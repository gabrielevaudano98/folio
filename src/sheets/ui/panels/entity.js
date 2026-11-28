// Folio Sheets — rich data types (area 21): a cell can hold an object (a person, a place, a product, a company, a
// link) and still show a plain value. The object is Univer cell custom data, written to the file as the cell's
// `data` in the sheet meta:  "cells": { "B3": { "data": { "type": "place", "name": "Turin", "country": "Italy" } } }
// The panel shows the selected cell's card, edits its fields, and inserts a field into the next column, as Excel's
// "Insert data" button does.
import { h, fill, section, hint, field, input, select, button, actions, status } from './kit.js';
import { addr, colName } from '../../core/a1.js';
import { L } from '../i18n.js';

export const TYPES = {
  person: { label: 'Person', fields: ['name', 'role', 'email', 'phone', 'company'] },
  company: { label: 'Company', fields: ['name', 'industry', 'country', 'website', 'employees'] },
  place: { label: 'Place', fields: ['name', 'country', 'region', 'population', 'latitude', 'longitude'] },
  product: { label: 'Product', fields: ['name', 'sku', 'price', 'currency', 'category', 'stock'] },
  link: { label: 'Link', fields: ['name', 'url', 'description'] },
  custom: { label: 'Custom', fields: ['name'] },
};

export default {
  title: 'Data type',
  mount(body, { surface }) {
    const root = h('div.xs-panel'); body.append(root);
    const cellRange = () => { const r = surface.range(); return surface.ws().getRange(r.getRow(), r.getColumn()); };
    const getData = (r) => r.getCellData?.()?.custom?.folio || null;
    const setData = (r, data) => {
      const cur = r.getCellData?.() || {};
      r.setValue({ ...cur, v: data?.name ?? cur.v ?? '', custom: data ? { ...(cur.custom || {}), folio: data } : Object.fromEntries(Object.entries(cur.custom || {}).filter(([k]) => k !== 'folio')) });
    };
    function render() {
      const r = cellRange(); const d = getData(r); const st = status();
      const ref = addr(r.getRow(), r.getColumn());
      if (!d) {
        const type = select(Object.entries(TYPES).map(([k, v]) => [k, L(v.label)]), 'place');
        return fill(root, h('p', L('{cell} holds a plain value.', { cell: ref })), hint(L('Turn it into a data type: the cell keeps showing its name, and carries fields you can insert into other cells.')),
          field(L('Type'), type), actions(button(L('Make data type'), () => { setData(r, { type: type.value, name: String(r.getValue() ?? '') }); render(); }, { primary: true })));
      }
      const t = TYPES[d.type] || TYPES.custom;
      const keys = [...new Set([...t.fields, ...Object.keys(d).filter((k) => k !== 'type')])];
      const ins = keys.map((k) => field(k, input({ value: d[k] ?? '' })));
      const newKey = input({ placeholder: L('field name') });
      fill(root, 
        h('div.xs-card', h('div.xs-card-head', h('strong', d.name || ref), h('span.xs-badge', L(t.label))),
          h('dl.info-list', keys.filter((k) => k !== 'name' && d[k] != null && d[k] !== '').map((k) => h('div', h('dt', k), h('dd', String(d[k])))))),
        section(L('Fields'), ...ins, h('div.xs-inline-form', field(L('Add a field'), newKey), button(L('Add'), () => { if (!newKey.value.trim()) return; setData(r, { ...d, [newKey.value.trim()]: '' }); render(); }))),
        actions(button(L('Save'), () => { const nd = { type: d.type }; keys.forEach((k, i) => { const v = ins[i].control.value; if (v !== '') nd[k] = Number.isFinite(Number(v)) && /^-?[\d.]+$/.test(v) ? Number(v) : v; }); setData(r, nd); st.ok(L('Saved.')); render(); }, { primary: true }),
          button(L('Insert field to the right…'), (e) => surface.ctx.showMenu(e.currentTarget, keys.filter((k) => k !== 'name').map((k) => ({ label: k, run: () => {
            const s = surface.ws(); let c = r.getColumn() + 1; while (s.getRange(r.getRow(), c).getValue() != null && s.getRange(r.getRow(), c).getValue() !== '') c++;
            surface.applyOps([{ op: 'values', sheet: surface.sheetName(), range: `${colName(c)}${r.getRow() + 1}`, values: [[d[k] ?? null]] }]);
          } }))), { quiet: true }),
          button(L('Back to plain value'), () => { setData(r, null); render(); }, { quiet: true })),
        st);
    }
    render();
    return { refresh: render, onSelection: render };
  },
};
