/**
 * Finds markdown file references written in parentheses, such as
 * `(docs/user_guide/USER_GUIDE.md#tab-bar)`, anywhere in a text. The same form
 * is the target of a markdown link (`[Tab bar](docs/guide.md#tab-bar)`),
 * including its optional `<…>` brackets and title.
 * Pure: no `vscode` import, so it is unit-testable in Node.
 */

/** A markdown file reference found in a text. Offsets are into the full text. */
export interface LinkRef {
  /** Offset of the first character of the path. */
  start: number;
  /** Offset just past the path or its anchor. */
  end: number;
  /** The relative path, e.g. `docs/guide.md`. */
  path: string;
  /** The anchor without its `#`, or undefined when there is none. */
  fragment?: string;
}

// A path segment character: letters, digits, `_`, `.` and `-`. Inside `<…>`
// a space is allowed too, as in a markdown link destination.
const SEG = String.raw`[\p{L}\p{N}_.\-]`;
const SEG_SPACED = String.raw`[\p{L}\p{N}_.\- ]`;

/** A relative path ending in `.md` (any case), followed by an optional anchor. */
const target = (seg: string) =>
  String.raw`((?:\.{1,2}/)*(?:${seg}+/)*${seg}*[\p{L}\p{N}_\-]\.md)` +
  String.raw`(?:#([\p{L}\p{N}\p{M}_\-]+))?`;

/**
 * - The reference must sit directly inside parentheses: `(docs/a.md)`, or
 *   `(<docs/my notes.md>)` when the path is in angle brackets, which allows
 *   spaces in it.
 * - A markdown link title may follow after whitespace: `(a.md "Title")` or
 *   `(a.md 'Title')`. It is matched only so that it is tolerated.
 * - The path is optional `./` / `../` prefixes, then `segment/` repeated, then
 *   a file name ending in `.md`. Since it must start right after the `(` or
 *   `<`, URLs (`(https://…/a.md)`), absolute paths (`(/docs/a.md)`), Windows
 *   paths and scoped names (`(@scope/a.md)`) never match.
 * - Requiring `)`, `>` or a title right after rejects `.mdx`, `.md5` and
 *   `a.md/b`.
 * - Groups 1–2 are the path and anchor in angle brackets, 3–4 without.
 */
const LINK_REF = new RegExp(
  String.raw`\((?:<${target(SEG_SPACED)}>|${target(SEG)})` +
    String.raw`(?:[ \t]+(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'))?` +
    String.raw`\)`,
  'giud',
);

/**
 * Returns every markdown file reference in the text, in order. A reference's
 * range covers its path and anchor only, not the brackets or title.
 * @param text - The full text of a document.
 */
export function findLinkRefs(text: string): LinkRef[] {
  const refs: LinkRef[] = [];
  for (const match of text.matchAll(LINK_REF)) {
    const angled = match[1] !== undefined;
    const path = angled ? match[1] : match[3];
    const fragment = angled ? match[2] : match[4];
    const indices = match.indices!;
    const [start, pathEnd] = indices[angled ? 1 : 3];
    const end = indices[angled ? 2 : 4]?.[1] ?? pathEnd;
    refs.push({ start, end, path, fragment });
  }
  return refs;
}
