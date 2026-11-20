// Folio — meeting recorder in the window: the Settings section, audio capture and the recording bar.
// Loaded on demand (opening Settings or starting a recording), so it costs nothing at startup.
// Capture: the microphone ('me') and the computer's sound ('them', Windows loopback) go through one AudioContext at
// 16 kHz into an AudioWorklet, which posts 100 ms Int16 blocks; they travel on a MessagePort straight to the worker.

const GB = (n) => `${(n / 2 ** 30).toFixed(n >= 2 ** 30 ? 1 : 2)} GB`;
const pct = (d, t) => (t ? Math.min(100, Math.floor((d / t) * 100)) : 0);
const clock = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function createMeeting(ui) {
  const { esc, toast, confirm, prompt, openFile, refreshTree, openSettings } = ui;
  let feature = null, host = null, progress = {}, rec = null, bar = null, state = null;

  /* ---------------- Settings section ---------------- */
  const group = (part) => feature?.[part];
  function partState(part) {
    const g = group(part); if (!g) return { label: '', busy: false };
    const live = g.components.map((c) => ({ ...c, ...(progress[c.id] || {}) }));
    const done = live.reduce((n, c) => n + (c.state === 'ready' ? c.total : c.done || 0), 0), total = live.reduce((n, c) => n + c.total, 0);
    const err = live.find((c) => c.error)?.error;
    const working = live.find((c) => ['queued', 'downloading', 'verifying', 'unpacking'].includes(c.state));
    if (live.every((c) => c.state === 'ready')) return { ready: true, label: `Ready · ${GB(g.bytes)}` };
    if (working) return { busy: true, done, total, label: working.state === 'verifying' ? 'Checking the download…' : working.state === 'unpacking' ? 'Installing…' : `Downloading ${pct(done, total)}% of ${GB(total)}` };
    if (live.some((c) => c.state === 'corrupt' || c.state === 'outdated')) return { label: 'Needs to be downloaded again', repair: true };
    const partial = live.some((c) => c.state === 'partial');
    return { label: err ? `Download stopped: ${err}` : partial ? `Paused at ${pct(done, total)}% · ${GB(total)}` : `Not downloaded · ${GB(total)}`, error: !!err, partial };
  }
  function partRow(part, title, sub) {
    const s = partState(part), id = `fp-${part}`;
    const btn = s.ready ? `<button class="btn" type="button" data-feat="remove" data-part="${part}">Remove</button>`
      : s.busy ? `<button class="btn" type="button" data-feat="cancel">Cancel</button>`
        : `<button class="btn ${part === 'required' ? 'btn-primary' : ''}" type="button" data-feat="install" data-part="${part}" ${feature.busy ? 'disabled' : ''}>${s.partial ? 'Resume' : s.repair ? 'Download again' : 'Download'}</button>`;
    return `<div class="row feature-part" data-part-row="${part}">
      <div class="row-main"><span class="row-title">${esc(title)}</span><span class="row-sub" id="${id}" ${s.error ? 'data-error="true"' : ''}>${esc(sub)} · ${esc(s.label)}</span>
        ${s.busy ? `<progress class="feature-progress" max="100" value="${pct(s.done, s.total)}" aria-labelledby="${id}"></progress>` : ''}</div>${btn}</div>`;
  }
  function sectionHtml() {
    const f = feature;
    if (!f.supported) return `<h3>Optional features</h3><div class="rows"><div class="row"><div class="row-main"><span class="row-title">${esc(f.name)}</span><span class="row-sub">Available on Windows for now.</span></div></div></div>`;
    const req = partState('required');
    const unsaved = f.unsaved.map((u) => `<div class="row"><div class="row-main"><span class="row-title">Unsaved recording: ${esc(u.title)}</span><span class="row-sub">${esc(new Date(u.started).toLocaleString())} · ${u.segments} lines. Folio closed before it was saved.</span></div>
      <button class="btn" type="button" data-feat="discard" data-work="${esc(u.id)}">Discard</button><button class="btn btn-primary" type="button" data-feat="recover" data-work="${esc(u.id)}">Save transcript</button></div>`).join('');
    const lic = [...f.required.components, ...f.notes.components].map((c) => `<li><strong>${esc(c.name)}</strong> · ${esc(c.license)} · ${esc(c.attribution)} <button class="btn btn-quiet" type="button" data-open-url="${esc(c.licenseUrl)}">License</button></li>`).join('');
    return `<h3>Optional features</h3>
      <p class="group-note">Downloaded only if you turn them on. While recording, the meeting recorder uses up to 3 GB of memory; when idle it uses none.</p>
      <div class="rows">
        <div class="row"><div class="row-main"><span class="row-title" id="feat-meeting-title">${esc(f.name)}</span><span class="row-sub">${esc(f.description)}</span></div>
          <label class="switch"><input type="checkbox" role="switch" data-feat="enable" aria-labelledby="feat-meeting-title" ${f.enabled ? 'checked' : ''}></label></div>
        ${f.enabled ? partRow('required', 'Speech model', 'Needed to record') : ''}
        ${f.enabled ? partRow('notes', 'Notes model', 'Optional: summary, decisions and action items') : ''}
        ${f.enabled && f.notes.ready ? `<div class="row"><div class="row-main"><span class="row-title" id="feat-auto">Write notes after each meeting</span><span class="row-sub">Every point quotes a line of the transcript; check them before you share.</span></div><label class="switch"><input type="checkbox" role="switch" data-feat="auto" aria-labelledby="feat-auto" ${f.autoNotes ? 'checked' : ''}></label></div>` : ''}
        ${f.enabled ? `<div class="row"><div class="row-main"><label class="row-title" for="feat-lang">Meeting language</label><span class="row-sub">Detect works for mixed Italian and English; a fixed language is a little more accurate.</span></div>
          <select class="select" id="feat-lang" data-feat="lang">${[['', 'Detect'], ['it', 'Italiano'], ['en', 'English']].map(([v, l]) => `<option value="${v}" ${f.language === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}
        ${unsaved}
        ${f.enabled && req.ready ? `<div class="row"><div class="row-main"><span class="row-title">Record a meeting</span><span class="row-sub">Use headphones, and tell everyone you are recording.</span></div><button class="btn btn-primary" type="button" data-feat="start" ${f.session ? 'disabled' : ''}>${f.session ? 'Recording…' : 'Start recording'}</button></div>` : ''}
      </div>
      ${f.enabled ? `<details class="feature-licenses"><summary>Licenses of the downloaded parts</summary><ul>${lic}</ul></details>` : ''}`;
  }
  const paint = () => { if (host?.isConnected && feature) { const focus = document.activeElement?.dataset?.feat; host.innerHTML = sectionHtml(); host.removeAttribute('aria-busy'); if (focus) host.querySelector(`[data-feat="${focus}"]`)?.focus(); } };
  async function refresh() { [feature] = await folio.features.list(); paint(); return feature; }

  async function onClick(e) {
    const b = e.target.closest('[data-feat]'); if (!b || b.type === 'checkbox') return;
    const a = b.dataset.feat;
    try {
      if (a === 'install') { b.disabled = true; progress = {}; const p = folio.features.install('meeting-recorder', b.dataset.part); setTimeout(refresh, 50); feature = (await p)[0]; progress = {}; paint(); }
      else if (a === 'cancel') await folio.features.cancel();
      else if (a === 'remove') { if (await confirm({ title: 'Remove this download?', body: 'You can download it again later.', action: 'Remove', danger: true })) { await folio.features.uninstall('meeting-recorder', b.dataset.part); openSettings(); } }
      else if (a === 'recover') { const p = await folio.meeting.recover(b.dataset.work); await refreshTree(); toast('Transcript saved.', { action: ['Open', () => openFile(p)] }); await refresh(); }
      else if (a === 'discard') { if (await confirm({ title: 'Discard this recording?', body: 'Its transcript will be deleted.', action: 'Discard', danger: true })) { await folio.meeting.discard(b.dataset.work); } openSettings(); }
      else if (a === 'start') { b.closest('dialog')?.close(); start(); }
    } catch (er) { toast(er.message, { kind: 'error' }); refresh(); }
  }
  async function onChange(e) {
    const el = e.target.closest('[data-feat]'); if (!el) return;
    try {
      if (el.dataset.feat === 'enable') { [feature] = await folio.features.set('meeting-recorder', { enabled: el.checked }); paint(); }
      if (el.dataset.feat === 'auto') { [feature] = await folio.features.set('meeting-recorder', { autoNotes: el.checked }); }
      if (el.dataset.feat === 'lang') { [feature] = await folio.features.set('meeting-recorder', { language: el.value }); }
    } catch (er) { toast(er.message, { kind: 'error' }); }
  }
  folio.features.onProgress((p) => { progress = p || {}; if (!Object.keys(progress).length) return refresh(); if (!host?.isConnected) return; for (const part of ['required', 'notes']) {
    const row = host.querySelector(`[data-part-row="${part}"]`); if (!row || !group(part)) continue;
    const s = partState(part); const sub = row.querySelector('.row-sub'); const bar = row.querySelector('progress');
    if (s.busy && !bar) { paint(); return; }
    if (bar) bar.value = pct(s.done, s.total);
    if (sub) sub.textContent = `${part === 'required' ? 'Needed to record' : 'Optional: summary, decisions and action items'} · ${s.label}`;
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
    try { disconnect(track); await connect(track, track === 'me' ? await getMic() : await getSystem()); rec.last[track] = performance.now(); toast(track === 'me' ? 'Microphone reconnected.' : 'Computer sound reconnected.'); }
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
    if (!bar) { bar = document.createElement('div'); bar.className = 'meeting-bar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Meeting recording'); document.body.appendChild(bar); bar.addEventListener('click', (e) => { if (e.target.closest('[data-meeting-stop]')) stop(); }); }
    const p = state.phase, pr = state.progress;
    const label = p === 'starting' ? 'Starting…' : p === 'recording' ? `Recording · ${clock(Date.now() - new Date(state.started).getTime())}` : p === 'transcribing' ? 'Finishing the transcript…'
      : p === 'notes' ? (pr?.step === 'loading' ? 'Loading the notes model…' : pr?.total ? `Writing notes ${Math.min(pr.done + 1, pr.total)} of ${pr.total}…` : 'Writing notes…') : p === 'saved' ? 'Saved' : '';
    const html = `<span class="meeting-dot" data-live="${p === 'recording'}" aria-hidden="true"></span><span class="meeting-label" aria-live="polite">${esc(label)}</span>${rec?.lost?.them ? '<span class="meeting-warn">No computer sound</span>' : ''}${p === 'recording' ? '<button class="btn" type="button" data-meeting-stop>Stop</button>' : ''}`;
    if (bar.innerHTML !== html) bar.innerHTML = html;
  }
  let lastError = null;
  folio.meeting.onState((s) => {
    state = s; paintBar(); if (host?.isConnected) refresh();
    if (s?.error && s.error !== lastError) { lastError = s.error; toast(s.error, { kind: 'error' }); }
    if (s?.phase === 'idle' && s.path && state?.progress !== undefined) refreshTree();
  });
  folio.meeting.onStopRequest(({ reason }) => { toast(reason, { kind: 'error' }); stop(); });

  async function start() {
    if (rec) return;
    try {
      const f = await refresh();
      if (f.session) return toast('A recording is still being saved. Try again in a moment.');
      if (!f.supported || !f.enabled || !f.required.ready) { toast('Turn on the meeting recorder and download its speech model in Settings first.'); return openSettings(); }
      if (!f.noticeSeen) {
        const ok = await confirm({ title: 'Before you record', body: 'Tell everyone on the call that you are recording, and check that your organisation allows it. Use headphones: without them your microphone also picks up the other people.', action: 'I understand' });
        if (!ok) return;
        await folio.features.set('meeting-recorder', { noticeSeen: true });
      }
      const title = await prompt({ title: 'Record a meeting', label: 'Title', value: '', hint: 'Optional. Used for the note’s name.', action: 'Start recording', allowEmpty: true, validate: false });
      if (title === null) return;
      state = { phase: 'starting', started: new Date().toISOString() }; paintBar();
      await folio.meeting.start({ title });
      for (let i = 0; i < 40 && !folio.meeting.ready(); i++) await new Promise((r) => setTimeout(r, 50));
      const ctx = new AudioContext({ sampleRate: 16000 });
      await ctx.audioWorklet.addModule('./meeting-worklet.js');
      const sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination); // keeps the graph running without playing anything
      rec = { ctx, sink, inputs: {}, last: {}, busy: {}, tried: {}, lost: {}, t0: performance.now() };
      try { await connect('me', await getMic()); } catch (e) { throw new Error(`The microphone is not available: ${e.message}`); }
      try { await connect('them', await getSystem()); } catch { rec.lost.them = true; toast('The computer’s sound is not available, so only your microphone is recorded.', { kind: 'error' }); }
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
      if (r?.path) toast('Meeting saved.', { action: ['Open', () => openFile(r.path)] });
    } catch (e) { toast(e.message, { kind: 'error' }); }
  }
  return { renderSettings, start, stop, toggle: () => (rec ? stop() : start()), recording: () => !!rec };
}
