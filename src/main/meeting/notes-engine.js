// Folio — runs llama.cpp's server as a short-lived child process to draft meeting notes, then stops it.
// A separate process, not a Node addon: Electron's V8 memory cage crashes node-llama-cpp (see docs/performance/meeting-spike.md),
// and when the process exits every byte of the model is returned to the system.
import { spawn } from 'node:child_process';
import net from 'node:net';
import crypto from 'node:crypto';
import { SCHEMA, SYSTEM, chunk, verify, merge } from './notes-core.js';

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.unref(); s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ serverBin: string, modelPath: string, lines: {n:number, who:string, text:string}[], threads: number, contextTokens: number,
 *   onProgress?: (p: {step: string, done?: number, total?: number}) => void, signal?: AbortSignal, onPid?: (pid: number) => void }} o
 */
export async function draftNotes({ serverBin, modelPath, lines, threads, contextTokens, onProgress = () => {}, signal, onPid = () => {} }) {
  if (!lines.length) return { notes: { summary: '', decisions: [], actions: [], questions: [] }, dropped: 0 };
  const port = await freePort(), key = crypto.randomBytes(16).toString('hex');
  const child = spawn(serverBin, ['-m', modelPath, '--host', '127.0.0.1', '--port', String(port), '--api-key', key, '-c', String(contextTokens), '-np', '1', '-t', String(threads), '--no-webui', '--jinja', '--log-disable'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let stderr = ''; child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  let exited = null; child.on('exit', (code) => { exited = code ?? -1; });
  onPid(child.pid);
  const kill = () => { if (exited === null) child.kill(); };
  signal?.addEventListener('abort', kill);
  const base = `http://127.0.0.1:${port}`, headers = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
  try {
    onProgress({ step: 'loading' });
    for (let i = 0; ; i++) {
      if (exited !== null) throw new Error(`The notes engine stopped (${exited}). ${stderr.split('\n').filter(Boolean).pop() || ''}`.trim());
      if (signal?.aborted) throw new Error('Cancelled.');
      try { const r = await fetch(`${base}/health`); if (r.ok) break; } catch {}
      if (i > 240) throw new Error('The notes engine did not start within two minutes.');
      await sleep(500);
    }
    const ask = async (messages, schema, maxTokens) => {
      const r = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers, signal, body: JSON.stringify({
        messages, temperature: 0.3, top_p: 0.9, max_tokens: maxTokens,
        response_format: { type: 'json_schema', json_schema: { name: 'notes', schema } },
        chat_template_kwargs: { enable_thinking: false }, // Qwen3 thinks by default; minutes do not need it
      }) });
      if (!r.ok) throw new Error(`The notes engine answered ${r.status}.`);
      const j = await r.json();
      return JSON.parse(j.choices?.[0]?.message?.content || '{}');
    };
    const parts = chunk(lines);
    const results = []; let dropped = 0;
    for (const [i, text] of parts.entries()) {
      onProgress({ step: 'writing', done: i, total: parts.length });
      const raw = await ask([{ role: 'system', content: SYSTEM }, { role: 'user', content: `Transcript (write the minutes in its language):\n${text}` }], SCHEMA, 1200);
      const v = verify(raw, lines); results.push(v.notes); dropped += v.dropped;
    }
    const notes = merge(results);
    if (results.length > 1 && notes.summary) {
      onProgress({ step: 'summary', done: parts.length, total: parts.length });
      const s = await ask([{ role: 'system', content: 'Join these partial summaries of one meeting into two or three sentences, in their language. Add nothing.' }, { role: 'user', content: results.map((r) => r.summary).join('\n') }], { type: 'object', required: ['summary'], properties: { summary: { type: 'string' } } }, 300);
      if (s.summary) notes.summary = String(s.summary).trim();
    }
    return { notes, dropped };
  } finally { signal?.removeEventListener('abort', kill); kill(); }
}
