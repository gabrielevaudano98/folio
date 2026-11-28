// Folio — the slide show: build steps, transitions, Morph, and the controls around them.
import { buildSteps, hiddenAtStart, keyframes, transitionFrames, parseTransition, withFragments, FRAGMENTS } from './slides-motion.js';

const EASE = 'cubic-bezier(.2,.7,.2,1)';

/** the elements an animation moves on a rendered slide */
const fragmentsIn = (sec) => [...sec.querySelectorAll('[data-fragment]')].filter((el) => !el.closest('.sl-master, .sl-zoom-view'));
export function targetsOf(sec, slide, a) {
  if (a.target === FRAGMENTS) return fragmentsIn(sec);
  if (a.target === 'body') {
    const body = sec.querySelector('.sl-body, .sl-phs .sl-ph-body'); if (!body) return [];
    if (a.by !== 'paragraph') return [body];
    return [...body.querySelectorAll(':scope > p, :scope > ul > li, :scope > ol > li, :scope > blockquote, :scope > h2, :scope > h3, :scope > pre, :scope > table, :scope > div')];
  }
  const n = (slide.objects || []).findIndex((o) => o.id === a.target);
  const el = n >= 0 ? sec.querySelector(`.sl-placed > [data-obj="${n}"]`) : null;
  if (!el) return [];
  if (a.by !== 'paragraph') return [el];
  const parts = [...el.querySelectorAll(':scope > p, :scope > ul > li, :scope > ol > li, :scope > .sl-obj-text > p, :scope > .sl-obj-text > ul > li')];
  return parts.length ? parts : [el];
}

/** a rendered slide made ready to build: entrance targets hidden, steps computed */
export function prepareSlide(sec, slide, { W = 1280, H = 720 } = {}) {
  const anims = withFragments(slide.animations, fragmentsIn(sec).length);
  const steps = buildSteps(anims, (a) => targetsOf(sec, slide, a).length);
  for (const a of hiddenAtStart(anims)) for (const el of targetsOf(sec, slide, a)) el.style.visibility = 'hidden';
  const running = [];
  const play = (k, { instant = false } = {}) => {
    for (const r of running.splice(0)) r.finish();
    for (const { anim, start } of steps[k] || []) {
      const els = targetsOf(sec, slide, anim); const list = anim.part != null ? [els[anim.part]].filter(Boolean) : els;
      for (const el of list) {
        el.style.visibility = '';
        const box = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, W, H };
        const frames = keyframes(anim, box);
        const end = anim.kind === 'exit' ? 'hidden' : '';
        const run = el.animate(frames, { duration: anim.duration * 1000, delay: start * 1000, iterations: anim.repeat, easing: anim.kind === 'emphasis' ? 'ease-in-out' : EASE, fill: anim.kind === 'path' || anim.kind === 'exit' ? 'forwards' : 'backwards' });
        if (end) run.finished.then(() => { el.style.visibility = 'hidden'; }).catch(() => {});
        if (anim.kind === 'entrance' && start > 0) { el.style.visibility = 'hidden'; setTimeout(() => { el.style.visibility = ''; }, start * 1000); }
        running.push(run);
        if (instant) run.finish();
      }
    }
  };
  return { steps, play, finish: () => running.splice(0).forEach((r) => r.finish()), running };
}

/**
 * start a show in an overlay. `order` is the list of slides to show (the deck's shown slides, or a custom show).
 * Hooks: onChange({ i, step }) after every move, decorate(overlay) to add tools.
 */
/** the slides of a custom show: `show-<name>: 1, 3, 5-7` in the front matter (slide numbers) */
export function customShows(deck) {
  const out = {};
  for (const [k, v] of Object.entries(deck.global || {})) {
    if (!k.startsWith('show-')) continue;
    const nums = String(v).split(',').flatMap((p) => { const m = p.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/); if (!m) return []; const a = +m[1], b = +(m[2] || m[1]); return Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i); });
    const slides = nums.map((n) => deck.slides.find((x) => !x.master && x.number === n)).filter(Boolean);
    if (slides.length) out[k.slice(5)] = slides;
  }
  return out;
}
const secsOf = (v) => { const m = String(v ?? '').trim().match(/^(\d*\.?\d+)\s*(ms|s)?$/); return m ? (m[2] === 'ms' ? +m[1] / 1000 : +m[1]) : null; };

