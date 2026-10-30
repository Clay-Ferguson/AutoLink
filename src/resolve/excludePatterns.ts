/**
 * Matches paths against the `autolink.excludePatterns` setting: simple
 * wildcard patterns, not regular expressions. Pure: no `vscode` import.
 *
 * The rules follow `.gitignore`:
 *
 * - `*` matches any characters except `/`, `?` matches one character except
 *   `/`, and `**` matches any number of folders. Everything else is literal.
 * - A pattern containing a `/` (other than a trailing one) is relative to the
 *   workspace folder root: `test/*`, `/build`. A pattern without one matches a
 *   name at any depth: `fixtures`, `*.generated.ts`.
 * - A pattern that matches a folder excludes everything under it, so `test/*`
 *   and `test` both exclude all of `test/`.
 * - A trailing `/` matches folders only: `out/` excludes `out/a.ts` but not a
 *   file named `out`.
 */

/** A compiled pattern. */
export interface ExcludePattern {
  /** Matches a path relative to the root, or anything under such a path. */
  readonly regex: RegExp;
  /** Whether the pattern is relative to the root, rather than matching a name at any depth. */
  readonly anchored: boolean;
}

/**
 * Compiles the `excludePatterns` setting. Backslashes count as slashes, and
 * blank entries and entries that aren't strings are ignored.
 * @param value - The raw setting value.
 */
export function compileExcludePatterns(value: unknown): ExcludePattern[] {
  if (!Array.isArray(value)) return [];
  const patterns: ExcludePattern[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const pattern = compile(entry);
    if (pattern) patterns.push(pattern);
  }
  return patterns;
}

function compile(entry: string): ExcludePattern | undefined {
  let pattern = entry.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  const dirOnly = pattern.endsWith('/');
  pattern = pattern.replace(/\/+$/, '');
  const anchored = pattern.includes('/');
  pattern = pattern.replace(/^(?:\.?\/)+/, '');
  if (!pattern) return undefined;

  let body = '';
  for (let i = 0; i < pattern.length; ) {
    if (pattern.startsWith('**/', i)) {
      body += '(?:.*/)?';
      i += 3;
    } else if (pattern.startsWith('**', i)) {
      body += '.*';
      i += 2;
    } else if (pattern[i] === '*') {
      body += '[^/]*';
      i++;
    } else if (pattern[i] === '?') {
      body += '[^/]';
      i++;
    } else {
      body += pattern[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  const prefix = anchored ? '' : '(?:.*/)?';
  // A folder-only pattern must match a folder above the path, never the path itself.
  const suffix = dirOnly ? '/.+' : '(?:/.*)?';
  return { regex: new RegExp(`^${prefix}${body}${suffix}$`), anchored };
}

/**
 * Reports whether a path is excluded.
 * @param patterns - The compiled patterns.
 * @param path - An absolute POSIX path (the `path` part of a `vscode.Uri`).
 * @param root - The root of the path's workspace folder. Without one, only
 *   patterns that match a name at any depth apply.
 */
export function isExcludedPath(patterns: readonly ExcludePattern[], path: string, root: string | undefined): boolean {
  if (patterns.length === 0) return false;
  if (root === undefined) {
    const absolute = path.replace(/^\/+/, '');
    return patterns.some(({ regex, anchored }) => !anchored && regex.test(absolute));
  }
  const base = root.endsWith('/') ? root : `${root}/`;
  if (!path.startsWith(base)) return false;
  const relative = path.slice(base.length);
  return patterns.some(({ regex }) => regex.test(relative));
}
