// Folio — chat mode: provider wire formats against a fake server, the permission policy, the key store, conversations on
// disk and the agent loop. No network and no Electron.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createProvider, checkEndpoint, ProviderError } from '../src/main/chat/providers.js';
import { classify } from '../src/main/chat/policy.js';
import { createKeyStore } from '../src/main/chat/keystore.js';
import { createChatStore } from '../src/main/chat/store.js';
import { createAgent, fitContext, repair } from '../src/main/chat/agent.js';
import { runChatTool } from '../src/main/chat/chat-tools.js';

console.log('\nchat mode');
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'folio-chat-'));

/* ---------- providers against a fake server ---------- */
const seen = [];
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const b = body ? JSON.parse(body) : {}; seen.push({ url: req.url, headers: req.headers, body: b });
    const send = (events) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`); res.end(); };
    if (req.url === '/bad') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'invalid x-api-key' } })); }
    if (req.url.startsWith('/v1/messages')) return send([
      { type: 'message_start', message: { usage: { input_tokens: 7 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'read_note' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":' } }, { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"a.md"}' } },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } }]);
    if (req.url.startsWith('/oa/chat/completions')) return send([
      { choices: [{ delta: { content: 'Hi' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_note', arguments: '{"pa' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.md"}' } }] }, finish_reason: 'tool_calls' }] }, { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } }]);
    if (req.url.startsWith('/v1beta/models/')) return send([{ candidates: [{ content: { parts: [{ text: 'Yo' }] } }] }, { candidates: [{ content: { parts: [{ functionCall: { name: 'read_note', args: { path: 'a.md' } } }] } }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1 } }]);
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const tools = [{ name: 'read_note', description: 'Read', schema: { type: 'object', $schema: 'x', additionalProperties: false, properties: { path: { type: 'string', description: 'p' }, n: { type: 'integer', exclusiveMinimum: 0 } }, required: ['path'] } }];
const history = [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a', toolCalls: [{ id: 't', name: 'read_note', args: { path: 'x.md' } }] }, { role: 'tool', results: [{ id: 't', name: 'read_note', text: 'body', isError: false }] }];
{
  const deltas = []; const p = createProvider({ provider: 'anthropic', key: 'sk-ant-SECRET', model: 'm', baseUrl: base });
  const r = await p.stream({ system: 'sys', messages: history, tools, onText: (d) => deltas.push(d) });
  assert.equal(r.text, 'Hello'); assert.deepEqual(deltas, ['Hel', 'lo']); assert.equal(r.stop, 'tools');
  assert.deepEqual(r.toolCalls, [{ id: 'tu1', name: 'read_note', args: { path: 'a.md' } }]); assert.deepEqual(r.usage, { input: 7, output: 5 });
  const s = seen.at(-1); assert.equal(s.headers['x-api-key'], 'sk-ant-SECRET'); assert.equal(s.body.system, 'sys');
  assert.equal(s.body.messages[2].content[0].type, 'tool_result'); assert.equal(s.body.messages[1].content[1].type, 'tool_use'); assert.deepEqual(s.body.tools[0].input_schema, tools[0].schema);
  console.log('  ✓ Anthropic: streamed text, tool call assembled from partial JSON, wire format of tool turns');
}
{
  const p = createProvider({ provider: 'openai', key: 'sk-O', model: 'm', baseUrl: base + '/oa' });
  const r = await p.stream({ system: 'sys', messages: history, tools });
  assert.equal(r.text, 'Hi'); assert.equal(r.stop, 'tools'); assert.deepEqual(r.toolCalls, [{ id: 'c1', name: 'read_note', args: { path: 'a.md' } }]); assert.deepEqual(r.usage, { input: 3, output: 2 });
  const s = seen.at(-1); assert.equal(s.headers.authorization, 'Bearer sk-O'); assert.equal(s.body.messages[0].role, 'system'); assert.equal(s.body.messages[3].role, 'tool'); assert.equal(s.body.messages[2].tool_calls[0].function.arguments, '{"path":"x.md"}');
  console.log('  ✓ OpenAI-compatible: streamed tool-call fragments, tool messages');
}
{
  const p = createProvider({ provider: 'google', key: 'g-key', model: 'gem', baseUrl: base });
  const r = await p.stream({ system: 'sys', messages: history, tools });
  assert.equal(r.text, 'Yo'); assert.deepEqual(r.toolCalls, [{ id: 'call_0', name: 'read_note', args: { path: 'a.md' } }]); assert.equal(r.stop, 'tools');
  const s = seen.at(-1); assert.equal(s.headers['x-goog-api-key'], 'g-key'); assert.ok(!s.url.includes('g-key'), 'the key is a header, never in the address');
  const decl = s.body.tools[0].functionDeclarations[0].parameters; assert.equal(decl.$schema, undefined); assert.equal(decl.additionalProperties, undefined); assert.equal(decl.properties.n.exclusiveMinimum, undefined);
  assert.equal(s.body.contents[2].parts[0].functionResponse.name, 'read_note');
  console.log('  ✓ Google: functionCall parts, schema reduced to the supported subset, key in a header');
}
{
  const p = createProvider({ provider: 'anthropic', key: 'sk-ant-SECRET', model: 'm', baseUrl: base + '/bad/x' });
  const e = await p.stream({ system: '', messages: history, tools }).catch((x) => x);
  const q = createProvider({ provider: 'openai', key: 'sk-SECRET2', model: 'm', baseUrl: base + '/bad/x' });
  assert.ok(e instanceof ProviderError); const e2 = await q.stream({ system: '', messages: [], tools: [] }).catch((x) => x);
  for (const x of [e, e2]) assert.ok(!/SECRET/.test(x.message), 'an error never contains the key');
  assert.match(e2.message, /key was refused|HTTP 404/);
  assert.throws(() => createProvider({ provider: 'anthropic', key: '', model: 'm' }), /API key/);
  assert.throws(() => createProvider({ provider: 'anthropic', key: 'k', model: '' }), /model/);
  assert.equal(createProvider({ provider: 'openai', key: '', model: 'llama', baseUrl: 'http://localhost:11434/v1' }) != null, true, 'a local model needs no key');
  assert.equal(checkEndpoint('http://localhost:11434/v1/'), 'http://localhost:11434/v1'); assert.equal(checkEndpoint('https://openrouter.ai/api/v1'), 'https://openrouter.ai/api/v1');
  for (const bad of ['http://example.com/v1', 'ftp://x', 'nope', 'https://u:p@x.com']) assert.throws(() => checkEndpoint(bad), ProviderError, bad);
  console.log('  ✓ errors are friendly and never contain the key; endpoints must be https or local');
}
server.close();

/* ---------- policy ---------- */
{
  const ctx = (o = {}) => ({ allowWrite: true, exists: async (p) => p === 'old.md', moves: 0, allowOverwrites: false, ...o });
  const T = (name, o = {}) => ({ name, write: true, annotations: {}, ...o });
  assert.equal((await classify({ name: 'read_note', write: false }, {}, ctx({ allowWrite: false }))).decision, 'auto');
  assert.equal((await classify(T('edit_note'), { path: 'a.md' }, ctx({ allowWrite: false }))).decision, 'deny');
  assert.equal((await classify(T('create_note'), {}, ctx())).decision, 'auto');
  assert.equal((await classify(T('write_note'), { path: 'new.md' }, ctx())).decision, 'auto');
  assert.equal((await classify(T('write_note'), { path: 'old.md' }, ctx())).decision, 'ask');
  assert.equal((await classify(T('write_note'), { path: 'old.md' }, ctx({ allowOverwrites: true }))).decision, 'auto');
  assert.equal((await classify(T('replace_section'), { path: 'old.md' }, ctx())).decision, 'ask');
  const del = await classify(T('delete_path'), { path: 'x' }, ctx({ allowOverwrites: true })); assert.equal(del.decision, 'ask'); assert.equal(del.remember, false, 'a delete is asked every time');
  assert.equal((await classify(T('move_note'), {}, ctx({ moves: 1 }))).decision, 'auto'); assert.equal((await classify(T('move_note'), {}, ctx({ moves: 2 }))).decision, 'ask');
  console.log('  ✓ policy: reads and small edits go through, overwrites and deletes ask, read-only denies');
}

/* ---------- key store ---------- */
{
  const fake = (ok = true, backend = 'gnome_libsecret') => ({ isEncryptionAvailable: () => ok, getSelectedStorageBackend: () => backend, encryptString: (s) => Buffer.from('enc:' + s.split('').reverse().join('')), decryptString: (b) => b.toString().slice(4).split('').reverse().join('') });
  const file = path.join(tmp, 'keys', 'ai-keys.json');
  const ks = createKeyStore({ file: () => file, safeStorage: fake() });
  await ks.set('anthropic', '  sk-ant-abcdef1234 ');
  const raw = await fs.readFile(file, 'utf8'); assert.ok(!raw.includes('abcdef1234') || raw.includes('"last4"'), 'only the last four characters are readable'); assert.ok(!raw.includes('sk-ant'), 'the key is not in the file as text');
  assert.equal(await ks.get('anthropic'), 'sk-ant-abcdef1234'); assert.deepEqual(await ks.status(), { anthropic: { has: true, last4: '1234' } });
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  await ks.remove('anthropic'); assert.equal(await ks.get('anthropic'), null);
  await assert.rejects(createKeyStore({ file: () => file, safeStorage: fake(false) }).set('openai', 'k'), /secure place/);
  await assert.rejects(createKeyStore({ file: () => file, safeStorage: fake(true, 'basic_text') }).set('openai', 'k'), /secure place/);
  await assert.rejects(ks.set('openai', 'two words'), /does not look/);
  console.log('  ✓ keys: encrypted, owner-only, last four shown, refused without a keychain (no plain text)');
}

/* ---------- conversations ---------- */
{
  const root = path.join(tmp, 'ws'); await fs.mkdir(root);
  const st = createChatStore(() => root);
  const c = st.create(); assert.equal(await st.list().then((l) => l.length), 0);
  c.messages.push({ role: 'user', text: 'Plan the launch of the new site' }, { role: 'assistant', text: 'ok', toolCalls: [] });
  await st.save(c);
  const back = await st.load(c.id); assert.deepEqual(back.messages, c.messages); assert.equal(back.title, 'Plan the launch of the new site');
  assert.equal((await st.list())[0].id, c.id);
  assert.ok((await fs.readdir(path.join(root, '.folio', 'chat'))).every((n) => !n.startsWith('.') || n.endsWith('.json')), 'no temp file is left');
  await assert.rejects(st.load('../../etc/passwd').then((x) => { if (x === null) throw new Error('none'); }), /none|Bad/);
  await st.remove(c.id); assert.equal(await st.load(c.id), null);
  console.log('  ✓ conversations round-trip through .folio/chat, bad ids refused');
}

/* ---------- context and repair ---------- */
{
  const big = (n) => ({ role: 'tool', results: [{ id: String(n), name: 'x', text: 'z'.repeat(1000), isError: false }] });
  const msgs = [{ role: 'user', text: 'hi' }, big(1), big(2), big(3)];
  const fit = fitContext(msgs, 1500);
  assert.match(fit[1].results[0].text, /removed/); assert.equal(fit[3].results[0].text.length, 1000, 'the newest result stays'); assert.equal(msgs[1].results[0].text.length, 1000, 'the stored conversation is not changed');
  const c = { messages: [{ role: 'assistant', text: '', toolCalls: [{ id: 'a', name: 'x' }] }] }; repair(c); assert.equal(c.messages.at(-1).role, 'tool');
  console.log('  ✓ old tool results are dropped from the context only, an unanswered tool call is closed');
}

/* ---------- agent loop ---------- */
{
  const script = (turns) => { let i = 0; return () => ({ async stream({ onText, signal }) { const t = turns[i++]; if (typeof t === 'function') return t({ signal }); if (t.text) onText(t.text); return { text: t.text || '', toolCalls: t.calls || [], stop: t.calls?.length ? 'tools' : 'end', usage: { input: 1, output: 1 } }; } }); };
  const mk = (turns, o = {}) => {
    const events = [], ran = [], asked = [];
    const agent = createAgent({
      provider: script(turns), tools: [{ name: 'read_note', write: false }, { name: 'edit_note', write: true, annotations: {} }, { name: 'write_note', write: true, annotations: { destructiveHint: true } }, { name: 'delete_path', write: true, annotations: { destructiveHint: true } }],
      runTool: async (n, a) => { ran.push([n, a]); if (a.path?.startsWith('..')) throw new Error(`Path escapes the workspace: ${a.path}`); return `ok ${n}`; },
      classify, ask: async (req) => { asked.push(req); return (o.answers || []).shift() || 'deny'; }, emit: (e) => events.push(e), save: async () => {},
      allowWrite: () => o.allowWrite !== false, exists: async (p) => p === 'old.md',
    });
    return { agent, events, ran, asked };
  };
  const conv = () => ({ id: 'x', messages: [], grants: {} });
  let h = mk([{ calls: [{ id: '1', name: 'read_note', args: { path: 'a.md' } }] }, { text: 'Done' }]); let c = conv();
  await h.agent.run(c, 'go', { system: 's' });
  assert.deepEqual(h.ran, [['read_note', { path: 'a.md' }]]); assert.equal(h.events.at(-1).type, 'done'); assert.deepEqual(c.messages.map((m) => m.role), ['user', 'assistant', 'tool', 'assistant']);
  assert.equal(h.asked.length, 0); console.log('  ✓ agent: a read runs, the result goes back to the model, the turn ends with the answer');

  h = mk([{ calls: [{ id: '1', name: 'delete_path', args: { path: 'a.md' } }] }, { text: 'ok' }], { answers: ['deny'] }); c = conv();
  await h.agent.run(c, 'go', { system: 's' });
  assert.equal(h.ran.length, 0, 'declined: nothing ran'); assert.equal(h.asked[0].remember, false); assert.match(c.messages[2].results[0].text, /declined/); assert.equal(c.messages[2].results[0].isError, true);
  h = mk([{ calls: [{ id: '1', name: 'delete_path', args: { path: 'a.md' } }] }, { text: 'ok' }], { answers: ['once'] });
  await h.agent.run(conv(), 'go', { system: 's' }); assert.equal(h.ran.length, 1);
  console.log('  ✓ agent: a delete waits for approval; declining runs nothing and tells the model');

  h = mk([{ calls: [{ id: '1', name: 'write_note', args: { path: 'old.md' } }] }, { calls: [{ id: '2', name: 'write_note', args: { path: 'old.md' } }] }, { text: 'ok' }], { answers: ['chat'] }); c = conv();
  await h.agent.run(c, 'go', { system: 's' }); assert.equal(h.asked.length, 1, 'allowed for the chat: asked once'); assert.equal(h.ran.length, 2); assert.equal(c.grants.overwrites, true);
  h = mk([{ calls: [{ id: '1', name: 'delete_path', args: { path: 'a' } }] }, { calls: [{ id: '2', name: 'delete_path', args: { path: 'b' } }] }, { text: 'ok' }], { answers: ['chat', 'once'] });
  await h.agent.run(conv(), 'go', { system: 's' }); assert.equal(h.asked.length, 2, 'deletes are asked every time, even after "allow for this chat"');
  console.log('  ✓ agent: "allow overwrites in this chat" holds for overwrites only, never for deletes');

  h = mk([{ calls: [{ id: '1', name: 'edit_note', args: { path: 'a.md' } }] }, { text: 'ok' }], { allowWrite: false }); c = conv();
  await h.agent.run(c, 'go', { system: 's' }); assert.equal(h.ran.length, 0); assert.match(c.messages[2].results[0].text, /read-only/);
  h = mk([{ calls: [{ id: '1', name: 'edit_note', args: { path: '../secret.md' } }] }, { text: 'ok' }]); c = conv();
  await h.agent.run(c, 'go', { system: 's' }); assert.match(c.messages[2].results[0].text, /escapes the workspace/); assert.equal(h.asked.length, 0);
  h = mk([{ calls: [{ id: '1', name: 'nope', args: {} }, { id: '2', name: 'read_note', args: { _unparsed: '{' } }] }, { text: 'ok' }]); c = conv();
  await h.agent.run(c, 'go', { system: 's' }); assert.equal(c.messages[2].results.length, 2); assert.equal(h.ran.length, 0);
  console.log('  ✓ agent: read-only mode denies writes; a path outside the folder fails inside the tool; bad calls are answered');

  const forever = Array.from({ length: 30 }, (_, i) => ({ calls: [{ id: String(i), name: 'read_note', args: { path: 'a' } }] }));
  h = mk(forever); await h.agent.run(conv(), 'go', { system: 's' }); assert.equal(h.ran.length, 24); assert.ok(h.events.some((e) => e.type === 'notice' && /24 steps/.test(e.message)));
  const ac = new AbortController();
  h = mk([({ signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))]); c = conv();
  const run = h.agent.run(c, 'go', { system: 's', signal: ac.signal }); setTimeout(() => ac.abort(), 20); await run;
  assert.ok(h.events.some((e) => e.type === 'done' && e.stopped)); assert.ok(!h.events.some((e) => e.type === 'error'));
  const ac2 = new AbortController();
  const hh = (() => { const events = []; const agent = createAgent({ provider: script([{ calls: [{ id: '1', name: 'delete_path', args: { path: 'a' } }] }]), tools: [{ name: 'delete_path', write: true, annotations: {} }], runTool: async () => 'x', classify, ask: () => new Promise(() => {}), emit: (e) => events.push(e), save: async () => {}, allowWrite: () => true, exists: async () => true }); return { agent, events }; })();
  const cc = conv(); const r2 = hh.agent.run(cc, 'go', { system: 's', signal: ac2.signal }); setTimeout(() => ac2.abort(), 20); await r2;
  assert.equal(cc.messages.at(-1).role, 'tool'); assert.ok(hh.events.some((e) => e.type === 'done'));
  console.log('  ✓ agent: step cap, stop button, stop while an approval is open');

  // chat-only tools
  const log = []; assert.equal(await runChatTool('create_folder', { path: 'a/b' }, { mkdir: async (p) => log.push(['mkdir', p]) }), 'Created folder a/b');
  await runChatTool('delete_path', { path: 'a' }, { trash: async (p) => { log.push(['trash', p]); return { token: 't1' }; }, onTrashed: (p, t) => log.push(['tok', t]) }); assert.deepEqual(log, [['mkdir', 'a/b'], ['trash', 'a'], ['tok', 't1']]);
  console.log('  ✓ chat-only tools call the injected folder and trash functions');
}
await fs.rm(tmp, { recursive: true, force: true });
console.log('chat mode: all passed');
