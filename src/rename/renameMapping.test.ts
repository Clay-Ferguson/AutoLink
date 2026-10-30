import * as posix from 'node:path/posix';
import { describe, expect, it } from 'vitest';
import { candidatePaths, isInside } from '../resolve/paths';
import { findMovedTarget, formatRef, mapBack, mapForward, rewriteRef, type Rename, type RefText } from './renameMapping';

const fileRename: Rename[] = [{ from: '/ws/docs/old.md', to: '/ws/docs/new.md' }];
const folderRename: Rename[] = [{ from: '/ws/docs', to: '/ws/guides' }];
const chained: Rename[] = [
  { from: '/ws/a.md', to: '/ws/b.md' },
  { from: '/ws/b.md', to: '/ws/sub/c.md' },
];

/** Resolves a reference among the given files, the way LinkService.resolveTarget does. */
const resolverFor =
  (files: string[], source: string, root = '/ws') =>
  (refPath: string): Promise<string | undefined> =>
    Promise.resolve(
      candidatePaths(posix.dirname(source), root, refPath).find((path) => isInside(root, path) && files.includes(path)),
    );

const isFileIn = (files: string[]) => (path: string) => Promise.resolve(files.includes(path));

const ref = (path: string, fragment?: string, angled = false): RefText => ({ path, fragment, angled });

describe('mapForward and mapBack', () => {
  it('map a renamed file and leave other paths alone', () => {
    expect(mapForward('/ws/docs/old.md', fileRename)).toBe('/ws/docs/new.md');
    expect(mapForward('/ws/docs/other.md', fileRename)).toBe('/ws/docs/other.md');
    expect(mapBack('/ws/docs/new.md', fileRename)).toBe('/ws/docs/old.md');
  });

  it('move the paths inside a renamed folder, not sibling prefixes', () => {
    expect(mapForward('/ws/docs/x/a.md', folderRename)).toBe('/ws/guides/x/a.md');
    expect(mapForward('/ws/docsx/a.md', folderRename)).toBe('/ws/docsx/a.md');
    expect(mapBack('/ws/guides/x/a.md', folderRename)).toBe('/ws/docs/x/a.md');
  });

  it('follow chained renames in order', () => {
    expect(mapForward('/ws/a.md', chained)).toBe('/ws/sub/c.md');
    expect(mapBack('/ws/sub/c.md', chained)).toBe('/ws/a.md');
  });
});

describe('findMovedTarget', () => {
  it('finds a renamed target relative to the source folder', async () => {
    const target = await findMovedTarget('../docs/old.md', '/ws/src/a.ts', '/ws', fileRename, isFileIn(['/ws/docs/new.md']));
    expect(target).toEqual({ before: '/ws/docs/old.md', after: '/ws/docs/new.md', style: 'source' });
  });

  it('falls back to the workspace root, like resolution does', async () => {
    const target = await findMovedTarget('docs/old.md', '/ws/src/a.ts', '/ws', fileRename, isFileIn(['/ws/docs/new.md']));
    expect(target).toEqual({ before: '/ws/docs/old.md', after: '/ws/docs/new.md', style: 'root' });
  });

  it('finds an unmoved target from where a moved source was', async () => {
    const target = await findMovedTarget('guide.md', '/ws/src/a.ts', '/ws', [], isFileIn(['/ws/src/guide.md']));
    expect(target).toEqual({ before: '/ws/src/guide.md', after: '/ws/src/guide.md', style: 'source' });
  });

  it('finds nothing for a file that does not exist', async () => {
    expect(await findMovedTarget('gone.md', '/ws/src/a.ts', '/ws', fileRename, isFileIn([]))).toBeUndefined();
  });

  it('ignores paths that leave the workspace', async () => {
    expect(await findMovedTarget('../../x.md', '/ws/src/a.ts', '/ws', [], isFileIn(['/x.md']))).toBeUndefined();
  });
});

