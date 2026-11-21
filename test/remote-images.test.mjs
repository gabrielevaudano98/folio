// A note's web images must not load by themselves, and when the person asks they go through the main process's network guard.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { workspace, runApp, open, step, log, errors } from './harness.mjs';

let hits = 0;
const server = http.createServer((q, s) => { hits++; s.end('x'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const w = workspace('remote-images', 47602);
fs.writeFileSync(path.join(w.ws, 'Remote.md'), `# Remote\n\n![tracker](http://127.0.0.1:${server.address().port}/pixel.png)\n`);
const preview = step("document.querySelector('#view-switch [data-view=\"preview\"]').click()", 900);
const r = await runApp(w, [
  { size: [1300, 800], wait: 1200 },
  open('Remote.md'), preview,
  log("[!!document.querySelector('#preview .remote-bar'), document.querySelector('#preview img')?.hasAttribute('src'), !!document.querySelector('#preview img.remote-blocked')]", 300),
  step("document.querySelector('#preview .remote-bar button').click()", 1500),
  log("[!!document.querySelector('#preview img.remote-blocked'), document.querySelector('#preview img')?.getAttribute('src')]", 300),
  errors,
]);
server.close();
const [before, after, errs] = r.js.slice(-3);
console.log('\nremote images');
assert.deepEqual(before, [true, false, true]); console.log('  ✓ opening a note shows a notice and loads no web image');
assert.deepEqual(after, [true, null]); console.log('  ✓ choosing to load goes through the main process, which refuses the local network');
assert.equal(hits, 0, `the page itself requested the image ${hits} time(s)`); console.log('  ✓ the page never contacted the image server itself');
assert.deepEqual(errs, [], JSON.stringify(errs));
