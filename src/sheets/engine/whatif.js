// Folio Sheets — what-if analysis and simulation (area 23). Every method works on a headless copy of the workbook
// (headless.js: the same Univer formula engine as the grid), so the window never freezes and the file is not touched
// until the person applies a result.
//
//   goalSeek    change one input cell until a formula cell reaches a target (secant steps, then bisection)
//   dataTable   one or two inputs × a list of values → the outputs, like Excel's Data Table
//   scenarios   named sets of input values → the result cells under each, like Scenario Manager's summary
//   simulate    Monte Carlo: inputs drawn from distributions, outputs summarised (mean, sd, percentiles, histogram)
import { splitRef } from '../core/a1.js';

const num = (v) => (typeof v === 'number' ? v : Number(v));
const fin = (v) => Number.isFinite(num(v));
const ref = (r, active) => { const { sheet, range } = splitRef(r); return { sheet: sheet || active, range: range.replace(/\$/g, '') }; };

async function reader(wb, active) {
  return {
    get: (r) => { const p = ref(r, active); return wb.values(p.sheet, p.range)[0][0]; },
    async set(values) { for (const [r, v] of Object.entries(values)) { const p = ref(r, active); wb.set(p.sheet, p.range, v); } await wb.settle(); },
  };
}

export async function goalSeek(H, data, { set, to, by, active, maxIter = 100, tol = 1e-7 }) {
  const wb = await H.open(data);
  try {
    const io = await reader(wb, active);
    const f = async (x) => { await io.set({ [by]: x }); const y = num(io.get(set)); if (!fin(y)) throw new Error(`${set} does not give a number when ${by} is ${x}.`); return y - num(to); };
    let x0 = num(io.get(by)); if (!fin(x0)) x0 = 0;
    let x1 = x0 === 0 ? 1 : x0 * 1.1;
    let f0 = await f(x0), f1 = await f(x1), steps = 2;
    let lo = null, hi = null; // a bracket, once the sign changes
    const keep = (x, y) => { if (y <= 0 && (lo == null || y > lo.y)) lo = { x, y }; if (y >= 0 && (hi == null || y < hi.y)) hi = { x, y }; };
    keep(x0, f0); keep(x1, f1);
    while (steps < maxIter && Math.abs(f1) > tol * Math.max(1, Math.abs(num(to)))) {
      let x2 = f1 === f0 ? x1 + (x1 - x0 || 1) : x1 - f1 * (x1 - x0) / (f1 - f0);
      if (lo && hi && (!fin(x2) || x2 < Math.min(lo.x, hi.x) || x2 > Math.max(lo.x, hi.x))) x2 = (lo.x + hi.x) / 2;
      if (!fin(x2)) break;
      const f2 = await f(x2); steps++; keep(x2, f2);
      [x0, f0, x1, f1] = [x1, f1, x2, f2];
    }
    const found = Math.abs(f1) <= tol * Math.max(1, Math.abs(num(to))) * 10;
    return { found, value: x1, result: f1 + num(to), steps, message: found ? '' : `No exact solution found after ${steps} tries; the closest is shown.` };
  } finally { H.close(wb); }
}

/** rowInput/colInput: cells; rowValues/colValues: lists; outputs: formula cells (one-variable) */
export async function dataTable(H, data, { active, colInput, colValues = [], rowInput = null, rowValues = [], outputs = [] }) {
  const wb = await H.open(data);
  try {
    const io = await reader(wb, active);
    if (!rowInput) {
      const grid = [[colInput, ...outputs]];
      for (const v of colValues) { await io.set({ [colInput]: v }); grid.push([v, ...outputs.map((o) => io.get(o))]); }
      return { grid };
    }
    const out = outputs[0];
    const grid = [[out, ...rowValues]];
    for (const cv of colValues) { const row = [cv]; for (const rv of rowValues) { await io.set({ [colInput]: cv, [rowInput]: rv }); row.push(io.get(out)); } grid.push(row); }
    return { grid };
  } finally { H.close(wb); }
}

