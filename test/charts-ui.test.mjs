// Chart editing in the interface: the page chart bar (type, value labels) rewrites one line of the block; the sheet
// chart panel sets donut, combo, secondary axis, axis titles and labels in the sheet's comment. Files checked on disk.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-charts-ui-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud');
fs.mkdirSync(ws, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47671 }));
const PAGE = '# Sales\n\nBefore the chart.\n\n```chart\ntype:  column\ntitle: Sales\ndata:\n| Month | Sales |\n| --- | --- |\n| Jan | 10 |\n| Feb | 14 |\n```\n\nAfter the chart.\n';
fs.writeFileSync(path.join(ws, 'a.md'), PAGE);
const SHEET = fs.readFileSync(new URL('./fixture/Budget.sheet.md', import.meta.url), 'utf8');
fs.writeFileSync(path.join(ws, 'Budget.sheet.md'), SHEET);

// A JavaScript string literal safe to splice into page code: JSON plus escapes for characters JSON leaves raw.
const lit = (v) => JSON.stringify(String(v)).replace(/[<>/\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const PROPS = new Set(['value', 'checked']);
const read = (f) => `folio.read(${lit(f)})`;
const fire = (sel, prop, value, ev = 'change') => {
  if (!PROPS.has(prop)) throw new Error(`unexpected property ${prop}`);
  const v = typeof value === 'boolean' ? String(value) : lit(value);
  return `(() => { const el = document.querySelector(${lit(sel)}); el[${lit(prop)}] = ${v}; el.dispatchEvent(new Event(${lit(ev)}, { bubbles: true })); return true; })()`;
};
const steps = [
  { size: [1500, 950], wait: 1200 },
  { js: "document.querySelector('[data-file=\"a.md\"]').click()", wait: 900 },
  { js: "document.querySelector('#view-switch [data-view=\"edit\"]').click()", wait: 1400 },
  // page: the bar offers the eight types and value labels
  { js: "[...document.querySelectorAll('.rich-chart-type option')].map((o) => o.value).join(',')", log: true, wait: 100 },
  { js: fire('.rich-chart-type', 'value', 'donut'), wait: 1600 },
  { js: read('a.md'), log: true, wait: 100 },
  { js: "document.querySelector('.rich-code-tool[data-tool=labels]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); true", wait: 1600 },
  { js: read('a.md'), log: true, wait: 100 },
  { js: "[!!document.querySelector('.rich-code-preview svg.chart .ch-total'), document.querySelectorAll('.rich-code-preview svg.chart .ch-slice').length, document.querySelector('.rich-code-tool[data-tool=labels]').getAttribute('aria-pressed')]", log: true, wait: 100 },
  // sheet: combo with a secondary axis and titles, value labels
  { js: "document.querySelector('[data-file=\"Budget.sheet.md\"]').click()", wait: 1500 },
  { js: fire('.sh-chart [data-ch=type]', 'value', 'combo'), wait: 700 },
  { js: "[...document.querySelectorAll('.sh-chart [data-ch=lines] option')].map((o) => o.value).join(',')", log: true, wait: 100 },
  { js: fire('.sh-chart [data-ch=secondary]', 'checked', true), wait: 700 },
  { js: fire('.sh-chart [data-ch=y2title]', 'value', 'Share'), wait: 700 },
  { js: fire('.sh-chart [data-ch=xtitle]', 'value', 'Item'), wait: 700 },
  { js: fire('.sh-chart [data-ch=labels]', 'checked', true), wait: 1600 },
  { js: read('Budget.sheet.md'), log: true, wait: 100 },
  { js: "(() => { const s = document.querySelector('.sh-chart-svg svg'); return [s.querySelectorAll('.ch-line').length > 0, s.querySelectorAll('.ch-tick2').length > 0, s.querySelectorAll('.ch-axis').length, s.querySelectorAll('.ch-val').length > 0]; })()", log: true, wait: 100 },
  { js: fire('.sh-chart [data-ch=type]', 'value', 'donut'), wait: 700 },
  { js: "[document.querySelectorAll('.sh-chart [data-ch=xtitle]').length, document.querySelectorAll('.sh-chart-svg .ch-total').length]", log: true, wait: 100 },
  { js: 'window.__folioErrors||[]', log: true, wait: 100 },
];

const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const { log, js } = await new Promise((resolve) => {
  const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
  const timer = setTimeout(() => child.kill(), 120000);
  child.on('exit', () => { clearTimeout(timer); resolve({ log: out, js: out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3))) }); });
});
console.log('\ncharts (interface)');
assert.deepEqual(js.at(-1), [], log.slice(-2000));
assert.equal(js[0], 'column,bar,line,area,pie,donut,combo,scatter', log.slice(-2000));
assert.equal(js[1], PAGE.replace('type:  column', 'type:  donut'));
console.log('  ✓ page: changing the type rewrites only the type line (the author\'s spacing kept)');
assert.equal(js[2], PAGE.replace('type:  column', 'type:  donut').replace('title: Sales\n', 'title: Sales\nlabels: true\n'));
assert.deepEqual(js[3], [true, 2, 'true']);
console.log('  ✓ page: Value labels adds one line before the data; the donut draws its slices and total');
assert.equal(js[4], ',Q1,Q2,Q3,Q4', 'line series picker lists the series');
const sheet = js[5];
const meta = (t) => t.split('\n').filter((l) => l.includes('"charts"'));
// the edited sheet is written again (as for any change to it); its cells stay the same and the other sheet is untouched
const cells = (t) => t.split('\n').filter((l) => !l.includes('"charts"')).map((l) => l.replace(/ +\|/g, ' |').replace(/\| -+/g, '| ---').trim()).join('\n');
assert.equal(cells(sheet), cells(SHEET)); assert.equal(sheet.slice(sheet.indexOf('## Rates')), SHEET.slice(SHEET.indexOf('## Rates')));
assert.equal(meta(sheet).length, 1); assert.match(meta(sheet)[0], /"charts":\[\{"type":"combo","title":"Costs by quarter","range":"A1:G5","stacked":true,"secondary":true,"y2title":"Share","xtitle":"Item","labels":true\}\]/);
assert.deepEqual(js[6], [true, true, 2, true]);
console.log('  ✓ sheet: combo with a secondary axis, axis titles and value labels are saved with the chart and drawn');
assert.deepEqual(js[7], [0, 1]);
console.log('  ✓ sheet: a donut hides the axis fields and draws its total');
fs.rmSync(tmp, { recursive: true, force: true });
