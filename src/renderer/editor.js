// Folio — the editor: CodeMirror 6 tuned for prose.
import { EditorState, StateField, StateEffect, RangeSetBuilder, Compartment, EditorSelection } from '@codemirror/state';
import { EditorView, keymap, Decoration, ViewPlugin, WidgetType, placeholder, drawSelection, dropCursor, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, syntaxTree, indentOnInput, bracketMatching } from '@codemirror/language';
import { classHighlighter } from '@lezer/highlight';
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';

/* heading sizes and code-block wells, by line */
const blockLines = ViewPlugin.fromClass(class {
  constructor(v) { this.decorations = this.build(v); }
  update(u) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view); }
  build(view) {
    const b = new RangeSetBuilder();
    const marks = [];
    for (const { from, to } of view.visibleRanges) {
      syntaxTree(view.state).iterate({ from, to, enter: (n) => {
        const h = n.name.match(/^ATXHeading(\d)$/);
        if (n.name.startsWith('SetextHeading') && view.state.doc.line(1).text === '---') return false;
        if (h) marks.push([view.state.doc.lineAt(n.from).from, `cm-h${h[1]}`]);
        if (n.name === 'FencedCode') {
          const a = view.state.doc.lineAt(n.from).number, z = view.state.doc.lineAt(n.to).number;
          for (let i = a; i <= z; i++) marks.push([view.state.doc.line(i).from, `cm-codeblock${i === a ? ' cm-codeblock-first' : ''}${i === z ? ' cm-codeblock-last' : ''}`]);
          return false;
        }
      } });
    }
    const doc = view.state.doc;
    if (doc.lines > 1 && doc.line(1).text === '---') {
      for (let i = 2; i <= Math.min(doc.lines, 60); i++) {
        if (doc.line(i).text === '---') { for (let j = 1; j <= i; j++) marks.push([doc.line(j).from, 'cm-frontmatter']); break; }
      }
    }
    marks.sort((x, y) => x[0] - y[0]);
    let last = -1;
    for (const [pos, cls] of marks) { if (pos === last) continue; last = pos; b.add(pos, pos, Decoration.line({ class: cls })); }
    return b.finish();
  }
}, { decorations: (v) => v.decorations });


