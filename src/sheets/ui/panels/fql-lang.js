// Folio Sheets — FQL highlighting and completion for the query editor (a CodeMirror StreamLanguage).
import { FUNCTIONS } from '../../core/fql/run.js';

const KW = new Set(['query', 'model', 'let', 'from', 'where', 'derive', 'select', 'drop', 'rename', 'groupby', 'rollup', 'orderby', 'join', 'pivot', 'unpivot', 'dedupe', 'fill', 'limit', 'type', 'split', 'append', 'load', 'to', 'at', 'as', 'by', 'on', 'using', 'into', 'and', 'or', 'not', 'in', 'is', 'null', 'true', 'false', 'between', 'table', 'relate', 'measure', 'evaluate', 'sheet', 'range', 'csv', 'json', 'xlsx', 'parquet', 'sql', 'values', 'left', 'right', 'inner', 'full', 'down', 'up', 'with']);
const AGG = ['sum', 'count', 'avg', 'mean', 'min', 'max', 'median', 'distinct', 'stdev', 'variance', 'first', 'last'];

export function fqlLanguage(language) {
  const { StreamLanguage } = language;
  const lang = StreamLanguage.define({
    name: 'fql',
    token(s) {
      if (s.eatSpace()) return null;
      if (s.match('--') || s.match('#')) { s.skipToEnd(); return 'comment'; }
      if (s.match(/^"([^"\\]|\\.)*"?/) || s.match(/^'([^'\\]|\\.)*'?/)) return 'string';
      if (s.match(/^`[^`]*`?/)) return 'variableName';
      if (s.match(/^\d+(\.\d+)?(e[-+]?\d+)?/i)) return 'number';
      if (s.match(/^(->|==|!=|<>|<=|>=|[-+*/%^=<>|])/)) return 'operator';
      const m = s.match(/^[A-Za-z_À-￿][\wÀ-￿]*/);
      if (m) { const w = m[0].toLowerCase(); if (KW.has(w)) return 'keyword'; if (s.peek() === '(') return 'function'; return 'variableName'; }
      s.next(); return null;
    },
    languageData: { commentTokens: { line: '--' } },
  });
  return [lang, lang.data.of({ autocomplete: (ctx) => { const w = ctx.matchBefore(/[A-Za-z_]\w*/); if (!w || (w.from === w.to && !ctx.explicit)) return null; return { from: w.from, options: [...[...KW].map((k) => ({ label: k, type: 'keyword' })), ...AGG.map((f) => ({ label: f, type: 'function', apply: `${f}(` })), ...Object.keys(FUNCTIONS).map((f) => ({ label: f, type: 'function', apply: `${f}(` }))] }; } })];
}
