import * as esbuild from 'esbuild';
import fs from 'node:fs';
const watch = process.argv.includes('--watch');
fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist/renderer', { recursive: true });
fs.copyFileSync('src/renderer/index.html', 'dist/renderer/index.html');
fs.copyFileSync('src/main/preload.cjs', 'dist/preload.cjs');
fs.copyFileSync('src/renderer/meeting-worklet.js', 'dist/renderer/meeting-worklet.js');
fs.copyFileSync('node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm', 'dist/quickjs.wasm'); // Folio Sheets' script sandbox
const common = { bundle: true, minify: !watch && !process.env.FOLIO_NOMINIFY, sourcemap: watch, logLevel: 'info', legalComments: 'none' };
const banner = { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" };
await Promise.all([
  esbuild.build({ ...common, entryPoints: ['src/main/boot.js'], outfile: 'dist/main.mjs', platform: 'node', format: 'esm', target: 'node22', external: ['electron', 'fsevents'], banner, loader: { '.md': 'text' } }),
  esbuild.build({ ...common, entryPoints: ['src/main/meeting/asr-worker.js'], outfile: 'dist/meeting-asr.cjs', platform: 'node', format: 'cjs', target: 'node22' }),
  esbuild.build({ ...common, entryPoints: ['src/sheets/engine/worker.js'], outfile: 'dist/sheets-engine.cjs', platform: 'node', format: 'cjs', target: 'node22', loader: { '.md': 'text' }, define: { 'import.meta.url': '__importMetaUrl' }, banner: { js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" } }),
  esbuild.build({ ...common, entryPoints: { 'sheets-formula-worker': 'src/sheets/ui/formula-worker.js' }, outdir: 'dist/renderer', platform: 'browser', format: 'iife', target: 'chrome130' }), // Folio Sheets' formula engine off the window's thread
  esbuild.build({ ...common, entryPoints: { 'sheets-univer': 'src/sheets/ui/sheets.css' }, outdir: 'dist/renderer', loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.svg': 'dataurl', '.png': 'dataurl', '.gif': 'dataurl' }, assetNames: 'fonts/[name]-[hash]', legalComments: 'inline' }),
  esbuild.build({ ...common, entryPoints: ['src/sheets/cli.js'], outfile: 'dist/folio-sheets.mjs', platform: 'node', format: 'esm', target: 'node22', banner, external: ['puppeteer-core'], loader: { '.md': 'text' } }),
  esbuild.build({ ...common, entryPoints: ['src/mcp/stdio.js'], outfile: 'dist/mcp-stdio.mjs', platform: 'node', format: 'esm', target: 'node22', banner, loader: { '.md': 'text' } }),
  esbuild.build({ ...common, entryPoints: ['src/renderer/app.js'], outdir: 'dist/renderer', platform: 'browser', format: 'esm', splitting: true, target: 'chrome130', loader: { '.css': 'text', '.md': 'text' }, chunkNames: 'chunks/[name]-[hash]' }),
  esbuild.build({ ...common, entryPoints: { app: 'src/renderer/styles.css' }, outdir: 'dist/renderer', loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' }, assetNames: 'fonts/[name]-[hash]', legalComments: 'inline' }),
]);
