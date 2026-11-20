// Folio — main process.
import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, systemPreferences, Menu, clipboard, net } from 'electron';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { tl, setLocale } from '../renderer/i18n.js';
import { createNotes, NOTE_EXT } from './notes.js';
import { createHistory } from './history.js';
import { createGitLog } from './git-log.js';
import { createAssets, isAssetPath } from './assets.js';
import { buildServer, runTool, TOOLS } from './mcp-tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
app.setName('Folio');
export const ATTRIBUTION = 'Based on Folio by Gabriele Vaudano (https://github.com/gabrielevaudano98/folio)';
app.setAboutPanelOptions({
  applicationName: 'Folio', applicationVersion: app.getVersion(),
  copyright: 'Copyright (C) 2026 Gabriele Vaudano. Licensed under the GNU AGPL-3.0.',
  credits: 'Based on Folio by Gabriele Vaudano\nhttps://github.com/gabrielevaudano98/folio',
  website: 'https://github.com/gabrielevaudano98/folio', authors: ['Gabriele Vaudano'],
});
if (process.env.FOLIO_USER_DATA) app.setPath('userData', process.env.FOLIO_USER_DATA);

/* ---------------- settings ---------------- */
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const BRIDGE_FILE = () => path.join(app.getPath('userData'), 'mcp-bridge.json');
const defaults = {
  workspace: null, recent: [], lastFile: null, mode: 'edit', theme: 'system', fontSize: 16,
  lineWidth: 72, spellcheck: true, smartTypography: true, mcpEnabled: true, mcpPort: 47321, allowWrite: true,
  token: crypto.randomBytes(24).toString('hex'), showOutline: true, sidebar: true,
  language: 'en',
  templateGallery: 'https://raw.githubusercontent.com/gabrielevaudano98/folio/main/community/templates/index.json',
};
let settings = { ...defaults };
try { settings = { ...defaults, ...JSON.parse(fss.readFileSync(SETTINGS_FILE(), 'utf8')) }; } catch {}
function saveSettings() {
  fss.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
  fss.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2));
  writeBridge();
}
function writeBridge() {
  const b = { port: mcpServerPort, token: settings.token, workspace: settings.workspace, allowWrite: settings.allowWrite, pid: process.pid };
  try { fss.writeFileSync(BRIDGE_FILE(), JSON.stringify(b, null, 2), { mode: 0o600 }); } catch {}
}

