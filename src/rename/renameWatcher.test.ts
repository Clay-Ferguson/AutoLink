import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REPORT_FILE } from '../analysis/linkAnalysis';
import type { AutoLinkConfig, RenameMode } from '../config';
import { LinkService } from '../linkService';
import { FakeDocument, Uri, fake, workspace } from '../test/fakeVscode';
import { RenameLinkUpdater } from './renameWatcher';

const FIX = 'Fix Links';
const SHOW = 'Show';
const REPORT = `/ws/${REPORT_FILE}`;

let mode: RenameMode;
const getConfig = (): AutoLinkConfig => ({
  fileExtensions: new Set(['ts']),
  warnOnBrokenLinks: true,
  updateLinksOnRename: mode,
  excludePatterns: () => [],
});
let updater: RenameLinkUpdater;

/** Fires a rename event, as VS Code does after a rename in the Explorer. */
function renamed(...pairs: [string, string][]): void {
  fake.renames.fire({ files: pairs.map(([from, to]) => ({ oldUri: Uri.file(from), newUri: Uri.file(to) })) });
}

/** Lets the given time pass, then lets everything that started finish. */
async function settle(ms = 500): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await new Promise((resolve) => setImmediate(resolve));
}

const texts = () => fake.messages.map(({ kind, message, items }) => [kind, message, items]);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  fake.reset();
  fake.folders = ['/ws'];
  mode = 'prompt';
  // The state after renaming docs/old.md to docs/new.md.
  fake.files.set('/ws/docs/new.md', '# New\n');
  fake.files.set('/ws/a.ts', '// (docs/old.md)\n');
  updater = new RenameLinkUpdater(new LinkService(), getConfig);
});

