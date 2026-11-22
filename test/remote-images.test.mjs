// A note's web images must not load by themselves, and when the person asks they go through the main process's network guard.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { workspace, runApp, open, step, log, errors } from './harness.mjs';

// a 1×1 PNG, and a picture that sends more than 30 MB without saying how long it is
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const hits = new Map(); const hit = (k) => hits.get(k) || 0;
const server = http.createServer((q, s) => {
  const route = ['/pixel.png', '/big.png', '/edit.png'].includes(q.url) ? q.url : 'other';
  hits.set(route, hit(route) + 1);
  if (route === '/big.png') {
    s.writeHead(200, { 'content-type': 'image/png' }); // no content-length: chunked
    const chunk = Buffer.alloc(1024 * 1024); let sent = 0;
    const more = () => { while (sent < 31) { sent++; if (!s.write(chunk)) return s.once('drain', more); } s.end(); };
    s.on('error', () => {}); more(); return;
  }
  setTimeout(() => { s.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length }); s.end(PNG); }, 150); // slow enough for two requests to overlap
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const preview = step("document.querySelector('#view-switch [data-view=\"preview\"]').click()", 900);
const edit = step("document.querySelector('#view-switch [data-view=\"edit\"]').click()", 1500);
console.log('\nremote images');

// 1. nothing allowed: the page never calls out, and the main process refuses the local network
{
  const w = workspace('remote-images', 47602);
  fs.writeFileSync(path.join(w.ws, 'Remote.md'), `# Remote\n\n![tracker](${base}/pixel.png)\n\n![inline](DATA:image/png;base64,${PNG.toString('base64')})\n`);
  fs.writeFileSync(path.join(w.ws, 'Deck.slides.md'), `---\nmarp: true\ntheme: folio\n---\n\n# Picture\n\n![dot](data:image/png;base64,${PNG.toString('base64')})\n`);
  fs.writeFileSync(path.join(w.ws, 'Embed.md'), '# Embed\n\n![[Deck.slides#1]]\n');
  const r = await runApp(w, [
    { size: [1300, 800], wait: 1200 },
    open('Remote.md'), preview,
    log("[!!document.querySelector('#preview .remote-bar'), document.querySelector('#preview img')?.hasAttribute('src'), !!document.querySelector('#preview img.remote-blocked'), (document.querySelector('#preview img[alt=\"inline\"]')?.getAttribute('src') || '').slice(0, 5)]", 300),
    step("document.querySelector('#preview .remote-bar button').click()", 1500),
    log("[!!document.querySelector('#preview img.remote-blocked'), document.querySelector('#preview img')?.getAttribute('src')]", 300),
    open('Embed.md'), preview, { js: '1', wait: 800 },
    log("(document.querySelector('#preview .ref-embed img[data-src]')?.getAttribute('src') || '').slice(0, 15)", 300),
    open('Remote.md'), edit,
    log("[document.querySelectorAll('img[src^=\"http\"]').length, !!document.querySelector('.cm-live-img-missing, .rich-img-wrap img.remote-blocked')]", 300),
    errors,
  ]);
  const [before, after, embed, ed, errs] = r.js.slice(-5);
  assert.deepEqual(before, [true, false, true, 'data:']); console.log('  ✓ opening a note shows a notice and loads no web image; an embedded picture still shows, whatever the case of its scheme');
  assert.deepEqual(after, [true, null]); console.log('  ✓ choosing to load goes through the main process, which refuses the local network');
  assert.equal(embed, 'data:image/png;', 'a picture in a slide embedded in a page'); console.log('  ✓ a picture written into a slide shows when the slide is embedded in a page');
  assert.deepEqual(ed, [0, true]); console.log('  ✓ the editor view loads no web image either and shows a placeholder');
  assert.equal([...hits.values()].reduce((a, b) => a + b, 0), 0, `the page itself contacted the image server: ${JSON.stringify([...hits])}`); console.log('  ✓ the page never contacted the image server itself');
  assert.deepEqual(errs, [], JSON.stringify(errs));
}

// 2. allowed (the test server stands in for a public one): data: URLs from the main process, one download per address, a size limit that holds without a length
{
  const w = workspace('remote-images-ok', 47603);
  fs.writeFileSync(path.join(w.ws, 'Remote.md'), `# Remote\n\n![a](${base}/pixel.png)\n\n![b](${base}/pixel.png)\n\n![big](${base}/big.png)\n`);
  fs.writeFileSync(path.join(w.ws, 'Edit.md'), `# Edit\n\n![e](${base}/edit.png)\n`);
  const r = await runApp(w, [
    { size: [1300, 800], wait: 1200 },
    open('Remote.md'), preview,
    step("document.querySelector('#preview .remote-bar button').click()", 4000),
    log("[...document.querySelectorAll('#preview img')].map((i) => [(i.getAttribute('src') || '').slice(0, 15), i.classList.contains('remote-blocked')])", 300),
    open('Edit.md'), edit,
    log("[!!document.querySelector('#remote-edit-bar'), document.querySelector('.rich-img-wrap img')?.hasAttribute('src'), !document.querySelector('#remote-edit-bar')?.closest('.rich-main'), document.querySelector('#remote-edit-bar')?.nextElementSibling?.matches('.rich-main, .rich-scroll')]", 300),
    step("document.querySelector('#remote-edit-bar button').click()", 2000),
    log("[!!document.querySelector('#remote-edit-bar'), (document.querySelector('.rich-img-wrap img')?.getAttribute('src') || '').slice(0, 15)]", 300),
    errors,
  ], { FOLIO_TEST_LOOPBACK: '1' });
  const [imgs, editBefore, editAfter, errs] = r.js.slice(-4);
  assert.deepEqual(imgs, [['data:image/png;', false], ['data:image/png;', false], ['', true]], JSON.stringify(imgs)); console.log('  ✓ allowed images arrive as data: URLs; one that streams past 30 MB without a length is refused');
  assert.equal(hit('/pixel.png'), 1, JSON.stringify([...hits])); console.log('  ✓ the same address shown twice is downloaded once');
  assert.deepEqual(editBefore, [true, false, true, true]); console.log('  ✓ the visual editor shows the same notice above the editor column (not beside it) and holds the image back');
  assert.deepEqual(editAfter, [false, 'data:image/png;']); console.log('  ✓ allowing from the editor loads its images without reopening the note');
  assert.equal(hit('/edit.png'), 1, JSON.stringify([...hits]));
  assert.deepEqual(errs, [], JSON.stringify(errs));
}
server.close();
