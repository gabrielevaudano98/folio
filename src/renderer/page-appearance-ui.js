// Folio — the page's appearance in the interface (Notion's "Appearance & layout"): the popover opened from the page menu,
// the cover picker, and the floating table of contents. The file edits go through page-appearance.js.
import { t as tr } from './i18n.js';
import { readAppearance, GRADIENTS } from './page-appearance.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let current = null;
const closeCurrent = () => { current?.close(); current = null; };

/** place a popover under its anchor, kept inside the window; closes on an outside click or Escape */
function place(pop, anchor, onClose) {
  document.body.append(pop);
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
  const h = pop.offsetHeight, w = pop.offsetWidth;
  pop.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
  pop.style.top = `${innerHeight - r.bottom - 8 >= h ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
  const close = () => { pop.remove(); document.removeEventListener('mousedown', outside, true); if (current?.pop === pop) current = null; onClose?.(); };
  const outside = (e) => { if (!pop.contains(e.target) && !anchor.contains?.(e.target)) close(); };
  document.addEventListener('mousedown', outside, true);
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); anchor.focus?.(); } });
  current = { close, pop };
  return close;
}

/**
 * the Appearance popover: font, small text, full width, table of contents.
 * get() returns the page text (or its front matter); apply(key, value) writes one option; locked() disables the controls;
 * defaults() gives the app-wide font, small text and full width (Settings) the page follows where it says nothing.
 */
export function openAppearance(anchor, { get, apply, locked = () => false, defaults = () => ({}) }) {
  closeCurrent();
  const pop = document.createElement('div'); pop.className = 'ap-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', tr('appearance.title'));
  const fonts = [['', 'appearance.font-sans'], ['serif', 'appearance.font-serif'], ['mono', 'appearance.font-mono']]; // the one shown is checked: the page's own, or the Settings default
  const rows = [['small-text', 'small', 'appearance.small-text'], ['full-width', 'full', 'appearance.full-width'], ['toc', 'toc', 'appearance.toc']];
  const draw = () => {
    const a = readAppearance(get(), defaults()); const off = locked();
    pop.innerHTML = `<div class="ap-head">${esc(tr('appearance.font'))}</div>
      <div class="ap-fonts" role="radiogroup" aria-label="${esc(tr('appearance.font'))}">${fonts.map(([v, k]) => `<button type="button" role="radio" class="ap-font" data-font="${v}" aria-checked="${a.font === v}"${off ? ' disabled' : ''}><span class="ap-ag ap-ag-${v || 'sans'}" aria-hidden="true">Ag</span><span>${esc(tr(k))}</span></button>`).join('')}</div>
      <div class="ap-sep" role="separator"></div>
      ${rows.map(([key, prop, k]) => `<button type="button" role="switch" class="ap-row" data-opt="${key}" aria-checked="${a[prop]}"${off ? ' disabled' : ''}><span>${esc(tr(k))}</span><span class="ap-switch" aria-hidden="true"></span></button>`).join('')}`;
  };
  draw();
  pop.addEventListener('click', (e) => {
    const f = e.target.closest('[data-font]'); const o = e.target.closest('[data-opt]');
    if (f) apply('font', f.dataset.font); else if (o) apply(o.dataset.opt, o.getAttribute('aria-checked') !== 'true'); else return;
    draw(); (f ? pop.querySelector(`[data-font="${f.dataset.font}"]`) : pop.querySelector(`[data-opt="${o.dataset.opt}"]`))?.focus();
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const all = [...pop.querySelectorAll('button:not([disabled])')]; const i = all.indexOf(document.activeElement); if (i < 0) return;
    e.preventDefault(); all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length].focus();
  });
  place(pop, anchor);
  (pop.querySelector('[aria-checked="true"].ap-font:not([disabled])') || pop.querySelector('button:not([disabled])'))?.focus({ preventScroll: true });
  return pop;
}

/** the cover picker: the built-in gradients and "choose an image" */
export function openCoverPicker(anchor, { onGradient, onUpload, onRemove = null }) {
  closeCurrent();
  const pop = document.createElement('div'); pop.className = 'ap-pop ap-cover-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', tr('cover.choose'));
  pop.innerHTML = `<div class="ap-head">${esc(tr('cover.gradients'))}</div>
    <div class="ap-grads">${Array.from({ length: GRADIENTS }, (_, i) => `<button type="button" class="ap-grad cover-g${i + 1}" data-grad="${i + 1}" aria-label="${esc(tr('cover.gradient-n', { n: i + 1 }))}"></button>`).join('')}</div>
    <div class="ap-sep" role="separator"></div>
    <button type="button" class="ap-row ap-act" data-act="upload"><span>${esc(tr('cover.choose-image'))}</span></button>
    ${onRemove ? `<button type="button" class="ap-row ap-act is-danger" data-act="remove"><span>${esc(tr('cover.remove'))}</span></button>` : ''}`;
  const close = place(pop, anchor);
  pop.addEventListener('click', (e) => {
    const g = e.target.closest('[data-grad]'); const a = e.target.closest('[data-act]');
    if (g) { close(); onGradient(+g.dataset.grad); } else if (a?.dataset.act === 'upload') { close(); onUpload(); } else if (a?.dataset.act === 'remove') { close(); onRemove(); }
  });
  pop.querySelector('.ap-grad')?.focus({ preventScroll: true });
  return pop;
}

/** a cover's picture, drawn into `el` (an element with class page-cover or page-cover-read); resolve(src) gives a usable address */
export function paintCover(el, cover, y, resolve) {
  el.className = el.className.replace(/\bcover-g\d+\b/g, '').trim();
  el.querySelector('.page-cover-img')?.remove();
  if (!cover) return;
  if (cover.kind === 'gradient') { el.classList.add(`cover-g${cover.n}`); return; }
  const img = document.createElement('img'); img.className = 'page-cover-img'; img.alt = ''; img.draggable = false; img.style.objectPosition = `50% ${y}%`;
  el.prepend(img);
  Promise.resolve(resolve?.(cover.src)).then((u) => { if (u && img.isConnected) img.src = u; });
}

/** the floating table of contents: thin lines on the right edge that open to the heading list on hover or focus */
export function mountToc(scroller, { root }) {
  const nav = document.createElement('nav'); nav.className = 'page-toc'; nav.setAttribute('aria-label', tr('toc.title')); nav.hidden = true;
  nav.innerHTML = '<div class="page-toc-in"><div class="page-toc-rail" aria-hidden="true"></div><ol class="page-toc-list"></ol></div>';
  scroller.prepend(nav);
  const rail = nav.querySelector('.page-toc-rail'), list = nav.querySelector('.page-toc-list');
  let heads = [], sig = '', on = false, raf = 0;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function mark() {
    raf = 0; if (nav.hidden || !heads.length) return;
    const top = scroller.getBoundingClientRect().top + 96; let cur = 0;
    heads.forEach((h, i) => { if (h.el.getBoundingClientRect().top <= top) cur = i; });
    rail.querySelectorAll('i').forEach((n, i) => n.classList.toggle('is-current', i === cur));
    list.querySelectorAll('button').forEach((b, i) => { b.classList.toggle('is-current', i === cur); if (i === cur) b.setAttribute('aria-current', 'location'); else b.removeAttribute('aria-current'); });
  }
  const soon = () => { if (!raf) raf = requestAnimationFrame(mark); };
  scroller.addEventListener('scroll', soon, { passive: true });
  list.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; heads[+b.dataset.i]?.el.scrollIntoView({ block: 'start', behavior: reduce() ? 'auto' : 'smooth' }); });
  return {
    el: nav,
    /** show when enabled and the page has two or more headings; cheap to call often */
    refresh(enabled) {
      on = !!enabled;
      const found = on ? [...root().querySelectorAll('h1, h2, h3, h4, h5, h6')].map((el) => ({ el, level: +el.tagName[1], text: el.textContent.replace(/\s+/g, ' ').trim() })).filter((h) => h.text) : [];
      if (found.length < 2) { heads = []; sig = ''; nav.hidden = true; return; }
      heads = found; nav.hidden = false;
      const min = Math.min(...found.map((h) => h.level)); const s = found.map((h) => `${h.level}${h.text}`).join('\n');
      if (s !== sig) {
        sig = s;
        rail.innerHTML = found.map((h) => `<i style="--w:${Math.max(8, 20 - (h.level - min) * 5)}px"></i>`).join('');
        list.innerHTML = found.map((h, i) => `<li style="--d:${Math.min(3, h.level - min)}"><button type="button" data-i="${i}">${esc(h.text)}</button></li>`).join('');
      }
      soon();
    },
    destroy() { nav.remove(); },
  };
}
