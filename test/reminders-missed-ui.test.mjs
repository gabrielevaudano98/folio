// #86 reminders in the app: one that came due while Folio was closed is announced at start (a toast and an OS
// notification), clicking the notification brings Folio forward on that note (the FOLIO_NO_OS_NOTIFY stand-in is clicked
// by the test runner), and a front matter date gets a reminder from its bell in the Properties panel (one line written).
import fs from 'node:fs'; import path from 'node:path';
import assert from 'node:assert/strict';
import { workspace, runApp } from './harness.mjs';

const w = workspace('reminders-missed-ui', 47635);
const sf = path.join(w.ud, 'settings.json');
const pad = (n) => String(n).padStart(2, '0'); const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date(); const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1); const nextWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
fs.mkdirSync(path.join(w.ws, 'pages'), { recursive: true });
fs.writeFileSync(sf, JSON.stringify({ ...JSON.parse(fs.readFileSync(sf, 'utf8')), remindersSeen: { [w.ws]: now.getTime() - 3 * 864e5 } }));
const A = `# Bills\n\nSome text.\n\n- [ ] Pay rent [[${key(yesterday)}]]{09:00 remind}\n`;
const B = `---\ndue: ${key(nextWeek)}\nowner: Ada\n---\n# Trip\n\nBody.\n`;
fs.writeFileSync(path.join(w.ws, 'pages', 'a.md'), A); fs.writeFileSync(path.join(w.ws, 'pages', 'b.md'), B);
const steps = [
  { size: [1400, 900], wait: 1800 },
  // 1. announced at start: one toast, one OS notification
  { js: "(window.__folioToasts || []).filter((t) => /closed/.test(t))", log: true, wait: 100 },
  { notifications: true, wait: 100 },
  { js: "[...document.querySelectorAll('#reminders-list .rem-item')].map((e) => [e.querySelector('.rem-title').textContent, e.className.replace('rem-item ', '')])", log: true, wait: 100 },
  // 2. clicking the notification opens the note at the reminder's line
  { notifyClick: 0, wait: 1500 },
  { js: "[document.querySelector('[data-tab][aria-selected=true], .tab.is-active')?.dataset.tab || '', document.hasFocus()]", log: true, wait: 100 },
  // 3. a front matter date: the bell in the Properties panel writes `due-remind:` under the date
  { js: "document.querySelector('[data-file=\"pages/b.md\"]').click(); true", wait: 1000 },
  { js: "document.querySelector('#view-switch [data-view=\"edit\"]').click(); true", wait: 1200 },
  { js: "(() => { const s = document.querySelector('.prop-row[data-key=\"due\"] .prop-remind'); return s ? [...s.options].map((o) => o.value) : null; })()", log: true, wait: 100 },
  { js: "(() => { const s = document.querySelector('.prop-row[data-key=\"due\"] .prop-remind'); s.value = '1d'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()", wait: 1800 },
  { js: "folio.read('pages/b.md')", log: true, wait: 100 },
  { js: "[[...document.querySelectorAll('.props .prop-row')].map((r) => r.dataset.key), document.querySelector('.prop-row[data-key=\"due\"] .prop-remind').value]", log: true, wait: 600 },
  { js: "[...document.querySelectorAll('#reminders-list .rem-item')].map((e) => [e.querySelector('.rem-title').textContent, e.querySelector('.rem-open').dataset.open])", log: true, wait: 100 },
  // 4. None removes the line again
  { js: "(() => { const s = document.querySelector('.prop-row[data-key=\"due\"] .prop-remind'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()", wait: 1800 },
  { js: "folio.read('pages/b.md')", log: true, wait: 100 },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
const { js, log } = await runApp(w, steps, { FOLIO_NO_OS_NOTIFY: '1' }, 120000);
console.log('\nmissed reminders and front matter reminders, ui');
assert.equal(js.length, 10, log.slice(-2000));
const [toasts, notes, list, afterClick, options, written, rows, listAfter, removed, errors] = [js[0], js[1], js[2], js[3], js[4], js[5], js[6], js[7], js[8], js[9]];
assert.deepEqual(errors, [], 'no renderer errors');
assert.equal(toasts.length, 1, JSON.stringify(toasts)); assert.match(toasts[0], /Missed while Folio was closed: Pay rent/);
assert.deepEqual(notes, [{ title: 'A reminder came due while Folio was closed', body: 'Pay rent' }]);
assert.deepEqual(list, [['Pay rent', 'is-overdue']]);
console.log('  ✓ a reminder that came due while Folio was closed is announced at start (toast and OS notification) and listed overdue');
assert.equal(afterClick[0], 'pages/a.md');
console.log('  ✓ clicking the notification brings Folio forward on that note');
assert.deepEqual(options, ['', '0', '5m', '10m', '30m', '1h', '1d', '2d']);
assert.equal(written, B.replace(`due: ${key(nextWeek)}\n`, `due: ${key(nextWeek)}\ndue-remind: 1d\n`), 'one line, right under the date');
assert.deepEqual(rows, [['due', 'owner'], '1d'], 'the reminder line is the date’s bell, not a property of its own');
assert(listAfter.some(([t, p]) => t === 'Trip · due' && p === 'pages/b.md'), JSON.stringify(listAfter));
assert.equal(removed, B);
console.log('  ✓ a front matter date gets a reminder from its bell: one `due-remind:` line under it, listed with the others; None removes it');
fs.rmSync(w.tmp, { recursive: true, force: true });