describe('rewriteRef', () => {
  it('keeps a reference relative to the source folder, with its anchor', async () => {
    const files = ['/ws/docs/new.md'];
    const text = await rewriteRef(ref('../docs/old.md', 'intro'), '/ws/src/a.ts', '/ws', files[0], 'source', resolverFor(files, '/ws/src/a.ts'));
    expect(text).toBe('../docs/new.md#intro');
  });

  it('keeps a reference relative to the workspace root', async () => {
    const files = ['/ws/docs/new.md'];
    const text = await rewriteRef(ref('docs/old.md'), '/ws/src/a.ts', '/ws', files[0], 'root', resolverFor(files, '/ws/src/a.ts'));
    expect(text).toBe('docs/new.md');
  });

  it('keeps a leading ./ unless the path now climbs up', async () => {
    const source = '/ws/src/a.ts';
    const near = ['/ws/src/notes/b.md'];
    expect(await rewriteRef(ref('./b.md'), source, '/ws', near[0], 'source', resolverFor(near, source))).toBe('./notes/b.md');
    const far = ['/ws/docs/b.md'];
    expect(await rewriteRef(ref('./b.md'), source, '/ws', far[0], 'source', resolverFor(far, source))).toBe('../docs/b.md');
  });

  it('takes the other style when its own one names another file', async () => {
    // From /ws/src, `docs/new.md` would find /ws/src/docs/new.md first.
    const files = ['/ws/docs/new.md', '/ws/src/docs/new.md'];
    const text = await rewriteRef(ref('docs/old.md'), '/ws/src/a.ts', '/ws', files[0], 'root', resolverFor(files, '/ws/src/a.ts'));
    expect(text).toBe('../docs/new.md');
  });

  it('puts a path with a space in angle brackets', async () => {
    const files = ['/ws/docs/my notes.md'];
    const text = await rewriteRef(ref('docs/old.md', 'x'), '/ws/a.ts', '/ws', files[0], 'source', resolverFor(files, '/ws/a.ts'));
    expect(text).toBe('<docs/my notes.md#x>');
  });

  it('gives undefined when no reference can name the file', async () => {
    const files = ['/ws/docs/a+b.md'];
    const text = await rewriteRef(ref('docs/old.md'), '/ws/a.ts', '/ws', files[0], 'source', resolverFor(files, '/ws/a.ts'));
    expect(text).toBeUndefined();
  });
});

describe('formatRef', () => {
  it('adds the anchor and checks the result scans back', () => {
    expect(formatRef('docs/a.md', 'top', false)).toBe('docs/a.md#top');
    expect(formatRef('docs/a b.md', undefined, false)).toBe('<docs/a b.md>');
    expect(formatRef('docs/a b.md', undefined, true)).toBe('docs/a b.md');
    expect(formatRef('docs/a(1).md', undefined, false)).toBeUndefined();
  });
});

