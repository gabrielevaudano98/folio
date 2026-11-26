// FQL — the compiler and runtime. A parsed program runs on Apache Arrow-style column tables from Arquero
// (Power Query and Power Pivot, areas 11 and 12). Expressions compile to plain closures given to arquero.escape(),
// so no text is ever evaluated as code. Runs in the data engine; the host passes the inputs it gathered
// (sheet ranges, file contents) and optional readers for formats that need a native library (xlsx, sql, parquet).
import * as aq from 'arquero';
import { parse, FqlError } from './parse.js';

const op = aq.op;

/* ---------- values ---------- */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const toNum = (v) => (v == null || v === '' ? null : typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : v instanceof Date ? v.getTime() : Number.isFinite(Number(String(v).replace(',', '.'))) ? Number(String(v).replace(',', '.')) : null);
const toDate = (v) => { if (v == null || v === '') return null; if (v instanceof Date) return v; if (typeof v === 'number') return v > 100000 ? new Date(v) : new Date(Math.round((v - 25569) * 86400000)); const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? null : d; };
const toText = (v) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
const eq = (a, b) => (typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a instanceof Date || b instanceof Date ? toDate(a)?.getTime() === toDate(b)?.getTime() : a == b); // eslint-disable-line eqeqeq

/** scalar functions available in expressions */
export const FUNCTIONS = {
  lower: (s) => toText(s).toLowerCase(), upper: (s) => toText(s).toUpperCase(), trim: (s) => toText(s).trim(), len: (s) => toText(s).length,
  contains: (s, x) => toText(s).toLowerCase().includes(toText(x).toLowerCase()), startswith: (s, x) => toText(s).toLowerCase().startsWith(toText(x).toLowerCase()), endswith: (s, x) => toText(s).toLowerCase().endsWith(toText(x).toLowerCase()),
  replace: (s, a, b) => toText(s).split(toText(a)).join(toText(b)), left: (s, n) => toText(s).slice(0, n), right: (s, n) => (n > 0 ? toText(s).slice(-n) : ''), substr: (s, a, n) => toText(s).substr(Math.max(0, a - 1), n),
  concat: (...a) => a.map(toText).join(''), text: toText, number: toNum, date: toDate,
  round: (x, d = 0) => (toNum(x) == null ? null : Math.round(toNum(x) * 10 ** d) / 10 ** d), floor: (x) => Math.floor(toNum(x)), ceil: (x) => Math.ceil(toNum(x)), abs: (x) => Math.abs(toNum(x)), sqrt: (x) => Math.sqrt(toNum(x)), ln: (x) => Math.log(toNum(x)), exp: (x) => Math.exp(toNum(x)),
  year: (d) => toDate(d)?.getUTCFullYear() ?? null, month: (d) => (toDate(d) ? toDate(d).getUTCMonth() + 1 : null), day: (d) => toDate(d)?.getUTCDate() ?? null, quarter: (d) => (toDate(d) ? Math.floor(toDate(d).getUTCMonth() / 3) + 1 : null), weekday: (d) => (toDate(d) ? ((toDate(d).getUTCDay() + 6) % 7) + 1 : null),
  today: () => new Date(new Date().toISOString().slice(0, 10)), datediff: (a, b, unit = 'day') => { const x = toDate(a), y = toDate(b); if (!x || !y) return null; const ms = y - x; return Math.round(ms / ({ day: 864e5, week: 6048e5, hour: 36e5 }[unit] || 864e5)); },
  if: (c, a, b = null) => (c ? a : b), coalesce: (...a) => a.find((x) => x != null && x !== '') ?? null, isnull: (x) => x == null || x === '',
};

