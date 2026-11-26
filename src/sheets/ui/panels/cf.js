// Folio Sheets — a quick conditional formatting rule (area 3). Univer's own panel (Home → Conditional formatting →
// Manage rules) edits every kind of rule; this one makes the common rules in one step, with Folio's greys and the
// content colours authors use for their data.
import { h, hint, field, input, number, select, button, actions, status, rangeInput } from './kit.js';
import { cssHex } from '../univer.js';
import { L } from '../i18n.js';

const RULES = [['greaterThan', 'Greater than'], ['lessThan', 'Less than'], ['between', 'Between'], ['equal', 'Equal to'], ['contains', 'Text contains'], ['empty', 'Empty'], ['notEmpty', 'Not empty'], ['duplicates', 'Duplicate values'], ['unique', 'Unique values'], ['top', 'Top N'], ['bottom', 'Bottom N'], ['formula', 'Formula is true']];
const STYLES = [['gray', 'Grey fill'], ['red', 'Red fill'], ['yellow', 'Yellow fill'], ['green', 'Green fill'], ['blue', 'Blue fill'], ['bold', 'Bold text']];

export default {
  title: 'Highlight cells',
  mount(body, { surface, opts }) {
    const root = h('div.xs-panel'); body.append(root);
    const rng = rangeInput(surface, surface.selectionRef({ withSheet: false }), { withSheet: false, label: L('Apply to') });
    const rule = select(RULES.map(([v, l]) => [v, L(l)]), opts.preset || 'greaterThan');
    const a = input({ 'aria-label': L('Value') }), b = number({ 'aria-label': L('Second value') });
    const style = select(STYLES.map(([v, l]) => [v, L(l)]), 'yellow');
    const st = status();
    const sync = () => { const r = rule.value; a.closest('.field').hidden = ['empty', 'notEmpty', 'duplicates', 'unique'].includes(r); b.closest('.field').hidden = r !== 'between'; a.placeholder = r === 'formula' ? '=$D2>100' : r === 'top' || r === 'bottom' ? '10' : ''; };
    rule.addEventListener('change', sync);
    root.append(hint(L('Cells that meet the rule get the style. Rules recompute as values change.')), rng, field(L('Rule'), rule), field(L('Value'), a), field(L('and'), b), field(L('Style'), style),
      actions(button(L('Add rule'), () => {
        try {
          const ws = surface.ws(); const range = ws.getRange(rng.control.value);
          let bld = ws.newConditionalFormattingRule().setRanges([range.getRange()]);
          const n = Number(a.value), r = rule.value;
          bld = { greaterThan: () => bld.whenNumberGreaterThan(n), lessThan: () => bld.whenNumberLessThan(n), between: () => bld.whenNumberBetween(n, Number(b.value)), equal: () => (Number.isFinite(n) && a.value !== '' ? bld.whenNumberEqualTo(n) : bld.whenTextEqualTo(a.value)), contains: () => bld.whenTextContains(a.value), empty: () => bld.whenCellEmpty(), notEmpty: () => bld.whenCellNotEmpty(), duplicates: () => bld.setDuplicateValues(), unique: () => bld.setUniqueValues(), top: () => bld.setRank({ isBottom: false, isPercent: false, value: n || 10 }), bottom: () => bld.setRank({ isBottom: true, isPercent: false, value: n || 10 }), formula: () => bld.whenFormulaSatisfied(a.value.startsWith('=') ? a.value : `=${a.value}`) }[r]();
          const root2 = getComputedStyle(document.documentElement);
          if (style.value === 'bold') bld = bld.setBold(true);
          else bld = bld.setBackground(cssHex(root2.getPropertyValue(style.value === 'gray' ? '--content-gray-bg' : `--content-${style.value}-bg`)));
          ws.addConditionalFormattingRule(bld.build());
          st.ok(L('Rule added. Manage rules lists every rule of the sheet.'));
        } catch (e) { st.error(e.message); }
      }, { primary: true }), button(L('Manage rules…'), () => surface.exec('sheet.operation.open.conditional.formatting.panel'), { quiet: true })), st);
    sync();
    return {};
  },
};
