// Version history as a mode (Google Docs): the document full width with its changes, the versions on the right.
// Works for every document type: it compares the Markdown text. Restore is always undoable (the current text is kept first).
import { diffWords } from 'diff';
import { wordParts, revertHunk, countHunks } from '../main/history-diff.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const timeOf = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export function dayLabel(t, now = Date.now()) {
  const d = new Date(t), n = new Date(now); const days = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  if (days === 0) return 'Today'; if (days === 1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== n.getFullYear() ? { year: 'numeric' } : {}) });
}
const REASON = { open: 'Saved before editing', created: 'Created', 'before-ai': 'Before an AI edit', ai: 'AI edit', 'before-restore': 'Before a restore', restore: 'Restored', named: 'Named version', close: 'Closed', edit: '' };
const who = (v) => (v.by === 'you' ? 'You' : v.by);
const initial = (v) => (who(v)[0] || '?').toUpperCase();
const hue = (name) => { let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

/*
 * mountHistory(host, api) → { open(), close(), isOpen() }
 * api: folio (IPC), icons, getPath(), getText(), setText(text) (replace the open document and save it),
 *      renderMd(text) → html (pages), isPage(), toast(text, opts), ask({title,label,value,…}) → string|null, confirm({…}) → bool,
 *      copyAs(path, text) → creates a new document, onClose()
 */
export function mountHistory(host, api) {
  const { folio, icons } = api;
  const st = { open: false, path: '', versions: [], deleted: [], sel: null, compare: 'current', view: 'changes', onlyNamed: false, side: 'versions', texts: new Map(), hunk: 0, parts: [], hunks: 0, live: '' };
  host.className = 'history'; host.hidden = true; host.setAttribute('role', 'region'); host.setAttribute('aria-label', 'Version history');

  const textOf = async (v) => { if (v === 'current') return st.live; if (!st.texts.has(v.id)) st.texts.set(v.id, await folio.historyGet(st.path, v.id)); return st.texts.get(v.id); };
  const selVersion = () => st.versions.find((v) => v.id === st.sel) || null;
  const label = (v) => v.name || REASON[v.reason] || '';

  async function open() {
    st.path = api.getPath(); if (!st.path) return;
    st.live = api.getText();
    await folio.historySnapshot(st.path, st.live, 'edit', false).catch(() => {}); // the text on screen is always in the list
    st.versions = await folio.historyList(st.path); st.deleted = []; st.texts.clear();
    st.sel = st.versions[0]?.id ?? null; st.compare = 'current'; st.view = 'changes'; st.side = 'versions'; st.onlyNamed = false; st.open = true;
    host.hidden = false; render(); await showVersion(); host.querySelector('.hv-versions button[aria-current]')?.focus();
  }
  function close() { if (!st.open) return; st.open = false; host.hidden = true; host.innerHTML = ''; api.onClose?.(); }

  function frame() {
    const v = selVersion(); const named = st.versions.filter((x) => x.name).length;
    return `<header class="hv-top">
      <button class="btn btn-quiet" type="button" data-act="back">${icons.arrowLeft}<span>Back to editing</span></button>
      <div class="hv-title"><h2>Version history</h2><span class="hv-sub">${esc(st.path)}</span></div>
      <div class="hv-actions">
        <div class="segmented" role="radiogroup" aria-label="Show">
          <button type="button" role="radio" data-view="changes" aria-checked="${st.view === 'changes'}">Changes</button>
          <button type="button" role="radio" data-view="version" aria-checked="${st.view === 'version'}">Version</button>
        </div>
        <button class="btn" type="button" data-act="name" ${v ? '' : 'disabled'}>${v?.name ? 'Rename' : 'Name this version'}</button>
        <button class="btn" type="button" data-act="copy" ${v ? '' : 'disabled'}>${icons.copy}<span>Make a copy</span></button>
        <button class="btn btn-primary" type="button" data-act="restore" ${v ? '' : 'disabled'}>Restore this version</button>
        <button class="icon-btn" type="button" data-act="more" aria-label="More" aria-haspopup="menu">${icons.more}</button>
      </div></header>
    <div class="hv-body">
      <section class="hv-main" aria-label="Selected version">
        <div class="hv-bar" data-bar></div>
        <div class="hv-doc prose" data-doc tabindex="0"></div>
      </section>
      <aside class="hv-side" aria-label="Versions">
        <div class="segmented hv-tabs" role="radiogroup" aria-label="List">
          <button type="button" role="radio" data-side="versions" aria-checked="${st.side === 'versions'}">Versions</button>
          <button type="button" role="radio" data-side="deleted" aria-checked="${st.side === 'deleted'}">Deleted pages</button>
        </div>
        ${st.side === 'versions' ? `<label class="hv-filter"><input type="checkbox" data-only ${st.onlyNamed ? 'checked' : ''}><span>Only named versions${named ? ` (${named})` : ''}</span></label>` : ''}
        <div class="hv-list-wrap" data-list></div>
      </aside></div>`;
  }
  function render() {
    host.innerHTML = frame(); renderList(); wire();
  }
  function listVersions() {
    const cur = `<li><button type="button" class="hv-v hv-cur" data-id="current" ${st.sel === 'current' ? 'aria-current="true"' : ''}><span class="hv-v-main"><b>Current version</b><span class="hv-v-sub">What is on screen now</span></span></button></li>`;
    let last = ''; const out = [];
    for (const v of st.versions) {
      if (st.onlyNamed && !v.name) continue;
      const k = dayKey(v.t); if (k !== last) { out.push(`<li class="hv-day" role="presentation">${esc(dayLabel(v.t))}</li>`); last = k; }
      const d = v.delta; const delta = d ? `<span class="hv-delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${Math.abs(d)} words</span>` : '';
      out.push(`<li><button type="button" class="hv-v ${v.name ? 'is-named' : ''}" data-id="${esc(v.id)}" ${st.sel === v.id ? 'aria-current="true"' : ''}>
        <span class="hv-av" style="--h:${hue(who(v))}" aria-hidden="true">${esc(initial(v))}</span>
        <span class="hv-v-main"><b>${v.name ? esc(v.name) : esc(timeOf(v.t))}</b>
          <span class="hv-v-sub">${v.name ? `${esc(timeOf(v.t))} · ` : ''}${esc(who(v))}${label(v) && !v.name ? ' · ' + esc(label(v)) : ''}${delta ? ' · ' : ''}${delta}</span>
          ${v.note ? `<span class="hv-note">${esc(v.note)}</span>` : ''}</span></button></li>`);
    }
    if (!out.length) out.push('<li class="hv-empty">No named versions yet. Select a version and choose “Name this version”.</li>');
    return `<ul class="hv-versions" role="list">${cur}${out.join('')}</ul>`;
  }
  function listDeleted() {
    if (!st.deleted.length) return '<p class="hv-empty">Nothing was deleted. Pages you delete in Folio, or outside it, appear here with their last version.</p>';
    return `<ul class="hv-deleted" role="list">${st.deleted.map((d, i) => `<li class="hv-del"><div class="hv-v-main"><b>${esc(d.path.split('/').pop())}</b><span class="hv-v-sub">${esc(d.path.includes('/') ? d.path.replace(/\/[^/]*$/, '') + ' · ' : '')}deleted after ${esc(dayLabel(d.last.t))}, ${esc(timeOf(d.last.t))} · ${d.versions} version${d.versions === 1 ? '' : 's'}</span></div><button class="btn" type="button" data-restore-deleted="${i}">Restore</button></li>`).join('')}</ul>`;
  }
  function renderList() { const el = host.querySelector('[data-list]'); if (el) el.innerHTML = st.side === 'versions' ? listVersions() : listDeleted(); }

  const baseFor = async () => {
    const v = selVersion();
    if (st.sel === 'current') return null;
    if (st.compare === 'current') return { old: await textOf(v), new: st.live, newLabel: 'now', mode: 'current' };
    const i = st.versions.indexOf(v); const prev = st.versions[i + 1];
    if (st.compare === 'previous') return { old: prev ? await textOf(prev) : '', new: await textOf(v), newLabel: 'this version', mode: 'previous', first: !prev };
    const other = st.versions.find((x) => x.id === st.compare);
    return other ? { old: await textOf(other), new: await textOf(v), mode: 'other', other } : null;
  };

  async function showVersion() {
    const bar = host.querySelector('[data-bar]'), doc = host.querySelector('[data-doc]'); if (!bar || !doc) return;
    const v = selVersion();
    if (st.sel === 'current' || !v) { bar.innerHTML = `<span class="hv-bar-text">This is the current text. Pick an earlier version to see what changed.</span>`; doc.innerHTML = st.view === 'version' || true ? body(st.live) : ''; return; }
    const text = await textOf(v);
    const opts = [['current', 'Current version'], ['previous', 'Previous version'], ...st.versions.filter((x) => x.id !== v.id).map((x) => [x.id, `${x.name || dayLabel(x.t) + ', ' + timeOf(x.t)}`])];
    const cmp = `<label class="hv-cmp">Compare with <select data-compare>${opts.map(([id, l]) => `<option value="${esc(id)}" ${st.compare === id ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    if (st.view === 'version') { bar.innerHTML = `<span class="hv-bar-text">${esc(dayLabel(v.t))}, ${esc(timeOf(v.t))} · ${esc(who(v))}</span>`; doc.innerHTML = body(text); return; }
    const b = await baseFor();
    st.parts = wordParts(b.old, b.new, diffWords); st.hunks = countHunks(st.parts); st.hunk = Math.min(st.hunk, Math.max(0, st.hunks - 1));
    const canPut = b.mode === 'current';
    let h = -1, inRun = false;
    doc.innerHTML = `<div class="hv-diff" data-diff>${st.parts.map((p) => {
      if (p.kind === 'same') { inRun = false; return esc(p.text); }
      let open = ''; if (!inRun) { h++; inRun = true; open = `<span class="hv-mark" data-h="${h}"></span>`; }
      return open + `<${p.kind === 'add' ? 'ins' : 'del'} data-h="${h}">${esc(p.text)}</${p.kind === 'add' ? 'ins' : 'del'}>`;
    }).join('')}</div>`;
    // one "put back" button after each change
    const seen = new Set();
    doc.querySelectorAll('[data-h]').forEach((el) => { const i = el.dataset.h; if (el.matches('.hv-mark')) return; el.classList.add('hv-chg'); const nxt = el.nextElementSibling; if (!(nxt && nxt.dataset?.h === i && !nxt.matches('.hv-put')) && !seen.has(i)) { /* last element of the change gets the button below */ } });
    if (canPut) for (let i = 0; i < st.hunks; i++) { const els = [...doc.querySelectorAll(`ins[data-h="${i}"], del[data-h="${i}"]`)]; const last = els[els.length - 1]; if (!last) continue; const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'hv-put'; btn.dataset.put = i; btn.title = 'Put this change back as it was in this version'; btn.setAttribute('aria-label', `Put back change ${i + 1}`); btn.innerHTML = icons.undo; last.after(btn); }
    bar.innerHTML = `<span class="hv-bar-text">${st.hunks ? `<b>${st.hunks}</b> change${st.hunks === 1 ? '' : 's'} ${b.mode === 'previous' ? (b.first ? 'in the first version' : 'in this version') : b.mode === 'other' ? 'between the two' : 'since this version'}` : 'No differences.'}</span>
      ${st.hunks ? `<span class="hv-nav"><button class="icon-btn" type="button" data-nav="-1" aria-label="Previous change">${icons.chevronUp || '↑'}</button><button class="icon-btn" type="button" data-nav="1" aria-label="Next change">${icons.chevronDown || '↓'}</button></span>` : ''}
      <span class="hv-legend"><ins>added</ins> <del>removed</del></span>${cmp}`;
    if (st.hunks) go(0);
  }
  const body = (text) => (api.isPage() ? api.renderMd(text) : `<pre class="hv-src">${esc(text)}</pre>`);
  function go(step) {
    const doc = host.querySelector('[data-doc]'); const marks = [...doc.querySelectorAll('.hv-mark')]; if (!marks.length) return;
    st.hunk = (st.hunk + step + marks.length) % marks.length; doc.querySelectorAll('.hv-cur-chg').forEach((x) => x.classList.remove('hv-cur-chg'));
    doc.querySelectorAll(`[data-h="${st.hunk}"]`).forEach((x) => x.classList.add('hv-cur-chg')); marks[st.hunk].scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  async function select(id) { st.sel = id; st.hunk = 0; if (id === 'current') st.view = 'changes'; renderList(); host.querySelectorAll('[data-act=name],[data-act=copy],[data-act=restore]').forEach((b) => (b.disabled = id === 'current')); await showVersion(); }

  async function restoreWhole() {
    const v = selVersion(); if (!v) return; const text = await textOf(v);
    if (text === st.live) return api.toast('That is already the current text.');
    await folio.historySnapshot(st.path, st.live, 'before-restore', true);
    await api.setText(text); await folio.historySnapshot(st.path, text, 'restore', true);
    api.toast(`Restored the version from ${dayLabel(v.t).toLowerCase()}, ${timeOf(v.t)}.`, { action: ['Undo', async () => { await api.setText(st.live); await folio.historySnapshot(st.path, st.live, 'edit', true); }] });
    close();
  }
  async function putBack(i) {
    const next = revertHunk(st.parts, i);
    await folio.historySnapshot(st.path, st.live, 'before-restore', true);
    await api.setText(next); st.live = next; await folio.historySnapshot(st.path, next, 'restore', true);
    st.versions = await folio.historyList(st.path); renderList(); await showVersion();
    api.toast('Put that change back.', { action: ['Undo', async () => { await api.setText(st.live = st.parts.filter((p) => p.kind !== 'del').map((p) => p.text).join('')); st.versions = await folio.historyList(st.path); renderList(); await showVersion(); }] });
  }
  async function nameIt() {
    const v = selVersion(); if (!v) return;
    const r = await api.ask({ title: v.name ? 'Rename this version' : 'Name this version', label: 'Name', value: v.name || '', hint: 'Named versions are kept for good. Leave empty to remove the name.', action: 'Save', allowEmpty: true, validate: false }); if (r == null) return;
    await folio.historyName(st.path, v.id, r.trim()); st.versions = await folio.historyList(st.path); render(); await showVersion();
  }
  async function copyIt() { const v = selVersion(); if (!v) return; const text = await textOf(v); await api.copyAs(st.path, text, v); }
  async function loadDeleted() { st.deleted = await folio.historyDeleted().catch(() => []); renderList(); }
  async function restoreDeleted(i) {
    const d = st.deleted[i]; if (!d) return;
    try { const text = await folio.historyGet(d.path, d.last.id); await folio.create(d.path, text); await api.opened(d.path); api.toast(`Restored ${d.path.split('/').pop()}.`); close(); }
    catch (e) { api.toast(`Could not restore. ${e.message}`, { kind: 'error' }); }
  }

  function wire() {
    host.onclick = async (e) => {
      const t = e.target;
      const v = t.closest('.hv-v'); if (v) return select(v.dataset.id);
      const put = t.closest('[data-put]'); if (put) return putBack(+put.dataset.put);
      const nav = t.closest('[data-nav]'); if (nav) return go(+nav.dataset.nav);
      const view = t.closest('[data-view]'); if (view) { st.view = view.dataset.view; host.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.view === st.view))); return showVersion(); }
      const side = t.closest('[data-side]'); if (side) { st.side = side.dataset.side; if (st.side === 'deleted') await loadDeleted(); render(); return; }
      const rd = t.closest('[data-restore-deleted]'); if (rd) return restoreDeleted(+rd.dataset.restoreDeleted);
      const act = t.closest('[data-act]')?.dataset.act;
      if (act === 'back') close(); else if (act === 'restore') restoreWhole(); else if (act === 'name') nameIt(); else if (act === 'copy') copyIt();
      else if (act === 'more') api.menu(t.closest('[data-act]'), [
        { label: 'Clear history of this page…', danger: true, run: async () => { if (await api.confirm({ title: 'Clear history?', body: `Every earlier version of “${st.path.split('/').pop()}” is removed from this computer. The page itself is not changed.`, action: 'Clear history', danger: true })) { await folio.historyClear(st.path); await folio.historySnapshot(st.path, st.live, 'open', true); st.versions = await folio.historyList(st.path); st.sel = st.versions[0]?.id ?? null; render(); showVersion(); } } },
      ]);
    };
    host.onchange = (e) => {
      if (e.target.matches('[data-only]')) { st.onlyNamed = e.target.checked; renderList(); }
      else if (e.target.matches('[data-compare]')) { st.compare = e.target.value; st.hunk = 0; showVersion(); }
    };
    host.onkeydown = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (e.target.closest?.('.hv-versions') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault(); const btns = [...host.querySelectorAll('.hv-versions .hv-v')]; const i = btns.indexOf(e.target.closest('.hv-v')); const n = btns[i + (e.key === 'ArrowDown' ? 1 : -1)]; if (n) { n.focus(); select(n.dataset.id); }
      } else if (e.key === 'F3' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.target.closest?.('.hv-versions'))) go(e.key === 'ArrowUp' || e.shiftKey ? -1 : 1);
    };
  }
  return { open, close, isOpen: () => st.open, refresh: async () => { if (!st.open) return; st.live = api.getText(); st.versions = await folio.historyList(st.path); renderList(); } };
}
