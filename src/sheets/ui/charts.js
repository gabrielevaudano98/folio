// Folio Sheets — charts over the grid (area 7), drawn by Apache ECharts in a Univer floating element.
// A chart is a spec in the sheet's meta (sheet-md v2 `charts`), the same spec Folio pages and slides use (chart.js):
//   { type, title, range, by, stacked, at: { x, y, w, h } }     x/y/w/h in pixels of the sheet at 100% zoom
import { createElement, useEffect, useRef } from 'react';
import { toSeries } from '../../renderer/chart.js';
import { cssHex } from './univer.js';
import { L } from './i18n.js';

let ec = null;
async function echarts() {
  if (ec) return ec;
  const [core, charts, comps, renderers] = await Promise.all([import('echarts/core'), import('echarts/charts'), import('echarts/components'), import('echarts/renderers')]);
  core.use([charts.BarChart, charts.LineChart, charts.PieChart, charts.ScatterChart, charts.RadarChart, charts.FunnelChart, comps.RadarComponent, comps.GridComponent, comps.TooltipComponent, comps.LegendComponent, comps.TitleComponent, comps.DatasetComponent, renderers.SVGRenderer]);
  return (ec = core);
}
const root = () => getComputedStyle(document.documentElement);
const PALETTE = ['blue', 'orange', 'green', 'purple', 'red', 'yellow', 'pink', 'brown', 'gray'];

/** ECharts option from values (row 0 = series names, column 0 = categories) and a spec */
export function chartOption(values, spec, { colors = [], ink = '#333', muted = '#777', rule = '#ddd', font = 'system-ui' } = {}) {
  const { categories, series } = toSeries(values, spec.by || 'columns');
  const type = spec.type || 'column';
  const text = { color: ink, fontFamily: font, fontSize: 11 };
  const base = { color: colors, textStyle: text, animationDuration: 250, tooltip: { trigger: type === 'pie' ? 'item' : 'axis', textStyle: { fontFamily: font } }, title: spec.title ? { text: spec.title, left: 8, top: 6, textStyle: { ...text, fontSize: 13, fontWeight: 600 } } : undefined, legend: series.length > 1 || type === 'pie' ? { bottom: 4, textStyle: text, itemWidth: 10, itemHeight: 10 } : undefined };
  if (type === 'radar') { const max = Math.max(1, ...series.flatMap((x) => x.values.map(Number).filter(Number.isFinite))); return { ...base, radar: { indicator: categories.map((c) => ({ name: c, max })), axisName: { color: muted }, splitLine: { lineStyle: { color: rule } }, splitArea: { show: false } }, series: [{ type: 'radar', data: series.map((x) => ({ name: x.name, value: x.values })), areaStyle: { opacity: 0.12 } }] }; }
  if (type === 'funnel') return { ...base, series: [{ type: 'funnel', left: '10%', width: '80%', label: { color: ink, fontFamily: font }, data: categories.map((c, i) => ({ name: c, value: series[0]?.values[i] ?? 0 })) }] };
  if (type === 'pie' || type === 'doughnut') return { ...base, series: [{ type: 'pie', radius: type === 'pie' ? ['0%', '68%'] : ['38%', '68%'], center: ['50%', '48%'], data: categories.map((c, i) => ({ name: c, value: series[0]?.values[i] ?? 0 })), label: { color: muted, fontFamily: font } }] };
  const horizontal = type === 'bar';
  const cat = { type: 'category', data: categories, axisLine: { lineStyle: { color: rule } }, axisLabel: { color: muted }, axisTick: { show: false } };
  const val = { type: 'value', splitLine: { lineStyle: { color: rule } }, axisLabel: { color: muted } };
  const grid = { left: 48, right: 16, top: spec.title ? 40 : 16, bottom: series.length > 1 ? 40 : 24, containLabel: false };
  if (type === 'scatter') return { ...base, grid, xAxis: { ...val }, yAxis: val, series: series.slice(1).map((s) => ({ type: 'scatter', name: s.name, data: s.values.map((v, i) => [series[0].values[i], v]), symbolSize: 7 })) };
  const kind = { column: 'bar', bar: 'bar', line: 'line', area: 'line' }[type] || 'bar';
  return {
    ...base, grid, xAxis: horizontal ? val : cat, yAxis: horizontal ? cat : val,
    series: series.map((s) => ({ type: kind, name: s.name, data: s.values, stack: spec.stacked ? 'all' : undefined, areaStyle: type === 'area' ? { opacity: 0.25 } : undefined, smooth: false, barMaxWidth: 36, symbol: kind === 'line' ? 'circle' : undefined, symbolSize: 5 })),
  };
}

