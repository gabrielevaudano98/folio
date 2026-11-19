// Folio references — resolve a reference to a value or an embed, and fill placeholders in rendered HTML.
import { parseRef, resolveTarget, docKind } from './refs-syntax.js';
import { parseWorkbook, evaluator, parseAddr, colName, display, formulaRefs } from './sheet-core.js';
import { splitBoardDoc, parseBoard, autoLayout, shapeSvg, edgePath, labelBox } from './board-core.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export class RefError extends Error {}

/* ---------- sheets ---------- */
function sheetPart(text, part, external) {
  const sheets = parseWorkbook(text).filter((b) => b.type === 'sheet');
  if (!sheets.length) throw new RefError('no sheet in this document');
  let name = '', range = part;
  const bang = part.lastIndexOf('!');
  if (bang >= 0) { name = part.slice(0, bang).replace(/^'|'$/g, ''); range = part.slice(bang + 1); }
  else if (part && !/^\$?[A-Z]+\$?\d+(:\$?[A-Z]+\$?\d+)?$/i.test(part)) { name = part; range = ''; }
  const s = name ? sheets.find((x) => x.name.toLowerCase() === name.toLowerCase()) : sheets[0];
  if (!s) throw new RefError(`no sheet named ${name}`);
  const ev = evaluator(s, { external }); const m = s.meta || {}; const fmtOf = (r, c) => m.cells?.[`${colName(c)}${r + 1}`]?.format ?? m.cols?.[colName(c)]?.format ?? '';
  const cell = (r, c) => { const v = ev.value(r, c); return ev.isError(v) ? String(v) : display(v, fmtOf(r, c)); };
  if (!range) { const cols = Math.max(...s.rows.map((r) => r.length)); return { sheet: s, grid: s.rows.map((_, r) => Array.from({ length: cols }, (__, c) => cell(r, c))) }; }
  const [a, b] = range.split(':').map(parseAddr);
  if (!a) throw new RefError(`bad cell ${range}`);
  if (!b) return { sheet: s, value: cell(a[0], a[1]), raw: ev.value(a[0], a[1]) };
  const grid = [];
  for (let r = a[0]; r <= b[0]; r++) { const row = []; for (let c = a[1]; c <= b[1]; c++) row.push(cell(r, c)); grid.push(row); }
  return { sheet: s, grid };
}
const tableHtml = (grid, head = true) => `<table class="ref-table">${grid.map((row, i) => `<tr>${row.map((v) => (i === 0 && head ? `<th>${esc(v)}</th>` : `<td>${esc(v)}</td>`)).join('')}</tr>`).join('')}</table>`;

