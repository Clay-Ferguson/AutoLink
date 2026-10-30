/**
 * Maps paths across renames and moves, and works out the new text of a
 * reference whose target or source file moved. Works on POSIX path strings
 * (the `path` part of a `vscode.Uri`). Pure: no `vscode` import.
 */

import * as posix from 'node:path/posix';
import { candidatePaths, isInside } from '../resolve/paths';
import { findLinkRefs } from '../scan/linkScanner';

/** A file or folder that was renamed or moved. */
export interface Rename {
  from: string;
  to: string;
}

/**
 * How a reference names its file: relative to the source file's folder, or
 * relative to the workspace folder root.
 */
export type LinkStyle = 'source' | 'root';

/** The file a reference named before the renames. */
export interface MovedTarget {
  /** Where the file was. */
  before: string;
  /** Where the file is now. */
  after: string;
  style: LinkStyle;
}

/** The parts of a reference that its new text is built from. */
export interface RefText {
  /** The path as written. */
  path: string;
  /** The anchor without its `#`, or undefined when there is none. */
  fragment?: string;
  /** Whether the reference is written in `<…>`. */
  angled: boolean;
}

/**
 * Returns where a path is after the renames. A path inside a renamed folder
 * moves with it; renames apply in order, so `a → b` then `b → c` takes `a` to `c`.
 * @param path - A path from before the renames.
 * @param renames - The renames, in the order they happened.
 */
export function mapForward(path: string, renames: readonly Rename[]): string {
  let result = path;
  for (const { from, to } of renames) result = movePath(result, from, to);
  return result;
}

/**
 * Returns where a path was before the renames: the inverse of {@link mapForward}.
 * @param path - A path from after the renames.
 * @param renames - The renames, in the order they happened.
 */
export function mapBack(path: string, renames: readonly Rename[]): string {
  let result = path;
  for (let i = renames.length - 1; i >= 0; i--) result = movePath(result, renames[i].to, renames[i].from);
  return result;
}

function movePath(path: string, from: string, to: string): string {
  return isInside(from, path) ? to + path.slice(from.length) : path;
}

/**
 * Finds the file a reference named before the renames, the same way
 * `LinkService.resolveTarget` does (source folder first, then the workspace
 * root), and where that file is now. The file must still exist.
 * @param refPath - The path as written.
 * @param oldSource - Where the source file was before the renames.
 * @param oldRoot - The workspace folder root the source file was in, if any.
 * @param renames - The renames, in the order they happened.
 * @param isFile - Reports whether a file exists now.
 * @returns The target, or undefined when the reference named no file that still exists.
 */
export async function findMovedTarget(
  refPath: string,
  oldSource: string,
  oldRoot: string | undefined,
  renames: readonly Rename[],
  isFile: (path: string) => Promise<boolean>,
): Promise<MovedTarget | undefined> {
  const docDir = posix.dirname(oldSource);
  const allowed = oldRoot ?? docDir;
  const candidates = candidatePaths(docDir, oldRoot, refPath);
  for (const [index, before] of candidates.entries()) {
    if (!isInside(allowed, before)) continue;
    const after = mapForward(before, renames);
    if (await isFile(after)) return { before, after, style: index === 0 ? 'source' : 'root' };
  }
  return undefined;
}

/**
 * Returns the text that replaces a reference (its path and anchor, inside the
 * brackets) so that it names the target again. The reference keeps its style
 * when that works, else takes the other one, and keeps a leading `./`. A path
 * with a space is put in `<…>`.
 * @param ref - The reference as written.
 * @param newSource - Where the source file is now.
 * @param newRoot - The workspace folder root the source file is in now, if any.
 * @param target - Where the target file is now.
 * @param style - How the reference named its file before.
 * @param resolve - Resolves a path written in the source file to a file, as `LinkService.resolveTarget` does.
 * @returns The new text, or undefined when no reference syntax can name the target.
 */
export async function rewriteRef(
  ref: RefText,
  newSource: string,
  newRoot: string | undefined,
  target: string,
  style: LinkStyle,
  resolve: (refPath: string) => Promise<string | undefined>,
): Promise<string | undefined> {
  const styles: LinkStyle[] = style === 'source' ? ['source', 'root'] : ['root', 'source'];
  for (const tried of styles) {
    const path = relativePath(ref.path, newSource, newRoot, target, tried);
    if (path === undefined) continue;
    const text = formatRef(path, ref.fragment, ref.angled);
    if (text !== undefined && (await resolve(path)) === target) return text;
  }
  return undefined;
}

function relativePath(
  written: string,
  newSource: string,
  newRoot: string | undefined,
  target: string,
  style: LinkStyle,
): string | undefined {
  if (style === 'root') return newRoot !== undefined && isInside(newRoot, target) ? posix.relative(newRoot, target) : undefined;
  const path = posix.relative(posix.dirname(newSource), target);
  return written.startsWith('./') && !path.startsWith('../') ? `./${path}` : path;
}

/**
 * Formats a path and anchor as the text of a reference, and checks that the
 * scanner reads it back unchanged.
 * @param path - The new path.
 * @param fragment - The anchor, if any.
 * @param angled - Whether the reference is already in `<…>`; the brackets stay and aren't part of the text.
 * @returns The text, or undefined when the path can't be written as a reference (e.g. it contains `(`).
 */
export function formatRef(path: string, fragment: string | undefined, angled: boolean): string | undefined {
  const target = fragment === undefined ? path : `${path}#${fragment}`;
  const text = !angled && path.includes(' ') ? `<${target}>` : target;
  const refs = findLinkRefs(angled ? `(<${text}>)` : `(${text})`);
  return refs.length === 1 && refs[0].path === path && refs[0].fragment === fragment ? text : undefined;
}
