/**
 * The command behind every AutoLink link: opens the referenced markdown file in
 * the editor and scrolls its heading to the top.
 */

import * as vscode from 'vscode';
import { listMatches, type LinkService } from '../linkService';
import { findHeadingLine } from '../markdown/headings';

export const OPEN_LINK_COMMAND = 'autolink.openLink';

/** The arguments a link passes to the command. */
export interface OpenLinkArgs {
  /** URI of the document that contains the reference. */
  source: string;
  /** The relative path written in the document. */
  path: string;
  /** The anchor without its `#`. */
  fragment?: string;
}

/**
 * Returns the `command:` URI that runs the open-link command with the args.
 * @param args - The command arguments.
 */
export function openLinkUri(args: OpenLinkArgs): vscode.Uri {
  return vscode.Uri.parse(`command:${OPEN_LINK_COMMAND}?${encodeURIComponent(JSON.stringify(args))}`);
}

/**
 * Validates the command's argument. A `command:` URI can come from elsewhere
 * (a hover, another extension), so nothing about its shape is assumed.
 * @param value - The raw argument.
 */
export function parseOpenLinkArgs(value: unknown): OpenLinkArgs | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { source, path, fragment } = value as Record<string, unknown>;
  if (typeof source !== 'string' || typeof path !== 'string') return undefined;
  if (fragment !== undefined && typeof fragment !== 'string') return undefined;
  if (!/\.md$/i.test(path)) return undefined;
  return { source, path, fragment };
}

/**
 * Opens the markdown file a link names, at the heading of its anchor. Only
 * `.md` files that the link service resolves (inside the source's workspace
 * folder) are opened; a bare file name that several files have opens none.
 * @param service - Resolves the reference to a file.
 * @param value - The command argument (see {@link OpenLinkArgs}).
 */
export async function openLink(service: LinkService, value: unknown): Promise<void> {
  const args = parseOpenLinkArgs(value);
  if (!args) return;
  const { target, ambiguous } = await service.resolve(vscode.Uri.parse(args.source), args.path);
  if (ambiguous) {
    void vscode.window.showWarningMessage(
      `AutoLink: '${args.path}' is not unique: ${ambiguous.length} files have that name (${listMatches(ambiguous)}). Write its path instead.`,
    );
    return;
  }
  if (!target) {
    void vscode.window.showWarningMessage(`AutoLink: Markdown file not found: ${args.path}`);
    return;
  }
  const document = await vscode.workspace.openTextDocument(target);
  if (!args.fragment) {
    await vscode.window.showTextDocument(document);
    return;
  }
  const line = findHeadingLine(document.getText(), args.fragment);
  if (line === undefined) {
    void vscode.window.showWarningMessage(`AutoLink: Heading '#${args.fragment}' not found in ${args.path}`);
  }
  const position = new vscode.Position(line ?? 0, 0);
  const range = new vscode.Range(position, position);
  const editor = await vscode.window.showTextDocument(document, { selection: range });
  editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
}
