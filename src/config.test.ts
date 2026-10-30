import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeRenameMode, readConfig } from './config';
import { fake } from './test/fakeVscode';

beforeEach(() => {
  fake.reset();
});

describe('normalizeRenameMode', () => {
  it.each(['prompt', 'always', 'never'] as const)('keeps %s', (mode) => {
    expect(normalizeRenameMode(mode)).toBe(mode);
  });

  it.each([undefined, null, '', 'Always', ' never', 'yes', true, 1, {}])('treats %j as prompt', (value) => {
    expect(normalizeRenameMode(value)).toBe('prompt');
  });
});

describe('readConfig', () => {
  it('defaults updateLinksOnRename to prompt', () => {
    expect(readConfig().updateLinksOnRename).toBe('prompt');
  });

  it('reads updateLinksOnRename', () => {
    fake.settings.set('updateLinksOnRename', 'never');
    expect(readConfig().updateLinksOnRename).toBe('never');
  });

  it('falls back to prompt for an invalid updateLinksOnRename', () => {
    fake.settings.set('updateLinksOnRename', 'sometimes');
    expect(readConfig().updateLinksOnRename).toBe('prompt');
  });
});
