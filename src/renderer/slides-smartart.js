// Folio — SmartArt-style diagrams (P9). The body is a Markdown list; the type decides the drawing.
//   ::: smartart #id type=process x=80 y=200 w=1120 h=300
//   - Research
//   - Design
//     - with users
//   - Build
//   :::
// Pure: returns HTML (an SVG for shapes and arrows, positioned HTML for wrapped text).

export const SMART_TYPES = [
  ['process', 'Process'], ['chevron', 'Chevron steps'], ['cycle', 'Cycle'], ['timeline', 'Timeline'],
  ['hierarchy', 'Hierarchy'], ['pyramid', 'Pyramid'], ['funnel', 'Funnel'], ['matrix', 'Matrix 2×2'],
  ['venn', 'Venn'], ['list', 'Cards'], ['stack', 'Stacked list'],
];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** inline Markdown that is safe to show in a label: **bold**, *italic*, `code` */
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>');

/** Markdown list → tree [{ text, children }] (any list marker, indentation by spaces or tabs) */
export function parseItems(body) {
  const root = { children: [], depth: -1 }; const stack = [root];
  for (const raw of String(body || '').split('\n')) {
    const m = raw.replace(/\t/g, '  ').match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (!m) continue;
    const depth = m[1].length; const node = { text: m[2].trim(), children: [], depth };
    while (stack.length > 1 && stack.at(-1).depth >= depth) stack.pop();
    stack.at(-1).children.push(node); stack.push(node);
  }
  return root.children;
}

const tone = (i, n) => `color-mix(in oklch, var(--sm-c) ${Math.round(100 - (i / Math.max(1, n - 1)) * 55)}%, var(--sl-bg))`;
const ink = (i, n) => (100 - (i / Math.max(1, n - 1)) * 55 > 55 ? 'var(--sl-bg)' : 'var(--sl-ink)');
const label = (x, y, w, h, html, { color = 'var(--sl-ink)', align = 'center', size, sub = [], valign } = {}) =>
  `<div class="sm-label" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;color:${color};text-align:${align};${size ? `font-size:${size}px;` : ''}${valign ? `align-items:${valign};` : align === 'left' ? 'align-items:flex-start;' : ''}"><div>${html}${sub.length ? `<ul>${sub.map((c) => `<li>${inline(c.text)}</li>`).join('')}</ul>` : ''}</div></div>`;
const fit = (w, h, n, base = 28) => Math.max(12, Math.min(base, Math.floor(Math.min(w / 7, h / 3.2) / Math.max(1, Math.sqrt(n) * 0.6))));

