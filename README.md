# AutoLink

AutoLink is a **VSCode Extension** that checks and maintains links to markdown
files across a whole project. AutoLink allows you to click links
that exist in source code comments for any kind of source code, to open the linked 
files (i.e. basic hyperlink type functionality). This makes it a better UX for 
having specific documentation/spec content be linked to by the code that implements
it.

AutoLink has three main uses, and each works without the others:

- **Make doc references in source code clickable.** Write a path to a `.md`
  file, optionally followed by a `#heading-anchor`, in parentheses anywhere in
  a source file:
- **Find broken links in a project's markdown docs.** **Check Project Links**
  reads every text file in the workspace folder, markdown files included, and
  reports each link to a `.md` file or heading that doesn't exist. A link from
  `README.md` to `docs/guide.md#install` is checked just like a link in code.
  This is worth having even if you never put a link in a source file. See
  [Checking a project's markdown files](#checking-a-projects-markdown-files).
- **Repair links when files and folders move.** When you rename or move a
  file or folder in VS Code, AutoLink finds every link the move broke, in
  markdown docs and source files alike, and offers to rewrite them to the new
  location: one click on **Fix Links**, and one Ctrl+Z (Cmd+Z) to undo it. Set
  [`autolink.updateLinksOnRename`](#settings) to `always` to have this happen
  without asking. Moves made outside VS Code, such as `git mv`, aren't seen;
  **Check Project Links** finds the links they broke.


  ```ts
  // See: (docs/user_guide/USER_GUIDE.md#tab-bar)
  ```

  Ctrl+click (Cmd+click on macOS) opens `USER_GUIDE.md` in the editor and
  scrolls the "Tab Bar" heading to the top.

## Checking a project's markdown files

1. Run **AutoLink: Check Project Links** from the Command Palette, or
   right-click in the Explorer and choose **AutoLink › Check Project Links**.
   To check only part of the project, right-click a folder and choose
   **AutoLink › Check Folder Links**.
2. Open `AUTOLINK_ANALYSIS.md` in the workspace folder root. It lists every
   broken link with its file, line and column and whether the file or only the
   heading is missing, then every link in each file, and each linked markdown
   file with the places that link to it.

The check covers links whose target is a `.md` file, with or without a
`#heading` anchor, wherever they're written. Links to images or other file
types, URLs, and anchor-only links within the same file (`(#install)`) aren't
checked.

To see broken-link warnings in your markdown files while you edit them, not
only in the report, add `md` to
[`autolink.fileExtensions`](#settings), whose default lists only source file
extensions:

```json
"autolink.fileExtensions": ["md", "ts", "tsx", "js"]
```

Links in markdown files are updated after a rename or move whatever that
setting says.

## Features

- **Links anywhere.** References are found in line comments, block comments,
  JSDoc, Python docstrings and string literals. The syntax is the target half
  of a markdown link: a relative path ending in `.md`, in parentheses. A full
  markdown link such as `[the guide](docs/guide.md)` works too, but the
  `[name]` part is optional.
- **Heading anchors.** `#tab-bar` matches a heading by its GitHub-style anchor
  (lower-case, punctuation dropped, spaces turned into hyphens; repeated
  headings get `-1`, `-2`, …), so the same links work when the docs are viewed
  on GitHub.
- **Path resolution.** A path is tried relative to the source file's folder
  first, then relative to the workspace folder root. Paths that would leave the
  workspace folder are ignored.
- **Broken-link warnings.** A reference whose file or heading can't be found
  gets a warning squiggle and appears in the Problems panel. Warnings update as
  you edit, save, create or delete markdown files.
- **Check a folder or the whole project.** Right-click in the Explorer and
  open the **AutoLink** submenu. **Check Folder Links** (on folders) checks
  everything under that folder; **Check Project Links** checks the whole
  workspace folder that holds the clicked item, and is also in the Command
  Palette as **AutoLink: Check Project Links**. AutoLink reads every text file
  in scope (markdown files included, binary files skipped, and anything
  excluded by `autolink.excludePatterns`, `files.exclude` or `search.exclude`
  left out), checks each reference, and writes `AUTOLINK_ANALYSIS.md` to the
  workspace folder root, replacing any earlier report. The report lists the broken links, the
  links in each file, and each linked markdown file with the places that link
  to it.
- **Links follow renames.** When you rename or move a file or folder in VS Code
  (F2, drag and drop in the Explorer, refactorings), AutoLink finds the
  references that the move broke, in the whole workspace folder, and asks
  whether to update them: **Fix Links** rewrites them, **Show** lists them in
  `AUTOLINK_ANALYSIS.md` first. This covers references to a moved markdown
  file and a moved file's own relative references. Updated references keep
  their style (relative to the source file or to the workspace folder root,
  with a leading `./` kept), and a new path with spaces is put in `<…>`. Files
  without unsaved changes are saved after the update; one Ctrl+Z (Cmd+Z)
  undoes it. References that were broken before the move are left alone.
  Renames made outside VS Code, such as `git mv` or `mv` in a terminal, aren't
  seen; run **Check Project Links** after those.

## Reference syntax

The path must sit directly inside parentheses, with no spaces between them and
the path. Requiring the parentheses keeps ordinary mentions of a file name,
such as `README.md` in a log message, from turning into links. As in a
markdown link, the path may be wrapped in `<…>`, which allows spaces in it, and
may be followed by a quoted title, which AutoLink ignores. Only the path and
anchor are underlined, not the brackets or the title.

| Written in the source                   | Opens                                          |
| --------------------------------------- | ---------------------------------------------- |
| `(docs/guide.md)`                       | `docs/guide.md` at the top                      |
| `(docs/guide.md#install)`               | `docs/guide.md` at the heading "Install"        |
| `[Install](docs/guide.md#install)`      | the same; the `[name]` part is optional         |
| `(./notes.md)`, `(../../docs/guide.md)` | the file, relative to the source file's folder  |
| `(<docs/My Notes/todo.md>)`             | a path with spaces, in angle brackets           |
| `(docs/guide.md "Title")`               | the file; a `"…"` or `'…'` title is ignored     |

Not treated as references: a path without parentheses (`docs/guide.md`), URLs
(`(https://…/guide.md)`, which VS Code already links), absolute paths, paths
with spaces outside angle brackets, URL-encoded paths (`My%20Notes/todo.md`),
and other extensions such as `.mdx`.

## Settings

To open the Settings editor, press **Ctrl+,** (**Cmd+,** on macOS), or choose
**File › Preferences › Settings** (**Code › Settings… › Settings** on macOS).
Type `autolink` in the search box at the top to list only AutoLink's settings.
The **User** tab changes them for every project, and the **Workspace** tab only
for the open one. To edit the JSON directly instead, run **Preferences: Open
User Settings (JSON)** from the Command Palette (**Ctrl+Shift+P**, or
**Cmd+Shift+P** on macOS).

| Setting                        | Default               | Description                                                                                                           |
| ------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `autolink.fileExtensions`      | `["ts", "tsx", "js"]` | Extensions of the source files that get links. Add `py`, `go`, … as needed.                                           |
| `autolink.warnOnBrokenLinks`   | `true`                | Show warnings for references whose file or heading is missing.                                                        |
| `autolink.updateLinksOnRename` | `"prompt"`            | After a rename or move breaks references: `prompt` asks, `always` updates them without asking, `never` doesn't check. |
| `autolink.excludePatterns`     | see below             | Files and folders AutoLink ignores in this project, as wildcard patterns such as `test/*`. See below.                 |

Changes apply immediately, without reloading the window. In the Settings
editor, `fileExtensions` and `excludePatterns` show as lists with an **Add
Item** button.

### Excluding files and folders

`autolink.excludePatterns` lists files and folders AutoLink leaves alone: their
references get no links or warnings, **Check Folder Links** and **Check
Project Links** skip them, and renames don't update them. References from
other files to markdown files inside them still work.

The default lists the version control, dependency, cache and build output
folders of web and Python projects, so these are left alone everywhere:

```json
[
  ".git", ".hg", ".svn",
  "node_modules", "bower_components", ".next", ".nuxt", ".svelte-kit", ".angular",
  ".turbo", ".parcel-cache", ".cache", ".vscode-test", "dist", "out", "build", "coverage",
  "__pycache__", ".venv", "venv", ".tox", ".nox", ".mypy_cache", ".pytest_cache",
  ".ruff_cache", ".ipynb_checkpoints", "*.egg-info"
]
```

A list you set replaces the default rather than adding to it, so copy the
entries you still want into it; `[]` turns the default off.

Since every project has its own folders, set this per project: in the
Settings editor, switch to the **Workspace** tab before adding patterns, so
they are saved in the project's `.vscode/settings.json` (commit it to share
them). In a multi-root workspace, each folder can have its own list on the
**Folder** tab, and patterns are relative to that folder. A list in your user
settings applies only to projects that set none of their own.

```json
// .vscode/settings.json
{
  "autolink.excludePatterns": [".git", "node_modules", "dist", "test/*", "fixtures", "*.generated.ts"]
}
```

Patterns are simple wildcards, not regular expressions, with the same rules as
`.gitignore`:

| Pattern            | Excludes                                                        |
| ------------------ | --------------------------------------------------------------- |
| `test/*`, `test`   | everything under the `test` folder at the workspace folder root |
| `src/*.ts`         | `.ts` files directly in `src`                                   |
| `src/**/*.test.ts` | `.test.ts` files anywhere under `src`                           |
| `fixtures`         | any file or folder named `fixtures`, in any folder              |
| `*.generated.ts`   | files ending in `.generated.ts`, in any folder                  |
| `out/`             | folders named `out`, but not files                              |

`*` matches any characters except `/`, `?` matches one character, and `**`
matches any number of folders. A pattern containing a `/` is relative to the
root of the workspace folder; one without matches a name at any depth.
Matching a folder excludes everything inside it. Matching is case-sensitive.

## Tips

### Keeping example links out of the report

Code and docs often contain markdown links that are only examples, such as a
comment showing what a link to a heading looks like. If the file they name
doesn't exist, they are reported as broken links in `AUTOLINK_ANALYSIS.md`
when you run **Check Folder Links** or **Check Project Links**, and get a
warning squiggle in the editor.

To keep AutoLink from treating one as a reference, put a space on each side of
the path, inside the parentheses:

```md
[Heading]( docs/file.md#slug )
```

instead of:

```md
[Heading](docs/file.md#slug)
```

AutoLink only recognizes a path that starts right after the `(` (see
[Reference syntax](#reference-syntax)), so the padded form is ignored: no link,
no warning, and no entry in the report. Markdown allows spaces around a link
destination, so in a `.md` file the padded link still renders as a link.

To ignore every reference in a file or folder, such as test fixtures, use
[`autolink.excludePatterns`](#excluding-files-and-folders) instead.

## Development

Requires Node 22 (see `.nvmrc`). TypeScript and all other tools are installed
locally by `npm install`.

| Command             | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| `npm run build`     | Bundle `src/` into `dist/extension.js` with esbuild  |
| `npm run watch`     | Rebuild on every change                              |
| `npm run typecheck` | `tsc --noEmit`                                       |
| `npm run lint`      | ESLint with typescript-eslint                        |
| `npm test`          | vitest unit tests                                    |
| `npm run check`     | Typecheck, lint and test                             |
| `npm run package`   | Build a production `.vsix`                           |

Press **F5** in VS Code ("Run AutoLink") to build and open `test-workspace/` in
an Extension Development Host window with the extension loaded. The sample
files there have working, broken and ignored references to try.

`./build.sh` runs `npm run check`, builds the `.vsix` and then asks whether to install it into
VS Code. To install a packaged build by hand:

```bash
code --install-extension autolink-0.1.0.vsix
```

### Layout

```
src/
  extension.ts            wiring only
  config.ts               autolink.* settings
  scan/linkScanner.ts     finds references in text (pure)
  markdown/headings.ts    markdown headings and GitHub slugs (pure)
  resolve/paths.ts        candidate paths and containment (pure)
  resolve/excludePatterns.ts  autolink.excludePatterns wildcards (pure)
  linkService.ts          resolves references to files; caches results
  providers/linkProvider.ts   DocumentLinkProvider
  diagnostics.ts          broken-link warnings
  commands/openLink.ts    opens the file at the heading
  commands/checkLinks.ts  "Check Folder/Project Links": scans, writes the report
  analysis/linkAnalysis.ts  checks every reference under a folder
  analysis/types.ts       scan result data and the reverse index (pure)
  analysis/files.ts       exclude glob, binary test, line/column (pure)
  analysis/report.ts      formats AUTOLINK_ANALYSIS.md (pure)
  rename/renameMapping.ts maps paths across renames, rewrites references (pure)
  rename/renameCheck.ts   finds references broken by renames, applies fixes
  rename/renameWatcher.ts follows renames: prompt, report, fix
  test/fakeVscode.ts      stand-in for the vscode module in unit tests
```

The modules marked "pure" don't import `vscode` and hold most of the logic.
Tests sit next to the code they test (`*.test.ts`).
