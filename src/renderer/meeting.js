// Folio — meeting recorder in the window: the Settings section, audio capture and the recording bar.
// Loaded on demand (opening Settings or starting a recording), so it costs nothing at startup.
// Capture: the microphone ('me') and the computer's sound ('them', Windows loopback) go through one AudioContext at
// 16 kHz into an AudioWorklet, which posts 100 ms Int16 blocks; they travel on a MessagePort straight to the worker.

import { t as tr, tl } from './i18n.js';

const GB = (n) => `${(n / 2 ** 30).toFixed(n >= 2 ** 30 ? 1 : 2)} GB`;
const pct = (d, t) => (t ? Math.min(100, Math.floor((d / t) * 100)) : 0);
const clock = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function createMeeting(ui) {
  const { esc, toast, confirm, prompt, openFile, refreshTree, openSettings } = ui;
  const setFeature = (f) => { feature = f; ui.onFeature?.(f); }; // the sidebar's record button follows what Settings changes
  let feature = null, host = null, progress = {}, rec = null, bar = null, state = null;

  /* ---------------- Settings section ---------------- */
  const group = (part) => feature?.[part];
  function partState(part) {
    const g = group(part); if (!g) return { label: '', busy: false };
    const live = g.components.map((c) => ({ ...c, ...(progress[c.id] || {}) }));
    const done = live.reduce((n, c) => n + (c.state === 'ready' ? c.total : c.done || 0), 0), total = live.reduce((n, c) => n + c.total, 0);
    const err = live.find((c) => c.error)?.error;
    const working = live.find((c) => ['queued', 'downloading', 'verifying', 'unpacking'].includes(c.state));
    if (live.every((c) => c.state === 'ready')) return { ready: true, label: tr('mtg.ready', { size: GB(g.bytes) }) };
    if (working) return { busy: true, done, total, label: working.state === 'verifying' ? tr('mtg.checking') : working.state === 'unpacking' ? tr('mtg.installing') : tr('mtg.downloading', { pct: pct(done, total), size: GB(total) }) };
    if (live.some((c) => c.state === 'corrupt' || c.state === 'outdated')) return { label: tr('mtg.redo'), repair: true };
    const partial = live.some((c) => c.state === 'partial');
    return { label: err ? tr('mtg.stopped', { err }) : partial ? tr('mtg.paused', { pct: pct(done, total), size: GB(total) }) : tr('mtg.not-downloaded', { size: GB(total) }), error: !!err, partial };
  }
  function partRow(part, title, sub) {
    const s = partState(part), id = `fp-${part}`;
    const btn = s.ready ? `<button class="btn" type="button" data-feat="remove" data-part="${part}">${tr('mtg.remove')}</button>`
      : s.busy ? `<button class="btn" type="button" data-feat="cancel">${tr('mtg.cancel')}</button>`
        : `<button class="btn ${part === 'required' ? 'btn-primary' : ''}" type="button" data-feat="install" data-part="${part}" ${feature.busy ? 'disabled' : ''}>${s.partial ? tr('mtg.resume') : s.repair ? tr('mtg.download-again') : tr('mtg.download')}</button>`;
    return `<div class="row feature-part" data-part-row="${part}">
      <div class="row-main"><span class="row-title">${esc(title)}</span><span class="row-sub" id="${id}" ${s.error ? 'data-error="true"' : ''}>${esc(sub)} · ${esc(s.label)}</span>
        ${s.busy ? `<progress class="feature-progress" max="100" value="${pct(s.done, s.total)}" aria-labelledby="${id}"></progress>` : ''}</div>${btn}</div>`;
  }
  function sectionHtml() {
    const f = feature;
    if (!f.supported) return `<h3>${tr('app.optional-features')}</h3><div class="rows"><div class="row"><div class="row-main"><span class="row-title">${esc(tl('mtg', f.name))}</span><span class="row-sub">${tr('mtg.windows-only')}</span></div></div></div>`;
    const req = partState('required');
    const unsaved = f.unsaved.map((u) => `<div class="row"><div class="row-main"><span class="row-title">${tr('mtg.unsaved', { title: esc(u.title) })}</span><span class="row-sub">${tr('mtg.unsaved-sub', { n: u.segments, when: esc(new Date(u.started).toLocaleString()) })}</span></div>
      <button class="btn" type="button" data-feat="discard" data-work="${esc(u.id)}">${tr('mtg.discard')}</button><button class="btn btn-primary" type="button" data-feat="recover" data-work="${esc(u.id)}">${tr('mtg.save-transcript')}</button></div>`).join('');
    const lic = [...f.required.components, ...f.notes.components].map((c) => `<li><strong>${esc(c.name)}</strong> · ${esc(c.license)} · ${esc(c.attribution)} <button class="btn btn-quiet" type="button" data-open-url="${esc(c.licenseUrl)}">${tr('mtg.license')}</button></li>`).join('');
    return `<h3>${tr('app.optional-features')}</h3>
      <p class="group-note">${tr('mtg.group-note')}</p>
      <div class="rows">
        <div class="row"><div class="row-main"><span class="row-title" id="feat-meeting-title">${esc(tl('mtg', f.name))}</span><span class="row-sub">${esc(tl('mtg', f.description))}</span></div>
          <label class="switch"><input type="checkbox" role="switch" data-feat="enable" aria-labelledby="feat-meeting-title" ${f.enabled ? 'checked' : ''}></label></div>
        ${f.enabled ? partRow('required', tr('mtg.speech-model'), tr('mtg.needed')) : ''}
        ${f.enabled ? partRow('notes', tr('mtg.notes-model'), tr('mtg.notes-optional')) : ''}
        ${f.enabled && f.notes.ready ? `<div class="row"><div class="row-main"><span class="row-title" id="feat-auto">${tr('mtg.auto-notes')}</span><span class="row-sub">${tr('mtg.auto-notes-sub')}</span></div><label class="switch"><input type="checkbox" role="switch" data-feat="auto" aria-labelledby="feat-auto" ${f.autoNotes ? 'checked' : ''}></label></div>` : ''}
        ${f.enabled ? `<div class="row"><div class="row-main"><label class="row-title" for="feat-lang">${tr('mtg.language')}</label><span class="row-sub">${tr('mtg.language-sub')}</span></div>
          <select class="select" id="feat-lang" data-feat="lang">${[['', tr('mtg.detect')], ['it', 'Italiano'], ['en', 'English']].map(([v, l]) => `<option value="${v}" ${f.language === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}
        ${f.enabled && req.ready && f.detectSupported ? `<div class="row"><div class="row-main"><span class="row-title" id="feat-detect">${tr('mtg.detect-calls')}</span><span class="row-sub">${tr('mtg.detect-calls-sub')}</span></div><label class="switch"><input type="checkbox" role="switch" data-feat="detect" aria-labelledby="feat-detect" ${f.detectCalls ? 'checked' : ''}></label></div>` : ''}
        ${unsaved}
        ${f.enabled && req.ready ? `<div class="row"><div class="row-main"><span class="row-title">${tr('mtg.record')}</span><span class="row-sub">${tr('mtg.record-sub')}</span></div><button class="btn btn-primary" type="button" data-feat="start" ${f.session ? 'disabled' : ''}>${f.session ? tr('mtg.recording-btn') : tr('mtg.start')}</button></div>` : ''}
      </div>
      ${f.enabled ? `<details class="feature-licenses"><summary>${tr('mtg.licenses')}</summary><ul>${lic}</ul></details>` : ''}`;
  }
  const paint = () => { if (host?.isConnected && feature) { const focus = document.activeElement?.dataset?.feat; host.innerHTML = sectionHtml(); host.removeAttribute('aria-busy'); if (focus) host.querySelector(`[data-feat="${focus}"]`)?.focus(); } };
  async function refresh() { setFeature((await folio.features.list())[0]); paint(); return feature; }

  async function onClick(e) {
    const b = e.target.closest('[data-feat]'); if (!b || b.type === 'checkbox') return;
    const a = b.dataset.feat;
    try {
      if (a === 'install') { b.disabled = true; progress = {}; const p = folio.features.install('meeting-recorder', b.dataset.part); setTimeout(refresh, 50); setFeature((await p)[0]); progress = {}; paint(); }
      else if (a === 'cancel') await folio.features.cancel();
      else if (a === 'remove') { if (await confirm({ title: tr('mtg.remove-title'), body: tr('mtg.remove-body'), action: tr('mtg.remove'), danger: true })) { await folio.features.uninstall('meeting-recorder', b.dataset.part); openSettings(); } }
      else if (a === 'recover') { const p = await folio.meeting.recover(b.dataset.work); await refreshTree(); toast(tr('mtg.transcript-saved'), { action: [tr('mtg.open'), () => openFile(p)] }); await refresh(); }
      else if (a === 'discard') { if (await confirm({ title: tr('mtg.discard-title'), body: tr('mtg.discard-body'), action: tr('mtg.discard'), danger: true })) { await folio.meeting.discard(b.dataset.work); } openSettings(); }
      else if (a === 'start') { b.closest('dialog')?.close(); start(); }
    } catch (er) { toast(er.message, { kind: 'error' }); refresh(); }
  }
  async function onChange(e) {
    const el = e.target.closest('[data-feat]'); if (!el) return;
    try {
      if (el.dataset.feat === 'enable') { setFeature((await folio.features.set('meeting-recorder', { enabled: el.checked }))[0]); paint(); }
      if (el.dataset.feat === 'auto') { setFeature((await folio.features.set('meeting-recorder', { autoNotes: el.checked }))[0]); }
      if (el.dataset.feat === 'detect') { setFeature((await folio.features.set('meeting-recorder', { detectCalls: el.checked }))[0]); }
      if (el.dataset.feat === 'lang') { setFeature((await folio.features.set('meeting-recorder', { language: el.value }))[0]); }
    } catch (er) { toast(er.message, { kind: 'error' }); }
  }
  folio.features.onProgress((p) => { progress = p || {}; if (!Object.keys(progress).length) return refresh(); if (!host?.isConnected) return; for (const part of ['required', 'notes']) {
    const row = host.querySelector(`[data-part-row="${part}"]`); if (!row || !group(part)) continue;
    const s = partState(part); const sub = row.querySelector('.row-sub'); const bar = row.querySelector('progress');
    if (s.busy && !bar) { paint(); return; }
    if (bar) bar.value = pct(s.done, s.total);
    if (sub) sub.textContent = `${part === 'required' ? tr('mtg.needed') : tr('mtg.notes-optional')} · ${s.label}`;
  } });

  async function renderSettings(el) {
    host = el;
    el.addEventListener('click', onClick); el.addEventListener('change', onChange);
    await refresh();
  }

  /* ---------------- capture ---------------- */
  async function connect(track, stream) {
    const src = rec.ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(rec.ctx, 'folio-pcm16');
    node.port.onmessage = (e) => { rec.last[track] = performance.now(); folio.meeting.push(track, e.data); };
    src.connect(node); node.connect(rec.sink);
    for (const t of stream.getAudioTracks()) t.onended = () => rec && reacquire(track);
    rec.inputs[track] = { stream, src, node };
  }
  function disconnect(track) {
    const i = rec?.inputs[track]; if (!i) return;
    for (const t of i.stream.getTracks()) { t.onended = null; t.stop(); }
    try { i.src.disconnect(); i.node.disconnect(); i.node.port.onmessage = null; } catch {}
    delete rec.inputs[track];
  }
  const getMic = () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  async function getSystem() {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    for (const t of s.getVideoTracks()) t.stop(); // only the sound is used; the picture is dropped at once
    if (!s.getAudioTracks().length) throw new Error('No computer sound was given.');
    return s;
  }
  /** a stream that stops delivering audio (a headset unplugged, a device switched) is opened again */
  async function reacquire(track) {
    if (!rec || rec.busy[track]) return;
    rec.busy[track] = true;
    try { disconnect(track); await connect(track, track === 'me' ? await getMic() : await getSystem()); rec.last[track] = performance.now(); toast(track === 'me' ? tr('mtg.mic-back') : tr('mtg.sound-back')); }
    catch { rec.lost[track] = true; } finally { if (rec) rec.busy[track] = false; }
  }
  function watchdog() {
    const now = performance.now();
    for (const track of Object.keys(rec.inputs)) if (now - (rec.last[track] || rec.t0) > 3000 && now - (rec.tried[track] || 0) > 10000) { rec.tried[track] = now; reacquire(track); }
    paintBar();
  }

  /* ---------------- recording bar ---------------- */
  function paintBar() {
    if (!state || state.phase === 'idle') { bar?.remove(); bar = null; return; }
    if (!bar) { bar = document.createElement('div'); bar.className = 'meeting-bar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', tr('mtg.bar-label')); document.body.appendChild(bar); bar.addEventListener('click', (e) => { if (e.target.closest('[data-meeting-stop]')) stop(); }); }
    const p = state.phase, pr = state.progress;
    const label = p === 'starting' ? tr('mtg.starting') : p === 'recording' ? tr('mtg.rec-clock', { time: clock(Date.now() - new Date(state.started).getTime()) }) : p === 'transcribing' ? tr('mtg.finishing')
      : p === 'notes' ? (pr?.step === 'loading' ? tr('mtg.loading-notes') : pr?.total ? tr('mtg.writing-n', { n: Math.min(pr.done + 1, pr.total), total: pr.total }) : tr('mtg.writing')) : p === 'saved' ? tr('mtg.saved') : '';
    const html = `<span class="meeting-dot" data-live="${p === 'recording'}" aria-hidden="true"></span><span class="meeting-label" aria-live="polite">${esc(label)}</span>${rec?.lost?.them ? `<span class="meeting-warn">${tr('mtg.no-sound')}</span>` : ''}${p === 'recording' ? `<button class="btn" type="button" data-meeting-stop>${tr('mtg.stop')}</button>` : ''}`;
    if (bar.innerHTML !== html) bar.innerHTML = html;
  }
  let lastError = null;
  folio.meeting.onState((s) => {
    state = s; paintBar(); if (host?.isConnected) refresh();
    if (!s || s.phase === 'idle' || s.phase === 'starting') lastError = null; // each recording shows its own errors
    if (s?.error && s.error !== lastError) { lastError = s.error; toast(s.error, { kind: 'error' }); }
    if (s?.phase === 'idle' && s.path && state?.progress !== undefined) refreshTree();
  });
  folio.meeting.onStopRequest(({ reason }) => { toast(reason, { kind: 'error' }); stop(); });

  /** `title` given (a call the app noticed) or `quick` (the sidebar button): no question about the title, the note can be renamed after */
  async function start({ title: given, quick } = {}) {
    if (rec) return;
    try {
      const f = await refresh();
      if (f.session) return toast(tr('mtg.still-saving'));
      if (!f.supported || !f.enabled || !f.required.ready) { toast(tr('mtg.turn-on')); return openSettings(); }
      if (!f.noticeSeen) {
        const ok = await confirm({ title: tr('mtg.notice-title'), body: tr('mtg.notice-body'), action: tr('mtg.understand') });
        if (!ok) return;
        await folio.features.set('meeting-recorder', { noticeSeen: true });
      }
      const title = quick || typeof given === 'string' ? given || '' : await prompt({ title: tr('mtg.record'), label: tr('mtg.title'), value: '', hint: tr('mtg.title-hint'), action: tr('mtg.start'), allowEmpty: true, validate: false });
      if (title === null) return;
      state = { phase: 'starting', started: new Date().toISOString() }; paintBar();
      await folio.meeting.start({ title });
      for (let i = 0; i < 40 && !folio.meeting.ready(); i++) await new Promise((r) => setTimeout(r, 50));
      const ctx = new AudioContext({ sampleRate: 16000 });
      await ctx.audioWorklet.addModule('./meeting-worklet.js');
      const sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination); // keeps the graph running without playing anything
      rec = { ctx, sink, inputs: {}, last: {}, busy: {}, tried: {}, lost: {}, t0: performance.now() };
      try { await connect('me', await getMic()); } catch (e) { throw new Error(tr('mtg.mic-unavailable', { err: e.message })); }
      try { await connect('them', await getSystem()); } catch { rec.lost.them = true; toast(tr('mtg.sound-unavailable'), { kind: 'error' }); }
      rec.timer = setInterval(watchdog, 1000);
    } catch (e) {
      toast(e.message, { kind: 'error' });
      teardown();
      await folio.meeting.stop().catch(() => {});
      state = null; paintBar();
    }
  }
  function teardown() {
    if (!rec) return;
    clearInterval(rec.timer);
    for (const t of Object.keys(rec.inputs)) disconnect(t);
    rec.ctx.close().catch(() => {});
    rec = null;
  }
  async function stop() {
    if (!rec && state?.phase !== 'recording') return;
    teardown();
    try {
      const r = await folio.meeting.stop();
      await refreshTree();
      if (r?.path) toast(tr('mtg.meeting-saved'), { action: [tr('mtg.open'), () => openFile(r.path)] });
    } catch (e) { toast(e.message, { kind: 'error' }); }
  }
  return { renderSettings, start, stop, toggle: () => (rec ? stop() : start()), quickToggle: () => (rec || state?.phase === 'recording' ? stop() : start({ quick: true })), recording: () => !!rec };
}
