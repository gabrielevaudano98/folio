// Folio Sheets — whole-workbook jobs without a window, in the data engine: what the window does when the person
// presses Refresh all or runs a macro, done on a headless Univer so AI assistants (MCP) and the command line can ask
// for it. Results go back as the workbook's new text; the caller writes the file.
//
//   values(H, text)                          every sheet's computed values and shown text
//   refresh(H, text, { files, readers })     every FQL query's `load` and every pivot, written where the window writes
//                                            them (the area a previous load wrote is cleared first: workbook `loads`)
//   macro(H, text, { entry, args, active })  a Folio Script macro, its steps replayed as Univer commands; a protected
//                                            sheet refuses steps outside its editable ranges, as in the window
import { toUniver, fromUniver } from '../core/convert.js';
import { readDoc, sheetsOf } from '../core/sheetmd.js';
import { splitRef, parseAddr, toRange, fromRange, quoteSheet } from '../core/a1.js';
import { parse as parseFql, inputsOf } from '../core/fql/parse.js';
import { run as runFql } from '../core/fql/run.js';
import { parsePivot, computePivot } from '../core/pivot.js';
import { replayOps } from '../core/replay.js';
import { runScript, scriptWorkbook } from './script.js';

const ownWorkbook = (wb) => Object.fromEntries(Object.entries(wb || {}).filter(([k]) => k !== 'names' && k !== 'univer'));
const plainValue = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v === undefined ? null : v);

async function openBook(H, text) {
  const loaded = toUniver(text, { share: true });
  const wb = await H.open(loaded.data);
  const sheet = (name) => wb.fwb.getSheetByName(name);
  const book = {
    wb, loaded, doc: loaded.doc,
    names: () => wb.sheetNames(),
    readSheet: (name) => sheet(name)?.getDataRange().getRawValues() ?? null,
    read(ref) { const { sheet: s, range } = splitRef(ref); return sheet(s)?.getRange(range).getRawValues() ?? null; },
    /** the window's surface.write: insert the sheet if needed, clear what `prev` covered, write, bold header */
    write(sheetName, at, grid, { prev = null, header = true } = {}) {
      const s = sheet(sheetName) || wb.fwb.insertSheet(sheetName);
      const start = parseAddr(at || 'A1') || [0, 0];
      if (prev) { try { const p = splitRef(prev); (p.sheet ? sheet(p.sheet) : s)?.getRange(p.range).clearContent(); } catch { /* gone */ } }
      const h = grid.length, w = grid.reduce((m, r) => Math.max(m, r.length), 1);
      if (!h) return null;
      s.getRange(start[0], start[1], h, w).setValues(grid.map((r) => Array.from({ length: w }, (_, j) => plainValue(r[j]))));
      if (header) s.getRange(start[0], start[1], 1, w).setFontWeight('bold');
      return `${quoteSheet(s.getSheetName())}!${fromRange({ startRow: start[0], endRow: start[0] + h - 1, startColumn: start[1], endColumn: start[1] + w - 1, rangeType: 0 })}`;
    },
    async text(workbook) { await wb.settle(); return fromUniver(wb.save(), loaded, workbook ? { workbook } : {}); },
    close() { H.close(wb); },
  };
  return book;
}

/** computed values and shown text of every sheet (or one) */
export async function values(H, text, { sheet = null } = {}) {
  const b = await openBook(H, text);
  try {
    const out = [];
    for (const name of b.names()) {
      if (sheet && name.toLowerCase() !== String(sheet).toLowerCase()) continue;
      const s = b.wb.fwb.getSheetByName(name); const r = s.getDataRange();
      out.push({ sheet: name, range: r.getA1Notation(), values: r.getRawValues().map((row) => row.map(plainValue)), display: r.getDisplayValues() });
    }
    if (sheet && !out.length) throw new Error(`No sheet named ${sheet}`);
    return out;
  } finally { b.close(); }
}

/** the inputs of every FQL block (sheets and files), for the caller to resolve the files */
export function inputsOfBook(text) {
  const files = new Map();
  for (const f of readDoc(text).fences.filter((x) => x.lang === 'fql')) {
    try { for (const x of inputsOf(parseFql(f.body, { name: f.name || 'Query' })).files) files.set(x.path, x.kind); } catch { /* reported when it runs */ }
  }
  return [...files].map(([path, kind]) => ({ path, kind }));
}

