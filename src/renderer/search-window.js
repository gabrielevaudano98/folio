// Folio — the search window on Ctrl+P (Notion's search, help/search). Empty: the pages you opened or edited lately,
// grouped Today, Yesterday, Past week, Older. Typing: pages by title and by content, each with its icon, folder and a
// highlighted snippet; chips for Title only, In folder… and the sort (Best match, Last edited); a read-only preview of
// the selected page on the right. Title only is the old "Go to note" switcher (fuzzy names, open tabs first, Create note).
// Arrows move, Enter opens, Mod+Enter opens in a tab behind the current one, Esc closes; ">" hands over to the commands.
import { t as tr } from './i18n.js';
import { parseQuery, rankResults, recencyGroups, termMarks } from './search-core.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mark = (s, marks, tag = 'mark') => { let out = '', last = 0; for (const [a, b] of marks) { if (a < last) continue; out += esc(s.slice(last, a)) + `<${tag}>` + esc(s.slice(a, b)) + `</${tag}>`; last = b; } return out + esc(s.slice(last)); };
const groupLabel = (k) => ({ today: tr('search.group-today'), yesterday: tr('search.group-yesterday'), week: tr('search.group-week') }[k] || tr('search.group-older'));
const RECENT_KEY = 'folio.search.recent', PREFS_KEY = 'folio.search.prefs';
const readJson = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch { return d; } };

/**
 * deps: { workspace(), files(), isOpen(p), stem(p), dirOf(p), dirs(), typeIcon(p), textOf(p), render(md),
 *         absUrl(rel), find(q, opts), open(p, { line, background }), commands(q), create(q), isMac }
 */
