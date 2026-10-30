/**
 * Helpers for the folder scan: which files to skip and where a reference sits.
 * Pure: no `vscode` import.
 */

/** Files larger than this are not read. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** How much of a file is searched for a NUL byte. */
const BINARY_SNIFF_BYTES = 8000;

/** Excluded whatever the settings say. */
const ALWAYS_EXCLUDED = ['**/node_modules', '**/.git'];

/**
 * Builds the exclude glob for `workspace.findFiles`. Passing any exclude
 * replaces the default `files.exclude`, so it is merged in here together with
 * `search.exclude`. Only entries set to `true` count; conditional entries
 * (`{ "when": … }`) are ignored.
 * @param settings - The `files.exclude` and `search.exclude` values.
 */
export function buildExcludeGlob(...settings: unknown[]): string {
  const patterns = new Set(ALWAYS_EXCLUDED);
  for (const setting of settings) {
    if (typeof setting !== 'object' || setting === null) continue;
    for (const [pattern, enabled] of Object.entries(setting)) {
      if (enabled === true && pattern.trim()) patterns.add(pattern.trim());
    }
  }
  return `{${[...patterns].join(',')}}`;
}

/**
 * Reports whether file content looks binary: a NUL byte near the start, the
 * same test git uses.
 * @param bytes - The file content.
 */
export function isBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/**
 * Returns the offset at which each line of the text starts.
 * @param text - The full text.
 */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

/**
 * Converts an offset into a 1-based line and column.
 * @param starts - The line starts from {@link lineStarts}.
 * @param offset - An offset into the same text.
 */
export function lineAndColumn(starts: number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, column: offset - starts[low] + 1 };
}
