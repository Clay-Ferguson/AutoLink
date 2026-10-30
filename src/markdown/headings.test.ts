import { describe, expect, it } from 'vitest';
import { findHeadingLine, parseHeadings, slugify } from './headings';

describe('slugify', () => {
  it.each([
    ['Tab Bar', 'tab-bar'],
    ['Hello, World!', 'hello-world'],
    ['  Trimmed  ', 'trimmed'],
    ['The `config` file', 'the-config-file'],
    ['See [the docs](https://x.y)', 'see-the-docs'],
    ['snake_case and kebab-case', 'snake_case-and-kebab-case'],
    ['C++ & Rust', 'c--rust'],
    ['Version 2.0 (beta)', 'version-20-beta'],
    ['Café Résumé', 'café-résumé'],
    ['<em>Tagged</em> heading', 'tagged-heading'],
  ])('%s → %s', (text, slug) => {
    expect(slugify(text)).toBe(slug);
  });
});

describe('parseHeadings', () => {
  it('parses ATX headings with their lines', () => {
    expect(parseHeadings('# Title\n\ntext\n## Tab Bar ##\n###### Six')).toEqual([
      { line: 0, text: 'Title', slug: 'title' },
      { line: 3, text: 'Tab Bar', slug: 'tab-bar' },
      { line: 4, text: 'Six', slug: 'six' },
    ]);
  });

  it('parses setext headings but not thematic breaks', () => {
    const markdown = 'Main\n====\n\nSub Part\n--------\n\n---\n';
    expect(parseHeadings(markdown).map((heading) => [heading.line, heading.slug])).toEqual([
      [0, 'main'],
      [3, 'sub-part'],
    ]);
  });

  it('ignores headings inside fenced code blocks', () => {
    const markdown = '# Real\n```sh\n# not a heading\n```\n~~~\n## nor this\n~~~\n## Also Real';
    expect(parseHeadings(markdown).map((heading) => heading.slug)).toEqual(['real', 'also-real']);
  });

  it('suffixes duplicate slugs like GitHub', () => {
    const markdown = '# Intro\n# Intro\n# Intro-1\n# Intro';
    expect(parseHeadings(markdown).map((heading) => heading.slug)).toEqual(['intro', 'intro-1', 'intro-1-1', 'intro-2']);
  });

  it('needs a space after the hashes', () => {
    expect(parseHeadings('#hashtag\n####### seven')).toEqual([]);
  });

  it('handles CRLF line endings', () => {
    expect(parseHeadings('# One\r\n## Two\r\n')).toEqual([
      { line: 0, text: 'One', slug: 'one' },
      { line: 1, text: 'Two', slug: 'two' },
    ]);
  });
});

describe('findHeadingLine', () => {
  const markdown = '# Guide\n\n## Tab Bar\n\n## Tab Bar\n';

  it('returns the line of the matching heading', () => {
    expect(findHeadingLine(markdown, 'tab-bar')).toBe(2);
    expect(findHeadingLine(markdown, 'tab-bar-1')).toBe(4);
  });

  it('ignores case in the fragment', () => {
    expect(findHeadingLine(markdown, 'Tab-Bar')).toBe(2);
  });

  it('returns undefined when no heading matches', () => {
    expect(findHeadingLine(markdown, 'missing')).toBeUndefined();
  });
});
