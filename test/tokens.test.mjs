// Design invariant 5: the interface never uses the --content-* colours; only rules that style page content may
// (each selector of a comma list on its own, so one content selector cannot carry interface ones).
import fs from 'node:fs'; import assert from 'node:assert/strict';
const css = fs.readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const CONTENT = /data-color|data-bg|callout-c-|cover-g\d|slash-swatch|\.(?:rich|md)-(?:tag|field|status)(?![\w-])|\.critic-|\.rich-chip\.is-date(?![\w-])/; // whole class names only // date chips are page content (overdue dates red, as in Notion)
const bad = [];
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  if (/var\(--content-/.test(m[2]) && !m[1].split(',').every((sel) => CONTENT.test(sel))) bad.push(m[1].trim().replace(/\s+/g, ' '));
}
assert.deepEqual(bad, [], 'interface rules use --content-* colours:\n' + bad.join('\n'));
console.log('\ntokens\n  ✓ --content-* colours appear only in rules that style page content');
