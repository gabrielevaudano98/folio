// Folio — notices when another app starts using the microphone (a call), so the recorder can offer to start.
// Windows keeps, per app, when it last opened and closed the microphone (Settings > Privacy > Microphone reads the same keys):
//   HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone\{NonPackaged|<package>}\<app>
//   LastUsedTimeStart = when it opened it, LastUsedTimeStop = 0 while it still has it open.
// Nothing is recorded or listened to here: only the name of the app is read, and the person is asked before anything starts.

export const MIC_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';

const KNOWN = [
  [/^(ms-?teams|teams|msteams)$/i, 'Microsoft Teams'], [/^zoom/i, 'Zoom'], [/^(slack)$/i, 'Slack'], [/^(discord)$/i, 'Discord'],
  [/^(skype)/i, 'Skype'], [/^webex|^ciscocollab/i, 'Webex'], [/^(chrome|msedge|firefox|brave|opera|vivaldi)$/i, 'the browser'],
];

/** a registry key name into a short app name: `C:#Program Files#Zoom#bin#Zoom.exe` -> Zoom, `MSTeams_8wekyb3d8bbwe` -> Microsoft Teams */
export function appName(key) {
  const last = String(key).split('\\').pop() || '';
  const base = last.includes('#') ? last.split('#').pop().replace(/\.exe$/i, '') : last.split('_')[0]; // a path of an installed app, or a package name
  const clean = base.replace(/^(microsoft|ms)\./i, '') || last; // Microsoft.SkypeApp -> SkypeApp
  for (const [re, name] of KNOWN) if (re.test(clean)) return name;
  return clean;
}

/**
 * Reads the output of `reg query <MIC_KEY> /s` and returns the apps that have the microphone open right now.
 * @returns {{name: string, key: string, since: number}[]} `since` is the open time as a Windows FILETIME (100 ns ticks since 1601)
 */
export function parseInUse(text) {
  const out = [];
  let key = null, start = 0n, stop = 0n, gotStart = false, gotStop = false;
  const flush = () => { if (key && gotStart && gotStop && start > 0n && stop === 0n) out.push({ name: appName(key), key, since: Number(start) }); }; // both values must be there: a half-read key is not a call
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^HK[A-Z_]+\\/i.test(line)) { flush(); key = line; start = 0n; stop = 0n; gotStart = false; gotStop = false; continue; }
    const m = /^\s+(LastUsedTimeStart|LastUsedTimeStop)\s+REG_QWORD\s+(0x[0-9a-f]+|\d+)\s*$/i.exec(line);
    if (!m) continue;
    let v; try { v = BigInt(m[2]); } catch { continue; }
    if (/Start$/i.test(m[1])) { start = v; gotStart = true; } else { stop = v; gotStop = true; }
  }
  flush();
  return out;
}

/**
 * One call = one stretch of the microphone being in use by some app. The person is told once per stretch, after the app has
 * held the microphone for `holdMs` (a short blip from dictation or a notification sound is not a call), and the stretch only
 * ends after `quietMs` without the microphone (muting inside a call often lets go of it for a moment).
 */
export function createEpisodes({ holdMs = 8000, quietMs = 30000 } = {}) {
  let ep = null;
  return {
    /** @param {string[]} names apps using the microphone now (the recorder itself already removed)  @param {number} now ms
     *  @returns {string|null} the app to tell the person about, once per call */
    step(names, now) {
      if (names.length) {
        if (!ep) ep = { since: now, last: now, notified: false };
        ep.last = now;
        if (!ep.notified && now - ep.since >= holdMs) { ep.notified = true; return names[0]; }
      } else if (ep && now - ep.last >= quietMs) ep = null;
      return null;
    },
    reset() { ep = null; },
    /** true while a stretch is open (tests) */
    get open() { return !!ep; },
  };
}

/**
 * Polls the registry. `exec(args)` runs `reg` and resolves to its text (injected so tests need no Windows).
 * `isBusy()` is true while the recorder is running: nothing is offered then, and the stretch starts over afterwards.
 */
export function createMicWatch({ exec, onCall, isBusy = () => false, own = [], intervalMs = 4000, now = () => Date.now(), setTimer = setInterval, clearTimer = clearInterval, episodes = createEpisodes() }) {
  let timer = null, running = false;
  const ownNames = own.map((n) => String(n).toLowerCase().replace(/\.exe$/, ''));
  const leaf = (k) => k.split('\\').pop().split('#').pop().replace(/\.exe$/i, '').toLowerCase();
  const mine = (a) => ownNames.includes(leaf(a.key)); // the app itself (narration, a test) is not a call
  async function tick() {
    if (running) return; // a slow `reg` never piles up
    running = true;
    try {
      if (isBusy()) { episodes.reset(); return; }
      const apps = parseInUse(await exec(['query', MIC_KEY, '/s'])).filter((a) => !mine(a));
      const who = episodes.step(apps.map((a) => a.name), now());
      if (who) await onCall({ app: who }); // an offer that fails stays inside this try
    } catch { /* reg missing or the key not there yet: nothing to report */ } finally { running = false; }
  }
  return {
    start() { if (timer) return; timer = setTimer(tick, intervalMs); timer.unref?.(); },
    stop() { if (timer) clearTimer(timer); timer = null; episodes.reset(); },
    tick, get on() { return !!timer; },
  };
}
