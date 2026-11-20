// Folio — the optional features service in the main process: component installs, the meeting recorder session,
// and the memory guard. main.js passes in what it owns (window, settings, notes, IPC helper) so this file stays testable.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { COMPONENTS, FEATURES, featureSupported, downloadBytes } from '../features/catalog.js';
import { createInstaller } from '../features/installer.js';
import { renderMeeting, fileName, lines as numberLines } from './transcript.js';
import { draftNotes } from './notes-engine.js';
import { writeAtomic } from '../atomic.js';

const FEATURE = 'meeting-recorder';
const RATE = 16000;

/** where downloaded components live: local, never roaming or synced folders */
export function componentsRoot(app, env = process.env, platform = process.platform) {
  if (env.FOLIO_COMPONENTS_DIR) return env.FOLIO_COMPONENTS_DIR;
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Folio', 'components');
  if (platform === 'darwin') return path.join(app.getPath('userData'), 'components');
  return path.join(env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'Folio', 'components');
}

/** samples of a 16-bit PCM wav (tests only) */
function wavPcm(buf) {
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4), size = buf.readUInt32LE(off + 4);
    if (id === 'data') return buf.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}

export function createFeatures({ app, net, utilityProcess, MessageChannelMain, h, getWin, settings, saveSettings, notes, workerPath, env = process.env }) {
  const platformKey = `${process.platform}-${process.arch}`;
  const root = componentsRoot(app, env);
  const workDir = path.join(root, '..', 'meetings');
  const send = (ch, data) => getWin()?.webContents.send(ch, data);
  const installer = createInstaller({
    root, platformKey,
    fetch: (url, o) => net.fetch(url, { ...o, bypassCustomProtocolHandlers: true }),
    onProgress: (p) => send('features:progress', p),
    freeBytes: async (dir) => { const s = await fs.statfs(dir); return Number(s.bavail) * Number(s.bsize); },
  });
  installer.cleanup().catch(() => {});

  const state = () => { settings.features ||= {}; return (settings.features[FEATURE] ||= { enabled: false, noticeSeen: false, autoNotes: true }); };

  /* ---------- feature list for the Settings view ---------- */
  async function unsaved() {
    const out = [];
    for (const f of await fs.readdir(workDir).catch(() => [])) {
      if (!f.endsWith('.jsonl') || (session && f === path.basename(session.workFile))) continue;
      const meta = await readWork(path.join(workDir, f)).catch(() => null);
      if (meta) out.push({ id: f.slice(0, -6), title: meta.meta.title, started: meta.meta.started, segments: meta.segments.length });
    }
    return out;
  }
  async function describe() {
    const f = FEATURES[FEATURE], st = state();
    const ids = [...f.required, ...f.notes];
    const s = await installer.statuses(ids);
    const comp = (id) => ({ id, kind: COMPONENTS[id].kind, name: COMPONENTS[id].name, license: COMPONENTS[id].license, licenseUrl: COMPONENTS[id].licenseUrl, attribution: COMPONENTS[id].attribution, ...s[id] });
    return [{
      id: FEATURE, name: f.name, description: f.description,
      supported: featureSupported(FEATURE, process.platform, platformKey, env),
      enabled: !!st.enabled, noticeSeen: !!st.noticeSeen, autoNotes: st.autoNotes !== false, language: st.language || '',
      required: { ready: f.required.every((id) => s[id].state === 'ready'), bytes: downloadBytes(f.required, platformKey), components: f.required.map(comp) },
      notes: { ready: f.notes.every((id) => s[id].state === 'ready'), bytes: downloadBytes(f.notes, platformKey), components: f.notes.map(comp) },
      busy: installer.busy(), session: session ? publicSession() : null, unsaved: await unsaved(),
    }];
  }
  const part = (which) => { const f = FEATURES[FEATURE]; if (which === 'required') return f.required; if (which === 'notes') return f.notes; throw new Error('Unknown part.'); };
  const check = (id) => { if (id !== FEATURE) throw new Error('Unknown feature.'); };

  h('features:list', () => describe());
  h('features:set', async (id, patch) => {
    check(id);
    const st = state();
    if (typeof patch?.enabled === 'boolean') st.enabled = patch.enabled;
    if (typeof patch?.autoNotes === 'boolean') st.autoNotes = patch.autoNotes;
    if (patch?.noticeSeen === true) st.noticeSeen = true;
    if (typeof patch?.language === 'string' && ['', 'it', 'en'].includes(patch.language)) st.language = patch.language; // '' = detect
    saveSettings();
    return describe();
  });
  h('features:install', async (id, which) => {
    check(id);
    if (!featureSupported(FEATURE, process.platform, platformKey, env)) throw new Error('This feature is not available on this computer yet.');
    try { await installer.install(part(which)); } catch (e) { if (!e.cancelled) throw e; }
    send('features:progress', {});
    return describe();
  });
  h('features:cancel', () => { installer.cancel(); return true; });
  h('features:uninstall', async (id, which) => {
    check(id);
    if (session) throw new Error('Stop the recording first.');
    for (const c of part(which)) await installer.uninstall(c);
    return describe();
  });

  /* ---------- the recording session ---------- */
  let session = null;
  const publicSession = () => ({ id: session.id, title: session.title, phase: session.phase, started: session.started.toISOString(), path: session.path || null, error: session.error || null, progress: session.progress || null, segments: session.segments.length });
  const phase = (p, extra = {}) => { if (!session) return; Object.assign(session, { phase: p }, extra); send('meeting:state', publicSession()); };

  async function readWork(file) {
    const rows = (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const meta = rows.find((r) => r.type === 'meta');
    if (!meta) throw new Error('not a meeting file');
    return { meta, segments: rows.filter((r) => r.type === 'segment') };
  }
  /** writes the note into the workspace with a name that does not overwrite anything */
  async function writeNote(rel, text) {
    await fs.mkdir(path.dirname(notes.resolve(rel, { mustBeNote: true })), { recursive: true });
    let abs;
    for (let i = 1; ; i++) { // the name is claimed with an exclusive create, so two saves at once never pick the same one
      abs = notes.resolve(i === 1 ? rel : rel.replace(/\.md$/, ` ${i}.md`), { mustBeNote: true });
      try { await (await fs.open(abs, 'wx')).close(); break; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    try { await writeAtomic(abs, text); } catch (e) { await fs.rm(abs, { force: true }); throw e; } // the work file keeps the transcript
    return notes.relOf(abs);
  }

  function memoryGuard() {
    const budget = FEATURES[FEATURE].budget;
    const t = setInterval(() => {
      if (!session) return clearInterval(t);
      let total = 0, worker = 0;
      for (const m of app.getAppMetrics()) {
        const kb = m.memory.privateBytes ?? m.memory.workingSetSize; total += kb;
        if (m.pid === session.workerPid) worker = kb;
      }
      const mb = (kb) => Math.round(kb / 1024);
      session.peak.worker = Math.max(session.peak.worker, mb(worker)); session.peak.app = Math.max(session.peak.app, mb(total));
      if (session.phase === 'recording' && (mb(worker) > budget.workerMB || mb(total) > budget.appMB)) {
        send('meeting:stop-request', { reason: `Folio stopped the recording because it used ${mb(total)} MB, above its ${budget.appMB} MB limit. The transcript so far is saved.` });
      }
    }, 5000);
    t.unref();
  }

  async function start({ title } = {}) {
    if (session) throw new Error('A recording is already running.');
    if (!state().enabled) throw new Error('Turn on the meeting recorder in Settings first.');
    notes.root(); // throws when no folder is open
    const d = await describe();
    if (!d[0].supported) throw new Error('The meeting recorder is not available on this computer yet.');
    if (!d[0].required.ready) throw new Error('Download the meeting recorder in Settings first.');
    const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const started = new Date();
    const asrId = FEATURES[FEATURE].required.find((c) => COMPONENTS[c].kind === 'asr');
    const asr = COMPONENTS[asrId], dir = (c) => installer.pathOf(c);
    await fs.mkdir(workDir, { recursive: true });
    const workFile = path.join(workDir, `${id}.jsonl`);
    const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80) || `Meeting ${started.toLocaleDateString()}`;
    await fs.writeFile(workFile, JSON.stringify({ type: 'meta', id, title: clean, started: started.toISOString(), asr: asrId }) + '\n');
    session = { id, title: clean, started, workFile, asrId, segments: [], phase: 'starting', peak: { worker: 0, app: 0 }, ready: null };
    send('meeting:state', publicSession());
    const worker = utilityProcess.fork(workerPath, [], { serviceName: 'Folio meeting transcription', stdio: 'pipe' });
    session.worker = worker;
    let stderr = ''; worker.stderr?.on('data', (b) => { stderr = (stderr + b).slice(-2000); });
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The speech engine did not start in time.')), 90000);
      worker.on('message', (m) => {
        if (m.type === 'ready') { clearTimeout(timer); session.loadMs = m.loadMs; resolve(); }
        else if (m.type === 'segment' && session) {
          const seg = { type: 'segment', id: m.id, track: m.track, t0: m.t0, t1: m.t1, text: m.text };
          session.segments.push(seg); fss.appendFile(workFile, JSON.stringify(seg) + '\n', () => {});
          send('meeting:segment', seg);
        } else if (m.type === 'stats' && session) session.queueSec = m.queueSec;
        else if (m.type === 'done' && session) session.done?.(m);
        else if (m.type === 'error') { if (m.fatal) { clearTimeout(timer); reject(new Error(m.error)); } else send('meeting:state', { ...publicSession(), error: m.error }); }
      });
      worker.on('exit', (code) => {
        clearTimeout(timer);
        if (!session || session.worker !== worker) return;
        session.workerExited = code;
        if (session.phase === 'recording' || session.phase === 'starting') {
          reject(new Error(`The speech engine stopped unexpectedly (${code}). ${stderr.trim().split('\n').pop() || ''}`.trim()));
          send('meeting:stop-request', { reason: 'The speech engine stopped unexpectedly. The transcript so far is saved.' });
        }
        session.done?.(null);
      });
    });
    worker.on('spawn', () => {
      session.workerPid = worker.pid;
      const { port1, port2 } = new MessageChannelMain();
      worker.postMessage({ type: 'init', sherpaDir: dir('sherpa-runtime'), vad: path.join(dir('silero-vad'), 'silero_vad.onnx'),
        asr: { type: asr.modelType, encoder: path.join(dir(asrId), 'encoder.int8.onnx'), decoder: path.join(dir(asrId), 'decoder.int8.onnx'), joiner: path.join(dir(asrId), 'joiner.int8.onnx'), tokens: path.join(dir(asrId), 'tokens.txt'), maxTokensPerSecond: asr.maxTokensPerSecond },
        language: state().language || '', threads: asr.threads, maxSegmentSec: asr.maxSegmentSec }, [port1]);
      session.port = port2;
    });
    try { await ready; } catch (e) { const s = session; session = null; try { s.worker.kill(); } catch {} await fs.rm(workFile, { force: true }); send('meeting:state', null); throw e; }
    getWin()?.webContents.postMessage('meeting:port', { id }, [session.port]);
    session.port = null;
    phase('recording');
    memoryGuard();
    if (env.FOLIO_MEETING_FAKE_WAV) feedWav(env.FOLIO_MEETING_FAKE_WAV, env.FOLIO_MEETING_FAKE_TRACK || 'them');
    return publicSession();
  }

  function feedWav(file, track) { // tests: a recording without a sound card
    const pcm = wavPcm(fss.readFileSync(file));
    for (let i = 0; i < pcm.length; i += RATE * 2) { // one second per message
      const b = pcm.subarray(i, Math.min(pcm.length, i + RATE * 2)); const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
      session.worker.postMessage({ type: 'feed', track, pcm: ab });
    }
  }

  /** stops the recording, writes the transcript at once, then the notes when their model is installed */
  async function stop() {
    if (!session) throw new Error('Nothing is recording.');
    if (session.phase !== 'recording' && session.phase !== 'starting') return publicSession();
    const s = session;
    phase('transcribing');
    const done = new Promise((resolve) => { s.done = resolve; });
    let result = null;
    if (s.workerExited === undefined) {
      s.worker.postMessage({ type: 'stop' });
      const wait = Math.max(60000, (s.queueSec || 0) * 4000);
      result = await Promise.race([done, new Promise((r) => setTimeout(() => r(null), wait))]);
    }
    try { s.worker.kill(); } catch {}
    const durationSec = (Date.now() - s.started.getTime()) / 1000;
    const audio = Math.max(result?.audioSec?.me || 0, result?.audioSec?.them || 0);
    const base = { title: s.title, started: s.started, durationSec, asrModel: s.asrId, segments: s.segments,
      stats: { workerPeakMB: s.peak.worker || null, appPeakMB: s.peak.app || null, speed: result?.decodeSec && audio ? +(result.decodeSec / audio).toFixed(3) : null } };
    try {
      s.path = await writeNote(fileName(s.started, s.title), renderMeeting(base));
      await fs.rm(s.workFile, { force: true });
      phase('saved', { path: s.path, audioSec: result?.audioSec });
    } catch (e) { phase('failed', { error: `The transcript could not be saved: ${e.message}. It is kept and can be saved from Settings.` }); session = null; throw e; }
    const out = publicSession();
    const d = (await describe())[0];
    const finish = () => { if (session === s) { session = null; send('meeting:state', { ...out, phase: 'idle' }); } };
    if (d.notes.ready && d.autoNotes && s.segments.length) { // the notes come later: the transcript is already saved
      writeNotesFor(s, base).catch((e) => phase('saved', { error: `Notes were not written: ${e.message}` })).finally(() => setTimeout(finish, 1500));
    } else finish();
    return out;
  }

  async function writeNotesFor(s, base) {
    const llmId = FEATURES[FEATURE].notes.find((c) => COMPONENTS[c].kind === 'llm'), llm = COMPONENTS[llmId];
    const ext = process.platform === 'win32' ? '.exe' : '';
    phase('notes', { progress: { step: 'loading' } });
    const L = numberLines(s.segments);
    s.notesAbort = new AbortController();
    const { notes: drafted } = await draftNotes({
      serverBin: path.join(installer.pathOf('llama-server'), 'bin', 'llama-server' + ext), modelPath: path.join(installer.pathOf(llmId), 'model.gguf'),
      lines: L, threads: Math.max(2, Math.min(llm.threads, (os.availableParallelism?.() || 4) - 1)), contextTokens: llm.contextTokens,
      onProgress: (p) => phase('notes', { progress: p }), signal: s.notesAbort.signal,
    });
    const fresh = renderMeeting({ ...base, notesModel: llmId, notes: drafted });
    const abs = notes.resolve(s.path, { mustBeNote: true });
    const current = await fs.readFile(abs, 'utf8').catch(() => null);
    const ours = renderMeeting(base);
    let text = fresh;
    if (current !== null && current !== ours) { // the person edited the note meanwhile: add the notes above the transcript, keep their text
      const block = fresh.slice(fresh.indexOf('## Notes'), fresh.indexOf('## Transcript'));
      const at = current.indexOf('## Transcript');
      text = at >= 0 ? current.slice(0, at) + block + current.slice(at) : current.trimEnd() + '\n\n' + block;
    }
    await writeAtomic(abs, text);
    phase('saved', { progress: null });
  }

  /** a recording whose app closed before it was saved: write its transcript now */
  async function recover(workId) {
    if (!/^[a-z0-9-]+$/.test(String(workId))) throw new Error('Unknown recording.');
    const file = path.join(workDir, `${workId}.jsonl`);
    const { meta, segments } = await readWork(file);
    const last = segments.reduce((m, x) => Math.max(m, x.t1 || 0), 0);
    const p = await writeNote(fileName(new Date(meta.started), meta.title), renderMeeting({ title: meta.title, started: new Date(meta.started), durationSec: last, asrModel: meta.asr, segments }));
    await fs.rm(file, { force: true });
    return p;
  }

  h('meeting:start', (o) => start(o));
  h('meeting:stop', () => stop());
  h('meeting:status', () => (session ? publicSession() : null));
  h('meeting:recover', (id) => recover(id));
  h('meeting:discard', async (workId) => { if (!/^[a-z0-9-]+$/.test(String(workId))) throw new Error('Unknown recording.'); await fs.rm(path.join(workDir, `${workId}.jsonl`), { force: true }); return true; });

  /** waits for notes still being written, so quitting does not cut them off (at most 3 minutes) */
  async function settle() { for (let i = 0; session && i < 360; i++) await new Promise((r) => setTimeout(r, 500)); }

  return {
    /** the display-media handler asks this: system sound is only given to the app page while it is starting a recording */
    allowLoopback: (frame) => !!session && (session.phase === 'starting' || session.phase === 'recording') && frame === getWin()?.webContents.mainFrame,
    active: () => !!session && ['starting', 'recording', 'transcribing'].includes(session.phase),
    stop: () => (session ? stop().catch(() => {}) : Promise.resolve()),
    settle,
    /** stops a notes engine still running (the app is quitting); the transcript is already saved */
    abortNotes: () => session?.notesAbort?.abort(),
  };
}
