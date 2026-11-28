// Per-change review (#18) in the real window: an assistant edits two places; rejecting one writes the old lines back,
// accepting the other leaves nothing to review.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { workspace, runApp, open, errors } from './harness.mjs';

const w = workspace('ai-review', 47626);
fs.writeFileSync(`${w.ws}/Review.md`, '# Review\n\nOne first.\n\n' + Array.from({ length: 12 }, (_, i) => `Filler ${i}.`).join('\n\n') + '\n\nTwo last.\n');
// the assistant edits from outside the window, like a real MCP client (the page's own fetch would carry the wrong Origin)
const edit = async () => {
  const token = JSON.parse(fs.readFileSync(`${w.ud}/mcp-bridge.json`, 'utf8')).token;
  const res = await fetch('http://127.0.0.1:47626/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + token },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'edit_note', arguments: { path: 'Review.md', edits: [{ oldText: 'One first.', newText: 'One changed.' }, { oldText: 'Two last.', newText: 'Two changed.' }] } } }) });
  return res.status + ' ' + (await res.text()).slice(0, 300);
};
// retry until the app's MCP server answers (a slow start must not lose the edit); the edit itself succeeds only once
const tryEdit = async (n = 0) => { try { const r = await edit(); if (r.includes('Edited')) return; } catch { /* not listening yet */ } if (n < 20) setTimeout(() => tryEdit(n + 1), 700); };
setTimeout(() => tryEdit(), 2500);
const r = await runApp(w, [{ size: [1300, 900], wait: 1200 }, open('Review.md'),
  { js: '1', wait: 4000 },
  { js: "document.querySelector('#ai-banner-review').click();1", wait: 600 },
  { js: "document.querySelectorAll('#sheet-diff .diff-hunk').length", log: true, wait: 100 },
  { js: "document.querySelector('#sheet-diff [data-hunk-act=reject]').click();1", wait: 1200 },
  { js: "document.querySelectorAll('#sheet-diff .diff-hunk').length", log: true, wait: 100 },
  { js: "document.querySelector('#sheet-diff [data-hunk-act=accept]').click();1", wait: 1200 },
  { js: "[document.querySelector('#sheet-diff').open, document.querySelector('#ai-banner').hidden]", log: true, wait: 100 },
  errors]);
console.log('\nper-change review');
const [n1, n2, closed, errs] = r.js;
assert.equal(n1, 2, r.log.slice(-1500)); assert.equal(n2, 1); assert.deepEqual(closed, [false, true]); assert.deepEqual(errs, []);
const got = w.read('Review.md');
assert.ok(got.includes('One first.') && got.includes('Two changed.'), got);
console.log('  ✓ reject restores one change on disk, accept settles the other, the review closes');
