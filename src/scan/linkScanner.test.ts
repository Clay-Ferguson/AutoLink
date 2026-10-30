import { describe, expect, it } from 'vitest';
import { findLinkRefs } from './linkScanner';

/** The matched text of each reference. */
const texts = (text: string) => findLinkRefs(text).map((ref) => text.slice(ref.start, ref.end));

describe('findLinkRefs', () => {
  it('finds a path with an anchor in a line comment', () => {
    const text = '// See: (docs/user_guide/USER_GUIDE.md#tab-bar)\nconst x = 1;';
    expect(findLinkRefs(text)).toEqual([
      { start: 9, end: 46, path: 'docs/user_guide/USER_GUIDE.md', fragment: 'tab-bar' },
    ]);
  });

  it('finds a path without an anchor', () => {
    expect(findLinkRefs('// (docs/a.md)')).toEqual([{ start: 4, end: 13, path: 'docs/a.md', fragment: undefined }]);
  });

  it('requires the parentheses', () => {
    expect(texts('// docs/a.md and docs/b.md#c')).toEqual([]);
    expect(texts('// (docs/a.md and docs/b.md#c)')).toEqual([]);
    expect(texts('// (docs/a.md or [x](docs/b.md#c')).toEqual([]);
    expect(texts('// ( docs/a.md )')).toEqual([]);
  });

  it('finds the target of a markdown link', () => {
    expect(texts('// See [the guide](docs/guide.md#install).')).toEqual(['docs/guide.md#install']);
  });

  it('accepts ./ and ../ prefixes and a bare file name', () => {
    expect(texts('// (./a.md) (../../docs/b.md#x) (README.md)')).toEqual(['./a.md', '../../docs/b.md#x', 'README.md']);
  });

  it('finds references in every kind of comment and string', () => {
    const text = [
      '/* block (docs/one.md) */',
      '/** JSDoc @see (docs/two.md#intro) */',
      '# python (docs/three.md)',
      '"""Docstring: (docs/four.md#usage)"""',
      'const s = "(docs/five.md)";',
    ].join('\n');
    expect(texts(text)).toEqual(['docs/one.md', 'docs/two.md#intro', 'docs/three.md', 'docs/four.md#usage', 'docs/five.md']);
  });

  it('finds several references on one line', () => {
    expect(texts('// (a.md), (b.md#c) and ((docs/d.md))')).toEqual(['a.md', 'b.md#c', 'docs/d.md']);
  });

  it('finds a reference directly after //', () => {
    expect(texts('//(docs/a.md)')).toEqual(['docs/a.md']);
  });

  it('ignores URLs, absolute and Windows paths', () => {
    expect(texts('// (https://example.com/docs/a.md#x)')).toEqual([]);
    expect(texts('// (/usr/share/docs/a.md)')).toEqual([]);
    expect(texts('// (C:\\docs\\a.md)')).toEqual([]);
    expect(texts('import x from "(@scope/a.md)"')).toEqual([]);
  });

  it('ignores other extensions that start with .md', () => {
    expect(texts('// (docs/a.mdx) (docs/a.md5) (docs/a.md/b)')).toEqual([]);
  });

  it('accepts a path in angle brackets, with spaces', () => {
    const text = '// [HUMAN](<../Job Interview Thread/HUMAN.md> "id:0854E3AF3")';
    expect(findLinkRefs(text)).toEqual([
      { start: 12, end: 44, path: '../Job Interview Thread/HUMAN.md', fragment: undefined },
    ]);
    expect(texts('// (<docs/my notes.md#part-two>)')).toEqual(['docs/my notes.md#part-two']);
  });

  it('tolerates a markdown link title', () => {
    const text = '// [HUMAN](../Job_Interview_Thread/HUMAN.md "id:0854E3AF3")';
    expect(findLinkRefs(text)).toEqual([
      { start: 11, end: 43, path: '../Job_Interview_Thread/HUMAN.md', fragment: undefined },
    ]);
    expect(texts(`// (a.md#x 'Title') (b.md "Say \\"hi\\"")`)).toEqual(['a.md#x', 'b.md']);
  });

  it('rejects malformed brackets and titles', () => {
    expect(texts('// (docs/my notes.md)')).toEqual([]);
    expect(texts('// (<docs/a.md) (docs/a.md>)')).toEqual([]);
    expect(texts('// (a.md"Title") (a.md "Title) (a.md Title)')).toEqual([]);
  });

  it('rejects a reference missing its closing quote or parenthesis', () => {
    expect(texts('(<README.md> "id: xxx')).toEqual([]);
    expect(texts('(<README.md> "id: xxx"')).toEqual([]);
    expect(texts('(README.md "id: xxx"')).toEqual([]);
    expect(texts('(<README.md>')).toEqual([]);
    expect(texts('(README.md')).toEqual([]);
    expect(texts('// (<README.md> "id: xxx\n// more")')).toEqual([]);
  });

  it('matches .md in any case', () => {
    expect(texts('// (docs/NOTES.MD)')).toEqual(['docs/NOTES.MD']);
  });

  it('accepts Unicode path and anchor characters', () => {
    expect(findLinkRefs('// (docs/café.md#résumé)')).toEqual([
      { start: 4, end: 23, path: 'docs/café.md', fragment: 'résumé' },
    ]);
  });

  it('ignores a lone .md', () => {
    expect(texts('// the (.md) extension')).toEqual([]);
  });
});
