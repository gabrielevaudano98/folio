// Runs every Folio test. Format tests are bundled because the cores import CSS-free browser modules.
import * as esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
const run = (f) => execFileSync(process.execPath, [f], { stdio: 'inherit' });
await esbuild.build({ entryPoints: ['test/formats.test.mjs'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist/test/formats.test.mjs', logLevel: 'error', banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
run('dist/test/formats.test.mjs');
run('test/mcp.test.mjs');
if (process.env.FOLIO_SKIP_UI !== '1' && (process.platform !== 'linux' || process.env.DISPLAY)) run('test/canvas.test.mjs');
if (process.env.FOLIO_SKIP_UI !== '1' && (process.platform !== 'linux' || process.env.DISPLAY)) run('test/arrange.test.mjs');
if (process.env.FOLIO_SKIP_UI !== '1' && (process.platform !== 'linux' || process.env.DISPLAY)) run('test/text.test.mjs');
if (process.env.FOLIO_SKIP_UI !== '1' && (process.platform !== 'linux' || process.env.DISPLAY)) run('test/links.test.mjs');
if (process.env.FOLIO_SKIP_UI !== '1' && (process.platform !== 'linux' || process.env.DISPLAY)) run('test/sync.test.mjs');
if (process.env.FOLIO_SKIP_UI !== '1' && (process.platform !== 'linux' || process.env.DISPLAY)) run('test/smoke.test.mjs');
else console.log('\nui smoke skipped (no display; run under xvfb-run)');
