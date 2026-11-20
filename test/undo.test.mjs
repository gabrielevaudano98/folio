// Folio history test: undo and redo in every kind of document, per tab, back and forward between notes, and file actions.
import assert from 'node:assert/strict';
import { workspace, runApp, open, errors, log, step } from './harness.mjs';

const w = workspace('undo', 47595);
const answer = (v) => step(`const i=document.querySelector('#prompt-input');i.value=${JSON.stringify(v)};i.closest('form').requestSubmit()`, 900);
const yes = step("document.querySelector('#sheet-prompt [data-yes]').click()", 1000);
const run = (id, wait = 500) => step(`window.__folioRun(${JSON.stringify(id)})`, wait);
const files = log("[...document.querySelectorAll('[data-file]')].map(e=>e.dataset.file).sort()", 200);
const activeTab = "document.querySelector('.tab[aria-selected=true]')?.dataset.tab";
const edit = (t) => step(`const v=window.__folioEditor.view;v.dispatch({changes:{from:0,insert:${JSON.stringify(t)}}})`, 900);
const head = log("window.__folioEditor.text.slice(0,10)");
const btns = log("['#btn-undo','#btn-redo','#btn-back','#btn-forward'].map(s=>document.querySelector(s).disabled)");
const r = await runApp(w, [
  { size: [1500, 950], wait: 1200 },
  // ----- visual editor: the history survives a tab switch too
  open('Roadmap.md'), step("document.querySelector('.ProseMirror').editor.commands.insertContentAt(1,'Hello ')", 800),
  log("[document.querySelector('.ProseMirror').textContent.includes('Hello'), document.querySelector('#btn-undo').disabled]"),
  open('Onboarding.md'), log("document.querySelector('#btn-undo').disabled"), open('Roadmap.md'),
  log("[document.querySelector('.ProseMirror').textContent.includes('Hello'), document.querySelector('#btn-undo').disabled]"),
  run('undo', 600), log("document.querySelector('.ProseMirror').textContent.includes('Hello')"),
  // ----- Markdown source: undo and redo through the app command, and the history survives a tab switch
  open('Onboarding.md'), run('mode-split', 600), edit('ONE '), edit('TWO '), head, btns,
  run('undo'), head, run('redo'), head,
  open('Roadmap.md'), log(`${activeTab}`),
  run('nav-back', 900), log(`${activeTab}`), btns, run('undo'), head, // TWO goes, ONE stays: the tab kept its history
  run('nav-forward', 900), log(`${activeTab}`), btns,
  // ----- slides: one deck's history never reaches another deck
  open('Pitch.slides.md'),
  step("window.__folioSurface.insertText('::: box #undo-me x=40 y=40 w=200 h=80\\nHello\\n:::')", 900),
  log("[document.querySelector('.sl-frame .sl-obj[data-id=undo-me]')!==null, document.querySelector('[data-sl=undo]').disabled]"),
  open('Report.slides.md'), log("[document.querySelector('[data-sl=undo]').disabled, document.querySelector('#btn-undo').disabled]"),
  run('undo'), log("document.querySelector('.sl-frame .sl-obj[data-id=undo-me]')!==null"),
  open('Pitch.slides.md'), log("[document.querySelector('.sl-frame .sl-obj[data-id=undo-me]')!==null, document.querySelector('#btn-undo').disabled]"),
  run('undo', 900), log("document.querySelector('.sl-frame .sl-obj[data-id=undo-me]')!==null"),
  run('redo', 900), log("document.querySelector('.sl-frame .sl-obj[data-id=undo-me]')!==null"),
  step("document.querySelector('[data-sl=undo]').click()", 900), log("document.querySelector('.sl-frame .sl-obj[data-id=undo-me]')!==null"),
  // ----- sheet and board
  open('Budget.sheet.md'), log("document.querySelector('#btn-undo').disabled"),
  open('System.board.md'), log("document.querySelector('#btn-undo').disabled"),
  // ----- an outside change (an AI edit, the code pane) is an undo step of its own
  open('Brand.slides.md'), log("document.querySelectorAll('.sl-thumb').length"),
  step("window.__folioSurface.setText(window.__folioEditor.text+'\\n\\n---\\n\\n# Added by AI\\n')", 900), log("document.querySelectorAll('.sl-thumb').length"),
  run('undo', 900), log("document.querySelectorAll('.sl-thumb').length"),
  // ----- file actions: rename, undo, redo, trash, undo, new folder, undo
  open('Roadmap.md'), run('rename', 500), answer('Plan'), files,
  run('undo-file', 1200), files, run('redo-file', 1200), files,
  run('trash', 500), yes, files,
  run('undo-file', 1500), files, log(`${activeTab}`),
  run('new-folder', 500), answer('Temp'), log("[...document.querySelectorAll('[data-dir]')].map(e=>e.dataset.dir)", 300),
  run('undo-file', 1200), log("[...document.querySelectorAll('[data-dir]')].map(e=>e.dataset.dir)", 300),
  // Ctrl+Z with the file list focused means the last file action
  open('Plan.md'), run('rename', 500), answer('Again'), files,
  step("document.querySelector('[data-file=\\'Again.md\\']').focus();window.__folioRun('undo')", 1500), files,
  errors,
], { FOLIO_FAKE_TRASH: '1' });
console.log('\nundo, redo, back and forward'); if (process.env.DEBUG) console.log(JSON.stringify(r.js));
const js = r.js;
if (process.env.DEBUG) console.log(JSON.stringify(js));
assert.deepEqual(js.at(-1), [], JSON.stringify(js.at(-1)));
const [rv1, rvOther, rv2, rv3, h1, b1, h2, h3, tab1, tab2, b2, h4, tab3, b3, sl1, sl2, sl3, sl4, sl5, sl6, sl7, sheetU, boardU, ex0, ex1, ex2,
  f1, f2, f3, f4, f5, tabAfterTrash, d1, d2, f6, f7] = js;
