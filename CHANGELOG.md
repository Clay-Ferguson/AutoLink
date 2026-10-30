# Changelog

## Unreleased

- **AutoLink** submenu on the Explorer context menu with **Check Folder Links** (folders only) and **Check Project Links** (also in the Command Palette; scans the workspace folder holding the clicked item). Each checks every markdown reference in the text files in scope and writes `AUTOLINK_ANALYSIS.md` (broken links, links per file, and which files link to each markdown file) to the workspace folder root.
- Links follow renames: renaming or moving a file or folder in VS Code finds the references it broke and offers to update them (**Fix Links**) or list them (**Show**). Updated references keep their style. New setting `autolink.updateLinksOnRename` (`prompt`, `always`, `never`).
- Broken-link warnings in open editors now update after a folder is renamed.
- New setting `autolink.excludePatterns`: a per-project list of wildcard patterns (`test/*`, `fixtures`, `*.generated.ts`) for files and folders AutoLink ignores, set in the workspace settings or per folder of a multi-root workspace. Excluded files get no links or warnings, are skipped by the link checks and are not updated after renames. The default lists the version control, dependency, cache and build output folders of web and Python projects (`.git`, `node_modules`, `dist`, `__pycache__`, `.venv`, …), which replaces the previously hard-coded `node_modules` and `.git` exclusion of the link checks.

## 0.1.0

- Ctrl/Cmd-clickable references to markdown files in parentheses (`(docs/guide.md#anchor)`) anywhere in source files.
- Markdown link destinations: the path may be in `<…>` (allowing spaces) and followed by a title, which is ignored.
- Opens the file in the editor and scrolls to the heading named by the anchor (GitHub-style slugs).
- Resolves paths relative to the source file, then the workspace folder root.
- Warnings for references whose file or heading is missing.
- Settings: `autolink.fileExtensions` (default `ts`, `tsx`, `js`) and `autolink.warnOnBrokenLinks`.
