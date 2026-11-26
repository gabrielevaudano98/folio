// Folio Sheets — slicers, timelines and macro buttons over the grid (areas 13, 17 and 22). Each is a Univer floating
// DOM element, so it scrolls, zooms and moves with the sheet; its definition is Folio's own sheet meta:
//   "slicers": [{ "kind": "slicer" | "timeline", "source": "A1:F200", "column": "Region", "selected": ["EU"],
//                 "title": "Region", "at": { "x", "y", "w", "h" } }]
//   "buttons": [{ "label": "Add totals", "macro": "addTotals", "at": { … } }]
// A slicer filters its source with Univer's filter (sheets-filter), so the rows it hides are the rows a filter hides:
// totals with SUBTOTAL, charts and copies all agree.
import { createElement as E, useState, useEffect } from 'react';
import { toRange, colName } from '../core/a1.js';
import { L } from './i18n.js';

const MONTH = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
/** a cell value as a date: Excel serial numbers, ISO text, Date */
export function asDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'number' && v > 59 && v < 2958466) return new Date(Math.round((v - 25569) * 864e5));
  if (typeof v === 'string' && /^\d{4}-\d{2}(-\d{2})?/.test(v)) { const d = new Date(v.length === 7 ? v + '-01' : v.slice(0, 10)); return Number.isNaN(+d) ? null : d; }
  return null;
}

