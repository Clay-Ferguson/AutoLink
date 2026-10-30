/**
 * A small stand-in for the `vscode` module, used by the unit tests through the
 * `vscode` alias in vitest.config.mts. It implements only what AutoLink uses.
 * Tests set up files, workspace folders and settings with {@link fake}.
 */

export class Uri {
  constructor(
    readonly scheme: string,
    readonly authority: string,
    readonly path: string,
    readonly query: string,
    readonly fragment: string,
  ) {}

  static file(path: string): Uri {
    return new Uri('file', '', path, '', '');
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    return base.with({ path: [base.path, ...segments].join('/').replace(/\/+/g, '/') });
  }

  static parse(value: string): Uri {
    const match = /^([a-z][\w+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i.exec(value);
    if (!match) throw new Error(`Bad URI: ${value}`);
    return new Uri(match[1], match[2] ?? '', match[3], match[4] ?? '', match[5] ?? '');
  }

  with(change: Partial<Pick<Uri, 'scheme' | 'authority' | 'path' | 'query' | 'fragment'>>): Uri {
    return new Uri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment,
    );
  }

  toString(): string {
    const authority = this.scheme === 'file' || this.authority ? `//${this.authority}` : '';
    const query = this.query ? `?${this.query}` : '';
    const fragment = this.fragment ? `#${this.fragment}` : '';
    return `${this.scheme}:${authority}${this.path}${query}${fragment}`;
  }
}

export class Position {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}

export class Range {
  constructor(
    readonly start: Position,
    readonly end: Position,
  ) {}
}

export class DocumentLink {
  tooltip?: string;
  constructor(
    readonly range: Range,
    readonly target?: Uri,
  ) {}
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export class Diagnostic {
  source?: string;
  code?: string;
  constructor(
    readonly range: Range,
    readonly message: string,
    readonly severity: DiagnosticSeverity,
  ) {}
}

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export class RelativePattern {
  constructor(
    readonly baseUri: Uri,
    readonly pattern: string,
  ) {}
}

export enum TextEditorRevealType {
  Default = 0,
  InCenter = 1,
  InCenterIfOutsideViewport = 2,
  AtTop = 3,
}

/** A text document. Edits change its text and make it dirty; saving writes it to the fake files. */
export class FakeDocument {
  isClosed = false;
  isDirty = false;
  constructor(
    readonly uri: Uri,
    private text: string,
    readonly version = 1,
  ) {}

  getText(range?: Range): string {
    if (!range) return this.text;
    return this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
  }

  positionAt(offset: number): Position {
    const before = this.text.slice(0, offset);
    const line = before.split('\n').length - 1;
    return new Position(line, offset - (before.lastIndexOf('\n') + 1));
  }

  offsetAt(position: Position): number {
    const lines = this.text.split('\n');
    let offset = 0;
    for (let i = 0; i < position.line; i++) offset += lines[i].length + 1;
    return offset + position.character;
  }

  /** Replaces the whole text, as an applied edit does. */
  edit(text: string): void {
    this.text = text;
    this.isDirty = true;
  }

  save(): Promise<boolean> {
    fake.files.set(this.uri.path, this.text);
    fake.saved.push(this.uri.path);
    this.isDirty = false;
    return Promise.resolve(true);
  }
}

/** Records replacements, like vscode.WorkspaceEdit. */
export class WorkspaceEdit {
  readonly replacements: { uri: Uri; range: Range; newText: string }[] = [];

  replace(uri: Uri, range: Range, newText: string): void {
    this.replacements.push({ uri, range, newText });
  }
}

/** A minimal event emitter, like vscode.EventEmitter. */
export class EventEmitter<T> {
  private listeners: ((data: T) => void)[] = [];

  readonly event = (listener: (data: T) => void): { dispose(): void } => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((other) => other !== listener);
      },
    };
  };

  fire(data: T): void {
    for (const listener of [...this.listeners]) listener(data);
  }
}

export class CancellationTokenSource {
  readonly token = { isCancellationRequested: false };

  cancel(): void {
    this.token.isCancellationRequested = true;
  }

  dispose(): void {}
}

export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

/** A message the extension showed, with the buttons it offered. */
export interface FakeMessage {
  kind: 'info' | 'warning';
  message: string;
  items: string[];
}

/** The state that tests control. */
export const fake = {
  /** File contents by path. */
  files: new Map<string, string>(),
  /** Workspace folder root paths. */
  folders: [] as string[],
  /** Settings by key, e.g. `fileExtensions`. */
  settings: new Map<string, unknown>(),
  /** Settings of one workspace folder by its root path, overriding {@link fake.settings} there. */
  folderSettings: new Map<string, Map<string, unknown>>(),
  /** Documents open in the editor, or opened with `openTextDocument`. */
  textDocuments: [] as FakeDocument[],
  /** Paths of the documents saved, in order. */
  saved: [] as string[],
  /** The edits passed to `applyEdit`, with their metadata. */
  appliedEdits: [] as { edit: WorkspaceEdit; metadata?: { isRefactoring?: boolean } }[],
  /** Whether `applyEdit` succeeds. */
  applyEditSucceeds: true,
  /** Fires `workspace.onDidRenameFiles`. */
  renames: new EventEmitter<{ files: readonly { oldUri: Uri; newUri: Uri }[] }>(),
  /** Messages shown, in order. */
  messages: [] as FakeMessage[],
  /** The buttons the user picks for the next messages, in order; undefined dismisses. */
  answers: [] as (string | undefined)[],
  /** Progress titles shown, in order. */
  progress: [] as string[],
  /** Runs when `withProgress` starts a task, before the task. */
  onProgress: undefined as (() => void) | undefined,
  /** Paths of the documents shown in an editor. */
  shown: [] as string[],
  reset(): void {
    this.files.clear();
    this.folders = [];
    this.settings.clear();
    this.folderSettings.clear();
    this.textDocuments = [];
    this.saved = [];
    this.appliedEdits = [];
    this.applyEditSucceeds = true;
    this.renames = new EventEmitter();
    this.messages = [];
    this.answers = [];
    this.progress = [];
    this.onProgress = undefined;
    this.shown = [];
  },
};

