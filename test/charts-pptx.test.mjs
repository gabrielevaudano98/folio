// Folio chart export test: donut, combo with a secondary axis, axis titles and value labels become native
// PowerPoint charts (checked in the chart XML of the exported .pptx), the slides draw them as SVG first, and a doughnut imports back as a donut.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-charts-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud'), out = path.join(tmp, 'out');
fs.cpSync(new URL('./fixture', import.meta.url), ws, { recursive: true }); fs.mkdirSync(ud); fs.mkdirSync(out);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47672 }));
const data = 'data:\n| Month | Revenue | Costs | Margin |\n| --- | --- | --- | --- |\n| Jan | 1200 | 800 | 33 |\n| Feb | 1500 | 900 | 40 |\n| Mar | 900 | 950 | -5 |';
const deck = `---\nmarp: true\ntheme: folio\n---\n\n## Share\n\n\`\`\`chart\ntype: donut\ntitle: Revenue share\nlabels: true\ndata:\n| Month | Revenue |\n| --- | --- |\n| Jan | 1200 |\n| Feb | 1500 |\n| Mar | 900 |\n\`\`\`\n\n---\n\n## Combo\n\n\`\`\`chart\ntype: combo\ntitle: Revenue and margin\nsecondary: true\nlabels: true\nxtitle: Month\nytitle: Euro\ny2title: Margin (%)\n${data}\n\`\`\`\n\n---\n\n## Bars\n\n\`\`\`chart\ntype: bar\ntitle: Costs\nxtitle: Euro\nytitle: Month\n${data}\n\`\`\`\n\n---\n\n## Area\n\n\`\`\`chart\ntype: area\nlabels: true\n${data}\n\`\`\`\n`;
fs.writeFileSync(path.join(ws, 'Charts.slides.md'), deck);

function run(steps, env = {}) {
  const stepsFile = path.join(tmp, `steps-${Date.now()}.json`); fs.writeFileSync(stepsFile, JSON.stringify(steps));
  return new Promise((resolve) => {
    const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile, FOLIO_EXPORT_DIR: out, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
    const timer = setTimeout(() => child.kill(), 120000);
    child.on('exit', () => { clearTimeout(timer); resolve({ log, js: log.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3))) }); });
  });
}

console.log('\ncharts (PowerPoint)');
const r = await run([
  { size: [1500, 950], wait: 1200 },
  { js: "document.querySelector('[data-file=\"Charts.slides.md\"]').click();1", wait: 2200 },
  { js: "[...document.querySelectorAll('.chart-block svg.chart')].map((s) => [s.querySelectorAll('.ch-slice').length, s.querySelectorAll('.ch-bar').length, s.querySelectorAll(':scope > .ch-line').length, s.querySelectorAll('.ch-axis').length, s.querySelectorAll('.ch-val').length, s.querySelectorAll('.ch-tick2').length].join(','))", log: true, wait: 100 },
  { js: "window.__folioRun('export-pptx');1", wait: 7000 },
  { js: 'window.__folioErrors||[]', log: true, wait: 100 },
]);
assert.deepEqual(r.js.at(-1), [], r.log.slice(-2000));
// the slide canvas and its thumbnails may each draw the charts: look at the first drawing of each
const drawn = r.js[0]; assert(Array.isArray(drawn) && drawn.length >= 3, r.log.slice(-2000));
const [donut, combo, bars] = drawn.slice(0, 3).map((x) => x.split(',').map(Number));
assert.equal(donut[0], 3); assert(donut[4] === 0, 'donut labels are ch-lbl, not ch-val');
assert.equal(combo[1], 6); assert.equal(combo[2], 1); assert.equal(combo[3], 3); assert(combo[4] >= 6); assert(combo[5] > 0);
assert.equal(bars[1], 9); assert.equal(bars[3], 2);
console.log('  ✓ the slides draw donut, combo (secondary axis, axis titles, labels) and bars with axis titles');

const zip = await JSZip.loadAsync(fs.readFileSync(path.join(out, 'Charts.pptx')));
const charts = await Promise.all(Object.keys(zip.files).filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f)).sort().map((f) => zip.file(f).async('string')));
assert.equal(charts.length, 4, 'four native charts');
const dn = charts.find((x) => x.includes('<c:doughnutChart>')); assert(dn, 'doughnut chart');
assert.match(dn, /<c:holeSize val="58"\/>/); assert.match(dn, /<c:showVal val="1"\/>/); assert.match(dn, /<c:showPercent val="0"\/>/);
console.log('  ✓ a donut is a native doughnut chart with its hole and value labels');
const cb = charts.find((x) => x.includes('<c:lineChart>') && x.includes('<c:barChart>')); assert(cb, 'combo chart: bar and line in one plot area');
assert.equal((cb.match(/<c:valAx>/g) || []).length, 2, 'two value axes'); assert.match(cb, /<c:crosses val="max"\/>/);
assert.match(cb, />Month</); assert.match(cb, />Euro</); assert.match(cb, />Margin \(%\)</);
assert.match(cb.slice(cb.indexOf('<c:lineChart>')), /<c:v>Margin<\/c:v>/); assert.doesNotMatch(cb.slice(cb.indexOf('<c:lineChart>')), /<c:v>Revenue<\/c:v>/);
assert.match(cb, /<c:showVal val="1"\/>/);
const cat2 = cb.slice(cb.lastIndexOf('<c:catAx>')); assert.match(cat2, /<c:delete val="1"\/>/); assert.doesNotMatch(cat2.slice(0, cat2.indexOf('</c:catAx>')), /<c:title>/, 'the hidden secondary category axis has no title');
console.log('  ✓ a combo is one chart: bars, the line on a secondary axis, three axis titles, value labels');
const br = charts.find((x) => x.includes('<c:barDir val="bar"/>')); assert(br, 'horizontal bar chart');
const catAx = br.slice(br.indexOf('<c:catAx>'), br.indexOf('</c:catAx>')), valAx = br.slice(br.indexOf('<c:valAx>'), br.indexOf('</c:valAx>'));
assert.match(catAx, />Month</); assert.match(valAx, />Euro</); assert.doesNotMatch(br, /<c:showVal val="1"\/>/);
console.log('  ✓ on a bar chart the horizontal title names the value axis, the vertical one the categories');
const ar = charts.find((x) => x.includes('<c:areaChart>')); assert(ar, 'area chart'); assert.match(ar, /<c:showVal val="1"\/>/); assert.doesNotMatch(ar, /<c:dLblPos /);
console.log('  ✓ an area chart gets value labels without a label position (PowerPoint refuses one there)');
// and back: importing the file turns the doughnut into a donut chart block
const r2 = await run([{ size: [1500, 950], wait: 1200 }, { js: "window.__folioRun('import-pptx');1", wait: 6000 }, { js: 'window.__folioErrors||[]', log: true, wait: 100 }], { FOLIO_IMPORT_FILE: path.join(out, 'Charts.pptx') });
assert.deepEqual(r2.js.at(-1), [], r2.log.slice(-2000));
const back = fs.readdirSync(ws).find((f) => /^Charts \d+\.slides\.md$/.test(f)); assert(back, 'imported deck');
assert.match(fs.readFileSync(path.join(ws, back), 'utf8'), /\`\`\`chart\ntype: donut\n/);
console.log('  ✓ importing the .pptx brings the doughnut back as type: donut');
fs.rmSync(tmp, { recursive: true, force: true });