export function createFloats({ api, surface, ctx }) {
  const doms = new Map(); // key → float id
  const state = new Map(); // key → setState of the mounted component
  let registered = false;
  const key = (sid, kind, i) => `${sid}:${kind}:${i}`;
  const specOf = (k) => { const [sid, kind, i] = k.split(':'); return surface.meta(sid)[kind === 'button' ? 'buttons' : 'slicers']?.[Number(i)]; };

  /* ---------- slicer data and filtering ---------- */
  function sourceOf(sid, spec) {
    const ws = surface.wb().getSheetBySheetId(sid); if (!ws) return null;
    const r = toRange(spec.source);
    const head = ws.getRange(r.startRow, r.startColumn, 1, r.endColumn - r.startColumn + 1).getRawValues()[0].map((x) => String(x ?? ''));
    const ci = head.indexOf(spec.column); if (ci < 0) return { ws, r, ci: -1, items: [] };
    const n = r.endRow - r.startRow;
    const raw = n > 0 ? ws.getRange(r.startRow + 1, r.startColumn + ci, n, 1).getRawValues().map((x) => x[0]) : [];
    const shown = n > 0 ? ws.getRange(r.startRow + 1, r.startColumn + ci, n, 1).getDisplayValues().map((x) => x[0]) : [];
    return { ws, r, ci, raw, shown };
  }
  function itemsOf(sid, spec) {
    const s = sourceOf(sid, spec); if (!s || s.ci < 0) return [];
    if (spec.kind === 'timeline') { const set = new Set(); s.raw.forEach((v) => { const d = asDate(v); if (d) set.add(MONTH(d)); }); return [...set].sort(); }
    return [...new Set(s.shown.filter((x) => x !== ''))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
  function apply(sid, spec) {
    const s = sourceOf(sid, spec); if (!s || s.ci < 0) return;
    let filter = s.ws.getFilter?.();
    const want = spec.source.replace(/\$/g, '');
    if (filter && filter.getRange().getA1Notation() !== want) { if (spec.selected?.length) { filter.remove(); filter = null; } else return; }
    if (!filter) { if (!spec.selected?.length) return; filter = s.ws.getRange(want).createFilter(); }
    const col = s.r.startColumn + s.ci;
    if (!spec.selected?.length) { filter.removeColumnFilterCriteria(col); return; }
    let values = spec.selected;
    if (spec.kind === 'timeline') { const [from, to] = [spec.selected[0], spec.selected.at(-1)].sort(); values = [...new Set(s.raw.map((v, i) => { const d = asDate(v); return d && MONTH(d) >= from && MONTH(d) <= to ? s.shown[i] : null; }).filter((x) => x != null))]; }
    filter.setColumnFilterCriteria(col, { colId: s.ci, filters: { filters: values.map(String) } });
  }

  /* ---------- components ---------- */
  function Slicer({ data }) {
    const k = data?.key; const [, force] = useState(0);
    useEffect(() => { state.set(k, () => force((n) => n + 1)); return () => state.delete(k); }, [k]);
    const spec = specOf(k); if (!spec) return null;
    const [sid] = k.split(':');
    const items = itemsOf(sid, spec); const sel = new Set(spec.selected || []);
    const toggle = (v, multi) => {
      let next;
      if (spec.kind === 'timeline') { const cur = spec.selected || []; next = multi && cur.length ? [cur[0], v].sort() : [v]; if (cur.length === 1 && cur[0] === v && !multi) next = []; }
      else { next = multi ? (sel.has(v) ? [...sel].filter((x) => x !== v) : [...sel, v]) : (sel.size === 1 && sel.has(v) ? [] : [v]); }
      spec.selected = next; surface.protection.unguarded(() => apply(sid, spec)); surface.save(); force((n) => n + 1);
    };
    const inRange = (v) => spec.kind === 'timeline' && spec.selected?.length && v >= spec.selected[0] && v <= spec.selected.at(-1);
    const fmtMonth = (m) => { const [y, mo] = m.split('-'); return new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(Date.UTC(+y, +mo - 1, 1))) + (mo === '01' || m === items[0] ? ` ${y}` : ''); };
    return E('div', { className: `xs-slicer xs-${spec.kind}`, role: 'group', 'aria-label': spec.title || spec.column, onMouseDown: (e) => { if (e.target.closest('button')) e.stopPropagation(); } },
      E('div', { className: 'xs-slicer-head' }, E('span', null, spec.title || spec.column), E('button', { type: 'button', className: 'xs-slicer-clear', disabled: !sel.size, 'aria-label': L('Clear filter'), title: L('Clear filter'), onClick: () => { spec.selected = []; surface.protection.unguarded(() => apply(sid, spec)); surface.save(); force((n) => n + 1); } }, L('Clear'))),
      E('div', { className: 'xs-slicer-items' }, items.length ? items.map((v) => E('button', { key: v, type: 'button', 'aria-pressed': String(spec.kind === 'timeline' ? !!inRange(v) : sel.has(v)), onClick: (e) => toggle(v, e.ctrlKey || e.metaKey || e.shiftKey) }, spec.kind === 'timeline' ? fmtMonth(v) : v)) : E('p', { className: 'xs-hint' }, L('No values in {column}.', { column: spec.column }))),
    );
  }
  function MacroButton({ data }) {
    const spec = specOf(data?.key); if (!spec) return null;
    return E('button', { type: 'button', className: 'btn xs-macro-btn', onMouseDown: (e) => e.stopPropagation(), onClick: () => surface.runMacro(spec.macro).catch((e) => ctx.toast(e.message, { kind: 'error' })) }, spec.label || spec.macro);
  }
  function ensure() { if (registered) return; api.registerComponent('folio-slicer', Slicer); api.registerComponent('folio-button', MacroButton); registered = true; }

  function place(sid, kind, i) {
    ensure();
    const spec = specOf(key(sid, kind, i)); const ws = surface.wb().getSheetBySheetId(sid); if (!spec || !ws) return;
    const at = spec.at || (kind === 'button' ? { x: 40, y: 40, w: 140, h: 36 } : { x: 520, y: 40, w: 220, h: kind === 'timeline' ? 120 : 240 });
    const k = key(sid, kind, i);
    const res = ws.addFloatDomToPosition({ componentKey: kind === 'button' ? 'folio-button' : 'folio-slicer', allowTransform: true, initPosition: { startX: at.x, endX: at.x + at.w, startY: at.y, endY: at.y + at.h }, data: { key: k } }, `folio-${kind}-${k.replace(/:/g, '-')}`);
    if (res) doms.set(k, res.id);
  }
  return {
    renderAll() {
      for (const ws of surface.wb().getSheets()) {
        const id = ws.getSheetId(); const m = surface.meta(id);
        (m.slicers || []).forEach((s, i) => place(id, s.kind === 'timeline' ? 'timeline' : 'slicer', i));
        (m.buttons || []).forEach((_, i) => place(id, 'button', i));
      }
    },
    clear(fromGrid = false) {
      if (fromGrid) for (const [k, id] of doms) { try { surface.wb()?.getSheetBySheetId(k.split(':')[0])?.removeFloatDom(id); } catch { /* gone */ } }
      doms.clear(); state.clear();
    },
    sync() {
      for (const [k, id] of doms) {
        const [sid] = k.split(':'); const d = surface.wb()?.getSheetBySheetId(sid)?.getFloatDomById?.(id); const spec = specOf(k);
        if (d?.position && spec) { const p = d.position; spec.at = { x: Math.round(p.left), y: Math.round(p.top), w: Math.round(p.width), h: Math.round(p.height) }; }
      }
    },
    /** slicer or timeline over a range with a header row */
    addSlicer({ kind = 'slicer', source, column, title = '' }) {
      const sid = surface.sheetId(); const list = (surface.meta(sid).slicers ||= []);
      const kindList = list.filter((s) => (s.kind || 'slicer') === kind).length;
      const r = toRange(source);
      list.push({ kind, source, column, title: title || column, selected: [], at: { x: 104 * (r.endColumn + 2) + 46 + 16 * kindList, y: 40 + 24 * kindList, w: kind === 'timeline' ? 420 : 220, h: kind === 'timeline' ? 120 : 240 } });
      this.sync(); this.clear(true); this.renderAll(); surface.save();
    },
    addButton({ label, macro }) {
      const sid = surface.sheetId(); const list = (surface.meta(sid).buttons ||= []);
      const r = surface.range();
      list.push({ label, macro, at: { x: 104 * (r?.getColumn() || 0) + 46, y: 24 * (r?.getRow() || 1), w: Math.max(120, 9 * label.length + 32), h: 34 } });
      this.sync(); this.clear(true); this.renderAll(); surface.save();
    },
    remove(sid, listName, i) { this.sync(); this.clear(true); surface.meta(sid)[listName].splice(i, 1); this.renderAll(); surface.save(); },
    /** columns of a source range, for the panel */
    columns(source) { try { const r = toRange(source); return surface.ws().getRange(r.startRow, r.startColumn, 1, r.endColumn - r.startColumn + 1).getRawValues()[0].map((x, i) => String(x ?? colName(r.startColumn + i))); } catch { return []; } },
    refresh() { for (const f of state.values()) f(); },
  };
}
