// Folio D16: comments sit beside their line, Accept/Reject on a suggestion appears on hover, the Info tab lists the page's facts,
// and gallery cards carry a thumbnail of the filled page.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-review-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud'), pages = path.join(ws, 'pages');
fs.mkdirSync(pages, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47598, authorName: 'Tester' }));
const filler = (n) => Array.from({ length: n }, (_, i) => `Filler paragraph ${i} with some words to take a little vertical room.`).join('\n\n');
const src = `# Review\n\nFirst {==line==}{>>Tester, 2026-11-20 10:00: Check this<<} here.\n\n${filler(14)}\n\nLast {==line==}{>>Tester, 2026-11-20 10:01: And this<<} here and {++an addition++} to accept.\n\n- [x] one\n- [ ] two\n\nEnd.\n`;
fs.writeFileSync(path.join(pages, 'r.md'), src);
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-dir=\"pages\"]').click()", wait: 500 },
  { js: "document.querySelector('[data-file=\"pages/r.md\"]').click()", wait: 900 },
  { js: "document.querySelector('#view-switch [data-view=\"edit\"]').click()", wait: 1500 },
  // 1. cards beside their lines
  { js: "document.querySelector('#dock-tab-review').click(); true", wait: 900 },
  { js: "(() => { const l = document.querySelector('.rv-list'); const cards = [...document.querySelectorAll('.rv-card.rv-thread')]; const marks = [...document.querySelectorAll('.rich-prose .critic-hl')]; return { aligned: l.classList.contains('is-aligned'), n: cards.length, tops: cards.map((c) => parseFloat(c.style.top)), gap: marks.length === 2 ? marks[1].getBoundingClientRect().top - marks[0].getBoundingClientRect().top : 0 }; })()", log: true, wait: 100 },
  { js: "document.querySelector('[data-rv=align]').click(); true", wait: 300 },
  { js: "document.querySelector('.rv-list').classList.contains('is-aligned')", log: true, wait: 100 },
  { js: "document.querySelector('[data-rv=align]').click(); true", wait: 300 },
  // 2. hover Accept on the suggestion
  { js: "document.querySelector('.rich-prose .critic-ins').scrollIntoView({ block: 'center' }); true", wait: 500 },
  { js: "document.querySelector('.rich-prose .critic-ins').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); true", wait: 300 },
  { js: "(() => { const b = document.querySelector('.rv-hover'); return [!b.hidden, [...b.querySelectorAll('button')].map((x) => x.getAttribute('aria-label'))]; })()", log: true, wait: 100 },
  { js: "document.querySelector('.rv-hover [data-hv=accept]').click(); true", wait: 2500 },
  { js: "[document.querySelectorAll('.rich-prose .critic-ins').length, document.querySelector('.rv-hover').hidden]", log: true, wait: 100 },
  // 3. Info tab
  { js: "document.querySelector('#dock-tab-info').click(); true", wait: 900 },
  { js: "Object.fromEntries([...document.querySelectorAll('#dock-info .info-list > div')].map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]))", log: true, wait: 100 },
  { js: "[document.querySelector('#dock-tab-info').getAttribute('aria-selected'), document.querySelector('#dock-info').hidden, document.querySelector('#dock-review').hidden]", log: true, wait: 100 },
  // 4. gallery thumbnails
  { js: "document.querySelector('.ribbon [data-cmd=\"app:template\"]').click(); true", wait: 2500 },
  { js: "(() => { const t = [...document.querySelectorAll('.tg-card .tg-thumb-page')]; return [t.length, t.filter((x) => x.textContent.trim().length > 10).length, Math.round(document.querySelector('.tg-thumb').getBoundingClientRect().height)]; })()", log: true, wait: 100 },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 120000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\nreview ui (D16)'); if (process.env.DEBUG) console.log(JSON.stringify(logs, null, 1));
  assert.equal(logs.length, 8, out.slice(-1500));
  const [al, unal, hov, accepted, info, tab, thumbs, errors] = logs; assert.deepEqual(errors, []);
  assert(al.aligned && al.n === 2 && al.gap > 100, JSON.stringify(al));
  assert(al.tops[1] - al.tops[0] > al.gap * 0.5, `the second card sits well below the first: ${JSON.stringify(al)}`);
  assert.equal(unal, false);
  console.log('  ✓ comment cards sit beside their lines (the later one lower); “Beside text” off stacks them again');
  assert.equal(hov[0], true); assert.deepEqual(hov[1], ['Accept this suggestion', 'Reject this suggestion']);
  assert.deepEqual(accepted, [0, true]);
  assert(/an addition to accept/.test(fs.readFileSync(path.join(pages, 'r.md'), 'utf8')) && !/\{\+\+/.test(fs.readFileSync(path.join(pages, 'r.md'), 'utf8')));
  console.log('  ✓ resting on a suggestion shows Accept and Reject; Accept writes the text without the markup');
  assert(/^\d/.test(info.Words) && info.Headings === '1' && info.Tasks === '1 of 2 done' && info.Comments === '2' && info.Path === 'pages/r.md' && /KB|B/.test(info.Size) && info.Changed, JSON.stringify(info));
  assert.deepEqual(tab, ['true', false, true]);
  console.log('  ✓ the Info tab lists words, headings, tasks, comments, path, size and when the file changed');
  assert(thumbs[0] >= 3 && thumbs[1] >= 1 && thumbs[2] >= 150, JSON.stringify(thumbs));
  console.log('  ✓ gallery cards carry a large thumbnail of the filled page');
});
