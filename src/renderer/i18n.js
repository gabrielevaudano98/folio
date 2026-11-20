// Folio — translatable strings, on i18next (the usual i18n library). Every sentence the app shows goes through t('key', { vars });
// the English catalogue (locales/en.js) is the source of truth, a language file only lists what it translates and anything it
// leaves out falls back to English, then to the key itself. Keys are flat (no namespaces, no dots meaning nesting).
// Variables are written {name}. Plurals follow i18next: `name_one` / `name_other` (CLDR categories of the language) chosen by `n`,
// and `{n}` is printed with the language's number format.
import i18next from 'i18next';
import en from './locales/en.js';
import it from './locales/it.js';

export const LOCALES = { en: { name: 'English', dict: en }, it: { name: 'Italiano', dict: it } };

const i18n = i18next.createInstance();
i18n.init({
  lng: 'en', fallbackLng: 'en', supportedLngs: Object.keys(LOCALES), nonExplicitSupportedLngs: false,
  resources: Object.fromEntries(Object.entries(LOCALES).map(([c, { dict }]) => [c, { translation: dict }])),
  defaultNS: 'translation', keySeparator: false, nsSeparator: false, pluralSeparator: '_', contextSeparator: '\u0000',
  interpolation: { prefix: '{', suffix: '}', escapeValue: false },
  returnNull: false, initAsync: false, saveMissing: false,
});

const KEY = 'folio.lang';
const stored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
let code = LOCALES[stored()] ? stored() : 'en';
i18n.changeLanguage(code);
// The language is remembered here, before the app asks the main process for its settings, so that text built when a file is
// first loaded (menus, tables) already speaks it. Changing the language reloads the window for the same reason.
export function setLocale(c) {
  code = LOCALES[c] ? c : 'en';
  i18n.changeLanguage(code);
  try { localStorage.setItem(KEY, code); } catch { /* storage unavailable */ }
  if (typeof document !== 'undefined') document.documentElement.setAttribute('lang', code);
  return code;
}
export const locale = () => code;
/** the same instance, for tests and for adding strings from a plugin */
export const instance = i18n;
export const has = (key) => i18n.exists(key, { lng: 'en' });

export function t(key, vars) {
  if (!vars) return i18n.t(key);
  const o = { ...vars };
  if (typeof vars.n === 'number') { o.count = vars.n; o.n = new Intl.NumberFormat(code).format(vars.n); }
  return i18n.t(key, o);
}

/** Static HTML: `data-i18n="key"` sets the text, `data-i18n-attr="aria-label:key;data-tip:key"` sets attributes. `fix` may adjust a result (platform key glyphs). */
export function applyStatic(root = document, fix = (s) => s) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = fix(t(el.dataset.i18n));
  for (const el of root.querySelectorAll('[data-i18n-attr]')) for (const pair of el.dataset.i18nAttr.split(';')) { const [a, k] = pair.split(':'); el.setAttribute(a, fix(t(k))); }
}

/** Data written in English in a table (ribbon, insert menu…): the key is `<prefix>.<slug of the English text>`, and the English text itself is the fallback. */
export const slugKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
export const tl = (prefix, text) => { if (typeof text !== 'string' || !text) return text; const k = `${prefix}.${slugKey(text)}`; return i18n.exists(k) ? i18n.t(k) : text; };