assert.equal(rvOther, true); assert.deepEqual(rv1, [true, false]); assert.deepEqual(rv2, [true, false]); assert.equal(rv3, false); console.log('  ✓ a note opened in the visual editor starts with no undo history of its own, not another tab\'s');
console.log('  ✓ in the visual editor Undo still works after switching tabs and coming back');
assert.equal(h1, 'TWO ONE # '); assert.deepEqual(b1, [false, true, false, true]); console.log('  ✓ typing in a note enables Undo, and Redo stays off until something is undone');
assert.equal(h2, 'ONE # Onbo'); assert.equal(h3, 'TWO ONE # '); console.log('  ✓ Undo and Redo from the app command change the note');
assert.equal(tab1, 'Roadmap.md'); assert.equal(tab2, 'Onboarding.md'); assert.deepEqual(b2, [false, true, false, false]); console.log('  ✓ Back returns to the previous note and Forward becomes available');
assert.equal(h4, 'ONE # Onbo'); console.log('  ✓ the note kept its undo history while another tab was open');
assert.equal(tab3, 'Roadmap.md'); assert.deepEqual(b3, [true, true, false, true]); console.log('  ✓ Forward goes on to the next note');
assert.deepEqual(sl1, [true, false]); console.log('  ✓ a new object enables the Undo button on the slides toolbar');
assert.deepEqual(sl2, [true, true]); assert.equal(sl3, false); console.log('  ✓ another deck starts with no history, and Undo there cannot bring back the first deck\'s object');
assert.deepEqual(sl4, [true, false]); assert.equal(sl5, false); assert.equal(sl6, true); assert.equal(sl7, false); console.log('  ✓ back in the first deck its history is intact: Undo, Redo and the toolbar button work');
assert.equal(sheetU, true); assert.equal(boardU, true); console.log('  ✓ sheets and boards start with a clean history too');
assert.equal(ex1, ex0 + 1); assert.equal(ex2, ex0); console.log('  ✓ a change that came from outside the canvas can be undone as its own step');
assert(f1.includes('Plan.md') && !f1.includes('Roadmap.md')); assert(f2.includes('Roadmap.md') && !f2.includes('Plan.md')); assert(f3.includes('Plan.md') && !f3.includes('Roadmap.md')); console.log('  ✓ renaming a note can be undone and redone');
assert(!f4.includes('Plan.md')); assert(f5.includes('Plan.md')); assert.equal(tabAfterTrash, 'Plan.md'); console.log('  ✓ moving a note to the Trash can be undone, and the note reopens');
assert(d1.includes('Temp')); assert(!d2.includes('Temp')); console.log('  ✓ creating a folder can be undone');
assert(f6.includes('Again.md')); assert(f7.includes('Plan.md') && !f7.includes('Again.md')); console.log('  ✓ Undo with the file list focused undoes the last file action');
