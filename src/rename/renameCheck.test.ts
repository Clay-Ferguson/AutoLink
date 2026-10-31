import type * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REPORT_FILE } from '../analysis/linkAnalysis';
import { LinkService } from '../linkService';
import { FakeDocument, Uri, fake, workspace } from '../test/fakeVscode';
import { applyFixes, findLinksBrokenByRenames, type MovedLink } from './renameCheck';

const rename = (from: string, to: string) => ({
  oldUri: Uri.file(from) as unknown as vscode.Uri,
  newUri: Uri.file(to) as unknown as vscode.Uri,
});

/** Checks the renames and returns the broken links as plain data. */
async function check(...renames: [string, string][]) {
  const links = await findLinksBrokenByRenames(
    new LinkService(),
    renames.map(([from, to]) => rename(from, to)),
  );
  return links?.map(({ source, line, column, text, target, replacement }) => ({
    source: source.path,
    line,
    column,
    text,
    target: target.path,
    replacement,
  }));
}

/** Finds the broken links, with `vscode` types. */
async function find(...renames: [string, string][]): Promise<MovedLink[]> {
  const links = await findLinksBrokenByRenames(
    new LinkService(),
    renames.map(([from, to]) => rename(from, to)),
  );
  return links!;
}

/** Finds the broken links and fixes them. */
async function fix(...renames: [string, string][]) {
  return applyFixes(await find(...renames));
}

