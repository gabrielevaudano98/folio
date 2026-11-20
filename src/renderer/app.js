// Folio — renderer.
import { diffLines } from 'diff';
import { createEditor } from './editor.js';
import { createRich } from './rich.js';
import { fuzzy, highlight } from './fuzzy.js';
import { INSERTS } from './inserts.js';
import { portableMarkdown } from './page-syntax.js';
import { mountSlides } from './slides.js';
import { NEW_DECK, renderSlide } from './slides-core.js';
import { hydrateRefs, resolveRef } from './refs.js';
import { parseRef, resolveTarget, docKind } from './refs-syntax.js';
import { extractTags, blockIds, linkKind, longDay, DAY, JOURNAL } from './page-mentions.js';
import { moveSection, shiftSection } from './page-outline.js';
import { renameTag } from './page-props.js';
import { listTemplates, fillTemplate, splitTemplate, intoPage, mergeProps, buttonSource, TEMPLATE_DIR, DAILY, CURSOR, STARTERS, templateMeta, withoutMeta, setMeta, communityItems, templateFileName } from './page-templates.js';
import { openGallery } from './template-gallery.js';
import { popupMenu } from './page-table.js';
import { mountBoard } from './board.js';
import { mountSheet } from './sheet.js';
import { render, headings, renderMermaid, exportDocument, slugify, hydrateCharts } from './markdown.js';
import { icons } from './icons.js';
import { mountHistory } from './history-view.js';
import { htmlToMarkdown } from './page-paste.js';
import { pageSetup, pdfOptions, pageCss } from './page-docx.js';
import { parseProps } from './page-props.js';
import { clean as cleanCm } from './page-critic.js';
import tokensCss from './tokens.css';
import stylesCss from './styles.css';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const base = (p) => p.split('/').pop();
const stem = (p) => base(p).replace(/(\.(slides|board|sheet))?\.(md|markdown|mdx|txt)$/i, '');

