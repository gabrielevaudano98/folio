// Folio — the date popover of a day chip (Notion's date mention, Apple Calendar's month grid).
// A text field that understands "tomorrow", "next friday", "domani", "3 dicembre", "15/01/2027"; quick picks;
// a month calendar; open the daily note; remove. Grey interface only (invariant 5).
import { t as tr, locale } from './i18n.js';
import { parseDay, isoDay, monthGrid, fullDay, formatDay } from './page-dates.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let chronoLib = null;
const chrono = async () => (chronoLib ||= await import('chrono-node'));

/** "15/01/2027", "2027-01-15", "domani", "next friday" → "YYYY-MM-DD" or null */
export async function parseTyped(text, now = new Date(), lang = 'en') {
  const t = String(text).trim(); if (!t) return null;
  if (parseDay(t)) return t.slice(0, 10);
  const num = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/.exec(t);
  if (num) {
    let [a, b, y] = [+num[1], +num[2], +num[3]]; if (y < 100) y += 2000;
    const [d, m] = lang === 'en' && /^en-US/.test(navigator.language || '') ? [b, a] : [a, b];
    const x = new Date(y, m - 1, d, 12); if (x.getMonth() === m - 1 && x.getDate() === d) return isoDay(x);
  }
  const c = await chrono(); const ref = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  for (const p of lang === 'it' ? [c.it, c] : [c, c.it]) { try { const d = p.parseDate(t, ref, { forwardDate: true }); if (d) return isoDay(d); } catch { /* not a date */ } }
  return null;
}

let open = null;
export const closeDatePicker = () => { open?.close(); };

/**
 * anchor: the chip; day: "YYYY-MM-DD"; onPick(day | null to remove); onOpenNote() opens the daily note.
 */
