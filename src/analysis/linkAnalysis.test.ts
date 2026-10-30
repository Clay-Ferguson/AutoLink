import type * as vscode from 'vscode';
import { beforeEach, describe, expect, it } from 'vitest';
import { LinkService } from '../linkService';
import { Uri, fake } from '../test/fakeVscode';
import { analyzeFolder, REPORT_FILE } from './linkAnalysis';

const asUri = (uri: Uri) => uri as unknown as vscode.Uri;
const analyze = (folder: string) => analyzeFolder(new LinkService(), asUri(Uri.file(folder)), asUri(Uri.file('/ws')));

beforeEach(() => {
  fake.reset();
  fake.folders = ['/ws'];
  fake.files.set('/ws/docs/guide.md', '# Guide\n\n## Tab Bar\n\nSee [the API](api.md).\n');
  fake.files.set('/ws/docs/api.md', '# API\n');
  fake.files.set('/ws/src/app.ts', 'const a = 1;\n  // (docs/guide.md#tab-bar) and (../docs/gone.md)\n');
  fake.files.set('/ws/src/plain.ts', 'no links here\n');
  fake.files.set('/ws/src/logo.png', '\u0089PNG\u0000(docs/guide.md)');
  fake.files.set('/ws/node_modules/pkg/readme.ts', '// (docs/guide.md)');
  fake.files.set(`/ws/${REPORT_FILE}`, '(docs/guide.md)');
});

describe('analyzeFolder', () => {
  it('records every link in the text files under the folder', async () => {
    const analysis = await analyze('/ws');
    expect(analysis).toMatchObject({ rootName: 'ws', folder: '', filesScanned: 4, filesSkipped: 1 });
    expect(analysis?.sources).toEqual([
      {
        path: 'docs/guide.md',
        links: [{ line: 5, column: 15, path: 'api.md', fragment: undefined, status: 'ok', target: 'docs/api.md' }],
      },
      {
        path: 'src/app.ts',
        links: [
          { line: 2, column: 7, path: 'docs/guide.md', fragment: 'tab-bar', status: 'ok', target: 'docs/guide.md' },
          { line: 2, column: 35, path: '../docs/gone.md', fragment: undefined, status: 'missingFile', target: undefined },
        ],
      },
    ]);
  });

  it('scans only the given folder, with paths relative to the root', async () => {
    const analysis = await analyze('/ws/src');
    expect(analysis?.folder).toBe('src');
    expect(analysis?.sources.map((source) => source.path)).toEqual(['src/app.ts']);
  });

  it('skips files excluded by excludePatterns', async () => {
    fake.settings.set('excludePatterns', ['src/*']);
    const analysis = await analyze('/ws');
    expect(analysis?.sources.map((source) => source.path)).toEqual(['docs/guide.md']);
    expect(analysis?.filesScanned).toBe(2);
  });

  it('reads excludePatterns from the workspace folder settings', async () => {
    fake.folderSettings.set('/ws', new Map([['excludePatterns', ['src/']]]));
    const analysis = await analyze('/ws');
    expect(analysis?.sources.map((source) => source.path)).toEqual(['docs/guide.md']);
  });

  it('stops when cancelled', async () => {
    const token = { isCancellationRequested: true } as vscode.CancellationToken;
    const analysis = await analyzeFolder(new LinkService(), asUri(Uri.file('/ws')), asUri(Uri.file('/ws')), token);
    expect(analysis).toBeUndefined();
  });
});