/* ---------- expressions → closures ---------- */
function compile(e, ctx) {
  switch (e.k) {
    case 'lit': return () => e.v;
    case 'col': {
      if (ctx.params && e.col in ctx.params && !e.table) { const v = ctx.params[e.col]; return () => v; }
      const key = e.table ? `${e.table}.${e.col}` : e.col;
      return (d) => { const v = d[key]; if (v === undefined && !ctx.lenient && !(key in d)) throw new FqlError(`No column named ${key}`, e.at); return v; };
    }
    case 'un': { const f = compile(e.e, ctx); return e.op === 'not' ? (d) => !f(d) : (d) => { const v = toNum(f(d)); return v == null ? null : -v; }; }
    case 'in': { const f = compile(e.e, ctx), items = e.list.map((x) => compile(x, ctx)); return (d) => { const v = f(d); return items.some((g) => eq(v, g(d))); }; }
    case 'between': { const f = compile(e.e, ctx), lo = compile(e.lo, ctx), hi = compile(e.hi, ctx); return (d) => { const v = f(d); return v != null && v >= lo(d) && v <= hi(d); }; }
    case 'isnull': { const f = compile(e.e, ctx); return (d) => { const v = f(d); const n = v == null || v === ''; return e.neg ? !n : n; }; }
    case 'call': {
      const fn = FUNCTIONS[e.fn];
      if (!fn) throw new FqlError(`Unknown function ${e.fn}()`, e.at);
      const args = e.args.map((a) => compile(a, ctx));
      return (d) => fn(...args.map((g) => g(d)));
    }
    case 'bin': {
      const l = compile(e.l, ctx), r = compile(e.r, ctx);
      switch (e.op) {
        case 'and': return (d) => !!l(d) && !!r(d);
        case 'or': return (d) => !!l(d) || !!r(d);
        case '==': return (d) => eq(l(d), r(d));
        case '!=': return (d) => !eq(l(d), r(d));
        case '<': case '<=': case '>': case '>=': return (d) => { let a = l(d), b = r(d); if (a == null || b == null) return false; if (a instanceof Date || b instanceof Date) { a = toDate(a)?.getTime(); b = toDate(b)?.getTime(); } return e.op === '<' ? a < b : e.op === '<=' ? a <= b : e.op === '>' ? a > b : a >= b; };
        case '+': return (d) => { const a = l(d), b = r(d); if (typeof a === 'string' && !isNum(toNum(a)) || typeof b === 'string' && !isNum(toNum(b))) return toText(a) + toText(b); const x = toNum(a), y = toNum(b); return x == null || y == null ? null : x + y; };
        default: { const f = { '-': (x, y) => x - y, '*': (x, y) => x * y, '/': (x, y) => (y === 0 ? null : x / y), '%': (x, y) => x % y, '^': (x, y) => x ** y }[e.op]; return (d) => { const x = toNum(l(d)), y = toNum(r(d)); return x == null || y == null ? null : f(x, y); }; }
      }
    }
    default: throw new FqlError(`Cannot compute ${e.k}`);
  }
}

/* ---------- aggregates ---------- */
const AGGS = { sum: 'sum', avg: 'mean', mean: 'mean', average: 'mean', min: 'min', max: 'max', median: 'median', stdev: 'stdev', variance: 'variance', distinct: 'distinct', product: 'product', mode: 'mode', any: 'any', count: 'count' };
/** rollup assignments → arquero ops, with helper columns for aggregates of expressions; post-steps for arithmetic between aggregates */
function planRollup(cols, ctx) {
  const pre = {}, agg = {}, post = [];
  let n = 0;
  const visit = (e) => {
    if (e.k === 'call' && (e.fn in AGGS || e.fn === 'first' || e.fn === 'last')) {
      const id = `__a${n++}`;
      if (e.fn === 'count' && !e.args.length) { agg[id] = op.count(); return { k: 'col', col: id }; }
      const arg = e.args[0];
      if (!arg) throw new FqlError(`${e.fn}() needs a column`, e.at);
      // count(Table) in a model counts rows
      if (e.fn === 'count' && arg.k === 'col' && ctx.tableNames?.has(arg.col)) { agg[id] = op.count(); return { k: 'col', col: id }; }
      let field;
      if (arg.k === 'col') field = arg.table ? `${arg.table}.${arg.col}` : arg.col;
      else { field = `__e${n}`; pre[field] = aq.escape(compile(arg, ctx)); }
      if (e.fn === 'first') agg[id] = op.array_agg(field); else if (e.fn === 'last') agg[id] = op.array_agg(field);
      else agg[id] = op[AGGS[e.fn]](field);
      if (e.fn === 'first' || e.fn === 'last') post.push([id, (d) => { const a = d[id] || []; return e.fn === 'first' ? a[0] ?? null : a[a.length - 1] ?? null; }]);
      return { k: 'col', col: id };
    }
    if (e.k === 'bin') return { ...e, l: visit(e.l), r: visit(e.r) };
    if (e.k === 'un') return { ...e, e: visit(e.e) };
    if (e.k === 'call') return { ...e, args: e.args.map(visit) };
    if (e.k === 'col' && ctx.measures?.has(e.col)) return e; // a measure used inside another measure
    return e;
  };
  const outs = cols.map(({ name, e }) => ({ name, e: visit(e) }));
  return { pre, agg, post, outs };
}

