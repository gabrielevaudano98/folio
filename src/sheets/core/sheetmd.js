// Folio Sheets — sheet-md v2 documents. A .sheet.md file is ordinary Markdown:
//   ## Sheet name + a table                one sheet; `<!-- sheet: {...} -->` under it holds styles and rules
//   <!-- workbook: {...} -->                workbook settings: names, scenarios, slicers, print, protection
//   ```fql Sales``` ```pivot Summary``` ```script Macros``` ```python Forecast```   blocks the workbook runs
// Everything not understood stays as written (lossless round-trip, AGENTS.md invariant 1). Pure.
import { parseWorkbook, serializeWorkbook } from '../../renderer/sheet-core.js';

export const BLOCK_LANGS = ['fql', 'pivot', 'script', 'python', 'chart'];
const WB = /^<!--\s*workbook:\s*([\s\S]*?)\s*-->\s*$/;
const FENCE = /^(\s*)(```+|~~~+)\s*([A-Za-z]+)(?:\s+(.*?))?\s*$/;

/** text → { blocks, workbook, fences } */
export function readDoc(text) {
  const blocks = parseWorkbook(text);
  let workbook = {};
  const fences = [];
  blocks.forEach((b, bi) => {
    if (b.type !== 'text') return;
    for (let i = 0; i < b.lines.length; i++) {
      const l = b.lines[i];
      const w = WB.exec(l);
      if (w) { try { workbook = JSON.parse(w[1]); } catch { /* keep text as is */ } continue; }
      const f = FENCE.exec(l);
      if (!f) continue;
      const close = new RegExp(`^\\s*${f[2][0] === '`' ? '`' : '~'}{${f[2].length},}\\s*$`);
      let j = i + 1; while (j < b.lines.length && !close.test(b.lines[j])) j++;
      const lang = f[3].toLowerCase();
      if (BLOCK_LANGS.includes(lang)) fences.push({ lang, name: (f[4] || '').trim(), body: b.lines.slice(i + 1, j).join('\n'), block: bi, start: i, end: j });
      i = j;
    }
  });
  return { blocks, workbook, fences };
}

export const sheetsOf = (doc) => doc.blocks.filter((b) => b.type === 'sheet');

/** replace or add the workbook comment; `null` removes it */
export function setWorkbook(doc, wb) {
  const json = wb && Object.keys(wb).length ? `<!-- workbook: ${JSON.stringify(wb)} -->` : null;
  for (const b of doc.blocks) {
    if (b.type !== 'text') continue;
    const i = b.lines.findIndex((l) => WB.test(l));
    if (i < 0) continue;
    if (json) b.lines[i] = json; else b.lines.splice(i, 1);
    doc.workbook = wb || {};
    return doc;
  }
  if (json) doc.blocks.push({ type: 'text', lines: ['', json, ''] });
  doc.workbook = wb || {};
  return doc;
}

/** replace the body of a named block, add it at the end, or remove it (body null) */
export function setFence(doc, lang, name, body) {
  const cur = readDoc(serializeDoc(doc)); // positions may have moved: re-read
  Object.assign(doc, cur);
  const f = doc.fences.find((x) => x.lang === lang && x.name === name);
  if (f) {
    const b = doc.blocks[f.block];
    if (body == null) b.lines.splice(f.start, f.end - f.start + 1);
    else b.lines.splice(f.start + 1, f.end - f.start - 1, ...String(body).replace(/\n+$/, '').split('\n'));
  } else if (body != null) doc.blocks.push({ type: 'text', lines: ['', `\`\`\`${lang}${name ? ' ' + name : ''}`, ...String(body).replace(/\n+$/, '').split('\n'), '```', ''] });
  Object.assign(doc, readDoc(serializeDoc(doc)));
  return doc;
}

export const serializeDoc = (doc) => serializeWorkbook(doc.blocks);