function isDirectory(path: string): boolean {
  const prefix = path.endsWith('/') ? path : `${path}/`;
  return [...fake.files.keys()].some((file) => file.startsWith(prefix));
}

export const workspace = {
  fs: {
    stat(uri: Uri): Promise<{ type: FileType; size: number }> {
      const text = fake.files.get(uri.path);
      if (text !== undefined) return Promise.resolve({ type: FileType.File, size: new TextEncoder().encode(text).length });
      if (isDirectory(uri.path)) return Promise.resolve({ type: FileType.Directory, size: 0 });
      return Promise.reject(new Error(`ENOENT ${uri.path}`));
    },
    writeFile(uri: Uri, content: Uint8Array): Promise<void> {
      fake.files.set(uri.path, new TextDecoder().decode(content));
      return Promise.resolve();
    },
    readFile(uri: Uri): Promise<Uint8Array> {
      const text = fake.files.get(uri.path);
      if (text === undefined) return Promise.reject(new Error(`ENOENT ${uri.path}`));
      return Promise.resolve(new TextEncoder().encode(text));
    },
  },
  /**
   * Lists every file under the pattern's base, whatever the include pattern.
   * Of the exclude glob, only entries that exclude a name anywhere in the tree
   * (a globstar, a slash, then the name) are honored.
   */
  findFiles(include: RelativePattern, exclude?: string): Promise<Uri[]> {
    const excluded = [...(exclude ?? '').matchAll(/\*\*\/([^,{}/*]+)/g)].map((match) => match[1]);
    const prefix = `${include.baseUri.path}/`;
    const paths = [...fake.files.keys()].filter(
      (path) => path.startsWith(prefix) && !path.split('/').some((segment) => excluded.includes(segment)),
    );
    return Promise.resolve(paths.map((path) => Uri.file(path)));
  },
  get textDocuments(): FakeDocument[] {
    return fake.textDocuments;
  },
  /** Returns the open document, or opens the file (without showing it). */
  openTextDocument(uri: Uri): Promise<FakeDocument> {
    const open = fake.textDocuments.find((document) => document.uri.toString() === uri.toString());
    if (open) return Promise.resolve(open);
    const text = fake.files.get(uri.path);
    if (text === undefined) return Promise.reject(new Error(`ENOENT ${uri.path}`));
    const document = new FakeDocument(uri, text);
    fake.textDocuments.push(document);
    return Promise.resolve(document);
  },
  /** Applies the replacements to the open documents, which become dirty. Ranges refer to the text before the edit. */
  async applyEdit(edit: WorkspaceEdit, metadata?: { isRefactoring?: boolean }): Promise<boolean> {
    fake.appliedEdits.push({ edit, metadata });
    if (!fake.applyEditSucceeds) return false;
    const byUri = new Map<string, { uri: Uri; range: Range; newText: string }[]>();
    for (const replacement of edit.replacements) {
      const key = replacement.uri.toString();
      byUri.set(key, [...(byUri.get(key) ?? []), replacement]);
    }
    for (const replacements of byUri.values()) {
      const document = await workspace.openTextDocument(replacements[0].uri);
      let text = document.getText();
      const spans = replacements
        .map(({ range, newText }) => ({ start: document.offsetAt(range.start), end: document.offsetAt(range.end), newText }))
        .sort((a, b) => b.start - a.start);
      for (const { start, end, newText } of spans) text = text.slice(0, start) + newText + text.slice(end);
      document.edit(text);
    }
    return true;
  },
  onDidRenameFiles(listener: (event: { files: readonly { oldUri: Uri; newUri: Uri }[] }) => void): { dispose(): void } {
    return fake.renames.event(listener);
  },
  getWorkspaceFolder(uri: Uri): { uri: Uri } | undefined {
    const root = fake.folders.find((folder) => uri.path === folder || uri.path.startsWith(`${folder}/`));
    return root === undefined ? undefined : { uri: Uri.file(root) };
  },
  getConfiguration(_section: string, scope?: Uri) {
    const root = scope && workspace.getWorkspaceFolder(scope)?.uri.path;
    const folder = root === undefined ? undefined : fake.folderSettings.get(root);
    return {
      get<T>(key: string, defaultValue: T): T {
        if (folder?.has(key)) return folder.get(key) as T;
        return fake.settings.has(key) ? (fake.settings.get(key) as T) : defaultValue;
      },
    };
  },
};

export const window = {
  showWarningMessage(message: string, ...items: string[]): Promise<string | undefined> {
    return answer('warning', message, items);
  },
  showInformationMessage(message: string, ...items: string[]): Promise<string | undefined> {
    return answer('info', message, items);
  },
  withProgress<T>(
    options: { title?: string },
    task: (progress: { report(value: unknown): void }, token: CancellationTokenSource['token']) => Promise<T>,
  ): Promise<T> {
    fake.progress.push(options.title ?? '');
    fake.onProgress?.();
    return task({ report() {} }, new CancellationTokenSource().token);
  },
  showTextDocument(uri: Uri): Promise<void> {
    fake.shown.push(uri.path);
    return Promise.resolve();
  },
};

function answer(kind: FakeMessage['kind'], message: string, items: string[]): Promise<string | undefined> {
  fake.messages.push({ kind, message, items });
  return Promise.resolve(fake.answers.shift());
}
