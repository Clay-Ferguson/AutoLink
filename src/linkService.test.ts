import type * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkService, listMatches } from './linkService';
import { findLinkRefs } from './scan/linkScanner';
import { FakeDocument, Uri, fake, workspace } from './test/fakeVscode';

const asDocument = (document: FakeDocument) => document as unknown as vscode.TextDocument;
const asUri = (uri: Uri) => uri as unknown as vscode.Uri;

beforeEach(() => {
  fake.reset();
  fake.folders = ['/ws'];
  fake.files.set('/ws/docs/guide.md', '# Guide\n\n## Tab Bar\n');
  fake.files.set('/outside/secret.md', '# Secret\n');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LinkService.resolveTarget', () => {
  it('resolves relative to the workspace root', async () => {
    const target = await new LinkService().resolveTarget(asUri(Uri.file('/ws/src/app.ts')), 'docs/guide.md');
    expect(target?.path).toBe('/ws/docs/guide.md');
  });

  it('prefers a file relative to the source document', async () => {
    fake.files.set('/ws/src/docs/guide.md', '# Local\n');
    const target = await new LinkService().resolveTarget(asUri(Uri.file('/ws/src/app.ts')), 'docs/guide.md');
    expect(target?.path).toBe('/ws/src/docs/guide.md');
  });

  it('resolves ../ paths relative to the source document', async () => {
    const target = await new LinkService().resolveTarget(asUri(Uri.file('/ws/src/app.ts')), '../docs/guide.md');
    expect(target?.path).toBe('/ws/docs/guide.md');
  });

  it('never leaves the workspace folder', async () => {
    const target = await new LinkService().resolveTarget(asUri(Uri.file('/ws/src/app.ts')), '../../outside/secret.md');
    expect(target).toBeUndefined();
  });

  it('does not resolve to a directory', async () => {
    fake.files.set('/ws/dir.md/inner.txt', '');
    expect(await new LinkService().resolveTarget(asUri(Uri.file('/ws/app.ts')), 'dir.md')).toBeUndefined();
  });

  it('stays in the document folder outside a workspace', async () => {
    fake.folders = [];
    fake.files.set('/loose/notes.md', '# Notes\n');
    const service = new LinkService();
    expect((await service.resolveTarget(asUri(Uri.file('/loose/a.ts')), 'notes.md'))?.path).toBe('/loose/notes.md');
    expect(await service.resolveTarget(asUri(Uri.file('/loose/a.ts')), '../outside/secret.md')).toBeUndefined();
  });
});

describe('LinkService.findBrokenLinks', () => {
  const source = (text: string, version = 1) => asDocument(new FakeDocument(Uri.file('/ws/src/app.ts'), text, version));

  it('reports missing files and missing headings only', async () => {
    const text = [
      '// (docs/guide.md)',
      '// (docs/guide.md#tab-bar)',
      '// (../docs/guide.md#guide)',
      '// (docs/guide.md#nope)',
      '// (docs/missing.md#tab-bar)',
    ].join('\n');
    const broken = await new LinkService().findBrokenLinks(source(text));
    expect(broken.map(({ ref, problem }) => [ref.path, ref.fragment, problem])).toEqual([
      ['docs/guide.md', 'nope', 'missingAnchor'],
      ['docs/missing.md', 'tab-bar', 'missingFile'],
    ]);
  });

  it('resolves a path with spaces in angle brackets, followed by a title', async () => {
    fake.files.set('/ws/docs/Job Interview Thread/HUMAN.md', '# Human\n');
    const text = [
      '// [HUMAN](<../docs/Job Interview Thread/HUMAN.md#human> "id:0854E3AF3")',
      '// [HUMAN](<../docs/Job Interview Thread/MISSING.md> "id:0854E3AF3")',
    ].join('\n');
    const broken = await new LinkService().findBrokenLinks(source(text));
    expect(broken.map(({ ref, problem }) => [ref.path, problem])).toEqual([
      ['../docs/Job Interview Thread/MISSING.md', 'missingFile'],
    ]);
  });

  it('caches per document version', async () => {
    const service = new LinkService();
    const document = source('// (docs/later.md)');
    expect(await service.findBrokenLinks(document)).toHaveLength(1);
    fake.files.set('/ws/docs/later.md', '');
    expect(await service.findBrokenLinks(document)).toHaveLength(1);
    expect(await service.findBrokenLinks(source('// (docs/later.md)', 2))).toHaveLength(0);
  });

  it('sees a new heading after invalidateMarkdown', async () => {
    const service = new LinkService();
    const document = source('// (docs/guide.md#new-part)');
    expect(await service.findBrokenLinks(document)).toHaveLength(1);
    fake.files.set('/ws/docs/guide.md', '# Guide\n## New Part\n');
    service.invalidateMarkdown(asUri(Uri.file('/ws/docs/guide.md')));
    expect(await service.findBrokenLinks(document)).toHaveLength(0);
  });

  it('reads headings from an open, unsaved markdown document', async () => {
    fake.textDocuments.push(new FakeDocument(Uri.file('/ws/docs/guide.md'), '# Unsaved Heading\n'));
    expect(await new LinkService().findBrokenLinks(source('// (docs/guide.md#unsaved-heading)'))).toHaveLength(0);
  });
});

describe('LinkService.checkLinks', () => {
  it('returns every reference with its status and target', async () => {
    const text = ['// (docs/guide.md#tab-bar)', '// (../docs/guide.md)', '// (docs/guide.md#nope)', '// (docs/missing.md)'].join(
      '\n',
    );
    const source = asUri(Uri.file('/ws/src/app.ts'));
    const checked = await new LinkService().checkLinks(source, findLinkRefs(text));
    expect(checked.map(({ ref, status, target }) => [ref.path, status, target?.path])).toEqual([
      ['docs/guide.md', 'ok', '/ws/docs/guide.md'],
      ['../docs/guide.md', 'ok', '/ws/docs/guide.md'],
      ['docs/guide.md', 'missingAnchor', '/ws/docs/guide.md'],
      ['docs/missing.md', 'missingFile', undefined],
    ]);
  });
});