const notes = createNotes(() => settings.workspace);
const history = createHistory(() => settings.workspace);
const gitLog = createGitLog(() => settings.workspace);
const assets = createAssets(notes);
const guardAsset = (rel) => { if (isAssetPath(rel)) throw new Error('The .asset folder belongs to Folio. Remove files from a page, or use Clean up unused files.'); };
/* history must never get in the way of saving */
const keep = async (rel, text, o) => { try { if (settings.workspace && !/(^|\/)\.folio\//.test(rel)) return await history.snapshot(rel, text, o); } catch (e) { console.error('history', e.message); } return null; };
let win = null;

/* ---------------- window ---------------- */
function themeColors() {
  const dark = nativeTheme.shouldUseDarkColors;
  return { color: dark ? '#1c1d21' : '#f4f4f6', symbolColor: dark ? '#e9e9ee' : '#26272c', height: 52 };
}
function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 760, minHeight: 520, show: false,
    title: 'Folio',
    backgroundColor: isMac ? '#00000000' : (nativeTheme.shouldUseDarkColors ? '#1c1d21' : '#f4f4f6'),
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 18, y: 18 },
    titleBarOverlay: isMac ? undefined : themeColors(),
    vibrancy: isMac ? 'sidebar' : undefined,
    visualEffectState: 'followWindow',
    backgroundMaterial: isWin ? 'mica' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: settings.spellcheck,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  if (!app.isPackaged && process.env.FOLIO_SHOT) devShot(win);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.on('close', (e) => {
    if (win.__forceClose) return;
    e.preventDefault();
    win.webContents.send('app:before-close');
  });
}
ipcMain.on('app:close-ok', () => { if (win) { win.__forceClose = true; win.close(); } });

nativeTheme.on('updated', () => {
  if (win && !isMac) win.setTitleBarOverlay?.(themeColors());
  win?.webContents.send('theme:changed', { dark: nativeTheme.shouldUseDarkColors, accent: accent() });
});
function accent() {
  try { const c = systemPreferences.getAccentColor?.(); return c ? '#' + c.slice(0, 6) : null; } catch { return null; }
}
if (isWin) systemPreferences.on?.('accent-color-changed', () => win?.webContents.send('theme:changed', { dark: nativeTheme.shouldUseDarkColors, accent: accent() }));

/* ---------------- workspace + watcher ---------------- */
let watcher = null;
const ownWrites = new Map(); // abs -> content we just wrote; suppresses our own echo
async function setWorkspace(dir) {
  settings.workspace = dir;
  if (dir) settings.recent = [dir, ...settings.recent.filter((d) => d !== dir)].slice(0, 8);
  saveSettings();
  await watcher?.close();
  watcher = null;
  if (!dir) return;
  assets.purgeTrash().catch(() => {}); // removed files older than 30 days leave the asset trash
  watcher = chokidar.watch(dir, {
    ignoreInitial: true, depth: 12,
    ignored: (p) => /(^|[/\\])(\.|node_modules)/.test(path.relative(dir, p)),
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
  });
  let structural = null;
  watcher.on('all', async (evt, abs) => {
    if (['add', 'unlink', 'addDir', 'unlinkDir'].includes(evt)) {
      clearTimeout(structural);
      structural = setTimeout(() => win?.webContents.send('fs:tree-changed'), 150);
    }
    if (evt === 'change' && NOTE_EXT.includes(path.extname(abs).toLowerCase())) {
      const text = await fs.readFile(abs, 'utf8').catch(() => null);
      if (text == null) return;
      if (ownWrites.get(abs) === text) { ownWrites.delete(abs); return; }
      win?.webContents.send('fs:file-changed', { path: notes.relOf(abs), content: text });
    }
  });
}

/* ---------------- IPC ---------------- */
const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...a) => {
  try { return { ok: true, value: await fn(...a) }; } catch (e) { return { ok: false, error: e.message }; }
});
h('app:init', () => ({
  settings: { ...settings, token: undefined }, platform: process.platform,
  dark: nativeTheme.shouldUseDarkColors, accent: accent(), version: app.getVersion(),
  mcp: mcpStatus(),
}));
h('settings:set', async (patch) => {
  const before = { ...settings };
  Object.assign(settings, patch);
  if ('theme' in patch) nativeTheme.themeSource = settings.theme;
  if ('language' in patch) { setLocale(settings.language); buildMenu(); }
  saveSettings();
  if (patch.mcpEnabled !== undefined || patch.mcpPort !== before.mcpPort) await restartMcp();
  return { ...settings, token: undefined };
});
h('workspace:choose', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: tl('dlg', 'Open a folder of notes') });
  if (r.canceled || !r.filePaths[0]) return null;
  await setWorkspace(r.filePaths[0]);
  return r.filePaths[0];
});
h('workspace:open', async (dir) => {
  if (!fss.existsSync(dir)) throw new Error('That folder no longer exists.');
  await setWorkspace(dir); return dir;
});
h('workspace:close', async () => { await setWorkspace(null); return true; });
h('workspace:reveal', (rel) => shell.showItemInFolder(rel ? notes.resolve(rel) : notes.root()));
h('fs:tree', () => notes.tree());
h('fs:read', (rel) => notes.read(rel));
h('fs:info', async (rel) => { const st = await fs.stat(notes.resolve(rel)).catch(() => null); return st ? { size: st.size, mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs } : null; });
h('fs:write', async (rel, content) => {
  const abs = notes.resolve(rel, { mustBeNote: true });
  ownWrites.set(abs, content);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  try { if (!(await history.list(rel)).length) { const was = await fs.readFile(abs, 'utf8').catch(() => null); if (was != null) await keep(rel, was, { reason: 'open', force: true }); } } catch {}
  await fs.writeFile(abs, content, 'utf8');
  keep(rel, content, { reason: 'edit' });
  return true;
});
h('fs:create', async (rel, content = '') => {
  const abs = notes.resolve(rel, { mustBeNote: true });
  if (fss.existsSync(abs)) throw new Error('A note with that name already exists.');
  ownWrites.set(abs, content);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
  keep(notes.relOf(abs), content, { reason: 'created', force: true });
  return notes.relOf(abs);
});
h('fs:mkdir', async (rel) => { guardAsset(rel); await fs.mkdir(notes.resolve(rel), { recursive: true }); return rel; });
h('fs:rename', async (from, to) => {
  guardAsset(from); guardAsset(to);
  const isDir = (await fs.stat(notes.resolve(from)).catch(() => null))?.isDirectory();
  const r = await notes.move(from, to);
  const pairs = isDir ? (await notes.allFiles()).filter((f) => f.startsWith(r.to + '/')).map((f) => [r.from + f.slice(r.to.length), f]) : [[r.from, r.to]];
  const changed = new Set();
  for (const [a, b] of pairs) { history.rename(a, b).catch(() => {}); for (const c of await notes.rewriteAfterMove(a, b, (f, text) => keep(f, text, { reason: 'before-rename', force: true })).catch(() => [])) changed.add(c); }
  /* a page (or a folder of pages) moved: files a page uses that did not move with it are copied into its new .asset, references follow */
  for (const [a, b] of pairs) {
    if (path.dirname(a) === path.dirname(b)) continue;
    try {
      const text = await notes.read(b); const moved = await assets.relocate(a, b, text);
      if (moved.text !== text) { await keep(b, text, { reason: 'move', force: true }); ownWrites.set(notes.resolve(b), moved.text); await fs.writeFile(notes.resolve(b), moved.text, 'utf8'); changed.add(b); }
    } catch (e) { console.error('assets relocate', e.message); }
  }
  return { to: r.to, changed: [...changed] };
});
h('fs:trash', async (rel) => { guardAsset(rel); await shell.trashItem(notes.resolve(rel)); return true; });
h('fs:search', (q, opts) => notes.search(q, opts));
/* version history */
h('history:list', (rel) => history.list(rel));
h('history:get', (rel, id) => history.get(rel, id));
h('history:snapshot', (rel, text, reason, force) => keep(rel, text, { reason: reason || 'edit', force: !!force }));
h('history:name', (rel, id, label, note) => history.name(rel, id, label, note));
h('history:git', (rel) => gitLog.list(notes.relOf(notes.resolve(rel))));
h('history:git-get', (rel, hash) => gitLog.show(notes.relOf(notes.resolve(rel)), hash));
h('history:deleted', () => history.deleted());
h('history:clear', (rel) => history.clear(rel));
h('history:usage', () => history.usage());
h('app:user-name', () => { try { const n = os.userInfo().username || ''; return n.charAt(0).toUpperCase() + n.slice(1); } catch { return ''; } });
h('fs:backlinks', (rel) => notes.backlinks(rel));
h('fs:unlinked', (rel) => notes.unlinkedMentions(rel));
h('fs:broken-links', (rel) => notes.brokenLinks(rel));
h('fs:list', () => notes.list({ limit: 5000 }));
h('fs:save-image', (noteRel, name, bytes) => assets.save(noteRel, name, bytes));
h('fs:pick-image', async (noteRel) => {
  const r = await dialog.showOpenDialog(win, { title: tl('dlg', 'Insert image'), properties: ['openFile'], filters: [{ name: tl('dlg', 'Images'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return assets.importFile(noteRel, r.filePaths[0]);
});
h('fs:pick-media', async (noteRel, kind) => {
  const FILTERS = {
    font: [{ name: tl('dlg', 'Fonts'), extensions: ['woff2', 'woff', 'ttf', 'otf'] }],
    video: [{ name: tl('dlg', 'Video'), extensions: ['mp4', 'webm', 'mov', 'm4v'] }],
    audio: [{ name: tl('dlg', 'Audio'), extensions: ['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac'] }],
    pdf: [{ name: 'PDF', extensions: ['pdf'] }],
    file: [],
  };
  const TITLES = { font: tl('dlg', 'Add a font file'), video: tl('dlg', 'Insert a video'), audio: tl('dlg', 'Insert audio'), pdf: tl('dlg', 'Insert a PDF'), file: tl('dlg', 'Attach a file') };
  const r = await dialog.showOpenDialog(win, { title: TITLES[kind] || tl('dlg', 'Insert video or audio'), properties: ['openFile'], filters: FILTERS[kind] ?? [{ name: tl('dlg', 'Video and audio'), extensions: ['mp4', 'webm', 'mov', 'm4v', 'mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return assets.importFile(noteRel, r.filePaths[0]);
});
/* assets: files a page lost, files a page needs, unused and missing files, migration from assets/ */
/* property types chosen per name, kept beside the history: <workspace>/.folio/property-types.json */
const typesFile = () => path.join(notes.root(), '.folio', 'property-types.json');
h('props:types', async () => { try { return JSON.parse(await fs.readFile(typesFile(), 'utf8')); } catch { return {}; } });
h('props:set-type', async (key, type) => {
  if (typeof key !== 'string' || !/^[A-Za-z_][\w .-]{0,40}$/.test(key) || !['text', 'number', 'checkbox', 'date', 'datetime', 'list', 'tags', 'link'].includes(type)) throw new Error('Not a property type.');
  let cur = {}; try { cur = JSON.parse(await fs.readFile(typesFile(), 'utf8')); } catch {}
  cur[key.toLowerCase()] = type; await fs.mkdir(path.dirname(typesFile()), { recursive: true }); await fs.writeFile(typesFile(), JSON.stringify(cur, null, 1), 'utf8'); return cur;
});
h('assets:sync', async (noteRel, before, after) => ({ ...(await assets.heal(noteRel, after)), orphans: await assets.orphans(noteRel, before, after), refs: [...assets.refsOf(noteRel, after)] }));
h('assets:restore', async (paths) => { let n = 0; for (const p of paths.slice(0, 500)) if (await assets.restore(p).catch(() => false)) n++; return n; });
h('assets:heal', (noteRel, text) => assets.heal(noteRel, text));
h('assets:remove', async (paths, permanent, { onlyUnused = true } = {}) => { const list = paths.slice(0, 500); const busy = onlyUnused ? await assets.stillUsed(list) : new Set(); let n = 0; for (const p of list) if (!busy.has(p) && await assets.remove(p, { permanent: !!permanent }).catch(() => false)) n++; return n; });
h('assets:usage', () => assets.usage());
h('assets:migrate', () => assets.migrateLegacy({ onBefore: (f, t) => keep(f, t, { reason: 'assets', force: true }) }));
h('assets:reveal', (assetRel) => { const abs = notes.resolve(assetRel); shell.showItemInFolder(abs); });
h('fs:abs-url', (rel) => 'file://' + notes.resolve(rel).split(path.sep).join('/'));
h('shell:open', (url) => { if (/^(https?|mailto):/.test(url)) shell.openExternal(url); });
/* open a file of the workspace (an attached PDF, a document) with the system's app */
/* templates (D9): the community gallery and links to Markdown files. Text only, 1 MB at most, HTTPS (or this machine) */
const TEMPLATE_MAX = 1024 * 1024;
h('templates:fetch', async (url) => {
  const u = new URL(String(url));
  const local = u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname);
  if (u.protocol !== 'https:' && !local) throw new Error('Only https:// links can be downloaded.');
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await net.fetch(u.href, { signal: ctl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`The server answered ${res.status}.`);
    const type = res.headers.get('content-type') || '';
    if (/^(image|video|audio|application\/(pdf|zip|octet-stream))/i.test(type)) throw new Error('That link is not a text file.');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > TEMPLATE_MAX) throw new Error('That file is larger than 1 MB.');
    return buf.toString('utf8');
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'The download took too long.' : e.message); } finally { clearTimeout(timer); }
});
h('templates:import-files', async () => {
  const r = await dialog.showOpenDialog(win, { title: tl('dlg', 'Import templates'), properties: ['openFile', 'multiSelections'], filters: [{ name: tl('dlg', 'Markdown'), extensions: ['md', 'markdown', 'txt'] }] });
  if (r.canceled) return [];
  const out = [];
  for (const f of r.filePaths.slice(0, 50)) { const st = await fs.stat(f); if (st.size > TEMPLATE_MAX) continue; out.push({ name: path.basename(f).replace(/\.(md|markdown|txt)$/i, ''), text: await fs.readFile(f, 'utf8') }); }
  return out;
});
h('shell:open-file', async (rel) => { const abs = notes.resolve(rel); await fs.access(abs); const err = await shell.openPath(abs); if (err) throw new Error(err); return true; });
h('clipboard:write', (text) => clipboard.writeText(text));
h('clipboard:read', () => ({ text: clipboard.readText(), html: clipboard.readHTML() }));
/* Word and HTML documents become pages: Word is read here with mammoth, the renderer turns the HTML into Markdown */
h('import:document', async () => {
  const pick = !app.isPackaged && process.env.FOLIO_IMPORT_FILE ? { filePaths: [process.env.FOLIO_IMPORT_FILE] } : await dialog.showOpenDialog(win, { title: tl('dlg', 'Import a document'), properties: ['openFile'], filters: [{ name: tl('dlg', 'Documents'), extensions: ['docx', 'html', 'htm'] }] });
  const f = pick.filePaths?.[0]; if (pick.canceled || !f) return null;
  const st = await fs.stat(f); if (st.size > 60 * 1024 * 1024) throw new Error('That file is larger than 60 MB.');
  const name = path.basename(f).replace(/\.(docx|html?)$/i, '');
  if (/\.html?$/i.test(f)) return { name, html: await fs.readFile(f, 'utf8'), messages: [] };
  const { default: mammoth } = await import('mammoth');
  const r = await mammoth.convertToHtml({ buffer: await fs.readFile(f) }, {
    styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => p > em:fresh", "p[style-name='Quote'] => blockquote > p:fresh", "p[style-name='Intense Quote'] => blockquote > p:fresh", "r[style-name='Code'] => code", "p[style-name='Code'] => pre:separator('\\n')", 'highlight => mark'],
    convertImage: mammoth.images.imgElement((img) => img.read('base64').then((b) => ({ src: `data:${img.contentType};base64,${b}` }))),
  });
  return { name, html: r.value, messages: r.messages.filter((m) => m.type === 'warning').slice(0, 5).map((m) => m.message) };
});

h('export:html', async (rel, html) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: rel.replace(/\.\w+$/, '.html').split('/').pop(), filters: [{ name: 'HTML', extensions: ['html'] }] });
  if (r.canceled) return null;
  await fs.writeFile(r.filePath, html, 'utf8'); shell.showItemInFolder(r.filePath); return r.filePath;
});
h('export:binary', async (rel, ext, bytes) => {
  const base = rel.split('/').pop().replace(/(\.(slides|board|sheet))?\.\w+$/, '');
  const r = !app.isPackaged && process.env.FOLIO_EXPORT_DIR ? { filePath: path.join(process.env.FOLIO_EXPORT_DIR, `${base}.${ext}`) } : await dialog.showSaveDialog(win, { defaultPath: `${base}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (r.canceled) return null;
  await fs.writeFile(r.filePath, Buffer.from(bytes)); if (!process.env.FOLIO_EXPORT_DIR) shell.showItemInFolder(r.filePath); return r.filePath;
});
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif' };
h('fs:data-url', async (src, noteRel) => {
  if (/^data:/.test(src)) return src;
  if (/^https?:\/\//.test(src)) {
    const { net } = await import('electron');
    const res = await net.fetch(src);
    if (!res.ok) throw new Error(`Image download failed (${res.status})`);
    const type = res.headers.get('content-type') || 'image/png';
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  }
  const rel = decodeURI(src).replace(/^\.\//, '');
  const abs = src.startsWith('file://') ? fileURLToPath(src) : notes.resolve(path.posix.join(path.posix.dirname(noteRel || ''), rel));
  const buf = await fs.readFile(abs);
  return `data:${MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream'};base64,${buf.toString('base64')}`;
});
h('export:pdf', async (rel, html, opts = {}) => {
  const pdfName = rel.replace(/(\.(slides|board|sheet))?\.\w+$/, '.pdf').split('/').pop();
  const r = !app.isPackaged && process.env.FOLIO_EXPORT_DIR ? { filePath: path.join(process.env.FOLIO_EXPORT_DIR, pdfName) } : await dialog.showSaveDialog(win, { defaultPath: pdfName, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled) return null;
  const tmp = path.join(os.tmpdir(), `folio-export-${Date.now()}.html`);
  await fs.writeFile(tmp, html, 'utf8');
  const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  await pw.loadFile(tmp);
  const pdf = await pw.webContents.printToPDF(opts.print ? opts.print : opts.cssPage ? { printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } } : { printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } });
  pw.destroy(); fs.unlink(tmp).catch(() => {});
  await fs.writeFile(r.filePath, pdf); if (!process.env.FOLIO_EXPORT_DIR) shell.showItemInFolder(r.filePath); return r.filePath;
});

/* ---------------- renderer round-trips for app-only tools ---------------- */
const pending = new Map();
function askRenderer(kind, payload, timeout = 4000) {
  return new Promise((resolve, reject) => {
    if (!win) return reject(new Error('Folio has no open window.'));
    const id = crypto.randomUUID();
    const t = setTimeout(() => { pending.delete(id); reject(new Error('Folio did not answer in time.')); }, timeout);
    pending.set(id, (v) => { clearTimeout(t); resolve(v); });
    win.webContents.send('ai:ask', { id, kind, payload });
  });
}
ipcMain.on('ai:answer', (_e, { id, value }) => pending.get(id)?.(value));

/* ---------------- MCP ---------------- */
let httpServer = null, mcpServerPort = null, mcpError = null;
const activity = []; // recent AI calls, shown in the AI panel

function mcpStatus() {
  return { enabled: settings.mcpEnabled, port: mcpServerPort, error: mcpError, url: mcpServerPort ? `http://127.0.0.1:${mcpServerPort}/mcp` : null, allowWrite: settings.allowWrite, activity: activity.slice(0, 30) };
}
function logActivity(entry) {
  activity.unshift({ ...entry, at: Date.now() });
  activity.length = Math.min(activity.length, 60);
  win?.webContents.send('ai:activity', mcpStatus());
}

const appBackend = {
  capabilities: () => ({ app: true, write: settings.allowWrite }),
  async call(name, args, ctx) {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) throw new Error(`Unknown tool ${name}`);
    if (tool.write && !settings.allowWrite) throw new Error('Folio is set to read-only for AI assistants. The user can allow edits in Folio → AI.');
    if (!settings.workspace) throw new Error('No folder is open in Folio. Ask the user to open one.');
    logActivity({ client: ctx.client, tool: name, path: args.path || args.from || args.query || '' });
    return runTool(notes, name, args, {
      history, client: ctx.client,
      onWrite: async (r) => {
        if (r.before != null) await keep(r.path, r.before, { reason: 'before-ai', force: true });
        await keep(r.path, r.after, { by: ctx.client || 'AI', reason: 'ai', force: true });
        ownWrites.set(notes.resolve(r.path), r.after);
        const orphans = r.before != null ? await assets.orphans(r.path, r.before, r.after).catch(() => []) : [];
        win?.webContents.send('ai:edit', { ...r, client: ctx.client, orphans });
      },
      onMove: async (r) => win?.webContents.send('ai:move', { ...r, client: ctx.client }),
      openNote: () => askRenderer('open-note'),
      showNote: (a) => { win?.show(); win?.focus(); return askRenderer('show-note', a); },
    });
  },
};

function allowedHost(req) {
  const host = (req.headers.host || '').split(':')[0];
  if (!['127.0.0.1', 'localhost'].includes(host)) return false;
  const origin = req.headers.origin;
  return !origin || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
}
async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 8e6) throw new Error('Body too large'); chunks.push(c); }
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : undefined;
}
function startMcp() {
  return new Promise((resolve) => {
    if (!settings.mcpEnabled) { mcpServerPort = null; writeBridge(); win?.webContents.send('ai:activity', mcpStatus()); return resolve(); }
    httpServer = http.createServer(async (req, res) => {
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      try {
        if (!allowedHost(req)) return send(403, { error: 'Forbidden host or origin' });
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/health') return send(200, { ok: true, app: 'folio' });
        if ((req.headers.authorization || '') !== `Bearer ${settings.token}`) return send(401, { error: 'Missing or wrong token. Copy it from Folio → AI.' });
        if (url.pathname === '/api/tool' && req.method === 'POST') {
          const { name, args, client } = await readBody(req);
          try { return send(200, { ok: true, value: await appBackend.call(name, args || {}, { client: client || 'AI assistant' }) }); }
          catch (e) { return send(200, { ok: false, error: e.message }); }
        }
        if (url.pathname === '/mcp') {
          if (req.method !== 'POST') return send(405, { error: 'Stateless server: POST only' });
          const body = await readBody(req);
          const label = String(req.headers['x-folio-client'] || '') || null;
          const server = buildServer(appBackend, { clientLabel: () => label });
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
          res.on('close', () => { transport.close(); server.close(); });
          await server.connect(transport);
          return transport.handleRequest(req, res, body);
        }
        send(404, { error: 'Not found' });
      } catch (e) { if (!res.headersSent) send(500, { error: e.message }); }
    });
    httpServer.on('error', (e) => {
      mcpError = e.code === 'EADDRINUSE' ? `Port ${settings.mcpPort} is taken by another app.` : e.message;
      mcpServerPort = null; writeBridge(); win?.webContents.send('ai:activity', mcpStatus()); resolve();
    });
    httpServer.listen(settings.mcpPort, '127.0.0.1', () => {
      mcpError = null; mcpServerPort = httpServer.address().port; writeBridge(); win?.webContents.send('ai:activity', mcpStatus()); resolve();
    });
  });
}
async function restartMcp() {
  if (httpServer) await new Promise((r) => httpServer.close(() => r()));
  httpServer = null; mcpServerPort = null;
  await startMcp();
}
h('mcp:status', () => mcpStatus());
h('mcp:token', () => settings.token);
h('mcp:rotate-token', () => { settings.token = crypto.randomBytes(24).toString('hex'); saveSettings(); return settings.token; });

/* ---------------- connections to AI clients ---------------- */
function stdioScript() {
  const p = path.join(__dirname, 'mcp-stdio.mjs');
  return p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}
function stdioEntry() {
  return { command: process.execPath, args: [stdioScript(), '--bridge', BRIDGE_FILE()], env: { ELECTRON_RUN_AS_NODE: '1' } };
}
const home = os.homedir();
const appData = isMac ? path.join(home, 'Library', 'Application Support') : (process.env.APPDATA || path.join(home, 'AppData', 'Roaming'));
const TARGETS = {
  claude: { name: 'Claude Desktop', file: path.join(appData, 'Claude', 'claude_desktop_config.json'), key: 'mcpServers', shape: (e) => e, restart: 'Quit and reopen Claude Desktop.' },
  cursor: { name: 'Cursor', file: path.join(home, '.cursor', 'mcp.json'), key: 'mcpServers', shape: (e) => e, restart: 'Cursor picks it up in Settings → MCP.' },
  vscode: { name: 'VS Code (Copilot)', file: path.join(appData, 'Code', 'User', 'mcp.json'), key: 'servers', shape: (e) => ({ type: 'stdio', ...e }), restart: 'Start it from the MCP view in VS Code.' },
  windsurf: { name: 'Windsurf', file: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'), key: 'mcpServers', shape: (e) => e, restart: 'Refresh in Windsurf → Cascade → MCP.' },
  lmstudio: { name: 'LM Studio', file: path.join(home, '.lmstudio', 'mcp.json'), key: 'mcpServers', shape: (e) => e, restart: 'LM Studio reloads mcp.json on save.' },
};
function quote(s) { return /[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s; }
async function readJson(file) {
  try { const t = await fs.readFile(file, 'utf8'); return t.trim() ? JSON.parse(t) : {}; }
  catch (e) { if (e.code === 'ENOENT') return {}; throw new Error(`Could not read ${file}: ${e.message}`); }
}
h('connections:list', async () => {
  const entry = stdioEntry();
  const list = [];
  for (const [id, t] of Object.entries(TARGETS)) {
    let installed = false, appPresent = fss.existsSync(path.dirname(t.file));
    try { installed = !!(await readJson(t.file))?.[t.key]?.folio; } catch {}
    list.push({ id, name: t.name, file: t.file, installed, appPresent, restart: t.restart, snippet: JSON.stringify({ [t.key]: { folio: t.shape(entry) } }, null, 2) });
  }
  const cli = `claude mcp add folio --scope user -e ELECTRON_RUN_AS_NODE=1 -- ${[entry.command, ...entry.args].map(quote).join(' ')}`;
  return { list, claudeCode: cli, httpUrl: mcpServerPort ? `http://127.0.0.1:${mcpServerPort}/mcp` : null };
});
h('connections:install', async (id) => {
  const t = TARGETS[id]; if (!t) throw new Error('Unknown app');
  const cfg = await readJson(t.file);
  if (fss.existsSync(t.file)) await fs.copyFile(t.file, t.file + '.folio-backup');
  cfg[t.key] = { ...(cfg[t.key] || {}), folio: t.shape(stdioEntry()) };
  await fs.mkdir(path.dirname(t.file), { recursive: true });
  await fs.writeFile(t.file, JSON.stringify(cfg, null, 2));
  return { file: t.file, restart: t.restart };
});
h('connections:remove', async (id) => {
  const t = TARGETS[id]; const cfg = await readJson(t.file);
  if (cfg[t.key]?.folio) { delete cfg[t.key].folio; await fs.writeFile(t.file, JSON.stringify(cfg, null, 2)); }
  return true;
});

/* ---------------- menu ---------------- */
function buildMenu() {
  const cmd = (id) => () => win?.webContents.send('menu:command', id);
  const template = [
    ...(isMac ? [{ label: 'Folio', submenu: [{ role: 'about' }, { type: 'separator' }, { label: tl('menu', 'Settings…'), accelerator: 'Cmd+,', click: cmd('settings') }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: tl('menu', 'File'), submenu: [
      { label: tl('menu', 'New Note'), accelerator: 'CmdOrCtrl+N', click: cmd('new-note') },
      { label: tl('menu', 'Open Folder…'), accelerator: 'CmdOrCtrl+O', click: cmd('open-folder') },
      { label: tl('menu', 'Quick Open…'), accelerator: 'CmdOrCtrl+P', click: cmd('quick-open') },
      { type: 'separator' },
      { label: tl('menu', 'Save'), accelerator: 'CmdOrCtrl+S', click: cmd('save') },
      { label: tl('menu', 'Close Tab'), accelerator: 'CmdOrCtrl+W', click: cmd('close-tab') },
      { type: 'separator' },
      { label: tl('menu', 'Import Word or HTML…'), click: cmd('import-document') },
      { label: tl('menu', 'Export…'), accelerator: 'CmdOrCtrl+Shift+E', click: cmd('export') },
      { label: tl('menu', 'Export as PDF…'), click: cmd('export-pdf') },
      { label: tl('menu', 'Export as Word…'), click: cmd('export-docx') },
      { label: tl('menu', 'Export as HTML…'), click: cmd('export-html') },
      { label: tl('menu', 'Export as Portable Markdown…'), click: cmd('export-md') },
      ...(isMac ? [] : [{ type: 'separator' }, { label: tl('menu', 'Settings…'), accelerator: 'Ctrl+,', click: cmd('settings') }, { role: 'quit' }]),
    ] },
    { label: tl('menu', 'Edit'), submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { label: tl('menu', 'Paste as Plain Text'), accelerator: 'CmdOrCtrl+Shift+V', click: cmd('paste-plain') }, { role: 'selectAll' }, { type: 'separator' },
      { label: tl('menu', 'Find in Note'), accelerator: 'CmdOrCtrl+F', click: cmd('find') },
      { label: tl('menu', 'Find and Replace…'), accelerator: process.platform === 'darwin' ? 'Cmd+Alt+H' : 'Ctrl+H', click: cmd('replace') },
      { label: tl('menu', 'Search All Notes'), accelerator: 'CmdOrCtrl+Shift+F', click: cmd('search') }] },
    { label: tl('menu', 'Format'), submenu: [
      { label: tl('menu', 'Bold'), accelerator: 'CmdOrCtrl+B', click: cmd('bold') },
      { label: tl('menu', 'Italic'), accelerator: 'CmdOrCtrl+I', click: cmd('italic') },
      { label: tl('menu', 'Link'), accelerator: 'CmdOrCtrl+K', click: cmd('link') },
      { label: tl('menu', 'Inline Code'), accelerator: 'CmdOrCtrl+E', click: cmd('code') },
      { label: tl('menu', 'Task'), accelerator: 'CmdOrCtrl+L', click: cmd('task') }] },
    { label: tl('menu', 'View'), submenu: [
      { label: tl('menu', 'Editor'), accelerator: 'CmdOrCtrl+1', click: cmd('mode-edit') },
      { label: tl('menu', 'Split'), accelerator: 'CmdOrCtrl+2', click: cmd('mode-split') },
      { label: tl('menu', 'Preview'), accelerator: 'CmdOrCtrl+3', click: cmd('mode-preview') },
      { type: 'separator' },
      { label: tl('menu', 'Toggle Sidebar'), accelerator: 'CmdOrCtrl+\\', click: cmd('toggle-sidebar') },
      { label: tl('menu', 'Toggle Outline'), accelerator: 'CmdOrCtrl+Shift+O', click: cmd('toggle-outline') },
      { label: tl('menu', 'Focus Mode'), accelerator: 'CmdOrCtrl+.', click: cmd('focus') },
      { label: tl('menu', 'Command Palette…'), accelerator: 'CmdOrCtrl+Shift+P', click: cmd('palette') },
      { type: 'separator' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])] },
    { label: tl('menu', 'AI'), submenu: [{ label: tl('menu', 'Connect AI Assistants…'), accelerator: 'CmdOrCtrl+Shift+A', click: cmd('ai') }] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [
      { label: tl('menu', 'Shortcuts and Syntax'), accelerator: 'F1', click: cmd('help') },
      { label: tl('menu', 'About Folio'), click: () => app.showAboutPanel() },
      { label: tl('menu', 'Source code and license'), click: () => shell.openExternal('https://github.com/gabrielevaudano98/folio') },
      { label: tl('menu', 'Report a problem'), click: () => shell.openExternal('https://github.com/gabrielevaudano98/folio/issues/new/choose') },
      { label: tl('menu', 'File formats'), click: () => shell.openExternal('https://github.com/gabrielevaudano98/folio/blob/main/docs/FORMATS.md') },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------- lifecycle ---------------- */
let pendingOpen = null;
app.on('open-file', (e, file) => { e.preventDefault(); pendingOpen = file; if (win) openPath(file); });
async function openPath(file) {
  const st = await fs.stat(file).catch(() => null);
  if (!st) return;
  if (st.isDirectory()) { await setWorkspace(file); win?.webContents.send('workspace:switched', { file: null }); return; }
  if (!settings.workspace || !path.resolve(file).startsWith(path.resolve(settings.workspace) + path.sep)) await setWorkspace(path.dirname(file));
  win?.webContents.send('workspace:switched', { file: notes.relOf(file) });
}
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  const f = argv.slice(1).find((a) => !a.startsWith('-') && fss.existsSync(a));
  if (f) openPath(f);
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.whenReady().then(async () => {
  nativeTheme.themeSource = settings.theme;
  setLocale(settings.language);
  buildMenu();
  if (settings.workspace && fss.existsSync(settings.workspace)) await setWorkspace(settings.workspace);
  else settings.workspace = null;
  await startMcp();
  createWindow();
  const argFile = process.argv.slice(app.isPackaged ? 1 : 2).find((a) => !a.startsWith('-') && fss.existsSync(a));
  if (pendingOpen || argFile) win.webContents.once('did-finish-load', () => openPath(pendingOpen || argFile));
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
app.on('before-quit', () => { if (win) win.__forceClose = true; try { const b = JSON.parse(fss.readFileSync(BRIDGE_FILE(), 'utf8')); b.port = null; fss.writeFileSync(BRIDGE_FILE(), JSON.stringify(b, null, 2)); } catch {} });

/* dev only: scripted screenshots for visual QA */
async function devShot(w) {
  const steps = JSON.parse(fss.readFileSync(process.env.FOLIO_SHOT, 'utf8'));
  w.webContents.on('console-message', (e) => { const msg = e.message; if (/error|fail/i.test(String(msg))) console.log('console:', msg); });
  w.webContents.once('did-finish-load', async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await wait(1500);
    for (const s of steps) {
      if (s.size) w.setContentSize(s.size[0], s.size[1]);
      if (s.dark !== undefined) nativeTheme.themeSource = s.dark ? 'dark' : 'light';
      if (s.js) { try { const v = await w.webContents.executeJavaScript(s.js); if (s.log) console.log('js', JSON.stringify(v)); } catch (e) { console.error('[folio-error] shot js', e.message); } }
      if (s.tool) { try { await appBackend.call(s.tool.name, s.tool.args, { client: s.tool.client || 'Claude Desktop' }); } catch (e) { console.error('shot tool', e.message); } }
      await wait(s.wait ?? 700);
      if (s.out) { const img = await w.webContents.capturePage(); fss.writeFileSync(s.out, img.toPNG()); console.log('shot', s.out); }
    }
    app.exit(0);
  });
}
