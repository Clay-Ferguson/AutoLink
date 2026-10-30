/**
 * Makes every markdown reference in a processed document Ctrl/Cmd-clickable.
 * VS Code asks for links when a document is opened and again after edits.
 */

import * as vscode from 'vscode';
import { openLinkUri } from '../commands/openLink';
import { appliesTo, type AutoLinkConfig } from '../config';
import { findLinkRefs } from '../scan/linkScanner';

export class AutoLinkProvider implements vscode.DocumentLinkProvider {
  constructor(private readonly getConfig: () => AutoLinkConfig) {}

  /**
   * Returns one link per reference. Links whose target is missing stay
   * clickable (the command explains what's wrong); the diagnostics mark them,
   * so nothing here goes stale when a markdown file appears or disappears.
   * @param document - The document VS Code asks about.
   */
  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    if (!appliesTo(document.uri, this.getConfig())) return [];
    return findLinkRefs(document.getText()).map((ref) => {
      const range = new vscode.Range(document.positionAt(ref.start), document.positionAt(ref.end));
      const link = new vscode.DocumentLink(
        range,
        openLinkUri({ source: document.uri.toString(), path: ref.path, fragment: ref.fragment }),
      );
      link.tooltip = ref.fragment ? `Open ${ref.path} › #${ref.fragment}` : `Open ${ref.path}`;
      return link;
    });
  }
}
