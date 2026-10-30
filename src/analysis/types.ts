/**
 * The result of checking every markdown reference under a folder. Paths are
 * POSIX paths relative to the workspace folder root, so the data is plain and
 * needs no `vscode` types.
 */

import type { LinkStatus } from '../linkService';

/** One reference found in a source file. */
export interface LinkRecord {
  /** 1-based line of the path's first character. */
  line: number;
  /** 1-based column of the path's first character. */
  column: number;
  /** The path as written, e.g. `../docs/guide.md`. */
  path: string;
  /** The anchor without its `#`, or undefined when there is none. */
  fragment?: string;
  status: LinkStatus;
  /** The file the path resolves to; undefined when it is missing. */
  target?: string;
}

/** A scanned file that contains at least one reference. */
export interface SourceFileLinks {
  path: string;
  /** The references in the order they appear in the file. */
  links: LinkRecord[];
}

export interface LinkAnalysis {
  /** Name of the workspace folder (or of the scanned folder outside a workspace). */
  rootName: string;
  /** The scanned folder; empty for the root itself. */
  folder: string;
  scannedAt: Date;
  /** Text files read. */
  filesScanned: number;
  /** Files not read: binary, too large or unreadable. */
  filesSkipped: number;
  /** Files with references, sorted by path. */
  sources: SourceFileLinks[];
}

/** A file that references resolve to, with the references to it. */
export interface LinkedTarget {
  path: string;
  inbound: { source: string; link: LinkRecord }[];
}

/**
 * Groups the references that resolve to a file by that file. References to
 * missing files have no target and are left out.
 * @param analysis - The scan result.
 * @returns The linked files, sorted by path; references in source order.
 */
export function indexTargets(analysis: LinkAnalysis): LinkedTarget[] {
  const byPath = new Map<string, LinkedTarget>();
  for (const source of analysis.sources) {
    for (const link of source.links) {
      if (link.target === undefined) continue;
      let entry = byPath.get(link.target);
      if (!entry) {
        entry = { path: link.target, inbound: [] };
        byPath.set(link.target, entry);
      }
      entry.inbound.push({ source: source.path, link });
    }
  }
  return [...byPath.values()].sort((a, b) => comparePaths(a.path, b.path));
}

/**
 * Orders paths for display: plain code-unit order, so the order doesn't depend
 * on the locale.
 * @param a - A path.
 * @param b - Another path.
 */
export function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
