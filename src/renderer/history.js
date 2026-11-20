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

/** Undo and redo for actions on files (create, rename, move, delete). Each op is { label, undo(), redo() }. */
export function createActionLog(limit = 50) {
  const done = [], undone = [];
  return {
    push(op) { done.push(op); if (done.length > limit) done.shift(); undone.length = 0; },
    get canUndo() { return done.length > 0; },
    get canRedo() { return undone.length > 0; },
    peek(dir) { const s = dir === 'redo' ? undone : done; return s[s.length - 1]; },
    /** run the newest op of a stack; a failing op is dropped so the stack never gets stuck */
    async run(dir) {
      const from = dir === 'redo' ? undone : done, to = dir === 'redo' ? done : undone;
      const op = from.pop(); if (!op) return null;
      await op[dir]();
      to.push(op);
      return op;
    },
    clear() { done.length = 0; undone.length = 0; },
  };
}
