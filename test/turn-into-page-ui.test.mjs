// Folio "Turn into page" (Notion): the block menu turns the chosen block into a page next to this one, named after it,
// and a [[link]] takes its place. The new page holds the block; the source page changes only there. Checked on disk.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-topage-ui-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud'), pages = path.join(ws, 'pages');
fs.mkdirSync(pages, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47615 }));
fs.writeFileSync(path.join(pages, 'a.md'), '# Plan\n\nAlpha line\n\n## Notes for Ada\n\nBravo line\n\nCharlie line\n');
// footnotes: [^1] is cited only by the block that becomes a page (its definition moves); [^2] also by a block that stays (kept in both)
fs.writeFileSync(path.join(pages, 'f.md'), '# Notes\n\nMoved claim[^1] and shared[^2].\n\nStays here[^2].\n\n[^1]: First source.\n\n[^2]: Second source.\n');
const P = "document.querySelector('.rich-prose')";
const hover = (sel, n) => `(() => { const a = ${P}.querySelectorAll(':scope > ${sel}')[${n}]; const r = a.getBoundingClientRect(); a.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 10, clientY: r.top + 5 })); return true; })()`;
const turn = "(() => { document.querySelector('.block-grip').click(); const b = document.querySelector('[data-act=\"page\"]'); const t = b.textContent; b.click(); return t; })()";
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-dir=\"pages\"]').click()", wait: 500 },
  { js: "document.querySelector('[data-file=\"pages/a.md\"]').click()", wait: 900 },
  { js: "document.querySelector('#view-switch [data-view=\"edit\"]').click()", wait: 1200 },
  { js: hover('p', 0), wait: 200 }, { js: turn, log: true, wait: 1500 },
  { js: hover('h2', 0), wait: 200 }, { js: turn, log: true, wait: 1500 },
  { js: hover('p', 2), wait: 200 }, { js: turn, log: true, wait: 1500 },
  { js: '[...document.querySelectorAll(".rich-prose > *")].map((e) => e.textContent)', log: true, wait: 800 },
  { js: "document.querySelector('[data-file=\"pages/f.md\"]').click()", wait: 1200 },
  { js: hover('p', 0), wait: 200 }, { js: turn, log: true, wait: 1800 },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true })); // after the last assertion, however it ends
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile, FOLIO_NO_OS_NOTIFY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 180000);
child.on('close', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\nturn into page ui'); if (process.env.DEBUG) console.log(JSON.stringify(logs, null, 1));
  assert.equal(logs.length, 6, out.slice(-2000)); assert.deepEqual(logs.at(-1), []);
  assert.match(logs[0], /Turn into page/);
  const files = fs.readdirSync(pages).sort(); assert.deepEqual(files, ['Alpha line.md', 'Bravo line.md', 'Moved claim and shared.md', 'Notes for Ada.md', 'a.md', 'f.md'].sort());
  console.log('  ✓ the block menu has Turn into page; each page is named after its block (heading text, first line) next to the source page');
  assert.equal(fs.readFileSync(path.join(pages, 'Notes for Ada.md'), 'utf8'), '## Notes for Ada\n');
  assert.equal(fs.readFileSync(path.join(pages, 'Alpha line.md'), 'utf8'), '# Alpha line\n\nAlpha line\n');
  console.log('  ✓ the new page holds the block (a heading stays the title, other text gets a title line)');
  assert.equal(fs.readFileSync(path.join(pages, 'a.md'), 'utf8'), '# Plan\n\n[[Alpha line]]\n\n[[Notes for Ada]]\n\n[[Bravo line]]\n\nCharlie line\n');
  console.log('  ✓ a [[link]] takes the block’s place; the rest of the source page is unchanged');
  assert.equal(fs.readFileSync(path.join(pages, 'Moved claim and shared.md'), 'utf8'), '# Moved claim and shared\n\nMoved claim[^1] and shared[^2].\n\n[^1]: First source.\n\n[^2]: Second source.\n');
  assert.equal(fs.readFileSync(path.join(pages, 'f.md'), 'utf8'), '# Notes\n\n[[Moved claim and shared]]\n\nStays here[^2].\n\n[^2]: Second source.\n');
  console.log('  ✓ footnotes go with the blocks: a definition moves to the new page and stays in the source only while the source still cites it');
});
