import type * as vscode from 'vscode';
import { beforeEach, describe, expect, it } from 'vitest';
import { LinkService } from './linkService';
import { findLinkRefs } from './scan/linkScanner';
import { FakeDocument, Uri, fake } from './test/fakeVscode';

const asDocument = (document: FakeDocument) => document as unknown as vscode.TextDocument;
const asUri = (uri: Uri) => uri as unknown as vscode.Uri;

beforeEach(() => {
  fake.reset();
  fake.folders = ['/ws'];
  fake.files.set('/ws/docs/guide.md', '# Guide\n\n## Tab Bar\n');
  fake.files.set('/outside/secret.md', '# Secret\n');
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
