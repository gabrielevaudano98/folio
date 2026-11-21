// Folio — meeting transcription worker. Runs in an Electron utilityProcess, started for one recording and ended after it,
// so the speech models never sit in the app's memory. Audio arrives on a MessagePort straight from the window as 16 kHz
// mono Int16 blocks, one stream per track ('me' microphone, 'them' computer sound). Each track has its own voice
// detector; speech segments are decoded one at a time off the JavaScript thread (decodeAsync).
const path = require('node:path');
const { dedupeSentences: dedupe } = require('./transcript.js');

const RATE = 16000;
const port = process.parentPort;
const send = (m) => port.postMessage(m);
const rssMB = () => Math.round(process.memoryUsage().rss / 2 ** 20);

let sherpa = null, rec = null, cfg = null;
const vads = {}, fed = { me: 0, them: 0 };
let signal = 0; // samples with real sound (not digital silence, as from a muted or wrong input), both tracks
const queue = []; let decoding = false, queuedSamples = 0, nextId = 1, stopping = false, decodeMs = 0;

function vadFor(track) {
  if (!vads[track]) {
    vads[track] = new sherpa.Vad({
      sileroVad: { model: cfg.vad, threshold: 0.5, minSilenceDuration: 0.5, minSpeechDuration: 0.25, maxSpeechDuration: cfg.maxSegmentSec, windowSize: 512 },
      sampleRate: RATE, numThreads: 1, debug: false,
    }, 60);
  }
  return vads[track];
}

function collect(track) {
  const v = vads[track];
  while (v && !v.isEmpty()) {
    const seg = v.front(false); v.pop(); // false: copy into V8 memory; Electron does not allow external buffers
    queue.push({ track, start: seg.start, samples: seg.samples });
    queuedSamples += seg.samples.length;
  }
  pump();
}

async function pump() {
  if (decoding) return;
  decoding = true;
  try {
    while (queue.length) {
      const s = queue.shift(); queuedSamples -= s.samples.length;
      const stream = rec.createStream();
      if (cfg.asr.maxTokensPerSecond) stream.setOption('max_tokens_per_second', String(cfg.asr.maxTokensPerSecond)); // Italian needs more than the default 6
      stream.acceptWaveform({ samples: s.samples, sampleRate: RATE });
      const a = Date.now(); const r = await rec.decodeAsync(stream); decodeMs += Date.now() - a;
      const text = dedupe(String(r.text || '').trim());
      if (text) send({ type: 'segment', id: nextId++, track: s.track, t0: s.start / RATE, t1: (s.start + s.samples.length) / RATE, text });
    }
  } catch (e) { send({ type: 'error', error: String(e.message || e) }); }
  finally { decoding = false; }
  if (stopping && !queue.length) finish();
}

function accept(track, buf) {
  if (!rec || stopping || (track !== 'me' && track !== 'them') || !(buf instanceof ArrayBuffer)) return;
  const i16 = new Int16Array(buf); const f = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32768;
  // the voice detector misses pauses in large blocks (1 s blocks gave one segment for a whole minute), so feed it 100 ms at a time
  const v = vadFor(track);
  for (let i = 0; i < f.length; i += 1600) { v.acceptWaveform(f.subarray(i, i + 1600)); collect(track); }
  fed[track] += f.length;
  for (let i = 0; i < f.length; i++) if (f[i] > 0.002 || f[i] < -0.002) { signal += f.length; break; }
}

let finished = false;
function finish() {
  if (finished) return; finished = true;
  send({ type: 'done', audioSec: { me: fed.me / RATE, them: fed.them / RATE }, decodeSec: decodeMs / 1000, rssMB: rssMB() });
  setTimeout(() => process.exit(0), 50);
}

port.on('message', async (e) => {
  const m = e.data || {};
  try {
    if (m.type === 'init') {
      cfg = m;
      const t0 = Date.now();
      sherpa = require(path.join(m.sherpaDir, 'node_modules', 'sherpa-onnx-node'));
      rec = await sherpa.OfflineRecognizer.createAsync({
        featConfig: { sampleRate: RATE, featureDim: 80 },
        modelConfig: {
          ...(m.asr.type === 'whisper'
            ? { whisper: { encoder: m.asr.encoder, decoder: m.asr.decoder, language: m.language || '', task: 'transcribe', tailPaddings: -1 } }
            : { transducer: { encoder: m.asr.encoder, decoder: m.asr.decoder, joiner: m.asr.joiner } }),
          tokens: m.asr.tokens, numThreads: m.threads, provider: 'cpu', debug: 0, modelType: m.asr.type,
        },
        decodingMethod: 'greedy_search',
      });
      const audio = e.ports?.[0];
      if (audio) { audio.on('message', (a) => accept(a.data?.track, a.data?.pcm)); audio.start(); }
      send({ type: 'ready', loadMs: Date.now() - t0, rssMB: rssMB() });
      setInterval(() => send({ type: 'stats', queueSec: queuedSamples / RATE, rssMB: rssMB(), audioSec: { me: fed.me / RATE, them: fed.them / RATE }, signalSec: signal / RATE }), 5000).unref();
    } else if (m.type === 'feed') accept(m.track, m.pcm);
    else if (m.type === 'stop') {
      stopping = true;
      for (const [track, v] of Object.entries(vads)) { v.flush(); collect(track); }
      if (!decoding && !queue.length) finish();
    }
  } catch (err) { send({ type: 'error', error: String(err.message || err), fatal: m.type === 'init' }); if (m.type === 'init') setTimeout(() => process.exit(1), 50); }
});
