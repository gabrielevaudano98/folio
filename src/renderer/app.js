// Folio — renderer.
import { diffLines } from 'diff';
import { createEditor } from './editor.js';
import { EditorView } from '@codemirror/view';
import { undo as cmUndo, redo as cmRedo, undoDepth, redoDepth } from '@codemirror/commands';
import { createActionLog } from './history.js';
import { createRich } from './rich.js';
import { NEW_DECK, renderSlide, parseFrontmatter } from './slides-core.js';
import { hydrateRefs, resolveRef } from './refs.js';
import { parseRef, resolveTarget, docKind } from './refs-syntax.js';
import { render, headings, renderMermaid, exportDocument, slugify, hydrateCharts } from './markdown.js';
import { icons } from './icons.js';
import tokensCss from './tokens.css';
import stylesCss from './styles.css';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const base = (p) => p.split('/').pop();
const stem = (p) => base(p).replace(/(\.(slides|board|sheet))?\.(md|markdown|mdx|txt)$/i, '');

/* ---------- document types: every type has a visual view and a code view ---------- */
// the visual editors are loaded the first time a document of their type is opened, so startup parses only what pages need
const SURFACES = { slides: () => import('./slides.js').then((m) => m.mountSlides), board: () => import('./board.js').then((m) => m.mountBoard), sheet: () => import('./sheet.js').then((m) => m.mountSheet) };
const surfaceMods = {};
const loadSurface = (type) => (surfaceMods[type] ||= SURFACES[type]().then((mount) => { surfaceMods[type].mount = mount; return mount; }, (e) => { delete surfaceMods[type]; throw e; }));
const NEW_BOARD = (t) => `# ${t}\n\nA board in board-md. Shapes: \`id: shape "Label" @x,y\`. Connectors: \`a -> b "label"\`.\n\n\`\`\`board\nstart: terminator "Start" @40,60\nidea: rect "Write the idea" @230,55\nok: diamond "Clear?" @430,45\ndone: terminator "Share" @620,60\nnote: note "Double-click to edit, drag from the dots to connect" @220,190 200x80\n\nstart -> idea\nidea -> ok\nok -> done "yes"\nok.bottom -> idea.bottom "no" {route: orthogonal}\n\`\`\`\n`;
const NEW_SHEET = (t) => `# ${t}\n\n## Sheet1\n\n| Item | Quantity | Price | Total |\n| --- | --- | --- | --- |\n| Notebooks | 4 | 3.5 | =B2*C2 |\n| Pens | 12 | 1.2 | =B3*C3 |\n| Folders | 6 | 2.1 | =B4*C4 |\n| Total |  |  | =SUM(D2:D4) |\n\n<!-- sheet: {"cols":{"C":{"format":"currency"},"D":{"format":"currency"}}} -->\n`;
const NEW_CONTENT = { md: (t) => `# ${t}\n\n`, slides: () => NEW_DECK, board: NEW_BOARD, sheet: NEW_SHEET };
const TYPE_INFO = { md: ['Page', 'A Markdown document'], slides: ['Slides', 'A deck in slides-md, Marp compatible'], board: ['Board', 'A whiteboard in board-md'], sheet: ['Sheet', 'A spreadsheet in sheet-md'] };
function docTypeAny(p) { const m = p?.match(/\.(slides|board|sheet)\.md$/i); return m ? m[1].toLowerCase() : 'md'; }
function docType(p) { const m = p?.match(/\.(slides|board|sheet)\.md$/i); const t = m ? m[1].toLowerCase() : 'md'; return SURFACES[t] ? t : 'md'; }
const typeIcon = (t) => ({ slides: icons.slides, board: icons.board, sheet: icons.sheet }[t] || icons.doc);
function viewsFor(type) {
  if (type === 'md') return [['edit', 'Write', icons.viewWrite, 'Mod+1'], ['split', 'Split', icons.viewSplit, 'Mod+2'], ['preview', 'Read', icons.viewRead, 'Mod+3']];
  return [['visual', TYPE_INFO[type][0], typeIcon(type), 'Mod+1'], ['split', 'Code and visual', icons.viewSplit, 'Mod+2'], ['code', 'Code', icons.source, 'Mod+3']];
}
function storedView(type) { const v = type === 'md' ? (S.settings.mode || 'edit') : localStorageGet('folio.view.' + type) || 'visual'; return viewsFor(type).some(([id]) => id === v) ? v : viewsFor(type)[0][0]; }
function renderViewSwitch(type) {
  const sw = $('#view-switch');
  if (sw.dataset.type === type) return;
  sw.dataset.type = type;
  sw.innerHTML = viewsFor(type).map(([id, label, icon, key]) => `<button type="button" role="radio" data-view="${id}" aria-checked="false" aria-label="${label}" data-tip="${label} (${keyLabel(key)})">${icon}</button>`).join('');
}
const surfaces = {};
function surfaceFor(type) {
  if (!SURFACES[type]) return null;
  if (!surfaces[type]) {
    const mount = surfaceMods[type]?.mount;
    if (!mount) return null; // not loaded yet: callers load it with loadSurface() and try again
    const host = document.createElement('div');
    host.className = `surface surface-${type}`; host.id = `surface-${type}`;
    $('#pane-surface').appendChild(host);
    surfaces[type] = mount(host, surfaceCtx(type));
    surfaces[type].host = host;
  }
  $$('#pane-surface > .surface').forEach((h) => (h.hidden = h !== surfaces[type].host));
  return surfaces[type];
}
function surfaceCtx(type) {
  return {
    icons, keyLabel, toast, prompt, confirm: confirmSheet, showMenu,
    onChange: (text) => onEditorChange(text, false, 'surface'),
    onStatus: (s) => { S.surfaceStatus = s; renderStatus(); },
    resolveImage: resolveImg,
    dataUrl: (src) => folio.dataUrl(src, S.active),
    readNote: readRelative,
    getPath: () => S.active,
    docKey: () => activeTab(),
    copy: (t) => folio.copy(t),
    revealLine: (n) => { if (app.dataset.modeView === 'split') editor.scrollToLine(n); },
    exportPdf: (html, o = {}) => folio.exportPdf(S.active, html, { cssPage: true, ...o }),
    saveAsset: (name, bytes) => folio.saveImage(S.active, name, bytes),
    qa: folio.qa,
    saveBinary: (ext, bytes) => folio.exportBinary(S.active, ext, bytes),
    isDark: () => S.dark,
    refEnv,
    openRef,
    copyRef: (part, kind) => copyRef(S.active, part, kind),
    pickRef,
    templateGallery, ensureTemplate, saveTemplate,
    userName: () => folio.userName(),
    pickImage: () => folio.pickImage(S.active),
    pickMedia: (kind) => folio.pickMedia(S.active, kind),
  };
}
const curType = () => app.dataset.doc || 'md';
const curSurface = () => (curType() !== 'md' ? surfaces[curType()] : null);
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const S = {
  platform: 'darwin', settings: {}, dark: false, workspace: null, tree: [], files: [],
  tabs: [], active: null, expanded: new Set(JSON.parse(localStorageGet('folio.expanded') || '[]')),
  mcp: null, aiEdits: new Map(), cursor: { line: 1, col: 1, selection: '' }, saving: false,
};
function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
const mod = () => (S.platform === 'darwin' ? '⌘' : 'Ctrl+');
const shift = () => (S.platform === 'darwin' ? '⇧' : 'Shift+');
const keyLabel = (k) => k.replace(/Mod\+/g, mod()).replace(/Shift\+/g, shift());

/* ============ boot ============ */
const app = $('#app');
let editor, rich;
const isRich = () => app.dataset.modeView === 'edit';

