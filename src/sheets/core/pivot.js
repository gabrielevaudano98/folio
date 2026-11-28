// Folio Sheets — PivotTables (area 6). A pivot is a readable block in the workbook, so people and AI assistants can
// write one by hand:
//
//   ```pivot Sales by region
//   source: Orders!A1:F100          a range, `query Name` (FQL) or `model Name` (a flattened data model)
//   rows: Region, Product
//   columns: Month
//   values: sum(Total), count(Qty) as Orders
//   filter: Product in Pen, Folder
//   place: Pivot!A1
//   totals: both                    rows | columns | both | none
//   ```
//
// The numbers are computed by pivottable (Nicolas Kruchten, MIT): its PivotData and aggregators, the engine behind
// pivotUI, given rows of records. Pure apart from that library, which needs jQuery's object helpers only.
import $ from './pivot-jquery.js'; // first: jQuery global, with the helpers pivottable still calls
import 'pivottable/dist/pivot.js';

export const AGGREGATORS = { sum: 'Sum', count: 'Count', counta: 'Count', countunique: 'Count Unique Values', avg: 'Average', average: 'Average', min: 'Minimum', max: 'Maximum', median: 'Median', var: 'Sample Variance', stdev: 'Sample Standard Deviation', first: 'First', last: 'Last', list: 'List Unique Values', sumfraction: 'Sum as Fraction of Total' };
export const AGG_LABEL = { sum: 'Sum', count: 'Count', countunique: 'Distinct count', avg: 'Average', min: 'Min', max: 'Max', median: 'Median', var: 'Variance', stdev: 'Std dev', first: 'First', last: 'Last', list: 'List', sumfraction: '% of total' };

const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
/** text of a ```pivot``` block → spec */
export function parsePivot(text) {
  const spec = { source: '', rows: [], columns: [], values: [], filters: [], place: '', totals: 'both' };
  for (const line of String(text).split('\n')) {
    const m = /^\s*([a-z]+)\s*:\s*(.*?)\s*$/i.exec(line); if (!m) continue;
    const [, k, v] = m; const key = k.toLowerCase();
    if (key === 'source') spec.source = v;
    else if (key === 'rows') spec.rows = splitList(v);
    else if (key === 'columns' || key === 'cols') spec.columns = splitList(v);
    else if (key === 'values') spec.values = splitList(v).map((x) => { const a = /^([a-z]+)\s*\(\s*([^)]*?)\s*\)\s*(?:as\s+(.+))?$/i.exec(x); return a ? { agg: a[1].toLowerCase(), field: a[2], as: a[3] || '' } : { agg: 'sum', field: x, as: '' }; });
    else if (key === 'filter' || key === 'filters') for (const part of v.split(';')) { const f = /^\s*(.+?)\s+(not in|in)\s+(.+)$/i.exec(part); if (f) spec.filters.push({ field: f[1], not: /not/i.test(f[2]), values: splitList(f[3]) }); }
    else if (key === 'place') spec.place = v;
    else if (key === 'totals') spec.totals = v.toLowerCase();
  }
  return spec;
}
export function serializePivot(s) {
  const out = [`source: ${s.source}`];
  if (s.rows?.length) out.push(`rows: ${s.rows.join(', ')}`);
  if (s.columns?.length) out.push(`columns: ${s.columns.join(', ')}`);
  if (s.values?.length) out.push(`values: ${s.values.map((v) => `${v.agg}(${v.field})${v.as ? ` as ${v.as}` : ''}`).join(', ')}`);
  if (s.filters?.length) out.push(`filter: ${s.filters.map((f) => `${f.field} ${f.not ? 'not in' : 'in'} ${f.values.join(', ')}`).join('; ')}`);
  if (s.place) out.push(`place: ${s.place}`);
  if (s.totals && s.totals !== 'both') out.push(`totals: ${s.totals}`);
  return out.join('\n');
}

/** grid (row 0 = headers) → records */
export function records(grid) {
  const head = (grid[0] || []).map((h, i) => (h == null || h === '' ? `Column ${i + 1}` : String(h)));
  return grid.slice(1).filter((r) => r.some((v) => v != null && v !== '')).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? null])));
}
const label = (v) => (v.as ? v.as : `${AGG_LABEL[v.agg] || v.agg} of ${v.field}`);

