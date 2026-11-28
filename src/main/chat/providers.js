// Folio — chat providers. One interface over Anthropic, OpenAI (and compatible endpoints) and Google.
//   provider.stream({ system, messages, tools, signal, onText }) -> { text, toolCalls: [{id,name,args}], stop, usage }
// Messages are neutral: { role:'user', text } | { role:'assistant', text, toolCalls } | { role:'tool', results:[{id,name,text,isError}] }.
// Pure Node (global fetch): tested against a fake server in test/chat-providers.test.mjs. The key is only ever put in a header
// of a request to the provider's own host and never appears in an error message.

export const PROVIDERS = {
  anthropic: { label: 'Anthropic', host: 'https://api.anthropic.com', models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'], custom: false },
  openai: { label: 'OpenAI', host: 'https://api.openai.com/v1', models: [], custom: true },
  google: { label: 'Google', host: 'https://generativelanguage.googleapis.com', models: [], custom: false },
  // OpenAI-compatible services with a fixed address: the same adapter, their own key
  openrouter: { label: 'OpenRouter', host: 'https://openrouter.ai/api/v1', models: [], custom: false, wire: 'openai' },
  xai: { label: 'xAI (Grok)', host: 'https://api.x.ai/v1', models: [], custom: false, wire: 'openai' },
};
export const DEFAULT_MODEL = { anthropic: 'claude-sonnet-5-5', openai: '', google: '', openrouter: '', xai: '' };

export class ProviderError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

/** an endpoint the person typed: https anywhere, http only for this computer (local models) */
export function checkEndpoint(url) {
  let u; try { u = new URL(url); } catch { throw new ProviderError('That address is not a valid URL.'); }
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new ProviderError('Use https, or http only for a model on this computer.');
  if (u.username || u.password) throw new ProviderError('Leave the user name and password out of the address.');
  return u.toString().replace(/\/+$/, '');
}

async function* sse(res, signal) {
  const dec = new TextDecoder(); let buf = '';
  for await (const chunk of res.body) {
    if (signal?.aborted) throw Object.assign(new Error('The request was stopped.'), { name: 'AbortError' });
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
      if (data && data !== '[DONE]') { try { yield JSON.parse(data); } catch { /* a keep-alive or comment */ } }
    }
  }
}

async function post(fetchImpl, url, headers, body, signal, secret) {
  let res;
  try { res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal }); }
  catch (e) { if (signal?.aborted) throw e; throw new ProviderError(`Could not reach the provider: ${e.cause?.code || e.message}`); }
  if (!res.ok) {
    let detail = ''; try { const j = await res.json(); detail = j?.error?.message || j?.message || ''; } catch { /* not json */ }
    const hint = res.status === 401 || res.status === 403 ? 'The key was refused. Check it in Settings → AI.' : res.status === 429 ? 'The provider says you are over a limit. Try again in a moment.' : res.status === 404 ? 'The provider does not know that model. Check the model name in Settings → AI.' : '';
    if (secret) detail = String(detail).split(secret).join('[key]'); // a server must not be able to hand the key back through an error
    throw new ProviderError([hint, String(detail).slice(0, 300) || `HTTP ${res.status}`].filter(Boolean).join(' '), res.status);
  }
  return res;
}

const schemaOf = (t) => t.schema;
/** Gemini accepts a subset of JSON Schema */
function geminiSchema(s) {
  if (!s || typeof s !== 'object') return s;
  if (Array.isArray(s)) return s.map(geminiSchema);
  const out = {};
  for (const k of ['type', 'description', 'enum', 'required', 'format', 'nullable']) if (s[k] !== undefined) out[k] = s[k];
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, geminiSchema(v)]));
  if (s.items) out.items = geminiSchema(s.items);
  if (out.type === 'object' && !out.properties) out.properties = {};
  return out;
}
/** an assistant turn with neither text nor tool calls would be rejected by the providers */
const keepable = (m) => m.role !== 'assistant' || !!m.text || !!m.toolCalls?.length;
const parseArgs = (s) => { if (!s) return {}; try { return JSON.parse(s); } catch { return { _unparsed: s }; } };

function anthropic({ key, fetchImpl, baseUrl, model, maxTokens = 8192 }) {
  const host = baseUrl || PROVIDERS.anthropic.host;
  const toWire = (messages) => messages.filter(keepable).map((m) => {
    if (m.role === 'user') return { role: 'user', content: m.text };
    if (m.role === 'assistant') return { role: 'assistant', content: [...(m.text ? [{ type: 'text', text: m.text }] : []), ...(m.toolCalls || []).map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args || {} }))] };
    return { role: 'user', content: m.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.text, ...(r.isError ? { is_error: true } : {}) })) };
  });
  return {
    async stream({ system, messages, tools, signal, onText }) {
      const body = { model, max_tokens: maxTokens, stream: true, system, messages: toWire(messages), ...(tools?.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: schemaOf(t) })) } : {}) };
      const res = await post(fetchImpl, `${host}/v1/messages`, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body, signal, key);
      let text = ''; const blocks = new Map(); let stop = 'end', usage = {};
      for await (const ev of sse(res, signal)) {
        if (ev.type === 'message_start') usage.input = ev.message?.usage?.input_tokens;
        else if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') blocks.set(ev.index, { id: ev.content_block.id, name: ev.content_block.name, json: '' });
        else if (ev.type === 'content_block_delta') {
          if (ev.delta?.type === 'text_delta') { text += ev.delta.text; onText?.(ev.delta.text); }
          else if (ev.delta?.type === 'input_json_delta') { const b = blocks.get(ev.index); if (b) b.json += ev.delta.partial_json; }
        } else if (ev.type === 'message_delta') { if (ev.delta?.stop_reason) stop = ev.delta.stop_reason === 'tool_use' ? 'tools' : ev.delta.stop_reason === 'max_tokens' ? 'length' : 'end'; if (ev.usage?.output_tokens != null) usage.output = ev.usage.output_tokens; }
        else if (ev.type === 'error') throw new ProviderError(ev.error?.message || 'The provider stopped the answer.');
      }
      return { text, toolCalls: [...blocks.values()].map((b) => ({ id: b.id, name: b.name, args: parseArgs(b.json) })), stop, usage };
    },
  };
}