/* ---------- tables ---------- */
/** 2D array (row 0 = header) → arquero table; empty or duplicate headers become Column1, Column2… */
export function tableFromGrid(grid) {
  const rows = (grid || []).filter((r) => r && r.some((v) => v != null && v !== ''));
  if (!rows.length) return aq.table({});
  const seen = new Map();
  const header = rows[0].map((h, i) => { let k = h == null || h === '' ? `Column${i + 1}` : String(h); const c = seen.get(k) || 0; seen.set(k, c + 1); return c ? `${k}${c + 1}` : k; });
  const cols = Object.fromEntries(header.map((h, j) => [h, rows.slice(1).map((r) => normal(r[j]))]));
  return aq.table(cols, header);
}
const normal = (v) => (v === undefined || v === '' ? null : v);
/** arquero table → 2D array with a header row */
export function gridFromTable(t) {
  const names = t.columnNames();
  const out = [names];
  for (const o of t.objects()) out.push(names.map((n) => { const v = o[n]; return v instanceof Date ? v.toISOString().slice(0, 10) : v ?? ''; }));
  return out;
}

/**
 * Run a program.
 * env = { sheets: { "Orders" | "Orders!A1:F9": grid }, files: { path: { text | bytes } }, readers: { xlsx(bytes, sheet), sql(sql, db), parquet(path) } }
 * Returns { results: { queryName: grid }, loads: [{ query, to, sheet, cell }], models: { name: { tables, relations, measures } }, timings }
 */
