// The rules every GitHub Actions workflow of this repository follows, checked
// line by line so a careless edit fails CI instead of weakening the pipeline.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT, readText } from '../helpers/files.ts';

const workflows = readdirSync(path.join(ROOT, '.github', 'workflows'))
  .filter((name) => name.endsWith('.yml'))
  .map((name) => ({ name, lines: readText(`.github/workflows/${name}`).split(/\r?\n/) }));

function indent(line: string): number {
  return line.length - line.trimStart().length;
}

test('there are workflows to check', () => {
  assert.deepEqual(workflows.map((workflow) => workflow.name).sort(), [
    'ci.yml',
    'codeql.yml',
    'dependency-review.yml',
    'pages.yml',
    'release.yml',
    'scorecard.yml',
  ]);
});

for (const { name, lines } of workflows) {
  test(`${name} grants nothing by default and never runs on pull_request_target`, () => {
    assert.ok(lines.includes('permissions: {}'), 'top-level permissions: {}');
    assert.ok(!lines.some((line) => line.includes('pull_request_target')));
    assert.ok(!lines.some((line) => /:\s*write-all/.test(line)));
  });

  test(`${name} pins every action to a full commit with its version in a comment`, () => {
    for (const line of lines.filter((candidate) => /^\s*(?:-\s+)?uses:/.test(candidate))) {
      assert.match(line, /uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+(?:\.\d+){0,2}$/, line.trim());
    }
  });

  test(`${name} checks out without keeping credentials`, () => {
    lines.forEach((line, index) => {
      if (/uses: actions\/checkout@/.test(line)) {
        const block = lines.slice(index + 1, index + 6).join('\n');
        assert.match(block, /persist-credentials: false/, `${name}:${String(index + 1)}`);
      }
    });
  });

  test(`${name} passes no expression into a script; values reach run steps through env`, () => {
    lines.forEach((line, index) => {
      const match = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(line);
      if (match === null) {
        return;
      }
      const runIndent = (match[1] ?? '').length;
      const inline = match[2] ?? '';
      assert.ok(!inline.includes('${{'), `${name}:${String(index + 1)}: ${inline}`);
      if (inline === '|' || inline === '>') {
        for (let next = index + 1; next < lines.length; next += 1) {
          const body = lines[next] ?? '';
          if (body.trim() !== '' && indent(body) <= runIndent + 2) {
            break;
          }
          assert.ok(!body.includes('${{'), `${name}:${String(next + 1)}: ${body.trim()}`);
        }
      }
    });
  });
}

test('installs use the lock file and never run dependency scripts', () => {
  for (const { name, lines } of workflows) {
    for (const line of lines.filter((candidate) => /\bnpm (?:ci|install|i)\b/.test(candidate))) {
      assert.match(line, /npm ci --ignore-scripts/, `${name}: ${line.trim()}`);
    }
  }
});

test('only the release workflow writes contents, from its attach job alone, and nothing publishes to a marketplace', () => {
  for (const { name, lines } of workflows) {
    const writes = lines.filter((line) => /^\s+(?:contents|packages): write$/.test(line));
    assert.equal(writes.length, name === 'release.yml' ? 1 : 0, name);
    assert.ok(!lines.some((line) => /\b(?:vsce publish|ovsx publish|npm publish)\b/.test(line)), `${name} publishes nothing until 1.0.0`);
  }
});

test('the release builds the tag by its full ref, attests in a job that runs no repository code, and never replaces files', () => {
  const release = workflows.find((workflow) => workflow.name === 'release.yml')?.lines ?? [];
  assert.ok(release.some((line) => line.trim() === 'ref: refs/tags/${{ github.event.release.tag_name || inputs.tag }}'));
  const attest = release.slice(
    release.findIndex((line) => line === '  attest:'),
    release.findIndex((line) => line === '  attach:'),
  );
  assert.ok(attest.length > 0);
  assert.ok(!attest.some((line) => /actions\/checkout@|npm (?:ci|run)/.test(line)), 'the attest job checks out and runs nothing of the repository');
  assert.ok(!release.some((line) => line.includes('--clobber')));
});

test('every workflow installs the engine from npm with the lockfile, never from a checkout of its repository', () => {
  assert.ok(workflows.length > 0);
  for (const workflow of workflows) {
    assert.ok(!workflow.lines.some((line) => line.trim() === 'repository: isocialPractice/cmd-sync-servers'), `${workflow.name} checks out the engine`);
    assert.ok(!workflow.lines.some((line) => line.includes('ENGINE_REF')), `${workflow.name} reads ENGINE_REF`);
  }
  const ci = workflows.find((workflow) => workflow.name === 'ci.yml')?.lines ?? [];
  assert.ok(ci.some((line) => line.trim() === '- run: npm ci --ignore-scripts'));
});
