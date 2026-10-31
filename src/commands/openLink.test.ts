import { beforeEach, describe, expect, it } from 'vitest';
import { LinkService } from '../linkService';
import { fake } from '../test/fakeVscode';
import { openLink } from './openLink';

beforeEach(() => {
  fake.reset();
  fake.folders = ['/ws'];
});

describe('openLink, bare file names', () => {
  it('opens the only file of that name', async () => {
    fake.files.set('/ws/docs/user_guide/USER_GUIDE.md', '# Guide\n');
    await openLink(new LinkService(), { source: 'file:///ws/src/app.ts', path: 'USER_GUIDE.md' });
    expect(fake.textDocuments.map(({ uri }) => uri.path)).toEqual(['/ws/docs/user_guide/USER_GUIDE.md']);
    expect(fake.shown).toHaveLength(1);
    expect(fake.messages).toEqual([]);
  });

  it('warns and opens nothing when several files have the name', async () => {
    fake.files.set('/ws/docs/a/NOTES.md', '');
    fake.files.set('/ws/docs/b/NOTES.md', '');
    await openLink(new LinkService(), { source: 'file:///ws/src/app.ts', path: 'NOTES.md', fragment: 'x' });
    expect(fake.shown).toEqual([]);
    expect(fake.messages.map(({ kind, message }) => [kind, message])).toEqual([
      [
        'warning',
        "AutoLink: 'NOTES.md' is not unique: 2 files have that name (docs/a/NOTES.md, docs/b/NOTES.md). Write its path instead.",
      ],
    ]);
  });
});
