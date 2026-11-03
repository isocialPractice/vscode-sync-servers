// What must agree before a release is built.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseProblems, type ReleaseFiles } from '../../scripts/lib/release-rules.mts';
import { readText } from '../helpers/files.ts';

function files(version: string, changelog = `## [${version}] - 2026-10-30`): ReleaseFiles {
  return {
    packageJson: JSON.stringify({ version }),
    packageLock: JSON.stringify({ version, packages: { '': { version } } }),
    changelog,
  };
}

test('an alpha tag that agrees with every file can be released', () => {
  assert.deepEqual(releaseProblems('v1.0.0-alpha.0.5.0', files('1.0.0-alpha.0.5.0')), []);
});

test('a tag, a lock file or a changelog that disagrees stops the release', () => {
  assert.match(releaseProblems('v1.0.0-alpha.0.4.0', files('1.0.0-alpha.0.5.0')).join('\n'), /is not "v1\.0\.0-alpha\.0\.5\.0"/);
  const stale = { ...files('1.0.0-alpha.0.5.0'), packageLock: JSON.stringify({ version: '1.0.0-alpha.0.4.0', packages: { '': { version: '1.0.0-alpha.0.4.0' } } }) };
  assert.match(releaseProblems('v1.0.0-alpha.0.5.0', stale).join('\n'), /package-lock\.json/);
  assert.match(releaseProblems('v1.0.0-alpha.0.5.0', files('1.0.0-alpha.0.5.0', '## [Unreleased]')).join('\n'), /CHANGELOG\.md/);
});

test('a stable version is refused until Marketplace releases are set up', () => {
  assert.match(releaseProblems('v1.0.0', files('1.0.0')).join('\n'), /not an alpha/);
});

test('the repository as it stands can be released under its own version', () => {
  const manifest = JSON.parse(readText('package.json')) as { version: string };
  assert.deepEqual(
    releaseProblems(`v${manifest.version}`, { packageJson: readText('package.json'), packageLock: readText('package-lock.json'), changelog: readText('CHANGELOG.md') }),
    [],
  );
});
