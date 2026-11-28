// Folio Sheets — conditional formatting to and from .xlsx (area 9). Univer's rules (sheet-md `cf`) ⇄ Excel's
// <conditionalFormatting> with their differential styles (dxf). Used by io.js in the data engine.
//
//   Univer                                   Excel
//   highlightCell / number                   cellIs (operator, formula1, formula2)
//   highlightCell / text                     containsText, notContainsText, beginsWith, endsWith, cellIs equal/notEqual,
//                                            containsBlanks, notContainsBlanks, containsErrors, notContainsErrors
//   highlightCell / timePeriod               timePeriod (+ Excel's own formula for it)
//   highlightCell / average                  aboveAverage
//   highlightCell / rank                     top10
//   highlightCell / duplicate|uniqueValues   duplicateValues, uniqueValues
//   highlightCell / formula                  expression
//   dataBar, colorScale, iconSet             dataBar, colorScale, iconSet (cfvo + colours / icon set)
//
// A rule Excel cannot express (an average "equal to", icons mixed from several sets) is left out of the export; the
// sheet-md file keeps it. Every rule that is written reads back as the same rule (tested).
import { toExcelFormula, fromExcelFormula } from './xlsx-formula.js';
import { addDxf, makeDifferentialStyle, makeFont, makePatternFill } from 'xlsx-kit/styles';
import * as W from 'xlsx-kit/worksheet';
import { addr, fromRange } from '../core/a1.js';

const hex6 = (c) => {
  const s = String(c || '').trim();
  let m = /^#?([0-9a-f]{6})$/i.exec(s); if (m) return m[1].toUpperCase();
  m = /^#?([0-9a-f]{3})$/i.exec(s); if (m) return m[1].split('').map((x) => x + x).join('').toUpperCase();
  m = /^rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s); if (m) return [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('').toUpperCase();
  return null;
};
const argb = (c) => { const h = hex6(c); return h ? 'FF' + h : null; };
const css = (rgb) => (rgb && /^[0-9a-f]{6,8}$/i.test(rgb) ? '#' + rgb.slice(-6).toLowerCase() : null);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const num = (v) => (typeof v === 'number' ? String(v) : String(v ?? '').replace(/^=/, ''));
const textLit = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;

/* ---------- styles: Univer IStyleBase ⇄ Excel dxf ---------- */
function dxfOf(style = {}) {
  const font = {};
  if (style.bl) font.bold = true;
  if (style.it) font.italic = true;
  if (style.ul?.s) font.underline = 'single';
  if (style.st?.s) font.strike = true;
  if (style.cl?.rgb && argb(style.cl.rgb)) font.color = { rgb: argb(style.cl.rgb) };
  const bg = style.bg?.rgb && argb(style.bg.rgb);
  return makeDifferentialStyle({
    ...(Object.keys(font).length ? { font: makeFont(font) } : {}),
    // a dxf's solid fill is read from bgColor by Excel
    ...(bg ? { fill: makePatternFill({ patternType: 'solid', fgColor: { rgb: bg }, bgColor: { rgb: bg } }) } : {}),
  });
}
function styleOf(dxf) {
  if (!dxf) return {};
  const s = {}; const f = dxf.font || {}; const fill = dxf.fill;
  if (f.bold) s.bl = 1; if (f.italic) s.it = 1; if (f.underline && f.underline !== 'none') s.ul = { s: 1 }; if (f.strike) s.st = { s: 1 };
  if (css(f.color?.rgb)) s.cl = { rgb: css(f.color.rgb) };
  const bg = css(fill?.bgColor?.rgb) || css(fill?.fgColor?.rgb);
  if (bg) s.bg = { rgb: bg };
  return s;
}

