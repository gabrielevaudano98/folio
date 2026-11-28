// Folio Sheets — collaboration-ready model (area: architecture). No network code: these are the contracts a future
// sync service plugs into. Pure, tested in Node.
//
// Every change to a workbook is one Univer *mutation*: a serialisable { id, params } that Univer can replay
// deterministically (it is how Univer's own undo/redo and its commercial collaboration work). Folio wraps each in an
// Operation with a unique id, the author, a Lamport clock and the version it was made on:
//
//   Operation = { id, actor, clock, base, unit, mutation: { id, params }, ts }
//
// - Local state and transport are separate: the OpLog only records and replays; a Transport moves operations.
// - Order: (clock, actor) is a total order every replica agrees on, so replicas that apply the same set of operations
//   in that order reach the same state. A server that rebroadcasts in its own order works too (base tells it what the
//   author had seen).
// - Concurrency: two operations with the same base touched the same document; `overlaps()` says whether they touched
//   the same cells, which is what a merge step (operational transform, or "last writer wins per cell") needs.

/** RFC 4122 v4 id (crypto when available) */
export function uid() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16); for (let i = 0; i < 16; i++) b[i] = (Math.random() * 256) | 0;
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** order operations the same way on every replica */
export const compareOps = (a, b) => a.clock - b.clock || (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** the cells an operation writes, as "sheet!r,c" keys; null when it touches structure (rows, columns, sheets) */
export function footprint(op) {
  const p = op.mutation?.params || {};
  const sheet = p.subUnitId || p.sheetId || '';
  if (p.cellValue && typeof p.cellValue === 'object') {
    const out = new Set();
    for (const [r, row] of Object.entries(p.cellValue)) for (const c of Object.keys(row || {})) out.add(`${sheet}!${r},${c}`);
    return out;
  }
  if (p.range && /set-range|style|numfmt/.test(op.mutation.id)) {
    const r = p.range; const out = new Set();
    if ((r.endRow - r.startRow + 1) * (r.endColumn - r.startColumn + 1) > 1e5) return null;
    for (let i = r.startRow; i <= r.endRow; i++) for (let j = r.startColumn; j <= r.endColumn; j++) out.add(`${sheet}!${i},${j}`);
    return out;
  }
  return null;
}
/** do two concurrent operations conflict? structural changes always do */
export function overlaps(a, b) {
  const fa = footprint(a), fb = footprint(b);
  if (!fa || !fb) return true;
  for (const k of fa) if (fb.has(k)) return true;
  return false;
}

/**
 * The operation log of one open workbook.
 * record() is called for every local mutation; ops() lists them; since(v) is what a transport would send;
 * receive() takes remote operations and returns the ones to apply, in order, skipping duplicates.
 */
export function createOpLog({ actor = 'local', now = () => Date.now() } = {}) {
  let clock = 0, version = 0, unit = null;
  const log = [], seen = new Set(), listeners = new Set();
  return {
    get actor() { return actor; },
    get clock() { return clock; },
    get version() { return version; },
    reset(snapshot) { log.length = 0; seen.clear(); clock = 0; version = 0; unit = snapshot?.id ?? null; },
    /** wrap a local Univer mutation; returns the Operation */
    record(mutation, options = {}) {
      if (options?.fromCollab || options?.onlyLocal) return null; // remote replays and local-only UI state are not new operations
      const op = { id: uid(), actor, clock: ++clock, base: version, unit, mutation: { id: mutation.id, params: structuredClone(mutation.params ?? {}) }, ts: now() };
      log.push(op); seen.add(op.id); version++;
      for (const f of listeners) f(op);
      return op;
    },
    ops: () => log.slice(),
    since: (v) => log.slice(v),
    /** remote operations → those not seen yet, in replica order; advances the Lamport clock */
    receive(remote) {
      const fresh = remote.filter((o) => !seen.has(o.id)).sort(compareOps);
      for (const o of fresh) { seen.add(o.id); clock = Math.max(clock, o.clock); log.push(o); version++; }
      return fresh;
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** JSON lines, for an audit trail or a sync service */
    toJSONL: () => log.map((o) => JSON.stringify(o)).join('\n'),
  };
}

/**
 * Transport contract. A sync service implements it; Folio ships only the local one.
 *   connect(docId, { since }) → Promise<void>
 *   send(ops) → Promise<void>
 *   onRemote(fn: (ops) => void) → unsubscribe
 *   onPresence(fn: (peers) => void) → unsubscribe     cursors and selections of other people
 *   disconnect()
 */
export function createLocalTransport() {
  const remote = new Set();
  return {
    kind: 'local',
    async connect() {}, async send() {}, onRemote(fn) { remote.add(fn); return () => remote.delete(fn); }, onPresence() { return () => {}; }, disconnect() { remote.clear(); },
    /** tests: pretend another replica sent these */
    inject(ops) { for (const f of remote) f(ops); },
  };
}

/** connect a log to a transport and to the function that applies a remote operation to Univer */
export function bindSync(log, transport, apply) {
  const offLocal = log.subscribe((op) => { transport.send([op]).catch(() => {}); });
  const offRemote = transport.onRemote((ops) => { for (const op of log.receive(ops)) apply(op); });
  return () => { offLocal(); offRemote(); };
}
/**
 * how the window replays a remote operation: Univer's command service, marked `fromCollab` so the log does not record
 * it again. Not `onlyLocal`: Univer skips formula recalculation for onlyLocal mutations, and a replica must recompute.
 */
export const applyWith = (commandService) => (op) => commandService.syncExecuteCommand(op.mutation.id, op.mutation.params, { fromCollab: true });