/** Refresh all: FQL loads, then pivots (which may read query results); returns { text, loaded, errors } */
export async function refresh(H, text, { env = {} } = {}) {
  const b = await openBook(H, text);
  try {
    const fences = readDoc(text).fences;
    const loads = { ...(b.doc.workbook?.loads || {}) };
    const errors = []; let loaded = 0;
    const runBlock = async (body, name, opts = {}) => {
      const program = parseFql(body, { name });
      const sheets = {};
      for (const s of inputsOf(program).sheets) {
        if (!b.names().includes(s.sheet)) continue; // the engine names the missing sheet
        sheets[s.range ? `${s.sheet}!${s.range}` : s.sheet] = s.range ? b.read(`${quoteSheet(s.sheet)}!${s.range}`) : b.readSheet(s.sheet);
      }
      return runFql(program, { ...env, sheets }, opts);
    };
    for (const f of fences.filter((x) => x.lang === 'fql')) {
      const block = f.name || 'Query';
      try {
        const res = await runBlock(f.body, block);
        for (const ld of res.loads || []) {
          const grid = res.results[ld.query]; if (!grid || ld.to === 'model') continue;
          const key = `${block}/${ld.query}`;
          loads[key] = b.write(ld.to === 'table' ? ld.name : ld.sheet, ld.to === 'table' ? 'A1' : ld.cell || 'A1', grid, { prev: loads[key] });
          loaded++;
        }
      } catch (e) { errors.push(`Query ${block}: ${e.message}`); }
      await b.wb.settle();
    }
    for (const f of fences.filter((x) => x.lang === 'pivot')) {
      try {
        const spec = parsePivot(f.body);
        let grid;
        const m = /^\s*(query|model)\s+(.+?)\s*$/i.exec(spec.source || '');
        if (!m) grid = b.read(spec.source);
        else {
          const name = m[2].replace(/^`|`$/g, '');
          for (const q of fences.filter((x) => x.lang === 'fql')) {
            let p; try { p = parseFql(q.body, { name: q.name }); } catch { continue; }
            if (m[1].toLowerCase() === 'query' && p.queries.some((x) => x.name === name)) { grid = (await runBlock(q.body, q.name, { only: name })).results[name]; break; }
            if (m[1].toLowerCase() === 'model' && p.models.some((x) => x.name === name)) { grid = (await runBlock(q.body, q.name, { flat: name })).flat; break; }
          }
          if (!grid) throw new Error(`No ${m[1].toLowerCase()} named ${name}.`);
        }
        const [sheet, cell] = spec.place.includes('!') ? spec.place.split('!') : [spec.place || f.name, 'A1'];
        loads[`pivot/${f.name}`] = b.write(sheet.replace(/^'|'$/g, ''), cell || 'A1', computePivot(grid, spec), { prev: loads[`pivot/${f.name}`] });
        loaded++;
      } catch (e) { errors.push(`PivotTable ${f.name}: ${e.message}`); }
      await b.wb.settle();
    }
    const out = loaded ? await b.text({ ...ownWorkbook(b.doc.workbook), loads }) : text;
    return { text: out, loaded, errors };
  } finally { b.close(); }
}

/* ---------- macros ---------- */
const inside = (x, a) => x.startRow >= a.startRow && x.endRow <= a.endRow && x.startColumn >= a.startColumn && x.endColumn <= a.endColumn;
const STRUCTURE = new Set(['insertRows', 'deleteRows', 'insertCols', 'deleteCols', 'merge', 'unmerge', 'renameSheet', 'deleteSheet']);
/** a step a protected sheet refuses (the window's guard, protection.js, for steps that arrive as operations) */
export function refusedBy(protect, op) {
  if (!protect || ['activate', 'select', 'insertSheet', 'colWidth', 'rowHeight', 'freeze'].includes(op.op)) return false;
  if (STRUCTURE.has(op.op)) return true;
  if (!op.range) return false;
  let x; try { x = toRange(op.range); } catch { return true; }
  const allow = (protect.allow || []).map((a) => { try { return toRange(a); } catch { return null; } }).filter(Boolean);
  return !allow.some((a) => inside(x, a));
}

/** run a macro of the workbook's scripts; returns { text, result, logs, toasts, refused } */
export async function macro(H, text, { entry, args = [], active = null, code = null } = {}) {
  const doc = readDoc(text);
  const src = code ?? doc.fences.filter((f) => f.lang === 'script').map((f) => f.body).join('\n\n');
  if (!src.trim()) throw new Error('This workbook has no scripts.');
  const b = await openBook(H, text);
  try {
    // the copy a script reads: computed values of the formula cells, as in the window
    const snap = b.wb.save(); const valuesBy = {};
    for (const id of snap.sheetOrder) {
      const ws = snap.sheets[id]; const s = b.wb.fwb.getSheetBySheetId(id); const grid = s.getDataRange().getRawValues();
      for (const r in ws.cellData || {}) for (const c in ws.cellData[r] || {}) { const x = ws.cellData[r][c]; if (x?.f || x?.si) (valuesBy[ws.name] ||= {}, valuesBy[ws.name][r] ||= {})[c] = plainValue(grid[r]?.[c]); }
    }
    const sheetName = active && b.names().includes(active) ? active : b.names()[0];
    const res = await runScript(src, entry, scriptWorkbook(snap, { active: sheetName, values: valuesBy }), args);
    const protectOf = Object.fromEntries(sheetsOf(doc).map((s) => [s.name, s.meta?.protect || null]));
    const refused = [];
    const ops = (res.ops || []).filter((o) => { const p = protectOf[o.sheet || sheetName]; if (refusedBy(p, o)) { refused.push(`${o.op} ${o.sheet || sheetName}${o.range ? '!' + o.range : ''}`); return false; } return true; });
    const failed = [];
    replayOps(b.wb.fwb, ops, { onError: (o, e) => failed.push(`${o.op}: ${e.message}`) });
    const changed = ops.some((o) => !['activate', 'select'].includes(o.op));
    const out = changed ? await b.text(ownWorkbook(doc.workbook)) : text;
    return { text: out, result: res.result ?? null, logs: res.logs || [], toasts: res.toasts || [], refused, failed };
  } finally { b.close(); }
}