/** render a diagram into a w×h box */
export function smartArt(type, body, w, h, { size } = {}) {
  const items = parseItems(body); const n = items.length;
  if (!n) return `<div class="sm-empty">Add list items to draw a ${esc(type)} diagram.</div>`;
  let svg = ''; let labels = '';
  const S = (k) => size || fit(w, h, n, k);
  const arrow = (x1, y1, x2, y2) => { const a = Math.atan2(y2 - y1, x2 - x1), L = 12, W = 7; const p = (dx, dy) => `${x2 - Math.cos(a) * dx + Math.sin(a) * dy},${y2 - Math.sin(a) * dx - Math.cos(a) * dy}`; return `<line x1="${x1}" y1="${y1}" x2="${x2 - Math.cos(a) * L}" y2="${y2 - Math.sin(a) * L}" class="sm-line"/><polygon points="${x2},${y2} ${p(L, W)} ${p(L, -W)}" class="sm-head"/>`; };
  if (type === 'process' || type === 'list' || type === 'stack') {
    if (type === 'stack') {
      const gap = 10, bh = (h - gap * (n - 1)) / n;
      items.forEach((it, i) => { const y = i * (bh + gap); svg += `<rect x="0" y="${y}" width="${w}" height="${bh}" rx="10" style="fill:${tone(i, n)}"/>`; labels += label(16, y, w - 32, bh, `<b>${inline(it.text)}</b>`, { color: ink(i, n), align: 'left', size: S(26), sub: it.children }); });
    } else {
      const gap = type === 'process' ? Math.min(60, w / (n * 4)) : 18, bw = (w - gap * (n - 1)) / n;
      items.forEach((it, i) => {
        const x = i * (bw + gap);
        svg += `<rect x="${x}" y="0" width="${bw}" height="${h}" rx="14" style="fill:${type === 'list' ? 'color-mix(in oklch, var(--sm-c) 10%, var(--sl-bg))' : tone(i, n)}"${type === 'list' ? ' class="sm-card"' : ''}/>`;
        if (type === 'process' && i < n - 1) svg += arrow(x + bw + 6, h / 2, x + bw + gap - 6, h / 2);
        labels += label(x + 10, 0, bw - 20, h, `<b>${inline(it.text)}</b>`, { color: type === 'list' ? 'var(--sl-ink)' : ink(i, n), size: S(28), sub: it.children, align: type === 'list' ? 'left' : 'center' });
      });
    }
  } else if (type === 'chevron') {
    const tip = Math.min(h * 0.35, w / n / 3), bw = (w + tip * (n - 1)) / n - 0;
    items.forEach((it, i) => {
      const x = i * (bw - tip + 6); const x2 = x + bw;
      const pts = i === 0 ? `${x},0 ${x2 - tip},0 ${x2},${h / 2} ${x2 - tip},${h} ${x},${h}` : `${x},0 ${x2 - tip},0 ${x2},${h / 2} ${x2 - tip},${h} ${x},${h} ${x + tip},${h / 2}`;
      svg += `<polygon points="${pts}" style="fill:${tone(i, n)}"/>`;
      labels += label(x + (i ? tip : 8), 0, bw - tip - (i ? tip : 8), h, `<b>${inline(it.text)}</b>`, { color: ink(i, n), size: S(26) });
    });
  } else if (type === 'cycle') {
    const cx = w / 2, cy = h / 2, m0 = Math.min(w, h), r = Math.min(m0 * 0.16, (Math.PI * (m0 / 2 - m0 * 0.16)) / n * 0.62), R = m0 / 2 - r;
    items.forEach((it, i) => {
      const a = -Math.PI / 2 + (i / n) * 2 * Math.PI, x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
      const a2 = -Math.PI / 2 + ((i + 1) / n) * 2 * Math.PI; const da = Math.asin(Math.min(1, (r + 8) / R)) * 1.2;
      const s = [cx + R * Math.cos(a + da), cy + R * Math.sin(a + da)], e = [cx + R * Math.cos(a2 - da), cy + R * Math.sin(a2 - da)];
      svg += `<path d="M${s[0]},${s[1]} A${R},${R} 0 0 1 ${e[0]},${e[1]}" class="sm-line" fill="none"/>`;
      const ang = a2 - da + Math.PI / 2; const L = 12, W = 7;
      svg += `<polygon points="${e[0]},${e[1]} ${e[0] - Math.cos(ang) * L + Math.sin(ang) * W},${e[1] - Math.sin(ang) * L - Math.cos(ang) * W} ${e[0] - Math.cos(ang) * L - Math.sin(ang) * W},${e[1] - Math.sin(ang) * L + Math.cos(ang) * W}" class="sm-head"/>`;
      svg += `<circle cx="${x}" cy="${y}" r="${r}" style="fill:${tone(i, n)}"/>`;
      labels += label(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8, `<b>${inline(it.text)}</b>`, { color: ink(i, n), size: size || Math.max(12, Math.min(24, r / 3.2)) });
    });
  } else if (type === 'timeline') {
    const y0 = h / 2; svg += `<line x1="0" y1="${y0}" x2="${w}" y2="${y0}" class="sm-line"/>`;
    const step = w / n;
    items.forEach((it, i) => {
      const x = step * i + step / 2; const up = i % 2 === 0; const [when, ...what] = it.text.split(/:\s+/);
      svg += `<circle cx="${x}" cy="${y0}" r="9" style="fill:${tone(i, n)}" class="sm-dot"/><line x1="${x}" y1="${y0 + (up ? -12 : 12)}" x2="${x}" y2="${y0 + (up ? -34 : 34)}" class="sm-line"/>`;
      labels += label(x - step / 2 + 6, up ? 0 : y0 + 38, step - 12, y0 - 40, what.length ? `<b>${inline(when)}</b><br>${inline(what.join(': '))}` : `<b>${inline(it.text)}</b>`, { size: S(26), sub: it.children, valign: up ? 'flex-end' : 'flex-start' });
    });
  } else if (type === 'hierarchy') {
    const levels = []; const walk = (nodes, d) => nodes.forEach((nd) => { (levels[d] ||= []).push(nd); nd.leafs = 0; walk(nd.children, d + 1); });
    walk(items, 0);
    const leafs = (nd) => (nd.leafs = nd.children.length ? nd.children.reduce((s, c) => s + leafs(c), 0) : 1);
    const total = items.reduce((s, nd) => s + leafs(nd), 0);
    const D = levels.length, gapY = 36, bh = Math.min(110, (h - gapY * (D - 1)) / D), unit = w / total;
    const place = (nodes, x0, d) => { let x = x0; for (const nd of nodes) { const span = nd.leafs * unit; nd.x = x + span / 2; nd.y = d * (bh + gapY); place(nd.children, x, d + 1); x += span; } };
    place(items, 0, 0);
    const bw = Math.min(220, unit * 0.88);
    const draw = (nodes, parent) => nodes.forEach((nd) => {
      if (parent) svg += `<path d="M${parent.x},${parent.y + bh} V${parent.y + bh + gapY / 2} H${nd.x} V${nd.y}" class="sm-line" fill="none"/>`;
      const i = Math.min(levels.length - 1, Math.round(nd.y / (bh + gapY)));
      svg += `<rect x="${nd.x - bw / 2}" y="${nd.y}" width="${bw}" height="${bh}" rx="10" style="fill:${tone(i, Math.max(2, D))}"/>`;
      labels += label(nd.x - bw / 2 + 6, nd.y, bw - 12, bh, inline(nd.text), { color: ink(i, Math.max(2, D)), size: size || Math.max(12, Math.min(22, bw / 9)) });
      draw(nd.children, nd);
    });
    draw(items, null);
  } else if (type === 'pyramid' || type === 'funnel') {
    const gap = 6, lh = (h - gap * (n - 1)) / n;
    items.forEach((it, i) => {
      const k0 = type === 'pyramid' ? i / n : 1 - i / n, k1 = type === 'pyramid' ? (i + 1) / n : 1 - (i + 1) / n;
      const minW = type === 'funnel' ? 0.18 : 0; const wa = Math.max(minW, k0) * w, wb = Math.max(minW, k1) * w; const y = i * (lh + gap);
      svg += `<polygon points="${(w - wa) / 2},${y} ${(w + wa) / 2},${y} ${(w + wb) / 2},${y + lh} ${(w - wb) / 2},${y + lh}" style="fill:${tone(i, n)}"/>`;
      const mid = Math.max(w * 0.22, (wa + wb) / 2 * (type === 'pyramid' && i === 0 ? 0.9 : 0.7)); const top = type === 'pyramid' && i === 0 ? lh * 0.4 : 0;
      labels += label((w - mid) / 2, y + top, mid, lh - top, `<b>${inline(it.text)}</b>`, { color: ink(i, n), size: Math.min(S(24), type === 'pyramid' && i === 0 ? Math.max(12, lh / 3) : 99) });
    });
  } else if (type === 'matrix') {
    const g = 10, cw = (w - g) / 2, ch = (h - g) / 2;
    items.slice(0, 4).forEach((it, i) => {
      const x = (i % 2) * (cw + g), y = Math.floor(i / 2) * (ch + g);
      svg += `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="12" style="fill:${tone(i, 4)}"/>`;
      labels += label(x + 14, y, cw - 28, ch, `<b>${inline(it.text)}</b>`, { color: ink(i, 4), size: S(24), sub: it.children });
    });
  } else if (type === 'venn') {
    const k = Math.min(3, n); const r = Math.min(h / 2.1, w / (k + 1.2)); const cy = h / 2;
    const xs = k === 1 ? [w / 2] : k === 2 ? [w / 2 - r * 0.55, w / 2 + r * 0.55] : [w / 2 - r * 0.6, w / 2 + r * 0.6, w / 2];
    const ys = k === 3 ? [cy - r * 0.3, cy - r * 0.3, cy + r * 0.55] : xs.map(() => cy);
    if (k === 3) { const r2 = Math.min(h / 3.1, w / 4.2); xs.splice(0, 3, w / 2 - r2 * 0.6, w / 2 + r2 * 0.6, w / 2); ys.splice(0, 3, h / 2 - r2 * 0.35, h / 2 - r2 * 0.35, h / 2 + r2 * 0.6); items.slice(0, 3).forEach((it, i) => { svg += `<circle cx="${xs[i]}" cy="${ys[i]}" r="${r2}" style="fill:${tone(i, 3)};fill-opacity:.55"/>`; labels += label(xs[i] - r2 * 0.75 + (i === 0 ? -r2 * 0.3 : i === 1 ? r2 * 0.3 : 0), ys[i] - r2 * 0.4 + (i === 2 ? r2 * 0.3 : -r2 * 0.1), r2 * 1.5, r2 * 0.8, `<b>${inline(it.text)}</b>`, { size: S(22) }); }); }
    else items.slice(0, k).forEach((it, i) => { svg += `<circle cx="${xs[i]}" cy="${ys[i]}" r="${r}" style="fill:${tone(i, 2)};fill-opacity:.55"/>`; labels += label(xs[i] - r * 0.7 + (k === 2 ? (i ? r * 0.25 : -r * 0.25) : 0), cy - r * 0.4, r * 1.4, r * 0.8, `<b>${inline(it.text)}</b>`, { size: S(24) }); });
    if (n > k && items[k]) labels += label(w / 2 - r * 0.4, h / 2 - 20, r * 0.8, 40, `<i>${inline(items[k].text)}</i>`, { size: S(18) });
  } else return smartArt('process', body, w, h, { size });
  return `<svg class="sm-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${svg}</svg>${labels}`;
}
