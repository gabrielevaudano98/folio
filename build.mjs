import * as esbuild from 'esbuild';
import fs from 'node:fs';
const watch = process.argv.includes('--watch');
fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist/renderer', { recursive: true });
fs.copyFileSync('src/renderer/index.html', 'dist/renderer/index.html');
fs.copyFileSync('src/main/preload.cjs', 'dist/preload.cjs');
const common = { bundle: true, minify: !watch && !process.env.FOLIO_NOMINIFY, sourcemap: watch, logLevel: 'info', legalComments: 'none' };
const banner = { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" };
await Promise.all([
  esbuild.build({ ...common, entryPoints: ['src/main/boot.js'], outfile: 'dist/main.mjs', platform: 'node', format: 'esm', target: 'node22', external: ['electron', 'fsevents'], banner, loader: { '.md': 'text' } }),
  esbuild.build({ ...common, entryPoints: ['src/mcp/stdio.js'], outfile: 'dist/mcp-stdio.mjs', platform: 'node', format: 'esm', target: 'node22', banner, loader: { '.md': 'text' } }),
  esbuild.build({ ...common, entryPoints: ['src/renderer/app.js'], outdir: 'dist/renderer', platform: 'browser', format: 'esm', splitting: true, target: 'chrome130', loader: { '.css': 'text', '.md': 'text' }, chunkNames: 'chunks/[name]-[hash]' }),
  esbuild.build({ ...common, entryPoints: { app: 'src/renderer/styles.css' }, outdir: 'dist/renderer', loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' }, assetNames: 'fonts/[name]-[hash]', legalComments: 'inline' }),
]);
