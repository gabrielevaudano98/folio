// Per-change review of AI edits (#18): settling one hunk leaves every other line, and its line endings, alone.
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
const out = 'dist/test/ai-hunks.mjs';
await esbuild.build({ entryPoints: ['src/renderer/ai-hunks.js'], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
const { splitHunks, settleHunk } = await import('../' + out);
console.log('\nai hunks');
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
