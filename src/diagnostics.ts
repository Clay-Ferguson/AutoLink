/** Shows a warning squiggle on references whose file or heading can't be found. */

import * as vscode from 'vscode';
import { appliesTo, type AutoLinkConfig } from './config';
import { listMatches, type BrokenLink, type LinkService } from './linkService';

/** Pause after the last edit before a document is checked again. */
const DEBOUNCE_MS = 300;

export class BrokenLinkDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('autolink');
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Orders the checks of a document, so that an older check never overwrites a newer one. */
  private readonly generations = new Map<string, number>();
  private allTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly service: LinkService,
    private readonly getConfig: () => AutoLinkConfig,
  ) {}

  /**
   * Checks a document now and replaces its warnings.
   * @param document - The document to check.
   */
  async refresh(document: vscode.TextDocument): Promise<void> {
    const key = document.uri.toString();
    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);
    const config = this.getConfig();
    if (!config.warnOnBrokenLinks || !appliesTo(document.uri, config)) {
      this.collection.delete(document.uri);
      return;
    }
    const broken = await this.service.findBrokenLinks(document);
    if (document.isClosed || this.generations.get(key) !== generation) return;
    this.collection.set(
      document.uri,
      broken.map((link) => toDiagnostic(document, link)),
    );
  }

  /**
   * Checks a document after typing pauses.
   * @param document - The edited document.
   */
  refreshSoon(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void this.refresh(document);
      }, DEBOUNCE_MS),
    );
  }

  /** Checks every open document now. */
  refreshAll(): void {
    for (const document of vscode.workspace.textDocuments) void this.refresh(document);
  }

  /** Checks every open document after a pause, e.g. while a markdown file is being edited. */
  refreshAllSoon(): void {
    clearTimeout(this.allTimer);
    this.allTimer = setTimeout(() => {
      this.allTimer = undefined;
      this.refreshAll();
    }, DEBOUNCE_MS);
  }

  /**
   * Removes the warnings of a closed document.
   * @param uri - The document's URI.
   */
  clear(uri: vscode.Uri): void {
    const key = uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.generations.delete(key);
    this.collection.delete(uri);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    clearTimeout(this.allTimer);
    this.collection.dispose();
  }
}

const CODES: Record<BrokenLink['problem'], string> = {
  missingFile: 'missing-file',
  missingAnchor: 'missing-anchor',
  ambiguousFile: 'ambiguous-file',
};

function toDiagnostic(document: vscode.TextDocument, { ref, problem, matches }: BrokenLink): vscode.Diagnostic {
  const range = new vscode.Range(document.positionAt(ref.start), document.positionAt(ref.end));
  const message =
    problem === 'missingFile'
      ? `Markdown file not found: ${ref.path}`
      : problem === 'ambiguousFile'
        ? `Markdown file name not unique: ${ref.path} (${matches?.length ?? 0} files: ${listMatches(matches ?? [])})`
        : `Heading '#${ref.fragment}' not found in ${ref.path}`;
  const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
  diagnostic.source = 'AutoLink';
  diagnostic.code = CODES[problem];
  return diagnostic;
}