export function createCharts({ api, surface, ctx }) {
  const live = new Map(); // chart key → { dispose, inst }
  const doms = new Map(); // chart key → float dom id
  let registered = false;
  const key = (sheetId, i) => `${sheetId}:${i}`;
  const specOf = (k) => { const [sid, i] = k.split(':'); return surface.meta(sid).charts?.[Number(i)]; };

  function theme() {
    const r = root();
    return { colors: PALETTE.map((c) => cssHex(r.getPropertyValue(`--content-${c}`))), ink: cssHex(r.getPropertyValue('--color-ink')), muted: cssHex(r.getPropertyValue('--color-muted')), rule: cssHex(r.getPropertyValue('--color-rule')), font: r.getPropertyValue('--font-sans') };
  }
  function values(spec) {
    const ws = spec.sheet ? surface.wb().getSheetByName(spec.sheet) : surface.wb().getSheetBySheetId(spec.__sheet) || surface.ws();
    return ws.getRange(spec.range).getRawValues();
  }
  async function draw(el, k) {
    const spec = specOf(k); if (!spec || !el) return;
    const E = await echarts();
    let inst = E.getInstanceByDom(el) || E.init(el, null, { renderer: 'svg' });
    try { inst.setOption(chartOption(values({ ...spec, __sheet: k.split(':')[0] }), spec, theme()), true); }
    catch (e) { el.textContent = L('This chart cannot be drawn: {error}', { error: e.message }); }
    live.set(k, { inst, el });
  }
  function Chart({ data }) {
    const ref = useRef(null);
    useEffect(() => { const k = data?.key; draw(ref.current, k); const ro = new ResizeObserver(() => live.get(k)?.inst?.resize()); ro.observe(ref.current); return () => { ro.disconnect(); live.get(k)?.inst?.dispose(); live.delete(k); }; }, [data?.key]);
    return createElement('div', { ref, className: 'xs-chart', role: 'img', 'aria-label': data?.label || L('Chart'), onDoubleClick: () => surface.ctx && data?.key && openEditor(data.key) });
  }
  function openEditor(k) { surface.panels?.open('chart', { key: k }); }
  function ensure() { if (registered) return; api.registerComponent('folio-chart', Chart); registered = true; }

  const DEFAULT_AT = { x: 420, y: 40, w: 480, h: 300 };
  function place(sheetId, i) {
    ensure();
    const spec = surface.meta(sheetId).charts[i];
    const ws = surface.wb().getSheetBySheetId(sheetId); if (!ws) return;
    const at = spec.at || DEFAULT_AT;
    const k = key(sheetId, i);
    const res = ws.addFloatDomToPosition({ componentKey: 'folio-chart', allowTransform: true, initPosition: { startX: at.x, endX: at.x + at.w, startY: at.y, endY: at.y + at.h }, data: { key: k, label: spec.title || L('Chart') } }, `folio-chart-${k.replace(':', '-')}`);
    if (res) doms.set(k, res.id);
  }
  return {
    renderAll() {
      for (const ws of surface.wb().getSheets()) { const id = ws.getSheetId(); (surface.meta(id).charts || []).forEach((_, i) => place(id, i)); }
    },
    /** forget the drawn charts; with `fromGrid` also take their boxes off the sheets (the workbook stays open) */
    clear(fromGrid = false) {
      if (fromGrid) for (const [k, id] of doms) { try { surface.wb()?.getSheetBySheetId(k.split(':')[0])?.removeFloatDom(id); } catch { /* already gone */ } }
      for (const { inst } of live.values()) inst?.dispose(); live.clear(); doms.clear();
    },
    refreshSoon() { clearTimeout(this._t); this._t = setTimeout(() => this.refresh(), 120); },
    /** the chart positions people dragged, back into the specs */
    sync() {
      for (const [k, id] of doms) {
        const [sid] = k.split(':'); const ws = surface.wb().getSheetBySheetId(sid); const d = ws?.getFloatDomById?.(id); const spec = specOf(k);
        if (!d?.position || !spec) continue;
        const p = d.position, at = { x: Math.round(p.left), y: Math.round(p.top), w: Math.round(p.width), h: Math.round(p.height) };
        // a chart the person has not moved keeps no position in the file (opening a file must not rewrite it)
        if (!spec.at && at.x === DEFAULT_AT.x && at.y === DEFAULT_AT.y && at.w === DEFAULT_AT.w && at.h === DEFAULT_AT.h) continue;
        spec.at = at;
      }
    },
    refresh() { for (const [k, { el }] of live) draw(el, k); },
    add(type) {
      const r = surface.range(); const id = surface.sheetId();
      const a1 = r.getWidth() * r.getHeight() > 1 ? r.getA1Notation() : surface.ws().getDataRange().getA1Notation();
      const list = surface.meta(id).charts ||= [];
      const col = r.getColumn() + r.getWidth() + 1;
      list.push({ type, title: '', range: a1, at: { x: Math.min(1200, 104 * col + 46), y: 40 + 24 * r.getRow(), w: 480, h: 300 } });
      place(id, list.length - 1);
      surface.save();
      ctx.toast(L('Chart added. Double-click it to change its type, data or title.'));
    },
    remove(k) { const [sid, i] = k.split(':'); this.sync(); this.clear(true); surface.meta(sid).charts.splice(Number(i), 1); this.renderAll(); surface.save(); },
    /** change a chart's spec and draw it again */
    update(k, patch) { const spec = specOf(k); if (!spec) return; Object.assign(spec, patch); for (const [key, v] of Object.entries(patch)) if (v == null || v === '') delete spec[key]; const el = live.get(k)?.el; if (el) draw(el, k); surface.save(); },
    redraw(k) { const id = doms.get(k); const [sid] = k.split(':'); const ws = surface.wb().getSheetBySheetId(sid); if (id) ws?.removeFloatDom(id); doms.delete(k); place(sid, Number(k.split(':')[1])); },
    list: () => [...doms.keys()],
    specOf,
  };
}
