// The marks on files in the Explorer and the Remote Files view, and which
// saved files upload on save.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { siteSchema, type Site, type SyncRecord } from '@isocialpractice/cmd-sync-servers';
import { CLOAKED_MARK, CONFLICT_MARK, differs, holdBack, localEntry, markFor, type MarkInput } from '../../src/marks.ts';
import { sampleSite } from '../helpers/sites.ts';

const record: SyncRecord = { local: { size: 10, mtimeMs: 1_000_000 }, remote: { size: 12, mtimeMs: 2_000_000 }, syncedAt: 3_000_000 };
const base: MarkInput = {
  side: 'local',
  cloaked: false,
  conflict: false,
  observed: { size: 10, mtimeMs: 1_000_000 },
  record,
  everSynced: true,
  toleranceMs: 2000,
};

test('a file as it was at the last sync has no mark', () => {
  assert.equal(markFor(base), undefined);
  assert.equal(markFor({ ...base, side: 'remote', observed: { size: 12, mtimeMs: 2_001_500 } }), undefined, 'a server time within the tolerance');
});

test('a local file saved again within the tolerance is changed, as the engine sees it', () => {
  assert.equal(markFor({ ...base, observed: { size: 10, mtimeMs: 1_001_500 } })?.badge, '↑');
});

test('a file changed since the last sync is marked with an arrow the way it would move', () => {
  assert.equal(markFor({ ...base, observed: { size: 11, mtimeMs: 1_000_000 } })?.badge, '↑');
  assert.equal(markFor({ ...base, observed: { size: 10, mtimeMs: 1_010_000 } })?.tooltip, 'Changed since the last sync. Put uploads it.');
  const remote = markFor({ ...base, side: 'remote', observed: { size: 13, mtimeMs: 2_000_000 } });
  assert.equal(remote?.badge, '↓');
  assert.equal(remote.word, 'changed on the server');
});

test('a file added since the last sync is new; before any sync nothing is marked', () => {
  assert.equal(markFor({ ...base, record: undefined })?.word, 'new');
  assert.equal(markFor({ ...base, record: undefined, everSynced: false }), undefined);
  assert.equal(markFor({ ...base, observed: undefined }), undefined, 'folders carry no change mark');
});

test('cloaked items are dimmed, and files that need a decision warn, before anything else', () => {
  assert.equal(markFor({ ...base, cloaked: true, conflict: true }), CLOAKED_MARK);
  assert.equal(markFor({ ...base, conflict: true }), CONFLICT_MARK);
  assert.equal(CONFLICT_MARK.tone, 'warning');
  for (const mark of [CLOAKED_MARK, CONFLICT_MARK]) {
    assert.ok(Array.from(new Intl.Segmenter().segment(mark.badge)).length <= 2, 'a badge is at most two characters');
    assert.ok(mark.tooltip.endsWith('.'), 'every badge has a tooltip');
  }
});

test('times are compared only when both sides have one', () => {
  assert.equal(differs({ size: 1, mtimeMs: undefined }, { size: 1, mtimeMs: 5 }, 0), false);
  assert.equal(differs({ size: 1, mtimeMs: 10 }, { size: 1, mtimeMs: 5 }, 0), true);
});

test('cloaked and sensitive files are held back from upload on save, with the reason', () => {
  const site = siteSchema.parse({
    ...sampleSite(path.join(tmpdir(), 'my-site'), path.join(tmpdir(), 'my-site-backup')),
    cloaking: { patterns: ['.psd'], paths: ['drafts'] },
  });
  assert.equal(holdBack(site, 'index.html'), undefined);
  assert.equal(holdBack(site, 'art/cover.psd'), 'it is cloaked');
  assert.equal(holdBack(site, 'drafts/next.html'), 'it is cloaked');
  assert.equal(holdBack(site, '.env'), 'it matches the sensitive pattern ".env"');
});

test('a global cloaking pattern holds a file back from upload on save, unless the site re-includes it or turns them off', () => {
  const base = sampleSite(path.join(tmpdir(), 'my-site'), path.join(tmpdir(), 'my-site-backup'));
  const site = siteSchema.parse({ ...base, cloaking: { patterns: ['!keep.lnk'] } });
  assert.equal(holdBack(site, 'docs/Shortcut.lnk', ['*.lnk']), 'it is cloaked');
  assert.equal(holdBack(site, 'keep.lnk', ['*.lnk']), undefined, 'the site re-includes it');
  assert.equal(holdBack(site, 'docs/Shortcut.lnk'), undefined);
  const off = siteSchema.parse({ ...base, cloaking: { useGlobalPatterns: false } });
  assert.equal(holdBack(off, 'docs/Shortcut.lnk', ['*.lnk']), undefined);
});

