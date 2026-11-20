// Folio — find and replace in the Write view (D7). Matches are found per text block (a paragraph, heading, cell),
// across bold or links inside it; other inline nodes (maths, footnotes) count as one character that never matches.
// Replace all is one transaction, so one Undo puts everything back.
import { t as tr, tl } from './i18n.js';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const OBJ = '￼';

/** the text of every text block, with the document position of each character */
export function textBlocks(doc) {
  const out = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.spec.code && node.type.name !== 'codeBlock') return false;
    let text = ''; const at = [];
    node.forEach((child, off) => {
      const start = pos + 1 + off;
      if (child.isText) { for (let i = 0; i < child.text.length; i++) at.push(start + i); text += child.text; }
      else { at.push(start); text += OBJ; }
    });
    at.push(pos + node.nodeSize - 1);
    out.push({ text, at });
    return false;
  });
  return out;
}

/** a RegExp for the query, or null when the query is empty or not a valid pattern */
export function pattern(query, { matchCase = false, wholeWord = false, regex = false } = {}) {
  if (!query) return null;
  let src = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  try { return new RegExp(src, `gu${matchCase ? '' : 'i'}`); } catch { return null; }
}

/** every match as { from, to } document positions, in order */
export function findMatches(doc, query, opts = {}) {
  const re = pattern(query, opts); if (!re) return [];
  const out = [];
  for (const b of textBlocks(doc)) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(b.text))) {
      if (!m[0].length) { re.lastIndex++; continue; }
      if (m[0].includes(OBJ)) continue;
      out.push({ from: b.at[m.index], to: b.at[m.index + m[0].length - 1] + 1, groups: m });
      if (out.length > 5000) return out;
    }
  }
  return out;
}

/** the replacement text for a match: $1, $& work when the query is a pattern */
export const replacement = (m, text, regex) => (regex ? text.replace(/\$(\d+|&)/g, (_, g) => (g === '&' ? m.groups[0] : m.groups[+g] ?? '')) : text);

/** replace every match in one transaction; returns how many */
export function replaceAll(state, dispatch, query, text, opts = {}) {
  const ms = findMatches(state.doc, query, opts); if (!ms.length) return 0;
  const tr = state.tr;
  for (let i = ms.length - 1; i >= 0; i--) {
    const m = ms[i]; const marks = state.doc.resolve(m.from).marksAcross(state.doc.resolve(m.to)) || [];
    const r = replacement(m, text, opts.regex);
    if (r) tr.replaceWith(m.from, m.to, state.schema.text(r, marks)); else tr.delete(m.from, m.to);
  }
  dispatch(tr.scrollIntoView());
  return ms.length;
}

const KEY = new PluginKey('folioFind');
export const FindReplace = Extension.create({
  name: 'findReplace',
  addStorage() { return { open: null }; },
  addKeyboardShortcuts() {
    return {
      'Mod-f': () => { this.storage.open?.(false); return true; },
      'Mod-h': () => { this.storage.open?.(true); return true; },
    };
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      key: KEY,
      state: {
        init: () => ({ query: '', opts: {}, current: -1, deco: DecorationSet.empty, matches: [] }),
        apply(tr, old, _o, state) {
          const meta = tr.getMeta(KEY);
          if (!meta && !tr.docChanged) return old;
          const next = { ...old, ...(meta || {}) };
          if (!next.query) return { ...next, deco: DecorationSet.empty, matches: [], current: -1 };
          const matches = findMatches(state.doc, next.query, next.opts);
          let current = next.current;
          if (meta && 'near' in meta) { current = matches.findIndex((m) => m.from >= meta.near); if (current < 0) current = matches.length ? 0 : -1; }
          current = matches.length ? Math.min(Math.max(current, 0), matches.length - 1) : -1;
          const deco = DecorationSet.create(state.doc, matches.slice(0, 2000).map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? 'find-hit is-current' : 'find-hit' })));
          return { ...next, matches, current, deco };
        },
      },
      props: { decorations: (state) => KEY.getState(state).deco },
    })];
  },
});
export const findState = (state) => KEY.getState(state);

