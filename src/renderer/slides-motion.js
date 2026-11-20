// Folio — slide motion: transitions between slides and animations of objects, as plain slides-md lines.
//
//   <!-- transition: push-left 0.6s -->                 one slide (front matter `transition:` for all)
//   <!--
//   animate: #title fade-in
//   animate: #chart fly-in-up after 0.4s delay=0.2s
//   animate: body appear click by=paragraph
//   -->
//
// An animation line: target (`#id` or `body`), effect, then in any order: trigger (click, with, after),
// a duration (`0.5s` or `500ms`), `delay=`, `repeat=` (a number or `loop`), `by=paragraph`, `path=dx,dy` for custom paths.

/** transitions: name → label and what PowerPoint calls it */
export const TRANSITIONS = {
  none: ['None', null], fade: ['Fade', 'fade'], 'fade-black': ['Fade through black', 'fade:thruBlk'], dissolve: ['Dissolve', 'dissolve'],
  'push-left': ['Push left', 'push:l'], 'push-right': ['Push right', 'push:r'], 'push-up': ['Push up', 'push:u'], 'push-down': ['Push down', 'push:d'],
  'wipe-left': ['Wipe left', 'wipe:l'], 'wipe-right': ['Wipe right', 'wipe:r'], 'wipe-up': ['Wipe up', 'wipe:u'], 'wipe-down': ['Wipe down', 'wipe:d'],
  'cover-left': ['Cover left', 'cover:l'], 'cover-right': ['Cover right', 'cover:r'], 'uncover-left': ['Uncover left', 'pull:l'], 'uncover-right': ['Uncover right', 'pull:r'],
  split: ['Split', 'split'], reveal: ['Reveal', 'fade'], zoom: ['Zoom', 'zoom'], 'zoom-out': ['Zoom out', 'zoom:out'], iris: ['Iris', 'circle'], clock: ['Clock', 'wheel'],
  blinds: ['Blinds', 'blinds'], flip: ['Flip', 'fade'], cube: ['Cube', 'push:l'], fall: ['Fall over', 'fade'], morph: ['Morph', 'morph'],
};
/** animation effects: name → kind, label, PowerPoint preset id */
export const EFFECTS = {
  appear: ['entrance', 'Appear', 1], 'fade-in': ['entrance', 'Fade in', 10], 'zoom-in': ['entrance', 'Zoom in', 53], 'grow-in': ['entrance', 'Grow and turn', 31],
  'fly-in-left': ['entrance', 'Fly in from left', 2], 'fly-in-right': ['entrance', 'Fly in from right', 2], 'fly-in-up': ['entrance', 'Fly in from bottom', 2], 'fly-in-down': ['entrance', 'Fly in from top', 2],
  'float-in': ['entrance', 'Float in', 42], 'wipe-in': ['entrance', 'Wipe', 22], 'spin-in': ['entrance', 'Spin in', 31], 'bounce-in': ['entrance', 'Bounce', 26],
  pulse: ['emphasis', 'Pulse', 26], spin: ['emphasis', 'Spin', 8], grow: ['emphasis', 'Grow', 6], teeter: ['emphasis', 'Teeter', 32], flash: ['emphasis', 'Flash', 35], shake: ['emphasis', 'Shake', 32],
  disappear: ['exit', 'Disappear', 1], 'fade-out': ['exit', 'Fade out', 10], 'zoom-out': ['exit', 'Zoom out', 53], 'fly-out-left': ['exit', 'Fly out to left', 2], 'fly-out-right': ['exit', 'Fly out to right', 2],
  'fly-out-up': ['exit', 'Fly out to top', 2], 'fly-out-down': ['exit', 'Fly out to bottom', 2], 'wipe-out': ['exit', 'Wipe out', 22],
  'path-left': ['path', 'Move left', 0], 'path-right': ['path', 'Move right', 0], 'path-up': ['path', 'Move up', 0], 'path-down': ['path', 'Move down', 0], 'path-arc': ['path', 'Arc', 0], 'path-custom': ['path', 'Custom path', 0],
};
const TRIGGERS = ['click', 'with', 'after'];

const secs = (v) => { const m = String(v).match(/^(\d*\.?\d+)(ms|s)$/); return m ? (m[2] === 'ms' ? +m[1] / 1000 : +m[1]) : null; };
const fmt = (s) => (s >= 1 && Number.isInteger(s) ? `${s}s` : s < 1 ? `${Math.round(s * 1000)}ms` : `${s}s`);

