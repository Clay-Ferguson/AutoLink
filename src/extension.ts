/**
 * AutoLink: makes markdown file references such as
 * `(docs/user_guide/USER_GUIDE.md#tab-bar)` in source files Ctrl/Cmd-clickable,
 * warns about references whose file or heading is missing, checks every
 * reference under a folder or in the whole project on request, and updates
 * references that renaming or moving files breaks.
 *
 * This module only wires the pieces together; VS Code disposes everything in
 * `context.subscriptions` when the extension deactivates.
 */

import * as vscode from 'vscode';
import {
  CHECK_FOLDER_LINKS_COMMAND,
  CHECK_PROJECT_LINKS_COMMAND,
  checkFolderLinks,
  checkProjectLinks,
} from './commands/checkLinks';
import { OPEN_LINK_COMMAND, openLink } from './commands/openLink';
import { CONFIG_SECTION, readConfig } from './config';
import { BrokenLinkDiagnostics } from './diagnostics';
import { LinkService } from './linkService';
import { AutoLinkProvider } from './providers/linkProvider';
import { RenameLinkUpdater } from './rename/renameWatcher';

export function activate(context: vscode.ExtensionContext): void {
  let config = readConfig();
  const getConfig = () => config;
  const service = new LinkService();
  const diagnostics = new BrokenLinkDiagnostics(service, getConfig);
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.md');

  // Re-registering the provider makes VS Code ask every open editor for links
  // again, so a settings change (e.g. adding `py`) takes effect without a reload.
  let providerRegistration: vscode.Disposable | undefined;
  const registerProvider = (): void => {
    providerRegistration?.dispose();
    providerRegistration = vscode.languages.registerDocumentLinkProvider(
      { scheme: 'file' },
      new AutoLinkProvider(getConfig),
    );
  };

  const onMarkdownChanged = (uri: vscode.Uri): void => {
    service.invalidateMarkdown(uri);
    diagnostics.refreshAllSoon();
  };

  registerProvider();
  context.subscriptions.push(
    {
      dispose: () => {
        providerRegistration?.dispose();
      },
    },
    diagnostics,
    watcher,
    new RenameLinkUpdater(service, getConfig),
    vscode.commands.registerCommand(OPEN_LINK_COMMAND, (args: unknown) => openLink(service, args)),
    vscode.commands.registerCommand(CHECK_FOLDER_LINKS_COMMAND, (folder: unknown) => checkFolderLinks(service, folder)),
    vscode.commands.registerCommand(CHECK_PROJECT_LINKS_COMMAND, (resource: unknown) =>
      checkProjectLinks(service, resource),
    ),
    watcher.onDidCreate(onMarkdownChanged),
    watcher.onDidChange(onMarkdownChanged),
    watcher.onDidDelete(onMarkdownChanged),
    // Renaming a folder may report no change for the markdown files inside it.
    vscode.workspace.onDidRenameFiles(() => {
      service.invalidateMarkdown();
      diagnostics.refreshAll();
    }),
    vscode.workspace.onDidOpenTextDocument((document) => void diagnostics.refresh(document)),
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      if (isMarkdown(document.uri)) onMarkdownChanged(document.uri);
      else diagnostics.refreshSoon(document);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnostics.clear(document.uri);
      service.forget(document.uri);
      // Unsaved edits of a closed markdown file no longer count: read it from disk again.
      if (isMarkdown(document.uri)) onMarkdownChanged(document.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(CONFIG_SECTION)) return;
      config = readConfig();
      registerProvider();
      diagnostics.refreshAll();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      // Workspace folders decide where references resolve.
      service.invalidateMarkdown();
      diagnostics.refreshAll();
    }),
  );
  diagnostics.refreshAll();
}

export function deactivate(): void {}

function isMarkdown(uri: vscode.Uri): boolean {
  return uri.scheme === 'file' && /\.md$/i.test(uri.path);
}
