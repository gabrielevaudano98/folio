// Folio — the slide show: build steps, transitions, Morph, and the controls around them.
import { buildSteps, hiddenAtStart, keyframes, transitionFrames, parseTransition } from './slides-motion.js';

const EASE = 'cubic-bezier(.2,.7,.2,1)';

/** the elements an animation moves on a rendered slide */
export function targetsOf(sec, slide, a) {
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
  const anims = slide.animations || [];
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
export function startShow({ deck, order, start = 0, renderSlide, hydrate, onExit, onChange, decorate, navigate }) {
  const ov = document.createElement('div');
  ov.className = 'presenter'; ov.tabIndex = 0; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Presentation');
  ov.innerHTML = '<div class="pr-stage"></div><div class="pr-bar"></div>';
  document.body.appendChild(ov);
  const stage = ov.querySelector('.pr-stage'), bar = ov.querySelector('.pr-bar');
  let i = Math.max(0, Math.min(order.length - 1, start)), step = 0, layer = null, prep = null, busy = null, k = 1;
  const history = [];
  const size = () => { k = Math.min(innerWidth / deck.width, innerHeight / deck.height); stage.style.width = deck.width * k + 'px'; stage.style.height = deck.height * k + 'px'; for (const l of stage.children) l.style.transform = `scale(${k})`; };
  const make = (n) => {
    const l = document.createElement('div'); l.className = 'sl-scale pr-layer'; l.style.transform = `scale(${k})`;
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
    if (from && animate && t.name !== 'none' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const ms = t.duration * 1000;
      if (t.name === 'morph') busy = morph(from, next, ms);
      else { const [outF, inF] = transitionFrames(t.name, deck.width, deck.height); busy = [from.l.firstElementChild.animate(outF, { duration: ms, easing: EASE, fill: 'forwards' }), next.l.firstElementChild.animate(inF, { duration: ms, easing: EASE, fill: 'backwards' })]; }
      Promise.all(busy.map((a) => a.finished.catch(() => {}))).then(() => { from.l.remove(); busy = null; });
    } else from?.l.remove();
    layer = next; prep = next.prep; i = n; step = built; status();
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
    if (i < order.length - 1) { history.push(i); show(i + 1); }
    else if (deck.global.loop === 'true' || deck.global.loop === true) { history.push(i); show(0); }
  };
  const prev = () => {
    if (step > 0) { show(i, step - 1, { animate: false }); return; }
    if (i > 0) show(i - 1, Infinity, { animate: false });
  };
  const go = (n, { remember = true } = {}) => { if (n < 0 || n >= order.length) return; if (remember) history.push(i); show(n); };
  const back = () => { if (history.length) show(history.pop(), Infinity, { animate: false }); };
  const close = () => { removeEventListener('resize', size); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); ov.remove(); onExit?.(order[i]); };
  const api = { next, prev, go, back, close, get i() { return i; }, get step() { return step; }, get layer() { return layer; }, get order() { return order; }, overlay: ov, stage, deck, get scale() { return k; }, get prep() { return prep; } };
  ov.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter', 'n'].includes(e.key)) next();
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(e.key)) prev();
    else if (e.key === 'Home') show(0); else if (e.key === 'End') show(order.length - 1, Infinity, { animate: false });
    else if (e.key === 'Escape') close();
    else return;
    e.preventDefault();
  });
  stage.addEventListener('click', (e) => { if (e.defaultPrevented || e.target.closest('a,[data-link],button,input,video,audio')) return; if (e.clientX > innerWidth / 3) next(); else prev(); });
  document.addEventListener('fullscreenchange', function f() { if (!document.fullscreenElement && ov.isConnected && !ov.dataset.windowed) { document.removeEventListener('fullscreenchange', f); close(); } });
  addEventListener('resize', size);
  size(); show(i, 0, { animate: false }); ov.focus();
  decorate?.(api);
  ov.requestFullscreen?.().catch(() => {});
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
