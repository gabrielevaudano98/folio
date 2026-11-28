// Fills revision, size and SHA-256 of the chat models in src/main/chat/local/catalog.js from Hugging Face's own file records.
// Run it with network access: `node scripts/pin-chat-models.mjs`. It rewrites only the entries that are not pinned yet.
// Review the diff: a model is trusted from the moment its hash is committed.
import fs from 'node:fs';
import { CHAT_MODELS, isPinned } from '../src/main/chat/local/catalog.js';

const FILE = new URL('../src/main/chat/local/catalog.js', import.meta.url);
let text = fs.readFileSync(FILE, 'utf8'), changed = 0;
for (const m of CHAT_MODELS.filter((x) => !isPinned(x))) {
  const info = await (await fetch(`https://huggingface.co/api/models/${m.repo}`)).json();
  const rev = info.sha;
  const tree = await (await fetch(`https://huggingface.co/api/models/${m.repo}/tree/${rev}`)).json();
  const f = tree.find((x) => x.path === m.file);
  if (!rev || !f?.lfs?.oid || !f.size) { console.error(`skip ${m.id}: ${m.repo}/${m.file} not found`); continue; }
  const needle = `file: '${m.file}', ramGB`;
  if (!text.includes(needle)) { console.error(`skip ${m.id}: entry text changed`); continue; }
  text = text.replace(needle, `file: '${m.file}', rev: '${rev}', sha256: '${f.lfs.oid}', bytes: ${f.size}, ramGB`);
  changed++; console.log(`pinned ${m.id} ${(f.size / 1e9).toFixed(2)} GB`);
}
fs.writeFileSync(FILE, text);
console.log(`${changed} pinned`);
