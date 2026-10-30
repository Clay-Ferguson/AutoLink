/**
 * Formats a folder scan as the markdown text of `AUTOLINK_ANALYSIS.md`. The
 * paths are relative to different files, so they are shown as plain text in
 * code blocks rather than as markdown links. Pure: no `vscode` import.
 */

import type { LinkStatus } from '../linkService';
import { indexTargets, type LinkAnalysis, type LinkRecord } from './types';

const STATUS_LABELS: Record<LinkStatus, string> = {
  ok: 'OK',
  missingFile: 'MISSING FILE',
  missingAnchor: 'MISSING HEADING',
};

/**
 * Returns the report for a scan.
 * @param analysis - The scan result.
 */
export function formatReport(analysis: LinkAnalysis): string {
  const links = analysis.sources.flatMap((source) => source.links.map((link) => ({ source: source.path, link })));
  const broken = links.filter(({ link }) => link.status !== 'ok');
  const scanned = analysis.folder
    ? `Scanned folder \`${analysis.folder}/\` of workspace \`${analysis.rootName}\``
    : `Scanned workspace \`${analysis.rootName}\``;
  const out: string[] = [
    '# AutoLink Analysis',
    '',
    `${scanned} on ${formatDate(analysis.scannedAt)}.`,
    '',
    `- Text files scanned: ${analysis.filesScanned}` +
      (analysis.filesSkipped ? ` (${analysis.filesSkipped} binary, too large or unreadable files skipped)` : ''),
    `- Files with links: ${analysis.sources.length}`,
    `- Links: ${links.length} (${links.length - broken.length} OK, ${broken.length} broken)`,
    '',
    '## Broken links',
    '',
  ];

  if (broken.length === 0) out.push('None.', '');
  else {
    out.push(
      ...codeBlock(
        broken.map(({ source, link }) => [`${source}:${link.line}:${link.column}`, STATUS_LABELS[link.status], written(link)]),
      ),
    );
  }

  out.push('## Files with links', '');
  if (analysis.sources.length === 0) out.push('None.', '');
  for (const source of analysis.sources) {
    out.push(`### \`${source.path}\``, '');
    out.push(
      ...codeBlock(
        source.links.map((link) => [
          `${link.line}:${link.column}`,
          STATUS_LABELS[link.status],
          written(link),
          link.target !== undefined && link.target !== link.path ? `-> ${link.target}` : '',
        ]),
      ),
    );
  }

  out.push('## Linked markdown files', '');
  const targets = indexTargets(analysis);
  if (targets.length === 0) out.push('None.', '');
  for (const target of targets) {
    out.push(`### \`${target.path}\``, '');
    out.push(
      ...codeBlock(
        target.inbound.map(({ source, link }) => [
          `${source}:${link.line}:${link.column}`,
          STATUS_LABELS[link.status],
          link.fragment === undefined ? '' : `#${link.fragment}`,
        ]),
      ),
    );
  }
  return `${out.join('\n').trimEnd()}\n`;
}

/** A reference that renames broke, for {@link formatRenameReport}. */
export interface MovedLinkRecord {
  /** The file containing the reference. */
  source: string;
  line: number;
  column: number;
  /** The path and anchor as written. */
  text: string;
  /** The file the reference named, where it is now. */
  target: string;
  /** The text that names the target again; undefined when it can't be written. */
  replacement?: string;
}

/**
 * Returns the report on the references that renames broke. Paths are relative
 * to the workspace folder root.
 * @param rootName - Name of the workspace folder.
 * @param renames - The renamed files and folders.
 * @param links - The broken references, in order.
 * @param date - When the renames were checked.
 */
export function formatRenameReport(
  rootName: string,
  renames: readonly { from: string; to: string }[],
  links: readonly MovedLinkRecord[],
  date: Date,
): string {
  const out: string[] = [
    '# AutoLink Analysis',
    '',
    `Links broken by renaming or moving files in workspace \`${rootName}\` on ${formatDate(date)}.`,
    '',
    '## Renamed or moved',
    '',
    ...codeBlock(renames.map(({ from, to }) => [from, `-> ${to}`])),
    '## Broken links',
    '',
  ];
  if (links.length === 0) out.push('None.', '');
  else {
    out.push(
      ...codeBlock(
        links.map((link) => [
          `${link.source}:${link.line}:${link.column}`,
          link.text,
          link.replacement === undefined ? `cannot update, the file is now ${link.target}` : `-> ${link.replacement}`,
        ]),
      ),
    );
  }
  return `${out.join('\n').trimEnd()}\n`;
}

/** The reference as written: path and anchor. */
function written(link: LinkRecord): string {
  return link.fragment === undefined ? link.path : `${link.path}#${link.fragment}`;
}

/**
 * Returns a fenced code block with the rows as aligned columns, followed by a
 * blank line.
 * @param rows - The cells of each row; every row has the same number of cells.
 */
function codeBlock(rows: string[][]): string[] {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  const lines = rows.map((row) =>
    row
      .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column])))
      .join('  ')
      .trimEnd(),
  );
  return ['```text', ...lines, '```', ''];
}

/** Formats a date as local `YYYY-MM-DD HH:MM`. */
function formatDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
