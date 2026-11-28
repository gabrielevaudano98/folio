// Folio — local models for the chat: the catalogue is sound and the recommendation fits the computer.
import assert from 'node:assert/strict';
import { CHAT_MODELS, isPinned, modelUrl } from '../src/main/chat/local/catalog.js';
import { plan, fit, ramBudgetGB } from '../src/main/chat/local/system.js';

console.log('\nchat local models');
const GB = 1024 ** 3;
{
  assert.ok(CHAT_MODELS.length >= 12);
  assert.equal(new Set(CHAT_MODELS.map((m) => m.id)).size, CHAT_MODELS.length);
  for (const m of CHAT_MODELS) { assert.ok(m.license && m.licenseUrl.startsWith('https://') && m.file.endsWith('.gguf') && m.ramGB > 0, m.id); }
  assert.ok(CHAT_MODELS.filter((m) => m.ramGB <= 4).length >= 8, 'at least 8 run on an 8 GB computer');
  console.log('  ✓ at least 12 models, unique ids, licences listed, most fit 8 GB');
}
{
  const pinned = CHAT_MODELS.filter(isPinned);
  assert.ok(pinned.length >= 1);
  for (const m of pinned) assert.match(modelUrl(m), /^https:\/\/huggingface\.co\/.+\/resolve\/[0-9a-f]{40}\/.+\.gguf$/);
  assert.equal(isPinned({ rev: 'main', sha256: 'x', bytes: 1 }), false);
  console.log('  ✓ only fully pinned entries are offered, by immutable revision');
}
{
  const dual8 = { cores: 2, ramBytes: 8 * GB, freeRamBytes: 5 * GB, freeBytes: 50 * GB };
  const p = plan(dual8);
  assert.ok(p.budgetGB <= 8 * 0.6 + 0.01);
  assert.ok(p.models.every((m) => m.fit === 'no' || m.ramGB <= p.budgetGB));
  assert.ok(p.recommended, 'a dual core with 8 GB gets a recommendation');
  const big = { cores: 16, ramBytes: 64 * GB, freeRamBytes: 50 * GB, freeBytes: 500 * GB };
  assert.ok(plan(big).models.length >= p.models.length);
  const tiny = { cores: 2, ramBytes: 1 * GB, freeRamBytes: 0.3 * GB, freeBytes: 50 * GB };
  assert.equal(plan(tiny).recommended, null);
  assert.equal(fit({ ramGB: 2, params: '1B', bytes: 2 * GB }, { ...dual8, freeBytes: 1 * GB }), 'no');
  assert.ok(ramBudgetGB(dual8) > 0);
  console.log('  ✓ recommendation respects memory, disk and cores; nothing offered on a 1 GB computer');
}
console.log('chat local models: all passed');
