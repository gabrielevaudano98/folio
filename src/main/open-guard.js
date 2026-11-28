// Folio — which workspace files may be handed to the system's default app ("Open" on an attached file).
// A folder that came from somewhere else (a download, a shared drive, a git clone) can hold anything under `.asset/`, and
// opening a program or script would run it. Only documents and media are opened; programs, scripts, shortcuts and
// installers are refused, and so is a file with no extension.
import path from 'node:path';

const LAUNCHERS = new Set([
  // Windows programs, scripts, shortcuts, installers, registry and control panel items
  'exe', 'com', 'scr', 'pif', 'bat', 'cmd', 'ps1', 'psm1', 'psd1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'wsc', 'hta', 'msi', 'msp', 'mst', 'msc',
  'reg', 'lnk', 'url', 'cpl', 'dll', 'sys', 'gadget', 'appx', 'appxbundle', 'msix', 'msixbundle', 'application', 'appref-ms', 'settingcontent-ms', 'library-ms', 'scf', 'inf', 'rgs', 'jar', 'jnlp', 'chm', 'diagcab',
  // macOS
  'app', 'command', 'workflow', 'terminal', 'tool', 'pkg', 'dmg', 'action', 'scpt', 'scptd', 'applescript', 'osa', 'webloc', 'fileloc', 'inetloc', 'mpkg', 'prefpane', 'saver', 'qlgenerator',
  // Linux and shells
  'sh', 'bash', 'zsh', 'csh', 'ksh', 'fish', 'run', 'bin', 'out', 'appimage', 'desktop', 'deb', 'rpm', 'snap', 'flatpakref', 'py', 'pl', 'rb', 'php', 'mjs', 'cjs',
]);

/** true when the file is a document or media file that is safe to open with the system's default app */
export function mayOpenWithSystem(file) {
  // Windows drops spaces and dots at the end of a name ("setup.exe ." runs as setup.exe); the last extension decides
  const base = path.basename(String(file || '')).replace(/[ .]+$/, '');
  const ext = path.extname(base).slice(1).toLowerCase().trim();
  return !!ext && !LAUNCHERS.has(ext);
}
