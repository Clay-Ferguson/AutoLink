import type * as vscode from 'vscode';
import { beforeEach, describe, expect, it } from 'vitest';
import { type AutoLinkConfig, normalizeExtensions, readConfig } from '../config';
import { OPEN_LINK_COMMAND, parseOpenLinkArgs } from '../commands/openLink';
import { FakeDocument, Uri, fake } from '../test/fakeVscode';
import { AutoLinkProvider } from './linkProvider';

const linksOf = (path: string, text: string, config: AutoLinkConfig = readConfig()) =>
  new AutoLinkProvider(() => config).provideDocumentLinks(
    new FakeDocument(Uri.file(path), text) as unknown as vscode.TextDocument,
  );

beforeEach(() => fake.reset());

describe('AutoLinkProvider', () => {
  it('links a reference with a command URI carrying its source, path and anchor', () => {
    const [link] = linksOf('/ws/src/app.ts', 'const a = 1;\n// See (docs/guide.md#tab-bar)');
    expect(link.range.start).toMatchObject({ line: 1, character: 8 });
    expect(link.range.end).toMatchObject({ line: 1, character: 29 });
    expect(link.tooltip).toBe('Open docs/guide.md › #tab-bar');
    expect(link.target?.scheme).toBe('command');
    expect(link.target?.path).toBe(OPEN_LINK_COMMAND);
    const args: unknown = JSON.parse(decodeURIComponent(link.target?.query ?? ''));
    expect(args).toEqual({ source: 'file:///ws/src/app.ts', path: 'docs/guide.md', fragment: 'tab-bar' });
  });

  it('links only files with a listed extension', () => {
    expect(linksOf('/ws/a.ts', '// (a.md)')).toHaveLength(1);
    expect(linksOf('/ws/a.tsx', '// (a.md)')).toHaveLength(1);
    expect(linksOf('/ws/a.js', '// (a.md)')).toHaveLength(1);
    expect(linksOf('/ws/a.py', '# (a.md)')).toHaveLength(0);
    fake.settings.set('fileExtensions', ['ts', '.PY']);
    expect(linksOf('/ws/a.py', '# (a.md)')).toHaveLength(1);
    expect(linksOf('/ws/a.js', '// (a.md)')).toHaveLength(0);
  });

  it('skips files excluded by excludePatterns', () => {
    fake.folders = ['/ws'];
    fake.settings.set('excludePatterns', ['test/*', '*.generated.ts']);
    expect(linksOf('/ws/test/deep/a.ts', '// (a.md)')).toHaveLength(0);
    expect(linksOf('/ws/src/api.generated.ts', '// (a.md)')).toHaveLength(0);
    expect(linksOf('/ws/src/a.ts', '// (a.md)')).toHaveLength(1);
  });

  it('applies the excludePatterns of the workspace folder holding the file', () => {
    fake.folders = ['/one', '/two'];
    fake.folderSettings.set('/one', new Map([['excludePatterns', ['test/*']]]));
    const config = readConfig();
    expect(linksOf('/one/test/a.ts', '// (a.md)', config)).toHaveLength(0);
    expect(linksOf('/two/test/a.ts', '// (a.md)', config)).toHaveLength(1);
  });

  it('ignores documents that are not local files', () => {
    const document = new FakeDocument(Uri.parse('untitled:Untitled-1.ts'), '// (a.md)');
    const provider = new AutoLinkProvider(readConfig);
    expect(provider.provideDocumentLinks(document as unknown as vscode.TextDocument)).toEqual([]);
  });
});

describe('normalizeExtensions', () => {
  it('lower-cases, strips dots and skips junk', () => {
    expect([...normalizeExtensions(['.TS', ' tsx ', '', 3, '..js'])]).toEqual(['ts', 'tsx', 'js']);
  });

  it('falls back to the defaults for a non-array', () => {
    expect([...normalizeExtensions('ts')]).toEqual(['ts', 'tsx', 'js']);
  });
});

describe('parseOpenLinkArgs', () => {
  it('accepts well-formed arguments', () => {
    expect(parseOpenLinkArgs({ source: 'file:///a.ts', path: 'b.md', fragment: 'c' })).toEqual({
      source: 'file:///a.ts',
      path: 'b.md',
      fragment: 'c',
    });
  });

  it('rejects other shapes and non-markdown targets', () => {
    expect(parseOpenLinkArgs(undefined)).toBeUndefined();
    expect(parseOpenLinkArgs({ source: 'file:///a.ts' })).toBeUndefined();
    expect(parseOpenLinkArgs({ source: 'file:///a.ts', path: 'b.md', fragment: 1 })).toBeUndefined();
    expect(parseOpenLinkArgs({ source: 'file:///a.ts', path: '../.ssh/id_rsa' })).toBeUndefined();
  });
});
