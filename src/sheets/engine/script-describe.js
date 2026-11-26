// Folio Sheets — what a script defines, read without running it (the window uses it for menus; pure).
/** names of the functions a script defines: macros (any case), custom functions (UPPER_CASE), hooks */
export function describe(code) {
  const names = [...String(code).matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/gm)].map((m) => ({ name: m[1], params: m[2].split(',').map((s) => s.trim()).filter(Boolean) }));
  const HOOKS = new Set(['onOpen', 'onEdit', 'onSelectionChange', 'onSave']);
  return {
    macros: names.filter((n) => !HOOKS.has(n.name) && !/^[A-Z][A-Z0-9_.]*$/.test(n.name) && !n.name.startsWith('_')),
    functions: names.filter((n) => /^[A-Z][A-Z0-9_.]*$/.test(n.name)),
    hooks: names.filter((n) => HOOKS.has(n.name)).map((n) => n.name),
  };
}

