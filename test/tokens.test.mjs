// Design invariant 5: the interface never uses the --content-* colours; only rules that style page content may.
import fs from 'node:fs'; import assert from 'node:assert/strict';
const css = fs.readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const CONTENT = /data-color|data-bg|callout-c-|slash-swatch|\.rich-tag|\.md-tag|\.rich-field|\.md-field|\.rich-status|\.md-status|\.critic-|\.rich-chip\.is-date/; // date chips are page content (overdue dates red, as in Notion)
const bad = [];
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  if (/var\(--content-/.test(m[2]) && !CONTENT.test(m[1])) bad.push(m[1].trim().replace(/\s+/g, ' '));
}
assert.deepEqual(bad, [], 'interface rules use --content-* colours:\n' + bad.join('\n'));
console.log('\ntokens\n  ✓ --content-* colours appear only in rules that style page content');
