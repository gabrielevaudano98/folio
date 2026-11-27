// MCP gating: without the app or without write permission, the matching tools are not offered at all; the server
// advertises the same version as package.json; every slide tool has a handler.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer, TOOLS, SERVER_INFO } from '../src/main/mcp-tools.js';
import { SLIDE_TOOLS } from '../src/main/mcp-slides.js';
import { lockedTarget } from '../src/main/locks.js';

let n = 0; const ok = (m) => { n++; console.log('  ✓', m); };
console.log('\nmcp gating');
const names = async (caps) => {
  const server = buildServer({ capabilities: () => caps, call: async () => 'x' });
  const [a, b] = InMemoryTransport.createLinkedPair(); const client = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const list = (await client.listTools()).tools.map((t) => t.name); await client.close(); return list.sort();
};
const all = await names({ app: true, write: true });
const readOnly = await names({ app: true, write: false });
const noApp = await names({ app: false, write: true });
assert.equal(all.length, TOOLS.length);
assert.deepEqual(readOnly, TOOLS.filter((t) => !t.write).map((t) => t.name).sort());
assert(readOnly.length > 0 && readOnly.length < all.length);
for (const t of TOOLS.filter((x) => x.write)) assert(!readOnly.includes(t.name), `${t.name} is offered without write permission`);
ok('read-only access offers no tool that writes');
assert.deepEqual(noApp, TOOLS.filter((t) => !t.appOnly).map((t) => t.name).sort());
for (const t of TOOLS.filter((x) => x.appOnly)) assert(!noApp.includes(t.name), `${t.name} is offered without the app`);
ok('without the app open, the app-only tools are not offered');

assert.equal(SERVER_INFO.version, JSON.parse(fs.readFileSync('package.json', 'utf8')).version);
ok('the server reports the version in package.json');

assert(SLIDE_TOOLS.length > 0 && SLIDE_TOOLS.every((t) => TOOLS.includes(t)), 'every slide tool is registered');
const dup = TOOLS.map((t) => t.name).filter((x, i, arr) => arr.indexOf(x) !== i);
assert.deepEqual(dup, [], 'tool names are unique');
ok('slide tools are registered and tool names are unique');
const locks = { '/ws/a': { 'pages/x.md': true }, 'pages/y.md': true };
assert.equal(lockedTarget(locks, '/ws/a', 'pages/x.md'), 'pages/x.md');
assert.equal(lockedTarget(locks, '/ws/a', 'pages'), 'pages/x.md', 'moving a folder that holds a locked page is refused');
assert.equal(lockedTarget(locks, '/ws/a', 'pages/x.md.bak'), null);
assert.equal(lockedTarget(locks, '/ws/b', 'pages/x.md'), null, 'a lock in one folder does not lock the same path in another');
assert.equal(lockedTarget(locks, '/ws/a', 'pages/y.md'), null, 'an old flat entry locks nothing');
assert.equal(lockedTarget(locks, '/ws/a', null), null);
ok('locked pages are kept per workspace folder and refuse MCP writes to the page or its folder');
console.log(`\n${n} mcp gating checks passed`);