function openai({ key, fetchImpl, baseUrl, model }) {
  const host = baseUrl ? checkEndpoint(baseUrl) : PROVIDERS.openai.host;
  const toWire = (system, messages) => {
    const out = [{ role: 'system', content: system }];
    for (const m of messages.filter(keepable)) {
      if (m.role === 'user') out.push({ role: 'user', content: m.text });
      else if (m.role === 'assistant') out.push({ role: 'assistant', content: m.text || null, ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } })) } : {}) });
      else for (const r of m.results) out.push({ role: 'tool', tool_call_id: r.id, content: r.text });
    }
    return out;
  };
  return {
    async stream({ system, messages, tools, signal, onText }) {
      const body = { model, stream: true, stream_options: { include_usage: true }, messages: toWire(system, messages), ...(tools?.length ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: schemaOf(t) } })) } : {}) };
      const res = await post(fetchImpl, `${host}/chat/completions`, key ? { authorization: `Bearer ${key}` } : {}, body, signal, key);
      let text = ''; const calls = new Map(); let stop = 'end', usage = {};
      for await (const ev of sse(res, signal)) {
        if (ev.error) throw new ProviderError(ev.error.message || 'The provider stopped the answer.');
        if (ev.usage) usage = { input: ev.usage.prompt_tokens, output: ev.usage.completion_tokens };
        const ch = ev.choices?.[0]; if (!ch) continue;
        if (ch.delta?.content) { text += ch.delta.content; onText?.(ch.delta.content); }
        for (const tc of ch.delta?.tool_calls || []) {
          const c = calls.get(tc.index ?? 0) || { id: '', name: '', json: '' };
          if (tc.id) c.id = tc.id; if (tc.function?.name) c.name += tc.function.name; if (tc.function?.arguments) c.json += tc.function.arguments;
          calls.set(tc.index ?? 0, c);
        }
        if (ch.finish_reason) stop = ch.finish_reason === 'tool_calls' ? 'tools' : ch.finish_reason === 'length' ? 'length' : 'end';
      }
      const toolCalls = [...calls.values()].map((c, i) => ({ id: c.id || `call_${i}`, name: c.name, args: parseArgs(c.json) }));
      return { text, toolCalls, stop: toolCalls.length ? 'tools' : stop, usage };
    },
  };
}

function google({ key, fetchImpl, baseUrl, model }) {
  const host = baseUrl || PROVIDERS.google.host;
  const toWire = (messages) => messages.filter(keepable).map((m) => {
    if (m.role === 'user') return { role: 'user', parts: [{ text: m.text }] };
    if (m.role === 'assistant') return { role: 'model', parts: [...(m.text ? [{ text: m.text }] : []), ...(m.toolCalls || []).map((c) => ({ functionCall: { name: c.name, args: c.args || {} } }))] };
    return { role: 'user', parts: m.results.map((r) => ({ functionResponse: { name: r.name, response: r.isError ? { error: r.text } : { result: r.text } } })) };
  });
  return {
    async stream({ system, messages, tools, signal, onText }) {
      const body = { systemInstruction: { parts: [{ text: system }] }, contents: toWire(messages), ...(tools?.length ? { tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: geminiSchema(schemaOf(t)) })) }] } : {}) };
      const res = await post(fetchImpl, `${host}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, { 'x-goog-api-key': key }, body, signal, key);
      let text = ''; const toolCalls = []; let stop = 'end', usage = {};
      for await (const ev of sse(res, signal)) {
        if (ev.error) throw new ProviderError(ev.error.message || 'The provider stopped the answer.');
        if (ev.usageMetadata) usage = { input: ev.usageMetadata.promptTokenCount, output: ev.usageMetadata.candidatesTokenCount };
        const c = ev.candidates?.[0]; if (!c) continue;
        for (const p of c.content?.parts || []) {
          if (p.text) { text += p.text; onText?.(p.text); }
          if (p.functionCall) toolCalls.push({ id: `g${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}_${toolCalls.length}`, name: p.functionCall.name, args: p.functionCall.args || {} });
        }
        if (c.finishReason === 'MAX_TOKENS') stop = 'length';
      }
      return { text, toolCalls, stop: toolCalls.length ? 'tools' : stop, usage };
    },
  };
}

/** @param {{provider:string,key:string,model:string,baseUrl?:string,fetchImpl?:typeof fetch}} o */
export function createProvider({ provider, key, model, baseUrl, fetchImpl = globalThis.fetch }) {
  if (!PROVIDERS[provider]) throw new ProviderError('Unknown provider.');
  if (!model) throw new ProviderError('Choose a model in Settings → AI.');
  if (!key && !(provider === 'openai' && baseUrl)) throw new ProviderError('Add an API key in Settings → AI.');
  const wire = PROVIDERS[provider].wire || provider;
  const o = { key, model, baseUrl: wire === 'openai' && provider !== 'openai' ? baseUrl || PROVIDERS[provider].host : baseUrl, fetchImpl };
  return wire === 'anthropic' ? anthropic(o) : wire === 'google' ? google(o) : openai(o);
}