describe('mapForward and mapBack, edge cases', () => {
  it('map the renamed folder path itself', () => {
    expect(mapForward('/ws/docs', folderRename)).toBe('/ws/guides');
    expect(mapBack('/ws/guides', folderRename)).toBe('/ws/docs');
  });

  it('leave a path untouched by every rename unchanged both ways', () => {
    expect(mapForward('/ws/src/a.ts', [...fileRename, ...folderRename])).toBe('/ws/src/a.ts');
    expect(mapBack('/ws/src/a.ts', [...fileRename, ...folderRename])).toBe('/ws/src/a.ts');
  });

  it('do nothing without renames', () => {
    expect(mapForward('/ws/a.md', [])).toBe('/ws/a.md');
    expect(mapBack('/ws/a.md', [])).toBe('/ws/a.md');
  });

  it('do not treat a file whose name starts with the renamed name as inside it', () => {
    const renames: Rename[] = [{ from: '/ws/docs/a.md', to: '/ws/docs/b.md' }];
    expect(mapForward('/ws/docs/a.md.bak', renames)).toBe('/ws/docs/a.md.bak');
    expect(mapForward('/ws/docs/a.mdx', renames)).toBe('/ws/docs/a.mdx');
  });

  it('apply independent renames in one batch', () => {
    const renames: Rename[] = [
      { from: '/ws/a.md', to: '/ws/x/a.md' },
      { from: '/ws/b.md', to: '/ws/y/b.md' },
    ];
    expect(mapForward('/ws/a.md', renames)).toBe('/ws/x/a.md');
    expect(mapForward('/ws/b.md', renames)).toBe('/ws/y/b.md');
    expect(mapBack('/ws/y/b.md', renames)).toBe('/ws/b.md');
  });

  it('follow a swap of two names through a temporary name', () => {
    const swap: Rename[] = [
      { from: '/ws/a.md', to: '/ws/tmp.md' },
      { from: '/ws/b.md', to: '/ws/a.md' },
      { from: '/ws/tmp.md', to: '/ws/b.md' },
    ];
    expect(mapForward('/ws/a.md', swap)).toBe('/ws/b.md');
    expect(mapForward('/ws/b.md', swap)).toBe('/ws/a.md');
    expect(mapBack('/ws/b.md', swap)).toBe('/ws/a.md');
    expect(mapBack('/ws/a.md', swap)).toBe('/ws/b.md');
  });

  it('follow a file moved out of a folder renamed earlier in the batch', () => {
    const renames: Rename[] = [
      { from: '/ws/a', to: '/ws/b' },
      { from: '/ws/b/x.md', to: '/ws/c/x.md' },
    ];
    expect(mapForward('/ws/a/x.md', renames)).toBe('/ws/c/x.md');
    expect(mapForward('/ws/a/y.md', renames)).toBe('/ws/b/y.md');
    expect(mapBack('/ws/c/x.md', renames)).toBe('/ws/a/x.md');
    expect(mapBack('/ws/b/y.md', renames)).toBe('/ws/a/y.md');
  });

  it('are inverses for every path a batch touches', () => {
    const renames: Rename[] = [
      { from: '/ws/docs', to: '/ws/guides' },
      { from: '/ws/guides/a.md', to: '/ws/top.md' },
      { from: '/ws/src/x.ts', to: '/ws/lib/x.ts' },
    ];
    for (const path of ['/ws/docs/a.md', '/ws/docs/b/c.md', '/ws/src/x.ts', '/ws/src/y.ts', '/ws/readme.md']) {
      expect(mapBack(mapForward(path, renames), renames)).toBe(path);
    }
  });

  it('handle names with spaces and non-ASCII letters', () => {
    const renames: Rename[] = [{ from: '/ws/My Notes', to: '/ws/Größe Notizen' }];
    expect(mapForward('/ws/My Notes/todo.md', renames)).toBe('/ws/Größe Notizen/todo.md');
    expect(mapBack('/ws/Größe Notizen/todo.md', renames)).toBe('/ws/My Notes/todo.md');
  });
});