/* ---------- formulas Excel writes for some rule types (relative to the range's top-left cell) ---------- */
const PERIOD = {
  today: (a) => `FLOOR(${a},1)=TODAY()`, yesterday: (a) => `FLOOR(${a},1)=TODAY()-1`, tomorrow: (a) => `FLOOR(${a},1)=TODAY()+1`,
  last7Days: (a) => `AND(TODAY()-FLOOR(${a},1)<=6,FLOOR(${a},1)<=TODAY())`,
  thisMonth: (a) => `AND(MONTH(${a})=MONTH(TODAY()),YEAR(${a})=YEAR(TODAY()))`,
  lastMonth: (a) => `AND(MONTH(${a})=MONTH(EDATE(TODAY(),0-1)),YEAR(${a})=YEAR(EDATE(TODAY(),0-1)))`,
  nextMonth: (a) => `AND(MONTH(${a})=MONTH(EDATE(TODAY(),0+1)),YEAR(${a})=YEAR(EDATE(TODAY(),0+1)))`,
  thisWeek: (a) => `AND(TODAY()-ROUNDDOWN(${a},0)<=WEEKDAY(TODAY())-1,ROUNDDOWN(${a},0)-TODAY()<=7-WEEKDAY(TODAY()))`,
  lastWeek: (a) => `AND(TODAY()-ROUNDDOWN(${a},0)>=(WEEKDAY(TODAY())),TODAY()-ROUNDDOWN(${a},0)<(WEEKDAY(TODAY())+7))`,
  nextWeek: (a) => `AND(ROUNDDOWN(${a},0)-TODAY()>(7-WEEKDAY(TODAY())),ROUNDDOWN(${a},0)-TODAY()<(15-WEEKDAY(TODAY())))`,
};
const TEXT = {
  containsText: ['containsText', (a, t) => `NOT(ISERROR(SEARCH(${textLit(t)},${a})))`],
  notContainsText: ['notContainsText', (a, t) => `ISERROR(SEARCH(${textLit(t)},${a}))`, 'notContains'],
  beginsWith: ['beginsWith', (a, t) => `LEFT(${a},LEN(${textLit(t)}))=${textLit(t)}`],
  endsWith: ['endsWith', (a, t) => `RIGHT(${a},LEN(${textLit(t)}))=${textLit(t)}`],
  containsBlanks: ['containsBlanks', (a) => `LEN(TRIM(${a}))=0`],
  notContainsBlanks: ['notContainsBlanks', (a) => `LEN(TRIM(${a}))>0`],
  containsErrors: ['containsErrors', (a) => `ISERROR(${a})`],
  notContainsErrors: ['notContainsErrors', (a) => `NOT(ISERROR(${a}))`],
};
const cfvoXml = (v = {}) => `<cfvo type="${esc(v.type || 'min')}"${v.value != null && !['min', 'max'].includes(v.type) ? ` val="${esc(num(v.value))}"` : ''}/>`;

