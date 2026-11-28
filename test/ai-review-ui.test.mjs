// Per-change review (#18) in the real window, on a note with CRLF line endings: an assistant edits four places.
// Rejecting one writes the old lines back; the reader edits another and accepts the edited text (Mod+Enter); Esc closes
// a change's editor without closing the review; a change made on disk while the review is open redraws it and keeps the
// reader's unsent draft; the last edit lands in version history and the editor's undo takes it back.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { workspace, runApp, open, errors, log, step } from './harness.mjs';

const w = workspace('ai-review', 47626);
// a fixed token written into the test's own settings, so nothing is read back from disk to authorise the request
const TOKEN = 'ai-review-test-token';
fs.writeFileSync(`${w.ud}/settings.json`, JSON.stringify({ workspace: w.ws, openTabs: [], mcpPort: 47626, token: TOKEN }));
const fill = (from, to) => Array.from({ length: to - from }, (_, i) => `Filler ${from + i}.`).join('\r\n\r\n');
const original = '# Review\r\n\r\nOne first.\r\n\r\n' + fill(0, 6) + '\r\n\r\nMid point.\r\n\r\n' + fill(6, 12) + '\r\n\r\nThird here.\r\n\r\n' + fill(12, 18) + '\r\n\r\nTwo last.\r\n';
fs.writeFileSync(`${w.ws}/Review.md`, original);
// the assistant edits from outside the window, like a real MCP client (the page's own fetch would carry the wrong Origin)
const edit = async () => {
  const res = await fetch('http://127.0.0.1:47626/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'edit_note', arguments: { path: 'Review.md', edits: [
      { oldText: 'One first.', newText: 'One changed.' }, { oldText: 'Mid point.', newText: 'Mid changed.' },
      { oldText: 'Third here.', newText: 'Third changed.' }, { oldText: 'Two last.', newText: 'Two changed.' }] } } }) });
  return res.status + ' ' + (await res.text()).slice(0, 300);
};
// retry until the app's MCP server answers (a slow start must not lose the edit); the edit itself succeeds only once
const tryEdit = async (n = 0) => { try { const r = await edit(); if (r.includes('Edited')) return; } catch { /* not listening yet */ } if (n < 20) setTimeout(() => tryEdit(n + 1), 700); };
setTimeout(() => tryEdit(), 2500);

const D = '#sheet-diff';
const hunkCount = log(`document.querySelectorAll('${D} .diff-hunk').length`);
const key = (k, ctrl = false) => step(`const t=document.querySelector('${D} .diff-hunk-edit textarea');t.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},ctrlKey:${ctrl},bubbles:true,cancelable:true}))`, 1200);
// at that step the window writes a marker note; the test then changes a filler line of Review.md from outside Folio
// (the watcher reloads the clean tab while the review is open)
const outside = step(`folio.write('outside-marker.md','go')`, 50);
const marker = path.join(w.ws, 'outside-marker.md');
const poll = setInterval(() => {
  if (!fs.existsSync(marker)) return;
  clearInterval(poll);
  fs.writeFileSync(`${w.ws}/Review.md`, w.read('Review.md').replace('Filler 7.', 'Filler 7 outside.'));
}, 40);
const r = await runApp(w, [{ size: [1300, 900], wait: 1200 }, open('Review.md'),
  { js: '1', wait: 4000 },
  step(`document.querySelector('#ai-banner-review').click()`, 600),
  hunkCount,
  // 1. reject the first change
  step(`document.querySelector('${D} [data-hunk-act=reject]').click()`, 1200),
  hunkCount,
  // 2. edit the next one ("Mid changed.") and accept the edited text with Mod+Enter
  step(`document.querySelector('${D} [data-hunk-act=edit-open]').click()`, 300),
  log(`(()=>{const t=document.querySelector('${D} .diff-hunk-edit textarea');return [t.value, document.activeElement===t, document.querySelector('${D} [data-hunk-act=edit-open]').getAttribute('aria-expanded'), t.getAttribute('aria-label')]})()`),
  step(`document.querySelector('${D} .diff-hunk-edit textarea').value='Mid by me.\\nAnd a second line.'`, 50),
  key('Enter', true),
  hunkCount,
  // 3. Esc in a change's editor closes that editor only, and focus goes back to its Edit button
  step(`document.querySelector('${D} [data-hunk-act=edit-open]').click()`, 300),
  key('Escape'),
  log(`[document.querySelector('${D}').open, !!document.querySelector('${D} .diff-hunk-edit'), document.activeElement?.dataset.hunkAct]`),
  // 4. start a draft on the last change ("Two changed."), then a change lands on disk: the review is redrawn and the draft survives
  step(`[...document.querySelectorAll('${D} [data-hunk-act=edit-open]')].at(-1).click()`, 300),
  step(`document.querySelector('${D} .diff-hunk-edit textarea').value='Two mine.'`, 50),
  outside, { js: '1', wait: 3500 },
  log(`[document.querySelectorAll('${D} .diff-hunk').length, document.querySelector('${D} .diff-hunk-edit textarea')?.value, [...document.querySelectorAll('${D} .diff-line.add .t')].map(e=>e.textContent).join('|')]`),
  // 5. accept the other pending changes, then the edited draft: nothing is left to review
  step(`document.querySelector('${D} .diff-hunk:not(:has(.diff-hunk-edit)) [data-hunk-act=accept]').click()`, 1200),
  step(`document.querySelector('${D} .diff-hunk:not(:has(.diff-hunk-edit)) [data-hunk-act=accept]').click()`, 1200),
  hunkCount,
  step(`document.querySelector('${D} [data-hunk-act=edit]').click()`, 1500),
  log(`[document.querySelector('${D}').open, document.querySelector('#ai-banner').hidden]`),
  // 6. undo in the editor takes the last edit back (the text returns to the assistant's proposal)
  step(`window.__folioRun('undo')`, 3500),
  errors]);
