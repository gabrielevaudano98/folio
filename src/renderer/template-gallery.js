// Folio — the template gallery (Confluence and Notion): browse by source and category, search, preview the filled
// page, star favourites, use a template in this page or for a new one, save the collection's or the community's
// templates to Templates/, import from files or links, create and organise your own. The host (app.js) owns files.
import { parseProps } from './page-props.js';
import { CATEGORIES } from './template-starters.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SOURCE = { mine: 'My templates', starter: 'Folio collection', community: 'Community' };
const ICON = { Meetings: '📝', Planning: '🎯', Product: '📦', Engineering: '🛠️', Reports: '📊', Docs: '📘', Personal: '🧭', General: '📄', Community: '🌐' };
const iconOf = (t) => t.icon || ICON[t.category] || '📄';

/**
 * host: {
 *   mode: 'insert' | 'new', page: name of the open page or '',
 *   items(): Promise<[...]> mine and starters (page-templates listTemplates), community(): Promise<{ items, error }>,
 *   text(item): Promise<string> raw template, preview(text, item): html of the filled page, icons,
 *   favs: string[], recent: string[], setFavs(ids), use(item, { name, as }) : Promise, save(item), edit(item),
 *   remove(item), rename(item), setCategory(item), duplicate(item), create(), importFiles(), importLink(), saveCurrent()
 * }
 */
