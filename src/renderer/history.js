// Per-document undo history for the surfaces (slides, board, sheet) and the file-action stack.
// A surface keeps one undo/redo pair of arrays; `perDoc` swaps their contents when another document is shown,
// so Ctrl+Z in one file can never bring back the text of another.

export function perDoc(undo, redo) {
  const store = new WeakMap(); let key = null;
  return {
    bind(k) {
      if (!k || k === key) return false;
      if (key) store.set(key, [undo.slice(), redo.slice()]);
      const [u = [], r = []] = store.get(k) || [];
      undo.length = 0; undo.push(...u); redo.length = 0; redo.push(...r);
      key = k; return true;
    },
  };
}

/** Undo and redo for actions on files (create, rename, move, delete). Each op is { label, undo(), redo() }.
 *  Runs are serialized, so a second shortcut press waits for the first; a failed op goes back where it was
 *  (and is dropped on its second failure, so a stale op can never block the stack). */
export function createActionLog(limit = 50) {
  const done = [], undone = [];
  let gen = 0, chain = Promise.resolve();
  const log = {
    push(op) { gen++; done.push(op); if (done.length > limit) done.shift(); undone.length = 0; },
    get canUndo() { return done.length > 0; },
    get canRedo() { return undone.length > 0; },
    peek(dir) { const s = dir === 'redo' ? undone : done; return s[s.length - 1]; },
    run(dir) {
      const next = chain.then(async () => {
        const from = dir === 'redo' ? undone : done, to = dir === 'redo' ? done : undone;
        const op = from.pop(); if (!op) return null;
        const started = gen;
        try { await op[dir](); }
        catch (e) { op.fails = (op.fails || 0) + 1; if (op.fails < 2) from.push(op); throw e; }
        if (gen === started) to.push(op); // a new action during the await has already cleared the other stack
        return op;
      });
      chain = next.catch(() => {});
      return next;
    },
    clear() { gen++; done.length = 0; undone.length = 0; },
  };
  return log;
}
