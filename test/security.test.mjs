// Folio security test: the workspace boundary holds against links, hidden files, the workspace folder itself and traversal.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createNotes, NotesError } from '../src/main/notes.js';
import { mayUse } from '../src/main/permissions.js';
import { isPrivateAddress, assertPublicHost } from '../src/main/netguard.js';
import { mayOpenWithSystem } from '../src/main/open-guard.js';

let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-sec-'));
const ws = path.join(tmp, 'ws'), outside = path.join(tmp, 'outside');
fs.mkdirSync(path.join(ws, 'docs'), { recursive: true }); fs.mkdirSync(path.join(ws, '.git'), { recursive: true }); fs.mkdirSync(outside);
fs.writeFileSync(path.join(ws, 'docs', 'a.md'), '# a'); fs.writeFileSync(path.join(ws, '.git', 'config'), 'token'); fs.writeFileSync(path.join(ws, '.env'), 'SECRET=1');
fs.writeFileSync(path.join(outside, 'secret.md'), 'top secret'); fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret');
const notes = createNotes(() => ws);
const throws = (fn, what) => assert.throws(fn, NotesError, what);

console.log('\nworkspace boundary');
assert.equal(notes.resolve('docs/a.md'), path.join(ws, 'docs', 'a.md')); ok('a normal note resolves');
throws(() => notes.resolve('../outside/secret.md'), 'dot-dot'); ok('.. traversal is refused');
assert.equal(notes.resolve('/docs/a.md'), path.join(ws, 'docs', 'a.md')); ok('a leading slash stays inside the workspace');
throws(() => notes.resolve('.git/config'), 'git'); throws(() => notes.resolve('.env'), 'env'); throws(() => notes.resolve('docs/.hidden/x.md'), 'nested'); ok('hidden files and folders are refused');
fs.mkdirSync(path.join(ws, 'docs', '.asset', '.trash'), { recursive: true }); fs.writeFileSync(path.join(ws, 'docs', '.asset', 'aaaaaaaa-x.png'), 'png');
throws(() => notes.resolve('docs/.asset/aaaaaaaa-x.png'), 'asset by default'); ok('.asset is hidden unless the caller asks for it');
assert.equal(notes.resolve('docs/.asset/aaaaaaaa-x.png', { allowAsset: true }), path.join(ws, 'docs', '.asset', 'aaaaaaaa-x.png')); ok('allowAsset reaches a file in a .asset folder');
for (const bad of ['docs/.asset/.trash/x', '.git/config', '.env', 'docs/.hidden/.asset/x', 'docs/.asset/.env', '../outside/secret.md']) throws(() => notes.resolve(bad, { allowAsset: true }), bad);
ok('allowAsset opens nothing else: trash, .git, .env, other hidden folders and traversal stay refused');
try { fs.symlinkSync(outside, path.join(ws, 'docs2-link')); fs.mkdirSync(path.join(ws, 'docs2')); fs.symlinkSync(outside, path.join(ws, 'docs2', '.asset')); fs.writeFileSync(path.join(outside, 'p.png'), 'x'); throws(() => notes.resolve('docs2/.asset/p.png', { allowAsset: true }), 'linked .asset'); ok('a .asset folder that is a link out of the workspace is refused'); } catch (e) { if (e.code !== 'EPERM') throw e; }
throws(() => notes.resolve('.', { notRoot: true })); throws(() => notes.resolve('docs/..', { notRoot: true })); ok('the workspace folder itself is refused for changes');
assert.equal(notes.resolve('.'), ws); ok('but it can still be named for listing');
await assert.rejects(notes.move('.', 'moved'), NotesError); ok('the workspace folder cannot be moved');

