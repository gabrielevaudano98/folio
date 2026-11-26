// FQL — Folio Query Language. Power Query (ETL) and Power Pivot (data model) for Folio Sheets, as readable text that
// lives in the workbook (```fql Name``` blocks) and that people and AI assistants can write. Specification: docs/FQL.md.
//
//   query Orders =
//     from csv "data/orders.csv"
//     | where Qty > 0 and Region in ("EU", "US")
//     | derive Total = Qty * Price, Year = year(Date)
//     | groupby Region, Year
//     | rollup Revenue = sum(Total), Orders = count()
//     | orderby -Revenue
//     | load to sheet "Summary" at A1
//
//   model Sales
//     table Orders = query Orders
//     table Regions = from sheet "Regions"
//     relate Orders.Region -> Regions.Code
//     measure Revenue = sum(Orders.Total)
//     measure `Avg order` = Revenue / count(Orders)
//
// This file is the lexer and the parser: text → AST, with line and column in every error. Pure, no dependencies.

export class FqlError extends Error {
  constructor(msg, at) { super(at ? `${msg} (line ${at.line}, column ${at.col})` : msg); this.at = at; this.plain = msg; }
}

const KEYWORDS = new Set(['query', 'model', 'let', 'from', 'where', 'derive', 'select', 'drop', 'rename', 'groupby', 'rollup', 'orderby', 'join', 'pivot', 'unpivot', 'dedupe', 'fill', 'limit', 'type', 'split', 'append', 'load', 'to', 'at', 'as', 'by', 'on', 'using', 'into', 'and', 'or', 'not', 'in', 'is', 'null', 'true', 'false', 'between', 'table', 'relate', 'measure', 'evaluate', 'sheet', 'range', 'csv', 'json', 'xlsx', 'parquet', 'sql', 'values', 'left', 'right', 'inner', 'full', 'down', 'up', 'with']);
// words that are keywords only where the grammar expects them; elsewhere they are ordinary names (a column called "type")
const SOFT = new Set(['table', 'sheet', 'range', 'csv', 'json', 'xlsx', 'parquet', 'sql', 'values', 'left', 'right', 'inner', 'full', 'down', 'up', 'type', 'split', 'fill', 'with', 'using', 'into', 'at', 'to', 'measure', 'relate', 'evaluate', 'load', 'append']);

/* ---------- lexer ---------- */
export function lex(src) {
  const toks = []; let i = 0, line = 1, col = 1;
  const at = () => ({ line, col });
  const adv = (n = 1) => { for (let k = 0; k < n; k++) { if (src[i] === '\n') { line++; col = 1; } else col++; i++; } };
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { toks.push({ t: 'nl', at: at() }); adv(); continue; }
    if (/\s/.test(c)) { adv(); continue; }
    if (c === '-' && src[i + 1] === '-') { while (i < src.length && src[i] !== '\n') adv(); continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') adv(); continue; }
    const p = at();
    if (c === '"' || c === "'") {
      let s = ''; adv();
      while (i < src.length && src[i] !== c) { if (src[i] === '\\' && i + 1 < src.length) { adv(); s += { n: '\n', t: '\t' }[src[i]] ?? src[i]; adv(); continue; } if (src[i] === '\n') throw new FqlError('Text is not closed', p); s += src[i]; adv(); }
      if (src[i] !== c) throw new FqlError('Text is not closed', p);
      adv(); toks.push({ t: 'str', v: s, at: p }); continue;
    }
    if (c === '`') {
      let s = ''; adv();
      while (i < src.length && src[i] !== '`') { if (src[i] === '\n') throw new FqlError('Name in backticks is not closed', p); s += src[i]; adv(); }
      if (src[i] !== '`') throw new FqlError('Name in backticks is not closed', p);
      adv(); toks.push({ t: 'id', v: s, quoted: true, at: p }); continue;
    }
    let m = /^(\d+\.?\d*(e[-+]?\d+)?|\.\d+(e[-+]?\d+)?)/i.exec(src.slice(i));
    if (m) { adv(m[0].length); toks.push({ t: 'num', v: Number(m[0]), at: p }); continue; }
    m = /^[A-Za-z_À-￿][\wÀ-￿]*/.exec(src.slice(i));
    if (m) {
      adv(m[0].length);
      // A1 cell references after "at" / "range" are read by the parser from the identifier
      const w = m[0], lw = w.toLowerCase();
      toks.push(KEYWORDS.has(lw) ? { t: 'kw', v: lw, raw: w, at: p } : { t: 'id', v: w, at: p });
      continue;
    }
    m = /^(->|==|!=|<>|<=|>=|[-+*/%^(),.=<>|:\[\]!$])/.exec(src.slice(i));
    if (m) { adv(m[0].length); toks.push({ t: 'op', v: m[0], at: p }); continue; }
    throw new FqlError(`Unexpected character "${c}"`, p);
  }
  toks.push({ t: 'eof', at: at() });
  return toks;
}

