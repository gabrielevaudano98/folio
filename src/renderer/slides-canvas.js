// Folio — slide canvas (P1): select, move, resize, rotate, snap and nudge placed objects.
// Moveable draws the handles and guides; Selecto does click and marquee selection.
// Every gesture ends in ONE call to ctx.edit(fn), which rewrites only the moved objects' opener lines.
import Moveable from 'moveable';
import Selecto from 'selecto';
import { setMany, setObjectAttrs, removeObject, scanObjects, objectSource, addObject, geometry, nextId, groupOf, portPoint } from './slides-objects.js';

const num = (v) => Math.round(v * 10) / 10;
const whole = (v) => Math.round(v);

/** read what Moveable left on an element: translate, size and rotation → object attributes */
function readPatch(el, g) {
  const t = el.style.transform || '';
  const tr = t.match(/translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/);
  const ro = t.match(/rotate\(\s*(-?[\d.]+)deg\s*\)/);
  const p = {
    x: whole(g.x + (tr ? parseFloat(tr[1]) : 0)),
    y: whole(g.y + (tr ? parseFloat(tr[2]) : 0)),
    w: whole(parseFloat(el.style.width) || g.w),
    h: whole(parseFloat(el.style.height) || g.h),
  };
  const rot = ro ? num(((parseFloat(ro[1]) % 360) + 360) % 360) : 0;
  p.rotate = rot > 180 ? num(rot - 360) : rot;
  return p;
}

/**
 * @param {{frame: HTMLElement, stage: HTMLElement, width: number, height: number, getChunk: () => string,
 *          edit: (fn: (chunk: string) => string) => void, selected: number[], onSelect: (sel: number[]) => void}} o
 */
