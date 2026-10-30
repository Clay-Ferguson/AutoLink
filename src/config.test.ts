import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_EXCLUDE_PATTERNS, normalizeRenameMode, readConfig } from './config';
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

describe('DEFAULT_EXCLUDE_PATTERNS', () => {
  it('matches the default in package.json', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      contributes: { configuration: { properties: Record<string, { default: unknown }> } };
    };
    expect(manifest.contributes.configuration.properties['autolink.excludePatterns'].default).toEqual(DEFAULT_EXCLUDE_PATTERNS);
  });
});
