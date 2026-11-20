// Folio security test, in the running app: what the renderer can and cannot ask of the main process.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { workspace, runApp, step, log, errors } from './harness.mjs';

const w = workspace('security', 47601);
const outside = path.join(w.tmp, 'outside'); fs.mkdirSync(outside);
fs.writeFileSync(path.join(outside, 'secret.png'), 'not really a picture'); fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
fs.writeFileSync(path.join(w.ws, 'pic.png'), PNG);
let links = true; try { fs.symlinkSync(outside, path.join(w.ws, 'out-dir')); } catch { links = false; }
const reject = (expr) => log(`(${expr}).then(()=>'ALLOWED',(e)=>String(e.message))`, 300);
const r = await runApp(w, [
  { size: [1300, 800], wait: 1200 },
  // a note names a file outside the open folder, a non-media file inside it, a picture inside it
  reject(`folio.dataUrl('file://${path.join(outside, 'secret.png')}', 'Roadmap.md')`),
  reject(`folio.dataUrl('file://${path.join(w.ws, 'Roadmap.md')}', 'Roadmap.md')`),
  log("folio.dataUrl('pic.png', 'Roadmap.md').then((d)=>d.slice(0,22))", 300),
  log(`folio.dataUrl('file://${path.join(w.ws, 'pic.png')}', 'Roadmap.md').then((d)=>d.slice(0,22))`, 300),
  reject("folio.dataUrl('http://127.0.0.1:1/x.png', 'Roadmap.md')"),
  // destructive calls on the workspace folder, opening a folder the person never picked, a link out of the folder
  reject("folio.trash('.')"), reject("folio.mkdir('.')"), reject("folio.rename('Journal', '.')"),
  reject("folio.openWorkspace('/tmp')"),
  links ? reject("folio.read('out-dir/secret.txt')") : log("'no links'"),
  // the window cannot be navigated away from the app page, so a file: page never gets the bridge
  step("location.assign('file:///etc/hostname')", 900), log("[location.href.includes('hostname'), typeof window.folio]"),
  // permissions: the microphone yes, location and camera no
  log("new Promise((r)=>navigator.geolocation.getCurrentPosition(()=>r('granted'),(e)=>r('code '+e.code)))", 1500),
  log("navigator.mediaDevices.getUserMedia({audio:true}).then((s)=>{s.getTracks().forEach((t)=>t.stop());return 'mic ok'},(e)=>e.name)", 1500),
  errors,
]); // no fake media here: the test's auto-accept switch would bypass the permission handler under test
if (process.env.DEBUG) console.log(JSON.stringify(r.js));
const [outsideFile, nonMedia, rel, abs, privateNet, trashRoot, mkdirRoot, renameRoot, openOther, linkOut, nav, geo, mic, errs] = r.js;
console.log('\nmain process boundary');
assert.match(outsideFile, /escapes the workspace/); console.log('  ✓ a note cannot pull in a file from outside the open folder');
assert.match(nonMedia, /Only images, audio, video and fonts/); console.log('  ✓ only media files can be embedded, not notes or keys');
assert.equal(rel, 'data:image/png;base64,'); assert.equal(abs, 'data:image/png;base64,'); console.log('  ✓ pictures inside the folder still embed');
assert.match(privateNet, /private network/); console.log('  ✓ a note cannot make the app fetch from the local network');
for (const [name, v] of Object.entries({ trashRoot, mkdirRoot, renameRoot })) assert.match(v, /workspace folder/, name); console.log('  ✓ the open folder itself cannot be trashed, replaced or moved');
assert.match(openOther, /Open Folder first/); console.log('  ✓ the renderer cannot switch to a folder the person never picked');
if (links) { assert.match(linkOut, /through a link/); console.log('  ✓ a link that leaves the folder cannot be read'); }
assert.deepEqual(nav, [false, 'object']); console.log('  ✓ the window stays on the app page when something tries to navigate it away');
assert.equal(geo, 'code 1'); assert(['mic ok', 'NotFoundError'].includes(mic), mic); /* allowed, though a test machine may have no microphone */ console.log('  ✓ the microphone is allowed for narration and location is denied (the camera rule is unit-tested in security.test.mjs)');
assert.deepEqual(errs, [], JSON.stringify(errs));