/* the bar: a row above the page, with options, counts and replace; Esc closes and leaves the cursor on the match */
export function mountFindBar(host, editor, { icons, keyLabel = (k) => k }) {
  const bar = document.createElement('div'); bar.className = 'find-bar'; bar.hidden = true; bar.setAttribute('role', 'search');
  const t = (cmd, label, icon, key) => `<button type="button" class="rb" data-f="${cmd}" aria-label="${label}" data-tip="${label}${key ? ` (${keyLabel(key)})` : ''}">${icon}</button>`;
  const opt = (k, label, text) => `<button type="button" class="find-opt" data-opt="${k}" aria-pressed="false" aria-label="${label}" data-tip="${label}">${text}</button>`;
  bar.innerHTML = `<div class="find-row">
      <div class="find-field">${icons.find}<input class="find-q" type="text" placeholder="${tr('find.find')}" aria-label="${tr('find.find')}" spellcheck="false">${opt('matchCase', tl('find', 'Match case'), 'Aa')}${opt('wholeWord', tl('find', 'Whole words'), '<u>' + tr('find.ab') + '</u>')}${opt('regex', tl('find', 'Regular expression'), '.*')}</div>
      <span class="find-count" aria-live="polite"></span>
      ${t('prev', tl('find', 'Previous match'), icons.arrowUp, 'Shift+Enter')}${t('next', tl('find', 'Next match'), icons.arrowDown, 'Enter')}
      ${t('toggleReplace', tl('find', 'Replace'), icons.replace, 'Mod+H')}${t('close', tl('find', 'Close'), icons.close, 'Escape')}
    </div>
    <div class="find-row find-replace" hidden>
      <div class="find-field">${icons.replace}<input class="find-r" type="text" placeholder="${tr('find.replace-with')}" aria-label="${tr('find.replace-with')}" spellcheck="false"></div>
      <button type="button" class="btn" data-f="one">${tr('find.replace')}</button><button type="button" class="btn" data-f="all">${tr('find.replace-all')}</button>
    </div>`;
  host.prepend(bar);
  const q = bar.querySelector('.find-q'), r = bar.querySelector('.find-r'), count = bar.querySelector('.find-count'), repRow = bar.querySelector('.find-replace');
  const opts = { matchCase: false, wholeWord: false, regex: false };
  const set = (meta) => editor.view.dispatch(editor.state.tr.setMeta(KEY, meta));
  const paint = () => {
    const s = findState(editor.state); const n = s.matches.length;
    const bad = q.value && opts.regex && !pattern(q.value, opts);
    q.toggleAttribute('aria-invalid', !!bad);
    count.textContent = !q.value ? '' : bad ? tl('find', 'Not a valid pattern') : n ? `${s.current + 1} of ${n > 5000 ? '5000+' : n}` : tl('find', 'No results');
  };
  const reveal = () => {
    const s = findState(editor.state); const m = s.matches[s.current]; if (!m) return;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, m.from, m.to)).scrollIntoView());
    editor.view.domAtPos(m.from)?.node?.parentElement?.scrollIntoView?.({ block: 'center' });
  };
  const search = () => { set({ query: q.value, opts: { ...opts }, near: editor.state.selection.from }); paint(); };
  const go = (step) => { const s = findState(editor.state); if (!s.matches.length) return; set({ current: (s.current + step + s.matches.length) % s.matches.length }); reveal(); paint(); };
  const open = (replace) => {
    bar.hidden = false; repRow.hidden = !replace && repRow.hidden; if (replace) repRow.hidden = false;
    bar.querySelector('[data-f="toggleReplace"]').setAttribute('aria-pressed', String(!repRow.hidden));
    const sel = editor.state.selection; const picked = sel.empty ? '' : editor.state.doc.textBetween(sel.from, sel.to, ' ');
    if (picked && !picked.includes('\n') && picked.length < 200) q.value = picked;
    (replace && q.value ? r : q).focus(); (replace && q.value ? r : q).select();
    search();
  };
  const close = () => { bar.hidden = true; set({ query: '' }); editor.commands.focus(); };
  const replaceOne = () => {
    const s = findState(editor.state); const m = s.matches[s.current]; if (!m) return;
    const marks = editor.state.doc.resolve(m.from).marksAcross(editor.state.doc.resolve(m.to)) || [];
    const text = replacement(m, r.value, opts.regex);
    const tr = editor.state.tr; if (text) tr.replaceWith(m.from, m.to, editor.state.schema.text(text, marks)); else tr.delete(m.from, m.to);
    tr.setMeta(KEY, { near: m.from + text.length }); editor.view.dispatch(tr); reveal(); paint();
  };
  const all = () => { const n = replaceAll(editor.state, (tr) => editor.view.dispatch(tr), q.value, r.value, opts); search(); count.textContent = n ? `Replaced ${n}` : tl('find', 'No results'); };
  q.addEventListener('input', search);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') { e.preventDefault(); close(); } });
  r.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (e.metaKey || e.ctrlKey) all(); else replaceOne(); } if (e.key === 'Escape') { e.preventDefault(); close(); } });
  bar.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  bar.addEventListener('click', (e) => {
    const o = e.target.closest('[data-opt]'); if (o) { opts[o.dataset.opt] = !opts[o.dataset.opt]; o.setAttribute('aria-pressed', String(opts[o.dataset.opt])); search(); return; }
    const f = e.target.closest('[data-f]')?.dataset.f;
    if (f === 'next') go(1); else if (f === 'prev') go(-1); else if (f === 'close') close(); else if (f === 'one') replaceOne(); else if (f === 'all') all();
    else if (f === 'toggleReplace') { repRow.hidden = !repRow.hidden; e.target.closest('[data-f]').setAttribute('aria-pressed', String(!repRow.hidden)); (repRow.hidden ? q : r).focus(); }
  });
  editor.storage.findReplace.open = open;
  return { open, close, get isOpen() { return !bar.hidden; } };
}
