// Folio — process entry. One binary, two jobs:
//  - normal start: the app (main.js)
//  - `--mcp-stdio`: the stdio MCP bridge that Claude Desktop, Cursor, VS Code… launch.
// The bridge runs inside the Electron main process, so the RunAsNode fuse can stay off
// (ELECTRON_RUN_AS_NODE would let any local program turn the signed binary into a Node runtime).
import { app } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Configs written before 1.2.3 launch `<binary> …/mcp-stdio.mjs --bridge …` with ELECTRON_RUN_AS_NODE; keep them working.
const legacy = process.argv.some((a) => /[\\/]mcp-stdio\.mjs$/.test(a));
if (process.argv.includes('--mcp-stdio') || legacy) {
  if (process.platform === 'darwin') app.dock?.hide();
  app.disableHardwareAcceleration();
  app.on('window-all-closed', () => {});
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mcp-stdio.mjs').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  const why = (w) => () => { if (process.env.FOLIO_DEBUG_STDIO) console.error(`[folio stdio] stdin ${w}`); app.exit(0); };
  process.stdin.on('end', why('end'));
  process.stdin.on('close', why('close'));
  await import(pathToFileURL(script).href);
} else {
  await import('./main.js');
}
