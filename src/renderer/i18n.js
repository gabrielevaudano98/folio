// Folio — strings ready for translation (D14). Every sentence the app shows from code goes through t('key', { vars });
// the English catalogue (locales/en.js) is the source of truth, a language file only has to list what it translates
// and anything it leaves out falls back to English. Plurals: keys `name.one` and `name.other` with {n}.
import en from './locales/en.js';
import it from './locales/it.js';

export const LOCALES = { en: { name: 'English', dict: en }, it: { name: 'Italiano', dict: it } };
let code = 'en', dict = en;

export function setLocale(c) { code = LOCALES[c] ? c : 'en'; dict = LOCALES[code].dict; if (typeof document !== 'undefined') document.documentElement.setAttribute('lang', code); return code; }
export const locale = () => code;

export function t(key, vars) {
  let s;
  if (vars && typeof vars.n === 'number') { const rule = new Intl.PluralRules(code).select(vars.n); s = dict[`${key}.${rule}`] ?? en[`${key}.${rule}`] ?? dict[`${key}.other`] ?? en[`${key}.other`]; }
  s = s ?? dict[key] ?? en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (k === 'n' ? new Intl.NumberFormat(code).format(vars.n) : vars[k] ?? '')) : s;
}
