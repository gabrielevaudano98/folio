#!/usr/bin/env node
// Development checkpoint: so a new work session never starts from zero.
//
//   node scripts/checkpoint.mjs "what was done"        commit everything as a WIP commit and write the bundle
//   node scripts/checkpoint.mjs --restore <file>       in a fresh clone: bring the branch back from a bundle
//
// What it leaves behind:
//   1. a commit on the current branch ("wip: …"), so work survives a crash of the editor or the shell;
//   2. <out>/folio-<branch>.bundle: every commit of the branch that is not on origin/main, in one file that
//      `git fetch` reads (default <out> = /mnt/user-data/outputs, else ./release);
//   3. docs/HANDOFF.md, refreshed: branch, last commits, what to run to resume. Edit its "Next" section by hand.
//   4. the branch pushed to origin (never main), unless --no-push or there is no access; a failed push is reported, not fatal.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const root = git('rev-parse', '--show-toplevel');
process.chdir(root);

if (process.argv[2] === '--restore') {
  const file = path.resolve(process.argv[3] || '');
  if (!fs.existsSync(file)) { console.error('Bundle not found:', file); process.exit(1); }
  git('bundle', 'verify', file);
  const heads = git('bundle', 'list-heads', file).split('\n').map((l) => l.split(' ')[1]).filter(Boolean);
  for (const ref of heads) {
    const branch = ref.replace(/^refs\/heads\//, '');
    git('fetch', file, `${ref}:${branch}`);
    console.log('restored', branch);
  }
  console.log('Next: git checkout <branch> && npm ci && npm run build && npm test');
  process.exit(0);
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch === 'main') { console.error('On main: create a branch first (git checkout -b feat/…).'); process.exit(1); }
const args = process.argv.slice(2); const noPush = args.includes('--no-push');
const msg = args.filter((a) => a !== '--no-push').join(' ').trim() || 'checkpoint';

// 1. handoff note (written first, so it is part of the commit)
const base = (() => { try { return git('merge-base', 'HEAD', 'origin/main'); } catch { return git('rev-list', '--max-parents=0', 'HEAD').split('\n')[0]; } })();
const handoff = path.join(root, 'docs', 'HANDOFF.md');
const prev = fs.existsSync(handoff) ? fs.readFileSync(handoff, 'utf8') : '';
const keep = /## Next\n([\s\S]*?)(?=\n## |$)/.exec(prev)?.[1]?.trim() || '- (write the next steps here)';
const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const write = (log) => fs.writeFileSync(handoff, `# Handoff — where work stands

Written by \`node scripts/checkpoint.mjs\` (${now}). Read this first when resuming.

- Branch: \`${branch}\` (from \`origin/main\` at \`${base.slice(0, 9)}\`)
- Last checkpoint: ${msg}

## Resume in a new session

1. Get the code: \`git fetch origin ${branch} && git checkout ${branch}\` (pushed at every checkpoint); without access to
   GitHub, a clone plus the bundle \`folio-${branch.replace(/\//g, '-')}.bundle\`
   (sent in the chat, or saved in the Project / your folder), then \`node scripts/checkpoint.mjs --restore <bundle>\`.
2. \`git checkout ${branch} && npm ci && npm run build\`
3. Check that everything is green: \`npm test\` (or the Sheets tests alone: \`node dist/test/sheets.test.mjs\` and the others in \`test/run.mjs\`).
4. Read \`docs/sheets/README.md\` (architecture and status) and the section below.

## Next
${keep}

## Commits since main
${log}
`);
write('(see git log)');
git('add', '-A');
const dirty = git('status', '--porcelain');
if (dirty) git('commit', '-q', '-m', `wip: ${msg}`, '-m', process.env.CHECKPOINT_TRAILER || 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01K2yBX8CsEz4eLBFwDbHvqa');
const log = git('log', '--oneline', `${base}..HEAD`) || '(none)';
write(log.split('\n').map((l) => `- ${l}`).join('\n'));
git('add', 'docs/HANDOFF.md');
if (git('status', '--porcelain')) git('commit', '-q', '--amend', '--no-edit');

// 2. bundle
const outDir = process.env.CHECKPOINT_DIR || (fs.existsSync('/mnt/user-data/outputs') ? '/mnt/user-data/outputs' : path.join(root, 'release'));
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `folio-${branch.replace(/\//g, '-')}.bundle`);
git('bundle', 'create', file, `${base}..${branch}`, branch);
git('bundle', 'verify', file);
const mb = (fs.statSync(file).size / 1048576).toFixed(1);
let pushed = 'skipped';
if (!noPush) { try { execFileSync('git', ['-c', 'push.negotiate=true', 'push', '-u', 'origin', branch], { stdio: 'pipe' }); pushed = `origin/${branch}`; } catch (e) { pushed = 'failed: ' + String(e.stderr || e.message).split('\n').filter(Boolean).slice(-1)[0]; } }
console.log(JSON.stringify({ branch, commit: git('rev-parse', '--short', 'HEAD'), bundle: file, size: `${mb} MB`, handoff: 'docs/HANDOFF.md', pushed }));
