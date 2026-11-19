// Folio — slide canvas (P1): select, move, resize, rotate, snap and nudge placed objects.
// Moveable draws the handles and guides; Selecto does click and marquee selection.
// Every gesture ends in ONE call to ctx.edit(fn), which rewrites only the moved objects' opener lines.
import Moveable from 'moveable';
import Selecto from 'selecto';
import { setMany, removeObject, scanObjects, objectSource, addObject, geometry, nextId, groupOf } from './slides-objects.js';

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
  const objEls = () => [...frame.querySelectorAll('.sl-obj')];
  const byIndex = (i) => frame.querySelector(`.sl-obj[data-obj="${i}"]`);
  const indexOf = (el) => Number(el.dataset.obj);
  const k = () => parseFloat(frame.style.getPropertyValue('--k')) || 1;

  const geo = () => { const list = scanObjects(o.getChunk()); return list.map(geometry); };
  let start = [];

  const moveable = new Moveable(stage, {
    target: [], container: stage, origin: false, edge: false, className: 'sl-moveable',
    draggable: true, resizable: true, rotatable: true, throttleDrag: 0, throttleResize: 0, throttleRotate: 0,
    keepRatio: false, renderDirections: ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], rotationPosition: 'top',
    snappable: true, snapDirections: { left: true, top: true, right: true, bottom: true, center: true, middle: true },
    elementSnapDirections: { left: true, top: true, right: true, bottom: true, center: true, middle: true },
    snapThreshold: 6, isDisplaySnapDigit: false, snapGap: false, snapRotationThreshold: 4, snapRotationDegrees: [0, 45, 90, 135, 180, 225, 270, 315],
    verticalGuidelines: [0, width / 2, width], horizontalGuidelines: [0, height / 2, height], elementGuidelines: [],
  });

  const apply = (e) => { e.target.style.cssText += e.cssText; };
  const begin = () => { start = geo(); };
  const finish = () => {
    const els = moveable.target ? [].concat(moveable.target) : [];
    const objs = scanObjects(o.getChunk());
    const patches = els.map((el) => {
      const i = indexOf(el); const g0 = start[i] || geometry({ attrs: {} }); const p = readPatch(el, g0);
      for (const key of Object.keys(p)) if (p[key] === g0[key]) delete p[key];
      if (p.rotate === 0 && !('rotate' in (objs[i]?.attrs || {}))) delete p.rotate;
      return [i, p];
    }).filter(([, p]) => Object.keys(p).length);
    if (!patches.length) return;
    o.edit((chunk) => setMany(chunk, patches));
  };

  moveable.on('dragStart', begin).on('drag', apply).on('dragEnd', ({ isDrag }) => { if (isDrag) finish(); });
  moveable.on('resizeStart', begin).on('resize', apply).on('resizeEnd', ({ isDrag }) => { if (isDrag) finish(); });
  moveable.on('rotateStart', begin).on('rotate', apply).on('rotateEnd', ({ isDrag }) => { if (isDrag) finish(); });
  moveable.on('dragGroupStart', begin).on('dragGroup', ({ events }) => events.forEach(apply)).on('dragGroupEnd', ({ isDrag }) => { if (isDrag) finish(); });
  moveable.on('resizeGroupStart', begin).on('resizeGroup', ({ events }) => events.forEach(apply)).on('resizeGroupEnd', ({ isDrag }) => { if (isDrag) finish(); });
  moveable.on('rotateGroupStart', begin).on('rotateGroup', ({ events }) => events.forEach(apply)).on('rotateGroupEnd', ({ isDrag }) => { if (isDrag) finish(); });

  const selecto = new Selecto({
    container: stage, rootContainer: stage, dragContainer: frame,
    selectableTargets: ['.sl-obj:not(.is-locked)'], selectByClick: true, selectFromInside: false, hitRate: 0,
    toggleContinueSelect: ['shift'], preventDefault: false,
  });
  selecto.on('dragStart', (e) => {
    const t = e.inputEvent.target;
    if (moveable.isMoveableElement(t) || [].concat(moveable.target || []).some((el) => el === t || el.contains(t))) e.stop();
  });
  selecto.on('selectEnd', (e) => {
    const sel = e.selected.map(indexOf).sort((a, b) => a - b);
    set(sel);
    if (e.isDragStart) { e.inputEvent.preventDefault(); setTimeout(() => moveable.dragStart(e.inputEvent)); }
  });

  let sel = [];
  function set(next, { notify = true } = {}) {
    const all = scanObjects(o.getChunk());
    const grp = new Set(next.map((i) => groupOf(all[i] || { attrs: {} })).filter(Boolean));
    next = [...new Set([...next, ...all.map((ob, i) => (grp.has(groupOf(ob)) ? i : -1)).filter((i) => i >= 0)])].sort((a, b) => a - b);
    sel = next.filter((i) => byIndex(i) && !byIndex(i).classList.contains('is-locked'));
    const els = sel.map(byIndex);
    moveable.target = els.length ? els : null;
    moveable.elementGuidelines = objEls().filter((el) => !els.includes(el));
    frame.querySelectorAll('.sl-obj').forEach((el) => el.classList.toggle('is-selected', els.includes(el)));
    // handles on a single object follow its rotation; groups are axis-aligned
    moveable.updateRect();
    if (notify) o.onSelect(sel);
  }

  /* keyboard: arrows nudge, Delete removes, Ctrl+D duplicates, Ctrl+A selects all, Esc clears */
  function onKey(e) {
    if (e.target.closest('input, textarea, select, [contenteditable="true"], .cm-editor')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); set(objEls().map(indexOf)); return; }
    if (e.key === 'Escape' && sel.length) { set([]); return; }
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

  return {
    select: set,
    setGrid(n) { moveable.snapGridWidth = n; moveable.snapGridHeight = n; moveable.updateRect(); },
    selection: () => sel,
    update: () => moveable.updateRect(),
    destroy() { stage.removeEventListener('keydown', onKey); selecto.destroy(); moveable.destroy(); },
  };
}
