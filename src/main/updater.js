// Folio — updates from GitHub releases. Checks the repository's releases (through electron-updater, which reads
// `latest.yml` / `latest-mac.yml` from the release and checks the SHA-512 of what it downloads) and, where the
// operating system allows it without a code-signing certificate, installs the new version.
//
//   install  Windows installer (NSIS): download, then "Restart and install"; no certificate needed.
//   notify   macOS, Windows portable, Linux: Folio says a new version exists and opens its release page. macOS refuses
//            to swap in an update that is not signed with a Developer ID (Squirrel.Mac), so an unsigned build cannot
//            update itself there; see docs/explanation/updates.md.
//   off      a development run (not packaged), or updates switched off with FOLIO_NO_UPDATE=1.
// main.js passes in what it owns, so this file is testable without Electron.

const REPO = 'gabrielevaudano98/folio';
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
export const FIRST_CHECK_MS = 15 * 1000; // after startup, so it never competes with opening the window

/** how this build can update; `installOnMac` is for a future signed build (see docs/explanation/updates.md) */
export function updateMode({ isPackaged, platform, env = {}, installOnMac = false }) {
  if (!isPackaged || env.FOLIO_NO_UPDATE === '1') return 'off';
  if (platform === 'win32') return env.PORTABLE_EXECUTABLE_FILE ? 'notify' : 'install'; // the portable exe is not installed anywhere
  if (platform === 'darwin') return installOnMac ? 'install' : 'notify';
  return 'notify';
}

/** the release page of a version; built here from a checked version string, never taken from the downloaded metadata */
export function releaseUrl(version) {
  return SEMVER.test(String(version)) ? `https://github.com/${REPO}/releases/tag/v${version}` : `https://github.com/${REPO}/releases`;
}

export function createUpdater({ app, shell, h, getWin, settings, saveSettings, autoUpdater, platform = process.platform, env = process.env, installOnMac = false, log = console }) {
  const mode = updateMode({ isPackaged: app.isPackaged, platform, env, installOnMac });
  let state = { phase: mode === 'off' ? 'off' : 'idle', mode, current: app.getVersion(), version: null, percent: 0, error: null, checkedAt: null };
  let timer = null, first = null;
  const set = (patch) => { state = { ...state, ...patch }; try { getWin()?.webContents.send('update:state', state); } catch {} return state; };

  if (mode !== 'off') {
    autoUpdater.autoDownload = false; // the person decides; nothing is downloaded behind their back
    autoUpdater.autoInstallOnAppQuit = mode === 'install';
    autoUpdater.allowPrerelease = true; // every Folio release is still marked pre-alpha
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = null;
    autoUpdater.on('update-available', (i) => set({ phase: 'available', version: SEMVER.test(i?.version) ? i.version : null, error: null, checkedAt: Date.now() }));
    autoUpdater.on('update-not-available', () => set({ phase: 'none', version: null, error: null, checkedAt: Date.now() }));
    autoUpdater.on('download-progress', (p) => set({ phase: 'downloading', percent: Math.round(p?.percent || 0) }));
    autoUpdater.on('update-downloaded', () => set({ phase: 'ready', percent: 100 }));
    autoUpdater.on('error', (e) => set({ phase: 'error', error: String(e?.message || e).split('\n')[0].slice(0, 200), checkedAt: Date.now() }));
  }

  async function check() {
    if (mode === 'off') throw new Error('Updates are off in this build.');
    if (state.phase === 'checking' || state.phase === 'downloading') return state;
    if (state.phase === 'ready') return state;
    set({ phase: 'checking', error: null });
    try { await autoUpdater.checkForUpdates(); } catch (e) { set({ phase: 'error', error: String(e?.message || e).split('\n')[0].slice(0, 200), checkedAt: Date.now() }); }
    return state;
  }
  async function download() {
    if (mode !== 'install') throw new Error('This build cannot install updates itself. Open the release page.');
    if (state.phase !== 'available') throw new Error('There is no update to download.');
    set({ phase: 'downloading', percent: 0, error: null });
    try { await autoUpdater.downloadUpdate(); } catch (e) { set({ phase: 'error', error: String(e?.message || e).split('\n')[0].slice(0, 200) }); }
    return state;
  }
  function install() {
    if (state.phase !== 'ready') throw new Error('There is no downloaded update.');
    return { quitting: true, run: () => autoUpdater.quitAndInstall(false, true) };
  }
  function schedule() {
    clearTimeout(first); clearInterval(timer); first = timer = null;
    if (mode === 'off' || !settings.autoUpdate) return;
    first = setTimeout(() => { check().catch(() => {}); }, FIRST_CHECK_MS);
    timer = setInterval(() => { check().catch(() => {}); }, CHECK_EVERY_MS);
    first.unref?.(); timer.unref?.();
  }

  h('update:state', () => state);
  h('update:check', () => check());
  h('update:download', () => download());
  h('update:install', () => { const r = install(); setImmediate(r.run); return true; });
  h('update:open-release', async () => { await shell.openExternal(releaseUrl(state.version)); return true; });
  h('update:set-auto', (on) => { settings.autoUpdate = !!on; saveSettings(); schedule(); return settings.autoUpdate; });

  return { state: () => state, check, download, install, schedule, mode };
}