export function parseTransition(v) {
  const [name = 'none', dur] = String(v || '').trim().split(/\s+/);
  return { name: TRANSITIONS[name] ? name : 'fade', duration: secs(dur) ?? 0.5 };
}
export const transitionText = (t) => (!t || t.name === 'none' ? null : `${t.name}${t.duration && t.duration !== 0.5 ? ' ' + fmt(t.duration) : ''}`);

export const DEFAULT_DUR = { entrance: 0.5, emphasis: 0.6, exit: 0.5, path: 1 };
/** one `animate:` value to an object; unknown words are kept so nothing typed by hand is lost */
export function parseAnim(v) {
  const words = String(v).trim().split(/\s+/);
  const a = { target: (words.shift() || '').replace(/^#/, ''), effect: words.shift() || 'fade-in', trigger: 'click', duration: null, delay: 0, repeat: 1, by: null, path: null, extra: [] };
  if (!EFFECTS[a.effect]) a.extra.push(`effect:${a.effect}`), (a.effect = 'fade-in');
  for (const w of words) {
    if (TRIGGERS.includes(w)) a.trigger = w;
    else if (secs(w) != null) a.duration = secs(w);
    else if (/^delay=/.test(w)) a.delay = secs(w.slice(6)) ?? 0;
    else if (/^repeat=/.test(w)) a.repeat = w.slice(7) === 'loop' ? Infinity : Math.max(1, parseInt(w.slice(7), 10) || 1);
    else if (/^by=/.test(w)) a.by = w.slice(3);
    else if (/^path=/.test(w)) a.path = w.slice(5).split(',').map(Number).slice(0, 2);
    else a.extra.push(w);
  }
  a.kind = EFFECTS[a.effect][0];
  if (a.duration == null) a.duration = DEFAULT_DUR[a.kind];
  // remember how it was typed: an unchanged animation writes back exactly as it was
  Object.defineProperty(a, 'raw', { value: String(v).trim(), enumerable: false });
  Object.defineProperty(a, 'sig', { value: sig(a), enumerable: false });
  return a;
}
const sig = (a) => JSON.stringify([a.target, a.effect, a.trigger, a.duration, a.delay, a.repeat === Infinity ? 'loop' : a.repeat, a.by, a.path, a.extra]);
export function animText(a) {
  if (a.raw && a.sig === sig(a)) return a.raw;
  const out = [(a.target === 'body' ? 'body' : '#' + a.target), a.effect];
  if (a.trigger !== 'click') out.push(a.trigger);
  if (a.duration !== DEFAULT_DUR[EFFECTS[a.effect][0]]) out.push(fmt(a.duration));
  if (a.delay) out.push(`delay=${fmt(a.delay)}`);
  if (a.repeat !== 1) out.push(`repeat=${a.repeat === Infinity ? 'loop' : a.repeat}`);
  if (a.by) out.push(`by=${a.by}`);
  if (a.path) out.push(`path=${a.path.join(',')}`);
  return out.concat(a.extra.filter((w) => !w.startsWith('effect:'))).join(' ');
}

/** replace the slide's animation lines (one comment block at the end of the slide, before nothing else) */
export function setAnimations(chunk, list) {
  // drop every comment made only of animate: lines, scanning comment by comment (no backtracking regex)
  let out = ''; let at = 0;
  for (;;) {
    const open = chunk.indexOf('<!--', at); if (open < 0) { out += chunk.slice(at); break; }
    const close = chunk.indexOf('-->', open + 4); if (close < 0) { out += chunk.slice(at); break; }
    const inner = chunk.slice(open + 4, close).split('\n').map((l) => l.trim()).filter(Boolean);
    const onlyAnim = inner.length > 0 && inner.every((l) => /^animate\s*:/.test(l));
    out += chunk.slice(at, open) + (onlyAnim ? '' : chunk.slice(open, close + 3));
    at = close + 3; if (onlyAnim && chunk[at] === '\n') at++;
  }
  out = out.replace(/\n+$/, '');
  if (list.length) out += `\n\n<!--\n${list.map((a) => 'animate: ' + (typeof a === 'string' ? a : animText(a))).join('\n')}\n-->`;
  return out + '\n';
}

/**
 * the click steps of a slide: each step is a list of { anim, start } where start is seconds after the click.
 * `by=paragraph` expands into one click per paragraph (`parts` says how many there are).
 */
export function buildSteps(anims, parts = () => 1) {
  const steps = []; let cur = null, lastEnd = 0;
  for (const a of anims) {
    const n = a.by === 'paragraph' ? Math.max(1, parts(a)) : 1;
    for (let p = 0; p < n; p++) {
      const one = n > 1 ? { ...a, part: p, trigger: p === 0 ? a.trigger : 'click' } : a;
      const dur = one.duration * (one.repeat === Infinity ? 1 : one.repeat);
      if (one.trigger === 'click' || !cur) { cur = []; steps.push(cur); const start = one.delay; cur.push({ anim: one, start }); lastEnd = start + dur; }
      else if (one.trigger === 'with') { const prev = cur[cur.length - 1]; const start = (prev?.start ?? 0) + one.delay; cur.push({ anim: one, start }); lastEnd = Math.max(lastEnd, start + dur); }
      else { const start = lastEnd + one.delay; cur.push({ anim: one, start }); lastEnd = start + dur; }
    }
  }
  return steps;
}
/** targets that start hidden: the ones whose first animation is an entrance */
export function hiddenAtStart(anims) {
  const first = new Map();
  for (const a of anims) { const k = a.target + (a.by === 'paragraph' ? ':p' : ''); if (!first.has(k)) first.set(k, a); }
  return [...first.values()].filter((a) => a.kind === 'entrance');
}

/** Web Animations keyframes for an effect; w/h is the element size in slide px, W/H the slide size */
export function keyframes(a, { w = 100, h = 100, x = 0, y = 0, W = 1280, H = 720 } = {}) {
  const off = { left: [-(x + w), 0], right: [W - x, 0], up: [0, H - y], down: [0, -(y + h)] };
  const dir = a.effect.split('-').pop();
  switch (a.effect) {
    case 'appear': return [{ visibility: 'hidden', offset: 0 }, { visibility: 'visible', offset: 0.001 }, { visibility: 'visible' }];
    case 'fade-in': case 'float-in': return a.effect === 'float-in' ? [{ opacity: 0, transform: 'translateY(40px)' }, { opacity: 1, transform: 'none' }] : [{ opacity: 0 }, { opacity: 1 }];
    case 'zoom-in': return [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'scale(1)' }];
    case 'grow-in': case 'spin-in': return [{ opacity: 0, transform: `scale(.2) rotate(${a.effect === 'spin-in' ? -360 : -90}deg)` }, { opacity: 1, transform: 'none' }];
    case 'bounce-in': return [{ opacity: 0, transform: 'translateY(-200px)' }, { opacity: 1, transform: 'translateY(0)', offset: 0.6 }, { transform: 'translateY(-30px)', offset: 0.8 }, { transform: 'none' }];
    case 'wipe-in': return [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }];
    case 'wipe-out': return [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 0 0 100%)' }];
    case 'fly-in-left': case 'fly-in-right': case 'fly-in-up': case 'fly-in-down': { const [dx, dy] = off[dir]; return [{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }]; }
    case 'fly-out-left': case 'fly-out-right': case 'fly-out-up': case 'fly-out-down': { const [dx, dy] = off[dir]; return [{ transform: 'none' }, { transform: `translate(${dx}px,${dy}px)` }]; }
    case 'pulse': return [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }];
    case 'grow': return [{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }];
    case 'spin': return [{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }];
    case 'teeter': case 'shake': { const d = a.effect === 'shake' ? 'translateX' : 'rotate'; const u = a.effect === 'shake' ? 'px' : 'deg'; const v = a.effect === 'shake' ? 12 : 6; return [0, v, -v, v, -v, 0].map((n) => ({ transform: `${d}(${n}${u})` })); }
    case 'flash': return [{ opacity: 1 }, { opacity: 0.1 }, { opacity: 1 }, { opacity: 0.1 }, { opacity: 1 }];
    case 'disappear': return [{ visibility: 'visible' }, { visibility: 'hidden', offset: 0.001 }, { visibility: 'hidden' }];
    case 'fade-out': return [{ opacity: 1 }, { opacity: 0 }];
    case 'zoom-out': return [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.3)' }];
    default: { // motion paths: relative moves that stay where they end
      const p = a.path || { 'path-left': [-200, 0], 'path-right': [200, 0], 'path-up': [0, -150], 'path-down': [0, 150], 'path-arc': [240, 0] }[a.effect] || [0, 0];
      if (a.effect === 'path-arc') return [{ transform: 'translate(0,0)' }, { transform: `translate(${p[0] / 2}px,-120px)` }, { transform: `translate(${p[0]}px,0)` }];
      return [{ transform: 'translate(0,0)' }, { transform: `translate(${p[0]}px,${p[1]}px)` }];
    }
  }
}

