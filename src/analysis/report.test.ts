import { describe, expect, it } from 'vitest';
import { formatRenameReport, formatReport } from './report';
import { indexTargets, type LinkAnalysis } from './types';

const analysis: LinkAnalysis = {
  rootName: 'AutoLink',
  folder: 'src',
  scannedAt: new Date(2026, 9, 29, 14, 3),
  filesScanned: 12,
  filesSkipped: 2,
  sources: [
    {
      path: 'src/a.ts',
      links: [
        { line: 3, column: 4, path: 'docs/guide.md', fragment: 'install', status: 'ok', target: 'docs/guide.md' },
        { line: 10, column: 4, path: 'docs/nope.md', status: 'missingFile' },
      ],
    },
    {
      path: 'src/nested/b.ts',
      links: [{ line: 7, column: 12, path: '../../docs/guide.md', fragment: 'gone', status: 'missingAnchor', target: 'docs/guide.md' }],
    },
  ],
};

describe('indexTargets', () => {
  it('groups resolved links by target file', () => {
    expect(indexTargets(analysis).map(({ path, inbound }) => [path, inbound.map(({ source }) => source)])).toEqual([
      ['docs/guide.md', ['src/a.ts', 'src/nested/b.ts']],
    ]);
  });
});

describe('formatReport', () => {
  it('lists broken links, links per file and linked files', () => {
    expect(formatReport(analysis)).toBe(
      [
        '# AutoLink Analysis',
        '',
        'Scanned folder `src/` of workspace `AutoLink` on 2026-10-29 14:03.',
        '',
        '- Text files scanned: 12 (2 binary, too large or unreadable files skipped)',
        '- Files with links: 2',
        '- Links: 3 (1 OK, 2 broken)',
        '',
        '## Broken links',
        '',
        '```text',
        'src/a.ts:10:4         MISSING FILE     docs/nope.md',
        'src/nested/b.ts:7:12  MISSING HEADING  ../../docs/guide.md#gone',
        '```',
        '',
        '## Files with links',
        '',
        '### `src/a.ts`',
        '',
        '```text',
        '3:4   OK            docs/guide.md#install',
        '10:4  MISSING FILE  docs/nope.md',
        '```',
        '',
        '### `src/nested/b.ts`',
        '',
        '```text',
        '7:12  MISSING HEADING  ../../docs/guide.md#gone  -> docs/guide.md',
        '```',
        '',
        '## Linked markdown files',
        '',
        '### `docs/guide.md`',
        '',
        '```text',
        'src/a.ts:3:4          OK               #install',
        'src/nested/b.ts:7:12  MISSING HEADING  #gone',
        '```',
        '',
      ].join('\n'),
    );
  });

  it('lists the renames and the links they broke', () => {
    const report = formatRenameReport(
      'AutoLink',
      [{ from: 'docs/old.md', to: 'docs/new.md' }],
      [
        { source: 'src/a.ts', line: 3, column: 4, text: 'docs/old.md#x', target: 'docs/new.md', replacement: 'docs/new.md#x' },
        { source: 'src/nested/b.ts', line: 7, column: 12, text: '../../docs/old.md', target: 'docs/a+b.md' },
      ],
      new Date(2026, 9, 29, 14, 3),
    );
    expect(report).toBe(
      [
        '# AutoLink Analysis',
        '',
        'Links broken by renaming or moving files in workspace `AutoLink` on 2026-10-29 14:03.',
        '',
        '## Renamed or moved',
        '',
        '```text',
        'docs/old.md  -> docs/new.md',
        '```',
        '',
        '## Broken links',
        '',
        '```text',
        'src/a.ts:3:4          docs/old.md#x      -> docs/new.md#x',
        'src/nested/b.ts:7:12  ../../docs/old.md  cannot update, the file is now docs/a+b.md',
        '```',
        '',
      ].join('\n'),
    );
  });

  it('aligns several renames and says None without broken links', () => {
    const report = formatRenameReport(
      'ws',
      [
        { from: 'docs', to: 'guides' },
        { from: 'src/a.ts', to: 'lib/deep/a.ts' },
      ],
      [],
      new Date(2026, 0, 2, 3, 4),
    );
    expect(report).toContain('on 2026-01-02 03:04.');
    expect(report).toContain('```text\ndocs      -> guides\nsrc/a.ts  -> lib/deep/a.ts\n```');
    expect(report).toMatch(/## Broken links\n\nNone\.\n$/);
  });

  it('says None for empty sections', () => {
    const report = formatReport({ ...analysis, folder: '', filesSkipped: 0, sources: [] });
    expect(report).toContain('Scanned workspace `AutoLink` on');
    expect(report).toContain('- Text files scanned: 12\n');
    expect(report.match(/^None\.$/gm)).toHaveLength(3);
  });
});

describe('formatReport, ambiguous file names', () => {
  it('labels the link and names the files it may mean', () => {
    const report = formatReport({
      ...analysis,
      sources: [
        { path: 'src/a.ts', links: [{ line: 1, column: 5, path: 'NOTES.md', status: 'ambiguousFile', matches: ['a/NOTES.md', 'b/NOTES.md'] }] },
      ],
    });
    expect(report).toContain('src/a.ts:1:5  AMBIGUOUS FILE  NOTES.md  matches a/NOTES.md, b/NOTES.md');
    expect(report).toContain('1:5  AMBIGUOUS FILE  NOTES.md  matches a/NOTES.md, b/NOTES.md');
    expect(report).toContain('- Links: 1 (0 OK, 1 broken)');
  });
});
