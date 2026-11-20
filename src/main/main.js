// Folio — main process.
import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, systemPreferences, Menu, clipboard, screen, session } from 'electron';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createNotes, NOTE_EXT } from './notes.js';
import { buildServer, runTool, TOOLS } from './mcp-tools.js';
import { startQa, pollQa, stopQa } from './qa.js';
import { mayUse } from './permissions.js';
import { assertPublicHost } from './netguard.js';
// tests: a fake microphone and camera, granted without a prompt
if (process.env.FOLIO_FAKE_MEDIA) { app.commandLine.appendSwitch('use-fake-device-for-media-stream'); app.commandLine.appendSwitch('use-fake-ui-for-media-stream'); }

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
  lineWidth: 72, spellcheck: true, mcpEnabled: true, mcpPort: 47321, allowWrite: true,
  token: crypto.randomBytes(24).toString('hex'), showOutline: true, sidebar: true,
};
let settings = { ...defaults };
try { settings = { ...defaults, ...JSON.parse(fss.readFileSync(SETTINGS_FILE(), 'utf8')) }; } catch {}
function saveSettings() {
  fss.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
  fss.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2), { mode: 0o600 }); // it holds the MCP token
  try { fss.chmodSync(SETTINGS_FILE(), 0o600); } catch {}
  writeBridge();
}
function writeBridge() {
  const b = { port: mcpServerPort, token: settings.token, workspace: settings.workspace, allowWrite: settings.allowWrite, pid: process.pid };
  try { fss.writeFileSync(BRIDGE_FILE(), JSON.stringify(b, null, 2), { mode: 0o600 }); fss.chmodSync(BRIDGE_FILE(), 0o600); } catch {} // the mode only applies to a new file, so older installs are repaired here
}

