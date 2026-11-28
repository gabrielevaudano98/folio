// Per-change review of AI edits (#18): settling one hunk (accept, reject or the reader's own edit) leaves every other
// line, and its line endings, alone.
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
const out = 'dist/test/ai-hunks.mjs';
await esbuild.build({ entryPoints: ['src/renderer/ai-hunks.js'], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
const { splitHunks, settleHunk, hunkDraft, hunkEditText, hunkEol } = await import('../' + out);
console.log('\nai hunks');
const hunks = (b, a) => splitHunks(b, a).items.filter((it) => it.type === 'hunk');
const glue = (items, side) => items.map((it) => (it.type === 'same' ? it.text : it[side])).join('');

const before = 'A\r\nB\r\nC\r\nD\r\nE\r\nF\r\n', after = 'A\r\nB2\r\nC\r\nD\r\nE\r\nF\r\nG\r\n';
assert.equal(splitHunks(before, after).count, 2);
let r = settleHunk(before, after, 0, 'reject');
assert.equal(r.after, 'A\r\nB\r\nC\r\nD\r\nE\r\nF\r\nG\r\n'); assert.equal(r.before, before);
assert.equal(splitHunks(r.before, r.after).count, 1);
r = settleHunk(before, after, 0, 'accept');
assert.equal(r.after, after); assert.equal(r.before, 'A\r\nB2\r\nC\r\nD\r\nE\r\nF\r\n');
assert.equal(splitHunks(r.before, r.after).count, 1);
// settling every hunk either way ends with nothing pending
let cur = { before, after };
while (splitHunks(cur.before, cur.after).count) cur = settleHunk(cur.before, cur.after, 0, 'accept');
assert.equal(cur.before, after); assert.equal(cur.after, after);
cur = { before, after };
while (splitHunks(cur.before, cur.after).count) cur = settleHunk(cur.before, cur.after, 0, 'reject');
assert.equal(cur.after, before);
assert.equal(splitHunks('x\n', 'x\n').count, 0);
console.log('  ok accept makes a change the baseline, reject restores the old lines, CRLF is kept');

// edit: exactly the reader's text in the hunk's place, in the hunk's line ending; the other hunk is untouched
const [h0] = hunks(before, after);
assert.equal(hunkDraft(h0), 'B2');
assert.equal(hunkEol(h0), '\r\n');
let text = hunkEditText(h0, 'B3\nB4');
assert.equal(text, 'B3\r\nB4\r\n');
r = settleHunk(before, after, 0, 'edit', { text });
assert.equal(r.after, 'A\r\nB3\r\nB4\r\nC\r\nD\r\nE\r\nF\r\nG\r\n');
assert.equal(r.before, 'A\r\nB3\r\nB4\r\nC\r\nD\r\nE\r\nF\r\n', 'the edit is settled: only the other change is still pending');
assert.equal(splitHunks(r.before, r.after).count, 1);
assert.deepEqual(hunks(r.before, r.after).map((h) => [h.old, h.new]), [['', 'G\r\n']]);
// an untouched draft is accept, byte for byte; an emptied one removes the lines
assert.equal(hunkEditText(h0, hunkDraft(h0)), h0.new);
assert.deepEqual(settleHunk(before, after, 0, 'edit', { text: hunkEditText(h0, 'B2') }), settleHunk(before, after, 0, 'accept'));
r = settleHunk(before, after, 0, 'edit', { text: hunkEditText(h0, '') });
assert.equal(r.after, 'A\r\nC\r\nD\r\nE\r\nF\r\nG\r\n');
// the reader may paste CRLF or lone CR: the hunk's own ending wins
assert.equal(hunkEditText({ old: 'a\n', new: 'b\n' }, 'x\r\ny\rz'), 'x\ny\nz\n');
// a trailing blank line the reader typed is kept as a blank line
assert.equal(hunkEditText({ old: 'a\n', new: 'b\n' }, 'x\n'), 'x\n\n');
assert.throws(() => settleHunk(before, after, 0, 'edit'), /needs its text/);
console.log('  ok edit writes exactly the edited text, in the hunk\'s line ending, and leaves the other change pending');

// last line without a newline: the edit keeps the file ending as the proposal had it
{
  const b = 'one\ntwo', a = 'one\nTWO';
  const [h] = hunks(b, a);
  assert.deepEqual([h.old, h.new, hunkDraft(h)], ['two', 'TWO', 'TWO']);
  assert.equal(settleHunk(b, a, 0, 'edit', { text: hunkEditText(h, 'Two\nthree') }).after, 'one\nTwo\nthree');
  // the assistant added the final newline: an edit keeps it
  const a2 = 'one\ntwo\nthree\n';
  const [g] = hunks(b, a2);
  assert.equal(settleHunk(b, a2, 0, 'edit', { text: hunkEditText(g, 'two\n3') }).after, 'one\ntwo\n3\n');
  // the assistant removed the last line: typing it back keeps the file without a final newline
  const [k] = hunks(b, 'one\n');
  assert.deepEqual([k.old, k.new, hunkDraft(k)], ['two', '', '']);
  assert.equal(settleHunk(b, 'one\n', 0, 'edit', { text: hunkEditText(k, 'deux') }).after, 'one\ndeux');
}
// a pure insertion of a blank line: the draft is empty, and leaving it empty still accepts the blank line
{
  const b = 'a\nb\n', a = 'a\n\nb\n';
  const [h] = hunks(b, a);
  assert.deepEqual([h.old, h.new, hunkDraft(h)], ['', '\n', '']);
  assert.equal(settleHunk(b, a, 0, 'edit', { text: hunkEditText(h, '') }).after, a);
  assert.equal(settleHunk(b, a, 0, 'edit', { text: hunkEditText(h, 'mid') }).after, 'a\nmid\nb\n');
}
// a pure deletion: the draft is empty; writing text puts it in place of the deleted lines, with the line ending kept
{
  const b = 'a\r\nb\r\nc\r\n', a = 'a\r\nc\r\n';
  const [h] = hunks(b, a);
  assert.deepEqual([h.old, h.new], ['b\r\n', '']);
  assert.equal(hunkEol(h), '\r\n');
  assert.equal(settleHunk(b, a, 0, 'edit', { text: hunkEditText(h, 'B') }).after, 'a\r\nB\r\nc\r\n');
}
// an empty note, and an assistant that empties a note
assert.equal(settleHunk('', 'x\n', 0, 'edit', { text: hunkEditText(hunks('', 'x\n')[0], 'y') }).after, 'y\n');
assert.equal(settleHunk('x\r\n', '', 0, 'reject').after, 'x\r\n');
assert.equal(hunkEol({ old: '', new: 'z' }, 'p\r\nq'), '\r\n', 'a one-line change takes the document\'s line ending');
console.log('  ok last line without newline, blank-line and pure insert/delete hunks, empty notes');

// adjacent changes are one hunk (never two that overlap); hunks are always separated by an unchanged line
{
  const b = 'a\nb\nc\nd\n', a = 'a\nB\nC\nd\n';
  assert.equal(splitHunks(b, a).count, 1);
  const [h] = hunks(b, a); assert.deepEqual([h.old, h.new], ['b\nc\n', 'B\nC\n']);
  const two = splitHunks('1\n2\n3\n', 'x\n2\ny\n');
  assert.equal(two.count, 2);
  assert.deepEqual(two.items.map((it) => it.type), ['hunk', 'same', 'hunk']);
}
// a stale button: the hunk must still read as it did when the sheet was drawn
{
  const [h] = hunks(before, after);
  assert.ok(settleHunk(before, after, 0, 'accept', { expect: h }));
  assert.equal(settleHunk(before, after.replace('B2', 'B9'), 0, 'accept', { expect: h }), null, 'the note changed since: nothing is settled');
  assert.equal(settleHunk(before, after, 7, 'accept'), null, 'no such hunk');
  assert.equal(settleHunk('same\n', 'same\n', 0, 'reject'), null);
}
console.log('  ok adjacent lines form one hunk; a change that is not what the reader saw is never settled');

// randomised: splitting is lossless, and settling any hunk any way keeps the other hunks' text and every unchanged line
{
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const words = ['alpha', 'beta', 'gamma', '', '# head', '- item', '  indent', 'tail'];
  const doc = (eol) => { const n = rnd(9); const ls = Array.from({ length: n }, () => words[rnd(words.length)]); return ls.join(eol) + (n && rnd(3) ? eol : ''); };
  const mutate = (t, eol) => {
    const ls = t.split(eol); const n = 1 + rnd(4);
    for (let i = 0; i < n; i++) { const at = rnd(ls.length + 1), k = rnd(3); if (k === 0) ls.splice(at, 0, words[rnd(words.length)] + '*'); else if (k === 1) ls.splice(at, 1); else ls[at] = (ls[at] ?? '') + '!'; }
    return ls.join(eol);
  };
  for (let round = 0; round < 400; round++) {
    const eol = rnd(2) ? '\r\n' : '\n';
    const b = doc(eol), a = mutate(b, eol);
    const { items, count } = splitHunks(b, a);
    assert.equal(glue(items, 'old'), b); assert.equal(glue(items, 'new'), a);
    for (const it of items) if (it.type === 'hunk') assert.ok(it.old !== '' || it.new !== '', 'no empty hunk');
    for (let i = 0; i + 1 < items.length; i++) assert.ok(!(items[i].type === 'hunk' && items[i + 1].type === 'hunk'), 'hunks never touch');
    if (!count) continue;
    const id = rnd(count), hit = items.find((it) => it.id === id);
    const edited = hunkEditText(hit, 'edited ' + round);
    for (const [action, keep] of [['accept', hit.new], ['reject', hit.old], ['edit', edited]]) {
      const s = settleHunk(b, a, id, action, { text: edited, expect: hit });
      const want = (side) => items.map((it) => (it.type === 'same' ? it.text : it === hit ? keep : it[side])).join('');
      assert.equal(s.before, want('old'), `round ${round} ${action} before`);
      assert.equal(s.after, want('new'), `round ${round} ${action} after`);
      // no line ending changes kind: a CRLF note never gains a bare "\n" and the reverse
      if (eol === '\r\n') assert.ok(!/(^|[^\r])\n/.test(s.after), `round ${round} ${action} keeps CRLF`);
      else assert.ok(!s.after.includes('\r'), `round ${round} ${action} keeps LF`);
    }
  }
}
console.log('  ok 400 random edits: lossless split, settling one hunk never touches another, line endings never mix');
