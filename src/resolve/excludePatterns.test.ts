import { describe, expect, it } from 'vitest';
import { compileExcludePatterns, isExcludedPath } from './excludePatterns';

/** Reports whether the patterns exclude a path under the workspace folder `/ws`. */
const excludes = (patterns: string[], relative: string) =>
  isExcludedPath(compileExcludePatterns(patterns), `/ws/${relative}`, '/ws');

describe('compileExcludePatterns', () => {
  it('skips blank entries and entries that are not strings', () => {
    expect(compileExcludePatterns(['', '  ', '/', 1, null, 'test'])).toHaveLength(1);
  });

  it('returns nothing for a non-array', () => {
    expect(compileExcludePatterns(undefined)).toEqual([]);
    expect(compileExcludePatterns('test/*')).toEqual([]);
  });
});

describe('isExcludedPath', () => {
  it('excludes everything under a folder for folder/*', () => {
    expect(excludes(['test/*'], 'test/a.ts')).toBe(true);
    expect(excludes(['test/*'], 'test/deep/nested/a.ts')).toBe(true);
    expect(excludes(['test/*'], 'tests/a.ts')).toBe(false);
    expect(excludes(['test/*'], 'src/test/a.ts')).toBe(false);
  });

  it('anchors a pattern with a slash to the root', () => {
    expect(excludes(['src/gen'], 'src/gen/a.ts')).toBe(true);
    expect(excludes(['src/gen'], 'lib/src/gen/a.ts')).toBe(false);
    expect(excludes(['/build'], 'build/a.ts')).toBe(true);
    expect(excludes(['/build'], 'src/build/a.ts')).toBe(false);
    expect(excludes(['./build'], 'build/a.ts')).toBe(true);
  });

  it('matches a pattern without a slash at any depth', () => {
    expect(excludes(['fixtures'], 'fixtures/a.ts')).toBe(true);
    expect(excludes(['fixtures'], 'src/fixtures/deep/a.ts')).toBe(true);
    expect(excludes(['*.generated.ts'], 'src/api.generated.ts')).toBe(true);
    expect(excludes(['*.generated.ts'], 'src/api.ts')).toBe(false);
  });

  it('keeps * and ? within one folder', () => {
    expect(excludes(['src/*.ts'], 'src/a.ts')).toBe(true);
    expect(excludes(['src/*.ts'], 'src/sub/a.md')).toBe(false);
    expect(excludes(['src/?.ts'], 'src/a.ts')).toBe(true);
    expect(excludes(['src/?.ts'], 'src/ab.ts')).toBe(false);
  });

  it('lets ** match any number of folders', () => {
    expect(excludes(['**/snapshots'], 'snapshots/a.ts')).toBe(true);
    expect(excludes(['**/snapshots'], 'a/b/snapshots/c.ts')).toBe(true);
    expect(excludes(['src/**/*.test.ts'], 'src/a.test.ts')).toBe(true);
    expect(excludes(['src/**/*.test.ts'], 'src/x/y/a.test.ts')).toBe(true);
    expect(excludes(['src/**/*.test.ts'], 'lib/a.test.ts')).toBe(false);
    expect(excludes(['docs/**'], 'docs/a/b.md')).toBe(true);
  });

  it('matches only folders with a trailing slash', () => {
    expect(excludes(['out/'], 'out/a.ts')).toBe(true);
    expect(excludes(['out/'], 'src/out/a.ts')).toBe(true);
    expect(excludes(['out/'], 'out')).toBe(false);
  });

  it('treats regular expression characters and backslashes literally', () => {
    expect(excludes(['a.b'], 'a.b/x.ts')).toBe(true);
    expect(excludes(['a.b'], 'axb/x.ts')).toBe(false);
    expect(excludes(['(x)+'], '(x)+/y.ts')).toBe(true);
    expect(excludes(['test\\*'], 'test/a.ts')).toBe(true);
  });

  it('is case-sensitive', () => {
    expect(excludes(['Test/*'], 'test/a.ts')).toBe(false);
  });

  it('excludes nothing without patterns, and never the root itself', () => {
    expect(excludes([], 'test/a.ts')).toBe(false);
    expect(isExcludedPath(compileExcludePatterns(['*']), '/ws', '/ws')).toBe(false);
    expect(isExcludedPath(compileExcludePatterns(['*']), '/elsewhere/a.ts', '/ws')).toBe(false);
  });

  it('applies only unanchored patterns outside a workspace folder', () => {
    const patterns = compileExcludePatterns(['tmp/*', 'fixtures']);
    expect(isExcludedPath(patterns, '/tmp/a.ts', undefined)).toBe(false);
    expect(isExcludedPath(patterns, '/home/u/fixtures/a.ts', undefined)).toBe(true);
  });
});
