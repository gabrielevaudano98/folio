// Ask your AI from inside Folio (#20). MCP is pull-only: an assistant cannot be called from the app, so the app keeps a
// short queue of requests the user wrote (an instruction and the selected text) and the assistant reads it with
// get_ai_requests, edits the note with the normal tools (the user reviews that as any AI edit) and closes the request
// with finish_ai_request. Nothing leaves the machine: the queue lives in memory.
import crypto from 'node:crypto';

const MAX = 20, MAX_TEXT = 20000;

export function createRequests({ now = () => Date.now() } = {}) {
  const list = [];
  const view = (r) => ({ id: r.id, path: r.path, instruction: r.instruction, selection: r.selection, line: r.line, at: new Date(r.at).toISOString(), status: r.status, ...(r.reply ? { reply: r.reply } : {}) });
  return {
    add({ path, instruction, selection = '', line = null }) {
      if (typeof instruction !== 'string' || !instruction.trim()) throw new Error('A request needs an instruction.');
      const r = { id: crypto.randomBytes(4).toString('hex'), path: path || null, instruction: instruction.trim().slice(0, 2000), selection: String(selection || '').slice(0, MAX_TEXT), line, at: now(), status: 'pending' };
      list.push(r);
      while (list.filter((x) => x.status === 'pending').length > MAX) list.splice(list.findIndex((x) => x.status === 'pending'), 1);
      return view(r);
    },
    pending: () => list.filter((r) => r.status === 'pending').map(view),
    count: () => list.filter((r) => r.status === 'pending').length,
    finish(id, reply = '') {
      const r = list.find((x) => x.id === id);
      if (!r) throw new Error(`No request ${id}. Use get_ai_requests to see the open ones.`);
      r.status = 'done'; r.reply = String(reply || '').slice(0, 2000);
      list.splice(list.indexOf(r), 1); // a finished request is not kept: the queue stays small and an id cannot be answered twice
      return view(r);
    },
    clear() { list.length = 0; },
    cancel(id) { const i = list.findIndex((x) => x.id === id && x.status === 'pending'); if (i >= 0) list.splice(i, 1); return i >= 0; },
  };
}