describe('LinkService.resolve, bare file names', () => {
  const app = asUri(Uri.file('/ws/src/app.ts'));

  it('finds the only markdown file of that name anywhere in the workspace folder', async () => {
    fake.files.set('/ws/docs/user_guide/USER_GUIDE.md', '# Guide\n');
    expect((await new LinkService().resolve(app, 'USER_GUIDE.md')).target?.path).toBe('/ws/docs/user_guide/USER_GUIDE.md');
  });

  it('prefers a file next to the source or in the root over a namesake elsewhere', async () => {
    fake.files.set('/ws/docs/a/NOTES.md', '');
    fake.files.set('/ws/docs/b/NOTES.md', '');
    fake.files.set('/ws/src/NOTES.md', '');
    fake.files.set('/ws/LICENSE.md', '');
    fake.files.set('/ws/vendor/LICENSE.md', '');
    const service = new LinkService();
    expect((await service.resolve(app, 'NOTES.md')).target?.path).toBe('/ws/src/NOTES.md');
    expect((await service.resolve(app, 'LICENSE.md')).target?.path).toBe('/ws/LICENSE.md');
  });

  it('reports every file when the name is not unique', async () => {
    fake.files.set('/ws/docs/b/NOTES.md', '');
    fake.files.set('/ws/docs/a/NOTES.md', '');
    const { target, ambiguous } = await new LinkService().resolve(app, 'NOTES.md');
    expect(target).toBeUndefined();
    expect(ambiguous?.map(({ path }) => path)).toEqual(['/ws/docs/a/NOTES.md', '/ws/docs/b/NOTES.md']);
  });

  it('matches the name exactly, case included', async () => {
    fake.files.set('/ws/docs/user_guide/USER_GUIDE.md', '');
    expect(await new LinkService().resolve(app, 'user_guide.md')).toEqual({});
  });

  it('does not search by name for a path, even ./NAME.md', async () => {
    fake.files.set('/ws/docs/user_guide/USER_GUIDE.md', '');
    const service = new LinkService();
    expect(await service.resolve(app, './USER_GUIDE.md')).toEqual({});
    expect(await service.resolve(app, 'user_guide/USER_GUIDE.md')).toEqual({});
  });

  it('ignores namesakes in excluded folders', async () => {
    fake.files.set('/ws/docs/README.md', '');
    fake.files.set('/ws/node_modules/pkg/README.md', '');
    fake.folderSettings.set('/ws', new Map([['excludePatterns', ['node_modules', 'test/*']]]));
    fake.files.set('/ws/test/fixtures/README.md', '');
    expect((await new LinkService().resolve(app, 'README.md')).target?.path).toBe('/ws/docs/README.md');
  });

  it('does not search outside a workspace folder', async () => {
    fake.folders = [];
    fake.files.set('/loose/docs/notes.md', '');
    expect(await new LinkService().resolve(asUri(Uri.file('/loose/a.ts')), 'notes.md')).toEqual({});
  });

  it('lists the markdown files once, until invalidateMarkdownIndex', async () => {
    const findFiles = vi.spyOn(workspace, 'findFiles');
    fake.files.set('/ws/docs/a/NOTES.md', '');
    const service = new LinkService();
    expect((await service.resolve(app, 'NOTES.md')).target?.path).toBe('/ws/docs/a/NOTES.md');
    fake.files.set('/ws/docs/b/NOTES.md', '');
    expect((await service.resolve(app, 'NOTES.md')).target?.path).toBe('/ws/docs/a/NOTES.md');
    expect(findFiles).toHaveBeenCalledTimes(1);
    service.invalidateMarkdownIndex();
    expect((await service.resolve(app, 'NOTES.md')).ambiguous).toHaveLength(2);
    expect(findFiles).toHaveBeenCalledTimes(2);
  });

  it('skips listed files that were deleted since', async () => {
    fake.files.set('/ws/docs/a/NOTES.md', '');
    fake.files.set('/ws/docs/b/NOTES.md', '');
    const service = new LinkService();
    expect((await service.resolve(app, 'NOTES.md')).ambiguous).toHaveLength(2);
    fake.files.delete('/ws/docs/b/NOTES.md');
    expect((await service.resolve(app, 'NOTES.md')).target?.path).toBe('/ws/docs/a/NOTES.md');
  });

  it('flags an ambiguous name in checkLinks and findBrokenLinks', async () => {
    fake.files.set('/ws/docs/a/NOTES.md', '');
    fake.files.set('/ws/docs/b/NOTES.md', '');
    const service = new LinkService();
    const broken = await service.findBrokenLinks(asDocument(new FakeDocument(Uri.file('/ws/src/app.ts'), '// (NOTES.md#x)')));
    expect(broken.map(({ ref, problem, matches }) => [ref.path, problem, matches?.length])).toEqual([['NOTES.md', 'ambiguousFile', 2]]);
  });
});

describe('listMatches', () => {
  it('names the files relative to the workspace root, at most five', () => {
    const uris = [1, 2, 3, 4, 5, 6].map((n) => asUri(Uri.file(`/ws/d${n}/A.md`)));
    expect(listMatches(uris.slice(0, 2))).toBe('d1/A.md, d2/A.md');
    expect(listMatches(uris)).toBe('d1/A.md, d2/A.md, d3/A.md, d4/A.md, d5/A.md, …');
  });
});
