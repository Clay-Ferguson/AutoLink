import { describe, expect, it } from 'vitest';
import { buildExcludeGlob, isBinary, lineAndColumn, lineStarts } from './files';

describe('buildExcludeGlob', () => {
  it('excludes nothing without settings', () => {
    expect(buildExcludeGlob(undefined, undefined, null)).toBe('{}');
  });

  it('adds the excludePatterns entries that are plain names, below any folder', () => {
    const excludePatterns = ['node_modules', ' .git ', '*.egg-info', 'test/*', 'out/', '[ab]', 3, ''];
    expect(buildExcludeGlob(excludePatterns)).toBe('{**/node_modules,**/.git,**/*.egg-info}');
  });

  it('merges the entries set to true, without duplicates', () => {
    const filesExclude = { '**/.git': true, '**/.DS_Store': true, '**/off': false };
    const searchExclude = { '**/dist': true, '**/*.js': { when: '$(basename).ts' } };
    expect(buildExcludeGlob(['node_modules', '.git'], filesExclude, searchExclude)).toBe(
      '{**/node_modules,**/.git,**/.DS_Store,**/dist}',
    );
  });
});

describe('isBinary', () => {
  it('detects a NUL byte', () => {
    expect(isBinary(new Uint8Array([0x50, 0x4e, 0x47, 0x00, 0x01]))).toBe(true);
    expect(isBinary(new TextEncoder().encode('plain text ünïcode\n'))).toBe(false);
  });
});

describe('lineAndColumn', () => {
  it('converts offsets to 1-based lines and columns', () => {
    const text = 'ab\ncde\n\nf';
    const starts = lineStarts(text);
    expect(starts).toEqual([0, 3, 7, 8]);
    expect(lineAndColumn(starts, 0)).toEqual({ line: 1, column: 1 });
    expect(lineAndColumn(starts, 4)).toEqual({ line: 2, column: 2 });
    expect(lineAndColumn(starts, 7)).toEqual({ line: 3, column: 1 });
    expect(lineAndColumn(starts, 8)).toEqual({ line: 4, column: 1 });
  });
});
