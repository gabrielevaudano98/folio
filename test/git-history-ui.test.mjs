// Folio D15 leftover in the real app: a workspace that is a Git repository shows the page's commits in its version timeline,
// read-only (no naming), and a commit can be restored like any version.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-githist-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud'), pages = path.join(ws, 'pages');
fs.mkdirSync(pages, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47605, authorName: 'Tester' }));
const git = (...a) => execFileSync('git', ['-c', 'user.name=Ada', '-c', 'user.email=ada@example.com', '-c', 'commit.gpgsign=false', ...a], { cwd: ws, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_DATE: '2026-11-18T10:00:00Z', GIT_COMMITTER_DATE: '2026-11-18T10:00:00Z' } });
git('init', '-q');
fs.writeFileSync(path.join(pages, 'a.md'), '# A\n\nThe first draft.\n'); git('add', '.'); git('commit', '-q', '-m', 'First draft');
fs.writeFileSync(path.join(pages, 'a.md'), '# A\n\nThe second thoughts.\n'); git('add', '.'); git('commit', '-q', '-m', 'Second thoughts');
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-dir=\"pages\"]').click()", wait: 500 },
  { js: "document.querySelector('[data-file=\"pages/a.md\"]').click()", wait: 1200 },
  { js: "document.querySelector('#btn-more').click(); true", wait: 400 },
  { js: "[...document.querySelectorAll('#menu .menu-item')].find((b) => b.textContent.startsWith('Version history')).click(); true", wait: 1800 },
  { js: "[...document.querySelectorAll('#history .hv-versions .hv-v')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim()).filter((t) => /Git commit/.test(t))", log: true, wait: 100 },
  { js: "(() => { const items = [...document.querySelectorAll('#history .hv-versions .hv-v')].filter((b) => /Git commit/.test(b.textContent)); items[items.length - 1].click(); return true; })()", wait: 800 },
  { js: "(() => { const h = document.querySelector('#history'); return [h.querySelector('[data-act=name]').disabled, h.querySelector('[data-act=restore]').disabled, h.querySelectorAll('.hv-diff ins, .hv-diff del').length > 0]; })()", log: true, wait: 100 },
  { js: "document.querySelector('#history [data-act=restore]').click(); true", wait: 1800 },
  { js: "[document.querySelector('#history').hidden, document.querySelector('.rich-prose')?.textContent.includes('first draft') || document.querySelector('#editor')?.textContent.includes('first draft')]", log: true, wait: 100 },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 90000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\ngit commits in the version timeline'); if (process.env.DEBUG) console.log(JSON.stringify(logs, null, 1));
  assert.equal(logs.length, 4, out.slice(-1500));
  const [items, sel, restored, errors] = logs; assert.deepEqual(errors, []);
  assert.equal(items.length, 2); assert(/Second thoughts/.test(items[0]) && /First draft/.test(items[1]) && items.every((t) => /Ada/.test(t)), JSON.stringify(items));
  console.log('  ✓ the commits that changed the page appear in the timeline with their author and message');
  assert.deepEqual(sel, [true, false, true]);
  console.log('  ✓ a commit cannot be named, but it can be compared and restored');
  assert.equal(restored[0], true); assert.equal(restored[1], true);
  console.log('  ✓ restoring a commit puts that text back');
});
