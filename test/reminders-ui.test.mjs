// Folio reminders in the app (W2-B): the date popover's Include time and Remind write `[[day]]{09:30 remind 30m}` after
// the day link (nothing else in the file changes), the chip reads "Tomorrow 9:30" with a bell, the sidebar lists every
// reminder of the folder (overdue ones marked), one that comes due while Folio runs shows a toast with Open, and Done /
// Dismiss go to the settings file, never to the page.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-rem-ui-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud'), pages = path.join(ws, 'pages');
fs.mkdirSync(pages, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47613 }));
const pad = (n) => String(n).padStart(2, '0'); const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date(); const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1); const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
const soon = new Date(now.getTime() + 90000); soon.setSeconds(0, 0); // the next whole minute that is at least 30 s away: slow runs still read the list before it fires
const soonMs = soon.getTime() - now.getTime();
const a = `# Plan\n\n- [ ] Call Ada [[${key(tomorrow)}]] end\n\nOther text stays.\n`;
fs.writeFileSync(path.join(pages, 'a.md'), a);
fs.writeFileSync(path.join(pages, 'b.md'), `Pay rent [[${key(yesterday)}]]{09:00 remind}\n`);
fs.writeFileSync(path.join(pages, 'c.md'), `Ping the team [[${key(soon)}]]{${pad(soon.getHours())}:${pad(soon.getMinutes())} remind}\n`);
const list = "[...document.querySelectorAll('#reminders-list .rem-item')].map((e) => [e.querySelector('.rem-title').textContent, e.className.replace('rem-item ', ''), e.querySelector('.rem-open').dataset.open])";
const steps = [
  { size: [1400, 900], wait: 1500 },
  { js: "document.querySelector('[data-dir=\"pages\"]').click()", wait: 500 },
  { js: "document.querySelector('[data-file=\"pages/a.md\"]').click()", wait: 900 },
  { js: "document.querySelector('#view-switch [data-view=\"edit\"]').click()", wait: 1200 },
  { js: "(() => { const el = document.querySelector('.rich-chip.is-date'); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: r.left + 3, clientY: r.top + 3 })); const p = document.querySelector('.date-pop'); return [!!p, !!p?.querySelector('.date-time-on'), !!p?.querySelector('.date-end-on'), [...(p?.querySelectorAll('.date-remind option') || [])].map((o) => o.value)]; })()", log: true, wait: 400 },
  { js: "(() => { const p = document.querySelector('.date-pop'); const on = p.querySelector('.date-time-on'); on.checked = true; on.dispatchEvent(new Event('change', { bubbles: true })); const t = p.querySelector('.date-time'); t.value = '09:30'; t.dispatchEvent(new Event('change', { bubbles: true })); const s = p.querySelector('.date-remind'); s.value = '30m'; s.dispatchEvent(new Event('change', { bubbles: true })); return !!document.querySelector('.date-pop'); })()", log: true, wait: 300 },
  { js: "document.querySelector('.date-pop').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); true", wait: 2500 },
  { js: "(() => { const c = document.querySelector('.rich-chip.is-date'); return [c.textContent, c.classList.contains('is-remind'), getComputedStyle(c, '::after').content !== 'none']; })()", log: true, wait: 600 },
  { js: list, log: true, wait: soonMs },
  { js: "(window.__folioToasts || []).filter((t) => /Ping the team/.test(t))", log: true, wait: 100 },
  // Done on a.md's reminder, Dismiss on the overdue one
  { js: "(() => { const it = [...document.querySelectorAll('#reminders-list .rem-item')].find((e) => e.querySelector('.rem-open').dataset.open === 'pages/a.md'); it.querySelector('[data-act=\"done\"]').click(); return true; })()", wait: 800 },
  { js: "(() => { const it = [...document.querySelectorAll('#reminders-list .rem-item')].find((e) => e.querySelector('.rem-open').dataset.open === 'pages/b.md'); it.querySelector('[data-act=\"dismiss\"]').click(); return true; })()", wait: 800 },
  { js: list + ".concat([[document.querySelector('#reminders-list .rem-more')?.textContent || '']])", log: true, wait: 600 },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true })); // after the last assertion, however it ends
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile, FOLIO_NO_OS_NOTIFY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 180000);
child.on('close', () => { // 'close': after the output is fully drained
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\nreminders ui'); if (process.env.DEBUG) console.log(JSON.stringify(logs, null, 1));
  assert.equal(logs.length, 7, out.slice(-2000));
  const [pop, stillOpen, chip, before, toasts, after, errors] = logs; assert.deepEqual(errors, []);
  assert.deepEqual(pop.slice(0, 3), [true, true, true]); assert.deepEqual(pop[3], ['', '0', '5m', '10m', '30m', '1h', '1d', '2d', 'custom']);
  assert.equal(stillOpen, true, 'the popover stays open while its options change');
  console.log('  ✓ the date popover has Include time, End date and Remind (None, at time, 5/10/30 min, 1 hour, 1/2 days, custom)');
  assert.equal(fs.readFileSync(path.join(pages, 'a.md'), 'utf8'), a.replace(`[[${key(tomorrow)}]]`, `[[${key(tomorrow)}]]{09:30 remind 30m}`));
  assert.deepEqual(chip, ['Tomorrow 9:30', true, true]);
  console.log('  ✓ time and reminder are written after the day link and nothing else changes; the chip reads “Tomorrow 9:30” with a bell');
  assert.deepEqual(before.map((r) => [r[0], r[1], r[2]]), [['Pay rent', 'is-overdue', 'pages/b.md'], ['Ping the team', 'is-upcoming', 'pages/c.md'], ['Call Ada end', 'is-upcoming', 'pages/a.md']]);
  console.log('  ✓ the Reminders section lists every reminder of the folder, soonest first, the missed one overdue');
  assert.equal(toasts.length, 1, 'a reminder that comes due while Folio runs shows one toast');
  console.log('  ✓ a reminder that comes due while Folio runs shows a toast with Open');
  assert.ok(!after.some((r) => r[2] === 'pages/b.md'), 'dismissed is hidden'); assert.ok(!after.some((r) => r[2] === 'pages/a.md'), 'done is folded away');
  assert.match(after.at(-1)[0], /1/);
  const st = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).reminderStates[ws];
  assert.deepEqual(Object.values(st).sort(), ['dismissed', 'done']);
  assert.equal(fs.readFileSync(path.join(pages, 'b.md'), 'utf8'), `Pay rent [[${key(yesterday)}]]{09:00 remind}\n`);
  console.log('  ✓ Done and Dismiss are stored in the settings file per folder; the pages keep their reminders as written');
});