describe('findMovedTarget, edge cases', () => {
  it('prefers the source folder when both candidates exist', async () => {
    const files = ['/ws/src/docs/a.md', '/ws/docs/a.md'];
    const target = await findMovedTarget('docs/a.md', '/ws/src/x.ts', '/ws', [], isFileIn(files));
    expect(target).toEqual({ before: '/ws/src/docs/a.md', after: '/ws/src/docs/a.md', style: 'source' });
  });

  it('counts a source in the workspace root as source style, since both bases are the same', async () => {
    const target = await findMovedTarget('docs/old.md', '/ws/x.ts', '/ws', fileRename, isFileIn(['/ws/docs/new.md']));
    expect(target).toEqual({ before: '/ws/docs/old.md', after: '/ws/docs/new.md', style: 'source' });
  });

  it('normalizes ./ and ../ in the written path', async () => {
    const target = await findMovedTarget('./../docs/./old.md', '/ws/src/a.ts', '/ws', fileRename, isFileIn(['/ws/docs/new.md']));
    expect(target?.before).toBe('/ws/docs/old.md');
    expect(target?.after).toBe('/ws/docs/new.md');
  });

  it('follows a target inside a renamed folder', async () => {
    const target = await findMovedTarget('../docs/sub/a.md', '/ws/src/x.ts', '/ws', folderRename, isFileIn(['/ws/guides/sub/a.md']));
    expect(target).toEqual({ before: '/ws/docs/sub/a.md', after: '/ws/guides/sub/a.md', style: 'source' });
  });

  it('outside a workspace, only looks inside the source folder', async () => {
    const files = ['/tmp/x/a.md', '/tmp/b.md'];
    expect(await findMovedTarget('a.md', '/tmp/x/s.ts', undefined, [], isFileIn(files))).toEqual({
      before: '/tmp/x/a.md',
      after: '/tmp/x/a.md',
      style: 'source',
    });
    expect(await findMovedTarget('../b.md', '/tmp/x/s.ts', undefined, [], isFileIn(files))).toBeUndefined();
  });

  it('asks only about the candidates, mapped forward', async () => {
    const asked: string[] = [];
    const isFile = (path: string) => {
      asked.push(path);
      return Promise.resolve(false);
    };
    await findMovedTarget('docs/old.md', '/ws/src/a.ts', '/ws', fileRename, isFile);
    expect(asked).toEqual(['/ws/src/docs/old.md', '/ws/docs/new.md']);
  });
});

describe('rewriteRef, edge cases', () => {
  it('writes a target in the same folder as a bare name', async () => {
    const files = ['/ws/src/b.md'];
    expect(await rewriteRef(ref('a.md'), '/ws/src/x.ts', '/ws', files[0], 'source', resolverFor(files, '/ws/src/x.ts'))).toBe('b.md');
  });

  it('keeps ./ for a target in the same folder', async () => {
    const files = ['/ws/src/b.md'];
    expect(await rewriteRef(ref('./a.md'), '/ws/src/x.ts', '/ws', files[0], 'source', resolverFor(files, '/ws/src/x.ts'))).toBe('./b.md');
  });

  it('does not add ./ when the original had none', async () => {
    const files = ['/ws/src/notes/b.md'];
    expect(await rewriteRef(ref('a.md'), '/ws/src/x.ts', '/ws', files[0], 'source', resolverFor(files, '/ws/src/x.ts'))).toBe('notes/b.md');
  });

  it('climbs several folders when needed', async () => {
    const source = '/ws/a/b/c/x.ts';
    const files = ['/ws/docs/g.md'];
    expect(await rewriteRef(ref('g.md'), source, '/ws', files[0], 'source', resolverFor(files, source))).toBe('../../../docs/g.md');
  });

  it('takes the source style when a root-style reference has no workspace root', async () => {
    const source = '/tmp/x/s.ts';
    const files = ['/tmp/x/docs/b.md'];
    const resolve = (refPath: string) => Promise.resolve(files.find((path) => path === posix.join('/tmp/x', refPath)));
    expect(await rewriteRef(ref('docs/a.md'), source, undefined, files[0], 'root', resolve)).toBe('docs/b.md');
  });

  it('gives undefined when the target left the workspace folder', async () => {
    // Moved to another workspace folder: neither style may leave /ws.
    const files = ['/other/docs/g.md'];
    expect(await rewriteRef(ref('docs/g.md'), '/ws/src/x.ts', '/ws', files[0], 'root', resolverFor(files, '/ws/src/x.ts'))).toBeUndefined();
  });

  it('gives undefined when both styles name another file', async () => {
    const resolve = () => Promise.resolve('/ws/elsewhere.md');
    expect(await rewriteRef(ref('docs/a.md'), '/ws/src/x.ts', '/ws', '/ws/docs/b.md', 'source', resolve)).toBeUndefined();
  });

  it('tries the source style first for a source-style reference', async () => {
    const tried: string[] = [];
    const resolve = (refPath: string) => {
      tried.push(refPath);
      return Promise.resolve(undefined);
    };
    await rewriteRef(ref('../docs/a.md'), '/ws/src/x.ts', '/ws', '/ws/docs/b.md', 'source', resolve);
    expect(tried).toEqual(['../docs/b.md', 'docs/b.md']);
  });

  it('tries the root style first for a root-style reference', async () => {
    const tried: string[] = [];
    const resolve = (refPath: string) => {
      tried.push(refPath);
      return Promise.resolve(undefined);
    };
    await rewriteRef(ref('docs/a.md'), '/ws/src/x.ts', '/ws', '/ws/docs/b.md', 'root', resolve);
    expect(tried).toEqual(['docs/b.md', '../docs/b.md']);
  });

  it('keeps an angled reference without adding brackets, with or without spaces', async () => {
    const spaced = ['/ws/docs/my notes.md'];
    expect(await rewriteRef(ref('docs/old.md', 'x', true), '/ws/a.ts', '/ws', spaced[0], 'source', resolverFor(spaced, '/ws/a.ts'))).toBe(
      'docs/my notes.md#x',
    );
    const plain = ['/ws/docs/notes.md'];
    expect(await rewriteRef(ref('docs/my old.md', undefined, true), '/ws/a.ts', '/ws', plain[0], 'source', resolverFor(plain, '/ws/a.ts'))).toBe(
      'docs/notes.md',
    );
  });

  it('keeps an anchor with non-ASCII letters and a target with them', async () => {
    const files = ['/ws/docs/größe.md'];
    expect(await rewriteRef(ref('docs/a.md', 'überblick'), '/ws/a.ts', '/ws', files[0], 'source', resolverFor(files, '/ws/a.ts'))).toBe(
      'docs/größe.md#überblick',
    );
  });

  it('keeps an upper-case extension', async () => {
    const files = ['/ws/docs/NEW.MD'];
    expect(await rewriteRef(ref('docs/OLD.MD'), '/ws/a.ts', '/ws', files[0], 'source', resolverFor(files, '/ws/a.ts'))).toBe('docs/NEW.MD');
  });

  it('gives undefined for a target that is no longer a markdown file', async () => {
    const files = ['/ws/docs/a.txt'];
    expect(await rewriteRef(ref('docs/a.md'), '/ws/a.ts', '/ws', files[0], 'source', resolverFor(files, '/ws/a.ts'))).toBeUndefined();
  });
});

