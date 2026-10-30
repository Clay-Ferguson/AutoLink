/**
 * Follows renames and moves made in VS Code (Explorer, drag and drop,
 * refactorings): finds the markdown references they broke and, as
 * `autolink.updateLinksOnRename` says, offers to update them or updates them.
 * Renames made outside VS Code, e.g. with `git mv`, aren't seen.
 */

import * as posix from 'node:path/posix';
import * as vscode from 'vscode';
import { REPORT_FILE } from '../analysis/linkAnalysis';
import { formatRenameReport } from '../analysis/report';
import type { AutoLinkConfig } from '../config';
import type { LinkService } from '../linkService';
import { applyFixes, findLinksBrokenByRenames, type FileRename, type MovedLink } from './renameCheck';

/** Pause after the last rename before the references are checked, so a burst of renames is checked once. */
const DEBOUNCE_MS = 500;

const FIX = 'Fix Links';
const SHOW = 'Show';

export class RenameLinkUpdater implements vscode.Disposable {
  private readonly subscription: vscode.Disposable;
  /** Renames not checked yet, in order. */
  private pending: FileRename[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Cancels the running check. */
  private running: vscode.CancellationTokenSource | undefined;

  constructor(
    private readonly service: LinkService,
    private readonly getConfig: () => AutoLinkConfig,
  ) {
    this.subscription = vscode.workspace.onDidRenameFiles(({ files }) => this.onRenamed(files));
  }

  private onRenamed(files: readonly FileRename[]): void {
    if (this.getConfig().updateLinksOnRename === 'never') return;
    const local = files.filter(({ oldUri, newUri }) => oldUri.scheme === 'file' && newUri.scheme === 'file');
    if (local.length === 0) return;
    this.pending.push(...local);
    // A newer rename can change what the running check finds: check them all again.
    this.running?.cancel();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.check();
    }, DEBOUNCE_MS);
  }

  /** Checks the pending renames and tells the user about the references they broke. */
  private async check(): Promise<void> {
    const renames = [...this.pending];
    const source = new vscode.CancellationTokenSource();
    this.running = source;
    let links: MovedLink[] | undefined;
    try {
      links = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'AutoLink: Checking links' },
        () => findLinksBrokenByRenames(this.service, renames, source.token),
      );
    } finally {
      if (this.running === source) this.running = undefined;
      source.dispose();
    }
    // Cancelled, or renamed again meanwhile: the next check has all the renames.
    if (!links || this.pending.length !== renames.length) return;
    this.pending = [];
    if (links.length > 0) await this.offer(renames, links);
  }

  /**
   * Asks whether to update the broken references, unless the setting says to
   * update them without asking, and updates them.
   */
  private async offer(renames: readonly FileRename[], links: readonly MovedLink[]): Promise<void> {
    const mode = this.getConfig().updateLinksOnRename;
    if (mode === 'never') return; // Changed while the check ran.
    if (mode === 'prompt') {
      const files = new Set(links.map((link) => link.source.toString())).size;
      const message = `AutoLink: ${describe(renames)} broke ${plural(links.length, 'link')} in ${plural(files, 'file')}.`;
      const actions = links.some((link) => link.replacement !== undefined) ? [FIX, SHOW] : [SHOW];
      for (;;) {
        const choice = await vscode.window.showWarningMessage(message, ...actions);
        if (choice === FIX) break;
        if (choice !== SHOW) return;
        await showReport(renames, links);
      }
    }

    const fixed = await applyFixes(links);
    const updated = `Updated ${plural(fixed.links, 'link')} in ${plural(fixed.files, 'file')}.`;
    const skipped = links.length - fixed.links;
    if (skipped === 0) {
      void vscode.window.showInformationMessage(`AutoLink: ${updated}`);
      return;
    }
    const notUpdated = `${plural(skipped, 'link')} could not be updated.`;
    const choice = await vscode.window.showWarningMessage(
      fixed.links > 0 ? `AutoLink: ${updated} ${notUpdated}` : `AutoLink: ${notUpdated}`,
      SHOW,
    );
    if (choice === SHOW) await showReport(renames, links);
  }

  dispose(): void {
    this.subscription.dispose();
    clearTimeout(this.timer);
    this.running?.cancel();
  }
}

/**
 * Writes the broken references to the report in the workspace folder root,
 * replacing any earlier report, and opens it.
 */
async function showReport(renames: readonly FileRename[], links: readonly MovedLink[]): Promise<void> {
  // A source moved out of the workspace still has its target inside it.
  const { source, target } = links[0];
  const root =
    (vscode.workspace.getWorkspaceFolder(source) ?? vscode.workspace.getWorkspaceFolder(target))?.uri ??
    source.with({ path: posix.dirname(source.path) });
  const relative = (uri: vscode.Uri) => posix.relative(root.path, uri.path);
  const text = formatRenameReport(
    posix.basename(root.path),
    renames.map(({ oldUri, newUri }) => ({ from: relative(oldUri), to: relative(newUri) })),
    links.map((link) => ({
      source: relative(link.source),
      line: link.line,
      column: link.column,
      text: link.text,
      target: relative(link.target),
      replacement: link.replacement,
    })),
    new Date(),
  );
  const report = vscode.Uri.joinPath(root, REPORT_FILE);
  await vscode.workspace.fs.writeFile(report, new TextEncoder().encode(text));
  await vscode.window.showTextDocument(report);
}

/** Names the renames for a message, e.g. `Moving guide.md` or `Renaming 3 items`. */
function describe(renames: readonly FileRename[]): string {
  const moved = renames.some(({ oldUri, newUri }) => posix.dirname(oldUri.path) !== posix.dirname(newUri.path));
  const verb = moved ? 'Moving' : 'Renaming';
  return renames.length === 1 ? `${verb} ${posix.basename(renames[0].oldUri.path)}` : `${verb} ${renames.length} items`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
