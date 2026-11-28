// Folio Sheets — the part of jQuery that pivottable's computations use, without a DOM: pivottable (PivotData and its
// aggregators) only calls these helpers, and attaches its UI to $.fn, which Folio does not use (it has its own field
// pane). Real jQuery 4 refuses to load where there is no `window.document` (the data engine, the command line), so
// every build resolves `jquery` to this module (build.mjs `alias`). Semantics follow jQuery 3/4.
const isPlain = (o) => o != null && typeof o === 'object' && (Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null);

/** jQuery.extend([deep,] target, ...sources) */
function extend(...args) {
  let deep = false, i = 0;
  if (typeof args[0] === 'boolean') { deep = args[0]; i = 1; }
  let target = args[i] ?? {}; i++;
  if (typeof target !== 'object' && typeof target !== 'function') target = {};
  if (i === args.length) { target = $; i--; } // $.extend(obj) extends jQuery itself
  for (; i < args.length; i++) {
    const src = args[i]; if (src == null) continue;
    for (const key of Object.keys(src)) {
      if (key === '__proto__') continue;
      const copy = src[key];
      if (copy === target) continue;
      if (deep && copy && (isPlain(copy) || Array.isArray(copy))) {
        const cur = target[key];
        const base = Array.isArray(copy) ? (Array.isArray(cur) ? cur : []) : (isPlain(cur) ? cur : {});
        target[key] = extend(true, base, copy);
      } else if (copy !== undefined) target[key] = copy;
    }
  }
  return target;
}

const $ = function jQueryLite() { throw new Error('jQuery DOM functions are not available in Folio Sheets.'); };
Object.assign($, {
  extend,
  fn: {},
  isFunction: (f) => typeof f === 'function',
  isArray: Array.isArray,
  inArray: (v, a, i) => (a == null ? -1 : Array.prototype.indexOf.call(a, v, i)),
  isEmptyObject: (o) => { for (let p = o == null ? null : Object(o); p; p = Object.getPrototypeOf(p)) if (Object.keys(p).length) return false; return true; }, // own or inherited enumerable keys, as jQuery
  isPlainObject: isPlain,
});
module.exports = $; // CommonJS, so pivottable's require("jquery") and `import $ from 'jquery'` get the same object