describe('formatRef, edge cases', () => {
  it.each([
    ['docs/a(1).md', 'parentheses'],
    ['docs/a+b.md', 'a plus sign'],
    ['docs/a#b.md', 'a hash'],
    ['docs/a>b.md', 'an angle bracket'],
    ['docs/a\tb.md', 'a tab'],
    ['docs/a%20b.md', 'a percent sign'],
    ['docs/a.mdx', 'another extension'],
    ['docs/a.txt', 'no .md extension'],
  ])('rejects %s (%s)', (path) => {
    expect(formatRef(path, undefined, false)).toBeUndefined();
    expect(formatRef(path, undefined, true)).toBeUndefined();
  });

  it('accepts names with dots, dashes, underscores and digits', () => {
    expect(formatRef('.hidden/v1.2_notes-final.md', undefined, false)).toBe('.hidden/v1.2_notes-final.md');
  });

  it('accepts ../ and ./ prefixes', () => {
    expect(formatRef('../../a.md', 'x', false)).toBe('../../a.md#x');
    expect(formatRef('./a.md', undefined, false)).toBe('./a.md');
  });

  it('wraps a spaced path with its anchor in brackets', () => {
    expect(formatRef('my docs/a b.md', 'sec-1', false)).toBe('<my docs/a b.md#sec-1>');
  });

  it('accepts non-ASCII letters in names', () => {
    expect(formatRef('docs/日本語.md', undefined, false)).toBe('docs/日本語.md');
  });
});
