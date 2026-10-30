/** Reads the `autolink.*` settings. */

import * as vscode from 'vscode';
import { compileExcludePatterns, isExcludedPath, type ExcludePattern } from './resolve/excludePatterns';
import { extensionOf } from './resolve/paths';

export const CONFIG_SECTION = 'autolink';

const DEFAULT_EXTENSIONS = ['ts', 'tsx', 'js'];

/**
 * The default `excludePatterns`: version control, dependency, cache and build
 * output folders of web and Python projects. Keep in sync with `package.json`.
 */
export const DEFAULT_EXCLUDE_PATTERNS = [
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.angular',
  '.turbo',
  '.parcel-cache',
  '.cache',
  '.vscode-test',
  'dist',
  'out',
  'build',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.nox',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.ipynb_checkpoints',
  '*.egg-info',
];

/** What to do when renaming or moving files in VS Code breaks references. */
export type RenameMode = 'prompt' | 'always' | 'never';

export interface AutoLinkConfig {
  /** Lower-case file extensions without dots, e.g. `ts`. */
  fileExtensions: ReadonlySet<string>;
  warnOnBrokenLinks: boolean;
  updateLinksOnRename: RenameMode;
  /**
   * Returns the patterns of files and folders AutoLink leaves alone, as set
   * for a workspace folder: each project has its own.
   * @param root - The workspace folder root, or undefined outside a workspace folder.
   */
  excludePatterns(root: vscode.Uri | undefined): readonly ExcludePattern[];
}

/**
 * Normalizes the `fileExtensions` setting: lower-cases each entry and strips
 * leading dots and white space, so `.TSX` and `tsx` mean the same. Entries
 * that aren't strings are ignored.
 * @param value - The raw setting value.
 */
export function normalizeExtensions(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set(DEFAULT_EXTENSIONS);
  const extensions = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const extension = entry.trim().replace(/^\.+/, '').toLowerCase();
    if (extension) extensions.add(extension);
  }
  return extensions;
}

/** Returns the current settings. */
export function readConfig(): AutoLinkConfig {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    fileExtensions: normalizeExtensions(config.get<unknown>('fileExtensions', DEFAULT_EXTENSIONS)),
    warnOnBrokenLinks: config.get<boolean>('warnOnBrokenLinks', true),
    updateLinksOnRename: normalizeRenameMode(config.get<unknown>('updateLinksOnRename', 'prompt')),
    excludePatterns: cachedPerFolder(readExcludePatterns),
  };
}

/**
 * Reads the `excludePatterns` setting of a workspace folder: its own
 * `.vscode/settings.json`, else the workspace's, else the user's.
 * @param root - The workspace folder root, or undefined for the window's setting.
 */
export function readExcludePatterns(root: vscode.Uri | undefined): ExcludePattern[] {
  return compileExcludePatterns(readExcludeSetting(root));
}

/**
 * Reads the raw `excludePatterns` setting of a workspace folder, as
 * {@link readExcludePatterns} does.
 * @param root - The workspace folder root, or undefined for the window's setting.
 */
export function readExcludeSetting(root: vscode.Uri | undefined): unknown {
  return vscode.workspace.getConfiguration(CONFIG_SECTION, root).get<unknown>('excludePatterns', DEFAULT_EXCLUDE_PATTERNS);
}

/** Memoizes a per-folder read; the settings are read again as a whole when they change. */
function cachedPerFolder<T>(read: (root: vscode.Uri | undefined) => T): (root: vscode.Uri | undefined) => T {
  const cache = new Map<string, T>();
  return (root) => {
    const key = root?.toString() ?? '';
    if (!cache.has(key)) cache.set(key, read(root));
    return cache.get(key)!;
  };
}

/**
 * Normalizes the `updateLinksOnRename` setting; anything unknown means `prompt`.
 * @param value - The raw setting value.
 */
export function normalizeRenameMode(value: unknown): RenameMode {
  return value === 'always' || value === 'never' ? value : 'prompt';
}

/**
 * Reports whether AutoLink processes a document: a local file whose extension
 * is listed in the settings and that `excludePatterns` doesn't exclude.
 * @param uri - The document's URI.
 * @param config - The current settings.
 */
export function appliesTo(uri: vscode.Uri, config: AutoLinkConfig): boolean {
  return uri.scheme === 'file' && config.fileExtensions.has(extensionOf(uri.path)) && !isExcluded(uri, config);
}

/**
 * Reports whether `excludePatterns` excludes a file or folder. The patterns
 * set for the workspace folder that holds it apply, relative to its root.
 * @param uri - The file or folder.
 * @param config - The current settings.
 */
export function isExcluded(uri: vscode.Uri, config: AutoLinkConfig): boolean {
  const root = vscode.workspace.getWorkspaceFolder(uri)?.uri;
  return isExcludedPath(config.excludePatterns(root), uri.path, root?.path);
}
