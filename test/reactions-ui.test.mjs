// Folio D16: reactions and @mentions in comments, with no syntax of their own. A reaction is a one-emoji reply, a mention is
// a [[People/Name]] link; both stay readable as plain CriticMarkup in the file.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-react-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud'), pages = path.join(ws, 'pages');
fs.mkdirSync(path.join(ws, 'People'), { recursive: true }); fs.mkdirSync(pages, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47604, authorName: 'Tester' }));
fs.writeFileSync(path.join(ws, 'People', 'Ada Lovelace.md'), '# Ada Lovelace\n');
fs.writeFileSync(path.join(ws, 'People', 'Bob Stone.md'), '# Bob Stone\n');
fs.writeFileSync(path.join(pages, 'r.md'), '# Review\n\nA {==line==}{>>Tester, 2026-11-20 10:00: Check this<<} here.\n');
const field = "document.querySelector('input[data-reply]')";
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-dir=\"pages\"]').click()", wait: 500 },
  { js: "document.querySelector('[data-file=\"pages/r.md\"]').click()", wait: 900 },
  { js: "document.querySelector('#view-switch [data-view=\"edit\"]').click()", wait: 1500 },
  { js: "document.querySelector('#dock-tab-review').click(); true", wait: 900 },
  // @ in a reply lists people; the arrows move; Enter writes the link
  { js: `(() => { const f = ${field}; f.focus(); f.value = 'Thanks @ad'; f.setSelectionRange(10, 10); f.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`, wait: 600 },
  { js: `(() => { const m = document.querySelector('#rv-mentions'); return [!m.hidden, [...m.querySelectorAll('[role=option]')].map((o) => o.textContent), ${field}.getAttribute('aria-activedescendant')]; })()`, log: true, wait: 100 },
  { js: `${field}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); [${field}.value, document.querySelector('#rv-mentions').hidden]`, log: true, wait: 200 },
  { js: `${field}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); true`, wait: 2500 },
  { js: "[...document.querySelectorAll('.rv-comment p')].map((p) => p.textContent)", log: true, wait: 100 },
  { js: "document.querySelectorAll('.rv-comment .rv-mention').length", log: true, wait: 100 },
  // reaction: the picker, add, count, take back
  { js: "document.querySelector('[data-act=pick]').click(); true", wait: 300 },
  { js: "[document.querySelectorAll('.rv-pick').length, document.querySelector('[data-act=pick]').getAttribute('aria-expanded')]", log: true, wait: 100 },
  { js: "document.querySelector('.rv-pick[data-emoji=\"👍\"]').click(); true", wait: 2500 },
  { js: "(() => { const b = document.querySelector('.rv-react:not(.rv-pick)'); return [b?.textContent.trim(), b?.getAttribute('aria-pressed'), document.querySelectorAll('.rv-comment').length, document.querySelectorAll('.rv-pick').length]; })()", log: true, wait: 100 },
  { js: "document.querySelector('.rv-react:not(.rv-pick)').click(); true", wait: 2500 },
  { js: "[document.querySelectorAll('.rv-react:not(.rv-pick)').length, document.querySelectorAll('.rv-comment').length]", log: true, wait: 100 },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 120000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\nreactions and mentions'); if (process.env.DEBUG) console.log(JSON.stringify(logs, null, 1));
  assert.equal(logs.length, 8, out.slice(-1500));
  const [open, picked, texts, chips, pickerOpen, reacted, taken, errors] = [logs[0], logs[1], logs[2], logs[3], logs[4], logs[5], logs[6], logs[7]]; assert.deepEqual(errors, [], JSON.stringify(logs.at(-2)));
  assert.equal(open[0], true); assert(open[1].some((x) => x.includes('Ada Lovelace')) && !open[1].some((x) => x.includes('Bob Stone')), JSON.stringify(open)); assert.equal(open[2], 'rv-m-0');
  assert.match(picked[0], /^Thanks \[\[(People\/)?Ada Lovelace\]\] $/); assert.equal(picked[1], true);
  assert(texts.some((x) => /Thanks @Ada Lovelace/.test(x)), JSON.stringify(texts)); assert.equal(chips, 1);
  console.log('  ✓ typing @ in a reply lists the people (not other pages); Enter writes [[People/Ada Lovelace]], drawn as a mention chip');
  assert.deepEqual(pickerOpen, [8, 'true']);
  assert.deepEqual(reacted.slice(0, 3), ['👍1', 'true', 2]); assert.deepEqual(taken, [0, 2]);
  console.log('  ✓ the reaction picker adds a one-emoji reply shown as a chip with its count; clicking it again takes it back');
  assert(!/<<\}\{>>Tester[^<]*: 👍/.test(fs.readFileSync(path.join(pages, 'r.md'), 'utf8')) && /Thanks \[\[(People\/)?Ada Lovelace\]\]<<\}/.test(fs.readFileSync(path.join(pages, 'r.md'), 'utf8')), fs.readFileSync(path.join(pages, 'r.md'), 'utf8'));
  console.log('  ✓ the file holds only CriticMarkup replies and a wiki link');
});
