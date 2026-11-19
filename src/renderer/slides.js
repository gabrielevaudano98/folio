// Folio — slides surface: thumbnails, stage, per-slide Markdown, presenter, PDF and PowerPoint export.
import { parseDeck, renderSlide, joinDeck, setDirective, setNotes, setGlobal, splitSlides, parseFrontmatter, LAYOUTS, THEMES, TEMPLATES } from './slides-core.js';
import { createEditor } from './editor.js';
import slidesCss from './slides.css';
import { hydrateCharts } from './markdown.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function mountSlides(host, ctx) {
  const { icons } = ctx;
  host.innerHTML = `
    <div class="sf-toolbar" role="toolbar" aria-label="Slides">
      <button class="btn" type="button" data-sl="add">${icons.plus} New slide</button>
      <div class="sf-sep"></div>
      <label class="sf-field"><span>Layout</span><select class="rb-select" data-sl-layout>${LAYOUTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label class="sf-field"><span>Theme</span><select class="rb-select sf-narrow" data-sl-theme>${THEMES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label class="sf-field"><span>Size</span><select class="rb-select sf-narrow" data-sl-size><option value="16:9">16:9</option><option value="4:3">4:3</option></select></label>
      <label class="sf-check"><input type="checkbox" data-sl-paginate> Slide numbers</label>
      <div class="sf-spacer"></div>
      <button class="btn" type="button" data-sl="export" aria-haspopup="menu">${icons.export} Export</button>
      <button class="btn btn-primary" type="button" data-sl="present">${icons.play} Present</button>
    </div>
    <div class="sl-main">
      <ol class="sl-thumbs" aria-label="Slides"></ol>
      <div class="sl-center">
        <div class="sl-stage"><div class="sl-frame"></div></div>
        <div class="sl-edit">
          <div class="sl-edit-col"><div class="sl-edit-head"><span>Slide ${'<b class="sl-cur">1</b>'} content</span><span class="sl-hint">Markdown. <code>::: left</code> / <code>::: right</code>, <code>::: card</code>, <code>![bg right](img)</code></span></div><div class="sl-cm"></div></div>
          <div class="sl-edit-col sl-notes-col"><label class="sl-edit-head" for="sl-notes-${host.id}">Speaker notes</label><textarea class="sl-notes input" id="sl-notes-${host.id}" placeholder="Only you see these while presenting"></textarea></div>
        </div>
      </div>
    </div>`;

  let text = '', deck = null, cur = 0, silent = false;
  const thumbs = host.querySelector('.sl-thumbs');
  const frame = host.querySelector('.sl-frame');
  const stage = host.querySelector('.sl-stage');
  const notesEl = host.querySelector('.sl-notes');
  const chunkEditor = createEditor(host.querySelector('.sl-cm'), { onChange: (t) => { if (!silent) editChunk(() => t); } });

  function chunks() { const fm = parseFrontmatter(text); return { fm: fm.raw, list: splitSlides(fm.body) }; }
  function commit(next, { keepEditor = false } = {}) {
    text = next; deck = parseDeck(text);
    cur = Math.min(cur, deck.slides.length - 1);
    render({ keepEditor });
    ctx.onChange(text);
  }
  function editChunk(fn) {
    const { fm, list } = chunks();
    list[cur] = fn(list[cur]);
    commit(joinDeck(fm, list), { keepEditor: true });
  }

  function hydrate(root) {
    if (root.querySelector('.chart-block[data-spec]')) hydrateCharts(root, ctx.readNote);
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
  function fit() {
    if (!deck) return;
    const r = stage.getBoundingClientRect();
    const k = Math.max(0.05, Math.min((r.width - 48) / deck.width, (r.height - 48) / deck.height));
    frame.style.width = `${deck.width * k}px`; frame.style.height = `${deck.height * k}px`;
    frame.style.setProperty('--k', k);
  }
  new ResizeObserver(fit).observe(stage);

  function render({ keepEditor = false } = {}) {
    if (!deck) return;
    const tk = 176 / deck.width;
    thumbs.innerHTML = deck.slides.map((s, i) => `
      <li class="sl-thumb" data-i="${i}" draggable="true" aria-current="${i === cur}" tabindex="0" aria-label="Slide ${i + 1}${s.title ? ': ' + esc(s.title) : ''}">
        <span class="sl-thumb-n">${i + 1}</span>
        <div class="sl-thumb-box" style="width:176px;height:${deck.height * tk}px"><div class="sl-scale" style="transform:scale(${tk})">${renderSlide(deck, s)}</div></div>
      </li>`).join('');
    hydrate(thumbs);
    const s = deck.slides[cur];
    frame.innerHTML = `<div class="sl-scale">${renderSlide(deck, s)}</div>`;
    hydrate(frame); fit();
    host.querySelector('[data-sl-layout]').value = s.layout;
    host.querySelector('[data-sl-theme]').value = deck.theme;
    host.querySelector('[data-sl-size]').value = deck.global.size === '4:3' ? '4:3' : '16:9';
    host.querySelector('[data-sl-paginate]').checked = deck.global.paginate === 'true';
    host.querySelector('.sl-cur').textContent = cur + 1;
    if (document.activeElement !== notesEl) notesEl.value = s.notes;
    if (!keepEditor) { silent = true; chunkEditor.setDoc(chunks().list[cur].replace(/^\n+/, '')); silent = false; }
    ctx.onStatus?.(`${deck.slides.length} ${deck.slides.length === 1 ? 'slide' : 'slides'}`);
  }

  function select(i, { reveal = true } = {}) {
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
  host.querySelector('[data-sl="add"]').addEventListener('click', (e) => ctx.showMenu(e.currentTarget, LAYOUTS.map(([v, l]) => ({ label: l, run: () => addSlide(v) }))));
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
    exportPdf, exportPptx,
    focus() { thumbs.querySelector('[aria-current="true"]')?.focus(); },
  };
}