/* ---------- pages ---------- */
function section(text, part) {
  const lines = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').split('\n');
  if (!part) return lines.join('\n');
  if (part.startsWith('^')) { const l = lines.find((x) => x.trimEnd().endsWith(' ' + part)); if (l == null) throw new RefError(`no block ${part}`); return l.replace(new RegExp(`\\s*\\${part}\\s*$`), ''); }
  const want = part.toLowerCase(); let fence = false, start = -1, level = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
    const m = !fence && lines[i].match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (!m) continue;
    if (start >= 0 && m[1].length <= level) return lines.slice(start, i).join('\n').trim();
    if (start < 0 && m[2].replace(/[*_`]/g, '').toLowerCase() === want) { start = i; level = m[1].length; }
  }
  if (start < 0) throw new RefError(`no heading “${part}”`);
  return lines.slice(start).join('\n').trim();
}
const firstLine = (md) => (md.split('\n').map((l) => l.replace(/^#+\s+|^[-*>]\s+/, '').trim()).find(Boolean) || '').replace(/[*_`]/g, '');

/* ---------- boards ---------- */
export function boardSvg(text, part = '') {
  const { code } = splitBoardDoc(text);
  const model = parseBoard(code);
  if (model.nodes.some((n) => n.x == null)) autoLayout(model);
  let nodes = model.nodes, edges = model.edges;
  if (part) { const n = nodes.find((x) => x.id === part); if (!n) throw new RefError(`no shape ${part}`); }
  const by = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const x0 = Math.min(...nodes.map((n) => n.x)) - 20, y0 = Math.min(...nodes.map((n) => n.y)) - 20;
  const x1 = Math.max(...nodes.map((n) => n.x + n.w)) + 20, y1 = Math.max(...nodes.map((n) => n.y + n.h)) + 40;
  const shapes = nodes.map((n) => { const lb = labelBox(n); return `<g transform="translate(${n.x},${n.y})"${part === n.id ? ' class="ref-hit"' : ''}>${shapeSvg(n)}<text x="${lb.x + lb.w / 2}" y="${lb.y + (lb.valign === 'top' ? 16 : lb.h / 2 + 5)}" text-anchor="middle" class="ref-board-label">${esc(n.label)}</text></g>`; }).join('');
  const lines = edges.filter((e) => by[e.from] && by[e.to]).map((e) => { try { return `<path class="b-edge" d="${edgePath(by[e.from], by[e.to], e).d}"/>`; } catch { return ''; } }).join('');
  return `<svg class="ref-board" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Board">${lines}${shapes}</svg>`;
}

/**
 * Resolve one reference.
 * @returns {Promise<{path, kind, value?: string, html?: string, open: {path, part}}>}
 */
export async function resolveRef(raw, env) {
  const { files, from, read, renderMarkdown, renderSlideHtml } = env;
  const { target, part } = parseRef(raw);
  const path = resolveTarget(target, files, from);
  if (!path) throw new RefError(`“${target}” not found`);
  const text = await read(path);
  const kind = docKind(path);
  const open = { path, part };
  if (kind === 'sheet') {
    const external = await loadExternals(text, { files, from: path, read, renderMarkdown, renderSlideHtml, seen: env_seen(env, path) });
    const r = sheetPart(text, part, external);
    return r.value != null ? { path, kind, value: r.value, html: `<span>${esc(r.value)}</span>`, open } : { path, kind, value: r.grid.flat().join(' '), html: tableHtml(r.grid), open };
  }
  if (kind === 'slides') {
    const { parseDeck } = await import('./slides-core.js');
    const deck = parseDeck(text); const n = part ? parseInt(part, 10) : 1;
    const s = deck.slides[(Number.isFinite(n) ? n : 1) - 1];
    if (!s) throw new RefError(`no slide ${part}`);
    const html = renderSlideHtml ? renderSlideHtml(deck, s) : '';
    return { path, kind, value: s.title || `Slide ${s.index + 1}`, html, open: { path, part: String(s.index + 1) }, size: [deck.width, deck.height] };
  }
  if (kind === 'board') {
    const svg = boardSvg(text, part);
    const label = part ? (parseBoard(splitBoardDoc(text).code).nodes.find((x) => x.id === part)?.label || part) : path.split('/').pop();
    return { path, kind, value: label, html: svg, open };
  }
  const md = section(text, part);
  return { path, kind, value: firstLine(md), html: renderMarkdown ? renderMarkdown(md) : `<pre>${esc(md)}</pre>`, open };
}

function env_seen(env, path) { const seen = new Set(env.seen || []); if (seen.has(path)) throw new RefError('circular reference'); seen.add(path); return seen; }

/** raw value(s) behind a reference, for formulas: a number or text for one cell, a 2D array for a range */
async function rawValue(raw, env) {
  const { target, part } = parseRef(raw);
  const path = resolveTarget(target, env.files, env.from);
  if (!path) throw new RefError('#REF!');
  if (docKind(path) !== 'sheet') return (await resolveRef(raw, env)).value;
  const text = await env.read(path);
  const external = await loadExternals(text, { ...env, from: path, seen: env_seen(env, path) });
  const sheets = parseWorkbook(text).filter((b) => b.type === 'sheet');
  let name = '', range = part; const bang = part.lastIndexOf('!');
  if (bang >= 0) { name = part.slice(0, bang).replace(/^'|'$/g, ''); range = part.slice(bang + 1); }
  const sh = name ? sheets.find((x) => x.name.toLowerCase() === name.toLowerCase()) : sheets[0];
  if (!sh) throw new RefError('#REF!');
  const ev = evaluator(sh, { external });
  const [a, b] = range.split(':').map(parseAddr); if (!a) throw new RefError('#REF!');
  if (!b) return ev.value(a[0], a[1]);
  const out = []; for (let r = a[0]; r <= b[0]; r++) { const row = []; for (let c = a[1]; c <= b[1]; c++) row.push(ev.value(r, c)); out.push(row); }
  return out;
}

/** resolve every {{ref}} used in the formulas of a sheet document: Map raw → value or { error } */
export async function loadExternals(text, env) {
  const refs = formulaRefs(text); if (!refs.length) return null;
  const map = new Map();
  await Promise.all(refs.map(async (raw) => {
    try { map.set(raw, await rawValue(raw, env)); }
    catch (e) { map.set(raw, { error: '#REF!' }); }
  }));
  return map;
}

/** fill .ref-value and .ref-embed placeholders under root; returns the list of references with their status */
export async function hydrateRefs(root, env) {
  const els = [...root.querySelectorAll('.ref-value[data-ref], .ref-embed[data-ref]')];
  const report = [];
  await Promise.all(els.map(async (el) => {
    const raw = el.dataset.ref; const isEmbed = el.classList.contains('ref-embed');
    try {
      const r = await resolveRef(raw, env);
      el.dataset.path = r.open.path; el.dataset.part = r.open.part || ''; el.classList.remove('is-broken');
      el.title = `${raw}\nCtrl+click to open`;
      if (!isEmbed) el.textContent = r.value;
      else if (r.kind === 'slides' && r.size) {
        const w = 480, k = w / r.size[0];
        el.innerHTML = `<span class="ref-embed-head">${esc(el.dataset.label || r.value)}</span><span class="ref-slide" style="width:${w}px;height:${r.size[1] * k}px"><span class="sl-scale" style="transform:scale(${k})">${r.html}</span></span>`;
        env.afterSlide?.(el);
      } else el.innerHTML = `<span class="ref-embed-head">${esc(el.dataset.label || raw)}</span><span class="ref-embed-body ref-${r.kind}">${r.html}</span>`;
      report.push({ raw, ok: true, path: r.open.path });
    } catch (e) {
      el.classList.add('is-broken'); el.title = `${raw}: ${e.message}`;
      el.textContent = isEmbed ? `Missing: ${raw} (${e.message})` : `⟨${raw}⟩`;
      report.push({ raw, ok: false, error: e.message });
    }
  }));
  return report;
}
