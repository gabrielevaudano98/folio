// Folio — the Properties panel above the title of a page (D8). It edits the front matter through page-props.js,
// so each change rewrites only that property's lines. `get()` returns the front matter block, `set(text)` stores it.
import { t as tr, tl } from './i18n.js';
import { parseProps, setProp, removeProp, renameProp, newKey, TYPES, remindKeys, setPropRemind, isRemindValue, REMIND_SUFFIX } from './page-props.js';
import { REMIND_PRESETS } from './page-when.js';
import { popupMenu } from './page-table.js';
import { openEmojiPicker } from './page-icon.js';
import { readAppearance, ownedKeys, setCover, setAppearance } from './page-appearance.js';
import { openCoverPicker, paintCover } from './page-appearance-ui.js';
/* the page icon (Notion): front matter `icon:`, drawn above the title, not listed with the properties */
const ICON_KEY = 'icon';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TYPE_LABEL = { text: tr('props.text'), number: 'Number', checkbox: 'Checkbox', date: 'Date', datetime: tl('props', 'Date and time'), list: 'List', tags: 'Tags', link: tl('props', 'Link to a page'), object: tl('props', 'Nested (edit in source)') };
const TYPE_ICON = { text: tr('props.counter'), number: 'heading', checkbox: 'check', date: 'calendar', datetime: 'calendar', list: 'listBullet', tags: 'tag', link: 'link', object: 'source' };
/* a value carried over when the type changes */
const convert = (v, t) => {
  const list = Array.isArray(v) ? v : v === '' || v == null ? [] : [String(v)];
  if (t === 'list' || t === 'tags') return list;
  const one = Array.isArray(v) ? v.join(', ') : v;
  if (t === 'checkbox') return one === true || /^(true|yes|1|x)$/i.test(String(one));
  if (t === 'number') return Number.isNaN(Number(one)) || one === '' || one === false ? '' : Number(one);
  if (t === 'date') return /^\d{4}-\d{2}-\d{2}/.test(String(one)) ? String(one).slice(0, 10) : '';
  if (t === 'datetime') return /^\d{4}-\d{2}-\d{2}/.test(String(one)) ? String(one).slice(0, 10) + 'T09:00' : '';
  return one === true ? 'true' : one === false ? 'false' : String(one ?? '');
};

