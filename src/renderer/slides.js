// Folio — slides surface: thumbnails, stage, per-slide Markdown, presenter, PDF and PowerPoint export.
import { t as tr, tl } from './i18n.js';
import { setFlag, addComment, removeComment, sectionsOf, SIZES, TOKENS, syncBody, slideChunk, syncedCopy, parseDeck, renderSlide, joinDeck, setDirective, setNotes, setGlobal, splitSlides, parseFrontmatter, LAYOUTS, THEMES, TEMPLATES } from './slides-core.js';
import { createEditor } from './editor.js';
import { perDoc } from './history.js';
import slidesCss from './slides.css';
import { hydrateCharts } from './markdown.js';
import { mountCanvas } from './slides-canvas.js';
import { SMART_TYPES, smartArt } from './slides-smartart.js';
import { designIdeas, BLOCKS } from './slides-designer.js';
import { SCHEMES, FONT_PAIRS, templateInfo, applyTemplate, templateFromDeck } from './slides-templates.js';
import { LIBRARY, shapeSvg, defaultSize } from './board-core.js';
import { startTextEdit } from './slides-text.js';
import { pathBlock, polygonsBlock, simplify, parsePoints, pointsText, replaceImageSrc, parseFill, MASKS, SHADOWS, scanObjects, addObject, nextId, setMany, setObjectAttrs, setObjectBody, inlineSafe, textStyle, removeObject, objectSource, retarget, alignPatches, distributePatches, zPatches, nextGroup, geometry, locked, groupOf } from './slides-objects.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function mountSlides(host, ctx) {
  const { icons } = ctx;
  host.innerHTML = `
    <div class="sf-toolbar" role="toolbar" aria-label="Slides">
      <button class="btn btn-quiet sf-ic" type="button" data-sl="undo" aria-label="Undo" title="Undo (${ctx.keyLabel('Mod+Z')})">${icons.undo}</button>
      <button class="btn btn-quiet sf-ic" type="button" data-sl="redo" aria-label="Redo" title="Redo (${ctx.keyLabel('Mod+Shift+Z')})">${icons.redo}</button>
      <button class="btn" type="button" data-sl="add">${icons.plus} New slide</button>
      <button class="btn" type="button" data-sl="box" title="Add a text box you can place anywhere">${icons.plus} Text box</button>
      <button class="btn" type="button" data-sl="insert" aria-haspopup="menu" title="Insert shapes, lines, images, tables, charts, icons, media">${icons.plus} Insert</button>
      <button class="btn" type="button" data-sl="arrange" aria-haspopup="menu" title="Align, distribute, order, group, lock">Arrange</button>
      <button class="btn" type="button" data-sl="review" aria-haspopup="menu" title="Find and replace, comments, accessibility">Review</button>
      <div class="seg sl-views" role="radiogroup" aria-label="Slide view"><button type="button" role="radio" data-slv="normal" aria-checked="true">Normal</button><button type="button" role="radio" data-slv="sorter" aria-checked="false">Sorter</button><button type="button" role="radio" data-slv="outline" aria-checked="false">Outline</button></div>
      <label class="sf-check"><input type="checkbox" data-sl-ideas> Ideas</label>
      <label class="sf-check"><input type="checkbox" data-sl-anim> Animate</label>
      <label class="sf-check"><input type="checkbox" data-sl-design> Design</label>
      <label class="sf-check"><input type="checkbox" data-sl-format> Format</label>
      <label class="sf-check"><input type="checkbox" data-sl-layers> Layers</label>
      <label class="sf-check"><input type="checkbox" data-sl-grid> Grid</label>
      <div class="sf-sep"></div>
      <label class="sf-field"><span>${tr('slides.layout')}</span><select class="rb-select" data-sl-layout>${LAYOUTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label class="sf-field"><span>${tr('slides.theme')}</span><select class="rb-select sf-narrow" data-sl-theme>${THEMES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label class="sf-field"><span>${tr('slides.size')}</span><select class="rb-select sf-narrow" data-sl-size>${Object.keys(SIZES).map((k) => `<option value="${k}">${k.replace("-portrait", " portrait")}</option>`).join("")}</select></label>
      <label class="sf-check"><input type="checkbox" data-sl-paginate> ${tr('slides.slide-numbers')}</label>
      <div class="sf-spacer"></div>
      <button class="btn" type="button" data-sl="export" aria-haspopup="menu">${icons.export} Export</button>
      <span class="sl-present-split"><button class="btn btn-primary" type="button" data-sl="present">${icons.play} Present</button><button class="btn btn-primary sl-present-more" type="button" data-sl="present-menu" aria-haspopup="menu" aria-label="More ways to present">▾</button></span>
    </div>
    <div class="sf-toolbar sl-fmtbar" role="toolbar" aria-label="${tr('slides.format-selected-object')}">
      <select class="rb-select sf-narrow" data-tx="style" aria-label="${tr('slides.paragraph-style')}"><option value="p">${tr('slides.text')}</option><option value="h1">${tr('slides.heading-1')}</option><option value="h2">${tr('slides.heading-2')}</option><option value="h3">${tr('slides.heading-3')}</option></select>
      <button class="rb" type="button" data-tx="bold" aria-label="${tr('slides.bold')}" title="${tr('slides.bold')}">${icons.bold}</button><button class="rb" type="button" data-tx="italic" aria-label="${tr('slides.italic')}" title="${tr('slides.italic')}">${icons.italic}</button>
      <button class="rb" type="button" data-tx="underline" aria-label="${tr('slides.underline')}" title="${tr('slides.underline')}">${icons.underline}</button><button class="rb" type="button" data-tx="strike" aria-label="${tr('slides.strikethrough')}" title="${tr('slides.strikethrough')}">${icons.strike}</button>
      <button class="rb" type="button" data-tx="highlight" aria-label="${tr('slides.highlight')}" title="${tr('slides.highlight')}">${icons.highlighter}</button><button class="rb" type="button" data-tx="link" aria-label="${tr('slides.link')}" title="${tr('slides.link')}">${icons.link}</button>
      <button class="rb" type="button" data-tx="bullet" aria-label="${tr('slides.bulleted-list')}" title="${tr('slides.bulleted-list')}">${icons.listBullet}</button><button class="rb" type="button" data-tx="ordered" aria-label="${tr('slides.numbered-list')}" title="${tr('slides.numbered-list')}">${icons.listOrdered}</button>
      <div class="sf-sep"></div>
      <label class="sf-field"><span>${tr('slides.font')}</span><select class="rb-select sf-narrow" data-at="font"><option value="">${tr('slides.theme')}</option><option value="sans">${tr('slides.sans')}</option><option value="serif">${tr('slides.serif')}</option><option value="mono">${tr('slides.mono')}</option><option value="rounded">${tr('slides.rounded')}</option></select></label>
      <label class="sf-field"><span>${tr('slides.size')}</span><input class="input sf-num" type="number" min="8" max="400" step="1" data-at="size" placeholder="${tr('slides.auto')}"></label>
      <label class="sf-field"><span>${tr('slides.text')}</span><input class="sf-color" type="color" data-at="color" value="#1a1a1a" aria-label="${tr('slides.text-colour')}"></label>
      <label class="sf-field"><span>${tr('slides.fill')}</span><input class="sf-color" type="color" data-at="fill" value="#f2f2f2" aria-label="${tr('slides.fill-colour')}"></label>
      <div class="sf-sep"></div>
      <button class="rb" type="button" data-al="left" aria-label="${tr('slides.align-left')}" title="${tr('slides.align-left')}">${icons.alignLeft}</button><button class="rb" type="button" data-al="center" aria-label="${tr('slides.align-centre')}" title="${tr('slides.align-centre')}">${icons.alignCenter}</button><button class="rb" type="button" data-al="right" aria-label="${tr('slides.align-right')}" title="${tr('slides.align-right')}">${icons.alignRight}</button>
      <label class="sf-field"><span>${tr('slides.vertical')}</span><select class="rb-select sf-narrow" data-at="valign"><option value="">${tr('slides.top')}</option><option value="middle">${tr('slides.middle')}</option><option value="bottom">${tr('slides.bottom')}</option></select></label>
      <label class="sf-field"><span>${tr('slides.spacing')}</span><select class="rb-select sf-narrow" data-at="line"><option value="">${tr('slides.theme')}</option><option value="1">1.0</option><option value="1.15">1.15</option><option value="1.4">1.4</option><option value="1.8">1.8</option></select></label>
      <label class="sf-check"><input type="checkbox" data-at-fit> ${tr('slides.shrink-to-fit')}</label>
    </div>
    <div class="sl-main">
      <ol class="sl-thumbs" aria-label="${tr('slides.slides')}"></ol>
      <div class="sl-center">
        <div class="sl-dock"><div class="sl-layers" hidden aria-label="Objects on this slide"></div><div class="sl-format" hidden role="region" aria-label="Format"></div><div class="sl-format sl-design" hidden role="region" aria-label="Design"></div><div class="sl-format sl-review" hidden role="region" aria-label="Review"></div><div class="sl-format sl-ideas" hidden role="region" aria-label="Design ideas"></div><div class="sl-format sl-anim" hidden role="region" aria-label="Animations"></div></div>
        <div class="sl-find" role="search" aria-label="Find and replace in this deck" hidden></div>
        <div class="sl-sync" role="status" hidden></div>
        <div class="sl-gallery" role="dialog" aria-label="${tr('slides.insert')}" hidden></div>
        <div class="sl-stage" tabindex="0" aria-label="${tr('slides.slide-canvas-arrow-keys-move-the-selec')}"><div class="sl-frame"></div></div>
        <div class="sl-edit">
          <div class="sl-edit-col"><div class="sl-edit-head"><span class="sl-cur-label">${tr('slides.slide')} <b class="sl-cur">1</b> ${tr('slides.content')}</span><span class="sl-hint">${tr('slides.markdown')} <code>${tr('slides.left')}</code> / <code>${tr('slides.right')}</code>, <code>${tr('slides.card')}</code>, <code>${tr('slides.bg-right-img')}</code></span></div><div class="sl-cm"></div></div>
          <div class="sl-edit-col sl-notes-col"><label class="sl-edit-head" for="sl-notes-${host.id}">${tr('slides.speaker-notes')}</label><textarea class="sl-notes input" id="sl-notes-${host.id}" placeholder="${tr('slides.only-you-see-these-while-presenting')}"></textarea></div>
        </div>
      </div>
    </div>`;

  let text = '', deck = null, cur = 0, silent = false, canvas = null, selected = [];
  let tplText = null, tplRef = null, tplSeq = 0;
  const parse = (t) => parseDeck(t, { template: tplText });
  const undo = []; const redo = []; let lastPush = 0, restoring = false;
  const docs = perDoc(undo, redo); let seen = false;
  const thumbs = host.querySelector('.sl-thumbs');
  const frame = host.querySelector('.sl-frame');
  const stage = host.querySelector('.sl-stage');
  const notesEl = host.querySelector('.sl-notes');
  const chunkEditor = createEditor(host.querySelector('.sl-cm'), { onChange: (t) => { if (!silent) editChunk(() => t); } });

  /** a deck can take its theme, tokens and masters from another deck: `template: Brand.slides` */
  async function loadTemplate(force = false) {
    const ref = parseFrontmatter(text).data.template || null;
    if (ref === tplRef && !force) return;
    tplRef = ref; const n = ++tplSeq;
    if (!ref) { if (tplText != null) { tplText = null; deck = parse(text); render({ keepEditor: true }); } return; }
    try {
      const { resolveTarget } = await import('./refs-syntax.js');
      const env = ctx.refEnv(); const path = resolveTarget(ref.replace(/^\[\[|\]\]$/g, ''), env.files, env.from);
      if (!path || path === env.from) throw new Error(`template “${ref}” not found`);
      const t = await env.read(path);
      if (n !== tplSeq) return;
      tplText = t.replace(/^(---\r?\n[\s\S]*?)^template:.*\r?\n/m, '$1');
    } catch (e) { if (n !== tplSeq) return; tplText = null; ctx.toast(e.message, { kind: 'error' }); }
    deck = parse(text); render({ keepEditor: true }); loadFonts();
  }
  /** fonts: assets/Brand-Regular.woff2, assets/Brand-Bold.woff2 → @font-face rules (family from the file name) */
  let fontKey = '';
  async function fontFaces({ inline = false } = {}) {
    const list = String(deck?.global.fonts || '').split(',').map((x) => x.trim()).filter((x) => /\.(woff2?|ttf|otf)$/i.test(x));
    const W = { thin: 100, extralight: 200, light: 300, regular: 400, book: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
    const rules = await Promise.all(list.map(async (f) => {
      const base = f.split('/').pop().replace(/\.\w+$/, ''); const [fam, ...rest] = base.split(/[-_]/); const tag = rest.join('').toLowerCase();
      const weight = Object.entries(W).find(([k]) => tag.includes(k))?.[1] || 400; const style = tag.includes('italic') ? 'italic' : 'normal';
      const url = inline ? await ctx.dataUrl(f).catch(() => null) : await ctx.resolveImage(f);
      return url ? `@font-face{font-family:"${fam.replace(/"/g, '')}";src:url("${url}");font-weight:${weight};font-style:${style};font-display:block}` : '';
    }));
    return rules.join('');
  }
  async function loadFonts() {
    const key = String(deck?.global.fonts || ''); if (key === fontKey) return; fontKey = key;
    let el = document.getElementById('sl-fonts'); if (!el) { el = document.createElement('style'); el.id = 'sl-fonts'; document.head.appendChild(el); }
    el.textContent = await fontFaces();
  }
  function chunks() { const fm = parseFrontmatter(text); return { fm: fm.raw, list: splitSlides(fm.body) }; }
  function commit(next, { keepEditor = false, keepFrame = false } = {}) {
    if (!restoring && text && next !== text) {
      const now = Date.now();
      if (now - lastPush > 700) { undo.push(text); if (undo.length > 200) undo.shift(); }
      lastPush = now; redo.length = 0;
    }
    text = next; deck = parse(text); loadTemplate();
    cur = Math.min(cur, deck.slides.length - 1);
    render({ keepEditor, keepFrame });
    syncHistory();
    ctx.onChange(text);
  }
  function syncHistory() {
    const u = host.querySelector('[data-sl="undo"]'), r = host.querySelector('[data-sl="redo"]');
    if (u) u.disabled = !undo.length; if (r) r.disabled = !redo.length;
  }
  function editChunk(fn) {
    const { fm, list } = chunks();
    list[cur] = fn(list[cur]);
    commit(joinDeck(fm, list), { keepEditor: true });
  }

  function hydrate(root) {
    if (root.querySelector('.chart-block[data-spec]')) hydrateCharts(root, ctx.readNote);
    if (root.querySelector('.sl-icon-svg')) import('./slides-icons.js').then(({ hydrateIcons }) => hydrateIcons(root));
    for (const m of root.querySelectorAll('.sl-media-el[data-src]')) { const src = m.dataset.src; const set = (u) => { if (u) m.src = u; }; if (/^(data:|blob:)/i.test(src)) set(src); else Promise.resolve(ctx.resolveImage(src)).then(set); if (m.dataset.poster) Promise.resolve(ctx.resolveImage(m.dataset.poster)).then((u) => u && (m.poster = u)); }
    if (root.querySelector('[data-ref]') && ctx.refEnv) import('./refs.js').then(({ hydrateRefs }) => hydrateRefs(root, ctx.refEnv()));
    for (const img of root.querySelectorAll('img[data-src]')) {
      const src = img.dataset.src;
      if (/^(data:|blob:)/i.test(src)) img.src = src;
      else Promise.resolve(ctx.resolveImage(src)).then((u) => { if (u) img.src = u; });
    }
  }
  function shrinkFit(root) {
    for (const el of root.querySelectorAll('.sl-obj.is-fit')) {
      const t = el.querySelector('.sl-obj-text') || el; let size = parseFloat(getComputedStyle(t).fontSize) || 30;
      for (let n = 0; n < 60 && size > 10 && (t.scrollHeight > el.clientHeight + 1 || t.scrollWidth > el.clientWidth + 1); n++) { size -= 1; t.style.fontSize = `${size}px`; }
    }
  }
  /* canvas zoom: 1 = fit the window; above that the stage scrolls (and Space-drag pans) */
  let zoom = 1;
  const zoomBar = document.createElement('div'); zoomBar.className = 'sl-zoombar'; zoomBar.setAttribute('role', 'group'); zoomBar.setAttribute('aria-label', 'Zoom');
  zoomBar.innerHTML = '<button type="button" class="icon-btn" data-z="-" aria-label="Zoom out">−</button><button type="button" class="sl-zoom-pct" data-z="fit" title="Fit to window (Ctrl+0)">100%</button><button type="button" class="icon-btn" data-z="+" aria-label="Zoom in">+</button>';
  stage.parentElement.appendChild(zoomBar);
  const setZoom = (z, at) => {
    const old = zoom; zoom = Math.max(1, Math.min(6, Math.round(z * 100) / 100)); if (zoom === old) return;
    const r = stage.getBoundingClientRect(); const px = at ? at.x - r.left : r.width / 2, py = at ? at.y - r.top : r.height / 2;
    const fx = (stage.scrollLeft + px) / Math.max(1, stage.scrollWidth), fy = (stage.scrollTop + py) / Math.max(1, stage.scrollHeight);
    fit(); stage.scrollLeft = fx * stage.scrollWidth - px; stage.scrollTop = fy * stage.scrollHeight - py;
  };
  zoomBar.addEventListener('click', (e) => { const b = e.target.closest('[data-z]'); if (!b) return; const z = b.dataset.z; setZoom(z === 'fit' ? 1 : z === '+' ? zoom * 1.25 : zoom / 1.25); });
  stage.addEventListener('wheel', (e) => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), { x: e.clientX, y: e.clientY }); }, { passive: false });
  host.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.target.closest('input, textarea, select, [contenteditable="true"], .cm-editor')) return;
    if (e.key === '=' || e.key === '+') { e.preventDefault(); setZoom(zoom * 1.25); } else if (e.key === '-') { e.preventDefault(); setZoom(zoom / 1.25); } else if (e.key === '0') { e.preventDefault(); setZoom(1); }
  });
  let panning = null, spaceDown = false;
  host.addEventListener('keydown', (e) => { if (e.key === ' ' && zoom > 1 && !e.target.closest('input, textarea, [contenteditable="true"], .cm-editor')) { spaceDown = true; stage.classList.add('is-panning'); e.preventDefault(); } });
  host.addEventListener('keyup', (e) => { if (e.key === ' ') { spaceDown = false; stage.classList.remove('is-panning'); } });
  stage.addEventListener('pointerdown', (e) => { if (!spaceDown && e.button !== 1) return; e.preventDefault(); e.stopPropagation(); panning = { x: e.clientX, y: e.clientY, l: stage.scrollLeft, t: stage.scrollTop }; }, true);
  addEventListener('pointermove', (e) => { if (!panning) return; stage.scrollLeft = panning.l - (e.clientX - panning.x); stage.scrollTop = panning.t - (e.clientY - panning.y); });
  addEventListener('pointerup', () => { panning = null; });
  function fit() {
    if (!deck) return;
    const r = stage.getBoundingClientRect();
    const k = Math.max(0.05, Math.min((r.width - 48) / deck.width, (r.height - 48) / deck.height)) * zoom;
    stage.classList.toggle('is-zoomed', zoom > 1); const pct = zoomBar.querySelector('.sl-zoom-pct'); if (pct) pct.textContent = `${Math.round(zoom * 100)}%`;
    frame.style.width = `${deck.width * k}px`; frame.style.height = `${deck.height * k}px`;
    frame.style.setProperty('--k', k);
    canvas?.update();
  }
  new ResizeObserver(fit).observe(stage);

  /* thumbnails: rendered when they scroll into view, and cached until their slide (or the deck's look) changes */
  const thumbCache = new Map(); let thumbObs = null; let thumbSig = ''; let thumbList = [];
  function thumbKey(s) {
    const raw = thumbList[s.index] ?? '';
    return /:::\s*zoom\b/.test(raw) ? null : `${thumbSig}\u0000${s.number}\u0000${raw}`;
  }
  function thumbHtml(s, i) {
    const key = thumbKey(s); const hit = key && thumbCache.get(key);
    if (hit) return hit;
    // the current slide and its neighbours render now; the rest when they scroll into view
    if (Math.abs(i - cur) > 6) return '';
    const html = renderSlide(deck, s); if (key) thumbCache.set(key, html); return html;
  }
  function watchThumbs() {
    thumbObs?.disconnect();
    thumbObs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const li = e.target; const i = +li.dataset.i; const s = deck.slides[i]; const box = li.querySelector('.sl-scale');
        if (box && !box.firstElementChild && s) { const key = thumbKey(s); let html = key && thumbCache.get(key); if (!html) { html = renderSlide(deck, s); if (key) thumbCache.set(key, html); } box.innerHTML = html; }
        if (box && !li.dataset.hydrated) { hydrate(li); li.dataset.hydrated = '1'; }
        thumbObs.unobserve(li);
      }
    }, { root: thumbs, rootMargin: '600px 0px' });
    thumbs.querySelectorAll('.sl-thumb').forEach((li) => thumbObs.observe(li));
    if (thumbCache.size > 2000) thumbCache.clear();
  }
  function render({ keepEditor = false, keepFrame = false } = {}) {
    { const { fm, list } = chunks(); thumbList = list; thumbSig = `${fm}\u0000${deck.masters.filter((m) => !m.fromTemplate).map((m) => list[m.index]).join('\u0001')}\u0000${deck.template ? 'tpl' : ''}\u0000${deck.width}x${deck.height}`; }
    if (!deck) return;
    const tk = 176 / deck.width;
    thumbs.innerHTML = deck.slides.map((s, i) => `${s.section ? `<li class="sl-section" data-sec="${i}" role="presentation"><span>${esc(s.section)}</span><button type="button" class="sl-sec-btn" data-sec-menu="${i}" aria-label="Section ${esc(s.section)} options">…</button></li>` : ''}
      <li class="sl-thumb${s.master ? ' is-master' : ''}${s.hidden ? ' is-hidden' : ''}" data-i="${i}" draggable="true" aria-current="${i === cur}" tabindex="0" aria-label="${s.master ? `Master slide${s.master !== 'all' ? ' for ' + esc(s.master) + ' slides' : ''}` : `Slide ${s.number}`}${s.title ? ': ' + esc(s.title) : ''}">
        <span class="sl-thumb-n">${s.master ? 'M' : s.number}${s.hidden ? '<span class="sl-badge" title="Hidden in the presentation">hidden</span>' : ''}${s.comments.length ? `<span class="sl-badge" title="${s.comments.length} ${s.comments.length === 1 ? 'comment' : 'comments'}">${s.comments.length} ${s.comments.length === 1 ? "comment" : "comments"}</span>` : ''}</span>
        <div class="sl-thumb-box" style="width:176px;height:${deck.height * tk}px"><div class="sl-scale" style="transform:scale(${tk})">${thumbHtml(s, i)}</div></div>
      </li>`).join('');
    watchThumbs();
    loadFonts();
    const s = deck.slides[cur];
    if (!keepFrame) {
    frame.innerHTML = `<div class="sl-scale">${renderSlide(deck, s)}</div>`;
    hydrate(frame); fit(); shrinkFit(frame);
    canvas?.destroy();
    canvas = mountCanvas({
      frame, stage, width: deck.width, height: deck.height, selected,
      getChunk: () => chunks().list[cur],
      edit(fn) { const { fm, list } = chunks(); list[cur] = fn(list[cur]); commit(joinDeck(fm, list)); },
      onSelect(sel) { selected = sel; canvas?.select(sel, { notify: false }); renderLayers(); syncFmt(); renderFormat(); drawVertices(); animPane?.render(); },
    });
    }
    host.querySelector('[data-sl-layout]').value = s.layout;
    host.querySelector('[data-sl-theme]').value = deck.theme;
    host.querySelector('[data-sl-size]').value = SIZES[deck.global.size] ? deck.global.size : '16:9';
    host.querySelector('[data-sl-paginate]').checked = deck.global.paginate === 'true';
    host.querySelector('.sl-cur-label').innerHTML = s.master ? `Master${s.master !== 'all' ? ` for <b>${esc(s.master)}</b> slides` : ' for <b>all</b> slides'}` : `Slide <b class="sl-cur">${s.number}</b> content`;
    renderLayers(); syncFmt(); checkSync(); renderFormat(); drawVertices(); renderDesign(); renderReview(); renderView(); renderIdeas(); renderAnim();
    if (document.activeElement !== notesEl) notesEl.value = s.notes;
    if (!keepEditor) { silent = true; chunkEditor.setDoc(chunks().list[cur].replace(/^\n+/, '')); silent = false; }
    ctx.onStatus?.(`${deck.shown.length} ${deck.shown.length === 1 ? 'slide' : 'slides'}${deck.masters.length ? ` · ${deck.masters.length} ${deck.masters.length === 1 ? 'master' : 'masters'}` : ''}`);
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
    if (list.length === 1) return ctx.toast(tr('slides.a-deck-needs-at-least-one-slide'));
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
      item(many ? tl('slides', 'Align left') : tl('slides', 'Align to slide: left'), one, () => patchSel(alignPatches(objs, selected, 'left', slide))),
      item(many ? tl('slides', 'Align center') : tl('slides', 'Align to slide: center'), one, () => patchSel(alignPatches(objs, selected, 'center', slide))),
      item(many ? tl('slides', 'Align right') : tl('slides', 'Align to slide: right'), one, () => patchSel(alignPatches(objs, selected, 'right', slide))),
      item(many ? tl('slides', 'Align top') : tl('slides', 'Align to slide: top'), one, () => patchSel(alignPatches(objs, selected, 'top', slide))),
      item(many ? tl('slides', 'Align middle') : tl('slides', 'Align to slide: middle'), one, () => patchSel(alignPatches(objs, selected, 'middle', slide))),
      item(many ? tl('slides', 'Align bottom') : tl('slides', 'Align to slide: bottom'), one, () => patchSel(alignPatches(objs, selected, 'bottom', slide))), '-',
      item(tl('slides', 'Distribute horizontally'), three, () => patchSel(distributePatches(objs, selected, 'h'))),
      item(tl('slides', 'Distribute vertically'), three, () => patchSel(distributePatches(objs, selected, 'v'))), '-',
      item(tl('slides', 'Bring to front'), one, () => patchSel(zPatches(objs, selected, 'front'))),
      item(tl('slides', 'Bring forward'), one, () => patchSel(zPatches(objs, selected, 'forward'))),
      item(tl('slides', 'Send backward'), one, () => patchSel(zPatches(objs, selected, 'backward'))),
      item(tl('slides', 'Send to back'), one, () => patchSel(zPatches(objs, selected, 'back'))), '-',
      item(tl('slides', 'Group'), many, () => { const g = nextGroup(objs); patchSel(selected.map((i) => [i, { group: g }])); }),
      item(tl('slides', 'Ungroup'), grouped, () => patchSel(selected.map((i) => [i, { group: null }]))),
      item(tl('slides', 'Lock'), one, () => patchSel(selected.map((i) => [i, { lock: 'true' }]))), '-',
      ...(() => { const ok = many && selected.every((i) => ['shape', 'box', 'path', 'image'].includes(objs[i]?.kind)); return [
        item(tl('slides', 'Merge shapes: union'), ok, () => mergeSel('union')), item(tl('slides', 'Merge shapes: intersect'), ok, () => mergeSel('intersection')),
        item(tl('slides', 'Merge shapes: subtract'), ok, () => mergeSel('difference')), item(tl('slides', 'Merge shapes: combine'), ok, () => mergeSel('xor')), '-']; })(),
      item(tl('slides', 'Copy'), one, () => copySel()), item(tl('slides', 'Cut'), one, () => { copySel(); deleteSel(); }), { label: tr('slides.paste'), run: () => pasteSel(), disabled: !clip.length },
      item(tl('slides', 'Duplicate'), one, () => { copySel(); pasteSel(); }),
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
    if (!clip.length) return ctx.toast(tr('slides.nothing-to-paste-copy-an-object-first'));
    let n0 = 0;
    editChunk2((c) => { n0 = scanObjects(c).length; return clip.reduce((t, src) => addObject(t, retarget(src, t)), c); });
    selected = clip.map((_, j) => n0 + j); canvas?.select(selected, { notify: false });
  }
  function renderLayers() {
    const pane = host.querySelector('.sl-layers'); if (pane.hidden) return;
    const objs = objsNow();
    const rows = objs.map((o, i) => ({ o, i, z: geometry(o).z })).sort((a, b) => b.z - a.z || b.i - a.i);
    pane.innerHTML = `<div class="sl-layers-head">${tr('slides.objects')}</div>` + (rows.length ? rows.map(({ o, i }) => `
      <div class="sl-layer" role="button" tabindex="0" data-i="${i}" aria-pressed="${selected.includes(i)}">
        <span class="sl-layer-name">${esc(o.id || o.kind + ' ' + (i + 1))}</span>
        ${groupOf(o) ? `<span class="sl-layer-tag">${esc(groupOf(o))}</span>` : ''}
        <button class="sl-layer-lock" type="button" data-lock="${i}" aria-label="${locked(o) ? 'Unlock' : 'Lock'} ${esc(o.id || o.kind)}" aria-pressed="${locked(o)}">${locked(o) ? 'Locked' : 'Lock'}</button>
      </div>`).join('') : '<p class="sl-layers-empty">' + tr('slides.no-placed-objects-yet-add-a-text-box-o') + '</p>');
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
  const isText = (o) => o && (o.kind === 'box' || o.kind === 'shape' || o.kind === 'smartart');
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
      b.title = live ? b.getAttribute('aria-label') : tl('slides', 'Double-click a box to edit its text');
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
    if (after.length !== before.length || splitSlides(next.replace(/^\n+/, '')).length !== 1 + (list[cur].match(/^---\s*$/gm) || []).length) { ctx.toast(tr('slides.that-edit-could-not-be-saved-safely-so'), { kind: 'error' }); return; }
    list[cur] = next; commit(joinDeck(f, list), { keepFrame: true });
  }

  function startEdit(i) {
    const o = objsNow()[i]; if (!isText(o) || locked(o) || textEdit) return;
    const el = frame.querySelector(`.sl-obj[data-obj="${i}"]`); if (!el) return;
    if (!inlineSafe(o.body)) { ctx.toast(tr('slides.this-box-has-blocks-the-text-editor-ca')); return; }
    const target = o.kind === 'shape' ? el.querySelector('.sl-obj-text') : el;
    if (o.kind === 'smartart') el.classList.add('is-sm-editing');
    selected = [i]; canvas?.select([], { notify: false }); editing = i; renderLayers();
    textEdit = startTextEdit({
      el: target, body: o.body.replace(/^\n+/, ''),
      onChange: (md) => editChunk2k((c) => setObjectBody(c, i, o.kind === 'shape' ? '\n' + md : md)),
      onLink: (prev) => ctx.prompt({ title: prev ? tl('slides', 'Edit link') : tl('slides', 'Add link'), label: tr('slides.address'), value: prev || 'https://', hint: tr('slides.leave-empty-to-remove-the-link'), action: tr('slides.apply'), allowEmpty: true, validate: false }),
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
    syncBar.innerHTML = `<span>${msg}</span>${changed ? '<button class="btn" type="button" data-sync="update">' + tr('slides.update-from-source') + '</button>' : ''}<button class="btn" type="button" data-sync="open">${tr('slides.open-source')}</button><button class="btn" type="button" data-sync="unlink">${tr('slides.unlink')}</button>`;
  }
  syncBar.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sync]'); if (!b) return; const ref = deck.slides[cur].eff.source;
    if (b.dataset.sync === 'unlink') editChunk2((c) => setDirective(c, 'source', null));
    if (b.dataset.sync === 'update') { const src = await sourceOf(ref); editChunk2(() => syncedCopy(ref, src)); ctx.toast(tr('slides.slide-updated-from-its-source')); }
    if (b.dataset.sync === 'open') { const { parseRef, resolveTarget } = await import('./refs-syntax.js'); const env = ctx.refEnv(); const { target, part } = parseRef(ref); ctx.openRef(target ? resolveTarget(target, env.files, env.from) : env.from, part); }
  });
  async function reuseSlide() {
    const t = await ctx.pickRef?.({ kind: 'link' }); if (!t) return;
    const ref = t.replace(/^!?\[\[|\]\]$/g, '').replace(/\|.*$/, '');
    if (!/#\d+$/.test(ref)) return ctx.toast(tr('slides.choose-a-slide-of-a-deck-as-the-part'));
    try { const src = await sourceOf(ref); const { fm, list } = chunks(); list.splice(cur + 1, 0, syncedCopy(ref, src)); cur += 1; commit(joinDeck(fm, list)); ctx.toast(tr('slides.added-a-synced-copy-it-will-offer-to-u')); }
    catch (e) { ctx.toast(e.message, { kind: 'error' }); }
  }
  /* slide management (P8) */
  function editAt(i, fn) { const { fm, list } = chunks(); list[i] = fn(list[i]); commit(joinDeck(fm, list)); }
  function editMany(idx, fn) { const { fm, list } = chunks(); for (const i of idx) list[i] = fn(list[i], i); commit(joinDeck(fm, list)); }
  function hideSlides(idx, on) { editMany(idx, (c) => setFlag(c, 'hidden', on)); ctx.toast(on ? `${idx.length === 1 ? 'Slide' : idx.length + ' slides'} hidden in the presentation.` : 'Slide shown again.'); }
  async function sectionAt(i) {
    const name = await ctx.prompt({ title: deck.slides[i].section ? tl('slides', 'Rename section') : tl('slides', 'Add section'), label: tr('slides.section-name'), value: deck.slides[i].section || '', action: tr('slides.save') });
    if (name == null) return; editAt(i, (c) => setDirective(c, 'section', name.trim() || null));
  }
  thumbs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sec-menu]'); if (!b) return; e.stopPropagation(); const i = Number(b.dataset.secMenu);
    const sec = sectionsOf(deck).find((x) => x.start === i);
    ctx.showMenu(b, [
      { label: tr('slides.rename-section'), run: () => sectionAt(i) },
      { label: tr('slides.hide-all-slides-in-section'), run: () => hideSlides(sec.slides.filter((j) => !deck.slides[j].master), true) },
      { label: tr('slides.show-all-slides-in-section'), run: () => hideSlides(sec.slides, false) },
      { label: tr('slides.remove-section-keep-slides'), run: () => editAt(i, (c) => setDirective(c, 'section', null)) },
    ]);
  }, true);

  /* comments */
  const rpane = host.querySelector('.sl-review');
  async function commentPrompt() {
    const text = await ctx.prompt({ title: tr('slides.add-comment'), label: tr('slides.comment-on-slide-master', { master: deck.slides[cur].number ?? 'master' }), value: '', action: tr('slides.add-comment') });
    if (!text || !text.trim()) return;
    const author = (await ctx.userName?.()) || '';
    editAt(cur, (c) => addComment(c, { author, date: new Date().toISOString().slice(0, 10), text }));
    showReview('comments');
  }
  let reviewTab = 'comments', a11yIssues = [];
  function showReview(tab) { reviewTab = tab; rpane.hidden = false; dockRoom(); renderReview(); }
  function renderReview() {
    if (rpane.hidden || !deck) return;
    const tabs = `<div class="fp-head rv-tabs"><button type="button" data-rt="comments" aria-pressed="${reviewTab === 'comments'}">${tr('slides.comments')}</button><button type="button" data-rt="a11y" aria-pressed="${reviewTab === 'a11y'}">${tr('slides.accessibility')}</button><button type="button" class="dp-x rv-close" data-rt="close" aria-label="${tr('slides.close-review-pane')}">${tr('slides.close')}</button></div>`;
    if (reviewTab === 'comments') {
      const all = deck.slides.flatMap((sl) => sl.comments.map((c, k) => ({ ...c, k, sl })));
      rpane.innerHTML = tabs + `<div class="fp-btns"><button class="btn" type="button" data-rv="add">${tr('slides.add-comment-to-this-slide')}</button></div>` + (all.length ? `<ul class="rv-list">${all.map((c) => `<li class="${c.sl.index === cur ? 'is-cur' : ''}"><a href="#" data-go="${c.sl.index}">${c.sl.master ? 'Master' : 'Slide ' + c.sl.number}</a>${c.author || c.date ? ` <span class="rv-meta">${esc(c.author)}${c.date ? ' · ' + esc(c.date) : ''}</span>` : ''}<p>${esc(c.text)}</p><button class="dp-x" type="button" data-resolve="${c.sl.index}:${c.k}">${tr('slides.resolve')}</button></li>`).join('')}</ul>` : '<p class="fp-note">' + tr('slides.no-comments-comments-are-saved-in-the') + '</p>');
    } else {
      const sev = { error: 'Error', warning: 'Warning', tip: tr('slides.tip') };
      rpane.innerHTML = tabs + (a11yIssues.length ? `<p class="fp-note">${a11yIssues.filter((x) => x.severity === 'error').length} errors, ${a11yIssues.filter((x) => x.severity === 'warning').length} warnings.</p><ul class="rv-list">${a11yIssues.map((x, n) => `<li class="rv-${x.severity}"><span class="rv-sev">${sev[x.severity]}</span><p>${esc(x.message)}</p><span class="fp-btns"><button class="btn" type="button" data-go="${x.slide}" data-go-obj="${x.object ?? ''}">${tr('slides.go-to-slide')}</button>${x.kind === 'alt' && x.object != null ? `<button class="btn" type="button" data-fix="${n}">${tr('slides.add-description')}</button>` : ''}</span></li>`).join('')}</ul>` : '<p class="fp-note">' + tr('slides.no-problems-found-titles-picture-descr') + '</p>') + '<div class="fp-btns"><button class="btn" type="button" data-rv="recheck">' + tr('slides.check-again') + '</button></div>';
    }
  }
  async function runA11y() { const { checkDeck } = await import('./slides-a11y.js'); a11yIssues = checkDeck(deck); showReview('a11y'); }
  rpane.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-rt]'); if (t) { if (t.dataset.rt === 'close') { rpane.hidden = true; dockRoom(); return; } reviewTab = t.dataset.rt; if (reviewTab === 'a11y') return runA11y(); return renderReview(); }
    const go = e.target.closest('[data-go]'); if (go) { e.preventDefault(); select(Number(go.dataset.go)); if (go.dataset.goObj) { selected = [Number(go.dataset.goObj)]; canvas?.select(selected, { notify: true }); } return; }
    const rs = e.target.closest('[data-resolve]'); if (rs) { const [i, k] = rs.dataset.resolve.split(':').map(Number); editAt(i, (c) => removeComment(c, k)); return; }
    const fx = e.target.closest('[data-fix]'); if (fx) {
      const it = a11yIssues[Number(fx.dataset.fix)];
      const alt = await ctx.prompt({ title: tr('slides.describe-the-picture'), label: tr('slides.alternative-text'), value: '', hint: tr('slides.what-does-the-picture-show-in-one-sent'), action: tr('slides.save') });
      if (alt && alt.trim()) { editAt(it.slide, (c) => setObjectAttrs(c, it.object, { alt: alt.trim() })); runA11y(); }
      return;
    }
    const rv = e.target.closest('[data-rv]'); if (!rv) return;
    if (rv.dataset.rv === 'add') commentPrompt(); else runA11y();
  });

  /* find and replace across the deck */
  const findBar = host.querySelector('.sl-find'); let hits = [], hit = -1;
  function openFind() {
    findBar.hidden = false;
    findBar.innerHTML = `<input class="input" type="search" data-f="q" placeholder="${tr('slides.find-in-slides')}" aria-label="${tr('slides.find')}"><input class="input" type="text" data-f="r" placeholder="${tr('slides.replace-with')}" aria-label="${tr('slides.replace-with')}"><label class="sf-check"><input type="checkbox" data-f="case"> ${tr('slides.match-case')}</label><span class="sl-find-n" aria-live="polite"></span><button class="btn" type="button" data-fb="prev">${tr('slides.previous')}</button><button class="btn" type="button" data-fb="next">${tr('slides.next')}</button><button class="btn" type="button" data-fb="one">${tr('slides.replace-2')}</button><button class="btn" type="button" data-fb="all">${tr('slides.replace-all')}</button><button class="dp-x" type="button" data-fb="close" aria-label="${tr('slides.close-find')}">${tr('slides.close')}</button>`;
    findBar.querySelector('[data-f=q]').focus();
  }
  const fq = () => findBar.querySelector('[data-f=q]')?.value || '';
  const fre = () => { const q = fq(); if (!q) return null; return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), findBar.querySelector('[data-f=case]').checked ? 'g' : 'gi'); };
  function findAll() {
    const re = fre(); hits = [];
    if (re) { const { list } = chunks(); list.forEach((c, i) => { for (const m of c.matchAll(re)) hits.push({ i, at: m.index }); }); }
    findBar.querySelector('.sl-find-n').textContent = fq() ? `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}` : '';
  }
  function gotoHit(d) { findAll(); if (!hits.length) return; hit = (hit + d + hits.length) % hits.length; select(hits[hit].i); findBar.querySelector('.sl-find-n').textContent = `${hit + 1} of ${hits.length}`; }
  findBar.addEventListener('input', () => { hit = -1; findAll(); });
  findBar.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); gotoHit(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') { findBar.hidden = true; stage.focus(); } });
  findBar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fb]'); if (!b) return; const re = fre(); const rep = findBar.querySelector('[data-f=r]').value;
    if (b.dataset.fb === 'close') { findBar.hidden = true; return; }
    if (b.dataset.fb === 'next' || b.dataset.fb === 'prev') return gotoHit(b.dataset.fb === 'next' ? 1 : -1);
    if (!re) return;
    if (b.dataset.fb === 'all') { findAll(); const n = hits.length; if (!n) return; const { fm, list } = chunks(); commit(joinDeck(fm, list.map((c) => c.replace(re, () => rep)))); findAll(); return ctx.toast(tr('slides.replaced-n-matches', { n: n })); }
    if (b.dataset.fb === 'one') { findAll(); if (!hits.length) return; const h = hits[Math.max(0, hit)] || hits[0]; const { fm, list } = chunks(); const c = list[h.i]; const m = new RegExp(re.source, re.flags.replace('g', '')).exec(c.slice(h.at)); if (!m) return; list[h.i] = c.slice(0, h.at) + rep + c.slice(h.at + m[0].length); commit(joinDeck(fm, list)); hit -= 1; gotoHit(1); }
  });

  /* reuse slides from another deck (copies) */
  async function reuseFromDeck() {
    const t = await ctx.pickRef?.({ kind: 'link' }); if (!t) return;
    const { parseRef, resolveTarget } = await import('./refs-syntax.js');
    const { target, part } = parseRef(t.replace(/^!?\[\[|\]\]$/g, '').replace(/\|.*$/, ''));
    const env = ctx.refEnv(); const path = resolveTarget(target, env.files, env.from);
    if (!path || !/\.slides\.md$/i.test(path)) return ctx.toast(tr('slides.choose-a-slide-deck'));
    const src = parseFrontmatter(await env.read(path)); const all = splitSlides(src.body);
    const m = String(part || '').match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    const pick = m ? all.slice(Number(m[1]) - 1, Number(m[2] || m[1])) : all;
    if (!pick.length) return ctx.toast(tr('slides.no-slides-there'));
    const { fm, list } = chunks(); list.splice(cur + 1, 0, ...pick.map((c) => '\n' + c.replace(/^\n+/, '').replace(/[ \t]*<!--\s*master(:[^>]*)?\s*-->[ \t]*\n?/g, '')));
    cur += 1; commit(joinDeck(fm, list)); ctx.toast(tr('slides.inserted-length-slides-from-target-the', { n: pick.length, target }));
  }
  host.querySelector('[data-sl="review"]').addEventListener('click', (e) => ctx.showMenu(e.currentTarget, [
    { label: tr('slides.find-and-replace'), key: 'Ctrl+H', run: openFind },
    { label: tr('slides.comments'), run: () => showReview('comments') },
    { label: tr('slides.add-comment-2'), run: commentPrompt },
    { label: tr('slides.check-accessibility'), run: runA11y }, '-',
    { label: tr('slides.insert-slides-from-another-deck'), run: reuseFromDeck },
    { label: deck.slides[cur].hidden ? tl('slides', 'Show this slide') : tl('slides', 'Hide this slide'), run: () => hideSlides([cur], !deck.slides[cur].hidden) },
  ]));

  /* views: normal, sorter, outline */
  let view = 'normal', sortSel = new Set(), sortAnchor = null;
  const mainEl = host.querySelector('.sl-main');
  const viewEl = document.createElement('div'); viewEl.className = 'sl-view'; viewEl.hidden = true; mainEl.after(viewEl);
  host.querySelector('.sl-views').addEventListener('click', (e) => { const b = e.target.closest('[data-slv]'); if (b) setView(b.dataset.slv); });
  function setView(v) {
    view = v; for (const b of host.querySelectorAll('[data-slv]')) b.setAttribute('aria-checked', String(b.dataset.slv === v));
    mainEl.hidden = v !== 'normal'; viewEl.hidden = v === 'normal'; host.classList.toggle('sl-alt-view', v !== 'normal');
    if (v === 'normal') { render(); requestAnimationFrame(fit); } else renderView();
  }
  function renderView() {
    if (view === 'normal' || !deck) return;
    if (view === 'sorter') {
      const tk = 220 / deck.width;
      viewEl.innerHTML = `<p class="sl-view-hint">${tr('slides.click-to-select-shift-or-ctrl-to-selec')}</p><ol class="sl-sorter" tabindex="0" aria-label="${tr('slides.slide-sorter')}">${deck.slides.map((sl, i) => `${sl.section ? `<li class="sl-sorter-sec">${esc(sl.section)}</li>` : ''}<li class="sl-sort${sortSel.has(i) ? ' is-sel' : ''}${sl.hidden ? ' is-hidden' : ''}${sl.master ? ' is-master' : ''}" data-si="${i}" draggable="true" aria-selected="${sortSel.has(i)}"><div class="sl-thumb-box" style="width:220px;height:${deck.height * tk}px"><div class="sl-scale" style="transform:scale(${tk})">${renderSlide(deck, sl)}</div></div><span>${sl.master ? 'Master' : sl.number}${sl.hidden ? ' · hidden' : ''}${sl.title ? ' · ' + esc(sl.title) : ''}</span></li>`).join('')}</ol>`;
      hydrate(viewEl);
    } else {
      viewEl.innerHTML = `<p class="sl-view-hint">${tr('slides.edit-titles-here-each-line-under-a-tit')}</p><ol class="sl-outline">${deck.slides.map((sl, i) => {
        const bullets = sl.content.split('\n').filter((l) => /^\s*[-*+]\s+\S/.test(l)).map((l) => l.replace(/^\s*[-*+]\s+/, ''));
        return `${sl.section ? `<li class="sl-outline-sec">${esc(sl.section)}</li>` : ''}<li class="sl-outline-item${sl.hidden ? ' is-hidden' : ''}"><span class="sl-outline-n">${sl.master ? 'M' : sl.number}</span><div><input class="sl-outline-title" data-oi="${i}" value="${esc(sl.title)}" placeholder="${tr('slides.untitled-slide')}" aria-label="Title of slide ${sl.number ?? 'master'}">${bullets.length ? `<ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}</div></li>`;
      }).join('')}</ol>`;
    }
  }
  viewEl.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-oi]'); if (!inp) return; const i = Number(inp.dataset.oi); const t = inp.value.trim();
    editAt(i, (c) => /^(\s*)#{1,6}\s+.*$/m.test(c) ? c.replace(/^(\s*#{1,6}\s+).*$/m, `$1${t}`) : c.replace(/^(\n*(?:[ \t]*<!--[\s\S]*?-->[ \t]*\n)*)/, `$1## ${t}\n\n`));
  });
  viewEl.addEventListener('click', (e) => {
    const li = e.target.closest('[data-si]'); if (!li) return; const i = Number(li.dataset.si);
    if (e.shiftKey && sortAnchor != null) { sortSel = new Set(Array.from({ length: Math.abs(i - sortAnchor) + 1 }, (_, k) => Math.min(i, sortAnchor) + k)); }
    else if (e.ctrlKey || e.metaKey) { sortSel.has(i) ? sortSel.delete(i) : sortSel.add(i); sortAnchor = i; }
    else { sortSel = new Set([i]); sortAnchor = i; }
    renderView();
  });
  viewEl.addEventListener('dblclick', (e) => { const li = e.target.closest('[data-si]'); if (li) { cur = Number(li.dataset.si); setView('normal'); } });
  let sortDrag = null;
  viewEl.addEventListener('dragstart', (e) => { const li = e.target.closest('[data-si]'); if (!li) return; const i = Number(li.dataset.si); if (!sortSel.has(i)) sortSel = new Set([i]); sortDrag = [...sortSel].sort((a, b) => a - b); e.dataTransfer.effectAllowed = 'move'; });
  viewEl.addEventListener('dragover', (e) => { if (sortDrag) { e.preventDefault(); viewEl.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop')); e.target.closest('[data-si]')?.classList.add('drop'); } });
  viewEl.addEventListener('drop', (e) => { e.preventDefault(); const t = e.target.closest('[data-si]'); if (t && sortDrag) moveBlock(sortDrag, Number(t.dataset.si)); sortDrag = null; });
  viewEl.addEventListener('dragend', () => { sortDrag = null; });
  /** move several slides so they sit before slide `to` (or at the end when `to` is after them) */
  function moveBlock(idx, to) {
    if (idx.includes(to)) return;
    const { fm, list } = chunks(); const moving = idx.map((i) => list[i]); const rest = list.filter((_, i) => !idx.includes(i));
    let at = rest.indexOf(list[to]); if (to > idx[idx.length - 1]) at += 1;
    rest.splice(at, 0, ...moving); sortSel = new Set(moving.map((_, k) => at + k)); commit(joinDeck(fm, rest));
  }
  viewEl.addEventListener('keydown', (e) => {
    if (view !== 'sorter' || !sortSel.size || e.target.closest('input')) return;
    const idx = [...sortSel].sort((a, b) => a - b);
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); const { fm, list } = chunks(); if (idx.length >= list.length) return ctx.toast(tr('slides.a-deck-needs-at-least-one-slide')); sortSel = new Set(); commit(joinDeck(fm, list.filter((_, i) => !idx.includes(i)))); }
    else if (e.key.toLowerCase() === 'h') { e.preventDefault(); hideSlides(idx, !deck.slides[idx[0]].hidden); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); const { fm, list } = chunks(); const at = idx[idx.length - 1] + 1; list.splice(at, 0, ...idx.map((i) => list[i])); sortSel = new Set(idx.map((_, k) => at + k)); commit(joinDeck(fm, list)); }
    else if (e.key === 'Enter') { cur = idx[0]; setView('normal'); }
  });

  /* design pane (P7): theme, template, colours, fonts, background, masters */
  const dpane = host.querySelector('.sl-design');
  host.querySelector('[data-sl-design]').addEventListener('change', (e) => { dpane.hidden = !e.target.checked; dockRoom(); renderDesign(); });
  const FONT_CHOICES = ['Inter', 'Helvetica Neue', 'Arial', 'Georgia', 'Times New Roman', 'Palatino', 'Garamond', 'Verdana', 'Trebuchet MS', 'Futura', 'Avenir Next', 'Gill Sans', 'Courier New'];
  function setFm(key, value) { const { fm, list } = chunks(); commit(joinDeck(setGlobal(fm, key, value), list)); }
  function renderDesign() {
    if (dpane.hidden || !deck) return;
    const g = deck.global; const s0 = deck.slides[cur]; const d = s0.directives;
    const fileFonts = String(g.fonts || '').split(',').map((x) => x.trim()).filter(Boolean);
    const fams = [...new Set([...fileFonts.map((f) => f.split('/').pop().split(/[-_.]/)[0]), ...FONT_CHOICES])];
    const fontSel = (k) => `<select class="rb-select fp-sel" data-dk="${k}"><option value="">${tr('slides.theme-default')}</option>${fams.map((f) => `<option${g[k] === f ? ' selected' : ''}>${esc(f)}</option>`).join('')}${g[k] && !fams.includes(g[k]) ? `<option selected>${esc(g[k])}</option>` : ''}</select>`;
    const colour = (k, label, d0) => `<label class="fp-row"><span>${label}</span><span class="dp-col"><input class="sf-color" type="color" data-dk="${k}" value="${hex(g[k], d0)}">${g[k] ? `<button class="dp-x" type="button" data-dreset="${k}" aria-label="Reset ${label}">${tr('slides.reset')}</button>` : ''}</span></label>`;
    const bgc = d._backgroundColor ?? d.backgroundColor, bgi = d._backgroundImage ?? d.backgroundImage;
    const gm = String(bgi || '').match(/^linear-gradient\((-?\d+)deg,\s*([^,]+),\s*([^)]+)\)$/);
    const bt = gm ? 'gradient' : s0.bgs.some((b) => !b.side) ? 'image' : bgc ? 'colour' : '';
    const ms = deck.masters;
    dpane.innerHTML = `<div class="fp-head">${tr('slides.design')}div>
      <section class="fp-sec"><h3>${tr('slides.theme')}h3>
        ${fRow(tl('slides', 'Theme'), `<select class="rb-select fp-sel" data-dk="theme">${THEMES.map(([v, l]) => `<option value="${v}"${deck.theme === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
        <div class="fp-row"><span>${tr('slides.template')}span><span class="dp-tpl">${g.template ? `<b>${esc(g.template)}</b>` : 'None'}</span></div>
        <div class="fp-btns"><button class="btn btn-primary" type="button" data-da="gallery">Browse templates…</button>${g.template ? '<button class="btn" type="button" data-da="untemplate">Remove</button>' : ''}<button class="btn" type="button" data-da="template">Use a deck…</button><button class="btn" type="button" data-da="save-template">Save as template…</button></div>
        <p class="fp-note">A template gives this deck its colours, fonts, backgrounds and slide layouts. ${g.template ? 'Edit the template file to change every deck that uses it.' : ''}</p></section>
      <section class="fp-sec"><h3>Colour schemes</h3><div class="dp-schemes">${[...(tplText ? templateInfo(tplText).variants : []), ...SCHEMES.map(([name, tokens]) => ({ name, tokens }))].map((v, n) => `<button type="button" class="dp-scheme" data-scheme="${n}" title="${esc(v.name)}" aria-label="Colour scheme ${esc(v.name)}"><i style="background:${v.tokens.paper}"></i><i style="background:${v.tokens.ink}"></i><i style="background:${v.tokens.accent}"></i><span>${esc(v.name)}</span></button>`).join('')}</div></section>
      <section class="fp-sec"><h3>Font pairs</h3><div class="dp-fonts">${FONT_PAIRS.map(([h, b], n) => `<button type="button" class="dp-font" data-fpair="${n}"><b style="font-family:'${h}'">${esc(h)}</b><span style="font-family:'${b}'">${h === b ? 'Body too' : esc(b)}</span></button>`).join('')}</div></section>
      <section class="fp-sec"><h3>${tr('slides.colours')}h3>${colour('paper', 'Background', '#fcfcfc')}${colour('ink', tl('slides', 'Text'), '#1f1f1f')}${colour('muted', tl('slides', 'Secondary text'), '#666666')}${colour('accent', tl('slides', 'Accent and links'), '#1f1f1f')}${colour('card', 'Cards', '#f2f2f2')}</section>
      <section class="fp-sec"><h3>${tr('slides.fonts')}h3>${fRow(tl('slides', 'Headings'), fontSel('heading-font'))}${fRow(tl('slides', 'Body'), fontSel('body-font'))}
        ${fileFonts.length ? `<p class="fp-note">Font files: ${fileFonts.map((f) => esc(f.split('/').pop())).join(', ')}</p>` : ''}
        <div class="fp-btns"><button class="btn" type="button" data-da="font">${tr('slides.add-font-file')}</button></div></section>
      <section class="fp-sec"><h3>Background${s0.master ? ' of this master' : ' of this slide'}</h3>
        ${fRow(tl('slides', 'Type'), `<select class="rb-select fp-sel" data-dk="bg-type"><option value="">${tr('slides.theme')}</option><option value="colour"${bt === 'colour' ? ' selected' : ''}>${tr('slides.colour')}</option><option value="gradient"${bt === 'gradient' ? ' selected' : ''}>${tr('slides.gradient')}</option><option value="image"${bt === 'image' ? ' selected' : ''}>${tr('slides.picture')}</option></select>`)}
        ${bt === 'colour' ? fRow(tl('slides', 'Colour'), `<input class="sf-color" type="color" data-dk="bg-1" value="${hex(bgc, '#ffffff')}">`) : ''}
        ${bt === 'gradient' ? `<div class="fp-grid">${fRow(tl('slides', 'From'), `<input class="sf-color" type="color" data-dk="bg-1" value="${hex(gm[2].trim(), '#ffffff')}">`)}${fRow('To', `<input class="sf-color" type="color" data-dk="bg-2" value="${hex(gm[3].trim(), '#dddddd')}">`)}${fRow(tl('slides', 'Angle'), `<input class="input fp-num" type="number" data-dk="bg-angle" value="${gm[1]}" step="15">`)}</div>` : ''}
        ${bt === 'image' ? '<div class="fp-btns"><button class="btn" type="button" data-da="bg-image">' + tr('slides.change-picture') + '</button></div>' : ''}
        <div class="fp-btns">${bt ? '<button class="btn" type="button" data-da="bg-all">' + tr('slides.apply-to-all-slides') + '</button>' : ''}</div></section>
      <section class="fp-sec"><h3>${tr('slides.masters')}</h3>
        ${ms.length ? `<ul class="dp-masters">${ms.map((m) => `<li><span>${m.master === 'all' ? 'All slides' : `${esc(m.master)} slides`}</span>${m.fromTemplate ? '<em>' + tr('slides.from-template') + '</em>' : `<button class="btn" type="button" data-dm="${m.index}">${tr('slides.edit')}</button>`}</li>`).join('')}</ul>` : '<p class="fp-note">' + tr('slides.objects-on-a-master-appear-on-every-sl') + '</p>'}
        <div class="fp-btns"><button class="btn" type="button" data-da="master-all">${tr('slides.add-master-for-all-slides')}</button>${!s0.master && s0.layout !== 'default' ? `<button class="btn" type="button" data-da="master-layout">Add master for ${esc(s0.layout)} slides</button>` : ''}</div></section>`;
  }
  function setBg(type, vals = {}) {
    editChunk2((c) => {
      let t = setDirective(setDirective(c, '_backgroundColor', null), '_backgroundImage', null);
      t = t.replace(/^!\[bg(?![^\]]*\b(left|right)\b)[^\]]*\]\([^)]*\)\s*\n?/gm, '');
      if (type === 'colour') t = setDirective(t, '_backgroundColor', vals.c1 || '#ffffff');
      if (type === 'gradient') t = setDirective(t, '_backgroundImage', `linear-gradient(${vals.angle ?? 135}deg, ${vals.c1 || '#ffffff'}, ${vals.c2 || '#dddddd'})`);
      if (type === 'image' && vals.src) t = `![bg](${vals.src})\n` + t.replace(/^\n+/, '');
      return t;
    });
  }
  dpane.addEventListener('change', async (e) => {
    const el = e.target.closest('[data-dk]'); if (!el) return; const k = el.dataset.dk;
    if (k === 'theme') return setFm('theme', el.value);
    if (['paper', 'ink', 'muted', 'accent', 'card', 'heading-font', 'body-font'].includes(k)) return setFm(k, el.value || null);
    const v = (n) => dpane.querySelector(`[data-dk="${n}"]`)?.value;
    if (k === 'bg-type') {
      if (el.value === 'image') { const src = await ctx.pickImage?.(); if (!src) return renderDesign(); return setBg('image', { src }); }
      return setBg(el.value, { c1: el.value === 'gradient' ? '#ffffff' : '#f2f2f2', c2: '#d9d9d9', angle: 135 });
    }
    const type = dpane.querySelector('[data-dk="bg-type"]').value;
    setBg(type, { c1: v('bg-1'), c2: v('bg-2'), angle: v('bg-angle') });
  });
  dpane.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-dreset]'); if (r) return setFm(r.dataset.dreset, null);
    const sc = e.target.closest('[data-scheme]'); if (sc) {
      const all = [...(tplText ? templateInfo(tplText).variants : []), ...SCHEMES.map(([name, tokens]) => ({ name, tokens }))]; const v = all[Number(sc.dataset.scheme)];
      let { fm, list } = chunks(); for (const [k, val] of Object.entries(v.tokens)) fm = setGlobal(fm, k, val); commit(joinDeck(fm, list)); return ctx.toast(`Colour scheme “${v.name}” applied.`);
    }
    const fp = e.target.closest('[data-fpair]'); if (fp) { const [h, b] = FONT_PAIRS[Number(fp.dataset.fpair)]; let { fm, list } = chunks(); fm = setGlobal(setGlobal(fm, 'heading-font', h), 'body-font', b); return commit(joinDeck(fm, list)); }
    const m = e.target.closest('[data-dm]'); if (m) return select(Number(m.dataset.dm));
    const b = e.target.closest('[data-da]'); if (!b) return;
    const a = b.dataset.da;
    if (a === 'template') {
      const t = await ctx.pickRef?.({ kind: 'link' }); if (!t) return;
      const target = t.replace(/^!?\[\[|\]\]$/g, '').replace(/\|.*$/, '').replace(/#.*$/, '');
      if (!/\.slides$/i.test(target) && !/\.slides\.md$/i.test(target)) return ctx.toast(tr('slides.choose-a-slide-deck-as-the-template'));
      return setFm('template', target);
    }
    if (a === 'untemplate') return setFm('template', null);
    if (a === 'gallery') {
      const t = await ctx.templateGallery?.({ mode: 'apply' }); if (!t || t === 'blank') return;
      await ctx.ensureTemplate(t); commit(applyTemplate(text, t)); tplRef = null; loadTemplate(true); return ctx.toast(`Template “${t.name}” applied. Undo with Ctrl+Z.`);
    }
    if (a === 'save-template') {
      const name = await ctx.prompt({ title: 'Save as template', label: 'Template name', value: deck.global.title || 'My template', action: 'Next' }); if (!name || !name.trim()) return;
      const description = await ctx.prompt({ title: 'Save as template', label: 'One line describing when to use it', value: '', action: 'Save template', allowEmpty: true });
      if (description == null) return;
      const path = await ctx.saveTemplate(name.trim(), templateFromDeck(text, { name: name.trim(), description: description.trim() }, tplText));
      return ctx.toast(`Saved as ${path}. It now appears in the template gallery.`);
    }
    if (a === 'font') { const f = await ctx.pickMedia?.('font'); if (!f) return; const cur0 = String(deck.global.fonts || '').split(',').map((x) => x.trim()).filter(Boolean); return setFm('fonts', [...new Set([...cur0, f])].join(', ')); }
    if (a === 'bg-image') { const src = await ctx.pickImage?.(); if (src) setBg('image', { src }); return; }
    if (a === 'bg-all') {
      const s0 = deck.slides[cur]; const d = s0.directives; const bgc = d._backgroundColor ?? d.backgroundColor, bgi = d._backgroundImage ?? d.backgroundImage;
      const img = s0.bgs.find((x) => !x.side);
      let { fm, list } = chunks();
      fm = setGlobal(setGlobal(fm, 'backgroundColor', bgc || null), 'backgroundImage', bgi || (img ? `url(${img.src})` : null));
      list = list.map((c) => setDirective(setDirective(c, '_backgroundColor', null), '_backgroundImage', null).replace(/^!\[bg(?![^\]]*\b(left|right)\b)[^\]]*\]\([^)]*\)\s*\n?/gm, ''));
      commit(joinDeck(fm, list)); return ctx.toast(tr('slides.background-applied-to-all-slides'));
    }
    if (a === 'master-all' || a === 'master-layout') {
      const which = a === 'master-all' ? '' : `: ${deck.slides[cur].layout}`;
      const { fm, list } = chunks(); list.unshift(`\n<!-- master${which} -->\n## Master${which ? ' for ' + which.slice(2) + ' slides' : ''}\n\nObjects placed here appear on every ${which ? which.slice(2) : ''} slide. Text in the flow is a note for you.\n\n::: box #footer x=88 y=650 w=500 h=40 size=18 color=#666666\nYour company\n:::\n`);
      cur = 0; commit(joinDeck(fm, list)); return ctx.toast(tr('slides.master-added-place-a-logo-or-footer-on'));
    }
  });

  /* format pane (P6) */
  const fpane = host.querySelector('.sl-format');
  host.querySelector('[data-sl-format]').addEventListener('change', (e) => { fpane.hidden = !e.target.checked; dockRoom(); renderFormat(); });
  function dockRoom() { const open = !fpane.hidden || !dpane.hidden || !rpane.hidden || !ipane.hidden || !apane.hidden || !host.querySelector('.sl-layers').hidden; host.classList.toggle('sl-docked', open); requestAnimationFrame(fit); }
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
    if (!picked.length) { fpane.innerHTML = '<div class="fp-head">' + tr('slides.format') + '</div><p class="fp-empty">' + tr('slides.select-an-object-on-the-slide-to-forma') + '</p>'; return; }
    const o = picked[0], a = o.attrs, g = geometry(o), kinds = new Set(picked.map((x) => x.kind));
    const only = (k) => kinds.size === 1 && kinds.has(k);
    const fill = parseFill(a.fill) || { kind: 'none' };
    const ft = fill.kind === 'solid' ? (fill.color === 'none' ? 'none' : 'solid') : fill.kind;
    const adj = adjOf(a); const crop = (a.crop || '0,0,1,1').split(',').map(Number);
    let h = `<div class="fp-head">${tr('slides.format')} <span class="fp-sub">${picked.length > 1 ? `${picked.length} objects` : esc(o.id || o.kind)}</span></div>`;
    if (picked.length === 1 && o.kind !== 'line') h += `<section class="fp-sec"><h3>${tr('slides.position-and-size')}</h3><div class="fp-grid">${fRow('X', num('x', g.x))}${fRow('Y', num('y', g.y))}${fRow(tl('slides', 'Width'), num('w', g.w, 1, 1))}${fRow(tl('slides', 'Height'), num('h', g.h, 1, 1))}${fRow(tl('slides', 'Rotate'), num('rotate', g.rotate || 0, 1, -360, 360))}</div></section>`;
    if ([...kinds].some((k) => k === 'box' || k === 'shape' || k === 'path')) {
      h += `<section class="fp-sec"><h3>${tr('slides.fill')}</h3>${fRow(tl('slides', 'Type'), sel('fill-type', ft, [['none', tl('slides', 'None')], ['solid', tl('slides', 'Solid')], ['linear', tl('slides', 'Linear gradient')], ['radial', tl('slides', 'Radial gradient')]]))}`;
      if (ft === 'solid') h += fRow(tl('slides', 'Colour'), col('fill-1', fill.color, '#f2f2f2'));
      if (ft === 'linear' || ft === 'radial') h += `<div class="fp-grid">${fRow(tl('slides', 'From'), col('fill-1', fill.stops[0], '#111111'))}${fRow('To', col('fill-2', fill.stops.at(-1), '#888888'))}${ft === 'linear' ? fRow(tl('slides', 'Angle'), num('fill-angle', fill.angle, 15, -360, 360)) : ''}</div>`;
      h += '</section>';
    }
    if ([...kinds].some((k) => ['box', 'shape', 'image', 'line', 'path'].includes(k))) {
      h += `<section class="fp-sec"><h3>${only('line') ? 'Line' : 'Border'}</h3><div class="fp-grid">${fRow(tl('slides', 'Colour'), col('stroke', a.stroke, '#1a1a1a'))}${fRow(tl('slides', 'Width'), num(only('line') ? 'width' : 'border', a[only('line') ? 'width' : 'border'] ?? '', 0.5, 0, 40))}</div>${fRow(tl('slides', 'Dashed'), `<input type="checkbox" data-fk="dash"${a.dash === 'true' ? ' checked' : ''}>`)}`;
      if (only('line')) h += `<div class="fp-grid">${fRow(tl('slides', 'Start'), sel('tail', a.tail || '', [['', tl('slides', 'None')], ['arrow', tl('slides', 'Arrow')]]))}${fRow('End', sel('head', a.head || '', [['', tl('slides', 'None')], ['arrow', tl('slides', 'Arrow')]]))}</div>${fRow(tl('slides', 'Route'), sel('route', a.route || '', [['', tl('slides', 'Straight')], ['elbow', tl('slides', 'Elbow')]]))}`;
      if (kinds.has('box') || kinds.has('image')) h += fRow(tl('slides', 'Corners'), num('radius', a.radius ?? '', 1, 0, 400));
      h += '</section>';
    }
    h += `<section class="fp-sec"><h3>${tr('slides.effects')}</h3>${fRow(tl('slides', 'Shadow'), sel('shadow', a.shadow || '', [['', tl('slides', 'None')], ...Object.keys(SHADOWS).map((k) => [k, k[0].toUpperCase() + k.slice(1)])]))}${fRow(tl('slides', 'Opacity'), range('opacity', g.opacity ?? 1, 0, 1, 0.05))}`;
    if ([...kinds].some((k) => ['image', 'icon', 'shape', 'path'].includes(k))) h += `<div class="fp-btns"><button class="btn" type="button" data-fa="flip-h">${tr('slides.flip-horizontal')}</button><button class="btn" type="button" data-fa="flip-v">${tr('slides.flip-vertical')}</button></div>`;
    h += '</section>';
    if (only('image')) {
      h += `<section class="fp-sec"><h3>${tr('slides.picture')}</h3>${fRow(tl('slides', 'Crop to shape'), sel('mask', a.mask || '', [['', tl('slides', 'None')], ...Object.keys(MASKS).map((k) => [k, k[0].toUpperCase() + k.slice(1)])]))}
        <div class="fp-grid">${fRow(tl('slides', 'Crop left %'), num('crop-l', Math.round(crop[0] * 100), 1, 0, 95))}${fRow(tl('slides', 'Crop top %'), num('crop-t', Math.round(crop[1] * 100), 1, 0, 95))}${fRow(tl('slides', 'Crop right %'), num('crop-r', Math.round((1 - crop[0] - crop[2]) * 100), 1, 0, 95))}${fRow(tl('slides', 'Crop bottom %'), num('crop-b', Math.round((1 - crop[1] - crop[3]) * 100), 1, 0, 95))}</div>
        ${fRow(tl('slides', 'Brightness'), range('adj-brightness', adj.brightness ?? 1, 0, 2, 0.05))}${fRow(tl('slides', 'Contrast'), range('adj-contrast', adj.contrast ?? 1, 0, 2, 0.05))}${fRow(tl('slides', 'Saturation'), range('adj-saturate', adj.saturate ?? 1, 0, 2, 0.05))}${fRow(tl('slides', 'Greyscale'), range('adj-grayscale', adj.grayscale ?? 0, 0, 1, 0.05))}${fRow(tl('slides', 'Blur'), range('adj-blur', adj.blur ?? 0, 0, 20, 0.5))}
        ${fRow(tl('slides', 'Fit'), sel('fit', a.fit || '', [['', tl('slides', 'Fill the frame')], ['contain', tl('slides', 'Show all')]]))}
        <label class="fp-row fp-wide"><span>${tr('slides.alt-text')}</span><input class="input" type="text" data-fk="alt" value="${esc(a.alt ?? o.alt ?? '')}" placeholder="${tr('slides.describe-the-picture-for-screen-reader')}"></label>
        <div class="fp-btns"><button class="btn" type="button" data-fa="replace">${tr('slides.replace')}</button><button class="btn" type="button" data-fa="natural">${tr('slides.reset-size')}</button><button class="btn" type="button" data-fa="reset-adjust">${tr('slides.reset-adjustments')}</button></div></section>`;
    }
    if (only('path') && a.points) h += `<section class="fp-sec"><h3>${tr('slides.free-shape')}h3>${fRow(tl('slides', 'Closed'), `<input type="checkbox" data-fk="closed"${a.closed === 'true' ? ' checked' : ''}>`)}${fRow(tl('slides', 'Smooth'), `<input type="checkbox" data-fk="smooth"${a.smooth === 'true' ? ' checked' : ''}>`)}<p class="fp-note">Drag the square handles to move points. Double-click one to remove it.</p></section>`;
    if (only('icon')) h += `<section class="fp-sec"><h3>${tr('slides.icon-2')}h3>${fRow(tl('slides', 'Colour'), col('color', a.color, '#1a1a1a'))}${fRow(tl('slides', 'Line weight'), range('weight', a.weight || 2, 0.5, 4, 0.25))}<div class="fp-btns"><button class="btn" type="button" data-fa="icon">Change icon…</button></div></section>`;
    if (only('smartart')) h += `<section class="fp-sec"><h3>Diagram</h3>${fRow(tl('slides', 'Type'), sel('type', a.type || 'process', SMART_TYPES))}${fRow(tl('slides', 'Colour'), col('fill', a.fill, '#1f1f1f'))}<p class="fp-note">Double-click the diagram to edit its list. Indent an item to make a sub-item.</p><div class="fp-btns"><button class="btn" type="button" data-fa="explode">Convert to shapes</button><button class="btn" type="button" data-fa="sm-box">Convert to text box</button></div></section>`;
    if (only('box') && /^\s*[-*+]\s/m.test(o.body || '')) h += `<section class="fp-sec"><h3>List</h3><div class="fp-btns"><button class="btn" type="button" data-fa="to-smartart">Convert to diagram…</button></div></section>`;
    { // link: where a click goes when presenting
      const L = String(a.link || ''); const kind = !L ? '' : ['next', 'prev', 'first', 'last', 'end', 'back'].includes(L) ? L : /^slide:/.test(L) ? 'slide' : /^\[\[/.test(L) ? 'doc' : 'url';
      const val = kind === 'slide' ? L.slice(6) : kind === 'doc' ? L.replace(/^\[\[|\]\]$/g, '') : kind === 'url' ? L : '';
      h += `<section class="fp-sec"><h3>${tr('slides.link')}h3>${fRow('Goes to', sel('link-kind', kind, [['', 'Nothing'], ['next', 'Next slide'], ['prev', 'Previous slide'], ['first', 'First slide'], ['last', 'Last slide'], ['slide', 'Slide number…'], ['back', 'Last slide viewed'], ['end', 'End of show'], ['url', 'Web address…'], ['doc', 'Folio document…']]))}${['slide', 'url', 'doc'].includes(kind) ? fRow(kind === 'slide' ? 'Slide' : kind === 'url' ? 'Address' : 'Document', `<input class="input" data-fk="link-value" value="${esc(val)}" placeholder="${kind === 'slide' ? '3' : kind === 'url' ? 'https://…' : 'Budget or Budget#Totals'}">`) : ''}<p class="fp-note">Links work when presenting and in PowerPoint.</p></section>`;
    }
    if (only('zoom')) {
      const list = deck.slides.filter((x) => !x.master); const secs = [...new Set(list.map((x) => x.section).filter(Boolean))];
      h += `<section class="fp-sec"><h3>Zoom</h3>${fRow('Shows', sel('zoom-to', a.section ? 'section:' + a.section : 'slide:' + (a.slide || ''), [...list.map((x) => ['slide:' + x.number, `Slide ${x.number}${x.title ? ' · ' + x.title.slice(0, 30) : ''}`]), ...secs.map((n) => ['section:' + n, `Section ${n}`])]))}${fRow('Return here', `<input type="checkbox" data-fk="return"${a.return === 'false' ? '' : ' checked'}>`)}<p class="fp-note">When presenting, a click on the zoom opens the slide or section, then comes back.</p></section>`;
    }
    if (only('media')) h += `<section class="fp-sec"><h3>${tr('slides.playback')}h3>${fRow(tl('slides', 'Loop'), `<input type="checkbox" data-fk="loop"${a.loop === 'true' ? ' checked' : ''}>`)}${fRow(tl('slides', 'Muted'), `<input type="checkbox" data-fk="muted"${a.muted === 'true' ? ' checked' : ''}>`)}${fRow(tl('slides', 'Start when the slide shows'), `<input type="checkbox" data-fk="autoplay"${a.autoplay === 'true' ? ' checked' : ''}>`)}</section>`;
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
    if (k === 'link-kind' || k === 'link-value') {
      const kind = fpane.querySelector('[data-fk="link-kind"]').value; const val = (fpane.querySelector('[data-fk="link-value"]')?.value || '').trim();
      const link = !kind ? null : kind === 'slide' ? (val ? `slide:${parseInt(val, 10) || 1}` : 'slide:1') : kind === 'url' ? (val || 'https://') : kind === 'doc' ? `[[${val || 'Document'}]]` : kind;
      return each(() => ({ link }));
    }
    if (k === 'zoom-to') { const [t, ...rest] = v.split(':'); const x = rest.join(':'); return each((o) => (o.kind === 'zoom' ? (t === 'section' ? { section: x, slide: null } : { slide: x, section: null }) : null)); }
    if (k === 'return') return each((o) => (o.kind === 'zoom' ? { return: el.checked ? null : 'false' } : null));
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
    if (act === 'to-smartart') smartGallery((type) => editChunk2((c) => convertKind(c, i, 'smartart', { type, fill: null, radius: null, align: null, valign: null })));
    if (act === 'sm-box') editChunk2((c) => convertKind(c, i, 'box', { type: null }));
    if (act === 'explode') explodeSmart(i);
  });

  /* merge shapes, freeform drawing, edit points (P6) */
  async function mergeSel(op) {
    const { merge } = await import('./slides-merge.js');
    const objs = objsNow(); const picked = [...selected].sort((a, b) => a - b); const list0 = picked.map((i) => objs[i]);
    let res; try { res = merge(list0, op); } catch (e) { return ctx.toast(tr('slides.could-not-merge-these-shapes-message', { message: e.message }), { kind: 'error' }); }
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
    ctx.toast(tr('slides.merged-into-one-shape-undo-with-ctrl-z'));
  }
  let drawing = null;
  function startDraw() {
    if (drawing) return;
    ctx.toast(tr('slides.draw-on-the-slide-with-the-mouse-relea'));
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
      const h = document.createElement('div'); h.className = 'sl-vtx'; h.title = tl('slides', 'Drag to move, double-click to remove');
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

  /* SmartArt (P9) */
  function convertKind(c, i, kind, patch) {
    const o = scanObjects(c)[i]; if (!o) return c;
    const lines = c.split('\n'); lines[o.open] = lines[o.open].replace(/^(\s*:::\s*)\w+/, `$1${kind}`);
    return setObjectAttrs(lines.join('\n'), i, patch);
  }
  function smartGallery(onPick) {
    const sample = '- One\n- Two\n  - detail\n- Three\n- Four';
    gallery.innerHTML = `<div class="slg-head">Diagrams</div><div class="slg-grid slg-sm">${SMART_TYPES.map(([t, l]) => `<button type="button" class="slg-item slg-sm-item" data-sm="${t}" aria-label="${l}"><span class="slide slg-sm-prev" style="--sm-c:var(--color-ink);width:240px;height:150px">${smartArt(t, sample, 240, 150, { size: 12 })}</span><span class="slg-sm-l">${l}</span></button>`).join('')}</div>`;
    gallery.hidden = false; gallery.querySelector('button')?.focus();
    gallery.onclick = (e) => { const b = e.target.closest('[data-sm]'); if (!b) return; closeGallery(); onPick(b.dataset.sm); };
  }
  function insertSmart() {
    smartGallery((type) => placeBlock(({ id }) => `::: smartart #${id('diagram')} type=${type} x=88 y=${deck.slides[cur].title ? 200 : 110} w=${deck.width - 176} h=${type === 'chevron' ? 160 : deck.height - 300}\n- First\n- Second\n- Third\n:::`, deck.width - 176, deck.height - 300));
  }
  /** replace a diagram by the shapes, lines and text boxes it is drawn with */
  function explodeSmart(i) {
    const node = frame.querySelector(`.sl-obj[data-obj="${i}"]`); const o = objsNow()[i]; if (!node || !o) return;
    const g = geometry(o); const blocks = []; let n = 0; const id = () => `${o.id || 'diagram'}-${++n}`;
    const colour = (el) => { const c = getComputedStyle(el).fill; const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return '#e8e8e8'; const [r, gg, b] = m[1].split(',').map((v) => parseFloat(v)); return '#' + [r, gg, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''); };
    for (const el of node.querySelectorAll('.sm-svg > *')) {
      const t = el.tagName.toLowerCase(); const N = (k) => parseFloat(el.getAttribute(k)) || 0;
      if (t === 'rect') blocks.push(`::: shape #${id()} type=${N('rx') ? 'rounded' : 'rect'} x=${Math.round(g.x + N('x'))} y=${Math.round(g.y + N('y'))} w=${Math.round(N('width'))} h=${Math.round(N('height'))} fill=${colour(el)} border=0\n\n\n:::`);
      else if (t === 'circle') { const r = N('r'); blocks.push(`::: shape #${id()} type=ellipse x=${Math.round(g.x + N('cx') - r)} y=${Math.round(g.y + N('cy') - r)} w=${Math.round(r * 2)} h=${Math.round(r * 2)} fill=${colour(el)} border=0\n\n\n:::`); }
      else if (t === 'polygon' && !el.classList.contains('sm-head')) { const pts = el.getAttribute('points').trim().split(/\s+/).map((p) => p.split(',').map(Number)).map(([x, y]) => [g.x + x, g.y + y]); blocks.push(pathBlock(id(), pts, ` closed=true fill=${colour(el)} border=0`)); }
      else if (t === 'line') { const x1 = g.x + N('x1'), y1 = g.y + N('y1'), x2 = g.x + N('x2'), y2 = g.y + N('y2'); const head = el.nextElementSibling?.classList.contains('sm-head') ? ' head=arrow' : ''; blocks.push(`::: line #${id()} x=${Math.round(x1)} y=${Math.round(y1)} w=${Math.round(x2 - x1)} h=${Math.round(y2 - y1)}${head} :::`); }
    }
    for (const lb of node.querySelectorAll('.sm-label')) {
      const st = lb.style; const html = lb.firstElementChild;
      const md = [...html.childNodes].map((c) => (c.nodeName === 'UL' ? '\n' + [...c.children].map((li) => `- ${li.textContent}`).join('\n') : c.nodeName === 'B' ? `**${c.textContent}**` : c.nodeName === 'BR' ? '\n' : c.textContent)).join('').trim();
      blocks.push(`::: box #${id()} x=${Math.round(g.x + parseFloat(st.left))} y=${Math.round(g.y + parseFloat(st.top))} w=${Math.round(parseFloat(st.width))} h=${Math.round(parseFloat(st.height))} align=${st.textAlign || 'center'} valign=middle${st.fontSize ? ` size=${parseFloat(st.fontSize)}` : ''}${/var\(--sl-bg\)/.test(st.color) ? ' color=#ffffff' : ''}\n${md}\n:::`);
    }
    const grp = nextGroup(objsNow());
    editChunk2((c) => { let t = removeObject(c, i); const start = scanObjects(t).length; for (const b of blocks) t = addObject(t, b); const all = scanObjects(t); selected = all.map((_, k) => k).filter((k) => k >= start); return setMany(t, selected.map((k) => [k, { group: grp }])); });
    ctx.toast(`Converted into ${blocks.length} shapes, grouped. Ungroup them in Arrange.`);
  }

  /* Design ideas (P9) */
  const ipane = host.querySelector('.sl-ideas');
  host.querySelector('[data-sl-ideas]').addEventListener('change', (e) => { ipane.hidden = !e.target.checked; dockRoom(); renderIdeas(); });
  let ideas = [], ideasKey = '';
  function renderIdeas() {
    if (ipane.hidden || !deck) return;
    const chunk = chunks().list[cur]; const key = `${cur}\u0000${chunk}\u0000${deck.theme}\u0000${deck.width}`;
    if (key === ideasKey) return; ideasKey = key;
    ideas = deck.slides[cur].master ? [] : designIdeas(chunk, { width: deck.width, height: deck.height });
    const fmRaw = chunks().fm; const w = 220, k = w / deck.width;
    ipane.innerHTML = `<div class="fp-head">Design ideas</div>` + (ideas.length ? `<p class="fp-note">Other ways to lay out this slide. Your text stays the same.</p><div class="ideas">${ideas.map((idea, n) => {
      const d2 = parseDeck(joinDeck(fmRaw, [idea.chunk]), { template: tplText }); const sl = d2.slides[0];
      return `<button type="button" class="idea" data-idea="${n}" aria-label="Apply ${esc(idea.label)}"><span class="idea-box" style="width:${w}px;height:${deck.height * k}px"><span class="sl-scale" style="transform:scale(${k})">${renderSlide(d2, sl, { number: false })}</span></span><span class="idea-l">${esc(idea.label)}</span></button>`;
    }).join('')}</div>` : `<p class="fp-note">${deck.slides[cur].objects.length ? 'This slide is laid out by hand with placed objects, so there are no ideas for it.' : 'Add a title and a few bullets, a picture or a quote, and ideas appear here.'}</p>`);
    hydrate(ipane);
  }
  ipane.addEventListener('click', (e) => { const b = e.target.closest('[data-idea]'); if (!b) return; const idea = ideas[Number(b.dataset.idea)]; selected = []; editChunk2(() => idea.chunk); ctx.toast(`Applied “${idea.label}”. Undo with Ctrl+Z.`); });

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
    gallery.innerHTML = `<div class="slg-head">${tr('slides.shapes')}</div>` + groups.map(([g, items]) => `<div class="slg-group">${esc(g)}</div><div class="slg-grid">${items.map(([sh, label]) => `<button type="button" class="slg-item" data-shape="${sh}" title="${esc(label)}" aria-label="${esc(label)}"><svg viewBox="-4 -4 ${defaultSize(sh)[0] + 8} ${defaultSize(sh)[1] + 8}">${shapeSvg({ shape: sh, w: defaultSize(sh)[0], h: defaultSize(sh)[1], style: {} }, 'slg-shape')}</svg></button>`).join('')}</div>`).join('');
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
    gallery.innerHTML = `<div class="slg-head">${tr('slides.icons')} <span class="slg-sub">${tr('slides.lucide')}</span></div><input class="input slg-search" type="search" placeholder="${tr('slides.search-icons-e-g-rocket-chart-user')}" aria-label="${tr('slides.search-icons')}"><div class="slg-grid slg-icons" role="listbox" aria-label="${tr('slides.icons')}"></div>`;
    gallery.hidden = false;
    const grid = gallery.querySelector('.slg-icons'), q = gallery.querySelector('.slg-search');
    let seq = 0;
    const show = async () => {
      const n = ++seq; const names = await searchIcons(q.value, 96);
      const svgs = await Promise.all(names.map((nm) => iconSvg(nm, 2)));
      if (n !== seq) return;
      grid.innerHTML = names.length ? names.map((nm, i) => `<button type="button" class="slg-item" data-icon="${nm}" title="${nm}" aria-label="${nm}">${svgs[i]}</button>`).join('') : '<p class="slg-empty">' + tr('slides.no-icon-matches') + '</p>';
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
    if (!path || docKind(path) !== 'sheet') return ctx.toast(tr('slides.choose-a-sheet-and-a-range-for-example'));
    const bang = part.lastIndexOf('!'); const sheet = bang >= 0 ? part.slice(0, bang).replace(/^'|'$/g, '') : ''; const range = bang >= 0 ? part.slice(bang + 1) : part;
    if (!/:/.test(range)) return ctx.toast(tr('slides.a-chart-needs-a-range-of-cells-for-exa'));
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
      { label: tr('slides.text-box'), run: () => addObjectBlock('box') },
      { label: tr('slides.shape'), run: shapeGallery },
      { label: tr('slides.icon'), run: () => iconGallery() },
      { label: 'Diagram (SmartArt)…', run: insertSmart }, '-',
      { label: tr('slides.freeform-draw'), run: startDraw },
      { label: tr('slides.line'), run: () => line('', 320, 0) },
      { label: tr('slides.arrow'), run: () => line(' head=arrow', 320, 0) },
      { label: tr('slides.connector-between-two-objects'), run: connectSelected, disabled: selected.length !== 2 }, '-',
      { label: tr('slides.image'), run: insertImage },
      { label: tr('slides.video-or-audio'), run: insertMedia },
      { label: tr('slides.table'), run: () => box('| Item | Value |\n| --- | --- |\n| One | 1 |\n| Two | 2 |', 560, 220) },
      { label: tr('slides.chart-from-a-sheet'), run: insertChart },
      { label: tr('slides.equation'), run: () => box('$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$', 480, 160, ' align=center valign=middle') },
      { label: tr('slides.code'), run: () => box('```js\nconst answer = 42;\n```', 520, 200) }, '-',
      { label: 'Zoom to a slide', run: () => { const list = deck.slides.filter((x) => !x.master); const me = deck.slides[cur]; const t = list.find((x) => x.number > (me?.number || 0)) || list[0]; placeBlock(({ x, y, id }) => `::: zoom #${id('zoom')} x=${x} y=${y} w=384 h=216 slide=${t?.number || 1} :::`, 384, 216); } },
      { label: 'Summary zoom (one per section)', run: summaryZoom, disabled: !deck.slides.some((x) => x.section) }, '-',
      { label: tr('slides.live-value-from-another-document'), run: () => insertRefBox('value') },
      { label: tr('slides.embed-from-another-document'), run: () => insertRefBox('embed') },
    ]);
  }
  /** a new slide with a zoom to each section, laid out in a grid */
  function summaryZoom() {
    const secs = [...new Set(deck.slides.filter((x) => !x.master && x.section).map((x) => x.section))]; if (!secs.length) return;
    const cols = secs.length <= 2 ? secs.length : secs.length <= 4 ? 2 : 3; const rows = Math.ceil(secs.length / cols);
    const gap = 32, top = 170, W = deck.width, H = deck.height;
    const w = Math.min((W - 160 - gap * (cols - 1)) / cols, ((H - top - 60 - gap * (rows - 1)) / rows) * (W / H)); const h = w * (H / W);
    const x0 = (W - (cols * w + gap * (cols - 1))) / 2;
    const zooms = secs.map((n, k) => `::: zoom #zoom-${k + 1} x=${Math.round(x0 + (k % cols) * (w + gap))} y=${Math.round(top + Math.floor(k / cols) * (h + gap))} w=${Math.round(w)} h=${Math.round(h)} section=${/[\s"]/.test(n) ? `"${n.replace(/"/g, "'")}"` : n} :::`);
    const { fm, list } = chunks(); list.splice(cur + 1, 0, `\n# Summary\n\n${zooms.join('\n\n')}\n`); cur += 1; commit(joinDeck(fm, list));
  }
  function connectSelected() {
    const objs = objsNow(); const [a, b] = selected.map((i) => objs[i]);
    if (!a || !b || a.kind === 'line' || b.kind === 'line') return ctx.toast(tr('slides.select-two-objects-not-lines-to-connec'));
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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') { e.preventDefault(); openFind(); return; }
    if ((e.key === 'Enter' || e.key === 'F2') && selected.length === 1) { e.preventDefault(); startEdit(selected[0]); return; }
    const mod = e.ctrlKey || e.metaKey, kk = e.key.toLowerCase();
    if (mod && kk === 'c' && selected.length) { e.preventDefault(); copySel(); }
    else if (mod && kk === 'x' && selected.length) { e.preventDefault(); copySel(); deleteSel(); }
    else if (mod && kk === 'v') { e.preventDefault(); pasteSel(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); restore(e.shiftKey ? redo : undo, e.shiftKey ? undo : redo); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); restore(redo, undo); }
  });
  host.querySelector('[data-sl="box"]').addEventListener('click', () => addObjectBlock('box'));
  host.querySelector('[data-sl="undo"]').addEventListener('click', () => restore(undo, redo));
  host.querySelector('[data-sl="redo"]').addEventListener('click', () => restore(redo, undo));
  syncHistory();
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
      { label: tr('slides.new-slide-after'), run: () => addSlide('default', i + 1) },
      { label: tr('slides.duplicate'), run: () => duplicateSlide(i) }, '-',
      { label: tr('slides.copy-embed-reference'), run: () => ctx.copyRef?.(String(i + 1), 'embed') }, { label: tr('slides.copy-link-to-slide'), run: () => ctx.copyRef?.(String(i + 1), 'link') }, '-',
      { label: tr('slides.move-up'), run: () => moveSlide(i, i - 1) }, { label: tr('slides.move-down'), run: () => moveSlide(i, i + 1) }, '-',
      { label: deck.slides[i].hidden ? tl('slides', 'Show slide') : tl('slides', 'Hide slide'), run: () => hideSlides([i], !deck.slides[i].hidden) },
      { label: deck.slides[i].section ? tl('slides', 'Rename section…') : tl('slides', 'Add section here…'), run: () => sectionAt(i) },
      ...(deck.slides[i].section ? [{ label: tr('slides.remove-section'), run: () => editAt(i, (c) => setDirective(c, 'section', null)) }] : []),
      { label: tr('slides.add-comment-2'), run: () => { select(i); commentPrompt(); } }, '-',
      { label: tr('slides.delete-slide'), danger: true, run: () => deleteSlide(i) },
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
  host.querySelector('[data-sl="add"]').addEventListener('click', (e) => ctx.showMenu(e.currentTarget, [...LAYOUTS.map(([v, l]) => ({ label: l, run: () => addSlide(v) })), '-', { label: tr('slides.synced-copy-of-a-slide'), run: reuseSlide }, '-', ...BLOCKS.map(([id, l, body]) => ({ label: `Building block: ${l}`, run: () => addBlock(body) }))]));
  function addBlock(body) { const { fm, list } = chunks(); list.splice(cur + 1, 0, `\n${body}\n`); cur += 1; selected = []; commit(joinDeck(fm, list)); }
  host.querySelector('[data-sl="present"]').addEventListener('click', () => present(cur));
  host.querySelector('[data-sl="present-menu"]').addEventListener('click', async (e) => {
    const anchor = e.currentTarget; const { customShows } = await import('./slides-present.js'); const shows = Object.keys(customShows(deck));
    ctx.showMenu(anchor, [{ label: 'From this slide', run: () => present(cur) }, { label: 'From the beginning', run: () => present(0) }, '-',
      { label: 'Presenter view', run: () => presenterView({}) }, { label: 'Rehearse timings', run: () => presenterView({ rehearse: true }) },
      ...(shows.length ? ['-', ...shows.map((n) => ({ label: `Custom show: ${n}`, run: () => present(0, n) }))] : [])]);
  });
  /** presenter view: notes, next slide, timer, tools; with rehearse, the time per slide is offered as auto-advance */
  async function presenterView({ rehearse = false } = {}) {
    const order = deck.shown; if (!order.length) return ctx.toast('There are no slides to present, only masters.');
    const { startPresenterView } = await import('./slides-presenter.js');
    const from = rehearse ? 0 : Math.max(0, order.indexOf(deck.slides[cur]));
    const openLink = (L) => { if (/^https?:/.test(L)) window.open(L, '_blank'); };
    show = startPresenterView({ deck, order, start: from, renderSlide, hydrate, openLink, rehearse, toast: ctx.toast,
      qa: ctx.qa ? { start: () => ctx.qa.start(deck.global.title || deck.shown[0]?.title || ''), poll: () => ctx.qa.poll(), stop: () => ctx.qa.stop() } : null,
      record: navigator.mediaDevices?.getUserMedia && ctx.saveAsset ? { start: recordNarration } : null,
      onExit: async (s, { times }) => {
        show = null; select(s?.index ?? cur);
        if (times?.size && await ctx.confirm?.({ title: 'Keep these timings?', body: `Each slide will move on by itself after the time you spent on it (${times.size} slides). You can change or remove them per slide.`, action: 'Keep timings' })) {
          const { fm, list } = chunks();
          for (const [idx, ms] of times) list[idx] = setDirective(list[idx], 'advance', `${Math.max(1, Math.round(ms / 1000))}s`);
          commit(joinDeck(fm, list)); ctx.toast('Timings saved as auto-advance.');
        }
      } });
    window.__folioShow = show.show; window.__folioPresenter = show;
  }
  /** record narration while presenting: one clip per slide, added to the slide as an audio object that plays on its own */
  async function recordNarration(slideNow) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const clips = []; let rec = null, slide = null, chunksA = [];
    const begin = () => { slide = slideNow(); chunksA = []; rec = new MediaRecorder(stream); rec.ondataavailable = (e) => chunksA.push(e.data); rec.start(); };
    const finish = () => new Promise((res) => { if (!rec) return res(); const s = slide; rec.onstop = () => { clips.push({ slide: s, blob: new Blob(chunksA, { type: rec.mimeType || 'audio/webm' }) }); res(); }; rec.stop(); });
    begin();
    const watch = setInterval(async () => { if (slideNow() !== slide) { await finish(); begin(); } }, 300);
    return { stop: async () => {
      clearInterval(watch); await finish(); stream.getTracks().forEach((t) => t.stop());
      const { fm, list } = chunks();
      for (const { slide: s, blob } of clips) {
        if (!s || blob.size < 2000) continue;
        const rel = await ctx.saveAsset(`narration-${s.number}.webm`, new Uint8Array(await blob.arrayBuffer()));
        const W = deck.width, H = deck.height;
        list[s.index] = list[s.index].replace(/\n*::: media #narration[^\n]*:::\n?/g, '\n').replace(/\n+$/, '') + `\n\n::: media #narration x=${W - 88} y=${H - 88} w=56 h=56 src=${/\s/.test(rel) ? `"${rel}"` : rel} autoplay=true :::\n`;
      }
      commit(joinDeck(fm, list)); ctx.toast(`Narration recorded for ${clips.filter((c) => c.blob.size >= 2000).length} slides.`);
    } };
  }
  host.querySelector('[data-sl="export"]').addEventListener('click', (e) => ctx.showMenu(e.currentTarget, [
    { label: tr('slides.powerpoint-pptx'), run: () => exportPptx() },
    { label: tr('slides.pdf'), run: () => exportPdf() },
  ]));

  /* animations */
  const apane = host.querySelector('.sl-anim');
  let animPane = null, animMod = null;
  async function renderAnim() {
    if (!apane.hidden && !animPane) { animMod = await import('./slides-anim-pane.js'); animPane = animMod.createAnimPane(apane, {
      deck: () => deck, cur: () => cur,
      selection: () => selected.map((i) => ({ index: i, id: objsNow()[i]?.id, kind: objsNow()[i]?.kind })),
      edit: (fn) => editChunk2(fn),
      applyAll: (t) => { const { fm, list } = chunks(); commit(joinDeck(setGlobal(fm, 'transition', t), list.map((c) => setDirective(c, 'transition', null)))); ctx.toast('Transition applied to every slide.'); },
      preview: async () => { const sec = frame.querySelector('section.slide'); if (!sec) return; const { previewSlide } = await import('./slides-present.js'); await previewSlide(sec, deck.slides[cur], { W: deck.width, H: deck.height }); render({ keepEditor: true }); },
      close: () => { apane.hidden = true; host.querySelector('[data-sl-anim]').checked = false; dockRoom(); },
    }); }
    animPane?.render();
    if (deck?.slides[cur]?.animations?.length) { animMod ||= await import('./slides-anim-pane.js'); animMod.badges(frame.querySelector('section.slide'), deck.slides[cur]); }
  }
  host.querySelector('[data-sl-anim]').addEventListener('change', (e) => { apane.hidden = !e.target.checked; dockRoom(); renderAnim(); });

  /* presenter */
  let show = null;
  async function present(start = 0, showName = null) {
    const P = await import('./slides-present.js');
    const custom = showName ? P.customShows(deck)[showName] : null;
    const order = custom || deck.shown; if (!order.length) return ctx.toast(tr('slides.there-are-no-slides-to-present-only-ma'));
    const startSlide = deck.slides[start]; const from = custom ? 0 : Math.max(0, order.indexOf(startSlide?.master ? order[0] : startSlide));
    const openLink = (L, api) => {
      const wiki = L.match(/^\[\[(.+)\]\]$/);
      if (wiki) { api.close(); ctx.onWikiLink ? ctx.onWikiLink(wiki[1]) : ctx.toast(`Open ${wiki[1]} from the sidebar.`); return; }
      if (/^https?:/.test(L)) window.open(L, '_blank');
    };
    show = P.startShow({ deck, order, start: from, renderSlide, hydrate, openLink, onExit: (s) => { show = null; select(s.index); } });
    window.__folioShow = show;
  }

  /* exports */
  async function resolvedHtml() {
    return (await resolvedBox(deck.shown.map((s) => renderSlide(deck, s)).join(''))).innerHTML;
  }
  /** slides as a detached element with charts, icons, live values and pictures resolved */
  async function resolvedBox(html) {
    const box = document.createElement('div');
    box.innerHTML = html;
    await hydrateCharts(box, ctx.readNote);
    if (box.querySelector('.sl-icon-svg')) { const { hydrateIcons } = await import('./slides-icons.js'); await hydrateIcons(box); }
    if (ctx.refEnv) { const { hydrateRefs } = await import('./refs.js'); await hydrateRefs(box, ctx.refEnv()); }
    await Promise.all([...box.querySelectorAll('img')].map(async (img) => {
      const src = img.dataset.src || img.getAttribute('src') || '';
      try { img.src = await ctx.dataUrl(src); } catch { img.remove(); }
    }));
    return box;
  }
  async function exportPdf() {
    try {
      const body = await resolvedHtml();
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>${await fontFaces({ inline: true })}@page{size:${deck.width}px ${deck.height}px;margin:0}html,body{margin:0}${slidesCss}.slide{page-break-after:always;break-after:page}</style></head><body>${body}</body></html>`;
      const out = await ctx.exportPdf(html);
      if (out) ctx.toast(tr('slides.slides-exported-to-pdf'));
    } catch (e) { ctx.toast(tr('slides.export-failed-message', { message: e.message }), { kind: 'error' }); }
  }
  /** handouts (1–9 slides per A4 page) or notes pages (a slide with its speaker notes), as PDF */
  async function exportHandouts({ perPage = 3, notes = false } = {}) {
    try {
      const { handoutHtml } = await import('./slides-handouts.js');
      const box = await resolvedBox(deck.shown.map((s) => renderSlide(deck, s)).join(''));
      const slidesHtml = [...box.querySelectorAll(':scope > section.slide')].map((el) => el.outerHTML);
      const html = handoutHtml({ deck, slides: deck.shown, slidesHtml, perPage, notes, css: slidesCss, fonts: await fontFaces({ inline: true }), title: deck.global.title || deck.shown[0]?.title || '' });
      const out = await ctx.exportPdf(html, { suffix: notes ? 'notes' : 'handouts' });
      if (out) ctx.toast(notes ? 'Notes pages exported to PDF.' : 'Handouts exported to PDF.');
    } catch (e) { ctx.toast(`Export failed. ${e.message}`, { kind: 'error' }); }
  }
  async function exportPptx() {
    try {
      const { buildPptx } = await import('./slides-pptx.js');
      const prepare = async (html) => {
        // mounted off-screen at 1:1 so the exporter can measure what the browser laid out
        const host = await resolvedBox(html);
        host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;';
        host.insertAdjacentHTML('afterbegin', `<style>${await fontFaces()}</style>`);
        document.body.appendChild(host);
        await Promise.all([...host.querySelectorAll('img')].map((i) => i.decode().catch(() => {})));
        shrinkFit(host);
        return host;
      };
      const bytes = await buildPptx(deck, { dataUrl: ctx.dataUrl, renderSlide, readNote: ctx.readNote, prepare });
      const out = await ctx.saveBinary('pptx', bytes);
      if (out) ctx.toast(tr('slides.slides-exported-to-powerpoint'));
    } catch (e) { ctx.toast(tr('slides.export-failed-message', { message: e.message }), { kind: 'error' }); }
  }

  return {
    setText(t) {
      const moved = docs.bind(ctx.docKey?.()); const had = seen; seen = true;
      if (moved) lastPush = 0; // the coalescing timer belongs to one document
      if (t === text) { if (moved) syncHistory(); return; }
      // a change that did not come from this canvas (an AI edit, the code pane) is a step of its own, so Undo gives it back
      if (!moved && had && !restoring) { undo.push(text); if (undo.length > 200) undo.shift(); redo.length = 0; lastPush = 0; }
      text = t; deck = parse(t); loadTemplate();
      cur = Math.min(cur, deck.slides.length - 1);
      render(); syncHistory();
    },
    setMode(view) { host.classList.toggle('sl-compact', view === 'split'); requestAnimationFrame(fit); },
    selectAtLine(line) {
      if (!deck) return;
      const fm = parseFrontmatter(text); let l = fm.raw ? fm.raw.split('\n').length : 1; let idx = 0;
      for (const [j, c] of splitSlides(fm.body).entries()) { const n = c.split('\n').length; if (line < l + n) { idx = j; break; } l += n; idx = j; }
      if (idx !== cur) { cur = idx; render(); }
    },
    present: () => present(cur),
    undo() { restore(undo, redo); }, redo() { restore(redo, undo); },
    canUndo: () => undo.length > 0, canRedo: () => redo.length > 0,
    insertText(t) { const { fm, list } = chunks(); list[cur] = addObject(list[cur], t); commit(joinDeck(fm, list)); },
    gotoSlide(i) { if (deck && i >= 0) select(i, { reveal: false }); },
    refresh() { if (deck) { render({ keepEditor: true }); checkSync(); } },
    exportPdf, exportPptx, exportHandouts,
    focus() { thumbs.querySelector('[aria-current="true"]')?.focus(); },
  };
}
