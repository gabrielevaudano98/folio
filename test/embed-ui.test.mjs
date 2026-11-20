// Folio live embeds: `![[Note#Heading]]` alone on a line is drawn under the line in the Write view; the text on disk stays as written.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-embed-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud'), pages = path.join(ws, 'pages');
fs.mkdirSync(pages, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47597 }));
const src = '# Host\n\n![[Source#Part]]\n\n![[Nowhere]]\n\nEnd.\n';
fs.writeFileSync(path.join(pages, 'host.md'), src);
fs.writeFileSync(path.join(pages, 'Source.md'), '# Source\n\n## Part\n\nHello embed.\n\n## Other\n\nNot this one.\n');
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-dir=\"pages\"]').click()", wait: 500 },
  { js: "document.querySelector('[data-file=\"pages/host.md\"]').click()", wait: 900 },
  { js: "document.querySelector('#view-switch [data-view=\"edit\"]').click()", wait: 2500 },
  { js: "[...document.querySelectorAll('.rich-embed')].map((e) => e.querySelector('.rich-embed-bar span').textContent + '::' + e.querySelector('.rich-embed-body').textContent.trim())", log: true, wait: 100 },
  { js: "document.querySelector('.rich-prose').textContent.includes('![[Source#Part]]')", log: true, wait: 100 },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 90000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\nlive embeds'); if (process.env.DEBUG) console.log(logs, out.slice(-800));
  assert.equal(logs.length, 3, out.slice(-1500));
  const [cards, textKept, errors] = logs; assert.deepEqual(errors, []);
  assert.equal(cards.length, 2);
  assert(cards[0].startsWith('Source#Part::') && cards[0].includes('Hello embed.') && !cards[0].includes('Not this one'), cards[0]);
  assert(/does not exist/.test(cards[1]), cards[1]);
  console.log('  ✓ a ![[Note#Heading]] line shows that section live, a missing target says so');
  assert(textKept === true); assert.equal(fs.readFileSync(path.join(pages, 'host.md'), 'utf8'), src);
  console.log('  ✓ the text stays as written, the file is untouched');
});