export function mountProps(page, { icons, get, set, tags = async () => [], onLink, onTag, onAdded, onType, locked = () => false, resolveImage = null, pickCover = null }) {
  const box = document.createElement('section'); box.className = 'props'; box.setAttribute('aria-label', tl('props', 'Properties'));
  page.prepend(box);
  let open = true, adding = null, repo = false;
  const ic = (n) => icons[n] || '';
  const commit = (fn) => { if (locked()) return render(); const before = get(); const after = fn(before); if (after !== before) set(after); render(); };

  /* a date property's reminder (`<name>-remind:`): a bell menu beside the date, as in the date popover */
  const REMIND_LABEL = { '5m': 'date.remind-5m', '10m': 'date.remind-10m', '30m': 'date.remind-30m', '1h': 'date.remind-1h', '1d': 'date.remind-1d', '2d': 'date.remind-2d' };
  const remindHtml = (p, cur) => {
    const at = tr(p.type === 'datetime' ? 'date.remind-at-time' : 'date.remind-on-day');
    const opts = ['', ...REMIND_PRESETS, ...(cur && !REMIND_PRESETS.includes(cur) ? [cur] : [])];
    return `<select class="prop-remind${cur ? ' is-on' : ''}" aria-label="${esc(tr('props.remind', { key: p.key }))}" title="${esc(tr('date.remind'))}">${opts.map((o) => `<option value="${o}"${o === (cur || '') ? ' selected' : ''}>${esc(o === '' ? tr('date.remind-none') : o === '0' ? at : REMIND_LABEL[o] ? tr(REMIND_LABEL[o]) : o)}</option>`).join('')}</select>`;
  };
  const valueHtml = (p, remind) => {
    const id = `prop-${p.key.replace(/\W+/g, '-')}`;
    if (p.readOnly) return `<code class="prop-raw" title="${tr('props.nested-values-are-edited-in-the-source')}">${esc(String(p.value).trim())}</code>`;
    if (p.type === 'checkbox') return `<input type="checkbox" class="prop-check" id="${id}" ${p.value ? 'checked' : ''} aria-label="${esc(p.key)}">`;
    if (p.type === 'list' || p.type === 'tags') {
      const chips = (p.value || []).map((x, i) => `<span class="prop-chip${p.type === 'tags' ? ' is-tag' : ''}"><button type="button" class="prop-chip-text" data-chip="${i}"${p.type === 'tags' ? ` data-tag="${esc(String(x).replace(/^#/, ''))}"` : ''}>${p.type === 'tags' ? '#' : ''}${esc(String(x).replace(/^#/, ''))}</button><button type="button" class="prop-chip-x" data-remove="${i}" aria-label="Remove ${esc(x)}">${ic('close')}</button></span>`).join('');
      return `<div class="prop-chips">${chips}<input class="prop-add-chip" id="${id}" type="text" placeholder="${p.value?.length ? '' : p.type === 'tags' ? 'Add a tag' : 'Add a value'}" aria-label="Add to ${esc(p.key)}" spellcheck="false"${p.type === 'tags' ? ' list="prop-tag-list"' : ''}></div>`;
    }
    const bell = p.value ? remindHtml(p, remind) : '';
    if (p.type === 'date') return `<div class="prop-date-row"><input type="date" class="prop-input" id="${id}" value="${esc(String(p.value || '').slice(0, 10))}" aria-label="${esc(p.key)}">${bell}</div>`;
    if (p.type === 'datetime') return `<div class="prop-date-row"><input type="datetime-local" class="prop-input" id="${id}" value="${esc(String(p.value || '').replace(' ', 'T').slice(0, 16))}" aria-label="${esc(p.key)}">${bell}</div>`;
    if (p.type === 'number') return `<input type="number" class="prop-input" id="${id}" value="${esc(p.value)}" aria-label="${esc(p.key)}" step="any">`;
    if (p.type === 'link') { const v = String(p.value || '').replace(/^\[\[|\]\]$/g, ''); return `<div class="prop-link-row">${v ? `<button type="button" class="prop-link" data-link="${esc(v)}" title="${tr('props.ctrl-or-click-to-open')}">${esc(v)}</button>` : ''}<input type="text" class="prop-input prop-link-input" id="${id}" value="${esc(v)}" placeholder="${tr('props.page-name')}" aria-label="${esc(p.key)}" spellcheck="false"${v ? ' hidden' : ''}></div>`; }
    return `<input type="text" class="prop-input" id="${id}" value="${esc(p.value)}" placeholder="${tr('props.empty')}" aria-label="${esc(p.key)}">`;
  };

  function render() {
    const all = parseProps(get()); const iconProp = all.props.find((x) => x.key === ICON_KEY && !x.readOnly && typeof x.value === 'string' && x.value.trim());
    const own = ownedKeys(get()); const ap = readAppearance(get()); const cover = ap.cover; if (!cover || cover.kind !== 'asset') repo = false;
    const rk = remindKeys(get()); const remindOf = (k) => { const r = all.props.find((x) => x.key === k + REMIND_SUFFIX); const v = r ? String(r.value ?? '').trim() : ''; return rk.has(k + REMIND_SUFFIX) && isRemindValue(v) ? v : ''; };
    const p = { ...all, props: all.props.filter((x) => x !== iconProp && !own.has(x.key) && !rk.has(x.key)) }; // appearance keys (font, cover…) and a date's reminder line are not properties
    box.classList.toggle('is-empty', !p.props.length && !adding);
    box.classList.toggle('has-icon', !!iconProp);
    box.classList.toggle('has-cover', !!cover);
    box.innerHTML = `${cover ? `<div class="page-cover${repo ? ' is-repositioning' : ''}" data-kind="${cover.kind}"${repo ? ` title="${esc(tr('cover.drag-hint'))}" tabindex="0" role="slider" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${ap.coverY}" aria-label="${esc(tr('cover.drag-hint'))}"` : ''}>
        <div class="page-cover-actions"><button type="button" class="page-cover-btn" data-cover="change">${esc(tr('cover.change'))}</button>${cover.kind === 'asset' ? `<button type="button" class="page-cover-btn" data-cover="reposition" aria-pressed="${repo}">${esc(tr(repo ? 'cover.done' : 'cover.reposition'))}</button>` : ''}<button type="button" class="page-cover-btn" data-cover="remove">${esc(tr('cover.remove'))}</button></div></div>` : ''}${iconProp ? `<button type="button" class="page-icon" aria-label="${esc(tr('icon.change'))}" title="${esc(tr('icon.change'))}">${esc(iconProp.value.trim())}</button>` : ''}
      <div class="page-head-actions">${cover ? '' : `<button type="button" class="props-cover-add">${ic('image') || ic('plus')}<span>${esc(tr('cover.add'))}</span></button>`}${iconProp ? '' : `<button type="button" class="props-icon-add">${ic('smile') || ic('plus')}<span>${esc(tr('icon.add'))}</span></button>`}</div>
      ${p.props.length ? `<button type="button" class="props-head" aria-expanded="${open}">${ic('chevron')}<span>${tr('props.properties')}</span><span class="props-count">${p.props.length}</span></button>` : ''}
      <div class="props-rows"${open ? '' : ' hidden'}>${p.props.map((x) => `<div class="prop-row" data-key="${esc(x.key)}" data-type="${x.type}">
        <button type="button" class="prop-key" aria-haspopup="menu" aria-label="${esc(x.key)}: ${TYPE_LABEL[x.type]}. Change type, rename or remove" data-tip="${TYPE_LABEL[x.type]}">${ic(TYPE_ICON[x.type])}<span>${esc(x.key)}</span></button>
        <div class="prop-value">${valueHtml(x, remindOf(x.key))}</div></div>`).join('')}
        ${adding ? `<div class="prop-row is-new"><span class="prop-key">${ic('plus')}<input class="prop-new-key" type="text" value="${esc(adding)}" aria-label="${tr('props.property-name')}" spellcheck="false"></span><div class="prop-value prop-hint">${tr('props.enter-to-add-esc-to-cancel')}</div></div>` : ''}
      </div>
      <button type="button" class="props-add"${open || !p.props.length ? '' : ' hidden'}>${ic('plus')}<span>${tr('props.add-property')}</span></button>
      <datalist id="prop-tag-list"></datalist>`;
    if (cover) paintCover(box.querySelector('.page-cover'), cover, ap.coverY, resolveImage);
    if (adding) { const k = box.querySelector('.prop-new-key'); k.focus(); k.select(); }
    if (locked()) box.querySelectorAll('input, select, .prop-key, .page-icon, .page-cover-btn, .props-cover-add').forEach((el) => { el.disabled = true; }); // X3: read, not changed
  }

  const keyOf = (el) => el.closest('.prop-row')?.dataset.key;
  const propOf = (key) => parseProps(get()).props.find((x) => x.key === key);
  const saveInput = (inp) => {
    const key = keyOf(inp); const p = propOf(key); if (!p) return;
    let v = inp.value;
    if (p.type === 'number') v = v === '' ? '' : Number(v);
    if (p.type === 'datetime') v = v.replace('T', ' ');
    if (p.type === 'link') v = v.trim();
    if (String(v) === String(p.type === 'link' ? String(p.value || '').replace(/^\[\[|\]\]$/g, '') : p.value ?? '')) return;
    commit((t) => setProp(t, key, v, p.type));
  };
  const addChip = (inp) => {
    const key = keyOf(inp); const p = propOf(key); const vals = inp.value.split(',').map((x) => x.trim().replace(p.type === 'tags' ? /^#/ : /^$/, '').replace(p.type === 'tags' ? /\s+/g : /^$/, '-')).filter(Boolean);
    if (!vals.length) return;
    const list = [...(p.value || []), ...vals.filter((v) => !(p.value || []).includes(v))];
    commit((t) => setProp(t, key, list, p.type));
    box.querySelector(`.prop-row[data-key="${CSS.escape(key)}"] .prop-add-chip`)?.focus();
  };

  box.addEventListener('click', (e) => {
    if (e.target.closest('.props-head')) { open = !open; render(); return; }
    const cb = e.target.closest('.page-cover-btn, .props-cover-add');
    if (cb) {
      if (locked()) return;
      const how = cb.dataset.cover;
      if (how === 'reposition') { repo = !repo; render(); return; }
      if (how === 'remove') { commit((t) => setCover(t, '')); return; }
      const upload = async () => { const rel = await pickCover?.(); if (rel) commit((t) => setCover(t, rel)); };
      openCoverPicker(cb, { onGradient: (n) => commit((t) => setCover(t, `gradient-${n}`)), onUpload: upload, onRemove: how === 'change' ? () => commit((t) => setCover(t, '')) : null });
      return;
    }
    const pi = e.target.closest('.page-icon, .props-icon-add');
    if (pi) { const had = !!e.target.closest('.page-icon'); const back = () => box.querySelector('.page-icon, .props-icon-add')?.focus(); openEmojiPicker(pi, { onPick: (em) => { commit((t) => setProp(t, ICON_KEY, em, 'text')); back(); }, onRemove: had ? () => { commit((t) => removeProp(t, ICON_KEY)); back(); } : null }); return; }
    if (e.target.closest('.props-add')) { if (locked()) return; open = true; adding = newKey(get()); render(); return; }
    const rm = e.target.closest('[data-remove]');
    if (rm) { const key = keyOf(rm); const p = propOf(key); const list = p.value.filter((_, i) => i !== +rm.dataset.remove); commit((t) => setProp(t, key, list, p.type)); return; }
    const tag = e.target.closest('[data-tag]'); if (tag) { onTag?.(tag.dataset.tag); return; }
    const link = e.target.closest('.prop-link'); // on a locked page a plain click opens the page: there is nothing to edit
    if (link) { if (e.ctrlKey || e.metaKey || locked()) onLink?.(link.dataset.link); else { link.hidden = true; const i = link.parentElement.querySelector('input'); i.hidden = false; i.focus(); } return; }
    const key = e.target.closest('.prop-key');
    if (key && !key.closest('.is-new')) openMenu(key);
  });
  /* reposition: drag the picture up or down; the position is written once, when the pointer is released */
  box.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('.page-cover.is-repositioning'); const img = c?.querySelector('.page-cover-img'); if (!c || !img || e.target.closest('.page-cover-btn') || locked()) return;
    e.preventDefault();
    const y0 = readAppearance(get()).coverY, h = c.getBoundingClientRect().height || 1, from = e.clientY; let y = y0;
    try { c.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer cannot be captured */ }
    const move = (ev) => { y = Math.min(100, Math.max(0, Math.round(y0 - ((ev.clientY - from) / h) * 100))); img.style.objectPosition = `50% ${y}%`; };
    const end = () => { c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', cancel); };
    const up = () => { end(); if (y !== y0) commit((t) => setAppearance(t, 'cover-y', y)); };
    const cancel = () => { end(); img.style.objectPosition = `50% ${y0}%`; }; // an interrupted drag is aborted, never saved half-way
    c.addEventListener('pointermove', move); c.addEventListener('pointerup', up); c.addEventListener('pointercancel', cancel);
  });
  /* the same, from the keyboard: Up and Down move the picture in steps of 5 */
  box.addEventListener('keydown', (e) => {
    const c = e.target.closest?.('.page-cover.is-repositioning'); if (!c || e.target !== c || locked() || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const y = Math.min(100, Math.max(0, readAppearance(get()).coverY + (e.key === 'ArrowUp' ? 5 : -5)));
    commit((t) => setAppearance(t, 'cover-y', y)); setTimeout(() => box.querySelector('.page-cover.is-repositioning')?.focus(), 0);
  });
  box.addEventListener('change', (e) => {
    const t = e.target;
    if (t.classList.contains('prop-check')) { const key = keyOf(t); commit((x) => setProp(x, key, t.checked, 'checkbox')); }
    else if (t.classList.contains('prop-remind')) { const key = keyOf(t); commit((x) => setPropRemind(x, key, t.value)); box.querySelector(`.prop-row[data-key="${CSS.escape(key)}"] .prop-remind`)?.focus(); }
    else if (t.classList.contains('prop-input') && (t.type === 'date' || t.type === 'datetime-local')) saveInput(t);
  });
  box.addEventListener('focusout', (e) => {
    const t = e.target;
    if (t.classList.contains('prop-input') && t.type !== 'date' && t.type !== 'datetime-local') saveInput(t);
    if (t.classList.contains('prop-add-chip') && t.value.trim()) addChip(t);
    if (t.classList.contains('prop-new-key')) setTimeout(() => { if (adding && !box.contains(document.activeElement)) { adding = null; render(); } }, 0);
  });
  box.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.classList.contains('prop-new-key')) {
      if (e.key === 'Enter') { e.preventDefault(); const k = t.value.trim(); adding = null; if (k && /^[A-Za-z_][\w .-]*$/.test(k) && !propOf(k)) { commit((x) => setProp(x, k, '', 'text')); onAdded?.(k); box.querySelector(`.prop-row[data-key="${CSS.escape(k)}"] input`)?.focus(); } else render(); }
      if (e.key === 'Escape') { e.preventDefault(); adding = null; render(); }
      return;
    }
    if (t.classList.contains('prop-add-chip')) {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addChip(t); }
      if (e.key === 'Backspace' && !t.value) { const key = keyOf(t); const p = propOf(key); if (p?.value?.length) { e.preventDefault(); commit((x) => setProp(x, key, p.value.slice(0, -1), p.type)); box.querySelector(`.prop-row[data-key="${CSS.escape(key)}"] .prop-add-chip`)?.focus(); } }
      return;
    }
    if (t.classList.contains('prop-input') && e.key === 'Enter') { e.preventDefault(); saveInput(t); t.blur(); }
    if (t.classList.contains('prop-input') && e.key === 'Escape') { e.preventDefault(); render(); }
  });
  box.addEventListener('focusin', async (e) => {
    if (!e.target.matches('.prop-add-chip[list]')) return;
    const dl = box.querySelector('#prop-tag-list'); if (dl.childElementCount) return;
    const all = await Promise.resolve(tags()).catch(() => []);
    dl.innerHTML = all.slice(0, 200).map((x) => `<option value="${esc(x.tag)}"></option>`).join('');
  });

  function openMenu(btn) {
    const key = btn.closest('.prop-row').dataset.key; const p = propOf(key); if (!p) return;
    const items = [{ head: tr('props.type') }, ...(p.readOnly ? [{ label: TYPE_LABEL.object, icon: ic('source'), checked: true, disabled: true, run() {} }] : TYPES.map((t) => ({ label: TYPE_LABEL[t], icon: ic(TYPE_ICON[t]), checked: p.type === t, run: () => { commit((x) => setProp(x, key, convert(p.value, t), t)); onType?.(key, t); } }))), '-',
      { label: tr('props.rename'), icon: ic('rename'), run: () => renameInline(key) },
      { label: tr('props.remove-property'), icon: ic('trash'), danger: true, run: () => commit((x) => removeProp(x, key)) }];
    popupMenu(btn, items, { label: tr('props.property-key', { key }) });
  }
  function renameInline(key) {
    const row = box.querySelector(`.prop-row[data-key="${CSS.escape(key)}"] .prop-key span`); if (!row) return;
    const inp = document.createElement('input'); inp.className = 'prop-new-key'; inp.value = key; inp.setAttribute('aria-label', tl('props', 'New name')); row.replaceWith(inp); inp.focus(); inp.select();
    const done = (ok) => { inp.onblur = null; if (ok) commit((x) => renameProp(x, key, inp.value)); else render(); };
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') { e.preventDefault(); done(false); } };
    inp.onblur = () => done(true);
  }

  render();
  return { render, pickIcon() { const b = box.querySelector('.page-icon, .props-icon-add'); if (b) b.click(); }, add() { if (locked()) return; open = true; adding = newKey(get()); render(); }, el: box };
}
