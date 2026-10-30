/**
 * Parses the headings of a markdown document and computes GitHub-style anchor
 * slugs for them. Pure: no `vscode` import.
 */

/** A heading of a markdown document. */
export interface Heading {
  /** 0-based line of the heading text. */
  line: number;
  /** The heading text, without `#` markers. */
  text: string;
  /** The anchor slug, unique within the document (`intro`, `intro-1`, ...). */
  slug: string;
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Converts heading text to the anchor GitHub generates for it: inline markup
 * removed, lower-cased, punctuation dropped, spaces turned into hyphens.
 * Duplicate handling (`-1`, `-2`) is done by {@link parseHeadings}.
 * @param text - The heading text.
 */
export function slugify(text: string): string {
  return (
    text
      // [label](url) and ![alt](url) → label / alt
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      // inline HTML tags
      .replace(/<[^>]+>/g, '')
      .trim()
      .toLowerCase()
      // keep letters, digits, combining marks, spaces, `_` and `-`
      .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
      .replace(/\s/g, '-')
  );
}

/**
 * Returns the ATX (`## Title`) and setext (`Title` over `===` / `---`)
 * headings of a markdown document, ignoring fenced code blocks.
 * @param markdown - The full markdown text.
 */
export function parseHeadings(markdown: string): Heading[] {
  const lines = markdown.split(/\r?\n/);
  const headings: Heading[] = [];
  const seen = new Map<string, number>();
  let fence: string | undefined;

  const add = (line: number, text: string): void => {
    const base = slugify(text);
    if (!base) return;
    let slug = base;
    let count = seen.get(base) ?? 0;
    // A literal heading "Intro-1" keeps its slug, so the suffix must skip taken slugs.
    while (seen.has(slug)) slug = `${base}-${++count}`;
    seen.set(base, count);
    seen.set(slug, seen.get(slug) ?? 0);
    headings.push({ line, text, slug });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = FENCE.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = undefined;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }
    const atx = ATX.exec(line);
    if (atx) {
      add(i, (atx[2] ?? '').trim());
      continue;
    }
    // Setext: a non-blank paragraph line followed by an underline. `---` under a
    // blank line is a thematic break, not a heading.
    const next = lines[i + 1];
    if (next !== undefined && line.trim() !== '' && /^ {0,3}\S/.test(line) && SETEXT_UNDERLINE.test(next)) {
      add(i, line.trim());
      i++;
    }
  }
  return headings;
}

/**
 * Returns the 0-based line of the heading whose slug matches the fragment, or
 * undefined. The match ignores case, as GitHub's anchor navigation does.
 * @param markdown - The full markdown text.
 * @param fragment - The anchor without its `#`.
 */
export function findHeadingLine(markdown: string, fragment: string): number | undefined {
  return findHeadingLineIn(parseHeadings(markdown), fragment);
}

/** Same as {@link findHeadingLine}, for already-parsed headings. */
export function findHeadingLineIn(headings: Heading[], fragment: string): number | undefined {
  const wanted = fragment.toLowerCase();
  return headings.find((heading) => heading.slug === wanted)?.line;
}
