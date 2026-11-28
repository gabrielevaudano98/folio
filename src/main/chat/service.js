// Folio — chat mode in the main process: settings, keys, conversations, the agent run and the IPC the window uses.
// The agent calls tools through the same backend as an outside MCP client, so every guard (workspace boundary, locks,
// "Let AI edit notes", version history, the live ai:edit highlight and undo) applies unchanged.
import fs from 'node:fs/promises';
import { z } from 'zod';
import { PROVIDERS, DEFAULT_MODEL, createProvider, checkEndpoint } from './providers.js';
import { createKeyStore } from './keystore.js';
import { createChatStore } from './store.js';
import { createAgent } from './agent.js';
import { classify } from './policy.js';
import { CHAT_TOOLS, runChatTool } from './chat-tools.js';
import { buildSystem } from './prompt.js';
import { assertUnlocked } from '../locks.js';

export const CLIENT = 'Folio chat';

export function createChat({ h, getWin, settings, saveSettings, notes, backend, TOOLS, keyFile, safeStorage, mkdir, trash, guardAsset, askOpenNote, fetchImpl }) {
  settings.chat = { provider: 'anthropic', models: { ...DEFAULT_MODEL }, openaiBase: '', ...(settings.chat || {}) };
  settings.chat.models = { ...DEFAULT_MODEL, ...settings.chat.models };
  const keys = createKeyStore({ file: keyFile, safeStorage });
  const store = createChatStore(() => settings.workspace);
  const send = (convId, ev) => { try { getWin()?.webContents.send('chat:event', { convId, ...ev }); } catch { /* window gone */ } };

  const all = [...TOOLS, ...CHAT_TOOLS];
  const wire = all.map((t) => ({ name: t.name, description: t.description, write: t.write, annotations: t.annotations, schema: (({ $schema, ...s }) => s)(z.toJSONSchema(z.object(t.input || {}))) }));

  const preview = (a) => Object.fromEntries(Object.entries(a || {}).map(([k, v]) => [k, typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v]));
  let cur = null, run = null; const approvals = new Map();
  const isDir = async (p) => { try { return (await fs.stat(notes.resolve(p))).isDirectory(); } catch { return false; } };
  const exists = async (p) => { try { notes.resolve(p); return !!(await notes.read(p).then(() => true, () => false)); } catch { return false; } };

  async function runTool(name, args, callId, opts = {}) {
    if (run?.root !== settings.workspace) throw new Error('The folder changed while the chat was working, so this step was not run.');
    if (opts.create && name === 'write_note') name = 'create_note'; // judged as a new note: never replaces one that appeared meanwhile
    const chatTool = CHAT_TOOLS.find((t) => t.name === name);
    if (!chatTool) return backend.call(name, args, { client: CLIENT });
    if (!settings.workspace) throw new Error('No folder is open in Folio.');
    if (!settings.allowWrite) throw new Error('Folio is set to read-only for AI. Turn on "Let AI edit notes" to let the chat change files.');
    assertUnlocked(chatTool, args, { notes, lockedPages: settings.lockedPages, workspace: settings.workspace });
    guardAsset(args.path);
    return runChatTool(name, args, { mkdir, trash, onTrashed: (rel, token) => send(cur?.id, { type: 'trashed', id: callId, path: rel, token }) });
  }

  const agent = createAgent({
    provider: () => run.provider, tools: wire, runTool, classify,
    ask: (req) => new Promise((resolve) => { approvals.set(req.id, resolve); send(cur.id, { type: 'approval', ...req, args: preview(req.args) }); }),
    emit: (ev) => send(cur?.id, ev), save: (c) => store.save(c),
    allowWrite: () => !!settings.allowWrite, exists, isDir,
  });

  function providerNow(key) {
    const p = settings.chat.provider;
    return createProvider({ provider: p, key, model: settings.chat.models[p], baseUrl: p === 'openai' && settings.chat.openaiBase ? settings.chat.openaiBase : undefined, fetchImpl });
  }
  async function needKey() {
    const p = settings.chat.provider;
    const key = await keys.get(p);
    if (!key && !(p === 'openai' && settings.chat.openaiBase)) throw new Error(`Add your ${PROVIDERS[p].label} API key in Settings → AI.`);
    return key || '';
  }

  const state = async () => ({
    providers: Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => [id, { label: p.label, models: p.models, custom: p.custom }])),
    config: settings.chat, keys: await keys.status(), keychain: keys.available(), allowWrite: !!settings.allowWrite,
    busy: !!run, current: cur ? { id: cur.id, title: cur.title } : null, conversations: settings.workspace ? await store.list() : [],
  });
  h('chat:state', state);
  h('chat:config', async (patch = {}) => {
    const c = settings.chat;
    if (patch.provider !== undefined) { if (!Object.hasOwn(PROVIDERS, patch.provider)) throw new Error('Unknown provider.'); c.provider = patch.provider; }
    if (patch.model !== undefined) c.models[patch.provider || c.provider] = String(patch.model).trim().slice(0, 120);
    if (patch.openaiBase !== undefined) c.openaiBase = patch.openaiBase ? checkEndpoint(patch.openaiBase) : '';
    saveSettings(); return state();
  });
  h('chat:key-set', async (provider, key) => { if (!Object.hasOwn(PROVIDERS, provider)) throw new Error('Unknown provider.'); await keys.set(provider, key); return state(); });
  h('chat:key-remove', async (provider) => { if (!Object.hasOwn(PROVIDERS, provider)) throw new Error('Unknown provider.'); await keys.remove(provider); return state(); });
  h('chat:key-test', async () => {
    const r = await providerNow(await needKey()).stream({ system: 'Reply with the single word: ok', messages: [{ role: 'user', text: 'ping' }], tools: [] });
    return { ok: true, text: r.text.slice(0, 40) };
  });

  const view = (c) => ({ id: c.id, title: c.title, messages: c.messages, grants: c.grants });
  h('chat:new', async () => { if (run) throw new Error('Wait for the answer to finish, or stop it.'); cur = null; return state(); });
  h('chat:open', async (id) => {
    if (run) throw new Error('Wait for the answer to finish, or stop it.');
    const c = await store.load(id); if (!c) throw new Error('That conversation could not be read.');
    cur = c; return view(c);
  });
  h('chat:current', async () => (cur ? view(cur) : null));
  h('chat:delete', async (id) => { if (run && cur?.id === id) throw new Error('Stop the answer first.'); await store.remove(id); if (cur?.id === id) cur = null; return state(); });

  h('chat:send', async (text) => {
    text = String(text || '').trim(); if (!text) throw new Error('Write a message first.');
    if (run) throw new Error('Still answering. Stop it first.');
    if (!settings.workspace) throw new Error('Open a folder first: the chat works on one folder.');
    const ctrl = new AbortController(); run = { ctrl, root: settings.workspace, provider: null }; // reserved before any await, so two sends cannot both start
    let provider; try { provider = providerNow(await needKey()); } catch (e) { run = null; throw e; }
    cur = cur || store.create();
    let system;
    try {
    const [list, open] = await Promise.all([notes.list({ limit: 301 }).catch(() => []), askOpenNote().catch(() => null)]);
    system = buildSystem({
      instructions: String(settings.chatInstructions?.[settings.workspace] || '').slice(0, 4000), folderName: settings.workspace.split(/[\\/]/).pop(),
      files: list.slice(0, 300).map((f) => f.path), more: list.length > 300, open: open?.path || '', today: new Date().toISOString().slice(0, 10), writeAllowed: !!settings.allowWrite,
    });
    } catch (e) { run = null; throw e; }
    const conv = cur; run.provider = provider;
    send(conv.id, { type: 'start', title: conv.title });
    agent.run(conv, text, { system, signal: ctrl.signal }).catch((e) => send(conv.id, { type: 'error', message: e.message })).finally(() => { for (const r of approvals.values()) r('deny'); approvals.clear(); run = null; send(conv.id, { type: 'idle', title: conv.title }); });
    return { id: conv.id };
  });
  h('chat:stop', async () => { run?.ctrl.abort(); for (const r of approvals.values()) r('deny'); approvals.clear(); return true; });
  h('chat:approve', async (id, answer) => { const r = approvals.get(id); if (!r) return false; approvals.delete(id); r(['once', 'chat', 'deny'].includes(answer) ? answer : 'deny'); return true; });

  return { reset() { run?.ctrl.abort(); cur = null; }, state };
}
