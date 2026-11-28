// Folio — how many CPU threads the speech model may use. The catalog's number is the floor (it suits a small PC); a bigger
// processor gets one more thread per 4 usable ones, never more than MAX, so a call app running next to Folio keeps most of the machine
// (16 usable threads -> 4, more than 16 -> 5). Speed matters less here than leaving the computer free.
export const MAX_ASR_THREADS = 5;
export function asrThreads(base, usable) {
  const floor = Math.max(1, Math.floor(base) || 1);
  const n = Number.isFinite(usable) && usable > 0 ? usable : 1;
  return Math.min(MAX_ASR_THREADS, Math.max(floor, Math.ceil(n / 4)));
}
