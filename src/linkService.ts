/**
 * Resolves markdown references to files and checks them, with caching. Shared
 * by the open-link command, the broken-link diagnostics and the folder check.
 */

import * as posix from 'node:path/posix';
import * as vscode from 'vscode';
import { findHeadingLineIn, parseHeadings, type Heading } from './markdown/headings';
import { candidatePaths, isInside } from './resolve/paths';
import { findLinkRefs, type LinkRef } from './scan/linkScanner';

export type LinkProblem = 'missingFile' | 'missingAnchor';
export type LinkStatus = 'ok' | LinkProblem;

/** A reference with the result of checking it. */
export interface CheckedLink {
  ref: LinkRef;
  status: LinkStatus;
  /** The file the reference resolves to; undefined when it is missing. */
  target?: vscode.Uri;
}

/** A reference whose file, or whose heading, can't be found. */
export interface BrokenLink {
  ref: LinkRef;
  problem: LinkProblem;
}

export class LinkService {
  /** Broken links per source document URI, valid for one document version. */
  private readonly broken = new Map<string, { version: number; links: Promise<BrokenLink[]> }>();
  /** Parsed headings per markdown URI; undefined when the file can't be read. */
  private readonly headings = new Map<string, Promise<Heading[] | undefined>>();

  /**
   * Finds the file a reference names: relative to the source file's folder
   * first, then relative to its workspace folder root. A path that leaves the
   * workspace folder (or, outside a workspace, the source file's folder) is
   * never used.
   * @param source - The URI of the document containing the reference.
   * @param refPath - The relative path written in the document.
   * @returns The URI of an existing file, or undefined.
   */
  async resolveTarget(source: vscode.Uri, refPath: string): Promise<vscode.Uri | undefined> {
    const docDir = posix.dirname(source.path);
    const root = vscode.workspace.getWorkspaceFolder(source)?.uri.path;
    const allowed = root ?? docDir;
    for (const path of candidatePaths(docDir, root, refPath)) {
      if (!isInside(allowed, path)) continue;
      const candidate = source.with({ path, query: '', fragment: '' });
      try {
        const stat = await vscode.workspace.fs.stat(candidate);
        if (stat.type & vscode.FileType.File) return candidate;
      } catch {
        // Not found: try the next candidate.
      }
    }
    return undefined;
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
      checked.flatMap(({ ref, status }) => (status === 'ok' ? [] : [{ ref, problem: status }])),
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
    const targets = new Map<string, Promise<vscode.Uri | undefined>>();
    const checked: CheckedLink[] = [];
    for (const ref of refs) {
      let target = targets.get(ref.path);
      if (!target) {
        target = this.resolveTarget(source, ref.path);
        targets.set(ref.path, target);
      }
      const uri = await target;
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
