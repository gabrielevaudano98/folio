// Folio — the chat agent loop. Pure: the provider, the tool runner and the approval are arguments, so it is tested without a
// network or Electron (test/chat-agent.test.mjs).
export const LIMITS = { steps: 24, toolResultChars: 30000, contextChars: 400000 };

const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const clip = (s) => (s.length > LIMITS.toolResultChars ? s.slice(0, LIMITS.toolResultChars) + `\n[cut: ${s.length - LIMITS.toolResultChars} more characters. Ask for a narrower range or section.]` : s);

/** drops the oldest tool results from a copy of the messages until the text fits the budget */
export function fitContext(messages, budget = LIMITS.contextChars) {
  const size = (m) => (m.text?.length || 0) + (m.results?.reduce((n, r) => n + r.text.length, 0) || 0) + (m.toolCalls ? JSON.stringify(m.toolCalls).length : 0);
  let total = messages.reduce((n, m) => n + size(m), 0);
  if (total <= budget) return messages;
  const out = messages.map((m) => (m.role === 'tool' ? { ...m, results: m.results.map((r) => ({ ...r })) } : m));
  for (const m of out) {
    if (total <= budget) break;
    if (m.role !== 'tool') continue;
    for (const r of m.results) { if (total <= budget) break; const was = r.text.length; r.text = '[older result removed to save space; read it again if needed]'; total -= was - r.text.length; }
  }
  return out;
}

/** a short human line for a tool step */
export function describe(name, a = {}) {
  const p = a.path || a.from || a.query || '';
  const to = a.to ? ` → ${a.to}` : '';
  return `${name.replace(/_/g, ' ')}${p ? ' ' + p : ''}${to}`;
}

/**
 * @param {object} d
 * @param {(ctx)=>object} d.provider returns a provider for this turn
 * @param {Array<{name,description,schema,write,annotations}>} d.tools
 * @param {(name,args)=>Promise<any>} d.runTool throws on error
 * @param {(tool,args,ctx)=>Promise<{decision,reason?,remember?}>} d.classify
 * @param {(req)=>Promise<'once'|'chat'|'deny'>} d.ask
 * @param {(ev)=>void} d.emit
 * @param {(conv)=>Promise<void>} d.save
 * @param {()=>boolean} d.allowWrite
 * @param {(p:string)=>Promise<boolean>} d.exists
 */
export function createAgent(d) {
  const byName = new Map(d.tools.map((t) => [t.name, t]));
  return {
    /** runs one user turn on a conversation; resolves when the model is done, stopped or failed */
    async run(conv, userText, { system, signal }) {
      conv.messages.push({ role: 'user', text: userText });
      let moves = 0, usage = { input: 0, output: 0 };
      const aborted = new Promise((r) => signal?.addEventListener('abort', () => r('abort'), { once: true }));
      try {
        for (let step = 0; step < LIMITS.steps; step++) {
          if (signal?.aborted) break;
          const r = await d.provider({}).stream({ system, messages: fitContext(conv.messages), tools: d.tools, signal, onText: (delta) => d.emit({ type: 'text', delta }) });
          usage.input += r.usage?.input || 0; usage.output += r.usage?.output || 0;
          conv.messages.push({ role: 'assistant', text: r.text, toolCalls: r.toolCalls });
          await d.save(conv);
          if (!r.toolCalls.length) { if (r.stop === 'length') d.emit({ type: 'notice', message: 'The answer was cut because it reached the length limit. Ask it to continue.' }); d.emit({ type: 'done', usage }); return; }
          const results = [];
          for (const c of r.toolCalls) {
            const res = (text, isError = false) => ({ id: c.id, name: c.name, text: clip(text), isError });
            const base = { type: 'tool', id: c.id, name: c.name, args: c.args, line: describe(c.name, c.args) };
            const tool = byName.get(c.name);
            if (signal?.aborted) { results.push(res('Stopped by the person.', true)); continue; }
            if (!tool) { d.emit({ ...base, status: 'error', detail: 'Unknown tool' }); results.push(res(`Unknown tool ${c.name}.`, true)); continue; }
            if (c.args?._unparsed) { d.emit({ ...base, status: 'error', detail: 'Bad arguments' }); results.push(res('The arguments were not valid JSON. Call the tool again.', true)); continue; }
            const verdict = await d.classify(tool, c.args, { allowWrite: d.allowWrite(), exists: d.exists, moves, allowOverwrites: !!conv.grants?.overwrites });
            if (verdict.decision === 'deny') { d.emit({ ...base, status: 'denied', detail: verdict.reason }); results.push(res(`Not allowed: ${verdict.reason}`, true)); continue; }
            if (verdict.decision === 'ask') {
              d.emit({ ...base, status: 'waiting', detail: verdict.reason });
              const answer = await Promise.race([d.ask({ id: c.id, name: c.name, args: c.args, reason: verdict.reason, remember: !!verdict.remember }), aborted]);
              if (answer === 'abort') { results.push(res('Stopped by the person.', true)); continue; }
              if (answer === 'deny') { d.emit({ ...base, status: 'denied', detail: 'You declined' }); results.push(res('The person declined this step. Do not retry it; ask what they want instead.', true)); continue; }
              if (answer === 'chat' && verdict.remember) conv.grants = { ...conv.grants, overwrites: true };
            }
            try {
              d.emit({ ...base, status: 'run' });
              const out = asText(await d.runTool(c.name, c.args || {}, c.id));
              if (c.name === 'move_note') moves++;
              d.emit({ ...base, status: 'done', detail: out.slice(0, 200) });
              results.push(res(out));
            } catch (e) { d.emit({ ...base, status: 'error', detail: e.message }); results.push(res(e.message || String(e), true)); }
          }
          conv.messages.push({ role: 'tool', results });
          await d.save(conv);
        }
        d.emit(signal?.aborted ? { type: 'done', usage, stopped: true } : { type: 'notice', message: `Stopped after ${LIMITS.steps} steps. Say "continue" to go on.` });
        if (!signal?.aborted) d.emit({ type: 'done', usage });
      } catch (e) {
        if (signal?.aborted) { d.emit({ type: 'done', usage, stopped: true }); return; }
        d.emit({ type: 'error', message: e.message || String(e) });
      } finally {
        repair(conv); await d.save(conv).catch(() => {});
      }
    },
  };
}

/** a conversation must end with something a provider accepts: every tool call answered */
export function repair(conv) {
  const last = conv.messages[conv.messages.length - 1];
  if (last?.role === 'assistant' && last.toolCalls?.length) conv.messages.push({ role: 'tool', results: last.toolCalls.map((c) => ({ id: c.id, name: c.name, text: 'Stopped before this ran.', isError: true })) });
}