beforeEach(() => {
  fake.reset();
  fake.folders = ['/ws'];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('findLinksBrokenByRenames', () => {
  it('finds references to a renamed markdown file, but not ones broken before', async () => {
    fake.files.set('/ws/docs/new.md', '# New\n');
    fake.files.set('/ws/src/app.ts', '// (../docs/old.md#intro) and (docs/old.md)\n// (../docs/gone.md)\n');
    fake.files.set('/ws/src/other.ts', '// (../docs/gone.md)\n');
    expect(await check(['/ws/docs/old.md', '/ws/docs/new.md'])).toEqual([
      {
        source: '/ws/src/app.ts',
        line: 1,
        column: 5,
        text: '../docs/old.md#intro',
        target: '/ws/docs/new.md',
        replacement: '../docs/new.md#intro',
      },
      {
        source: '/ws/src/app.ts',
        line: 1,
        column: 32,
        text: 'docs/old.md',
        target: '/ws/docs/new.md',
        replacement: 'docs/new.md',
      },
    ]);
  });

  it("finds a moved source file's own references", async () => {
    fake.files.set('/ws/docs/guide.md', '# Guide\n');
    fake.files.set('/ws/lib/deep/a.ts', '// (../docs/guide.md) and (docs/guide.md)\n');
    expect(await check(['/ws/src/a.ts', '/ws/lib/deep/a.ts'])).toEqual([
      {
        source: '/ws/lib/deep/a.ts',
        line: 1,
        column: 5,
        text: '../docs/guide.md',
        target: '/ws/docs/guide.md',
        replacement: '../../docs/guide.md',
      },
    ]);
  });

  it('follows a renamed folder, leaving references inside it that still work', async () => {
    fake.files.set('/ws/guides/a.md', 'See [b](b.md).\n');
    fake.files.set('/ws/guides/b.md', '# B\n');
    fake.files.set('/ws/src/x.ts', '// (../docs/b.md)\n');
    const links = await check(['/ws/docs', '/ws/guides']);
    expect(links?.map(({ source, replacement }) => [source, replacement])).toEqual([['/ws/src/x.ts', '../guides/b.md']]);
  });

  it('follows chained renames', async () => {
    fake.files.set('/ws/sub/c.md', '# C\n');
    fake.files.set('/ws/x.ts', '// (a.md)\n');
    const links = await check(['/ws/a.md', '/ws/b.md'], ['/ws/b.md', '/ws/sub/c.md']);
    expect(links?.map(({ replacement }) => replacement)).toEqual(['sub/c.md']);
  });

  it('reports a reference it cannot rewrite without a replacement', async () => {
    fake.files.set('/ws/docs/a+b.md', '# A\n');
    fake.files.set('/ws/x.ts', '// (docs/old.md)\n');
    const links = await check(['/ws/docs/old.md', '/ws/docs/a+b.md']);
    expect(links).toMatchObject([{ text: 'docs/old.md', target: '/ws/docs/a+b.md', replacement: undefined }]);
  });

  it('finds nothing when the renamed file was not referenced', async () => {
    fake.files.set('/ws/docs/new.md', '# New\n');
    fake.files.set('/ws/src/app.ts', '// (../docs/other.md)\n');
    expect(await check(['/ws/docs/old.md', '/ws/docs/new.md'])).toEqual([]);
  });
});

describe('findLinksBrokenByRenames, bare file names', () => {
  it('rewrites a bare name when its file is renamed', async () => {
    fake.files.set('/ws/docs/guide/GUIDE.md', '# Guide\n');
    fake.files.set('/ws/src/app.ts', '// (USER_GUIDE.md#tab-bar)\n');
    expect(await check(['/ws/docs/guide/USER_GUIDE.md', '/ws/docs/guide/GUIDE.md'])).toMatchObject([
      { source: '/ws/src/app.ts', text: 'USER_GUIDE.md#tab-bar', target: '/ws/docs/guide/GUIDE.md', replacement: 'GUIDE.md#tab-bar' },
    ]);
  });

  it('writes a path when the new name is taken', async () => {
    fake.files.set('/ws/docs/guide/GUIDE.md', '# Guide\n');
    fake.files.set('/ws/other/GUIDE.md', '# Other\n');
    fake.files.set('/ws/src/app.ts', '// (USER_GUIDE.md)\n');
    expect(await check(['/ws/docs/guide/USER_GUIDE.md', '/ws/docs/guide/GUIDE.md'])).toMatchObject([
      { text: 'USER_GUIDE.md', replacement: 'docs/guide/GUIDE.md' },
    ]);
  });

  it('leaves a bare name alone when its file only moves', async () => {
    fake.files.set('/ws/manual/USER_GUIDE.md', '# Guide\n');
    fake.files.set('/ws/src/app.ts', '// (USER_GUIDE.md)\n');
    expect(await check(['/ws/docs/USER_GUIDE.md', '/ws/manual/USER_GUIDE.md'])).toEqual([]);
  });

  it('leaves a bare name alone that was ambiguous before', async () => {
    fake.files.set('/ws/a/GUIDE.md', '');
    fake.files.set('/ws/b/NOTES.md', '');
    fake.files.set('/ws/src/app.ts', '// (NOTES.md)\n');
    expect(await check(['/ws/a/NOTES.md', '/ws/a/GUIDE.md'])).toEqual([]);
  });
});

describe('findLinksBrokenByRenames, edge cases', () => {
  it('reports every reference to the renamed file, with lines and columns', async () => {
    fake.files.set('/ws/docs/new.md', '# New\n');
    fake.files.set('/ws/a.ts', '// (docs/old.md)\n\nx = "(docs/old.md#top)"; // (docs/old.md)\n');
    const links = await check(['/ws/docs/old.md', '/ws/docs/new.md']);
    expect(links?.map(({ line, column, text, replacement }) => [line, column, text, replacement])).toEqual([
      [1, 5, 'docs/old.md', 'docs/new.md'],
      [3, 7, 'docs/old.md#top', 'docs/new.md#top'],
      [3, 30, 'docs/old.md', 'docs/new.md'],
    ]);
  });

  it('sorts the references by file and position', async () => {
    fake.files.set('/ws/docs/new.md', '# New\n');
    fake.files.set('/ws/b.ts', '// (docs/old.md)\n');
    fake.files.set('/ws/a.ts', '// (docs/old.md) (docs/old.md)\n');
    fake.files.set('/ws/c/d.ts', '// (../docs/old.md)\n');
    const links = await check(['/ws/docs/old.md', '/ws/docs/new.md']);
    expect(links?.map(({ source, column }) => `${source}:${column}`)).toEqual([
      '/ws/a.ts:5',
      '/ws/a.ts:19',
      '/ws/b.ts:5',
      '/ws/c/d.ts:5',
    ]);
  });

  it('replaces only the path and anchor, not a title', async () => {
    fake.files.set('/ws/docs/new.md', '# New\n');
    fake.files.set('/ws/a.ts', '// (docs/old.md#x "The Title")\n');
    expect(await check(['/ws/docs/old.md', '/ws/docs/new.md'])).toMatchObject([
      { text: 'docs/old.md#x', replacement: 'docs/new.md#x' },
    ]);
  });

  it('rewrites a reference in angle brackets inside the brackets', async () => {
    fake.files.set('/ws/docs/my new.md', '# New\n');
    fake.files.set('/ws/a.ts', '// (<docs/my old.md#a>)\n');
    expect(await check(['/ws/docs/my old.md', '/ws/docs/my new.md'])).toMatchObject([
      { column: 6, text: 'docs/my old.md#a', replacement: 'docs/my new.md#a' },
    ]);
  });

  it('puts a new path with a space in angle brackets', async () => {
    fake.files.set('/ws/docs/my notes.md', '# Notes\n');
    fake.files.set('/ws/a.ts', '// (docs/old.md)\n');
    expect(await check(['/ws/docs/old.md', '/ws/docs/my notes.md'])).toMatchObject([
      { text: 'docs/old.md', replacement: '<docs/my notes.md>' },
    ]);
  });

  it('finds references in markdown files', async () => {
    fake.files.set('/ws/docs/new.md', '# New\n');
    fake.files.set('/ws/docs/index.md', '- [Old](old.md)\n- [Old again](./old.md#intro)\n');
    expect(await check(['/ws/docs/old.md', '/ws/docs/new.md'])).toMatchObject([
      { source: '/ws/docs/index.md', text: 'old.md', replacement: 'new.md' },
      { source: '/ws/docs/index.md', text: './old.md#intro', replacement: './new.md#intro' },
    ]);
  });

  it('rewrites a reference of the renamed file to itself', async () => {
    fake.files.set('/ws/docs/new.md', '# New\n\nSee [top](old.md#new).\n');
    expect(await check(['/ws/docs/old.md', '/ws/docs/new.md'])).toMatchObject([
      { source: '/ws/docs/new.md', text: 'old.md#new', replacement: 'new.md#new' },
    ]);
  });

  it('normalizes redundant segments in the replacement', async () => {
    fake.files.set('/ws/docs/new.md', '# New\n');
    fake.files.set('/ws/src/a.ts', '// (../src/../docs/old.md)\n');
    expect(await check(['/ws/docs/old.md', '/ws/docs/new.md'])).toMatchObject([
      { text: '../src/../docs/old.md', replacement: '../docs/new.md' },
    ]);
  });

  it('follows a rename that changes only the case of the name', async () => {
    fake.files.set('/ws/docs/guide.md', '# Guide\n');
    fake.files.set('/ws/a.ts', '// (docs/Guide.md)\n');
    expect(await check(['/ws/docs/Guide.md', '/ws/docs/guide.md'])).toMatchObject([
      { text: 'docs/Guide.md', replacement: 'docs/guide.md' },
    ]);
  });

  it('keeps an upper-case extension', async () => {
    fake.files.set('/ws/docs/NEW.MD', '# New\n');
    fake.files.set('/ws/a.ts', '// (docs/OLD.MD)\n');
    expect(await check(['/ws/docs/OLD.MD', '/ws/docs/NEW.MD'])).toMatchObject([{ replacement: 'docs/NEW.MD' }]);
  });

  it('counts lines and columns in a file with CRLF line endings', async () => {
    fake.files.set('/ws/docs/new.md', '# New\r\n');
    fake.files.set('/ws/a.ts', 'one\r\ntwo (docs/old.md)\r\n');
    expect(await check(['/ws/docs/old.md', '/ws/docs/new.md'])).toMatchObject([{ line: 2, column: 6 }]);
  });

  it('reads the unsaved text of an open document instead of the disk', async () => {
    fake.files.set('/ws/docs/new.md', '# New\n');
    fake.files.set('/ws/a.ts', '// nothing here\n');
    fake.files.set('/ws/b.ts', '// (docs/old.md)\n');
    fake.textDocuments.push(new FakeDocument(Uri.file('/ws/a.ts'), '// (docs/old.md) typed, not saved\n'));
    fake.textDocuments.push(new FakeDocument(Uri.file('/ws/b.ts'), '// already fixed by hand: (docs/new.md)\n'));
    const links = await check(['/ws/docs/old.md', '/ws/docs/new.md']);
    expect(links?.map(({ source }) => source)).toEqual(['/ws/a.ts']);
  });

  it('skips binary files, excluded folders and the report', async () => {
    fake.files.set('/ws/docs/new.md', '# New\n');
    fake.files.set('/ws/logo.png', '\u0089PNG\u0000(docs/old.md)');
    fake.files.set('/ws/node_modules/pkg/a.ts', '// (../../docs/old.md)');
    fake.files.set('/ws/.git/x.md', '(../docs/old.md)');
    fake.files.set(`/ws/${REPORT_FILE}`, '(docs/old.md)');
    expect(await check(['/ws/docs/old.md', '/ws/docs/new.md'])).toEqual([]);
  });

  it('skips files excluded by files.exclude', async () => {
    fake.settings.set('exclude', { '**/generated': true });
    fake.files.set('/ws/docs/new.md', '# New\n');
    fake.files.set('/ws/generated/a.ts', '// (../docs/old.md)');
    expect(await check(['/ws/docs/old.md', '/ws/docs/new.md'])).toEqual([]);
  });

  it('skips files excluded by excludePatterns', async () => {
    fake.settings.set('excludePatterns', ['generated/*']);
    fake.files.set('/ws/docs/new.md', '# New\n');
    fake.files.set('/ws/generated/a.ts', '// (../docs/old.md)');
    expect(await check(['/ws/docs/old.md', '/ws/docs/new.md'])).toEqual([]);
  });

  it('does not check a moved file that excludePatterns excludes', async () => {
    fake.settings.set('excludePatterns', ['lib/']);
    fake.files.set('/ws/src/guide.md', '# Near\n');
    fake.files.set('/ws/lib/a.ts', '// (guide.md)\n');
    expect(await check(['/ws/src/a.ts', '/ws/lib/a.ts'])).toEqual([]);
  });

  it('does not report a file that only mentions the old name', async () => {
    fake.files.set('/ws/docs/new.md', '# New\n');
    fake.files.set('/ws/a.ts', '// old.md was renamed; see (docs/other.md)\n');
    fake.files.set('/ws/docs/other.md', '# Other\n');
    expect(await check(['/ws/docs/old.md', '/ws/docs/new.md'])).toEqual([]);
  });

  it('reports a renamed markdown file it can no longer link to', async () => {
    fake.files.set('/ws/docs/a.txt', 'text\n');
    fake.files.set('/ws/x.ts', '// (docs/a.md)\n');
    expect(await check(['/ws/docs/a.md', '/ws/docs/a.txt'])).toMatchObject([
      { text: 'docs/a.md', target: '/ws/docs/a.txt', replacement: undefined },
    ]);
  });

  it('reports nothing when a file is renamed to the name a broken reference expects', async () => {
    fake.files.set('/ws/docs/a.md', '# A\n');
    fake.files.set('/ws/x.ts', '// (docs/a.md)\n');
    expect(await check(['/ws/docs/draft.txt', '/ws/docs/a.md'])).toEqual([]);
  });

  it('reports nothing when a non-markdown file is renamed in place', async () => {
    fake.files.set('/ws/docs/guide.md', '# Guide\n');
    fake.files.set('/ws/src/b.ts', '// (../docs/guide.md) (docs/guide.md)\n');
    expect(await check(['/ws/src/a.ts', '/ws/src/b.ts'])).toEqual([]);
  });

  it('reads only the moved file when no markdown file or folder was renamed', async () => {
    const findFiles = vi.spyOn(workspace, 'findFiles');
    fake.files.set('/ws/src/guide.md', '# Near\n');
    // `../src/guide.md` still resolves the same from /ws/lib; `./guide.md` doesn't
    // (a bare `guide.md` would still find the only guide.md by name).
    fake.files.set('/ws/lib/a.ts', '// (../src/guide.md) (./guide.md)\n');
    expect(await check(['/ws/src/a.ts', '/ws/lib/a.ts'])).toMatchObject([
      { text: './guide.md', replacement: '../src/guide.md' },
    ]);
    expect(findFiles).not.toHaveBeenCalled();
  });

  it('scans the workspace when a markdown file or a folder was renamed', async () => {
    const findFiles = vi.spyOn(workspace, 'findFiles');
    fake.files.set('/ws/docs/new.md', '# New\n');
    await check(['/ws/docs/old.md', '/ws/docs/new.md']);
    expect(findFiles).toHaveBeenCalledTimes(1);
    findFiles.mockClear();
    fake.files.set('/ws/guides/a.ts', '');
    await check(['/ws/src', '/ws/guides']);
    expect(findFiles).toHaveBeenCalledTimes(1);
  });

  it('checks a non-markdown file renamed twice at its final place only', async () => {
    fake.files.set('/ws/docs/guide.md', '# Guide\n');
    fake.files.set('/ws/deep/er/b.ts', '// (../docs/guide.md)\n');
    const links = await check(['/ws/src/a.ts', '/ws/src/b.ts'], ['/ws/src/b.ts', '/ws/deep/er/b.ts']);
    expect(links).toMatchObject([{ source: '/ws/deep/er/b.ts', replacement: '../../docs/guide.md' }]);
  });

  it('handles a source and its target moved apart in one batch', async () => {
    fake.files.set('/ws/manual/g.md', '# G\n');
    fake.files.set('/ws/lib/a.ts', '// (../docs/g.md#x)\n');
    const links = await check(['/ws/src/a.ts', '/ws/lib/a.ts'], ['/ws/docs/g.md', '/ws/manual/g.md']);
    expect(links).toMatchObject([{ source: '/ws/lib/a.ts', replacement: '../manual/g.md#x' }]);
  });

  it('handles a source and its target moved together into a new folder', async () => {
    fake.files.set('/ws/pkg/a.ts', '// (g.md)\n');
    fake.files.set('/ws/pkg/g.md', '# G\n');
    expect(await check(['/ws/src/a.ts', '/ws/pkg/a.ts'], ['/ws/src/g.md', '/ws/pkg/g.md'])).toEqual([]);
  });

  it('reports a moved source whose reference now finds a different file of the same name', async () => {
    fake.files.set('/ws/src/guide.md', '# The intended guide\n');
    fake.files.set('/ws/other/guide.md', '# A different guide\n');
    fake.files.set('/ws/other/a.ts', '// (guide.md)\n');
    expect(await check(['/ws/src/a.ts', '/ws/other/a.ts'])).toMatchObject([
      { text: 'guide.md', target: '/ws/src/guide.md', replacement: '../src/guide.md' },
    ]);
  });

  it('does not report a reference of a moved source that was broken before', async () => {
    fake.files.set('/ws/lib/a.ts', '// (gone.md) (../docs/gone.md)\n');
    expect(await check(['/ws/src/a.ts', '/ws/lib/a.ts'])).toEqual([]);
  });

  it('keeps a root-style reference root-style inside a renamed folder', async () => {
    fake.files.set('/ws/guides/a.md', 'See (docs/b.md).\n');
    fake.files.set('/ws/guides/b.md', '# B\n');
    expect(await check(['/ws/docs', '/ws/guides'])).toMatchObject([
      { source: '/ws/guides/a.md', text: 'docs/b.md', replacement: 'guides/b.md' },
    ]);
  });

  it('follows deep references into a renamed folder', async () => {
    fake.files.set('/ws/guides/sub/deep/x.md', '# X\n');
    fake.files.set('/ws/src/a.ts', '// (../docs/sub/deep/x.md#y)\n');
    expect(await check(['/ws/docs', '/ws/guides'])).toMatchObject([{ replacement: '../guides/sub/deep/x.md#y' }]);
  });

  it('reports a reference of a file moved out of the workspace without a replacement', async () => {
    fake.files.set('/ws/docs/g.md', '# G\n');
    fake.files.set('/tmp/a.ts', '// (../ws/docs/g.md) (docs/g.md)\n');
    // Both resolved from /ws/a.ts; from /tmp nothing may reach into /ws.
    expect(await check(['/ws/a.ts', '/tmp/a.ts'])).toMatchObject([
      { source: '/tmp/a.ts', text: '../ws/docs/g.md', target: '/ws/docs/g.md', replacement: undefined },
      { source: '/tmp/a.ts', text: 'docs/g.md', target: '/ws/docs/g.md', replacement: undefined },
    ]);
  });

  it('scans both workspace folders when a file moves between them, and cannot link across', async () => {
    fake.folders = ['/ws1', '/ws2'];
    fake.files.set('/ws2/docs/g.md', '# G\n');
    fake.files.set('/ws1/src/a.ts', '// (../docs/g.md)\n');
    fake.files.set('/ws2/src/b.ts', '// (../docs/g.md)\n');
    expect(await check(['/ws1/docs/g.md', '/ws2/docs/g.md'])).toMatchObject([
      { source: '/ws1/src/a.ts', target: '/ws2/docs/g.md', replacement: undefined },
    ]);
  });

  it('known limitation: does not report a root-style reference that a moved-in file now shadows', async () => {
    fake.files.set('/ws/guide.md', '# Root guide\n');
    fake.files.set('/ws/src/guide.md', '# Moved in\n');
    fake.files.set('/ws/src/a.ts', '// (guide.md)\n');
    expect(await check(['/ws/other/guide.md', '/ws/src/guide.md'])).toEqual([]);
  });

  it('does not resolve again the references the renames did not touch', async () => {
    fake.files.set('/ws/docs/new.md', '# New\n');
    fake.files.set('/ws/docs/other.md', '# Other\n');
    fake.files.set('/ws/a.ts', '// (docs/old.md) (docs/other.md) (docs/other.md#x)\n');
    const resolveTarget = vi.spyOn(LinkService.prototype, 'resolveTarget');
    await check(['/ws/docs/old.md', '/ws/docs/new.md']);
    // Once to see that docs/old.md is broken, once to check its replacement.
    expect(resolveTarget.mock.calls.map(([, refPath]) => refPath)).toEqual(['docs/old.md', 'docs/new.md']);
  });

  it('stops when cancelled', async () => {
    fake.files.set('/ws/docs/new.md', '# New\n');
    fake.files.set('/ws/a.ts', '// (docs/old.md)\n');
    const token = { isCancellationRequested: true } as vscode.CancellationToken;
    expect(await findLinksBrokenByRenames(new LinkService(), [rename('/ws/docs/old.md', '/ws/docs/new.md')], token)).toBeUndefined();
  });

  it('finds nothing without renames', async () => {
    expect(await check()).toEqual([]);
  });
});

describe('applyFixes', () => {
  it('rewrites and saves the references, after which nothing is broken', async () => {
    fake.files.set('/ws/docs/new.md', '# New\n');
    fake.files.set('/ws/src/app.ts', '// (../docs/old.md#intro) and (docs/old.md)\n');
    expect(await fix(['/ws/docs/old.md', '/ws/docs/new.md'])).toEqual({ links: 2, files: 1 });
    expect(fake.files.get('/ws/src/app.ts')).toBe('// (../docs/new.md#intro) and (docs/new.md)\n');
    expect(fake.saved).toEqual(['/ws/src/app.ts']);
    fake.textDocuments = [];
    expect(await check(['/ws/docs/old.md', '/ws/docs/new.md'])).toEqual([]);
  });

  it('applies replacements of different lengths in one file at the right places', async () => {
    fake.files.set('/ws/a/b/c/x.md', '# X\n');
    fake.files.set('/ws/src/app.ts', 'a (../x.md) b (../x.md#h) c\nd (./../x.md) e\n');
    await fix(['/ws/x.md', '/ws/a/b/c/x.md']);
    expect(fake.files.get('/ws/src/app.ts')).toBe('a (../a/b/c/x.md) b (../a/b/c/x.md#h) c\nd (../a/b/c/x.md) e\n');
  });

  it('rewrites several files as one edit, marked as a refactoring', async () => {
    fake.files.set('/ws/docs/new.md', '# New\n');
    fake.files.set('/ws/a.ts', '// (docs/old.md)\n');
    fake.files.set('/ws/b/c.ts', '// (../docs/old.md) (../docs/old.md)\n');
    expect(await fix(['/ws/docs/old.md', '/ws/docs/new.md'])).toEqual({ links: 3, files: 2 });
    expect(fake.appliedEdits).toHaveLength(1);
    expect(fake.appliedEdits[0].metadata).toEqual({ isRefactoring: true });
    expect(fake.files.get('/ws/a.ts')).toBe('// (docs/new.md)\n');
    expect(fake.files.get('/ws/b/c.ts')).toBe('// (../docs/new.md) (../docs/new.md)\n');
    expect(fake.saved.sort()).toEqual(['/ws/a.ts', '/ws/b/c.ts']);
  });

  it('keeps brackets and titles in the source intact', async () => {
    fake.files.set('/ws/docs/my notes.md', '# Notes\n');
    fake.files.set('/ws/a.ts', '// (docs/old.md "T") [x](docs/old.md#a)\n');
    await fix(['/ws/docs/old.md', '/ws/docs/my notes.md']);
    expect(fake.files.get('/ws/a.ts')).toBe('// (<docs/my notes.md> "T") [x](<docs/my notes.md#a>)\n');
  });

  it('rewrites a reference already in angle brackets inside them', async () => {
    fake.files.set('/ws/docs/plain.md', '# Plain\n');
    fake.files.set('/ws/a.ts', '// (<docs/my notes.md#a>)\n');
    await fix(['/ws/docs/my notes.md', '/ws/docs/plain.md']);
    expect(fake.files.get('/ws/a.ts')).toBe('// (<docs/plain.md#a>)\n');
  });

  it('keeps CRLF line endings', async () => {
    fake.files.set('/ws/docs/new.md', '# New\r\n');
    fake.files.set('/ws/a.ts', 'one\r\ntwo (docs/old.md)\r\nthree (docs/old.md)\r\n');
    await fix(['/ws/docs/old.md', '/ws/docs/new.md']);
    expect(fake.files.get('/ws/a.ts')).toBe('one\r\ntwo (docs/new.md)\r\nthree (docs/new.md)\r\n');
  });

  it('edits but does not save a document with unsaved changes', async () => {
    fake.files.set('/ws/docs/new.md', '# New\n');
    fake.files.set('/ws/a.ts', '// (docs/old.md)\n');
    const document = new FakeDocument(Uri.file('/ws/a.ts'), '// (docs/old.md) and my edit\n');
    document.isDirty = true;
    fake.textDocuments.push(document);
    expect(await fix(['/ws/docs/old.md', '/ws/docs/new.md'])).toEqual({ links: 1, files: 1 });
    expect(document.getText()).toBe('// (docs/new.md) and my edit\n');
    expect(document.isDirty).toBe(true);
    expect(fake.saved).toEqual([]);
    expect(fake.files.get('/ws/a.ts')).toBe('// (docs/old.md)\n');
  });

  it('saves an open document without unsaved changes', async () => {
    fake.files.set('/ws/docs/new.md', '# New\n');
    fake.files.set('/ws/a.ts', '// (docs/old.md)\n');
    fake.textDocuments.push(new FakeDocument(Uri.file('/ws/a.ts'), '// (docs/old.md)\n'));
    await fix(['/ws/docs/old.md', '/ws/docs/new.md']);
    expect(fake.saved).toEqual(['/ws/a.ts']);
    expect(fake.files.get('/ws/a.ts')).toBe('// (docs/new.md)\n');
  });

  it('leaves out references without a replacement', async () => {
    fake.files.set('/ws/docs/a+b.md', '# A\n');
    fake.files.set('/ws/docs/ok.md', '# OK\n');
    fake.files.set('/ws/x.ts', '// (docs/old.md) (docs/old2.md)\n');
    const links = await find(['/ws/docs/old.md', '/ws/docs/a+b.md'], ['/ws/docs/old2.md', '/ws/docs/ok.md']);
    expect(links).toHaveLength(2);
    expect(await applyFixes(links)).toEqual({ links: 1, files: 1 });
    expect(fake.files.get('/ws/x.ts')).toBe('// (docs/old.md) (docs/ok.md)\n');
  });

  it('leaves alone a reference whose text changed since it was found', async () => {
    fake.files.set('/ws/docs/new.md', '# New\n');
    fake.files.set('/ws/a.ts', '// (docs/old.md) (docs/old.md)\n');
    const links = await find(['/ws/docs/old.md', '/ws/docs/new.md']);
    // The user edits the first reference while the prompt is open.
    const document = new FakeDocument(Uri.file('/ws/a.ts'), '// (docs/odd.md) (docs/old.md)\n');
    document.isDirty = true;
    fake.textDocuments.push(document);
    expect(await applyFixes(links)).toEqual({ links: 1, files: 1 });
    expect(document.getText()).toBe('// (docs/odd.md) (docs/new.md)\n');
  });

  it('leaves alone references that moved within the file since they were found', async () => {
    fake.files.set('/ws/docs/new.md', '# New\n');
    fake.files.set('/ws/a.ts', '// (docs/old.md)\n');
    const links = await find(['/ws/docs/old.md', '/ws/docs/new.md']);
    const document = new FakeDocument(Uri.file('/ws/a.ts'), '// inserted\n// (docs/old.md)\n');
    document.isDirty = true;
    fake.textDocuments.push(document);
    expect(await applyFixes(links)).toEqual({ links: 0, files: 0 });
    expect(fake.appliedEdits).toEqual([]);
    expect(document.getText()).toBe('// inserted\n// (docs/old.md)\n');
  });

  it('skips a file deleted since it was checked and fixes the others', async () => {
    fake.files.set('/ws/docs/new.md', '# New\n');
    fake.files.set('/ws/a.ts', '// (docs/old.md)\n');
    fake.files.set('/ws/b.ts', '// (docs/old.md)\n');
    const links = await find(['/ws/docs/old.md', '/ws/docs/new.md']);
    fake.files.delete('/ws/a.ts');
    expect(await applyFixes(links)).toEqual({ links: 1, files: 1 });
    expect(fake.files.get('/ws/b.ts')).toBe('// (docs/new.md)\n');
  });

  it('saves nothing and reports nothing when the edit is refused', async () => {
    fake.files.set('/ws/docs/new.md', '# New\n');
    fake.files.set('/ws/a.ts', '// (docs/old.md)\n');
    fake.applyEditSucceeds = false;
    expect(await fix(['/ws/docs/old.md', '/ws/docs/new.md'])).toEqual({ links: 0, files: 0 });
    expect(fake.saved).toEqual([]);
    expect(fake.files.get('/ws/a.ts')).toBe('// (docs/old.md)\n');
  });

  it('applies no edit when there is nothing to fix', async () => {
    expect(await applyFixes([])).toEqual({ links: 0, files: 0 });
    expect(fake.appliedEdits).toEqual([]);
  });
});