clearInterval(poll);
console.log('\nper-change review');
const js = r.js;
const fail = r.log.slice(-2500);
assert.equal(js[0], 4, fail);
assert.equal(js[1], 3, fail);
const [draft, focused, expanded, label] = js[2];
assert.equal(draft, 'Mid changed.', 'the editor starts from the proposed text, without its line ending');
assert.ok(focused, 'the editor takes focus'); assert.equal(expanded, 'true'); assert.equal(label, 'Proposed text of change 1');
assert.equal(js[3], 2, fail);
assert.deepEqual(js[4], [true, false, 'edit-open'], 'Esc closes the change editor, not the review');
console.log('  ✓ reject, then edit and accept with Mod+Enter; Esc closes only the editor');
const [nAfterDisk, keptDraft, adds] = js[5];
assert.equal(keptDraft, 'Two mine.', 'the draft survives the redraw');
assert.ok(nAfterDisk >= 2 && adds.includes('Filler 7 outside.'), `the review shows the text as it is now: ${nAfterDisk} ${adds}`);
assert.equal(js[6], 1, fail);
assert.deepEqual(js[7], [false, true]);
const got = w.read("Review.md");
// every line ending is still CRLF; each change is settled as the reader chose
assert.ok(!/(^|[^\r])\n/.test(got), 'no bare LF: ' + JSON.stringify(got.slice(0, 200)));
assert.ok(got.includes('One first.\r\n'), 'rejected change is back');
assert.ok(got.includes('Mid by me.\r\nAnd a second line.\r\n'), 'edited change written exactly, CRLF kept');
assert.ok(got.includes('Third changed.\r\n') && got.includes('Filler 7 outside.\r\n'), 'accepted changes stay');
console.log('  ✓ a change on disk redraws the review and keeps the draft; the file keeps CRLF and holds exactly the chosen text');
// version history keeps the edited text (the undo after it is autosaved later, so look for the edit among the versions)
const hist = path.join(w.ws, '.folio', 'history', 'files');
const sha = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
const ids = fs.readdirSync(hist).flatMap((f) => JSON.parse(fs.readFileSync(path.join(hist, f), 'utf8')).versions.map((v) => v.id));
const editedText = original.replace('Mid point.', 'Mid by me.\r\nAnd a second line.').replace('Third here.', 'Third changed.').replace('Filler 7.', 'Filler 7 outside.').replace('Two last.', 'Two mine.');
assert.ok(ids.includes(sha(editedText)), 'the accepted edit is a version in history');
assert.equal(got, editedText.replace('Two mine.', 'Two changed.'), 'undo takes back exactly the last edit, and the page editor keeps CRLF');
assert.deepEqual(js.at(-1), []);
console.log('  ✓ the edit is kept in version history and undo takes it back');
