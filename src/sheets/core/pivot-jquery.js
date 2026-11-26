// pivottable 2.23 runs on jQuery: this module, imported before it, makes the jQuery it gets global. Every build resolves
// `jquery` to jquery-lite.cjs (no DOM needed); the helpers below are set again for a real jQuery 4, which removed them.
// Module order does the sequencing, so no top-level await is needed and the data engine (CommonJS) loads pivots too.
import $ from 'jquery';
$.isFunction ??= (f) => typeof f === 'function';
$.isArray ??= Array.isArray;
$.inArray ??= (v, a, i) => (a == null ? -1 : Array.prototype.indexOf.call(a, v, i));
globalThis.jQuery ??= $;
export default $;
