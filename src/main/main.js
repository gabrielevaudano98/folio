// Folio — main process.
import { app, BrowserWindow, ipcMain, safeStorage, dialog, shell, nativeTheme, systemPreferences, Menu, clipboard, net, screen, session, utilityProcess, MessageChannelMain, desktopCapturer, Notification } from 'electron';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { tl, setLocale } from '../renderer/i18n.js';
import { createNotes, NOTE_EXT } from './notes.js';
import { createHistory } from './history.js';
import { createGitLog } from './git-log.js';
import { createAssets, isAssetPath } from './assets.js';
import { duplicate } from './duplicate.js';
import { assertUnlocked, isLockedPage } from './locks.js';
import { buildServer, runTool, TOOLS } from './mcp-tools.js';
import { startQa, pollQa, stopQa } from './qa.js';
import { mayUse } from './permissions.js';
import { assertPublicHost } from './netguard.js';
import { createFeatures } from './meeting/service.js';
import { createUpdater } from './updater.js';
import { createChat } from './chat/service.js';
import electronUpdater from 'electron-updater';
import { writeAtomic, writeAtomicSync, writeNew } from './atomic.js';
// tests: a fake microphone and camera, granted without a prompt
if (process.env.FOLIO_FAKE_MEDIA) { app.commandLine.appendSwitch('use-fake-device-for-media-stream'); app.commandLine.appendSwitch('use-fake-ui-for-media-stream'); }
if (process.env.FOLIO_FAKE_AUDIO_FILE) app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.FOLIO_FAKE_AUDIO_FILE); // tests: the fake microphone speaks this wav

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
  lineWidth: 72, spellcheck: true, smartTypography: true, mcpEnabled: true, mcpPort: 47321, allowWrite: true, remoteImages: false,
  token: crypto.randomBytes(24).toString('hex'), showOutline: true, sidebar: true,
  language: 'en', dateStyle: 'relative', lockedPages: {}, autoUpdate: false,
  templateGallery: 'https://raw.githubusercontent.com/gabrielevaudano98/folio/main/community/templates/index.json',
};
let settings = { ...defaults };
try { settings = { ...defaults, ...JSON.parse(fss.readFileSync(SETTINGS_FILE(), 'utf8')) }; } catch {}
// settings change often (every tab switch records the last file), so writes are batched and done off the main thread;
// quitting writes any pending change at once. It holds the MCP token (0600) and is atomic, so a crash cannot leave it half written.
let settingsTimer = null, settingsWrite = Promise.resolve(), settingsInFlight = 0, settingsDirty = false;
function saveSettings() {
  settingsDirty = true;
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    settingsTimer = null;
    const text = JSON.stringify(settings, null, 2);
    settingsInFlight++; settingsDirty = false; // a failed write marks it dirty again, so quit retries it
    settingsWrite = settingsWrite.then(async () => {
      await fs.mkdir(path.dirname(SETTINGS_FILE()), { recursive: true });
      await writeAtomic(SETTINGS_FILE(), text, { mode: 0o600 });
      writeBridge();
    }).catch((e) => { settingsDirty = true; console.error('[folio] settings not saved:', e.message); }).finally(() => { settingsInFlight--; });
  }, 200);
}
/** at quit: once any write already started has finished (so it cannot land after this one), writes the latest settings */
function flushSettingsSync() {
  clearTimeout(settingsTimer); settingsTimer = null;
  if (!settingsDirty) return;
  settingsDirty = false;
  try { fss.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true }); writeAtomicSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2), { mode: 0o600 }); writeBridge(); }
  catch (e) { console.error('[folio] settings not saved:', e.message); }
}
function writeBridge() {
  const b = { port: mcpServerPort, token: settings.token, workspace: settings.workspace, allowWrite: settings.allowWrite, pid: process.pid };
  try { writeAtomicSync(BRIDGE_FILE(), JSON.stringify(b, null, 2), { mode: 0o600 }); } catch {} // owner-only: it holds the token (an older, wider file is replaced with 0600)
}

