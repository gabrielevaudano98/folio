// Folio — optional features: catalog, archive reading, the installer (against a local server), meeting transcript and notes checks.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import crypto from 'node:crypto'; import zlib from 'node:zlib';
import JSZip from 'jszip';
import { COMPONENTS, FEATURES, validateCatalog, keepLlamaFile, featureSupported, downloadBytes } from '../src/main/features/catalog.js';
import { parseTgz, parseZip, selectFiles, safeRel } from '../src/main/features/unpack.js';
import { createInstaller } from '../src/main/features/installer.js';
import { dropEcho, lines, renderMeeting, fileName, clock, overlap, dedupeSentences } from '../src/main/meeting/transcript.js';
import { verify, chunk, merge, quoteOnLine, readsLikeDecision, readsLikeQuestion } from '../src/main/meeting/notes-core.js';
import { componentsRoot, createFeatures } from '../src/main/meeting/service.js';

let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('  ok', name); };
console.log('\nfeatures');

/* ---------- catalog ---------- */
await t('catalog has no mistakes', () => assert.deepEqual(validateCatalog(), []));
await t('catalog catches a bad entry', () => {
  const bad = { x: { kind: 'asr', license: 'MIT', attribution: 'a', files: [{ name: '../evil', url: 'http://a', sha256: 'zz', bytes: 0 }] } };
  const e = validateCatalog(bad, { f: { required: ['x', 'missing'], notes: [] } });
  for (const want of ['bad file name', 'not https', 'bad sha256', 'bad size', 'unknown component missing']) assert.ok(e.some((m) => m.includes(want)), want);
});
await t('every downloadable file is pinned (no "main" or "latest")', () => {
  for (const c of Object.values(COMPONENTS)) for (const list of c.files ? [c.files] : Object.values(c.platforms)) for (const f of list) assert.ok(!/\/(main|latest)\//.test(f.url), f.url);
});
await t('default speech model is Whisper turbo (MIT), Parakeet stays in the catalog', () => {
  const f = FEATURES['meeting-recorder'];
  assert.ok(f.required.includes('whisper-large-v3-turbo-int8')); assert.deepEqual(f.alternatives.asr, ['parakeet-tdt-0.6b-v3-int8']);
  const w = COMPONENTS['whisper-large-v3-turbo-int8']; assert.equal(w.license, 'MIT'); assert.match(w.attribution, /OpenAI/); assert.match(w.attribution, /Changed/); assert.equal(w.modelType, 'whisper');
});
await t('licenses: Parakeet credits NVIDIA and says it was changed (CC-BY-4.0)', () => {
  const p = COMPONENTS['parakeet-tdt-0.6b-v3-int8'];
  assert.equal(p.license, 'CC-BY-4.0'); assert.match(p.attribution, /NVIDIA/); assert.match(p.attribution, /Changed/);
});
await t('the feature fits the memory budget: worker 3 GB, models measured below it', () => {
  const f = FEATURES['meeting-recorder'];
  assert.equal(f.budget.workerMB, 3072); assert.equal(f.budget.appMB, 4096);
  for (const id of [...f.required, ...f.notes]) if (COMPONENTS[id].peakRamMB) assert.ok(COMPONENTS[id].peakRamMB < f.budget.workerMB, id);
});
await t('Windows only for now, with a test switch', () => {
  assert.equal(featureSupported('meeting-recorder', 'win32', 'win32-x64'), true);
  assert.equal(featureSupported('meeting-recorder', 'linux', 'linux-x64'), false);
  assert.equal(featureSupported('meeting-recorder', 'linux', 'linux-x64', { FOLIO_FEATURES_ANY_PLATFORM: '1' }), true);
  assert.equal(featureSupported('meeting-recorder', 'darwin', 'darwin-arm64', { FOLIO_FEATURES_ANY_PLATFORM: '1' }), false); // no files for it yet
  assert.ok(downloadBytes(FEATURES['meeting-recorder'].required, 'win32-x64') > 600e6);
});
await t('llama.cpp: only the server and its libraries are kept', () => {
  for (const k of ['llama-server.exe', 'llama-server-impl.dll', 'llama.dll', 'ggml-cpu-haswell.dll', 'libomp.dll', 'llama-server', 'libllama.so.1', 'libllama-server-impl.so']) assert.ok(keepLlamaFile(k), k);
  for (const k of ['llama-cli.exe', 'llama-cli-impl.dll', 'libllama-bench-impl.so', 'llama-bench', 'LICENSE']) assert.ok(!keepLlamaFile(k), k);
});
await t('models are stored locally, never in a roaming folder', () => {
  const win = componentsRoot(null, { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local', APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32');
  assert.ok(win.includes('Local') && !win.includes('Roaming'), win);
  assert.equal(componentsRoot(null, { FOLIO_COMPONENTS_DIR: '/x' }, 'win32'), '/x');
});

/* ---------- archives ---------- */
function tar(entries) { // a minimal ustar writer for tests
  const blocks = [];
  for (const e of entries) {
    const h = Buffer.alloc(512); const data = Buffer.from(e.data || '');
    h.write(e.name.slice(0, 100), 0); h.write((e.mode ?? 0o644).toString(8).padStart(7, '0'), 100); h.write('0000000', 108); h.write('0000000', 116);
    h.write(data.length.toString(8).padStart(11, '0'), 124); h.write('00000000000', 136); h.write(e.type || '0', 156);
    if (e.link) h.write(e.link, 157); h.write('ustar\u000000', 257);
    h.fill(' ', 148, 156); let sum = 0; for (const b of h) sum += b; h.write(sum.toString(8).padStart(6, '0') + '\u0000 ', 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return zlib.gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
await t('tgz: strip, keep filter, links copied, never created', () => {
  const tgz = tar([{ name: 'pkg/', type: '5' }, { name: 'pkg/libx.so.1.0.0', data: 'LIB', mode: 0o755 }, { name: 'pkg/libx.so.1', type: '2', link: 'libx.so.1.0.0' }, { name: 'pkg/libx.so', type: '2', link: 'libx.so.1' }, { name: 'pkg/README.md', data: 'r' }]);
  const out = selectFiles(parseTgz(tgz), { strip: 1, keep: (p) => p.startsWith('lib') });
  assert.deepEqual(out.map((o) => o.path).sort(), ['libx.so', 'libx.so.1', 'libx.so.1.0.0']);
  assert.ok(out.every((o) => o.data.toString() === 'LIB' && o.mode === 0o755));
});
await t('tgz: a path that leaves the folder fails the install', () => {
  assert.throws(() => selectFiles(parseTgz(tar([{ name: '../../evil.dll', data: 'x' }]))), /Unsafe/);
  assert.equal(safeRel('/etc/passwd'), null); assert.equal(safeRel('C:\\Windows\\x'), null); assert.equal(safeRel('a/../../b'), null); assert.equal(safeRel('a\\b'), 'a/b');
});
await t('zip: read and filtered', async () => {
  const z = new JSZip(); z.file('llama-server.exe', 'exe'); z.file('llama-cli.exe', 'cli'); z.file('ggml.dll', 'dll');
  const out = selectFiles(await parseZip(await z.generateAsync({ type: 'nodebuffer' })), { keep: keepLlamaFile });
  assert.deepEqual(out.map((o) => o.path).sort(), ['ggml.dll', 'llama-server.exe']);
});

/* ---------- installer, against a local server with Range support ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-features-'));
const big = crypto.randomBytes(300_000), small = Buffer.from('tokens\n');
const tgzFile = tar([{ name: 'package/index.js', data: 'module.exports=1' }, { name: 'package/native.node', data: 'BIN', mode: 0o755 }]);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const files = { '/big.bin': big, '/tokens.txt': small, '/rt.tgz': tgzFile };
let slow = false, requests = [];
const server = http.createServer((req, res) => {
  requests.push({ url: req.url, range: req.headers.range });
  const body = files[req.url]; if (!body) { res.writeHead(404); return res.end(); }
  const m = /bytes=(\d+)-/.exec(req.headers.range || '');
  const from = m ? Number(m[1]) : 0;
  res.writeHead(m ? 206 : 200, { 'content-length': body.length - from, ...(m ? { 'content-range': `bytes ${from}-${body.length - 1}/${body.length}` } : {}) });
  if (!slow) return res.end(body.subarray(from));
  let i = from; const tick = () => { if (i >= body.length || res.destroyed) return res.end(); res.write(body.subarray(i, i + 20000)); i += 20000; setTimeout(tick, 15); }; tick();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const catalog = {
  model: { kind: 'asr', version: '1', license: 'MIT', attribution: 'x', files: [{ name: 'model.bin', url: base + '/big.bin', sha256: sha(big), bytes: big.length }, { name: 'tokens.txt', url: base + '/tokens.txt', sha256: sha(small), bytes: small.length }] },
  rt: { kind: 'runtime', version: '1', license: 'MIT', attribution: 'x', platforms: { 'test-x64': [{ name: 'rt.tgz', url: base + '/rt.tgz', sha256: sha(tgzFile), bytes: tgzFile.length, unpack: 'tgz', into: 'node_modules/rt', strip: 1 }] } },
  bad: { kind: 'asr', version: '1', license: 'MIT', attribution: 'x', files: [{ name: 'model.bin', url: base + '/big.bin', sha256: 'f'.repeat(64), bytes: big.length }] },
};
const progress = [];
const inst = createInstaller({ root: path.join(tmp, 'c'), platformKey: 'test-x64', fetch, components: catalog, onProgress: (p) => progress.push(p), freeBytes: async () => 10e9 });

await t('install: download, check, unpack, mark ready', async () => {
  assert.equal((await inst.status('model')).state, 'not-installed');
  await inst.install(['model', 'rt']);
  assert.equal((await inst.status('model')).state, 'ready'); assert.equal((await inst.status('rt')).state, 'ready');
  assert.deepEqual(fs.readFileSync(path.join(inst.pathOf('model'), 'model.bin')), big);
  assert.equal(fs.readFileSync(path.join(inst.pathOf('rt'), 'node_modules/rt/index.js'), 'utf8'), 'module.exports=1');
  assert.ok(!fs.existsSync(path.join(tmp, 'c', '.downloads', 'model')));
  assert.ok(progress.some((p) => p.model?.state === 'downloading'));
});
await t('install again: nothing is downloaded', async () => { requests = []; await inst.install(['model']); assert.equal(requests.length, 0); });
await t('a file changed on disk is reported, then repaired', async () => {
  fs.truncateSync(path.join(inst.pathOf('model'), 'model.bin'), 10);
  assert.equal((await inst.status('model')).state, 'corrupt');
  await inst.install(['model']); assert.equal((await inst.status('model')).state, 'ready');
});
await t('cancel keeps the partial file; install resumes with a Range request', async () => {
  await inst.uninstall('model'); slow = true; requests = [];
  const p = inst.install(['model']);
  await new Promise((r) => setTimeout(r, 60)); inst.cancel();
  await assert.rejects(p, (e) => e.cancelled);
  const st = await inst.status('model'); assert.equal(st.state, 'partial'); assert.ok(st.done > 0 && st.done < big.length, String(st.done));
  slow = false; requests = [];
  await inst.install(['model']);
  assert.match(requests.find((r) => r.url === '/big.bin').range, /^bytes=[1-9]\d*-$/);
  assert.equal((await inst.status('model')).state, 'ready');
  assert.deepEqual(fs.readFileSync(path.join(inst.pathOf('model'), 'model.bin')), big);
});
await t('a wrong checksum deletes the download and installs nothing', async () => {
  await assert.rejects(inst.install(['bad']), /checksum/);
  assert.equal((await inst.status('bad')).state, 'not-installed');
  assert.ok(!fs.existsSync(inst.pathOf('bad')));
});
await t('not enough disk space is refused before downloading', async () => {
  const tiny = createInstaller({ root: path.join(tmp, 'd'), platformKey: 'test-x64', fetch, components: catalog, freeBytes: async () => 1000 });
  requests = []; await assert.rejects(tiny.install(['model']), /disk space/); assert.equal(requests.length, 0);
});
await t('one download at a time; unknown or unavailable components are refused', async () => {
  slow = true; const p = inst.install(['bad']).catch(() => {});
  await assert.rejects(inst.install(['rt']), /Another download/); inst.cancel(); await p; slow = false;
  await assert.rejects(inst.install(['nope']), /not available/);
  assert.equal((await createInstaller({ root: tmp, platformKey: 'other', fetch, components: catalog }).status('rt')).state, 'unsupported');
});
await t('an update cut between its two renames is put back at the next start', async () => {
  const dest = inst.pathOf('model'); fs.renameSync(dest, dest + '.old'); // the live folder moved away, the new one never arrived
  assert.equal((await inst.status('model')).state, 'not-installed');
  await inst.cleanup(); assert.equal((await inst.status('model')).state, 'ready');
});
await t('uninstall removes files', async () => { await inst.uninstall('rt'); assert.equal((await inst.status('rt')).state, 'not-installed'); assert.ok(!fs.existsSync(inst.pathOf('rt'))); });
server.close();

/* ---------- transcript ---------- */
const seg = (id, track, t0, t1, text) => ({ id, track, t0, t1, text });
await t('echo: the microphone repeating the other side is dropped, real replies kept', () => {
  const s = [seg(1, 'them', 0, 4, 'Can you prepare the Windows build by Friday?'), seg(2, 'me', 0.3, 4.2, 'can you prepare the windows build by friday'), seg(3, 'me', 5, 6, 'Yes, I will do it.')];
  assert.deepEqual(dropEcho(s).map((x) => x.id), [1, 3]);
  assert.ok(overlap('a b c', 'x y z') === 0);
});
await t('a sentence repeated by Whisper is kept once', () => {
  assert.equal(dedupeSentences('Il primo punto è il registratore. Il primo punto è il registratore. Poi altro.'), 'Il primo punto è il registratore. Poi altro.');
  assert.equal(dedupeSentences('Il primo punto è il registratore che funziona in locale. Il registratore che funziona in locale.'), 'Il primo punto è il registratore che funziona in locale.');
  assert.equal(dedupeSentences('Sì. Sì, certo.'), 'Sì. Sì, certo.');
});
await t('lines are numbered in time order with speakers', () => {
  const L = lines([seg(2, 'me', 5, 6, 'Second'), seg(1, 'them', 1, 2, 'First'), seg(3, 'them', 7, 8, '  ')]);
  assert.deepEqual(L.map((l) => [l.n, l.who, l.text]), [[1, 'Others', 'First'], [2, 'You', 'Second']]);
  assert.equal(clock(3725), '01:02:05');
});
await t('file name is safe and dated', () => {
  assert.equal(fileName(new Date(2026, 10, 20, 15, 4), 'Weekly: sync / Q4?'), 'Meetings/2026-11-20 15-04 Weekly sync Q4.md');
  assert.equal(fileName(new Date(2026, 10, 20, 9, 0), ''), 'Meetings/2026-11-20 09-00 Meeting.md');
});
await t('note: front matter with measurements, notes cite lines, transcript escaped', () => {
  const md = renderMeeting({ title: 'Sync', started: new Date('2026-11-20T14:04:00Z'), durationSec: 65, asrModel: 'parakeet', notesModel: 'qwen', segments: [seg(1, 'them', 0, 2, 'Use *stars* and # signs')],
    notes: { summary: 'We met.', decisions: [{ text: 'Ship it', line: 1 }], actions: [{ task: 'Build', owner: 'Marco', due: 'Friday', line: 1 }], questions: [] }, stats: { workerPeakMB: 950, appPeakMB: 1400, speed: 0.08 } });
  assert.match(md, /^---\ntype: meeting\ntitle: "Sync"\n/); assert.match(md, /duration: 00:01:05/); assert.match(md, /worker_peak_mb: 950/); assert.match(md, /transcription_speed: 0.08/);
  assert.match(md, /- \[ \] Build · owner: Marco · due: Friday \(line 1\)/); assert.match(md, /\*\*1\*\* · 00:00:00 · Others: Use \\\*stars\\\* and \\# signs/);
  assert.ok(md.indexOf('## Notes') < md.indexOf('## Transcript'));
});

/* ---------- notes: the model proposes, the transcript decides (cases seen in the spike) ---------- */
const L = lines([
  seg(1, 'them', 0, 3, 'Michael, puoi preparare la Build per Windows entro venerdì ventisette novembre?'),
  seg(2, 'them', 4, 6, 'La preparo io e la carico sul G2 Bentovenerd.'),
  seg(3, 'them', 7, 9, 'Abbiamo deciso di usare il paraguette per la trascrizione e quen per le note.'),
  seg(4, 'them', 10, 12, 'Giulia, ti occupi tu di provare il modello con le registrazioni di Teams?'),
]);
await t('invented owners and dates are removed, real ones kept', () => {
  const { notes, dropped } = verify({ summary: ' Riunione  ', decisions: [{ text: 'Usare Parakeet', line: 3, quote: 'Abbiamo deciso di usare il paraguette' }], questions: [],
    actions: [
      { task: 'Build', owner: 'Michael', due: 'venerdì ventisette novembre', line: 1, quote: 'Michael, puoi preparare la Build per Windows entro venerdì ventisette novembre?' },
      { task: 'Caricare', owner: "L'utente", due: 'entro la prossima settimana', line: 2, quote: 'La preparo io e la carico sul G2 Bentovenerd.' },
      { task: 'Prove', owner: 'Giulia', due: 'prossima settimana', line: 4, quote: 'Giulia, ti occupi tu di provare il modello' },
      { task: 'Caricare', owner: 'Io', due: '', line: 2, quote: 'La preparo io' },
    ] }, L);
  assert.equal(notes.summary, 'Riunione');
  assert.deepEqual(notes.actions.map((a) => [a.line, a.owner, a.due]), [[1, 'Michael', 'venerdì ventisette novembre'], [2, '', ''], [4, 'Giulia', '']]);
  assert.equal(notes.decisions.length, 1); assert.equal(dropped, 0);
});
await t('a quote that is not on its line drops the item', () => {
  const { notes, dropped } = verify({ summary: '', decisions: [], questions: [{ text: 'Data?', line: 2, quote: 'Qual è la data della documentazione' }],
    actions: [{ task: 'x', owner: '', due: '', line: 3, quote: 'Il limite è di 6 gigabit per i modelli.' }, { task: 'y', owner: '', due: '', line: 99, quote: 'anything' }] }, L);
  assert.equal(notes.actions.length + notes.questions.length, 0); assert.equal(dropped, 3);
  assert.ok(quoteOnLine('Giulia, ti occupi tu di provare il modello', 'giulia ti occupi di provare il modello'));
  assert.ok(!quoteOnLine('Giulia, ti occupi tu', 'Marco'));
});
await t('a line listed as a decision or question must read like one', () => {
  const { notes } = verify({ summary: '', actions: [],
    decisions: [{ text: 'Build', line: 1, quote: 'puoi preparare la Build per Windows' }, { text: 'Parakeet', line: 3, quote: 'Abbiamo deciso di usare il paraguette' }],
    questions: [{ text: 'Quando?', line: 2, quote: 'La preparo io' }, { text: 'Chi prova?', line: 4, quote: 'Giulia, ti occupi tu di provare il modello' }] }, L);
  assert.deepEqual(notes.decisions.map((d) => d.line), [3]); assert.deepEqual(notes.questions.map((q) => q.line), [4]);
  assert.ok(readsLikeDecision('We agreed to ship on Monday')); assert.ok(!readsLikeDecision('Thanks everyone'));
  assert.ok(readsLikeQuestion('Resta aperta la domanda sull eco')); assert.ok(!readsLikeQuestion('Ci sentiamo lunedì'));
});
await t('long transcripts are split and merged in order', () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ n: i + 1, who: 'You', text: 'parola '.repeat(8) }));
  const parts = chunk(many, 6000); assert.ok(parts.length >= 3); assert.ok(parts.every((p) => p.length <= 6100));
  assert.ok(parts[1].startsWith('[')); assert.equal(parts.join('\n').split('\n').length, 300);
  const m = merge([{ summary: 'A', decisions: [{ line: 9 }], actions: [], questions: [] }, { summary: 'B', decisions: [{ line: 2 }], actions: [], questions: [] }]);
  assert.equal(m.summary, 'A B'); assert.deepEqual(m.decisions.map((d) => d.line), [2, 9]);
});

/* ---------- recordings kept after a crash: ids are checked before they become file names ---------- */
await t('meeting:recover and meeting:discard refuse an id that is not one of ours', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-feat-')); const handlers = {};
  createFeatures({ app: { getPath: () => tmp }, net: {}, utilityProcess: {}, MessageChannelMain: class {}, h: (name, fn) => { handlers[name] = fn; }, getWin: () => null,
    settings: {}, saveSettings: () => {}, notes: { resolve: (r) => path.join(tmp, r), root: () => tmp }, workerPath: '', env: { LOCALAPPDATA: tmp, XDG_DATA_HOME: tmp } });
  const keep = path.join(path.dirname(componentsRoot({ getPath: () => tmp }, { LOCALAPPDATA: tmp, XDG_DATA_HOME: tmp })), 'keep.jsonl'); fs.mkdirSync(path.dirname(keep), { recursive: true }); fs.writeFileSync(keep, 'x');
  for (const bad of ['../keep', '..\\keep', 'A_b', 'a b', '', '.', 'x/../y']) {
    await assert.rejects(handlers['meeting:recover'](bad), /Unknown recording\./, `recover ${JSON.stringify(bad)}`);
    await assert.rejects(handlers['meeting:discard'](bad), /Unknown recording\./, `discard ${JSON.stringify(bad)}`);
  }
  assert.ok(fs.existsSync(keep)); assert.equal(await handlers['meeting:discard']('0a1b-2c'), true);
});

/* ---------- offering to record when a call starts ---------- */
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
function callService(over = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-detect-')); const handlers = {}, sent = [], toasts = [], reg = { n: 0 }; const win = { webContents: { send: (ch, d) => sent.push([ch, d]) }, isMinimized: () => false, restore() {}, show() {}, focus() {} };
  const settings = over.settings || { features: { 'meeting-recorder': { enabled: true, detectCalls: true } } };
  const svc = createFeatures({ app: { getPath: () => tmp, getName: () => 'Folio' }, net: {}, utilityProcess: {}, MessageChannelMain: class {}, h: (name, fn) => { handlers[name] = fn; }, getWin: () => win,
    settings, saveSettings: () => {}, notes: { resolve: (r) => path.join(tmp, r), root: () => tmp }, workerPath: '', env: { LOCALAPPDATA: tmp, XDG_DATA_HOME: tmp },
    platform: 'win32', notify: (o) => toasts.push(o), detect: { intervalMs: 15, holdMs: 60, quietMs: 1000, ready: async () => true, ...over.detect },
    execReg: async () => { reg.n++; return `HKEY_CURRENT_USER\\Software\\x\\NonPackaged\\C:#Program Files#Zoom#bin#Zoom.exe\r\n    LastUsedTimeStart    REG_QWORD    0x5\r\n    LastUsedTimeStop    REG_QWORD    0x0\r\n`; }, ...over.svc });
  return { handlers, sent, toasts, reg, svc, settings };
}
await t('a call that holds the microphone gets one notification; clicking it asks the window to start', async () => {
  const { handlers, sent, toasts } = callService();
  await nap(400);
  assert.equal(toasts.length, 1, 'one notification for the whole call');
  assert.match(toasts[0].title, /Zoom/); assert.match(toasts[0].title, /microphone/);
  assert.deepEqual(sent.filter(([c]) => c === 'meeting:auto-start'), [], 'nothing starts before the click');
  toasts[0].onClick();
  assert.deepEqual(sent.filter(([c]) => c === 'meeting:auto-start'), [['meeting:auto-start', { title: 'Meeting Zoom' }]]);
  await handlers['features:set']('meeting-recorder', { detectCalls: false });
});
await t('a notification is not shown if the person turned detection off while it was being prepared', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { handlers, toasts } = callService({ detect: { ready: async () => { await gate; return true; } } });
  await nap(200); // the call is noticed, the readiness check is waiting
  await handlers['features:set']('meeting-recorder', { detectCalls: false }); release(); await nap(100);
  assert.equal(toasts.length, 0);
});
await t('nothing is offered while no folder is open', async () => {
  const { toasts, handlers } = callService({ svc: { notes: { resolve: (r) => r, root: () => { throw new Error('Open a folder first.'); } } } });
  await nap(300); assert.equal(toasts.length, 0);
  await handlers['features:set']('meeting-recorder', { detectCalls: false });
});
await t('nothing is offered while the speech model is not downloaded', async () => {
  const { toasts, handlers } = callService({ detect: { ready: async () => false } });
  await nap(300); assert.equal(toasts.length, 0);
  await handlers['features:set']('meeting-recorder', { detectCalls: false });
});
await t('turning the setting off stops the watching; never turned on, nothing is read', async () => {
  const on = callService(); await nap(120); assert.ok(on.reg.n > 0);
  await on.handlers['features:set']('meeting-recorder', { detectCalls: false }); const at = on.reg.n; await nap(120);
  assert.equal(on.reg.n, at, 'no more registry reads'); assert.equal((await on.handlers['features:list']())[0].detectCalls, false);
  const never = callService({ settings: { features: { 'meeting-recorder': { enabled: true } } } }); await nap(120);
  assert.equal(never.reg.n, 0); assert.equal(never.toasts.length, 0);
});
await t('detection is not offered off Windows', async () => {
  const { handlers, reg } = callService({ svc: { platform: 'linux' } }); await nap(120);
  assert.equal(reg.n, 0); assert.equal((await handlers['features:list']())[0].detectSupported, false);
});

console.log(`  ${n} passed`);
