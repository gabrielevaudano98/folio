// Folio Sheets — the function library menus (Formulas tab). Univer's engine implements these; the list is what the
// menus offer first, "More functions…" opens Univer's full searchable list.
export const FUNCTION_GROUPS = {
  financial: ['PMT', 'IPMT', 'PPMT', 'FV', 'PV', 'NPV', 'XNPV', 'IRR', 'XIRR', 'RATE', 'NPER', 'SLN', 'DB', 'DDB'],
  logical: ['IF', 'IFS', 'IFERROR', 'IFNA', 'AND', 'OR', 'NOT', 'XOR', 'SWITCH', 'LET', 'LAMBDA', 'TRUE', 'FALSE'],
  text: ['CONCAT', 'TEXTJOIN', 'TEXT', 'LEFT', 'RIGHT', 'MID', 'LEN', 'FIND', 'SEARCH', 'SUBSTITUTE', 'REPLACE', 'TRIM', 'UPPER', 'LOWER', 'PROPER', 'TEXTSPLIT', 'TEXTBEFORE', 'TEXTAFTER', 'VALUE'],
  date: ['TODAY', 'NOW', 'DATE', 'DATEDIF', 'YEAR', 'MONTH', 'DAY', 'WEEKDAY', 'WEEKNUM', 'EOMONTH', 'EDATE', 'NETWORKDAYS', 'WORKDAY', 'HOUR', 'MINUTE'],
  lookup: ['XLOOKUP', 'VLOOKUP', 'HLOOKUP', 'INDEX', 'MATCH', 'XMATCH', 'CHOOSE', 'OFFSET', 'INDIRECT', 'ROW', 'COLUMN', 'TRANSPOSE', 'HYPERLINK'],
  math: ['SUM', 'SUMIF', 'SUMIFS', 'SUMPRODUCT', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'INT', 'MOD', 'ABS', 'POWER', 'SQRT', 'PRODUCT', 'SUBTOTAL', 'AGGREGATE', 'RAND', 'RANDBETWEEN'],
  stat: ['AVERAGE', 'AVERAGEIF', 'AVERAGEIFS', 'COUNT', 'COUNTA', 'COUNTBLANK', 'COUNTIF', 'COUNTIFS', 'MAX', 'MAXIFS', 'MIN', 'MINIFS', 'MEDIAN', 'MODE', 'STDEV.S', 'VAR.S', 'PERCENTILE.INC', 'QUARTILE.INC', 'CORREL', 'FORECAST.LINEAR'],
  array: ['FILTER', 'SORT', 'SORTBY', 'UNIQUE', 'SEQUENCE', 'RANDARRAY', 'VSTACK', 'HSTACK', 'TAKE', 'DROP', 'CHOOSECOLS', 'CHOOSEROWS', 'TOCOL', 'TOROW', 'WRAPROWS'],
  custom: [],
};
