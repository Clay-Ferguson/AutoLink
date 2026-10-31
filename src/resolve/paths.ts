/**
 * Computes where a relative markdown reference may point. Works on POSIX path
 * strings (the `path` part of a `vscode.Uri`). Pure: no `vscode` import.
 */

import * as posix from 'node:path/posix';

/**
 * Returns the paths a reference may name, in the order to try them: relative
 * to the document's folder first, then relative to its workspace root.
 * @param docDir - The folder of the source document.
 * @param workspaceRoot - The root of the document's workspace folder, if any.
 * @param refPath - The relative path written in the source.
 */
export function candidatePaths(docDir: string, workspaceRoot: string | undefined, refPath: string): string[] {
  const candidates = [posix.join(docDir, refPath)];
  if (workspaceRoot !== undefined) {
    const fromRoot = posix.join(workspaceRoot, refPath);
    if (!candidates.includes(fromRoot)) candidates.push(fromRoot);
  }
  return candidates;
}

/**
 * Reports whether a reference is a bare file name such as `USER_GUIDE.md`,
 * with no folder at all, not even `./`. Only such a reference may resolve to
 * the one file of that name anywhere in the workspace folder.
 * @param refPath - The relative path written in the source.
 */
export function isBareName(refPath: string): boolean {
  return !refPath.includes('/');
}

/**
 * Reports whether a path is the folder itself or lies inside it. Both paths
 * must be normalized. Used to keep `../../../etc/x.md` from leaving the
 * workspace.
 * @param folder - The containing folder.
 * @param target - The path to test.
 */
export function isInside(folder: string, target: string): boolean {
  if (target === folder) return true;
  const base = folder.endsWith('/') ? folder : `${folder}/`;
  return target.startsWith(base);
}

/**
 * Returns the lower-case extension of a path without its dot, e.g. `tsx`.
 * @param path - A file path.
 */
export function extensionOf(path: string): string {
  return posix.extname(path).slice(1).toLowerCase();
}
