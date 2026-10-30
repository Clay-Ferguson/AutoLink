/**
 * The "AutoLink" submenu of the Explorer's context menu:
 *
 * - "Check Folder Links" (folders only) checks every markdown reference under
 *   the folder.
 * - "Check Project Links" checks every reference in the workspace folder that
 *   holds the clicked item; it is in the Command Palette too.
 *
 * Both write the result to `AUTOLINK_ANALYSIS.md` in the workspace folder root,
 * replacing any earlier report.
 */

import * as vscode from 'vscode';
import { analyzeFolder, REPORT_FILE } from '../analysis/linkAnalysis';
import { formatReport } from '../analysis/report';
import type { LinkAnalysis } from '../analysis/types';
import type { LinkService } from '../linkService';

export const CHECK_FOLDER_LINKS_COMMAND = 'autolink.checkFolderLinks';
export const CHECK_PROJECT_LINKS_COMMAND = 'autolink.checkProjectLinks';

/**
 * Scans a folder, writes the report and opens it.
 * @param service - Resolves and checks references.
 * @param folder - The folder the Explorer passes.
 * @returns The scan result, or undefined when there was no folder or the scan was cancelled.
 */
export async function checkFolderLinks(service: LinkService, folder: unknown): Promise<LinkAnalysis | undefined> {
  if (!(folder instanceof vscode.Uri)) {
    void vscode.window.showInformationMessage('AutoLink: Right-click a folder in the Explorer to check its links.');
    return undefined;
  }
  const root = vscode.workspace.getWorkspaceFolder(folder)?.uri ?? folder;
  return runCheck(service, folder, root);
}

/**
 * Scans the whole workspace folder, writes the report and opens it.
 * @param service - Resolves and checks references.
 * @param resource - The item the Explorer passes; none from the Command Palette.
 * @returns The scan result, or undefined when there was no workspace folder or the scan was cancelled.
 */
export async function checkProjectLinks(service: LinkService, resource: unknown): Promise<LinkAnalysis | undefined> {
  const workspaceFolder = await pickWorkspaceFolder(resource);
  if (!workspaceFolder) return undefined;
  return runCheck(service, workspaceFolder.uri, workspaceFolder.uri);
}

/**
 * Finds the workspace folder to scan: the one holding the clicked item, else
 * the only one, else the one the user picks.
 * @returns The folder, or undefined when there is none or the pick was cancelled.
 */
async function pickWorkspaceFolder(resource: unknown): Promise<vscode.WorkspaceFolder | undefined> {
  if (resource instanceof vscode.Uri) {
    const containing = vscode.workspace.getWorkspaceFolder(resource);
    if (containing) return containing;
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showInformationMessage('AutoLink: Open a folder to check its links.');
    return undefined;
  }
  if (folders.length === 1) return folders[0];
  return vscode.window.showWorkspaceFolderPick({ placeHolder: 'AutoLink: Workspace folder to check' });
}

/**
 * Scans a folder, writes the report to the root and opens it.
 * @param folder - The folder to scan.
 * @param root - The workspace folder root; the report goes here.
 * @returns The scan result, or undefined when cancelled.
 */
async function runCheck(service: LinkService, folder: vscode.Uri, root: vscode.Uri): Promise<LinkAnalysis | undefined> {
  const analysis = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'AutoLink: Checking links', cancellable: true },
    (progress, token) => analyzeFolder(service, folder, root, token, progress),
  );
  if (!analysis) return undefined;

  const report = vscode.Uri.joinPath(root, REPORT_FILE);
  await vscode.workspace.fs.writeFile(report, new TextEncoder().encode(formatReport(analysis)));
  await vscode.window.showTextDocument(report);
  const links = analysis.sources.flatMap((source) => source.links);
  const broken = links.filter((link) => link.status !== 'ok').length;
  void vscode.window.showInformationMessage(
    `AutoLink: ${links.length} links checked in ${analysis.sources.length} files, ${broken} broken. See ${REPORT_FILE}.`,
  );
  return analysis;
}
