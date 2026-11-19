// Folio — icons for slides (Lucide, ISC licence). Loaded on first use.
let nodes = null, tags = null;
async function load() { if (!nodes) nodes = (await import('lucide-static/icon-nodes.json')).default; return nodes; }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function iconSvg(name, sw = 2) {
  const all = await load(); const def = all[name];
  if (!def) return null;
  const body = def.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${esc(sw)}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
export async function hydrateIcons(root) {
  await Promise.all([...root.querySelectorAll('.sl-icon-svg[data-icon]')].map(async (el) => {
    el.innerHTML = (await iconSvg(el.dataset.icon, el.dataset.sw || 2)) || `<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="4" fill="none" stroke="currentColor" stroke-dasharray="3 3"/></svg>`;
  }));
}
/** icon names matching a query (name or tag), best first */
export async function searchIcons(q, limit = 120) {
  const all = await load();
  if (!tags) tags = (await import('lucide-static/tags.json')).default;
  const names = Object.keys(all); q = q.trim().toLowerCase();
  if (!q) return names.slice(0, limit);
  const score = (n) => (n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : (tags[n] || []).some((t) => t.startsWith(q)) ? 3 : (tags[n] || []).some((t) => t.includes(q)) ? 4 : 9);
  return names.map((n) => [n, score(n)]).filter(([, s]) => s < 9).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([n]) => n);
}
