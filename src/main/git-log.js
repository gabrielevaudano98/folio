// Folio — the Git commits that touched a page, for the version timeline (D15 leftover). Read-only: `git log` and
// `git show` through execFile (no shell, fixed arguments), only for a path the workspace resolves, only for a real hash.
// A workspace that is not a Git repository, or a machine without git, simply has no commits to show.
import { execFile } from 'node:child_process';

const SEP = '\x1f';
export const parseLog = (out) => String(out || '').split('\n').filter(Boolean).map((l) => {
  const [hash, author, ct, subject] = l.split(SEP);
  return { hash, author: author || 'Git', t: Number(ct) * 1000, subject: subject || '' };
}).filter((c) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(c.hash) && Number.isFinite(c.t));
export const validHash = (h) => /^[0-9a-f]{7,64}$/.test(String(h));

export function createGitLog(getRoot, run = (args, cwd) => new Promise((resolve, reject) => execFile('git', args, { cwd, timeout: 8000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } }, (e, stdout) => (e ? reject(e) : resolve(stdout))))) {
  const inside = async (root) => { try { return (await run(['rev-parse', '--is-inside-work-tree'], root)).trim() === 'true'; } catch { return false; } };
  return {
    /** the latest commits that changed `rel` (path relative to the workspace), newest first */
    async list(rel, limit = 60) {
      const root = getRoot(); if (!root || !rel || !(await inside(root))) return [];
      try { return parseLog(await run(['-c', 'core.quotepath=off', 'log', `--max-count=${Math.min(200, limit)}`, `--format=%H${SEP}%an${SEP}%ct${SEP}%s`, '--', `./${rel}`], root)); } catch { return []; }
    },
    /** the page as it was in that commit, or null */
    async show(rel, hash) {
      const root = getRoot(); if (!root || !rel || !validHash(hash)) return null;
      try { return await run(['show', `${hash}:./${rel}`], root); } catch { return null; }
    },
  };
}
