// Folio — Design ideas (P9): rule-based layouts for the content of one slide. Pure text in, text out.
import { parseItems } from './slides-smartart.js';

const DIRECTIVE = /^[ \t]*<!--[\s\S]*?-->[ \t]*\n?/gm;
/** what a slide says, independent of how it is laid out */
export function analyse(chunk) {
  const comments = (chunk.match(DIRECTIVE) || []).filter((c) => !/layout\s*:/.test(c)).join('');
  const body = chunk.replace(DIRECTIVE, '');
  const lines = body.split('\n');
  const heading = lines.find((l) => /^\s*#{1,6}\s+\S/.test(l)) || '';
  const title = heading.replace(/^\s*#{1,6}\s+/, '').trim();
  const listText = lines.filter((l) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(l)).join('\n');
  const items = parseItems(listText);
  const images = [...body.matchAll(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)(?!\{)/g)].map((m) => ({ alt: m[1].replace(/^bg\b[^\]]*/i, '').trim(), src: m[2] }));
  const quote = lines.filter((l) => /^\s*>\s?/.test(l)).map((l) => l.replace(/^\s*>\s?/, '')).join(' ').trim();
  const prose = lines.filter((l) => l.trim() && !/^\s*(#|[-*+]\s|\d+[.)]\s|>|!\[|:::|```|\|)/.test(l)).map((l) => l.trim());
  const placed = /^\s*:::\s*(box|shape|line|icon|media|path|smartart)\b/m.test(body);
  return { comments, title, items, images, quote, prose, placed, body };
}
const list = (items, d = 0) => items.map((it) => `${'  '.repeat(d)}- ${it.text}\n${list(it.children, d + 1)}`).join('');
const head = (a, lvl = '##') => (a.title ? `${lvl} ${a.title}\n\n` : '');

/** up to `max` alternative versions of a slide: [{ id, label, chunk }] */
export function designIdeas(chunk, { width = 1280, height = 720, max = 8 } = {}) {
  const a = analyse(chunk); const out = [];
  const add = (id, label, body) => { const c = `\n${a.comments}${body.replace(/\n*$/, '')}\n`; if (c.replace(/\s/g, '') !== chunk.replace(/\s/g, '')) out.push({ id, label, chunk: c }); };
  const W = width - 176, top = a.title ? 200 : 110, H = height - top - 90;
  const sa = (type, h = H) => `::: smartart type=${type} x=88 y=${top} w=${W} h=${Math.round(h)}\n${list(a.items)}:::`;
  const n = a.items.length; const dated = n >= 2 && a.items.every((it) => /^(\d{4}|q[1-4]|[a-z]{3,9}\.?\s+\d{4}|\d{1,2}[/.-]\d{1,2})\b.*?:/i.test(it.text));
  const hasKids = a.items.some((it) => it.children.length);
  if (a.placed) return out;
  if (n >= 2 && n <= 8 && !a.quote) {
    if (dated) add('timeline', 'Timeline', head(a) + sa('timeline'));
    if (n <= 6) add('cards', 'Cards', `<!-- layout: cards -->\n${head(a)}${a.items.map((it) => `::: card\n### ${it.text}\n${it.children.map((c) => c.text).join('\n')}\n:::`).join('\n\n')}`);
    if (n <= 6) add('process', 'Process', head(a) + sa('process', Math.min(H, 260)));
    if (n <= 7) add('chevron', 'Steps', head(a) + sa('chevron', Math.min(H, 160)));
    if (n >= 3 && n <= 6) add('cycle', 'Cycle', head(a) + sa('cycle'));
    if (hasKids) add('hierarchy', 'Hierarchy', head(a) + sa('hierarchy'));
    if (n === 4) add('matrix', 'Matrix', head(a) + sa('matrix'));
    if (n >= 3 && n <= 6) add('pyramid', 'Pyramid', head(a) + sa('pyramid'));
    if (n >= 3 && n <= 6) add('funnel', 'Funnel', head(a) + sa('funnel'));
    if (n === 2 || n === 3) add('venn', 'Overlap', head(a) + sa('venn'));
    if (n >= 4) { const half = Math.ceil(n / 2); add('columns', 'Two columns', `<!-- layout: two-columns -->\n${head(a)}::: left\n${list(a.items.slice(0, half))}:::\n\n::: right\n${list(a.items.slice(half))}:::`); }
    add('stack', 'Stacked bars', head(a) + sa('stack'));
  }
  if (a.images.length) {
    const img = a.images[0]; const text = [a.title ? `## ${a.title}` : '', a.items.length ? list(a.items) : a.prose.join('\n\n')].filter(Boolean).join('\n\n');
    add('image-right', 'Picture on the right', `![bg right:45%](${img.src})\n\n${text}`);
    add('image-left', 'Picture on the left', `![bg left:45%](${img.src})\n\n${text}`);
    add('full-bleed', 'Full-bleed picture', `<!-- _class: invert -->\n![bg brightness:.45](${img.src})\n\n${a.title ? `# ${a.title}` : ''}${a.prose.length ? `\n\n${a.prose[0]}` : ''}`);
  }
  if (a.quote) add('quote', 'Quote', `<!-- layout: quote -->\n> ${a.quote}${a.prose.length ? `\n\n${a.prose.join(' ')}` : ''}`);
  if (/^[\s€$£¥+-]*\d[\d.,]*\s*[%kKmMbB]?\b/.test(a.title)) add('big-number', 'Big number', `<!-- layout: big-number -->\n# ${a.title}\n\n${a.prose[0] || a.items[0]?.text || ''}`);
  if (a.title && !n && !a.images.length && !a.quote) {
    add('title', 'Title slide', `<!-- layout: title -->\n# ${a.title}${a.prose.length ? `\n\n${a.prose.join('\n\n')}` : ''}`);
    add('section', 'Section divider', `<!-- layout: section -->\n# ${a.title}`);
  }
  return out.slice(0, max);
}

/** building blocks: ready slides for common needs */
export const BLOCKS = [
  ['agenda', 'Agenda', '## Agenda\n\n::: smartart type=stack x=88 y=190 w=1104 h=440\n- Where we are\n- What we learned\n- What we propose\n- Next steps\n:::'],
  ['timeline', 'Timeline', '## Roadmap\n\n::: smartart type=timeline x=88 y=200 w=1104 h=420\n- Q1 2027: Discovery\n- Q2 2027: Pilot\n- Q3 2027: Launch\n- Q4 2027: Scale\n:::'],
  ['process', 'Process', '## How it works\n\n::: smartart type=chevron x=88 y=260 w=1104 h=180\n- Collect\n- Analyse\n- Decide\n- Act\n:::'],
  ['comparison', 'Comparison', '<!-- layout: two-columns -->\n## Option A or option B\n\n::: left\n### Option A\n- Faster to ship\n- Lower cost\n:::\n\n::: right\n### Option B\n- More flexible\n- Scales further\n:::'],
  ['swot', 'SWOT', '## SWOT\n\n::: smartart type=matrix x=88 y=180 w=1104 h=470\n- Strengths\n  - What we do well\n- Weaknesses\n  - Where we fall short\n- Opportunities\n  - What we can use\n- Threats\n  - What could hurt us\n:::'],
  ['team', 'Team', '## Team\n\n::: smartart type=hierarchy x=88 y=180 w=1104 h=460\n- Head of product\n  - Design lead\n  - Engineering lead\n    - Frontend\n    - Backend\n  - Research lead\n:::'],
  ['pricing', 'Pricing', '<!-- layout: cards -->\n## Pricing\n\n::: card\n### Starter\n€9 a month\n:::\n\n::: card\n### Team\n€29 a month\n:::\n\n::: card\n### Business\nTalk to us\n:::'],
  ['kpis', 'Key numbers', '## Key numbers\n\n::: box #k1 x=88 y=230 w=330 h=260 fill=#f2f2f2 radius=16 align=center valign=middle\n# 42%\nGrowth\n:::\n\n::: box #k2 x=475 y=230 w=330 h=260 fill=#f2f2f2 radius=16 align=center valign=middle\n# 1.2M\nUsers\n:::\n\n::: box #k3 x=862 y=230 w=330 h=260 fill=#f2f2f2 radius=16 align=center valign=middle\n# 4.8\nRating\n:::'],
];