export function startShow({ deck, order, start = 0, renderSlide, hydrate, onExit, onChange, decorate, navigate, openLink, root = null, win = window, fullscreen = true, keys = true }) {
  const doc = win.document;
  const ov = doc.createElement('div');
  ov.className = 'presenter'; ov.tabIndex = 0; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Presentation');
  ov.innerHTML = '<div class="pr-stage"></div><div class="pr-bar"></div>';
  if (root) ov.classList.add('is-embedded'); (root || doc.body).appendChild(ov);
  const stage = ov.querySelector('.pr-stage'), bar = ov.querySelector('.pr-bar');
  let i = Math.max(0, Math.min(order.length - 1, start)), step = 0, layer = null, prep = null, busy = null, k = 1;
  const history = [];
  const size = () => { const bw = root ? root.clientWidth : win.innerWidth, bh = root ? root.clientHeight : win.innerHeight; k = Math.min(bw / deck.width, bh / deck.height); stage.style.width = deck.width * k + 'px'; stage.style.height = deck.height * k + 'px'; for (const l of stage.children) l.style.transform = `scale(${k})`; };
  const make = (n) => {
    const l = doc.createElement('div'); l.className = 'sl-scale pr-layer'; l.style.transform = `scale(${k})`;
    l.innerHTML = renderSlide(deck, order[n]); hydrate?.(l); stage.appendChild(l);
    const sec = l.querySelector('section.slide');
    return { l, sec, n, prep: prepareSlide(sec, order[n], { W: deck.width, H: deck.height }) };
  };
  const status = () => { bar.textContent = `${i + 1} / ${order.length}`; onChange?.({ i, step, slide: order[i], steps: prep?.steps.length || 0 }); };
  /** show slide n at a build step (0 = nothing built, Infinity = all), with or without its transition */
  const show = (n, at = 0, { animate = true } = {}) => {
    busy?.forEach((a) => a.finish());
    const from = layer; const next = make(n);
    const built = Math.min(at, next.prep.steps.length);
    for (let s = 0; s < built; s++) next.prep.play(s, { instant: true });
    const t = parseTransition(order[n].transition ?? deck.global.transition ?? 'none');
    if (from && animate && t.name !== 'none' && !win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const ms = t.duration * 1000;
      if (t.name === 'morph') busy = morph(from, next, ms);
      else { const [outF, inF] = transitionFrames(t.name, deck.width, deck.height); busy = [from.l.firstElementChild.animate(outF, { duration: ms, easing: EASE, fill: 'forwards' }), next.l.firstElementChild.animate(inF, { duration: ms, easing: EASE, fill: 'backwards' })]; }
      Promise.all(busy.map((a) => a.finished.catch(() => {}))).then(() => { from.l.remove(); busy = null; });
    } else from?.l.remove();
    layer = next; prep = next.prep; i = n; step = built; status();
    for (const m of next.sec.querySelectorAll('[data-autoplay]')) { try { m.currentTime = 0; m.play()?.catch?.(() => {}); } catch {} }
    stage.appendChild(canvas); stage.appendChild(laser); redraw?.();
    schedule();
  };
  // auto-advance: `advance: 5s` on a slide (or in the front matter) moves on after that time, builds first
  let timer = null; const kiosk = String(deck.global.kiosk) === 'true';
  const schedule = () => {
    clearTimeout(timer); timer = null;
    const t = secsOf(order[i].advance ?? deck.global.advance); if (t == null || paused) return;
    timer = setTimeout(() => { if (!ov.isConnected) return; for (let s2 = step; s2 < prep.steps.length; s2++) prep.play(s2, { instant: true }); step = prep.steps.length; next(); }, t * 1000);
  };
  let paused = false;
  // zooms: a click opens the slide or section, and the show comes back afterwards
  let ret = null;
  const zoomTo = (el) => {
    const n = order.findIndex((x) => x.number === +el.dataset.zoom); if (n < 0) return;
    // a section runs until the next slide that starts another section
    const sec = el.dataset.zoomSection; let last = n;
    if (sec) while (last + 1 < order.length && !order[last + 1].section) last++;
    const obj = (order[i].objects || [])[+el.dataset.obj];
    if (obj?.attrs.return !== 'false') ret = { after: last, to: i };
    const r = el.getBoundingClientRect(), st = stage.getBoundingClientRect();
    show(n); const lay = layer.l.firstElementChild; busy?.forEach((a2) => a2.cancel());
    const sx = r.width / st.width, sy = r.height / st.height;
    busy = [lay.animate([{ transform: `translate(${(r.left - st.left) / k}px,${(r.top - st.top) / k}px) scale(${sx},${sy})`, transformOrigin: '0 0' }, { transform: 'none', transformOrigin: '0 0' }], { duration: 650, easing: EASE })];
    busy[0].finished.then(() => { busy = null; [...stage.children].slice(0, -1).forEach((c) => c.remove()); }).catch(() => {});
  };
  /** where a link goes: next, prev, first, last, back, end, slide:N, a web address or a Folio document */
  const follow = (link) => {
    const L = String(link).trim();
    if (L === 'next') return next(); if (L === 'prev') return prev(); if (L === 'first') return go(0); if (L === 'last') return go(order.length - 1);
    if (L === 'back') return back(); if (L === 'end') return close();
    const m = L.match(/^(?:slide:|#)(\d+)$/); if (m) { const n = order.findIndex((x) => x.number === +m[1]); if (n >= 0) go(n); return; }
    openLink?.(L, api);
  };
  const morph = (from, to, ms) => {
    // objects with the same id glide from where they were; everything else cross-fades
    const idOf = (layerObj, el) => (order[layerObj.n].objects || [])[+el.dataset.obj]?.id;
    const ids = new Map(); for (const el of from.sec.querySelectorAll('.sl-placed > [data-obj]')) { const id = idOf(from, el); if (id) ids.set(id, el); }
    const anims = [from.l.firstElementChild.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, fill: 'forwards' })];
    for (const el of to.sec.querySelectorAll('.sl-placed > [data-obj], .sl-body, .sl-phs')) {
      const match = el.dataset.obj != null && ids.get(idOf(to, el));
      if (match) {
        const a = match.getBoundingClientRect(), b = el.getBoundingClientRect();
        const dx = (a.left - b.left) / k, dy = (a.top - b.top) / k, sx = a.width / Math.max(1, b.width), sy = a.height / Math.max(1, b.height);
        const base = el.style.transform || '';
        match.style.visibility = 'hidden';
        anims.push(el.animate([{ transform: `translate(${dx}px,${dy}px) scale(${sx},${sy}) ${base}`, transformOrigin: '0 0' }, { transform: base || 'none', transformOrigin: '0 0' }], { duration: ms, easing: EASE }));
      } else anims.push(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: EASE, fill: 'backwards' }));
    }
    return anims;
  };
  const next = () => {
    if (busy) { busy.forEach((a) => a.finish()); return; }
    if (prep.running.some((r) => r.playState === 'running')) { prep.finish(); return; }
    if (step < prep.steps.length) { prep.play(step); step++; status(); return; }
    if (navigate?.next?.(i)) return;
    if (ret && i === ret.after) { const to = ret.to; ret = null; history.push(i); show(to, Infinity); return; }
    if (i < order.length - 1) { history.push(i); show(i + 1); }
    else if (String(deck.global.loop) === 'true' || kiosk) { history.push(i); show(0); }
  };
  const prev = () => {
    if (step > 0) { show(i, step - 1, { animate: false }); return; }
    if (i > 0) show(i - 1, Infinity, { animate: false });
  };
  const go = (n, { remember = true } = {}) => { if (n < 0 || n >= order.length) return; if (remember) history.push(i); show(n); };
  const back = () => { if (history.length) show(history.pop(), Infinity, { animate: false }); };
  const close = () => { clearTimeout(timer); win.removeEventListener('resize', size); ro?.disconnect(); if (fullscreen && doc.fullscreenElement) doc.exitFullscreen().catch(() => {}); ov.remove(); onExit?.(order[i]); };
  const pause = (on = !paused) => { paused = on; if (paused) { clearTimeout(timer); timer = null; } else schedule(); return paused; };
  /* ink: pen, highlighter, eraser and laser, kept per slide for the whole show */
  const ink = new Map(); let tool = null; let drawing = null;
  const canvas = doc.createElement('canvas'); canvas.className = 'pr-ink'; canvas.width = deck.width; canvas.height = deck.height; stage.appendChild(canvas);
  const laser = doc.createElement('div'); laser.className = 'pr-laser'; laser.hidden = true; stage.appendChild(laser);
  const cx = canvas.getContext('2d');
  const TOOLS = { pen: { color: '#e5332a', width: 4, alpha: 1 }, highlighter: { color: '#ffd500', width: 26, alpha: 0.38 } };
  const redraw = () => {
    cx.clearRect(0, 0, canvas.width, canvas.height);
    for (const st of ink.get(i) || []) { cx.globalAlpha = st.alpha; cx.strokeStyle = st.color; cx.lineWidth = st.width; cx.lineCap = cx.lineJoin = 'round'; cx.beginPath(); st.pts.forEach(([x, y], n) => (n ? cx.lineTo(x, y) : cx.moveTo(x, y))); cx.stroke(); }
    cx.globalAlpha = 1;
  };
  const at = (e) => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * deck.width, ((e.clientY - r.top) / r.height) * deck.height]; };
  const setTool = (t) => { tool = TOOLS[t] || t === 'eraser' || t === 'laser' ? t : null; ov.dataset.tool = tool || ''; canvas.style.pointerEvents = tool && tool !== 'laser' ? 'auto' : 'none'; laser.hidden = tool !== 'laser'; onChange?.({ i, step, slide: order[i], steps: prep?.steps.length || 0, tool }); return tool; };
  canvas.addEventListener('pointerdown', (e) => {
    if (!tool) return; e.preventDefault(); try { canvas.setPointerCapture(e.pointerId); } catch {}
    if (tool === 'eraser') { drawing = { erase: true }; erase(at(e)); return; }
    const t = TOOLS[tool]; drawing = { ...t, pts: [at(e)] }; (ink.get(i) || ink.set(i, []).get(i)).push(drawing);
  });
  const erase = ([x, y]) => { const list = ink.get(i) || []; const keep = list.filter((st) => !st.pts.some(([a, b]) => Math.hypot(a - x, b - y) < 18 + st.width / 2)); if (keep.length !== list.length) { ink.set(i, keep); redraw(); } };
  canvas.addEventListener('pointermove', (e) => { if (!drawing) return; if (drawing.erase) erase(at(e)); else { drawing.pts.push(at(e)); redraw(); } });
  canvas.addEventListener('pointerup', () => { drawing = null; });
  stage.addEventListener('pointermove', (e) => { if (tool === 'laser') { const [x, y] = at(e); laser.style.left = (x * k) + 'px'; laser.style.top = (y * k) + 'px'; } if (zoomed) { const r = stage.getBoundingClientRect(); stage.style.transformOrigin = `${e.clientX - r.left}px ${e.clientY - r.top}px`; } });
  /* black and white screens, and a magnifier */
  const veil = doc.createElement('div'); veil.className = 'pr-veil'; veil.hidden = true; ov.appendChild(veil);
  const screen = (c) => { if (!c || veil.dataset.c === c) { veil.hidden = true; veil.dataset.c = ''; return null; } veil.hidden = false; veil.dataset.c = c; veil.style.background = c === 'white' ? '#fff' : '#000'; return c; };
  let zoomed = false;
  const magnify = (on = !zoomed) => { zoomed = on; stage.style.transform = on ? 'scale(2)' : ''; stage.style.transition = 'transform .25s'; return on; };
  let typed = '';
  const api = { next, prev, go, back, close, follow, pause, seek: (n, st) => show(n, st, { animate: false }), tool: setTool, screen, magnify, clearInk: () => { ink.delete(i); redraw(); }, get ink() { return ink; }, get paused() { return paused; }, get i() { return i; }, get step() { return step; }, get layer() { return layer; }, get order() { return order; }, overlay: ov, stage, deck, get scale() { return k; }, get prep() { return prep; } };
  ov.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    if (kiosk && e.key !== 'Escape') return;
    const ctrl = e.ctrlKey || e.metaKey; const key = e.key.toLowerCase();
    if (ctrl && 'piel'.includes(key) && key.length === 1) { setTool({ p: 'pen', i: 'highlighter', e: 'eraser', l: 'laser' }[key] === tool ? null : { p: 'pen', i: 'highlighter', e: 'eraser', l: 'laser' }[key]); e.preventDefault(); return; }
    if (ctrl && key === 'a') { setTool(null); e.preventDefault(); return; }
    if (!ctrl && /^[0-9]$/.test(e.key)) { typed += e.key; e.preventDefault(); return; }
    if (e.key === 'Enter' && typed) { const n = order.findIndex((x) => x.number === +typed); typed = ''; if (n >= 0) go(n); e.preventDefault(); return; }
    typed = '';
    if (!ctrl && (key === 'b' || e.key === '.')) { screen('black'); e.preventDefault(); return; }
    if (!ctrl && (key === 'w' || e.key === ',')) { screen('white'); e.preventDefault(); return; }
    if (!ctrl && key === 'e' && !e.shiftKey) { ink.delete(i); redraw(); e.preventDefault(); return; }
    if (e.key === '+' || e.key === '=') { magnify(true); e.preventDefault(); return; }
    if (e.key === '-') { magnify(false); e.preventDefault(); return; }
    if (e.key === 'Escape' && (tool || zoomed || !veil.hidden)) { setTool(null); magnify(false); screen(null); e.preventDefault(); return; }
    if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter', 'n'].includes(e.key)) next();
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(e.key)) prev();
    else if (e.key === 'Home') show(0); else if (e.key === 'End') show(order.length - 1, Infinity, { animate: false });
    else if (e.key === 'Escape') close();
    else return;
    e.preventDefault();
  });
  stage.addEventListener('click', (e) => {
    const l = e.target.closest('[data-link]'); const z = e.target.closest('[data-zoom]');
    if (l) { e.preventDefault(); follow(l.dataset.link); } else if (z && z.dataset.zoom) { e.preventDefault(); zoomTo(z); }
  });
  stage.addEventListener('click', (e) => { if (kiosk || (tool && tool !== 'laser')) return; if (e.defaultPrevented || e.target.closest('a,[data-link],button,input,video,audio')) return; if (e.clientX > innerWidth / 3) next(); else prev(); });
  if (fullscreen) doc.addEventListener('fullscreenchange', function f() { if (!doc.fullscreenElement && ov.isConnected && !ov.dataset.windowed) { doc.removeEventListener('fullscreenchange', f); close(); } });
  win.addEventListener('resize', size); const ro = root && 'ResizeObserver' in win ? new win.ResizeObserver(size) : null; ro?.observe(root);
  size(); show(i, 0, { animate: false }); if (keys) ov.focus();
  decorate?.(api);
  if (fullscreen) ov.requestFullscreen?.().catch(() => {});
  return api;
}

/** play a slide's animations once on a rendered copy (the Animations pane's Preview) */
export async function previewSlide(sec, slide, { W, H } = {}) {
  const p = prepareSlide(sec, slide, { W, H });
  for (let s = 0; s < p.steps.length; s++) {
    p.play(s);
    await Promise.all(p.running.map((r) => r.finished.catch(() => {})));
    await new Promise((r) => setTimeout(r, 250));
  }
  return p.steps.length;
}
