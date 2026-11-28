// Folio Sheets — formula text between Univer and Excel files. Excel stores functions added after 2007 with a prefix
// (`_xlfn.XLOOKUP`, `_xlfn._xlws.FILTER`, LAMBDA parameters as `_xlpm.x`); a file without it shows #NAME? in Excel, and
// a prefix left in an imported formula shows #NAME? in Folio. Text inside "strings" and 'sheet names' is never touched.
// Source of the list: [MS-XLSX] 2.2.2 "Formulas", future functions.

const XLWS = new Set(['FILTER', 'SORT']);
const FUTURE = new Set([
  'ACOT', 'ACOTH', 'AGGREGATE', 'ARABIC', 'ARRAYTOTEXT', 'BASE', 'BETA.DIST', 'BETA.INV', 'BINOM.DIST', 'BINOM.DIST.RANGE',
  'BINOM.INV', 'BITAND', 'BITLSHIFT', 'BITOR', 'BITRSHIFT', 'BITXOR', 'BYCOL', 'BYROW', 'CEILING.MATH', 'CEILING.PRECISE',
  'CHISQ.DIST', 'CHISQ.DIST.RT', 'CHISQ.INV', 'CHISQ.INV.RT', 'CHISQ.TEST', 'CHOOSECOLS', 'CHOOSEROWS', 'COMBINA',
  'CONCAT', 'CONFIDENCE.NORM', 'CONFIDENCE.T', 'COT', 'COTH', 'COVARIANCE.P', 'COVARIANCE.S', 'CSC', 'CSCH', 'DAYS',
  'DECIMAL', 'DROP', 'ERF.PRECISE', 'ERFC.PRECISE', 'EXPAND', 'EXPON.DIST', 'F.DIST', 'F.DIST.RT', 'F.INV', 'F.INV.RT',
  'F.TEST', 'FILTER', 'FILTERXML', 'FLOOR.MATH', 'FLOOR.PRECISE', 'FORECAST.ETS', 'FORECAST.ETS.CONFINT',
  'FORECAST.ETS.SEASONALITY', 'FORECAST.ETS.STAT', 'FORECAST.LINEAR', 'FORMULATEXT', 'GAMMA', 'GAMMA.DIST', 'GAMMA.INV',
  'GAMMALN.PRECISE', 'GAUSS', 'HSTACK', 'HYPGEOM.DIST', 'IFNA', 'IFS', 'IMAGE', 'IMCOSH', 'IMCOT', 'IMCSC', 'IMCSCH',
  'IMSEC', 'IMSECH', 'IMSINH', 'IMTAN', 'ISFORMULA', 'ISOMITTED', 'ISOWEEKNUM', 'LAMBDA', 'LET', 'LOGNORM.DIST',
  'LOGNORM.INV', 'MAKEARRAY', 'MAP', 'MAXIFS', 'MINIFS', 'MODE.MULT', 'MODE.SNGL', 'MUNIT', 'NEGBINOM.DIST',
  'NETWORKDAYS.INTL', 'NORM.DIST', 'NORM.INV', 'NORM.S.DIST', 'NORM.S.INV', 'NUMBERVALUE', 'PDURATION',
  'PERCENTILE.EXC', 'PERCENTILE.INC', 'PERCENTRANK.EXC', 'PERCENTRANK.INC', 'PERMUTATIONA', 'PHI', 'POISSON.DIST',
  'QUARTILE.EXC', 'QUARTILE.INC', 'RANDARRAY', 'RANK.AVG', 'RANK.EQ', 'REDUCE', 'RRI', 'SCAN', 'SEC', 'SECH', 'SEQUENCE',
  'SHEET', 'SHEETS', 'SKEW.P', 'SORT', 'SORTBY', 'STDEV.P', 'STDEV.S', 'SWITCH', 'T.DIST', 'T.DIST.2T', 'T.DIST.RT',
  'T.INV', 'T.INV.2T', 'T.TEST', 'TAKE', 'TEXTAFTER', 'TEXTBEFORE', 'TEXTJOIN', 'TEXTSPLIT', 'TOCOL', 'TOROW', 'UNICHAR',
  'UNICODE', 'UNIQUE', 'VALUETOTEXT', 'VAR.P', 'VAR.S', 'VSTACK', 'WEBSERVICE', 'WEIBULL.DIST', 'WORKDAY.INTL',
  'WRAPCOLS', 'WRAPROWS', 'XLOOKUP', 'XMATCH', 'XOR', 'Z.TEST',
]);

/** apply `fn` to the parts of a formula outside "string" and 'quoted sheet name' literals */
function outsideLiterals(f, fn) {
  let out = '', i = 0, start = 0;
  while (i < f.length) {
    const q = f[i];
    if (q !== '"' && q !== "'") { i++; continue; }
    out += fn(f.slice(start, i));
    let j = i + 1;
    for (; j < f.length; j++) if (f[j] === q) { if (f[j + 1] === q) j++; else break; } // "" and '' escape a quote
    out += f.slice(i, j + 1); i = start = j + 1;
  }
  return out + fn(f.slice(start));
}

/** Univer formula (with or without "=") → Excel file formula (no "=", prefixes added) */
export function toExcelFormula(f) {
  const body = String(f).replace(/^=/, '');
  if (!/[A-Za-z]\.?[A-Za-z0-9.]*\s*\(/.test(body)) return body;
  return outsideLiterals(body, (s) => s.replace(/(^|[^A-Za-z0-9_.!])([A-Za-z][A-Za-z0-9.]*)(?=\s*\()/g, (m, pre, name) => {
    const up = name.toUpperCase();
    if (!FUTURE.has(up)) return m;
    return pre + (XLWS.has(up) ? '_xlfn._xlws.' : '_xlfn.') + name;
  }));
}

/** Excel file formula → Univer formula text (prefixes removed; no "=" added) */
export function fromExcelFormula(f) {
  const body = String(f);
  if (!body.includes('_xl')) return body;
  return outsideLiterals(body, (s) => s.replace(/_xlfn\.(_xlws\.)?|_xlpm\.|_xlws\./g, ''));
}
