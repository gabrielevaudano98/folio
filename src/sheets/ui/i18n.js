// Folio Sheets — interface text. English is written in the code; the Italian catalogue below is keyed by the English
// text (test/sheets-ui.test.mjs checks that every literal L('…') and every ribbon label has an entry).
// The app's language comes from renderer/i18n.js; Univer's own menus use Univer's it-IT catalogue.
import { locale } from '../../renderer/i18n.js';
import IT from './locale-it.js';

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);
/** translate English UI text; {name} placeholders are filled from `vars` */
export function L(text, vars) {
  if (typeof text !== 'string') return text;
  const s = locale() === 'it' ? IT[text] ?? text : text;
  return fill(s, vars);
}
export const lang = () => locale();
export { IT };
