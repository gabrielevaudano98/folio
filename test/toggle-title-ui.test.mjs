// #86: a toggle title keeps colour and comments in the Write view: it shows them, the review pane lists the comment,
// the colour menu colours title text, and resolving the comment writes the reply into the title. Files checked on disk.
import fs from 'node:fs'; import path from 'node:path';
import assert from 'node:assert/strict';
import { workspace, runApp } from './harness.mjs';

const w = workspace('toggle-title-ui', 47633);
process.on('exit', () => fs.rmSync(w.tmp, { recursive: true, force: true })); // also when the run or an assertion fails
const sf = path.join(w.ud, 'settings.json'); fs.writeFileSync(sf, JSON.stringify({ ...JSON.parse(fs.readFileSync(sf, 'utf8')), authorName: 'Tester' }));
fs.mkdirSync(path.join(w.ws, 'pages'), { recursive: true });
const TITLE = 'Plan [urgent]{color=red} {==check==}{>>Ann, 2026-11-20 10:00: why?<<}';
const SRC = `# Toggles\n\n<details open>\n<summary>${TITLE}</summary>\n\nBody line\n\n</details>\n\nAfter.\n`;
fs.writeFileSync(path.join(w.ws, 'pages', 't.md'), SRC);
const disk = "folio.read('pages/t.md')";
const S = "document.querySelector('.rich-prose summary')";
const selectWord = (word) => `(() => { const s = ${S}; const walk = document.createTreeWalker(s, NodeFilter.SHOW_TEXT); for (let n = walk.nextNode(); n; n = walk.nextNode()) { const i = n.data.indexOf(${JSON.stringify(word)}); if (i >= 0) { document.querySelector('.rich-prose').focus(); const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + ${word.length}); getSelection().removeAllRanges(); getSelection().addRange(r); return true; } } return false; })()`;
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-dir=\"pages\"]').click()", wait: 500 },
  { js: "document.querySelector('[data-file=\"pages/t.md\"]').click()", wait: 900 },
  { js: "document.querySelector('#view-switch [data-view=\"edit\"]').click()", wait: 1500 },
  // 1. the title shows the colour, the highlight and the comment marker; the toggle is an editable block, not raw source
  { js: `(() => { const s = ${S}; return { toggle: !!s.closest('.rich-details'), color: s.querySelector('[data-folio-color]')?.getAttribute('data-color') + ':' + s.querySelector('[data-folio-color]')?.textContent, hl: s.querySelector('.critic-hl')?.textContent, comment: !!s.querySelector('.critic-comment'), raw: !!document.querySelector('.rich-prose [data-folio-raw]') }; })()`, log: true, wait: 100 },
  // 2. the review pane lists the title's comment with its quote
  { js: "document.querySelector('#dock-tab-review').click(); true", wait: 900 },
  { js: "[...document.querySelectorAll('.rv-card.rv-thread')].map((c) => c.querySelector('.rv-quote')?.textContent + ' | ' + c.querySelector('.rv-comment p')?.textContent)", log: true, wait: 100 },
  // 3. colour a word of the title from the colour menu: saved as [Plan]{color=blue} inside <summary>
  { js: selectWord('Plan'), log: true, wait: 300 },
  { js: "document.querySelector('.rb-swatch[data-colour=\"blue\"]').click(); true", wait: 1800 },
  { js: disk, log: true, wait: 100 },
  // 4. resolve the comment: the reply is written into the title and the toggle stays a toggle
  { js: "document.querySelector('.rv-card.rv-thread [data-act=resolve]').click(); true", wait: 2200 },
  { js: disk, log: true, wait: 100 },
  // 5. reopen: the saved title reads back with the same marks
  { js: "document.querySelector('#view-switch [data-view=\"preview\"]').click(); true", wait: 900 },
  { js: "(() => { const s = document.querySelector('#preview summary'); return [s?.querySelector('[data-color=\"blue\"]')?.textContent, s?.querySelector('[data-color=\"red\"]')?.textContent, !!s?.querySelector('.critic-comment')]; })()", log: true, wait: 100 },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
const { js, log } = await runApp(w, steps, {}, 90000);
console.log('\ntoggle titles: colour and comments, ui');
assert.equal(js.length, 7, log.slice(-1500));
const [shown, threads, selected, coloured, resolved, read, errors] = js;
assert.deepEqual(errors, [], 'no renderer errors');
assert.deepEqual(shown, { toggle: true, color: 'red:urgent', hl: 'check', comment: true, raw: false });
console.log('  ✓ the Write view shows colour, highlight and comment in a toggle title, and the toggle stays editable');
assert.deepEqual(threads, ['check | why?']); console.log('  ✓ the review pane lists the comment on the title');
assert.equal(selected, true);
assert.equal(coloured, SRC.replace('<summary>Plan ', '<summary>[Plan]{color=blue} '), 'only the title changes, and only by the new colour');
console.log('  ✓ the colour menu colours title text; the rest of the file is unchanged');
assert.match(resolved, /<summary>\[Plan\]\{color=blue\} \[urgent\]\{color=red\} \{==check==\}\{>>Ann, 2026-11-20 10:00: why\?<<\}\{>>Tester, [^<]*: \[resolved\]<<\}<\/summary>\n\nBody line\n\n<\/details>\n\nAfter\.\n$/);
console.log('  ✓ resolving the title comment writes its reply into the title');
assert.deepEqual(read, ['Plan', 'urgent', true]); console.log('  ✓ the Read view draws the saved title with its colours and comment');