/* ---------- live WYSIWYG: syntax hides off the cursor's lines ---------- */
class TaskWidget extends WidgetType {
  constructor(checked, pos) { super(); this.checked = checked; this.pos = pos; }
  eq(o) { return o.checked === this.checked && o.pos === this.pos; }
  toDOM(view) {
    const w = document.createElement('span'); w.className = 'cm-live-task';
    const box = document.createElement('input'); box.type = 'checkbox'; box.checked = this.checked;
    box.setAttribute('aria-label', this.checked ? 'Mark as not done' : 'Mark as done');
    box.addEventListener('mousedown', (e) => {
      e.preventDefault();
      view.dispatch({ changes: { from: this.pos, to: this.pos + 3, insert: this.checked ? '[ ]' : '[x]' }, userEvent: 'input.task' });
    });
    w.appendChild(box); return w;
  }
  ignoreEvent() { return true; }
}
class LabelWidget extends WidgetType {
  constructor(text) { super(); this.text = text; }
  eq(o) { return o.text === this.text; }
  toDOM() { const s = document.createElement('strong'); s.className = 'cm-live-label'; s.textContent = this.text; return s; }
}
class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement('span'); s.className = 'cm-live-bullet'; s.textContent = '•'; return s; }
}
class HrWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement('span'); s.className = 'cm-live-hr'; s.setAttribute('role', 'separator'); return s; }
}
class ImageWidget extends WidgetType {
  constructor(src, alt, resolve) { super(); this.src = src; this.alt = alt; this.resolve = resolve; }
  eq(o) { return o.src === this.src && o.alt === this.alt; }
  toDOM() {
    const img = document.createElement('img'); img.className = 'cm-live-img'; img.alt = this.alt; img.decoding = 'async';
    img.onerror = () => { const s = document.createElement('span'); s.className = 'cm-live-img-missing'; s.textContent = `Image not found: ${this.alt || this.src}`; img.replaceWith(s); };
    if (/^(https?:|data:|file:)/.test(this.src)) img.src = this.src;
    else Promise.resolve(this.resolve?.(this.src)).then((u) => { if (u) img.src = u; else img.onerror(); });
    return img;
  }
}
const hide = Decoration.replace({});
function liveDecorations(view, resolveImage) {
  const { state } = view;
  const active = new Set();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number, b = state.doc.lineAt(r.to).number;
    for (let i = a; i <= b; i++) active.add(i);
  }
  const deco = [];
  const lineOf = (pos) => state.doc.lineAt(pos).number;
  const off = (from, to) => { for (let i = lineOf(from); i <= lineOf(to); i++) if (active.has(i)) return false; return true; };
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({ from, to, enter: (n) => {
      const name = n.name;
      if (name === 'FencedCode' || name === 'Table' || name === 'HTMLBlock') return false;
      if (name === 'HeaderMark' && off(n.from, n.to)) {
        const next = state.sliceDoc(n.to, n.to + 1) === ' ' ? n.to + 1 : n.to;
        if (n.node.parent?.name.startsWith('ATXHeading')) deco.push(hide.range(n.from, next));
      } else if ((name === 'EmphasisMark' || name === 'StrikethroughMark') && off(n.from, n.to)) {
        deco.push(hide.range(n.from, n.to));
      } else if (name === 'CodeMark' && n.node.parent?.name === 'InlineCode' && off(n.from, n.to)) {
        deco.push(hide.range(n.from, n.to));
      } else if (name === 'Link' && off(n.from, n.to)) {
        const raw = state.sliceDoc(n.from, n.to);
        const callout = raw.match(/^\[!(note|tip|important|warning|caution)\]$/i);
        if (callout) { deco.push(Decoration.replace({ widget: new LabelWidget(callout[1][0].toUpperCase() + callout[1].slice(1).toLowerCase()) }).range(n.from, n.to)); return false; }
        if (state.sliceDoc(n.from - 1, n.from) === '[' && state.sliceDoc(n.to, n.to + 1) === ']') {
          deco.push(hide.range(n.from - 1, n.from), hide.range(n.to, n.to + 1));
        }
        const c = n.node.cursor(); if (c.firstChild()) do {
          if (c.name === 'LinkMark' || c.name === 'URL' || c.name === 'LinkTitle') {
            // hide "[" , "](" ... ")" around the label
            deco.push(hide.range(c.from, c.to));
          }
        } while (c.nextSibling());
        return false;
      } else if (name === 'Image' && off(n.from, n.to)) {
        const text = state.sliceDoc(n.from, n.to);
        const m = text.match(/^!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?/);
        if (m) deco.push(Decoration.replace({ widget: new ImageWidget(m[2], m[1], resolveImage) }).range(n.from, n.to));
        return false;
      } else if (name === 'QuoteMark') {
        const line = state.doc.lineAt(n.from);
        deco.push(Decoration.line({ class: 'cm-quote-line' }).range(line.from));
        if (off(n.from, n.to)) deco.push(hide.range(n.from, state.sliceDoc(n.to, n.to + 1) === ' ' ? n.to + 1 : n.to));
      } else if (name === 'ListMark' && off(n.from, n.to)) {
        const after = state.sliceDoc(n.to, n.to + 5);
        const isTask = /^ \[[ xX]\]/.test(after);
        const bullet = /^[-*+]$/.test(state.sliceDoc(n.from, n.to));
        if (isTask) deco.push(hide.range(n.from, n.to + 1));
        else if (bullet) deco.push(Decoration.replace({ widget: new BulletWidget() }).range(n.from, n.to + (after[0] === ' ' ? 1 : 0)));
      } else if (name === 'TaskMarker') {
        const checked = /x/i.test(state.sliceDoc(n.from, n.to));
        if (off(n.from, n.to)) {
          const end = state.sliceDoc(n.to, n.to + 1) === ' ' ? n.to + 1 : n.to;
          deco.push(Decoration.replace({ widget: new TaskWidget(checked, n.from) }).range(n.from, end));
        }
        if (checked) { const line = state.doc.lineAt(n.from); if (n.to + 1 < line.to) deco.push(Decoration.mark({ class: 'cm-task-done' }).range(n.to + 1, line.to)); }
      } else if (name === 'HorizontalRule' && off(n.from, n.to)) {
        deco.push(Decoration.replace({ widget: new HrWidget() }).range(n.from, n.to));
      }
    } });
  }
  return Decoration.set(deco, true);
}
function livePlugin(resolveImage) {
  return [
    ViewPlugin.fromClass(class {
      constructor(v) { this.decorations = liveDecorations(v, resolveImage); }
      update(u) { if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = liveDecorations(u.view, resolveImage); }
    }, { decorations: (v) => v.decorations, provide: (p) => EditorView.atomicRanges.of((v) => v.plugin(p)?.decorations || Decoration.none) }),
    EditorView.editorAttributes.of({ class: 'cm-live' }),
  ];
}

