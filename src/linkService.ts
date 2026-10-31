/**
 * Resolves markdown references to files and checks them, with caching. Shared
 * by the open-link command, the broken-link diagnostics and the folder check.
 */

import * as posix from 'node:path/posix';
import * as vscode from 'vscode';
import { listFiles } from './analysis/linkAnalysis';
import { findHeadingLineIn, parseHeadings, type Heading } from './markdown/headings';
import { candidatePaths, extensionOf, isBareName, isInside } from './resolve/paths';
import { findLinkRefs, type LinkRef } from './scan/linkScanner';

export type LinkProblem = 'missingFile' | 'missingAnchor' | 'ambiguousFile';
export type LinkStatus = 'ok' | LinkProblem;

/** How many of an ambiguous reference's files a message names. */
const MAX_LISTED_MATCHES = 5;

/** Where a reference leads. */
export interface Resolution {
  /** The file the reference names; undefined when it is missing or ambiguous. */
  target?: vscode.Uri;
  /** For a bare file name that more than one file has: every one of them. */
  ambiguous?: vscode.Uri[];
}

/** A reference with the result of checking it. */
export interface CheckedLink {
  ref: LinkRef;
  status: LinkStatus;
  /** The file the reference resolves to; undefined when it is missing or ambiguous. */
  target?: vscode.Uri;
  /** The files an ambiguous bare file name may mean. */
  matches?: vscode.Uri[];
}

/** A reference whose file, or whose heading, can't be found, or whose file name isn't unique. */
export interface BrokenLink {
  ref: LinkRef;
  problem: LinkProblem;
  /** The files an ambiguous bare file name may mean. */
  matches?: vscode.Uri[];
}

export class LinkService {
  /** Broken links per source document URI, valid for one document version. */
  private readonly broken = new Map<string, { version: number; links: Promise<BrokenLink[]> }>();
  /** Parsed headings per markdown URI; undefined when the file can't be read. */
  private readonly headings = new Map<string, Promise<Heading[] | undefined>>();
  /** The markdown files of each workspace folder (by root URI), by file name. */
  private readonly markdownIndex = new Map<string, Promise<Map<string, vscode.Uri[]>>>();

  /**
   * Finds the file a reference names, as {@link resolve} does.
   * @param source - The URI of the document containing the reference.
   * @param refPath - The relative path written in the document.
   * @returns The URI of an existing file, or undefined when it is missing or ambiguous.
   */
  async resolveTarget(source: vscode.Uri, refPath: string): Promise<vscode.Uri | undefined> {
    return (await this.resolve(source, refPath)).target;
  }

  /**
   * Finds the file a reference names: relative to the source file's folder
   * first, then relative to its workspace folder root. A path that leaves the
   * workspace folder (or, outside a workspace, the source file's folder) is
   * never used. Failing those, a bare file name such as `USER_GUIDE.md` names
   * the markdown file of that name anywhere in the workspace folder, provided
   * there is only one. See: (README.md#bare-file-names)
   * @param source - The URI of the document containing the reference.
   * @param refPath - The relative path written in the document.
   */
  async resolve(source: vscode.Uri, refPath: string): Promise<Resolution> {
    const docDir = posix.dirname(source.path);
    const folder = vscode.workspace.getWorkspaceFolder(source)?.uri;
    const root = folder?.path;
    const allowed = root ?? docDir;
    for (const path of candidatePaths(docDir, root, refPath)) {
      if (!isInside(allowed, path)) continue;
      const candidate = source.with({ path, query: '', fragment: '' });
      if (await isFile(candidate)) return { target: candidate };
    }
    if (!folder || !isBareName(refPath)) return {};
    const matches = await this.findByName(folder, refPath);
    if (matches.length === 1) return { target: matches[0] };
    return matches.length > 1 ? { ambiguous: matches } : {};
  }

  /**
   * Returns the markdown files of a workspace folder, except those that
   * `autolink.excludePatterns`, `files.exclude` or `search.exclude` exclude.
   * The list is cached until {@link invalidateMarkdownIndex}; it may name
   * files deleted since.
   * @param root - The workspace folder root.
   */
  async listMarkdown(root: vscode.Uri): Promise<vscode.Uri[]> {
    return [...(await this.indexOf(root)).values()].flat();
  }

  /**
   * Returns the existing markdown files of a workspace folder that have a
   * name, in path order.
   * @param root - The workspace folder root.
   * @param name - The file name, e.g. `USER_GUIDE.md`; case matters.
   */
  private async findByName(root: vscode.Uri, name: string): Promise<vscode.Uri[]> {
    const indexed = (await this.indexOf(root)).get(name) ?? [];
    // A deleted folder may not report the files in it, so the index can be stale.
    const exists = await Promise.all(indexed.map(isFile));
    return indexed.filter((_, i) => exists[i]);
  }