const notes = createNotes(() => settings.workspace);
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
  // mouse and trackpad back/forward: Windows app commands, macOS swipes
  win.on('app-command', (_e, c) => { if (c === 'browser-backward') win.webContents.send('menu:command', 'nav-back'); else if (c === 'browser-forward') win.webContents.send('menu:command', 'nav-forward'); });
  win.on('swipe', (_e, dir) => { if (dir === 'left') win.webContents.send('menu:command', 'nav-back'); else if (dir === 'right') win.webContents.send('menu:command', 'nav-forward'); });
  if (!app.isPackaged && process.env.FOLIO_SHOT) devShot(win);
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    // the presenter's audience window: full screen on another display when there is one
    if (frameName === 'folio-audience' && (url === 'about:blank' || url === '')) {
      const here = screen.getDisplayMatching(win.getBounds()); const other = screen.getAllDisplays().find((d) => d.id !== here.id);
      const b = (other || here).bounds;
      return { action: 'allow', overrideBrowserWindowOptions: { x: b.x, y: b.y, width: other ? b.width : 1280, height: other ? b.height : 720, fullscreen: !!other, autoHideMenuBar: true, backgroundColor: '#000000', title: 'Folio — audience', webPreferences: { sandbox: true, contextIsolation: true } } };
    }
    if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' };
  });
  // the window never leaves the app page: any other address (a file: page would inherit the preload bridge) opens in the browser or not at all
  const here = (u) => String(u).split(/[?#]/)[0];
  const lock = (e, url) => { if (here(url) === here(win.webContents.getURL())) return; e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); };
  win.webContents.on('will-navigate', lock);
  win.webContents.on('will-redirect', lock);
  win.on('close', (e) => {
    if (win.__forceClose) return;
    e.preventDefault();
    win.webContents.send('app:before-close');
  });
}
ipcMain.on('app:close-ok', (e) => { if (fromApp(e) && win) { win.__forceClose = true; win.close(); } });

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
  await clearTrashed();
  settings.workspace = dir;
  if (dir) settings.recent = [dir, ...settings.recent.filter((d) => d !== dir)].slice(0, 8);
  saveSettings();
  await watcher?.close();
  watcher = null;
  if (!dir) return;
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
// only the app's own page may call into the main process: not a subframe, not another window
const fromApp = (e) => !!win && e.sender === win.webContents && e.senderFrame === win.webContents.mainFrame;
const h = (ch, fn) => ipcMain.handle(ch, async (e, ...a) => {
  if (!fromApp(e)) return { ok: false, error: 'Not allowed from here.' };
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
  saveSettings();
  if (patch.mcpEnabled !== undefined || patch.mcpPort !== before.mcpPort) await restartMcp();
  return { ...settings, token: undefined };
});
h('workspace:choose', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Open a folder of notes' });
  if (r.canceled || !r.filePaths[0]) return null;
  await setWorkspace(r.filePaths[0]);
  return r.filePaths[0];
});
h('workspace:open', async (dir) => {
  if (typeof dir !== 'string' || ![settings.workspace, ...settings.recent].includes(dir)) throw new Error('Choose that folder with Open Folder first.'); // only folders the person picked
  if (!fss.existsSync(dir)) throw new Error('That folder no longer exists.');
  await setWorkspace(dir); return dir;
});
h('workspace:close', async () => { await setWorkspace(null); return true; });
h('workspace:reveal', (rel) => shell.showItemInFolder(rel ? notes.resolve(rel) : notes.root()));
h('fs:tree', () => notes.tree());
h('fs:read', (rel) => notes.read(rel));
h('fs:write', async (rel, content) => {
  const abs = notes.resolve(rel, { mustBeNote: true });
  ownWrites.set(abs, content);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
  return true;
});
h('fs:create', async (rel, content = '') => {
  const abs = notes.resolve(rel, { mustBeNote: true });
  if (fss.existsSync(abs)) throw new Error('A note with that name already exists.');
  ownWrites.set(abs, content);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
  return notes.relOf(abs);
});
h('fs:mkdir', async (rel) => { await fs.mkdir(notes.resolve(rel, { notRoot: true }), { recursive: true }); return rel; });
h('fs:rename', async (from, to) => {
  const isDir = (await fs.stat(notes.resolve(from, { notRoot: true })).catch(() => null))?.isDirectory();
  const r = await notes.move(from, to);
  const pairs = isDir ? (await notes.allFiles()).filter((f) => f.startsWith(r.to + '/')).map((f) => [r.from + f.slice(r.to.length), f]) : [[r.from, r.to]];
  const changed = new Set();
  for (const [a, b] of pairs) for (const c of await notes.rewriteAfterMove(a, b).catch(() => [])) changed.add(c);
  return { to: r.to, changed: [...changed] };
});
// A copy of every trashed item is kept in a private folder for this session so the move can be undone.
// Copies belong to the workspace they came from and are removed when it changes and when Folio quits.
const trashed = new Map();
let undoDir = null;
const undoRoot = () => path.join(app.getPath('userData'), 'undo');
async function clearTrashed() { trashed.clear(); undoDir = null; await fs.rm(undoRoot(), { recursive: true, force: true }).catch(() => {}); }
h('fs:trash', async (rel) => {
  const abs = notes.resolve(rel, { notRoot: true });
  if (!undoDir) { await fs.mkdir(undoRoot(), { recursive: true, mode: 0o700 }); undoDir = await fs.mkdtemp(path.join(undoRoot(), 's-')); } // mkdtemp makes it owner-only
  const token = crypto.randomUUID(); const keep = path.join(undoDir, token);
  await fs.mkdir(keep);
  await fs.cp(abs, path.join(keep, 'item'), { recursive: true });
  if (process.env.FOLIO_FAKE_TRASH === '1' && !app.isPackaged) await fs.rm(abs, { recursive: true, force: true }); else await shell.trashItem(abs);
  trashed.set(token, { rel, keep, root: notes.root() });
  while (trashed.size > 25) { const [old, e] = trashed.entries().next().value; trashed.delete(old); fs.rm(e.keep, { recursive: true, force: true }).catch(() => {}); }
  return { token };
});
h('fs:untrash', async (token) => {
  const e = trashed.get(token);
  if (!e || e.root !== notes.root()) throw new Error('That item can no longer be restored from here. Look in the system Trash.');
  const abs = notes.resolve(e.rel);
  if (fss.existsSync(abs)) throw new Error('Something with that name already exists.');
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.cp(path.join(e.keep, 'item'), abs, { recursive: true, force: false, errorOnExist: true }); // never overwrite something created meanwhile
  return e.rel;
});
h('fs:search', (q, opts) => notes.search(q, opts));
h('app:user-name', () => { try { const n = os.userInfo().username || ''; return n.charAt(0).toUpperCase() + n.slice(1); } catch { return ''; } });
h('fs:backlinks', (rel) => notes.backlinks(rel));
h('fs:broken-links', (rel) => notes.brokenLinks(rel));
h('fs:list', () => notes.list({ limit: 5000 }));
h('fs:save-image', async (noteRel, name, bytes) => {
  const dir = path.join(path.dirname(notes.resolve(noteRel)), 'assets');
  await fs.mkdir(dir, { recursive: true });
  const safe = (name || 'image.png').replace(/[^\w.-]+/g, '-');
  const file = path.join(dir, `${Date.now().toString(36)}-${safe}`);
  await fs.writeFile(file, Buffer.from(bytes));
  return path.relative(path.dirname(notes.resolve(noteRel)), file).split(path.sep).join('/');
});
h('fs:pick-image', async (noteRel) => {
  const r = await dialog.showOpenDialog(win, { title: 'Insert image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = path.join(path.dirname(notes.resolve(noteRel)), 'assets');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${Date.now().toString(36)}-${path.basename(r.filePaths[0]).replace(/[^\w.-]+/g, '-')}`);
  await fs.copyFile(r.filePaths[0], file);
  return path.relative(path.dirname(notes.resolve(noteRel)), file).split(path.sep).join('/');
});
/** a PowerPoint file or template to import: its name and bytes (FOLIO_IMPORT_FILE stands in for the dialog in tests) */
h('qa:start', (title) => startQa(String(title || '').slice(0, 80)));
h('qa:poll', () => pollQa());
h('qa:stop', () => stopQa());
let importN = 0;
h('fs:pick-office', async () => {
  const dev = !app.isPackaged && process.env.FOLIO_IMPORT_FILE;
  const r = dev ? { filePaths: [process.env.FOLIO_IMPORT_FILE.split('|')[importN++ % process.env.FOLIO_IMPORT_FILE.split('|').length]] } : await dialog.showOpenDialog(win, { title: 'Import PowerPoint', properties: ['openFile'], filters: [{ name: 'PowerPoint', extensions: ['pptx', 'potx'] }] });
  if (r.canceled || !r.filePaths?.[0]) return null;
  const file = r.filePaths[0];
  if (!/\.(pptx|potx)$/i.test(file)) throw new Error('Choose a .pptx or .potx file.');
  const st = await fs.stat(file); if (st.size > 300 * 1024 * 1024) throw new Error('This file is too large to import (over 300 MB).');
  return { name: path.basename(file).replace(/\.(pptx|potx)$/i, ''), ext: path.extname(file).slice(1).toLowerCase(), bytes: new Uint8Array(await fs.readFile(file)) };
});
h('fs:pick-media', async (noteRel, kind) => {
  const font = kind === 'font';
  const r = await dialog.showOpenDialog(win, { title: font ? 'Add a font file' : 'Insert video or audio', properties: ['openFile'], filters: font ? [{ name: 'Fonts', extensions: ['woff2', 'woff', 'ttf', 'otf'] }] : [{ name: 'Video and audio', extensions: ['mp4', 'webm', 'mov', 'm4v', 'mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = path.join(path.dirname(notes.resolve(noteRel)), 'assets');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${Date.now().toString(36)}-${path.basename(r.filePaths[0]).replace(/[^\w.-]+/g, '-')}`);
  await fs.copyFile(r.filePaths[0], file);
  return path.relative(path.dirname(notes.resolve(noteRel)), file).split(path.sep).join('/');
});
h('fs:abs-url', (rel) => 'file://' + notes.resolve(rel).split(path.sep).join('/'));
h('shell:open', (url) => { if (/^(https?|mailto):/.test(url)) shell.openExternal(url); });
h('clipboard:write', (text) => clipboard.writeText(text));

h('export:html', async (rel, html) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: rel.replace(/\.\w+$/, '.html').split('/').pop(), filters: [{ name: 'HTML', extensions: ['html'] }] });
  if (r.canceled) return null;
  await fs.writeFile(r.filePath, html, 'utf8'); shell.showItemInFolder(r.filePath); return r.filePath;
});
h('export:binary', async (rel, ext, bytes) => {
  if (!/^[a-z0-9]{1,8}$/i.test(ext || '')) throw new Error('Unsupported file type.');
  const base = rel.split('/').pop().replace(/(\.(slides|board|sheet))?\.\w+$/, '');
  const r = !app.isPackaged && process.env.FOLIO_EXPORT_DIR ? { filePath: path.join(process.env.FOLIO_EXPORT_DIR, `${base}.${ext}`) } : await dialog.showSaveDialog(win, { defaultPath: `${base}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (r.canceled) return null;
  await fs.writeFile(r.filePath, Buffer.from(bytes)); if (!process.env.FOLIO_EXPORT_DIR) shell.showItemInFolder(r.filePath); return r.filePath;
});
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.aac': 'audio/aac', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' };
const MAX_REMOTE = 30 * 1024 * 1024;
h('fs:data-url', async (src, noteRel) => {
  if (/^data:/.test(src)) return src;
  if (/^https?:\/\//.test(src)) {
    // a note can name any address: no private network (checked by name and by what it resolves to), only images, audio, video and fonts, bounded in size and time
    const { net } = await import('electron');
    // follow redirects by hand so every hop is checked before it is requested
    let url = src, res;
    for (let hop = 0; ; hop++) {
      if (hop > 5) throw new Error('Too many redirects.');
      await assertPublicHost(new URL(url).hostname);
      res = await net.fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
      const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!next) break;
      url = new URL(next, url).href; if (!/^https?:\/\//.test(url)) throw new Error('That address is not a web address.');
    }
    if (!res.ok) throw new Error(`Image download failed (${res.status})`);
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!/^(image|audio|video|font)\//.test(type)) throw new Error('That address is not an image or media file.');
    if (Number(res.headers.get('content-length')) > MAX_REMOTE) throw new Error('That file is too large to embed.');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_REMOTE) throw new Error('That file is too large to embed.');
    return `data:${type};base64,${buf.toString('base64')}`;
  }
  // local files: only inside the open folder, and only media types, so a note cannot pull in files like ~/.ssh/id_rsa
  const rel = decodeURI(src).replace(/^\.\//, '');
  const abs = src.startsWith('file://') ? notes.contain(fileURLToPath(src)) : notes.resolve(path.posix.join(path.posix.dirname(noteRel || ''), rel));
  const mime = MIME[path.extname(abs).toLowerCase()];
  if (!mime) throw new Error('Only images, audio, video and fonts can be embedded.');
  const buf = await fs.readFile(abs);
  return `data:${mime};base64,${buf.toString('base64')}`;
});
h('export:pdf', async (rel, html, opts = {}) => {
  const suffix = /^[a-z-]{1,20}$/.test(opts.suffix || '') ? ` ${opts.suffix}` : '';
  const pdfName = rel.replace(/(\.(slides|board|sheet))?\.\w+$/, `${suffix}.pdf`).split('/').pop();
  const r = !app.isPackaged && process.env.FOLIO_EXPORT_DIR ? { filePath: path.join(process.env.FOLIO_EXPORT_DIR, pdfName) } : await dialog.showSaveDialog(win, { defaultPath: pdfName, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled) return null;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'folio-export-')); // owner-only, so nobody can plant a link where the file goes
  const tmp = path.join(tmpDir, 'export.html');
  await fs.writeFile(tmp, html, 'utf8');
  const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  let pdf;
  try {
    await pw.loadFile(tmp);
    pdf = await pw.webContents.printToPDF(opts.cssPage ? { printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } } : { printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } });
  } finally { pw.destroy(); if (!process.env.FOLIO_KEEP_HTML) fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {}); }
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
ipcMain.on('ai:answer', (e, { id, value }) => { if (fromApp(e)) pending.get(id)?.(value); });

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
      onWrite: async (r) => {
        ownWrites.set(notes.resolve(r.path), r.after);
        win?.webContents.send('ai:edit', { ...r, client: ctx.client });
      },
      onMove: async (r) => win?.webContents.send('ai:move', { ...r, client: ctx.client }),
      openNote: () => askRenderer('open-note'),
      showNote: (a) => { win?.show(); win?.focus(); return askRenderer('show-note', a); },
    });
  },
};

function tokenOk(header) {
  const a = Buffer.from(String(header || '')), b = Buffer.from(`Bearer ${settings.token}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
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
        if (!tokenOk(req.headers.authorization)) return send(401, { error: 'Missing or wrong token. Copy it from Folio → AI.' });
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
    ...(isMac ? [{ label: 'Folio', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'Cmd+,', click: cmd('settings') }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'File', submenu: [
      { label: 'New Note', accelerator: 'CmdOrCtrl+N', click: cmd('new-note') },
      { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: cmd('open-folder') },
      { label: 'Quick Open…', accelerator: 'CmdOrCtrl+P', click: cmd('quick-open') },
      { type: 'separator' },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: cmd('save') },
      { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: cmd('close-tab') },
      { type: 'separator' },
      { label: 'Import PowerPoint…', click: cmd('import-pptx') },
      { type: 'separator' },
      { label: 'Export as HTML…', click: cmd('export-html') },
      { label: 'Export as PDF…', accelerator: 'CmdOrCtrl+Shift+E', click: cmd('export-pdf') },
      { label: 'Export Slides as PowerPoint…', click: cmd('export-pptx') },
      { label: 'Export Handouts…', click: cmd('export-handouts') },
      { label: 'Export Notes Pages…', click: cmd('export-notes') },
      ...(isMac ? [] : [{ type: 'separator' }, { label: 'Settings…', accelerator: 'Ctrl+,', click: cmd('settings') }, { role: 'quit' }]),
    ] },
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: cmd('undo') },
      { label: 'Redo', accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Shift+Z', click: cmd('redo') },
      ...(isMac ? [] : [{ label: 'Redo', accelerator: 'Ctrl+Y', visible: false, click: cmd('redo') }]),
      { label: 'Undo File Action', accelerator: 'CmdOrCtrl+Alt+Z', click: cmd('undo-file') },
      { label: 'Redo File Action', accelerator: 'CmdOrCtrl+Alt+Shift+Z', click: cmd('redo-file') },
      { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' },
      { label: 'Find in Note', accelerator: 'CmdOrCtrl+F', click: cmd('find') },
      { label: 'Search All Notes', accelerator: 'CmdOrCtrl+Shift+F', click: cmd('search') }] },
    { label: 'Format', submenu: [
      { label: 'Bold', accelerator: 'CmdOrCtrl+B', click: cmd('bold') },
      { label: 'Italic', accelerator: 'CmdOrCtrl+I', click: cmd('italic') },
      { label: 'Link', accelerator: 'CmdOrCtrl+K', click: cmd('link') },
      { label: 'Inline Code', accelerator: 'CmdOrCtrl+E', click: cmd('code') },
      { label: 'Task', accelerator: 'CmdOrCtrl+L', click: cmd('task') }] },
    { label: 'Go', submenu: [
      { label: 'Back', accelerator: isMac ? 'Cmd+Alt+Left' : 'Alt+Left', click: cmd('nav-back') },
      { label: 'Forward', accelerator: isMac ? 'Cmd+Alt+Right' : 'Alt+Right', click: cmd('nav-forward') },
      { type: 'separator' },
      { label: 'Go to Note…', click: cmd('quick-open') }] },
    { label: 'View', submenu: [
      { label: 'Editor', accelerator: 'CmdOrCtrl+1', click: cmd('mode-edit') },
      { label: 'Split', accelerator: 'CmdOrCtrl+2', click: cmd('mode-split') },
      { label: 'Preview', accelerator: 'CmdOrCtrl+3', click: cmd('mode-preview') },
      { type: 'separator' },
      { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+\\', click: cmd('toggle-sidebar') },
      { label: 'Toggle Outline', accelerator: 'CmdOrCtrl+Shift+O', click: cmd('toggle-outline') },
      { label: 'Focus Mode', accelerator: 'CmdOrCtrl+.', click: cmd('focus') },
      { label: 'Command Palette…', accelerator: 'CmdOrCtrl+Shift+P', click: cmd('palette') },
      { type: 'separator' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])] },
    { label: 'AI', submenu: [{ label: 'Connect AI Assistants…', accelerator: 'CmdOrCtrl+Shift+A', click: cmd('ai') }] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [
      { label: 'About Folio', click: () => app.showAboutPanel() },
      { label: 'Source code and license', click: () => shell.openExternal('https://github.com/gabrielevaudano98/folio') },
      { label: 'Report a problem', click: () => shell.openExternal('https://github.com/gabrielevaudano98/folio/issues/new/choose') },
      { label: 'Building slide templates', click: () => shell.openExternal('https://github.com/gabrielevaudano98/folio/blob/main/docs/TEMPLATES.md') },
      { label: 'File formats', click: () => shell.openExternal('https://github.com/gabrielevaudano98/folio/blob/main/docs/FORMATS.md') },
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
/** the app page may use the microphone (narration) and nothing else; no page may attach a webview */
function lockDownSession() {
  const ok = (wc, permission, mediaTypes) => mayUse(permission, wc === win?.webContents, mediaTypes);
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => cb(ok(wc, permission, details?.mediaTypes)));
  session.defaultSession.setPermissionCheckHandler((wc, permission, _origin, details) => ok(wc, permission, details?.mediaType ? [details.mediaType] : []));
  app.on('web-contents-created', (_e, contents) => contents.on('will-attach-webview', (e) => e.preventDefault()));
}
app.whenReady().then(async () => {
  lockDownSession();
  try { fss.chmodSync(SETTINGS_FILE(), 0o600); } catch {} // settings from before 1.2.2 were readable by other users
  fss.rmSync(undoRoot(), { recursive: true, force: true }); // leftovers from a crashed session
  nativeTheme.themeSource = settings.theme;
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
app.on('before-quit', () => { fss.rmSync(undoRoot(), { recursive: true, force: true }); if (win) win.__forceClose = true; try { const b = JSON.parse(fss.readFileSync(BRIDGE_FILE(), 'utf8')); b.port = null; fss.writeFileSync(BRIDGE_FILE(), JSON.stringify(b, null, 2)); } catch {} });

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
