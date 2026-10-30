import { describe, expect, it } from 'vitest';
import { candidatePaths, extensionOf, isInside } from './paths';

describe('candidatePaths', () => {
  it('tries the document folder first, then the workspace root', () => {
    expect(candidatePaths('/ws/src/app', '/ws', 'docs/a.md')).toEqual(['/ws/src/app/docs/a.md', '/ws/docs/a.md']);
  });

  it('normalizes ./ and ../', () => {
    expect(candidatePaths('/ws/src', '/ws', '../docs/./a.md')).toEqual(['/ws/docs/a.md', '/docs/a.md']);
  });

  it('lists a path once when both bases give it', () => {
    expect(candidatePaths('/ws', '/ws', 'a.md')).toEqual(['/ws/a.md']);
  });

  it('uses only the document folder outside a workspace', () => {
    expect(candidatePaths('/tmp/x', undefined, 'a.md')).toEqual(['/tmp/x/a.md']);
  });
});

describe('isInside', () => {
  it('accepts the folder and paths below it', () => {
    expect(isInside('/ws', '/ws')).toBe(true);
    expect(isInside('/ws', '/ws/docs/a.md')).toBe(true);
    expect(isInside('/ws/', '/ws/a.md')).toBe(true);
  });

  it('rejects paths outside it, including sibling prefixes', () => {
    expect(isInside('/ws', '/etc/a.md')).toBe(false);
    expect(isInside('/ws', '/ws-other/a.md')).toBe(false);
  });
});

describe('extensionOf', () => {
  it('returns the lower-case extension without the dot', () => {
    expect(extensionOf('/a/b.TSX')).toBe('tsx');
    expect(extensionOf('/a/b.test.ts')).toBe('ts');
    expect(extensionOf('/a/Makefile')).toBe('');
  });
});
