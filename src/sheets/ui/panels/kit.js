// Folio Sheets — the building blocks every side panel uses, in Folio's design system (tokens.css, styles.css):
// sections, fields, segmented controls, range inputs that take the selection, previews and status lines.
// Plain DOM, no framework: panels are small and short-lived.
import { L } from '../i18n.js';

/** h('div.class#id', { attrs, on: { click } }, ...children) */
export function h(spec, props = {}, ...kids) {
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) { kids.unshift(props); props = {}; }
  const [, tag = 'div', rest = ''] = /^([a-z0-9-]*)(.*)$/i.exec(spec);
  const el = document.createElement(tag || 'div');
  for (const m of rest.matchAll(/([.#])([\w-]+)/g)) { if (m[1] === '.') el.classList.add(m[2]); else el.id = m[2]; }
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'on') { for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn); continue; }
    if (k === 'style' && typeof v === 'object') { Object.assign(el.style, v); continue; }
    if (k === 'html') { el.innerHTML = v; continue; }
    if (k in el && !k.startsWith('aria') && !k.startsWith('data') && k !== 'for' && k !== 'role' && k !== 'list') { try { el[k] = v; continue; } catch { /* read-only property: set the attribute */ } }
    el.setAttribute(k === 'for' ? 'for' : k, v === true ? '' : String(v));
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
let uidN = 0;
export const uid = (p = 'xs') => `${p}-${++uidN}`;

export const section = (title, ...kids) => h('section.xs-sec', title ? h('h3.xs-sec-title', title) : null, ...kids);
export const hint = (text) => h('p.xs-hint', text);
export const row = (...kids) => h('div.xs-row', ...kids);

/** a labelled control; returns the wrapper with .control set */
export function field(label, control, help) {
  const id = control.id || (control.id = uid('f'));
  const w = h('div.field.xs-field', h('label', { for: id }, label), control, help ? h('div.field-help', help) : null);
  w.control = control; return w;
}
export const input = (props = {}) => h('input.input.xs-input', { type: 'text', autocomplete: 'off', spellcheck: false, ...props });
export const number = (props = {}) => input({ type: 'number', step: 'any', ...props });
export function select(options, value, props = {}) {
  const el = h('select.select.xs-select', props, options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: String(v) === String(value) }, l); }));
  return el;
}
export function checkbox(label, checked, onChange) {
  const box = h('input', { type: 'checkbox', checked: !!checked, on: { change: (e) => onChange?.(e.target.checked) } });
  // a div around the label: HTMLLabelElement.control is read-only, and panels read `.control` on every field
  const w = h('div.xs-check', h('label', box, h('span', label))); w.control = box; return w;
}
/** replace an element's children, skipping null, false and empty conditionals */
export const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false && k !== ''));
export function button(label, onClick, { primary = false, quiet = false, icon = '', title = '', disabled = false, danger = false } = {}) {
  const b = h(`button.btn${primary ? '.btn-primary' : ''}${quiet ? '.btn-quiet' : ''}${danger ? '.xs-danger' : ''}`, { type: 'button', disabled, title: title || null, 'data-tip': title || null, on: { click: (e) => onClick?.(e) } });
  if (icon) b.insertAdjacentHTML('afterbegin', icon);
  if (label) b.append(h('span', label));
  else b.setAttribute('aria-label', title);
  return b;
}
export const actions = (...kids) => h('div.xs-actions', ...kids);

/** segmented control (radio group) */
export function segmented(options, value, onChange, label = '') {
  const el = h('div.segmented.xs-seg', { role: 'radiogroup', 'aria-label': label });
  const set = (v) => { for (const b of el.children) b.setAttribute('aria-checked', String(b.dataset.v === String(v))); };
  for (const [v, l] of options) el.append(h('button', { type: 'button', role: 'radio', 'data-v': v, 'aria-checked': 'false', on: { click: () => { set(v); onChange?.(v); } } }, l));
  el.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const list = [...el.children]; const i = list.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const n = list[(i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length]; n.click(); n.focus(); e.preventDefault();
  });
  set(value); el.set = set; return el;
}
/** tabs across the top of a panel; body(id) renders a tab */
export function tabs(list, current, render) {
  const bar = h('div.dock-tabs.xs-tabs', { role: 'tablist' });
  const body = h('div.xs-tabbody', { role: 'tabpanel' });
  const show = (id) => {
    for (const b of bar.children) { const on = b.dataset.tab === id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
    body.replaceChildren(); const r = render(id, body); if (r instanceof Node) body.append(r); wrap.current = id;
  };
  for (const [id, label] of list) bar.append(h('button', { type: 'button', role: 'tab', 'data-tab': id, 'aria-selected': 'false', on: { click: () => show(id) } }, label));
  bar.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const l = [...bar.children]; const i = l.findIndex((b) => b.getAttribute('aria-selected') === 'true');
    const n = l[(i + (e.key === 'ArrowRight' ? 1 : -1) + l.length) % l.length]; n.click(); n.focus();
  });
  const wrap = h('div.xs-tabwrap', bar, body); wrap.show = show; wrap.body = body;
  queueMicrotask(() => show(current || list[0][0]));
  return wrap;
}

