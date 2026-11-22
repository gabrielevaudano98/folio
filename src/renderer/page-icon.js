// Folio — the emoji picker of a page icon and of callouts (Notion's icon picker, macOS Character Viewer).
// Search by name, categories, a random pick, remove. The emoji itself is page content; the picker is grey.
import { t as tr } from './i18n.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let list = null;
const load = async () => (list ||= (await import('gemoji')).gemoji.filter((e) => e.category !== 'Flags' || /^flag/.test(e.names[0])));

let current = null;
export const closeEmojiPicker = () => current?.close();

/** anchor: the element it opens under; onPick(emoji); onRemove() when there is something to remove */
export async function openEmojiPicker(anchor, { onPick, onRemove = null } = {}) {
  closeEmojiPicker();
  const all = await load();
  const pop = document.createElement('div'); pop.className = 'emoji-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', tr('icon.choose'));
  pop.innerHTML = `<div class="emoji-top"><input class="emoji-q" type="search" spellcheck="false" placeholder="${esc(tr('icon.search'))}" aria-label="${esc(tr('icon.search'))}">
    <button type="button" class="btn btn-quiet emoji-rand" title="${esc(tr('icon.random'))}" aria-label="${esc(tr('icon.random'))}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h2.5c2.5 0 3.5 8 6 8H14M2 12h2.5C6 12 7 9.5 7.8 8M10.5 4H14M12 2l2 2-2 2M12 10l2 2-2 2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    ${onRemove ? `<button type="button" class="btn btn-quiet emoji-rm">${esc(tr('icon.remove'))}</button>` : ''}</div>
    <div class="emoji-body" role="listbox" aria-label="${esc(tr('icon.choose'))}"></div>`;
  document.body.append(pop);
  const body = pop.querySelector('.emoji-body'), q = pop.querySelector('.emoji-q');
  const cell = (e) => `<button type="button" role="option" class="emoji-cell" data-e="${esc(e.emoji)}" title="${esc(e.names[0].replace(/_/g, ' '))}" aria-label="${esc(e.description || e.names[0])}">${esc(e.emoji)}</button>`;
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    if (t) { const hits = all.filter((e) => e.names.some((n) => n.includes(t)) || e.tags.some((n) => n.includes(t)) || (e.description || '').includes(t)).slice(0, 120); body.innerHTML = hits.length ? `<div class="emoji-grid">${hits.map(cell).join('')}</div>` : `<p class="emoji-none">${esc(tr('icon.none'))}</p>`; return; }
    const cats = new Map(); for (const e of all) { if (!cats.has(e.category)) cats.set(e.category, []); cats.get(e.category).push(e); }
    body.innerHTML = [...cats].map(([c, es]) => `<div class="emoji-cat">${esc(c)}</div><div class="emoji-grid">${es.map(cell).join('')}</div>`).join('');
  };
  draw();
  const r = anchor.getBoundingClientRect(); const h = pop.offsetHeight, w = pop.offsetWidth;
  pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  pop.style.top = `${innerHeight - r.bottom - 8 >= h ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
  const close = () => { pop.remove(); document.removeEventListener('mousedown', outside, true); current = null; };
  const outside = (e) => { if (!pop.contains(e.target)) close(); };
  document.addEventListener('mousedown', outside, true);
  current = { close };
  q.addEventListener('input', draw);
  pop.addEventListener('click', (e) => {
    const c = e.target.closest('.emoji-cell'); if (c) { close(); onPick?.(c.dataset.e); return; }
    if (e.target.closest('.emoji-rand')) { const x = all[Math.floor(Math.random() * Math.min(all.length, 1400))]; close(); onPick?.(x.emoji); return; }
    if (e.target.closest('.emoji-rm')) { close(); onRemove?.(); }
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); anchor.focus?.(); }
    if (e.key === 'Enter' && e.target === q) { e.preventDefault(); body.querySelector('.emoji-cell')?.click(); }
    if (e.key === 'ArrowDown' && e.target === q) { e.preventDefault(); body.querySelector('.emoji-cell')?.focus(); }
    const cells = [...body.querySelectorAll('.emoji-cell')]; const i = cells.indexOf(document.activeElement);
    if (i >= 0) { const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }[e.key]; if (step) { e.preventDefault(); cells[Math.max(0, Math.min(cells.length - 1, i + step))].focus(); } }
  });
  q.focus();
  return current;
}
