// Folio Sheets — syntax colours for the code editors in panels: greys and weight only (tokens.css, chroma 0).
export function highlightStyle(language) {
  const { HighlightStyle } = language;
  // lezer tags come from @lezer/highlight; CodeMirror re-exports them through the language package's dependency
  return HighlightStyle.define([
    { tag: tagsOf('keyword'), fontWeight: '680', color: 'var(--color-ink)' },
    { tag: tagsOf('string'), color: 'var(--color-ink-2)' },
    { tag: tagsOf('number'), color: 'var(--color-ink-2)', fontVariantNumeric: 'tabular-nums' },
    { tag: tagsOf('comment'), color: 'var(--color-muted)', fontStyle: 'italic' },
    { tag: tagsOf('function'), textDecoration: 'underline', textDecorationColor: 'var(--color-rule-strong)', textUnderlineOffset: '3px' },
    { tag: tagsOf('operator'), color: 'var(--color-muted)' },
  ]);
}
import { tags as t } from '@lezer/highlight';
function tagsOf(k) {
  return { keyword: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword], string: [t.string, t.special(t.string)], number: [t.number, t.bool, t.null], comment: [t.comment, t.lineComment, t.blockComment], function: [t.function(t.variableName), t.function(t.propertyName)], operator: [t.operator, t.compareOperator, t.arithmeticOperator] }[k];
}