export function createSearchWindow(deps) {
  let root = null, st = null, seq = 0, previewSeq = 0, timer = 0;
  const prefs = readJson(PREFS_KEY, { preview: true, sort: 'best' });
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ preview: prefs.preview, sort: prefs.sort })); } catch {} };

  /* ---- recently opened pages, per folder (window storage: never written into a note) ---- */
  const recentAll = () => readJson(RECENT_KEY, {});
  function noteOpened(p) {
    const ws = deps.workspace(); if (!ws || !p) return;
    const all = recentAll(); const mine = all[ws] || {};
    mine[p] = Date.now();
    all[ws] = Object.fromEntries(Object.entries(mine).sort((a, b) => b[1] - a[1]).slice(0, 100));
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(all)); } catch {}
  }
  function noteMoved(from, to) {
    const ws = deps.workspace(); const all = recentAll(); const mine = all[ws]; if (!mine) return;
    for (const k of Object.keys(mine)) if (k === from || k.startsWith(from + '/')) { if (to) mine[to + k.slice(from.length)] = mine[k]; delete mine[k]; }
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(all)); } catch {}
  }

  function build() {
    root = document.createElement('div');
    root.className = 'search-scrim'; root.id = 'search-win'; root.hidden = true;
    const mod = deps.isMac ? '⌘' : 'Ctrl+';
    root.innerHTML = `<div class="search-win" role="dialog" aria-modal="true" aria-label="${esc(tr('search.title'))}">
      <div class="palette-field"><span class="search-glyph" aria-hidden="true"></span>
        <input id="search-input" type="text" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="search-list" placeholder="${esc(tr('search.placeholder'))}" aria-label="${esc(tr('search.title'))}"></div>
      <div class="search-chips" role="toolbar" aria-label="${esc(tr('search.filters'))}">
        <button type="button" class="search-chip" id="search-title-only" aria-pressed="false">${esc(tr('search.title-only'))}</button>
        <label class="search-chip search-chip-select"><span class="visually-hidden">${esc(tr('search.in-folder'))}</span><select id="search-folder"></select></label>
        <label class="search-chip search-chip-select"><span class="visually-hidden">${esc(tr('search.sort'))}</span><select id="search-sort">
          <option value="best">${esc(tr('search.sort-best'))}</option><option value="edited">${esc(tr('search.sort-edited'))}</option></select></label>
        <span class="search-chips-gap"></span>
        <button type="button" class="search-chip" id="search-preview-toggle" aria-pressed="true" aria-controls="search-preview">${esc(tr('search.preview'))}</button>
      </div>
      <div class="search-body">
        <ul class="search-list" id="search-list" role="listbox" aria-label="${esc(tr('search.results'))}"></ul>
        <div class="search-preview" id="search-preview" role="region" aria-label="${esc(tr('search.preview'))}" tabindex="-1"></div>
      </div>
      <p class="search-foot" id="search-foot"><span><kbd>↑</kbd><kbd>↓</kbd> ${esc(tr('search.hint-select'))}</span><span><kbd>Enter</kbd> ${esc(tr('search.hint-open'))}</span><span><kbd>${esc(mod)}Enter</kbd> ${esc(tr('search.hint-tab'))}</span><span><kbd>Esc</kbd> ${esc(tr('search.hint-close'))}</span><span>${esc(tr('search.hint-commands'))}</span></p>
    </div>`;
    document.body.append(root);
    const input = root.querySelector('#search-input');
    input.addEventListener('input', () => {
      if (input.value.startsWith('>')) { const v = input.value; close(false); deps.commands(v); return; }
      st.sel = 0; schedule();
    });
    input.addEventListener('keydown', onKey);
    root.querySelector('#search-list').addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) run(Number(li.dataset.i), { background: e.metaKey || e.ctrlKey }); });
    root.querySelector('#search-list').addEventListener('mousemove', (e) => { const li = e.target.closest('[data-i]'); if (li && Number(li.dataset.i) !== st.sel) select(Number(li.dataset.i)); });
    root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
    root.querySelector('#search-title-only').addEventListener('click', (e) => { st.titleOnly = !st.titleOnly; e.currentTarget.setAttribute('aria-pressed', String(st.titleOnly)); st.sel = 0; update(); input.focus(); });
    root.querySelector('#search-folder').addEventListener('change', (e) => { st.folder = e.target.value; st.sel = 0; update(); });
    root.querySelector('#search-sort').addEventListener('change', (e) => { prefs.sort = st.sort = e.target.value; savePrefs(); st.sel = 0; update(); });
    root.querySelector('#search-preview-toggle').addEventListener('click', (e) => { prefs.preview = !prefs.preview; savePrefs(); e.currentTarget.setAttribute('aria-pressed', String(prefs.preview)); layout(); drawPreview(); input.focus(); });
    root.querySelectorAll('select').forEach((s) => s.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }));
  }

  function onKey(e) {
    const mod = deps.isMac ? e.metaKey : e.ctrlKey;
    if (e.key === 'ArrowDown') { e.preventDefault(); select(Math.min(st.items.length - 1, st.sel + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(Math.max(0, st.sel - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (timer) { clearTimeout(timer); timer = 0; update().then(() => run(st.sel, { background: mod })); } else run(st.sel, { background: mod }); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  }

  async function open({ titleOnly = false, query = '' } = {}) {
    if (!root) build();
    if (isOpen()) { const i = root.querySelector('#search-input'); i.focus(); i.select(); return; }
    st = { items: [], sel: 0, titleOnly, folder: '', sort: prefs.sort === 'edited' ? 'edited' : 'best', meta: new Map(), opener: document.activeElement, content: new Map(), contentQ: null };
    const input = root.querySelector('#search-input');
    input.value = query;
    root.querySelector('#search-title-only').setAttribute('aria-pressed', String(titleOnly));
    root.querySelector('#search-sort').value = st.sort;
    root.querySelector('#search-preview-toggle').setAttribute('aria-pressed', String(prefs.preview));
    const dirs = deps.dirs();
    root.querySelector('#search-folder').innerHTML = `<option value="">${esc(tr('search.all-folders'))}</option>` + dirs.map((d) => `<option value="${esc(d)}">${esc(tr('search.in-name', { name: d }))}</option>`).join('');
    root.hidden = false;
    document.querySelectorAll('#app, .toasts').forEach((el) => (el.inert = true));
    layout(); input.focus();
    await update();
    // the last edit and icon of every page (also warms main's text cache for the first query)
    if (deps.workspace()) {
      const mine = st;
      deps.find('', {}).then((rows) => { if (st !== mine || !isOpen()) return; for (const r of rows) st.meta.set(r.path, r); update(); }, () => {});
    }
  }
  function close(restore = true) {
    if (!root || root.hidden) return;
    root.hidden = true; clearTimeout(timer); timer = 0; seq++;
    document.querySelectorAll('#app, .toasts').forEach((el) => (el.inert = false));
    if (restore) st?.opener?.focus?.();
  }
  const isOpen = () => !!root && !root.hidden;
  const layout = () => root.querySelector('.search-win').classList.toggle('has-preview', prefs.preview);
  function schedule() { clearTimeout(timer); timer = setTimeout(() => { timer = 0; update(); }, 90); }

  /* ---- rows ---- */
  function fileRows() {
    const inFolder = (p) => !st.folder || p.startsWith(st.folder + '/');
    return deps.files().filter(inFolder).map((p) => ({ path: p, title: deps.stem(p), modified: st.meta.get(p)?.modified || 0, open: deps.isOpen(p) }));
  }
  async function update() {
    const raw = root.querySelector('#search-input').value;
    const q = parseQuery(raw);
    if (!q.terms.length) { st.q = q; st.items = recentItems(); draw(); return; }
    if (!st.titleOnly && deps.workspace() && st.contentQ !== `${st.folder}\u0000${q.raw}`) {
      const mine = ++seq;
      let rows = [];
      try { rows = await deps.find(q.raw, { folder: st.folder }); } catch { rows = []; }
      if (mine !== seq || !isOpen()) return;
      st.content = new Map(rows.map((r) => [r.path, r]));
      for (const r of rows) if (!st.meta.has(r.path)) st.meta.set(r.path, { path: r.path, modified: r.modified, icon: r.icon });
      st.contentQ = `${st.folder}\u0000${q.raw}`;
    }
    st.q = q;
    const ranked = rankResults(fileRows(), q, st.titleOnly ? null : st.content, { sort: st.sort, titleOnly: st.titleOnly }).slice(0, 80);
    st.items = ranked.map((r) => ({ kind: 'page', ...r }));
    if (deps.workspace() && !ranked.some((r) => r.title.toLowerCase() === q.text.toLowerCase()) && !ranked.some((r) => r.titleStrong))
      st.items.push({ kind: 'create', title: q.text });
    draw();
  }
  function recentItems() {
    const opened = recentAll()[deps.workspace()] || {};
    const items = fileRows().map((f) => ({ path: f.path, title: f.title, modified: f.modified, time: Math.max(opened[f.path] || 0, f.modified || 0) }));
    if (st.sort === 'edited') { return items.filter((x) => x.modified).sort((a, b) => b.modified - a.modified).slice(0, 40).map((x) => ({ kind: 'page', ...x, titleMarks: [] })); }
    const groups = recencyGroups(items, Date.now(), { limit: 40 });
    const out = [];
    for (const g of groups) g.items.forEach((x, k) => out.push({ kind: 'page', ...x, titleMarks: [], group: k === 0 ? g.key : null }));
    if (!out.length) out.push(...items.slice(0, 40).map((x) => ({ kind: 'page', ...x, titleMarks: [] })));
    return out;
  }

  function iconHtml(p) {
    const e = st.meta.get(p)?.icon;
    return e ? `<span class="search-emoji" aria-hidden="true">${esc(e)}</span>` : `<span class="search-ic" aria-hidden="true">${deps.typeIcon(p)}</span>`;
  }
  function rowHtml(it, i) {
    if (it.kind === 'create') return `<li class="search-item" role="option" id="sr-${i}" data-i="${i}" aria-selected="${i === st.sel}"><span class="search-ic" aria-hidden="true">${deps.icons.plus}</span><span class="search-main"><span class="search-title">${esc(tr('app.create-note-q', { q: it.title }))}</span></span></li>`;
    const dir = deps.dirOf(it.path);
    const snip = it.content?.snippets?.find((x) => x.text.toLowerCase() !== it.title.toLowerCase());
    const titleMarks = it.titleMarks?.length ? it.titleMarks : (st.q?.terms.length ? termMarks(it.title, st.q.terms) : []);
    return `<li class="search-item" role="option" id="sr-${i}" data-i="${i}" data-path="${esc(it.path)}" aria-selected="${i === st.sel}">${iconHtml(it.path)}<span class="search-main">
      <span class="search-line1"><span class="search-title">${mark(it.title, titleMarks, 'b')}</span>${dir ? `<span class="search-dir">${esc(dir)}</span>` : ''}</span>
      ${snip ? `<span class="search-snippet">${mark(snip.text, snip.marks)}</span>` : ''}</span></li>`;
  }
  function draw() {
    st.sel = Math.min(st.sel, Math.max(0, st.items.length - 1));
    const list = root.querySelector('#search-list');
    const empty = !st.q?.terms.length;
    let html = '';
    if (!st.items.length) html = `<li class="palette-empty" role="presentation">${esc(tr(deps.workspace() ? (empty ? 'search.no-pages' : 'app.no-matches') : 'app.open-a-folder-first'))}</li>`;
    else if (empty && st.items.some((x) => x.group)) {
      let open = false;
      st.items.forEach((it, i) => {
        if (it.group) { if (open) html += '</ul></li>'; html += `<li role="group" aria-labelledby="sg-${it.group}"><div class="search-group" id="sg-${it.group}" role="presentation">${esc(groupLabel(it.group))}</div><ul role="none">`; open = true; }
        html += rowHtml(it, i);
      });
      if (open) html += '</ul></li>';
    } else {
      if (empty) html += `<li class="search-group" role="presentation">${esc(tr('search.last-edited'))}</li>`;
      else html += `<li class="search-group" role="presentation" aria-live="polite">${esc(tr('search.n-results', { n: st.items.filter((x) => x.kind === 'page').length }))}</li>`;
      html += st.items.map(rowHtml).join('');
    }
    list.innerHTML = html;
    root.querySelector('#search-input').setAttribute('aria-activedescendant', st.items.length ? `sr-${st.sel}` : '');
    drawPreview();
  }
  function select(i) {
    if (i < 0 || i >= st.items.length) return;
    root.querySelector(`#sr-${st.sel}`)?.setAttribute('aria-selected', 'false');
    st.sel = i;
    const li = root.querySelector(`#sr-${i}`); li?.setAttribute('aria-selected', 'true'); li?.scrollIntoView({ block: 'nearest' });
    root.querySelector('#search-input').setAttribute('aria-activedescendant', `sr-${i}`);
    drawPreview();
  }

  /* ---- preview: the Read view's rendering, read-only; web pictures stay blocked, local ones resolve from the page */
  let previewTimer = 0;
  function drawPreview() {
    clearTimeout(previewTimer);
    const pane = root.querySelector('#search-preview');
    pane.hidden = !prefs.preview;
    if (!prefs.preview) return;
    const it = st.items[st.sel];
    if (!it || it.kind !== 'page') { pane.innerHTML = `<p class="search-preview-empty">${esc(tr('search.no-preview'))}</p>`; pane.dataset.path = ''; return; }
    if (pane.dataset.path === it.path && pane.dataset.q === (st.q?.raw || '')) return;
    const mine = ++previewSeq;
    previewTimer = setTimeout(async () => {
      const text = await deps.textOf(it.path).catch(() => '');
      if (mine !== previewSeq || !isOpen()) return;
      const tpl = document.createElement('template');
      try { tpl.innerHTML = deps.render(text); } catch { tpl.innerHTML = `<pre>${esc(text.slice(0, 4000))}</pre>`; }
      for (const el of tpl.content.querySelectorAll('[srcset]')) el.removeAttribute('srcset');
      for (const el of tpl.content.querySelectorAll('script, iframe, object, embed')) el.remove();
      for (const m of tpl.content.querySelectorAll('video, audio')) { m.removeAttribute('src'); m.removeAttribute('data-src'); }
      for (const img of tpl.content.querySelectorAll('img')) {
        const src = img.getAttribute('src') || ''; img.removeAttribute('src'); img.loading = 'lazy';
        if (!src || /^(https?:|\/\/)/i.test(src) || /^file:/i.test(src)) { img.classList.add('remote-blocked'); img.alt = img.alt || tr('app.remote-image'); continue; }
        if (/^(data:|blob:)/.test(src)) { img.src = src; continue; }
        let rel; try { rel = decodeURI(src).replace(/^\.\//, ''); } catch { continue; }
        const d = deps.dirOf(it.path);
        deps.absUrl(d ? `${d}/${rel}` : rel).then((u) => { if (u && mine === previewSeq) img.src = u; }, () => {});
      }
      for (const a of tpl.content.querySelectorAll('a[href]')) { a.removeAttribute('href'); a.setAttribute('tabindex', '-1'); }
      for (const el of tpl.content.querySelectorAll('input, button, textarea, select')) el.setAttribute('disabled', '');
      const page = document.createElement('div'); page.className = 'prose search-preview-page'; page.setAttribute('inert', '');
      const head = document.createElement('p'); head.className = 'search-preview-title'; head.textContent = it.title; head.hidden = !!tpl.content.querySelector('h1'); // the page's own title is shown once
      page.append(head, tpl.content);
      pane.replaceChildren(page); pane.dataset.path = it.path; pane.dataset.q = st.q?.raw || '';
      const terms = st.q?.terms || [];
      const hitLine = it.content?.snippets?.[0]?.text;
      if (terms.length && hitLine) {
        // scroll the first matching block into view, like Notion's jump to the match
        const want = terms[0];
        const el = [...page.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, td, blockquote, pre')].find((n) => n.textContent.toLowerCase().includes(want));
        if (el) { el.classList.add('search-preview-hit'); pane.scrollTop = Math.max(0, el.offsetTop - 40); }
      } else pane.scrollTop = 0;
    }, 60);
  }

  function run(i, { background = false } = {}) {
    const it = st.items[i]; if (!it) return;
    close(background);
    if (it.kind === 'create') return deps.create(it.title);
    return deps.open(it.path, { line: it.content?.line, background });
  }

  return { open, close, isOpen, noteOpened, noteMoved };
}
