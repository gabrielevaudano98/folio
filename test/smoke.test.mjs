// Folio UI smoke test: opens every document type in every view and fails on any renderer error.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-smoke-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud');
fs.cpSync(new URL('./fixture', import.meta.url), ws, { recursive: true });
fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47599 }));
const before = Object.fromEntries(fs.readdirSync(ws).filter((f) => f.endsWith('.md')).map((f) => [f, fs.readFileSync(path.join(ws, f), 'utf8')]));
const views = { 'Roadmap.md': ['edit', 'split', 'preview'], 'Pitch.slides.md': ['visual', 'split', 'code'], 'System.board.md': ['visual', 'split', 'code'], 'Budget.sheet.md': ['visual', 'split', 'code'] };
const steps = [{ size: [1280, 800], wait: 1500 }];
for (const [file, vs] of Object.entries(views)) {
  steps.push({ js: `document.querySelector('[data-file="${file}"]').click()`, wait: 900 });
  for (const v of vs) steps.push({ js: `document.querySelector('#view-switch [data-view="${v}"]').click()`, wait: 700 });
}
steps.push({ js: "document.querySelector('[data-sv=kanban]')?.click()", wait: 500 }, { js: "document.querySelector('[data-sv=grid]')?.click()", wait: 300 }, { js: "document.querySelector('#ai-status').click()", wait: 600 }, { log: true, js: 'window.__folioErrors || []', wait: 100 });
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));

const args = ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])];
const child = spawn(electron, args, { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 90000);
child.on('exit', () => {
  clearTimeout(timer);
  const errs = out.split('\n').filter((l) => /\[folio-error\]|Uncaught/.test(l));
  const report = out.split('\n').find((l) => l.startsWith('js '));
  const after = Object.fromEntries(Object.keys(before).map((f) => [f, fs.readFileSync(path.join(ws, f), 'utf8')]));
  const touched = Object.keys(before).filter((f) => before[f] !== after[f]);
  console.log('\nui smoke');
  if (!report) { console.error(out.slice(-3000)); throw new Error('The app did not finish the smoke run.'); }
  if (errs.length || report !== 'js []') { console.error(errs.join('\n') || report); process.exit(1); }
  console.log('  ✓ every document type opens in every view without errors');
  if (touched.length) { console.error('Files rewritten just by opening them:', touched); process.exit(1); }
  console.log('  ✓ opening documents does not rewrite them');
});