/** keyframes for the outgoing and incoming slide of a transition (W/H the slide size in px) */
export function transitionFrames(name, W = 1280, H = 720) {
  const slide = (dx, dy) => [[{ transform: 'none' }, { transform: `translate(${-dx}px,${-dy}px)` }], [{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }]];
  const D = { left: [W, 0], right: [-W, 0], up: [0, H], down: [0, -H] };
  const [kind, dir] = name.split('-');
  switch (kind) {
    case 'fade': return name === 'fade-black' ? [[{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }], [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }]] : [[{ opacity: 1 }, { opacity: 0 }], [{ opacity: 0 }, { opacity: 1 }]];
    case 'dissolve': case 'reveal': return [[{ opacity: 1, filter: 'blur(0)' }, { opacity: 0, filter: 'blur(6px)' }], [{ opacity: 0 }, { opacity: 1 }]];
    case 'push': return slide(...D[dir]);
    case 'cover': { const [dx, dy] = D[dir]; return [[{ opacity: 1 }, { opacity: 1 }], [{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }]]; }
    case 'uncover': { const [dx, dy] = D[dir]; return [[{ transform: 'none' }, { transform: `translate(${-dx}px,${-dy}px)` }], [{ opacity: 1 }, { opacity: 1 }]]; }
    case 'wipe': { const c = { left: 'inset(0 0 0 100%)', right: 'inset(0 100% 0 0)', up: 'inset(100% 0 0 0)', down: 'inset(0 0 100% 0)' }[dir]; return [[{ opacity: 1 }, { opacity: 1 }], [{ clipPath: c }, { clipPath: 'inset(0 0 0 0)' }]]; }
    case 'split': return [[{ opacity: 1 }, { opacity: 1 }], [{ clipPath: 'inset(0 50% 0 50%)' }, { clipPath: 'inset(0 0 0 0)' }]];
    case 'iris': return [[{ opacity: 1 }, { opacity: 1 }], [{ clipPath: 'circle(0% at 50% 50%)' }, { clipPath: 'circle(75% at 50% 50%)' }]];
    case 'clock': return [[{ opacity: 1 }, { opacity: 1 }], [{ clipPath: 'polygon(50% 50%, 50% 0, 50% 0, 50% 0, 50% 0, 50% 0)' }, { clipPath: 'polygon(50% 50%, 50% 0, 100% 0, 100% 100%, 0 100%, 0 0)', offset: 0.99 }, { clipPath: 'none' }]];
    case 'blinds': return [[{ opacity: 1 }, { opacity: 0 }], [{ maskImage: 'repeating-linear-gradient(#000 0 0%, transparent 0% 10%)', WebkitMaskImage: 'repeating-linear-gradient(#000 0 0%, transparent 0% 10%)' }, { maskImage: 'repeating-linear-gradient(#000 0 10%, transparent 10% 10%)', WebkitMaskImage: 'repeating-linear-gradient(#000 0 10%, transparent 10% 10%)' }]];
    case 'zoom': return dir === 'out' ? [[{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.4)', opacity: 0 }], [{ transform: 'scale(1.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }]] : [[{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.6)', opacity: 0 }], [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }]];
    case 'flip': return [[{ transform: 'perspective(2000px) rotateY(0)' }, { transform: 'perspective(2000px) rotateY(90deg)', offset: 0.5 }, { transform: 'perspective(2000px) rotateY(90deg)' }], [{ transform: 'perspective(2000px) rotateY(-90deg)' }, { transform: 'perspective(2000px) rotateY(-90deg)', offset: 0.5 }, { transform: 'perspective(2000px) rotateY(0)' }]];
    case 'cube': return [[{ transform: 'perspective(2400px) translateZ(0) rotateY(0)', transformOrigin: '100% 50%' }, { transform: `perspective(2400px) translateX(${-W}px) rotateY(-90deg)`, transformOrigin: '100% 50%' }], [{ transform: `perspective(2400px) translateX(${W}px) rotateY(90deg)`, transformOrigin: '0 50%' }, { transform: 'perspective(2400px) rotateY(0)', transformOrigin: '0 50%' }]];
    case 'fall': return [[{ transform: 'perspective(2000px) rotateX(0)', transformOrigin: '50% 100%' }, { transform: 'perspective(2000px) rotateX(-90deg)', transformOrigin: '50% 100%', opacity: 0 }], [{ opacity: 0 }, { opacity: 1 }]];
    default: return [[{ opacity: 1 }, { opacity: 0 }], [{ opacity: 0 }, { opacity: 1 }]];
  }
}
