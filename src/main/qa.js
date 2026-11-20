// Folio — audience Q&A during a presentation: a small page on the local network where people send questions.
// It listens only while the presenter has Q&A open, keeps questions in memory, and never serves files.
import http from 'node:http';
import os from 'node:os';
import qrcode from 'qrcode-generator';

let server = null; let questions = []; let title = 'Questions';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const page = (sent) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:17px/1.5 -apple-system,system-ui,"Segoe UI",sans-serif;margin:0;padding:24px;max-width:560px;margin-inline:auto;color:#1f1f1f;background:#fafafa}h1{font-size:22px;margin:0 0 4px}p{color:#5e5e5e;margin:0 0 20px}label{display:block;font-weight:600;margin:14px 0 6px}input,textarea{width:100%;box-sizing:border-box;font:inherit;padding:12px;border:1px solid #c8c8c8;border-radius:10px;background:#fff}textarea{min-height:120px}button{margin-top:16px;width:100%;padding:14px;font:inherit;font-weight:600;border:0;border-radius:10px;background:#1f1f1f;color:#fff}.ok{padding:12px;border-radius:10px;background:#e9f5ec;color:#185c2c}</style></head>
<body><h1>${esc(title)}</h1><p>Ask the speaker a question. It appears on the presenter’s screen.</p>${sent ? '<p class="ok" role="status">Thanks, your question was sent.</p>' : ''}
<form method="post" action="/ask"><label for="q">Your question</label><textarea id="q" name="q" required maxlength="500"></textarea><label for="n">Your name (optional)</label><input id="n" name="n" maxlength="60" autocomplete="name"><button type="submit">Send question</button></form></body></html>`;
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return '127.0.0.1';
}
export async function startQa(deckTitle = '') {
  title = deckTitle ? `Questions · ${deckTitle}` : 'Questions';
  if (!server) {
    questions = [];
    server = http.createServer((req, res) => {
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.method === 'POST' && req.url === '/ask') {
        let body = '';
        req.on('data', (d) => { body += d; if (body.length > 4000) req.destroy(); });
        req.on('end', () => {
          const p = new URLSearchParams(body); const q = (p.get('q') || '').trim().slice(0, 500); const n = (p.get('n') || '').trim().slice(0, 60);
          if (q && questions.length < 500) questions.push({ text: q, name: n, at: Date.now() });
          res.writeHead(303, { Location: '/?sent=1' }); res.end();
        });
        return;
      }
      if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page(req.url.includes('sent=1'))); return; }
      res.writeHead(404); res.end();
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '0.0.0.0', resolve); });
  }
  const url = `http://${lanAddress()}:${server.address().port}/`;
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  return { url, qr: qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true, alt: 'QR code for the question page' }) };
}
export const pollQa = () => questions.slice();
export function stopQa() { server?.close(); server = null; }
