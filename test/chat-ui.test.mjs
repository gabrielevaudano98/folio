// Folio — chat mode in the real app, against a fake OpenAI-compatible server: switch to Chat, ask for a note, see the step,
// the note on disk, the live AI-edit path, an approval card for a delete (declined: the note stays), and the minimised layout.
import http from 'node:http';
import assert from 'node:assert/strict';
import { workspace, runApp, errors, log } from './harness.mjs';

console.log('\nchat mode (in the app)');
const w = workspace('chat', 47611);
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const msgs = JSON.parse(body).messages; const last = msgs[msgs.length - 1];
    const send = (events) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`); res.end(); };
    const call = (name, args) => send([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c' + msgs.length, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] }]);
    if (last.role === 'tool') return send([{ choices: [{ delta: { content: 'All **done**.' }, finish_reason: 'stop' }] }]);
    if (/create/.test(last.content)) return call('create_note', { path: 'Plan.md', content: '# Plan\n\nStart here.\n' });
    if (/delete/.test(last.content)) return call('delete_path', { path: 'Plan.md', reason: 'You asked' });
    send([{ choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop' }] }]);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const ask = (text) => ({ js: `(()=>{const i=document.querySelector('#chat-input');i.value=${JSON.stringify(text)};document.querySelector('#chat-form').requestSubmit();return 1})()`, wait: 2500 });
const r = await runApp(w, [
  { size: [1300, 860], wait: 1200 },
  { js: `folio.chat.config({provider:'openai',model:'fake',openaiBase:'http://127.0.0.1:${port}/v1'}).then(()=>1)`, wait: 300 },
  { js: "document.querySelector('[data-set-mode=chat]').click();1", wait: 1200 },
  log("({mode:document.querySelector('#app').dataset.appMode,layout:document.querySelector('#app').dataset.chatLayout,visible:!document.querySelector('#chat').hidden,w:Math.round(document.querySelector('#chat').getBoundingClientRect().width),checked:document.querySelector('[data-set-mode=chat]').getAttribute('aria-checked'),empty:!!document.querySelector('.chat-empty'),input:!document.querySelector('#chat-input').disabled})"),
  ask('please create a plan note'),
  log("({steps:[...document.querySelectorAll('.chat-step')].map(s=>[s.dataset.status,s.querySelector('.chat-step-line').textContent.replace(/^[^:]*: /,'')]),ai:document.querySelector('.chat-ai')?.textContent.trim(),busy:document.querySelector('#chat').dataset.busy})"),
  log("folio.read('Plan.md')"),
  ask('now delete it'),
  log("({card:!!document.querySelector('.chat-approve'),title:document.querySelector('.chat-approve-title')?.textContent,target:document.querySelector('.chat-approve-target')?.textContent,btns:[...document.querySelectorAll('.chat-approve [data-answer]')].map(b=>b.dataset.answer),focus:document.activeElement?.dataset?.answer,status:document.querySelector('.chat-step[data-status=waiting]')?.dataset.status})"),
  { js: "document.querySelector('.chat-approve [data-answer=deny]').click();1", wait: 2500 },
  log("({card:!!document.querySelector('.chat-approve'),steps:[...document.querySelectorAll('.chat-step')].map(s=>s.dataset.status),busy:document.querySelector('#chat').dataset.busy})"),
  log("folio.read('Plan.md').then(()=>'still there',()=>'gone')"),
  { js: "document.querySelector('#chat-layout').click();1", wait: 900 },
  log("({layout:document.querySelector('#app').dataset.chatLayout,w:Math.round(document.querySelector('#chat').getBoundingClientRect().width),right:Math.round(document.querySelector('#workspace').getBoundingClientRect().right-document.querySelector('#chat').getBoundingClientRect().left)})"),
  log("folio.chat.state().then(s=>({convs:s.conversations.length}))"),
  errors,
], {}, 120000);
server.close();
const j = r.js; const at = (i) => j[i];
assert.deepEqual(at(0), { mode: 'chat', layout: 'full', visible: true, w: at(0).w, checked: 'true', empty: true, input: true }); assert.ok(at(0).w > 900, 'full layout fills the window');
assert.deepEqual(at(1).steps, [['done', 'create note Plan.md']]); assert.equal(at(1).ai, 'All done.'); assert.equal(at(1).busy, 'false');
assert.match(at(2), /Start here/);
assert.equal(at(3).card, true); assert.equal(at(3).title, 'Move to the Trash'); assert.equal(at(3).target, 'Plan.md'); assert.deepEqual(at(3).btns, ['once', 'deny']); assert.equal(at(3).focus, 'once');
assert.equal(at(4).card, false); assert.ok(at(4).steps.includes('denied')); assert.equal(at(4).busy, 'false'); assert.equal(at(5), 'still there');
assert.equal(at(6).layout, 'dock'); assert.ok(at(6).w >= 370 && at(6).w <= 390, 'minimised: a side panel'); assert.ok(Math.abs(at(6).right - at(6).w) <= 2, 'the editor area ends where the chat begins');
assert.equal(at(7).convs, 1); assert.deepEqual(at(8), [], 'no errors in the window');
console.log('  ✓ switch to Chat, create a note from the chat, delete asks and declining keeps it, minimise to a side panel');
console.log('chat mode (in the app): all passed');
