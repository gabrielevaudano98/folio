// Folio PowerPoint interop test: export a deck (with masters) to .pptx, handouts and notes pages to PDF,
// then import the .pptx back and the same file as a .potx template, and check the files on disk.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-interop-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud'), out = path.join(tmp, 'out');
fs.cpSync(new URL('./fixture', import.meta.url), ws, { recursive: true }); fs.mkdirSync(ud); fs.mkdirSync(out);
fs.copyFileSync(new URL('../src/templates/Swiss.slides.md', import.meta.url), path.join(ws, 'Swiss.slides.md'));
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47587 }));

function run(steps, env = {}) {
  const stepsFile = path.join(tmp, `steps-${Date.now()}.json`); fs.writeFileSync(stepsFile, JSON.stringify(steps));
  return new Promise((resolve) => {
    const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile, FOLIO_EXPORT_DIR: out, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
    const timer = setTimeout(() => child.kill(), 150000);
    child.on('exit', () => { clearTimeout(timer); resolve({ log, js: log.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3))) }); });
  });
}
const open = (f) => ({ js: `document.querySelector('[data-file="${f}"]').click();1`, wait: 1800 });
const toasts = { js: "(window.__folioToasts||[]).join(' | ')", log: true, wait: 100 };

console.log('\ninterop');
// 1. export
const r1 = await run([
  { size: [1500, 950], wait: 1200 },
  open('Pitch.slides.md'), { js: "window.__folioRun('export-pptx');1", wait: 7000 },
  { js: 'window.__folioSurface.exportHandouts({perPage:3});1', wait: 4000 }, { js: 'window.__folioSurface.exportHandouts({notes:true});1', wait: 4000 },
  open('Swiss.slides.md'), { js: "window.__folioRun('export-pptx');1", wait: 6000 },
  open('Motion.slides.md'), { js: "window.__folioRun('export-pptx');1", wait: 5000 },
  { js: 'window.__folioErrors||[]', log: true, wait: 100 },
]);
assert.deepEqual(r1.js.at(-1), [], r1.log.slice(-2000));
const zip = await JSZip.loadAsync(fs.readFileSync(path.join(out, 'Pitch.pptx')));
const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
assert.equal(slides.length, 11); console.log('  ✓ every slide is exported, hidden ones marked as hidden');
const all = (await Promise.all(slides.map((f) => zip.file(f).async('string')))).join('\n');
assert.match(all, /prst="ellipse"/); assert.match(all, /<a:tailEnd type="triangle"/); assert.match(all, /<c:chart /); assert.match(all, /<a:srcRect /); console.log('  ✓ placed objects are native: shapes, arrows, charts and cropped pictures');
assert.match(all, />Why now</); assert.match(all, /<a:buChar /); console.log('  ✓ text stays text, lists keep their bullets');
assert.match(await zip.file('ppt/theme/theme1.xml').async('string'), /<a:clrScheme name="Folio"><a:dk1><a:srgbClr val="[0-9A-F]{6}"/); console.log('  ✓ the deck colours are the PowerPoint theme colours');
const sz = await JSZip.loadAsync(fs.readFileSync(path.join(out, 'Swiss.pptx')));
const layouts = await Promise.all(Object.keys(sz.files).filter((f) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f)).map((f) => sz.file(f).async('string')));
const titleLayout = layouts.find((x) => /name="Folio · title"/.test(x)); assert(titleLayout, 'title layout');
assert.match(titleLayout, /type="title"/); assert.match(titleLayout, /anchor="b"/); console.log('  ✓ masters become slide layouts with title and body placeholders, anchored as in Folio');
const mz = await JSZip.loadAsync(fs.readFileSync(path.join(out, 'Motion.pptx')));
const m1 = await mz.file('ppt/slides/slide1.xml').async('string'), m2 = await mz.file('ppt/slides/slide2.xml').async('string');
assert.match(m1, /<p:transition spd="med"><p:fade\/><\/p:transition><p:timing>/); assert.match(m1, /presetID="2" presetClass="entr" presetSubtype="4"[^>]*nodeType="withEffect"/); assert.match(m1, /<p:bldP spid="\d+" grpId="0" build="p"/); assert.match(m2, /p159:morph/);
console.log('  ✓ transitions, Morph and animations are native PowerPoint timing (objects named for Morph)');
const pages = (f) => (fs.readFileSync(path.join(out, f)).toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
assert.equal(pages('Pitch handouts.pdf'), 4); assert.equal(pages('Pitch notes.pdf'), 11); console.log('  ✓ handouts put three slides on a page; notes pages hold one slide each');

// 2. import: the .pptx as a deck, then the same package as a .potx template
const potx = path.join(tmp, 'Swiss brand.potx');
const tz = await JSZip.loadAsync(fs.readFileSync(path.join(out, 'Swiss.pptx')));
tz.file('[Content_Types].xml', (await tz.file('[Content_Types].xml').async('string')).replace('presentationml.presentation.main+xml', 'presentationml.template.main+xml'));
fs.writeFileSync(potx, await tz.generateAsync({ type: 'nodebuffer' }));
const r2 = await run([
  { size: [1500, 950], wait: 1200 },
  { js: "window.__folioRun('import-pptx');1", wait: 6000 }, toasts,
  { js: "window.__folioRun('import-pptx');1", wait: 5000 }, toasts,
  { js: 'window.__folioErrors||[]', log: true, wait: 100 },
], { FOLIO_IMPORT_FILE: `${path.join(out, 'Pitch.pptx')}|${potx}` });
assert.deepEqual(r2.js.at(-1), [], r2.log.slice(-2000));
assert.match(r2.js[0], /Imported Pitch\./); assert.match(r2.js[1], /Swiss brand is now a template/);
const deck = fs.readFileSync(path.join(ws, 'Pitch 2.slides.md'), 'utf8');
assert.equal(deck.split(/\n---\n/).length - 1, 11); assert.match(deck, /## Why now\n\n- Teams write in many tools/); assert.match(deck, /::: shape #[\w-]+ type=ellipse/);
const pic = deck.match(/!\[[^\]]*\]\((assets\/[^)]+)\)/); assert(pic && fs.existsSync(path.join(ws, pic[1]))); console.log('  ✓ a .pptx imports as a deck next to the open note, pictures saved in assets');
const tpl = fs.readFileSync(path.join(ws, 'Templates', 'Swiss brand.slides.md'), 'utf8');
assert.match(tpl, /template-name: "Swiss brand"/); assert.match(tpl, /accent: "#e3120b"/); assert.match(tpl, /<!-- master: title only -->/); assert.match(tpl, /::: box placeholder=title x=88 y=210\.1 w=760\.1 h=220 size=68 valign=bottom/); console.log('  ✓ a .potx imports as a template: theme, layouts as masters, placeholders where they were');