/**
 * A local folder with a junction `img` to `shared/img` and, where file links
 * can be made, `css/site.css` to `../shared/site.css`, `css/theme.css` to a
 * file outside the site and `css/gone.css` to nothing.
 */
function linkedFolder(): { local: string; fileLinks: boolean; site: (symlinks: Site['sync']['symlinks']) => Site; cleanup: () => void } {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'sync-servers-marks-')));
  const local = path.join(dir, 'site');
  const outside = path.join(dir, 'outside');
  mkdirSync(path.join(local, 'shared', 'img'), { recursive: true });
  mkdirSync(path.join(local, 'css'));
  mkdirSync(outside);
  writeFileSync(path.join(local, 'shared', 'site.css'), 'body {}');
  writeFileSync(path.join(outside, 'theme.css'), 'h1 { color: red }');
  symlinkSync(path.join(local, 'shared', 'img'), path.join(local, 'img'), 'junction');
  let fileLinks = true;
  try {
    symlinkSync(path.join('..', 'shared', 'site.css'), path.join(local, 'css', 'site.css'), 'file');
    symlinkSync(path.join(outside, 'theme.css'), path.join(local, 'css', 'theme.css'), 'file');
    symlinkSync(path.join(local, 'missing.css'), path.join(local, 'css', 'gone.css'), 'file');
  } catch {
    fileLinks = false;
  }
  const base = sampleSite(local, path.join(dir, 'backup'));
  return {
    local,
    fileLinks,
    site: (symlinks) => ({ ...base, sync: { ...base.sync, symlinks } }),
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('a folder link is a folder where the site follows links, and a link where it does not', () => {
  const folder = linkedFolder();
  try {
    const img = path.join(folder.local, 'img');
    assert.equal(localEntry(folder.site('skip'), img)?.isSymbolicLink(), true);
    for (const policy of ['follow-inside-root', 'follow'] as const) {
      assert.equal(localEntry(folder.site(policy), img)?.isDirectory(), true, policy);
    }
    assert.equal(localEntry(folder.site('follow'), path.join(folder.local, 'shared', 'site.css'))?.isFile(), true);
    assert.equal(localEntry(folder.site('follow'), path.join(folder.local, 'nothing.css')), undefined);
  } finally {
    folder.cleanup();
  }
});

test('a file link the site follows carries the mark of the file it points to', (t) => {
  const folder = linkedFolder();
  try {
    if (!folder.fileLinks) {
      t.skip('creating file links is not permitted here');
      return;
    }
    const at = (name: string): string => path.join(folder.local, 'css', name);
    assert.equal(localEntry(folder.site('skip'), at('site.css'))?.isSymbolicLink(), true);
    assert.equal(localEntry(folder.site('follow-inside-root'), at('site.css'))?.isFile(), true);
    assert.equal(localEntry(folder.site('follow-inside-root'), at('theme.css'))?.isSymbolicLink(), true, 'it leads out of the site');
    assert.equal(localEntry(folder.site('follow'), at('theme.css'))?.size, 17);
    assert.equal(localEntry(folder.site('follow'), at('gone.css'))?.isSymbolicLink(), true, 'a broken link is itself');

    const real = statSync(path.join(folder.local, 'shared', 'site.css'));
    const synced: SyncRecord = { local: { size: real.size, mtimeMs: real.mtimeMs }, remote: { size: real.size, mtimeMs: real.mtimeMs }, syncedAt: real.mtimeMs };
    const older: SyncRecord = { ...synced, local: { size: real.size - 1, mtimeMs: real.mtimeMs - 60_000 } };
    const markOf = (symlinks: Site['sync']['symlinks'], record: SyncRecord): string | undefined => {
      const info = localEntry(folder.site(symlinks), at('site.css'));
      return markFor({ ...base, observed: info?.isFile() === true ? { size: info.size, mtimeMs: info.mtimeMs } : undefined, record })?.word;
    };
    for (const policy of ['follow-inside-root', 'follow'] as const) {
      assert.equal(markOf(policy, synced), undefined, `${policy}: in sync, like the file itself`);
      assert.equal(markOf(policy, older), 'changed', `${policy}: changed since the last sync, like the file itself`);
    }
    assert.equal(markOf('skip', older), undefined, 'a link the site skips is not a file of the site');
  } finally {
    folder.cleanup();
  }
});