let links = true;
try { fs.symlinkSync(outside, path.join(ws, 'out-dir')); fs.symlinkSync(path.join(outside, 'secret.md'), path.join(ws, 'out-file.md')); fs.symlinkSync(path.join(outside, 'nope.md'), path.join(ws, 'dangling.md')); fs.symlinkSync(path.join(ws, 'docs'), path.join(ws, 'in-dir')); fs.symlinkSync(path.join(ws, '.git'), path.join(ws, 'public')); fs.symlinkSync(path.join(ws, '.env'), path.join(ws, 'env-link.md')); fs.symlinkSync(path.join(outside, 'secret.md'), path.join(ws, 'docs', 'peek.md')); }
catch (e) { links = false; console.log('  (links unavailable here, skipped:', e.code + ')'); }
if (links) {
  throws(() => notes.resolve('out-dir/secret.md'), 'dir link'); ok('a folder link that leaves the workspace is refused');
  throws(() => notes.resolve('out-file.md'), 'file link'); ok('a file link that leaves the workspace is refused');
  throws(() => notes.resolve('out-dir/new.md', { mustBeNote: true }), 'new through link'); ok('creating a note through such a link is refused');
  throws(() => notes.resolve('dangling.md', { mustBeNote: true }), 'dangling'); ok('a broken link cannot be written through');
  await assert.rejects(notes.read('out-dir/secret.md'), NotesError); await assert.rejects(notes.write('out-dir/x.md', 'x'), NotesError);
  await assert.rejects(notes.append('dangling.md', 'x'), NotesError); ok('read, write and append all stop at the link');
  assert.equal(await notes.read('in-dir/a.md'), '# a'); ok('a link that stays inside the workspace still works');
  throws(() => notes.resolve('public/config'), 'visible link to .git'); throws(() => notes.resolve('env-link.md'), 'visible link to .env'); ok('a visible link to a hidden folder or file does not unlock it');
  const hits = await notes.search('secret'); assert.equal(hits.length, 0, JSON.stringify(hits)); ok('search does not read through a link that leaves the workspace');
  assert(!(await notes.list()).some((f) => f.path.endsWith('peek.md') || f.path === 'out-file.md')); assert(!JSON.stringify(await notes.tree()).includes('peek.md')); ok('such links are not listed either');
  assert(!fs.existsSync(path.join(outside, 'x.md')) && !fs.existsSync(path.join(outside, 'nope.md'))); ok('nothing was written outside');
}

console.log('\ncontain (absolute paths, such as file: URLs in a note)');
assert.equal(notes.contain(path.join(ws, 'docs', 'a.md')), path.join(ws, 'docs', 'a.md')); ok('a file in the workspace is allowed');
throws(() => notes.contain(path.join(outside, 'secret.md'))); throws(() => notes.contain('/etc/passwd')); throws(() => notes.contain(path.join(ws, '..', 'outside', 'secret.md'))); ok('a file elsewhere is refused');
throws(() => notes.contain(path.join(ws, '.env'))); ok('a hidden file inside is refused');

console.log('\npermissions');
assert(mayUse('media', true, ['audio'])); ok('the app page may record audio');
assert(!mayUse('media', true, [])); assert(!mayUse('media', true, ['unknown'])); ok('an unclear media request is refused'); assert(!mayUse('media', true, ['video'])); assert(!mayUse('media', true, ['audio', 'video'])); ok('the camera is never allowed');
for (const p of ['geolocation', 'notifications', 'clipboard-read', 'midi', 'openExternal', 'fullscreen']) assert(!mayUse(p, true, [])); ok('nothing else is allowed');
assert(!mayUse('media', false, ['audio'])); ok('no other page or window gets the microphone');

console.log('\nprivate addresses');
for (const a of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '172.31.255.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', '[::1]', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) assert(isPrivateAddress(a), a); ok('loopback, private, link-local and mapped addresses are private');
for (const a of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.0.1', '2606:4700:4700::1111']) assert(!isPrivateAddress(a), a); ok('public addresses are not');
await assert.rejects(assertPublicHost('localhost'), /private/); await assert.rejects(assertPublicHost('printer.local'), /private/); await assert.rejects(assertPublicHost('10.0.0.1'), /private/); ok('names and literals for the local network are refused');
await assert.rejects(assertPublicHost('looks-public.example', async () => [{ address: '203.0.113.9' }, { address: '127.0.0.1' }]), /private/); ok('a public-looking name that resolves to a private address is refused');
await assert.doesNotReject(assertPublicHost('cdn.example', async () => [{ address: '203.0.113.9' }])); ok('a name that resolves to public addresses is allowed');

console.log('\nopening attached files');
for (const f of ['report.pdf', 'a/b/photo.PNG', 'notes.docx', 'clip.mp4', 'v1.2.bin.pdf']) assert.equal(mayOpenWithSystem(f), true, f); ok('documents and media may be opened');
for (const f of ['setup.exe', 'run.BAT', 'x.cmd', 'a.ps1', 'link.lnk', 'Tool.app', 'go.command', 'x.sh', 'a.AppImage', 'a.desktop', 'x.jar', 'pic.png.exe', 'setup.exe .', 'setup.exe...', 'noext', '.hidden', 'x.url', 'x.hta', 'x.msi', 'a.xll', 'a.docm', 'a.xlsm', 'a.zip', 'a.svg.exe']) assert.equal(mayOpenWithSystem(f), false, f);
ok('anything not on the document and media list (programs, scripts, shortcuts, installers, macro files, unknown types, no extension) is refused (also with a trailing dot or space)');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} security checks passed`);
