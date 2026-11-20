// Folio — meeting transcript: segments in, Markdown out. Pure, tested in Node.
// A segment is { id, track: 'me' | 'them', t0, t1 (seconds from the start), text }.

export const SPEAKER = { me: 'You', them: 'Others' };

/** lower case, no accents or punctuation, single spaces: used to compare what two tracks heard */
export const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = (s) => norm(s).split(' ').filter(Boolean);
/** share of the shorter text's words that the other text also has */
export function overlap(a, b) {
  const A = words(a), B = new Set(words(b));
  if (!A.length || !B.size) return 0;
  const hit = A.filter((w) => B.has(w)).length;
  return hit / Math.min(A.length, B.size);
}

/**
 * Without headphones the microphone also hears the other people. A 'me' segment that says much the same as a
 * 'them' segment at about the same time is that echo, and is dropped. Returns the segments to keep, in time order.
 */
export function dropEcho(segments, { slack = 2, min = 0.6 } = {}) {
  const them = segments.filter((s) => s.track === 'them');
  return segments
    .filter((s) => s.track !== 'me' || !them.some((o) => o.t0 <= s.t1 + slack && s.t0 <= o.t1 + slack && overlap(s.text, o.text) >= min))
    .filter((s) => norm(s.text))
    .sort((a, b) => a.t0 - b.t0 || (a.track < b.track ? -1 : 1));
}

/** Whisper sometimes writes a sentence again, whole or its tail; keep the first */
export function dedupeSentences(text) {
  const parts = String(text).match(/[^.!?]+[.!?]*\s*/g) || [String(text)];
  const out = [];
  for (const p of parts) {
    const prev = out.length ? norm(out[out.length - 1]) : '', cur = norm(p);
    if (cur && prev && (cur === prev || (cur.split(' ').length >= 4 && ` ${prev} `.includes(` ${cur} `)))) continue; // a repeat, or the tail of the sentence before
    out.push(p);
  }
  return out.join('').trim();
}

export const clock = (sec) => { const t = Math.max(0, Math.floor(sec)); return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60].map((n) => String(n).padStart(2, '0')).join(':'); };

/** one numbered line per kept segment; the numbers are what notes cite */
export function lines(segments) {
  return dropEcho(segments).map((s, i) => ({ n: i + 1, at: s.t0, who: SPEAKER[s.track] || 'Speaker', text: s.text.trim() }));
}

/** "Meetings/2026-11-20 15-04 Weekly sync.md": a name that is safe on Windows and macOS */
export function fileName(date, title) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}-${p(date.getMinutes())}`;
  const t = String(title || '').replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `Meetings/${stamp}${t ? ' ' + t : ' Meeting'}.md`;
}

const esc = (s) => String(s).replace(/([\\`*_[\]<>#|])/g, '\\$1');
const yaml = (s) => JSON.stringify(String(s));

/**
 * The note. `notes` is the verified output of notes-core (or null). Every cited line keeps its number, so a reader can
 * check each point against the transcript.
 */
export function renderMeeting({ title, started, durationSec, asrModel, notesModel = null, segments, notes = null, notesError = null, stats = null }) {
  const L = lines(segments);
  const out = ['---', 'type: meeting', `title: ${yaml(title || 'Meeting')}`, `date: ${started.toISOString()}`, `duration: ${clock(durationSec)}`, `transcription: ${asrModel}`];
  if (notesModel) out.push(`notes: ${notesModel}`);
  // measured on this computer: the memory peaks and the transcription speed (seconds of work per second of audio)
  if (stats?.workerPeakMB) out.push(`worker_peak_mb: ${stats.workerPeakMB}`);
  if (stats?.appPeakMB) out.push(`app_peak_mb: ${stats.appPeakMB}`);
  if (stats?.speed) out.push(`transcription_speed: ${stats.speed}`);
  out.push('---', '', `# ${esc(title || 'Meeting')}`, '');
  out.push(`> Transcribed on this computer${notes ? ' and summarised by a small local model' : ''}. Check names, numbers and dates before you share it.`, '');
  if (notes) out.push(...renderNotes(notes), '');
  else if (notesError) out.push(`> Notes were not written: ${esc(notesError)}`, '');
  out.push('## Transcript', '');
  if (!L.length) out.push('_Nothing was heard._');
  for (const l of L) out.push(`**${l.n}** · ${clock(l.at)} · ${l.who}: ${esc(l.text)}`, '');
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function renderNotes(n) {
  const cite = (x) => ` (line ${x.line})`;
  const o = ['## Notes', ''];
  if (n.summary) o.push('### Summary', '', esc(n.summary), '');
  if (n.decisions.length) { o.push('### Decisions', ''); for (const d of n.decisions) o.push(`- ${esc(d.text)}${cite(d)}`); o.push(''); }
  if (n.actions.length) {
    o.push('### Action items', '');
    for (const a of n.actions) o.push(`- [ ] ${esc(a.task)}${a.owner ? ` · owner: ${esc(a.owner)}` : ''}${a.due ? ` · due: ${esc(a.due)}` : ''}${cite(a)}`);
    o.push('');
  }
  if (n.questions.length) { o.push('### Open questions', ''); for (const q of n.questions) o.push(`- ${esc(q.text)}${cite(q)}`); o.push(''); }
  return o;
}