/* ---------- document types: every type has a visual view and a code view ---------- */
const SURFACES = { slides: mountSlides, board: mountBoard, sheet: mountSheet };
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
    const host = document.createElement('div');
    host.className = `surface surface-${type}`; host.id = `surface-${type}`;
    $('#pane-surface').appendChild(host);
    surfaces[type] = SURFACES[type](host, surfaceCtx(type));
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
    copy: (t) => folio.copy(t),
    revealLine: (n) => { if (app.dataset.modeView === 'split') editor.scrollToLine(n); },
    exportPdf: (html) => folio.exportPdf(S.active, html, { cssPage: true }),
    saveBinary: (ext, bytes) => folio.exportBinary(S.active, ext, bytes),
    isDark: () => S.dark,
    refEnv,
    openRef,
    copyRef: (part, kind) => copyRef(S.active, part, kind),
    pickRef,
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
  folio.userName().then((n) => { S.userName = n || ''; }).catch(() => {});
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
    onWikiLink: async (name) => { if (DAY.test(parseRef(name).target) && !resolveWiki(name)) return openDailyNote(parseRef(name).target); const f = resolveWiki(name); if (f) return openRef(f, parseRef(name).part); if (await confirmSheet({ title: `Create “${name}”?`, body: 'This note does not exist yet.', action: 'Create note' })) { const p = await folio.create(name + '.md', `# ${name}\n\n`); await refreshTree(); openFile(p); } },
    resolveValue: (raw) => resolveRef(raw, refEnv()).then((r) => r.value),
    smartTypography: () => S.settings.smartTypography !== false,
    pickRef: (o) => pickRef(o),
    breadcrumb: () => breadcrumbHtml(S.active),
    pickMedia: (kind) => folio.pickMedia(S.active, kind).catch((e) => { toast(e.message, { kind: 'error' }); return null; }),
    askUrl: (title) => prompt({ title, label: 'Address', placeholder: 'https://', action: 'Insert' }).then((u) => { u = (u || '').trim(); if (!u) return null; return /^[a-z][\w+.-]*:/i.test(u) ? u : 'https://' + u; }),
    openMedia: (src) => openMedia(src),
    createDoc: createDocHere,
    onCommand: (id) => { if (id === 'template') return insertTemplateCmd(); if (id === 'daily-note') return openDailyNote(todayKey()); if (id === 'template-button') return insertTemplateButton(); if (id === 'focus') toggleFocus(); else if (id === 'outline') toggleOutline(); else if (id === 'spellcheck') { const v = !S.settings.spellcheck; saveSetting({ spellcheck: v }); editor.setSpellcheck(v); rich.editor.view.dom.setAttribute('spellcheck', String(v)); } },
    isOn: (id) => (id === 'focus' ? app.classList.contains('focus') : id === 'outline' ? app.dataset.outline === 'open' : id === 'spellcheck' ? !!S.settings.spellcheck : false),
    onTag: (t) => showTag(t),
    onTemplate: (b, pos) => runTemplateButton(b, pos),
    author: () => S.settings.authorName || S.userName || '',
    onStats: (st) => { S.richStats = st; if (isRich()) renderStatus(); },
    mentions: mentionCtx,
    linkKind: (target) => linkKind(target, S.files, S.active || ''),
    preview: previewHtml,
    saveImage: async (src) => {
      const t = activeTab(); if (!t) return null;
      let data = src; if (!/^data:/.test(src)) data = await folio.dataUrl(src, t.path);
      const m = /^data:image\/([\w+.-]+);base64,(.*)$/s.exec(data); if (!m) return null;
      const bin = atob(m[2]); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return folio.saveImage(t.path, `pasted.${m[1].replace('jpeg', 'jpg').replace(/\+.*/, '')}`, bytes);
    },
    onError: (e) => toast(`Paste failed. ${e.message}`, { kind: 'error' }),
    onCopyBlockLink: (id) => { if (!S.active) return; const t = `[[${refName(S.active)}#^${id}]]`; folio.copy(t); toast(`Copied ${t}. Paste it anywhere to link to this block.`); },
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

  initHistory();
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
  $('#btn-outline').innerHTML = icons.outline;
  $('#btn-more').innerHTML = icons.more;
  $('.workspace-chev').innerHTML = icons.chevronDown;
  $$('.search-glyph').forEach((e) => (e.innerHTML = icons.search));
  $('.ai-status-icon').innerHTML = icons.spark;
  $('.ai-banner-mark').innerHTML = icons.spark;
  $('#ai-banner-close').innerHTML = icons.close;
  $('#search-kbd').textContent = keyLabel('Mod+Shift+F');
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
    renderTree(); tagsStale();
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
  if (prev) prev.scroll = editor.view.scrollDOM.scrollTop;
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
  editor.setDoc(t.text);
  if (type === 'md') { if (isRich()) rich.setMarkdown(t.text); }
  else { const s = surfaceFor(type); s.setText(t.text); s.setMode?.(v); }
  requestAnimationFrame(() => { editor.view.scrollDOM.scrollTop = t.scroll || 0; if (line) editor.scrollToLine(line, { select: true }); });
  const ai = S.aiEdits.get(p);
  if (ai && Date.now() - ai.at < 10 * 60e3) { showAiBanner(p); highlightAi(p, { fresh: false }); } else hideAiBanner();
  renderTabs(); renderTree(); renderPreview(); renderOutline(); renderStatus();
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
  folio.historySnapshot(t.path, t.text, 'close', false).catch(() => {});
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
  if (curType() === 'md') { if (isRich()) rich.setMarkdown(text); }
  else curSurface()?.setText(text);
}
function renderTabsDirty() {
  for (const el of $$('#tabs .tab')) { const t = tabOf(el.dataset.tab); if (t) el.dataset.dirty = String(t.text !== t.saved); }
}
async function saveTab(t) {
  if (t.text === t.saved) return;
  const text = t.text;
  try { await folio.write(t.path, text); t.saved = text; if (t.path === S.active) { setSaveState('Saved'); if (/\[\[|\{\{/.test(text)) backlinksSoon(); if (/#|^tags?:/m.test(text)) tagsStale(); } renderTabsDirty(); }
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
  for (const m of el.querySelectorAll('video[data-src], audio[data-src]')) {
    const src = m.dataset.src;
    if (/^(https?:|data:|file:)/.test(src)) m.src = src;
    else folio.absUrl(normalize(dir ? `${dir}/${decodeURI(src).replace(/^\.\//, '')}` : decodeURI(src))).then((u) => (m.src = u)).catch(() => {});
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
  hydrateBreadcrumbs(el, t.path);
}
/* open an attached file (relative to the page) with the system's app, or a web address in the browser */
function openMedia(src) {
  if (!src) return;
  if (/^(https?|mailto):/i.test(src)) return folio.openExternal(src);
  const d = dirOf(S.active || ''); const rel = normalize(d ? `${d}/${decodeURI(src).replace(/^\.\//, '')}` : decodeURI(src));
  return folio.openFile(rel).catch((e) => toast(`Could not open ${base(rel)}. ${e.message}`, { kind: 'error' }));
}
/* [BREADCRUMB]: where this page sits in the workspace */
function breadcrumbHtml(p) {
  const parts = (p || '').split('/'); const file = parts.pop();
  const crumbs = [S.workspace ? S.workspace.split(/[\\/]/).pop() : 'Workspace', ...parts, stem(file || '')];
  return crumbs.map((c, i) => `<span class="md-crumb"${i === crumbs.length - 1 ? ' aria-current="page"' : ''}>${esc(c)}</span>`).join('<span class="md-crumb-sep" aria-hidden="true">/</span>');
}
function hydrateBreadcrumbs(el, p) { for (const n of el.querySelectorAll('.md-breadcrumb')) n.innerHTML = breadcrumbHtml(p); }
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

async function createDocHere({ type, name, content }) {
  if (!S.workspace || !S.active) return null;
  const folder = dirOf(S.active), ext = type === 'md' ? '.md' : `.${type}.md`;
  let title = name, n = 1; const pathOf = (t) => (folder ? folder + '/' : '') + t + ext;
  while (S.files.includes(pathOf(title))) title = `${name} ${++n}`;
  try {
    const p = await folio.create(pathOf(title), content ? content(title) : (NEW_CONTENT[type] || NEW_CONTENT.md)(title));
    await refreshTree(); toast(`Created ${base(p)}. Ctrl or ⌘ click the link to open it.`);
    return { path: p, ref: refName(p) };
  } catch (e) { toast(e.message, { kind: 'error' }); return null; }
}

/* inline pickers in pages: [[ @ # : (page-mentions.js) */
const textOf = async (p) => tabOf(p)?.text ?? await folio.read(p).catch(() => '');
let tagCache = { at: 0, tags: [] };
const tagsStale = () => { tagCache.at = 0; tagsSoon(); };
async function tagIndex() {
  if (Date.now() - tagCache.at < 30000) return tagCache.tags;
  const counts = new Map();
  for (const f of S.files.filter((x) => /\.(md|markdown)$/i.test(x) && docKind(x) === 'page').slice(0, 2000)) {
    for (const t of extractTags(await textOf(f))) { const k = t.toLowerCase(); const c = counts.get(k) || { tag: t, count: 0, files: [] }; c.count++; c.files.push(f); counts.set(k, c); }
  }
  tagCache = { at: Date.now(), tags: [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)) };
  return tagCache.tags;
}
/* the Tags section of the sidebar (Obsidian's tag pane): nested tags under their parent, counts, rename */
const tagsOpen = () => S.settings.showTags !== false;
async function renderTags() {
  const box = $('#tags-list'); if (!box) return;
  $('#tags-head').setAttribute('aria-expanded', String(tagsOpen())); box.hidden = !tagsOpen();
  if (!S.workspace) { box.innerHTML = ''; return; }
  const all = await tagIndex();
  if (!all.length) { box.innerHTML = '<div class="side-empty">Write #tag in a page, or add tags in its properties.</div>'; return; }
  // parents of nested tags are listed even when no page uses them alone; they count every page under them
  const byKey = new Map(all.map((t) => [t.tag.toLowerCase(), { ...t, files: [...t.files] }]));
  for (const t of all) { const parts = t.tag.split('/'); for (let i = 1; i < parts.length; i++) { const p = parts.slice(0, i).join('/'); const k = p.toLowerCase(); const e = byKey.get(k) || { tag: p, count: 0, files: [] }; e.files = [...new Set([...e.files, ...t.files])]; e.count = e.files.length; byKey.set(k, e); } }
  const sorted = [...byKey.values()].sort((a, b) => a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' }));
  const active = /^#(\S+)$/.exec($('#sidebar-search').value.trim())?.[1]?.toLowerCase();
  box.innerHTML = sorted.map((t) => { const depth = t.tag.split('/').length - 1; const name = t.tag.split('/').pop();
    return `<button type="button" class="tag-item" data-tag="${esc(t.tag)}" style="--depth:${depth}"${active === t.tag.toLowerCase() ? ' aria-current="true"' : ''}><span class="tag-name">#${esc(depth ? name : t.tag)}</span><span class="tag-count">${t.count}</span></button>`; }).join('');
}
const tagsSoon = debounce(() => renderTags(), 400);
function showTag(tag) {
  const si = $('#sidebar-search'); si.value = '#' + tag.replace(/^#/, '');
  if (app.dataset.sidebar !== 'open') toggleSidebar?.();
  runSearch(si.value); renderTags();
}
async function renameTagEverywhere(tag) {
  const to = await prompt({ title: `Rename #${tag}`, label: 'New name', value: tag, hint: 'Every page that uses it is updated, nested tags too (#tag/child).', action: 'Rename' });
  const next = (to || '').trim().replace(/^#/, ''); if (!next || next === tag) return;
  if (!/^[\p{L}\p{N}_\-/]+$/u.test(next) || !/[\p{L}_]/u.test(next)) { toast('A tag has letters, numbers, - _ or /, and at least one letter.', { kind: 'error' }); return; }
  const files = (await tagIndex()).filter((t) => t.tag.toLowerCase() === tag.toLowerCase() || t.tag.toLowerCase().startsWith(tag.toLowerCase() + '/')).flatMap((t) => t.files);
  let changed = 0;
  for (const f of [...new Set(files)]) {
    const t = tabOf(f); const before = t ? t.text : await folio.read(f).catch(() => null); if (before == null) continue;
    const after = renameTag(before, tag, next); if (after === before) continue;
    await folio.write(f, after); changed++;
    if (t) { if (t.text === t.saved) t.saved = after; t.text = after; if (f === S.active) { setActiveText(after); renderPreview(); renderOutline(); } }
  }
  tagCache.at = 0; await renderTags();
  if (/^#/.test($('#sidebar-search').value)) showTag(next);
  toast(changed ? `Renamed #${tag} to #${next} in ${changed} ${changed === 1 ? 'page' : 'pages'}.` : `No page uses #${tag}.`);
}
function mentionCtx() {
  if (!S.workspace || !S.active) return null;
  return {
    files: S.files, from: S.active, refName,
    headingsOf: async (p) => headings(await textOf(p)).map((h) => ({ text: h.text.replace(/[*_`]/g, ''), level: h.level })),
    blocksOf: async (p) => blockIds(await textOf(p)),
    tags: tagIndex,
    createDoc: createDocHere,
  };
}
/* a day link ([[2026-11-21]]) opens that daily note in Journal/, made on first use */
async function openDailyNote(day) {
  const existing = resolveTarget(day, S.files, S.active || '');
  if (existing) return openRef(existing);
  const d = new Date(`${day}T12:00:00`);
  const t = listTemplates(S.files).find((x) => x.name.toLowerCase() === DAILY.toLowerCase());
  const text = t ? filled(await templateText(t), { title: day, now: d }).split(CURSOR).join('') : `# ${longDay(d)}\n\n`;
  const p = await folio.create(`${JOURNAL}/${day}.md`, text);
  await refreshTree(); openFile(p);
}
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/* templates (D9): pages in Templates/ and the starters; filled with {{title}}, {{date}}… when used */
const communityText = new Map();
const templateText = async (t) => (t.path ? await textOf(t.path) : t.url ? communityText.get(t.url) ?? communityText.set(t.url, await folio.fetchTemplate(t.url)).get(t.url) : t.text);
/* a template ready to use: variables filled, its own `template:` description removed */
const filled = (raw, opts) => fillTemplate(withoutMeta(raw), opts);
function pickTemplate({ title = 'Insert template', note = 'Its properties join this page’s and its text goes at the cursor.', action = 'Insert' } = {}) {
  return new Promise((resolve) => {
    const d = $('#sheet-prompt'); const list = listTemplates(S.files);
    d.innerHTML = `<form method="dialog" class="prompt-form tpl-form">
      <div class="sheet-head"><div><h2 id="prompt-title">${esc(title)}</h2><p>${esc(note)} Your own templates are the pages in <b>${TEMPLATE_DIR}/</b>.</p></div></div>
      <div class="sheet-body"><fieldset class="tpl-list"><legend class="visually-hidden">Template</legend>
        ${list.map((t, i) => `<label class="tpl-card"><input type="radio" name="tpl" value="${i}"${i === 0 ? ' checked' : ''}><span class="tpl-name">${esc(t.name)}</span><span class="tpl-desc">${esc(t.starter ? t.desc : t.path)}</span>${t.starter ? '<span class="tpl-badge">Starter</span>' : ''}</label>`).join('')}
      </fieldset></div>
      <div class="sheet-foot"><button class="btn" type="button" data-edit>All templates…</button><span class="rb-spacer"></span><button class="btn" type="button" data-cancel>Cancel</button><button class="btn btn-primary" type="submit">${esc(action)}</button></div></form>`;
    const done = (v) => { d.close(); resolve(v); };
    d.querySelector('form').onsubmit = (e) => { e.preventDefault(); done(list[+d.querySelector('[name=tpl]:checked').value]); };
    d.querySelector('[data-cancel]').onclick = () => done(null);
    d.querySelector('[data-edit]').onclick = () => { done(null); templateGallery('insert'); };
    d.addEventListener('dblclick', (e) => { const c = e.target.closest('.tpl-card'); if (c) { c.querySelector('input').checked = true; d.querySelector('form').requestSubmit(); } }, { once: true });
    d.oncancel = () => resolve(null);
    d.showModal(); d.querySelector('[name=tpl]:checked')?.focus();
  });
}
async function applyTemplate(t, pos = null) {
  if (!t || curType() !== 'md') return;
  const text = filled(await templateText(t), { title: stem(S.active || 'Untitled') });
  rememberTemplate(t);
  if (isRich()) { rich.insertTemplate(text, pos); return; }
  const tab = activeTab(); const { fm, body } = splitTemplate(text);
  if (fm) { const cur = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(tab.text)?.[0] || ''; const merged = mergeProps(cur, fm); if (merged !== cur) editor.setDoc(merged + tab.text.slice(cur.length), { keepHistory: true }); }
  editor.insert(intoPage(body).split(CURSOR).join(''));
}
async function insertTemplateCmd() { return templateGallery(curType() === 'md' && S.active ? 'insert' : 'new'); }

/* ---------- the template gallery (Confluence, Notion) ---------- */
async function templateItems() {
  const metas = {};
  for (const f of S.files.filter((x) => x.startsWith(TEMPLATE_DIR + '/') && /\.(md|markdown)$/i.test(x))) metas[f] = templateMeta(await textOf(f));
  return listTemplates(S.files, metas);
}
function rememberTemplate(t) { if (!t?.id) return; const r = [t.id, ...(S.settings.templateRecent || []).filter((x) => x !== t.id)].slice(0, 12); saveSetting({ templateRecent: r }); }
const freeTemplatePath = (name, folder = TEMPLATE_DIR) => { const base0 = templateFileName(name); let p = `${folder}/${base0}.md`, n = 1; while (S.files.includes(p)) p = `${folder}/${base0} ${++n}.md`; return p; };
async function writeTemplate(name, text) { const p = freeTemplatePath(name); await folio.create(p, text); S.expanded.add(TEMPLATE_DIR); await refreshTree(); return p; }
async function newPageFromTemplate(t, name) {
  if (!S.workspace) return chooseFolder();
  const folder = S.active && !S.active.startsWith(TEMPLATE_DIR + '/') ? dirOf(S.active) : '';
  let title = templateFileName(name || t.name), file = (folder ? folder + '/' : '') + title + '.md', n = 1;
  while (S.files.includes(file)) file = (folder ? folder + '/' : '') + `${title} ${++n}.md`;
  title = stem(file);
  const text = filled(await templateText(t), { title }).split(CURSOR).join('');
  const p = await folio.create(file, text); rememberTemplate(t);
  if (folder) S.expanded.add(folder); await refreshTree(); await openFile(p);
}
async function templateGallery(mode = 'insert') {
  if (!S.workspace) return chooseFolder();
  const page = mode === 'insert' && curType() === 'md' && S.active && !S.active.startsWith(TEMPLATE_DIR + '/') ? stem(S.active) : '';
  return openGallery($('#sheet-gallery'), {
    mode: page ? 'insert' : 'new', page, icons,
    items: templateItems,
    community: async () => {
      const url = S.settings.templateGallery;
      try { return { items: communityItems(JSON.parse(await folio.fetchTemplate(url)), url) }; } catch (e) { return { items: null, error: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }; }
    },
    text: templateText,
    preview: async (raw, t) => { const text = filled(raw, { title: page || t.name }).split(CURSOR).join(''); const { body } = splitTemplate(text); return { text, html: render(page ? intoPage(body) : body) }; },
    favs: S.settings.templateFavs || [], recent: S.settings.templateRecent || [],
    setFavs: (ids) => saveSetting({ templateFavs: ids }),
    use: async (t, { as, name }) => { try { if (as === 'here') await applyTemplate(t); else await newPageFromTemplate(t, name); } catch (e) { toast(e.message, { kind: 'error' }); } },
    save: async (t) => {
      try {
        const raw = await templateText(t);
        const p = await writeTemplate(t.name, setMeta(raw, { description: t.desc, category: t.category, icon: t.icon, ...(t.url ? { source: t.url } : {}) }));
        toast(`Saved to ${p}. Edit it there: it is yours now.`); return p;
      } catch (e) { toast(e.message, { kind: 'error' }); return null; }
    },
    edit: (t) => openFile(t.path),
    remove: async (t) => { if (!await confirmSheet({ title: `Delete the template “${t.name}”?`, body: 'It moves to the trash. Pages made from it stay as they are.', action: 'Delete', danger: true })) return false; await folio.trash(t.path); await refreshTree(); return true; },
    rename: async (t) => { const name = await prompt({ title: 'Rename template', label: 'Name', value: t.name, action: 'Rename' }); if (!name || name === t.name) return null; const to = `${dirOf(t.path)}/${templateFileName(name)}.md`; await movePath(t.path, to, false); return to; },
    setCategory: async (t) => {
      const cat = await prompt({ title: 'Category', label: 'Category', value: t.category, hint: 'For example Meetings, Planning, Product, Engineering, Reports, Docs, Personal, or your own.', action: 'Save' });
      if (!cat) return false; const text = await textOf(t.path); await folio.write(t.path, setMeta(text, { category: cat.trim() })); const tab = tabOf(t.path); if (tab) { tab.text = tab.saved = setMeta(text, { category: cat.trim() }); } return true;
    },
    duplicate: async (t) => writeTemplate(`${t.name} copy`, await templateText(t)),
    create: async () => { const p = await writeTemplate('New template', setMeta('# {{title}}\n\n{{cursor}}\n', { description: 'What this template is for', category: 'General' })); await openFile(p); toast('A template is a page: write it as you want new pages to start. {{title}}, {{date}} and {{cursor}} are filled in when it is used.'); },
    saveCurrent: async () => { const tab = activeTab(); const p = await writeTemplate(stem(S.active), setMeta(tab.text, { description: '', category: 'General' })); toast(`Saved as a template: ${p}.`); },
    importFiles: async () => { const list = await folio.importTemplateFiles(); for (const f of list) await writeTemplate(f.name, Object.keys(templateMeta(f.text)).length ? f.text : setMeta(f.text, { category: 'Imported' })); if (list.length) toast(`Imported ${list.length} ${list.length === 1 ? 'template' : 'templates'}.`); return list.length; },
    importLink: async () => {
      const url = await prompt({ title: 'Import a template from a link', label: 'Link to a Markdown file', value: 'https://', hint: 'A raw .md file, for example from GitHub (raw) or a gist.', action: 'Import' });
      if (!url || url === 'https://') return null;
      try { const text = await folio.fetchTemplate(url.trim()); const name = templateMeta(text).name || /^#\s+(.+)$/m.exec(withoutMeta(text))?.[1]?.replace(/\{\{[^}]*\}\}/g, '').trim() || decodeURIComponent(url.split('/').pop().replace(/\.(md|markdown|txt)$/i, '')) || 'Imported template';
        const p = await writeTemplate(name, Object.keys(templateMeta(text)).length ? text : setMeta(text, { category: 'Imported', source: url.trim() })); toast(`Imported ${p}.`); return p; }
      catch (e) { toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { kind: 'error' }); return null; }
    },
    menu: (anchor, items) => popupMenu(anchor, items, { label: 'Template actions' }),
  });
}
async function insertTemplateButton() {
  const t = await pickTemplate({ title: 'Template button', note: 'A button in the page that inserts this template below it, as in Notion.', action: 'Add button' }); if (!t) return;
  const src = buttonSource({ label: `New ${t.name.toLowerCase()}`, template: t.name });
  if (isRich()) rich.insertTemplate(src); else editor.insert(`\n${src}\n`);
}
async function runTemplateButton(b, pos) {
  const t = listTemplates(S.files).find((x) => x.name.toLowerCase() === (b.template || '').toLowerCase());
  if (!t) { toast(`No template called “${b.template}”. Templates are the pages in ${TEMPLATE_DIR}/.`, { kind: 'error' }); return; }
  applyTemplate(t, pos);
}
/* the card shown when you rest the pointer on a link: the start of the target, or the section it points at */
async function previewHtml(name) {
  const { target, part } = parseRef(name);
  const path = resolveTarget(target, S.files, S.active || '');
  if (!path) return null;
  const kind = docKind(path);
  const title = `<p class="rich-hover-title">${esc(stem(path))}${kind === 'page' ? '' : ` <span>${esc(kind)}</span>`}</p>`;
  if (kind !== 'page') return title;
  let text = (await textOf(path)).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const lines = text.split('\n');
  let from = 0, to = lines.length;
  if (part.startsWith('^')) { const i = lines.findIndex((l) => l.trimEnd().endsWith(' ' + part)); if (i >= 0) { from = i; to = i + 1; } }
  else if (part) {
    const i = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#{1,6}\s+/, '').replace(/[*_`]/g, '').trim().toLowerCase() === part.toLowerCase());
    if (i >= 0) { const lvl = lines[i].match(/^#+/)[0].length; from = i; to = lines.findIndex((l, k) => k > i && /^#{1,6}\s/.test(l) && l.match(/^#+/)[0].length <= lvl); if (to < 0) to = lines.length; }
  }
  const snippet = lines.slice(from, Math.min(to, from + 14)).join('\n').slice(0, 700).trim();
  return snippet ? title + render(snippet) : title;
}

/* ============ outline ============ */
let currentHeads = [], outlineFolded = new Set(), outlineFor = null;
function renderOutline() {
  const t = activeTab();
  if (t?.path !== outlineFor) { outlineFolded = new Set(); outlineFor = t?.path; }
  currentHeads = t ? headings(t.text) : [];
  $('#outline-list').innerHTML = currentHeads.length
    ? currentHeads.map((h, i) => {
      const kids = currentHeads[i + 1] && currentHeads[i + 1].level > h.level;
      const hidden = currentHeads.some((p, k) => k < i && outlineFolded.has(k) && p.level < h.level && !currentHeads.slice(k + 1, i).some((q) => q.level <= p.level));
      return `<li${hidden ? ' hidden' : ''}>${kids ? `<button type="button" class="outline-fold" data-fold="${i}" aria-expanded="${!outlineFolded.has(i)}" aria-label="${outlineFolded.has(i) ? 'Show' : 'Hide'} the headings under ${esc(h.text)}">${icons.chevron}</button>` : ''}<a href="#" draggable="true" data-line="${h.line}" data-i="${i}" style="--lvl:${Math.min(h.level, 4)}" title="Drag to move this section. Alt+Shift+arrows to move or change its level">${esc(h.text)}</a></li>`;
    }).join('')
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
  const i = Number(a.dataset.i);
  showMenu(null, [
    { label: 'Promote (one level up)', disabled: h.level <= 1, run: () => shiftSectionAt(i, -1) }, { label: 'Demote (one level down)', disabled: h.level >= 6, run: () => shiftSectionAt(i, 1) },
    { label: 'Move section up', run: () => { let k = i - 1; while (k >= 0 && currentHeads[k].level > h.level) k--; if (k >= 0) moveSectionTo(i, k); } },
    { label: 'Move section to the end', run: () => moveSectionTo(i, -1) },
    '-',
    { label: 'Copy link to this section', run: () => copyRef(S.active, part, 'link') }, { label: 'Copy embed reference', run: () => copyRef(S.active, part, 'embed') }], { x: e.clientX, y: e.clientY });
});
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-bl]'); if (!a) return; e.preventDefault();
  openFile(a.dataset.bl, { line: Number(a.dataset.blLine) });
});
/* sections from the outline: drag a heading to move it with everything under it; promote and demote (Word) */
function moveSectionTo(from, before) {
  if (curType() !== 'md' || from === before) return;
  if (isRich()) { rich.moveSection(from, before); return; }
  const t = activeTab(); const h = currentHeads[from], b = before < 0 ? null : currentHeads[before];
  const next = moveSection(t.text, h.line, b ? b.line : -1); if (next !== t.text) editor.setDoc(next, { keepHistory: true });
}
function shiftSectionAt(i, delta) {
  if (curType() !== 'md') return;
  if (isRich()) { rich.shiftSection(i, delta); return; }
  const t = activeTab(); const next = shiftSection(t.text, currentHeads[i].line, delta); if (next !== t.text) editor.setDoc(next, { keepHistory: true });
}
{
  const list = $('#outline-list'); let dragI = null;
  list.addEventListener('dragstart', (e) => { const a = e.target.closest('a[data-i]'); if (!a || curType() !== 'md') return; dragI = +a.dataset.i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', a.textContent); a.classList.add('is-dragging'); });
  const clear = () => list.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
  list.addEventListener('dragover', (e) => {
    if (dragI == null) return; const a = e.target.closest('a[data-i]'); if (!a) return; e.preventDefault(); clear();
    const r = a.getBoundingClientRect(); a.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
  });
  list.addEventListener('dragleave', (e) => { if (!list.contains(e.relatedTarget)) clear(); });
  list.addEventListener('drop', (e) => {
    const a = e.target.closest('a[data-i]'); if (dragI == null || !a) return; e.preventDefault();
    const i = +a.dataset.i; const after = a.classList.contains('drop-after'); clear();
    // dropping after a heading puts the section after that heading's whole section
    let before = i;
    if (after) { const lvl = currentHeads[i].level; const k = currentHeads.findIndex((h, j) => j > i && h.level <= lvl); before = k < 0 ? -1 : k; }
    moveSectionTo(dragI, before); dragI = null;
  });
  list.addEventListener('dragend', () => { dragI = null; clear(); list.querySelectorAll('.is-dragging').forEach((x) => x.classList.remove('is-dragging')); });
  list.addEventListener('keydown', (e) => {
    const a = e.target.closest('a[data-i]'); if (!a || !e.altKey || !e.shiftKey) return; const i = +a.dataset.i;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); shiftSectionAt(i, e.key === 'ArrowLeft' ? -1 : 1); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault(); const lvl = currentHeads[i].level;
      if (e.key === 'ArrowUp') { let k = i - 1; while (k >= 0 && currentHeads[k].level > lvl) k--; if (k >= 0) moveSectionTo(i, k); }
      else { const n = currentHeads.findIndex((h, j) => j > i && h.level <= lvl); if (n >= 0) { const m = currentHeads.findIndex((h, j) => j > n && h.level <= currentHeads[n].level); moveSectionTo(i, m < 0 ? -1 : m); } }
    }
    setTimeout(() => $(`#outline-list a[data-i="${Math.min(i, currentHeads.length - 1)}"]`)?.focus(), 400);
  });
  list.addEventListener('click', (e) => { const f = e.target.closest('[data-fold]'); if (!f) return; e.preventDefault(); const i = +f.dataset.fold; outlineFolded.has(i) ? outlineFolded.delete(i) : outlineFolded.add(i); renderOutline(); });
}
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
  const st = isRich() ? S.richStats : null; const zoomEl = $('#st-zoom');
  if (st) {
    $('#st-words').textContent = st.selection ? `${fmt.format(st.selection.words)} of ${fmt.format(st.words)} words` : `${fmt.format(st.words)} ${st.words === 1 ? 'word' : 'words'}`;
    $('#st-time').textContent = st.selection ? `${fmt.format(st.selection.chars)} characters selected` : `${fmt.format(st.chars)} characters · ${Math.max(1, Math.round(st.words / 230))} min read`;
    zoomEl.hidden = false; $('#st-zoom-val').textContent = `${Math.round(st.zoom * 100)}%`;
  } else zoomEl.hidden = true;
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
async function newNote(folder = dirOf(S.active || ''), type, fromTemplate = false) {
  if (!S.workspace) return chooseFolder();
  const res = await newDocSheet({ folder, type, fromTemplate });
  if (!res) return;
  const { name } = res; type = res.type;
  const ext = type === 'md' ? '.md' : `.${type}.md`;
  const file = (folder ? folder + '/' : '') + (/\.(md|markdown|mdx|txt)$/i.test(name) ? name : name + ext);
  try {
    const title = stem(file);
    const tpl = type === 'md' && res.template ? res.template : null;
    const content = tpl ? filled(await templateText(tpl), { title }).split(CURSOR).join('') : (NEW_CONTENT[type] || NEW_CONTENT.md)(title);
    const p = await folio.create(file, content);
    if (folder) S.expanded.add(folder);
    await refreshTree(); await openFile(p);
    if (type === 'md' && !isRich()) editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
  } catch (e) { toast(e.message, { kind: 'error' }); }
}
function newDocSheet({ folder, type = 'md', fromTemplate = false }) {
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
        <div class="field new-tpl" style="margin-top:var(--space-sm)"><label for="new-template">Template</label>
          <select class="rb-select" id="new-template"><option value="">Blank page</option>${listTemplates(S.files).map((t, i) => `<option value="${i}">${esc(t.name)}${t.starter ? ' (starter)' : ''}</option>`).join('')}</select></div>
      </div>
      <div class="sheet-foot"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn btn-primary" type="submit">Create</button></div></form>`;
    const input = $('#prompt-input', d);
    const done = (v) => { d.close(); resolve(v); };
    d.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v || /[\\:*?"<>|]/.test(v)) { $('#prompt-help', d).textContent = 'Use a name without \\ : * ? " < > |'; $('#prompt-help', d).dataset.error = 'true'; input.focus(); return; }
      const tv = $('#new-template', d).value;
      done({ name: v, type: d.querySelector('input[name=type]:checked').value, template: tv === '' ? null : listTemplates(S.files)[+tv] });
    };
    d.querySelector('[data-cancel]').onclick = () => done(null);
    d.oncancel = () => resolve(null);
    const tplField = $('.new-tpl', d), syncTpl = () => { tplField.hidden = d.querySelector('input[name=type]:checked').value !== 'md'; };
    d.querySelectorAll('input[name=type]').forEach((r) => r.addEventListener('change', syncTpl)); syncTpl();
    if (fromTemplate) { const sel = $('#new-template', d); sel.selectedIndex = Math.min(1, sel.options.length - 1); }
    d.showModal(); input.select();
  });
}
async function newFolder(parent = '') {
  const name = await prompt({ title: 'New folder', label: 'Name', value: '', action: 'Create' });
  if (!name) return;
  try { const p = (parent ? parent + '/' : '') + name; await folio.mkdir(p); S.expanded.add(p); await refreshTree(); } catch (e) { toast(e.message, { kind: 'error' }); }
}
async function renamePath(p, isDir) {
  const name = await prompt({ title: isDir ? 'Rename folder' : 'Rename note', label: 'Name', value: isDir ? base(p) : stem(p), action: 'Rename' });
  if (!name) return;
  const ext = isDir ? '' : (p.match(/(\.(slides|board|sheet))?\.\w+$/i)?.[0] || '.md');
  const to = (dirOf(p) ? dirOf(p) + '/' : '') + name + (isDir || /\.\w+$/.test(name) ? '' : ext);
  if (to === p) return;
  await movePath(p, to, isDir);
}
async function movePath(from, to, isDir) {
  try {
    const r = await folio.rename(from, to);
    retargetTabs(from, to);
    const n = r?.changed?.length || 0;
    if (n) toast(`Updated links in ${n} ${n === 1 ? 'document' : 'documents'}.`);
    await refreshTree();
  } catch (e) { toast(e.message, { kind: 'error' }); }
}
function retargetTabs(from, to) {
  for (const t of S.tabs) {
    if (t.path === from || t.path.startsWith(from + '/')) {
      const np = to + t.path.slice(from.length);
      if (S.active === t.path) S.active = np;
      t.path = np;
    }
  }
  renderTabs(); renderStatus(); persistTabs();
}
async function trashPath(p, isDir) {
  const ok = await confirmSheet({ title: `Move “${isDir ? base(p) : stem(p)}” to the Trash?`, body: 'You can restore it from the system Trash.', action: 'Move to Trash', danger: true });
  if (!ok) return;
  try {
    await folio.trash(p);
    for (const t of [...S.tabs]) if (t.path === p || t.path.startsWith(p + '/')) { t.saved = t.text; await closeTab(t.path); }
    await refreshTree();
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
  const tagQ = /^(?:#|tag:#?)([\p{L}\p{N}_\-/]+)$/u.exec(q.trim());
  if (tagQ) {
    const want = tagQ[1].toLowerCase(); const all = await tagIndex();
    const files = [...new Set(all.filter((t) => t.tag.toLowerCase() === want || t.tag.toLowerCase().startsWith(want + '/')).flatMap((t) => t.files))].sort((a, b) => stem(a).localeCompare(stem(b)));
    $('#results-head').textContent = files.length ? `${files.length} ${files.length === 1 ? 'page' : 'pages'} tagged #${tagQ[1]}` : `No page is tagged #${tagQ[1]}`;
    $('#results').innerHTML = files.map((f) => `<button class="result" type="button" data-file="${esc(f)}" data-line="1"><span class="result-name">${esc(stem(f))}</span>${dirOf(f) ? `<span class="result-folder">${esc(dirOf(f))}</span>` : ''}</button>`).join('');
    return;
  }
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
        <div class="row"><div class="row-main"><span class="row-title">Smart quotes and dashes</span><span class="row-sub">Typing " -- ... becomes “ – … in the Write view</span></div><label class="switch"><input type="checkbox" role="switch" data-setting="smartTypography" ${s.smartTypography !== false ? 'checked' : ''} aria-label="Smart quotes and dashes"></label></div>
      </div></section>
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
}

/* ============ palette ============ */
const COMMANDS = [
  { id: 'new-note', title: 'New note', key: 'Mod+N', run: () => newNote() },
  { id: 'new-from-template', title: 'New page from a template…', run: () => templateGallery('new') },
  { id: 'template-gallery', title: 'Templates: browse the gallery', run: () => templateGallery('insert') },
  { id: 'save-as-template', title: 'Save this page as a template', run: () => (curType() === 'md' && S.active ? writeTemplate(stem(S.active), setMeta(activeTab().text, { description: '', category: 'General' })).then((p) => toast(`Saved as a template: ${p}.`)) : toast('Open a page first.')) },
  { id: 'comment', title: 'Comment on the selection', key: 'Mod+Alt+M', run: () => rich.run('comment') },
  { id: 'suggest-mode', title: 'Suggesting: on or off (track changes)', run: () => rich.run('suggest') },
  { id: 'review-pane', title: 'Show or hide comments and suggestions', run: () => rich.run('reviewPane') },
  { id: 'accept-all', title: 'Accept all suggestions', run: () => rich.run('acceptAll') },
  { id: 'reject-all', title: 'Reject all suggestions', run: () => rich.run('rejectAll') },
  { id: 'insert-template', title: 'Insert template…', key: 'Mod+Alt+T', run: () => insertTemplateCmd() },
  { id: 'template-button', title: 'Insert template button', run: () => insertTemplateButton() },
  { id: 'daily-note', title: 'Open today’s daily note', key: 'Mod+Alt+D', run: () => (S.workspace ? openDailyNote(todayKey()) : chooseFolder()) },

  { id: 'new-folder', title: 'New folder', run: () => newFolder(dirOf(S.active || '')) },
  { id: 'open-folder', title: 'Open folder…', key: 'Mod+O', run: chooseFolder },
  { id: 'quick-open', title: 'Go to note…', key: 'Mod+P', run: () => openPalette('files') },
  { id: 'search', title: 'Search all notes', key: 'Mod+Shift+F', run: focusSearch },
  { id: 'find', title: 'Find in note', key: 'Mod+F', run: () => (isRich() && curType() === 'md' ? rich.find(false) : editor.run('find')) },
  { id: 'replace', title: 'Find and replace in note', key: 'Mod+H', run: () => (isRich() && curType() === 'md' ? rich.find(true) : editor.run('find')) },
  { id: 'word-count', title: 'Word count', key: 'Mod+Shift+C', run: () => (isRich() ? rich.run('counts') : toast(`${$('#st-words').textContent}`)) },
  { id: 'ribbon-full', title: 'Ribbon: show the full ribbon (tabs like Word)', run: () => rich.setRibbonMode('full') },
  { id: 'ribbon-compact', title: 'Ribbon: show the simplified ribbon', run: () => rich.setRibbonMode('compact') },
  { id: 'format-painter', title: 'Format painter', key: 'Mod+Alt+C', run: () => rich.run('painter') },
  { id: 'typewriter', title: 'Typewriter scrolling', run: () => rich.run('typewriter') },
  { id: 'page-zoom-in', title: 'Page zoom in', run: () => rich.zoom(1) },
  { id: 'page-zoom-out', title: 'Page zoom out', run: () => rich.zoom(-1) },
  { id: 'page-zoom-reset', title: 'Page zoom 100%', run: () => rich.zoom(0) },
  { id: 'mode-edit', title: 'View: write or visual', key: 'Mod+1', run: () => setView(viewsFor(curType())[0][0]) },
  { id: 'mode-split', title: 'View: split', key: 'Mod+2', run: () => setView('split') },
  { id: 'mode-preview', title: 'View: read or code', key: 'Mod+3', run: () => setView(viewsFor(curType())[2][0]) },
  { id: 'toggle-sidebar', title: 'Toggle sidebar', key: 'Mod+\\', run: toggleSidebar },
  { id: 'toggle-outline', title: 'Toggle outline', key: 'Mod+Shift+O', run: toggleOutline },
  { id: 'focus', title: 'Focus mode', key: 'Mod+.', run: toggleFocus },
  { id: 'ai', title: 'Connect AI assistants…', key: 'Mod+Shift+A', run: openAiSheet },
  { id: 'history', title: 'Version history', key: 'Mod+Alt+Shift+H', run: () => openHistory() },
  { id: 'name-version', title: 'Name the current version…', key: 'Mod+Alt+Shift+S', run: () => nameCurrentVersion() },
  { id: 'export', title: 'Export…', key: 'Mod+Shift+E', run: () => openExport() },
  { id: 'export-docx', title: 'Export as Word…', run: () => exportAs('docx') },
  { id: 'import-document', title: 'Import Word or HTML as a page…', run: () => importDocument() },
  { id: 'paste-plain', title: 'Paste as plain text', key: 'Mod+Shift+V', run: () => pastePlain() },
  { id: 'export-html', title: 'Export as HTML…', run: () => exportAs('html') },
  { id: 'export-md', title: 'Export as portable Markdown…', run: () => exportAs('md') },
  { id: 'export-pptx', title: 'Export slides as PowerPoint…', run: () => (curType() === 'slides' ? exportAs('pptx') : toast('Open a slides document first.')) },
  { id: 'present', title: 'Present slides', key: 'Mod+Enter', run: () => (curType() === 'slides' ? curSurface().present() : toast('Open a slides document to present it.')) },
  { id: 'new-slides', title: 'New slides…', run: () => newNote(undefined, 'slides') },
  { id: 'export-pdf', title: 'Export as PDF…', run: () => exportAs('pdf') },
  { id: 'reveal', title: S.platform === 'darwin' ? 'Reveal in Finder' : 'Show in folder', run: () => folio.reveal(S.active || '') },
  { id: 'rename', title: 'Rename note…', run: () => S.active && renamePath(S.active, false) },
  { id: 'trash', title: 'Move note to Trash', run: () => S.active && trashPath(S.active, false) },
  { id: 'settings', title: 'Settings…', key: 'Mod+,', run: openSettings },
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
  { id: 'superscript', title: 'Format: superscript', key: 'Mod+Shift+.', run: () => pageFmt('superscript', '<sup>', '</sup>') },
  { id: 'subscript', title: 'Format: subscript', key: 'Mod+Shift+,', run: () => pageFmt('subscript', '<sub>', '</sub>') },
  { id: 'math', title: 'Insert maths (inline)', key: 'Mod+Shift+M', run: () => pageFmt('inlineMath', '$', '$') },
  { id: 'math-block', title: 'Insert maths block', run: () => (isRich() ? rich.run('blockMath') : editor.insert('\n$$\n\n$$\n')) },
  { id: 'footnote', title: 'Insert footnote', key: 'Mod+Alt+F', run: () => (isRich() ? rich.run('footnote') : editor.insert('[^1]')) },
  { id: 'hidden-comment', title: 'Format: hidden comment', run: () => pageFmt('hiddenComment', '%%', '%%') },
  { id: 'colour', title: 'Format: text colour…', run: () => (isRich() ? rich.run('colour') : pageFmt(null, '[', ']{color=red}')) },
  { id: 'align-left', title: 'Align left', key: 'Mod+Shift+L', run: () => isRich() && rich.run('alignLeft') },
  { id: 'align-center', title: 'Centre', key: 'Mod+Alt+E', run: () => isRich() && rich.run('alignCenter') },
  { id: 'align-right', title: 'Align right', key: 'Mod+Shift+R', run: () => isRich() && rich.run('alignRight') },
  { id: 'align-justify', title: 'Justify', key: 'Mod+Shift+J', run: () => isRich() && rich.run('alignJustify') },
  { id: 'close-folder', title: 'Close folder', run: async () => { for (const t of S.tabs) await saveTab(t); await folio.closeWorkspace(); S.settings.workspace = null; showWelcome(); } },
];
/* everything the / menu offers is in the palette too (the Write view inserts it, the source view types its Markdown) */
for (const it of INSERTS) {
  const title = `${it.turn ? 'Turn into' : 'Insert'}: ${it.label}`;
  if (COMMANDS.some((c) => c.title.toLowerCase().replace(/…$/, '') === title.toLowerCase())) continue;
  COMMANDS.push({ id: 'ins-' + it.id, title, key: it.key, run: () => {
    if (curType() !== 'md') return toast('This inserts into pages.');
    if (isRich()) return rich.insert(it.id);
    if (it.md != null) return insertMd(it.md);
    toast('Switch to the Write view to insert this.');
  } });
}
function fmt(id, n) {
  if (isRich()) { if (id === 'heading') return rich.editor.chain().focus().toggleHeading({ level: n }).run(); return rich.run(id); }
  if (id === 'heading') return editor.run('heading', n);
  return editor.run(id);
}
/* page formatting from the palette: the Write view runs the command, the source view wraps the selection */
function pageFmt(id, before, after) {
  if (isRich() && id) return rich.run(id);
  if (!isRich() && editor.wrap) return editor.wrap(before, after);
  return insertMd(before + after);
}
function insertMd(md) {
  if (isRich()) { rich.editor.chain().focus().insertContent(md, { contentType: 'markdown' }).run(); return; }
  editor.insert(md);
}
let pal = { mode: 'commands', items: [], sel: 0, opener: null };
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
const EXPORT_KEY = 'folio.export';
const exportPrefs = () => { try { return { format: 'pdf', size: 'A4', landscape: false, margins: 'normal', pageNumbers: true, header: false, review: 'keep', ...JSON.parse(localStorage.getItem(EXPORT_KEY) || '{}') }; } catch { return { format: 'pdf', size: 'A4', landscape: false, margins: 'normal', pageNumbers: true, header: false, review: 'keep' }; } };
function openExport() {
  const t = activeTab(); if (!t) return toast('Open a note to export it.');
  if (curType() !== 'md') return exportAs('pdf');
  const p = exportPrefs(); const d = $('#sheet-prompt');
  const seg = (name, opts, cur) => `<div class="segmented" role="radiogroup" aria-label="${name}">${opts.map(([v, l]) => `<button type="button" role="radio" data-${name}="${v}" aria-checked="${String(cur) === String(v)}">${l}</button>`).join('')}</div>`;
  d.classList.remove('sheet-small');
  d.innerHTML = `<form method="dialog">
    <div class="sheet-head"><div><h2 id="prompt-title">Export “${esc(stem(t.path))}”</h2><p>Choose a format and how the pages look.</p></div><button class="icon-btn" type="button" data-cancel aria-label="Close">${icons.close}</button></div>
    <div class="sheet-body">
      <section class="group"><h3>Format</h3><div class="rows"><div class="row"><div class="row-main"><span class="row-title">File type</span></div>${seg('format', [['pdf', 'PDF'], ['docx', 'Word'], ['html', 'HTML'], ['md', 'Markdown']], p.format)}</div></div></section>
      <section class="group" data-pages><h3>Pages</h3><div class="rows">
        <div class="row"><div class="row-main"><span class="row-title">Paper</span></div>${seg('size', [['A4', 'A4'], ['Letter', 'Letter'], ['A5', 'A5'], ['Legal', 'Legal']], p.size)}</div>
        <div class="row"><div class="row-main"><span class="row-title">Orientation</span></div>${seg('landscape', [['false', 'Portrait'], ['true', 'Landscape']], p.landscape)}</div>
        <div class="row"><div class="row-main"><span class="row-title">Margins</span></div>${seg('margins', [['normal', 'Normal'], ['narrow', 'Narrow'], ['wide', 'Wide']], p.margins)}</div>
        <div class="row"><div class="row-main"><span class="row-title">Page numbers</span></div><label class="switch"><input type="checkbox" role="switch" name="pageNumbers" ${p.pageNumbers ? 'checked' : ''} aria-label="Page numbers"></label></div>
        <div class="row"><div class="row-main"><span class="row-title">Title in the header</span></div><label class="switch"><input type="checkbox" role="switch" name="header" ${p.header ? 'checked' : ''} aria-label="Title in the header"></label></div>
      </div></section>
      <section class="group" data-review><h3>Suggestions and comments</h3><div class="rows"><div class="row"><div class="row-main"><span class="row-title">In the file</span><span class="row-sub" data-review-sub></span></div>${seg('review', [['keep', 'Keep'], ['clean', 'Final text only']], p.review)}</div></div></section>
    </div>
    <div class="sheet-foot"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn btn-primary" type="submit">Export</button></div></form>`;
  const sync = () => {
    d.querySelector('[data-pages]').hidden = !/^(pdf|docx)$/.test(p.format);
    d.querySelector('[data-review]').hidden = !/^(pdf|docx|html)$/.test(p.format) || !/\{(\+\+|--|~~|==|>>)/.test(t.text);
    d.querySelector('[data-review-sub]').textContent = p.format === 'docx' ? 'Word shows them as tracked changes and comments' : 'Clean removes comments and accepts every suggestion';
    for (const b of d.querySelectorAll('[role=radio]')) { const k = Object.keys(b.dataset)[0]; b.setAttribute('aria-checked', String(String(p[k]) === b.dataset[k])); }
  };
  d.onclick = (e) => {
    if (e.target.closest('[data-cancel]')) return d.close();
    const b = e.target.closest('[role=radio]'); if (!b) return;
    const k = Object.keys(b.dataset)[0]; p[k] = k === 'landscape' ? b.dataset[k] === 'true' : b.dataset[k]; sync();
  };
  d.onchange = (e) => { if (e.target.name) { p[e.target.name] = e.target.checked; } };
  d.onsubmit = (e) => { e.preventDefault(); try { localStorage.setItem(EXPORT_KEY, JSON.stringify(p)); } catch {} d.close(); exportAs(p.format, p); };
  sync(); d.showModal(); d.querySelector('button[type=submit]').focus();
}
const exportText = (t, o) => (o?.review === 'clean' ? cleanCm(t.text) : t.text);
async function importDocument() {
  try {
    const r = await folio.importDocument(); if (!r) return;
    const { markdown, images } = htmlToMarkdown(r.html, { source: 'web' });
    const rel = `${r.name}.md`; let md = markdown;
    const target = await folio.create(rel, `# ${r.name}\n\n`).catch(() => null);
    if (!target) return toast('Could not create the page.', { kind: 'error' });
    for (const src of images) { try { const m = /^data:image\/([\w+.-]+);base64,(.*)$/s.exec(src); if (!m) continue; const bin = atob(m[2]); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); const saved = await folio.saveImage(target, `image.${m[1].replace('jpeg', 'jpg').replace(/\+.*/, '')}`, bytes); md = md.split(src).join(encodeURI(saved)); } catch {} }
    md = md.replace(/^# .*\n+/, (h) => h); // keep the document's own title if it has one
    const body = /^#\s/.test(md) ? md : `# ${r.name}\n\n${md}`;
    await folio.write(target, body + '\n');
    await refreshTree(); openFile(target);
    toast(r.messages?.length ? `Imported ${r.name}. Some Word formatting could not be kept.` : `Imported ${r.name}.`);
  } catch (e) { toast(`Import failed. ${e.message}`, { kind: 'error' }); }
}
async function pastePlain() {
  if (!isRich() || curType() !== 'md') return document.execCommand?.('paste');
  const c = await folio.readClipboard(); rich.insertPlain(c.text || '');
}
const dataUrlImage = (url) => new Promise((res) => { const i = new Image(); i.onload = () => res({ width: i.naturalWidth, height: i.naturalHeight }); i.onerror = () => res({ width: 0, height: 0 }); i.src = url; });
function bytesOf(url) { const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url); if (!m) return null; const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]); const b = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) b[i] = raw.charCodeAt(i); return { data: b, mime: m[1] }; }
async function exportWord(t, o) {
  const [{ toDocx }, { render: renderMd }] = [await import('./page-docx.js'), { render }];
  const text = exportText(t, o); const props = Object.fromEntries(parseProps(text).props.map((q) => [q.key, q.value]));
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-9999px;top:0;width:720px'; host.innerHTML = renderMd(text); document.body.appendChild(host);
  try {
    await renderMermaid(host, false); await hydrateCharts(host, readRelative);
    const bytes = await toDocx(host, {
      title: props.title || stem(t.path), author: S.settings.authorName || S.userName || 'Folio', props, page: o, reviewMarks: o?.review !== 'clean',
      async loadImage(src) {
        if (!src) return null; const url = await folio.dataUrl(src, t.path); const b = bytesOf(url); if (!b) return null;
        const type = /svg/.test(b.mime) ? null : b.mime.split('/')[1].replace('jpeg', 'jpg'); if (!/^(png|jpg|gif|bmp)$/.test(type || '')) return rasterUrl(url);
        return { data: b.data, type, ...(await dataUrlImage(url)) };
      },
      async rasterize(el) { const svg = el.querySelector('svg'); if (!svg) return null; const xml = new XMLSerializer().serializeToString(svg); const box = svg.getBoundingClientRect(); return rasterUrl('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml), box.width, box.height); },
    });
    const out = await folio.exportBinary(t.path, 'docx', bytes); if (out) toast(`Exported to ${base(out)}.`);
  } finally { host.remove(); }
}
async function rasterUrl(url, w, h) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const W = Math.round(w || img.naturalWidth || 600), H = Math.round(h || img.naturalHeight || 400); const c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  const b = bytesOf(c.toDataURL('image/png')); return { data: b.data, type: 'png', width: W, height: H };
}
async function exportAs(kind, o = null) {
  const t = activeTab(); if (!t) return toast('Open a note to export it.');
  if (!o && curType() === 'md' && (kind === 'pdf' || kind === 'docx')) o = exportPrefs();
  if (kind === 'docx') { if (curType() !== 'md') return toast('Word export is for pages.'); try { return await exportWord(t, o); } catch (e) { return toast(`Export failed. ${e.message}`, { kind: 'error' }); } }
  const s = curSurface();
  if (kind === 'md') {
    if (curType() !== 'md') return toast('Portable Markdown export is for pages.');
    try { const out = await folio.exportBinary(t.path, 'md', new TextEncoder().encode(portableMarkdown(t.text))); if (out) toast(`Exported to ${base(out)}. Folio colour and alignment were removed.`); }
    catch (e) { toast(`Export failed. ${e.message}`, { kind: 'error' }); }
    return;
  }
  if (s) { if (kind === 'pdf' && s.exportPdf) return s.exportPdf(); if (kind === 'pptx' && s.exportPptx) return s.exportPptx(); if (kind === 'html') return toast('HTML export is for pages. Use PDF for this document.'); }
  const prose = stylesCss.slice(stylesCss.indexOf('/* ---------- preview prose')).split('/* ---------- palette')[0];
  const css = tokensCss + '\nbody{margin:0;font-family:var(--font-sans);color:var(--color-ink);background:var(--color-paper);-webkit-print-color-adjust:exact}' + prose + '\n.copy-code{display:none}.prose{padding:48px 24px}@media print{.prose{padding:0}}';
  const page = o && curType() === 'md' ? pageCss(o) : '';
  const html = exportDocument(stem(t.path), o ? render(exportText(t, o)) : (!isRich() && $('#preview').innerHTML) || render(t.text), css + page);
  try { const out = kind === 'pdf' ? await folio.exportPdf(t.path, html, o && curType() === 'md' ? { print: pdfOptions(o, stem(t.path)) } : undefined) : await folio.exportHtml(t.path, html); if (out) toast(`Exported to ${base(out)}.`); }
  catch (e) { toast(`Export failed. ${e.message}`, { kind: 'error' }); }
}

/* ============ toggles ============ */
function toggleSidebar() { const open = app.dataset.sidebar !== 'open'; app.dataset.sidebar = open ? 'open' : 'closed'; saveSetting({ sidebar: open }); }
function toggleOutline() { const open = app.dataset.outline !== 'open'; app.dataset.outline = open ? 'open' : 'closed'; $('#btn-outline').setAttribute('aria-pressed', String(open)); layoutPanes(); saveSetting({ showOutline: open }); rich?.sync?.(); }
function toggleFocus() { app.classList.toggle('focus'); layoutPanes(); rich?.sync?.(); if (app.classList.contains('focus') && app.dataset.modeView === 'split') setView('edit', { persist: false }); }
function focusSearch() { if (app.dataset.sidebar !== 'open') toggleSidebar(); $('#sidebar-search').focus(); $('#sidebar-search').select(); }

/* ============ version history ============ */
let hist;
function initHistory() {
  hist = mountHistory($('#history'), {
    folio, icons,
    getPath: () => S.active, getText: () => activeTab()?.text ?? '',
    setText: async (text) => { setActiveText(text); await saveActive(); renderStatus(); previewSoon(); },
    isPage: () => curType() === 'md', renderMd: (t) => render(t),
    toast, ask: prompt, confirm: confirmSheet, menu: (el, items) => showMenu(el, items),
    copyAs: async (path, text, v) => {
      const dot = path.lastIndexOf('.'); const when = new Date(v.t).toISOString().slice(0, 16).replace('T', ' ');
      let target = `${path.slice(0, dot)} (${v.name || when})${path.slice(dot)}`;
      try { const p = await folio.create(target, text); await refreshTree(); hist.close(); openFile(p); toast('Made a copy from that version.'); }
      catch (e) { toast(`Could not make a copy. ${e.message}`, { kind: 'error' }); }
    },
    opened: async (p) => { await refreshTree(); openFile(p); },
    onClose: () => { $('#workspace').removeAttribute('data-history'); },
  });
}
async function openHistory() {
  if (!S.active) return toast('Open a document first.');
  if (hist.isOpen()) return hist.close();
  await saveActive(); $('#workspace').dataset.history = 'true'; await hist.open();
}
async function nameCurrentVersion() {
  const t = activeTab(); if (!t) return;
  const name = await prompt({ title: 'Name this version', label: 'Name', hint: 'Named versions are kept for good.', action: 'Save' }); if (!name) return;
  await saveActive();
  const v = await folio.historySnapshot(t.path, t.text, 'named', true);
  const list = await folio.historyList(t.path); const id = v?.id || list[0]?.id;
  if (id) { await folio.historyName(t.path, id, name); toast(`Saved the version “${name}”.`); }
}

/* ============ small UI kit: toast, prompt, confirm, menu, tooltip ============ */
function toast(text, { kind = 'info', action } = {}) {
  const el = document.createElement('div');
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
  $('#btn-outline').onclick = toggleOutline;
  $('#tags-head').addEventListener('click', () => { saveSetting({ showTags: !tagsOpen() }); renderTags(); });
  $('#tags-list').addEventListener('click', (e) => { const b = e.target.closest('[data-tag]'); if (b) showTag(b.dataset.tag); });
  $('#tags-list').addEventListener('contextmenu', (e) => {
    const b = e.target.closest('[data-tag]'); if (!b) return; e.preventDefault(); const tag = b.dataset.tag;
    showMenu(null, [{ label: `Show pages tagged #${tag}`, run: () => showTag(tag) }, { label: 'Rename tag…', run: () => renameTagEverywhere(tag) }, { label: 'Copy tag', run: () => { folio.copy('#' + tag); toast(`Copied #${tag}`); } }], { x: e.clientX, y: e.clientY });
  });
  $('#st-zoom').addEventListener('click', (e) => { const b = e.target.closest('[data-zoom]'); if (b && isRich()) rich.zoom(+b.dataset.zoom); });
  $('#st-words').addEventListener('click', () => { if (isRich() && curType() === 'md') rich.run('counts', $('#st-words')); });
  $('#ai-status').onclick = openAiSheet;
  $('#view-switch').onclick = (e) => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); };
  $('#view-switch').onkeydown = (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const views = viewsFor(curType()).map(([id]) => id); const i = views.indexOf(app.dataset.modeView);
    const v = views[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3]; setView(v); $(`#view-switch [data-view="${v}"]`).focus();
  };
  $('#btn-more').onclick = (e) => showMenu(e.currentTarget, [
    { label: 'Version history', key: 'Mod+Alt+Shift+H', run: () => openHistory() },
    { label: 'Export…', key: 'Mod+Shift+E', run: openExport },
    { label: 'Import Word or HTML…', run: importDocument }, '-',
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
    const tg = e.target.closest('.md-tag'); if (tg) { showTag(tg.textContent.replace(/^#/, '')); return; }
    const tb = e.target.closest('.template-button button');
    if (tb) {
      const box = tb.closest('[data-line]'); const b = JSON.parse(decodeURIComponent(box.dataset.spec));
      const t = listTemplates(S.files).find((x) => x.name.toLowerCase() === (b.template || '').toLowerCase());
      if (!t) { toast(`No template called “${b.template}”.`, { kind: 'error' }); return; }
      const text0 = filled(await templateText(t), { title: stem(S.active) }).split(CURSOR).join('');
      const { fm, body } = splitTemplate(text0); const tab = activeTab(); let text = tab.text;
      const lines = text.split('\n'); const at = b.where === 'above' ? Number(box.dataset.line) : Number(box.dataset.lineEnd);
      lines.splice(at, 0, ...(b.where === 'above' ? [intoPage(body).trimEnd(), ''] : ['', intoPage(body).trimEnd()]));
      text = lines.join('\n');
      if (fm) { const cur = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)?.[0] || ''; text = mergeProps(cur, fm) + text.slice(cur.length); }
      editor.applyRemote(text); tab.text = text; if (isRich()) rich.setMarkdown(text); renderPreview(); autosave(); return;
    }
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
    else if (href) openMedia(href);
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
    tagsStale();
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
addEventListener('error', (e) => { window.__folioErrors.push(String(e.message)); console.error('[folio-error]', e.message, e.error?.stack || ''); });
addEventListener('unhandledrejection', (e) => { window.__folioErrors.push(String(e.reason?.message || e.reason)); console.error('[folio-error]', e.reason?.message || e.reason); });
boot().catch((e) => { document.body.insertAdjacentHTML('beforeend', `<div class="toasts"><div class="toast" data-kind="error" role="alert"><p>Folio could not start. ${esc(e.message)}</p></div></div>`); console.error(e); });
