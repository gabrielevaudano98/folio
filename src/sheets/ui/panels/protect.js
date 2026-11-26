// Folio Sheets — protection, encryption and signatures (area 26). Hashing, AES-GCM and RSA run in the data engine
// with node-forge (engine/crypto.js); passwords never stay in memory longer than the call.
import { h, fill, section, hint, field, input, button, actions, status, tabs, rangeInput } from './kit.js';
import { splitRef, toRange } from '../../core/a1.js';
import { L } from '../i18n.js';

const pw = (label = L('Password')) => input({ type: 'password', autocomplete: 'new-password', 'aria-label': label });

export default {
  title: 'Protect',
  mount(body, { surface, ctx, opts }) {
    const root = h('div.xs-panel'); body.append(root);
    const t = tabs([['sheet', L('Sheet')], ['ranges', L('Editable ranges')], ['encrypt', L('Encrypt')], ['sign', L('Sign')]], opts.tab || 'sheet', (id) => ({ sheet, ranges, encrypt, sign })[id]());
    root.append(t);

    function sheet() {
      const p = surface.meta().protect; const st = status();
      if (p) {
        const pass = pw();
        return h('div', h('p', L('{sheet} is protected.', { sheet: surface.sheetName() })), p.allow?.length ? hint(L('Editable: {list}', { list: p.allow.join(', ') })) : null,
          p.password ? field(L('Password'), pass) : null,
          actions(button(L('Unprotect sheet'), async () => {
            if (p.password && !(await surface.call('crypto.check', { password: pass.value, record: p.password }))) return st.error(L('Wrong password.'));
            surface.protection.unguarded(() => surface.setMeta({ protect: null })); t.show('sheet');
          }, { primary: true })), st);
      }
      const pass = pw(), again = pw(L('Repeat password'));
      return h('div', hint(L('A protected sheet keeps its cells, rows and columns as they are; only editable ranges can change. A password stops others from switching protection off in Folio, but the file stays readable Markdown: use Encrypt for secrets.')),
        field(L('Password (optional)'), pass), field(L('Repeat password'), again),
        actions(button(L('Protect sheet'), async () => {
          if (pass.value !== again.value) return st.error(L('The passwords are different.'));
          const record = pass.value ? await surface.call('crypto.hash', { password: pass.value }) : null;
          surface.setMeta({ protect: { allow: surface.meta().protectAllow || [], ...(record ? { password: record } : {}) } }); t.show('sheet');
        }, { primary: true })), st);
    }
    function ranges() {
      const p = surface.meta().protect; const list = p?.allow || surface.meta().protectAllow || [];
      const set = (l) => (p ? surface.protection.unguarded(() => surface.setMeta({ protect: { ...p, allow: l } })) : surface.setMeta({ protectAllow: l.length ? l : null }));
      const r = rangeInput(surface, surface.selectionRef({ withSheet: false }), { withSheet: false, label: L('Range people may edit') });
      return h('div', hint(L('Cells in these ranges stay editable when the sheet is protected, as input cells of a form.')),
        list.length ? h('ul.xs-list', list.map((a, i) => h('li.xs-item', h('div.xs-item-main', h('div.xs-item-title', a)), h('div.xs-item-actions', button(L('Remove'), () => { set(list.filter((_, k) => k !== i)); t.show('ranges'); }, { quiet: true }))))) : h('p.xs-empty', L('No editable ranges.')),
        r, actions(button(L('Add range'), () => { try { toRange(r.control.value); set([...list, r.control.value.replace(/\$/g, '')]); t.show('ranges'); } catch { ctx.toast(L('Not a cell or range: {ref}', { ref: r.control.value })); } }, { primary: true })));
    }
    function encrypt() {
      const enc = surface.meta().encrypted || []; const st = status();
      const r = rangeInput(surface, surface.selectionRef({ withSheet: false }), { withSheet: false, label: L('Cells to encrypt') });
      const pass = pw(), again = pw(L('Repeat password'));
      return h('div', hint(L('Encrypted cells are stored as AES-256 ciphertext in the file and shown blank. Only someone with the password can put them back. Folio cannot recover a lost password.')),
        enc.length ? section(L('Encrypted on this sheet'), h('ul.xs-list', enc.map((e, i) => { const pass2 = pw(); return h('li.xs-item.xs-item-col', h('div.xs-item-title', e.range), h('div.xs-inline-form', pass2, button(L('Decrypt'), async () => {
          try {
            const values = await surface.call('crypto.decrypt', { box: e.box, password: pass2.value });
            surface.protection.unguarded(() => { surface.applyOps([{ op: 'values', sheet: surface.sheetName(), range: e.range, values }]); surface.setMeta({ encrypted: enc.filter((_, k) => k !== i).length ? enc.filter((_, k) => k !== i) : null }); });
            ctx.toast(L('Cells decrypted.')); t.show('encrypt');
          } catch (err) { st.error(err.message); }
        }))); }))) : null,
        section(L('Encrypt cells'), r, field(L('Password'), pass), field(L('Repeat password'), again),
          actions(button(L('Encrypt'), async () => {
            if (!pass.value || pass.value.length < 8) return st.error(L('Use a password of at least 8 characters.'));
            if (pass.value !== again.value) return st.error(L('The passwords are different.'));
            const ref = r.control.value.replace(/\$/g, ''); const res = surface.resolve(ref); if (!res) return st.error(L('Not a cell or range: {ref}', { ref }));
            const values = res.range.getCellDatas().map((row) => row.map((c) => (c?.f ? c.f : c?.v ?? null)));
            const box = await surface.call('crypto.encrypt', { value: values, password: pass.value });
            surface.protection.unguarded(() => { res.range.clearContent(); surface.setMeta({ encrypted: [...enc, { range: splitRef(ref).range, box }] }); });
            st.ok(L('{n} cells encrypted.', { n: values.flat().length })); t.show('encrypt');
          }, { primary: true }))), st);
    }
    function sign() {
      const st = status(); const out = h('div');
      const verify = async () => {
        try {
          const v = await surface.call('crypto.verify', { text: surface.saveNow() });
          fill(out, h('div.xs-card', h('div.xs-card-head', h('strong', v.valid ? L('Valid signature') : L('No valid signature')), h('span.xs-badge', v.valid ? L('Verified') : L('Not verified'))),
            v.signer || v.date ? h('dl.info-list', h('div', h('dt', L('Signed by')), h('dd', v.signer || '—')), h('div', h('dt', L('Date')), h('dd', v.date ? new Date(v.date).toLocaleString() : '—')), h('div', h('dt', L('Key')), h('dd', v.fingerprint || '—')), h('div', h('dt', L('Your key')), h('dd', v.mine ? L('Yes') : L('No')))) : null,
            v.reason ? h('p.xs-hint', v.reason) : null));
        } catch (e) { st.error(e.message); }
      };
      queueMicrotask(verify);
      return h('div', hint(L('A signature proves who signed this workbook and that nothing changed since. The key pair is made on this computer the first time; the public key travels in the file so anyone can check it. Any later edit breaks the signature.')),
        out, actions(button(L('Sign workbook'), async () => {
          st.busy(L('Signing…'));
          try {
            const signer = (await ctx.userName?.().catch?.(() => '')) || '';
            const r = await surface.call('crypto.sign', { text: surface.saveNow(), signer });
            ctx.onChange(r.text); st.ok(L('Signed.')); setTimeout(verify, 300);
          } catch (e) { st.error(e.message); }
        }, { primary: true }), button(L('Check signature'), verify)), st);
    }
    return { update(o) { if (o.tab) t.show(o.tab); } };
  },
};