const STEPS = ['where', 'derive', 'select', 'drop', 'rename', 'groupby', 'rollup', 'orderby', 'join', 'pivot', 'unpivot', 'dedupe', 'fill', 'limit', 'type', 'split', 'append', 'load'];
function distance(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
const closest = (w, list) => { let best = null, bd = 3; for (const x of list) { const v = distance(w.toLowerCase(), x); if (v < bd) { bd = v; best = x; } } return best; };

/* ---------- parser ---------- */
/** `name`: the query name a bare pipeline gets (a ```fql Name``` block that holds only `from … | …`) */
export function parse(src, { name: bareName = 'Query' } = {}) {
  const toks = lex(src); let k = 0;
  const peek = (o = 0) => toks[k + o];
  const next = () => toks[k++];
  const isKw = (v, o = 0) => peek(o).t === 'kw' && peek(o).v === v;
  const isOp = (v, o = 0) => peek(o).t === 'op' && peek(o).v === v;
  const skipNl = () => { while (peek().t === 'nl') k++; };
  const want = (cond, what) => { if (!cond) throw new FqlError(`Expected ${what}, found ${desc(peek())}`, peek().at); return next(); };
  const kw = (v) => want(isKw(v), `"${v}"`);
  const op = (v) => want(isOp(v), `"${v}"`);
  const desc = (t) => (t.t === 'eof' ? 'the end' : t.t === 'nl' ? 'a new line' : t.t === 'str' ? `"${t.v}"` : `"${t.raw ?? t.v}"`);
  // in a pipeline, new lines are allowed before "|" and after ","
  const nlBeforePipe = () => { let o = 0; while (peek(o).t === 'nl') o++; if (isOp('|', o)) { k += o; return true; } return false; };

  /** a name: identifier, `quoted name`, or a soft keyword used as a name */
  function name(what = 'a name') {
    const t = peek();
    if (t.t === 'id') return next().v;
    if (t.t === 'kw' && SOFT.has(t.v)) return next().raw;
    throw new FqlError(`Expected ${what}, found ${desc(t)}`, t.at);
  }
  const isName = (o = 0) => peek(o).t === 'id' || (peek(o).t === 'kw' && SOFT.has(peek(o).v));
  function list(item) { const out = [item()]; while (isOp(',')) { next(); skipNl(); out.push(item()); } return out; }
  /** "Orders.Total" or "Total" */
  function colRef() { const a = name('a column'); if (isOp('.') && isName(1)) { next(); return { table: a, col: name('a column') }; } return { col: a }; }
  /** cell or range: A1, $B$2, A1:C10, A:C */
  function cellRange() {
    let s = '';
    const part = () => { while (isOp('$')) s += next().v; const t = next(); if (t.t !== 'id' && t.t !== 'num') throw new FqlError(`Expected a cell like A1, found ${desc(t)}`, t.at); s += String(t.v); if (t.t === 'id' && /^[A-Z]+$/i.test(t.v) && isOp('$')) { s += next().v; const n = next(); s += String(n.v); } else if (t.t === 'id' && /^[A-Z]+$/i.test(t.v) && peek().t === 'num' && !peek().at?.space) { s += String(next().v); } };
    part(); if (isOp(':')) { s += next().v; part(); }
    if (!/^\$?[A-Z]{1,3}\$?\d*(:\$?[A-Z]{1,3}\$?\d*)?$/i.test(s) && !/^\d+:\d+$/.test(s)) throw new FqlError(`Not a cell or range: ${s}`, peek().at);
    return s.toUpperCase();
  }

  /* expressions, by precedence: or < and < not < comparison < + - < * / % < ^ < unary < call/primary */
  function expr() { return orE(); }
  function orE() { let l = andE(); while (isKw('or')) { next(); skipNl(); l = { k: 'bin', op: 'or', l, r: andE() }; } return l; }
  function andE() { let l = notE(); while (isKw('and')) { next(); skipNl(); l = { k: 'bin', op: 'and', l, r: notE() }; } return l; }
  function notE() { if (isKw('not')) { next(); return { k: 'un', op: 'not', e: notE() }; } return cmp(); }
  function cmp() {
    const l = add();
    if (peek().t === 'op' && ['=', '==', '!=', '<>', '<', '<=', '>', '>='].includes(peek().v)) { const o = next().v; return { k: 'bin', op: { '=': '==', '<>': '!=' }[o] || o, l, r: add() }; }
    if (isKw('not') && isKw('in', 1)) { next(); next(); return { k: 'un', op: 'not', e: { k: 'in', e: l, list: inList() } }; }
    if (isKw('in')) { next(); return { k: 'in', e: l, list: inList() }; }
    if (isKw('between')) { next(); const lo = add(); kw('and'); return { k: 'between', e: l, lo, hi: add() }; }
    if (isKw('is')) { next(); const neg = isKw('not') ? (next(), true) : false; kw('null'); return { k: 'isnull', e: l, neg }; }
    return l;
  }
  function inList() { op('('); skipNl(); const items = list(expr); skipNl(); op(')'); return items; }
  function add() { let l = mul(); while (isOp('+') || isOp('-')) { const o = next().v; l = { k: 'bin', op: o, l, r: mul() }; } return l; }
  function mul() { let l = pow(); while (isOp('*') || isOp('/') || isOp('%')) { const o = next().v; l = { k: 'bin', op: o, l, r: pow() }; } return l; }
  function pow() { const l = unary(); if (isOp('^')) { next(); return { k: 'bin', op: '^', l, r: pow() }; } return l; }
  function unary() { if (isOp('-')) { next(); return { k: 'un', op: '-', e: unary() }; } if (isOp('+')) { next(); return unary(); } return primary(); }
  function primary() {
    const t = peek();
    if (t.t === 'num') { next(); return { k: 'lit', v: t.v }; }
    if (t.t === 'str') { next(); return { k: 'lit', v: t.v }; }
    if (isKw('true') || isKw('false')) { next(); return { k: 'lit', v: t.v === 'true' }; }
    if (isKw('null')) { next(); return { k: 'lit', v: null }; }
    if (isOp('(')) { next(); skipNl(); const e = expr(); skipNl(); op(')'); return e; }
    if (t.t === 'id' && !t.quoted && isOp('(', 1)) {
      const fn = next().v.toLowerCase(); next(); skipNl();
      const args = isOp(')') ? [] : list(expr); skipNl(); op(')');
      return { k: 'call', fn, args, at: t.at };
    }
    if (isName()) { const r = colRef(); return { k: 'col', ...r, at: t.at }; }
    throw new FqlError(`Expected a value, found ${desc(t)}`, t.at);
  }

  /* sources */
  function source() {
    const at = peek().at;
    if (isKw('query')) { next(); return { kind: 'query', name: name('a query name'), at }; } // "table T = query Q" reads well without from
    kw('from');
    const t = peek();
    const kind = t.t === 'kw' ? t.v : null;
    if (kind === 'sheet') { next(); const sheet = want(peek().t === 'str' || isName(), 'a sheet name'); const s = { kind: 'sheet', sheet: sheet.v ?? sheet.raw, at }; if (isKw('range')) { next(); s.range = cellRange(); } return s; }
    if (['csv', 'json', 'parquet'].includes(kind)) { next(); const p = want(peek().t === 'str', 'a file path in quotes'); const s = { kind, path: p.v, at }; if (kind === 'csv' && isKw('with')) { next(); s.options = options(); } return s; }
    if (kind === 'xlsx') { next(); const p = want(peek().t === 'str', 'a file path in quotes'); const s = { kind, path: p.v, at }; if (isKw('sheet')) { next(); s.sheet = want(peek().t === 'str', 'a sheet name in quotes').v; } return s; }
    if (kind === 'sql') { next(); const q = want(peek().t === 'str', 'an SQL query in quotes'); const s = { kind, sql: q.v, at }; if (isKw('on')) { next(); s.db = want(peek().t === 'str', 'a database file in quotes').v; } return s; }
    if (isKw('query')) { next(); return { kind: 'query', name: name('a query name'), at }; }
    if (isKw('model')) { next(); const model = name('a model name'); kw('evaluate'); const measures = list(() => name('a measure')); let by = []; if (isKw('by')) { next(); by = list(colRef); } return { kind: 'model', model, measures, by, at }; }
    if (kind === 'values') { next(); op('('); skipNl(); const outer = isOp('[') && isOp('[', 1) ? (next(), true) : false; const rows = list(() => { skipNl(); op('['); const r = list(expr).map(lit); op(']'); return r; }); skipNl(); if (outer) op(']'); skipNl(); op(')'); return { kind: 'values', header: rows[0].map(String), rows: rows.slice(1), at }; }
    throw new FqlError(`Expected a source (sheet, csv, json, xlsx, parquet, sql, query, model, values), found ${desc(t)}`, t.at);
  }
  const lit = (e) => { if (e.k === 'lit') return e.v; if (e.k === 'un' && e.op === '-' && e.e.k === 'lit') return -e.e.v; throw new FqlError('Only plain values are allowed here'); };
  function options() { const o = {}; op('('); list(() => { const key = name('an option'); op('='); o[key] = lit(expr()); }); op(')'); return o; }

  /* pipeline steps */
  const AGG = new Set(['sum', 'count', 'avg', 'mean', 'average', 'min', 'max', 'median', 'stdev', 'variance', 'distinct', 'first', 'last', 'product', 'mode', 'any']);
  function assign() { const n = name('a column name'); op('='); return { name: n, e: expr() }; }
  function order() { const desc_ = isOp('-') ? (next(), true) : false; return { ...colRef(), desc: desc_ }; }
  function step() {
    const t = peek(); const at = t.at;
    if (t.t !== 'kw') { const hint = closest(String(t.v), STEPS); throw new FqlError(`Expected a step (where, derive, select, groupby, rollup, orderby, join, load…), found ${desc(t)}${hint ? `. Did you mean ${hint}?` : ''}`, at); }
    next();
    switch (t.v) {
      case 'where': return { op: 'where', e: expr(), at };
      case 'derive': return { op: 'derive', cols: list(assign), at };
      case 'select': return { op: 'select', cols: list(() => name('a column')), at };
      case 'drop': return { op: 'drop', cols: list(() => name('a column')), at };
      case 'rename': return { op: 'rename', pairs: list(() => { const a = name('a column'); kw('as'); return [a, name('a new name')]; }), at };
      case 'groupby': return { op: 'groupby', cols: list(() => name('a column')), at };
      case 'rollup': return { op: 'rollup', cols: list(() => { const a = assign(); if (!checkAgg(a.e)) throw new FqlError('A rollup value must be an aggregate such as sum(Total) or count()', at); return a; }), at };
      case 'orderby': return { op: 'orderby', keys: list(order), at };
      case 'join': { const other = name('a query to join'); kw('on'); const l = name('a column'); op('='); const r = name('a column'); let how = 'inner'; if (['left', 'right', 'inner', 'full'].includes(peek().v) && peek().t === 'kw') how = next().v; return { op: 'join', other, on: [l, r], how, at }; }
      case 'pivot': { const key = name('a column'); kw('by'); const value = name('a column'); let agg = 'sum'; if (isKw('using')) { next(); agg = want(peek().t === 'id', 'an aggregate (sum, count…)').v.toLowerCase(); } return { op: 'pivot', key, value, agg, at }; }
      case 'unpivot': { const cols = list(() => name('a column')); kw('as'); const kname = name('a name for the keys'); op(','); return { op: 'unpivot', cols, as: [kname, name('a name for the values')], at }; }
      case 'dedupe': return { op: 'dedupe', cols: isName() ? list(() => name('a column')) : [], at };
      case 'fill': { const dir = want(isKw('down') || isKw('up'), '"down" or "up"').v; return { op: 'fill', dir, cols: list(() => name('a column')), at }; }
      case 'limit': return { op: 'limit', n: want(peek().t === 'num', 'a number').v, at };
      case 'type': return { op: 'type', cols: list(() => { const c = name('a column'); kw('as'); const ty = name('a type').toLowerCase(); if (!['number', 'text', 'date', 'bool'].includes(ty)) throw new FqlError(`Unknown type ${ty}: use number, text, date or bool`, at); return [c, ty]; }), at };
      case 'split': { const c = name('a column'); kw('by'); const sep = want(peek().t === 'str', 'a separator in quotes').v; kw('into'); return { op: 'split', col: c, sep, into: list(() => name('a column name')), at }; }
      case 'append': return { op: 'append', other: name('a query'), at };
      case 'load': {
        kw('to');
        if (isKw('sheet')) { next(); const s = want(peek().t === 'str', 'a sheet name in quotes').v; let cell = 'A1'; if (isKw('at')) { next(); cell = cellRange(); } return { op: 'load', to: 'sheet', sheet: s, cell, at }; }
        if (isKw('table')) { next(); return { op: 'load', to: 'table', name: name('a table name'), at }; }
        if (isKw('model')) { next(); return { op: 'load', to: 'model', at }; }
        throw new FqlError('Expected "sheet", "table" or "model" after "load to"', peek().at);
      }
      default: throw new FqlError(`"${t.v}" is not a step`, at);
    }
  }
  /** a rollup value is built from aggregates (sum, count…) and constants; a bare column outside an aggregate has no single value */
  function checkAgg(e, inside = false) {
    if (e.k === 'call' && AGG.has(e.fn)) return true;
    if (e.k === 'col' && !inside) throw new FqlError('A rollup value must be an aggregate such as sum(Total) or count()', e.at);
    const kids = e.k === 'bin' ? [e.l, e.r] : e.k === 'un' ? [e.e] : e.k === 'call' ? e.args : [];
    return kids.map((x) => checkAgg(x, inside)).some(Boolean);
  }
  function pipeline() {
    const src = source(); const steps = [];
    while (nlBeforePipe()) { next(); skipNl(); steps.push(step()); }
    return { source: src, steps };
  }

  /* statements */
  const program = { queries: [], models: [], params: [] };
  skipNl();
  while (peek().t !== 'eof') {
    const t = peek();
    if (isKw('query')) {
      next(); const n = name('a query name'); op('='); skipNl();
      const q = { name: n, ...pipeline(), at: t.at };
      if (program.queries.some((x) => x.name.toLowerCase() === n.toLowerCase())) throw new FqlError(`The query ${n} is defined twice`, t.at);
      program.queries.push(q);
    } else if (isKw('model')) {
      next(); const m = { name: name('a model name'), tables: [], relations: [], measures: [], at: t.at };
      while (true) {
        let o = 0; while (peek(o).t === 'nl') o++;
        const nx = peek(o);
        if (!(nx.t === 'kw' && ['table', 'relate', 'measure'].includes(nx.v))) break;
        k += o; next();
        if (nx.v === 'table') { const n = name('a table name'); op('='); skipNl(); m.tables.push({ name: n, ...pipeline(), at: nx.at }); }
        else if (nx.v === 'relate') { const a = colRef(); op('->'); const b = colRef(); if (!a.table || !b.table) throw new FqlError('A relation joins Table.column -> Table.column', nx.at); m.relations.push({ from: a, to: b, at: nx.at }); }
        else { const n = name('a measure name'); op('='); m.measures.push({ name: n, e: expr(), at: nx.at }); }
      }
      program.models.push(m);
    } else if (isKw('let')) {
      next(); const n = name('a parameter name'); op('='); program.params.push({ name: n, e: expr(), at: t.at });
    } else if (isKw('from') && !program.queries.some((x) => x.name.toLowerCase() === String(bareName).toLowerCase())) {
      program.queries.push({ name: String(bareName), ...pipeline(), at: t.at });
    } else throw new FqlError(`Expected "query", "model" or "let", found ${desc(t)}`, t.at);
    if (peek().t !== 'eof') want(peek().t === 'nl', 'a new line'); skipNl();
  }
  return program;
}

/** every input a program needs from outside: sheet ranges and files (the host gathers them before running) */
export function inputsOf(program) {
  const sheets = [], files = [];
  const visit = (s) => { if (s.kind === 'sheet') sheets.push({ sheet: s.sheet, range: s.range || null }); else if (['csv', 'json', 'xlsx', 'parquet'].includes(s.kind)) files.push({ kind: s.kind, path: s.path }); else if (s.kind === 'sql' && s.db) files.push({ kind: 'db', path: s.db }); };
  for (const q of program.queries) visit(q.source);
  for (const m of program.models) for (const t of m.tables) visit(t.source);
  return { sheets, files };
}