export async function scenarios(H, data, { active, list, results }) {
  const wb = await H.open(data);
  try {
    const io = await reader(wb, active);
    const inputs = [...new Set(list.flatMap((s) => Object.keys(s.cells)))];
    const current = Object.fromEntries(inputs.map((c) => [c, io.get(c)]));
    const cols = [{ name: 'Current values', cells: current }, ...list];
    const grid = [['', ...cols.map((c) => c.name)]];
    const res = {};
    for (const s of cols) { await io.set({ ...current, ...s.cells }); res[s.name] = Object.fromEntries(results.map((r) => [r, io.get(r)])); }
    for (const c of inputs) grid.push([c, ...cols.map((s) => s.cells[c] ?? current[c])]);
    grid.push(['Results', ...cols.map(() => '')]);
    for (const r of results) grid.push([r, ...cols.map((s) => res[s.name][r])]);
    return { grid };
  } finally { H.close(wb); }
}

/* ---------- Monte Carlo ---------- */
/** seeded PRNG (mulberry32), so a simulation can be repeated */
export function rng(seed = 1) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function sampler(dist, rand) {
  const [kind, ...p] = Array.isArray(dist) ? dist : [dist.kind, ...(dist.params || [])];
  const P = p.map(Number);
  switch (String(kind).toLowerCase()) {
    case 'uniform': return () => P[0] + (P[1] - P[0]) * rand();
    case 'normal': return () => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return P[0] + P[1] * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    case 'lognormal': { const s = sampler(['normal', P[0], P[1]], rand); return () => Math.exp(s()); }
    case 'triangular': return () => { const [a, m, b] = P; const u = rand(), c = (m - a) / (b - a); return u < c ? a + Math.sqrt(u * (b - a) * (m - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - m)); };
    case 'pert': return () => { const [a, m, b] = P; const al = 1 + 4 * (m - a) / (b - a), be = 1 + 4 * (b - m) / (b - a); return a + betaSample(al, be, rand) * (b - a); };
    case 'discrete': { const vals = p.filter((_, i) => i % 2 === 0).map(Number), w = p.filter((_, i) => i % 2 === 1).map(Number); const tot = w.reduce((s, x) => s + x, 0); return () => { let u = rand() * tot; for (let i = 0; i < vals.length; i++) { u -= w[i]; if (u <= 0) return vals[i]; } return vals.at(-1); }; }
    default: throw new Error(`Unknown distribution ${kind}: use uniform, normal, lognormal, triangular, pert or discrete.`);
  }
}
const std = (rand) => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function gammaSample(k, rand) { if (k < 1) return gammaSample(k + 1, rand) * rand() ** (1 / k); const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d); for (;;) { let x, v; do { x = std(rand); v = 1 + c * x; } while (v <= 0); v = v ** 3; const u = rand(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; } }
function betaSample(a, b, rand) { const x = gammaSample(a, rand), y = gammaSample(b, rand); return x / (x + y); }

export function summarise(xs, bins = 20) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b); const n = v.length;
  if (!n) return { n: 0 };
  const mean = v.reduce((s, x) => s + x, 0) / n, sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1));
  const q = (p) => { const i = (n - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo); };
  const min = v[0], max = v[n - 1], w = (max - min) / bins || 1;
  const hist = Array.from({ length: bins }, (_, i) => ({ from: min + i * w, to: min + (i + 1) * w, count: 0 }));
  for (const x of v) hist[Math.min(bins - 1, Math.floor((x - min) / w))].count++;
  return { n, mean, sd, min, max, p5: q(0.05), p10: q(0.1), p50: q(0.5), p90: q(0.9), p95: q(0.95), hist };
}

/** inputs: { "Sheet!B2": ["normal", 100, 15] }, outputs: ["Sheet!F9"] */
export async function simulate(H, data, { active, inputs, outputs, iterations = 500, seed = 1, onProgress = null }) {
  const N = Math.max(10, Math.min(5000, Math.round(iterations)));
  const rand = rng(seed);
  const draw = Object.fromEntries(Object.entries(inputs).map(([c, d]) => [c, sampler(d, rand)]));
  const wb = await H.open(data);
  try {
    const io = await reader(wb, active);
    const samples = Object.fromEntries(outputs.map((o) => [o, []]));
    const t0 = Date.now();
    for (let i = 0; i < N; i++) {
      await io.set(Object.fromEntries(Object.entries(draw).map(([c, f]) => [c, f()])));
      for (const o of outputs) samples[o].push(num(io.get(o)));
      if (onProgress && i % 25 === 0) onProgress({ done: i, of: N, ms: Date.now() - t0 });
    }
    return { iterations: N, seed, results: Object.fromEntries(outputs.map((o) => [o, summarise(samples[o])])) };
  } finally { H.close(wb); }
}