async function boot() {
  const init = await folio.init();
  S.platform = init.platform; S.settings = init.settings; S.mcp = init.mcp; S.version = init.version;
  document.documentElement.dataset.platform = init.platform;
  if (init.platform === 'darwin') document.documentElement.classList.add('vibrant');
  applyTheme(init.dark, init.accent);
  paintStaticIcons();
  applyLayoutSettings();

  editor = createEditor($('#editor'), {
    onChange: (text, isRemote) => onEditorChange(text, isRemote),
    onCursor: (c) => { S.cursor = c; renderStatus(); },
    onScroll: () => syncFromEditor(),
    onPasteImage: pasteImage,
    onSave: () => saveActive(true),
    resolveImage: (src) => { const t = activeTab(); if (!t) return null; const rel = decodeURI(src).replace(/^\.\//, ''); const d = dirOf(t.path); return folio.absUrl(normalize(d ? `${d}/${rel}` : rel)).catch(() => null); },
  });
  editor.setSpellcheck(S.settings.spellcheck);

  rich = createRich($('#pane-rich'), {
    keyLabel,
    onChange: (md) => onEditorChange(md, false, 'rich'),
    resolveImage: resolveImg,
    onPickImage: async () => { const t = activeTab(); if (!t) return null; try { return await folio.pickImage(t.path); } catch (e) { toast(e.message, { kind: 'error' }); return null; } },
    readNote: (src) => readRelative(src),
    isDark: () => S.dark,
    onWikiLink: async (name) => { const f = resolveWiki(name); if (f) return openRef(f, parseRef(name).part); if (await confirmSheet({ title: `Create “${name}”?`, body: 'This note does not exist yet.', action: 'Create note' })) { const p = await folio.create(name + '.md', `# ${name}\n\n`); await refreshTree(); openFile(p); } },
    resolveValue: (raw) => resolveRef(raw, refEnv()).then((r) => r.value),
    onLink: (prev) => prompt({ title: prev ? 'Edit link' : 'Add link', label: 'Address', value: prev || 'https://', hint: 'Leave empty to remove the link', action: 'Apply', allowEmpty: true, validate: false }),
  });
  $('#pane-rich').addEventListener('paste', async (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file) return; e.preventDefault(); e.stopPropagation();
    const t = activeTab(); if (!t) return;
    try { const rel = await folio.saveImage(t.path, file.name || 'pasted.png', new Uint8Array(await file.arrayBuffer())); rich.editor.chain().focus().setImage({ src: encodeURI(rel), alt: 'image' }).run(); }
    catch (er) { toast(`Could not save the image. ${er.message}`, { kind: 'error' }); }
  }, true);
  $('.rich-scroll').addEventListener('scroll', () => { if (isRich()) markOutlineCurrent(); }, { passive: true });

  bindChrome();
  bindIpc();
  renderAiStatus();

  if (init.settings.workspace) await loadWorkspace(init.settings.workspace, { restore: true });
  else showWelcome();
}

function applyTheme(dark, accent) {
  S.dark = dark;
  document.documentElement.dataset.mode = dark ? 'dark' : 'light';
  const root = document.documentElement.style;
  if (false) { // grayscale palette by design: the OS accent colour is not used
    root.setProperty('--color-accent', accent);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    root.setProperty('--color-accent-ink', lum > 0.42 ? 'var(--color-ink-on-accent-dark)' : 'var(--color-ink-on-accent-light)');
  } else {
    root.removeProperty('--color-accent'); root.removeProperty('--color-accent-ink');
  }
  if (S.tabs.length) renderPreview();
}

function paintStaticIcons() {
  $('#btn-new').innerHTML = icons.compose;
  $('#view-switch [data-view="edit"]').innerHTML = icons.viewWrite;
  $('#view-switch [data-view="split"]').innerHTML = icons.viewSplit;
  $('#view-switch [data-view="preview"]').innerHTML = icons.viewRead;
  $('#btn-sidebar').innerHTML = icons.sidebar;
  $('#btn-back').innerHTML = icons.back; $('#btn-forward').innerHTML = icons.forward;
  $('#btn-undo').innerHTML = icons.undo; $('#btn-redo').innerHTML = icons.redo;
  $('#btn-outline').innerHTML = icons.outline;
  $('#btn-more').innerHTML = icons.more;
  $('.workspace-chev').innerHTML = icons.chevronDown;
  $$('.search-glyph').forEach((e) => (e.innerHTML = icons.search));
  $('.ai-status-icon').innerHTML = icons.spark;
  $('.ai-banner-mark').innerHTML = icons.spark;
  $('#ai-banner-close').innerHTML = icons.close;
  $('#search-kbd').textContent = keyLabel('Mod+Shift+F');
  $('#btn-back').dataset.tip = `Back (${S.platform === 'darwin' ? '⌘⌥←' : 'Alt+←'})`; $('#btn-forward').dataset.tip = `Forward (${S.platform === 'darwin' ? '⌘⌥→' : 'Alt+→'})`;
  $$('[data-tip]').forEach((el) => (el.dataset.tip = el.dataset.tip.replace(/⌘/g, mod()).replace(/⇧/g, shift())));
}

function applyLayoutSettings() {
  const s = S.settings;
  app.dataset.sidebar = s.sidebar === false ? 'closed' : 'open';
  app.dataset.outline = s.showOutline === false ? 'closed' : 'open';
  setView(s.mode || 'split', { persist: false });
  document.documentElement.style.setProperty('--editor-size', `${s.fontSize || 16}px`);
  document.documentElement.style.setProperty('--measure', `${s.lineWidth || 72}ch`);
  const sw = Number(localStorageGet('folio.sidebarW')); if (sw) document.documentElement.style.setProperty('--sidebar-w', `${sw}px`);
  $('#btn-outline').setAttribute('aria-pressed', String(app.dataset.outline === 'open'));
  layoutPanes();
}
function resolveImg(src) { const t = activeTab(); if (!t) return null; const rel = decodeURI(src).replace(/^\.\//, ''); const d = dirOf(t.path); return folio.absUrl(normalize(d ? `${d}/${rel}` : rel)).catch(() => null); }
async function saveSetting(patch) { S.settings = await folio.setSettings(patch); }

/* ============ panes ============ */
let splitRatio = Number(localStorageGet('folio.split')) || 0.5;
function layoutPanes() {
  const ws = $('#workspace');
  const narrow = window.innerWidth < 1100;
  app.classList.toggle('narrow', narrow);
  const outline = app.dataset.outline === 'open' && !narrow && !app.classList.contains('focus') ? 'var(--outline-w)' : '0';
  const v = app.dataset.modeView;
  if (curType() !== 'md') { ws.style.setProperty('--cols', v === 'split' ? `minmax(0, ${splitRatio}fr) 1px minmax(0, ${1 - splitRatio}fr)` : 'minmax(0, 1fr)'); return; }
  ws.style.setProperty('--cols', v === 'split' ? `minmax(0, ${splitRatio}fr) 1px minmax(0, ${1 - splitRatio}fr) ${outline}` : `minmax(0, 1fr) ${outline}`);
}
window.addEventListener('resize', layoutPanes);

function setView(v, { persist = true } = {}) {
  const type = curType();
  if (!viewsFor(type).some(([id]) => id === v)) v = { edit: viewsFor(type)[0][0], visual: 'edit', code: 'split', preview: 'code' }[v] || viewsFor(type)[0][0];
  const prev = app.dataset.modeView;
  app.dataset.modeView = v;
  editor?.setLive(false);
  const t = activeTab();
  if (type !== 'md') {
    const s = surfaceFor(type);
    if (!s) { loadSurface(type).then(() => { if (curType() === type) setView(v, { persist }); }, (e) => toast(e.message, { kind: 'error' })); return; }
    if (t && s) { if (v !== 'code' && prev === 'code') s.setText(t.text); if (v !== 'visual') editor.applyRemote(t.text); s.setMode?.(v); }
    $$('#view-switch button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.view === v)));
    layoutPanes();
    if (persist) localStorageSet('folio.view.' + type, v);
    return;
  }
  if (t && rich && editor) {
    if (v === 'edit' && prev !== 'edit') rich.setMarkdown(t.text);
    if (v !== 'edit' && prev === 'edit') editor.applyRemote(t.text);
  }
  $$('#view-switch button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.view === v)));
  layoutPanes();
  if (v !== 'edit') renderPreview();
  if (persist) saveSetting({ mode: v });
}

/* ============ workspace ============ */
async function loadWorkspace(dir, { restore = false } = {}) {
  S.workspace = dir;
  actions.clear(); nav.list = []; nav.i = -1; // file actions and history belong to one folder
  $('#workspace-name').textContent = dir.split(/[\\/]/).filter(Boolean).pop();
  $('#tree').innerHTML = Array.from({ length: 7 }, (_, i) => `<div class="skeleton-row" style="--w:${[62, 48, 70, 40, 56, 66, 44][i]}%;--d:${i % 3 === 2 ? 1 : 0}"></div>`).join('');
  await refreshTree();
  if (restore && S.settings.openTabs?.length) {
    for (const p of S.settings.openTabs) await openFile(p, { background: true }).catch(() => {});
    const last = S.settings.lastFile && S.tabs.find((t) => t.path === S.settings.lastFile) ? S.settings.lastFile : S.tabs[0]?.path;
    if (last) activate(last); else showNoNote();
  } else if (!S.tabs.length) showNoNote();
}
async function refreshTree() {
  try {
    S.tree = await folio.tree();
    S.files = flatten(S.tree);
    renderTree();
  } catch (e) {
    $('#tree').innerHTML = `<div class="side-empty">Could not read this folder. ${esc(e.message)}<br><button class="btn" type="button" data-act="choose">Choose another folder…</button></div>`;
  }
}
function flatten(nodes, out = []) { for (const n of nodes) { if (n.type === 'file') out.push(n.path); else flatten(n.children, out); } return out; }

function renderTree() {
  const host = $('#tree');
  if (!S.tree.length) {
    host.innerHTML = `<div class="side-empty">This folder has no Markdown notes yet.<br><button class="btn" type="button" data-act="new">${icons.plus} New note</button></div>`;
    return;
  }
  const row = (n, depth) => {
    if (n.type === 'dir') {
      const open = S.expanded.has(n.path);
      return `<div role="none"><button class="tree-row" type="button" role="treeitem" data-dir="${esc(n.path)}" aria-expanded="${open}" style="--depth:${depth}" draggable="true">
        <span class="twisty">${icons.chevron}</span><span class="glyph">${icons.folder}</span><span class="label">${esc(n.name)}</span></button>
        <div class="tree-children" role="group" ${open ? '' : 'hidden'}>${n.children.map((c) => row(c, depth + 1)).join('')}</div></div>`;
    }
    const ai = S.aiEdits.has(n.path) ? '<span class="ai-tag">AI</span>' : '';
    return `<button class="tree-row" type="button" role="treeitem" data-file="${esc(n.path)}" aria-selected="${n.path === S.active}" style="--depth:${depth}" draggable="true" title="${esc(n.path)}">
      <span class="twisty"></span><span class="glyph">${typeIcon(docTypeAny(n.path))}</span><span class="label">${esc(stem(n.name))}</span>${ai}</button>`;
  };
  host.innerHTML = S.tree.map((n) => row(n, 0)).join('');
}

/* ============ tabs & files ============ */
const tabOf = (p) => S.tabs.find((t) => t.path === p);
const activeTab = () => tabOf(S.active);

async function openFile(p, { line, background = false } = {}) {
  let t = tabOf(p);
  if (!t) {
    const text = await folio.read(p);
    t = { path: p, text, saved: text, scroll: 0 };
    S.tabs.push(t);
  }
  if (!background) activate(p, { line });
  persistTabs();
  return t;
}
function activate(p, { line } = {}) {
  const prev = activeTab();
  if (prev) {
    prev.scroll = editor.view.scrollDOM.scrollTop;
    prev.cm = editor.snapshot(); // keeps this tab's undo history for when it is shown again
    prev.rich = docType(prev.path) === 'md' && isRich() ? rich.snapshot() : null;
  }
  navRecord(p);
  S.active = p;
  const t = activeTab();
  hideEmpty();
  const type = docType(p);
  app.dataset.doc = type; S.surfaceStatus = '';
  renderViewSwitch(type);
  const v = storedView(type);
  app.dataset.modeView = v;
  $$('#view-switch button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.view === v)));
  layoutPanes();
  if (t.cm && t.cm.doc.toString() === t.text) editor.restore(t.cm); else editor.setDoc(t.text);
  if (type === 'md') { if (isRich()) { if (t.rich && t.rich.md === t.text) rich.restore(t.rich); else rich.setMarkdown(t.text); } }
  else {
    const s = surfaceFor(type);
    if (s) { s.setText(t.text); s.setMode?.(v); }
    else { loadSurface(type).then(() => { if (S.active === p) activate(p, { line }); }, (e) => toast(e.message, { kind: 'error' })); return; }
  }
  requestAnimationFrame(() => { editor.view.scrollDOM.scrollTop = t.scroll || 0; if (line) editor.scrollToLine(line, { select: true }); });
  const ai = S.aiEdits.get(p);
  if (ai && Date.now() - ai.at < 10 * 60e3) { showAiBanner(p); highlightAi(p, { fresh: false }); } else hideAiBanner();
  renderTabs(); renderTree(); renderPreview(); renderOutline(); renderStatus(); updateHistoryButtons();
  saveSetting({ lastFile: p });
  if (type !== 'md') { if (v === 'code') editor.focus(); else curSurface()?.focus?.(); }
  else if (isRich()) rich.focus('start'); else if (app.dataset.modeView !== 'preview') editor.focus();
}
function renderTabs() {
  $('#tabs').innerHTML = S.tabs.map((t) => {
    const dirty = t.text !== t.saved;
    return `<div class="tab" role="tab" tabindex="0" data-tab="${esc(t.path)}" aria-selected="${t.path === S.active}" data-dirty="${dirty}" data-ai="${S.aiEdits.has(t.path)}" title="${esc(t.path)}">
      <span class="tab-label">${esc(stem(t.path))}</span>
      <span class="tab-close" role="button" tabindex="-1" data-close="${esc(t.path)}" aria-label="${dirty ? 'Unsaved changes. Close' : 'Close'} ${esc(stem(t.path))}">${icons.close}</span></div>`;
  }).join('');
}
async function closeTab(p = S.active) {
  const t = tabOf(p); if (!t) return;
  if (t.text !== t.saved) await saveTab(t);
  const i = S.tabs.indexOf(t);
  S.tabs.splice(i, 1);
  if (S.active === p) {
    const next = S.tabs[i] || S.tabs[i - 1];
    if (next) activate(next.path); else { S.active = null; showNoNote(); renderTabs(); renderTree(); }
  } else renderTabs();
  persistTabs();
}
function persistTabs() { saveSetting({ openTabs: S.tabs.map((t) => t.path) }); }

/* ============ editing & saving ============ */
const autosave = debounce(() => saveActive(), 650);
const surfaceSoon = debounce((text) => curSurface()?.setText(text), 250);
const previewSoon = debounce(() => { renderPreview(); renderOutline(); }, 110);
function onEditorChange(text, isRemote, from = 'source') {
  const t = activeTab(); if (!t) return;
  historySoon();
  if (from === 'source' && isRich()) return; // the hidden source view only mirrors
  if (from === 'source' && curType() !== 'md' && app.dataset.modeView === 'visual') return;
  if (text === t.text) return;
  t.text = text;
  if (curType() !== 'md') {
    if (from === 'source' && app.dataset.modeView === 'split') surfaceSoon(text);
    if (from === 'surface' && app.dataset.modeView === 'split') editor.applyRemote(text);
  }
  if (!isRemote) { autosave(); setSaveState('Edited'); }
  renderTabsDirty();
  previewSoon(); renderStatus();
}
function setActiveText(text) {
  const t = activeTab(); if (!t) return;
  t.text = text;
  editor.applyRemote(text);
  if (curType() === 'md') { if (isRich()) rich.setMarkdown(text, { keepHistory: true }); }
  else curSurface()?.setText(text);
}
function renderTabsDirty() {
  for (const el of $$('#tabs .tab')) { const t = tabOf(el.dataset.tab); if (t) el.dataset.dirty = String(t.text !== t.saved); }
}
async function saveTab(t) {
  if (t.text === t.saved) return;
  const text = t.text;
  try { await folio.write(t.path, text); t.saved = text; if (t.path === S.active) { setSaveState('Saved'); if (/\[\[|\{\{/.test(text)) backlinksSoon(); } renderTabsDirty(); }
  catch (e) { toast(`Could not save ${base(t.path)}. ${e.message}`, { kind: 'error', action: ['Retry', () => saveTab(t)] }); setSaveState('Not saved'); }
}
async function saveActive() { const t = activeTab(); if (t) await saveTab(t); }
let saveStateTimer;
function setSaveState(s) { $('#st-save').textContent = s; clearTimeout(saveStateTimer); if (s === 'Saved') saveStateTimer = setTimeout(() => ($('#st-save').textContent = ''), 1600); }

async function pasteImage(file, view) {
  const t = activeTab(); if (!t) return;
  try {
    const rel = await folio.saveImage(t.path, file.name || 'pasted.png', new Uint8Array(await file.arrayBuffer()));
    editor.insert(`![${(file.name || 'image').replace(/\.\w+$/, '')}](${encodeURI(rel)})`);
  } catch (e) { toast(`Could not save the image. ${e.message}`, { kind: 'error' }); }
}

/* ============ preview ============ */
async function renderPreview() {
  const t = activeTab();
  const el = $('#preview');
  if (!t || app.dataset.modeView === 'edit' || curType() !== 'md') return;
  const html = render(t.text);
  el.innerHTML = html;
  const dir = dirOf(t.path);
  for (const img of el.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    if (src && !/^(https?:|data:|file:)/.test(src)) {
      const rel = decodeURI(src).replace(/^\.\//, '');
      folio.absUrl(normalize(dir ? `${dir}/${rel}` : rel)).then((u) => (img.src = u)).catch(() => {});
    }
    img.loading = 'lazy'; img.decoding = 'async';
  }
  for (const a of el.querySelectorAll('a[data-wikilink]')) {
    if (!resolveWiki(a.dataset.wikilink)) a.classList.add('missing');
  }
  for (const pre of el.querySelectorAll('pre:not(.mermaid-src)')) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn copy-code'; b.textContent = 'Copy';
    pre.appendChild(b);
  }
  for (const cb of el.querySelectorAll('.task-list-item input')) cb.removeAttribute('disabled');
  const ai = S.aiEdits.get(t.path);
  if (ai) markPreviewAi(ai);
  renderMermaid(el, S.dark);
  hydrateCharts(el, readRelative);
  hydrateRefs(el, refEnv());
}
/* references between documents */
/* reference picker and "copy reference" */
function refName(path) {
  const short = path.split('/').pop().replace(/\.(md|markdown|mdx|txt)$/i, '');
  return resolveTarget(short, S.files, S.active || '') === path ? short : '/' + path;
}
function refText(kind, path, part = '', label = '') {
  const body = refName(path) + (part ? '#' + part : '');
  return kind === 'value' ? `{{${body}}}` : kind === 'embed' ? `![[${body}]]` : `[[${body}${label ? '|' + label : ''}]]`;
}
async function partsOf(path) {
  const text = tabOf(path)?.text ?? await folio.read(path).catch(() => '');
  const kind = docKind(path);
  if (kind === 'sheet') { const { parseWorkbook } = await import('./sheet-core.js'); return parseWorkbook(text).filter((b) => b.type === 'sheet').map((b) => ({ value: `${b.name}!A1`, label: `Sheet ${b.name} (edit the cell or range)` })); }
  if (kind === 'slides') { const { parseDeck } = await import('./slides-core.js'); return parseDeck(text).slides.map((sl, i) => ({ value: String(i + 1), label: `Slide ${i + 1}${sl.title ? ': ' + sl.title : ''}` })); }
  if (kind === 'board') { const { splitBoardDoc, parseBoard } = await import('./board-core.js'); return parseBoard(splitBoardDoc(text).code).nodes.filter((n) => !n.implicit).map((n) => ({ value: n.id, label: `${n.label} (${n.id})` })); }
  return headings(text).map((h) => ({ value: h.text.replace(/[*_`]/g, ''), label: `${'  '.repeat(h.level - 1)}${h.text}` }));
}
function pickRef({ kind = 'link' } = {}) {
  return new Promise((resolve) => {
    const d = $('#sheet-prompt');
    const docs = S.files.filter((f) => f !== S.active);
    d.innerHTML = `<form method="dialog" class="prompt-form ref-form">
      <div class="sheet-head"><div><h2 id="prompt-title">Insert reference</h2><p>Point at another document, a part of it, or a live result.</p></div></div>
      <div class="sheet-body">
        <div class="field"><label for="ref-doc">Document</label><input class="input" id="ref-doc" list="ref-docs" autocomplete="off" spellcheck="false" placeholder="Type to search"><datalist id="ref-docs">${docs.map((f) => `<option value="${esc(f)}">${esc(stem(f))}</option>`).join('')}</datalist></div>
        <div class="field"><label for="ref-part-pick">Part</label><select class="rb-select" id="ref-part-pick"><option value="">Whole document</option></select>
          <input class="input" id="ref-part" spellcheck="false" placeholder="Optional, e.g. Costs!H6 or 3" aria-label="Part"></div>
        <fieldset class="field ref-kinds"><legend>Show as</legend>
          <label><input type="radio" name="ref-kind" value="link"${kind === 'link' ? ' checked' : ''}> Link</label>
          <label><input type="radio" name="ref-kind" value="value"${kind === 'value' ? ' checked' : ''}> Live value</label>
          <label><input type="radio" name="ref-kind" value="embed"${kind === 'embed' ? ' checked' : ''}> Embed</label></fieldset>
        <p class="ref-preview" id="ref-preview" aria-live="polite"></p>
      </div>
      <div class="sheet-foot"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn btn-primary" type="submit">Insert</button></div></form>`;
    const docEl = $('#ref-doc', d), pick = $('#ref-part-pick', d), partEl = $('#ref-part', d), prev = $('#ref-preview', d);
    const path = () => S.files.includes(docEl.value) ? docEl.value : resolveTarget(docEl.value, S.files, S.active || '');
    const current = () => { const p = path(); if (!p) return null; return refText(d.querySelector('[name=ref-kind]:checked').value, p, partEl.value.trim()); };
    let seq = 0;
    const preview = async () => {
      const t = current(); const n = ++seq;
      if (!t) { prev.textContent = docEl.value ? 'No document with that name.' : ''; return; }
      prev.innerHTML = `<code>${esc(t)}</code>`;
      try { const r = await resolveRef(t.replace(/^!?\[\[|\]\]$|^\{\{|\}\}$/g, '').replace(/\|.*$/, ''), refEnv()); if (n === seq) prev.innerHTML = `<code>${esc(t)}</code> <span>shows ${esc(String(r.value).slice(0, 80))}</span>`; }
      catch (e) { if (n === seq) prev.innerHTML = `<code>${esc(t)}</code> <span class="ref-preview-err">${esc(e.message)}</span>`; }
    };
    docEl.addEventListener('change', async () => {
      const p = path(); pick.innerHTML = '<option value="">Whole document</option>'; partEl.value = '';
      if (p) { for (const o of await partsOf(p)) pick.insertAdjacentHTML('beforeend', `<option value="${esc(o.value)}">${esc(o.label)}</option>`); }
      preview();
    });
    docEl.addEventListener('input', preview);
    pick.addEventListener('change', () => { partEl.value = pick.value; preview(); if (docKind(path() || '') === 'sheet' && pick.value) { partEl.focus(); partEl.setSelectionRange(partEl.value.indexOf('!') + 1, partEl.value.length); } });
    partEl.addEventListener('input', preview);
    d.querySelectorAll('[name=ref-kind]').forEach((r) => r.addEventListener('change', preview));
    const done = (v) => { d.close(); resolve(v); };
    d.querySelector('form').onsubmit = (e) => { e.preventDefault(); const t = current(); if (!t) { prev.textContent = 'Choose a document first.'; docEl.focus(); return; } done(t); };
    d.querySelector('[data-cancel]').onclick = () => done(null);
    d.oncancel = () => resolve(null);
    d.showModal(); docEl.focus();
  });
}
async function insertRef(kind) {
  const t = await pickRef({ kind }); if (!t) return;
  const type = curType();
  if (type === 'md') { if (isRich()) rich.editor.chain().focus().insertContent({ type: 'text', text: t }).run(); else editor.insert(t); }
  else if (type === 'slides' && app.dataset.modeView !== 'code') curSurface()?.insertText?.(t);
  else editor.insert(t);
  toast('Reference inserted.');
}
function copyRef(path, part, kind) { const t = refText(kind, path, part); folio.copy(t); toast(`Copied ${t}`); }
function refEnv() {
  return {
    files: S.files, from: S.active || '',
    read: (p) => (tabOf(p) ? Promise.resolve(tabOf(p).text) : folio.read(p)),
    renderMarkdown: (m) => render(m),
    renderSlideHtml: (deck, s) => renderSlide(deck, s, { number: false }),
    afterSlide: (el) => { for (const img of el.querySelectorAll('img[data-src]')) Promise.resolve(resolveImg(img.dataset.src)).then((u) => { if (u) img.src = u; }); },
  };
}
async function openRef(path, part = '') {
  await openFile(path);
  if (!part) return;
  const type = docType(path);
  if (type === 'slides') curSurface()?.gotoSlide?.(parseInt(part, 10) - 1);
  else if (type === 'sheet') curSurface()?.gotoCell?.(part);
  else if (type === 'board') curSurface()?.gotoNode?.(part);
  else { const h = headings(activeTab().text).find((x) => x.text.replace(/[*_`]/g, '').toLowerCase() === part.toLowerCase()); if (h) editor.scrollToLine(h.line, { select: true }); }
}
document.addEventListener('click', (e) => {
  const el = e.target.closest('.ref-value[data-path], .ref-embed[data-path]');
  if (el && (e.ctrlKey || e.metaKey || el.classList.contains('ref-embed') && e.target.closest('.ref-embed-head'))) { e.preventDefault(); e.stopPropagation(); openRef(el.dataset.path, el.dataset.part); }
}, true);
function readRelative(src) { if (src.startsWith('/')) return folio.read(normalize(src.slice(1))); const d = dirOf(S.active || ''); return folio.read(normalize(d ? `${d}/${src}` : src)); }
function normalize(p) {
  const out = [];
  for (const seg of p.split('/')) { if (seg === '..') out.pop(); else if (seg && seg !== '.') out.push(seg); }
  return out.join('/');
}
function resolveWiki(name) { return resolveTarget(parseRef(name).target, S.files, S.active || ''); }

/* ============ outline ============ */
let currentHeads = [];
function renderOutline() {
  const t = activeTab();
  currentHeads = t ? headings(t.text) : [];
  $('#outline-list').innerHTML = currentHeads.length
    ? currentHeads.map((h, i) => `<li><a href="#" data-line="${h.line}" data-i="${i}" style="--lvl:${Math.min(h.level, 4)}">${esc(h.text)}</a></li>`).join('')
    : '<li class="outline-empty">Headings appear here as you write them.</li>';
  markOutlineCurrent();
  if (activeTab()?.path !== blPath) renderBacklinks();
}
let blSeq = 0, blPath = null;
const backlinksSoon = debounce(() => renderBacklinks(), 600);
async function renderBacklinks() {
  const t = activeTab(); const seq = ++blSeq; if (!t) return; blPath = t.path;
  const [bl, broken] = await Promise.all([folio.backlinks(t.path).catch(() => []), folio.brokenLinks(t.path).catch(() => [])]);
  if (seq !== blSeq) return;
  const kindLabel = { link: 'link', value: 'value', embed: 'embed' };
  $('#backlinks').innerHTML = bl.length ? bl.map((b) => `<li><a href="#" data-bl="${esc(b.path)}" data-bl-line="${b.line}" title="${esc(b.text)}"><span class="bl-name">${esc(stem(b.path))}</span><span class="bl-kind">${kindLabel[b.kind] || b.kind}</span><span class="bl-ref">${esc(b.ref)}</span></a></li>`).join('')
    : '<li class="outline-empty">No other document links here yet.</li>';
  const st = $('#st-links'); st.hidden = !bl.length && !broken.length;
  st.textContent = [bl.length ? `${bl.length} ${bl.length === 1 ? 'link' : 'links'} here` : '', broken.length ? `${broken.length} broken` : ''].filter(Boolean).join(' · ');
  st.onclick = () => showMenu(st, [
    ...(bl.length ? [{ head: 'Linked from' }, ...bl.map((b) => ({ label: `${stem(b.path)}: ${b.ref}`, run: () => openFile(b.path, { line: b.line }) }))] : []),
    ...(broken.length ? [{ head: 'Broken references here' }, ...broken.map((b) => ({ label: `Line ${b.line}: ${b.ref}`, run: () => openFile(t.path, { line: b.line }) }))] : []),
  ]);
  const box = $('#broken-links'); box.hidden = !broken.length;
  box.innerHTML = broken.length ? `<b>${broken.length} broken ${broken.length === 1 ? 'reference' : 'references'}</b>${broken.map((b) => `<a href="#" data-bl="${esc(t.path)}" data-bl-line="${b.line}">Line ${b.line}: ${esc(b.ref)}</a>`).join('')}` : '';
}
$('#outline-list').addEventListener('contextmenu', (e) => {
  const a = e.target.closest('a[data-i]'); if (!a || curType() !== 'md') return; e.preventDefault();
  const h = currentHeads[Number(a.dataset.i)]; const part = h.text.replace(/[*_`]/g, '');
  showMenu(null, [{ label: 'Copy link to this section', run: () => copyRef(S.active, part, 'link') }, { label: 'Copy embed reference', run: () => copyRef(S.active, part, 'embed') }], { x: e.clientX, y: e.clientY });
});
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-bl]'); if (!a) return; e.preventDefault();
  openFile(a.dataset.bl, { line: Number(a.dataset.blLine) });
});
function markOutlineCurrent(line) {
  if (curType() !== 'md') return;
  if (isRich() && line == null) { const c = rich.currentHeading(); $$('#outline-list a').forEach((a) => a.setAttribute('aria-current', String(Number(a.dataset.i) === c))); return; }
  const l = line ?? (app.dataset.modeView === 'preview' ? previewTopLine() : editor.topLine() - 1);
  let cur = -1; currentHeads.forEach((h, i) => { if (h.line <= l + 1) cur = i; });
  $$('#outline-list a').forEach((a) => a.setAttribute('aria-current', String(Number(a.dataset.i) === cur)));
}

/* ============ scroll sync ============ */
let syncLock = 0;
function syncFromEditor() {
  if (curType() !== 'md') { if (app.dataset.modeView === 'split') curSurface()?.selectAtLine?.(S.cursor.line); return; }
  markOutlineCurrent();
  if (app.dataset.modeView !== 'split' || Date.now() < syncLock) return;
  const line = editor.topLine() - 1;
  const els = $$('#preview [data-line]');
  let target = null;
  for (const el of els) { if (Number(el.dataset.line) <= line) target = el; else break; }
  const pane = $('#pane-preview');
  syncLock = Date.now() + 80;
  if (!target || line <= 0) { pane.scrollTop = 0; return; }
  const start = Number(target.dataset.line), end = Number(target.dataset.lineEnd || start + 1);
  const frac = Math.min(1, (line - start) / Math.max(1, end - start));
  pane.scrollTop = target.offsetTop - 24 + target.offsetHeight * frac;
}
function previewTopLine() {
  const pane = $('#pane-preview'); let line = 0;
  for (const el of $$('#preview [data-line]')) { if (el.offsetTop - pane.scrollTop < 40) line = Number(el.dataset.line); else break; }
  return line;
}
$('#pane-preview').addEventListener('scroll', () => {
  markOutlineCurrent();
  if (app.dataset.modeView !== 'split' || Date.now() < syncLock) return;
  syncLock = Date.now() + 80;
  editor.scrollToLine(previewTopLine() + 1);
}, { passive: true });

/* ============ status ============ */
function renderStatus() {
  const t = activeTab();
  if (!t) { ['#st-path', '#st-words', '#st-time', '#st-cursor'].forEach((s) => ($(s).textContent = '')); return; }
  const words = (t.text.replace(/^---[\s\S]*?---/, '').replace(/```[\s\S]*?```/g, '').match(/[\p{L}\p{N}’'-]+/gu) || []).length;
  const fmt = new Intl.NumberFormat();
  $('#st-path').textContent = t.path;
  if (curType() !== 'md') { $('#st-words').textContent = S.surfaceStatus || ''; $('#st-time').textContent = ''; $('#st-cursor').textContent = app.dataset.modeView === 'visual' ? '' : `Line ${S.cursor.line}, column ${S.cursor.col}`; return; }
  $('#st-words').textContent = `${fmt.format(words)} ${words === 1 ? 'word' : 'words'}`;
  $('#st-time').textContent = `${Math.max(1, Math.round(words / 230))} min read`;
  $('#st-cursor').textContent = isRich() ? '' : S.cursor.selection ? `${fmt.format(S.cursor.selection.length)} selected` : `Line ${S.cursor.line}, column ${S.cursor.col}`;
}

/* ============ empty states ============ */
function showEmpty(html) { const e = $('#empty-state'); e.innerHTML = `<div class="empty-inner">${html}</div>`; e.hidden = false; }
function hideEmpty() { $('#empty-state').hidden = true; }
function showWelcome() {
  S.workspace = null; S.tabs = []; S.active = null;
  $('#workspace-name').textContent = 'No folder';
  $('#tree').innerHTML = '<div class="side-empty">Open a folder to see its notes here.</div>';
  renderTabs(); renderStatus(); hideAiBanner();
  const recent = (S.settings.recent || []).slice(0, 5);
  showEmpty(`
    <h1>Open a folder and start writing</h1>
    <p>Folio edits plain Markdown files on your disk. Connect Claude, Cursor or any MCP app, and they read and edit the same notes while you watch.</p>
    <div class="empty-actions">
      <button class="btn btn-primary btn-lg" type="button" data-act="choose">Open folder…</button>
      <button class="btn btn-lg" type="button" data-act="ai">Connect an AI</button>
    </div>
    ${recent.length ? `<div class="recent"><h2>Recent folders</h2><ul class="recent-list">${recent.map((d) => `<li><button type="button" data-recent="${esc(d)}"><span class="recent-name">${esc(d.split(/[\\/]/).filter(Boolean).pop())}</span><span class="recent-path">${esc(d)}</span></button></li>`).join('')}</ul></div>` : ''}`);
}
function showNoNote() {
  hideAiBanner();
  $('#preview').innerHTML = ''; editor.setDoc(''); renderOutline(); renderStatus();
  showEmpty(`
    <h1>Pick a note, or start a new one</h1>
    <p>Everything saves as you type. Press ${keyLabel('Mod+P')} to jump to any note by name.</p>
    <div class="empty-actions">
      <button class="btn btn-primary btn-lg" type="button" data-act="new">New note</button>
      <button class="btn btn-lg" type="button" data-act="quick-open">Quick open…</button>
    </div>`);
}

/* ============ new / rename / move / trash ============ */
async function newNote(folder = dirOf(S.active || ''), type) {
  if (!S.workspace) return chooseFolder();
  const res = await newDocSheet({ folder, type });
  if (!res) return;
  const { name } = res; type = res.type;
  const ext = type === 'md' ? '.md' : `.${type}.md`;
  const file = (folder ? folder + '/' : '') + (/\.(md|markdown|mdx|txt)$/i.test(name) ? name : name + ext);
  let tpl = null;
  if (type === 'slides') { tpl = await templateGallery({ mode: 'new' }); if (tpl == null) return; }
  try {
    const title = stem(file).replace(/\.slides$/i, '');
    let content = (NEW_CONTENT[type] || NEW_CONTENT.md)(stem(file));
    if (tpl && tpl !== 'blank') { const T = await import('./slides-templates.js'); await ensureTemplate(tpl); content = T.newDeckFrom(tpl, title); }
    const p = await folio.create(file, content);
    if (folder) S.expanded.add(folder);
    await refreshTree(); await openFile(p);
    let rec = null;
    actions.push({ scope: S.workspace, label: `created ${base(p)}`, undo: async () => { rec = await trashRaw(p); }, redo: async () => { await untrashRaw(rec); await openFile(p); } });
    updateHistoryButtons();
    if (type === 'md' && !isRich()) editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
  } catch (e) { toast(e.message, { kind: 'error' }); }
}
function newDocSheet({ folder, type = 'md' }) {
  return new Promise((resolve) => {
    const d = $('#sheet-prompt');
    const types = Object.keys(TYPE_INFO).filter((t) => t === 'md' || SURFACES[t]);
    d.innerHTML = `<form method="dialog">
      <div class="sheet-head"><div><h2 id="prompt-title">New document</h2><p>${folder ? `In ${esc(folder)}` : 'At the top of the folder'}. Every type is a Markdown file your AI can read and edit.</p></div></div>
      <div class="sheet-body">
        <fieldset class="type-pick"><legend class="visually-hidden">Type</legend>
          ${types.map((t) => `<label class="type-card"><input type="radio" name="type" value="${t}" ${t === type ? 'checked' : ''}><span class="type-icon">${typeIcon(t)}</span><span class="type-name">${TYPE_INFO[t][0]}</span><span class="type-desc">${TYPE_INFO[t][1]}</span></label>`).join('')}
        </fieldset>
        <div class="field" style="margin-top:var(--space-md)"><label for="prompt-input">Name</label>
          <input class="input" id="prompt-input" type="text" autocomplete="off" spellcheck="false" value="Untitled" required aria-describedby="prompt-help"><span class="field-help" id="prompt-help"></span></div>
      </div>
      <div class="sheet-foot"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn btn-primary" type="submit">Create</button></div></form>`;
    const input = $('#prompt-input', d);
    const done = (v) => { d.close(); resolve(v); };
    d.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v || /[\\:*?"<>|]/.test(v)) { $('#prompt-help', d).textContent = 'Use a name without \\ : * ? " < > |'; $('#prompt-help', d).dataset.error = 'true'; input.focus(); return; }
      done({ name: v, type: d.querySelector('input[name=type]:checked').value });
    };
    d.querySelector('[data-cancel]').onclick = () => done(null);
    d.oncancel = () => resolve(null);
    d.showModal(); input.select();
  });
}
/* slide templates: gallery, workspace copies, saving */
async function ensureTemplate(t) {
  const T = await import('./slides-templates.js'); const path = T.workspacePath(t);
  if (!S.files.includes(path)) { await folio.create(path, t.text); await refreshTree(); }
  return path;
}
/** a .pptx becomes a deck next to the open note; a .potx becomes a template in Templates/ */
async function importPowerPointFile() {
  let picked;
  try { picked = await folio.pickOffice(); } catch (e) { return toast(e.message, { kind: 'error' }); }
  if (!picked) return;
  const asTemplate = picked.ext === 'potx';
  const T = await import('./slides-templates.js');
  const folder = asTemplate ? T.TEMPLATE_DIR : dirOf(S.active || '');
  const safe = picked.name.replace(/[\\/:*?"<>|]/g, '-');
  let path = `${folder ? folder + '/' : ''}${safe}.slides.md`; let n = 2;
  while (S.files.includes(path)) path = `${folder ? folder + '/' : ''}${safe} ${n++}.slides.md`;
  toast(`Importing ${picked.name}…`);
  try {
    const { importPowerPoint } = await import('./slides-import.js');
    const text = await importPowerPoint(picked.bytes.buffer, { name: picked.name, template: asTemplate, saveAsset: (name, bytes) => folio.saveImage(path, name, bytes) });
    await folio.create(path, text); await refreshTree(); await openFile(path);
    toast(asTemplate ? `${picked.name} is now a template. Find it in New from template.` : `Imported ${picked.name}.`);
  } catch (e) { toast(`Import failed. ${e.message}`, { kind: 'error' }); }
}
async function saveTemplate(name, text) {
  const T = await import('./slides-templates.js');
  let path = `${T.TEMPLATE_DIR}/${name.replace(/[\\/:*?"<>|]/g, '-')}.slides.md`; let n = 2;
  while (S.files.includes(path)) path = `${T.TEMPLATE_DIR}/${name.replace(/[\\/:*?"<>|]/g, '-')} ${n++}.slides.md`;
  await folio.create(path, text); await refreshTree(); return path;
}
async function templateGallery({ mode = 'new' } = {}) {
  const T = await import('./slides-templates.js');
  const list = await T.listTemplates(refEnv());
  return new Promise((resolve) => {
    const d = $('#sheet-prompt'); d.classList.add('sheet-wide');
    const tags = [...new Set(list.flatMap((t) => t.tags))].sort();
    d.innerHTML = `<form method="dialog" class="tp-form">
      <div class="sheet-head"><div><h2 id="prompt-title">${mode === 'new' ? 'Choose a template' : 'Change template'}</h2><p>${mode === 'new' ? 'A template sets colours, fonts, backgrounds and slide layouts. You can change it later in Design.' : 'The deck keeps its slides and takes the colours, fonts, backgrounds and layouts of the template.'}</p></div></div>
      <div class="sheet-body">
        <div class="tp-filter"><input class="input" type="search" data-tq placeholder="Search templates" aria-label="Search templates"><select class="rb-select" data-tt aria-label="Filter by style"><option value="">All styles</option>${tags.map((x) => `<option>${esc(x)}</option>`).join('')}</select></div>
        <div class="tp-grid" role="radiogroup" aria-label="Templates">
          ${mode === 'new' ? '<label class="tp-card"><input type="radio" name="tp" value="blank"><span class="tp-prev tp-blank">Blank deck</span><span class="tp-name">Blank</span><span class="tp-desc">The plain Folio look, no template file.</span></label>' : ''}
          ${list.map((t, i) => `<label class="tp-card" data-tags="${esc(t.tags.join(','))}" data-name="${esc((t.name + ' ' + t.description).toLowerCase())}"><input type="radio" name="tp" value="${i}"${i === 0 && mode !== 'new' ? ' checked' : ''}><span class="tp-prev">${T.previewHtml(t, 200)}</span><span class="tp-name">${esc(t.name)}${t.builtin ? '' : ' <em>yours</em>'}</span><span class="tp-desc">${esc(t.description)}</span>${t.variants.length ? `<span class="tp-vars" aria-label="Colour variants">${[t, ...t.variants].map((v) => { const tk = v.tokens || {}; const tok = v.tokens ? tk : Object.fromEntries(['paper', 'accent', 'ink'].map((k) => [k, (parseFrontmatter(t.text).data[k] || '')])); return `<i style="background:${esc(tok.accent || '#888')};border-color:${esc(tok.paper || '#fff')}"></i>`; }).join('')}</span>` : ''}</label>`).join('')}
        </div>
        <p class="fp-note">Make your own: build a deck, then Design, Save as template. Templates live in the ${T.TEMPLATE_DIR} folder. <a href="#" data-guide>How to build a template</a></p>
      </div>
      <div class="sheet-foot"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn btn-primary" type="submit">${mode === 'new' ? 'Create' : 'Apply template'}</button></div></form>`;
    if (mode === 'new') d.querySelector('input[value="0"]').checked = true;
    const filter = () => { const q = d.querySelector('[data-tq]').value.trim().toLowerCase(), tg = d.querySelector('[data-tt]').value; for (const c of d.querySelectorAll('.tp-card[data-name]')) c.hidden = (q && !c.dataset.name.includes(q)) || (tg && !c.dataset.tags.split(',').includes(tg)); };
    d.querySelector('[data-tq]').addEventListener('input', filter); d.querySelector('[data-tt]').addEventListener('change', filter);
    d.querySelector('[data-guide]').addEventListener('click', (e) => { e.preventDefault(); folio.openExternal?.('https://github.com/gabrielevaudano98/folio/blob/main/docs/TEMPLATES.md'); });
    const done = (v) => { d.close(); d.classList.remove('sheet-wide'); resolve(v); };
    d.querySelector('form').onsubmit = (e) => { e.preventDefault(); const v = d.querySelector('input[name=tp]:checked')?.value; done(v == null ? null : v === 'blank' ? 'blank' : list[Number(v)]); };
    d.querySelector('[data-cancel]').onclick = () => done(null);
    d.oncancel = () => { d.classList.remove('sheet-wide'); resolve(null); };
    d.showModal();
  });
}
async function newFolder(parent = '') {
  const name = await prompt({ title: 'New folder', label: 'Name', value: '', action: 'Create' });
  if (!name) return;
  try {
    const p = (parent ? parent + '/' : '') + name; await folio.mkdir(p); S.expanded.add(p); await refreshTree();
    let rec = null;
    actions.push({ scope: S.workspace, label: `created folder ${name}`, undo: async () => { rec = await trashRaw(p); }, redo: async () => { await untrashRaw(rec); } });
    updateHistoryButtons();
  } catch (e) { toast(e.message, { kind: 'error' }); }
}
async function renamePath(p, isDir) {
  const name = await prompt({ title: isDir ? 'Rename folder' : 'Rename note', label: 'Name', value: isDir ? base(p) : stem(p), action: 'Rename' });
  if (!name) return;
  const ext = isDir ? '' : (p.match(/(\.(slides|board|sheet))?\.\w+$/i)?.[0] || '.md');
  const to = (dirOf(p) ? dirOf(p) + '/' : '') + name + (isDir || /\.\w+$/.test(name) ? '' : ext);
  if (to === p) return;
  await movePath(p, to, isDir);
}
/** rename or move, with the links in other documents kept in step; returns how many documents changed */
async function moveRaw(from, to) {
  const r = await folio.rename(from, to);
  retargetTabs(from, to);
  await refreshTree();
  return r?.changed?.length || 0;
}
async function movePath(from, to, isDir) {
  try {
    const n = await moveRaw(from, to);
    actions.push({ scope: S.workspace, label: `${dirOf(from) === dirOf(to) ? 'renamed' : 'moved'} ${isDir ? base(from) : stem(from)}`, undo: () => moveRaw(to, from), redo: () => moveRaw(from, to) });
    toast(n ? `Updated links in ${n} ${n === 1 ? 'document' : 'documents'}.` : `${dirOf(from) === dirOf(to) ? 'Renamed' : 'Moved'} “${isDir ? base(from) : stem(from)}”.`, { action: ['Undo', () => fileUndo('undo')] });
    updateHistoryButtons();
  } catch (e) { toast(e.message, { kind: 'error' }); }
}
function retargetTabs(from, to) {
  nav.list = nav.list.map((x) => (x === from || x.startsWith(from + '/') ? to + x.slice(from.length) : x));
  for (const t of S.tabs) {
    if (t.path === from || t.path.startsWith(from + '/')) {
      const np = to + t.path.slice(from.length);
      if (S.active === t.path) S.active = np;
      t.path = np;
    }
  }
  renderTabs(); renderStatus(); persistTabs();
}
/** move to the Trash, keeping a copy so the move can be undone; unsaved edits are saved first so they come back too */
async function trashRaw(p) {
  const open = S.tabs.filter((t) => t.path === p || t.path.startsWith(p + '/')).map((t) => t.path);
  const active = open.includes(S.active) ? S.active : null;
  for (const q of open) {
    const t = tabOf(q); if (!t || t.text === t.saved) continue;
    await saveTab(t).catch(() => {});
    if (t.text !== t.saved) throw new Error(`Could not save “${stem(q)}”, so it was not moved. Your changes are still open.`);
  }
  const { token } = await folio.trash(p);
  for (const q of open) await closeTab(q);
  await refreshTree();
  return { token, open, active };
}
async function untrashRaw(rec) {
  await folio.untrash(rec.token); await refreshTree();
  for (const q of rec.open) await openFile(q, { background: true });
  if (rec.active) await openFile(rec.active);
}
async function trashPath(p, isDir) {
  const ok = await confirmSheet({ title: `Move “${isDir ? base(p) : stem(p)}” to the Trash?`, body: 'You can undo this, or restore it from the system Trash.', action: 'Move to Trash', danger: true });
  if (!ok) return;
  try {
    let rec = await trashRaw(p);
    const name = isDir ? base(p) : stem(p);
    actions.push({ scope: S.workspace, label: `moved ${name} to the Trash`, undo: async () => { await untrashRaw(rec); }, redo: async () => { rec = await trashRaw(p); } });
    toast(`Moved “${name}” to the Trash.`, { action: ['Undo', () => fileUndo('undo')] });
    updateHistoryButtons();
  } catch (e) { toast(e.message, { kind: 'error' }); }
}
async function chooseFolder() {
  try {
    const dir = await folio.chooseWorkspace();
    if (!dir) return;
    await switchWorkspace(dir);
  } catch (e) { toast(e.message, { kind: 'error' }); }
}
async function switchWorkspace(dir) {
  await actions.idle(); // let a file action that is still running finish in the folder it started in
  for (const t of S.tabs) await saveTab(t);
  S.tabs = []; S.active = null; S.aiEdits.clear(); S.expanded.clear();
  renderTabs();
  await folio.openWorkspace(dir);
  S.settings.workspace = dir;
  await saveSetting({ openTabs: [], lastFile: null });
  await loadWorkspace(dir);
}

/* ============ search ============ */
const runSearch = debounce(async (q) => {
  const files = $('#section-files'), res = $('#section-results');
  if (!q.trim()) { files.hidden = false; res.hidden = true; return; }
  files.hidden = true; res.hidden = false;
  if (!S.workspace) { $('#results').innerHTML = '<div class="side-empty">Open a folder to search it.</div>'; return; }
  try {
    const results = await folio.search(q, { limit: 80 });
    const total = results.reduce((n, r) => n + r.total, 0);
    $('#results-head').textContent = results.length ? `${total} ${total === 1 ? 'match' : 'matches'} in ${results.length} ${results.length === 1 ? 'note' : 'notes'}` : 'No matches';
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    $('#results').innerHTML = results.length ? results.map((r) => `
      <button class="result" type="button" data-file="${esc(r.path)}" data-line="${r.matches[0]?.line || 1}">
        <span class="result-name">${esc(stem(r.path))}</span>
        ${dirOf(r.path) ? `<span class="result-folder">${esc(dirOf(r.path))}</span>` : ''}
        ${r.matches.slice(0, 2).map((m) => `<span class="result-line">${esc(m.text).replace(re, (x) => `<mark>${x}</mark>`)}</span>`).join('')}
      </button>`).join('') : `<div class="side-empty">Nothing in this folder matches “${esc(q)}”.</div>`;
  } catch (e) { $('#results').innerHTML = `<div class="side-empty">Search failed. ${esc(e.message)}</div>`; }
}, 160);

/* ============ AI edits: the signature ============ */
function lineChanges(before, after) {
  const parts = diffLines(before ?? '', after ?? '');
  const changed = []; let line = 1, added = 0, removed = 0;
  for (const p of parts) {
    const n = p.count ?? p.value.split('\n').length - (p.value.endsWith('\n') ? 1 : 0);
    if (p.added) { for (let i = 0; i < n; i++) changed.push(line + i); line += n; added += n; }
    else if (p.removed) { removed += n; if (!changed.includes(line)) changed.push(line); }
    else line += n;
  }
  return { changed: [...new Set(changed)], added, removed, parts };
}
function onAiEdit({ path: p, before, after, client, created }) {
  const prior = S.aiEdits.get(p);
  const rec = { before: prior && Date.now() - prior.at < 10 * 60e3 ? prior.before : before, after, client, at: Date.now(), created };
  rec.stats = lineChanges(rec.before, after);
  S.aiEdits.set(p, rec);
  const t = tabOf(p);
  if (t) {
    const userDirty = t.text !== t.saved;
    t.saved = after;
    if (p === S.active) { setActiveText(after); highlightAi(p, { fresh: true }); showAiBanner(p); renderPreview(); renderOutline(); if (userDirty) toast(`${client} changed this note while you had unsaved edits. Press ${keyLabel('Mod+Z')} to get yours back.`); }
    else t.text = after;
  } else {
    toast(`${client} ${created ? 'created' : 'edited'} ${stem(p)}.`, { action: ['Open', () => openFile(p)] });
  }
  if (created) refreshTree(); else renderTree();
  renderTabs();
}
let settleTimer;
function highlightAi(p, { fresh }) {
  const rec = S.aiEdits.get(p); if (!rec) return;
  const cur = lineChanges(rec.before, activeTab()?.text ?? rec.after);
  editor.markAiLines(cur.changed);
  clearTimeout(settleTimer);
  if (fresh) {
    const first = cur.changed[0];
    if (first) editor.scrollToLine(Math.max(1, first - 3));
    settleTimer = setTimeout(() => { editor.settleAi(); $$('#preview .ai-changed').forEach((e) => e.classList.add('settled')); }, 2600);
  } else editor.settleAi();
}
function markPreviewAi(rec) {
  const { changed } = lineChanges(rec.before, activeTab()?.text ?? rec.after);
  const set = new Set(changed.map((n) => n - 1));
  const fresh = Date.now() - rec.at < 2600;
  for (const el of $$('#preview [data-line]')) {
    if (el.matches('ul, ol, table, blockquote') && el.querySelector('[data-line]')) continue;
    if (el.matches('p') && el.closest('li[data-line]')) continue;
    const a = Number(el.dataset.line), b = Number(el.dataset.lineEnd || a + 1);
    for (let i = a; i < b; i++) if (set.has(i)) { el.classList.add('ai-changed'); if (!fresh) el.classList.add('settled'); break; }
  }
}
function showAiBanner(p) {
  const rec = S.aiEdits.get(p); if (!rec) return;
  const { added, removed } = rec.stats;
  const bits = [added && `${added} ${added === 1 ? 'line' : 'lines'} added`, removed && `${removed} removed`].filter(Boolean).join(', ');
  $('#ai-banner-text').innerHTML = `<strong>${esc(rec.client)}</strong> ${rec.created ? 'created' : 'edited'} this note <span>${bits ? `(${bits})` : ''} at ${new Date(rec.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;
  $('#ai-banner').hidden = false;
  $('#ai-banner-undo').textContent = rec.created ? 'Remove note' : 'Undo';
}
function hideAiBanner() { $('#ai-banner').hidden = true; }
function dismissAi(p = S.active) {
  S.aiEdits.delete(p); hideAiBanner(); editor.settleAi('clear');
  $$('#preview .ai-changed').forEach((e) => e.classList.remove('ai-changed'));
  renderTree(); renderTabs();
}
async function undoAi(p = S.active) {
  const rec = S.aiEdits.get(p); if (!rec) return;
  if (rec.created) { S.aiEdits.delete(p); const t = tabOf(p); if (t) t.saved = t.text; await folio.trash(p); await closeTab(p); await refreshTree(); return; }
  try {
    await folio.write(p, rec.before);
    const t = tabOf(p);
    if (t) { t.saved = rec.before; if (p === S.active) setActiveText(rec.before); else t.text = rec.before; }
    dismissAi(p); renderPreview(); renderOutline();
    toast(`Restored ${stem(p)} to how it was before ${rec.client} edited it.`);
  } catch (e) { toast(`Could not undo. ${e.message}`, { kind: 'error' }); }
}
function openDiff(p = S.active) {
  const rec = S.aiEdits.get(p); if (!rec) return;
  const parts = diffLines(rec.before ?? '', activeTab()?.text ?? rec.after);
  let a = 1, b = 1; const rows = [];
  parts.forEach((part, idx) => {
    const lines = part.value.replace(/\n$/, '').split('\n');
    if (!part.added && !part.removed) {
      const keep = lines.length > 7 && idx !== 0 && idx !== parts.length - 1 ? [...lines.slice(0, 3).map((l, i) => [l, a + i, b + i]), null, ...lines.slice(-3).map((l, i) => [l, a + lines.length - 3 + i, b + lines.length - 3 + i])]
        : lines.length > 4 && (idx === 0 || idx === parts.length - 1) ? (idx === 0 ? [null, ...lines.slice(-3).map((l, i) => [l, a + lines.length - 3 + i, b + lines.length - 3 + i])] : [...lines.slice(0, 3).map((l, i) => [l, a + i, b + i]), null])
        : lines.map((l, i) => [l, a + i, b + i]);
      for (const k of keep) rows.push(k ? `<div class="diff-line"><span class="n">${k[2]}</span><span class="s"></span><span class="t">${esc(k[0]) || ' '}</span></div>` : '<div class="diff-gap">Unchanged lines hidden</div>');
      a += lines.length; b += lines.length;
    } else if (part.removed) { lines.forEach((l, i) => rows.push(`<div class="diff-line del"><span class="n">${a + i}</span><span class="s">−</span><span class="t">${esc(l) || ' '}</span></div>`)); a += lines.length; }
    else { lines.forEach((l, i) => rows.push(`<div class="diff-line add"><span class="n">${b + i}</span><span class="s">+</span><span class="t">${esc(l) || ' '}</span></div>`)); b += lines.length; }
  });
  const d = $('#sheet-diff');
  d.innerHTML = `
    <div class="sheet-head"><div><h2 id="diff-title">Changes by ${esc(rec.client)}</h2><p>${esc(p)}, compared with the note before the first AI edit in this session.</p></div>
      <button class="icon-btn" type="button" data-close-sheet aria-label="Close">${icons.close}</button></div>
    <div class="sheet-body"><div class="diff-summary"><span>+ ${rec.stats.added} added</span><span>− ${rec.stats.removed} removed</span></div><div class="diff">${rows.join('')}</div></div>
    <div class="sheet-foot"><button class="btn" type="button" data-diff="undo">Undo all changes</button><button class="btn btn-primary" type="button" data-diff="keep">Keep changes</button></div>`;
  d.showModal(); d.querySelector('[data-diff="keep"]').focus();
}

/* ============ AI panel ============ */
function renderAiStatus() {
  const m = S.mcp || {};
  const el = $('#ai-status');
  const recent = m.activity?.[0];
  el.dataset.state = m.port ? 'on' : 'off';
  $('#ai-status-title').textContent = m.port ? (m.allowWrite ? 'AI can read and edit' : 'AI can read only') : 'AI access off';
  $('#ai-status-sub').textContent = m.error ? m.error : !m.enabled ? 'Turn on in AI settings' : recent ? `Last used by ${recent.client}` : 'Connect Claude, Cursor and more';
}
async function openAiSheet() {
  const d = $('#sheet-ai');
  const [conn, token] = await Promise.all([folio.connections().catch(() => null), folio.mcpToken().catch(() => '')]);
  const m = S.mcp || {};
  const logos = { claude: 'C', cursor: 'Cu', vscode: 'VS', windsurf: 'W', lmstudio: 'LM' };
  d.innerHTML = `
    <div class="sheet-head"><div><h2 id="ai-title">Connect your AI</h2><p>Folio runs an MCP server on this computer. Apps you connect can list, search, read and edit the notes in the open folder, and every edit appears here with an undo.</p></div>
      <button class="icon-btn" type="button" data-close-sheet aria-label="Close">${icons.close}</button></div>
    <div class="sheet-body">
      <section class="group"><div class="rows">
        <div class="row"><div class="row-main"><span class="row-title">Allow AI access</span><span class="row-sub">${m.port ? `Listening on 127.0.0.1, port ${m.port}` : m.error ? esc(m.error) : 'The server is stopped.'}</span></div>
          <label class="switch"><input type="checkbox" role="switch" data-setting="mcpEnabled" ${m.enabled ? 'checked' : ''} aria-label="Allow AI access"></label></div>
        <div class="row"><div class="row-main"><span class="row-title">Let AI edit notes</span><span class="row-sub">Off means assistants can only read and search.</span></div>
          <label class="switch"><input type="checkbox" role="switch" data-setting="allowWrite" ${m.allowWrite ? 'checked' : ''} aria-label="Let AI edit notes"></label></div>
      </div></section>

      <section class="group"><h3>Apps on this computer</h3><p class="group-note">Connect writes Folio into the app’s MCP config file and keeps a backup of the old one.</p>
        <div class="rows">${conn ? conn.list.map((c) => `
          <div class="row"><span class="app-logo" aria-hidden="true">${logos[c.id] || c.name[0]}</span>
            <div class="row-main"><span class="row-title">${esc(c.name)}</span><span class="row-sub">${c.installed ? esc(c.restart) : c.appPresent ? 'Found on this computer' : 'Not found, the config is created when you connect'}</span></div>
            <span class="row-state" data-on="${c.installed}">${c.installed ? `${icons.check} Connected` : ''}</span>
            <div class="row-actions">
              <button class="icon-btn" type="button" data-copy-snippet="${c.id}" aria-label="Copy ${esc(c.name)} config" data-tip="Copy config">${icons.copy}</button>
              ${c.installed ? `<button class="btn" type="button" data-uninstall="${c.id}">Disconnect</button>` : `<button class="btn" type="button" data-install="${c.id}">Connect</button>`}
            </div></div>`).join('') : '<div class="row"><span class="row-sub">Could not read the app configs.</span></div>'}
        </div></section>

      <section class="group"><h3>Claude Code</h3><p class="group-note">Run this once in a terminal.</p>
        <div class="codebox"><code id="cc-cmd">${esc(conn?.claudeCode || '')}</code><button class="icon-btn" type="button" data-copy="#cc-cmd" aria-label="Copy command">${icons.copy}</button></div></section>

      <section class="group"><h3>Any other MCP client</h3><p class="group-note">Streamable HTTP, local only. Send the token as a bearer header.</p>
        <div class="rows">
          <div class="row"><div class="row-main"><span class="row-title">URL</span><span class="row-sub" id="mcp-url">${esc(conn?.httpUrl || 'Server stopped')}</span></div><button class="icon-btn" type="button" data-copy="#mcp-url" aria-label="Copy URL">${icons.copy}</button></div>
          <div class="row"><div class="row-main"><span class="row-title">Token</span><span class="row-sub" id="mcp-token" data-secret="${esc(token)}">${'•'.repeat(24)}</span></div>
            <button class="btn btn-quiet" type="button" data-reveal-token>Show</button><button class="icon-btn" type="button" data-copy-token aria-label="Copy token">${icons.copy}</button><button class="btn" type="button" data-rotate>New token</button></div>
        </div></section>

      <section class="group"><h3>Recent activity</h3><div class="rows" id="ai-activity">${activityHtml()}</div></section>
    </div>`;
  if (!d.open) { d.showModal(); d.querySelector('.sheet-body input, .sheet-body button')?.focus(); }
}
function activityHtml() {
  const a = S.mcp?.activity || [];
  if (!a.length) return '<p class="activity-empty">No assistant has used Folio yet. Once connected, ask it something like “summarise my notes about the roadmap”.</p>';
  const verbs = { list_notes: 'listed notes', read_note: 'read', search_notes: 'searched for', get_outline: 'read the outline of', get_open_note: 'looked at your open note', create_note: 'created', write_note: 'rewrote', edit_note: 'edited', append_to_note: 'appended to', move_note: 'moved', open_note: 'opened' };
  return `<ul class="activity">${a.slice(0, 12).map((x) => `<li><span class="a-time">${new Date(x.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span class="a-client">${esc(x.client)}</span><span class="a-what">${esc(verbs[x.tool] || x.tool)} ${esc(x.path || '')}</span></li>`).join('')}</ul>`;
}

/* ============ settings sheet ============ */
function openSettings() {
  const s = S.settings;
  const d = $('#sheet-settings');
  d.innerHTML = `
    <div class="sheet-head"><div><h2 id="settings-title">Settings</h2><p>Saved on this computer.</p></div><button class="icon-btn" type="button" data-close-sheet aria-label="Close">${icons.close}</button></div>
    <div class="sheet-body">
      <section class="group"><h3>Appearance</h3><div class="rows">
        <div class="row"><div class="row-main"><label class="row-title" for="set-theme">Theme</label></div>
          <select class="select" id="set-theme" data-setting="theme"><option value="system">Match system</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
        <div class="row"><div class="row-main"><label class="row-title" for="set-size">Text size</label><span class="row-sub">Editor and preview</span></div>
          <select class="select" id="set-size" data-setting="fontSize">${[14, 15, 16, 17, 18, 20, 22].map((n) => `<option value="${n}">${n} pt</option>`).join('')}</select></div>
        <div class="row"><div class="row-main"><label class="row-title" for="set-width">Line length</label><span class="row-sub">Characters per line</span></div>
          <select class="select" id="set-width" data-setting="lineWidth">${[60, 66, 72, 80, 96, 120].map((n) => `<option value="${n}">${n}</option>`).join('')}</select></div>
      </div></section>
      <section class="group"><h3>Writing</h3><div class="rows">
        <div class="row"><div class="row-main"><span class="row-title">Check spelling</span></div><label class="switch"><input type="checkbox" role="switch" data-setting="spellcheck" ${s.spellcheck ? 'checked' : ''} aria-label="Check spelling"></label></div>
      </div></section>
      <section class="group" id="set-features" aria-busy="true"><h3>Optional features</h3></section>
      <section class="group"><h3>About</h3><div class="rows">
        <div class="row"><div class="row-main"><span class="row-title">Folio ${esc(S.version || '')}</span><span class="row-sub">Based on Folio by Gabriele Vaudano. Free software under the GNU AGPL-3.0: you may change and share it, keeping this attribution and publishing your changes.</span></div>
          <button class="btn" type="button" data-open-url="https://github.com/gabrielevaudano98/folio">Source code</button></div>
      </div></section>
      <section class="group"><h3>AI server</h3><div class="rows">
        <div class="row"><div class="row-main"><label class="row-title" for="set-port">Port</label><span class="row-sub field-help" id="port-help">Local only, 1024 to 65535</span></div>
          <input class="input" id="set-port" type="text" inputmode="numeric" name="port" autocomplete="off" value="${s.mcpPort}" style="width:7rem" aria-describedby="port-help"></div>
      </div></section>
    </div>`;
  $('#set-theme', d).value = s.theme; $('#set-size', d).value = s.fontSize; $('#set-width', d).value = s.lineWidth;
  d.showModal(); $('#set-theme', d).focus();
  meeting().then((m) => m.renderSettings($('#set-features', d))).catch((e) => toast(e.message, { kind: 'error' }));
}

/* ============ meeting recorder (optional feature, loaded on demand) ============ */
let meetingP = null;
function meeting() {
  return (meetingP ||= import('./meeting.js').then(({ createMeeting }) => createMeeting({
    $, esc, toast, confirm: confirmSheet, prompt, openSettings,
    openFile: (p) => openFile(p).catch((e) => toast(e.message, { kind: 'error' })),
    refreshTree: () => refreshTree().catch(() => {}),
  })));
}

/* ============ palette ============ */
/* ---------- back and forward between notes ---------- */
const nav = { list: [], i: -1, busy: false };
function navRecord(p) {
  if (nav.busy || nav.list[nav.i] === p) return;
  nav.list.length = nav.i + 1; nav.list.push(p);
  if (nav.list.length > 100) nav.list.shift();
  nav.i = nav.list.length - 1;
}
function navFind(d) { for (let j = nav.i + d; j >= 0 && j < nav.list.length; j += d) if (S.files.includes(nav.list[j])) return j; return -1; }
async function navGo(d) {
  const j = navFind(d); if (j < 0) return;
  nav.busy = true;
  try { await openFile(nav.list[j]); nav.i = j; } catch (e) { toast(e.message, { kind: 'error' }); } finally { nav.busy = false; }
  updateHistoryButtons();
}

/* ---------- undo and redo ---------- */
const actions = createActionLog(50);
/** where Undo and Redo go right now: the editor with focus, else the visible document view */
function docTarget() {
  const dom = document.activeElement?.closest?.('.cm-editor');
  const v = dom && EditorView.findFromDOM(dom);
  if (v) return { run: (d) => (d === 'undo' ? cmUndo(v) : cmRedo(v)), can: (d) => (d === 'undo' ? undoDepth(v.state) : redoDepth(v.state)) > 0 };
  const type = curType();
  if (type !== 'md' && app.dataset.modeView !== 'code') {
    const sf = curSurface();
    if (sf?.undo) return { run: (d) => sf[d](), can: (d) => (d === 'undo' ? sf.canUndo() : sf.canRedo()) };
  }
  if (type === 'md' && isRich()) return { run: (d) => rich[d](), can: (d) => (d === 'undo' ? rich.canUndo() : rich.canRedo()) };
  return { run: (d) => editor[d](), can: (d) => (d === 'undo' ? editor.canUndo() : editor.canRedo()) };
}
function editUndo(dir) {
  const a = document.activeElement;
  if (a?.matches?.('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea')) { document.execCommand(dir); return; }
  if (a?.closest?.('#sidebar')) return fileUndo(dir); // in the file list, Undo means the last file action
  if (!S.active) return;
  docTarget().run(dir);
  updateHistoryButtons();
}
async function fileUndo(dir) {
  const op = actions.peek(dir);
  if (!op) return toast(dir === 'undo' ? 'No file action to undo.' : 'No file action to redo.');
  if (op.scope !== S.workspace) { actions.clear(); return toast('That action belongs to another folder.', { kind: 'error' }); }
  try { await actions.run(dir); toast(`${dir === 'undo' ? 'Undid' : 'Redid'}: ${op.label}.`); }
  catch (e) { toast(e.message, { kind: 'error' }); }
  await refreshTree(); updateHistoryButtons();
}
function updateHistoryButtons() {
  const t = S.active ? docTarget() : null;
  $('#btn-undo').disabled = !t || !t.can('undo');
  $('#btn-redo').disabled = !t || !t.can('redo');
  $('#btn-back').disabled = navFind(-1) < 0;
  $('#btn-forward').disabled = navFind(1) < 0;
}
const historySoon = debounce(() => updateHistoryButtons(), 60);

const COMMANDS = [
  { id: 'undo', title: 'Undo', key: 'Mod+Z', run: () => editUndo('undo') },
  { id: 'redo', title: 'Redo', key: 'Mod+Shift+Z', run: () => editUndo('redo') },
  { id: 'undo-file', title: 'Undo last file action', key: 'Mod+Alt+Z', run: () => fileUndo('undo') },
  { id: 'redo-file', title: 'Redo file action', key: 'Mod+Alt+Shift+Z', run: () => fileUndo('redo') },
  { id: 'nav-back', title: 'Go back', get key() { return S.platform === 'darwin' ? 'Mod+Alt+Left' : 'Alt+Left'; }, run: () => navGo(-1) },
  { id: 'nav-forward', title: 'Go forward', get key() { return S.platform === 'darwin' ? 'Mod+Alt+Right' : 'Alt+Right'; }, run: () => navGo(1) },
  { id: 'new-note', title: 'New note', key: 'Mod+N', run: () => newNote() },
  { id: 'new-folder', title: 'New folder', run: () => newFolder(dirOf(S.active || '')) },
  { id: 'open-folder', title: 'Open folder…', key: 'Mod+O', run: chooseFolder },
  { id: 'quick-open', title: 'Go to note…', key: 'Mod+P', run: () => openPalette('files') },
  { id: 'search', title: 'Search all notes', key: 'Mod+Shift+F', run: focusSearch },
  { id: 'find', title: 'Find in note', key: 'Mod+F', run: () => editor.run('find') },
  { id: 'mode-edit', title: 'View: write or visual', key: 'Mod+1', run: () => setView(viewsFor(curType())[0][0]) },
  { id: 'mode-split', title: 'View: split', key: 'Mod+2', run: () => setView('split') },
  { id: 'mode-preview', title: 'View: read or code', key: 'Mod+3', run: () => setView(viewsFor(curType())[2][0]) },
  { id: 'toggle-sidebar', title: 'Toggle sidebar', key: 'Mod+\\', run: toggleSidebar },
  { id: 'toggle-outline', title: 'Toggle outline', key: 'Mod+Shift+O', run: toggleOutline },
  { id: 'focus', title: 'Focus mode', key: 'Mod+.', run: toggleFocus },
  { id: 'ai', title: 'Connect AI assistants…', key: 'Mod+Shift+A', run: openAiSheet },
  { id: 'export-html', title: 'Export as HTML…', run: () => exportAs('html') },
  { id: 'export-pptx', title: 'Export slides as PowerPoint…', run: () => (curType() === 'slides' ? exportAs('pptx') : toast('Open a slides document first.')) },
  { id: 'import-pptx', title: 'Import PowerPoint or template (.pptx, .potx)…', run: () => importPowerPointFile() },
  { id: 'export-handouts', title: 'Export slide handouts as PDF…', run: async () => {
    if (curType() !== 'slides') return toast('Open a slides document first.');
    const n = await prompt({ title: 'Export handouts', label: 'Slides per page', value: '3', hint: '1, 2, 3, 4, 6 or 9. Three per page adds lines for notes.', action: 'Export' });
    if (!n) return; const per = parseInt(n, 10);
    if (![1, 2, 3, 4, 6, 9].includes(per)) return toast('Choose 1, 2, 3, 4, 6 or 9 slides per page.', { kind: 'error' });
    curSurface()?.exportHandouts?.({ perPage: per });
  } },
  { id: 'export-notes', title: 'Export slide notes pages as PDF…', run: () => (curType() === 'slides' ? curSurface()?.exportHandouts?.({ notes: true }) : toast('Open a slides document first.')) },
  { id: 'present', title: 'Present slides', key: 'Mod+Enter', run: () => (curType() === 'slides' && curSurface() ? curSurface().present() : toast('Open a slides document to present it.')) },
  { id: 'new-slides', title: 'New slides…', run: () => newNote(undefined, 'slides') },
  { id: 'export-pdf', title: 'Export as PDF…', key: 'Mod+Shift+E', run: () => exportAs('pdf') },
  { id: 'reveal', title: S.platform === 'darwin' ? 'Reveal in Finder' : 'Show in folder', run: () => folio.reveal(S.active || '') },
  { id: 'rename', title: 'Rename note…', run: () => S.active && renamePath(S.active, false) },
  { id: 'trash', title: 'Move note to Trash', run: () => S.active && trashPath(S.active, false) },
  { id: 'settings', title: 'Settings…', key: 'Mod+,', run: openSettings },
  { id: 'meeting', title: 'Record a meeting… / Stop recording', run: () => meeting().then((m) => m.toggle()) },
  { id: 'bold', title: 'Format: bold', key: 'Mod+B', run: () => fmt('bold') },
  { id: 'italic', title: 'Format: italic', key: 'Mod+I', run: () => fmt('italic') },
  { id: 'underline', title: 'Format: underline', key: 'Mod+U', run: () => fmt('underline') },
  { id: 'highlight', title: 'Format: highlight', key: 'Mod+Shift+H', run: () => fmt('highlight') },
  { id: 'link', title: 'Format: link', key: 'Mod+K', run: () => fmt('link') },
  { id: 'code', title: 'Format: inline code', key: 'Mod+E', run: () => fmt('code') },
  { id: 'task', title: 'Format: checklist', key: 'Mod+L', run: () => fmt('task') },
  { id: 'quote', title: 'Format: quote', run: () => fmt('quote') },
  { id: 'h1', title: 'Format: heading 1', key: 'Mod+Alt+1', run: () => fmt('heading', 1) },
  { id: 'h2', title: 'Format: heading 2', key: 'Mod+Alt+2', run: () => fmt('heading', 2) },
  { id: 'h3', title: 'Format: heading 3', key: 'Mod+Alt+3', run: () => fmt('heading', 3) },
  { id: 'table', title: 'Insert table', run: () => (isRich() ? rich.run('table') : editor.insert('\n| Column | Column |\n| --- | --- |\n|  |  |\n')) },
  { id: 'image', title: 'Insert image…', run: () => (isRich() ? rich.run('image') : folio.pickImage(S.active).then((r) => r && editor.insert(`![image](${r})`)).catch((e) => toast(e.message, { kind: 'error' }))) },
  { id: 'mermaid', title: 'Insert diagram (Mermaid)', run: () => insertMd('\n```mermaid\nflowchart LR\n  A[Idea] --> B[Draft] --> C[Shipped]\n```\n') },
  { id: 'insert-ref', title: 'Insert reference to another document…', key: 'Mod+Shift+K', run: () => insertRef('link') },
  { id: 'insert-value', title: 'Insert live value from another document…', run: () => insertRef('value') },
  { id: 'insert-embed', title: 'Embed part of another document…', run: () => insertRef('embed') },
  { id: 'callout', title: 'Insert callout', run: () => insertMd('\n> [!NOTE]\n> \n') },
  { id: 'close-folder', title: 'Close folder', run: async () => { for (const t of S.tabs) await saveTab(t); await folio.closeWorkspace(); S.settings.workspace = null; actions.clear(); nav.list = []; nav.i = -1; showWelcome(); } },
];
function fmt(id, n) {
  if (isRich()) { if (id === 'heading') return rich.editor.chain().focus().toggleHeading({ level: n }).run(); return rich.run(id); }
  if (id === 'heading') return editor.run('heading', n);
  return editor.run(id);
}
function insertMd(md) {
  if (isRich()) { rich.editor.chain().focus().insertContent(md, { contentType: 'markdown' }).run(); return; }
  editor.insert(md);
}
let pal = { mode: 'commands', items: [], sel: 0, opener: null };
function fuzzy(q, s) {
  if (!q) return { score: 1, marks: [] };
  const ql = q.toLowerCase(), sl = s.toLowerCase();
  const idx = sl.indexOf(ql);
  if (idx >= 0) return { score: 100 - idx + (idx === 0 ? 50 : 0), marks: [[idx, idx + q.length]] };
  let i = 0, score = 0; const marks = [];
  for (let j = 0; j < sl.length && i < ql.length; j++) if (sl[j] === ql[i]) { marks.push([j, j + 1]); score += j > 0 && /[\s/_-]/.test(sl[j - 1]) ? 6 : 1; i++; }
  return i === ql.length ? { score, marks } : null;
}
function highlight(s, marks) { let out = '', last = 0; for (const [a, b] of marks) { out += esc(s.slice(last, a)) + '<b>' + esc(s.slice(a, b)) + '</b>'; last = b; } return out + esc(s.slice(last)); }
function openPalette(mode = 'commands') {
  pal = { mode, items: [], sel: 0, opener: document.activeElement };
  const input = $('#palette-input');
  input.value = mode === 'commands' ? '>' : '';
  input.placeholder = mode === 'commands' ? 'Type a command' : 'Go to note by name';
  $('#palette-hint').textContent = mode === 'commands' ? 'Delete the > to search notes instead.' : 'Type > for commands.';
  $('#palette').hidden = false;
  $$('#app, .toasts').forEach((e) => (e.inert = true));
  input.focus();
  updatePalette();
}
function closePalette() { $('#palette').hidden = true; $$('#app, .toasts').forEach((e) => (e.inert = false)); pal.opener?.focus?.(); }
function updatePalette() {
  const raw = $('#palette-input').value;
  const isCmd = raw.startsWith('>');
  const q = isCmd ? raw.slice(1).trim() : raw.trim();
  if (isCmd) {
    pal.items = COMMANDS.map((c) => ({ c, f: fuzzy(q, c.title) })).filter((x) => x.f).sort((a, b) => b.f.score - a.f.score)
      .map(({ c, f }) => ({ html: `<span class="palette-title">${highlight(c.title, f.marks)}</span>${c.key ? `<kbd>${esc(keyLabel(c.key))}</kbd>` : ''}`, run: c.run }));
  } else {
    pal.items = S.files.map((p) => ({ p, f: fuzzy(q, stem(p)) || (q.includes('/') ? fuzzy(q, p) : null) })).filter((x) => x.f)
      .sort((a, b) => b.f.score - a.f.score || (tabOf(b.p) ? 1 : 0) - (tabOf(a.p) ? 1 : 0)).slice(0, 60)
      .map(({ p, f }) => ({ html: `${icons.doc}<span class="palette-title">${highlight(stem(p), f.marks.filter(([a]) => a < stem(p).length))}</span><span class="palette-sub">${esc(dirOf(p))}</span>`, run: () => openFile(p) }));
    if (q && !pal.items.length && S.workspace) pal.items.push({ html: `${icons.plus}<span class="palette-title">Create note “${esc(q)}”</span>`, run: async () => { try { const p = await folio.create(q.endsWith('.md') ? q : q + '.md', `# ${q.split('/').pop()}\n\n`); await refreshTree(); openFile(p); } catch (e) { toast(e.message, { kind: 'error' }); } } });
  }
  pal.sel = Math.min(pal.sel, Math.max(0, pal.items.length - 1));
  $('#palette-list').innerHTML = pal.items.length ? pal.items.map((it, i) => `<li class="palette-item" role="option" id="pi-${i}" data-i="${i}" aria-selected="${i === pal.sel}">${it.html}</li>`).join('')
    : `<li class="palette-empty">${S.workspace || isCmd ? 'No matches.' : 'Open a folder first.'}</li>`;
  $('#palette-input').setAttribute('aria-activedescendant', pal.items.length ? `pi-${pal.sel}` : '');
}
function runPalette(i = pal.sel) { const it = pal.items[i]; if (!it) return; closePalette(); it.run(); }

/* ============ export ============ */
async function exportAs(kind) {
  const t = activeTab(); if (!t) return toast('Open a note to export it.');
  const s = curSurface();
  if (s) { if (kind === 'pdf' && s.exportPdf) return s.exportPdf(); if (kind === 'pptx' && s.exportPptx) return s.exportPptx(); if (kind === 'html') return toast('HTML export is for pages. Use PDF for this document.'); }
  const prose = stylesCss.slice(stylesCss.indexOf('/* ---------- preview prose')).split('/* ---------- palette')[0];
  const css = tokensCss + '\nbody{margin:0;font-family:var(--font-sans);color:var(--color-ink);background:var(--color-paper);-webkit-print-color-adjust:exact}' + prose + '\n.copy-code{display:none}.prose{padding:48px 24px}@media print{.prose{padding:0}}';
  const html = exportDocument(stem(t.path), (!isRich() && $('#preview').innerHTML) || render(t.text), css);
  try { const out = kind === 'pdf' ? await folio.exportPdf(t.path, html) : await folio.exportHtml(t.path, html); if (out) toast(`Exported to ${base(out)}.`); }
  catch (e) { toast(`Export failed. ${e.message}`, { kind: 'error' }); }
}

/* ============ toggles ============ */
function toggleSidebar() { const open = app.dataset.sidebar !== 'open'; app.dataset.sidebar = open ? 'open' : 'closed'; saveSetting({ sidebar: open }); }
function toggleOutline() { const open = app.dataset.outline !== 'open'; app.dataset.outline = open ? 'open' : 'closed'; $('#btn-outline').setAttribute('aria-pressed', String(open)); layoutPanes(); saveSetting({ showOutline: open }); }
function toggleFocus() { app.classList.toggle('focus'); layoutPanes(); if (app.classList.contains('focus') && app.dataset.modeView === 'split') setView('edit', { persist: false }); }
function focusSearch() { if (app.dataset.sidebar !== 'open') toggleSidebar(); $('#sidebar-search').focus(); $('#sidebar-search').select(); }

/* ============ small UI kit: toast, prompt, confirm, menu, tooltip ============ */
function toast(text, { kind = 'info', action } = {}) {
  const el = document.createElement('div');
  (window.__folioToasts ||= []).push(text); // tests read what was said
  el.className = 'toast'; el.dataset.kind = kind; el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = `<p>${esc(text)}</p>${action ? `<button class="btn btn-quiet" type="button">${esc(action[0])}</button>` : ''}<button class="icon-btn" type="button" aria-label="Dismiss">${icons.close}</button>`;
  $('#toasts').appendChild(el);
  const remove = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 280); };
  if (action) el.querySelector('.btn').onclick = () => { remove(); action[1](); };
  el.querySelector('.icon-btn').onclick = remove;
  let timer = kind === 'error' ? null : setTimeout(remove, 5000);
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', () => { if (kind !== 'error') timer = setTimeout(remove, 2500); });
}
function prompt({ title, label, value = '', hint = '', action = 'OK', allowEmpty = false, validate = true }) {
  return new Promise((resolve) => {
    const d = $('#sheet-prompt');
    d.innerHTML = `<form method="dialog" class="prompt-form">
      <div class="sheet-head"><div><h2 id="prompt-title">${esc(title)}</h2></div></div>
      <div class="sheet-body"><div class="field"><label for="prompt-input">${esc(label)}</label>
        <input class="input" id="prompt-input" name="name" type="text" autocomplete="off" spellcheck="false" value="${esc(value)}" ${allowEmpty ? '' : 'required'} aria-describedby="prompt-help">
        <span class="field-help" id="prompt-help">${esc(hint)}</span></div></div>
      <div class="sheet-foot"><button class="btn" type="button" value="cancel" data-cancel>Cancel</button><button class="btn btn-primary" type="submit" value="ok">${esc(action)}</button></div></form>`;
    const input = $('#prompt-input', d);
    const done = (v) => { d.close(); resolve(v); };
    d.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (allowEmpty && !v) return done('');
      if (!validate && v) return done(v);
      if (!v || /[\\:*?"<>|]/.test(v) || v.split('/').some((s) => s === '..')) { $('#prompt-help', d).textContent = 'Use a name without \\ : * ? " < > |'; $('#prompt-help', d).dataset.error = 'true'; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
      done(v);
    };
    d.querySelector('[data-cancel]').onclick = () => done(null);
    d.oncancel = () => resolve(null);
    d.showModal(); input.select();
  });
}
function confirmSheet({ title, body, action, danger }) {
  return new Promise((resolve) => {
    const d = $('#sheet-prompt');
    d.innerHTML = `<div class="sheet-head"><div><h2 id="prompt-title">${esc(title)}</h2><p>${esc(body)}</p></div></div>
      <div class="sheet-foot"><button class="btn" type="button" data-no>Cancel</button><button class="btn ${danger ? '' : 'btn-primary'}" type="button" data-yes>${esc(action)}</button></div>`;
    const done = (v) => { d.close(); resolve(v); };
    d.querySelector('[data-no]').onclick = () => done(false);
    d.querySelector('[data-yes]').onclick = () => done(true);
    d.oncancel = () => resolve(false);
    d.showModal(); d.querySelector('[data-yes]').focus();
  });
}
function showMenu(anchor, items, at) {
  const m = $('#menu');
  m.innerHTML = items.map((it, i) => it === '-' ? '<div class="menu-sep" role="separator"></div>' : it.head ? `<div class="menu-head">${esc(it.head)}</div>`
    : `<button class="menu-item ${it.danger ? 'danger' : ''}" type="button" role="menuitem" data-mi="${i}"${it.disabled ? ' disabled aria-disabled="true"' : ''}><span class="menu-label">${esc(it.label)}</span>${it.key ? `<kbd>${esc(keyLabel(it.key))}</kbd>` : ''}</button>`).join('');
  m.onclick = (e) => { const b = e.target.closest('[data-mi]'); if (!b) return; m.hidePopover(); items[Number(b.dataset.mi)].run(); };
  m.showPopover();
  const r = at ? { left: at.x, bottom: at.y, right: at.x } : anchor.getBoundingClientRect();
  const w = m.offsetWidth, h = m.offsetHeight;
  let x = at ? at.x : Math.min(r.left, window.innerWidth - w - 8);
  if (!at && r.right > window.innerWidth - 240) x = r.right - w;
  let y = at ? at.y : r.bottom + 4;
  if (y + h > window.innerHeight - 8) y = Math.max(8, (at ? at.y : r.top) - h - 4);
  m.style.left = `${Math.max(8, x)}px`; m.style.top = `${y}px`;
  m.querySelector('.menu-item')?.focus();
}
let tipTimer;
function bindTooltips() {
  const tip = $('#tip');
  const show = (el, delay) => {
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      tip.textContent = el.dataset.tip; tip.hidden = false;
      const r = el.getBoundingClientRect();
      tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2))}px`;
      tip.style.top = `${r.bottom + 6}px`;
    }, delay);
  };
  const hide = () => { clearTimeout(tipTimer); tip.hidden = true; };
  document.addEventListener('pointerover', (e) => { const el = e.target.closest('[data-tip]'); if (el) show(el, 850); });
  document.addEventListener('pointerout', (e) => { if (e.target.closest('[data-tip]')) hide(); });
  document.addEventListener('focusin', (e) => { const el = e.target.closest('[data-tip]'); if (el && el.matches(':focus-visible')) show(el, 0); else hide(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  document.addEventListener('pointerdown', hide);
}

/* ============ bindings ============ */
function bindChrome() {
  bindTooltips();
  $('#btn-new').onclick = () => newNote();
  $('#btn-sidebar').onclick = toggleSidebar;
  $('#btn-back').onclick = () => navGo(-1); $('#btn-forward').onclick = () => navGo(1);
  $('#btn-undo').onclick = () => editUndo('undo'); $('#btn-redo').onclick = () => editUndo('redo');
  // clicking these must not take the focus away from the editor they act on
  for (const id of ['#btn-back', '#btn-forward', '#btn-undo', '#btn-redo']) $(id).addEventListener('mousedown', (e) => e.preventDefault());
  document.addEventListener('focusin', historySoon);
  // back and forward from the keyboard win over the editors' own word-jump keys; the mouse side buttons do the same
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.shiftKey || (S.platform === 'darwin' ? !e.metaKey : e.ctrlKey || e.metaKey)) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.target.closest?.('input, textarea, select')) return;
    e.preventDefault(); e.stopPropagation(); navGo(e.key === 'ArrowLeft' ? -1 : 1);
  }, true);
  document.addEventListener('mouseup', (e) => { if (e.button === 3 || e.button === 4) { e.preventDefault(); navGo(e.button === 3 ? -1 : 1); } });
  $('#btn-outline').onclick = toggleOutline;
  $('#ai-status').onclick = openAiSheet;
  $('#view-switch').onclick = (e) => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); };
  $('#view-switch').onkeydown = (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const views = viewsFor(curType()).map(([id]) => id); const i = views.indexOf(app.dataset.modeView);
    const v = views[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3]; setView(v); $(`#view-switch [data-view="${v}"]`).focus();
  };
  $('#btn-more').onclick = (e) => showMenu(e.currentTarget, [
    { label: 'Export as PDF…', key: 'Mod+Shift+E', run: () => exportAs('pdf') },
    { label: 'Export as HTML…', run: () => exportAs('html') }, '-',
    { label: 'Focus mode', key: 'Mod+.', run: toggleFocus },
    { label: 'Command palette…', key: 'Mod+Shift+P', run: () => openPalette('commands') }, '-',
    { label: 'Connect AI assistants…', key: 'Mod+Shift+A', run: openAiSheet },
    { label: 'Settings…', key: 'Mod+,', run: openSettings },
  ]);
  $('#workspace-switch').onclick = (e) => showMenu(e.currentTarget, [
    ...(S.settings.recent || []).filter((d) => d !== S.workspace).slice(0, 5).map((d) => ({ label: d.split(/[\\/]/).filter(Boolean).pop(), run: () => switchWorkspace(d).catch((er) => toast(er.message, { kind: 'error' })) })),
    ...((S.settings.recent || []).length > 1 ? ['-'] : []),
    { label: 'Open folder…', key: 'Mod+O', run: chooseFolder },
    ...(S.workspace ? [{ label: S.platform === 'darwin' ? 'Reveal in Finder' : 'Show in folder', run: () => folio.reveal('') }, { label: 'New folder…', run: () => newFolder('') }] : []),
  ]);

  // sidebar tree
  const tree = $('#tree');
  tree.addEventListener('click', (e) => {
    const f = e.target.closest('[data-file]'), d = e.target.closest('[data-dir]');
    if (f) openFile(f.dataset.file).catch((er) => toast(er.message, { kind: 'error' }));
    else if (d) { const p = d.dataset.dir; S.expanded.has(p) ? S.expanded.delete(p) : S.expanded.add(p); localStorageSet('folio.expanded', JSON.stringify([...S.expanded])); renderTree(); $(`[data-dir="${CSS.escape(p)}"]`)?.focus(); }
  });
  tree.addEventListener('contextmenu', (e) => {
    const f = e.target.closest('[data-file]'), d = e.target.closest('[data-dir]');
    e.preventDefault();
    const at = { x: e.clientX, y: e.clientY };
    if (f) { const p = f.dataset.file; showMenu(null, [
      { label: 'Open', run: () => openFile(p) }, '-',
      { label: 'Rename…', run: () => renamePath(p, false) },
      { label: S.platform === 'darwin' ? 'Reveal in Finder' : 'Show in folder', run: () => folio.reveal(p) },
      { label: 'Copy relative path', run: () => folio.copy(p) }, '-',
      { label: 'Move to Trash', danger: true, run: () => trashPath(p, false) }], at); }
    else if (d) { const p = d.dataset.dir; showMenu(null, [
      { label: 'New note here…', run: () => newNote(p) }, { label: 'New folder here…', run: () => newFolder(p) }, '-',
      { label: 'Rename…', run: () => renamePath(p, true) },
      { label: S.platform === 'darwin' ? 'Reveal in Finder' : 'Show in folder', run: () => folio.reveal(p) }, '-',
      { label: 'Move to Trash', danger: true, run: () => trashPath(p, true) }], at); }
    else if (S.workspace) showMenu(null, [{ label: 'New note…', run: () => newNote('') }, { label: 'New folder…', run: () => newFolder('') }], at);
  });
  tree.addEventListener('keydown', (e) => {
    const rows = $$('.tree-row', tree).filter((r) => r.offsetParent);
    const i = rows.indexOf(document.activeElement);
    if (i < 0) return;
    const el = rows[i];
    if (e.key === 'ArrowDown') { e.preventDefault(); rows[i + 1]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); rows[i - 1]?.focus(); }
    else if (e.key === 'ArrowRight' && el.dataset.dir && !S.expanded.has(el.dataset.dir)) { e.preventDefault(); el.click(); }
    else if (e.key === 'ArrowLeft' && el.dataset.dir && S.expanded.has(el.dataset.dir)) { e.preventDefault(); el.click(); }
    else if (e.key === 'F2' || (e.key === 'Enter' && S.platform === 'darwin' && el.dataset.file && !e.metaKey)) { e.preventDefault(); renamePath(el.dataset.file || el.dataset.dir, !!el.dataset.dir); }
    else if ((e.key === 'Backspace' && (e.metaKey || e.ctrlKey)) || e.key === 'Delete') { e.preventDefault(); trashPath(el.dataset.file || el.dataset.dir, !!el.dataset.dir); }
  });
  // drag to move
  let dragPath = null;
  tree.addEventListener('dragstart', (e) => { const r = e.target.closest('.tree-row'); dragPath = r?.dataset.file || r?.dataset.dir; e.dataTransfer.effectAllowed = 'move'; });
  tree.addEventListener('dragover', (e) => { const d = e.target.closest('[data-dir]'); if (!dragPath) return; e.preventDefault(); $$('.drop-target', tree).forEach((x) => x.classList.remove('drop-target')); d?.classList.add('drop-target'); });
  tree.addEventListener('dragleave', (e) => e.target.closest('[data-dir]')?.classList.remove('drop-target'));
  tree.addEventListener('drop', (e) => {
    e.preventDefault(); $$('.drop-target', tree).forEach((x) => x.classList.remove('drop-target'));
    const d = e.target.closest('[data-dir]'); const to = d ? d.dataset.dir : '';
    if (!dragPath || to === dragPath || to.startsWith(dragPath + '/') || dirOf(dragPath) === to) return (dragPath = null);
    const isDir = !!tree.querySelector(`[data-dir="${CSS.escape(dragPath)}"]`);
    movePath(dragPath, (to ? to + '/' : '') + base(dragPath), isDir); if (to) S.expanded.add(to); dragPath = null;
  });
  tree.addEventListener('focusin', () => (document.documentElement.dataset.focusIn = 'sidebar'));
  tree.addEventListener('focusout', () => delete document.documentElement.dataset.focusIn);

  // sidebar search
  const si = $('#sidebar-search');
  si.addEventListener('input', () => runSearch(si.value));
  si.addEventListener('keydown', (e) => { if (e.key === 'Escape') { si.value = ''; runSearch(''); editor.focus(); } if (e.key === 'ArrowDown') { e.preventDefault(); $('#results .result')?.focus(); } });
  $('#results').addEventListener('click', (e) => { const r = e.target.closest('[data-file]'); if (r) openFile(r.dataset.file, { line: Number(r.dataset.line) }); });

  // tabs
  $('#tabs').addEventListener('click', (e) => {
    const c = e.target.closest('[data-close]'); if (c) { e.stopPropagation(); return closeTab(c.dataset.close); }
    const t = e.target.closest('[data-tab]'); if (t && t.dataset.tab !== S.active) activate(t.dataset.tab);
  });
  $('#tabs').addEventListener('auxclick', (e) => { const t = e.target.closest('[data-tab]'); if (t && e.button === 1) closeTab(t.dataset.tab); });
  $('#tabs').addEventListener('keydown', (e) => { const t = e.target.closest('[data-tab]'); if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); activate(t.dataset.tab); } });

  // outline
  $('#outline-list').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-line]'); if (!a) return; e.preventDefault();
    const line = Number(a.dataset.line);
    if (isRich()) { rich.scrollToHeading(Number(a.dataset.i)); return; }
    if (app.dataset.modeView !== 'preview') editor.scrollToLine(line + 1, { select: true });
    const h = currentHeads[Number(a.dataset.i)];
    const target = $(`#preview #${CSS.escape(slugify(h.text))}`) || $$('#preview [data-line]').find((el) => Number(el.dataset.line) === line);
    if (target && app.dataset.modeView !== 'edit') { syncLock = Date.now() + 400; $('#pane-preview').scrollTo({ top: target.offsetTop - 24, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
  });

  // preview interactions
  $('#preview').addEventListener('click', async (e) => {
    const copy = e.target.closest('.copy-code');
    if (copy) { await folio.copy(copy.parentElement.querySelector('code')?.innerText || ''); copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = 'Copy'), 1400); return; }
    const box = e.target.closest('.task-list-item input');
    if (box) {
      const li = box.closest('[data-line]'); if (!li) return;
      const n = Number(li.dataset.line); const lines = activeTab().text.split('\n');
      lines[n] = lines[n].replace(/\[( |x|X)\]/, (m) => (m === '[ ]' ? '[x]' : '[ ]'));
      const text = lines.join('\n'); editor.applyRemote(text); activeTab().text = text; autosave(); return;
    }
    const a = e.target.closest('a'); if (!a) return;
    e.preventDefault();
    if (a.dataset.wikilink) { const f = resolveWiki(a.dataset.wikilink); if (f) openRef(f, parseRef(a.dataset.wikilink).part); else if (await confirmSheet({ title: `Create “${a.dataset.wikilink}”?`, body: 'This note does not exist yet.', action: 'Create note' })) { const p = await folio.create(a.dataset.wikilink + '.md', `# ${a.dataset.wikilink}\n\n`); await refreshTree(); openFile(p); } return; }
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) { const id = decodeURIComponent(href.slice(1)); const el = [...$('#preview').querySelectorAll('[id]')].find((x) => x.id === id); el?.scrollIntoView(); return; }
    if (/^(https?|mailto):/.test(href)) return folio.openExternal(href);
    const rel = normalize((dirOf(S.active) ? dirOf(S.active) + '/' : '') + decodeURI(href.split('#')[0]));
    if (S.files.includes(rel)) openFile(rel);
  });

  // empty states
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b) { const act = b.dataset.act; if (act === 'choose') chooseFolder(); if (act === 'new') newNote(); if (act === 'ai') openAiSheet(); if (act === 'quick-open') openPalette('files'); }
    const r = e.target.closest('[data-recent]'); if (r) switchWorkspace(r.dataset.recent).catch((er) => toast(er.message, { kind: 'error' }));
  });

  // banner
  $('#ai-banner-undo').onclick = () => undoAi();
  $('#ai-banner-review').onclick = () => openDiff();
  $('#ai-banner-close').onclick = () => dismissAi();

  // sheets: close buttons, settings, ai actions
  document.addEventListener('click', async (e) => {
    const close = e.target.closest('[data-close-sheet]'); if (close) close.closest('dialog').close();
    const url = e.target.closest('[data-open-url]'); if (url) folio.openExternal(url.dataset.openUrl);
    const diff = e.target.closest('[data-diff]'); if (diff) { $('#sheet-diff').close(); if (diff.dataset.diff === 'undo') undoAi(); else dismissAi(); }
    const inst = e.target.closest('[data-install]');
    if (inst) { inst.disabled = true; inst.textContent = 'Connecting…'; try { const r = await folio.install(inst.dataset.install); toast(`Connected. ${r.restart}`); } catch (er) { toast(er.message, { kind: 'error' }); } openAiSheet(); }
    const un = e.target.closest('[data-uninstall]'); if (un) { await folio.uninstall(un.dataset.uninstall).catch((er) => toast(er.message, { kind: 'error' })); openAiSheet(); }
    const cp = e.target.closest('[data-copy]'); if (cp) { await folio.copy($(cp.dataset.copy).textContent); flashCopied(cp); }
    const cs = e.target.closest('[data-copy-snippet]'); if (cs) { const c = await folio.connections(); await folio.copy(c.list.find((x) => x.id === cs.dataset.copySnippet).snippet); flashCopied(cs); }
    const ct = e.target.closest('[data-copy-token]'); if (ct) { await folio.copy($('#mcp-token').dataset.secret); flashCopied(ct); }
    const rv = e.target.closest('[data-reveal-token]'); if (rv) { const t = $('#mcp-token'); const shown = rv.textContent === 'Hide'; t.textContent = shown ? '•'.repeat(24) : t.dataset.secret; rv.textContent = shown ? 'Show' : 'Hide'; }
    const rot = e.target.closest('[data-rotate]'); if (rot) { if (await confirmSheet({ title: 'Make a new token?', body: 'Clients that use the HTTP URL will need the new token. Apps connected above keep working.', action: 'New token' })) { await folio.rotateToken(); openAiSheet(); } }
  });
  document.addEventListener('change', async (e) => {
    const el = e.target.closest('[data-setting]'); if (!el) return;
    const k = el.dataset.setting; const v = el.type === 'checkbox' ? el.checked : /fontSize|lineWidth/.test(k) ? Number(el.value) : el.value;
    await saveSetting({ [k]: v });
    if (k === 'fontSize' || k === 'lineWidth') applyLayoutSettings();
    if (k === 'spellcheck') editor.setSpellcheck(v);
    if (k === 'mcpEnabled' || k === 'allowWrite') { S.mcp = await folio.mcpStatus(); renderAiStatus(); }
  });
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'set-port') return;
    const n = Number(e.target.value), help = $('#port-help'), ok = Number.isInteger(n) && n >= 1024 && n <= 65535;
    help.dataset.error = String(!ok); help.textContent = ok ? 'Local only, 1024 to 65535' : 'Enter a whole number from 1024 to 65535';
    e.target.setAttribute('aria-invalid', String(!ok));
    if (ok) debouncedPort(n);
  });
  for (const d of $$('dialog.sheet')) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });

  // palette
  const pi = $('#palette-input');
  pi.addEventListener('input', () => { pal.sel = 0; updatePalette(); });
  pi.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); pal.sel = Math.min(pal.items.length - 1, pal.sel + 1); updatePalette(); $(`#pi-${pal.sel}`)?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); pal.sel = Math.max(0, pal.sel - 1); updatePalette(); $(`#pi-${pal.sel}`)?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') { e.preventDefault(); runPalette(); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  $('#palette-list').addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) runPalette(Number(li.dataset.i)); });
  $('#palette').addEventListener('pointerdown', (e) => { if (e.target.id === 'palette') closePalette(); });

  // resizers
  dragResize($('#sidebar-resizer'), (x) => { const w = Math.max(200, Math.min(420, x)); document.documentElement.style.setProperty('--sidebar-w', `${w}px`); localStorageSet('folio.sidebarW', w); });
  dragResize($('#pane-divider'), (x) => { const ws = $('#workspace').getBoundingClientRect(); const outline = $('#outline').offsetWidth; splitRatio = Math.max(0.22, Math.min(0.78, (x - ws.left) / (ws.width - outline))); localStorageSet('folio.split', splitRatio); layoutPanes(); });

  // global shortcuts not owned by the menu
  document.addEventListener('keydown', (e) => {
    const m = e.metaKey || e.ctrlKey;
    if (m && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); openPalette('commands'); }
    if (m && e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); insertRef('link'); }
    if (m && e.key === 'Enter' && curType() === 'slides') { e.preventDefault(); curSurface()?.present(); }
    if (e.key === 'Escape' && app.classList.contains('focus') && $('#palette').hidden) toggleFocus();
  });
}
const debouncedPort = debounce(async (n) => { await saveSetting({ mcpPort: n }); S.mcp = await folio.mcpStatus(); renderAiStatus(); }, 700);
function flashCopied(btn) { const old = btn.innerHTML; btn.innerHTML = icons.check; setTimeout(() => (btn.innerHTML = old), 1200); }
function dragResize(handle, onMove) {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); handle.setPointerCapture(e.pointerId); app.classList.add('resizing');
    const move = (ev) => onMove(ev.clientX);
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); app.classList.remove('resizing'); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
  });
}