/** an A1 range input with a button that takes the current selection */
export function rangeInput(surface, value = '', { label = L('Range'), withSheet = true, onChange, help } = {}) {
  const inp = input({ value, placeholder: 'A1:D20', on: { change: () => onChange?.(inp.value) } });
  const take = button('', () => { inp.value = surface.selectionRef({ withSheet }); onChange?.(inp.value); inp.dispatchEvent(new Event('input')); }, { quiet: true, title: L('Use the selection'), icon: surface.icons.grid });
  const w = field(label, h('div.xs-range', inp, take), help);
  w.control = inp; w.querySelector('label').htmlFor = inp.id || (inp.id = uid('r'));
  return w;
}

/** a small read-only table (a preview); long tables are cut */
export function preview(grid, { max = 50, caption = '' } = {}) {
  if (!grid?.length) return h('p.xs-empty', L('No rows.'));
  const fmt = (v) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6)) : String(v));
  const t = h('table.xs-preview', caption ? h('caption.visually-hidden', caption) : null,
    h('thead', h('tr', grid[0].map((c) => h('th', { scope: 'col' }, fmt(c))))),
    h('tbody', grid.slice(1, max + 1).map((r) => h('tr', r.map((c) => h('td', { class: typeof c === 'number' ? 'num' : null }, fmt(c)))))));
  const w = h('div.xs-preview-wrap', t);
  if (grid.length - 1 > max) w.append(h('p.xs-hint', L('{n} more rows not shown.', { n: grid.length - 1 - max })));
  return w;
}

/** a live status line: busy, ok, error (always with words, never colour alone) */
export function status() {
  const el = h('div.xs-status', { role: 'status', 'aria-live': 'polite' });
  el.busy = (t) => { el.dataset.kind = 'busy'; el.textContent = t; };
  el.ok = (t) => { el.dataset.kind = 'ok'; el.textContent = t; };
  el.error = (t) => { el.dataset.kind = 'error'; el.textContent = t; };
  el.clear = () => { delete el.dataset.kind; el.textContent = ''; };
  return el;
}

/** a code editor (CodeMirror 6, already in the app for Markdown); lang: 'fql' | 'javascript' | 'python' | 'plain' */
export async function codeEditor(parent, { value = '', lang = 'plain', onChange, minLines = 8, label = '' } = {}) {
  const [{ EditorView, keymap, lineNumbers, highlightActiveLine }, { EditorState }, cmds, language, { highlightStyle }] = await Promise.all([
    import('@codemirror/view'), import('@codemirror/state'), import('@codemirror/commands'), import('@codemirror/language'), import('./code-style.js'),
  ]);
  const ext = [lineNumbers(), highlightActiveLine(), cmds.history(), keymap.of([...cmds.defaultKeymap, ...cmds.historyKeymap, cmds.indentWithTab]), language.syntaxHighlighting(highlightStyle(language)), language.indentOnInput(), language.bracketMatching(),
    EditorView.updateListener.of((u) => { if (u.docChanged) onChange?.(u.state.doc.toString()); }),
    EditorView.contentAttributes.of({ 'aria-label': label || L('Code') }),
    EditorView.theme({ '&': { minHeight: `${minLines * 1.5}em` }, '.cm-content': { fontFamily: 'var(--font-mono)' } })];
  if (lang === 'fql') ext.push((await import('./fql-lang.js')).fqlLanguage(language));
  else if (lang === 'javascript' || lang === 'python') {
    const { languages } = await import('@codemirror/language-data');
    const d = languages.find((l) => l.name.toLowerCase() === lang); if (d) ext.push(await d.load());
  }
  const view = new EditorView({ parent, state: EditorState.create({ doc: value, extensions: ext }) });
  view.dom.classList.add('xs-code');
  return { view, get value() { return view.state.doc.toString(); }, set value(v) { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } }); }, focus: () => view.focus(), destroy: () => view.destroy() };
}

/** plain values from a grid of Univer cells or raw values */
export const plainGrid = (g) => (g || []).map((r) => r.map((v) => (v && typeof v === 'object' && !(v instanceof Date) ? v.v ?? null : v)));
/** the first row as column names */
export const columnsOf = (grid) => (grid?.[0] || []).map((c, i) => (c == null || c === '' ? `Column ${i + 1}` : String(c)));
export const fmtNum = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: d }).format(v) : v == null ? '' : String(v));
