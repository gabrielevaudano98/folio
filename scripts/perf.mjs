// Folio — performance baseline. Builds a large workspace, starts the app and measures what the plan's budgets name
// (docs/performance/budget.md): launch, memory at rest, the longest main-thread task for common actions.
// Run: npm run build && xvfb-run -a node scripts/perf.mjs   (prints one JSON line; compare before and after a change)
import fs from 'node:fs'; import path from 'node:path';
import { workspace, runApp } from '../test/harness.mjs';

const w = workspace('perf', 47699);
// 1,500 small pages in 30 folders, and one long page (tables, code, lists, links): a heavy but realistic notebook
for (let f = 0; f < 30; f++) { const d = path.join(w.ws, `Area ${f}`); fs.mkdirSync(d, { recursive: true }); for (let i = 0; i < 50; i++) fs.writeFileSync(path.join(d, `Note ${i}.md`), `# Note ${f}.${i}\n\nSome text with a [[Note ${(i + 1) % 50}]] link and #tag${i % 7}.\n`); }
const block = (i) => `## Section ${i}\n\nA paragraph with **bold**, *italic*, \`code\` and a [link](https://example.com) number ${i}.\n\n- item one\n- item two\n  - nested ${i}\n\n| a | b | c |\n|---|---|---|\n| ${i} | x | y |\n\n\`\`\`js\nconst n${i} = ${i} * 2;\n\`\`\`\n`;
fs.writeFileSync(path.join(w.ws, 'Long page.md'), '# Long page\n\n' + Array.from({ length: 400 }, (_, i) => block(i)).join('\n'));
const longtasks = "window.__lt=[];new PerformanceObserver((l)=>{for(const e of l.getEntries())window.__lt.push(Math.round(e.duration))}).observe({type:'longtask',buffered:true});1";
const maxLT = (label) => ({ js: `(()=>{const v={action:'${label}',longestTaskOver50Ms:Math.max(0,...window.__lt),tasksOver50:window.__lt.length};window.__lt=[];return v})()`, log: true, wait: 50 });
const steps = [
  { size: [1400, 900], wait: 500 },
  { js: longtasks, wait: 300 },
  maxLT('startup'),
  { metrics: true, wait: 8000 }, { metrics: true, wait: 50 }, // just after start, then after 8 s at rest
  { js: "document.querySelector('[data-file=\"Long page.md\"]').click();1", wait: 2500 }, maxLT('open long page'),
  // one character every 60 ms, as a fast typist: each keystroke is its own task
  { js: "(()=>{const e=document.querySelector('.ProseMirror')||document.querySelector('.cm-content');e.focus();let i=0;const t=setInterval(()=>{document.execCommand('insertText',false,'x');if(++i>=40)clearInterval(t)},60);return 1})()", wait: 3500 }, maxLT('typing (40 keys)'),
  { js: "(()=>{let s=document.querySelector('.ProseMirror');while(s&&!(s.scrollHeight>s.clientHeight+10&&/(auto|scroll)/.test(getComputedStyle(s).overflowY)))s=s.parentElement;window.__scroller=s?.className||'none';let y=0;const t=setInterval(()=>{y+=300;if(s)s.scrollTop=y},16);setTimeout(()=>clearInterval(t),2000);return 1})()", wait: 2500 }, { js: 'window.__scroller', log: true, wait: 10 }, maxLT('scroll the long page'),
  { js: "window.__folioRun('palette');1", wait: 800 }, maxLT('open command palette'),
  { js: "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));1", wait: 300 },
  { js: "window.__folioRun('quick-open')||1", wait: 800 }, maxLT('quick open'),
  { metrics: true, wait: 50 },
];
const r = await runApp(w, steps, {}, 240000);
const perf = r.log.split('\n').find((l) => l.startsWith('perf ')); const metrics = r.js.filter((x) => x?.metrics);
const out = { loadedMs: perf ? JSON.parse(perf.slice(5)).loadedMs : null, memoryMB: { afterStart: metrics[0]?.totalMB, atRest: metrics[1]?.totalMB, afterWork: metrics[2]?.totalMB }, processes: { afterStart: metrics[0]?.metrics, atRest: metrics[1]?.metrics, afterWork: metrics[2]?.metrics }, actions: r.js.filter((x) => x?.action) };
console.log(JSON.stringify(out, null, 1));