/* AI-edited lines */
export const setAiLines = StateEffect.define();
export const settleAiLines = StateEffect.define();
const aiField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setAiLines)) {
        const b = new RangeSetBuilder();
        for (const n of e.value) if (n >= 1 && n <= tr.state.doc.lines) b.add(tr.state.doc.line(n).from, tr.state.doc.line(n).from, Decoration.line({ class: 'cm-ai-line' }));
        deco = b.finish();
      }
      if (e.is(settleAiLines)) {
        const b = new RangeSetBuilder();
        deco.between(0, tr.state.doc.length, (from) => { b.add(from, from, Decoration.line({ class: 'cm-ai-line settled' })); });
        deco = e.value === 'clear' ? Decoration.none : b.finish();
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/* formatting commands */
function wrap(view, mark, ph = 'text', close = mark) {
  const tr = view.state.changeByRange((r) => {
    const sel = view.state.sliceDoc(r.from, r.to);
    const before = view.state.sliceDoc(r.from - mark.length, r.from), after = view.state.sliceDoc(r.to, r.to + close.length);
    if (before === mark && after === close) {
      return { changes: [{ from: r.from - mark.length, to: r.from }, { from: r.to, to: r.to + close.length }], range: EditorSelection.range(r.from - mark.length, r.to - mark.length) };
    }
    const text = sel || ph;
    return { changes: { from: r.from, to: r.to, insert: mark + text + close }, range: EditorSelection.range(r.from + mark.length, r.from + mark.length + text.length) };
  });
  view.dispatch(tr, { userEvent: 'input.format' }); view.focus(); return true;
}
function link(view) {
  const tr = view.state.changeByRange((r) => {
    const sel = view.state.sliceDoc(r.from, r.to) || 'link';
    const isUrl = /^https?:\/\//.test(sel);
    const insert = isUrl ? `[](${sel})` : `[${sel}](https://)`;
    const start = isUrl ? r.from + 1 : r.from + sel.length + 3;
    return { changes: { from: r.from, to: r.to, insert }, range: isUrl ? EditorSelection.cursor(start) : EditorSelection.range(start, start + 8) };
  });
  view.dispatch(tr); view.focus(); return true;
}
function linePrefix(view, re, prefix) {
  const changes = [];
  const seen = new Set();
  for (const r of view.state.selection.ranges) {
    for (let p = r.from; p <= r.to;) {
      const line = view.state.doc.lineAt(p);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const m = line.text.match(re);
        if (m) changes.push({ from: line.from, to: line.from + m[0].length, insert: '' });
        else changes.push({ from: line.from + (line.text.match(/^\s*/)[0].length), insert: prefix });
      }
      p = line.to + 1;
    }
  }
  view.dispatch({ changes }); view.focus(); return true;
}
export const commands = {
  highlight: (v) => wrap(v, '=='),
  underline: (v) => { const r = v.state.selection.main; const s = v.state.sliceDoc(r.from, r.to) || 'text'; v.dispatch({ changes: { from: r.from, to: r.to, insert: `<u>${s}</u>` }, selection: { anchor: r.from + 3, head: r.from + 3 + s.length } }); v.focus(); return true; },
  bold: (v) => wrap(v, '**'), italic: (v) => wrap(v, '_'), code: (v) => wrap(v, '`', 'code'), strike: (v) => wrap(v, '~~'),
  link, task: (v) => linePrefix(v, /^\s*- \[[ x]\] /, '- [ ] '), quote: (v) => linePrefix(v, /^\s*> /, '> '),
  bullet: (v) => linePrefix(v, /^\s*[-*] (?!\[)/, '- '),
  heading: (n) => (v) => linePrefix(v, /^#{1,6} /, '#'.repeat(n) + ' '),
  find: (v) => { openSearchPanel(v); return true; },
};

/* continue lists on Enter */
function continueList(view) {
  const { state } = view; const r = state.selection.main;
  if (!r.empty) return false;
  const line = state.doc.lineAt(r.head);
  const m = line.text.match(/^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/);
  if (!m || r.head < line.from + m[0].length) return false;
  if (line.text.trim() === m[0].trim()) { view.dispatch({ changes: { from: line.from, to: line.to, insert: '' } }); return true; }
  let bullet = m[2];
  if (/^\d/.test(bullet)) bullet = (parseInt(bullet, 10) + 1) + bullet.slice(-1);
  const insert = '\n' + m[1] + bullet + m[3] + (m[4] ? '[ ] ' : '');
  view.dispatch({ changes: { from: r.head, insert }, selection: { anchor: r.head + insert.length }, scrollIntoView: true, userEvent: 'input' });
  return true;
}

export function createEditor(parent, { onChange, onCursor, onScroll, onPasteImage, onSave, resolveImage, live = false }) {
  const wrapComp = new Compartment(), spellComp = new Compartment(), liveComp = new Compartment();
  const extensions = [
    history(), drawSelection(), dropCursor(), indentOnInput(), bracketMatching(), highlightSelectionMatches(), highlightActiveLine(),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
    syntaxHighlighting(classHighlighter),
    blockLines, aiField,
    search({ top: true }),
    placeholder('Start writing…'),
    keymap.of([
      { key: 'Enter', run: continueList },
      { key: 'Mod-b', run: commands.bold }, { key: 'Mod-i', run: commands.italic }, { key: 'Mod-k', run: commands.link },
      { key: 'Mod-e', run: commands.code }, { key: 'Mod-l', run: commands.task }, { key: 'Mod-Shift-x', run: commands.strike },
      { key: 'Mod-s', run: () => { onSave?.(); return true; } },
      ...searchKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap,
    ]),
    spellComp.of(EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences' })),
    wrapComp.of([]),
    liveComp.of(live ? livePlugin(resolveImage) : []),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange?.(u.state.doc.toString(), u.transactions.some((t) => t.annotation?.(remote)));
      if (u.selectionSet || u.docChanged) {
        const pos = u.state.selection.main.head, line = u.state.doc.lineAt(pos);
        onCursor?.({ line: line.number, col: pos - line.from + 1, selection: u.state.sliceDoc(u.state.selection.main.from, u.state.selection.main.to) });
      }
    }),
    EditorView.domEventHandlers({
      scroll: (_e, view) => onScroll?.(view),
      paste: (e, view) => {
        const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
        if (!file) return false;
        e.preventDefault(); onPasteImage?.(file, view); return true;
      },
      drop: (e, view) => {
        const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
        if (!file) return false;
        e.preventDefault();
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos != null) view.dispatch({ selection: { anchor: pos } });
        onPasteImage?.(file, view); return true;
      },
    }),
  ];
  const view = new EditorView({ parent, state: EditorState.create({ doc: '', extensions }) });
  return {
    view,
    setDoc(text, { keepHistory = false } = {}) {
      if (keepHistory) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, annotations: remoteAnn.of(true) });
      } else {
        view.setState(EditorState.create({ doc: text, extensions }));
      }
    },
    /** apply an external text with a minimal change, keeping cursor and undo history */
    applyRemote(text) {
      const cur = view.state.doc.toString();
      if (cur === text) return;
      let a = 0; while (a < cur.length && a < text.length && cur[a] === text[a]) a++;
      let z = 0; while (z < cur.length - a && z < text.length - a && cur[cur.length - 1 - z] === text[text.length - 1 - z]) z++;
      view.dispatch({ changes: { from: a, to: cur.length - z, insert: text.slice(a, text.length - z) }, annotations: remoteAnn.of(true) });
    },
    get text() { return view.state.doc.toString(); },
    markAiLines(lines) { view.dispatch({ effects: setAiLines.of(lines) }); },
    settleAi(mode) { view.dispatch({ effects: settleAiLines.of(mode) }); },
    scrollToLine(n, { select = false } = {}) {
      const l = view.state.doc.line(Math.max(1, Math.min(n, view.state.doc.lines)));
      view.dispatch({ effects: EditorView.scrollIntoView(l.from, { y: 'start', yMargin: 48 }), selection: select ? { anchor: l.from } : undefined });
    },
    topLine() {
      const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop - view.documentTop + view.dom.getBoundingClientRect().top + 8);
      return view.state.doc.lineAt(block.from).number;
    },
    run(name, ...a) { const c = commands[name]; return c ? (a.length ? c(...a)(view) : c(view)) : false; },
    wrap(before, after) { return wrap(view, before, 'text', after); },
    insert(text) { const r = view.state.selection.main; view.dispatch({ changes: { from: r.from, to: r.to, insert: text }, selection: { anchor: r.from + text.length } }); view.focus(); },
    focus() { view.focus(); },
    setLive(on) { view.dispatch({ effects: liveComp.reconfigure(on ? livePlugin(resolveImage) : []) }); },
    setSpellcheck(on) { view.dispatch({ effects: spellComp.reconfigure(EditorView.contentAttributes.of({ spellcheck: on ? 'true' : 'false' })) }); },
  };
}

import { Annotation } from '@codemirror/state';
const remoteAnn = Annotation.define();
const remote = remoteAnn;
