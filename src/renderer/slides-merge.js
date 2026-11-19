// Folio — merge shapes (P6): union, intersect, subtract and combine placed objects into one free shape.
// Outlines come from the rendered SVG of each object, sampled into polygons; polygon-clipping (MIT) does the maths.
import polygonClipping from 'polygon-clipping';
import { geometry, parsePoints, pointsPath } from './slides-objects.js';
import { shapeSvg } from './board-core.js';

const NS = 'http://www.w3.org/2000/svg';
function sampleSvg(markup, w, h, steps = 64) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.style.cssText = 'position:fixed;left:-9999px;top:0;width:10px;height:10px;visibility:hidden';
  svg.innerHTML = markup; document.body.appendChild(svg);
  const rings = [];
  try {
    for (const el of svg.querySelectorAll('rect, ellipse, circle, polygon, path')) {
      if (el.classList.contains('b-line')) continue;
      const tag = el.tagName.toLowerCase(); const n = (k) => parseFloat(el.getAttribute(k)) || 0;
      if (tag === 'rect') { const x = n('x'), y = n('y'), ww = n('width'), hh = n('height'); rings.push([[x, y], [x + ww, y], [x + ww, y + hh], [x, y + hh]]); continue; }
      if (tag === 'ellipse' || tag === 'circle') { const cx = n('cx'), cy = n('cy'), rx = tag === 'circle' ? n('r') : n('rx'), ry = tag === 'circle' ? n('r') : n('ry'); rings.push(Array.from({ length: steps }, (_, i) => [cx + rx * Math.cos((i / steps) * 2 * Math.PI), cy + ry * Math.sin((i / steps) * 2 * Math.PI)])); continue; }
      if (tag === 'polygon') { rings.push(el.getAttribute('points').trim().split(/[\s]+/).map((p) => p.split(',').map(Number))); continue; }
      const len = el.getTotalLength(); if (!len) continue;
      const ring = []; for (let i = 0; i < steps * 2; i++) { const p = el.getPointAtLength((i / (steps * 2)) * len); ring.push([p.x, p.y]); }
      rings.push(ring);
    }
  } finally { svg.remove(); }
  return rings.filter((r) => r.length >= 3);
}
const rotate = (pts, g) => {
  if (!g.rotate) return pts;
  const a = (g.rotate * Math.PI) / 180, cx = g.x + g.w / 2, cy = g.y + g.h / 2;
  return pts.map(([x, y]) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)]);
};
/** an object's outline as a MultiPolygon in slide space */
export function outline(o) {
  const g = geometry(o); const a = o.attrs; let rings;
  if (o.kind === 'shape') rings = sampleSvg(shapeSvg({ shape: a.type || 'rect', w: g.w, h: g.h, style: {} }), g.w, g.h).map((r) => r.map(([x, y]) => [g.x + x, g.y + y]));
  else if (o.kind === 'path') {
    const d = a.d || pointsPath(parsePoints(a.points), true, a.smooth === 'true');
    rings = sampleSvg(`<path d="${String(d).replace(/[^MLCZQHVmlczqhv\d.,\s-]/g, '')}"/>`, 1, 1, 96).map((r) => r.map(([x, y]) => [g.x + x * g.w, g.y + y * g.h]));
  } else rings = [[[g.x, g.y], [g.x + g.w, g.y], [g.x + g.w, g.y + g.h], [g.x, g.y + g.h]]];
  rings = rings.map((r) => rotate(r, g)).map((r) => [...r, r[0]]);
  // separate outlines of one shape are unioned (a cylinder is a body plus a lid)
  return rings.length > 1 ? polygonClipping.union(...rings.map((r) => [r])) : [[rings[0]]];
}
/** op: union | intersection | difference | xor; the first object is the base for difference */
export function merge(objs, op) {
  const polys = objs.map(outline);
  const res = polygonClipping[op](...polys);
  return res.filter((p) => p.length && p[0].length >= 4);
}
