// Folio — the date popover of a day chip (Notion's date mention, Apple Calendar's month grid).
// A text field that understands "tomorrow", "next friday", "domani", "3 dicembre", "15/01/2027"; quick picks;
// a month calendar; an end date, a time and a reminder (page-when.js); open the daily note; remove. Grey interface only (invariant 5).
import { t as tr, locale } from './i18n.js';
import { parseDay, isoDay, monthGrid, fullDay, formatDay } from './page-dates.js';
import { REMIND_PRESETS, offsetMinutes } from './page-when.js';

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
 * anchor: the chip; when: "YYYY-MM-DD" or { day, time, endDay, endTime, remind } (page-when.js);
 * onPick(when | null to remove, { live }) — live: written while the popover stays open; onOpenNote() opens the daily note.
 */
export function openDatePicker(anchor, when, { onPick, onOpenNote } = {}) {
  closeDatePicker();
  const w = typeof when === 'string' ? { day: when, time: null, endDay: null, endTime: null, remind: null } : { time: null, endDay: null, endTime: null, remind: null, ...when };
  const lang = locale() === 'it' ? 'it' : 'en'; const loc = lang === 'it' ? 'it-IT' : 'en-GB';
  const now = new Date(); const sel = parseDay(w.day)?.date || now;
  let view = new Date(sel.getFullYear(), sel.getMonth(), 1, 12), focus = new Date(sel);
  let target = 'start'; // with an end date on, a calendar click sets the start, then the end
  const pop = document.createElement('div'); pop.className = 'date-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', tr('date.pick-a-date'));
  const dows = monthGrid(2026, 0, lang)[0].map((d) => d.toLocaleDateString(loc, { weekday: 'narrow' }));
  const quick = [[tr('date.today'), 0], [tr('date.tomorrow'), 1], [tr('date.next-week'), 7]];
  const PRESET = { '5m': 'date.remind-5m', '10m': 'date.remind-10m', '30m': 'date.remind-30m', '1h': 'date.remind-1h', '1d': 'date.remind-1d', '2d': 'date.remind-2d' };
  const UNIT = { m: 'date.unit-m', h: 'date.unit-h', d: 'date.unit-d', w: 'date.unit-w' };
  const presetLabel = (r) => (r === '0' ? (w.time ? tr('date.remind-at-time') : tr('date.remind-on-day')) : tr(PRESET[r]));
  const isPreset = (r) => r == null || REMIND_PRESETS.includes(r);
  const custom = /^(\d{1,3})([mhd])$/.exec(isPreset(w.remind) ? '' : w.remind || '') || /^(\d{1,3})(w)$/.exec(w.remind || '');
  pop.innerHTML = `
    <input class="date-input" type="text" spellcheck="false" autocomplete="off" aria-label="${esc(tr('date.type-a-date'))}" placeholder="${esc(tr('date.type-a-date'))}">
    <p class="date-hint" aria-live="polite"></p>
    <div class="date-quick" role="group" aria-label="${esc(tr('date.quick'))}">${quick.map(([k, n]) => `<button type="button" class="date-chipbtn" data-add="${n}">${esc(k)}</button>`).join('')}</div>
    <div class="date-head"><span class="date-month" aria-live="polite"></span>
      <button type="button" class="icon-btn date-nav" data-nav="-1" aria-label="${esc(tr('date.previous-month'))}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button type="button" class="date-today" data-nav="0">${esc(tr('date.today'))}</button>
      <button type="button" class="icon-btn date-nav" data-nav="1" aria-label="${esc(tr('date.next-month'))}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>
    <div class="date-grid" role="grid" aria-label="${esc(tr('date.calendar'))}"><div class="date-row date-dows" role="row">${dows.map((d) => `<span role="columnheader">${esc(d)}</span>`).join('')}</div><div class="date-weeks"></div></div>
    <div class="date-opts">
      <label class="date-opt"><span>${esc(tr('date.end-date'))}</span><span class="switch"><input type="checkbox" role="switch" class="date-end-on" ${w.endDay ? 'checked' : ''}></span></label>
      <input class="date-input date-end" type="text" spellcheck="false" autocomplete="off" aria-label="${esc(tr('date.end-date'))}" placeholder="${esc(tr('date.type-a-date'))}" ${w.endDay ? '' : 'hidden'}>
      <label class="date-opt"><span>${esc(tr('date.include-time'))}</span><span class="switch"><input type="checkbox" role="switch" class="date-time-on" ${w.time ? 'checked' : ''}></span></label>
      <div class="date-times" ${w.time ? '' : 'hidden'}><input class="date-time" type="time" aria-label="${esc(tr('date.start-time'))}" value="${esc(w.time || '09:00')}"><span class="date-times-to" aria-hidden="true">→</span><input class="date-time date-end-time" type="time" aria-label="${esc(tr('date.end-time'))}" value="${esc(w.endTime || '')}"></div>
      <label class="date-opt"><span>${esc(tr('date.remind'))}</span><select class="date-remind" aria-label="${esc(tr('date.remind'))}">
        <option value="">${esc(tr('date.remind-none'))}</option>${REMIND_PRESETS.map((r) => `<option value="${r}">${esc(presetLabel(r))}</option>`).join('')}<option value="custom">${esc(tr('date.remind-custom'))}</option></select></label>
      <div class="date-custom" ${custom ? '' : 'hidden'}><input class="date-custom-n" type="number" min="1" max="999" value="${custom ? custom[1] : 15}" aria-label="${esc(tr('date.remind-amount'))}"><select class="date-custom-u" aria-label="${esc(tr('date.remind-unit'))}">${['m', 'h', 'd', 'w'].map((u) => `<option value="${u}" ${custom?.[2] === u ? 'selected' : ''}>${esc(tr(UNIT[u]))}</option>`).join('')}</select><span>${esc(tr('date.before'))}</span></div>
    </div>
    <div class="date-foot">${onOpenNote ? `<button type="button" class="btn btn-quiet" data-act="note">${esc(tr('date.open-daily-note'))}</button>` : '<span></span>'}<button type="button" class="btn btn-quiet date-remove" data-act="remove">${esc(tr('date.remove'))}</button></div>`;
  document.body.append(pop);
  const $ = (s) => pop.querySelector(s);
  const input = $('.date-input'), hint = $('.date-hint'), endInput = $('.date-end'), remindSel = $('.date-remind');
  input.value = formatDay(isoDay(sel), { style: 'full', lang });
  if (w.endDay) endInput.value = formatDay(w.endDay, { style: 'full', lang });
  remindSel.value = w.remind == null ? '' : isPreset(w.remind) ? w.remind : 'custom';

  const draw = (moveFocus = false) => {
    $('.date-month').textContent = view.toLocaleDateString(loc, { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase());
    const weeks = monthGrid(view.getFullYear(), view.getMonth(), lang);
    $('.date-weeks').innerHTML = weeks.map((wk) => `<div class="date-row" role="row">${wk.map((d) => {
      const k = isoDay(d); const out = d.getMonth() !== view.getMonth(); const on = k === w.day || k === w.endDay;
      const inRange = w.endDay && k > w.day && k < w.endDay;
      return `<button type="button" role="gridcell" class="date-day${out ? ' is-out' : ''}${k === isoDay(now) ? ' is-today' : ''}${on ? ' is-sel' : ''}${inRange ? ' is-range' : ''}" data-day="${k}" tabindex="${k === isoDay(focus) ? 0 : -1}" aria-selected="${on}" aria-label="${esc(fullDay(k, lang))}">${d.getDate()}</button>`;
    }).join('')}</div>`).join('');
    if (moveFocus) pop.querySelector(`[data-day="${isoDay(focus)}"]`)?.focus();
  };
  draw();

  const place = () => {
    const r = anchor.getBoundingClientRect(); const h = pop.offsetHeight, wd = pop.offsetWidth;
    pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - wd - 8))}px`;
    pop.style.top = `${innerHeight - r.bottom - 8 >= h ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
  };
  place();
  let closed = false;
  const result = () => ({ day: w.day, time: w.time, endDay: w.endDay && w.endDay >= w.day ? w.endDay : null, endTime: w.time ? w.endTime : null, remind: w.remind });
  const live = () => { if (!closed) onPick?.(result(), { live: true }); };
  const pick = (k) => { if (closed) return; w.day = k; if (w.endDay && w.endDay < k) w.endDay = null; close(); onPick?.(result()); }; // a slow parse finishing after Esc does nothing
  const close = () => { closed = true; pop.remove(); document.removeEventListener('mousedown', outside, true); open = null; anchor.isConnected && anchor.focus?.(); };
  const outside = (e) => { if (!pop.contains(e.target)) close(); };
  document.addEventListener('mousedown', outside, true);
  open = { close };

  pop.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.day) {
      if (!w.endDay && !$('.date-end-on').checked) return pick(b.dataset.day);
      if (target === 'start') { w.day = b.dataset.day; if (!w.endDay || w.endDay < w.day) w.endDay = w.day; target = 'end'; input.value = formatDay(w.day, { style: 'full', lang }); }
      else { if (b.dataset.day < w.day) { w.endDay = w.day; w.day = b.dataset.day; } else w.endDay = b.dataset.day; target = 'start'; input.value = formatDay(w.day, { style: 'full', lang }); }
      endInput.value = formatDay(w.endDay, { style: 'full', lang }); draw(); return live();
    }
    if (b.dataset.add != null) { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + +b.dataset.add, 12); return pick(isoDay(d)); }
    if (b.dataset.nav != null) { const n = +b.dataset.nav; view = n ? new Date(view.getFullYear(), view.getMonth() + n, 1, 12) : new Date(now.getFullYear(), now.getMonth(), 1, 12); if (!n) focus = new Date(now); return draw(); }
    if (b.dataset.act === 'remove') { close(); return onPick?.(null); }
    if (b.dataset.act === 'note') { close(); return onOpenNote?.(); }
  });
  /* the options write at once, the popover stays open (Notion) */
  $('.date-end-on').addEventListener('change', (e) => {
    endInput.hidden = !e.target.checked; target = e.target.checked ? 'end' : 'start';
    if (e.target.checked) { w.endDay = w.day; endInput.value = formatDay(w.day, { style: 'full', lang }); } else w.endDay = null;
    draw(); live();
  });
  $('.date-time-on').addEventListener('change', (e) => {
    $('.date-times').hidden = !e.target.checked;
    w.time = e.target.checked ? ($('.date-time').value || '09:00') : null; if (!w.time) w.endTime = null;
    remindSel.querySelector('option[value="0"]').textContent = presetLabel('0');
    live();
  });
  $('.date-time').addEventListener('change', (e) => { if (e.target.value) { w.time = e.target.value; live(); } });
  $('.date-end-time').addEventListener('change', (e) => { w.endTime = e.target.value || null; live(); });
  const customValue = () => { const n = Math.max(1, Math.min(999, Math.round(+$('.date-custom-n').value || 0))); return `${n}${$('.date-custom-u').value}`; };
  remindSel.addEventListener('change', () => {
    const v = remindSel.value; $('.date-custom').hidden = v !== 'custom';
    w.remind = v === '' ? null : v === 'custom' ? customValue() : v; live();
  });
  for (const el of [$('.date-custom-n'), $('.date-custom-u')]) el.addEventListener('change', () => { if (remindSel.value === 'custom' && offsetMinutes(customValue()) != null) { w.remind = customValue(); live(); } });

  let seq = 0;
  input.addEventListener('input', async () => {
    const n = ++seq; const k = await parseTyped(input.value, now, lang); if (n !== seq) return;
    hint.textContent = k ? fullDay(k, lang) : input.value.trim() ? tr('date.not-a-date') : '';
    hint.dataset.ok = String(!!k);
    if (k) { const d = parseDay(k).date; view = new Date(d.getFullYear(), d.getMonth(), 1, 12); focus = d; draw(); }
  });
  endInput.addEventListener('change', async () => {
    const k = await parseTyped(endInput.value, now, lang); if (closed) return;
    if (!k) { hint.textContent = tr('date.not-a-date'); return; }
    w.endDay = k < w.day ? w.day : k; endInput.value = formatDay(w.endDay, { style: 'full', lang }); draw(); live();
  });
  pop.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return close(); }
    if (e.target === endInput) { if (e.key === 'Enter') { e.preventDefault(); endInput.dispatchEvent(new Event('change')); } return; }
    if (e.target === input) {
      if (e.key === 'Enter') { e.preventDefault(); const k = await parseTyped(input.value, now, lang); if (closed) return; if (k) pick(k); else hint.textContent = tr('date.not-a-date'); }
      if (e.key === 'ArrowDown') { e.preventDefault(); draw(true); }
      return;
    }
    if (!e.target.closest?.('.date-grid')) return;
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
