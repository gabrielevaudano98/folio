// Folio visual regression: slides rendered by the app compared with reference screenshots in test/visual.
// Images are compared small (240 px wide) with a tolerance, so font hinting across machines does not fail it;
// a layout, colour or missing-object regression does. FOLIO_VISUAL_UPDATE=1 rewrites the references.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { workspace, runApp, open, log, step, errors } from './harness.mjs';

const CASES = [['Pitch.slides.md', [0, 2, 5, 10]], ['Motion.slides.md', [0, 1]], ['Links.slides.md', [0]], ['Brand.slides.md', [0, 1]]];
const W = 240;
const w = workspace('visual', 47579);
const steps = [{ size: [1500, 950], wait: 1200 }];
const shots = [];
for (const [file, idx] of CASES) {
  steps.push(open(file));
  for (const i of idx) {
    const out = path.join(w.out, `${file.replace(/\W/g, '_')}-${i}.png`); shots.push({ file, i, out });
    steps.push(step(`document.querySelector('.sl-thumb[data-i=\"${i}\"]').click()`, 900), log("(()=>{const r=document.querySelector('.sl-frame').getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(Math.round)})()"), { js: '1', wait: 200, out });
  }
}
steps.push(errors);
const r = await runApp(w, steps);
assert.deepEqual(r.js.at(-1), [], JSON.stringify(r.js));
/** crop to the slide and shrink to W px wide (box filter) */
function thumb(file, [x, y, cw, ch]) {
  const src = PNG.sync.read(fs.readFileSync(file)); const scale = src.width / 1500; // device pixel ratio
  const X = Math.round(x * scale), Y = Math.round(y * scale), CW = Math.round(cw * scale), CH = Math.round(ch * scale);
  const H = Math.round((W * CH) / CW); const out = new PNG({ width: W, height: H });
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
    const x0 = X + Math.floor((tx * CW) / W), x1 = X + Math.floor(((tx + 1) * CW) / W), y0 = Y + Math.floor((ty * CH) / H), y1 = Y + Math.floor(((ty + 1) * CH) / H);
    const acc = [0, 0, 0, 0]; let n = 0;
    for (let sy = y0; sy < Math.max(y1, y0 + 1); sy++) for (let sx = x0; sx < Math.max(x1, x0 + 1); sx++) { const p = (sy * src.width + sx) * 4; for (let c = 0; c < 4; c++) acc[c] += src.data[p + c]; n++; }
    const q = (ty * W + tx) * 4; for (let c = 0; c < 4; c++) out.data[q + c] = Math.round(acc[c] / n);
  }
  return out;
}
console.log('\nvisual');
const rects = r.js.slice(0, -1); let updated = 0;
for (const [k, s] of shots.entries()) {
  const img = thumb(s.out, rects[k]); const ref = path.join('test/visual', `${s.file.replace('.slides.md', '')}-${s.i + 1}.png`);
  if (process.env.FOLIO_VISUAL_UPDATE || !fs.existsSync(ref)) { fs.writeFileSync(ref, PNG.sync.write(img)); updated++; continue; }
  const base = PNG.sync.read(fs.readFileSync(ref));
  assert.equal(base.height, img.height, `${ref}: the slide changed size`);
  const diff = new PNG({ width: W, height: img.height });
  const bad = pixelmatch(base.data, img.data, diff.data, W, img.height, { threshold: 0.18 });
  const share = bad / (W * img.height);
  const limit = process.env.CI ? 0.06 : 0.03;
  if (share > limit) { fs.writeFileSync(ref.replace('.png', '.diff.png'), PNG.sync.write(diff)); fs.writeFileSync(ref.replace('.png', '.actual.png'), PNG.sync.write(img)); }
  assert(share <= limit, `${ref} differs in ${(share * 100).toFixed(1)}% of pixels (see .diff.png and .actual.png)`);
}
console.log(updated ? `  ✓ wrote ${updated} reference screenshots` : `  ✓ ${shots.length} slides match their reference screenshots`);