export function openGallery(dialog, host) {
  return new Promise(async (resolve) => {
    let items = await host.items(), community = null, communityError = '', favs = new Set(host.favs || []), recent = host.recent || [];
    let view = favs.size ? 'favs' : recent.length ? 'recent' : 'all', query = '', current = null, seq = 0;
    const ic = (n) => host.icons?.[n] || '';
    const all = () => [...items, ...(community || [])];
    const byId = (id) => all().find((t) => t.id === id);
    const cats = (src) => [...new Set(items.filter((t) => t.source === src).map((t) => t.category))].sort((a, b) => (CATEGORIES.indexOf(a) + 1 || 99) - (CATEGORIES.indexOf(b) + 1 || 99) || a.localeCompare(b));

    dialog.className = 'sheet tg-dialog';
    dialog.innerHTML = `<div class="tg-shell">
      <nav class="tg-nav" aria-label="Template sources"></nav>
      <section class="tg-main" aria-live="polite"></section>
      <aside class="tg-preview" aria-label="Preview"></aside>
    </div>`;
    const nav = dialog.querySelector('.tg-nav'), main = dialog.querySelector('.tg-main'), prev = dialog.querySelector('.tg-preview');

    const navBtn = (v, label, n, icon) => `<button type="button" class="tg-nav-item" data-view="${esc(v)}"${view === v ? ' aria-current="true"' : ''}>${icon ? `<span class="tg-nav-ic" aria-hidden="true">${icon}</span>` : ''}<span class="tg-nav-label">${esc(label)}</span>${n != null ? `<span class="tg-n">${n}</span>` : ''}</button>`;
    function drawNav() {
      const mine = items.filter((t) => t.source === 'mine');
      nav.innerHTML = `<div class="tg-search">${ic('find')}<input type="search" placeholder="Search templates" aria-label="Search templates" value="${esc(query)}"></div>
        <div class="tg-nav-list">
          ${navBtn('all', 'All templates', items.length)}
          ${navBtn('recent', 'Recently used', recent.filter(byId).length)}
          ${navBtn('favs', 'Favourites', [...favs].filter(byId).length, '★')}
          <h3>My templates</h3>
          ${navBtn('mine', 'All of mine', mine.length)}
          ${cats('mine').map((c) => navBtn('mine:' + c, c, mine.filter((t) => t.category === c).length)).join('')}
          ${mine.length ? '' : '<p class="tg-hint">Pages in Templates/ appear here.</p>'}
          <h3>Folio collection</h3>
          ${cats('starter').map((c) => navBtn('starter:' + c, c, items.filter((t) => t.source === 'starter' && t.category === c).length, ICON[c])).join('')}
          <h3>Community</h3>
          ${navBtn('community', community ? 'All community' : 'Browse online', community ? community.length : null, '🌐')}
          ${community ? [...new Set(community.map((t) => t.category))].sort().map((c) => navBtn('community:' + c, c, community.filter((t) => t.category === c).length)).join('') : ''}
        </div>
        <div class="tg-nav-foot">
          <button type="button" class="btn" data-act="create">${ic('plus')}<span>New template</span></button>
          <button type="button" class="btn" data-act="import" aria-haspopup="menu">${ic('folder')}<span>Import</span></button>
          ${host.page ? `<button type="button" class="btn btn-quiet" data-act="saveCurrent">Save “${esc(host.page)}” as a template</button>` : ''}
        </div>`;
    }
    function shown() {
      const q = query.trim().toLowerCase();
      if (q) return all().filter((t) => `${t.name} ${t.desc} ${t.category} ${t.author || ''}`.toLowerCase().includes(q));
      if (view === 'all') return items;
      if (view === 'recent') return recent.map(byId).filter(Boolean);
      if (view === 'favs') return all().filter((t) => favs.has(t.id));
      const [src, cat] = view.split(':');
      const list = src === 'community' ? community || [] : items.filter((t) => t.source === src);
      return cat ? list.filter((t) => t.category === cat) : list;
    }
    const title = () => (query.trim() ? `Results for “${query.trim()}”` : view === 'all' ? 'All templates' : view === 'recent' ? 'Recently used' : view === 'favs' ? 'Favourites' : view.includes(':') ? view.split(':')[1] : SOURCE[view] || view);
    function drawMain() {
      const list = shown();
      const empty = view === 'favs' ? 'Star a template to keep it here.' : view === 'recent' ? 'Templates you use appear here.' : view === 'mine' ? 'Create a template, import one, or save one from the collection or the community.'
        : view.startsWith('community') && !community ? (communityError ? `Could not reach the community gallery: ${communityError}` : 'Loading the community gallery…') : 'No templates match.';
      main.innerHTML = `<header class="tg-main-head"><h2 id="tg-title">${esc(title())}</h2><span class="tg-n">${list.length || ''}</span>
          <button type="button" class="rb tg-close" data-act="close" aria-label="Close" data-tip="Close (Esc)">${ic('close')}</button></header>
        ${view.startsWith('community') && communityError ? `<p class="tg-error">${esc(empty)} <button type="button" class="btn btn-quiet" data-act="retry">Try again</button></p>` : ''}
        <div class="tg-grid" role="listbox" aria-labelledby="tg-title">${list.map((t) => `<div class="tg-card${current?.id === t.id ? ' is-current' : ''}" role="option" aria-selected="${current?.id === t.id}" tabindex="0" data-id="${esc(t.id)}">
            <span class="tg-card-ic" aria-hidden="true">${esc(iconOf(t))}</span>
            <span class="tg-card-name">${esc(t.name)}</span>
            <span class="tg-card-desc">${esc(t.desc || (t.source === 'mine' ? t.path : ''))}</span>
            <span class="tg-card-foot"><span class="tg-chip">${esc(t.category)}</span><span class="tg-src">${esc(t.source === 'community' && t.author ? t.author : SOURCE[t.source])}</span></span>
            <button type="button" class="tg-star" data-star="${esc(t.id)}" aria-pressed="${favs.has(t.id)}" aria-label="${favs.has(t.id) ? 'Remove from' : 'Add to'} favourites">★</button>
          </div>`).join('')}</div>
        ${list.length ? '' : view.startsWith('community') && communityError ? '' : `<p class="tg-empty">${esc(empty)}</p>`}`;
    }
    async function drawPreview() {
      const t = current;
      if (!t) { prev.innerHTML = `<div class="tg-preview-empty"><p>Choose a template to see the page it makes.</p><p class="tg-hint">Templates give a page its shape: the sections to fill, the properties to set, the questions to answer.</p></div>`; return; }
      const n = ++seq;
      prev.innerHTML = `<div class="tg-preview-head"><span class="tg-card-ic" aria-hidden="true">${esc(iconOf(t))}</span><div><h3>${esc(t.name)}</h3><p>${esc(t.desc)}</p></div>
          <button type="button" class="tg-star" data-star="${esc(t.id)}" aria-pressed="${favs.has(t.id)}" aria-label="${favs.has(t.id) ? 'Remove from' : 'Add to'} favourites">★</button></div>
        <div class="tg-preview-meta"><span class="tg-chip">${esc(t.category)}</span><span>${esc(SOURCE[t.source])}${t.author ? ` · ${esc(t.author)}` : ''}</span></div>
        <div class="tg-preview-props"></div>
        <div class="tg-preview-doc prose" tabindex="0" aria-label="Preview of the page"><p class="tg-hint">Loading…</p></div>
        <div class="tg-actions">
          ${host.mode === 'new' || !host.page ? `<label class="tg-name"><span>Page name</span><input class="input" type="text" value="${esc(t.name)}" spellcheck="false"></label>` : ''}
          <div class="tg-row">
            ${host.mode === 'new' || !host.page ? `<button type="button" class="btn btn-primary" data-act="useNew">Create page</button>` : `<button type="button" class="btn btn-primary" data-act="useHere">Use in “${esc(host.page)}”</button><button type="button" class="btn" data-act="useNew">New page</button>`}
            ${t.source === 'mine' ? `<button type="button" class="btn" data-act="edit">Edit</button><button type="button" class="rb" data-act="more" aria-haspopup="menu" aria-label="More" data-tip="Rename, category, duplicate, delete">${ic('more')}</button>`
              : `<button type="button" class="btn" data-act="save" data-tip="Copy it into Templates/ to change it">${t.source === 'community' ? 'Download' : 'Customise'}</button>`}
          </div>
        </div>`;
      try {
        const raw = await host.text(t); if (n !== seq) return;
        const html = await host.preview(raw, t); if (n !== seq) return;
        prev.querySelector('.tg-preview-doc').innerHTML = html.html;
        const props = parseProps(html.text).props.filter((p) => !p.readOnly);
        prev.querySelector('.tg-preview-props').innerHTML = props.length ? props.map((p) => `<span class="tg-prop"><b>${esc(p.key)}</b> ${esc(Array.isArray(p.value) ? p.value.join(', ') : String(p.value ?? ''))}</span>`).join('') : '';
      } catch (e) { if (n === seq) prev.querySelector('.tg-preview-doc').innerHTML = `<p class="tg-error">${esc(e.message)}</p>`; }
    }
    const draw = () => { drawNav(); drawMain(); };
    async function loadCommunity() {
      communityError = ''; draw();
      const r = await host.community().catch((e) => ({ items: null, error: e.message }));
      community = r.items; communityError = r.error || ''; draw();
    }
    const select = (t) => { current = t; drawMain(); drawPreview(); dialog.querySelector(`.tg-card[data-id="${CSS.escape(t.id)}"]`)?.focus({ preventScroll: true }); };
    const reload = async (keep) => { items = await host.items(); current = keep ? byId(keep) || null : current && byId(current.id) ? byId(current.id) : null; draw(); drawPreview(); };
    const done = (v) => { dialog.close(); resolve(v); };

    dialog.addEventListener('input', (e) => { if (e.target.matches('.tg-search input')) { query = e.target.value; drawMain(); } });
    dialog.addEventListener('click', async (e) => {
      const star = e.target.closest('[data-star]');
      if (star) { const id = star.dataset.star; favs.has(id) ? favs.delete(id) : favs.add(id); host.setFavs([...favs]); draw(); if (current) drawPreview(); return; }
      const v = e.target.closest('[data-view]');
      if (v) { view = v.dataset.view; query = ''; if (view.startsWith('community') && !community) loadCommunity(); draw(); return; }
      const card = e.target.closest('.tg-card'); if (card) { select(byId(card.dataset.id)); return; }
      const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
      const t = current;
      if (act === 'close') return done(null);
      if (act === 'retry') return loadCommunity();
      if (act === 'useHere' || act === 'useNew') {
        const name = prev.querySelector('.tg-name input')?.value.trim();
        done(t); host.use(t, { as: act === 'useHere' ? 'here' : 'new', name: name || t.name }); return;
      }
      if (act === 'save') { const saved = await host.save(t); if (saved) { await reload(saved); view = 'mine'; draw(); } return; }
      if (act === 'edit') { done(null); host.edit(t); return; }
      if (act === 'create') { done(null); host.create(); return; }
      if (act === 'saveCurrent') { done(null); host.saveCurrent(); return; }
      if (act === 'import') {
        host.menu(e.target.closest('[data-act]'), [
          { label: 'From files on this computer…', run: async () => { const n = await host.importFiles(); if (n) { view = 'mine'; await reload(); } } },
          { label: 'From a link (https://…/template.md)…', run: async () => { const id = await host.importLink(); if (id) { view = 'mine'; await reload(id); } } },
        ]);
        return;
      }
      if (act === 'more' && t) {
        host.menu(e.target.closest('[data-act]'), [
          { label: 'Rename…', run: async () => { const id = await host.rename(t); if (id) await reload(id); } },
          { label: 'Change category…', run: async () => { if (await host.setCategory(t)) await reload(t.id); } },
          { label: 'Duplicate', run: async () => { const id = await host.duplicate(t); if (id) await reload(id); } },
          { label: 'Delete', danger: true, run: async () => { if (await host.remove(t)) { current = null; await reload(); } } },
        ]);
      }
    });
    dialog.addEventListener('dblclick', (e) => { const card = e.target.closest('.tg-card'); if (!card) return; const t = byId(card.dataset.id); done(t); host.use(t, { as: host.page && host.mode !== 'new' ? 'here' : 'new', name: t.name }); });
    dialog.addEventListener('keydown', (e) => {
      const card = e.target.closest?.('.tg-card');
      if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(byId(card.dataset.id)); return; }
      if (card && /^Arrow/.test(e.key)) {
        e.preventDefault(); const cards = [...dialog.querySelectorAll('.tg-card')]; const i = cards.indexOf(card);
        const cols = Math.max(1, Math.round(main.querySelector('.tg-grid').clientWidth / card.offsetWidth));
        const j = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + cols, ArrowUp: i - cols }[e.key];
        cards[Math.max(0, Math.min(cards.length - 1, j))]?.focus();
      }
      if (e.target.matches?.('.tg-name input') && e.key === 'Enter') { e.preventDefault(); prev.querySelector('[data-act="useNew"]')?.click(); }
    });
    dialog.oncancel = (e) => { e.preventDefault(); done(null); };
    draw(); drawPreview();
    dialog.showModal();
    dialog.querySelector('.tg-search input').focus();
    const first = shown()[0]; if (first) select(first);
  });
}
