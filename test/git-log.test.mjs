// Folio D15 leftover: the Git commits that touched a page appear in its version timeline. Read-only, no shell.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import assert from 'node:assert/strict';
import { createGitLog, parseLog, validHash } from '../src/main/git-log.js';

console.log('\ngit history');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-git-'));
const git = (...a) => execFileSync('git', ['-c', 'user.name=Ada', '-c', 'user.email=ada@example.com', '-c', 'commit.gpgsign=false', ...a], { cwd: tmp, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_DATE: '2026-11-18T10:00:00Z', GIT_COMMITTER_DATE: '2026-11-18T10:00:00Z' } }).toString();

// not a repository, no root, no git binary: nothing to show, never an error
assert.deepEqual(await createGitLog(() => tmp).list('a.md'), []);
assert.deepEqual(await createGitLog(() => null).list('a.md'), []);
assert.deepEqual(await createGitLog(() => tmp, () => Promise.reject(Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }))).list('a.md'), []);

git('init', '-q'); fs.mkdirSync(path.join(tmp, 'pages')); fs.writeFileSync(path.join(tmp, 'pages', 'a.md'), '# A\n\nfirst\n'); fs.writeFileSync(path.join(tmp, 'b.md'), 'other\n');
git('add', '.'); git('commit', '-q', '-m', 'Add A and B');
fs.writeFileSync(path.join(tmp, 'pages', 'a.md'), '# A\n\nfirst\nsecond\n'); git('add', '.'); git('commit', '-q', '-m', 'Second line, with: punctuation | and "quotes"');
fs.writeFileSync(path.join(tmp, 'b.md'), 'changed\n'); git('add', '.'); git('commit', '-q', '-m', 'Only B');

const g = createGitLog(() => tmp);
const log = await g.list('pages/a.md');
assert.deepEqual(log.map((c) => c.subject), ['Second line, with: punctuation | and "quotes"', 'Add A and B']);
assert(log.every((c) => c.author === 'Ada' && validHash(c.hash) && c.t === Date.parse('2026-11-18T10:00:00Z')));
console.log('  ✓ lists the commits that changed the page, newest first, without those that touched other files');
assert.equal(await g.show('pages/a.md', log[1].hash), '# A\n\nfirst\n'); assert.equal(await g.show('pages/a.md', log[0].hash), '# A\n\nfirst\nsecond\n');
assert.equal(await g.show('b.md', log[1].hash), 'other\n');
console.log('  ✓ shows the page as it was in a commit');
assert.equal(await g.show('pages/a.md', '--output=/tmp/x'), null); assert.equal(await g.show('pages/a.md', 'HEAD'), null); assert.equal(await g.show('pages/a.md', 'abc; rm -rf'), null);
assert.equal(await g.show('nope.md', log[0].hash), null);
assert.deepEqual(parseLog('garbage\nnot\x1fenough'), []);
console.log('  ✓ only real commit ids are accepted; a missing file or odd input gives nothing');
// a workspace that is a folder inside a larger repository still works, with paths relative to the workspace
fs.mkdirSync(path.join(tmp, 'sub')); fs.writeFileSync(path.join(tmp, 'sub', 'n.md'), 'n\n'); git('add', '.'); git('commit', '-q', '-m', 'In sub');
const gs = createGitLog(() => path.join(tmp, 'sub'));
const ls = await gs.list('n.md'); assert.deepEqual(ls.map((c) => c.subject), ['In sub']); assert.equal(await gs.show('n.md', ls[0].hash), 'n\n');
console.log('  ✓ a workspace inside a larger repository uses paths relative to the workspace');
