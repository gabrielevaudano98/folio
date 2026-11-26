import * as esbuild from 'esbuild';
await esbuild.build({ entryPoints: [process.argv[2]], bundle: true, platform: 'node', format: 'esm', outdir: 'dist/test', outExtension: { '.js': '.mjs' }, logLevel: 'error', loader: { '.md': 'text' }, external: ['esbuild'], banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