const notes = createNotes(() => settings.workspace);
const history = createHistory(() => settings.workspace);
const gitLog = createGitLog(() => settings.workspace);
const assets = createAssets(notes);
const guardAsset = (rel) => { if (isAssetPath(rel)) throw new Error('The .asset folder belongs to Folio. Remove files from a page, or use Clean up unused files.'); };
/* history must never get in the way of saving */
const keep = async (rel, text, o) => { try { if (settings.workspace && !/(^|\/)\.folio\//.test(rel)) return await history.snapshot(rel, text, o); } catch (e) { console.error('history', e.message); return false; } return null; }; // false: it could not be stored (null: nothing new to store)
let win = null;
let chat = null; // chat mode (src/main/chat), created once the MCP backend exists

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
  // the page crashed (out of memory, a GPU or renderer fault): open it again rather than leave a blank window.
  // Notes are autosaved shortly after typing stops, so the last second or so of typing can be lost; tabs come back from
  // settings. A recording in progress is stopped and saved first, since its audio came from this page.
  // Up to three reloads a minute; a fourth crash stops the loop.
  const crashes = [];
  win.webContents.on('render-process-gone', (_e, d) => {
    if (d.reason === 'clean-exit' || win.isDestroyed()) return;
    console.error('[folio] window process gone:', d.reason, d.exitCode);
    if (features.active()) features.stop();
    const now = Date.now(); crashes.push(now); while (crashes.length && now - crashes[0] > 60000) crashes.shift();
    if (crashes.length <= 3) { win.webContents.reload(); return; }
    dialog.showMessageBox(win, { type: 'error', message: 'Folio’s window keeps closing unexpectedly.', detail: `Reason: ${d.reason}. Your notes are saved on disk, apart from anything typed in the last moment before the crash. Restart Folio, and if it happens again, report it with this reason.`, buttons: ['Quit'] }).then(() => app.quit());
  });
  win.webContents.on('will-redirect', lock);
  win.webContents.on('did-start-loading', () => { closeReady = false; }); // a reload: the new page says when it listens again
  win.on('close', (e) => {
    if (win.__forceClose || !closeReady || win.webContents.isCrashed()) return; // nobody to ask yet (or any more): just close
    e.preventDefault();
    win.webContents.send('app:before-close');
  });
}
ipcMain.on('app:close-ok', (e) => { if (fromApp(e) && win) { win.__forceClose = true; const q = quitPending; if (q) quitOk = true; win.close(); if (q) app.quit(); } });
ipcMain.on('app:close-cancel', (e) => { if (fromApp(e)) quitPending = false; });
ipcMain.on('app:close-ready', (e) => { if (fromApp(e)) closeReady = true; }); // the page listens for app:before-close from now on
/* Quit (⌘Q, the menu, the dock) first lets the page save its tabs, the same way closing the window does; the other quit steps run only once it agreed */
let quitPending = false, quitOk = false, closeReady = false;
const quitAgreed = () => quitOk || !closeReady || !win || win.isDestroyed() || win.webContents.isCrashed(); // a page that is not listening yet, or crashed, cannot answer: quit anyway (it has no unsaved tabs to lose)

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
  chat?.reset();
  await clearTrashed();
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
  const { token: _t, features: _f, ...rest } = patch || {}; // the token and optional features have their own channels
  Object.assign(settings, rest);
  if ('theme' in patch) nativeTheme.themeSource = settings.theme;
  if ('language' in patch) { setLocale(settings.language); buildMenu(); }
  saveSettings();
  if (patch.mcpEnabled !== undefined || patch.mcpPort !== before.mcpPort) await restartMcp();
  return { ...settings, token: undefined };
});
// optional features (meeting recorder): downloads, the recording session and its worker
const features = createFeatures({ app, net, utilityProcess, MessageChannelMain, h, getWin: () => win, settings, saveSettings, notes, workerPath: path.join(__dirname, 'meeting-asr.cjs'),
  // Windows only: a notification when another app starts using the microphone, and the registry query that finds it
  notify: ({ title, body, onClick }) => { if (!Notification.isSupported()) return; const n = new Notification({ title, body, silent: true }); n.on('click', onClick); n.show(); },
  execReg: process.platform === 'win32' ? (args) => new Promise((res, rej) => execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe'), args, { windowsHide: true, timeout: 5000, maxBuffer: 1 << 20 }, (e, out) => (e ? rej(e) : res(out)))) : null });
// updates from GitHub releases: a check at startup and every six hours (Settings → Updates switches it off)
const updater = createUpdater({ app, shell, h, getWin: () => win, settings, saveSettings, autoUpdater: electronUpdater.autoUpdater });
h('workspace:choose', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: tl('dlg', 'Open a folder of notes') });
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
h('fs:info', async (rel) => { const st = await fs.stat(notes.resolve(rel)).catch(() => null); return st ? { size: st.size, mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs } : null; });
h('fs:write', async (rel, content) => {
  if (shotFailWrites) throw new Error('disk full (test)'); // only set by the dev test runner (FOLIO_SHOT, unpackaged)
  const abs = notes.resolve(rel, { mustBeNote: true });
  ownWrites.set(abs, content);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  try { if (!(await history.list(rel)).length) { const was = await fs.readFile(abs, 'utf8').catch(() => null); if (was != null) await keep(rel, was, { reason: 'open', force: true }); } } catch {}
  await writeAtomic(abs, content);
  keep(rel, content, { reason: 'edit' });
  return true;
});
h('fs:create', async (rel, content = '') => {
  const abs = notes.resolve(rel, { mustBeNote: true });
  if (fss.existsSync(abs)) throw new Error('A note with that name already exists.');
  ownWrites.set(abs, content);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await writeAtomic(abs, content);
  keep(notes.relOf(abs), content, { reason: 'created', force: true });
  return notes.relOf(abs);
});
h('fs:mkdir', async (rel) => { guardAsset(rel); await fs.mkdir(notes.resolve(rel, { notRoot: true }), { recursive: true }); return rel; });
h('fs:rename', async (from, to) => {
  guardAsset(from); guardAsset(to);
  const isDir = (await fs.stat(notes.resolve(from, { notRoot: true })).catch(() => null))?.isDirectory();
  const r = await notes.move(from, to);
  const pairs = isDir ? (await notes.allFiles()).filter((f) => f.startsWith(r.to + '/')).map((f) => [r.from + f.slice(r.to.length), f]) : [[r.from, r.to]];
  const changed = new Set();
  // a locked page keeps its old link (X3); a moved page's own links still follow it. Locks are still keyed by the old path here.
  const oldOf = (f) => (f === r.to || f.startsWith(r.to + '/') ? r.from + f.slice(r.to.length) : f);
  const lockSkip = (f, was) => !pairs.some(([, b]) => b === f) && (isLockedPage(settings.lockedPages, settings.workspace, oldOf(f)) || isLockedPage(settings.lockedPages, settings.workspace, was));
  for (const [a, b] of pairs) { history.rename(a, b).catch(() => {}); for (const c of await notes.rewriteAfterMove(a, b, (f, text) => keep(f, text, { reason: 'before-rename', force: true }), { skip: lockSkip }).catch(() => [])) changed.add(c); }
  /* a page (or a folder of pages) moved: files a page uses that did not move with it are copied into its new .asset, references follow */
  for (const [a, b] of pairs) {
    if (path.dirname(a) === path.dirname(b)) continue;
    try {
      const text = await notes.read(b); const moved = await assets.relocate(a, b, text);
      if (moved.text !== text) { await keep(b, text, { reason: 'move', force: true }); ownWrites.set(notes.resolve(b), moved.text); await writeAtomic(notes.resolve(b), moved.text); changed.add(b); }
    } catch (e) { console.error('assets relocate', e.message); }
  }
  return { to: r.to, changed: [...changed] };
});
/* duplicate a note or a folder next to itself: new notes written atomically, the files they use copied into their own .asset */
h('fs:duplicate', async (rel, suffix) => {
  guardAsset(rel);
  return duplicate({ notes, assets, from: rel, suffix, write: async (r, text) => {
    const abs = notes.resolve(r, { mustBeNote: true });
    ownWrites.set(abs, text);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    // exclusive: a note another program or an AI created at this very name a moment ago is never replaced
    try { await writeNew(abs, text); } catch (e) { ownWrites.delete(abs); throw e.code === 'EEXIST' ? new Error('A note with that name already exists.') : e; }
    keep(notes.relOf(abs), text, { reason: 'created', force: true });
  } });
});
// A copy of every trashed item is kept in a private folder for this session so the move can be undone.
// Copies belong to the workspace they came from and are removed when it changes and when Folio quits.
const trashed = new Map();
let undoDir = null;
const undoRoot = () => path.join(app.getPath('userData'), 'undo');
async function clearTrashed() { trashed.clear(); undoDir = null; await fs.rm(undoRoot(), { recursive: true, force: true }).catch(() => {}); }
async function trashPath(rel) {
  guardAsset(rel);
  const abs = notes.resolve(rel, { notRoot: true });
  if (!undoDir) { await fs.mkdir(undoRoot(), { recursive: true, mode: 0o700 }); undoDir = await fs.mkdtemp(path.join(undoRoot(), 's-')); } // mkdtemp makes it owner-only
  const token = crypto.randomUUID(); const keep = path.join(undoDir, token);
  await fs.mkdir(keep);
  await fs.cp(abs, path.join(keep, 'item'), { recursive: true });
  if (process.env.FOLIO_FAKE_TRASH === '1' && !app.isPackaged) await fs.rm(abs, { recursive: true, force: true }); else await shell.trashItem(abs);
  trashed.set(token, { rel, keep, root: notes.root() });
  while (trashed.size > 25) { const [old, e] = trashed.entries().next().value; trashed.delete(old); fs.rm(e.keep, { recursive: true, force: true }).catch(() => {}); }
  return { token };
}
h('fs:trash', (rel) => trashPath(rel));
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
/** a PowerPoint file or template to import: its name and bytes (FOLIO_IMPORT_FILE stands in for the dialog in tests) */
h('qa:start', (title) => startQa(String(title || '').slice(0, 80)));
h('qa:poll', () => pollQa());
h('qa:stop', () => stopQa());
let importN = 0;
h('fs:pick-office', async () => {
  const dev = !app.isPackaged && process.env.FOLIO_IMPORT_FILE;
  const r = dev ? { filePaths: [process.env.FOLIO_IMPORT_FILE.split('|')[importN++ % process.env.FOLIO_IMPORT_FILE.split('|').length]] } : await dialog.showOpenDialog(win, { title: tl('dlg', 'Import PowerPoint'), properties: ['openFile'], filters: [{ name: 'PowerPoint', extensions: ['pptx', 'potx'] }] });
  if (r.canceled || !r.filePaths?.[0]) return null;
  const file = r.filePaths[0];
  if (!/\.(pptx|potx)$/i.test(file)) throw new Error('Choose a .pptx or .potx file.');
  const st = await fs.stat(file); if (st.size > 300 * 1024 * 1024) throw new Error('This file is too large to import (over 300 MB).');
  return { name: path.basename(file).replace(/\.(pptx|potx)$/i, ''), ext: path.extname(file).slice(1).toLowerCase(), bytes: new Uint8Array(await fs.readFile(file)) };
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
  cur[key.toLowerCase()] = type; await fs.mkdir(path.dirname(typesFile()), { recursive: true }); await writeAtomic(typesFile(), JSON.stringify(cur, null, 1)); return cur;
});
h('assets:sync', async (noteRel, before, after) => ({ ...(await assets.heal(noteRel, after)), orphans: await assets.orphans(noteRel, before, after), refs: [...assets.refsOf(noteRel, after)] }));
h('assets:restore', async (paths) => { let n = 0; for (const p of paths.slice(0, 500)) if (await assets.restore(p).catch(() => false)) n++; return n; });
h('assets:heal', (noteRel, text) => assets.heal(noteRel, text));
h('assets:remove', async (paths, permanent, { onlyUnused = true } = {}) => { const list = paths.slice(0, 500); const busy = onlyUnused ? await assets.stillUsed(list) : new Set(); let n = 0; for (const p of list) if (!busy.has(p) && await assets.remove(p, { permanent: !!permanent }).catch(() => false)) n++; return n; });
h('assets:usage', () => assets.usage());
h('assets:migrate', () => assets.migrateLegacy({ onBefore: (f, t) => keep(f, t, { reason: 'assets', force: true }) }));
h('assets:reveal', (assetRel) => { const abs = notes.resolve(assetRel, { allowAsset: true }); shell.showItemInFolder(abs); });
h('fs:abs-url', (rel) => 'file://' + notes.resolve(rel, { allowAsset: true }).split(path.sep).join('/'));
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
    if (Number(res.headers.get('content-length')) > TEMPLATE_MAX) throw new Error('That file is larger than 1 MB.');
    const chunks = []; let size = 0; const reader = res.body?.getReader(); if (!reader) return ''; // an empty answer is an empty template
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > TEMPLATE_MAX) { ctl.abort(); throw new Error('That file is larger than 1 MB.'); } chunks.push(value); }
    return Buffer.concat(chunks).toString('utf8');
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'The download took too long.' : e.message); } finally { clearTimeout(timer); }
});
h('templates:import-files', async () => {
  const r = await dialog.showOpenDialog(win, { title: tl('dlg', 'Import templates'), properties: ['openFile', 'multiSelections'], filters: [{ name: tl('dlg', 'Markdown'), extensions: ['md', 'markdown', 'txt'] }] });
  if (r.canceled) return [];
  const out = [];
  for (const f of r.filePaths.slice(0, 50)) { const st = await fs.stat(f); if (st.size > TEMPLATE_MAX) continue; out.push({ name: path.basename(f).replace(/\.(md|markdown|txt)$/i, ''), text: await fs.readFile(f, 'utf8') }); }
  return out;
});
h('shell:open-file', async (rel) => { const abs = notes.resolve(rel, { allowAsset: true }); await fs.access(abs); const err = await shell.openPath(abs); if (err) throw new Error(err); return true; });
h('clipboard:write', (text) => clipboard.writeText(text));
h('clipboard:read', async () => ({ text: await clipboard.readText(), html: typeof clipboard.readHTML === 'function' ? clipboard.readHTML() : '' })); // Electron 45: readText is async, readHTML is gone
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
  if (!/^[a-z0-9]{1,8}$/i.test(ext || '')) throw new Error('Unsupported file type.');
  const base = rel.split('/').pop().replace(/(\.(slides|board|sheet))?\.\w+$/, '');
  const r = !app.isPackaged && process.env.FOLIO_EXPORT_DIR ? { filePath: path.join(process.env.FOLIO_EXPORT_DIR, `${base}.${ext}`) } : await dialog.showSaveDialog(win, { defaultPath: `${base}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (r.canceled) return null;
  await fs.writeFile(r.filePath, Buffer.from(bytes)); if (!process.env.FOLIO_EXPORT_DIR) shell.showItemInFolder(r.filePath); return r.filePath;
});
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.aac': 'audio/aac', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' };
const MAX_REMOTE = 30 * 1024 * 1024;
const TEST_LOOPBACK = !app.isPackaged && process.env.FOLIO_TEST_LOOPBACK === '1'; // tests only: lets the allowed path be checked against a local server; never in a packaged app
async function readCapped(res, max) {
  const reader = res.body?.getReader(); if (!reader) return Buffer.alloc(0);
  const parts = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => {}); throw new Error('That file is too large to embed.'); }
    parts.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(parts, size);
}
h('fs:data-url', async (src, noteRel) => {
  if (/^data:/i.test(src)) return 'data:' + src.slice(5); // schemes are case-insensitive; hand back one spelling
  if (/^https?:\/\//i.test(src)) {
    // a note can name any address: no private network (checked by name and by what it resolves to), only images, audio, video and fonts, bounded in size and time
    const { net } = await import('electron');
    // follow redirects by hand so every hop is checked before it is requested
    let url = src, res; const signal = AbortSignal.timeout(20000); // one deadline for the whole download, redirects included
    for (let hop = 0; ; hop++) {
      if (hop > 5) throw new Error('Too many redirects.');
      const host = new URL(url).hostname;
      if (!(TEST_LOOPBACK && host === '127.0.0.1')) await assertPublicHost(host);
      res = await net.fetch(url, { redirect: 'manual', signal });
      const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!next) break;
      url = new URL(next, url).href; if (!/^https?:\/\//.test(url)) throw new Error('That address is not a web address.');
    }
    if (!res.ok) throw new Error(`Image download failed (${res.status})`);
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!/^(image|audio|video|font)\//.test(type)) throw new Error('That address is not an image or media file.');
    if (Number(res.headers.get('content-length')) > MAX_REMOTE) throw new Error('That file is too large to embed.');
    const buf = await readCapped(res, MAX_REMOTE); // read in pieces: a server that sends no length cannot make Folio hold more than the limit
    return `data:${type};base64,${buf.toString('base64')}`;
  }
  // local files: only inside the open folder, and only media types, so a note cannot pull in files like ~/.ssh/id_rsa
  const rel = decodeURI(src).replace(/^\.\//, '');
  const abs = src.startsWith('file://') ? notes.contain(fileURLToPath(src), { allowAsset: true }) : notes.resolve(path.posix.join(path.posix.dirname(noteRel || ''), rel), { allowAsset: true });
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
    pdf = await pw.webContents.printToPDF(opts.print ? opts.print : opts.cssPage ? { printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } } : { printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } });
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
    assertUnlocked(tool, args, { notes, lockedPages: settings.lockedPages, workspace: settings.workspace }); // X3: a locked page takes no AI edit and is not moved
    logActivity({ client: ctx.client, tool: name, path: args.path || args.from || args.query || '' });
    return runTool(notes, name, args, {
      history, client: ctx.client, isLocked: (rel) => isLockedPage(settings.lockedPages, settings.workspace, rel),
      onWrite: async (r) => {
        if (r.before != null) await keep(r.path, r.before, { reason: 'before-ai', force: true });
        const aiKept = (await keep(r.path, r.after, { by: ctx.client || 'AI', reason: 'ai', force: true })) !== false;
        ownWrites.set(notes.resolve(r.path), r.after);
        const orphans = r.before != null ? await assets.orphans(r.path, r.before, r.after).catch(() => []) : [];
        win?.webContents.send('ai:edit', { ...r, client: ctx.client, orphans, aiKept });
      },
      onMove: async (r) => win?.webContents.send('ai:move', { ...r, client: ctx.client }),
      openNote: () => askRenderer('open-note'),
      showNote: (a) => { win?.show(); win?.focus(); return askRenderer('show-note', a); },
    });
  },
};

// chat mode: an AI chat bound to the open folder; runs the same tools as an outside MCP client, behind approvals
chat = createChat({
  h, getWin: () => win, settings, saveSettings, notes, backend: appBackend, TOOLS, safeStorage, guardAsset,
  keyFile: () => path.join(app.getPath('userData'), 'ai-keys.json'),
  mkdir: async (rel) => { guardAsset(rel); await fs.mkdir(notes.resolve(rel, { notRoot: true }), { recursive: true }); },
  trash: trashPath, askOpenNote: () => askRenderer('open-note', null, 800),
});

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
  return path.join(__dirname, 'mcp-stdio.mjs').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}
function stdioEntry() {
  // Windows: a GUI exe gets no stdin from its parent, so the bridge runs as Node there (the RunAsNode fuse stays on, see build/afterPack.cjs)
  if (isWin) return { command: process.execPath, args: [stdioScript(), '--bridge', BRIDGE_FILE()], env: { ELECTRON_RUN_AS_NODE: '1' } };
  return { command: process.execPath, args: [...(app.isPackaged ? [] : [app.getAppPath()]), '--mcp-stdio', '--bridge', BRIDGE_FILE()] };
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
function quote(s) { if (isWin) return /[\s"]/.test(s) ? `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"` : s; return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`; } // POSIX: single quotes, so $() and backticks in a path stay text
async function readJson(file) {
  try { const t = await fs.readFile(file, 'utf8'); return t.trim() ? JSON.parse(t) : {}; }
  catch (e) { if (e.code === 'ENOENT') return {}; throw new Error(`Could not read ${file}: ${e.message}`); }
}
h('connections:list', async () => {
  const entry = stdioEntry();
  const list = [];
  for (const [id, t] of Object.entries(TARGETS)) {
    // a pre-1.2.3 entry (no --mcp-stdio) still works but shows Connect, which rewrites it
    let installed = false, appPresent = fss.existsSync(path.dirname(t.file));
    try { const cur = (await readJson(t.file))?.[t.key]?.folio; installed = !!cur && Array.isArray(cur.args) && (cur.args.includes('--mcp-stdio') || (isWin && cur.args.some((a) => /[\\/]mcp-stdio\.mjs$/.test(a)) && cur.env?.ELECTRON_RUN_AS_NODE === '1')); } catch {}
    list.push({ id, name: t.name, file: t.file, installed, appPresent, restart: tl('dlg', t.restart), snippet: JSON.stringify({ [t.key]: { folio: t.shape(entry) } }, null, 2) });
  }
  const cli = `claude mcp add folio --scope user${entry.env ? ' -e ELECTRON_RUN_AS_NODE=1' : ''} -- ${[entry.command, ...entry.args].map(quote).join(' ')}`;
  return { list, claudeCode: cli, httpUrl: mcpServerPort ? `http://127.0.0.1:${mcpServerPort}/mcp` : null };
});
h('connections:install', async (id) => {
  const t = TARGETS[id]; if (!t) throw new Error('Unknown app');
  const cfg = await readJson(t.file);
  if (fss.existsSync(t.file)) await fs.copyFile(t.file, t.file + '.folio-backup');
  cfg[t.key] = { ...(cfg[t.key] || {}), folio: t.shape(stdioEntry()) };
  await fs.mkdir(path.dirname(t.file), { recursive: true });
  await writeAtomic(t.file, JSON.stringify(cfg, null, 2));
  return { file: t.file, restart: tl('dlg', t.restart) };
});
h('connections:remove', async (id) => {
  const t = TARGETS[id]; const cfg = await readJson(t.file);
  if (cfg[t.key]?.folio) { delete cfg[t.key].folio; await writeAtomic(t.file, JSON.stringify(cfg, null, 2)); }
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
      { label: tl('menu', 'Import PowerPoint…'), click: cmd('import-pptx') },
      { type: 'separator' },
      { label: tl('menu', 'Export…'), accelerator: 'CmdOrCtrl+Shift+E', click: cmd('export') },
      { label: tl('menu', 'Export as PDF…'), click: cmd('export-pdf') },
      { label: tl('menu', 'Export as Word…'), click: cmd('export-docx') },
      { label: tl('menu', 'Export as HTML…'), click: cmd('export-html') },
      { label: tl('menu', 'Export as Portable Markdown…'), click: cmd('export-md') },
      { label: tl('menu', 'Export Slides as PowerPoint…'), click: cmd('export-pptx') },
      { label: tl('menu', 'Export Handouts…'), click: cmd('export-handouts') },
      { label: tl('menu', 'Export Notes Pages…'), click: cmd('export-notes') },
      ...(isMac ? [] : [{ type: 'separator' }, { label: tl('menu', 'Settings…'), accelerator: 'Ctrl+,', click: cmd('settings') }, { role: 'quit' }]),
    ] },
    { label: tl('menu', 'Edit'), submenu: [
      { label: tl('menu', 'Undo'), accelerator: 'CmdOrCtrl+Z', click: cmd('undo') },
      { label: tl('menu', 'Redo'), accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Shift+Z', click: cmd('redo') },
      ...(isMac ? [] : [{ label: tl('menu', 'Redo'), accelerator: 'Ctrl+Y', visible: false, click: cmd('redo') }]),
      { label: tl('menu', 'Undo File Action'), accelerator: 'CmdOrCtrl+Alt+Z', click: cmd('undo-file') },
      { label: tl('menu', 'Redo File Action'), accelerator: 'CmdOrCtrl+Alt+Shift+Z', click: cmd('redo-file') },
      { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { label: tl('menu', 'Paste as Plain Text'), accelerator: 'CmdOrCtrl+Shift+V', click: cmd('paste-plain') }, { role: 'selectAll' }, { type: 'separator' },
      { label: tl('menu', 'Find in Note'), accelerator: 'CmdOrCtrl+F', click: cmd('find') },
      { label: tl('menu', 'Find and Replace…'), accelerator: process.platform === 'darwin' ? 'Cmd+Alt+H' : 'Ctrl+H', click: cmd('replace') },
      { label: tl('menu', 'Search All Notes'), accelerator: 'CmdOrCtrl+Shift+F', click: cmd('search') }] },
    { label: tl('menu', 'Format'), submenu: [
      { label: tl('menu', 'Bold'), accelerator: 'CmdOrCtrl+B', click: cmd('bold') },
      { label: tl('menu', 'Italic'), accelerator: 'CmdOrCtrl+I', click: cmd('italic') },
      { label: tl('menu', 'Link'), accelerator: 'CmdOrCtrl+K', click: cmd('link') },
      { label: tl('menu', 'Inline Code'), accelerator: 'CmdOrCtrl+E', click: cmd('code') },
      { label: tl('menu', 'Task'), accelerator: 'CmdOrCtrl+L', click: cmd('task') }] },
    { label: tl('menu', 'Go'), submenu: [
      { label: tl('menu', 'Back'), accelerator: isMac ? 'Cmd+Alt+Left' : 'Alt+Left', click: cmd('nav-back') },
      { label: tl('menu', 'Forward'), accelerator: isMac ? 'Cmd+Alt+Right' : 'Alt+Right', click: cmd('nav-forward') },
      { type: 'separator' },
      { label: tl('menu', 'Go to Note…'), click: cmd('quick-open') }] },
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
      { label: tl('menu', 'Building slide templates'), click: () => shell.openExternal('https://github.com/gabrielevaudano98/folio/blob/main/docs/TEMPLATES.md') },
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
/** the app page may use the microphone (narration) and nothing else; no page may attach a webview */
function lockDownSession() {
  const ok = (wc, permission, mediaTypes) => (permission === 'display-capture' ? wc === win?.webContents && features.allowLoopback(win.webContents.mainFrame) : mayUse(permission, wc === win?.webContents, mediaTypes));
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => cb(ok(wc, permission, details?.mediaTypes)));
  session.defaultSession.setPermissionCheckHandler((wc, permission, _origin, details) => ok(wc, permission, details?.mediaType ? [details.mediaType] : []));
  app.on('web-contents-created', (_e, contents) => contents.on('will-attach-webview', (e) => e.preventDefault()));
  // screen capture is never granted; the meeting recorder gets the computer's sound (Windows loopback) while it records
  session.defaultSession.setDisplayMediaRequestHandler((request, cb) => {
    if (!features.allowLoopback(request.frame)) return cb({});
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).then((s) => cb(s[0] ? { video: s[0], audio: 'loopback' } : {}), () => cb({}));
  });
}
app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('com.folio.markdown'); // notifications carry the app's name
  lockDownSession();
  try { fss.chmodSync(SETTINGS_FILE(), 0o600); } catch {} // settings from before 1.2.2 were readable by other users
  fss.rmSync(undoRoot(), { recursive: true, force: true }); // leftovers from a crashed session
  nativeTheme.themeSource = settings.theme;
  setLocale(settings.language);
  buildMenu();
  if (settings.workspace && fss.existsSync(settings.workspace)) await setWorkspace(settings.workspace);
  else settings.workspace = null;
  await startMcp();
  createWindow();
  updater.schedule();
  const argFile = process.argv.slice(app.isPackaged ? 1 : 2).find((a) => !a.startsWith('-') && fss.existsSync(a));
  if (pendingOpen || argFile) win.webContents.once('did-finish-load', () => openPath(pendingOpen || argFile));
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
app.on('before-quit', (e) => { if (quitAgreed()) return; e.preventDefault(); quitPending = true; win.webContents.send('app:before-close'); });
app.on('before-quit', (e) => { // a recording is saved before the app quits; a notes engine still running is stopped
  if (!quitAgreed()) return;
  if (!features.active()) { features.abortNotes(); return; }
  e.preventDefault(); features.stop().finally(() => app.quit());
});
app.on('before-quit', (e) => {
  if (!quitAgreed()) return; // the page saves (or asks) first
  if (settingsInFlight) { e.preventDefault(); settingsWrite.finally(() => app.quit()); return; } // let it land first, then flush
  flushSettingsSync(); fss.rmSync(undoRoot(), { recursive: true, force: true }); if (win) win.__forceClose = true; try { const b = JSON.parse(fss.readFileSync(BRIDGE_FILE(), 'utf8')); b.port = null; writeAtomicSync(BRIDGE_FILE(), JSON.stringify(b, null, 2), { mode: 0o600 }); } catch {} });

/* dev only: scripted screenshots for visual QA */
let shotFailWrites = false; // the dev test runner can make every page write fail, to test what the app does then
async function devShot(w) {
  const steps = JSON.parse(fss.readFileSync(process.env.FOLIO_SHOT, 'utf8'));
  w.webContents.on('console-message', (e) => { const msg = e.message; if (/error|fail/i.test(String(msg))) console.log('console:', msg); });
  w.webContents.once('did-finish-load', async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    console.log('perf', JSON.stringify({ loadedMs: Math.round(process.uptime() * 1000) })); // process start to page loaded
    await wait(1500);
    for (const s of steps) {
      if (s.size) w.setContentSize(s.size[0], s.size[1]);
      if ('failWrites' in s) shotFailWrites = !!s.failWrites;
      if (s.quit) app.quit(); // the same path as ⌘Q or the Quit menu item
      if (s.dark !== undefined) nativeTheme.themeSource = s.dark ? 'dark' : 'light';
      if (s.js) { try { const v = await w.webContents.executeJavaScript(s.js); if (s.log) console.log('js', JSON.stringify(v)); } catch (e) { console.error('[folio-error] shot js', e.message); } }
      if (s.metrics) { // memory of every process, in MB (private bytes on Windows and macOS, working set on Linux)
        const m = app.getAppMetrics().map((x) => ({ type: x.type, mb: Math.round((x.memory.privateBytes ?? x.memory.workingSetSize) / 1024), cpu: Math.round(x.cpu.percentCPUUsage) }));
        console.log('js', JSON.stringify({ metrics: m, totalMB: m.reduce((n, x) => n + x.mb, 0) }));
      }
      if (s.tool) { try { await appBackend.call(s.tool.name, s.tool.args, { client: s.tool.client || 'Claude Desktop' }); } catch (e) { console.error('shot tool', e.message); } }
      await wait(s.wait ?? 700);
      if (s.out) { const img = await w.webContents.capturePage(); fss.writeFileSync(s.out, img.toPNG()); console.log('shot', s.out); }
    }
    app.exit(0);
  });
}
