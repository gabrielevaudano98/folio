// Folio — slide templates (the PowerPoint way): a template is a deck with theme tokens, fonts, masters with
// placeholders, colour variants and sample slides. Built-in templates ship with the app; your own live in the
// workspace folder Templates/. A deck uses one with `template: Templates/Name.slides`. Guide: docs/TEMPLATES.md.
import Folio from '../templates/Folio.slides.md';
import Graphite from '../templates/Graphite.slides.md';
import Editorial from '../templates/Editorial.slides.md';
import Swiss from '../templates/Swiss.slides.md';
import Corporate from '../templates/Corporate.slides.md';
import Studio from '../templates/Studio.slides.md';
import Mono from '../templates/Mono.slides.md';
import Pitch from '../templates/Pitch.slides.md';
import { parseFrontmatter, splitSlides, parseDeck, renderSlide, joinDeck, setGlobal, TOKENS } from './slides-core.js';

export const BUILTIN = [Folio, Graphite, Editorial, Swiss, Corporate, Studio, Mono, Pitch];
export const TEMPLATE_DIR = 'Templates';
const TOKEN_KEYS = ['paper', 'ink', 'muted', 'accent', 'card'];

/** name, description, tags and colour variants of a template */
export function templateInfo(text, fallback = 'Template') {
  const d = parseFrontmatter(text).data;
  const variants = Object.entries(d).filter(([k]) => k.startsWith('variant-')).map(([k, v]) => {
    const c = String(v).split(',').map((x) => x.trim()); return { name: k.slice(8).replace(/^./, (x) => x.toUpperCase()), tokens: Object.fromEntries(TOKEN_KEYS.map((t, i) => [t, c[i]]).filter(([, x]) => /^#[0-9a-f]{3,8}$/i.test(x || ''))) };
  });
  return { name: d['template-name'] || fallback, description: d['template-description'] || '', tags: String(d['template-tags'] || '').split(',').map((x) => x.trim()).filter(Boolean), variants, fonts: [d['heading-font'], d['body-font']].filter(Boolean) };
}
/** built-in templates plus the decks in the workspace's Templates folder */
export async function listTemplates(env) {
  const own = env.files.filter((f) => f.startsWith(TEMPLATE_DIR + '/') && /\.slides\.md$/i.test(f));
  const mine = await Promise.all(own.map(async (path) => { const text = await env.read(path).catch(() => ''); return { ...templateInfo(text, path.split('/').pop().replace(/\.slides\.md$/i, '')), text, path, builtin: false }; }));
  const builtins = BUILTIN.map((text) => ({ ...templateInfo(text), text, builtin: true }));
  // a workspace copy of a built-in replaces it in the list, so edits to it show
  const names = new Set(mine.map((t) => t.name.toLowerCase()));
  return [...mine, ...builtins.filter((t) => !names.has(t.name.toLowerCase()))];
}
/** where a template lives in the workspace (built-ins are copied there on first use) */
export const workspacePath = (t) => t.path || `${TEMPLATE_DIR}/${t.name.replace(/[\\/:*?"<>|]/g, '-')}.slides.md`;
export const refFor = (path) => path.replace(/\.md$/i, '');

/** a new deck that uses a template: linked for theme, fonts and masters, with copies of its sample slides */
export function newDeckFrom(t, title) {
  const fm = `---\nmarp: true\ntemplate: ${refFor(workspacePath(t))}\ntitle: ${title}\n---\n`;
  const samples = splitSlides(parseFrontmatter(t.text).body).filter((c) => !/<!--\s*master\b/.test(c));
  const first = samples[0] ? samples[0].replace(/^#[ \t]+.*$/m, () => `# ${title}`) : `\n# ${title}\n`;
  return joinDeck(fm, [first, ...samples.slice(1)].map((c) => '\n' + c.replace(/^\n+/, '')));
}
/** front matter keys that a template provides; applying a template removes them from the deck so the template shows */
export const DESIGN_KEYS = ['theme', ...Object.keys(TOKENS), 'fonts', 'backgroundColor', 'backgroundImage', 'color', 'size'];
export function applyTemplate(deckText, t) {
  const fm = parseFrontmatter(deckText); let raw = fm.raw || '---\nmarp: true\n---\n';
  for (const k of DESIGN_KEYS) raw = setGlobal(raw, k, null);
  raw = setGlobal(raw, 'template', refFor(workspacePath(t)));
  return joinDeck(raw, splitSlides(fm.body));
}
/** a template made from a deck: its effective design (including what it inherits), masters and a few sample slides */
export function templateFromDeck(deckText, { name, description = '', tags = '' }, templateText = null) {
  const deck = parseDeck(deckText, { template: templateText });
  const g = deck.global; const lines = ['---', 'marp: true', `template-name: ${name}`, `template-description: ${description}`, `template-tags: ${tags}`];
  for (const k of DESIGN_KEYS) if (g[k] != null && g[k] !== '') lines.push(`${k}: ${/^#/.test(g[k]) ? `"${g[k]}"` : g[k]}`);
  for (const [k, v] of Object.entries(g)) if (k.startsWith('variant-')) lines.push(`${k}: "${v}"`);
  if (g.paginate) lines.push(`paginate: ${g.paginate}`);
  lines.push('---', '');
  const masters = deck.masters.map((m) => m.src.replace(/^\n+/, ''));
  const samples = deck.shown.slice(0, 4).map((s) => s.src.replace(/^\n+/, ''));
  return lines.join('\n') + '\n' + [...masters, ...samples].map((c) => c.replace(/\n*$/, '\n')).join('\n---\n\n');
}
/** generic colour schemes and font pairs (PowerPoint's Variants) */
export const SCHEMES = [
  ['Grey', { paper: '#fcfcfc', ink: '#1f1f1f', muted: '#6b6b6b', accent: '#1f1f1f', card: '#f2f2f2' }],
  ['Night', { paper: '#161616', ink: '#f5f5f5', muted: '#a3a3a3', accent: '#ffffff', card: '#242424' }],
  ['Navy', { paper: '#ffffff', ink: '#1b2a3d', muted: '#5d6b7c', accent: '#1f4f8b', card: '#eef2f7' }],
  ['Forest', { paper: '#f6f7f2', ink: '#1d2a1f', muted: '#5f6b60', accent: '#2f6b3a', card: '#e8ede3' }],
  ['Terracotta', { paper: '#fbf7f4', ink: '#2a2522', muted: '#7a716b', accent: '#c4552b', card: '#f2e8e1' }],
  ['Plum', { paper: '#ffffff', ink: '#2b1a33', muted: '#6c5a73', accent: '#6b2d7a', card: '#f3ecf5' }],
  ['Ocean', { paper: '#f3f8f8', ink: '#13302e', muted: '#56706d', accent: '#0f766e', card: '#e2efed' }],
  ['Signal', { paper: '#ffffff', ink: '#111111', muted: '#5c5c5c', accent: '#e3120b', card: '#f1f1f1' }],
];
export const FONT_PAIRS = [['Inter', 'Inter'], ['Georgia', 'Georgia'], ['Georgia', 'Inter'], ['Helvetica Neue', 'Helvetica Neue'], ['Futura', 'Avenir Next'], ['Palatino', 'Helvetica Neue'], ['Courier New', 'Courier New'], ['Arial', 'Arial']];

/** small preview of a template: its title sample slide and first content slide */
export function previewHtml(t, w = 260) {
  const deck = parseDeck(t.text); const pick = [deck.shown.find((s) => s.layout === 'title') || deck.shown[0], deck.shown.find((s) => s.layout !== 'title' && s.layout !== 'section')].filter(Boolean);
  const k = w / deck.width;
  return pick.map((s) => `<span class="tp-slide" style="width:${w}px;height:${deck.height * k}px"><span class="sl-scale" style="transform:scale(${k})">${renderSlide(deck, s, { number: false })}</span></span>`).join('');
}
