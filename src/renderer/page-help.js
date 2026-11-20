// Folio — the help sheet (D14): every shortcut the commands carry, the syntax Folio reads, and what works from the keyboard.
// Pure: the host passes its commands and a key labeller; the strings come from i18n.
import { t } from './i18n.js';

/* what to type, and what it makes (the same conventions docs/FORMATS.md lists) */
export const SYNTAX = [
  ['# Title  ## Section', 'Headings'], ['**bold**  *italic*  ~~strike~~  ==highlight==', 'Inline style'],
  ['[text](https://…)  [[Page]]  [[Page#Heading]]  [[Page#^id]]', 'Links, to a page, a heading or a block'],
  ['![[Page#Heading]]', 'Shows that section live, under the line'], ['![alt](.asset/picture.png)', 'An image (kept in the hidden .asset folder)'],
  ['- [ ] task   - [x] done', 'Task list'], ['[status:: draft]  [due:: 2026-12-01]', 'Properties in the text; a status is a chip'],
  ['#tag  #area/sub', 'Tags'], ['> [!note] Title', 'Callout (note, tip, warning…)'],
  ['{==text==}{>>comment<<}', 'Comment'], ['{++added++}  {--removed--}  {~~old~>new~~}', 'Suggestions'],
  ['| a | b |  then  | --- | --- |', 'Table; :--- :---: ---: set the alignment'], ['```js … ```', 'Code block'],
  ['$x^2$  and  $$ … $$', 'Maths'], ['{{Budget.sheet#Costs!H6}}', 'A live value from another document'], ['[TOC]', 'Live table of contents'],
];

/* [{ id, title, rows: [[left, right]] }] filtered by `query` */
export function helpSections(commands, label = (k) => k, query = '') {
  const q = query.trim().toLowerCase(), hit = (a, b) => !q || `${a} ${b}`.toLowerCase().includes(q);
  const keys = commands.filter((c) => c.key).map((c) => [c.title, label(c.key)]).sort((a, b) => a[0].localeCompare(b[0]));
  const kb = [[t('help.kb.chip'), t('help.kb.chipDo')], [t('help.kb.menu'), t('help.kb.menuDo')], [t('help.kb.tab'), t('help.kb.tabDo')]];
  return [
    { id: 'shortcuts', title: t('help.shortcuts'), rows: keys.filter(([a, b]) => hit(a, b)) },
    { id: 'keyboard', title: t('help.keyboard'), rows: kb.filter(([a, b]) => hit(a, b)) },
    { id: 'syntax', title: t('help.syntax'), rows: SYNTAX.map(([a, b]) => [a, b]).filter(([a, b]) => hit(a, b)) },
  ].filter((s) => s.rows.length);
}
