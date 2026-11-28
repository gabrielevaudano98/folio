// Folio — rulers along the slide canvas and the guides dragged out of them (P2).
// View state only: guides live in memory for the open deck and are never written to the file.
// Drag from the top ruler for a horizontal guide, from the left ruler for a vertical one; drag a guide back onto a ruler
// (or off the slide) to remove it. Objects snap to guides while they move.

/** tick spacing in slide px for a zoom factor k: labels at least ~48 screen px apart, ticks at least ~6 */
export function rulerSteps(k) {
  const label = [50, 100, 200, 250, 500, 1000].find((s) => s * k >= 48) || 1000;
  const tick = [5, 10, 20, 25, 50, 100].find((s) => s * k >= 6 && label % s === 0) || label / 2;
  return { label, tick };
}
/** a guide position in slide px for a pointer at client coordinate c, or null when it is off the slide */
export const guideAt = (c, start, k, size) => { const v = Math.round((c - start) / k); return v >= 0 && v <= size ? v : null; };

/**
 * @param {{ stage: HTMLElement, frame: HTMLElement, width: number, height: number, k: () => number,
 *           guides: () => { x: number[], y: number[] }, onChange: (g: { x: number[], y: number[] }) => void,
 *           label: (key: string, vars?: object) => string, menu: (items: object[], at: { x: number, y: number }) => void }} o
 */
export function mountRulers(o) {
  const { stage, frame } = o;
  const top = document.createElement('div'); top.className = 'sl-ruler is-top'; top.setAttribute('aria-hidden', 'true');
  const left = document.createElement('div'); left.className = 'sl-ruler is-left'; left.setAttribute('aria-hidden', 'true');
  const corner = document.createElement('div'); corner.className = 'sl-ruler-corner'; corner.setAttribute('aria-hidden', 'true');
  stage.append(top, left, corner);
  let visible = false;
  let W = o.width, H = o.height;

  function layout() {
    const on = visible;
    for (const el of [top, left, corner]) el.hidden = !on;
    drawGuides();
    if (!on) return;
    const k = o.k(); const { label, tick } = rulerSteps(k);
    const fx = frame.offsetLeft, fy = frame.offsetTop, fw = frame.offsetWidth, fh = frame.offsetHeight;
    top.style.cssText = `left:${fx}px;top:${fy - 20}px;width:${fw}px;--tick:${tick * k}px;--major:${label * k}px`;
    left.style.cssText = `left:${fx - 20}px;top:${fy}px;height:${fh}px;--tick:${tick * k}px;--major:${label * k}px`;
    corner.style.cssText = `left:${fx - 20}px;top:${fy - 20}px`;
    const marks = (n) => Array.from({ length: Math.floor(n / label) + 1 }, (_, i) => i * label);
    top.innerHTML = marks(W).map((v) => `<span style="left:${v * k}px">${v}</span>`).join('');
    left.innerHTML = marks(H).map((v) => `<span style="top:${v * k}px">${v}</span>`).join('');
  }

  /* guides: lines over the slide, each draggable; the layer is put back after every render of the frame */
  function drawGuides() {
    frame.querySelector(':scope > .sl-guides')?.remove();
    if (!visible) return; // guides show, and objects snap to them, while the rulers are on
    const g = o.guides();
    const layer = document.createElement('div'); layer.className = 'sl-guides'; layer.setAttribute('aria-hidden', 'true');
    const k = o.k();
    layer.innerHTML = g.x.map((v, i) => `<div class="sl-guide is-v" data-guide="x" data-gi="${i}" style="left:${v * k}px" title="${v}"></div>`).join('')
      + g.y.map((v, i) => `<div class="sl-guide is-h" data-guide="y" data-gi="${i}" style="top:${v * k}px" title="${v}"></div>`).join('');
    frame.appendChild(layer);
  }

  /** drag a guide: from a ruler (a new one) or an existing guide; dropped off the slide it goes away */
  function drag(e, axis, index) {
    e.preventDefault(); e.stopPropagation();
    const g = o.guides(); const list = [...g[axis]];
    const at = index ?? list.push(NaN) - 1;
    const line = document.createElement('div'); line.className = `sl-guide is-${axis === 'x' ? 'v' : 'h'} is-dragging`;
    const layer = frame.querySelector(':scope > .sl-guides') || (() => { drawGuides(); return frame.querySelector(':scope > .sl-guides'); })();
    layer?.querySelector(`[data-guide="${axis}"][data-gi="${index}"]`)?.remove(); layer?.appendChild(line);
    const move = (ev) => {
      const r = frame.getBoundingClientRect(); const k = o.k();
      const v = axis === 'x' ? guideAt(ev.clientX, r.left, k, W) : guideAt(ev.clientY, r.top, k, H);
      list[at] = v ?? NaN; line.hidden = v == null; line.title = v ?? '';
      if (v != null) line.style[axis === 'x' ? 'left' : 'top'] = `${v * k}px`;
    };
    const up = (ev) => {
      move(ev);
      removeEventListener('pointermove', move, true); removeEventListener('pointerup', up, true);
      o.onChange({ ...g, [axis]: [...new Set(list.filter(Number.isFinite))] });
    };
    addEventListener('pointermove', move, true); addEventListener('pointerup', up, true);
    move(e);
  }
  top.addEventListener('pointerdown', (e) => { if (e.button === 0) drag(e, 'y'); });
  left.addEventListener('pointerdown', (e) => { if (e.button === 0) drag(e, 'x'); });
  const onGuide = (e) => {
    const el = e.target.closest?.('.sl-guide[data-guide]'); if (!el || !frame.contains(el) || e.button !== 0) return;
    drag(e, el.dataset.guide, Number(el.dataset.gi));
  };
  // guides sit over the objects: catch the press before the canvas selection sees it
  frame.addEventListener('pointerdown', onGuide, true);
  const stopMouse = (e) => { if (e.target.closest?.('.sl-guide[data-guide]')) e.stopPropagation(); };
  frame.addEventListener('mousedown', stopMouse, true);
  const clearMenu = (e) => {
    e.preventDefault();
    const g = o.guides();
    o.menu([{ label: o.label('slides.clear-guides'), disabled: !g.x.length && !g.y.length, run: () => o.onChange({ x: [], y: [] }) }], { x: e.clientX, y: e.clientY });
  };
  for (const el of [top, left, corner]) el.addEventListener('contextmenu', clearMenu);
  frame.addEventListener('contextmenu', (e) => { if (e.target.closest?.('.sl-guide[data-guide]')) clearMenu(e); });

  return {
    update(size) { if (size) { W = size.width; H = size.height; } layout(); },
    setVisible(on) { visible = !!on; layout(); },
    get visible() { return visible; },
    destroy() { top.remove(); left.remove(); corner.remove(); frame.querySelector(':scope > .sl-guides')?.remove(); },
  };
}