export function openDatePicker(anchor, day, { onPick, onOpenNote } = {}) {
  closeDatePicker();
  const lang = locale() === 'it' ? 'it' : 'en'; const loc = lang === 'it' ? 'it-IT' : 'en-GB';
  const now = new Date(); const sel = parseDay(day)?.date || now;
  let view = new Date(sel.getFullYear(), sel.getMonth(), 1, 12), focus = new Date(sel);
  const pop = document.createElement('div'); pop.className = 'date-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', tr('date.pick-a-date'));
  const dows = monthGrid(2026, 0, lang)[0].map((d) => d.toLocaleDateString(loc, { weekday: 'narrow' }));
  const quick = [[tr('date.today'), 0], [tr('date.tomorrow'), 1], [tr('date.next-week'), 7]];
  pop.innerHTML = `
    <input class="date-input" type="text" spellcheck="false" autocomplete="off" aria-label="${esc(tr('date.type-a-date'))}" placeholder="${esc(tr('date.type-a-date'))}">
    <p class="date-hint" aria-live="polite"></p>
    <div class="date-quick" role="group" aria-label="${esc(tr('date.quick'))}">${quick.map(([k, n]) => `<button type="button" class="date-chipbtn" data-add="${n}">${esc(k)}</button>`).join('')}</div>
    <div class="date-head"><span class="date-month" aria-live="polite"></span>
      <button type="button" class="icon-btn date-nav" data-nav="-1" aria-label="${esc(tr('date.previous-month'))}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button type="button" class="date-today" data-nav="0">${esc(tr('date.today'))}</button>
      <button type="button" class="icon-btn date-nav" data-nav="1" aria-label="${esc(tr('date.next-month'))}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>
    <div class="date-grid" role="grid" aria-label="${esc(tr('date.calendar'))}"><div class="date-row date-dows" role="row">${dows.map((d) => `<span role="columnheader">${esc(d)}</span>`).join('')}</div><div class="date-weeks"></div></div>
    <div class="date-foot">${onOpenNote ? `<button type="button" class="btn btn-quiet" data-act="note">${esc(tr('date.open-daily-note'))}</button>` : '<span></span>'}<button type="button" class="btn btn-quiet date-remove" data-act="remove">${esc(tr('date.remove'))}</button></div>`;
  document.body.append(pop);
  const input = pop.querySelector('.date-input'), hint = pop.querySelector('.date-hint');
  input.value = formatDay(isoDay(sel), { style: 'full', lang });

  const draw = (moveFocus = false) => {
    pop.querySelector('.date-month').textContent = view.toLocaleDateString(loc, { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase());
    const weeks = monthGrid(view.getFullYear(), view.getMonth(), lang);
    pop.querySelector('.date-weeks').innerHTML = weeks.map((w) => `<div class="date-row" role="row">${w.map((d) => {
      const k = isoDay(d); const out = d.getMonth() !== view.getMonth();
      return `<button type="button" role="gridcell" class="date-day${out ? ' is-out' : ''}${k === isoDay(now) ? ' is-today' : ''}${k === isoDay(sel) ? ' is-sel' : ''}" data-day="${k}" tabindex="${k === isoDay(focus) ? 0 : -1}" aria-selected="${k === isoDay(sel)}" aria-label="${esc(fullDay(k, lang))}">${d.getDate()}</button>`;
    }).join('')}</div>`).join('');
    if (moveFocus) pop.querySelector(`[data-day="${isoDay(focus)}"]`)?.focus();
  };
  draw();

  const place = () => {
    const r = anchor.getBoundingClientRect(); const h = pop.offsetHeight, w = pop.offsetWidth;
    pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
    pop.style.top = `${innerHeight - r.bottom - 8 >= h ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
  };
  place();
  let closed = false;
  const pick = (k) => { if (closed) return; close(); onPick?.(k); }; // a slow parse finishing after Esc does nothing
  const close = () => { closed = true; pop.remove(); document.removeEventListener('mousedown', outside, true); open = null; anchor.focus?.(); };
  const outside = (e) => { if (!pop.contains(e.target)) close(); };
  document.addEventListener('mousedown', outside, true);
  open = { close };

  pop.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.day) return pick(b.dataset.day);
    if (b.dataset.add != null) { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + +b.dataset.add, 12); return pick(isoDay(d)); }
    if (b.dataset.nav != null) { const n = +b.dataset.nav; view = n ? new Date(view.getFullYear(), view.getMonth() + n, 1, 12) : new Date(now.getFullYear(), now.getMonth(), 1, 12); if (!n) focus = new Date(now); return draw(); }
    if (b.dataset.act === 'remove') { close(); return onPick?.(null); }
    if (b.dataset.act === 'note') { close(); return onOpenNote?.(); }
  });
  let seq = 0;
  input.addEventListener('input', async () => {
    const n = ++seq; const k = await parseTyped(input.value, now, lang); if (n !== seq) return;
    hint.textContent = k ? fullDay(k, lang) : input.value.trim() ? tr('date.not-a-date') : '';
    hint.dataset.ok = String(!!k);
    if (k) { const d = parseDay(k).date; view = new Date(d.getFullYear(), d.getMonth(), 1, 12); focus = d; draw(); }
  });
  pop.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return close(); }
    if (e.target === input) {
      if (e.key === 'Enter') { e.preventDefault(); const k = await parseTyped(input.value, now, lang); if (closed) return; if (k) pick(k); else hint.textContent = tr('date.not-a-date'); }
      if (e.key === 'ArrowDown') { e.preventDefault(); draw(true); }
      return;
    }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step || e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      if (step) focus = new Date(focus.getFullYear(), focus.getMonth(), focus.getDate() + step, 12);
      else { const m = focus.getMonth() + (e.key === 'PageUp' ? -1 : 1); const last = new Date(focus.getFullYear(), m + 1, 0).getDate(); focus = new Date(focus.getFullYear(), m, Math.min(focus.getDate(), last), 12); } // 31 March → 28 February, not 3 March
      if (focus.getMonth() !== view.getMonth() || focus.getFullYear() !== view.getFullYear()) view = new Date(focus.getFullYear(), focus.getMonth(), 1, 12);
      draw(true);
    }
  });
  input.focus(); input.select();
  return { close };
}
