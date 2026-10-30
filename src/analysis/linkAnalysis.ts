/**
 * Checks every markdown reference in the text files under a folder, for the
 * "Check Folder Links" and "Check Project Links" commands.
 */

import * as posix from 'node:path/posix';
import * as vscode from 'vscode';
import { readExcludePatterns } from '../config';
import type { LinkService } from '../linkService';
import { isExcludedPath } from '../resolve/excludePatterns';
import { findLinkRefs } from '../scan/linkScanner';
import { buildExcludeGlob, isBinary, lineAndColumn, lineStarts, MAX_FILE_BYTES } from './files';
import { comparePaths, type LinkAnalysis, type SourceFileLinks } from './types';

/** The report's file name, in the workspace folder root. */
export const REPORT_FILE = 'AUTOLINK_ANALYSIS.md';

/** Files read and checked at the same time. */
export const BATCH_SIZE = 16;

/**
 * Scans the text files under a folder, recursively, and checks each markdown
 * reference in them. Files excluded by `autolink.excludePatterns`,
 * `files.exclude` or `search.exclude`, `node_modules`, `.git` and the report
 * itself are skipped.
 * @param service - Resolves and checks references.
 * @param folder - The folder to scan.
 * @param root - The workspace folder root; report paths are relative to it.
 * @param token - Cancels the scan.
 * @param progress - Receives progress in percent.
 * @returns The result, or undefined when cancelled.
 */
export async function analyzeFolder(
  service: LinkService,
  folder: vscode.Uri,
  root: vscode.Uri,
  token?: vscode.CancellationToken,
  progress?: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<LinkAnalysis | undefined> {
  const files = await listFiles(folder, root, token);
  const analysis: LinkAnalysis = {
    rootName: posix.basename(root.path),
    folder: posix.relative(root.path, folder.path),
    scannedAt: new Date(),
    filesScanned: 0,
    filesSkipped: 0,
    sources: [],
  };
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    if (token?.isCancellationRequested) return undefined;
    const batch = files.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((uri) => checkFile(service, uri, root)));
    for (const result of results) {
      if (result === undefined) {
        analysis.filesSkipped++;
        continue;
      }
      analysis.filesScanned++;
      if (result.links.length > 0) analysis.sources.push(result);
    }
    progress?.report({
      message: `${Math.min(i + BATCH_SIZE, files.length)} of ${files.length} files`,
      increment: (batch.length / files.length) * 100,
    });
  }
  if (token?.isCancellationRequested) return undefined;
  analysis.sources.sort((a, b) => comparePaths(a.path, b.path));
  return analysis;
}

/**
 * Lists the files under a folder, recursively, that a scan reads: all but
 * those excluded by `autolink.excludePatterns`, `files.exclude` or
 * `search.exclude`, `node_modules`, `.git` and the report.
 * @param folder - The folder to list.
 * @param root - The workspace folder root, whose settings apply and which holds the report.
 * @param token - Cancels the listing.
 */
export async function listFiles(
  folder: vscode.Uri,
  root: vscode.Uri,
  token?: vscode.CancellationToken,
): Promise<vscode.Uri[]> {
  const exclude = buildExcludeGlob(
    vscode.workspace.getConfiguration('files', root).get<unknown>('exclude'),
    vscode.workspace.getConfiguration('search', root).get<unknown>('exclude'),
  );
  const excludePatterns = readExcludePatterns(root);
  const reportPath = posix.join(root.path, REPORT_FILE);
  return (await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*'), exclude, undefined, token)).filter(
    (uri) => uri.path !== reportPath && !isExcludedPath(excludePatterns, uri.path, root.path),
  );
}

/**
 * Checks the references in one file.
 * @returns The file's references, or undefined when it isn't a readable text file.
 */
async function checkFile(service: LinkService, uri: vscode.Uri, root: vscode.Uri): Promise<SourceFileLinks | undefined> {
  const text = await readSource(uri);
  if (text === undefined) return undefined;
  const path = posix.relative(root.path, uri.path);
  const refs = findLinkRefs(text);
  if (refs.length === 0) return { path, links: [] };
  const starts = lineStarts(text);
  const checked = await service.checkLinks(uri, refs);
  return {
    path,
    links: checked.map(({ ref, status, target }) => ({
      ...lineAndColumn(starts, ref.start),
      path: ref.path,
      fragment: ref.fragment,
      status,
      target: target && posix.relative(root.path, target.path),
    })),
  };
}

/**
 * Returns a file's text: the open editor's text when it is open, so unsaved
 * edits count, else the file on disk.
 * @returns The text, or undefined for a binary, too large or unreadable file.
 */
export async function readSource(uri: vscode.Uri): Promise<string | undefined> {
  const key = uri.toString();
  const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === key);
  if (open) return open.getText();
  try {
    if ((await vscode.workspace.fs.stat(uri)).size > MAX_FILE_BYTES) return undefined;
    const bytes = await vscode.workspace.fs.readFile(uri);
    return isBinary(bytes) ? undefined : new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}
