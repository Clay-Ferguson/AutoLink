# AutoLink

AutoLink makes references to markdown files in your source code clickable.
Write a path to a `.md` file, optionally followed by a `#heading-anchor`, in
parentheses anywhere in a source file:

```ts
// See: (docs/user_guide/USER_GUIDE.md#tab-bar)
```

Ctrl+click (Cmd+click on macOS) opens `USER_GUIDE.md` in the editor and
scrolls the "Tab Bar" heading to the top.

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
  excluded by `autolink.excludePatterns`, `files.exclude`, `search.exclude`,
  `node_modules` or `.git` left out), checks each reference, and writes `AUTOLINK_ANALYSIS.md` to the
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
| `autolink.excludePatterns`     | `[]`                  | Files and folders AutoLink ignores in this project, as wildcard patterns such as `test/*`. See below.                 |

Changes apply immediately, without reloading the window. In the Settings
editor, `fileExtensions` and `excludePatterns` show as lists with an **Add
Item** button.

### Excluding files and folders

`autolink.excludePatterns` lists files and folders AutoLink leaves alone: their
references get no links or warnings, **Check Folder Links** and **Check
Project Links** skip them, and renames don't update them. References from
other files to markdown files inside them still work.

Since every project has its own folders, set this per project: in the
Settings editor, switch to the **Workspace** tab before adding patterns, so
they are saved in the project's `.vscode/settings.json` (commit it to share
them). In a multi-root workspace, each folder can have its own list on the
**Folder** tab, and patterns are relative to that folder. A list in your user
settings applies only to projects that set none of their own.

```json
// .vscode/settings.json
{
  "autolink.excludePatterns": ["test/*", "fixtures", "*.generated.ts", "out/"]
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
