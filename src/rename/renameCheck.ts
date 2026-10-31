/**
 * Finds the markdown references that renaming or moving files and folders in
 * VS Code broke, and rewrites them so they name their files again.
 */

import * as posix from 'node:path/posix';
import * as vscode from 'vscode';
import { lineAndColumn, lineStarts } from '../analysis/files';
import { BATCH_SIZE, listFiles, readSource } from '../analysis/linkAnalysis';
import { comparePaths } from '../analysis/types';
import { isExcluded, readConfig } from '../config';
import type { LinkService } from '../linkService';
import { extensionOf, isInside } from '../resolve/paths';
import { findLinkRefs } from '../scan/linkScanner';
import { findMovedTarget, mapBack, rewriteRef, type Rename } from './renameMapping';

/** A renamed or moved file or folder, as `workspace.onDidRenameFiles` reports it. */
export interface FileRename {
  readonly oldUri: vscode.Uri;
  readonly newUri: vscode.Uri;
}

/** A reference that renames broke. */
export interface MovedLink {
  /** The file containing the reference. */
  source: vscode.Uri;
  /** Offset of the first character of the path in the source text. */
  start: number;
  /** Offset just past the path or its anchor. */
  end: number;
  /** 1-based line of the path's first character. */
  line: number;
  /** 1-based column of the path's first character. */
  column: number;
  /** The path and anchor as written. */
  text: string;
  /** The file the reference named, where it is now. */
  target: vscode.Uri;
  /** The text that names the target again; undefined when the new path can't be written as a reference. */
  replacement?: string;
}

/**
 * Finds the references that renames broke: those that named an existing file
 * before and now name no file, or another one. References that were broken
 * already are left out.
 *
 * When only files other than markdown files were renamed, only their own
 * references can break, so only they are read. Otherwise the text files of the
 * workspace folders involved are read, and those that neither were moved nor
 * mention a renamed name are skipped: a reference from outside a renamed file
 * or folder has to name it. Files excluded by `autolink.excludePatterns` are
 * never read.
 * @param service - Resolves references.
 * @param renames - The renames, in the order they happened; `file` URIs only.
 * @param token - Cancels the check.
 * @returns The broken references, sorted by file and position, or undefined when cancelled.
 */
export async function findLinksBrokenByRenames(
  service: LinkService,
  renames: readonly FileRename[],
  token?: vscode.CancellationToken,
): Promise<MovedLink[] | undefined> {
  const paths: Rename[] = renames.map(({ oldUri, newUri }) => ({ from: oldUri.path, to: newUri.path }));
  const names = paths.map(({ from }) => posix.basename(from));
  // File watcher events may arrive after the renames are reported: list the markdown files afresh.
  service.invalidateMarkdownIndex();
  const oldNames = oldMarkdownNames(service, paths);
  const files = await filesToCheck(renames, token);
  const links: MovedLink[] = [];
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    if (token?.isCancellationRequested) return undefined;
    const batch = files.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((uri) => checkFile(service, uri, paths, names, oldNames)));
    links.push(...results.flat());
  }
  if (token?.isCancellationRequested) return undefined;
  // The sort is stable, and each file's references are already in order.
  return links.sort((a, b) => comparePaths(a.source.path, b.source.path));
}

/** Returns where the markdown files of a workspace folder were before the renames, by their file names then. */
type OldMarkdownNames = (root: vscode.Uri) => Promise<Map<string, string[]>>;

/**
 * Lists where the markdown files of each workspace folder were before the
 * renames, by their file names then, so that a bare file name such as
 * `(USER_GUIDE.md)` can be followed to its renamed file. Each folder is
 * listed once, when first needed.
 * @param service - Lists the markdown files.
 * @param renames - The renames as paths.
 */
function oldMarkdownNames(service: LinkService, renames: readonly Rename[]): OldMarkdownNames {
  const cache = new Map<string, Promise<Map<string, string[]>>>();
  return (root) => {
    const key = root.toString();
    let cached = cache.get(key);
    if (!cached) {
      cached = service.listMarkdown(root).then((files) => {
        const byName = new Map<string, string[]>();
        for (const { path } of files) {
          const before = mapBack(path, renames);
          if (!isInside(root.path, before)) continue;
          const name = posix.basename(before);
          byName.set(name, [...(byName.get(name) ?? []), before]);
        }
        return byName;
      });
      cache.set(key, cached);
    }
    return cached;
  };
}

