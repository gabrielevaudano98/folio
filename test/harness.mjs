// Shared harness for in-app tests: a fixture workspace, Folio under FOLIO_SHOT steps, logged js results.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';

export function workspace(name, port) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `folio-${name}-`));
  const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud'), out = path.join(tmp, 'out');
  fs.cpSync(new URL('./fixture', import.meta.url), ws, { recursive: true }); fs.mkdirSync(ud); fs.mkdirSync(out);
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: port }));
  return { tmp, ws, ud, out, read: (f) => fs.readFileSync(path.join(ws, f), 'utf8') };
}
export function runApp(w, steps, env = {}) {
  const stepsFile = path.join(w.tmp, `steps-${Date.now()}.json`); fs.writeFileSync(stepsFile, JSON.stringify(steps));
  return new Promise((resolve) => {
    const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: w.ud, FOLIO_SHOT: stepsFile, FOLIO_EXPORT_DIR: w.out, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
    const timer = setTimeout(() => child.kill(), 180000);
    child.on('exit', () => { clearTimeout(timer); resolve({ log, js: log.split('\n').filter((l) => l.startsWith('js ')).map((l) => { try { return JSON.parse(l.slice(3)); } catch { return l.slice(3); } }) }); });
  });
}
export const open = (f) => ({ js: `document.querySelector('[data-file="${f}"]').click();1`, wait: 1800 });
export const fire = "window.__fire=(t,x,y)=>{const tg=t=='mousemove'||t=='mouseup'?document:document.elementFromPoint(x,y);tg.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:t=='mouseup'?0:1,view:window}))};";
/** select a placed object on the canvas by id */
export const pick = (id) => ({ js: `${fire}const r=document.querySelector('.sl-frame .sl-obj[data-id="${id}"]').getBoundingClientRect();const c=[r.x+r.width/2,r.y+r.height/2];__fire('mousedown',...c);__fire('mouseup',...c);setTimeout(()=>document.elementFromPoint(...c).dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:c[0],clientY:c[1]})),60);1`, wait: 500 });
export const errors = { js: 'window.__folioErrors||[]', log: true, wait: 100 };
export const log = (expr, wait = 100) => ({ js: expr, log: true, wait });
export const step = (expr, wait = 400) => ({ js: `(()=>{${expr};return 1})()`, wait });
