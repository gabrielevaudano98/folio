// Folio — renderer.
import { diffLines } from 'diff';
import { createEditor } from './editor.js';
import { EditorView } from '@codemirror/view';
import { undo as cmUndo, redo as cmRedo, undoDepth, redoDepth } from '@codemirror/commands';
import { createActionLog } from './history.js';
import { createRich } from './rich.js';
import { fuzzy, highlight } from './fuzzy.js';
import { INSERTS } from './inserts.js';
import { portableMarkdown } from './page-syntax.js';
import { NEW_DECK, renderSlide, parseFrontmatter } from './slides-core.js';
import { hydrateRefs, resolveRef } from './refs.js';
import { parseRef, resolveTarget, docKind, findMentions, linkMention, linkAllMentions } from './refs-syntax.js';
import { openDatePicker } from './page-date-ui.js';
import { whenLabel } from './page-when.js';
import { DATE_STYLES, formatDay, datePrefs } from './page-dates.js';
import { extractTags, blockIds, linkKind, longDay, DAY, JOURNAL, statusOptions } from './page-mentions.js';
import { moveSection, shiftSection } from './page-outline.js';
import { docInfo, infoRows } from './page-info.js';
import { t as tr, setLocale, locale, applyStatic, LOCALES, tl } from './i18n.js';
import { helpSections } from './page-help.js';
import { renameTag, setTypeOverrides } from './page-props.js';
import { listTemplates, fillTemplate, askVars, splitTemplate, intoPage, mergeProps, buttonSource, TEMPLATE_DIR, DAILY, CURSOR, STARTERS, templateMeta, withoutMeta, setMeta, communityItems, templateFileName } from './page-templates.js';
import { openGallery } from './template-gallery.js';
import { popupMenu } from './page-table.js';
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
// the visual editors are loaded the first time a document of their type is opened, so startup parses only what pages need
const SURFACES = { slides: () => import('./slides.js').then((m) => m.mountSlides), board: () => import('./board.js').then((m) => m.mountBoard), sheet: () => import('./sheet.js').then((m) => m.mountSheet) };
const surfaceMods = {};
const loadSurface = (type) => (surfaceMods[type] ||= SURFACES[type]().then((mount) => { surfaceMods[type].mount = mount; return mount; }, (e) => { delete surfaceMods[type]; throw e; }));
const NEW_BOARD = (t) => `# ${t}\n\nA board in board-md. Shapes: \`id: shape "Label" @x,y\`. Connectors: \`a -> b "label"\`.\n\n\`\`\`board\nstart: terminator "Start" @40,60\nidea: rect "Write the idea" @230,55\nok: diamond "Clear?" @430,45\ndone: terminator "Share" @620,60\nnote: note "Double-click to edit, drag from the dots to connect" @220,190 200x80\n\nstart -> idea\nidea -> ok\nok -> done "yes"\nok.bottom -> idea.bottom "no" {route: orthogonal}\n\`\`\`\n`;
const NEW_SHEET = (t) => `# ${t}\n\n## Sheet1\n\n| Item | Quantity | Price | Total |\n| --- | --- | --- | --- |\n| Notebooks | 4 | 3.5 | =B2*C2 |\n| Pens | 12 | 1.2 | =B3*C3 |\n| Folders | 6 | 2.1 | =B4*C4 |\n| Total |  |  | =SUM(D2:D4) |\n\n<!-- sheet: {"cols":{"C":{"format":"currency"},"D":{"format":"currency"}}} -->\n`;
const NEW_CONTENT = { md: (t) => `# ${t}\n\n`, slides: () => NEW_DECK, board: NEW_BOARD, sheet: NEW_SHEET };
const TYPE_INFO = { md: 1, slides: 1, board: 1, sheet: 1 }; // names and descriptions: app.type-<id> and app.typedesc-<id>
function docTypeAny(p) { const m = p?.match(/\.(slides|board|sheet)\.md$/i); return m ? m[1].toLowerCase() : 'md'; }
function docType(p) { const m = p?.match(/\.(slides|board|sheet)\.md$/i); const t = m ? m[1].toLowerCase() : 'md'; return SURFACES[t] ? t : 'md'; }
const typeIcon = (t) => ({ slides: icons.slides, board: icons.board, sheet: icons.sheet }[t] || icons.doc);
function viewsFor(type) {
  if (type === 'md') return [['edit', tr('ui.write'), icons.viewWrite, 'Mod+1'], ['split', tr('ui.split'), icons.viewSplit, 'Mod+2'], ['preview', tr('ui.read'), icons.viewRead, 'Mod+3']];
  return [['visual', tr(`app.type-${type}`), typeIcon(type), 'Mod+1'], ['split', tr('app.view-code-and-visual'), icons.viewSplit, 'Mod+2'], ['code', tr('app.view-code'), icons.source, 'Mod+3']];
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
    templateGallery: slideTemplateGallery, ensureTemplate, saveTemplate,
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
  { const before = locale(); setLocale(init.settings.language); if (locale() !== before) { location.reload(); return; } } // menus and tables are built at load: start again in the new language
  localizeCommands();
  S.platform = init.platform; S.settings = init.settings; datePrefs.style = init.settings.dateStyle || 'relative'; datePrefs.lang = locale(); S.mcp = init.mcp; S.version = init.version;
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
    resolveImage: (src) => resolveImg(src),
  });
  editor.setSpellcheck(S.settings.spellcheck);

  rich = createRich($('#pane-rich'), {
    keyLabel,
    onCopyCode: (text) => { folio.copy(text); toast(tr('app.copied')); },
    onUnlock: () => setPageLock(S.active, false),
    reviewDock: $('#dock-review'),
    onReviewCount: (n) => { const b = $('#dock-badge'); b.textContent = String(n); b.hidden = !n; },
    onChange: (md) => onEditorChange(md, false, 'rich'),
    resolveImage: resolveImg,
    onRemoteBlocked: (n) => { remoteBlockedCount = n; renderRemoteNotice(); },
    onPickImage: async () => { const t = activeTab(); if (!t) return null; try { return await folio.pickImage(t.path); } catch (e) { toast(e.message, { kind: 'error' }); return null; } },
    readNote: (src) => readRelative(src),
    isDark: () => S.dark,
    onWikiLink: async (name) => { if (DAY.test(parseRef(name).target) && !resolveWiki(name)) return openDailyNote(parseRef(name).target); const f = resolveWiki(name); if (f) return openRef(f, parseRef(name).part); if (await confirmSheet({ title: tr('app.create-name', { name }), body: tr('app.this-note-does-not-exist-yet'), action: tr('app.create-note') })) { const p = await folio.create(name + '.md', `# ${name}\n\n`); await refreshTree(); openFile(p); } },
    resolveValue: (raw) => resolveRef(raw, refEnv()).then((r) => r.value),
    smartTypography: () => S.settings.smartTypography !== false,
    pickRef: (o) => pickRef(o),
    breadcrumb: () => breadcrumbHtml(S.active),
    pickMedia: (kind) => folio.pickMedia(S.active, kind).catch((e) => { toast(e.message, { kind: 'error' }); return null; }),
    askUrl: (title) => prompt({ title, label: tr('app.address'), placeholder: tr('app.https'), action: tr('app.insert') }).then((u) => { u = (u || '').trim(); if (!u) return null; return /^[a-z][\w+.-]*:/i.test(u) ? u : 'https://' + u; }),
    openMedia: (src) => openMedia(src),
    createDoc: createDocHere,
    onCommand: (id) => { if (id === 'template') return insertTemplateCmd(); if (id === 'daily-note') return openDailyNote(todayKey()); if (id === 'template-button') return insertTemplateButton(); if (id === 'help') return openHelp(); if (id === 'link-health') return openLinkHealth(); if (id === 'focus') toggleFocus(); else if (id === 'outline') toggleOutline(); else if (id === 'spellcheck') { const v = !S.settings.spellcheck; saveSetting({ spellcheck: v }); editor.setSpellcheck(v); rich.editor.view.dom.setAttribute('spellcheck', String(v)); } },
    isOn: (id) => (id === 'focus' ? app.classList.contains('focus') : id === 'outline' ? app.dataset.outline === 'open' : id === 'spellcheck' ? !!S.settings.spellcheck : false),
    onTag: (t) => showTag(t),
    onTemplate: (b, pos) => runTemplateButton(b, pos),
    author: () => S.settings.authorName || S.userName || '',
    onStats: (st) => { S.richStats = st; if (isRich()) renderStatus(); },
    mentions: mentionCtx,
    onPropType: (k, t) => folio.setPropType(k, t).then(setTypeOverrides).catch(() => {}),
    onStatus: (el, cur, apply) => showMenu(el, statusOptions(activeTab()?.text).map((v) => ({ label: (v.toLowerCase() === cur.toLowerCase() ? '✓ ' : '') + v, run: () => apply(v) }))),
    linkKind: (target) => linkKind(target, S.files, S.active || ''),
    onDate: (el, when, apply, openNote) => openDatePicker(el, when, { onPick: apply, onOpenNote: openNote }),
    dateStyle: () => datePrefs.style,
    preview: previewHtml,
    saveImage: async (src) => {
      const t = activeTab(); if (!t) return null;
      let data = src; if (!/^data:/.test(src)) data = await folio.dataUrl(src, t.path);
      const m = /^data:image\/([\w+.-]+);base64,(.*)$/s.exec(data); if (!m) return null;
      const bin = atob(m[2]); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return folio.saveImage(t.path, `pasted.${m[1].replace('jpeg', 'jpg').replace(/\+.*/, '')}`, bytes);
    },
    onError: (e) => toast(tr('app.paste-failed-message', { message: e.message }), { kind: 'error' }),
    onBlockDeleted: (undo, n = 1) => { const path = S.active; toast(tr('app.blocks-deleted', { n }), { action: [tr('app.undo'), () => { if (S.active === path && isRich()) undo(); }] }); }, // only for the page and view it came from
    onCopyBlockLink: (id) => { if (!S.active) return; const t = `[[${refName(S.active)}#^${id}]]`; folio.copy(t); toast(tr('app.copied-t-paste-it-anywhere-to-link-to', { t })); },
    onLink: (prev) => prompt({ title: tr(prev ? 'app.edit-link' : 'app.add-link'), label: tr('app.address'), value: prev || 'https://', hint: tr('app.leave-empty-to-remove-the-link'), action: tr('app.apply'), allowEmpty: true, validate: false }),
  });
  $('#pane-rich').addEventListener('paste', async (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file) return; e.preventDefault(); e.stopPropagation();
    const t = activeTab(); if (!t) return;
    try { const rel = await folio.saveImage(t.path, file.name || 'pasted.png', new Uint8Array(await file.arrayBuffer())); rich.editor.chain().focus().setImage({ src: encodeURI(rel), alt: 'image' }).run(); }
    catch (er) { toast(tr('app.could-not-save-the-image-message', { message: er.message }), { kind: 'error' }); }
  }, true);
  $('.rich-scroll').addEventListener('scroll', () => { if (isRich()) markOutlineCurrent(); }, { passive: true });
  /* quiet chrome while writing (Notion, iA Writer): typing fades the ribbon and the side panels; the pointer brings them back */
  let lastXY = null;
  $('#pane-rich').addEventListener('keydown', (e) => { if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace') && e.target.closest?.('.rich-prose')) app.classList.add('is-typing'); });
  document.addEventListener('mousemove', (e) => { if (!app.classList.contains('is-typing')) return; const d = lastXY ? Math.abs(e.clientX - lastXY[0]) + Math.abs(e.clientY - lastXY[1]) : 0; lastXY = [e.clientX, e.clientY]; if (d > 6) { app.classList.remove('is-typing'); lastXY = null; } }, { passive: true });

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
  translateStatic();
}
/* the HTML's own words, in the language chosen; ⌘ and ⇧ become what this keyboard calls them */
function translateStatic() {
  const keys = (s) => s.replace(/⌘/g, mod()).replace(/⇧/g, shift());
  applyStatic(document, keys);
  $$('[data-tip]:not([data-i18n-attr])').forEach((el) => (el.dataset.tip = keys(el.dataset.tip)));
  $('#btn-back').dataset.tip = `${tr('ui.back')} (${S.platform === 'darwin' ? '⌘⌥←' : 'Alt+←'})`; $('#btn-forward').dataset.tip = `${tr('ui.forward')} (${S.platform === 'darwin' ? '⌘⌥→' : 'Alt+→'})`;
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
// Remote images: the page's CSP blocks them, so a note you did not write cannot make your machine call out just by being opened.
// On request (per note for this session, or always from Settings) the main process fetches them with its network guard and hands back a data: URL.
let remoteGen = 0; // bumped when the folder changes, so a download still in flight cannot fill the new folder's cache
const remoteOK = new Set(), remoteCache = new Map(), remoteJobs = new Map(), remoteFailed = new Set(); // grants, fetched images, downloads in flight and failures belong to the open folder
const isRemote = (s) => /^https?:\/\//i.test(s || '');
const remoteAllowed = (t) => !!t && (S.settings.remoteImages === true || remoteOK.has(t.path));
let remoteBytes = 0; const REMOTE_CACHE_MAX = 64 * 1024 * 1024; // fetched images kept for redraws, oldest dropped past this
function resetRemote() { remoteOK.clear(); remoteCache.clear(); remoteJobs.clear(); remoteFailed.clear(); remoteBytes = 0; remoteGen++; }
function cacheRemote(src, u) {
  if (!u || u.length > REMOTE_CACHE_MAX) return;
  remoteCache.set(src, u); remoteBytes += u.length;
  for (const [k, v] of remoteCache) { if (remoteBytes <= REMOTE_CACHE_MAX) break; remoteCache.delete(k); remoteBytes -= v.length; }
}
// one download per address at a time; a failure is not retried until the folder changes or the person asks again
function remoteImage(src) {
  const t = activeTab(); if (!remoteAllowed(t)) return Promise.resolve(null);
  if (remoteCache.has(src)) { const u = remoteCache.get(src); remoteCache.delete(src); remoteCache.set(src, u); return Promise.resolve(u); } // most recently used last
  if (remoteFailed.has(src)) return Promise.resolve(null);
  if (!remoteJobs.has(src)) {
    const g = remoteGen;
    remoteJobs.set(src, folio.dataUrl(src, t.path).then((u) => { if (g === remoteGen) cacheRemote(src, u); return u; }, () => { if (g === remoteGen) remoteFailed.add(src); return null; }).finally(() => { if (g === remoteGen) remoteJobs.delete(src); }));
  }
  return remoteJobs.get(src);
}
// a file: address written in a note is shown only when it points inside the open folder, and main checks the real path again
function fileUrlRel(src) {
  if (!S.workspace) return null;
  let abs; try { abs = decodeURIComponent(new URL(src).pathname); } catch { return null; }
  if (/^\/[a-z]:\//i.test(abs)) abs = abs.slice(1);
  const win = /^[a-z]:/i.test(abs), ws = S.workspace.replace(/\\/g, '/').replace(/\/+$/, '');
  const a = win ? abs.toLowerCase() : abs, w = win ? ws.toLowerCase() : ws;
  return a.startsWith(w + '/') ? abs.slice(ws.length + 1) : null;
}
function resolveImg(src) {
  if (isRemote(src)) return remoteImage(src);
  if (/^file:/i.test(src)) { const rel = fileUrlRel(src); return rel ? folio.absUrl(rel).catch(() => null) : Promise.resolve(null); }
  const t = activeTab(); if (!t) return Promise.resolve(null);
  let rel; try { rel = decodeURI(src).replace(/^\.\//, ''); } catch { return Promise.resolve(null); } // a malformed %-escape is a missing image, not an exception
  const d = dirOf(t.path); return folio.absUrl(normalize(d ? `${d}/${rel}` : rel)).catch(() => null);
}
// the person allowed this note's web images (or all of them): forget earlier failures and redraw every view that shows images
function allowRemote(path) { if (path) remoteOK.add(path); remoteFailed.clear(); renderPreview(); if (curType() === 'md' && isRich()) rich?.refreshImages?.(); renderRemoteNotice(); } // the hidden editor may still hold another note: it reloads its pictures when it is shown
// edit view: the same notice as the preview, above the editor, while the open note has blocked web images
let remoteBlockedCount = 0; // web images the visual editor holds back in the open note
function renderRemoteNotice() {
  const t = activeTab(); let bar = $('#remote-edit-bar');
  const show = t && !remoteAllowed(t) && remoteBlockedCount > 0 && curType() === 'md';
  if (!show) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement('div'); bar.id = 'remote-edit-bar'; bar.className = 'remote-bar remote-bar-edit'; bar.setAttribute('role', 'status');
    bar.innerHTML = '<span></span><button type="button" class="btn"></button>';
    bar.querySelector('button').onclick = () => allowRemote(activeTab()?.path);
    const scroll = $('#pane-rich .rich-scroll'); if (!scroll) return; scroll.parentElement.insertBefore(bar, scroll);
  }
  bar.querySelector('span').textContent = tr('app.remote-images-blocked', { n: remoteBlockedCount });
  bar.querySelector('button').textContent = tr('app.load-remote-images');
}
async function saveSetting(patch) { S.settings = await folio.setSettings(patch); }

/* ============ panes ============ */
let splitRatio = Number(localStorageGet('folio.split')) || 0.5;
function layoutPanes() {
  const ws = $('#workspace');
  const narrow = window.innerWidth < 1100;
  app.classList.toggle('narrow', narrow);
  const review = app.dataset.dock === 'review';
  const outline = app.dataset.outline === 'open' && !narrow && !app.classList.contains('focus') ? (review ? 'var(--dock-w-review)' : 'var(--outline-w)') : '0';
  const v = app.dataset.modeView;
  if (curType() !== 'md') { ws.style.setProperty('--cols', v === 'split' ? `minmax(0, ${splitRatio}fr) 1px minmax(0, ${1 - splitRatio}fr)` : 'minmax(0, 1fr)'); return; }
  ws.style.setProperty('--cols', v === 'split' ? `minmax(0, ${splitRatio}fr) 1px minmax(0, ${1 - splitRatio}fr) ${outline}` : `minmax(0, 1fr) ${outline}`);
}
window.addEventListener('resize', layoutPanes);
/* the right dock: Outline and Review share one column (Google Docs side panel), never two */
function setDock(tab, { focus = false } = {}) {
  app.dataset.dock = tab;
  for (const b of $$('#outline .dock-tabs [role=tab]')) b.setAttribute('aria-selected', String(b.dataset.dock === tab));
  $('#dock-outline').hidden = tab !== 'outline'; $('#dock-review').hidden = tab !== 'review'; $('#dock-info').hidden = tab !== 'info';
  if (tab === 'info') { if (app.dataset.outline !== 'open') { app.dataset.outline = 'open'; $('#btn-outline').setAttribute('aria-pressed', 'true'); } renderInfo(true); }
  if (tab === 'review' && app.dataset.outline !== 'open') { app.dataset.outline = 'open'; $('#btn-outline').setAttribute('aria-pressed', 'true'); }
  layoutPanes(); rich?.sync?.();
  if (focus) $(`#dock-tab-${tab}`).focus();
}
$('#dock-review').addEventListener('review-toggle', (e) => {
  if (e.auto && app.dataset.dock === 'info') return; // an automatic show must not pull someone out of Info
  if (e.detail !== (app.dataset.dock === 'review')) setDock(e.detail ? 'review' : 'outline');
});
$('#outline .dock-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-dock]'); if (!b) return; const tab = b.dataset.dock;
  if (tab === 'review') { rich.review().show(true); if (app.dataset.dock !== 'review') setDock('review'); }
  else { rich.review().show(false); if (app.dataset.dock !== tab) setDock(tab); }
});
const DOCK_TABS = ['outline', 'review', 'info'];
$('#outline .dock-tabs').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault();
  const i = DOCK_TABS.indexOf(app.dataset.dock); $(`#dock-tab-${DOCK_TABS[(i + (e.key === 'ArrowRight' ? 1 : DOCK_TABS.length - 1)) % DOCK_TABS.length]}`).click();
  $(`#dock-tab-${app.dataset.dock}`).focus();
});
/* Info: what the page holds and when the file changed (the file facts come from the main process, kept per page) */
const infoFile = {};
async function renderInfo(refetch) {
  if (app.dataset.dock !== 'info') return;
  const t = activeTab(), el = $('#dock-info');
  if (!t) { el.innerHTML = `<p class="info-empty">${esc(tr('info.empty'))}</p>`; return; }
  if (refetch || !(t.path in infoFile)) infoFile[t.path] = await folio.info(t.path).catch(() => null);
  if (activeTab()?.path !== t.path || app.dataset.dock !== 'info') return;
  const rows = infoRows(curType() === 'md' ? docInfo(t.text) : { words: 0, chars: 0, minutes: 1, tasks: { done: 0, open: 0 }, bytes: new TextEncoder().encode(t.text).length }, t.path, infoFile[t.path]);
  const shown = curType() === 'md' ? rows : rows.filter(([k]) => [tr('info.path'), tr('info.size'), tr('info.changed'), tr('info.created')].includes(k));
  el.innerHTML = `<h2 class="side-head">${esc(tr('info.title'))}</h2><dl class="info-list">${shown.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}
const infoSoon = debounce(() => renderInfo(false), 200);

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
  if (dir !== S.workspace) resetRemote(); // grants and fetched web images never follow you into another folder, however the folder changed
  S.workspace = dir;
  folio.propTypes().then(setTypeOverrides).catch(() => setTypeOverrides({}));
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
    renderTree(); tagsStale(); remindersSoon();
  } catch (e) {
    $('#tree').innerHTML = `<div class="side-empty">${esc(tr('app.could-not-read-folder', { message: e.message }))}<br><button class="btn" type="button" data-act="choose">${tr('app.choose-another-folder')}</button></div>`;
  }
}
function flatten(nodes, out = []) { for (const n of nodes) { if (n.type === 'file') out.push(n.path); else flatten(n.children, out); } return out; }

function renderTree() {
  const host = $('#tree');
  if (!S.tree.length) {
    host.innerHTML = `<div class="side-empty">${tr('app.this-folder-has-no-markdown-notes-yet')}<br><button class="btn" type="button" data-act="new">${icons.plus} New note</button></div>`;
    return;
  }
  const row = (n, depth) => {
    if (n.type === 'dir') {
      const open = S.expanded.has(n.path);
      return `<div role="none"><button class="tree-row" type="button" role="treeitem" data-dir="${esc(n.path)}" aria-expanded="${open}" style="--depth:${depth}" draggable="true">
        <span class="twisty">${icons.chevron}</span><span class="glyph">${icons.folder}</span><span class="label">${esc(n.name)}</span></button>
        <div class="tree-children" role="group" ${open ? '' : 'hidden'}>${n.children.map((c) => row(c, depth + 1)).join('')}</div></div>`;
    }
    const ai = S.aiEdits.has(n.path) ? '<span class="ai-tag">' + tr('app.ai') + '</span>' : '';
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
    if (ASSET_HINT.test(text)) await checkAssets(t).catch(() => {});
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
  applyLock();
  requestAnimationFrame(() => { editor.view.scrollDOM.scrollTop = t.scroll || 0; if (line) editor.scrollToLine(line, { select: true }); });
  const ai = S.aiEdits.get(p);
  if (ai && Date.now() - ai.at < 10 * 60e3) { showAiBanner(p); highlightAi(p, { fresh: false }); } else hideAiBanner();
  renderTabs(); renderTree(); renderPreview(); renderOutline(); renderStatus(); updateHistoryButtons(); renderRemoteNotice();
  saveSetting({ lastFile: p });
  if (type !== 'md') { if (v === 'code') editor.focus(); else curSurface()?.focus?.(); }
  else if (isRich()) rich.focus('start'); else if (app.dataset.modeView !== 'preview') editor.focus();
}
function renderTabs() {
  $('#tabs').innerHTML = S.tabs.map((t) => {
    const dirty = t.text !== t.saved;
    return `<div class="tab" role="tab" tabindex="0" data-tab="${esc(t.path)}" aria-selected="${t.path === S.active}" data-dirty="${dirty}" data-ai="${S.aiEdits.has(t.path)}" title="${esc(t.path)}">
      <span class="tab-label">${esc(stem(t.path))}</span>
      <span class="tab-close" aria-hidden="true" data-close="${esc(t.path)}">${icons.close}</span></div>`; // a mouse shortcut: from the keyboard a tab closes with Delete or ⌘/Ctrl+W
  }).join('');
}
async function closeTab(p = S.active) {
  const t = tabOf(p); if (!t) return;
  while (t.text !== t.saved) if (!(await saveTab(t))) return; // typing during the write saves again; a failed write keeps the tab open with its text (the toast offers Retry)
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
  historySoon();
  if (from === 'source' && isRich()) return; // the hidden source view only mirrors
  if (from === 'source' && curType() !== 'md' && app.dataset.modeView === 'visual') return;
  if (text === t.text) return;
  t.text = text;
  if (curType() !== 'md') {
    if (from === 'source' && app.dataset.modeView === 'split') surfaceSoon(text);
    if (from === 'surface' && app.dataset.modeView === 'split') editor.applyRemote(text);
  }
  if (!isRemote) { autosave(); setSaveState('edited'); }
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
/** save a tab; resolves true when its text is on disk (or was already), false when the write failed (the tab keeps its text) */
async function saveTab(t) {
  if (t.text === t.saved) return true;
  if (S.writesFrozen || t.dead) return false; // a tab of a folder that was closed or left is never written again
  const text = t.text, before = t.saved;
  try { await folio.write(t.path, text); t.saved = text; assetsAfterSave(t, before, text); if (app.dataset.dock === 'info') renderInfo(true); if (t.path === S.active) { setSaveState('saved'); if (/\[\[|\{\{/.test(text)) backlinksSoon(); if (/#|^tags?:/m.test(text)) tagsStale(); } renderTabsDirty(); return true; }
  catch (e) { toast(tr('app.could-not-save-path-message', { path: base(t.path), message: e.message }), { kind: 'error', action: [tr('app.retry'), () => saveTab(t)] }); setSaveState('failed'); return false; }
}
/** save every open tab before they go away (close folder, switch folder, reload, quit); when some write fails, ask before dropping the unsaved text */
async function saveAllOrAsk() {
  const failed = [];
  for (const t of S.tabs.filter((x) => !x.dead)) {
    let ok = true;
    while (ok && t.text !== t.saved) ok = await saveTab(t).catch(() => false); // text typed during a write is saved too
    if (!ok) failed.push(t);
  }
  if (!failed.length) return true;
  const discard = await confirmSheet({ title: tl('app', 'Some pages could not be saved'), body: tr('app.unsaved-pages-lost', { names: failed.map((t) => stem(t.path)).join(', ') }), action: tl('app', 'Discard changes'), danger: true });
  if (discard) S.writesFrozen = true; // the pages are about to go: no later save (a Retry, an autosave) may write them, least of all into another folder
  return discard;
}
async function saveActive() { const t = activeTab(); if (t) await saveTab(t); }
let saveStateTimer;
function setSaveState(s) { $('#st-save').textContent = tr(`app.save-${s}`); clearTimeout(saveStateTimer); if (s === 'saved') saveStateTimer = setTimeout(() => ($('#st-save').textContent = ''), 1600); }

async function pasteImage(file, view) {
  const t = activeTab(); if (!t) return;
  try {
    const rel = await folio.saveImage(t.path, file.name || 'pasted.png', new Uint8Array(await file.arrayBuffer()));
    editor.insert(`![${(file.name || 'image').replace(/\.\w+$/, '')}](${encodeURI(rel)})`);
  } catch (e) { toast(tr('app.could-not-save-the-image-message', { message: e.message }), { kind: 'error' }); }
}

/* ============ preview ============ */
async function renderPreview() {
  const t = activeTab();
  const el = $('#preview');
  if (!t || app.dataset.modeView === 'edit' || curType() !== 'md') return;
  // parsed in an inert template, so no picture is requested before its address has been checked
  const tpl = document.createElement('template'); tpl.innerHTML = render(t.text);
  const blocked = [];
  const block = (img) => { img.classList.add('remote-blocked'); img.alt = img.alt || tr('app.remote-image'); };
  for (const el of tpl.content.querySelectorAll('[srcset]')) el.removeAttribute('srcset'); // a candidate list cannot be checked address by address
  for (const img of tpl.content.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    if (src && !/^(data:|blob:)/.test(src)) {
      img.removeAttribute('src');
      if (isRemote(src)) {
        img.dataset.remoteSrc = src;
        if (remoteAllowed(t)) remoteImage(src).then((u) => { if (u) img.src = u; else block(img); });
        else { block(img); blocked.push(img); }
      } else resolveImg(src).then((u) => { if (u) img.src = u; });
    }
    img.loading = 'lazy'; img.decoding = 'async';
  }
  for (const m of tpl.content.querySelectorAll('video[data-src], audio[data-src]')) {
    const src = m.dataset.src;
    if (/^(data:|blob:)/.test(src)) m.src = src;
    else if (isRemote(src) && !remoteAllowed(t)) blocked.push(m);
    else resolveImg(src).then((u) => { if (u) m.src = u; });
  }
  el.replaceChildren(tpl.content);
  if (blocked.length) {
    const bar = document.createElement('div'); bar.className = 'remote-bar'; bar.setAttribute('role', 'status');
    bar.innerHTML = `<span>${esc(tr('app.remote-images-blocked', { n: blocked.length }))}</span><button type="button" class="btn">${esc(tr('app.load-remote-images'))}</button>`;
    bar.querySelector('button').onclick = () => allowRemote(t.path);
    el.prepend(bar);
  }
  for (const a of el.querySelectorAll('a[data-wikilink]')) {
    if (!resolveWiki(a.dataset.wikilink)) a.classList.add('missing');
  }
  for (const pre of el.querySelectorAll('pre:not(.mermaid-src)')) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn copy-code'; b.textContent = tr('app.copy');
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
  return folio.openFile(rel).catch((e) => toast(tr('app.could-not-open-rel-message', { rel: base(rel), message: e.message }), { kind: 'error' }));
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
  if (kind === 'sheet') { const { parseWorkbook } = await import('./sheet-core.js'); return parseWorkbook(text).filter((b) => b.type === 'sheet').map((b) => ({ value: `${b.name}!A1`, label: tr('app.sheet-name-edit-the-cell-or-range', { name: b.name }) })); }
  if (kind === 'slides') { const { parseDeck } = await import('./slides-core.js'); return parseDeck(text).slides.map((sl, i) => ({ value: String(i + 1), label: tr('app.slide-i-title', { i: i + 1, title: sl.title ? ': ' + sl.title : '' }) })); }
  if (kind === 'board') { const { splitBoardDoc, parseBoard } = await import('./board-core.js'); return parseBoard(splitBoardDoc(text).code).nodes.filter((n) => !n.implicit).map((n) => ({ value: n.id, label: `${n.label} (${n.id})` })); }
  return headings(text).map((h) => ({ value: h.text.replace(/[*_`]/g, ''), label: `${'  '.repeat(h.level - 1)}${h.text}` }));
}
function pickRef({ kind = 'link' } = {}) {
  return new Promise((resolve) => {
    const d = $('#sheet-prompt');
    const docs = S.files.filter((f) => f !== S.active);
    d.innerHTML = `<form method="dialog" class="prompt-form ref-form">
      <div class="sheet-head"><div><h2 id="prompt-title">${tr('app.insert-reference')}</h2><p>${tr('app.point-at-another-document-a-part-of-it')}</p></div></div>
      <div class="sheet-body">
        <div class="field"><label for="ref-doc">${tr('app.document')}</label><input class="input" id="ref-doc" list="ref-docs" autocomplete="off" spellcheck="false" placeholder="${tr('app.type-to-search')}"><datalist id="ref-docs">${docs.map((f) => `<option value="${esc(f)}">${esc(stem(f))}</option>`).join('')}</datalist></div>
        <div class="field"><label for="ref-part-pick">${tr('app.part')}</label><select class="rb-select" id="ref-part-pick"><option value="">${tr('app.whole-document')}</option></select>
          <input class="input" id="ref-part" spellcheck="false" placeholder="${tr('app.optional-e-g-costs-h6-or-3')}" aria-label="${tr('app.part')}"></div>
        <fieldset class="field ref-kinds"><legend>${tr('app.show-as')}</legend>
          <label><input type="radio" name="ref-kind" value="link"${kind === 'link' ? ' checked' : ''}> ${tr('app.link')}</label>
          <label><input type="radio" name="ref-kind" value="value"${kind === 'value' ? ' checked' : ''}> ${tr('app.live-value')}</label>
          <label><input type="radio" name="ref-kind" value="embed"${kind === 'embed' ? ' checked' : ''}> ${tr('app.embed')}</label></fieldset>
        <p class="ref-preview" id="ref-preview" aria-live="polite"></p>
      </div>
      <div class="sheet-foot"><button class="btn" type="button" data-cancel>${tr('app.cancel')}</button><button class="btn btn-primary" type="submit">${tr('app.insert')}</button></div></form>`;
    const docEl = $('#ref-doc', d), pick = $('#ref-part-pick', d), partEl = $('#ref-part', d), prev = $('#ref-preview', d);
    const path = () => S.files.includes(docEl.value) ? docEl.value : resolveTarget(docEl.value, S.files, S.active || '');
    const current = () => { const p = path(); if (!p) return null; return refText(d.querySelector('[name=ref-kind]:checked').value, p, partEl.value.trim()); };
    let seq = 0;
    const preview = async () => {
      const t = current(); const n = ++seq;
      if (!t) { prev.textContent = docEl.value ? tr('app.no-document-with-that-name') : ''; return; }
      prev.innerHTML = `<code>${esc(t)}</code>`;
      try { const r = await resolveRef(t.replace(/^!?\[\[|\]\]$|^\{\{|\}\}$/g, '').replace(/\|.*$/, ''), refEnv()); if (n === seq) prev.innerHTML = `<code>${esc(t)}</code> <span>shows ${esc(String(r.value).slice(0, 80))}</span>`; }
      catch (e) { if (n === seq) prev.innerHTML = `<code>${esc(t)}</code> <span class="ref-preview-err">${esc(e.message)}</span>`; }
    };
    docEl.addEventListener('change', async () => {
      const p = path(); pick.innerHTML = '<option value="">' + tr('app.whole-document') + '</option>'; partEl.value = '';
      if (p) { for (const o of await partsOf(p)) pick.insertAdjacentHTML('beforeend', `<option value="${esc(o.value)}">${esc(o.label)}</option>`); }
      preview();
    });
    docEl.addEventListener('input', preview);
    pick.addEventListener('change', () => { partEl.value = pick.value; preview(); if (docKind(path() || '') === 'sheet' && pick.value) { partEl.focus(); partEl.setSelectionRange(partEl.value.indexOf('!') + 1, partEl.value.length); } });
    partEl.addEventListener('input', preview);
    d.querySelectorAll('[name=ref-kind]').forEach((r) => r.addEventListener('change', preview));
    const done = (v) => { d.close(); resolve(v); };
    d.querySelector('form').onsubmit = (e) => { e.preventDefault(); const t = current(); if (!t) { prev.textContent = tr('app.choose-a-document-first'); docEl.focus(); return; } done(t); };
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
  toast(tr('app.reference-inserted'));
}
function copyRef(path, part, kind) { const t = refText(kind, path, part); folio.copy(t); toast(tr('app.copied-t', { t })); }
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
  if (SURFACES[type]) await loadSurface(type).catch(() => {}); // the first open of this type mounts its editor after loading it
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
    await refreshTree(); toast(tr('app.created-p-ctrl-or-click-the-link-to-op', { p: base(p) }));
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
  if (!all.length) { box.innerHTML = '<div class="side-empty">' + tr('app.write-tag-in-a-page-or-add-tags-in-its') + '</div>'; return; }
  // parents of nested tags are listed even when no page uses them alone; they count every page under them
  const byKey = new Map(all.map((t) => [t.tag.toLowerCase(), { ...t, files: [...t.files] }]));
  for (const t of all) { const parts = t.tag.split('/'); for (let i = 1; i < parts.length; i++) { const p = parts.slice(0, i).join('/'); const k = p.toLowerCase(); const e = byKey.get(k) || { tag: p, count: 0, files: [] }; e.files = [...new Set([...e.files, ...t.files])]; e.count = e.files.length; byKey.set(k, e); } }
  const sorted = [...byKey.values()].sort((a, b) => a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' }));
  const active = /^#(\S+)$/.exec($('#sidebar-search').value.trim())?.[1]?.toLowerCase();
  box.innerHTML = sorted.map((t) => { const depth = t.tag.split('/').length - 1; const name = t.tag.split('/').pop();
    return `<button type="button" class="tag-item" data-tag="${esc(t.tag)}" style="--depth:${depth}"${active === t.tag.toLowerCase() ? ' aria-current="true"' : ''}><span class="tag-name">#${esc(depth ? name : t.tag)}</span><span class="tag-count">${t.count}</span></button>`; }).join('');
}
const tagsSoon = debounce(() => renderTags(), 400);
/* the Reminders section of the sidebar (X13): every @remind of the workspace, overdue first, with Done and Dismiss.
   The list comes from the main process, which also fires them; Done and Dismiss are app state, never written in the page. */
const remindersOpen = () => S.settings.showReminders !== false;
let reminderList = [], showDoneReminders = false;
const reminderWhen = (r) => whenLabel(r, (d) => formatDay(d, { style: datePrefs.style, lang: locale() }));
async function renderReminders() {
  const sec = $('#section-reminders'), box = $('#reminders-list'); if (!sec || !box) return;
  try { reminderList = S.workspace && folio.reminders ? await folio.reminders.list() : []; } catch { reminderList = []; }
  sec.hidden = !reminderList.length;
  const open = remindersOpen(); $('#reminders-head').setAttribute('aria-expanded', String(open)); box.hidden = !open;
  const overdue = reminderList.filter((r) => r.state === 'overdue').length; const badge = $('#reminders-badge');
  badge.hidden = !overdue; badge.textContent = overdue ? String(overdue) : ''; badge.setAttribute('aria-label', tr('app.reminders-overdue', { n: overdue }));
  const shown = reminderList.filter((r) => showDoneReminders || r.state !== 'done'); const done = reminderList.length - reminderList.filter((r) => r.state !== 'done').length;
  box.innerHTML = shown.map((r) => `<div class="rem-item is-${r.state}" role="listitem" data-id="${esc(r.id)}">
      <button type="button" class="rem-open" data-open="${esc(r.rel)}" data-line="${r.line}" title="${esc(r.rel)}"><span class="rem-title">${esc(r.title || stem(r.rel))}</span><span class="rem-meta"><span class="rem-when">${esc(reminderWhen(r))}</span>${r.state === 'overdue' ? ` · <span class="rem-late">${tr('app.reminder-overdue')}</span>` : ''} · ${esc(stem(r.rel))}</span></button>
      <button type="button" class="icon-btn rem-act" data-act="${r.state === 'done' ? 'undo' : 'done'}" aria-label="${r.state === 'done' ? tr('app.reminder-not-done') : tr('app.reminder-done')}" data-tip="${r.state === 'done' ? tr('app.reminder-not-done') : tr('app.reminder-done')}" aria-pressed="${r.state === 'done'}">${icons.check}</button>
      <button type="button" class="icon-btn rem-act" data-act="dismiss" aria-label="${tr('app.reminder-dismiss')}" data-tip="${tr('app.reminder-dismiss')}">${icons.close}</button></div>`).join('')
    + (done ? `<button type="button" class="rem-more" data-act="toggle-done">${showDoneReminders ? tr('app.reminders-hide-done') : tr('app.reminders-show-done', { n: done })}</button>` : '');
}
const remindersSoon = debounce(() => renderReminders(), 150);
function onReminderFired(r) {
  const what = r.title || stem(r.rel);
  toast(tr('app.reminder-toast', { what, when: reminderWhen(r) }), { action: [tr('app.open'), () => openFile(r.rel, { line: r.line })] });
  remindersSoon();
}
function showTag(tag) {
  const si = $('#sidebar-search'); si.value = '#' + tag.replace(/^#/, '');
  if (app.dataset.sidebar !== 'open') toggleSidebar?.();
  runSearch(si.value); renderTags();
}
async function renameTagEverywhere(tag) {
  const to = await prompt({ title: tr('app.rename-tag-2', { tag }), label: tr('app.new-name'), value: tag, hint: tr('app.every-page-that-uses-it-is-updated-nes'), action: tr('app.rename-2') });
  const next = (to || '').trim().replace(/^#/, ''); if (!next || next === tag) return;
  if (!/^[\p{L}\p{N}_\-/]+$/u.test(next) || !/[\p{L}_]/u.test(next)) { toast(tr('app.a-tag-has-letters-numbers-or-and-at-le'), { kind: 'error' }); return; }
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
    statuses: statusOptions(activeTab()?.text),
    createDoc: createDocHere,
    lang: () => locale(),
    dayLabel: (d) => formatDay(d, { style: 'relative', lang: locale() }),
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
/* a template with questions ({{ask:…}}) shows a short form first; null means the person cancelled */
async function askFilled(t, opts) {
  const raw = await templateText(t); const qs = askVars(withoutMeta(raw));
  if (!qs.length) return filled(raw, opts);
  const people = S.files.filter((f) => /^People\//.test(f)).map((f) => stem(f));
  const answers = await new Promise((resolve) => {
    const d = $('#sheet-prompt'); d.classList.remove('sheet-small');
    const field = (q, i) => `<div class="field"><label for="ask-${i}">${esc(q.label)}</label>${q.kind === 'long' ? `<textarea class="input" id="ask-${i}" rows="3" data-q="${esc(q.label)}"></textarea>` : `<input class="input" id="ask-${i}" data-q="${esc(q.label)}" type="${q.kind === 'date' ? 'date' : 'text'}" autocomplete="off"${q.kind === 'people' ? ' list="ask-people"' : ''}>`}</div>`;
    d.innerHTML = `<form method="dialog" class="prompt-form"><div class="sheet-head"><div><h2 id="prompt-title">${esc(t.name)}</h2><p>${tr('app.a-few-details-to-fill-in-you-can-leave')}</p></div></div>
      <div class="sheet-body">${qs.map(field).join('')}<datalist id="ask-people">${people.map((n) => `<option value="${esc(n)}">`).join('')}</datalist></div>
      <div class="sheet-foot"><button class="btn" type="button" data-cancel>${tr('app.cancel')}</button><button class="btn btn-primary" type="submit">${tr('app.create')}</button></div></form>`;
    const done = (v) => { d.close(); resolve(v); };
    d.querySelector('form').onsubmit = (e) => { e.preventDefault(); done(Object.fromEntries([...d.querySelectorAll('[data-q]')].map((i) => [i.dataset.q, i.value.trim()]))); };
    d.querySelector('[data-cancel]').onclick = () => done(null); d.oncancel = () => resolve(null);
    d.showModal(); d.querySelector('[data-q]').focus();
  });
  return answers ? filled(raw, { ...opts, answers }) : null;
}
function pickTemplate({ title = tr('app.insert-template'), note = tr('app.template-note'), action = tr('app.insert') } = {}) {
  return new Promise((resolve) => {
    const d = $('#sheet-prompt'); const list = listTemplates(S.files);
    d.innerHTML = `<form method="dialog" class="prompt-form tpl-form">
      <div class="sheet-head"><div><h2 id="prompt-title">${esc(title)}</h2><p>${esc(note)} Your own templates are the pages in <b>${TEMPLATE_DIR}/</b>.</p></div></div>
      <div class="sheet-body"><fieldset class="tpl-list"><legend class="visually-hidden">${tr('app.template')}</legend>
        ${list.map((t, i) => `<label class="tpl-card"><input type="radio" name="tpl" value="${i}"${i === 0 ? ' checked' : ''}><span class="tpl-name">${esc(t.name)}</span><span class="tpl-desc">${esc(t.starter ? t.desc : t.path)}</span>${t.starter ? '<span class="tpl-badge">' + tr('app.starter') + '</span>' : ''}</label>`).join('')}
      </fieldset></div>
      <div class="sheet-foot"><button class="btn" type="button" data-edit>${tr('app.all-templates')}</button><span class="rb-spacer"></span><button class="btn" type="button" data-cancel>${tr('app.cancel')}</button><button class="btn btn-primary" type="submit">${esc(action)}</button></div></form>`;
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
  const text = await askFilled(t, { title: stem(S.active || 'Untitled') }); if (text == null) return;
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
  const text0 = await askFilled(t, { title }); if (text0 == null) return;
  const text = text0.split(CURSOR).join('');
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
    preview: async (raw, t) => { const text = filled(raw, { title: page || t.name, keepAsk: true }).split(CURSOR).join(''); const { body } = splitTemplate(text); return { text, html: render(page ? intoPage(body) : body) }; },
    favs: S.settings.templateFavs || [], recent: S.settings.templateRecent || [],
    setFavs: (ids) => saveSetting({ templateFavs: ids }),
    use: async (t, { as, name }) => { try { if (as === 'here') await applyTemplate(t); else await newPageFromTemplate(t, name); } catch (e) { toast(e.message, { kind: 'error' }); } },
    save: async (t) => {
      try {
        const raw = await templateText(t);
        const p = await writeTemplate(t.name, setMeta(raw, { description: t.desc, category: t.category, icon: t.icon, ...(t.url ? { source: t.url } : {}) }));
        toast(tr('app.saved-to-p-edit-it-there-it-is-yours-n', { p })); return p;
      } catch (e) { toast(e.message, { kind: 'error' }); return null; }
    },
    edit: (t) => openFile(t.path),
    remove: async (t) => { if (!await confirmSheet({ title: tr('app.delete-the-template-name', { name: t.name }), body: tr('app.it-moves-to-the-trash-pages-made-from'), action: tr('app.delete'), danger: true })) return false; await folio.trash(t.path); await refreshTree(); return true; },
    rename: async (t) => { const name = await prompt({ title: tr('app.rename-template'), label: tr('app.name'), value: t.name, action: tr('app.rename-2') }); if (!name || name === t.name) return null; const to = `${dirOf(t.path)}/${templateFileName(name)}.md`; await movePath(t.path, to, false); return to; },
    setCategory: async (t) => {
      const cat = await prompt({ title: tr('app.category'), label: tr('app.category'), value: t.category, hint: tr('app.for-example-meetings-planning-product'), action: tr('app.save') });
      if (!cat) return false; const text = await textOf(t.path); await folio.write(t.path, setMeta(text, { category: cat.trim() })); const tab = tabOf(t.path); if (tab) { tab.text = tab.saved = setMeta(text, { category: cat.trim() }); } return true;
    },
    duplicate: async (t) => writeTemplate(`${t.name} copy`, await templateText(t)),
    create: async () => { const p = await writeTemplate('New template', setMeta('# {{title}}\n\n{{cursor}}\n', { description: tr('app.what-this-template-is-for'), category: 'General' })); await openFile(p); toast(tr('app.a-template-is-a-page-write-it-as-you-w', { title: '{{title}}', date: '{{date}}', cursor: '{{cursor}}' })); },
    saveCurrent: async () => { const tab = activeTab(); const p = await writeTemplate(stem(S.active), setMeta(tab.text, { description: '', category: 'General' })); toast(tr('app.saved-as-a-template-p', { p })); },
    importFiles: async () => { const list = await folio.importTemplateFiles(); for (const f of list) await writeTemplate(f.name, Object.keys(templateMeta(f.text)).length ? f.text : setMeta(f.text, { category: 'Imported' })); if (list.length) toast(tr('app.imported-length-templates', { n: list.length })); return list.length; },
    importLink: async () => {
      const url = await prompt({ title: tr('app.import-a-template-from-a-link'), label: tr('app.link-to-a-markdown-file'), value: 'https://', hint: tr('app.a-raw-md-file-for-example-from-github'), action: tr('app.import-2') });
      if (!url || url === 'https://') return null;
      try { const text = await folio.fetchTemplate(url.trim()); const name = templateMeta(text).name || /^#\s+(.+)$/m.exec(withoutMeta(text))?.[1]?.replace(/\{\{[^}]*\}\}/g, '').trim() || decodeURIComponent(url.split('/').pop().replace(/\.(md|markdown|txt)$/i, '')) || 'Imported template';
        const p = await writeTemplate(name, Object.keys(templateMeta(text)).length ? text : setMeta(text, { category: 'Imported', source: url.trim() })); toast(tr('app.imported-p', { p })); return p; }
      catch (e) { toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { kind: 'error' }); return null; }
    },
    menu: (anchor, items) => popupMenu(anchor, items, { label: tr('app.template-actions') }),
  });
}
async function insertTemplateButton() {
  const t = await pickTemplate({ title: tr('app.template-button'), note: tr('app.a-button-in-the-page-that-inserts-this'), action: tr('app.add-button') }); if (!t) return;
  const src = buttonSource({ label: tr('app.new-tolowercase', { toLowerCase: t.name.toLowerCase() }), template: t.name });
  if (isRich()) rich.insertTemplate(src); else editor.insert(`\n${src}\n`);
}
async function runTemplateButton(b, pos) {
  const t = listTemplates(S.files).find((x) => x.name.toLowerCase() === (b.template || '').toLowerCase());
  if (!t) { toast(tr('app.no-template-called-template-templates', { template: b.template, TEMPLATE_DIR }), { kind: 'error' }); return; }
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
      return `<li${hidden ? ' hidden' : ''}>${kids ? `<button type="button" class="outline-fold" data-fold="${i}" aria-expanded="${!outlineFolded.has(i)}" aria-label="${esc(tr(outlineFolded.has(i) ? 'app.show-headings-under' : 'app.hide-headings-under', { text: h.text }))}">${icons.chevron}</button>` : ''}<a href="#" draggable="true" data-line="${h.line}" data-i="${i}" style="--lvl:${Math.min(h.level, 4)}" title="${tr('app.drag-to-move-this-section-alt-shift-ar')}">${esc(h.text)}</a></li>`;
    }).join('')
    : '<li class="outline-empty">' + tr('app.headings-appear-here-as-you-write-them') + '</li>';
  markOutlineCurrent();
  if (activeTab()?.path !== blPath) renderBacklinks();
}
let blSeq = 0, blPath = null;
const backlinksSoon = debounce(() => renderBacklinks(), 600);
async function renderBacklinks() {
  const t = activeTab(); const seq = ++blSeq; if (!t) return; blPath = t.path;
  const [bl, broken, mentions] = await Promise.all([folio.backlinks(t.path).catch(() => []), folio.brokenLinks(t.path).catch(() => []), folio.unlinked(t.path).catch(() => [])]);
  if (seq !== blSeq) return;
  renderUnlinked(mentions);
  const kindLabel = { link: 'link', value: 'value', embed: 'embed' };
  $('#backlinks').innerHTML = bl.length ? bl.map((b) => `<li><a href="#" data-bl="${esc(b.path)}" data-bl-line="${b.line}" title="${esc(b.text)}"><span class="bl-name">${esc(stem(b.path))}</span><span class="bl-kind">${kindLabel[b.kind] || b.kind}</span><span class="bl-ref">${esc(b.ref)}</span></a></li>`).join('')
    : '<li class="outline-empty">' + tr('app.no-other-document-links-here-yet') + '</li>';
  const st = $('#st-links'); st.hidden = !bl.length && !broken.length;
  st.textContent = [bl.length ? `${bl.length} ${bl.length === 1 ? 'link' : 'links'} here` : '', broken.length ? `${broken.length} broken` : ''].filter(Boolean).join(' · ');
  st.onclick = () => showMenu(st, [
    ...(bl.length ? [{ head: tr('app.linked-from') }, ...bl.map((b) => ({ label: `${stem(b.path)}: ${b.ref}`, run: () => openFile(b.path, { line: b.line }) }))] : []),
    ...(broken.length ? [{ head: tr('app.broken-references-here') }, ...broken.map((b) => ({ label: tr('app.line-line-ref', { line: b.line, ref: b.ref }), run: () => openFile(t.path, { line: b.line }) }))] : []),
  ]);
  const box = $('#broken-links'); box.hidden = !broken.length;
  box.innerHTML = broken.length ? `<b>${tr('app.broken-references', { n: broken.length })}</b>${broken.map((b) => { const nm = /^\[\[([^\]|#]+)\]\]$/.exec(b.ref)?.[1]?.trim(); return `<span class="broken-row"><a href="#" data-bl="${esc(t.path)}" data-bl-line="${b.line}">${esc(tr('app.line-line-ref', { line: b.line, ref: b.ref }))}</a>${nm && !/\.\w{2,5}$/.test(nm) ? `<button type="button" class="btn btn-quiet" data-create-page="${esc(nm)}">${tr('app.create-page')}</button>` : ''}</span>`; }).join('')}` : '';
}
/* unlinked mentions: the name of this page written without a link, with a one-click "Link" (Obsidian, Notion) */
function renderUnlinked(list) {
  const ul = $('#unlinked'), head = $('#unlinked-head');
  head.hidden = ul.hidden = !list.length;
  ul.innerHTML = (list.length > 1 ? `<li class="unlinked-all"><button type="button" class="btn btn-quiet" data-link-all>${esc(tr('links.linkAll', { n: list.length }))}</button></li>` : '') + list.slice(0, 50).map((m, i) => {
    const t = m.text, k = t.toLowerCase().indexOf(m.match.toLowerCase());
    const snip = k < 0 ? esc(t) : `${esc(t.slice(0, k))}<mark>${esc(t.slice(k, k + m.match.length))}</mark>${esc(t.slice(k + m.match.length))}`;
    return `<li class="unlinked-row"><a href="#" data-bl="${esc(m.path)}" data-bl-line="${m.line}" title="${esc(m.path)}"><span class="bl-name">${esc(stem(m.path))}</span><span class="bl-ref unlinked-snip">${snip}</span></a><button type="button" class="btn btn-quiet" data-link-mention="${i}" aria-label="Link this mention in ${esc(stem(m.path))}">${tr('app.link')}</button></li>`;
  }).join('');
  ul._list = list;
}
async function linkOneMention(m) {
  const tab = tabOf(m.path);
  const text = tab ? tab.text : await folio.read(m.path);
  const hit = findMentions(text, m.name).find((x) => x.start === m.start) || findMentions(text, m.name).find((x) => x.line === m.line);
  if (!hit) { toast(tr('app.that-mention-changed-refreshing')); return renderBacklinks(); }
  const next = linkMention(text, hit, m.name);
  if (tab) { tab.text = next; if (S.active === tab.path) setActiveText(next); await saveTab(tab); }
  else await folio.write(m.path, next);
  toast(tr('app.linked-name-in-path', { name: m.name, path: stem(m.path) }), { action: [tr('app.undo'), async () => { if (tab) { tab.text = text; if (S.active === tab.path) setActiveText(text); await saveTab(tab); } else await folio.write(m.path, text); renderBacklinks(); }] });
  renderBacklinks();
}
/* Link all: every mention of this page's name, in every document, one undoable step */
async function linkAllMentionsNow(list) {
  const name = list[0].name, before = new Map(); let total = 0;
  for (const path of new Set(list.map((m) => m.path))) {
    const tab = tabOf(path), text = tab ? tab.text : await folio.read(path);
    const r = linkAllMentions(text, name); if (!r.count) continue;
    before.set(path, text); total += r.count;
    if (tab) { tab.text = r.text; if (S.active === tab.path) setActiveText(r.text); await saveTab(tab); } else await folio.write(path, r.text);
  }
  const restore = async () => { for (const [path, text] of before) { const tab = tabOf(path); if (tab) { tab.text = text; if (S.active === tab.path) setActiveText(text); await saveTab(tab); } else await folio.write(path, text); } renderBacklinks(); };
  toast(tr('links.linked', { n: total, name }), { action: [tr('links.undo'), restore] });
  renderBacklinks();
}
$('#unlinked').addEventListener('click', (e) => { if (e.target.closest('[data-link-all]')) { e.preventDefault(); return linkAllMentionsNow($('#unlinked')._list); } const b = e.target.closest('[data-link-mention]'); if (b) { e.preventDefault(); linkOneMention($('#unlinked')._list[Number(b.dataset.linkMention)]); } });
$('#broken-links').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-create-page]'); if (!b) return; e.preventDefault();
  try { const p = await folio.create(b.dataset.createPage + '.md', `# ${b.dataset.createPage}\n\n`); await refreshTree(); toast(tr('app.created-p', { p })); renderBacklinks(); } catch (er) { toast(er.message, { kind: 'error' }); }
});
$('#outline-list').addEventListener('contextmenu', (e) => {
  const a = e.target.closest('a[data-i]'); if (!a || curType() !== 'md') return; e.preventDefault();
  const h = currentHeads[Number(a.dataset.i)]; const part = h.text.replace(/[*_`]/g, '');
  const i = Number(a.dataset.i);
  showMenu(null, [
    { label: tr('app.promote-one-level-up'), disabled: h.level <= 1, run: () => shiftSectionAt(i, -1) }, { label: tr('app.demote-one-level-down'), disabled: h.level >= 6, run: () => shiftSectionAt(i, 1) },
    { label: tr('app.move-section-up'), run: () => { let k = i - 1; while (k >= 0 && currentHeads[k].level > h.level) k--; if (k >= 0) moveSectionTo(i, k); } },
    { label: tr('app.move-section-to-the-end'), run: () => moveSectionTo(i, -1) },
    '-',
    { label: tr('app.copy-link-to-this-section'), run: () => copyRef(S.active, part, 'link') }, { label: tr('app.copy-embed-reference'), run: () => copyRef(S.active, part, 'embed') }], { x: e.clientX, y: e.clientY });
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
/* a new, empty page offers a start (Notion): a few templates, the gallery, an import */
let startEl = null;
/* sits under the last block of the page (the editor stretches to fill the sheet, so it cannot simply follow it) */
function placeStart() {
  const pm = rich.editor.view.dom, last = pm.lastElementChild, pageEl = startEl.parentElement; if (!last) return;
  startEl.style.top = `${Math.round(last.getBoundingClientRect().bottom - pageEl.getBoundingClientRect().top + 16)}px`;
}
const emptyPage = (text) => !/\S/.test(text.replace(/^---[\s\S]*?\n---[ \t]*(?:\n|$)/, '').replace(/^#{1,6}[ \t].*$/m, ''));
function updateStart() {
  const t = activeTab();
  const on = !!t && curType() === 'md' && isRich() && S.workspace && !t.path.startsWith(TEMPLATE_DIR + '/') && emptyPage(t.text);
  if (!on) { if (startEl) startEl.hidden = true; return; }
  if (!startEl) {
    startEl = document.createElement('div'); startEl.className = 'start-with'; startEl.setAttribute('role', 'group'); startEl.setAttribute('aria-label', tr('app.start-with'));
    $('#pane-rich .rich-page').append(startEl);
    startEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-start]'); if (!b) return;
      const k = b.dataset.start;
      if (k === 'empty') { rich.focus?.(); rich.editor.commands.focus('end'); }
      else if (k === 'gallery') templateGallery('insert');
      else if (k === 'import') importDocument();
      else { const tpl = listTemplates(S.files).find((x) => x.id === k); if (tpl) applyTemplate(tpl); }
    });
  }
  const all = listTemplates(S.files), recent = (S.settings.templateRecent || []);
  const byId = (id) => all.find((x) => x.id === id || x.name === id);
  const picks = []; for (const id of [...recent, ...all.filter((x) => x.source === 'mine').map((x) => x.id), 'Meeting notes', 'Project brief', 'Decision log', 'Status report']) { const x = byId(id); if (x && !picks.includes(x)) picks.push(x); if (picks.length === 4) break; }
  startEl.hidden = false; placeStart();
  const sig = picks.map((x) => x.id).join('|'); if (startEl.dataset.sig === sig) return; startEl.dataset.sig = sig;
  startEl.innerHTML = `<p class="start-title">${tr('app.start-with')}</p><div class="start-grid">
    <button type="button" class="start-card" data-start="empty">${icons.file || ''}<span class="start-name">${tr('app.empty-page')}</span><span class="start-sub">${tr('app.just-start-writing')}</span></button>
    ${picks.map((x) => `<button type="button" class="start-card" data-start="${esc(x.id)}"><span class="start-glyph" aria-hidden="true">${esc(x.icon || '📄')}</span><span class="start-name">${esc(x.name)}</span><span class="start-sub">${esc(x.desc || x.category || '')}</span></button>`).join('')}
    <button type="button" class="start-card start-more" data-start="gallery">${icons.template || icons.plus || ''}<span class="start-name">${tr('app.all-templates')}</span><span class="start-sub">${tr('app.browse-the-gallery')}</span></button>
    <button type="button" class="start-card start-more" data-start="import">${icons.upload || icons.plus || ''}<span class="start-name">${tr('app.import')}</span><span class="start-sub">${tr('app.word-or-html')}</span></button></div>`;
}
function renderStatus() {
  updateStart();
  if (app.dataset.dock === 'info') infoSoon();
  const t = activeTab();
  if (!t) { ['#st-path', '#st-words', '#st-time', '#st-cursor'].forEach((s) => ($(s).textContent = '')); return; }
  const words = (t.text.replace(/^---[\s\S]*?---/, '').replace(/```[\s\S]*?```/g, '').match(/[\p{L}\p{N}’'-]+/gu) || []).length;
  const fmt = new Intl.NumberFormat();
  $('#st-path').textContent = t.path;
  if (curType() !== 'md') { $('#st-words').textContent = S.surfaceStatus || ''; $('#st-time').textContent = ''; $('#st-cursor').textContent = app.dataset.modeView === 'visual' ? '' : tr('app.cursor-pos', { line: S.cursor.line, col: S.cursor.col }); return; }
  $('#st-words').textContent = tr('app.words', { n: words });
  $('#st-time').textContent = tr('app.min-read', { n: Math.max(1, Math.round(words / 230)) });
  $('#st-cursor').textContent = isRich() ? '' : S.cursor.selection ? tr('app.n-selected', { n: S.cursor.selection.length }) : tr('app.cursor-pos', { line: S.cursor.line, col: S.cursor.col });
  const st = isRich() ? S.richStats : null; const zoomEl = $('#st-zoom');
  if (st) {
    $('#st-words').textContent = st.selection ? tr('app.words-of', { n: st.selection.words, total: fmt.format(st.words) }) : tr('app.words', { n: st.words });
    $('#st-time').textContent = st.selection ? tr('app.chars-selected', { n: st.selection.chars }) : `${tr('app.chars', { n: st.chars })} · ${tr('app.min-read', { n: Math.max(1, Math.round(st.words / 230)) })}`;
    zoomEl.hidden = false; $('#st-zoom-val').textContent = `${Math.round(st.zoom * 100)}%`; $('#st-zoom-val').setAttribute('aria-label', tr('app.zoom-reset', { pct: Math.round(st.zoom * 100) }));
  } else zoomEl.hidden = true;
}

/* ============ empty states ============ */
function showEmpty(html) { const e = $('#empty-state'); e.innerHTML = `<div class="empty-inner">${html}</div>`; e.hidden = false; }
function hideEmpty() { $('#empty-state').hidden = true; }
function showWelcome() {
  S.workspace = null; S.tabs = []; S.active = null;
  $('#workspace-name').textContent = tr('ui.no-folder');
  $('#tree').innerHTML = '<div class="side-empty">' + tr('app.open-a-folder-to-see-its-notes-here') + '</div>';
  renderTabs(); renderStatus(); hideAiBanner();
  const recent = (S.settings.recent || []).slice(0, 5);
  showEmpty(`
    <h1>${tr('app.open-a-folder-and-start-writing')}</h1>
    <p>${tr('app.folio-edits-plain-markdown-files-on-yo')}</p>
    <div class="empty-actions">
      <button class="btn btn-primary btn-lg" type="button" data-act="choose">${tr('app.open-folder')}</button>
      <button class="btn btn-lg" type="button" data-act="ai">${tr('app.connect-an-ai')}</button>
    </div>
    ${recent.length ? `<div class="recent"><h2>${tr('app.recent-folders')}</h2><ul class="recent-list">${recent.map((d) => `<li><button type="button" data-recent="${esc(d)}"><span class="recent-name">${esc(d.split(/[\\/]/).filter(Boolean).pop())}</span><span class="recent-path">${esc(d)}</span></button></li>`).join('')}</ul></div>` : ''}`);
}
function showNoNote() {
  hideAiBanner();
  $('#preview').innerHTML = ''; editor.setDoc(''); renderOutline(); renderStatus();
  showEmpty(`
    <h1>${tr('app.pick-a-note-or-start-a-new-one')}</h1>
    <p>${tr('app.everything-saves', { key: keyLabel('Mod+P') })}</p>
    <div class="empty-actions">
      <button class="btn btn-primary btn-lg" type="button" data-act="new">${tr('app.new-note-2')}</button>
      <button class="btn btn-lg" type="button" data-act="quick-open">${tr('app.quick-open')}</button>
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
  let tpl = null;
  if (type === 'slides') { tpl = await slideTemplateGallery({ mode: 'new' }); if (tpl == null) return; }
  try {
    const title = stem(file).replace(/\.slides$/i, '');
    const mdTpl = type === 'md' && res.template ? res.template : null;
    const asked = mdTpl ? await askFilled(mdTpl, { title }) : null; if (mdTpl && asked == null) return;
    let content = mdTpl ? asked.split(CURSOR).join('') : (NEW_CONTENT[type] || NEW_CONTENT.md)(stem(file));
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
function newDocSheet({ folder, type = 'md', fromTemplate = false }) {
  return new Promise((resolve) => {
    const d = $('#sheet-prompt');
    const types = Object.keys(TYPE_INFO).filter((t) => t === 'md' || SURFACES[t]);
    d.innerHTML = `<form method="dialog">
      <div class="sheet-head"><div><h2 id="prompt-title">${tr('app.new-document')}</h2><p>${folder ? `In ${esc(folder)}` : 'At the top of the folder'}. Every type is a Markdown file your AI can read and edit.</p></div></div>
      <div class="sheet-body">
        <fieldset class="type-pick"><legend class="visually-hidden">${tr('app.type')}</legend>
          ${types.map((t) => `<label class="type-card"><input type="radio" name="type" value="${t}" ${t === type ? 'checked' : ''}><span class="type-icon">${typeIcon(t)}</span><span class="type-name">${tr(`app.type-${t}`)}</span><span class="type-desc">${tr(`app.typedesc-${t}`)}</span></label>`).join('')}
        </fieldset>
        <div class="field" style="margin-top:var(--space-md)"><label for="prompt-input">${tr('app.name')}</label>
          <input class="input" id="prompt-input" type="text" autocomplete="off" spellcheck="false" value="Untitled" required aria-describedby="prompt-help"><span class="field-help" id="prompt-help"></span></div>
        <div class="field new-tpl" style="margin-top:var(--space-sm)"><label for="new-template">${tr('app.template')}</label>
          <select class="rb-select" id="new-template"><option value="">${tr('app.blank-page')}</option>${listTemplates(S.files).map((t, i) => `<option value="${i}">${esc(t.name)}${t.starter ? ' (starter)' : ''}</option>`).join('')}</select></div>
      </div>
      <div class="sheet-foot"><button class="btn" type="button" data-cancel>${tr('app.cancel')}</button><button class="btn btn-primary" type="submit">${tr('app.create')}</button></div></form>`;
    const input = $('#prompt-input', d);
    const done = (v) => { d.close(); resolve(v); };
    d.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v || /[\\:*?"<>|]/.test(v)) { $('#prompt-help', d).textContent = tr('app.bad-name'); $('#prompt-help', d).dataset.error = 'true'; input.focus(); return; }
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
async function slideTemplateGallery({ mode = 'new' } = {}) {
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
  const name = await prompt({ title: tr('app.new-folder-2'), label: tr('app.name'), value: '', action: tr('app.create') });
  if (!name) return;
  try {
    const p = (parent ? parent + '/' : '') + name; await folio.mkdir(p); S.expanded.add(p); await refreshTree();
    let rec = null;
    actions.push({ scope: S.workspace, label: `created folder ${name}`, undo: async () => { rec = await trashRaw(p); }, redo: async () => { await untrashRaw(rec); } });
    updateHistoryButtons();
  } catch (e) { toast(e.message, { kind: 'error' }); }
}
async function renamePath(p, isDir) {
  const name = await prompt({ title: tr(isDir ? 'app.rename-folder' : 'app.rename-note'), label: tr('app.name'), value: isDir ? base(p) : stem(p), action: tr('app.rename-2') });
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
    const what = isDir ? base(from) : stem(from);
    toast(n ? tr('app.updated-links-in-n-documents', { n }) : tr(dirOf(from) === dirOf(to) ? 'app.renamed-what' : 'app.moved-what', { what }), { action: [tr('app.undo'), () => fileUndo('undo')] });
    updateHistoryButtons();
  } catch (e) { toast(e.message, { kind: 'error' }); }
}
/* X3: locked pages live in the app settings, per workspace folder (relative paths inside it), never in the .md */
const lockMap = () => { const m = S.workspace && S.settings.lockedPages?.[S.workspace]; return m && typeof m === 'object' ? m : {}; };
const isLocked = (p) => !!p && lockMap()[p] === true;
function saveLocks(map) {
  const all = {}; for (const [k, v] of Object.entries(S.settings.lockedPages || {})) if (v && typeof v === 'object' && k !== S.workspace) all[k] = v;
  if (Object.keys(map).length) all[S.workspace] = map;
  S.settings.lockedPages = all; saveSetting({ lockedPages: all });
}
let lockApplied = false;
function applyLock() {
  const on = curType() === 'md' && isLocked(S.active);
  if (rich && on !== lockApplied) rich.setLocked(on);
  lockApplied = on;
  // only when it differs: reconfiguring on every activation ended slide text editing, and setDoc() resets it to editable
  if (editor && editor.view.state.readOnly !== on) editor.setReadOnly(on);
}
function setPageLock(p, on) {
  if (!p || !S.workspace) return;
  const lp = { ...lockMap() };
  if (on) lp[p] = true; else delete lp[p];
  saveLocks(lp);
  if (p === S.active) applyLock();
  toast(tr(on ? 'app.page-locked' : 'app.page-unlocked'));
}
/** B8: open or close every toggle of the page in one undo step; with no argument it opens them all unless all are open */
function toggleAllToggles(open) {
  if (curType() !== 'md' || !isRich() || app.dataset.modeView !== 'edit') return toast(tr('app.open-a-page-in-the-write-view-first'));
  if (isLocked(S.active)) return toast(tr('app.this-page-is-locked'));
  const { open: o, closed: c } = rich.toggleCount();
  if (o + c === 0) return toast(tr('app.no-toggles-on-this-page'));
  rich.setToggles(open ?? c > 0);
}
function retargetTabs(from, to) {
  const lp = lockMap();
  if (Object.keys(lp).some((k) => k === from || k.startsWith(from + '/'))) {
    const next = {}; for (const [k, v] of Object.entries(lp)) next[k === from || k.startsWith(from + '/') ? to + k.slice(from.length) : k] = v;
    saveLocks(next);
  }
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
/* [PAGE ACTIONS]: duplicate, move to…, copy link (sidebar menu, ••• menu, palette) */
async function duplicatePath(p, isDir) {
  try {
    for (const t of S.tabs.filter((x) => (x.path === p || x.path.startsWith(p + '/')) && x.text !== x.saved)) { // the copy has what is on screen
      await saveTab(t).catch(() => {});
      if (t.text !== t.saved) throw new Error(tr('app.duplicate-not-saved', { name: stem(t.path) }));
    }
    const r = await folio.duplicate(p, tr('app.copy-suffix'));
    if (isDir) S.expanded.add(r.to);
    await refreshTree();
    if (!isDir) await openFile(r.to);
    let rec = null;
    actions.push({ scope: S.workspace, label: `duplicated ${isDir ? base(p) : stem(p)}`,
      undo: async () => { rec = await trashRaw(r.to); if (r.assets.length) await folio.assetsRemove(r.assets, false); },
      redo: async () => { await untrashRaw(rec); if (r.assets.length) await folio.assetsRestore(r.assets); await refreshTree(); if (!isDir) await openFile(r.to); } });
    toast(tr('app.duplicated-what', { what: isDir ? base(r.to) : stem(r.to) }), { action: [tr('app.undo'), () => fileUndo('undo')] });
    updateHistoryButtons();
  } catch (e) { toast(e.message, { kind: 'error' }); }
}
function allDirs(nodes = S.tree || [], out = []) { for (const n of nodes) if (n.type === 'dir') { out.push(n.path); allDirs(n.children, out); } return out; }
/** Move to…: the quick switcher, listing the folders the item can go to */
function moveToPicker(p, isDir) {
  if (!p) return;
  openPalette('move', { p, isDir });
}
function copyPageLink(p) { if (p) copyRef(p, '', 'link'); }
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
  const ok = await confirmSheet({ title: tr('app.move-p-to-the-trash', { p: isDir ? base(p) : stem(p) }), body: tr('app.you-can-undo-this-or-restore-it-from-the-system-trash'), action: tr('app.move-to-trash'), danger: true });
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
    // save the open pages first: choosing a folder switches the main process to it at once, and a later save would land there
    await actions.idle(); if (!(await saveAllOrAsk())) return;
    const dir = await folio.chooseWorkspace();
    if (!dir) { S.writesFrozen = false; return; } // nothing changed: the tabs (and any unsaved text) stay as they were
    await switchWorkspace(dir, { saved: true }); // main already points at the new folder: saving again would write there
  } catch (e) { S.writesFrozen = false; toast(e.message, { kind: 'error' }); }
}
async function switchWorkspace(dir, { saved = false } = {}) {
  if (!saved) { await actions.idle(); if (!(await saveAllOrAsk())) return false; } // let a file action still running finish in the folder it started in
  for (const t of S.tabs) t.dead = true; // the old tabs go now: nothing of theirs is written any more (not even a pending Retry)
  S.tabs = []; S.active = null; S.aiEdits.clear(); S.expanded.clear(); resetRemote();
  S.writesFrozen = false;
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
  if (!S.workspace) { $('#results').innerHTML = '<div class="side-empty">' + tr('app.open-a-folder-to-search-it') + '</div>'; return; }
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
    $('#results-head').textContent = results.length ? `${tr('app.n-matches', { n: total })} ${tr('app.in-n-notes', { n: results.length })}` : tr('app.no-matches-head');
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    $('#results').innerHTML = results.length ? results.map((r) => `
      <button class="result" type="button" data-file="${esc(r.path)}" data-line="${r.matches[0]?.line || 1}">
        <span class="result-name">${esc(stem(r.path))}</span>
        ${dirOf(r.path) ? `<span class="result-folder">${esc(dirOf(r.path))}</span>` : ''}
        ${r.matches.slice(0, 2).map((m) => `<span class="result-line">${esc(m.text).replace(re, (x) => `<mark>${x}</mark>`)}</span>`).join('')}
      </button>`).join('') : `<div class="side-empty">${esc(tr('app.nothing-matches', { q }))}</div>`;
  } catch (e) { $('#results').innerHTML = `<div class="side-empty">${esc(tr('app.search-failed', { message: e.message }))}</div>`; }
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
function onAiEdit({ path: p, before, after, client, created, orphans, aiKept = true }) {
  if (orphans?.length) { const pend = pendingAssets.get(p) || new Map(); for (const o of orphans) pend.set(o.path, o.bytes); pendingAssets.set(p, pend); clearTimeout(assetTimer); assetTimer = setTimeout(askAssetRemoval, 4000); }
  const prior = S.aiEdits.get(p);
  const rec = { before: prior && Date.now() - prior.at < 10 * 60e3 ? prior.before : before, after, client, at: Date.now(), created };
  rec.stats = lineChanges(rec.before, after);
  S.aiEdits.set(p, rec);
  const t = tabOf(p);
  if (t) {
    const userDirty = t.text !== t.saved;
    t.saved = after;
    if (userDirty && p !== S.active) {
      // a background tab has no undo: the draft is replaced only once it is safely kept as a version; until then (or if that fails) the tab keeps it
      const draft = t.text;
      folio.historySnapshot(p, draft, 'before-ai', true).catch(() => false).then((kept) => {
        // only the latest AI edit replaces the draft
        if (kept !== false && S.aiEdits.get(p)?.after === after && t.text === draft && S.active !== p && tabOf(p) === t) { t.text = after; renderTabs(); toast(tr('app.ai-replaced-draft', { client, name: stem(p) }), { action: [tr('app.open'), () => openFile(p)] }); }
        else if (kept === false) toast(tr(aiKept ? 'app.ai-draft-kept-in-tab' : 'app.ai-draft-kept-in-tab-file', { client, name: stem(p) }), { kind: 'error', action: [tr('app.open'), () => openFile(p)] });
      });
    } else if (p === S.active) { setActiveText(after); highlightAi(p, { fresh: true }); showAiBanner(p); renderPreview(); renderOutline(); if (userDirty) toast(tr('app.client-changed-this-note-while-you-had', { client, Z: keyLabel('Mod+Z') })); }
    else t.text = after;
  } else {
    toast(tr(created ? 'app.ai-created' : 'app.ai-edited', { client, name: stem(p) }), { action: [tr('app.open'), () => openFile(p)] });
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
  $('#ai-banner-text').innerHTML = `<strong>${esc(rec.client)}</strong> ${tr(rec.created ? 'app.ai-banner-created' : 'app.ai-banner-edited')} <span>${bits ? `(${bits})` : ''} ${tr('app.at-time', { time: new Date(rec.at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) })}</span>`;
  $('#ai-banner').hidden = false;
  $('#ai-banner-undo').textContent = tr(rec.created ? 'app.remove-note' : 'ui.undo');
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
    toast(tr('app.restored-p-to-how-it-was-before-client', { p: stem(p), client: rec.client }));
  } catch (e) { toast(tr('app.could-not-undo-message', { message: e.message }), { kind: 'error' }); }
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
      for (const k of keep) rows.push(k ? `<div class="diff-line"><span class="n">${k[2]}</span><span class="s"></span><span class="t">${esc(k[0]) || ' '}</span></div>` : '<div class="diff-gap">' + tr('app.unchanged-lines-hidden') + '</div>');
      a += lines.length; b += lines.length;
    } else if (part.removed) { lines.forEach((l, i) => rows.push(`<div class="diff-line del"><span class="n">${a + i}</span><span class="s">−</span><span class="t">${esc(l) || ' '}</span></div>`)); a += lines.length; }
    else { lines.forEach((l, i) => rows.push(`<div class="diff-line add"><span class="n">${b + i}</span><span class="s">+</span><span class="t">${esc(l) || ' '}</span></div>`)); b += lines.length; }
  });
  const d = $('#sheet-diff');
  d.innerHTML = `
    <div class="sheet-head"><div><h2 id="diff-title">${esc(tr('app.changes-by', { client: rec.client }))}</h2><p>${esc(tr('app.compared-with-before', { path: p }))}</p></div>
      <button class="icon-btn" type="button" data-close-sheet aria-label="${tr('app.close')}">${icons.close}</button></div>
    <div class="sheet-body"><div class="diff-summary"><span>+ ${rec.stats.added} added</span><span>− ${rec.stats.removed} removed</span></div><div class="diff">${rows.join('')}</div></div>
    <div class="sheet-foot"><button class="btn" type="button" data-diff="undo">${tr('app.undo-all-changes')}</button><button class="btn btn-primary" type="button" data-diff="keep">${tr('app.keep-changes')}</button></div>`;
  d.showModal(); d.querySelector('[data-diff="keep"]').focus();
}

/* ============ AI panel ============ */
function renderAiStatus() {
  const m = S.mcp || {};
  const el = $('#ai-status');
  const recent = m.activity?.[0];
  el.dataset.state = m.port ? 'on' : 'off';
  $('#ai-status-title').textContent = tr(m.port ? (m.allowWrite ? 'app.ai-read-edit' : 'app.ai-read-only') : 'app.ai-off');
  $('#ai-status-sub').textContent = m.error ? m.error : !m.enabled ? tr('app.ai-turn-on') : recent ? tr('app.ai-last-used', { client: recent.client }) : tr('app.ai-connect-more');
}
async function openAiSheet() {
  const d = $('#sheet-ai');
  const [conn, token] = await Promise.all([folio.connections().catch(() => null), folio.mcpToken().catch(() => '')]);
  const m = S.mcp || {};
  const logos = { claude: 'C', cursor: 'Cu', vscode: 'VS', windsurf: 'W', lmstudio: 'LM' };
  d.innerHTML = `
    <div class="sheet-head"><div><h2 id="ai-title">${tr('app.connect-your-ai')}</h2><p>${tr('app.folio-runs-an-mcp-server-on-this-compu')}</p></div>
      <button class="icon-btn" type="button" data-close-sheet aria-label="${tr('app.close')}">${icons.close}</button></div>
    <div class="sheet-body">
      <section class="group"><div class="rows">
        <div class="row"><div class="row-main"><span class="row-title">${tr('app.allow-ai-access')}</span><span class="row-sub">${m.port ? `Listening on 127.0.0.1, port ${m.port}` : m.error ? esc(m.error) : 'The server is stopped.'}</span></div>
          <label class="switch"><input type="checkbox" role="switch" data-setting="mcpEnabled" ${m.enabled ? 'checked' : ''} aria-label="${tr('app.allow-ai-access')}"></label></div>
        <div class="row"><div class="row-main"><span class="row-title">${tr('app.let-ai-edit-notes')}</span><span class="row-sub">${tr('app.off-means-assistants-can-only-read-and')}</span></div>
          <label class="switch"><input type="checkbox" role="switch" data-setting="allowWrite" ${m.allowWrite ? 'checked' : ''} aria-label="${tr('app.let-ai-edit-notes')}"></label></div>
      </div></section>

      <section class="group"><h3>${tr('app.apps-on-this-computer')}</h3><p class="group-note">${tr('app.connect-writes-folio-into-the-app-s-mc')}</p>
        <div class="rows">${conn ? conn.list.map((c) => `
          <div class="row"><span class="app-logo" aria-hidden="true">${logos[c.id] || c.name[0]}</span>
            <div class="row-main"><span class="row-title">${esc(c.name)}</span><span class="row-sub">${c.installed ? esc(c.restart) : tr(c.appPresent ? 'app.found-here' : 'app.not-found')}</span></div>
            <span class="row-state" data-on="${c.installed}">${c.installed ? `${icons.check} Connected` : ''}</span>
            <div class="row-actions">
              <button class="icon-btn" type="button" data-copy-snippet="${c.id}" aria-label="${esc(tr('app.copy-name-config', { name: c.name }))}" data-tip="${tr('app.copy-config')}">${icons.copy}</button>
              ${c.installed ? `<button class="btn" type="button" data-uninstall="${c.id}">${tr('app.disconnect')}</button>` : `<button class="btn" type="button" data-install="${c.id}">${tr('app.connect')}</button>`}
            </div></div>`).join('') : '<div class="row"><span class="row-sub">' + tr('app.could-not-read-the-app-configs') + '</span></div>'}
        </div></section>

      <section class="group"><h3>${tr('app.claude-code')}</h3><p class="group-note">${tr('app.run-this-once-in-a-terminal')}</p>
        <div class="codebox"><code id="cc-cmd">${esc(conn?.claudeCode || '')}</code><button class="icon-btn" type="button" data-copy="#cc-cmd" aria-label="${tr('app.copy-command')}">${icons.copy}</button></div></section>

      <section class="group"><h3>${tr('app.any-other-mcp-client')}</h3><p class="group-note">${tr('app.streamable-http-local-only-send-the-to')}</p>
        <div class="rows">
          <div class="row"><div class="row-main"><span class="row-title">${tr('app.url')}</span><span class="row-sub" id="mcp-url">${esc(conn?.httpUrl || 'Server stopped')}</span></div><button class="icon-btn" type="button" data-copy="#mcp-url" aria-label="${tr('app.copy-url')}">${icons.copy}</button></div>
          <div class="row"><div class="row-main"><span class="row-title">${tr('app.token')}</span><span class="row-sub" id="mcp-token" data-secret="${esc(token)}">${'•'.repeat(24)}</span></div>
            <button class="btn btn-quiet" type="button" data-reveal-token>${tr('app.show')}</button><button class="icon-btn" type="button" data-copy-token aria-label="${tr('app.copy-token')}">${icons.copy}</button><button class="btn" type="button" data-rotate>${tr('app.new-token')}</button></div>
        </div></section>

      <section class="group"><h3>${tr('app.recent-activity')}</h3><div class="rows" id="ai-activity">${activityHtml()}</div></section>
    </div>`;
  if (!d.open) { d.showModal(); d.querySelector('.sheet-body input, .sheet-body button')?.focus(); }
}
function activityHtml() {
  const a = S.mcp?.activity || [];
  if (!a.length) return '<p class="activity-empty">' + tr('app.no-assistant-has-used-folio-yet-once-c') + '</p>';
  const verbs = { list_notes: 'listed notes', read_note: 'read', search_notes: 'searched for', get_outline: 'read the outline of', get_open_note: 'looked at your open note', create_note: 'created', write_note: 'rewrote', edit_note: 'edited', append_to_note: 'appended to', move_note: 'moved', open_note: 'opened' };
  return `<ul class="activity">${a.slice(0, 12).map((x) => `<li><span class="a-time">${new Date(x.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span class="a-client">${esc(x.client)}</span><span class="a-what">${esc(verbs[x.tool] || x.tool)} ${esc(x.path || '')}</span></li>`).join('')}</ul>`;
}

/* ============ settings sheet ============ */
function openSettings() {
  const s = S.settings;
  const d = $('#sheet-settings');
  d.innerHTML = `
    <div class="sheet-head"><div><h2 id="settings-title">${tr('app.settings-2')}</h2><p>${tr('app.saved-on-this-computer')}</p></div><button class="icon-btn" type="button" data-close-sheet aria-label="${tr('app.close')}">${icons.close}</button></div>
    <div class="sheet-body">
      <section class="group"><h3>${tr('app.appearance')}</h3><div class="rows">
        <div class="row"><div class="row-main"><label class="row-title" for="set-theme">${tr('app.theme')}</label></div>
          <select class="select" id="set-theme" data-setting="theme"><option value="system">${tr('app.match-system')}</option><option value="light">${tr('app.light')}</option><option value="dark">${tr('app.dark')}</option></select></div>
        <div class="row"><div class="row-main"><label class="row-title" for="set-lang">${esc(tr('settings.language'))}</label><span class="row-sub">${esc(tr('settings.languageHint'))}</span></div>
          <select class="select" id="set-lang" data-setting="language">${Object.entries(LOCALES).map(([c, l]) => `<option value="${c}">${esc(l.name)}</option>`).join('')}</select></div>
        <div class="row"><div class="row-main"><label class="row-title" for="set-size">${tr('app.text-size')}</label><span class="row-sub">${tr('app.editor-and-preview')}</span></div>
          <select class="select" id="set-size" data-setting="fontSize">${[14, 15, 16, 17, 18, 20, 22].map((n) => `<option value="${n}">${n} pt</option>`).join('')}</select></div>
        <div class="row"><div class="row-main"><label class="row-title" for="set-width">${tr('app.line-length')}</label><span class="row-sub">${tr('app.characters-per-line')}</span></div>
          <select class="select" id="set-width" data-setting="lineWidth">${[60, 66, 72, 80, 96, 120].map((n) => `<option value="${n}">${n}</option>`).join('')}</select></div>
        <div class="row"><div class="row-main"><label class="row-title" for="set-date">${esc(tr('date.setting'))}</label><span class="row-sub">${esc(tr('date.setting-hint'))}</span></div>
          <select class="select" id="set-date" data-setting="dateStyle">${DATE_STYLES.map((k) => `<option value="${k}">${esc({ relative: tr('date.style-relative'), full: tr('date.style-full'), short: tr('date.style-short'), dmy: tr('date.style-dmy'), mdy: tr('date.style-mdy'), iso: tr('date.style-iso') }[k])} · ${esc(formatDay(todayKey(), { style: k, lang: locale() }))}</option>`).join('')}</select></div>
      </div></section>
      <section class="group"><h3>${tr('app.writing')}</h3><div class="rows">
        <div class="row"><div class="row-main"><span class="row-title">${tr('app.load-remote-images-always')}</span><span class="row-sub">${tr('app.load-remote-images-always-help')}</span></div><label class="switch"><input type="checkbox" role="switch" data-setting="remoteImages" ${s.remoteImages ? 'checked' : ''} aria-label="${tr('app.load-remote-images-always')}"></label></div>
        <div class="row"><div class="row-main"><span class="row-title">${tr('app.check-spelling')}</span></div><label class="switch"><input type="checkbox" role="switch" data-setting="spellcheck" ${s.spellcheck ? 'checked' : ''} aria-label="${tr('app.check-spelling')}"></label></div>
        <div class="row"><div class="row-main"><span class="row-title">${tr('app.smart-quotes-and-dashes')}</span><span class="row-sub">${tr('app.typing-becomes-in-the-write-view')}</span></div><label class="switch"><input type="checkbox" role="switch" data-setting="smartTypography" ${s.smartTypography !== false ? 'checked' : ''} aria-label="${tr('app.smart-quotes-and-dashes')}"></label></div>
      </div></section>
      <section class="group" id="set-features" aria-busy="true"><h3>${tr('app.optional-features')}</h3></section>
      <section class="group"><h3>${tr('app.about')}</h3><div class="rows">
        <div class="row"><div class="row-main"><span class="row-title">Folio ${esc(S.version || '')}</span><span class="row-sub">${tr('app.based-on-folio-by-gabriele-vaudano-fre')}</span></div>
          <button class="btn" type="button" data-open-url="https://github.com/gabrielevaudano98/folio">${tr('app.source-code')}</button></div>
      </div></section>
      <section class="group"><h3>${tr('app.ai-server')}</h3><div class="rows">
        <div class="row"><div class="row-main"><label class="row-title" for="set-port">${tr('app.port')}</label><span class="row-sub field-help" id="port-help">${tr('app.local-only-1024-to-65535')}</span></div>
          <input class="input" id="set-port" type="text" inputmode="numeric" name="port" autocomplete="off" value="${s.mcpPort}" style="width:7rem" aria-describedby="port-help"></div>
      </div></section>
    </div>`;
  $('#set-theme', d).value = s.theme; $('#set-lang', d).value = s.language || 'en'; $('#set-size', d).value = s.fontSize; $('#set-width', d).value = s.lineWidth; $('#set-date', d).value = s.dateStyle || 'relative';
  if (!d.open) d.showModal();
  $(`#${document.activeElement?.id && d.contains(document.activeElement) ? document.activeElement.id : 'set-theme'}`, d)?.focus();
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

/* ============ link health: every broken reference in the workspace, grouped by page ============ */
async function openLinkHealth() {
  const d = $('#sheet-links');
  const broken = await folio.brokenLinks().catch(() => []);
  const byFile = new Map(); for (const b of broken) { if (!byFile.has(b.path)) byFile.set(b.path, []); byFile.get(b.path).push(b); }
  d.innerHTML = `<div class="sheet-head"><div><h2 id="links-title">${esc(tr('links.title'))}</h2><p>${esc(broken.length ? tr('links.summary', { n: broken.length, files: byFile.size }) : tr('links.none'))}</p></div><button class="icon-btn" type="button" data-close-sheet aria-label="${esc(tr('help.close'))}">${icons.close}</button></div>
    <div class="sheet-body">${[...byFile].map(([p, rows]) => `<section class="group"><h3>${esc(stem(p))}</h3><ul class="links-list">${rows.map((b) => { const nm = /^\[\[([^\]|#]+)\]\]$/.exec(b.ref)?.[1]?.trim(); return `<li><button type="button" class="link-open" data-open="${esc(p)}" data-line="${b.line}"><span class="bl-ref">${esc(b.ref)}</span><span class="bl-kind">${esc(tr('links.line', { n: b.line }))}</span></button>${nm ? `<button type="button" class="btn btn-quiet" data-create="${esc(nm)}">${esc(tr('links.create'))}</button>` : ''}</li>`; }).join('')}</ul></section>`).join('')}</div>`;
  d.onclick = async (e) => {
    const o = e.target.closest('[data-open]'); if (o) { d.close(); return openFile(o.dataset.open, { line: Number(o.dataset.line) }); }
    const c = e.target.closest('[data-create]'); if (!c) return;
    try { await folio.create(c.dataset.create + '.md', `# ${c.dataset.create}\n\n`); await refreshTree(); toast(tr('links.created', { name: c.dataset.create })); openLinkHealth(); } catch (er) { toast(er.message, { kind: 'error' }); }
  };
  if (!d.open) d.showModal();
}

/* ============ help sheet (shortcuts from the commands themselves, so it can't drift) ============ */
function openHelp(query = '') {
  const d = $('#sheet-help');
  const draw = (q) => {
    const secs = helpSections(COMMANDS, keyLabel, q);
    $('#help-body', d).innerHTML = secs.length ? secs.map((s) => `<section class="group" aria-labelledby="help-${s.id}"><h3 id="help-${s.id}">${esc(s.title)}</h3><dl class="help-list">${s.rows.map(([a, b]) => `<div><dt>${s.id === 'syntax' ? `<code>${esc(a)}</code>` : esc(a)}</dt><dd>${s.id === 'shortcuts' ? `<kbd>${esc(b)}</kbd>` : esc(b)}</dd></div>`).join('')}</dl></section>`).join('') : `<p class="info-empty">${esc(tr('help.none'))}</p>`;
  };
  if (!d.open) {
    d.innerHTML = `<div class="sheet-head"><div><h2 id="help-title">${esc(tr('help.title'))}</h2></div><button class="icon-btn" type="button" data-close-sheet aria-label="${esc(tr('help.close'))}">${icons.close}</button></div>
      <div class="sheet-body"><input class="input help-search" id="help-search" type="search" name="help-search" autocomplete="off" aria-label="${esc(tr('help.search'))}" placeholder="${esc(tr('help.search'))}" value="${esc(query)}"><div id="help-body"></div></div>`;
    $('#help-search', d).addEventListener('input', (e) => draw(e.target.value));
    d.showModal();
  }
  draw(query); $('#help-search', d).focus();
}

/* command titles come from the catalogue (cmd.<id>); English stays in `en`, which the dedupe below compares against */
function localizeCommands() { for (const c of COMMANDS) { c.en ??= c.title; const k = c.id === 'reveal' && S.platform === 'darwin' ? 'cmd.reveal-mac' : `cmd.${c.id}`; const v = tr(k); c.title = v === k ? c.en : v; } }

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
  { id: 'new-from-template', title: 'New page from a template…', run: () => templateGallery('new') },
  { id: 'template-gallery', title: 'Templates: browse the gallery', run: () => templateGallery('insert') },
  { id: 'save-as-template', title: 'Save this page as a template', run: () => (curType() === 'md' && S.active ? writeTemplate(stem(S.active), setMeta(activeTab().text, { description: '', category: 'General' })).then((p) => toast(`Saved as a template: ${p}.`)) : toast('Open a page first.')) },
  { id: 'comment', title: 'Comment on the selection', key: 'Mod+Alt+M', run: () => rich.run('comment') },
  { id: 'suggest-mode', title: 'Suggesting: on or off (track changes)', run: () => rich.run('suggest') },
  { id: 'review-pane', title: 'Show or hide comments and suggestions', run: () => rich.run('reviewPane') },
  { id: 'accept-all', title: 'Accept all suggestions', run: () => rich.run('acceptAll') },
  { id: 'reject-all', title: 'Reject all suggestions', run: () => rich.run('rejectAll') },
  { id: 'lock-page', title: 'Lock or unlock this page', run: () => (curType() === 'md' && S.active ? setPageLock(S.active, !isLocked(S.active)) : toast(tr('app.open-a-page-first'))) },
  { id: 'toggle-all-toggles', title: 'Expand or collapse all toggles', key: 'Mod+Alt+Shift+T', run: () => toggleAllToggles() },
  { id: 'expand-toggles', title: 'Expand all toggles', run: () => toggleAllToggles(true) },
  { id: 'collapse-toggles', title: 'Collapse all toggles', run: () => toggleAllToggles(false) },
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
  { id: 'link-health', title: 'Check links in all pages…', run: () => openLinkHealth() },
  { id: 'help', title: 'Help: shortcuts and syntax', key: 'F1', run: () => openHelp() },
  { id: 'ai', title: 'Connect AI assistants…', key: 'Mod+Shift+A', run: openAiSheet },
  { id: 'assets-clean', title: 'Files: clean up unused files…', run: () => openAssets() },
  { id: 'assets-ask', title: 'Files: ask before removing a file from the folder', run: () => { saveSetting({ assetRemoval: 'ask' }); toast('Folio will ask when a file is removed from a page.'); } },
  { id: 'history', title: 'Version history', key: 'Mod+Alt+Shift+H', run: () => openHistory() },
  { id: 'name-version', title: 'Name the current version…', key: 'Mod+Alt+Shift+S', run: () => nameCurrentVersion() },
  { id: 'export', title: 'Export…', key: 'Mod+Shift+E', run: () => openExport() },
  { id: 'export-docx', title: 'Export as Word…', run: () => exportAs('docx') },
  { id: 'import-document', title: 'Import Word or HTML as a page…', run: () => importDocument() },
  { id: 'paste-plain', title: 'Paste as plain text', key: 'Mod+Shift+V', run: () => pastePlain() },
  { id: 'export-html', title: 'Export as HTML…', run: () => exportAs('html') },
  { id: 'export-md', title: 'Export as portable Markdown…', run: () => exportAs('md') },
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
  { id: 'present', title: 'Present slides', key: 'Mod+Enter', run: () => {
    if (curType() !== 'slides') return toast('Open a slides document to present it.');
    loadSurface('slides').then(() => { if (curType() === 'slides') (curSurface() || surfaceFor('slides'))?.present(); }, (e) => toast(e.message, { kind: 'error' })); // the editor may still be loading
  } },
  { id: 'new-slides', title: 'New slides…', run: () => newNote(undefined, 'slides') },
  { id: 'export-pdf', title: 'Export as PDF…', run: () => exportAs('pdf') },
  { id: 'reveal', title: 'Show in folder', run: () => folio.reveal(S.active || '') },
  { id: 'rename', title: 'Rename note…', run: () => S.active && renamePath(S.active, false) },
  { id: 'trash', title: 'Move note to Trash', run: () => S.active && trashPath(S.active, false) },
  { id: 'duplicate', title: 'Duplicate note', run: () => S.active && duplicatePath(S.active, false) },
  { id: 'move-to', title: 'Move note to…', run: () => S.active && moveToPicker(S.active, false) },
  { id: 'copy-page-link', title: 'Copy link to note', run: () => copyPageLink(S.active) },
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
  { id: 'close-folder', title: 'Close folder', run: async () => { if (!(await saveAllOrAsk())) return; for (const t of S.tabs) t.dead = true; S.writesFrozen = false; await folio.closeWorkspace(); S.settings.workspace = null; actions.clear(); nav.list = []; nav.i = -1; showWelcome(); } },
];
/* everything the / menu offers is in the palette too (the Write view inserts it, the source view types its Markdown) */
for (const it of INSERTS) {
  const title = `${tr(it.turn ? 'app.turn-into' : 'app.insert-colon')}: ${it.label}`;
  if (COMMANDS.some((c) => c.title.toLowerCase().replace(/…$/, '') === title.toLowerCase())) continue;
  COMMANDS.push({ id: 'ins-' + it.id, title, key: it.key, run: () => {
    if (curType() !== 'md') return toast(tr('app.this-inserts-into-pages'));
    if (isRich()) return rich.insert(it.id);
    if (it.md != null) return insertMd(it.md);
    toast(tr('app.switch-to-the-write-view-to-insert-thi'));
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
function openPalette(mode = 'commands', move = null) {
  pal = { mode, items: [], sel: 0, opener: document.activeElement, move };
  const input = $('#palette-input');
  input.value = mode === 'commands' ? '>' : '';
  input.placeholder = mode === 'move' ? tr('app.move-name-to', { name: move.isDir ? base(move.p) : stem(move.p) }) : tr(mode === 'commands' ? 'app.type-a-command' : 'app.go-to-note');
  $('#palette-hint').textContent = mode === 'move' ? tr('app.move-to-hint') : mode === 'commands' ? 'Delete the > to search notes instead.' : 'Type > for commands.';
  $('#palette').hidden = false;
  $$('#app, .toasts').forEach((e) => (e.inert = true));
  input.focus();
  updatePalette();
}
function closePalette() { $('#palette').hidden = true; $$('#app, .toasts').forEach((e) => (e.inert = false)); pal.opener?.focus?.(); }
function updatePalette() {
  const raw = $('#palette-input').value;
  const isCmd = pal.mode !== 'move' && raw.startsWith('>');
  const q = isCmd ? raw.slice(1).trim() : raw.trim();
  if (pal.mode === 'move') {
    const { p, isDir } = pal.move; const root = S.workspace ? S.workspace.split(/[\\/]/).filter(Boolean).pop() : tr('app.workspace-folder');
    const dirs = ['', ...allDirs()].filter((d) => d !== dirOf(p) && !(isDir && (d === p || d.startsWith(p + '/'))));
    pal.items = dirs.map((d) => ({ d, label: d || root, f: q ? fuzzy(q, d || root) : { score: 0, marks: [] } })).filter((x) => x.f)
      .sort((a, b) => b.f.score - a.f.score).slice(0, 80)
      .map(({ d, label, f }) => ({ html: `${icons.folder}<span class="palette-title">${highlight(label, f.marks)}</span>${d ? '' : `<span class="palette-sub">${esc(tr('app.top-of-the-folder'))}</span>`}`,
        run: () => { if (d) S.expanded.add(d); return movePath(p, (d ? d + '/' : '') + base(p), isDir); } }));
  } else if (isCmd) {
    pal.items = COMMANDS.map((c) => ({ c, f: fuzzy(q, c.title) || (c.en && c.en !== c.title ? fuzzy(q, c.en) : null) })).filter((x) => x.f).sort((a, b) => b.f.score - a.f.score)
      .map(({ c, f }) => ({ html: `<span class="palette-title">${highlight(c.title, f.marks)}</span>${c.key ? `<kbd>${esc(keyLabel(c.key))}</kbd>` : ''}`, run: c.run }));
  } else {
    pal.items = S.files.map((p) => ({ p, f: fuzzy(q, stem(p)) || (q.includes('/') ? fuzzy(q, p) : null) })).filter((x) => x.f)
      .sort((a, b) => b.f.score - a.f.score || (tabOf(b.p) ? 1 : 0) - (tabOf(a.p) ? 1 : 0)).slice(0, 60)
      .map(({ p, f }) => ({ html: `${icons.doc}<span class="palette-title">${highlight(stem(p), f.marks.filter(([a]) => a < stem(p).length))}</span><span class="palette-sub">${esc(dirOf(p))}</span>`, run: () => openFile(p) }));
    if (q && !pal.items.length && S.workspace) pal.items.push({ html: `${icons.plus}<span class="palette-title">${esc(tr('app.create-note-q', { q }))}</span>`, run: async () => { try { const p = await folio.create(q.endsWith('.md') ? q : q + '.md', `# ${q.split('/').pop()}\n\n`); await refreshTree(); openFile(p); } catch (e) { toast(e.message, { kind: 'error' }); } } });
  }
  pal.sel = Math.min(pal.sel, Math.max(0, pal.items.length - 1));
  $('#palette-list').innerHTML = pal.items.length ? pal.items.map((it, i) => `<li class="palette-item" role="option" id="pi-${i}" data-i="${i}" aria-selected="${i === pal.sel}">${it.html}</li>`).join('')
    : `<li class="palette-empty">${tr(S.workspace || isCmd ? 'app.no-matches' : 'app.open-a-folder-first')}</li>`;
  $('#palette-input').setAttribute('aria-activedescendant', pal.items.length ? `pi-${pal.sel}` : '');
}
function runPalette(i = pal.sel) { const it = pal.items[i]; if (!it) return; closePalette(); it.run(); }

/* ============ export ============ */
const EXPORT_KEY = 'folio.export';
const exportPrefs = () => { try { return { format: 'pdf', size: 'A4', landscape: false, margins: 'normal', pageNumbers: true, header: false, review: 'keep', ...JSON.parse(localStorage.getItem(EXPORT_KEY) || '{}') }; } catch { return { format: 'pdf', size: 'A4', landscape: false, margins: 'normal', pageNumbers: true, header: false, review: 'keep' }; } };
function openExport() {
  const t = activeTab(); if (!t) return toast(tr('app.open-a-note-to-export-it'));
  if (curType() !== 'md') return exportAs('pdf');
  const p = exportPrefs(); const d = $('#sheet-prompt');
  const seg = (name, opts, cur) => `<div class="segmented" role="radiogroup" aria-label="${name}">${opts.map(([v, l]) => `<button type="button" role="radio" data-${name}="${v}" aria-checked="${String(cur) === String(v)}">${l}</button>`).join('')}</div>`;
  d.classList.remove('sheet-small');
  d.innerHTML = `<form method="dialog">
    <div class="sheet-head"><div><h2 id="prompt-title">${esc(tr('app.export-title', { name: stem(t.path) }))}</h2><p>${tr('app.choose-a-format-and-how-the-pages-look')}</p></div><button class="icon-btn" type="button" data-cancel aria-label="${tr('app.close')}">${icons.close}</button></div>
    <div class="sheet-body">
      <section class="group"><h3>${tr('app.format')}</h3><div class="rows"><div class="row"><div class="row-main"><span class="row-title">${tr('app.file-type')}</span></div>${seg('format', [['pdf', 'PDF'], ['docx', tl('app', 'Word')], ['html', 'HTML'], ['md', tl('app', 'Markdown')]], p.format)}</div></div></section>
      <section class="group" data-pages><h3>${tr('app.pages')}</h3><div class="rows">
        <div class="row"><div class="row-main"><span class="row-title">${tr('app.paper')}</span></div>${seg('size', [['A4', 'A4'], ['Letter', 'Letter'], ['A5', 'A5'], ['Legal', 'Legal']], p.size)}</div>
        <div class="row"><div class="row-main"><span class="row-title">${tr('app.orientation')}</span></div>${seg('landscape', [['false', tl('app', 'Portrait')], ['true', tl('app', 'Landscape')]], p.landscape)}</div>
        <div class="row"><div class="row-main"><span class="row-title">${tr('app.margins')}</span></div>${seg('margins', [['normal', tl('app', 'Normal')], ['narrow', tl('app', 'Narrow')], ['wide', tl('app', 'Wide')]], p.margins)}</div>
        <div class="row"><div class="row-main"><span class="row-title">${tr('app.page-numbers')}</span></div><label class="switch"><input type="checkbox" role="switch" name="pageNumbers" ${p.pageNumbers ? 'checked' : ''} aria-label="${tr('app.page-numbers')}"></label></div>
        <div class="row"><div class="row-main"><span class="row-title">${tr('app.title-in-the-header')}</span></div><label class="switch"><input type="checkbox" role="switch" name="header" ${p.header ? 'checked' : ''} aria-label="${tr('app.title-in-the-header')}"></label></div>
      </div></section>
      <section class="group" data-review><h3>${tr('app.suggestions-and-comments')}</h3><div class="rows"><div class="row"><div class="row-main"><span class="row-title">${tr('app.in-the-file')}</span><span class="row-sub" data-review-sub></span></div>${seg('review', [['keep', tl('app', 'Keep')], ['clean', tl('app', 'Final text only')]], p.review)}</div></div></section>
    </div>
    <div class="sheet-foot"><button class="btn" type="button" data-cancel>${tr('app.cancel')}</button><button class="btn btn-primary" type="submit">${tr('app.export-2')}</button></div></form>`;
  const sync = () => {
    d.querySelector('[data-pages]').hidden = !/^(pdf|docx)$/.test(p.format);
    d.querySelector('[data-review]').hidden = !/^(pdf|docx|html)$/.test(p.format) || !/\{(\+\+|--|~~|==|>>)/.test(t.text);
    d.querySelector('[data-review-sub]').textContent = tr(p.format === 'docx' ? 'app.review-docx' : 'app.review-clean');
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
    if (!target) return toast(tr('app.could-not-create-the-page'), { kind: 'error' });
    for (const src of images) { try { const m = /^data:image\/([\w+.-]+);base64,(.*)$/s.exec(src); if (!m) continue; const bin = atob(m[2]); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); const saved = await folio.saveImage(target, `image.${m[1].replace('jpeg', 'jpg').replace(/\+.*/, '')}`, bytes); md = md.split(src).join(encodeURI(saved)); } catch {} }
    md = md.replace(/^# .*\n+/, (h) => h); // keep the document's own title if it has one
    const body = /^#\s/.test(md) ? md : `# ${r.name}\n\n${md}`;
    await folio.write(target, body + '\n');
    await refreshTree(); openFile(target);
    toast(r.messages?.length ? `Imported ${r.name}. Some Word formatting could not be kept.` : `Imported ${r.name}.`);
  } catch (e) { toast(tr('app.import-failed-message', { message: e.message }), { kind: 'error' }); }
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
    const out = await folio.exportBinary(t.path, 'docx', bytes); if (out) toast(tr('app.exported-to-out', { out: base(out) }));
  } finally { host.remove(); }
}
async function rasterUrl(url, w, h) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const W = Math.round(w || img.naturalWidth || 600), H = Math.round(h || img.naturalHeight || 400); const c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  const b = bytesOf(c.toDataURL('image/png')); return { data: b.data, type: 'png', width: W, height: H };
}
async function exportAs(kind, o = null) {
  const t = activeTab(); if (!t) return toast(tr('app.open-a-note-to-export-it'));
  if (!o && curType() === 'md' && (kind === 'pdf' || kind === 'docx')) o = exportPrefs();
  if (SURFACES[curType()]) { try { await loadSurface(curType()); } catch (e) { return toast(e.message, { kind: 'error' }); } } // its editor may still be loading
  if (kind === 'docx') { if (curType() !== 'md') return toast(tr('app.word-export-is-for-pages')); try { return await exportWord(t, o); } catch (e) { return toast(tr('app.export-failed-message', { message: e.message }), { kind: 'error' }); } }
  const s = curSurface();
  if (kind === 'md') {
    if (curType() !== 'md') return toast(tr('app.portable-markdown-export-is-for-pages'));
    try { const out = await folio.exportBinary(t.path, 'md', new TextEncoder().encode(portableMarkdown(t.text))); if (out) toast(tr('app.exported-to-out-folio-colour-and-align', { out: base(out) })); }
    catch (e) { toast(tr('app.export-failed-message', { message: e.message }), { kind: 'error' }); }
    return;
  }
  if (s) { if (kind === 'pdf' && s.exportPdf) return s.exportPdf(); if (kind === 'pptx' && s.exportPptx) return s.exportPptx(); if (kind === 'html') return toast(tr('app.html-export-is-for-pages-use-pdf-for-t')); }
  const prose = stylesCss.slice(stylesCss.indexOf('/* ---------- preview prose')).split('/* ---------- palette')[0];
  const css = tokensCss + '\nbody{margin:0;font-family:var(--font-sans);color:var(--color-ink);background:var(--color-paper);-webkit-print-color-adjust:exact}' + prose + '\n.copy-code{display:none}.prose{padding:48px 24px}@media print{.prose{padding:0}}';
  const page = o && curType() === 'md' ? pageCss(o) : '';
  const html = exportDocument(stem(t.path), o ? render(exportText(t, o)) : (!isRich() && $('#preview').innerHTML) || render(t.text), css + page);
  try { const out = kind === 'pdf' ? await folio.exportPdf(t.path, html, o && curType() === 'md' ? { print: pdfOptions(o, stem(t.path)) } : undefined) : await folio.exportHtml(t.path, html); if (out) toast(tr('app.exported-to-out', { out: base(out) })); }
  catch (e) { toast(tr('app.export-failed-message', { message: e.message }), { kind: 'error' }); }
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
      try { const p = await folio.create(target, text); await refreshTree(); hist.close(); openFile(p); toast(tr('app.made-a-copy-from-that-version')); }
      catch (e) { toast(tr('app.could-not-make-a-copy-message', { message: e.message }), { kind: 'error' }); }
    },
    opened: async (p) => { await refreshTree(); openFile(p); },
    onClose: () => { $('#workspace').removeAttribute('data-history'); },
  });
}
async function openHistory() {
  if (!S.active) return toast(tr('app.open-a-document-first'));
  if (hist.isOpen()) return hist.close();
  await saveActive(); $('#workspace').dataset.history = 'true'; await hist.open();
}
async function nameCurrentVersion() {
  const t = activeTab(); if (!t) return;
  const name = await prompt({ title: tr('app.name-this-version'), label: tr('app.name'), hint: tr('app.named-versions-are-kept-for-good'), action: tr('app.save') }); if (!name) return;
  await saveActive();
  const v = await folio.historySnapshot(t.path, t.text, 'named', true);
  const list = await folio.historyList(t.path); const id = v?.id || list[0]?.id;
  if (id) { await folio.historyName(t.path, id, name); toast(tr('app.saved-the-version-name', { name })); }
}

/* ============ small UI kit: toast, prompt, confirm, menu, tooltip ============ */

/* ---- assets: files a page uses live in a hidden .asset folder ---- */
const ASSET_HINT = /(?:\.asset|assets)\//;
const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
const assetName = (p) => p.split('/').pop().replace(/^[0-9a-f]{8}-(?=.)/, '');
const pendingAssets = new Map(); // note path -> Map(asset path -> bytes): removed from a page, file still on disk
let assetTimer, assetCard;
const missingWarned = new Set();
/** on open and when the window is focused again: bring back files a page needs from the asset trash, and say which are really gone */
async function checkAssets(t, { rerender = false } = {}) {
  const r = await folio.assetsHeal(t.path, t.text);
  if (r.restored?.length) { toast(tr('app.restored-length-files-this-page-uses-f', { n: r.restored.length })); if (rerender && t.path === S.active && t.text === t.saved) activate(t.path); }
  const fresh = (r.missing || []).filter((m) => !missingWarned.has(m));
  if (fresh.length) {
    fresh.forEach((m) => missingWarned.add(m));
    toast(fresh.length === 1 ? tr('app.asset-missing-one', { name: assetName(fresh[0]) }) : tr('app.asset-missing-many', { n: fresh.length }), { kind: 'error', action: [tr('app.details'), openAssets] });
  }
}
function assetsAfterSave(t, before, after) {
  if (!ASSET_HINT.test(before) && !ASSET_HINT.test(after)) return;
  folio.assetsSync(t.path, before, after).then((r) => {
    if (r.restored?.length) toast(tr('app.restored-length-files-from-the-asset-t', { n: r.restored.length }));
    const keepRefs = new Set(r.refs || []); const pend = pendingAssets.get(t.path) || new Map();
    for (const p of [...pend.keys()]) if (keepRefs.has(p)) pend.delete(p); // the picture is back (undo)
    for (const o of r.orphans || []) pend.set(o.path, o.bytes);
    pend.size ? pendingAssets.set(t.path, pend) : pendingAssets.delete(t.path);
    clearTimeout(assetTimer); if (pendingAssets.size) assetTimer = setTimeout(askAssetRemoval, 2500);
    else assetCard?.remove();
  }).catch(() => {});
}
async function askAssetRemoval() {
  const files = [...pendingAssets.values()].flatMap((m) => [...m]); if (!files.length) return;
  const paths = files.map(([p]) => p), bytes = files.reduce((s, [, b]) => s + b, 0), mode = S.settings.assetRemoval || 'ask';
  const clear = () => pendingAssets.clear();
  const run = async (permanent) => {
    const n = await folio.assetsRemove(paths, permanent); clear();
    toast(permanent ? `Deleted ${n} ${n === 1 ? 'file' : 'files'}.` : `Moved ${n} ${n === 1 ? 'file' : 'files'} to the asset trash.`, permanent ? {} : { action: [tr('app.undo'), () => folio.assetsRestore(paths).then(() => { const t = activeTab(); if (t) checkAssets(t, { rerender: true }); })] });
  };
  if (mode === 'keep') return clear();
  if (mode === 'trash' || mode === 'delete') return run(mode === 'delete');
  assetCard?.remove();
  const el = assetCard = document.createElement('div');
  el.className = 'toast asset-toast'; el.setAttribute('role', 'status');
  const what = files.length === 1 ? `“${assetName(paths[0])}”` : tr('app.n-files', { n: files.length });
  el.innerHTML = `<div class="asset-toast-body"><p>${esc(tr('app.you-removed', { what, size: fmtSize(bytes), n: files.length }))}</p>
    <label class="sf-check"><input type="checkbox" data-perm> ${tr('app.delete-permanently-skip-the-asset-tras')}</label>
    <label class="sf-check"><input type="checkbox" data-always> ${tr('app.always-do-this-don-t-ask-again')}</label>
    <div class="asset-toast-actions"><button class="btn btn-quiet" type="button" data-keep>${tr('app.keep')}</button><button class="btn" type="button" data-remove>${tr('app.remove')}</button></div></div>
    <button class="icon-btn" type="button" aria-label="${tr('app.dismiss')}">${icons.close}</button>`;
  $('#toasts').appendChild(el);
  const close = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 280); assetCard = null; };
  el.querySelector('.icon-btn').onclick = () => { clear(); close(); };
  el.querySelector('[data-keep]').onclick = () => { if (el.querySelector('[data-always]').checked) saveSetting({ assetRemoval: 'keep' }); clear(); close(); };
  el.querySelector('[data-remove]').onclick = async () => {
    const perm = el.querySelector('[data-perm]').checked;
    if (el.querySelector('[data-always]').checked) saveSetting({ assetRemoval: perm ? 'delete' : 'trash' });
    close(); await run(perm);
  };
  el.querySelector('[data-remove]').focus({ preventScroll: true });
}
/** the asset manager: unused files, missing files, files still in an old assets/ folder */
async function openAssets() {
  const d = $('#sheet-assets'); let u;
  try { u = await folio.assetsUsage(); } catch (e) { return toast(e.message, { kind: 'error' }); }
  const sel = new Set(u.unused.map((f) => f.path));
  const render = () => {
    d.innerHTML = `<div class="sheet-head"><div><h2 id="assets-title">${tr('app.files-in-your-pages')}</h2>
      <p>${u.used.length} in use (${fmtSize(u.usedBytes)}), ${u.unused.length} unused (${fmtSize(u.unusedBytes)}). ${tr('app.usage-summary-tail', { code: '<code>.asset</code>' })}</p></div></div>
      <div class="sheet-body">
      ${u.missing.length ? `<section class="asset-section"><h3>${tr('app.missing-count', { n: u.missing.length })}</h3><ul class="asset-list">${u.missing.map((m, i) => `<li><span class="asset-name">${esc(assetName(m.path))} <span class="asset-size">${esc(tr('app.in-note-line', { note: m.note, line: m.line }))}</span></span><button class="btn btn-quiet" type="button" data-open="${i}">${tr('app.open-page')}</button></li>`).join('')}</ul></section>` : ''}
      ${u.unused.length ? `<section class="asset-section"><h3>${tr('app.unused-count', { n: u.unused.length })}</h3><ul class="asset-list">${u.unused.map((f, i) => `<li><label class="sf-check asset-name"><input type="checkbox" data-sel="${i}" ${sel.has(f.path) ? 'checked' : ''}> ${esc(assetName(f.path))}</label><span class="asset-size">${fmtSize(f.bytes)}</span></li>`).join('')}</ul></section>` : '<p>' + tr('app.no-unused-files') + '</p>'}
      ${u.legacy ? `<section class="asset-section"><h3>${tr('app.old-folders')}</h3><p>${tr('app.legacy-files', { n: u.legacy, code: '<code>assets</code>' })}</p><button class="btn" type="button" data-migrate>${tr('app.move-to-asset')}</button></section>` : ''}
      </div>
      <div class="sheet-foot"><button class="btn" type="button" data-close>${tr('app.close')}</button>
        ${u.unused.length ? `<button class="btn" type="button" data-delete ${sel.size ? '' : 'disabled'}>${tr('app.delete-permanently')}</button><button class="btn btn-primary" type="button" data-trash ${sel.size ? '' : 'disabled'}>${tr('app.move-n-to-trash', { n: sel.size })}</button>` : ''}</div>`;
    d.querySelector('[data-close]').onclick = () => d.close();
    d.querySelectorAll('[data-sel]').forEach((c) => (c.onchange = () => { const p = u.unused[Number(c.dataset.sel)].path; c.checked ? sel.add(p) : sel.delete(p); render(); d.querySelector(`[data-sel="${c.dataset.sel}"]`)?.focus(); }));
    d.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => { const m = u.missing[Number(b.dataset.open)]; d.close(); openFile(m.note, { line: m.line }).catch((e) => toast(e.message, { kind: 'error' })); }));
    const drop = async (permanent) => {
      if (permanent && !(await confirmSheet({ title: tr('app.delete-these-files-permanently'), body: tr('app.size-files-will-be-deleted-and-cannot', { n: sel.size }), action: tr('app.delete'), danger: true }))) return;
      const n = await folio.assetsRemove([...sel], permanent);
      toast(permanent ? tr('app.deleted-n-files', { n }) : tr('app.moved-n-to-asset-trash', { n })); d.close(); openAssets();
    };
    d.querySelector('[data-trash]')?.addEventListener('click', () => drop(false));
    d.querySelector('[data-delete]')?.addEventListener('click', () => drop(true));
    d.querySelector('[data-migrate]')?.addEventListener('click', async () => {
      if (!(await confirmSheet({ title: tr('app.move-files-to-asset'), body: tr('app.pages-that-point-to-assets-are-updated'), action: tr('app.move') }))) return;
      try { const r = await folio.assetsMigrate(); toast(`${tr('app.moved-n-files', { n: r.files })}, ${tr('app.updated-n-pages', { n: r.notes })}.`); d.close(); refreshTree?.(); } catch (e) { toast(e.message, { kind: 'error' }); }
    });
  };
  render(); d.showModal();
}
window.addEventListener('focus', () => { const t = activeTab(); if (t && ASSET_HINT.test(t.text)) checkAssets(t, { rerender: true }).catch(() => {}); });
function toast(text, { kind = 'info', action } = {}) {
  const el = document.createElement('div');
  (window.__folioToasts ||= []).push(text); // tests read what was said
  el.className = 'toast'; el.dataset.kind = kind; el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = `<p>${esc(text)}</p>${action ? `<button class="btn btn-quiet" type="button">${esc(action[0])}</button>` : ''}<button class="icon-btn" type="button" aria-label="${tr('app.dismiss')}">${icons.close}</button>`;
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
      <div class="sheet-foot"><button class="btn" type="button" value="cancel" data-cancel>${tr('app.cancel')}</button><button class="btn btn-primary" type="submit" value="ok">${esc(action)}</button></div></form>`;
    const input = $('#prompt-input', d);
    const done = (v) => { d.close(); resolve(v); };
    d.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (allowEmpty && !v) return done('');
      if (!validate && v) return done(v);
      if (!v || /[\\:*?"<>|]/.test(v) || v.split('/').some((s) => s === '..')) { $('#prompt-help', d).textContent = tr('app.bad-name'); $('#prompt-help', d).dataset.error = 'true'; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
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
      <div class="sheet-foot"><button class="btn" type="button" data-no>${tr('app.cancel')}</button><button class="btn ${danger ? '' : 'btn-primary'}" type="button" data-yes>${esc(action)}</button></div>`;
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
  /* the ARIA menu pattern: arrows, Home and End move between items, a letter jumps to the next label that starts with it, Tab closes */
  m.onkeydown = (e) => {
    const list = [...m.querySelectorAll('.menu-item:not([disabled])')]; if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    const go = (k) => { e.preventDefault(); list[(k + list.length) % list.length].focus(); };
    if (e.key === 'ArrowDown') go(i + 1); else if (e.key === 'ArrowUp') go(i < 0 ? -1 : i - 1); else if (e.key === 'Home') go(0); else if (e.key === 'End') go(-1);
    else if (e.key === 'Tab') m.hidePopover();
    else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { const k = e.key.toLowerCase(); const n = [...list.slice(i + 1), ...list.slice(0, i + 1)].find((b) => b.textContent.trim().toLowerCase().startsWith(k)); if (n) { e.preventDefault(); n.focus(); } }
  };
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
  $('#tags-head').addEventListener('click', () => { saveSetting({ showTags: !tagsOpen() }); renderTags(); });
  $('#reminders-head').addEventListener('click', () => { saveSetting({ showReminders: !remindersOpen() }); renderReminders(); });
  $('#reminders-list').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'toggle-done') { showDoneReminders = !showDoneReminders; return renderReminders(); }
    if (b.dataset.open) return openFile(b.dataset.open, { line: Number(b.dataset.line) });
    const id = b.closest('[data-id]')?.dataset.id; if (!id) return;
    const state = { done: 'done', undo: null, dismiss: 'dismissed' }[b.dataset.act];
    try { await folio.reminders.set(id, state); } catch (er) { return toast(er.message, { kind: 'error' }); }
    if (state === 'dismissed') toast(tr('app.reminder-dismissed'), { action: [tr('app.undo'), () => folio.reminders.set(id, null)] });
  });
  $('#tags-list').addEventListener('click', (e) => { const b = e.target.closest('[data-tag]'); if (b) showTag(b.dataset.tag); });
  $('#tags-list').addEventListener('contextmenu', (e) => {
    const b = e.target.closest('[data-tag]'); if (!b) return; e.preventDefault(); const tag = b.dataset.tag;
    showMenu(null, [{ label: tr('app.show-pages-tagged-tag', { tag }), run: () => showTag(tag) }, { label: tr('app.rename-tag'), run: () => renameTagEverywhere(tag) }, { label: tr('app.copy-tag'), run: () => { folio.copy('#' + tag); toast(tr('app.copied-tag', { tag })); } }], { x: e.clientX, y: e.clientY });
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
    ...(S.active ? [{ label: tr('app.duplicate'), run: () => duplicatePath(S.active, false) }, { label: tr('app.move-to'), run: () => moveToPicker(S.active, false) },
      { label: tr('app.copy-link'), run: () => copyPageLink(S.active) }] : []),
    ...(curType() === 'md' && S.active ? [{ label: tr(isLocked(S.active) ? 'app.unlock-page' : 'app.lock-page'), run: () => setPageLock(S.active, !isLocked(S.active)) }, { label: tr('app.expand-or-collapse-all-toggles'), key: 'Mod+Alt+Shift+T', run: () => toggleAllToggles() }, '-'] : []),
    { label: tr('app.version-history'), key: 'Mod+Alt+Shift+H', run: () => openHistory() },
    { label: tr('app.export'), key: 'Mod+Shift+E', run: openExport },
    { label: tr('app.import-word-or-html'), run: importDocument }, '-',
    { label: tr('app.focus-mode'), key: 'Mod+.', run: toggleFocus },
    { label: tr('app.command-palette'), key: 'Mod+Shift+P', run: () => openPalette('commands') }, '-',
    { label: tr('app.connect-ai-assistants'), key: 'Mod+Shift+A', run: openAiSheet },
    { label: tr('app.settings'), key: 'Mod+,', run: openSettings },
  ]);
  $('#workspace-switch').onclick = (e) => showMenu(e.currentTarget, [
    ...(S.settings.recent || []).filter((d) => d !== S.workspace).slice(0, 5).map((d) => ({ label: d.split(/[\\/]/).filter(Boolean).pop(), run: () => switchWorkspace(d).catch((er) => toast(er.message, { kind: 'error' })) })),
    ...((S.settings.recent || []).length > 1 ? ['-'] : []),
    { label: tr('app.open-folder'), key: 'Mod+O', run: chooseFolder },
    ...(S.workspace ? [{ label: tr(S.platform === 'darwin' ? 'app.reveal-finder' : 'app.show-in-folder'), run: () => folio.reveal('') }, { label: tr('app.new-folder'), run: () => newFolder('') }] : []),
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
      { label: tr('app.open'), run: () => openFile(p) }, '-',
      { label: tr('app.duplicate'), run: () => duplicatePath(p, false) },
      { label: tr('app.move-to'), run: () => moveToPicker(p, false) },
      { label: tr('app.copy-link'), run: () => copyPageLink(p) }, '-',
      { label: tr('app.rename'), run: () => renamePath(p, false) },
      ...(docType(p) === 'md' ? [{ label: tr(isLocked(p) ? 'app.unlock-page' : 'app.lock-page'), run: () => setPageLock(p, !isLocked(p)) }] : []),
      { label: tr(S.platform === 'darwin' ? 'app.reveal-finder' : 'app.show-in-folder'), run: () => folio.reveal(p) },
      { label: tr('app.copy-relative-path'), run: () => folio.copy(p) }, '-',
      { label: tr('app.move-to-trash'), danger: true, run: () => trashPath(p, false) }], at); }
    else if (d) { const p = d.dataset.dir; showMenu(null, [
      { label: tr('app.new-note-here'), run: () => newNote(p) }, { label: tr('app.new-folder-here'), run: () => newFolder(p) }, '-',
      { label: tr('app.duplicate'), run: () => duplicatePath(p, true) },
      { label: tr('app.move-to'), run: () => moveToPicker(p, true) }, '-',
      { label: tr('app.rename'), run: () => renamePath(p, true) },
      { label: tr(S.platform === 'darwin' ? 'app.reveal-finder' : 'app.show-in-folder'), run: () => folio.reveal(p) }, '-',
      { label: tr('app.move-to-trash'), danger: true, run: () => trashPath(p, true) }], at); }
    else if (S.workspace) showMenu(null, [{ label: tr('app.new-note'), run: () => newNote('') }, { label: tr('app.new-folder'), run: () => newFolder('') }], at);
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
  /* a folder row drops into that folder; a note row drops into the folder that holds the note (not the root) */
  const dropDir = (t) => { const row = t.closest('.tree-row'); if (row?.dataset.file) { const dir = dirOf(row.dataset.file); return dir ? $$('[data-dir]', tree).find((x) => x.dataset.dir === dir) || null : null; } return t.closest('[data-dir]'); };
  tree.addEventListener('dragstart', (e) => { const r = e.target.closest('.tree-row'); dragPath = r?.dataset.file || r?.dataset.dir; e.dataTransfer.effectAllowed = 'move'; });
  tree.addEventListener('dragover', (e) => { const d = dropDir(e.target); if (!dragPath) return; e.preventDefault(); $$('.drop-target', tree).forEach((x) => x.classList.remove('drop-target')); d?.classList.add('drop-target'); });
  tree.addEventListener('dragleave', (e) => $$('.drop-target', tree).forEach((x) => x.classList.remove('drop-target')));
  tree.addEventListener('drop', (e) => {
    e.preventDefault(); $$('.drop-target', tree).forEach((x) => x.classList.remove('drop-target'));
    const d = dropDir(e.target); const to = d ? d.dataset.dir : '';
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
  $('#tabs').addEventListener('keydown', (e) => { const t = e.target.closest('[data-tab]'); if (!t) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(t.dataset.tab); } else if (e.key === 'Delete') { e.preventDefault(); closeTab(t.dataset.tab); } });

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
      if (!t) { toast(tr('app.no-template-called-template', { template: b.template }), { kind: 'error' }); return; }
      const text0 = await askFilled(t, { title: stem(S.active) }); if (text0 == null) return; const textB = text0.split(CURSOR).join('');
      const { fm, body } = splitTemplate(textB); const tab = activeTab(); let text = tab.text;
      const lines = text.split('\n'); const at = b.where === 'above' ? Number(box.dataset.line) : Number(box.dataset.lineEnd);
      lines.splice(at, 0, ...(b.where === 'above' ? [intoPage(body).trimEnd(), ''] : ['', intoPage(body).trimEnd()]));
      text = lines.join('\n');
      if (fm) { const cur = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)?.[0] || ''; text = mergeProps(cur, fm) + text.slice(cur.length); }
      editor.applyRemote(text); tab.text = text; if (isRich()) rich.setMarkdown(text); renderPreview(); autosave(); return;
    }
    const copy = e.target.closest('.copy-code');
    if (copy) { await folio.copy(copy.parentElement.querySelector('code')?.innerText || ''); copy.textContent = tr('app.copied'); setTimeout(() => (copy.textContent = tr('app.copy')), 1400); return; }
    const box = e.target.closest('.task-list-item input');
    if (box && isLocked(S.active)) { e.preventDefault(); return; }
    if (box) {
      const li = box.closest('[data-line]'); if (!li) return;
      const n = Number(li.dataset.line); const lines = activeTab().text.split('\n');
      lines[n] = lines[n].replace(/\[( |x|X)\]/, (m) => (m === '[ ]' ? '[x]' : '[ ]'));
      const text = lines.join('\n'); editor.applyRemote(text); activeTab().text = text; autosave(); return;
    }
    const a = e.target.closest('a'); if (!a) return;
    e.preventDefault();
    if (a.dataset.wikilink) { const f = resolveWiki(a.dataset.wikilink); if (f) openRef(f, parseRef(a.dataset.wikilink).part); else if (await confirmSheet({ title: tr('app.create-wikilink', { wikilink: a.dataset.wikilink }), body: tr('app.this-note-does-not-exist-yet'), action: tr('app.create-note') })) { const p = await folio.create(a.dataset.wikilink + '.md', `# ${a.dataset.wikilink}\n\n`); await refreshTree(); openFile(p); } return; }
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
    if (inst) { inst.disabled = true; inst.textContent = tr('app.connecting'); try { const r = await folio.install(inst.dataset.install); toast(tr('app.connected-restart', { restart: r.restart })); } catch (er) { toast(er.message, { kind: 'error' }); } openAiSheet(); }
    const un = e.target.closest('[data-uninstall]'); if (un) { await folio.uninstall(un.dataset.uninstall).catch((er) => toast(er.message, { kind: 'error' })); openAiSheet(); }
    const cp = e.target.closest('[data-copy]'); if (cp) { await folio.copy($(cp.dataset.copy).textContent); flashCopied(cp); }
    const cs = e.target.closest('[data-copy-snippet]'); if (cs) { const c = await folio.connections(); await folio.copy(c.list.find((x) => x.id === cs.dataset.copySnippet).snippet); flashCopied(cs); }
    const ct = e.target.closest('[data-copy-token]'); if (ct) { await folio.copy($('#mcp-token').dataset.secret); flashCopied(ct); }
    const rv = e.target.closest('[data-reveal-token]'); if (rv) { const t = $('#mcp-token'); const shown = rv.textContent === 'Hide'; t.textContent = shown ? '•'.repeat(24) : t.dataset.secret; rv.textContent = shown ? tl('app', 'Show') : tl('app', 'Hide'); }
    const rot = e.target.closest('[data-rotate]'); if (rot) { if (await confirmSheet({ title: tr('app.make-a-new-token'), body: tr('app.clients-that-use-the-http-url-will-nee'), action: tr('app.new-token') })) { await folio.rotateToken(); openAiSheet(); } }
  });
  document.addEventListener('change', async (e) => {
    const el = e.target.closest('[data-setting]'); if (!el) return;
    const k = el.dataset.setting; const v = el.type === 'checkbox' ? el.checked : /fontSize|lineWidth/.test(k) ? Number(el.value) : el.value;
    if (k === 'language' && !(await saveAllOrAsk())) { el.value = locale(); return; } // kept the old language: nothing saved, the menu shows it again
    await saveSetting({ [k]: v });
    if (k === 'fontSize' || k === 'lineWidth') applyLayoutSettings();
    if (k === 'spellcheck') editor.setSpellcheck(v);
    if (k === 'remoteImages') allowRemote(null);
    if (k === 'dateStyle') { datePrefs.style = v; rich.refreshDecorations?.(); renderPreview(); }
    if (k === 'language') { setLocale(v); location.reload(); }
    if (k === 'mcpEnabled' || k === 'allowWrite') { S.mcp = await folio.mcpStatus(); renderAiStatus(); }
  });
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'set-port') return;
    const n = Number(e.target.value), help = $('#port-help'), ok = Number.isInteger(n) && n >= 1024 && n <= 65535;
    help.dataset.error = String(!ok); help.textContent = ok ? tl('app', 'Local only, 1024 to 65535') : tl('app', 'Enter a whole number from 1024 to 65535');
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
  const sideW = (w) => { w = Math.max(200, Math.min(420, w)); document.documentElement.style.setProperty('--sidebar-w', `${w}px`); localStorageSet('folio.sidebarW', w); $('#sidebar-resizer').setAttribute('aria-valuenow', String(Math.round(w))); return w; };
  dragResize($('#sidebar-resizer'), sideW);
  $('#sidebar-resizer').addEventListener('keydown', (e) => { const d = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0; if (!d) return; e.preventDefault(); sideW(+$('#sidebar-resizer').getAttribute('aria-valuenow') + d); });
  dragResize($('#pane-divider'), (x) => { const ws = $('#workspace').getBoundingClientRect(); const outline = $('#outline').offsetWidth; splitRatio = Math.max(0.22, Math.min(0.78, (x - ws.left) / (ws.width - outline))); localStorageSet('folio.split', splitRatio); layoutPanes(); });

  // global shortcuts not owned by the menu
  document.addEventListener('keydown', (e) => {
    const m = e.metaKey || e.ctrlKey;
    if (m && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); openPalette('commands'); }
    if (m && e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); insertRef('link'); }
    if (m && e.altKey && e.shiftKey && e.code === 'KeyT') { e.preventDefault(); toggleAllToggles(); } // B8: Notion's Ctrl+Alt+T is Insert template here
    else if (m && e.altKey && !e.shiftKey && e.code === 'KeyT' && curType() === 'md') { e.preventDefault(); insertTemplateCmd(); } // shown in the palette, was never bound
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
  if (folio.reminders) { folio.reminders.onChanged(remindersSoon); folio.reminders.onFired(onReminderFired); folio.reminders.onOpen((r) => openFile(r.rel, { line: r.line })); setInterval(remindersSoon, 60000); /* overdue as time passes */ }
  folio.onFileChanged(({ path: p, content }) => {
    tagsStale();
    if (p !== S.active) backlinksSoon();
    if (p !== S.active && /\{\{|!\[\[|```chart/.test(activeTab()?.text || '')) { renderPreview(); curSurface()?.refresh?.(); }
    const t = tabOf(p); if (!t || content === t.saved) return;
    if (t.text === t.saved) { t.saved = content; if (p === S.active) { setActiveText(content); renderPreview(); renderOutline(); } else t.text = content; }
    else toast(tr('app.p-changed-on-disk-while-you-were-editi', { p: stem(p) }), { action: [tr('app.use-disk-version'), () => { t.saved = content; if (p === S.active) setActiveText(content); else t.text = content; }] });
  });
  folio.onAiEdit(onAiEdit);
  folio.onAiMove(({ from, to, client }) => { retargetTabs(from, to); refreshTree(); toast(tr('app.client-moved-from-to-to', { client, from: stem(from), to })); });
  folio.onAiActivity((m) => { S.mcp = m; renderAiStatus(); const box = $('#ai-activity'); if (box) box.innerHTML = activityHtml(); });
  folio.onAiAsk(async ({ id, kind, payload }) => {
    if (kind === 'open-note') {
      const t = activeTab();
      folio.answer(id, t ? { path: t.path, content: t.text, unsavedChanges: t.text !== t.saved, cursorLine: S.cursor.line, selection: S.cursor.selection || null } : { path: null, message: tr('app.no-note-is-open-in-folio') });
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
  folio.onBeforeClose(async () => { if (await saveAllOrAsk()) folio.closeOk(); else folio.closeCancel?.(); });
}

window.__folioErrors = [];
/** tests and automation: run a command by id, as the menu would */
window.__folioRun = (id) => (id === 'palette' ? openPalette('commands') : COMMANDS.find((x) => x.id === id)?.run()); // the palette is opened by the menu, not a command
Object.defineProperty(window, '__folioSurface', { get: () => curSurface() });
Object.defineProperty(window, '__folioEditor', { get: () => editor });
addEventListener('error', (e) => { window.__folioErrors.push(String(e.message)); console.error('[folio-error]', e.message); });
addEventListener('unhandledrejection', (e) => { window.__folioErrors.push(String(e.reason?.message || e.reason)); if (e.reason?.stack) console.error('[folio-error-stack]', e.reason.stack.split('\n').slice(0, 4).join(' | ')); console.error('[folio-error]', e.reason?.message || e.reason); });
boot().catch((e) => { document.body.insertAdjacentHTML('beforeend', `<div class="toasts"><div class="toast" data-kind="error" role="alert"><p>${esc(tr('app.could-not-start', { message: e.message }))}</p></div></div>`); console.error(e); });