afterEach(() => {
  updater.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('RenameLinkUpdater', () => {
  it('asks after a rename, and changes nothing when the message is dismissed', async () => {
    renamed(['/ws/docs/old.md', '/ws/docs/new.md']);
    await settle();
    expect(fake.progress).toEqual(['AutoLink: Checking links']);
    expect(texts()).toEqual([['warning', 'AutoLink: Renaming old.md broke 1 link in 1 file.', [FIX, SHOW]]]);
    expect(fake.files.get('/ws/a.ts')).toBe('// (docs/old.md)\n');
    expect(fake.appliedEdits).toEqual([]);
  });

  it('waits for the pause after the last rename before checking', async () => {
    renamed(['/ws/docs/old.md', '/ws/docs/new.md']);
    await settle(499);
    expect(fake.progress).toEqual([]);
    await settle(1);
    expect(fake.progress).toHaveLength(1);
  });

  it('rewrites and saves the references on Fix Links, then says so', async () => {
    fake.answers = [FIX];
    renamed(['/ws/docs/old.md', '/ws/docs/new.md']);
    await settle();
    expect(fake.files.get('/ws/a.ts')).toBe('// (docs/new.md)\n');
    expect(fake.saved).toEqual(['/ws/a.ts']);
    expect(texts()[1]).toEqual(['info', 'AutoLink: Updated 1 link in 1 file.', []]);
  });

  it('writes and opens the report on Show, then asks again', async () => {
    fake.answers = [SHOW, FIX];
    renamed(['/ws/docs/old.md', '/ws/docs/new.md']);
    await settle();
    expect(fake.shown).toEqual([REPORT]);
    const report = fake.files.get(REPORT)!;
    expect(report).toContain('docs/old.md  -> docs/new.md');
    expect(report).toContain('a.ts:1:5  docs/old.md  -> docs/new.md');
    expect(texts().map(([kind]) => kind)).toEqual(['warning', 'warning', 'info']);
    expect(texts()[1]).toEqual(texts()[0]);
    expect(fake.files.get('/ws/a.ts')).toBe('// (docs/new.md)\n');
  });

  it('changes nothing when dismissed after Show', async () => {
    fake.answers = [SHOW, SHOW, undefined];
    renamed(['/ws/docs/old.md', '/ws/docs/new.md']);
    await settle();
    expect(fake.messages).toHaveLength(3);
    expect(fake.files.get('/ws/a.ts')).toBe('// (docs/old.md)\n');
  });

  it('updates without asking when set to always', async () => {
    mode = 'always';
    renamed(['/ws/docs/old.md', '/ws/docs/new.md']);
    await settle();
    expect(texts()).toEqual([['info', 'AutoLink: Updated 1 link in 1 file.', []]]);
    expect(fake.files.get('/ws/a.ts')).toBe('// (docs/new.md)\n');
  });

  it('does not check at all when set to never', async () => {
    mode = 'never';
    renamed(['/ws/docs/old.md', '/ws/docs/new.md']);
    await settle();
    expect(fake.progress).toEqual([]);
    expect(fake.messages).toEqual([]);
  });

  it('says nothing when the setting changes to never before the check ends', async () => {
    renamed(['/ws/docs/old.md', '/ws/docs/new.md']);
    mode = 'never';
    await settle();
    expect(fake.messages).toEqual([]);
    expect(fake.files.get('/ws/a.ts')).toBe('// (docs/old.md)\n');
  });

  it('uses the setting at the end of the check', async () => {
    renamed(['/ws/docs/old.md', '/ws/docs/new.md']);
    mode = 'always';
    await settle();
    expect(texts()).toEqual([['info', 'AutoLink: Updated 1 link in 1 file.', []]]);
  });

  it('says nothing when the rename broke no reference', async () => {
    fake.files.set('/ws/docs/other.md', '# Other\n');
    renamed(['/ws/docs/x.md', '/ws/docs/other.md']);
    await settle();
    expect(fake.progress).toHaveLength(1);
    expect(fake.messages).toEqual([]);
  });

  it('offers only Show when no reference can be rewritten', async () => {
    fake.files.delete('/ws/docs/new.md');
    fake.files.set('/ws/docs/a+b.md', '# A\n');
    renamed(['/ws/docs/old.md', '/ws/docs/a+b.md']);
    await settle();
    expect(texts()).toEqual([['warning', 'AutoLink: Renaming old.md broke 1 link in 1 file.', [SHOW]]]);
  });

  it('warns about the references it could not update, and shows them', async () => {
    fake.files.set('/ws/docs/a+b.md', '# A\n');
    fake.files.set('/ws/a.ts', '// (docs/old.md) (docs/old2.md)\n');
    fake.answers = [FIX, SHOW];
    renamed(['/ws/docs/old.md', '/ws/docs/new.md'], ['/ws/docs/old2.md', '/ws/docs/a+b.md']);
    await settle();
    expect(texts()[1]).toEqual(['warning', 'AutoLink: Updated 1 link in 1 file. 1 link could not be updated.', [SHOW]]);
    expect(fake.files.get(REPORT)).toContain('cannot update, the file is now docs/a+b.md');
    expect(fake.files.get('/ws/a.ts')).toBe('// (docs/new.md) (docs/old2.md)\n');
  });

  it('says only what failed when set to always and nothing could be updated', async () => {
    mode = 'always';
    fake.files.delete('/ws/docs/new.md');
    fake.files.set('/ws/docs/a+b.md', '# A\n');
    renamed(['/ws/docs/old.md', '/ws/docs/a+b.md']);
    await settle();
    expect(texts()).toEqual([['warning', 'AutoLink: 1 link could not be updated.', [SHOW]]]);
  });

  it('counts the files and says Moving for a move to another folder', async () => {
    fake.files.delete('/ws/docs/new.md');
    fake.files.set('/ws/manual/old.md', '# Old\n');
    fake.files.set('/ws/a.ts', '// (docs/old.md) (docs/old.md)\n');
    fake.files.set('/ws/b.ts', '// (docs/old.md)\n');
    renamed(['/ws/docs/old.md', '/ws/manual/old.md']);
    await settle();
    expect(texts()[0][1]).toBe('AutoLink: Moving old.md broke 3 links in 2 files.');
  });

  it('checks a burst of renames once', async () => {
    fake.files.set('/ws/docs/new2.md', '# New 2\n');
    fake.files.set('/ws/a.ts', '// (docs/old.md) (docs/old2.md)\n');
    renamed(['/ws/docs/old.md', '/ws/docs/new.md']);
    await settle(300);
    renamed(['/ws/docs/old2.md', '/ws/docs/new2.md']);
    await settle(300);
    expect(fake.progress).toEqual([]);
    await settle(200);
    expect(fake.progress).toHaveLength(1);
    expect(texts()).toEqual([['warning', 'AutoLink: Renaming 2 items broke 2 links in 1 file.', [FIX, SHOW]]]);
  });

  it('starts over with all renames when one arrives during a check', async () => {
    fake.files.set('/ws/docs/new2.md', '# New 2\n');
    fake.files.set('/ws/a.ts', '// (docs/old.md) (docs/old2.md)\n');
    fake.onProgress = () => {
      fake.onProgress = undefined;
      renamed(['/ws/docs/old2.md', '/ws/docs/new2.md']);
    };
    const readFile = vi.spyOn(workspace.fs, 'readFile');
    renamed(['/ws/docs/old.md', '/ws/docs/new.md']);
    await settle();
    expect(fake.messages).toEqual([]);
    // The first check stopped before reading anything.
    expect(readFile).not.toHaveBeenCalled();
    await settle();
    expect(fake.progress).toHaveLength(2);
    expect(readFile).toHaveBeenCalledTimes(3);
    expect(texts()).toEqual([['warning', 'AutoLink: Renaming 2 items broke 2 links in 1 file.', [FIX, SHOW]]]);
  });

  it('follows chained renames of one file in a burst', async () => {
    fake.files.delete('/ws/docs/new.md');
    fake.files.set('/ws/final/c.md', '# C\n');
    fake.answers = [FIX];
    renamed(['/ws/docs/old.md', '/ws/docs/b.md']);
    renamed(['/ws/docs/b.md', '/ws/final/c.md']);
    await settle();
    expect(fake.files.get('/ws/a.ts')).toBe('// (final/c.md)\n');
  });

  it('checks a later rename on its own once the earlier one is done', async () => {
    renamed(['/ws/docs/old.md', '/ws/docs/new.md']);
    await settle();
    fake.files.set('/ws/docs/z.md', '# Z\n');
    fake.files.set('/ws/b.ts', '// (docs/y.md)\n');
    renamed(['/ws/docs/y.md', '/ws/docs/z.md']);
    await settle();
    expect(texts().map(([, message]) => message)).toEqual([
      'AutoLink: Renaming old.md broke 1 link in 1 file.',
      'AutoLink: Renaming y.md broke 1 link in 1 file.',
    ]);
  });

  it('ignores renames of files that are not on disk', async () => {
    fake.renames.fire({
      files: [{ oldUri: Uri.parse('untitled:Untitled-1'), newUri: Uri.parse('untitled:Untitled-2') }],
    });
    fake.renames.fire({
      files: [{ oldUri: Uri.parse('vscode-vfs://host/docs/old.md'), newUri: Uri.file('/ws/docs/new.md') }],
    });
    await settle();
    expect(fake.progress).toEqual([]);
  });

  it('ignores a rename from disk to somewhere else', async () => {
    fake.renames.fire({
      files: [{ oldUri: Uri.file('/ws/docs/old.md'), newUri: Uri.parse('vscode-vfs://host/ws/docs/new.md') }],
    });
    await settle();
    expect(fake.progress).toEqual([]);
  });

  it('checks only the renames on disk of a mixed event', async () => {
    fake.renames.fire({
      files: [
        { oldUri: Uri.parse('untitled:Untitled-1'), newUri: Uri.parse('untitled:Untitled-2') },
        { oldUri: Uri.file('/ws/docs/old.md'), newUri: Uri.file('/ws/docs/new.md') },
      ],
    });
    await settle();
    expect(texts()[0][1]).toBe('AutoLink: Renaming old.md broke 1 link in 1 file.');
  });

  it('edits but does not save a document with unsaved changes', async () => {
    const document = new FakeDocument(Uri.file('/ws/a.ts'), '// (docs/old.md) unsaved\n');
    document.isDirty = true;
    fake.textDocuments.push(document);
    fake.answers = [FIX];
    renamed(['/ws/docs/old.md', '/ws/docs/new.md']);
    await settle();
    expect(document.getText()).toBe('// (docs/new.md) unsaved\n');
    expect(fake.saved).toEqual([]);
  });

  it('writes the report into the workspace for a file moved out of it', async () => {
    fake.files.delete('/ws/a.ts');
    fake.files.set('/ws/docs/g.md', '# G\n');
    fake.files.set('/tmp/a.ts', '// (docs/g.md)\n');
    fake.answers = [SHOW];
    renamed(['/ws/a.ts', '/tmp/a.ts']);
    await settle();
    expect(fake.shown).toEqual([REPORT]);
    expect(fake.files.has('/tmp/AUTOLINK_ANALYSIS.md')).toBe(false);
  });

  it('stops following renames when disposed', async () => {
    updater.dispose();
    renamed(['/ws/docs/old.md', '/ws/docs/new.md']);
    await settle();
    expect(fake.progress).toEqual([]);
  });

  it('drops a waiting check when disposed', async () => {
    renamed(['/ws/docs/old.md', '/ws/docs/new.md']);
    await settle(100);
    updater.dispose();
    await settle(1000);
    expect(fake.progress).toEqual([]);
    expect(fake.messages).toEqual([]);
  });
});
