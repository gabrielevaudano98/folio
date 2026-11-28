// Folio Sheets — versions, comparison and activity (areas 15 and 27). Folio keeps snapshots of every note (history.js
// in the main process, plus git when the folder is a repository); this panel compares them cell by cell
// (core/diff.js with json-diff-ts) and restores a version or a single cell. Activity lists the operations of this
// session from the operation log (core/collab.js), the same records a sync service would exchange.
import { h, fill, section, hint, button, actions, status, tabs, select, field } from './kit.js';
import { compareWorkbooks, summarise } from '../../core/diff.js';
import { colName } from '../../core/a1.js';
import { L } from '../i18n.js';

const when = (t) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(t));
const show = (v) => (v == null ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export default {
  title: 'History',
  mount(body, { surface, ctx, opts }) {
    const root = h('div.xs-panel'); body.append(root);
    const folio = globalThis.folio;
    const path = surface.path();
    const t = tabs([['versions', L('Versions')], ['compare', L('Compare')], ['activity', L('Activity')]], opts.tab || 'versions', (id) => ({ versions, compare, activity })[id]());
    root.append(t);
    const list = async () => (await folio.historyList(path).catch(() => [])) || [];
    const textOf = async (id) => (id === 'now' ? surface.saveNow() : (await folio.historyGet(path, id)) ?? '');

    function changeList(changes, { restoreFrom } = {}) {
      if (!changes.length) return h('p.xs-empty', L('No differences.'));
      const s = summarise(changes);
      return h('div', h('p.xs-hint', L('{cells} cells, {sheets} sheets, {rules} rules and settings, {blocks} queries or scripts changed.', s)),
        h('ul.xs-diff', changes.slice(0, 400).map((c) => h('li', { 'data-op': c.op },
          h('span.xs-diff-op', { 'aria-label': L(c.op === 'add' ? 'added' : c.op === 'remove' ? 'removed' : 'changed') }, c.op === 'add' ? '+' : c.op === 'remove' ? '−' : '~'),
          c.kind === 'cell' ? h('button.xs-link', { type: 'button', on: { click: () => surface.activate(`'${c.sheet}'!${c.cell}`) } }, `${c.sheet}!${c.cell}`) : h('strong', c.kind === 'sheet' ? L('Sheet {name}', { name: c.sheet }) : c.kind === 'block' ? c.field : `${c.sheet ? c.sheet + ' · ' : ''}${c.field}`),
          c.kind === 'cell' ? h('span.xs-diff-vals', h('del', show(c.before)), ' → ', h('ins', show(c.after)), c.fields?.includes('style') ? h('span.xs-item-sub', ` ${L('format')}`) : null) : c.kind === 'rule' || c.kind === 'workbook' ? h('span.xs-diff-vals', h('del', show(c.before)), ' → ', h('ins', show(c.after))) : null,
          restoreFrom && c.kind === 'cell' && c.fields?.includes('raw') ? button('', () => surface.applyOps([{ op: 'values', sheet: c.sheet, range: c.cell, values: [[c.before == null ? null : (String(c.before).startsWith('=') ? c.before : Number.isFinite(Number(c.before)) && c.before !== '' ? Number(c.before) : c.before)]] }]), { quiet: true, icon: surface.icons.undo, title: L('Put back the old value') }) : null))),
        changes.length > 400 ? h('p.xs-hint', L('{n} more changes not shown.', { n: changes.length - 400 })) : null);
    }
    function versions() {
      const wrap = h('div'); const st = status();
      (async () => {
        const vs = await list();
        if (!vs.length) { fill(wrap, hint(L('No saved versions yet. Folio keeps a version as you edit; the first appears after a few minutes of work.'))); return; }
        fill(wrap, h('ul.xs-list', vs.slice(0, 60).map((v) => h('li.xs-item.xs-item-col',
          h('div.xs-item-main', h('div.xs-item-title', v.name || when(v.t)), h('div.xs-item-sub', [v.name ? when(v.t) : '', v.reason || ''].filter(Boolean).join(' · '))),
          h('div.xs-item-actions',
            button(L('Changes since'), async () => { st.busy(L('Comparing…')); try { const a = await textOf(v.id); const ch = compareWorkbooks(a, surface.saveNow()); st.clear(); fill(det, h('h4', L('From {when} to now', { when: when(v.t) })), changeList(ch, { restoreFrom: a })); } catch (e) { st.error(e.message); } }, { quiet: true }),
            button(L('Restore'), async () => { const a = await textOf(v.id); if (await ctx.confirm?.({ title: L('Restore this version?'), body: L('The workbook goes back to {when}. The current state is kept as a version, so you can come back.', { when: when(v.t) }), action: L('Restore') }) === false) return; await folio.historySnapshot(path, surface.saveNow(), 'before restore', true); ctx.onChange(a); }, { quiet: true }))))), st, det);
      })();
      const det = h('div.xs-results');
      return wrap;
    }
    function compare() {
      const wrap = h('div'); const out = h('div.xs-results'); const st = status();
      (async () => {
        const vs = await list();
        const opts2 = [['now', L('Now')], ...vs.slice(0, 100).map((v) => [v.id, v.name || when(v.t)])];
        const a = select(opts2, vs[0]?.id || 'now'), b = select(opts2, 'now');
        fill(wrap, hint(L('Any two versions, cell by cell: values, formulas, formats, rules, queries and scripts.')), field(L('From'), a), field(L('To'), b),
          actions(button(L('Compare'), async () => { st.busy(L('Comparing…')); try { fill(out, changeList(compareWorkbooks(await textOf(a.value), await textOf(b.value)), { restoreFrom: a.value })); st.clear(); } catch (e) { st.error(e.message); } }, { primary: true })), st, out);
      })();
      return wrap;
    }
    function activity() {
      const ops = surface.oplog.ops().slice(-300).reverse();
      const label = (o) => { const id = o.mutation.id.replace(/^sheet\.mutation\./, '').replace(/-/g, ' '); const p = o.mutation.params || {}; const cells = p.cellValue ? Object.entries(p.cellValue).flatMap(([r, row]) => Object.keys(row || {}).map((c) => `${colName(+c)}${+r + 1}`)) : []; return `${id}${cells.length ? ` · ${cells.slice(0, 4).join(', ')}${cells.length > 4 ? '…' : ''}` : ''}`; };
      return h('div', hint(L('Every change of this session, in order, with who made it. These are the operations a shared workbook would send to others.')),
        ops.length ? h('ol.activity', ops.map((o) => h('li', h('span', new Date(o.ts).toLocaleTimeString()), h('span', o.actor), h('span', label(o))))) : h('p.xs-empty', L('No changes yet in this session.')),
        ops.length ? actions(button(L('Copy as JSON lines'), () => { globalThis.folio?.copy?.(surface.oplog.toJSONL()); ctx.toast(L('Copied.')); }, { quiet: true })) : null);
    }
    void section;
    return { update(o) { if (o.tab) t.show(o.tab); } };
  },
};