/** Returns the files whose references the renames may have broken. */
async function filesToCheck(renames: readonly FileRename[], token?: vscode.CancellationToken): Promise<vscode.Uri[]> {
  const types = await Promise.all(renames.map(({ newUri }) => fileType(newUri)));
  const scan = renames.some(
    ({ oldUri, newUri }, i) => isMarkdown(oldUri) || isMarkdown(newUri) || (types[i] ?? 0) & vscode.FileType.Directory,
  );
  // A file renamed again later no longer exists here; its later rename has it.
  if (!scan) {
    const config = readConfig();
    return renames
      .filter(({ newUri }, i) => (types[i] ?? 0) & vscode.FileType.File && !isExcluded(newUri, config))
      .map(({ newUri }) => newUri);
  }

  const roots = new Map<string, vscode.Uri>();
  for (const { oldUri, newUri } of renames) {
    for (const uri of [oldUri, newUri]) {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (folder) roots.set(folder.uri.toString(), folder.uri);
    }
  }
  const lists = await Promise.all([...roots.values()].map((root) => listFiles(root, root, token)));
  return lists.flat();
}

/**
 * Finds the references in one file that the renames broke.
 * @param service - Resolves references.
 * @param uri - The file, where it is now.
 * @param renames - The renames as paths.
 * @param names - The old names of the renamed files and folders.
 * @param oldNames - Where markdown files were before the renames, by their names then.
 */
async function checkFile(
  service: LinkService,
  uri: vscode.Uri,
  renames: readonly Rename[],
  names: readonly string[],
  oldNames: OldMarkdownNames,
): Promise<MovedLink[]> {
  const oldSource = mapBack(uri.path, renames);
  const moved = oldSource !== uri.path;
  const text = await readSource(uri);
  if (text === undefined || (!moved && !names.some((name) => text.includes(name)))) return [];
  const refs = findLinkRefs(text);
  if (refs.length === 0) return [];

  const oldFolder = vscode.workspace.getWorkspaceFolder(uri.with({ path: oldSource }))?.uri;
  const oldRoot = oldFolder?.path;
  const namesakes = async (name: string) => (oldFolder ? ((await oldNames(oldFolder)).get(name) ?? []) : []);
  const newRoot = vscode.workspace.getWorkspaceFolder(uri)?.uri.path;
  const isFile = async (path: string) => Boolean(((await fileType(uri.with({ path }))) ?? 0) & vscode.FileType.File);
  const resolve = async (refPath: string) => (await service.resolveTarget(uri, refPath))?.path;
  const starts = lineStarts(text);
  const links: MovedLink[] = [];
  for (const ref of refs) {
    const target = await findMovedTarget(ref.path, oldSource, oldRoot, renames, isFile, namesakes);
    // Untouched by the renames: it still means what it meant, broken or not.
    if (!target || (!moved && target.before === target.after)) continue;
    if ((await resolve(ref.path)) === target.after) continue;
    const angled = text[ref.start - 1] === '<';
    const replacement = await rewriteRef(
      { path: ref.path, fragment: ref.fragment, angled },
      uri.path,
      newRoot,
      target.after,
      target.style,
      resolve,
    );
    links.push({
      source: uri,
      start: ref.start,
      end: ref.end,
      ...lineAndColumn(starts, ref.start),
      text: text.slice(ref.start, ref.end),
      target: uri.with({ path: target.after }),
      replacement,
    });
  }
  return links;
}

/**
 * Rewrites the references that have a replacement, as one undoable edit, and
 * saves the files that had no unsaved changes before. A reference whose text
 * changed since it was found is left alone.
 * @param links - The broken references.
 * @returns How many references were rewritten, in how many files.
 */
export async function applyFixes(links: readonly MovedLink[]): Promise<{ links: number; files: number }> {
  const bySource = new Map<string, MovedLink[]>();
  for (const link of links) {
    if (link.replacement === undefined) continue;
    const key = link.source.toString();
    bySource.set(key, [...(bySource.get(key) ?? []), link]);
  }

  const edit = new vscode.WorkspaceEdit();
  const changed: vscode.TextDocument[] = [];
  let count = 0;
  for (const group of bySource.values()) {
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(group[0].source);
    } catch {
      continue; // Deleted or moved again since it was checked.
    }
    let replaced = 0;
    for (const link of group) {
      const range = new vscode.Range(document.positionAt(link.start), document.positionAt(link.end));
      if (document.getText(range) !== link.text) continue;
      edit.replace(document.uri, range, link.replacement!);
      replaced++;
    }
    if (replaced === 0) continue;
    count += replaced;
    changed.push(document);
  }
  if (count === 0) return { links: 0, files: 0 };

  // Saved only if they were saved before: the user's own unsaved edits stay unsaved.
  const toSave = changed.filter((document) => !document.isDirty);
  if (!(await vscode.workspace.applyEdit(edit, { isRefactoring: true }))) return { links: 0, files: 0 };
  await Promise.all(toSave.map((document) => document.save()));
  return { links: count, files: changed.length };
}

async function fileType(uri: vscode.Uri): Promise<vscode.FileType | undefined> {
  try {
    return (await vscode.workspace.fs.stat(uri)).type;
  } catch {
    return undefined;
  }
}

function isMarkdown(uri: vscode.Uri): boolean {
  return extensionOf(uri.path) === 'md';
}
