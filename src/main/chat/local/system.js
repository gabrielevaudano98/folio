// Folio — what this computer can run, and which local model to suggest. Pure given the facts; `readFacts` reads them.
import os from 'node:os';
import fs from 'node:fs/promises';
import { CHAT_MODELS, isPinned } from './catalog.js';

const GB = 1024 ** 3;

/** cores, memory and free disk of the folder where models are stored. Nothing leaves the computer. */
export async function readFacts(dir, osImpl = os) {
  let freeBytes = null;
  try { const s = await fs.statfs(dir); freeBytes = Number(s.bavail) * Number(s.bsize); } catch { /* unknown: treated as enough, the download checks again */ }
  const cpus = osImpl.cpus();
  return { cores: cpus.length || 1, ramBytes: osImpl.totalmem(), freeRamBytes: osImpl.freemem(), freeBytes, arch: osImpl.arch(), platform: osImpl.platform(), cpu: cpus[0]?.model || '' };
}

/**
 * Memory we are willing to give the model: 60% of the installed memory (the rest is for the system and Folio), and never
 * more than what is free plus 25% of the total, so a busy computer is not pushed into swapping.
 */
export function ramBudgetGB(f) {
  const total = f.ramBytes / GB, free = (f.freeRamBytes ?? f.ramBytes) / GB;
  return Math.max(0, Math.min(total * 0.6, free + total * 0.25));
}

/** how a model will feel here: 'good', 'slow' (works, wait for it) or 'no' (do not offer) */
export function fit(m, f) {
  const need = m.ramGB;
  if (need > ramBudgetGB(f)) return 'no';
  if (f.freeBytes != null && m.bytes && f.freeBytes < m.bytes * 1.1) return 'no';
  const heavy = parseFloat(m.params) >= 7;
  if (f.cores <= 2 && parseFloat(m.params) > 2) return 'slow';
  if (f.cores <= 4 && heavy) return 'slow';
  if (need > ramBudgetGB(f) * 0.8) return 'slow';
  return 'good';
}

/** pinned models with their fit, most capable first; `recommended` is the best one that fits well, else the best that fits at all */
export function plan(f, models = CHAT_MODELS) {
  const rows = models.filter(isPinned).map((m) => ({ ...m, fit: fit(m, f) }));
  const rank = (m) => m.tools * 100 + parseFloat(m.params);
  rows.sort((a, b) => rank(b) - rank(a));
  const ok = rows.filter((r) => r.fit === 'good'), slow = rows.filter((r) => r.fit === 'slow');
  const pick = (ok.find((r) => r.tools >= 2) || ok[0] || slow.find((r) => r.tools >= 2) || slow[0]) ?? null;
  return { facts: f, budgetGB: Math.round(ramBudgetGB(f) * 10) / 10, models: rows, recommended: pick ? pick.id : null };
}
