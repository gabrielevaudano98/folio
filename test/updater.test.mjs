// Updates from GitHub releases: which builds may install, what the checker does with electron-updater's events.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { updateMode, releaseUrl, createUpdater } from '../src/main/updater.js';

// the mode of each kind of build
assert.equal(updateMode({ isPackaged: false, platform: 'win32' }), 'off', 'a development run never updates');
assert.equal(updateMode({ isPackaged: true, platform: 'win32', env: { FOLIO_NO_UPDATE: '1' } }), 'off');
assert.equal(updateMode({ isPackaged: true, platform: 'win32' }), 'install');
assert.equal(updateMode({ isPackaged: true, platform: 'win32', env: { PORTABLE_EXECUTABLE_FILE: 'C:/x.exe' } }), 'notify', 'the portable exe is not installed');
assert.equal(updateMode({ isPackaged: true, platform: 'darwin' }), 'notify', 'unsigned macOS cannot swap itself');
assert.equal(updateMode({ isPackaged: true, platform: 'darwin', installOnMac: true }), 'install');
assert.equal(updateMode({ isPackaged: true, platform: 'linux' }), 'notify');

// the release page is built from a checked version, not from downloaded text
assert.equal(releaseUrl('1.6.0'), 'https://github.com/gabrielevaudano98/folio/releases/tag/v1.6.0');
assert.equal(releaseUrl('1.6.0-beta.1'), 'https://github.com/gabrielevaudano98/folio/releases/tag/v1.6.0-beta.1');
assert.equal(releaseUrl('1.0.0/../../evil'), 'https://github.com/gabrielevaudano98/folio/releases');
assert.equal(releaseUrl(null), 'https://github.com/gabrielevaudano98/folio/releases');

// a fake electron-updater
function make(opts = {}) {
  const au = new EventEmitter(); const calls = [];
  au.checkForUpdates = async () => { calls.push('check'); if (opts.fail) throw new Error('net::ERR_INTERNET_DISCONNECTED\nstack…'); au.emit(opts.version ? 'update-available' : 'update-not-available', { version: opts.version }); };
  au.downloadUpdate = async () => { calls.push('download'); au.emit('download-progress', { percent: 41.6 }); au.emit('update-downloaded', {}); };
  au.quitAndInstall = (...a) => calls.push(['quit', ...a]);
  const handlers = {}; const sent = []; const opened = [];
  const settings = { autoUpdate: true }; let saved = 0;
  const u = createUpdater({ app: { isPackaged: true, getVersion: () => '1.5.1' }, shell: { openExternal: async (x) => opened.push(x) }, h: (ch, fn) => { handlers[ch] = fn; },
    getWin: () => ({ webContents: { send: (c, s) => sent.push([c, s.phase]) } }), settings, saveSettings: () => saved++, autoUpdater: au, platform: opts.platform || 'win32', env: opts.env || {} });
  return { u, au, calls, handlers, sent, opened, settings, saved: () => saved };
}

// Windows installer: nothing downloads by itself; check, download, install
{
  const { u, au, calls, handlers, sent } = make({ version: '1.6.0' });
  assert.equal(au.autoDownload, false); assert.equal(au.allowPrerelease, true); assert.equal(au.allowDowngrade, false); assert.equal(au.autoInstallOnAppQuit, true);
  assert.equal((await handlers['update:check']()).phase, 'available');
  assert.equal(u.state().version, '1.6.0'); assert.deepEqual(calls, ['check']);
  await assert.rejects(async () => handlers['update:install'](), /no downloaded update/);
  assert.equal((await handlers['update:download']()).phase, 'ready');
  assert.deepEqual(sent.map((x) => x[1]), ['checking', 'available', 'downloading', 'downloading', 'ready']);
  await handlers['update:install'](); await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls.at(-1), ['quit', false, true]);
}
// up to date, and a failed check says so without throwing
{ const m = make({}); assert.equal((await m.handlers['update:check']()).phase, 'none'); }
{ const m = make({ fail: true }); const s = await m.handlers['update:check'](); assert.equal(s.phase, 'error'); assert.equal(s.error, 'net::ERR_INTERNET_DISCONNECTED', 'one line only'); }
// macOS (unsigned): tells, never downloads or installs, opens the release page
{
  const m = make({ version: '1.6.0', platform: 'darwin' });
  assert.equal(m.au.autoInstallOnAppQuit, false);
  await m.handlers['update:check']();
  await assert.rejects(async () => m.handlers['update:download'](), /cannot install updates itself/);
  await m.handlers['update:open-release']();
  assert.deepEqual(m.opened, ['https://github.com/gabrielevaudano98/folio/releases/tag/v1.6.0']);
  assert.ok(!m.calls.includes('download'));
}
// a version string from the release metadata that is not a version is ignored
{ const m = make({ version: 'x"><script>' }); await m.handlers['update:check'](); assert.equal(m.u.state().version, null); }
// the switch is remembered and saved
{ const m = make(); assert.equal(await m.handlers['update:set-auto'](false), false); assert.equal(m.settings.autoUpdate, false); assert.equal(m.saved(), 1); }
// a development build is off and checking says so
{ const au = new EventEmitter(); const hs = {};
  const u = createUpdater({ app: { isPackaged: false, getVersion: () => '1.5.1' }, shell: {}, h: (c, f) => { hs[c] = f; }, getWin: () => null, settings: {}, saveSettings() {}, autoUpdater: au, platform: 'win32', env: {} });
  assert.equal(u.state().phase, 'off'); await assert.rejects(u.check(), /off in this build/); u.schedule(); }
console.log('updater: ok');
