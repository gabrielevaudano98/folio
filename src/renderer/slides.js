// Folio — slides surface: thumbnails, stage, per-slide Markdown, presenter, PDF and PowerPoint export.
import { syncBody, slideChunk, syncedCopy, parseDeck, renderSlide, joinDeck, setDirective, setNotes, setGlobal, splitSlides, parseFrontmatter, LAYOUTS, THEMES, TEMPLATES } from './slides-core.js';
import { createEditor } from './editor.js';
import slidesCss from './slides.css';
import { hydrateCharts } from './markdown.js';
import { mountCanvas } from './slides-canvas.js';
import { LIBRARY, shapeSvg, defaultSize } from './board-core.js';
import { startTextEdit } from './slides-text.js';
import { pathBlock, polygonsBlock, simplify, parsePoints, pointsText, replaceImageSrc, parseFill, MASKS, SHADOWS, scanObjects, addObject, nextId, setMany, setObjectAttrs, setObjectBody, inlineSafe, textStyle, removeObject, objectSource, retarget, alignPatches, distributePatches, zPatches, nextGroup, geometry, locked, groupOf } from './slides-objects.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function mountSlides(host, ctx) {
  const { icons } = ctx;
  host.innerHTML = `
    <div class="sf-toolbar" role="toolbar" aria-label="Slides">
      <button class="btn" type="button" data-sl="add">${icons.plus} New slide</button>
      <button class="btn" type="button" data-sl="box" title="Add a text box you can place anywhere">${icons.plus} Text box</button>
      <button class="btn" type="button" data-sl="insert" aria-haspopup="menu" title="Insert shapes, lines, images, tables, charts, icons, media">${icons.plus} Insert</button>
      <button class="btn" type="button" data-sl="arrange" aria-haspopup="menu" title="Align, distribute, order, group, lock">Arrange</button>
      <label class="sf-check"><input type="checkbox" data-sl-format> Format</label>
      <label class="sf-check"><input type="checkbox" data-sl-layers> Layers</label>
      <label class="sf-check"><input type="checkbox" data-sl-grid> Grid</label>
      <div class="sf-sep"></div>
      <label class="sf-field"><span>Layout</span><select class="rb-select" data-sl-layout>${LAYOUTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label class="sf-field"><span>Theme</span><select class="rb-select sf-narrow" data-sl-theme>${THEMES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label class="sf-field"><span>Size</span><select class="rb-select sf-narrow" data-sl-size><option value="16:9">16:9</option><option value="4:3">4:3</option></select></label>
      <label class="sf-check"><input type="checkbox" data-sl-paginate> Slide numbers</label>
      <div class="sf-spacer"></div>
      <button class="btn" type="button" data-sl="export" aria-haspopup="menu">${icons.export} Export</button>
      <button class="btn btn-primary" type="button" data-sl="present">${icons.play} Present</button>
    </div>
    <div class="sf-toolbar sl-fmtbar" role="toolbar" aria-label="Format selected object">
      <select class="rb-select sf-narrow" data-tx="style" aria-label="Paragraph style"><option value="p">Text</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option></select>
      <button class="rb" type="button" data-tx="bold" aria-label="Bold" title="Bold">${icons.bold}</button><button class="rb" type="button" data-tx="italic" aria-label="Italic" title="Italic">${icons.italic}</button>
      <button class="rb" type="button" data-tx="underline" aria-label="Underline" title="Underline">${icons.underline}</button><button class="rb" type="button" data-tx="strike" aria-label="Strikethrough" title="Strikethrough">${icons.strike}</button>
      <button class="rb" type="button" data-tx="highlight" aria-label="Highlight" title="Highlight">${icons.highlighter}</button><button class="rb" type="button" data-tx="link" aria-label="Link" title="Link">${icons.link}</button>
      <button class="rb" type="button" data-tx="bullet" aria-label="Bulleted list" title="Bulleted list">${icons.listBullet}</button><button class="rb" type="button" data-tx="ordered" aria-label="Numbered list" title="Numbered list">${icons.listOrdered}</button>
      <div class="sf-sep"></div>
      <label class="sf-field"><span>Font</span><select class="rb-select sf-narrow" data-at="font"><option value="">Theme</option><option value="sans">Sans</option><option value="serif">Serif</option><option value="mono">Mono</option><option value="rounded">Rounded</option></select></label>
      <label class="sf-field"><span>Size</span><input class="input sf-num" type="number" min="8" max="400" step="1" data-at="size" placeholder="auto"></label>
      <label class="sf-field"><span>Text</span><input class="sf-color" type="color" data-at="color" value="#1a1a1a" aria-label="Text colour"></label>
      <label class="sf-field"><span>Fill</span><input class="sf-color" type="color" data-at="fill" value="#f2f2f2" aria-label="Fill colour"></label>
      <div class="sf-sep"></div>
      <button class="rb" type="button" data-al="left" aria-label="Align left" title="Align left">${icons.alignLeft}</button><button class="rb" type="button" data-al="center" aria-label="Align centre" title="Align centre">${icons.alignCenter}</button><button class="rb" type="button" data-al="right" aria-label="Align right" title="Align right">${icons.alignRight}</button>
      <label class="sf-field"><span>Vertical</span><select class="rb-select sf-narrow" data-at="valign"><option value="">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select></label>
      <label class="sf-field"><span>Spacing</span><select class="rb-select sf-narrow" data-at="line"><option value="">Theme</option><option value="1">1.0</option><option value="1.15">1.15</option><option value="1.4">1.4</option><option value="1.8">1.8</option></select></label>
      <label class="sf-check"><input type="checkbox" data-at-fit> Shrink to fit</label>
    </div>
    <div class="sl-main">
      <ol class="sl-thumbs" aria-label="Slides"></ol>
      <div class="sl-center">
        <div class="sl-dock"><div class="sl-layers" hidden aria-label="Objects on this slide"></div><div class="sl-format" hidden role="region" aria-label="Format"></div></div>
        <div class="sl-sync" role="status" hidden></div>
        <div class="sl-gallery" role="dialog" aria-label="Insert" hidden></div>
        <div class="sl-stage" tabindex="0" aria-label="Slide canvas. Arrow keys move the selected object, Delete removes it."><div class="sl-frame"></div></div>
        <div class="sl-edit">
          <div class="sl-edit-col"><div class="sl-edit-head"><span>Slide ${'<b class="sl-cur">1</b>'} content</span><span class="sl-hint">Markdown. <code>::: left</code> / <code>::: right</code>, <code>::: card</code>, <code>![bg right](img)</code></span></div><div class="sl-cm"></div></div>
          <div class="sl-edit-col sl-notes-col"><label class="sl-edit-head" for="sl-notes-${host.id}">Speaker notes</label><textarea class="sl-notes input" id="sl-notes-${host.id}" placeholder="Only you see these while presenting"></textarea></div>
        </div>
      </div>
    </div>`;

  let text = '', deck = null, cur = 0, silent = false, canvas = null, selected = [];
  const undo = []; const redo = []; let lastPush = 0, restoring = false;
  const thumbs = host.querySelector('.sl-thumbs');
  const frame = host.querySelector('.sl-frame');
  const stage = host.querySelector('.sl-stage');
  const notesEl = host.querySelector('.sl-notes');
  const chunkEditor = createEditor(host.querySelector('.sl-cm'), { onChange: (t) => { if (!silent) editChunk(() => t); } });

  function chunks() { const fm = parseFrontmatter(text); return { fm: fm.raw, list: splitSlides(fm.body) }; }
  function commit(next, { keepEditor = false, keepFrame = false } = {}) {
    if (!restoring && text && next !== text) {
      const now = Date.now();
      if (now - lastPush > 700) { undo.push(text); if (undo.length > 200) undo.shift(); }
      lastPush = now; redo.length = 0;
    }
    text = next; deck = parseDeck(text);
    cur = Math.min(cur, deck.slides.length - 1);
    render({ keepEditor, keepFrame });
    ctx.onChange(text);
  }
  function editChunk(fn) {
    const { fm, list } = chunks();
    list[cur] = fn(list[cur]);
    commit(joinDeck(fm, list), { keepEditor: true });
  }

  function hydrate(root) {
    if (root.querySelector('.chart-block[data-spec]')) hydrateCharts(root, ctx.readNote);
    if (root.querySelector('.sl-icon-svg')) import('./slides-icons.js').then(({ hydrateIcons }) => hydrateIcons(root));
    for (const m of root.querySelectorAll('.sl-media-el[data-src]')) { const src = m.dataset.src; const set = (u) => { if (u) m.src = u; }; if (/^(https?:|data:|file:)/.test(src)) set(src); else Promise.resolve(ctx.resolveImage(src)).then(set); if (m.dataset.poster) Promise.resolve(ctx.resolveImage(m.dataset.poster)).then((u) => u && (m.poster = u)); }
    if (root.querySelector('[data-ref]') && ctx.refEnv) import('./refs.js').then(({ hydrateRefs }) => hydrateRefs(root, ctx.refEnv()));
    for (const img of root.querySelectorAll('img[data-src]')) {
      const src = img.dataset.src;
      if (/^(https?:|data:|file:)/.test(src)) img.src = src;
      else Promise.resolve(ctx.resolveImage(src)).then((u) => { if (u) img.src = u; });
    }
    for (const img of root.querySelectorAll('.sl-body img')) {
      const src = img.getAttribute('src') || '';
      if (src && !/^(https?:|data:|file:)/.test(src)) Promise.resolve(ctx.resolveImage(src)).then((u) => { if (u) img.src = u; });
    }
  }
  function shrinkFit(root) {
    for (const el of root.querySelectorAll('.sl-obj.is-fit')) {
      const t = el.querySelector('.sl-obj-text') || el; let size = parseFloat(getComputedStyle(t).fontSize) || 30;
      for (let n = 0; n < 60 && size > 10 && (t.scrollHeight > el.clientHeight + 1 || t.scrollWidth > el.clientWidth + 1); n++) { size -= 1; t.style.fontSize = `${size}px`; }
    }
  }
  function fit() {
    if (!deck) return;
    const r = stage.getBoundingClientRect();
    const k = Math.max(0.05, Math.min((r.width - 48) / deck.width, (r.height - 48) / deck.height));
    frame.style.width = `${deck.width * k}px`; frame.style.height = `${deck.height * k}px`;
    frame.style.setProperty('--k', k);
    canvas?.update();
  }
  new ResizeObserver(fit).observe(stage);

  function render({ keepEditor = false, keepFrame = false } = {}) {
    if (!deck) return;
    const tk = 176 / deck.width;
    thumbs.innerHTML = deck.slides.map((s, i) => `
      <li class="sl-thumb" data-i="${i}" draggable="true" aria-current="${i === cur}" tabindex="0" aria-label="Slide ${i + 1}${s.title ? ': ' + esc(s.title) : ''}">
        <span class="sl-thumb-n">${i + 1}</span>
        <div class="sl-thumb-box" style="width:176px;height:${deck.height * tk}px"><div class="sl-scale" style="transform:scale(${tk})">${renderSlide(deck, s)}</div></div>
      </li>`).join('');
    hydrate(thumbs);
    const s = deck.slides[cur];
    if (!keepFrame) {
    frame.innerHTML = `<div class="sl-scale">${renderSlide(deck, s)}</div>`;
    hydrate(frame); fit(); shrinkFit(frame);
    canvas?.destroy();
    canvas = mountCanvas({
      frame, stage, width: deck.width, height: deck.height, selected,
      getChunk: () => chunks().list[cur],
      edit(fn) { const { fm, list } = chunks(); list[cur] = fn(list[cur]); commit(joinDeck(fm, list)); },
      onSelect(sel) { selected = sel; canvas?.select(sel, { notify: false }); renderLayers(); syncFmt(); renderFormat(); drawVertices(); },
    });
    }
    host.querySelector('[data-sl-layout]').value = s.layout;
    host.querySelector('[data-sl-theme]').value = deck.theme;
    host.querySelector('[data-sl-size]').value = deck.global.size === '4:3' ? '4:3' : '16:9';
    host.querySelector('[data-sl-paginate]').checked = deck.global.paginate === 'true';
    host.querySelector('.sl-cur').textContent = cur + 1;
    renderLayers(); syncFmt(); checkSync(); renderFormat(); drawVertices();
    if (document.activeElement !== notesEl) notesEl.value = s.notes;
    if (!keepEditor) { silent = true; chunkEditor.setDoc(chunks().list[cur].replace(/^\n+/, '')); silent = false; }
    ctx.onStatus?.(`${deck.slides.length} ${deck.slides.length === 1 ? 'slide' : 'slides'}`);
  }

  function select(i, { reveal = true } = {}) {
    if (i !== cur) selected = [];
    cur = Math.max(0, Math.min(i, deck.slides.length - 1));
    render();
    thumbs.querySelector(`[data-i="${cur}"]`)?.scrollIntoView({ block: 'nearest' });
    if (reveal) ctx.revealLine?.(lineOf(cur));
  }
  function lineOf(i) {
    const fm = parseFrontmatter(text); let line = fm.raw ? fm.raw.split('\n').length : 1;
    const list = splitSlides(fm.body);
    for (let j = 0; j < i; j++) line += list[j].split('\n').length;
    return line;
  }

  function addSlide(layout = 'default', at = cur + 1) {
    const { fm, list } = chunks();
    list.splice(at, 0, '\n' + TEMPLATES[layout] + '\n');
    cur = at; commit(joinDeck(fm, list));
  }
  function moveSlide(from, to) {
    const { fm, list } = chunks();
    if (to < 0 || to >= list.length || from === to) return;
    const [c] = list.splice(from, 1); list.splice(to, 0, c);
    cur = to; commit(joinDeck(fm, list));
  }
  function deleteSlide(i) {
    const { fm, list } = chunks();
    if (list.length === 1) return ctx.toast('A deck needs at least one slide.');
    list.splice(i, 1); cur = Math.max(0, i - 1); commit(joinDeck(fm, list));
  }
  function duplicateSlide(i) {
    const { fm, list } = chunks(); list.splice(i + 1, 0, list[i]); cur = i + 1; commit(joinDeck(fm, list));
  }

  function addObjectBlock(kind) {
    const { fm, list } = chunks();
    const id = nextId(list[cur], kind);
    const n = scanObjects(list[cur]).length;
    const x = Math.round(deck.width / 2 - 180 + n * 24), y = Math.round(deck.height / 2 - 80 + n * 24);
    const block = kind === 'box'
      ? `::: box #${id} x=${x} y=${y} w=360 h=160 fill=#f2f2f2 radius=12\nText\n:::`
      : `::: shape #${id} type=rounded x=${x} y=${y} w=240 h=120 fill=#e8e8e8\n\nLabel\n:::`;
    list[cur] = addObject(list[cur], block);
    selected = [scanObjects(list[cur]).length - 1];
    commit(joinDeck(fm, list));
  }
  /* arrange (P2) */
  const objsNow = () => scanObjects(chunks().list[cur]);
  function patchSel(patches) { if (patches.length) editChunk2((c) => setMany(c, patches)); }
  function editChunk2(fn) { const { fm, list } = chunks(); list[cur] = fn(list[cur]); commit(joinDeck(fm, list)); }
  function arrangeMenu(anchor) {
    const objs = objsNow(); const n = selected.length; const one = n >= 1, many = n >= 2, three = n >= 3;
    const slide = { width: deck.width, height: deck.height };
    const item = (label, ok, run) => ({ label, run, disabled: !ok });
    const grouped = selected.some((i) => groupOf(objs[i]));
    ctx.showMenu(anchor, [
      item(many ? 'Align left' : 'Align to slide: left', one, () => patchSel(alignPatches(objs, selected, 'left', slide))),
      item(many ? 'Align center' : 'Align to slide: center', one, () => patchSel(alignPatches(objs, selected, 'center', slide))),
      item(many ? 'Align right' : 'Align to slide: right', one, () => patchSel(alignPatches(objs, selected, 'right', slide))),
      item(many ? 'Align top' : 'Align to slide: top', one, () => patchSel(alignPatches(objs, selected, 'top', slide))),
      item(many ? 'Align middle' : 'Align to slide: middle', one, () => patchSel(alignPatches(objs, selected, 'middle', slide))),
      item(many ? 'Align bottom' : 'Align to slide: bottom', one, () => patchSel(alignPatches(objs, selected, 'bottom', slide))), '-',
      item('Distribute horizontally', three, () => patchSel(distributePatches(objs, selected, 'h'))),
      item('Distribute vertically', three, () => patchSel(distributePatches(objs, selected, 'v'))), '-',
      item('Bring to front', one, () => patchSel(zPatches(objs, selected, 'front'))),
      item('Bring forward', one, () => patchSel(zPatches(objs, selected, 'forward'))),
      item('Send backward', one, () => patchSel(zPatches(objs, selected, 'backward'))),
      item('Send to back', one, () => patchSel(zPatches(objs, selected, 'back'))), '-',
      item('Group', many, () => { const g = nextGroup(objs); patchSel(selected.map((i) => [i, { group: g }])); }),
      item('Ungroup', grouped, () => patchSel(selected.map((i) => [i, { group: null }]))),
      item('Lock', one, () => patchSel(selected.map((i) => [i, { lock: 'true' }]))), '-',
      ...(() => { const ok = many && selected.every((i) => ['shape', 'box', 'path', 'image'].includes(objs[i]?.kind)); return [
        item('Merge shapes: union', ok, () => mergeSel('union')), item('Merge shapes: intersect', ok, () => mergeSel('intersection')),
        item('Merge shapes: subtract', ok, () => mergeSel('difference')), item('Merge shapes: combine', ok, () => mergeSel('xor')), '-']; })(),
      item('Copy', one, () => copySel()), item('Cut', one, () => { copySel(); deleteSel(); }), { label: 'Paste', run: () => pasteSel(), disabled: !clip.length },
      item('Duplicate', one, () => { copySel(); pasteSel(); }),
      item('Delete', one, () => deleteSel()),
    ]);
  }
  let clip = [];
  function copySel() {
    const text0 = chunks().list[cur];
    clip = selected.map((i) => objectSource(text0, i)).filter(Boolean);
    navigator.clipboard?.writeText(clip.join('\n\n')).catch(() => {});
  }
  function deleteSel() { const gone = [...selected].sort((a, b) => b - a); selected = []; editChunk2((c) => gone.reduce((t, i) => removeObject(t, i), c)); }
  function pasteSel() {
    if (!clip.length) return ctx.toast('Nothing to paste. Copy an object first.');
    let n0 = 0;
    editChunk2((c) => { n0 = scanObjects(c).length; return clip.reduce((t, src) => addObject(t, retarget(src, t)), c); });
    selected = clip.map((_, j) => n0 + j); canvas?.select(selected, { notify: false });
  }
  function renderLayers() {
    const pane = host.querySelector('.sl-layers'); if (pane.hidden) return;
    const objs = objsNow();
    const rows = objs.map((o, i) => ({ o, i, z: geometry(o).z })).sort((a, b) => b.z - a.z || b.i - a.i);
    pane.innerHTML = `<div class="sl-layers-head">Objects</div>` + (rows.length ? rows.map(({ o, i }) => `
      <div class="sl-layer" role="button" tabindex="0" data-i="${i}" aria-pressed="${selected.includes(i)}">
        <span class="sl-layer-name">${esc(o.id || o.kind + ' ' + (i + 1))}</span>
        ${groupOf(o) ? `<span class="sl-layer-tag">${esc(groupOf(o))}</span>` : ''}
        <button class="sl-layer-lock" type="button" data-lock="${i}" aria-label="${locked(o) ? 'Unlock' : 'Lock'} ${esc(o.id || o.kind)}" aria-pressed="${locked(o)}">${locked(o) ? 'Locked' : 'Lock'}</button>
      </div>`).join('') : '<p class="sl-layers-empty">No placed objects yet. Add a text box or shape.</p>');
  }
  host.querySelector('.sl-layers').addEventListener('click', (e) => {
    const lk = e.target.closest('[data-lock]');
    if (lk) { const i = Number(lk.dataset.lock); const o = objsNow()[i]; patchSel([[i, { lock: locked(o) ? null : 'true' }]]); return; }
    const row = e.target.closest('[data-i]'); if (!row) return;
    const i = Number(row.dataset.i); const o = objsNow()[i];
    selected = e.shiftKey ? [...new Set([...selected, i])] : [i];
    if (locked(o)) return renderLayers();
    canvas?.select(selected, { notify: false }); renderLayers();
  });
  host.querySelector('[data-sl-layers]').addEventListener('change', (e) => { host.querySelector('.sl-layers').hidden = !e.target.checked; dockRoom(); renderLayers(); });
  host.querySelector('[data-sl-grid]').addEventListener('change', (e) => { frame.classList.toggle('sl-grid', e.target.checked); canvas?.setGrid(e.target.checked ? 40 : 0); });
  host.querySelector('[data-sl="arrange"]').addEventListener('click', (e) => arrangeMenu(e.currentTarget));
  /* text on the canvas (P3) */
  let textEdit = null, editing = -1;
  const fmt = host.querySelector('.sl-fmtbar');
  const isText = (o) => o && (o.kind === 'box' || o.kind === 'shape');
  function syncFmt() {
    const objs = objsNow(); const picked = selected.filter((i) => isText(objs[i]));
    fmt.classList.toggle('is-idle', !picked.length);
    for (const c of fmt.querySelectorAll('input, select, button')) c.disabled = !picked.length;
    if (!picked.length) return;
    const a = objs[picked[0]].attrs;
    for (const el of fmt.querySelectorAll('[data-at]')) { const k = el.dataset.at; el.value = a[k] ?? (el.type === 'color' ? (k === 'fill' ? '#f2f2f2' : '#1a1a1a') : ''); }
    fmt.querySelector('[data-at-fit]').checked = a.fit === 'shrink';
    for (const b of fmt.querySelectorAll('[data-al]')) b.setAttribute('aria-pressed', String(a.align === b.dataset.al));
    const live = !!textEdit;
    for (const b of fmt.querySelectorAll('[data-tx]')) {
      const k = b.dataset.tx; b.disabled = !live;
      if (k === 'style') { b.value = !live ? 'p' : textEdit.active('heading', { level: 1 }) ? 'h1' : textEdit.active('heading', { level: 2 }) ? 'h2' : textEdit.active('heading', { level: 3 }) ? 'h3' : 'p'; continue; }
      const name = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strike', highlight: 'highlight', link: 'link', bullet: 'bulletList', ordered: 'orderedList' }[k];
      b.setAttribute('aria-pressed', String(live && textEdit.active(name)));
      b.title = live ? b.getAttribute('aria-label') : 'Double-click a box to edit its text';
    }
  }
  fmt.addEventListener('sl-text-state', syncFmt);
  fmt.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  fmt.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tx]'); if (t && t.tagName === 'BUTTON' && textEdit) { textEdit.run(t.dataset.tx); return; }
    const al = e.target.closest('[data-al]'); if (al) setAttrs({ align: al.dataset.al });
  });
  fmt.querySelector('[data-tx="style"]').addEventListener('change', (e) => textEdit?.run(e.target.value));
  fmt.addEventListener('change', (e) => {
    const el = e.target.closest('[data-at]'); if (el) { setAttrs({ [el.dataset.at]: el.value === '' ? null : el.value }); return; }
    if (e.target.matches('[data-at-fit]')) setAttrs({ fit: e.target.checked ? 'shrink' : null });
  });
  /** write box-level attributes for the selection; while typing, keep the editor open and restyle live */
  function setAttrs(patch) {
    const objs = objsNow(); const picked = selected.filter((i) => isText(objs[i]));
    if (!picked.length) return;
    const clean = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === '' ? null : v]));
    if (!textEdit) { patchSel(picked.map((i) => [i, clean])); return; }
    editChunk2k((c) => setMany(c, picked.map((i) => [i, clean])));
    const o = objsNow()[editing]; const el = frame.querySelector(`.sl-obj[data-obj="${editing}"]`); if (!el || !o) return;
    const t = o.kind === 'shape' ? el.querySelector('.sl-obj-text') : el;
    for (const prop of ['fontFamily', 'fontSize', 'textAlign', 'lineHeight', 'justifyContent', 'fontWeight']) t.style[prop] = '';
    for (const d of textStyle(o.attrs)) { const [k, ...v] = d.split(':'); t.style.setProperty(k, v.join(':')); }
    if (o.attrs.color) el.style.color = o.attrs.color; else el.style.color = '';
    if (o.kind === 'box') el.style.background = o.attrs.fill || '';
    el.classList.toggle('is-fit', o.attrs.fit === 'shrink');
  }
  function editChunk2k(fn) {
    const { fm: f, list } = chunks(); const before = scanObjects(list[cur]);
    const next = fn(list[cur]); const after = scanObjects(next);
    // safety net: an edit may never add, drop or merge objects or other slides
    if (after.length !== before.length || splitSlides(next.replace(/^\n+/, '')).length !== 1 + (list[cur].match(/^---\s*$/gm) || []).length) { ctx.toast('That edit could not be saved safely, so nothing was changed.', { kind: 'error' }); return; }
    list[cur] = next; commit(joinDeck(f, list), { keepFrame: true });
  }

  function startEdit(i) {
    const o = objsNow()[i]; if (!isText(o) || locked(o) || textEdit) return;
    const el = frame.querySelector(`.sl-obj[data-obj="${i}"]`); if (!el) return;
    if (!inlineSafe(o.body)) { ctx.toast('This box has blocks the text editor cannot keep (containers, code, images, tables or HTML). Edit it in the code panel below.'); return; }
    const target = o.kind === 'shape' ? el.querySelector('.sl-obj-text') : el;
    selected = [i]; canvas?.select([], { notify: false }); editing = i; renderLayers();
    textEdit = startTextEdit({
      el: target, body: o.body.replace(/^\n+/, ''),
      onChange: (md) => editChunk2k((c) => setObjectBody(c, i, o.kind === 'shape' ? '\n' + md : md)),
      onLink: (prev) => ctx.prompt({ title: prev ? 'Edit link' : 'Add link', label: 'Address', value: prev || 'https://', hint: 'Leave empty to remove the link', action: 'Apply', allowEmpty: true, validate: false }),
      onEnd: () => { textEdit = null; const was = editing; editing = -1; selected = [was]; render({ keepEditor: false }); syncFmt(); stage.focus(); },
    });
    syncFmt();
  }
  frame.addEventListener('dblclick', (e) => { const el = e.target.closest('.sl-obj'); if (el) startEdit(Number(el.dataset.obj)); });

  /* synced copies of slides from this or another deck */
  const syncBar = host.querySelector('.sl-sync'); let syncSeq = 0;
  async function sourceOf(ref) {
    const { parseRef, resolveTarget } = await import('./refs-syntax.js');
    const env = ctx.refEnv(); const { target, part } = parseRef(ref);
    const path = target ? resolveTarget(target, env.files, env.from) : env.from;
    if (!path) throw new Error(`${target} not found`);
    const chunk = slideChunk(await env.read(path), parseInt(part, 10) || 1);
    if (chunk == null) throw new Error(`no slide ${part} in ${target}`);
    return chunk;
  }
  async function checkSync() {
    const n = ++syncSeq; const s0 = deck?.slides[cur]; const ref = s0?.eff.source;
    if (!ref) { syncBar.hidden = true; return; }
    let msg, changed = false;
    try { const src = await sourceOf(ref); changed = syncBody(src) !== syncBody(chunks().list[cur]); msg = changed ? `This slide is a synced copy of <b>${esc(ref)}</b>. It differs from the source.` : `Synced copy of <b>${esc(ref)}</b>. Up to date.`; }
    catch (e) { msg = `Synced copy of <b>${esc(ref)}</b>, but the source cannot be found (${esc(e.message)}).`; }
    if (n !== syncSeq) return;
    syncBar.hidden = false; syncBar.classList.toggle('is-changed', changed);
    syncBar.innerHTML = `<span>${msg}</span>${changed ? '<button class="btn" type="button" data-sync="update">Update from source</button>' : ''}<button class="btn" type="button" data-sync="open">Open source</button><button class="btn" type="button" data-sync="unlink">Unlink</button>`;
  }
  syncBar.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sync]'); if (!b) return; const ref = deck.slides[cur].eff.source;
    if (b.dataset.sync === 'unlink') editChunk2((c) => setDirective(c, 'source', null));
    if (b.dataset.sync === 'update') { const src = await sourceOf(ref); editChunk2(() => syncedCopy(ref, src)); ctx.toast('Slide updated from its source.'); }
    if (b.dataset.sync === 'open') { const { parseRef, resolveTarget } = await import('./refs-syntax.js'); const env = ctx.refEnv(); const { target, part } = parseRef(ref); ctx.openRef(target ? resolveTarget(target, env.files, env.from) : env.from, part); }
  });
  async function reuseSlide() {
    const t = await ctx.pickRef?.({ kind: 'link' }); if (!t) return;
    const ref = t.replace(/^!?\[\[|\]\]$/g, '').replace(/\|.*$/, '');
    if (!/#\d+$/.test(ref)) return ctx.toast('Choose a slide of a deck as the part.');
    try { const src = await sourceOf(ref); const { fm, list } = chunks(); list.splice(cur + 1, 0, syncedCopy(ref, src)); cur += 1; commit(joinDeck(fm, list)); ctx.toast('Added a synced copy. It will offer to update when the source changes.'); }
    catch (e) { ctx.toast(e.message, { kind: 'error' }); }
  }
  /* format pane (P6) */
  const fpane = host.querySelector('.sl-format');
  host.querySelector('[data-sl-format]').addEventListener('change', (e) => { fpane.hidden = !e.target.checked; dockRoom(); renderFormat(); });
  function dockRoom() { const open = !fpane.hidden || !host.querySelector('.sl-layers').hidden; host.classList.toggle('sl-docked', open); requestAnimationFrame(fit); }
  const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : /^#[0-9a-f]{3}$/i.test(c || '') ? '#' + c.slice(1).split('').map((x) => x + x).join('') : d);
  const fRow = (label, html) => `<label class="fp-row"><span>${label}</span>${html}</label>`;
  const num = (k, v, step = 1, min = '', max = '') => `<input class="input fp-num" type="number" data-fk="${k}" value="${v ?? ''}" step="${step}"${min !== '' ? ` min="${min}"` : ''}${max !== '' ? ` max="${max}"` : ''}>`;
  const col = (k, v, d) => `<input class="sf-color" type="color" data-fk="${k}" value="${hex(v, d)}">`;
  const sel = (k, v, opts) => `<select class="rb-select fp-sel" data-fk="${k}">${opts.map(([val, l]) => `<option value="${val}"${String(v ?? '') === val ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const range = (k, v, min, max, step) => `<input class="fp-range" type="range" data-fk="${k}" min="${min}" max="${max}" step="${step}" value="${v}">`;
  const adjOf = (a) => Object.fromEntries(String(a.adjust || '').split(',').map((x) => x.split(':')).filter((x) => x.length === 2).map(([k, v]) => [k.trim(), parseFloat(v)]));
  function renderFormat() {
    if (fpane.hidden) return;
    const objs = objsNow(); const picked = selected.map((i) => objs[i]).filter(Boolean);
    if (!picked.length) { fpane.innerHTML = '<div class="fp-head">Format</div><p class="fp-empty">Select an object on the slide to format it.</p>'; return; }
    const o = picked[0], a = o.attrs, g = geometry(o), kinds = new Set(picked.map((x) => x.kind));
    const only = (k) => kinds.size === 1 && kinds.has(k);
    const fill = parseFill(a.fill) || { kind: 'none' };
    const ft = fill.kind === 'solid' ? (fill.color === 'none' ? 'none' : 'solid') : fill.kind;
    const adj = adjOf(a); const crop = (a.crop || '0,0,1,1').split(',').map(Number);
    let h = `<div class="fp-head">Format <span class="fp-sub">${picked.length > 1 ? `${picked.length} objects` : esc(o.id || o.kind)}</span></div>`;
    if (picked.length === 1 && o.kind !== 'line') h += `<section class="fp-sec"><h3>Position and size</h3><div class="fp-grid">${fRow('X', num('x', g.x))}${fRow('Y', num('y', g.y))}${fRow('Width', num('w', g.w, 1, 1))}${fRow('Height', num('h', g.h, 1, 1))}${fRow('Rotate', num('rotate', g.rotate || 0, 1, -360, 360))}</div></section>`;
    if ([...kinds].some((k) => k === 'box' || k === 'shape' || k === 'path')) {
      h += `<section class="fp-sec"><h3>Fill</h3>${fRow('Type', sel('fill-type', ft, [['none', 'None'], ['solid', 'Solid'], ['linear', 'Linear gradient'], ['radial', 'Radial gradient']]))}`;
      if (ft === 'solid') h += fRow('Colour', col('fill-1', fill.color, '#f2f2f2'));
      if (ft === 'linear' || ft === 'radial') h += `<div class="fp-grid">${fRow('From', col('fill-1', fill.stops[0], '#111111'))}${fRow('To', col('fill-2', fill.stops.at(-1), '#888888'))}${ft === 'linear' ? fRow('Angle', num('fill-angle', fill.angle, 15, -360, 360)) : ''}</div>`;
      h += '</section>';
    }
    if ([...kinds].some((k) => ['box', 'shape', 'image', 'line', 'path'].includes(k))) {
      h += `<section class="fp-sec"><h3>${only('line') ? 'Line' : 'Border'}</h3><div class="fp-grid">${fRow('Colour', col('stroke', a.stroke, '#1a1a1a'))}${fRow('Width', num(only('line') ? 'width' : 'border', a[only('line') ? 'width' : 'border'] ?? '', 0.5, 0, 40))}</div>${fRow('Dashed', `<input type="checkbox" data-fk="dash"${a.dash === 'true' ? ' checked' : ''}>`)}`;
      if (only('line')) h += `<div class="fp-grid">${fRow('Start', sel('tail', a.tail || '', [['', 'None'], ['arrow', 'Arrow']]))}${fRow('End', sel('head', a.head || '', [['', 'None'], ['arrow', 'Arrow']]))}</div>${fRow('Route', sel('route', a.route || '', [['', 'Straight'], ['elbow', 'Elbow']]))}`;
      if (kinds.has('box') || kinds.has('image')) h += fRow('Corners', num('radius', a.radius ?? '', 1, 0, 400));
      h += '</section>';
    }
    h += `<section class="fp-sec"><h3>Effects</h3>${fRow('Shadow', sel('shadow', a.shadow || '', [['', 'None'], ...Object.keys(SHADOWS).map((k) => [k, k[0].toUpperCase() + k.slice(1)])]))}${fRow('Opacity', range('opacity', g.opacity ?? 1, 0, 1, 0.05))}`;
    if ([...kinds].some((k) => ['image', 'icon', 'shape', 'path'].includes(k))) h += `<div class="fp-btns"><button class="btn" type="button" data-fa="flip-h">Flip horizontal</button><button class="btn" type="button" data-fa="flip-v">Flip vertical</button></div>`;
    h += '</section>';
    if (only('image')) {
      h += `<section class="fp-sec"><h3>Picture</h3>${fRow('Crop to shape', sel('mask', a.mask || '', [['', 'None'], ...Object.keys(MASKS).map((k) => [k, k[0].toUpperCase() + k.slice(1)])]))}
        <div class="fp-grid">${fRow('Crop left %', num('crop-l', Math.round(crop[0] * 100), 1, 0, 95))}${fRow('Crop top %', num('crop-t', Math.round(crop[1] * 100), 1, 0, 95))}${fRow('Crop right %', num('crop-r', Math.round((1 - crop[0] - crop[2]) * 100), 1, 0, 95))}${fRow('Crop bottom %', num('crop-b', Math.round((1 - crop[1] - crop[3]) * 100), 1, 0, 95))}</div>
        ${fRow('Brightness', range('adj-brightness', adj.brightness ?? 1, 0, 2, 0.05))}${fRow('Contrast', range('adj-contrast', adj.contrast ?? 1, 0, 2, 0.05))}${fRow('Saturation', range('adj-saturate', adj.saturate ?? 1, 0, 2, 0.05))}${fRow('Greyscale', range('adj-grayscale', adj.grayscale ?? 0, 0, 1, 0.05))}${fRow('Blur', range('adj-blur', adj.blur ?? 0, 0, 20, 0.5))}
        ${fRow('Fit', sel('fit', a.fit || '', [['', 'Fill the frame'], ['contain', 'Show all']]))}
        <label class="fp-row fp-wide"><span>Alt text</span><input class="input" type="text" data-fk="alt" value="${esc(a.alt ?? o.alt ?? '')}" placeholder="Describe the picture for screen readers"></label>
        <div class="fp-btns"><button class="btn" type="button" data-fa="replace">Replace…</button><button class="btn" type="button" data-fa="natural">Reset size</button><button class="btn" type="button" data-fa="reset-adjust">Reset adjustments</button></div></section>`;
    }
    if (only('path') && a.points) h += `<section class="fp-sec"><h3>Free shape</h3>${fRow('Closed', `<input type="checkbox" data-fk="closed"${a.closed === 'true' ? ' checked' : ''}>`)}${fRow('Smooth', `<input type="checkbox" data-fk="smooth"${a.smooth === 'true' ? ' checked' : ''}>`)}<p class="fp-note">Drag the square handles to move points. Double-click one to remove it.</p></section>`;
    if (only('icon')) h += `<section class="fp-sec"><h3>Icon</h3>${fRow('Colour', col('color', a.color, '#1a1a1a'))}${fRow('Line weight', range('weight', a.weight || 2, 0.5, 4, 0.25))}<div class="fp-btns"><button class="btn" type="button" data-fa="icon">Change icon…</button></div></section>`;
    if (only('media')) h += `<section class="fp-sec"><h3>Playback</h3>${fRow('Loop', `<input type="checkbox" data-fk="loop"${a.loop === 'true' ? ' checked' : ''}>`)}${fRow('Muted', `<input type="checkbox" data-fk="muted"${a.muted === 'true' ? ' checked' : ''}>`)}${fRow('Start when the slide shows', `<input type="checkbox" data-fk="autoplay"${a.autoplay === 'true' ? ' checked' : ''}>`)}</section>`;
    const focusKey = document.activeElement?.closest?.('.sl-format') ? document.activeElement.dataset.fk : null;
    fpane.innerHTML = h;
    if (focusKey) fpane.querySelector(`[data-fk="${focusKey}"]`)?.focus();
  }
  function fpWrite(k, el) {
    const objs = objsNow(); const v = el.type === 'checkbox' ? (el.checked ? 'true' : null) : el.value;
    const each = (fn) => patchSel(selected.filter((i) => objs[i]).map((i) => [i, fn(objs[i], objs[i].attrs)]).filter(([, p]) => p));
    if (['x', 'y', 'w', 'h', 'rotate'].includes(k)) return each(() => ({ [k]: v === '' ? null : Math.round(parseFloat(v) * 10) / 10 }));
    if (k.startsWith('fill-')) {
      const t = fpane.querySelector('[data-fk="fill-type"]').value;
      const c1 = fpane.querySelector('[data-fk="fill-1"]')?.value || '#111111', c2 = fpane.querySelector('[data-fk="fill-2"]')?.value || '#888888', ang = fpane.querySelector('[data-fk="fill-angle"]')?.value || 90;
      const fill = t === 'none' ? 'none' : t === 'solid' ? c1 : t === 'linear' ? `linear(${c1},${c2},${ang})` : `radial(${c1},${c2})`;
      return each((o) => (['box', 'shape', 'path'].includes(o.kind) ? { fill } : null));
    }
    if (k.startsWith('crop-')) {
      const p = (n) => Math.max(0, Math.min(95, parseFloat(fpane.querySelector(`[data-fk="crop-${n}"]`).value) || 0)) / 100;
      const l = p('l'), t = p('t'), r = p('r'), b = p('b');
      const crop = l + r >= 0.95 || t + b >= 0.95 ? null : (l || t || r || b) ? [l, t, 1 - l - r, 1 - t - b].map((x) => Math.round(x * 1000) / 1000).join(',') : null;
      return each((o) => (o.kind === 'image' ? { crop } : null));
    }
    if (k.startsWith('adj-')) {
      return each((o, a) => {
        const cur = adjOf(a); const name = k.slice(4); cur[name] = parseFloat(v);
        const neutral = { brightness: 1, contrast: 1, saturate: 1, grayscale: 0, blur: 0 };
        const s2 = Object.entries(cur).filter(([n, x]) => x !== neutral[n]).map(([n, x]) => `${n}:${x}`).join(',');
        return { adjust: s2 || null };
      });
    }
    if (k === 'opacity') return each(() => ({ opacity: parseFloat(v) >= 1 ? null : parseFloat(v) }));
    return each(() => ({ [k]: v === '' ? null : v }));
  }
  fpane.addEventListener('change', (e) => { const el = e.target.closest('[data-fk]'); if (el) fpWrite(el.dataset.fk, el); });
  fpane.addEventListener('input', (e) => {
    const el = e.target.closest('input[type=range][data-fk]'); if (!el) return;
    // live preview while dragging a slider, written on change
    const k = el.dataset.fk; const v = parseFloat(el.value);
    for (const i of selected) { const node = frame.querySelector(`.sl-obj[data-obj="${i}"]`); if (!node) continue;
      if (k === 'opacity') node.style.opacity = v;
      else if (k.startsWith('adj-')) { const img = node.querySelector('img') || node; const cur = adjOf(objsNow()[i].attrs); cur[k.slice(4)] = v; img.style.filter = Object.entries(cur).map(([n, x]) => (n === 'blur' ? `blur(${x}px)` : `${n}(${x})`)).join(' '); }
    }
  });
  fpane.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-fa]'); if (!b) return;
    const objs = objsNow(); const act = b.dataset.fa;
    if (act === 'flip-h' || act === 'flip-v') {
      const ax = act === 'flip-h' ? 'h' : 'v';
      return patchSel(selected.filter((i) => objs[i]).map((i) => { const f = objs[i].attrs.flip || ''; const has = f.includes(ax); const nf = (has ? f.replace(ax, '') : f + ax).split('').sort().join(''); return [i, { flip: nf || null }]; }));
    }
    const i = selected[0]; const o = objs[i];
    if (act === 'replace') { const src = await ctx.pickImage?.(); if (src) editChunk2((c) => replaceImageSrc(c, i, src)); }
    if (act === 'natural') {
      const url = await ctx.resolveImage(o.src);
      const dim = await new Promise((res) => { const im = new Image(); im.onload = () => res([im.naturalWidth, im.naturalHeight]); im.onerror = () => res(null); im.src = url; });
      if (dim) { const g = geometry(o); const k2 = Math.min(1, (deck.width * 0.8) / dim[0], (deck.height * 0.8) / dim[1]); patchSel([[i, { w: Math.round(dim[0] * k2), h: Math.round(dim[1] * k2), crop: null, x: g.x, y: g.y }]]); }
    }
    if (act === 'reset-adjust') patchSel([[i, { adjust: null, mask: null, crop: null }]]);
    if (act === 'icon') iconGallery((name) => patchSel([[i, { name }]]));
  });

  /* merge shapes, freeform drawing, edit points (P6) */
  async function mergeSel(op) {
    const { merge } = await import('./slides-merge.js');
    const objs = objsNow(); const picked = [...selected].sort((a, b) => a - b); const list0 = picked.map((i) => objs[i]);
    let res; try { res = merge(list0, op); } catch (e) { return ctx.toast(`Could not merge these shapes. ${e.message}`, { kind: 'error' }); }
    if (!res.length) return ctx.toast(op === 'intersection' ? 'These shapes do not overlap, so nothing is left.' : 'Nothing is left after that operation.');
    const a = list0[0].attrs;
    const keep = ['fill', 'stroke', 'border', 'shadow', 'opacity', 'dash'].filter((k) => a[k] != null).map((k) => ` ${k}=${/[\s"']/.test(a[k]) ? `"${a[k]}"` : a[k]}`).join('') || ' fill=#e8e8e8';
    const gone = new Set(list0.map((o) => o.id).filter(Boolean));
    editChunk2((c) => {
      const nid = nextId(c, 'path');
      let t = picked.slice().reverse().reduce((acc, i) => removeObject(acc, i), c);
      // connectors that pointed at a merged object now point at the merged shape
      const lines = scanObjects(t).map((ln, i) => [ln, i]).filter(([ln]) => ln.kind === 'line').reverse();
      for (const [ln, i] of lines) {
        const hit = (k) => ln.attrs[k] && gone.has(String(ln.attrs[k]).split('.')[0]);
        if (hit('from') && hit('to')) { t = removeObject(t, i); continue; }
        const p2 = {}; for (const k of ['from', 'to']) if (hit(k)) p2[k] = nid;
        if (Object.keys(p2).length) t = setObjectAttrs(t, i, p2);
      }
      t = addObject(t, polygonsBlock(nid, res, keep));
      selected = [scanObjects(t).length - 1]; return t;
    });
    ctx.toast('Merged into one shape. Undo with Ctrl+Z.');
  }
  let drawing = null;
  function startDraw() {
    if (drawing) return;
    ctx.toast('Draw on the slide with the mouse. Release to finish, Escape to cancel.');
    canvas?.select([], { notify: true });
    const veil = document.createElement('div'); veil.className = 'sl-draw'; frame.appendChild(veil);
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg'); const pl = document.createElementNS(svgNS, 'polyline'); svg.appendChild(pl); veil.appendChild(svg);
    const k = () => parseFloat(frame.style.getPropertyValue('--k')) || 1;
    let pts = [];
    const stop = () => { veil.remove(); drawing = null; removeEventListener('keydown', esc2, true); };
    const esc2 = (e) => { if (e.key === 'Escape') { e.preventDefault(); stop(); } };
    addEventListener('keydown', esc2, true);
    veil.addEventListener('pointerdown', (e) => {
      e.preventDefault(); try { veil.setPointerCapture(e.pointerId); } catch {} const r = frame.getBoundingClientRect();
      const at = (ev) => [(ev.clientX - r.left) / k(), (ev.clientY - r.top) / k()];
      pts = [at(e)];
      veil.onpointermove = (ev) => { pts.push(at(ev)); pl.setAttribute('points', pts.map((p) => p.map((v) => v * k()).join(',')).join(' ')); };
      veil.onpointerup = () => {
        stop();
        const simple = simplify(pts, 2.5);
        if (simple.length < 2 || Math.hypot(simple.at(-1)[0] - simple[0][0], simple.at(-1)[1] - simple[0][1]) + simple.length < 6) return;
        const closed = simple.length > 3 && Math.hypot(simple.at(-1)[0] - simple[0][0], simple.at(-1)[1] - simple[0][1]) < 24;
        const ptsOut = closed ? simple.slice(0, -1) : simple;
        editChunk2((c) => { const t = addObject(c, pathBlock(nextId(c, 'path'), ptsOut, closed ? ' closed=true smooth=true fill=#e8e8e8' : ' smooth=true')); selected = [scanObjects(t).length - 1]; return t; });
      };
    });
    drawing = veil;
  }
  /* vertex handles for a selected points path: drag to move a point, double-click to delete it */
  let vtx = [];
  function drawVertices() {
    vtx.forEach((h) => h.remove()); vtx = [];
    if (selected.length !== 1 || textEdit) return;
    const o = objsNow()[selected[0]]; if (!o || o.kind !== 'path' || !o.attrs.points || locked(o)) return;
    const g = geometry(o); const pts = parsePoints(o.attrs.points); const k = parseFloat(frame.style.getPropertyValue('--k')) || 1;
    if (g.rotate) return;
    pts.forEach(([px, py], j) => {
      const h = document.createElement('div'); h.className = 'sl-vtx'; h.title = 'Drag to move, double-click to remove';
      h.style.left = `${(g.x + px * g.w) * k}px`; h.style.top = `${(g.y + py * g.h) * k}px`;
      h.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation(); try { h.setPointerCapture(e.pointerId); } catch {} const r = frame.getBoundingClientRect(); let last = null;
        h.onpointermove = (ev) => { last = [(ev.clientX - r.left) / k, (ev.clientY - r.top) / k]; h.style.left = `${last[0] * k}px`; h.style.top = `${last[1] * k}px`; };
        h.onpointerup = () => {
          h.onpointermove = h.onpointerup = null; if (!last) return;
          const abs = pts.map(([qx, qy]) => [g.x + qx * g.w, g.y + qy * g.h]); abs[j] = last;
          rewritePath(selected[0], abs);
        };
      });
      h.addEventListener('dblclick', (e) => { e.stopPropagation(); if (pts.length <= 2) return; const abs = pts.map(([qx, qy]) => [g.x + qx * g.w, g.y + qy * g.h]); abs.splice(j, 1); rewritePath(selected[0], abs); });
      frame.appendChild(h); vtx.push(h);
    });
  }
  function rewritePath(i, abs) {
    const xs = abs.map((p) => p[0]), ys = abs.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(1, Math.max(...xs) - x), h = Math.max(1, Math.max(...ys) - y);
    patchSel([[i, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), points: pointsText(abs.map(([px, py]) => [(px - x) / w, (py - y) / h])) }]]);
  }

  /* insert (P5) */
  const gallery = host.querySelector('.sl-gallery');
  function placeBlock(make, w = 360, h = 160) {
    const { fm, list } = chunks();
    const n = scanObjects(list[cur]).length;
    const x = Math.round(deck.width / 2 - w / 2 + (n % 6) * 24), y = Math.round(deck.height / 2 - h / 2 + (n % 6) * 24);
    list[cur] = addObject(list[cur], make({ x, y, w, h, id: (kind) => nextId(list[cur], kind) }));
    selected = [scanObjects(list[cur]).length - 1];
    commit(joinDeck(fm, list));
  }
  const box = (body, w = 520, h = 260, extra = '') => placeBlock(({ x, y, id }) => `::: box #${id('box')} x=${x} y=${y} w=${w} h=${h}${extra}\n${body}\n:::`, w, h);
  function closeGallery() { gallery.hidden = true; gallery.innerHTML = ''; }
  gallery.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeGallery(); stage.focus(); } });
  document.addEventListener('pointerdown', (e) => { if (!gallery.hidden && !gallery.contains(e.target) && !e.target.closest('[data-sl="insert"]')) closeGallery(); });

  function shapeGallery() {
    const seen = new Set(); const groups = LIBRARY.filter(([g]) => ['General', 'Flowchart', 'Architecture'].includes(g)).map(([g, items]) => [g, items.filter(([sh]) => !seen.has(sh) && seen.add(sh))]);
    gallery.innerHTML = `<div class="slg-head">Shapes</div>` + groups.map(([g, items]) => `<div class="slg-group">${esc(g)}</div><div class="slg-grid">${items.map(([sh, label]) => `<button type="button" class="slg-item" data-shape="${sh}" title="${esc(label)}" aria-label="${esc(label)}"><svg viewBox="-4 -4 ${defaultSize(sh)[0] + 8} ${defaultSize(sh)[1] + 8}">${shapeSvg({ shape: sh, w: defaultSize(sh)[0], h: defaultSize(sh)[1], style: {} }, 'slg-shape')}</svg></button>`).join('')}</div>`).join('');
    gallery.hidden = false; gallery.querySelector('button')?.focus();
    gallery.onclick = (e) => {
      const b = e.target.closest('[data-shape]'); if (!b) return; const sh = b.dataset.shape; closeGallery();
      const [dw, dh] = defaultSize(sh); const k2 = Math.max(1, 200 / Math.max(dw, dh));
      const w = Math.round(dw * k2), h = Math.round(dh * k2);
      placeBlock(({ x, y, id }) => `::: shape #${id('shape')} type=${sh} x=${x} y=${y} w=${w} h=${h} fill=#e8e8e8\n\n\n:::`, w, h);
    };
  }
  async function iconGallery(onPick) {
    const { searchIcons, iconSvg } = await import('./slides-icons.js');
    gallery.innerHTML = `<div class="slg-head">Icons <span class="slg-sub">Lucide</span></div><input class="input slg-search" type="search" placeholder="Search icons, e.g. rocket, chart, user" aria-label="Search icons"><div class="slg-grid slg-icons" role="listbox" aria-label="Icons"></div>`;
    gallery.hidden = false;
    const grid = gallery.querySelector('.slg-icons'), q = gallery.querySelector('.slg-search');
    let seq = 0;
    const show = async () => {
      const n = ++seq; const names = await searchIcons(q.value, 96);
      const svgs = await Promise.all(names.map((nm) => iconSvg(nm, 2)));
      if (n !== seq) return;
      grid.innerHTML = names.length ? names.map((nm, i) => `<button type="button" class="slg-item" data-icon="${nm}" title="${nm}" aria-label="${nm}">${svgs[i]}</button>`).join('') : '<p class="slg-empty">No icon matches.</p>';
    };
    q.addEventListener('input', show); await show(); q.focus();
    gallery.onclick = (e) => {
      const b = e.target.closest('[data-icon]'); if (!b) return; closeGallery();
      if (onPick) return onPick(b.dataset.icon);
      placeBlock(({ x, y, id }) => `::: icon #${id('icon')} name=${b.dataset.icon} x=${x} y=${y} w=120 h=120 :::`, 120, 120);
    };
  }
  async function insertImage() {
    const src = await ctx.pickImage?.(); if (!src) return;
    const url = await ctx.resolveImage(src);
    const dim = await new Promise((res) => { const im = new Image(); im.onload = () => res([im.naturalWidth, im.naturalHeight]); im.onerror = () => res([800, 600]); im.src = url; });
    const k2 = Math.min(1, 640 / dim[0], 420 / dim[1]); const w = Math.round(dim[0] * k2), h = Math.round(dim[1] * k2);
    placeBlock(({ x, y }) => `![${src.split('/').pop().replace(/^[a-z0-9]+-/, '').replace(/\.\w+$/, '')}](${src}){x=${x} y=${y} w=${w} h=${h}}`, w, h);
  }
  async function insertMedia() {
    const src = await ctx.pickMedia?.(); if (!src) return;
    const audio = /\.(mp3|m4a|wav|ogg|aac|flac)$/i.test(src);
    const [w, h] = audio ? [480, 64] : [640, 360];
    placeBlock(({ x, y, id }) => `::: media #${id('media')} src=${src} x=${x} y=${y} w=${w} h=${h} :::`, w, h);
  }
  async function insertChart() {
    const t = await ctx.pickRef?.({ kind: 'embed' }); if (!t) return;
    const { parseRef, resolveTarget, docKind } = await import('./refs-syntax.js');
    const { target, part } = parseRef(t.replace(/^!?\[\[|\]\]$/g, '').replace(/^\{\{|\}\}$/g, ''));
    const env = ctx.refEnv(); const path = resolveTarget(target, env.files, env.from);
    if (!path || docKind(path) !== 'sheet') return ctx.toast('Choose a sheet and a range, for example Costs!A1:E5.');
    const bang = part.lastIndexOf('!'); const sheet = bang >= 0 ? part.slice(0, bang).replace(/^'|'$/g, '') : ''; const range = bang >= 0 ? part.slice(bang + 1) : part;
    if (!/:/.test(range)) return ctx.toast('A chart needs a range of cells, for example A1:E5.');
    box(`\`\`\`chart\ntype: column\nsource: /${path}\n${sheet ? `sheet: ${sheet}\n` : ''}range: ${range}\n\`\`\``, 640, 380);
  }
  async function insertRefBox(kind) {
    const t = await ctx.pickRef?.({ kind }); if (!t) return;
    if (kind === 'value') box(`# ${t}`, 360, 140, ' align=center valign=middle');
    else box(t, 560, 340);
  }
  function insertMenu(anchor) {
    const line = (extra, w, h) => placeBlock(({ x, y, id }) => `::: line #${id('line')} x=${x} y=${y + h} w=${w} h=0${extra} :::`, w, h);
    ctx.showMenu(anchor, [
      { label: 'Text box', run: () => addObjectBlock('box') },
      { label: 'Shape…', run: shapeGallery },
      { label: 'Icon…', run: () => iconGallery() }, '-',
      { label: 'Freeform (draw)', run: startDraw },
      { label: 'Line', run: () => line('', 320, 0) },
      { label: 'Arrow', run: () => line(' head=arrow', 320, 0) },
      { label: 'Connector between two objects', run: connectSelected, disabled: selected.length !== 2 }, '-',
      { label: 'Image…', run: insertImage },
      { label: 'Video or audio…', run: insertMedia },
      { label: 'Table', run: () => box('| Item | Value |\n| --- | --- |\n| One | 1 |\n| Two | 2 |', 560, 220) },
      { label: 'Chart from a sheet…', run: insertChart },
      { label: 'Equation', run: () => box('$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$', 480, 160, ' align=center valign=middle') },
      { label: 'Code', run: () => box('```js\nconst answer = 42;\n```', 520, 200) }, '-',
      { label: 'Live value from another document…', run: () => insertRefBox('value') },
      { label: 'Embed from another document…', run: () => insertRefBox('embed') },
    ]);
  }
  function connectSelected() {
    const objs = objsNow(); const [a, b] = selected.map((i) => objs[i]);
    if (!a || !b || a.kind === 'line' || b.kind === 'line') return ctx.toast('Select two objects (not lines) to connect.');
    const { fm, list } = chunks(); let t = list[cur];
    const ensure = (i) => { const o = scanObjects(t)[i]; if (o.id) return o.id; const nid = nextId(t, o.kind === 'image' ? 'image' : o.kind); t = setObjectAttrs(t, i, { id: nid }); return nid; };
    const ia = ensure(selected[0]), ib = ensure(selected[1]);
    t = addObject(t, `::: line #${nextId(t, 'line')} from=${ia} to=${ib} head=arrow :::`);
    list[cur] = t; selected = [scanObjects(t).length - 1]; commit(joinDeck(fm, list));
  }

  function restore(from, to) {
    if (!from.length) return;
    to.push(text); restoring = true; commit(from.pop()); restoring = false;
  }
  stage.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, .cm-editor, [contenteditable="true"]')) return;
    if ((e.key === 'Enter' || e.key === 'F2') && selected.length === 1) { e.preventDefault(); startEdit(selected[0]); return; }
    const mod = e.ctrlKey || e.metaKey, kk = e.key.toLowerCase();
    if (mod && kk === 'c' && selected.length) { e.preventDefault(); copySel(); }
    else if (mod && kk === 'x' && selected.length) { e.preventDefault(); copySel(); deleteSel(); }
    else if (mod && kk === 'v') { e.preventDefault(); pasteSel(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); restore(e.shiftKey ? redo : undo, e.shiftKey ? undo : redo); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); restore(redo, undo); }
  });
  host.querySelector('[data-sl="box"]').addEventListener('click', () => addObjectBlock('box'));
  host.querySelector('[data-sl="insert"]').addEventListener('click', (e) => insertMenu(e.currentTarget));

  /* events */
  thumbs.addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) select(Number(li.dataset.i)); });
  thumbs.addEventListener('keydown', (e) => {
    const li = e.target.closest('[data-i]'); if (!li) return;
    const i = Number(li.dataset.i);
    if (e.key === 'ArrowDown') { e.preventDefault(); select(i + 1); thumbs.querySelector(`[data-i="${cur}"]`)?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); select(i - 1); thumbs.querySelector(`[data-i="${cur}"]`)?.focus(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSlide(i); }
    if (e.altKey && e.key === 'ArrowUp') moveSlide(i, i - 1);
  });
  thumbs.addEventListener('contextmenu', (e) => {
    const li = e.target.closest('[data-i]'); if (!li) return; e.preventDefault();
    const i = Number(li.dataset.i); select(i, { reveal: false });
    ctx.showMenu(null, [
      { label: 'New slide after', run: () => addSlide('default', i + 1) },
      { label: 'Duplicate', run: () => duplicateSlide(i) }, '-',
      { label: 'Copy embed reference', run: () => ctx.copyRef?.(String(i + 1), 'embed') }, { label: 'Copy link to slide', run: () => ctx.copyRef?.(String(i + 1), 'link') }, '-',
      { label: 'Move up', run: () => moveSlide(i, i - 1) }, { label: 'Move down', run: () => moveSlide(i, i + 1) }, '-',
      { label: 'Delete slide', danger: true, run: () => deleteSlide(i) },
    ], { x: e.clientX, y: e.clientY });
  });
  let drag = null;
  thumbs.addEventListener('dragstart', (e) => { drag = Number(e.target.closest('[data-i]')?.dataset.i); e.dataTransfer.effectAllowed = 'move'; });
  thumbs.addEventListener('dragover', (e) => { if (drag == null) return; e.preventDefault(); thumbs.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop')); e.target.closest('[data-i]')?.classList.add('drop'); });
  thumbs.addEventListener('drop', (e) => { e.preventDefault(); const t = e.target.closest('[data-i]'); if (t && drag != null) moveSlide(drag, Number(t.dataset.i)); drag = null; });
  thumbs.addEventListener('dragend', () => { drag = null; thumbs.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop')); });

  host.querySelector('[data-sl-layout]').addEventListener('change', (e) => {
    const v = e.target.value;
    editChunk((c) => setDirective(c, 'layout', v === 'default' ? null : v));
    silent = true; chunkEditor.setDoc(chunks().list[cur].replace(/^\n+/, '')); silent = false;
  });
  host.querySelector('[data-sl-theme]').addEventListener('change', (e) => { const { fm, list } = chunks(); commit(joinDeck(setGlobal(fm, 'theme', e.target.value), list)); });
  host.querySelector('[data-sl-size]').addEventListener('change', (e) => { const { fm, list } = chunks(); commit(joinDeck(setGlobal(fm, 'size', e.target.value), list)); });
  host.querySelector('[data-sl-paginate]').addEventListener('change', (e) => { const { fm, list } = chunks(); commit(joinDeck(setGlobal(fm, 'paginate', String(e.target.checked)), list)); });
  let notesTimer;
  notesEl.addEventListener('input', () => { clearTimeout(notesTimer); notesTimer = setTimeout(() => editChunk((c) => setNotes(c, notesEl.value)), 350); });
  host.querySelector('[data-sl="add"]').addEventListener('click', (e) => ctx.showMenu(e.currentTarget, [...LAYOUTS.map(([v, l]) => ({ label: l, run: () => addSlide(v) })), '-', { label: 'Synced copy of a slide…', run: reuseSlide }]));
  host.querySelector('[data-sl="present"]').addEventListener('click', () => present(cur));
  host.querySelector('[data-sl="export"]').addEventListener('click', (e) => ctx.showMenu(e.currentTarget, [
    { label: 'PowerPoint (.pptx)…', run: () => exportPptx() },
    { label: 'PDF…', run: () => exportPdf() },
  ]));

  /* presenter */
  function present(start = 0) {
    let i = start, showNotes = false;
    const ov = document.createElement('div');
    ov.className = 'presenter'; ov.tabIndex = 0; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Presentation');
    document.body.appendChild(ov);
    const draw = () => {
      const s = deck.slides[i];
      const k = Math.min(innerWidth / deck.width, (innerHeight - (showNotes ? 160 : 0)) / deck.height);
      ov.innerHTML = `<div class="pr-stage" style="width:${deck.width * k}px;height:${deck.height * k}px"><div class="sl-scale" style="transform:scale(${k})">${renderSlide(deck, s)}</div></div>
        ${showNotes ? `<div class="pr-notes"><b>Notes</b><p>${esc(s.notes || 'No notes for this slide.')}</p></div>` : ''}
        <div class="pr-bar">${i + 1} / ${deck.slides.length}<span>Arrows to move, N for notes, Esc to exit</span></div>`;
      hydrate(ov);
    };
    const close = () => { removeEventListener('resize', draw); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); ov.remove(); select(i); };
    ov.addEventListener('keydown', (e) => {
      if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(e.key)) { i = Math.min(deck.slides.length - 1, i + 1); draw(); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { i = Math.max(0, i - 1); draw(); }
      else if (e.key === 'Home') { i = 0; draw(); } else if (e.key === 'End') { i = deck.slides.length - 1; draw(); }
      else if (e.key.toLowerCase() === 'n') { showNotes = !showNotes; draw(); }
      else if (e.key === 'Escape') close();
      e.preventDefault();
    });
    ov.addEventListener('click', (e) => { if (e.clientX > innerWidth / 3) i = Math.min(deck.slides.length - 1, i + 1); else i = Math.max(0, i - 1); draw(); });
    document.addEventListener('fullscreenchange', function f() { if (!document.fullscreenElement && ov.isConnected) { document.removeEventListener('fullscreenchange', f); close(); } });
    addEventListener('resize', draw);
    draw(); ov.focus();
    ov.requestFullscreen?.().catch(() => {});
  }

  /* exports */
  async function resolvedHtml() {
    const box = document.createElement('div');
    box.innerHTML = deck.slides.map((s) => renderSlide(deck, s)).join('');
    await hydrateCharts(box, ctx.readNote);
    if (box.querySelector('.sl-icon-svg')) { const { hydrateIcons } = await import('./slides-icons.js'); await hydrateIcons(box); }
    if (ctx.refEnv) { const { hydrateRefs } = await import('./refs.js'); await hydrateRefs(box, ctx.refEnv()); }
    await Promise.all([...box.querySelectorAll('img')].map(async (img) => {
      const src = img.dataset.src || img.getAttribute('src') || '';
      try { img.src = await ctx.dataUrl(src); } catch { img.remove(); }
    }));
    return box.innerHTML;
  }
  async function exportPdf() {
    try {
      const body = await resolvedHtml();
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${deck.width}px ${deck.height}px;margin:0}html,body{margin:0}${slidesCss}.slide{page-break-after:always;break-after:page}</style></head><body>${body}</body></html>`;
      const out = await ctx.exportPdf(html);
      if (out) ctx.toast('Slides exported to PDF.');
    } catch (e) { ctx.toast(`Export failed. ${e.message}`, { kind: 'error' }); }
  }
  async function exportPptx() {
    try {
      const { buildPptx } = await import('./slides-pptx.js');
      const bytes = await buildPptx(deck, { dataUrl: ctx.dataUrl, renderSlide, readNote: ctx.readNote });
      const out = await ctx.saveBinary('pptx', bytes);
      if (out) ctx.toast('Slides exported to PowerPoint.');
    } catch (e) { ctx.toast(`Export failed. ${e.message}`, { kind: 'error' }); }
  }

  return {
    setText(t) {
      if (t === text) return;
      text = t; deck = parseDeck(t);
      cur = Math.min(cur, deck.slides.length - 1);
      render();
    },
    setMode(view) { host.classList.toggle('sl-compact', view === 'split'); requestAnimationFrame(fit); },
    selectAtLine(line) {
      if (!deck) return;
      const fm = parseFrontmatter(text); let l = fm.raw ? fm.raw.split('\n').length : 1; let idx = 0;
      for (const [j, c] of splitSlides(fm.body).entries()) { const n = c.split('\n').length; if (line < l + n) { idx = j; break; } l += n; idx = j; }
      if (idx !== cur) { cur = idx; render(); }
    },
    present: () => present(cur),
    insertText(t) { const { fm, list } = chunks(); list[cur] = addObject(list[cur], t); commit(joinDeck(fm, list)); },
    gotoSlide(i) { if (deck && i >= 0) select(i, { reveal: false }); },
    refresh() { if (deck) { render({ keepEditor: true }); checkSync(); } },
    exportPdf, exportPptx,
    focus() { thumbs.querySelector('[aria-current="true"]')?.focus(); },
  };
}