/** Univer rules of one sheet → Excel conditional formatting on `ws`; returns how many rules were written */
export function writeConditionalFormatting(wb, ws, rules = []) {
  let priority = 0, written = 0;
  for (const cf of rules) {
    const r = cf.rule || {}; const ranges = cf.ranges || []; if (!ranges.length) continue;
    const sqref = ranges.map(fromRange).join(' ');
    const a = addr(ranges[0].startRow, ranges[0].startColumn);
    const base = { priority: ++priority, ...(cf.stopIfTrue ? { stopIfTrue: true } : {}) };
    const dxf = () => addDxf(wb.styles, dxfOf(r.style));
    let rule = null;
    if (r.type === 'highlightCell') {
      const st = r.subType;
      if (st === 'number') {
        const two = r.operator === 'between' || r.operator === 'notBetween';
        const vals = two ? (Array.isArray(r.value) ? r.value : [r.value, r.value]) : [r.value];
        if (vals.some((v) => v == null || v === '')) continue;
        rule = { type: 'cellIs', operator: r.operator, formulas: vals.map(num) };
      } else if (st === 'text') {
        if (r.operator === 'equal' || r.operator === 'notEqual') rule = { type: 'cellIs', operator: r.operator, formulas: [textLit(r.value)] };
        else if (TEXT[r.operator]) { const [type, f, op] = TEXT[r.operator]; rule = { type, ...(/Text|With/.test(type) ? { operator: op || type, text: String(r.value ?? '') } : {}), formulas: [f(a, r.value)] }; }
      } else if (st === 'timePeriod' && PERIOD[r.operator]) rule = { type: 'timePeriod', timePeriod: r.operator, formulas: [PERIOD[r.operator](a)] };
      else if (st === 'average') {
        const map = { greaterThan: [true, false], greaterThanOrEqual: [true, true], lessThan: [false, false], lessThanOrEqual: [false, true] }[r.operator];
        if (!map) continue; // "equal to the average" has no Excel rule
        rule = { type: 'aboveAverage', aboveAverage: map[0], ...(map[1] ? { equalAverage: true } : {}), formulas: [] };
      } else if (st === 'rank') rule = { type: 'top10', rank: Number(r.value) || 10, ...(r.isBottom ? { bottom: true } : {}), ...(r.isPercent ? { percent: true } : {}), formulas: [] };
      else if (st === 'duplicateValues' || st === 'uniqueValues') rule = { type: st, formulas: [] };
      else if (st === 'formula' && r.value) rule = { type: 'expression', formulas: [toExcelFormula(num(r.value))] };
      if (rule) rule.dxfId = dxf();
    } else if (r.type === 'colorScale') {
      const cfg = [...(r.config || [])].sort((x, y) => x.index - y.index);
      if (cfg.length < 2 || cfg.length > 3 || cfg.some((x) => !argb(x.color))) continue;
      rule = { type: 'colorScale', formulas: [], innerXml: `<colorScale>${cfg.map((x) => cfvoXml(x.value)).join('')}${cfg.map((x) => `<color rgb="${argb(x.color)}"/>`).join('')}</colorScale>` };
    } else if (r.type === 'dataBar') {
      const c = r.config || {}; const col = argb(c.positiveColor); if (!col) continue;
      rule = { type: 'dataBar', formulas: [], innerXml: `<dataBar${r.isShowValue === false ? ' showValue="0"' : ''}>${cfvoXml(c.min)}${cfvoXml(c.max)}<color rgb="${col}"/></dataBar>` };
    } else if (r.type === 'iconSet') {
      const cfg = r.config || [];
      const set = cfg[0]?.iconType; const n = cfg.length;
      if (!set || !/^[345]/.test(set) || Number(set[0]) !== n || cfg.some((x) => x.iconType !== set)) continue; // one Excel icon set only
      const ids = cfg.map((x) => Number(x.iconId));
      const reverse = ids.every((v, i) => v === n - 1 - i) ? true : ids.every((v, i) => v === i) ? false : null;
      if (reverse === null) continue;
      // Univer lists icons from the highest threshold down; Excel lists thresholds from the lowest up
      const thresholds = cfg.slice(0, -1).map((x) => x.value).reverse();
      rule = { type: 'iconSet', formulas: [], innerXml: `<iconSet iconSet="${esc(set)}"${reverse ? ' reverse="1"' : ''}${r.isShowValue === false ? ' showValue="0"' : ''}><cfvo type="percent" val="0"/>${thresholds.map(cfvoXml).join('')}</iconSet>` };
    }
    if (!rule) continue;
    W.addConditionalFormatting(ws, W.makeConditionalFormatting({ sqref, rules: [W.makeCfRule({ ...base, ...rule })] }));
    written++;
  }
  return written;
}

/* ---------- import ---------- */
const attr = (xml, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(xml)?.[1];
const unNum = (v) => { const s = String(v ?? '').trim(); return /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(s) ? Number(s) : s; };
const unText = (f) => { const m = /^"((?:[^"]|"")*)"$/.exec(String(f || '').trim()); return m ? m[1].replace(/""/g, '"') : null; };
const cfvos = (xml) => [...String(xml).matchAll(/<cfvo\b([^>]*)\/?>/g)].map((m) => ({ type: attr(m[1], 'type') || 'min', ...(attr(m[1], 'val') != null ? { value: unNum(attr(m[1], 'val')) } : {}) }));
const colors = (xml) => [...String(xml).matchAll(/<color\b([^>]*)\/?>/g)].map((m) => css(attr(m[1], 'rgb')) || '#000000');
const TEXT_IN = { containsText: 'containsText', notContainsText: 'notContainsText', beginsWith: 'beginsWith', endsWith: 'endsWith', containsBlanks: 'containsBlanks', notContainsBlanks: 'notContainsBlanks', containsErrors: 'containsErrors', notContainsErrors: 'notContainsErrors' };