export function mountCanvas(o) {
  const { frame, stage, width, height } = o;
  const objEls = () => [...frame.querySelectorAll('.sl-obj[data-obj]')];
  const byIndex = (i) => frame.querySelector(`.sl-obj[data-obj="${i}"]`);
  const indexOf = (el) => Number(el.dataset.obj);
  const k = () => parseFloat(frame.style.getPropertyValue('--k')) || 1;

  let ends = [];
  const geo = () => { const list = scanObjects(o.getChunk()); return list.map(geometry); };
  let start = [];

  const moveable = new Moveable(stage, {
    target: [], container: stage, origin: false, edge: false, className: 'sl-moveable',
    draggable: true, resizable: true, rotatable: true, throttleDrag: 0, throttleResize: 0, throttleRotate: 0,
    keepRatio: false, renderDirections: ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], rotationPosition: 'top',
    snappable: true, snapDirections: { left: true, top: true, right: true, bottom: true, center: true, middle: true },
    elementSnapDirections: { left: true, top: true, right: true, bottom: true, center: true, middle: true },
    snapThreshold: 6, isDisplaySnapDigit: false, snapGap: false, snapRotationThreshold: 4, snapRotationDegrees: [0, 45, 90, 135, 180, 225, 270, 315],
    // the frame (unscaled, slide size × k) is the snap container: snap lines and the grid are slide px scaled by k
    snapContainer: frame, elementGuidelines: [],
  });
  /** snap lines: the slide's edges and centre plus the guides from the rulers (slide px), and the grid, all scaled by k */
  let guideLines = o.guides?.() || { x: [], y: [] }, grid = 0;
  const applySnap = () => {
    const kk = k();
    moveable.verticalGuidelines = [...new Set([0, width / 2, width, ...(guideLines.x || [])])].map((v) => v * kk);
    moveable.horizontalGuidelines = [...new Set([0, height / 2, height, ...(guideLines.y || [])])].map((v) => v * kk);
    moveable.snapGridWidth = grid * kk; moveable.snapGridHeight = grid * kk;
  };
  applySnap();
  /** a drag that snapped lands a fraction of a screen pixel off its line; put an edge or centre exactly on it */
  const settle = (p, g0) => {
    if (p.rotate || g0.rotate) return;
    const tol = Math.max(1, 1 / k());
    const fix = (pos, size, lines) => {
      let best = null;
      for (const at of [pos, pos + size / 2, pos + size]) for (const v of lines) { const d = v - at; if (Math.abs(d) <= tol && (best == null || Math.abs(d) < Math.abs(best))) best = d; }
      return best == null ? pos : Math.round(pos + best);
    };
    p.x = fix(p.x, p.w, [0, width / 2, width, ...(guideLines.x || [])]);
    p.y = fix(p.y, p.h, [0, height / 2, height, ...(guideLines.y || [])]);
  };

  const apply = (e) => { e.target.style.cssText += e.cssText; };
  let copying = false, dragging = false;
  // Alt held when the gesture started (Moveable does not always pass the pressing event on)
  let altAtDown = false; const downAlt = (ev) => { altAtDown = !!ev.altKey; }; stage.addEventListener('mousedown', downAlt, true); stage.addEventListener('pointerdown', downAlt, true);
  // Alt held while dragging (checked again at the drop, like PowerPoint's Ctrl-drag)
  let altNow = false; const trackAlt = (ev) => { altNow = !!ev.altKey; }; document.addEventListener('mousemove', trackAlt, true); document.addEventListener('pointermove', trackAlt, true);
  const begin = (e, drag = false) => { dragging = drag; start = geo(); copying = drag && (altAtDown || !!(e?.inputEvent?.altKey)); frame.classList.toggle('is-copying', copying); };
  const finish = () => {
    const els = moveable.target ? [].concat(moveable.target) : [];
    const objs = scanObjects(o.getChunk());
    const patches = els.map((el) => {
      const i = indexOf(el); const g0 = start[i] || geometry({ attrs: {} }); const p = readPatch(el, g0);
      if (dragging) settle(p, g0);
      for (const key of Object.keys(p)) if (p[key] === g0[key]) delete p[key];
      if (p.rotate === 0 && !('rotate' in (objs[i]?.attrs || {}))) delete p.rotate;
      return [i, p];
    }).filter(([, p]) => Object.keys(p).length);
    if (!patches.length) return;
    if (dragging && altNow) copying = true;
    if (copying) {
      // Alt-drag: the originals stay, copies land where the drag ended
      copying = false; frame.classList.remove('is-copying');
      const n0 = objs.length;
      o.edit((chunk) => patches.reduce((t, [i, p]) => {
        const ob = scanObjects(t)[i]; const nid = nextId(t, ob.kind === 'image' ? 'image' : ob.kind);
        let src = objectSource(t, i).replace(/ #[\w-]+/, '').replace(/^(\s*:::\s*\w+)/, `$1 #${nid}`);
        if (ob.kind === 'image') src = src.replace(/\{([^}]*)\}\s*$/, (m, inner) => `{#${nid} ${inner.replace(/#[\w-]+\s*/, '')}}`);
        return setMany(addObject(t, src), [[scanObjects(t).length, p]]);
      }, chunk));
      o.onSelect(patches.map((_, j) => n0 + j));
      return;
    }
    o.edit((chunk) => setMany(chunk, patches));
  };

  moveable.on('dragStart', (e) => begin(e, true)).on('drag', apply).on('dragEnd', ({ isDrag }) => { if (isDrag) finish(); });
  moveable.on('resizeStart', () => begin()).on('resize', apply).on('resizeEnd', ({ isDrag }) => { if (isDrag) finish(); });
  moveable.on('rotateStart', () => begin()).on('rotate', apply).on('rotateEnd', ({ isDrag }) => { if (isDrag) finish(); });
  moveable.on('dragGroupStart', (e) => begin(e, true)).on('dragGroup', ({ events }) => events.forEach(apply)).on('dragGroupEnd', ({ isDrag }) => { if (isDrag) finish(); });
  moveable.on('resizeGroupStart', () => begin()).on('resizeGroup', ({ events }) => events.forEach(apply)).on('resizeGroupEnd', ({ isDrag }) => { if (isDrag) finish(); });
  moveable.on('rotateGroupStart', () => begin()).on('rotateGroup', ({ events }) => events.forEach(apply)).on('rotateGroupEnd', ({ isDrag }) => { if (isDrag) finish(); });

  const selecto = new Selecto({
    container: stage, rootContainer: stage, dragContainer: frame,
    selectableTargets: ['.sl-obj[data-obj]:not(.is-locked)'], selectByClick: true, selectFromInside: false, hitRate: 0,
    toggleContinueSelect: ['shift'], preventDefault: false,
  });
  selecto.on('dragStart', (e) => {
    const t = e.inputEvent.target;
    if (t.closest?.('[data-editing]')) { e.stop(); return; }
    const ie = e.inputEvent;
    if (ie && (ie.shiftKey || ie.ctrlKey || ie.metaKey)) {
      const hit = t.closest?.('.sl-obj:not(.is-locked)');
      if (hit) { e.stop(); const prev = new Set(sel); const i = indexOf(hit); if (prev.has(i)) prev.delete(i); else prev.add(i); set([...prev].sort((a, b) => a - b)); return; }
    }
    if (moveable.isMoveableElement(t) || [].concat(moveable.target || []).some((el) => el === t || el.contains(t))) e.stop();
  });
  selecto.on('selectEnd', (e) => {
    const next = e.selected.map(indexOf).sort((a, b) => a - b);
    set(next);
    if (e.isDragStart) { e.inputEvent.preventDefault(); setTimeout(() => moveable.dragStart(e.inputEvent)); }
  });

  let sel = [];
  function set(next, { notify = true } = {}) {
    const all = scanObjects(o.getChunk());
    const grp = new Set(next.map((i) => groupOf(all[i] || { attrs: {} })).filter(Boolean));
    next = [...new Set([...next, ...all.map((ob, i) => (grp.has(groupOf(ob)) ? i : -1)).filter((i) => i >= 0)])].sort((a, b) => a - b);
    sel = next.filter((i) => byIndex(i) && !byIndex(i).classList.contains('is-locked'));
    const els = sel.map(byIndex);
    const hasLine = els.some((el) => el.classList.contains('sl-line'));
    moveable.resizable = !hasLine; moveable.rotatable = !hasLine;
    moveable.draggable = !els.some((el) => el.classList.contains('is-connector'));
    moveable.target = els.length ? els : null;
    drawEnds(els.length === 1 && hasLine ? els[0] : null);
    moveable.elementGuidelines = objEls().filter((el) => !els.includes(el));
    frame.querySelectorAll('.sl-obj').forEach((el) => el.classList.toggle('is-selected', els.includes(el)));
    // handles on a single object follow its rotation; groups are axis-aligned
    moveable.updateRect();
    if (notify) o.onSelect(sel);
    announce(els);
  }
  // a live region tells screen readers what is selected and where
  const live = document.createElement('div'); live.className = 'visually-hidden'; live.setAttribute('aria-live', 'polite'); stage.appendChild(live);
  function announce(els) {
    if (!els.length) { live.textContent = ''; return; }
    if (els.length > 1) { live.textContent = `${els.length} objects selected`; return; }
    const ob = scanObjects(o.getChunk())[indexOf(els[0])]; if (!ob) return; const g = geometry(ob);
    const what = (ob.body || ob.alt || '').replace(/[#*_`>[\]-]/g, '').trim().split('\n')[0].slice(0, 40);
    live.textContent = `${ob.kind}${what ? ' ' + what : ''}${ob.id ? ', ' + ob.id : ''}, x ${Math.round(g.x)}, y ${Math.round(g.y)}, ${Math.round(g.w)} by ${Math.round(g.h)}. Arrows move, Enter edits text, Delete removes.`;
  }

  /* keyboard: arrows nudge, Delete removes, Ctrl+D duplicates, Ctrl+A selects all, Esc clears */
  function onKey(e) {
    if (e.target.closest('input, textarea, select, [contenteditable="true"], .cm-editor')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); set(objEls().map(indexOf)); return; }
    if (e.key === 'Escape' && sel.length) { set([]); return; }
    if (e.key === 'Tab' && !mod) {
      // keyboard-only editing: Tab and Shift+Tab walk through the objects on the slide
      const all = objEls().filter((el) => !el.classList.contains('is-locked')).map(indexOf).sort((a, b) => a - b); if (!all.length) return;
      e.preventDefault();
      const curI = sel.length ? all.indexOf(sel[sel.length - 1]) : -1;
      const nextI = e.shiftKey ? (curI <= 0 ? all.length - 1 : curI - 1) : (curI + 1) % all.length;
      set([all[nextI]]); return;
    }
    if (!sel.length) return;
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d) {
      e.preventDefault();
      const g = geo();
      o.edit((chunk) => setMany(chunk, sel.map((i) => [i, { x: num((g[i]?.x || 0) + d[0]), y: num((g[i]?.y || 0) + d[1]) }])));
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const gone = [...sel].sort((a, b) => b - a);
      set([]);
      o.edit((chunk) => gone.reduce((t, i) => removeObject(t, i), chunk));
      return;
    }
    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      const picked = [...sel]; const n0 = scanObjects(o.getChunk()).length;
      o.edit((chunk) => picked.reduce((t, i) => {
        const g = geometry(scanObjects(t)[i]);
        let src = objectSource(t, i).replace(/ #[\w-]+/, '');
        const nid = nextId(t, scanObjects(t)[i].kind === 'image' ? 'image' : scanObjects(t)[i].kind);
        src = src.replace(/^(\s*:::\s*\w+)/, `$1 #${nid}`);
        src = src.replace(/\b(x|y)=-?[\d.]+/g, (m, a) => `${a}=${num((a === 'x' ? g.x : g.y) + 24)}`);
        return addObject(t, src);
      }, chunk));
      o.onSelect(picked.map((_, j) => n0 + j));
    }
  }
  stage.addEventListener('keydown', onKey);

  set(o.selected || [], { notify: false });
  frame.addEventListener('scroll', () => moveable.updateRect());

  /* endpoint handles for a selected line; ends snap to the ports of objects that have an id */
  function drawEnds(el) {
    ends.forEach((h) => h.remove()); ends = [];
    if (!el) return;
    const kk = k();
    for (const which of [1, 2]) {
      const h = document.createElement('div');
      h.className = 'sl-end'; h.dataset.end = which; h.tabIndex = -1;
      h.style.left = `${parseFloat(el.dataset['x' + which]) * kk}px`; h.style.top = `${parseFloat(el.dataset['y' + which]) * kk}px`;
      h.addEventListener('pointerdown', (e) => dragEnd(e, el, which, h));
      frame.appendChild(h); ends.push(h);
    }
  }
  function snapTarget(x, y, lineIdx) {
    const all = scanObjects(o.getChunk()); let best = null;
    all.forEach((ob, i) => {
      if (i === lineIdx || ob.kind === 'line' || !ob.id) return;
      const g = geometry(ob);
      for (const port of ['top', 'right', 'bottom', 'left', 'center']) {
        const [px, py] = portPoint(g, port); const d = Math.hypot(px - x, py - y);
        if (d < 18 && (!best || d < best.d)) best = { d, ref: `${ob.id}.${port}`, x: px, y: py };
      }
    });
    return best;
  }
  function dragEnd(e, el, which, h) {
    e.preventDefault(); e.stopPropagation(); try { h.setPointerCapture(e.pointerId); } catch {}
    const i = indexOf(el); const rect = frame.getBoundingClientRect(); const kk = k();
    let pt = null;
    const move = (ev) => {
      const x = (ev.clientX - rect.left) / kk, y = (ev.clientY - rect.top) / kk;
      const snap = snapTarget(x, y, i);
      pt = snap ? { x: snap.x, y: snap.y, ref: snap.ref } : { x: Math.round(x), y: Math.round(y), ref: null };
      h.style.left = `${pt.x * kk}px`; h.style.top = `${pt.y * kk}px`; h.classList.toggle('is-snapped', !!snap);
    };
    const up = () => {
      h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up);
      if (!pt) return;
      const x1 = which === 1 ? pt.x : parseFloat(el.dataset.x1), y1 = which === 1 ? pt.y : parseFloat(el.dataset.y1);
      const x2 = which === 2 ? pt.x : parseFloat(el.dataset.x2), y2 = which === 2 ? pt.y : parseFloat(el.dataset.y2);
      const patch = { x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1), [which === 1 ? 'from' : 'to']: pt.ref };
      o.edit((chunk) => setObjectAttrs(chunk, i, patch));
    };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
  }

  return {
    select: set,
    setGrid(n) { grid = n; applySnap(); moveable.updateRect(); },
    setGuides(g) { guideLines = g || { x: [], y: [] }; applySnap(); moveable.updateRect(); },
    selection: () => sel,
    update: () => { applySnap(); moveable.updateRect(); if (ends.length) drawEnds(byIndex(sel[0])); },
    destroy() { document.removeEventListener('mousemove', trackAlt, true); document.removeEventListener('pointermove', trackAlt, true); live.remove(); ends.forEach((h) => h.remove()); stage.removeEventListener('keydown', onKey); selecto.destroy(); moveable.destroy(); },
  };
}
