// Folio Sheets — sheet protection (area 26, with the encryption and signatures in panels/protect.js).
// A protected sheet refuses edits except in its allowed ranges, as in Excel. The rule lives in the sheet's meta:
//   "protect": { "allow": ["B2:B20"], "password": { pbkdf2 record }, "structure": true }
// Enforcement sits in front of Univer's command service: a command that would change a protected cell is cancelled
// before it runs, so nothing reaches the file, the undo stack or the operation log.
import { toRange } from '../core/a1.js';
import { L } from './i18n.js';

const READ_ONLY = /^(sheet\.operation\.|sheet\.command\.(copy|set-selections|set-zoom|scroll|set-worksheet-activate|set-scroll)|formula\.|ui\.|doc\.operation|sidebar\.|data-validation\.operation|sheet\.command\.set-format-painter)/;
const STRUCTURE = /^sheet\.command\.(insert-row|insert-col|remove-row|remove-col|move-rows|move-cols|set-row-height|set-col-width|set-worksheet-row-height|set-worksheet-col-width|delete-range|insert-range|set-row-hidden|set-col-hidden|set-specific-rows-visible|set-specific-cols-visible|remove-sheet|set-worksheet-name|insert-sheet|set-tab-color|set-worksheet-hide|set-worksheet-order)/;

const inside = (r, a) => r.startRow >= a.startRow && r.endRow <= a.endRow && r.startColumn >= a.startColumn && r.endColumn <= a.endColumn;

export function createProtection({ U, surface, ctx }) {
  let bypass = 0, warned = 0;
  const rule = (id) => surface.meta(id)?.protect || null;
  const ranges = (params) => {
    const out = [];
    if (params?.range) out.push(params.range);
    if (Array.isArray(params?.ranges)) out.push(...params.ranges);
    if (params?.cellValue && typeof params.cellValue === 'object') for (const [r, row] of Object.entries(params.cellValue)) for (const c of Object.keys(row || {})) out.push({ startRow: +r, endRow: +r, startColumn: +c, endColumn: +c });
    return out;
  };
  function blocked(cmd) {
    if (bypass || READ_ONLY.test(cmd.id)) return false;
    const p = cmd.params || {};
    const id = p.subUnitId || p.sheetId || surface.sheetId();
    const r = rule(id); if (!r) return false;
    if (STRUCTURE.test(cmd.id)) return true;
    if (!/^sheet\.(command|mutation)\./.test(cmd.id) && !/^(sheet|data-validation|sheets-filter|sheet-conditional)/.test(cmd.id)) return false;
    const allow = (r.allow || []).map((a) => { try { return toRange(a); } catch { return null; } }).filter(Boolean);
    let list = ranges(p);
    if (!list.length) { const sel = surface.range(); if (sel) list = [toRange(sel.getA1Notation())]; }
    return list.some((x) => !allow.some((a) => inside(x, a)));
  }
  U.commands.beforeCommandExecuted((cmd) => {
    if (!blocked(cmd)) return;
    if (Date.now() - warned > 1500) { warned = Date.now(); ctx.toast(L('This sheet is protected. Unprotect it in Review → Protect sheet to change these cells.')); }
    throw new Error(L('This sheet is protected.'));
  });
  return {
    isProtected: (id = surface.sheetId()) => !!rule(id),
    /** run Folio's own changes (unprotecting, applying a result the person asked for) past the guard */
    async unguarded(fn) { bypass++; try { return await fn(); } finally { bypass--; } },
  };
}
