// Bundles src/extension.ts into dist/extension.js (CommonJS, which the VS Code
// extension host loads). The `vscode` module is provided by VS Code at runtime.
//   node esbuild.mjs              development build with source map
//   node esbuild.mjs --watch      rebuild on change
//   node esbuild.mjs --production no source map (used by vscode:prepublish)

import * as fs from 'node:fs';
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const outfile = 'dist/extension.js';

// Don't leave a stale map from a dev build next to a production bundle.
if (production) fs.rmSync(`${outfile}.map`, { force: true });

const options = {
  entryPoints: ['src/extension.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  sourcemap: !production,
  minify: false,
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