/**
 * compute a pivot → grid. One value: rows × columns; several values: one column per value (and per column key).
 * Fields that are not in the data are an error naming them.
 */
export function computePivot(grid, spec) {
  const data = records(grid);
  const fields = new Set((grid[0] || []).map(String));
  const missing = [...spec.rows, ...spec.columns, ...spec.values.map((v) => v.field), ...spec.filters.map((f) => f.field)].filter((f) => f && !fields.has(f));
  if (missing.length) throw new Error(`No column named ${[...new Set(missing)].join(', ')} in the source.`);
  const keep = (r) => spec.filters.every((f) => { const hit = f.values.some((x) => String(r[f.field] ?? '') === x); return f.not ? !hit : hit; });
  const rows = data.filter(keep);
  const P = $.pivotUtilities;
  const values = spec.values.length ? spec.values : [{ agg: 'count', field: '', as: 'Count' }];
  const pds = values.map((v) => {
    const name = AGGREGATORS[v.agg]; if (!name) throw new Error(`Unknown summary ${v.agg}(): use ${Object.keys(AGG_LABEL).join(', ')}.`);
    const agg = P.aggregators[name](v.agg === 'count' || !v.field ? [] : [v.field]);
    return new P.PivotData(rows, { rows: spec.rows, cols: spec.columns, aggregator: agg, aggregatorName: name });
  });
  const pd = pds[0];
  const rowKeys = pd.getRowKeys(), colKeys = pd.getColKeys();
  const showRowTotals = spec.totals === 'both' || spec.totals === 'rows', showColTotals = spec.totals === 'both' || spec.totals === 'columns';
  // values are written to cells: 15 significant digits, as Excel keeps them (12 × 1.2 is 14.4, not 14.399999999999999)
  const val = (p, rk, ck) => { const a = p.getAggregator(rk, ck); const v = a.value(); return v == null || Number.isNaN(v) ? null : typeof v === 'number' ? Number(v.toPrecision(15)) : v; };
  const out = [];
  const rHead = spec.rows.length ? spec.rows : [''];
  if (!spec.columns.length) {
    out.push([...rHead, ...values.map(label)]);
    for (const rk of rowKeys) out.push([...(spec.rows.length ? rk : ['']), ...pds.map((p) => val(p, rk, []))]);
    if (showColTotals || !spec.rows.length) out.push([...(spec.rows.length ? ['Grand total', ...rHead.slice(1).map(() => '')] : ['Total']), ...pds.map((p) => val(p, [], []))]);
    return out;
  }
  // with columns: one header row per column field, then one column per (column key × value)
  const multi = values.length > 1;
  for (let i = 0; i < spec.columns.length; i++) {
    const head = [...rHead.map((_, j) => (j === rHead.length - 1 ? spec.columns[i] : ''))];
    for (const ck of colKeys) for (let k = 0; k < values.length; k++) head.push(k === 0 ? ck[i] : '');
    if (showRowTotals) for (let k = 0; k < values.length; k++) head.push(i === 0 && k === 0 ? 'Total' : '');
    out.push(head);
  }
  if (multi) out.push([...rHead.map(() => ''), ...colKeys.flatMap(() => values.map(label)), ...(showRowTotals ? values.map(label) : [])]);
  out.push([...rHead, ...Array(out[0].length - rHead.length).fill('')]);
  for (const rk of rowKeys) out.push([...(spec.rows.length ? rk : ['']), ...colKeys.flatMap((ck) => pds.map((p) => val(p, rk, ck))), ...(showRowTotals ? pds.map((p) => val(p, rk, [])) : [])]);
  if (showColTotals) out.push(['Grand total', ...rHead.slice(1).map(() => ''), ...colKeys.flatMap((ck) => pds.map((p) => val(p, [], ck))), ...(showRowTotals ? pds.map((p) => val(p, [], [])) : [])]);
  return out;
}
/** distinct values of a field (for the filter lists), sorted */
export function distinct(grid, field) {
  const i = (grid[0] || []).map(String).indexOf(field); if (i < 0) return [];
  return [...new Set(grid.slice(1).map((r) => (r[i] == null ? '' : String(r[i]))))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
