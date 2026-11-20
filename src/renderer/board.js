// Folio — board surface: a draw.io-style canvas on top of board-md.
import { LIBRARY, SHAPES, CONTAINERS, ARROWS, parseBoard, serializeBoard, splitBoardDoc, joinBoardDoc, autoLayout, edgePath, shapeSvg, labelBox, defaultSize, fitAuto, ports, applyEdgeStyle } from './board-core.js';

import { perDoc } from './history.js';

const NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GRID = 10;
const snap = (v) => Math.round(v / GRID) * GRID;
const FILLS = ['', '#ffffff', '#f2f2f2', '#e3e3e3', '#cfcfcf', '#a8a8a8', '#6e6e6e', '#3a3a3a', '#1c1c1c'];
const STROKES = ['', '#1c1c1c', '#5c5c5c', '#9a9a9a', '#d0d0d0', '#ffffff'];
const MARKERS = [['', 'None'], ['arrow', 'Arrow'], ['open', 'Open arrow'], ['triangle', 'Hollow triangle'], ['diamond', 'Filled diamond'], ['diamondOpen', 'Hollow diamond'], ['circle', 'Circle']];

let measureCtx;
function wrap(text, width, font) {
  measureCtx ||= document.createElement('canvas').getContext('2d');
  measureCtx.font = font;
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const t = line ? line + ' ' + word : word;
      if (measureCtx.measureText(t).width > width && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}

export function mountBoard(host, ctx) {
  const { icons } = ctx;
  host.innerHTML = `
    <div class="sf-toolbar" role="toolbar" aria-label="Board">
      <button class="rb" type="button" data-b="undo" aria-label="Undo" data-tip="Undo (${ctx.keyLabel('Mod+Z')})">${icons.undo}</button>
      <button class="rb" type="button" data-b="redo" aria-label="Redo" data-tip="Redo (${ctx.keyLabel('Mod+Shift+Z')})">${icons.redo}</button>
      <div class="sf-sep"></div>
      <button class="btn" type="button" data-b="layout" aria-haspopup="menu">Auto layout</button>
      <button class="btn" type="button" data-b="arrange" aria-haspopup="menu">Arrange</button>
      <div class="sf-sep"></div>
      <button class="rb" type="button" data-b="zoom-out" aria-label="Zoom out">${icons.minus || '−'}</button>
      <button class="btn bd-zoom" type="button" data-b="fit" data-tip="Fit to screen">100%</button>
      <button class="rb" type="button" data-b="zoom-in" aria-label="Zoom in">${icons.plus}</button>
      <div class="sf-spacer"></div>
      <span class="bd-errors" hidden></span>
      <button class="btn" type="button" data-b="export" aria-haspopup="menu">${icons.export} Export</button>
    </div>
    <div class="bd-main">
      <aside class="bd-lib" aria-label="Shapes">
        <label class="sidebar-search bd-search"><span class="search-glyph">${icons.search}</span><input type="search" placeholder="Search shapes" aria-label="Search shapes"></label>
        <div class="bd-lib-list"></div>
      </aside>
      <div class="bd-canvas" tabindex="0" aria-label="Board canvas. Delete removes, arrows move, Enter edits the label.">
        <svg class="bd-svg" xmlns="${NS}">
          <defs>
            <pattern id="bd-grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" class="bd-dot"/></pattern>
            ${markerDefs()}
          </defs>
          <rect class="bd-bg" width="100%" height="100%" fill="url(#bd-grid)"/>
          <g class="bd-view"><g class="bd-nodes-back"></g><g class="bd-edges"></g><g class="bd-nodes"></g><g class="bd-over"></g></g>
          <rect class="bd-marquee" hidden/>
        </svg>
        <textarea class="bd-editor" hidden spellcheck="true" aria-label="Edit label"></textarea>
        <div class="bd-empty" hidden><p><b>Empty board.</b> Drag a shape from the left, or write it in code: <code>a: rect "Idea"</code>, then <code>a -> b</code>.</p></div>
      </div>
      <aside class="bd-inspector" aria-label="Format"></aside>
    </div>`;

  const svg = host.querySelector('.bd-svg'), viewG = host.querySelector('.bd-view');
  const nodesG = host.querySelector('.bd-nodes'), backG = host.querySelector('.bd-nodes-back'), edgesG = host.querySelector('.bd-edges'), overG = host.querySelector('.bd-over');
  const canvas = host.querySelector('.bd-canvas'), editorEl = host.querySelector('.bd-editor'), marquee = host.querySelector('.bd-marquee');
  const inspector = host.querySelector('.bd-inspector');

  let text = '', parts = null, model = { nodes: [], edges: [], comments: [], errors: [] };
  let sel = new Set(); // node ids and 'e:<index>'
  let view = { x: 40, y: 40, k: 1 }, fitted = false;
  const undo = [], redo = [];
  const docs = perDoc(undo, redo); let seen = false;
  let clipboard = null;

  /* ---------- model io ---------- */
  function load(t) {
    text = t; parts = splitBoardDoc(t);
    model = parseBoard(parts.code);
    model.edges.forEach(applyEdgeStyle);
    autoLayout(model);
    const ids = new Set(model.nodes.map((n) => n.id));
    sel = new Set([...sel].filter((s) => (s.startsWith('e:') ? Number(s.slice(2)) < model.edges.length : ids.has(s))));
  }
  function commit({ history = true } = {}) {
    if (history) { undo.push(text); if (undo.length > 200) undo.shift(); redo.length = 0; }
    text = joinBoardDoc(parts, serializeBoard(model));
    render();
    ctx.onChange(text);
  }
  const node = (id) => model.nodes.find((n) => n.id === id);
  function newId(base) { const b = base.replace(/[^A-Za-z_]/g, '') || 'n'; let i = 1; while (node(b + i)) i++; return b + i; }

  /* ---------- render ---------- */
  function nodeMarkup(n) {
    const s = n.style;
    const vars = [s.stroke && `--b-stroke:${s.stroke}`, s.color && `--b-text:${s.color}`, s.width && `--b-sw:${s.width}`, s.opacity && `opacity:${s.opacity}`].filter(Boolean).join(';');
    const cls = ['b-node', s.dashed || s.line === 'dashed' ? 'b-dashed' : '', s.line === 'dotted' ? 'b-dotted' : '', sel.has(n.id) ? 'selected' : '', CONTAINERS.includes(n.shape) ? 'b-is-container' : ''].join(' ');
    let inner = shapeSvg(n);
    const fs = Number(s.size) || (n.shape === 'text' ? 15 : 13);
    const font = `${s.bold || ['class', 'interface', 'table'].includes(n.shape) ? 600 : 400} ${fs}px -apple-system, "Segoe UI", system-ui, sans-serif`;
    if (['class', 'interface', 'table'].includes(n.shape)) {
      const head = 30;
      inner += `<path class="b-line" d="M0,${head} H${n.w}"/>`;
      inner += n.shape === 'interface' ? `<text class="b-text" x="${n.w / 2}" y="12" text-anchor="middle" font-size="10">«interface»</text><text class="b-text" x="${n.w / 2}" y="25" text-anchor="middle" font-weight="600" font-size="${fs}">${esc(n.label)}</text>`
        : `<text class="b-text" x="${n.w / 2}" y="${head / 2 + 5}" text-anchor="middle" font-weight="600" font-size="${fs}">${esc(n.label)}</text>`;
      let y = head + 4;
      for (const l of n.body) {
        if (l.trim() === '--') { inner += `<path class="b-line" d="M0,${y + 2} H${n.w}"/>`; y += 8; continue; }
        if (n.shape === 'table') {
          const [name = '', type = '', ...rest] = l.trim().split(/\s+/);
          const key = rest.join(' ');
          inner += `<text class="b-text b-mono" x="8" y="${y + 15}" font-size="12">${key ? `<tspan font-weight="700" font-size="10">${esc(key)} </tspan>` : ''}${esc(name)}</text><text class="b-text b-muted b-mono" x="${n.w - 8}" y="${y + 15}" text-anchor="end" font-size="11">${esc(type)}</text>`;
        } else inner += `<text class="b-text b-mono" x="8" y="${y + 15}" font-size="12">${esc(l)}</text>`;
        y += 22;
      }
    } else if (n.shape === 'note' && n.body.length) {
      const lb = labelBox(n);
      const lines = [n.label, ...n.body].flatMap((l, i) => wrap(l, lb.w, font).map((t) => [t, i === 0]));
      inner += lines.map(([t, b], i) => `<text class="b-text" x="${lb.x}" y="${lb.y + 14 + i * 19}" font-size="${fs}"${b ? ' font-weight="600"' : ''}>${esc(t)}</text>`).join('');
    } else if (n.label && !(n.shape === 'initial' && n.label === n.id) && !(n.shape === 'final' && n.label === n.id) && !(n.shape === 'fork' && n.label === n.id)) {
      const lb = labelBox(n);
      if (lb.vertical) {
        inner += `<text class="b-text" font-weight="600" font-size="${fs}" text-anchor="middle" transform="translate(${lb.w / 2 + 5},${lb.h / 2}) rotate(-90)">${esc(n.label)}</text>`;
      } else {
        const lines = wrap(n.label, Math.max(20, lb.w), font);
        const lh = fs * 1.3, total = lines.length * lh;
        const va = lb.valign || s.valign || 'middle';
        const y0 = va === 'top' ? lb.y + fs : lb.y + (lb.h - total) / 2 + fs * 0.98;
        const al = s.align || lb.align || 'center';
        const x = al === 'left' ? lb.x : al === 'right' ? lb.x + lb.w : lb.x + lb.w / 2;
        const anchor = al === 'left' ? 'start' : al === 'right' ? 'end' : 'middle';
        inner += `<text class="b-text" font-size="${lb.size || fs}" text-anchor="${anchor}"${s.bold || lb.bold ? ' font-weight="600"' : ''}>${lines.map((l, i) => `<tspan x="${x}" y="${y0 + i * lh}">${esc(l)}</tspan>`).join('')}</text>`;
      }
    }
    return `<g class="${cls}" data-id="${esc(n.id)}" transform="translate(${n.x},${n.y})" style="${vars}">${inner}</g>`;
  }
  function edgeMarkup(e, i) {
    const a = node(e.from), b = node(e.to);
    if (!a || !b) return '';
    const { d, mid } = edgePath(a, b, e);
    const s = e.style;
    const label = e.label ? (() => {
      measureCtx ||= document.createElement('canvas').getContext('2d'); measureCtx.font = '12px -apple-system, "Segoe UI", sans-serif';
      const w = measureCtx.measureText(e.label).width + 10;
      return `<rect class="b-elabel-bg" x="${mid[0] - w / 2}" y="${mid[1] - 10}" width="${w}" height="20" rx="4"/><text class="b-text" x="${mid[0]}" y="${mid[1] + 4}" text-anchor="middle" font-size="12">${esc(e.label)}</text>`;
    })() : '';
    const vars = [s.stroke && `--b-stroke:${s.stroke}`, s.width && `--b-sw:${s.width}`].filter(Boolean).join(';');
    return `<g class="b-edge ${sel.has('e:' + i) ? 'selected' : ''}" data-e="${i}" style="${vars}">
      <path class="b-edge-hit" d="${d}"/>
      <path class="b-edge-line ${e.line === 'dashed' ? 'b-dash' : e.line === 'dotted' ? 'b-dot' : ''}" d="${d}"${e.start ? ` marker-start="url(#m-${e.start}-s)"` : ''}${e.end ? ` marker-end="url(#m-${e.end}-e)"` : ''}/>
      ${label}</g>`;
  }
  function render() {
    backG.innerHTML = model.nodes.filter((n) => CONTAINERS.includes(n.shape)).map(nodeMarkup).join('');
    nodesG.innerHTML = model.nodes.filter((n) => !CONTAINERS.includes(n.shape)).map(nodeMarkup).join('');
    edgesG.innerHTML = model.edges.map(edgeMarkup).join('');
    applyView(); drawOverlay(); renderInspector();
    host.querySelector('.bd-empty').hidden = model.nodes.length > 0;
    const errs = host.querySelector('.bd-errors');
    errs.hidden = !model.errors.length;
    errs.textContent = model.errors.length ? `${model.errors.length} ${model.errors.length === 1 ? 'line' : 'lines'} not understood, see code view` : '';
    errs.title = model.errors.map((e) => `Line ${e.line}: ${e.msg}`).join('\n');
    host.querySelector('[data-b="undo"]').disabled = !undo.length;
    host.querySelector('[data-b="redo"]').disabled = !redo.length;
    ctx.onStatus?.(`${model.nodes.length} ${model.nodes.length === 1 ? 'shape' : 'shapes'}, ${model.edges.length} ${model.edges.length === 1 ? 'connector' : 'connectors'}`);
  }
  function applyView() {
    viewG.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
    host.querySelector('#bd-grid')?.setAttribute('patternTransform', `translate(${view.x},${view.y}) scale(${view.k})`);
    host.querySelector('.bd-zoom').textContent = `${Math.round(view.k * 100)}%`;
  }
  function drawOverlay(hoverId) {
    let h = '';
    const nodesSel = [...sel].filter((s) => !s.startsWith('e:')).map(node).filter(Boolean);
    if (nodesSel.length === 1) {
      const n = nodesSel[0], hs = 7 / view.k;
      h += `<rect class="bd-sel" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" style="stroke-width:${1.5 / view.k}"/>`;
      for (const [k, x, y] of handles(n)) h += `<rect class="bd-handle" data-h="${k}" x="${x - hs / 2}" y="${y - hs / 2}" width="${hs}" height="${hs}" style="stroke-width:${1 / view.k}"/>`;
    } else for (const n of nodesSel) h += `<rect class="bd-sel" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" style="stroke-width:${1.5 / view.k}"/>`;
    const portFor = hoverId ? node(hoverId) : nodesSel.length === 1 ? nodesSel[0] : null;
    if (portFor && !CONTAINERS.includes(portFor.shape)) for (const [k, [x, y]] of Object.entries(ports(portFor))) h += `<circle class="bd-port" data-port="${k}" data-node="${esc(portFor.id)}" cx="${x}" cy="${y}" r="${5 / view.k}" style="stroke-width:${1.5 / view.k}"/>`;
    overG.innerHTML = h;
  }
  const handles = (n) => [['nw', n.x, n.y], ['n', n.x + n.w / 2, n.y], ['ne', n.x + n.w, n.y], ['e', n.x + n.w, n.y + n.h / 2], ['se', n.x + n.w, n.y + n.h], ['s', n.x + n.w / 2, n.y + n.h], ['sw', n.x, n.y + n.h], ['w', n.x, n.y + n.h / 2]];

  function fit() {
    const r = canvas.getBoundingClientRect();
    if (!model.nodes.length || !r.width) { view = { x: 40, y: 40, k: 1 }; applyView(); return; }
    const minX = Math.min(...model.nodes.map((n) => n.x)) - 40, minY = Math.min(...model.nodes.map((n) => n.y)) - 40;
    const maxX = Math.max(...model.nodes.map((n) => n.x + n.w)) + 40, maxY = Math.max(...model.nodes.map((n) => n.y + n.h)) + 60;
    const k = Math.min(1.5, Math.max(0.15, Math.min(r.width / (maxX - minX), r.height / (maxY - minY))));
    view = { k, x: (r.width - (maxX - minX) * k) / 2 - minX * k, y: (r.height - (maxY - minY) * k) / 2 - minY * k };
    applyView(); drawOverlay();
  }
  function zoomAt(k, cx, cy) {
    k = Math.max(0.1, Math.min(4, k));
    view.x = cx - (cx - view.x) * (k / view.k); view.y = cy - (cy - view.y) * (k / view.k); view.k = k;
    applyView(); drawOverlay();
  }
  const toModel = (ev) => { const r = svg.getBoundingClientRect(); return [(ev.clientX - r.left - view.x) / view.k, (ev.clientY - r.top - view.y) / view.k]; };

  /* ---------- library ---------- */
  function libTile(shape, name) {
    const [w, h] = defaultSize(shape);
    const n = { shape, w, h: h || 80, label: '', style: {}, body: shape === 'class' ? ['+ field', '--', '+ method()'] : shape === 'table' ? ['id uuid PK', 'name text'] : [], id: '' };
    fitAuto(n);
    const pad = 6, k = Math.min(40 / (n.w + pad * 2), 32 / (n.h + pad * 2 + (shape === 'actor' ? 0 : 0)));
    return `<button class="bd-tile" type="button" draggable="true" data-shape="${shape}" aria-label="${esc(name)}" data-tip="${esc(name)}">
      <svg viewBox="${-pad - 10} ${-pad} ${n.w + pad * 2 + 20} ${n.h + pad * 2}" width="44" height="34">${shapeSvg(n)}</svg></button>`;
  }
  function renderLib(q = '') {
    const ql = q.trim().toLowerCase();
    host.querySelector('.bd-lib-list').innerHTML = LIBRARY.map(([cat, list]) => {
      const items = list.filter(([s, name]) => !ql || name.toLowerCase().includes(ql) || s.includes(ql) || cat.toLowerCase().includes(ql));
      return items.length ? `<details class="bd-cat" open><summary>${esc(cat)}</summary><div class="bd-tiles">${items.map(([s, name]) => libTile(s, name)).join('')}</div></details>` : '';
    }).join('') || '<p class="side-empty">No shapes match.</p>';
  }
  function addShape(shape, at) {
    const [w, h] = defaultSize(shape);
    const r = canvas.getBoundingClientRect();
    const [cx, cy] = at || [(r.width / 2 - view.x) / view.k, (r.height / 2 - view.y) / view.k];
    const name = LIBRARY.flatMap(([, l]) => l).find(([s]) => s === shape)?.[1] || shape;
    const n = { id: newId(shape), shape, label: ['initial', 'final', 'fork'].includes(shape) ? '' : name, x: snap(cx - w / 2), y: snap(cy - (h || 60) / 2), w, h, style: {}, body: [] };
    if (shape === 'class') { n.label = 'ClassName'; n.body = ['+ attribute: Type', '--', '+ operation(): void']; }
    if (shape === 'interface') { n.label = 'InterfaceName'; n.body = ['+ operation(): void']; }
    if (shape === 'table') { n.label = 'entity'; n.body = ['id uuid PK', 'name text', 'created_at timestamp']; }
    if (['initial', 'final', 'fork'].includes(shape)) n.label = n.id;
    fitAuto(n);
    model.nodes.push(n);
    sel = new Set([n.id]);
    commit();
    if (!['initial', 'final', 'fork'].includes(shape)) setTimeout(() => editLabel(n.id), 0);
  }

  /* ---------- label editor ---------- */
  function editLabel(id) {
    const n = node(id) ?? null;
    const edge = id.startsWith?.('e:') ? model.edges[Number(id.slice(2))] : null;
    if (!n && !edge) return;
    const r = canvas.getBoundingClientRect();
    let box;
    if (n) { const lb = ['class', 'interface', 'table', 'note'].includes(n.shape) ? { x: 0, y: 0, w: n.w, h: Math.max(n.h, 80) } : labelBox(n); box = { x: n.x + lb.x, y: n.y + lb.y, w: Math.max(lb.w, 120), h: Math.max(lb.h, 36) }; }
    else { const { mid } = edgePath(node(edge.from), node(edge.to), edge); box = { x: mid[0] - 70, y: mid[1] - 16, w: 140, h: 32 }; }
    Object.assign(editorEl.style, { left: `${box.x * view.k + view.x}px`, top: `${box.y * view.k + view.y}px`, width: `${box.w * view.k}px`, height: `${box.h * view.k}px`, fontSize: `${13 * view.k}px` });
    editorEl.value = n ? (n.body.length ? [n.label, ...n.body].join('\n') : n.label) : edge.label;
    editorEl.hidden = false; editorEl.focus(); editorEl.select();
    const done = (save) => {
      editorEl.hidden = true; editorEl.onkeydown = editorEl.onblur = null;
      if (!save) return canvas.focus();
      const v = editorEl.value;
      if (n) {
        if (['class', 'interface', 'table'].includes(n.shape) || (n.shape === 'note' && v.includes('\n'))) { const [first, ...rest] = v.split('\n'); n.label = first; n.body = rest; fitAuto(n); }
        else n.label = v;
      } else edge.label = v.replace(/\n/g, ' ');
      commit(); canvas.focus();
    };
    editorEl.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') done(false);
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || (!e.shiftKey && !(n && (n.body.length || ['class', 'interface', 'table', 'note'].includes(n.shape)))))) { e.preventDefault(); done(true); }
    };
    editorEl.onblur = () => done(true);
  }

  /* ---------- pointer interactions ---------- */
  let drag = null, spaceDown = false;
  svg.addEventListener('pointerdown', (ev) => {
    canvas.focus();
    if (!editorEl.hidden) return;
    const [mx, my] = toModel(ev);
    const t = ev.target;
    if (ev.button === 1 || spaceDown) { drag = { type: 'pan', sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y }; svg.setPointerCapture(ev.pointerId); return; }
    if (t.classList.contains('bd-handle')) { const n = node([...sel][0]); drag = { type: 'resize', h: t.dataset.h, n, o: { ...n }, mx, my }; svg.setPointerCapture(ev.pointerId); return; }
    if (t.classList.contains('bd-port')) { drag = { type: 'connect', from: t.dataset.node, port: t.dataset.port, mx, my }; svg.setPointerCapture(ev.pointerId); return; }
    const g = t.closest('.b-node'), eg = t.closest('.b-edge');
    if (g) {
      const id = g.dataset.id;
      if (ev.shiftKey || ev.metaKey || ev.ctrlKey) { sel.has(id) ? sel.delete(id) : sel.add(id); }
      else if (!sel.has(id)) sel = new Set([id]);
      const moving = new Set([...sel].filter((s) => !s.startsWith('e:')));
      for (const id2 of [...moving]) { const c = node(id2); if (c && CONTAINERS.includes(c.shape)) for (const m of model.nodes) if (m !== c && m.x >= c.x && m.y >= c.y && m.x + m.w <= c.x + c.w && m.y + m.h <= c.y + c.h) moving.add(m.id); }
      drag = { type: 'move', mx, my, start: [...moving].map((i) => [node(i), node(i).x, node(i).y]), moved: false };
      svg.setPointerCapture(ev.pointerId);
      render(); return;
    }
    if (eg) { const id = 'e:' + eg.dataset.e; if (ev.shiftKey) sel.add(id); else sel = new Set([id]); render(); return; }
    sel.clear(); render();
    drag = { type: 'marquee', mx, my, cx: ev.clientX, cy: ev.clientY };
    svg.setPointerCapture(ev.pointerId);
  });
  svg.addEventListener('pointermove', (ev) => {
    const [mx, my] = toModel(ev);
    if (!drag) { const g = ev.target.closest('.b-node'); const id = g?.dataset.id || (ev.target.classList.contains('bd-port') ? ev.target.dataset.node : null); if (id !== svg.__hover) { svg.__hover = id; drawOverlay(id); } return; }
    if (drag.type === 'pan') { view.x = drag.vx + ev.clientX - drag.sx; view.y = drag.vy + ev.clientY - drag.sy; applyView(); drawOverlay(); }
    if (drag.type === 'move') {
      const dx = snap(mx - drag.mx), dy = snap(my - drag.my);
      if (dx || dy) drag.moved = true;
      for (const [n, x, y] of drag.start) { n.x = x + dx; n.y = y + dy; }
      render();
    }
    if (drag.type === 'resize') {
      const { n, o, h } = drag; const dx = mx - drag.mx, dy = my - drag.my;
      if (h.includes('e')) n.w = Math.max(20, snap(o.w + dx));
      if (h.includes('s')) n.h = Math.max(8, snap(o.h + dy));
      if (h.includes('w')) { n.w = Math.max(20, snap(o.w - dx)); n.x = o.x + o.w - n.w; }
      if (h.includes('n')) { n.h = Math.max(8, snap(o.h - dy)); n.y = o.y + o.h - n.h; }
      n.sized = true; drag.moved = true; render();
    }
    if (drag.type === 'connect') {
      const a = node(drag.from), [x1, y1] = ports(a)[drag.port];
      overG.insertAdjacentHTML('beforeend', '');
      let tmp = overG.querySelector('.bd-tmp');
      if (!tmp) { tmp = document.createElementNS(NS, 'path'); tmp.setAttribute('class', 'bd-tmp'); tmp.setAttribute('marker-end', 'url(#m-arrow-e)'); overG.appendChild(tmp); }
      tmp.setAttribute('d', `M${x1},${y1} L${mx},${my}`);
      const target = model.nodes.find((n) => n.id !== a.id && !CONTAINERS.includes(n.shape) && mx >= n.x && mx <= n.x + n.w && my >= n.y && my <= n.y + n.h);
      overG.querySelectorAll('.bd-target').forEach((x) => x.remove());
      if (target) overG.insertAdjacentHTML('afterbegin', `<rect class="bd-target" x="${target.x - 4}" y="${target.y - 4}" width="${target.w + 8}" height="${target.h + 8}" rx="6" style="stroke-width:${2 / view.k}"/>`);
      drag.target = target;
    }
    if (drag.type === 'marquee') {
      const r = svg.getBoundingClientRect();
      const x = Math.min(drag.cx, ev.clientX) - r.left, y = Math.min(drag.cy, ev.clientY) - r.top;
      marquee.hidden = false;
      Object.entries({ x, y, width: Math.abs(ev.clientX - drag.cx), height: Math.abs(ev.clientY - drag.cy) }).forEach(([k, v]) => marquee.setAttribute(k, v));
      const [x0, y0, x1, y1] = [Math.min(drag.mx, mx), Math.min(drag.my, my), Math.max(drag.mx, mx), Math.max(drag.my, my)];
      sel = new Set(model.nodes.filter((n) => n.x >= x0 && n.y >= y0 && n.x + n.w <= x1 && n.y + n.h <= y1).map((n) => n.id));
      drawOverlay();
    }
  });
  svg.addEventListener('pointerup', (ev) => {
    if (!drag) return;
    const d = drag; drag = null;
    marquee.hidden = true;
    if ((d.type === 'move' || d.type === 'resize') && d.moved) { const before = text; commit({ history: false }); undo.push(before); redo.length = 0; render(); }
    if (d.type === 'marquee') render();
    if (d.type === 'connect') {
      overG.querySelector('.bd-tmp')?.remove();
      if (d.target) {
        const [mx, my] = toModel(ev);
        const tp = Object.entries(ports(d.target)).sort((p, q) => Math.hypot(p[1][0] - mx, p[1][1] - my) - Math.hypot(q[1][0] - mx, q[1][1] - my))[0][0];
        model.edges.push({ from: d.from, fromPort: d.port, to: d.target.id, toPort: tp, label: '', style: {}, line: 'solid', end: 'arrow' });
        sel = new Set(['e:' + (model.edges.length - 1)]);
        commit();
      } else drawOverlay();
    }
  });
  svg.addEventListener('dblclick', (ev) => {
    const g = ev.target.closest('.b-node'), eg = ev.target.closest('.b-edge');
    if (g) editLabel(g.dataset.id);
    else if (eg) editLabel('e:' + eg.dataset.e);
    else { const [mx, my] = toModel(ev); addShapeAt('rounded', mx, my); }
  });
  function addShapeAt(shape, mx, my) { addShape(shape, [mx, my]); }
  svg.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = svg.getBoundingClientRect();
    if (ev.ctrlKey || ev.metaKey) zoomAt(view.k * Math.exp(-ev.deltaY * 0.01), ev.clientX - r.left, ev.clientY - r.top);
    else { view.x -= ev.deltaX; view.y -= ev.deltaY; applyView(); drawOverlay(); }
  }, { passive: false });
  svg.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    const g = ev.target.closest('.b-node'), eg = ev.target.closest('.b-edge');
    if (g && !sel.has(g.dataset.id)) { sel = new Set([g.dataset.id]); render(); }
    if (eg) { sel = new Set(['e:' + eg.dataset.e]); render(); }
    const at = { x: ev.clientX, y: ev.clientY };
    if (!sel.size) { const [mx, my] = toModel(ev); return ctx.showMenu(null, [{ label: 'Paste', run: () => paste([mx, my]) }, { label: 'Select all', run: selectAll }, '-', { label: 'Auto layout', run: () => layoutAll('LR') }], at); }
    ctx.showMenu(null, [
      { label: 'Edit label', key: 'Enter', run: () => editLabel([...sel][0]) },
      { label: 'Duplicate', key: 'Mod+D', run: duplicate }, { label: 'Copy', key: 'Mod+C', run: copy }, '-',
      { label: 'Bring to front', run: () => zorder(1) }, { label: 'Send to back', run: () => zorder(-1) }, '-',
      ...(g ? [{ label: 'Copy link to shape', run: () => ctx.copyRef?.(g.dataset.id, 'link') }, { label: 'Copy embed reference', run: () => ctx.copyRef?.(g.dataset.id, 'embed') }, '-'] : []),
      { label: 'Delete', danger: true, key: 'Delete', run: remove },
    ], at);
  });

  // library drag and click
  host.querySelector('.bd-lib-list').addEventListener('click', (e) => { const t = e.target.closest('[data-shape]'); if (t) addShape(t.dataset.shape); });
  host.querySelector('.bd-lib-list').addEventListener('dragstart', (e) => { const t = e.target.closest('[data-shape]'); if (t) e.dataTransfer.setData('text/x-folio-shape', t.dataset.shape); });
  canvas.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-folio-shape')) e.preventDefault(); });
  canvas.addEventListener('drop', (e) => { const s = e.dataTransfer.getData('text/x-folio-shape'); if (!s) return; e.preventDefault(); const [mx, my] = toModel(e); addShape(s, [mx, my]); });
  host.querySelector('.bd-search input').addEventListener('input', (e) => renderLib(e.target.value));

  /* ---------- keyboard ---------- */
  canvas.addEventListener('keydown', (e) => {
    if (e.target !== canvas) return;
    const m = e.metaKey || e.ctrlKey;
    if (e.key === ' ') { spaceDown = true; canvas.classList.add('panning'); e.preventDefault(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) { e.preventDefault(); remove(); }
    else if (m && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
    else if (m && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
    else if (m && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
    else if (m && e.key.toLowerCase() === 'c') { e.preventDefault(); copy(); }
    else if (m && e.key.toLowerCase() === 'x') { e.preventDefault(); copy(); remove(); }
    else if (m && e.key.toLowerCase() === 'v') { e.preventDefault(); paste(); }
    else if (m && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); }
    else if (m && e.key === '0') { e.preventDefault(); fit(); }
    else if (e.key === '+' || e.key === '=') { const r = canvas.getBoundingClientRect(); zoomAt(view.k * 1.2, r.width / 2, r.height / 2); }
    else if (e.key === '-') { const r = canvas.getBoundingClientRect(); zoomAt(view.k / 1.2, r.width / 2, r.height / 2); }
    else if (e.key === 'Enter' && sel.size === 1) { e.preventDefault(); editLabel([...sel][0]); }
    else if (e.key === 'Escape') { sel.clear(); render(); }
    else if (e.key.startsWith('Arrow') && sel.size) {
      e.preventDefault();
      const st = e.shiftKey ? 50 : GRID, [dx, dy] = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
      for (const id of sel) { const n = node(id); if (n) { n.x += dx; n.y += dy; } }
      commit();
    }
  });
  canvas.addEventListener('keyup', (e) => { if (e.key === ' ') { spaceDown = false; canvas.classList.remove('panning'); } });

  /* ---------- operations ---------- */
  function doUndo() { if (!undo.length) return; redo.push(text); const t = undo.pop(); load(t); render(); ctx.onChange(text); }
  function doRedo() { if (!redo.length) return; undo.push(text); const t = redo.pop(); load(t); render(); ctx.onChange(text); }
  function selectAll() { sel = new Set(model.nodes.map((n) => n.id)); render(); }
  function remove() {
    const ids = new Set([...sel].filter((s) => !s.startsWith('e:')));
    const eidx = new Set([...sel].filter((s) => s.startsWith('e:')).map((s) => Number(s.slice(2))));
    model.edges = model.edges.filter((e, i) => !eidx.has(i) && !ids.has(e.from) && !ids.has(e.to));
    model.nodes = model.nodes.filter((n) => !ids.has(n.id));
    sel.clear(); commit();
  }
  function copy() {
    const ids = new Set([...sel].filter((s) => !s.startsWith('e:')));
    if (!ids.size) return;
    clipboard = { nodes: model.nodes.filter((n) => ids.has(n.id)).map((n) => structuredClone(n)), edges: model.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => structuredClone(e)) };
  }
  function paste(at) {
    if (!clipboard) return;
    const map = {};
    const minX = Math.min(...clipboard.nodes.map((n) => n.x)), minY = Math.min(...clipboard.nodes.map((n) => n.y));
    const add = clipboard.nodes.map((n) => { const c = structuredClone(n); c.pre = []; map[n.id] = c.id = newId(n.shape); c.x = at ? snap(at[0] + n.x - minX) : n.x + 20; c.y = at ? snap(at[1] + n.y - minY) : n.y + 20; model.nodes.push(c); return c; });
    for (const e of clipboard.edges) model.edges.push({ ...structuredClone(e), from: map[e.from], to: map[e.to] });
    clipboard = { nodes: add.map((n) => structuredClone(n)), edges: clipboard.edges.map((e) => ({ ...e, from: map[e.from], to: map[e.to] })) };
    sel = new Set(add.map((n) => n.id)); commit();
  }
  function duplicate() { copy(); paste(); }
  function zorder(dir) {
    const ids = new Set(sel);
    const picked = model.nodes.filter((n) => ids.has(n.id)), rest = model.nodes.filter((n) => !ids.has(n.id));
    model.nodes = dir > 0 ? [...rest, ...picked] : [...picked, ...rest];
    commit();
  }
  function align(how) {
    const ns = [...sel].map(node).filter(Boolean); if (ns.length < 2) return;
    const x0 = Math.min(...ns.map((n) => n.x)), x1 = Math.max(...ns.map((n) => n.x + n.w)), y0 = Math.min(...ns.map((n) => n.y)), y1 = Math.max(...ns.map((n) => n.y + n.h));
    for (const n of ns) {
      if (how === 'left') n.x = x0; if (how === 'right') n.x = x1 - n.w; if (how === 'center') n.x = snap((x0 + x1) / 2 - n.w / 2);
      if (how === 'top') n.y = y0; if (how === 'bottom') n.y = y1 - n.h; if (how === 'middle') n.y = snap((y0 + y1) / 2 - n.h / 2);
    }
    if (how === 'hdist' || how === 'vdist') {
      const key = how === 'hdist' ? 'x' : 'y', size = how === 'hdist' ? 'w' : 'h';
      const sorted = ns.sort((a, b) => a[key] - b[key]);
      const span = (sorted.at(-1)[key] + sorted.at(-1)[size]) - sorted[0][key];
      const gap = (span - sorted.reduce((s, n) => s + n[size], 0)) / (sorted.length - 1);
      let pos = sorted[0][key];
      for (const n of sorted) { n[key] = snap(pos); pos += n[size] + gap; }
    }
    commit();
  }
  function layoutAll(dir) { autoLayout(model, { dir, all: true }); commit(); fit(); }

  host.querySelector('[data-b="undo"]').onclick = doUndo;
  host.querySelector('[data-b="redo"]').onclick = doRedo;
  host.querySelector('[data-b="fit"]').onclick = fit;
  host.querySelector('[data-b="zoom-in"]').onclick = () => { const r = canvas.getBoundingClientRect(); zoomAt(view.k * 1.2, r.width / 2, r.height / 2); };
  host.querySelector('[data-b="zoom-out"]').onclick = () => { const r = canvas.getBoundingClientRect(); zoomAt(view.k / 1.2, r.width / 2, r.height / 2); };
  host.querySelector('[data-b="layout"]').onclick = (e) => ctx.showMenu(e.currentTarget, [{ label: 'Left to right', run: () => layoutAll('LR') }, { label: 'Top to bottom', run: () => layoutAll('TB') }, { label: 'Right to left', run: () => layoutAll('RL') }, { label: 'Bottom to top', run: () => layoutAll('BT') }]);
  host.querySelector('[data-b="arrange"]').onclick = (e) => ctx.showMenu(e.currentTarget, [
    { head: 'Align (two or more shapes)' }, { label: 'Align left', run: () => align('left') }, { label: 'Align center', run: () => align('center') }, { label: 'Align right', run: () => align('right') },
    { label: 'Align top', run: () => align('top') }, { label: 'Align middle', run: () => align('middle') }, { label: 'Align bottom', run: () => align('bottom') }, '-',
    { label: 'Distribute horizontally', run: () => align('hdist') }, { label: 'Distribute vertically', run: () => align('vdist') }, '-',
    { label: 'Bring to front', run: () => zorder(1) }, { label: 'Send to back', run: () => zorder(-1) },
  ]);
  host.querySelector('[data-b="export"]').onclick = (e) => ctx.showMenu(e.currentTarget, [{ label: 'PNG image…', run: () => exportImage('png') }, { label: 'SVG image…', run: () => exportImage('svg') }]);

  /* ---------- inspector ---------- */
  function swatches(list, cur, attr) {
    return `<div class="bd-swatches">${list.map((c) => `<button type="button" class="bd-sw ${c ? '' : 'bd-sw-none'}" data-${attr}="${c}" aria-pressed="${(cur || '') === c}" aria-label="${c || 'Default'}" style="${c ? `background:${c}` : ''}"></button>`).join('')}</div>`;
  }
  function renderInspector() {
    const ns = [...sel].filter((s) => !s.startsWith('e:')).map(node).filter(Boolean);
    const es = [...sel].filter((s) => s.startsWith('e:')).map((s) => model.edges[Number(s.slice(2))]).filter(Boolean);
    if (!ns.length && !es.length) {
      inspector.innerHTML = `<h3 class="bd-ins-h">Board</h3>
        <p class="bd-ins-note">Double-click empty space to add a shape. Drag from the dots on a shape to connect it. Hold Space or the middle button to pan, ${esc(ctx.keyLabel('Mod'))} and scroll to zoom.</p>
        <div class="bd-ins-row"><button class="btn" type="button" data-ins="layout-lr">Auto layout →</button><button class="btn" type="button" data-ins="layout-tb">Auto layout ↓</button></div>
        <h3 class="bd-ins-h">In code</h3>
        <pre class="bd-cheat">a: rect "Idea" @40,40
b: diamond "Ok?"
c: class "Order" [
  + id: UUID
  --
  + pay()
]
a -> b "next"
b -->  c
A -|> B   inherits
A ..|> B  implements
A *-- B   composition
A o-- B   aggregation</pre>`;
      return;
    }
    if (es.length && !ns.length) {
      const e = es[0];
      inspector.innerHTML = `<h3 class="bd-ins-h">Connector</h3>
        <div class="field"><label>Label</label><input class="input" data-e-label value="${esc(e.label)}"></div>
        <div class="field"><label>Line</label><select class="select" data-e="line"><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></div>
        <div class="field"><label>Route</label><select class="select" data-e="route"><option value="orthogonal">Right angles</option><option value="straight">Straight</option><option value="curved">Curved</option></select></div>
        <div class="field"><label>Start</label><select class="select" data-e="start">${MARKERS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
        <div class="field"><label>End</label><select class="select" data-e="end">${MARKERS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
        <div class="field"><label>Color</label>${swatches(STROKES, e.style.stroke, 'estroke')}</div>
        <div class="bd-ins-row"><button class="btn" type="button" data-ins="swap">Reverse</button><button class="btn" type="button" data-ins="delete">Delete</button></div>`;
      inspector.querySelector('[data-e="line"]').value = e.line || 'solid';
      inspector.querySelector('[data-e="route"]').value = e.style.route || 'orthogonal';
      inspector.querySelector('[data-e="start"]').value = e.start || '';
      inspector.querySelector('[data-e="end"]').value = e.end || '';
      return;
    }
    const n = ns[0], one = ns.length === 1;
    inspector.innerHTML = `<h3 class="bd-ins-h">${one ? 'Shape' : `${ns.length} shapes`}</h3>
      ${one ? `<div class="field"><label>Type</label><select class="select" data-n="shape">${SHAPES.map((s) => `<option value="${s}">${s}</option>`).join('')}</select></div>
      <div class="field"><label>Label</label><textarea class="input bd-label-input" data-n-label rows="${n.body.length ? 5 : 2}">${esc(n.body.length ? [n.label, ...n.body].join('\n') : n.label)}</textarea></div>` : ''}
      <div class="field"><label>Fill</label>${swatches(FILLS, n.style.fill, 'fill')}</div>
      <div class="field"><label>Line</label>${swatches(STROKES, n.style.stroke, 'stroke')}
        <div class="bd-ins-row"><select class="select" data-n="line"><option value="">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select>
        <select class="select" data-n="width"><option value="">1.5 pt</option><option value="1">1 pt</option><option value="2">2 pt</option><option value="3">3 pt</option></select></div></div>
      <div class="field"><label>Text</label><div class="bd-ins-row"><select class="select" data-n="size"><option value="">13 pt</option>${[11, 12, 15, 18, 22, 28, 36].map((v) => `<option value="${v}">${v} pt</option>`).join('')}</select>
        <button class="rb" type="button" data-ins="bold" aria-pressed="${!!n.style.bold}" aria-label="Bold">${icons.bold}</button>
        <select class="select" data-n="align"><option value="">Center</option><option value="left">Left</option><option value="right">Right</option></select></div></div>
      ${one ? `<div class="field"><label>Position and size</label><div class="bd-xywh">${['x', 'y', 'w', 'h'].map((k) => `<label><span>${k.toUpperCase()}</span><input class="input" data-geo="${k}" inputmode="numeric" value="${Math.round(n[k])}"></label>`).join('')}</div></div>` : ''}
      <div class="bd-ins-row"><button class="btn" type="button" data-ins="front">Front</button><button class="btn" type="button" data-ins="back">Back</button><button class="btn" type="button" data-ins="delete">Delete</button></div>`;
    if (one) inspector.querySelector('[data-n="shape"]').value = n.shape;
    inspector.querySelector('[data-n="line"]').value = n.style.line || (n.style.dashed ? 'dashed' : '');
    inspector.querySelector('[data-n="width"]').value = n.style.width || '';
    inspector.querySelector('[data-n="size"]').value = n.style.size || '';
    inspector.querySelector('[data-n="align"]').value = n.style.align || '';
  }
  const selNodes = () => [...sel].filter((s) => !s.startsWith('e:')).map(node).filter(Boolean);
  const selEdges = () => [...sel].filter((s) => s.startsWith('e:')).map((s) => model.edges[Number(s.slice(2))]).filter(Boolean);
  const setStyle = (k, v) => { for (const n of selNodes()) { if (v) n.style[k] = v; else delete n.style[k]; if (k === 'line') delete n.style.dashed; } commit(); };
  inspector.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.fill !== undefined) return setStyle('fill', b.dataset.fill);
    if (b.dataset.stroke !== undefined) return setStyle('stroke', b.dataset.stroke);
    if (b.dataset.estroke !== undefined) { for (const ed of selEdges()) { if (b.dataset.estroke) ed.style.stroke = b.dataset.estroke; else delete ed.style.stroke; } return commit(); }
    const a = b.dataset.ins;
    if (a === 'layout-lr') layoutAll('LR'); if (a === 'layout-tb') layoutAll('TB');
    if (a === 'delete') remove(); if (a === 'front') zorder(1); if (a === 'back') zorder(-1);
    if (a === 'bold') { const on = !selNodes()[0]?.style.bold; setStyle('bold', on ? true : ''); }
    if (a === 'swap') { for (const ed of selEdges()) { [ed.from, ed.to] = [ed.to, ed.from]; [ed.fromPort, ed.toPort] = [ed.toPort, ed.fromPort]; [ed.start, ed.end] = [ed.end, ed.start]; } commit(); }
  });
  inspector.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.n === 'shape') { const n = selNodes()[0]; n.shape = t.value; if (!n.sized) { [n.w, n.h] = defaultSize(n.shape); fitAuto(n); } return commit(); }
    if (t.dataset.n) return setStyle(t.dataset.n, t.value);
    if (t.dataset.e === 'route') { for (const ed of selEdges()) { if (t.value === 'orthogonal') delete ed.style.route; else ed.style.route = t.value; } return commit(); }
    if (t.dataset.e) { for (const ed of selEdges()) ed[t.dataset.e] = t.value || null; return commit(); }
    if (t.dataset.geo) { const n = selNodes()[0]; const v = Number(t.value); if (Number.isFinite(v)) { n[t.dataset.geo] = v; if ('wh'.includes(t.dataset.geo)) n.sized = true; commit(); } }
  });
  inspector.addEventListener('input', (e) => {
    const t = e.target;
    clearTimeout(t.__timer);
    t.__timer = setTimeout(() => {
      if (t.matches('[data-n-label]')) { const n = selNodes()[0]; const [first, ...rest] = t.value.split('\n'); if (n.body.length || ['class', 'interface', 'table'].includes(n.shape)) { n.label = first; n.body = rest; fitAuto(n); } else n.label = t.value; commit(); }
      if (t.matches('[data-e-label]')) { for (const ed of selEdges()) ed.label = t.value; commit(); }
    }, 300);
  });

  /* ---------- export ---------- */
  function exportSvgString() {
    if (!model.nodes.length) return null;
    const minX = Math.min(...model.nodes.map((n) => n.x)) - 50, minY = Math.min(...model.nodes.map((n) => n.y)) - 50;
    const maxX = Math.max(...model.nodes.map((n) => n.x + n.w)) + 50, maxY = Math.max(...model.nodes.map((n) => n.y + n.h)) + 70;
    const save = new Set(sel); sel.clear(); render();
    const body = backG.outerHTML + edgesG.outerHTML + nodesG.outerHTML;
    sel = save; render();
    const css = `.b-shape{fill:#fff;stroke:var(--b-stroke,#1c1c1c);stroke-width:var(--b-sw,1.5)}.b-container{fill:rgba(0,0,0,.025);stroke:var(--b-stroke,#9a9a9a);stroke-width:var(--b-sw,1.2);stroke-dasharray:6 4}.b-line{fill:none;stroke:var(--b-stroke,#1c1c1c);stroke-width:var(--b-sw,1.5)}.b-dash{stroke-dasharray:6 4}.b-dot{stroke-dasharray:1.5 4;stroke-linecap:round}.b-dashed .b-shape,.b-dashed .b-line{stroke-dasharray:6 4}.b-dotted .b-shape{stroke-dasharray:1.5 4}.b-fill-ink{fill:var(--b-stroke,#1c1c1c)}.b-hit{fill:transparent}.b-text{fill:var(--b-text,#1c1c1c);font-family:-apple-system,"Segoe UI",system-ui,sans-serif}.b-muted{fill:#777}.b-mono{font-family:ui-monospace,"SF Mono",Consolas,monospace}.b-edge-hit{display:none}.b-edge-line{fill:none;stroke:var(--b-stroke,#1c1c1c);stroke-width:var(--b-sw,1.5)}.b-elabel-bg{fill:#fff}.bd-mk{fill:#1c1c1c;stroke:#1c1c1c}.bd-mk-o{fill:#fff;stroke:#1c1c1c}`;
    return { w: maxX - minX, h: maxY - minY, svg: `<svg xmlns="${NS}" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" width="${maxX - minX}" height="${maxY - minY}"><style>${css}</style><defs>${markerDefs()}</defs><rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" fill="#fff"/>${body}</svg>` };
  }
  async function exportImage(kind) {
    const out = exportSvgString();
    if (!out) return ctx.toast('The board is empty.');
    try {
      if (kind === 'svg') { const r = await ctx.saveBinary('svg', new TextEncoder().encode(out.svg)); if (r) ctx.toast('Board exported as SVG.'); return; }
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(out.svg);
      await img.decode();
      const c = document.createElement('canvas'); c.width = out.w * 2; c.height = out.h * 2;
      const g = c.getContext('2d'); g.scale(2, 2); g.drawImage(img, 0, 0);
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      const r = await ctx.saveBinary('png', new Uint8Array(await blob.arrayBuffer()));
      if (r) ctx.toast('Board exported as PNG.');
    } catch (e) { ctx.toast(`Export failed. ${e.message}`, { kind: 'error' }); }
  }

  new ResizeObserver(() => { if (!fitted && model.nodes.length && canvas.clientWidth) { fitted = true; fit(); } }).observe(canvas);
  renderLib();

  return {
    setText(t) {
      const moved = docs.bind(ctx.docKey?.()); const had = seen; seen = true;
      if (t === text) { if (moved) render(); return; }
      if (!moved && had) { undo.push(text); if (undo.length > 200) undo.shift(); redo.length = 0; } // an outside change is its own undo step
      const first = !parts;
      load(t); render();
      if (first || !fitted) { fitted = false; requestAnimationFrame(() => { if (canvas.clientWidth) { fitted = true; fit(); } }); }
    },
    setMode(v) { host.classList.toggle('bd-compact', v === 'split'); requestAnimationFrame(() => { drawOverlay(); }); },
    gotoNode(id) { if (model?.nodes.some((n) => n.id === id)) { sel = new Set([id]); render(); } },
    selectAtLine(line) {
      const n = model.nodes.find((x) => x.line === line - (parts.before.split('\n').length));
      if (n && !(sel.size === 1 && sel.has(n.id))) { sel = new Set([n.id]); render(); }
    },
    exportPng: () => exportImage('png'),
    undo: () => doUndo(), redo: () => doRedo(), canUndo: () => undo.length > 0, canRedo: () => redo.length > 0,
    focus() { canvas.focus(); },
  };
}

function markerDefs() {
  const mk = (id, path, open, w = 12, h = 12, rx = 10, ry = 6) => ['e', 's'].map((d) => `<marker id="m-${id}-${d}" viewBox="0 0 ${w} ${h}" refX="${rx}" refY="${ry}" markerWidth="${w}" markerHeight="${h}" markerUnits="userSpaceOnUse" orient="${d === 'e' ? 'auto' : 'auto-start-reverse'}"><path class="${open ? 'bd-mk-o' : 'bd-mk'}" d="${path}"/></marker>`).join('');
  return mk('arrow', 'M1,1 L11,6 L1,11 Z', false)
    + mk('open', 'M1,1 L11,6 L1,11', true).replace(/class="bd-mk-o"/g, 'class="bd-mk-line"')
    + mk('triangle', 'M1,1 L13,7 L1,13 Z', true, 14, 14, 13, 7)
    + mk('diamond', 'M1,6 L8,1 L15,6 L8,11 Z', false, 16, 12, 15, 6)
    + mk('diamondOpen', 'M1,6 L8,1 L15,6 L8,11 Z', true, 16, 12, 15, 6)
    + mk('circle', 'M6,2 A4,4 0 1 1 5.99,2 Z', false, 12, 12, 10, 6);
}