function bindIpc() {
  folio.onTreeChanged(() => { refreshTree(); backlinksSoon(); });
  folio.onFileChanged(({ path: p, content }) => {
    if (p !== S.active) backlinksSoon();
    if (p !== S.active && /\{\{|!\[\[|```chart/.test(activeTab()?.text || '')) { renderPreview(); curSurface()?.refresh?.(); }
    const t = tabOf(p); if (!t || content === t.saved) return;
    if (t.text === t.saved) { t.saved = content; if (p === S.active) { setActiveText(content); renderPreview(); renderOutline(); } else t.text = content; }
    else toast(`${stem(p)} changed on disk while you were editing.`, { action: ['Use disk version', () => { t.saved = content; if (p === S.active) setActiveText(content); else t.text = content; }] });
  });
  folio.onAiEdit(onAiEdit);
  folio.onAiMove(({ from, to, client }) => { retargetTabs(from, to); refreshTree(); toast(`${client} moved ${stem(from)} to ${to}.`); });
  folio.onAiActivity((m) => { S.mcp = m; renderAiStatus(); const box = $('#ai-activity'); if (box) box.innerHTML = activityHtml(); });
  folio.onAiAsk(async ({ id, kind, payload }) => {
    if (kind === 'open-note') {
      const t = activeTab();
      folio.answer(id, t ? { path: t.path, content: t.text, unsavedChanges: t.text !== t.saved, cursorLine: S.cursor.line, selection: S.cursor.selection || null } : { path: null, message: 'No note is open in Folio.' });
    } else if (kind === 'show-note') {
      try { await openFile(payload.path, { line: payload.line }); folio.answer(id, true); } catch (e) { folio.answer(id, false); }
    }
  });
  folio.onMenu((id) => {
    const c = COMMANDS.find((x) => x.id === id);
    if (c) return c.run();
    if (id === 'save') saveActive(); if (id === 'close-tab') closeTab(); if (id === 'palette') openPalette('commands');
  });
  folio.onTheme(({ dark, accent }) => applyTheme(dark, accent));
  folio.onSwitched(async ({ file }) => {
    const ws = (await folio.init()).settings.workspace;
    if (ws !== S.workspace) { S.tabs = []; S.active = null; renderTabs(); await loadWorkspace(ws); }
    if (file) { await refreshTree(); openFile(file); }
  });
  folio.onBeforeClose(async () => { for (const t of S.tabs) await saveTab(t).catch(() => {}); folio.closeOk(); });
}

window.__folioErrors = [];
/** tests and automation: run a command by id, as the menu would */
window.__folioRun = (id) => COMMANDS.find((x) => x.id === id)?.run();
Object.defineProperty(window, '__folioSurface', { get: () => curSurface() });
Object.defineProperty(window, '__folioEditor', { get: () => editor });
addEventListener('error', (e) => { window.__folioErrors.push(String(e.message)); console.error('[folio-error]', e.message); });
addEventListener('unhandledrejection', (e) => { window.__folioErrors.push(String(e.reason?.message || e.reason)); if (e.reason?.stack) console.error('[folio-error-stack]', e.reason.stack.split('\n').slice(0, 4).join(' | ')); console.error('[folio-error]', e.reason?.message || e.reason); });
boot().catch((e) => { document.body.insertAdjacentHTML('beforeend', `<div class="toasts"><div class="toast" data-kind="error" role="alert"><p>Folio could not start. ${esc(e.message)}</p></div></div>`); console.error(e); });
