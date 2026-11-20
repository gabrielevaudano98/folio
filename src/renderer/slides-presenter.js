// Folio — presenter view: the current slide (live), the next one, speaker notes, timer, clock and tools.
// With "Audience window" the show also runs full screen on a second display, kept in step with this one.
import { startShow } from './slides-present.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const mmss = (ms) => { const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return `${h ? h + ':' + String(m).padStart(2, '0') : m}:${String(s % 60).padStart(2, '0')}`; };

/**
 * opts: deck, order, start, renderSlide, hydrate, openLink, onExit(slide, { times }), rehearse (record time per slide),
 * qa: { start() → { url, qr }, poll() → questions, stop() }, record: { start(), stop() → Promise<Blob[]> by slide }
 */
export function startPresenterView(opts) {
  const { deck, order, renderSlide, rehearse = false } = opts;
  const ov = document.createElement('div'); ov.className = 'pv'; ov.tabIndex = 0; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Presenter view');
  ov.innerHTML = `<header class="pv-bar">
      <div class="pv-time"><span class="pv-elapsed" aria-live="off">0:00</span><button type="button" class="pv-btn" data-pv="pause" aria-label="Pause timer">Pause</button><button type="button" class="pv-btn" data-pv="reset">Reset</button><span class="pv-clock"></span></div>
      <div class="pv-tools" role="toolbar" aria-label="Tools">
        <button type="button" class="pv-btn" data-pv="tool" data-t="laser" title="Laser pointer (Ctrl+L)">Laser</button><button type="button" class="pv-btn" data-pv="tool" data-t="pen" title="Pen (Ctrl+P)">Pen</button><button type="button" class="pv-btn" data-pv="tool" data-t="highlighter" title="Highlighter (Ctrl+I)">Highlighter</button><button type="button" class="pv-btn" data-pv="tool" data-t="eraser" title="Eraser (Ctrl+E)">Eraser</button>
        <button type="button" class="pv-btn" data-pv="black" title="Black screen (B)">Black</button><button type="button" class="pv-btn" data-pv="zoom" title="Magnifier (+ and −)">Zoom</button>
        <button type="button" class="pv-btn" data-pv="audience">Audience window</button>${opts.qa ? '<button type="button" class="pv-btn" data-pv="qa">Q&amp;A</button>' : ''}${opts.record ? '<button type="button" class="pv-btn" data-pv="record">Record narration</button>' : ''}
      </div>
      <div class="pv-end"><span class="pv-count"></span><button type="button" class="pv-btn pv-primary" data-pv="end">End show</button></div>
    </header>
    <main class="pv-main"><section class="pv-cur" aria-label="Current slide"></section>
      <aside class="pv-side"><div class="pv-next-wrap"><h2>Next</h2><div class="pv-next" aria-label="Next slide"></div></div>
        <div class="pv-notes-wrap"><h2>Notes <span class="pv-font"><button type="button" class="pv-btn" data-pv="smaller" aria-label="Smaller notes">A−</button><button type="button" class="pv-btn" data-pv="bigger" aria-label="Bigger notes">A+</button></span></h2><div class="pv-notes" tabindex="0"></div></div>
        <div class="pv-qa" hidden><h2>Questions</h2><div class="pv-qa-link"></div><ol class="pv-qa-list"></ol></div>
      </aside></main>
    <footer class="pv-nav"><button type="button" class="pv-btn" data-pv="prev">Previous</button><span class="pv-step"></span><button type="button" class="pv-btn pv-primary" data-pv="next">Next</button></footer>`;
  document.body.appendChild(ov);
  const $ = (s) => ov.querySelector(s);
  let started = Date.now(), pausedAt = null, slideStart = Date.now(), notesSize = 20, aud = null, audWin = null;
  const times = new Map(); let typed = '';
  const tick = () => { const now = pausedAt ?? Date.now(); $('.pv-elapsed').textContent = mmss(now - started); $('.pv-clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  const clock = setInterval(tick, 500); tick();
  const nextPreview = (i, step, steps) => {
    const box = $('.pv-next'); const w = box.clientWidth || 360; const k = w / deck.width;
    if (step < steps) { box.innerHTML = `<div class="pv-build">Next click: build ${step + 1} of ${steps} on this slide</div>`; return; }
    const n = order[i + 1];
    box.innerHTML = n ? `<div class="sl-scale" style="width:${deck.width}px;height:${deck.height}px;transform:scale(${k});transform-origin:0 0">${renderSlide(deck, n)}</div>` : '<div class="pv-build">End of show</div>';
    box.style.height = deck.height * k + 'px'; if (n) opts.hydrate?.(box);
  };
  let lastI = -1;
  const onChange = ({ i, step, steps, slide }) => {
    if (i !== lastI) { if (lastI >= 0 && rehearse) times.set(order[lastI].index, (times.get(order[lastI].index) || 0) + (Date.now() - slideStart)); slideStart = Date.now(); lastI = i; }
    $('.pv-count').textContent = `Slide ${i + 1} of ${order.length}`;
    $('.pv-step').textContent = steps ? `Build ${step} of ${steps}` : '';
    $('.pv-notes').innerHTML = slide.notes ? slide.notes.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('') : '<p class="pv-empty">No notes for this slide.</p>';
    nextPreview(i, step, steps);
    // keep the audience window on the same slide and build
    if (aud && (aud.i !== i || aud.step !== step)) { if (aud.i === i && aud.step === step - 1) aud.next(); else if (aud.i === i - 1 && step === 0) aud.next(); else aud.seek(i, step); }
  };
  const cur = startShow({ ...opts, root: $('.pv-cur'), fullscreen: false, keys: false, onChange, onExit: undefined });
  const end = () => {
    clearInterval(clock); if (rehearse && lastI >= 0) times.set(order[lastI].index, (times.get(order[lastI].index) || 0) + (Date.now() - slideStart));
    try { audWin?.close(); } catch {} opts.qa?.stop?.();
    ov.remove(); document.exitFullscreen?.().catch(() => {});
    opts.onExit?.(order[cur.i], { times: rehearse ? times : null });
  };
  const both = (fn) => { fn(cur); };
  ov.addEventListener('keydown', (e) => {
    if (e.target !== ov && e.target.closest('.presenter')) return; // the show's own keys
    const k = e.key; const ctrl = e.ctrlKey || e.metaKey;
    if (/^[0-9]$/.test(k) && !ctrl) { typed += k; e.preventDefault(); return; }
    if (k === 'Enter' && typed) { const n = order.findIndex((x) => x.number === +typed); typed = ''; if (n >= 0) cur.go(n); e.preventDefault(); return; }
    typed = '';
    if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'n', 'Enter'].includes(k) && !ctrl) both((s) => s.next());
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'p', 'Backspace'].includes(k) && !ctrl) both((s) => s.prev());
    else if (k === 'Escape' && !ov.querySelector('.presenter[data-tool]:not([data-tool=""])')) end();
    else { if (e.target !== ov) return; const fwd = (o) => o?.overlay.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, bubbles: false, cancelable: true })); fwd(cur); fwd(aud); return; }
    e.preventDefault();
  });
  ov.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pv]'); if (!b) return; const a = b.dataset.pv;
    if (a === 'next') cur.next(); else if (a === 'prev') cur.prev(); else if (a === 'end') end();
    else if (a === 'pause') { if (pausedAt) { started += Date.now() - pausedAt; pausedAt = null; b.textContent = 'Pause'; } else { pausedAt = Date.now(); b.textContent = 'Resume'; } cur.pause(!!pausedAt); }
    else if (a === 'reset') { started = Date.now(); if (pausedAt) pausedAt = started; }
    else if (a === 'tool') { const t = cur.tool(b.dataset.t === ov.dataset.tool ? null : b.dataset.t); aud?.tool(t); ov.dataset.tool = t || ''; ov.querySelectorAll('[data-pv=tool]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.t === t))); }
    else if (a === 'black') { const c = cur.screen('black'); aud?.screen(c ? 'black' : null); b.setAttribute('aria-pressed', String(!!c)); }
    else if (a === 'zoom') b.setAttribute('aria-pressed', String(cur.magnify()));
    else if (a === 'smaller' || a === 'bigger') { notesSize = Math.max(12, Math.min(44, notesSize + (a === 'bigger' ? 2 : -2))); $('.pv-notes').style.fontSize = notesSize + 'px'; }
    else if (a === 'audience') openAudience();
    else if (a === 'qa') toggleQa();
    else if (a === 'record') toggleRecord(b);
    ov.focus();
  });
  /* the audience window: the same show, full screen on another display */
  function openAudience() {
    if (audWin && !audWin.closed) { audWin.focus(); return; }
    audWin = window.open('', 'folio-audience', 'popup,width=1280,height=720');
    if (!audWin) { opts.toast?.('The audience window could not open.'); return; }
    const d = audWin.document; d.title = 'Folio — audience';
    d.head.innerHTML = [...document.querySelectorAll('style, link[rel=stylesheet]')].map((n) => (n.tagName === 'LINK' ? `<link rel="stylesheet" href="${n.href}">` : n.outerHTML)).join('');
    d.body.style.margin = '0'; d.body.style.background = '#000';
    aud = startShow({ ...opts, start: cur.i, win: audWin, fullscreen: true, keys: true, onChange: undefined, onExit: () => { aud = null; } });
    aud.seek(cur.i, cur.step);
    // clicks and keys in the audience window drive the presenter too
    aud.overlay.addEventListener('keydown', (e) => { if (['ArrowRight', ' ', 'PageDown', 'Enter', 'ArrowLeft', 'PageUp'].includes(e.key)) setTimeout(() => { if (aud && (aud.i !== cur.i || aud.step !== cur.step)) cur.seek(aud.i, aud.step); }, 0); });
    $('[data-pv=audience]').setAttribute('aria-pressed', 'true');
  }
  /* audience questions over the local network */
  let qaTimer = null;
  async function toggleQa() {
    const box = $('.pv-qa');
    if (!box.hidden) { box.hidden = true; clearInterval(qaTimer); opts.qa.stop?.(); return; }
    const { url, qr } = await opts.qa.start(); box.hidden = false;
    $('.pv-qa-link').innerHTML = `<div class="pv-qr">${qr}</div><p>Ask at <b>${esc(url)}</b></p>`;
    const poll = async () => { const qs = await opts.qa.poll(); $('.pv-qa-list').innerHTML = qs.map((q) => `<li><p>${esc(q.text)}</p><span>${esc(q.name || 'Anonymous')} · ${new Date(q.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></li>`).join('') || '<li class="pv-empty">No questions yet.</li>'; };
    poll(); qaTimer = setInterval(poll, 2000);
  }
  /* narration: one audio clip per slide */
  let recording = null;
  async function toggleRecord(b) {
    if (recording) { const r = recording; recording = null; b.textContent = 'Record narration'; b.setAttribute('aria-pressed', 'false'); await r.stop(); return; }
    try { recording = await opts.record.start(() => order[cur.i]); b.textContent = 'Stop recording'; b.setAttribute('aria-pressed', 'true'); } catch (err) { opts.toast?.(`Recording needs a microphone. ${err.message}`); }
  }
  ov.focus();
  document.documentElement.requestFullscreen?.().catch(() => {});
  const api = { show: cur, get audience() { return aud; }, end, overlay: ov, openAudience, times };
  return api;
}