/** Excel conditional formatting of `ws` → Univer rules (ranges as { startRow, … }) */
export function readConditionalFormatting(wb, ws, sheetKey) {
  const dxfs = wb.styles?.dxfs || [];
  const out = []; let k = 0;
  for (const cf of ws.conditionalFormatting || []) {
    const ranges = (cf.sqref?.ranges || []).map((g) => ({ startRow: g.minRow - 1, endRow: g.maxRow - 1, startColumn: g.minCol - 1, endColumn: g.maxCol - 1, rangeType: 0 }));
    if (!ranges.length) continue;
    for (const x of [...(cf.rules || [])].sort((p, q) => (p.priority || 0) - (q.priority || 0))) {
      const style = styleOf(dxfs[x.dxfId]);
      const f = x.formulas || [];
      let rule = null;
      if (x.type === 'cellIs') {
        const t = unText(f[0]);
        if (t != null && (x.operator === 'equal' || x.operator === 'notEqual')) rule = { type: 'highlightCell', subType: 'text', operator: x.operator, value: t, style };
        else if (['between', 'notBetween'].includes(x.operator)) rule = { type: 'highlightCell', subType: 'number', operator: x.operator, value: [unNum(f[0]), unNum(f[1])], style };
        else if (x.operator) rule = { type: 'highlightCell', subType: 'number', operator: x.operator, value: unNum(f[0]), style };
      } else if (TEXT_IN[x.type]) rule = { type: 'highlightCell', subType: 'text', operator: TEXT_IN[x.type], ...(x.text != null ? { value: x.text } : {}), style };
      else if (x.type === 'timePeriod' && x.timePeriod) rule = { type: 'highlightCell', subType: 'timePeriod', operator: x.timePeriod, style };
      else if (x.type === 'aboveAverage') rule = { type: 'highlightCell', subType: 'average', operator: (x.aboveAverage === false ? 'lessThan' : 'greaterThan') + (x.equalAverage ? 'OrEqual' : ''), style };
      else if (x.type === 'top10') rule = { type: 'highlightCell', subType: 'rank', isBottom: !!x.bottom, isPercent: !!x.percent, value: x.rank ?? 10, style };
      else if (x.type === 'duplicateValues' || x.type === 'uniqueValues') rule = { type: 'highlightCell', subType: x.type, style };
      else if (x.type === 'expression' && f[0]) rule = { type: 'highlightCell', subType: 'formula', value: '=' + fromExcelFormula(String(f[0]).replace(/^=/, '')), style };
      else if (x.type === 'colorScale') { const v = cfvos(x.innerXml), c = colors(x.innerXml); if (v.length >= 2) rule = { type: 'colorScale', config: v.map((value, index) => ({ index, color: c[index] || '#000000', value })) }; }
      else if (x.type === 'dataBar') { const v = cfvos(x.innerXml), c = colors(x.innerXml); rule = { type: 'dataBar', isShowValue: attr(x.innerXml || '', 'showValue') !== '0', config: { min: v[0] || { type: 'min' }, max: v[1] || { type: 'max' }, isGradient: false, positiveColor: c[0] || '#638ec6', nativeColor: '#ff0000' } }; }
      else if (x.type === 'iconSet') {
        const xml = x.innerXml || ''; const set = attr(xml, 'iconSet') || '3TrafficLights1'; const n = Number(set[0]) || 3;
        const v = cfvos(xml); const reverse = attr(xml, 'reverse') === '1';
        const th = v.slice(1).reverse(); // highest threshold first, as Univer lists them
        rule = { type: 'iconSet', isShowValue: attr(xml, 'showValue') !== '0', config: Array.from({ length: n }, (_, i) => ({ operator: i < n - 1 ? 'greaterThanOrEqual' : 'lessThan', value: i < n - 1 ? th[i] || { type: 'percent', value: 0 } : th[n - 2] || { type: 'percent', value: 0 }, iconType: set, iconId: String(reverse ? n - 1 - i : i) })) };
      }
      if (rule) out.push({ cfId: `cf-${sheetKey}-${++k}`, ranges, stopIfTrue: !!x.stopIfTrue, rule });
    }
  }
  return out;
}
