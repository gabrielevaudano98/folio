// Folio — Settings section for the spreadsheet's optional data components (DuckDB, Pyodide). They download on first use
// from Folio Sheets (pinned versions, SHA-256 checked: src/main/features/catalog.js); here the person sees whether
// each is on this computer, how much it weighs, what it is for and its licence, and can download or remove it.
// Loaded with Settings, like the meeting recorder's section.
import { t as tr } from './i18n.js';

const MB = (n) => `${Math.max(1, Math.round(n / 2 ** 20))} MB`;
const pct = (d, t) => (t ? Math.min(100, Math.floor((d / t) * 100)) : 0);
const WORKING = ['queued', 'downloading', 'verifying', 'unpacking'];
const USE = { duckdb: 'sc.duckdb-use', pyodide: 'sc.pyodide-use' };

export function renderSheetsComponents(el, { esc, toast, confirm }) {
  let list = [], progress = {};
  const label = (c) => {
    const s = { ...c, ...(progress[c.id] || {}) };
    if (s.state === 'ready') return { ready: true, text: tr('sc.ready', { size: MB(s.diskBytes || s.total) }) };
    if (s.state === 'partial' && !s.error) return { text: tr('sc.partial', { pct: pct(s.done, s.total), size: MB(s.total) }), resume: true };
    if (WORKING.includes(s.state)) return { busy: true, done: s.done || 0, total: s.total, text: s.state === 'verifying' ? tr('sc.checking') : s.state === 'unpacking' ? tr('sc.installing') : tr('sc.downloading', { pct: pct(s.done, s.total), size: MB(s.total) }) };
    if (s.state === 'unsupported') return { text: tr('sc.unsupported') };
    if (s.state === 'outdated' || s.state === 'corrupt') return { repair: true, text: tr('sc.repair', { size: MB(s.total) }) };
    return { error: !!s.error, text: s.error ? tr('sc.stopped', { err: s.error }) : tr('sc.not-downloaded', { size: MB(s.total) }) };
  };
  const row = (c) => {
    const s = label(c), id = `sc-${c.id}`, busyAny = list.some((x) => WORKING.includes((progress[x.id] || x).state));
    const btn = s.ready ? `<button class="btn" type="button" data-sc="remove" data-id="${esc(c.id)}">${tr('sc.remove')}</button>`
      : s.busy ? `<button class="btn" type="button" data-sc="cancel">${tr('sc.cancel')}</button>`
        : c.state === 'unsupported' ? '' : `<button class="btn" type="button" data-sc="install" data-id="${esc(c.id)}" ${busyAny ? 'disabled' : ''}>${s.repair ? tr('sc.download-again') : s.resume ? tr('sc.resume') : tr('sc.download')}</button>`;
    return `<div class="row" data-sc-row="${esc(c.id)}"><div class="row-main"><span class="row-title">${esc(c.name || c.id)}</span>
      <span class="row-sub">${esc(tr(USE[c.id] || 'sc.generic-use'))}</span>
      <span class="row-sub" id="${id}" ${s.error ? 'data-error="true"' : ''}>${esc(s.text)}</span>
      ${s.busy ? `<progress class="feature-progress" max="100" value="${pct(s.done, s.total)}" aria-labelledby="${id}"></progress>` : ''}</div>${btn}</div>`;
  };
  const paint = () => {
    if (!el.isConnected) return;
    const focus = document.activeElement?.closest?.('[data-sc]') ? `[data-sc="${document.activeElement.dataset.sc}"][data-id="${document.activeElement.dataset.id || ''}"]` : null;
    const lic = list.filter((c) => c.license).map((c) => `<li><strong>${esc(c.name)}</strong> · ${esc(c.license)} · ${esc(c.attribution || '')} <button class="btn btn-quiet" type="button" data-open-url="${esc(c.licenseUrl)}">${tr('sc.license')}</button></li>`).join('');
    el.innerHTML = `<h3>${tr('sc.title')}</h3><p class="group-note">${tr('sc.note')}</p><div class="rows">${list.map(row).join('')}</div>${lic ? `<details class="feature-licenses"><summary>${tr('sc.licenses')}</summary><ul>${lic}</ul></details>` : ''}`;
    el.removeAttribute('aria-busy');
    if (focus) el.querySelector(focus)?.focus();
  };
  const refresh = async () => { list = await folio.sheetsComponents(); paint(); };
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sc]'); if (!b) return;
    try {
      if (b.dataset.sc === 'install') { b.disabled = true; progress = {}; const p = folio.sheetsInstall(b.dataset.id); setTimeout(refresh, 50); await p; progress = {}; await refresh(); }
      else if (b.dataset.sc === 'cancel') await folio.sheetsCancelInstall();
      else if (b.dataset.sc === 'remove') {
        const c = list.find((x) => x.id === b.dataset.id);
        if (await confirm({ title: tr('sc.remove-title', { name: c?.name || '' }), body: tr('sc.remove-body'), action: tr('sc.remove'), danger: true })) { await folio.sheetsUninstall(b.dataset.id); await refresh(); }
      }
    } catch (er) { toast(er.message, { kind: 'error' }); refresh(); }
  });
  const off = folio.onSheetsInstallProgress?.((p) => {
    if (!el.isConnected) { off?.(); return; }
    progress = p || {};
    if (!Object.keys(progress).length) return refresh();
    for (const c of list) { // update in place: a repaint per event would steal focus
      const r = el.querySelector(`[data-sc-row="${CSS.escape(c.id)}"]`); const s = label(c); if (!r) continue;
      const bar = r.querySelector('progress'); if (s.busy && !bar) { paint(); return; }
      if (bar) bar.value = pct(s.done, s.total);
      const sub = r.querySelector(`#sc-${CSS.escape(c.id)}`); if (sub) sub.textContent = s.text;
    }
  });
  return refresh();
}
