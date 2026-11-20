// Folio page tools for AIs (D13): sections, block ids, comments and suggestions on plain Markdown text.
import assert from 'node:assert/strict';
import { sections, findSection, findBlock, readSection, replaceSection, insertAfter, addComment, suggestEdit, PageToolError } from '../src/main/page-tools.js';
import { listChanges, accept, reject, resolveAll } from '../src/main/critic-text.js';

let n = 0; const ok = (m) => { n++; console.log('  ✓', m); };
console.log('\npage tools');
const doc = `# Plan

Intro text.

## Goals

- Ship D13
- Test it

### Stretch

Maybe more. ^b1

## Risks

None known.

\`\`\`md
## Not a heading
\`\`\`

## Goals

Second goals section.
`;

{ const s = sections(doc);
  assert.deepEqual(s.map((h) => [h.level, h.text, h.line]), [[1, 'Plan', 1], [2, 'Goals', 5], [3, 'Stretch', 10], [2, 'Risks', 14], [2, 'Goals', 22]]);
  assert.equal(s[1].end, 12); assert.equal(s[3].end, 20);
  ok('sections: levels, lines and ends; headings inside code fences are ignored'); }

{ assert.throws(() => findSection(doc, 'Goals'), (e) => e instanceof PageToolError && /2 headings/.test(e.message));
  assert.equal(findSection(doc, 'Goals', { line: 22 }).line, 22);
  assert.equal(findSection(doc, 'plan > risks').line, 14);
  assert.throws(() => findSection(doc, 'Nowhere'), /Headings: Plan/);
  assert.throws(() => findSection(doc, 'Risks > Goals'), /not found/);
  ok('findSection: case-insensitive, paths, line, ambiguity and missing errors list what exists'); }

{ const r = readSection(doc, 'Goals', { line: 5 });
  assert.equal(r.fromLine, 5); assert.equal(r.toLine, 12); assert(r.text.includes('### Stretch') && !r.text.includes('Risks'));
  assert.equal(r.body.split('\n')[0], '- Ship D13');
  const own = readSection(doc, 'Goals', { line: 5, includeChildren: false });
  assert(!own.text.includes('Stretch') && own.toLine === 8);
  ok('readSection: with and without sub-sections'); }

{ const out = replaceSection(doc, 'Risks', 'Many.\n');
  assert(out.includes('## Risks\n\nMany.\n\n## Goals') && !out.includes('None known'));
  assert.equal(out.split('\n## Risks')[0], doc.split('\n## Risks')[0]);
  assert.equal(out.split('\n## Goals\n\nSecond')[1], doc.split('\n## Goals\n\nSecond')[1]);
  const big = replaceSection(doc, 'Goals', '- only this', { line: 5 });
  assert(!big.includes('Stretch') && big.includes('## Goals\n\n- only this\n\n## Risks'));
  const withHead = replaceSection(doc, 'Risks', '## Dangers\n\nSome.', { includeHeading: true });
  assert(withHead.includes('## Dangers\n\nSome.\n\n## Goals') && !withHead.includes('## Risks'));
  ok('replaceSection: only that section changes; heading kept (or replaced with includeHeading); sub-sections go with it'); }

{ const a = insertAfter(doc, 'Risks', '- New risk');
  assert(a.includes('None known.\n\n```md\n## Not a heading\n```\n\n- New risk\n\n## Goals'));
  const b = insertAfter(doc, '^b1', 'Inserted block');
  assert(b.includes('Maybe more. ^b1\n\nInserted block\n\n## Risks'));
  assert.throws(() => insertAfter(doc, '^zzz', 'x'), /Block id not found/);
  assert.deepEqual(findBlock(doc, '^b1'), { from: 12, to: 12 });
  const last = insertAfter('# A\n\ntext\n', 'A', 'more');
  assert.equal(last, '# A\n\ntext\n\nmore\n');
  ok('insertAfter: after a heading section or a ^id block, spacing kept, text ending with a newline kept'); }

{ const c = addComment('One two three.\n', 'two', 'Why two?', { author: 'Claude', date: '2026-11-20 10:00' });
  assert.equal(c, 'One {==two==}{>>Claude, 2026-11-20 10:00: Why two?<<} three.\n');
  const ch = listChanges(c); assert(ch.some((x) => x.kind === 'comment' && x.comment.author === 'Claude' && x.comment.text === 'Why two?'));
  assert.equal(resolveAll(c), 'One two three.\n');
  assert.throws(() => addComment('a a', 'a', 'x'), /appears 2 times/);
  assert.equal(addComment('a a', 'a', 'x', { occurrence: 2, author: '', date: 'd' }), 'a {==a==}{>>x<<}');
  assert.throws(() => addComment('use `code here` ok', 'code here', 'x'), /not found outside code/);
  assert.throws(() => addComment('x', 'x{++', 'c'), /CriticMarkup/);
  ok('addComment: highlight and comment as CriticMarkup, author and date, occurrence, never inside code'); }

{ const sub = suggestEdit('One two three.\n', { oldText: 'two', newText: '2', comment: 'digits', author: 'Claude', date: 'D' });
  assert.equal(sub, 'One {~~two~>2~~}{>>Claude, D: digits<<} three.\n');
  assert.equal(accept(sub).replace(/\{>>.*?<<\}/, ''), 'One 2 three.\n'); assert.equal(reject(sub).replace(/\{>>.*?<<\}/, ''), 'One two three.\n');
  assert.equal(suggestEdit('One two.', { oldText: ' two', newText: '' }), 'One{-- two--}.');
  assert.equal(suggestEdit('One two.', { insertAfter: 'One', newText: ' and a half' }), 'One{++ and a half++} two.');
  assert.equal(accept(suggestEdit('One two.', { insertAfter: 'One', newText: ' and a half' })), 'One and a half two.');
  assert.throws(() => suggestEdit('x', {}), /give oldText/);
  assert.throws(() => suggestEdit('x y', { oldText: 'x', newText: 'a~>b' }), /CriticMarkup/);
  ok('suggestEdit: substitution, deletion, insertion, optional comment; accept and reject give the right text; delimiters in the text are refused'); }

console.log(`\n${n} checks passed`);
