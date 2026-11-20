// Folio — meeting recorder audio worklet. Runs on the audio thread: mixes the input to mono (the AudioContext already
// runs at 16 kHz, so the browser has resampled it) and posts 100 ms blocks of Int16 samples to the page.
const BLOCK = 1600;
class FolioPcm16 extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(BLOCK); this.n = 0; }
  process(inputs) {
    const chans = inputs[0];
    if (chans && chans.length) {
      const len = chans[0].length, k = chans.length;
      for (let i = 0; i < len; i++) {
        let v = 0; for (let c = 0; c < k; c++) v += chans[c][i];
        v /= k; v = v < -1 ? -1 : v > 1 ? 1 : v;
        this.buf[this.n++] = v < 0 ? v * 32768 : v * 32767;
        if (this.n === BLOCK) { this.port.postMessage(this.buf.buffer, [this.buf.buffer]); this.buf = new Int16Array(BLOCK); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('folio-pcm16', FolioPcm16);