  private indexOf(root: vscode.Uri): Promise<Map<string, vscode.Uri[]>> {
    const key = root.toString();
    let cached = this.markdownIndex.get(key);
    if (!cached) {
      cached = listFiles(root, root, undefined, '**/*.md').then((files) => {
        const byName = new Map<string, vscode.Uri[]>();
        for (const uri of files.filter((file) => extensionOf(file.path) === 'md').sort(byPath)) {
          const name = posix.basename(uri.path);
          byName.set(name, [...(byName.get(name) ?? []), uri]);
        }
        return byName;
      });
      // A failed listing is tried again next time.
      const listing = cached;
      listing.catch(() => {
        if (this.markdownIndex.get(key) === listing) this.markdownIndex.delete(key);
      });
      this.markdownIndex.set(key, listing);
    }
    return cached;
  }

  /**
   * Returns the headings of a markdown file, from the open editor's text when
   * the file is open, else from disk.
   * @param uri - The markdown file.
   */
  getHeadings(uri: vscode.Uri): Promise<Heading[] | undefined> {
    const key = uri.toString();
    let cached = this.headings.get(key);
    if (!cached) {
      cached = readText(uri).then((text) => (text === undefined ? undefined : parseHeadings(text)));
      this.headings.set(key, cached);
    }
    return cached;
  }

  /**
   * Returns the references in a document whose file or heading can't be found.
   * @param document - A source document.
   */
  findBrokenLinks(document: vscode.TextDocument): Promise<BrokenLink[]> {
    const key = document.uri.toString();
    const cached = this.broken.get(key);
    if (cached && cached.version === document.version) return cached.links;
    const links = this.checkLinks(document.uri, findLinkRefs(document.getText())).then((checked) =>
      checked.flatMap(({ ref, status, matches }) => (status === 'ok' ? [] : [{ ref, problem: status, matches }])),
    );
    this.broken.set(key, { version: document.version, links });
    return links;
  }

  /**
   * Drops cached results after a markdown file was created, changed or
   * deleted. Every document's broken-link result is dropped too, since any of
   * them may reference that file.
   * @param uri - The markdown file, or undefined to drop everything.
   */
  invalidateMarkdown(uri?: vscode.Uri): void {
    if (uri) this.headings.delete(uri.toString());
    else this.headings.clear();
    this.broken.clear();
  }

  /**
   * Drops the cached list of markdown files after markdown files were
   * created, deleted or renamed, or the settings that exclude files changed.
   * Every document's broken-link result is dropped too, since bare file names
   * in any of them may now name another file or none.
   */
  invalidateMarkdownIndex(): void {
    this.markdownIndex.clear();
    this.broken.clear();
  }

  /**
   * Drops the cached result of a closed document.
   * @param uri - The document's URI.
   */
  forget(uri: vscode.Uri): void {
    this.broken.delete(uri.toString());
  }

  /**
   * Checks every reference of a document: finds its file and, when it has an
   * anchor, the heading.
   * @param source - The URI of the document containing the references.
   * @param refs - The references found in it.
   * @returns One result per reference, in the same order.
   */
  async checkLinks(source: vscode.Uri, refs: LinkRef[]): Promise<CheckedLink[]> {
    // One lookup per distinct path, however often the document repeats it.
    const resolutions = new Map<string, Promise<Resolution>>();
    const checked: CheckedLink[] = [];
    for (const ref of refs) {
      let resolution = resolutions.get(ref.path);
      if (!resolution) {
        resolution = this.resolve(source, ref.path);
        resolutions.set(ref.path, resolution);
      }
      const { target: uri, ambiguous } = await resolution;
      if (ambiguous) {
        checked.push({ ref, status: 'ambiguousFile', matches: ambiguous });
        continue;
      }
      if (!uri) {
        checked.push({ ref, status: 'missingFile' });
        continue;
      }
      if (ref.fragment === undefined) {
        checked.push({ ref, status: 'ok', target: uri });
        continue;
      }
      const headings = await this.getHeadings(uri);
      const found = headings !== undefined && findHeadingLineIn(headings, ref.fragment) !== undefined;
      checked.push({ ref, status: found ? 'ok' : 'missingAnchor', target: uri });
    }
    return checked;
  }
}

/**
 * Lists the files an ambiguous reference may mean, relative to their
 * workspace folder root, for a message: at most a few, then `…`.
 * @param matches - The files.
 */
export function listMatches(matches: readonly vscode.Uri[]): string {
  const shown = matches.slice(0, MAX_LISTED_MATCHES).map((uri) => {
    const root = vscode.workspace.getWorkspaceFolder(uri)?.uri.path;
    return root === undefined ? uri.path : posix.relative(root, uri.path);
  });
  if (matches.length > MAX_LISTED_MATCHES) shown.push('…');
  return shown.join(', ');
}

async function isFile(uri: vscode.Uri): Promise<boolean> {
  try {
    return Boolean((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.File);
  } catch {
    return false;
  }
}

function byPath(a: vscode.Uri, b: vscode.Uri): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  const key = uri.toString();
  const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === key);
  if (open) return open.getText();
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}
