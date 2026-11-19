// Creates labels, milestones and roadmap issues on GitHub from .github/roadmap.json.
// Safe to run again: it skips what already exists. Needs GITHUB_TOKEN (or GH_TOKEN) with repo scope.
//   GITHUB_TOKEN=... node scripts/seed-issues.mjs gabrielevaudano98/folio
import fs from 'node:fs';

const repo = process.argv[2] || 'gabrielevaudano98/folio';
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!token) { console.error('Set GITHUB_TOKEN'); process.exit(1); }
const api = async (method, url, body) => {
  const res = await fetch(`https://api.github.com/repos/${repo}${url}`, { method, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok && res.status !== 422) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
};
const plan = JSON.parse(fs.readFileSync(new URL('../.github/roadmap.json', import.meta.url)));
for (const [name, color, description] of plan.labels) await api('POST', '/labels', { name, color, description });
const existingMs = await api('GET', '/milestones?state=all&per_page=100');
const ms = Object.fromEntries(existingMs.map((m) => [m.title, m.number]));
for (const [title, description] of plan.milestones) if (!ms[title]) ms[title] = (await api('POST', '/milestones', { title, description })).number;
const existing = new Set();
for (let page = 1; ; page++) { const list = await api('GET', `/issues?state=all&per_page=100&page=${page}`); list.forEach((i) => existing.add(i.title)); if (list.length < 100) break; }
let made = 0;
for (const [milestone, title, labels, body] of plan.issues) {
  if (existing.has(title)) continue;
  await api('POST', '/issues', { title, body: `${body}\n\n_Roadmap item, milestone ${milestone}._`, labels, milestone: ms[milestone] });
  made++;
}
console.log(`Created ${made} issues (${plan.issues.length - made} already existed).`);