export async function run(src, env = {}, { only = null, maxRows = 1_000_000, flat = null, name = 'Query' } = {}) {
  const program = typeof src === 'string' ? parse(src, { name }) : src;
  const params = {};
  for (const p of program.params) params[p.name] = compile(p.e, { params })({});
  const ctx = { params };
  const cache = new Map(), busy = new Set(), timings = {};
  const queries = new Map(program.queries.map((q) => [q.name.toLowerCase(), q]));
  const models = new Map(program.models.map((m) => [m.name.toLowerCase(), m]));

  async function sourceTable(s) {
    switch (s.kind) {
      case 'sheet': { const key = s.range ? `${s.sheet}!${s.range}` : s.sheet; const g = env.sheets?.[key] ?? env.sheets?.[s.sheet]; if (!g) throw new FqlError(`No sheet named ${s.sheet}`, s.at); return tableFromGrid(g); }
      case 'csv': { const f = file(s); return aq.fromCSV(f.text ?? new TextDecoder().decode(f.bytes), { delimiter: s.options?.delimiter, header: s.options?.header !== false, autoType: s.options?.types !== false }); }
      case 'json': { const f = file(s); const v = JSON.parse(f.text ?? new TextDecoder().decode(f.bytes)); return Array.isArray(v) ? aq.from(v) : aq.from(v.data || v.rows || Object.values(v)[0] || []); }
      case 'xlsx': { const f = file(s); if (!env.readers?.xlsx) throw new FqlError('Reading Excel files needs the data engine', s.at); return tableFromGrid(await env.readers.xlsx(f.bytes, s.sheet)); }
      case 'parquet': if (!env.readers?.sql) throw new FqlError('Parquet files are read by DuckDB: install it in Settings → Optional features', s.at); return tableFromGrid(await env.readers.sql(`SELECT * FROM read_parquet(${sqlStr(s.path)})`, null, [s.path]));
      case 'sql': if (!env.readers?.sql) throw new FqlError('SQL needs DuckDB: install it in Settings → Optional features', s.at); return tableFromGrid(await env.readers.sql(s.sql, s.db || null));
      case 'query': return queryTable(s.name, s.at);
      case 'model': return evaluateModel(s);
      case 'values': return tableFromGrid([s.header, ...s.rows]);
      default: throw new FqlError(`Unknown source ${s.kind}`, s.at);
    }
  }
  const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;
  function file(s) { const f = env.files?.[s.path]; if (!f) throw new FqlError(`File not found: ${s.path}`, s.at); return f; }

  async function pipeline(p) {
    let t = await sourceTable(p.source);
    let groups = null;
    for (const st of p.steps) {
      const names = new Set(t.columnNames());
      const need = (c) => { if (!names.has(c)) throw new FqlError(`No column named ${c}. Columns: ${[...names].join(', ')}`, st.at); return c; };
      switch (st.op) {
        case 'where': t = t.filter(aq.escape(compile(st.e, ctx))); break;
        case 'derive': for (const c of st.cols) t = t.derive({ [c.name]: aq.escape(compile(c.e, ctx)) }); break;
        case 'select': t = t.select(st.cols.map(need)); break;
        case 'drop': t = t.select(aq.not(st.cols.map(need))); break;
        case 'rename': t = t.rename(Object.fromEntries(st.pairs.map(([a, b]) => [need(a), b]))); break;
        case 'groupby': groups = st.cols.map(need); t = t.groupby(groups); break;
        case 'rollup': {
          const plan = planRollup(st.cols, ctx);
          if (Object.keys(plan.pre).length) t = t.derive(plan.pre);
          t = t.rollup(plan.agg);
          for (const [id, f] of plan.post) t = t.derive({ [id]: aq.escape(f) });
          t = t.derive(Object.fromEntries(plan.outs.map(({ name, e }) => [name, aq.escape(compile(e, ctx))])));
          t = t.select([...(groups || []), ...plan.outs.map((o) => o.name)]);
          groups = null; t = t.ungroup(); break;
        }
        case 'orderby': t = t.orderby(st.keys.map((k) => (k.desc ? aq.desc(need(k.col)) : need(k.col)))); break;
        case 'join': {
          const other = await queryTable(st.other, st.at);
          need(st.on[0]); if (!other.columnNames().includes(st.on[1])) throw new FqlError(`${st.other} has no column ${st.on[1]}`, st.at);
          const fn = { inner: 'join', left: 'join_left', right: 'join_right', full: 'join_full' }[st.how];
          t = t[fn](other, [[st.on[0]], [st.on[1]]]); break;
        }
        case 'pivot': t = t.groupby(aq.not([need(st.key), need(st.value)])).pivot(st.key, { [st.value]: op[AGGS[st.agg] || 'sum'](st.value) }).ungroup(); break;
        case 'unpivot': t = t.fold(st.cols.map(need), { as: st.as }); break;
        case 'dedupe': t = st.cols.length ? t.dedupe(st.cols.map(need)) : t.dedupe(); break;
        case 'fill': for (const c of st.cols) t = t.derive({ [need(c)]: st.dir === 'down' ? op.fill_down(c) : op.fill_up(c) }); break;
        case 'limit': t = t.slice(0, st.n); break;
        case 'type': for (const [c, ty] of st.cols) { need(c); const f = { number: toNum, text: toText, date: toDate, bool: (v) => (v == null ? null : /^(true|yes|1|sì|si)$/i.test(String(v))) }[ty]; t = t.derive({ [c]: aq.escape((d) => f(d[c])) }); } break;
        case 'split': { need(st.col); const parts = st.into; t = t.derive(Object.fromEntries(parts.map((p, i) => [p, aq.escape((d) => toText(d[st.col]).split(st.sep)[i]?.trim() ?? null)]))); break; }
        case 'append': t = t.concat(await queryTable(st.other, st.at)); break;
        case 'load': break;
        default: throw new FqlError(`Unknown step ${st.op}`, st.at);
      }
      if (t.numRows() > maxRows) throw new FqlError(`More than ${maxRows} rows: add a filter or a limit`, st.at);
    }
    return t;
  }
  async function queryTable(name, at) {
    const key = name.toLowerCase();
    if (cache.has(key)) return cache.get(key);
    const q = queries.get(key); if (!q) throw new FqlError(`No query named ${name}`, at);
    if (busy.has(key)) throw new FqlError(`The query ${name} depends on itself`, at);
    busy.add(key); const t0 = Date.now();
    try { const t = await pipeline(q); cache.set(key, t); timings[q.name] = Date.now() - t0; return t; } finally { busy.delete(key); }
  }

  /* ---------- the data model (Power Pivot) ---------- */
  const modelCache = new Map();
  async function loadModel(name, at) {
    const key = name.toLowerCase();
    if (modelCache.has(key)) return modelCache.get(key);
    const m = models.get(key); if (!m) throw new FqlError(`No model named ${name}`, at);
    const tables = new Map();
    for (const t of m.tables) tables.set(t.name, await pipeline(t));
    for (const r of m.relations) for (const side of [r.from, r.to]) { const t = tables.get(side.table); if (!t) throw new FqlError(`The model has no table ${side.table}`, r.at); if (!t.columnNames().includes(side.col)) throw new FqlError(`${side.table} has no column ${side.col}`, r.at); }
    const out = { m, tables };
    modelCache.set(key, out);
    return out;
  }
  /**
   * evaluate measures by dimension columns: start from the fact table (the table the measures aggregate), follow
   * relations (many → one) to every table a dimension comes from, then group and aggregate.
   */
  async function evaluateModel(s) {
    const { m, tables } = await loadModel(s.model, s.at);
    const measures = new Map(m.measures.map((x) => [x.name.toLowerCase(), x]));
    const wanted = s.measures.map((n) => { const x = measures.get(n.toLowerCase()); if (!x) throw new FqlError(`The model has no measure ${n}`, s.at); return x; });
    // expand measure references (Revenue / Orders) into their definitions
    const expand = (e, depth = 0) => {
      if (depth > 20) throw new FqlError('Measures refer to each other in a loop', s.at);
      if (e.k === 'col' && !e.table && measures.has(e.col.toLowerCase())) return expand(measures.get(e.col.toLowerCase()).e, depth + 1);
      if (e.k === 'bin') return { ...e, l: expand(e.l, depth), r: expand(e.r, depth) };
      if (e.k === 'un') return { ...e, e: expand(e.e, depth) };
      if (e.k === 'call') return { ...e, args: e.args.map((a) => expand(a, depth)) };
      return e;
    };
    const exprs = wanted.map((x) => ({ name: x.name, e: expand(x.e) }));
    const used = new Set();
    const walk = (e) => { if (e.k === 'col' && e.table) used.add(e.table); else if (e.k === 'col' && tables.has(e.col)) used.add(e.col); if (e.l) walk(e.l); if (e.r) walk(e.r); if (e.e) walk(e.e); (e.args || []).forEach(walk); };
    exprs.forEach((x) => walk(x.e));
    const fact = [...used][0] || m.tables[0].name;
    // prefix every column with its table: Orders.Total
    const prefixed = (name) => tables.get(name).rename(Object.fromEntries(tables.get(name).columnNames().map((c) => [c, `${name}.${c}`])));
    let t = prefixed(fact);
    const joined = new Set([fact]);
    const needTables = new Set([...used, ...s.by.map((b) => b.table).filter(Boolean)]);
    // breadth-first along relations from the fact table
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of m.relations) {
        if (joined.has(r.from.table) && !joined.has(r.to.table) && needTables.has(r.to.table)) {
          t = t.join_left(prefixed(r.to.table), [[`${r.from.table}.${r.from.col}`], [`${r.to.table}.${r.to.col}`]]); joined.add(r.to.table); grew = true;
        }
      }
    }
    for (const n of needTables) if (!joined.has(n)) throw new FqlError(`No relation leads from ${fact} to ${n}`, s.at);
    const by = s.by.map((b) => { const c = b.table ? `${b.table}.${b.col}` : `${fact}.${b.col}`; if (!t.columnNames().includes(c)) throw new FqlError(`No column ${c} in the model`, s.at); return c; });
    const mctx = { ...ctx, tableNames: new Set(tables.keys()) };
    // unqualified column names inside measures belong to the fact table
    const qualify = (e) => { if (e.k === 'col' && !e.table && !tables.has(e.col)) return { ...e, table: fact }; if (e.k === 'bin') return { ...e, l: qualify(e.l), r: qualify(e.r) }; if (e.k === 'un') return { ...e, e: qualify(e.e) }; if (e.k === 'call') return { ...e, args: e.args.map(qualify) }; return e; };
    const plan = planRollup(exprs.map((x) => ({ name: x.name, e: qualify(x.e) })), mctx);
    if (Object.keys(plan.pre).length) t = t.derive(plan.pre);
    if (by.length) t = t.groupby(by);
    t = t.rollup(plan.agg);
    for (const [id, f] of plan.post) t = t.derive({ [id]: aq.escape(f) });
    t = t.derive(Object.fromEntries(plan.outs.map(({ name, e }) => [name, aq.escape(compile(e, mctx))])));
    t = t.select([...by, ...plan.outs.map((o) => o.name)]).ungroup();
    return t.rename(Object.fromEntries(by.map((c) => [c, c.split('.').slice(1).join('.') || c])));
  }

  if (flat) {
    // the model as one table (Orders.Total, Regions.Name…), joined along every relation from its first table: the pivot table's input
    const { m, tables } = await loadModel(flat);
    const pre = (name) => tables.get(name).rename(Object.fromEntries(tables.get(name).columnNames().map((c) => [c, `${name}.${c}`])));
    let t = pre(m.tables[0].name); const joined = new Set([m.tables[0].name]); let grew = true;
    while (grew) { grew = false; for (const r of m.relations) if (joined.has(r.from.table) && !joined.has(r.to.table)) { t = t.join_left(pre(r.to.table), [[`${r.from.table}.${r.from.col}`], [`${r.to.table}.${r.to.col}`]]); joined.add(r.to.table); grew = true; } }
    return { flat: gridFromTable(t), measures: m.measures.map((x) => x.name) };
  }
  const results = {}, loads = [];
  for (const q of program.queries) {
    if (only && !only.includes(q.name)) continue;
    const t = await queryTable(q.name, q.at);
    results[q.name] = gridFromTable(t);
    const load = q.steps.find((s) => s.op === 'load');
    if (load) loads.push({ query: q.name, to: load.to, sheet: load.sheet, cell: load.cell, name: load.name });
  }
  const modelsOut = {};
  for (const m of program.models) {
    const { tables } = await loadModel(m.name, m.at);
    modelsOut[m.name] = { tables: Object.fromEntries([...tables].map(([n, t]) => [n, { columns: t.columnNames(), rows: t.numRows() }])), relations: m.relations.map((r) => `${r.from.table}.${r.from.col} -> ${r.to.table}.${r.to.col}`), measures: m.measures.map((x) => x.name) };
  }
  return { results, loads, models: modelsOut, timings };
}

