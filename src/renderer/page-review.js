// Folio — the review pane of a page (D10): comment threads and suggested changes beside the text, as in Google Docs
// and Word. Everything is CriticMarkup in the file (page-critic.js); this pane only lists it and acts on it.
import { TextSelection } from '@tiptap/pm/state';
import { t } from './i18n.js';
import { docReview, settle, resolveThread, commentBody } from './page-critic.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PREF = 'folio.page.review';
const pref = () => { try { return localStorage.getItem(PREF) || 'auto'; } catch { return 'auto'; } };
const savePref = (v) => { try { localStorage.setItem(PREF, v); } catch { /* no storage */ } };
const when = (d) => {
  if (!d) return '';
  const t = new Date(d.replace(' ', 'T')); if (Number.isNaN(+t)) return d;
  const now = new Date(); const same = t.toDateString() === now.toDateString();
  return same ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : t.toLocaleDateString([], { day: 'numeric', month: 'short', ...(t.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
};
const initials = (n) => (n || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const short = (t, n = 80) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

export function mountReview(host, editor, { icons, author = () => '', keyLabel = (k) => k, onToggle, dock = null, onCount = null }) {
  const scroll = host.querySelector('.rich-scroll');
  const main = document.createElement('div'); main.className = 'rich-main';
  scroll.replaceWith(main); main.append(scroll);
  const pane = document.createElement('aside'); pane.className = 'review-pane'; pane.setAttribute('aria-label', 'Comments and suggestions'); pane.hidden = true;
  (dock || main).append(pane);
  let autoShown = false, filter = 'all', items = [], timer = 0, focusDraft = false;
  /* Google Docs: each card sits beside the line it is about (Beside text), or all of them stack in a list */
  const ALIGN = 'folio.page.review.align';
  let aligned = (() => { try { return localStorage.getItem(ALIGN) !== 'off'; } catch { return true; } })();
  const anchorPos = (x) => Math.min(x.kind === 'thread' ? (x.hl ? x.from : x.start) : x.from, editor.state.doc.content.size);
  const ic = (n) => icons[n] || '';

  const visible = () => !pane.hidden;
  const mode = () => (!editor.isEditable ? 'view' : editor.storage.suggestMode?.on ? 'suggest' : 'edit');
  const show = (on, persist = true) => { if (persist) autoShown = false; pane.hidden = !on; if (persist) savePref(on ? 'auto' : 'hidden'); if (dock) { const ev = new CustomEvent('review-toggle', { detail: on }); ev.auto = !persist; dock.dispatchEvent(ev); } onToggle?.(on); };
  const sel = () => editor.state.selection;
  const activeIndex = () => { const { from, to } = sel(); return items.findIndex((x) => (x.kind === 'thread' ? (from <= x.end && to >= x.from) : from <= x.to && to >= x.from)); };

  function render() {
    items = docReview(editor.state.doc);
    const threads = items.filter((x) => x.kind === 'thread'), changes = items.filter((x) => x.kind !== 'thread' && x.kind !== 'hl');
    if (pref() === 'auto' && (threads.length || changes.length) && pane.hidden && !focusDraft) { show(true, false); autoShown = true; }
    else if (autoShown && !threads.length && !changes.length && !pane.hidden && !focusDraft) { show(false, false); autoShown = false; }
    onCount?.(threads.length + changes.length);
    const list = items.filter((x) => x.kind !== 'hl' && (filter === 'all' || (filter === 'comments') === (x.kind === 'thread')));
    const act = activeIndex();
    pane.innerHTML = `<div class="rv-head">
        <div class="rv-title"><span class="rv-count">${threads.length} ${threads.length === 1 ? 'comment' : 'comments'} · ${changes.length} ${changes.length === 1 ? 'suggestion' : 'suggestions'}</span></div>
        <button type="button" class="btn btn-quiet rv-align" data-rv="align" aria-pressed="${aligned}" title="${esc(t('review.besideTextTip'))}">${esc(t('review.besideText'))}</button>
      </div>
      <div class="rv-tools">
        <div class="rv-mode" role="radiogroup" aria-label="Mode" data-mode="${mode()}">${[['edit', 'Editing', 'Change the text directly'], ['suggest', 'Suggesting', 'Your changes become suggestions'], ['view', 'Viewing', 'Read only']].map(([k, l, t]) => `<button type="button" role="radio" aria-checked="${mode() === k}" data-mode-set="${k}" title="${t}">${l}</button>`).join('')}</div>
        <div class="rv-filter" role="radiogroup" aria-label="Show">${[['all', 'All'], ['comments', 'Comments'], ['changes', 'Suggestions']].map(([k, l]) => `<button type="button" role="radio" aria-checked="${filter === k}" data-filter="${k}">${l}</button>`).join('')}</div>
      </div>
      ${changes.length ? `<div class="rv-bulk"><button type="button" class="btn btn-quiet" data-rv="acceptAll">${ic('check')}<span>Accept all</span></button><button type="button" class="btn btn-quiet" data-rv="rejectAll">${ic('close')}<span>Reject all</span></button></div>` : ''}
      <div class="rv-list"><div class="rv-track">${list.length ? list.map((x) => card(x, items.indexOf(x), items.indexOf(x) === act)).join('') : `<p class="rv-empty">${items.length ? 'Nothing in this view.' : `No comments or suggestions yet. Select text and press <kbd>${esc(keyLabel('Mod+Alt+M'))}</kbd> to comment, or turn on Suggesting to propose changes that others accept or reject.`}</p>`}</div></div>`;
    const draft = pane.querySelector('.rv-draft textarea');
    if (draft && focusDraft) { draft.focus(); focusDraft = false; }
    place();
    if (!aligned) pane.querySelector('.rv-card.is-active')?.scrollIntoView?.({ block: 'nearest' });
  }
  /* put every card at the height of its line; cards that would overlap move down to the next free spot */
  function place() {
    const list = pane.querySelector('.rv-list'), track = list?.querySelector('.rv-track'); if (!list) return;
    const on = aligned && !pane.hidden && !!track.querySelector('.rv-card'); list.classList.toggle('is-aligned', on);
    if (!on) { track.style.transform = ''; track.querySelectorAll('.rv-card').forEach((c) => (c.style.top = '')); return; }
    list.addEventListener('scroll', () => { list.scrollTop = 0; }, { once: true });
    const base = list.getBoundingClientRect().top, st = scroll.scrollTop;
    const cards = [...track.querySelectorAll('.rv-card')].map((c) => { let top = 0; try { top = editor.view.coordsAtPos(anchorPos(items[+c.dataset.i])).top - base + st; } catch { /* keep 0 */ } return { c, top }; }).sort((a, b) => a.top - b.top);
    let bottom = 0;
    for (const k of cards) { const t = Math.max(k.top, bottom, 0); k.c.style.top = `${t}px`; bottom = t + k.c.offsetHeight + 8; }
    track.style.height = `${bottom}px`; track.style.transform = `translateY(${-st}px)`;
  }
  let placeRaf = 0; const placeSoon = () => { cancelAnimationFrame(placeRaf); placeRaf = requestAnimationFrame(() => { if (aligned && !pane.hidden) { const t = pane.querySelector('.rv-track'); if (t) t.style.transform = `translateY(${-scroll.scrollTop}px)`; } }); };
  scroll.addEventListener('scroll', placeSoon, { passive: true });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (aligned && !pane.hidden && !typing()) place(); }).observe(scroll);
  function card(x, i, active) {
    if (x.kind === 'thread') {
      const comments = x.comments.map((c, k) => {
        if (!c.text && k === x.comments.length - 1) return `<div class="rv-draft"><textarea rows="2" placeholder="Add a comment" aria-label="Comment" data-edit="${i}"></textarea><div class="rv-row"><button type="button" class="btn btn-primary" data-act="save" data-i="${i}">Comment</button><button type="button" class="btn" data-act="cancel" data-i="${i}">Cancel</button></div></div>`;
        return `<div class="rv-comment"><span class="rv-avatar" aria-hidden="true">${esc(initials(c.author))}</span><div class="rv-body"><div class="rv-meta"><b>${esc(c.author || 'Comment')}</b><span>${esc(when(c.date))}</span><button type="button" class="rv-del" data-act="delComment" data-i="${i}" data-k="${k}" aria-label="Delete this comment">${ic('trash')}</button></div><p>${esc(c.text)}</p></div></div>`;
      }).join('');
      const drafting = x.comments.some((c) => !c.text);
      return `<article class="rv-card rv-thread${active ? ' is-active' : ''}" data-i="${i}" tabindex="0">
        ${x.quote ? `<blockquote class="rv-quote">${esc(short(x.quote))}</blockquote>` : ''}
        ${comments}
        ${drafting ? '' : `<div class="rv-row rv-reply"><input type="text" placeholder="Reply" aria-label="Reply" data-reply="${i}"><button type="button" class="rb" data-act="resolve" data-i="${i}" aria-label="Resolve" data-tip="Resolve: the comments go, the text stays">${ic('check')}</button></div>`}
      </article>`;
    }
    const what = x.kind === 'ins' ? `Add <ins class="critic-ins">${esc(short(x.text))}</ins>` : x.kind === 'del' ? `Delete <del class="critic-del">${esc(short(x.text))}</del>` : `Replace <del class="critic-del">${esc(short(x.old))}</del> with <ins class="critic-ins">${esc(short(x.new))}</ins>`;
    return `<article class="rv-card rv-change${active ? ' is-active' : ''}" data-i="${i}" tabindex="0">
      <div class="rv-meta"><b>Suggestion</b></div><p>${what}</p>
      <div class="rv-row"><button type="button" class="btn" data-act="accept" data-i="${i}">${ic('check')}<span>${esc(t('review.accept'))}</span></button><button type="button" class="btn" data-act="reject" data-i="${i}">${ic('close')}<span>${esc(t('review.reject'))}</span></button></div>
    </article>`;
  }
  // never rebuild the pane under someone typing a comment or reply: wait until they leave the field
  const typing = () => { const a = document.activeElement; return pane.contains(a) && /^(TEXTAREA|INPUT)$/.test(a.tagName) && a.type !== 'checkbox'; };
  const soon = () => { clearTimeout(timer); timer = setTimeout(() => (typing() ? soon() : render()), 120); };
  editor.on('transaction', ({ transaction }) => { if (transaction.docChanged) soon(); else if (visible()) { const a = activeIndex(); pane.querySelectorAll('.rv-card').forEach((c) => c.classList.toggle('is-active', +c.dataset.i === a)); } });

  const go = (x) => { const pos = x.kind === 'thread' ? (x.hl ? x.from : x.start) : x.from; editor.chain().focus().setTextSelection(x.kind === 'thread' && x.hl ? { from: x.from, to: x.to } : pos).scrollIntoView().run(); };
  const setBody = (pos, body) => { const n = editor.state.doc.nodeAt(pos); if (n) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, body })); };
  const dropComment = (x, k) => {
    const tr = editor.state.tr;
    if (x.comments.length === 1) resolveThread(editor.state, x, tr); else tr.delete(x.comments[k].pos, x.comments[k].pos + 1);
    editor.view.dispatch(tr);
  };

  pane.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  pane.addEventListener('click', (e) => {
    const ms = e.target.closest('[data-mode-set]'); if (ms) { api.mode(ms.dataset.modeSet); return; }
    const f = e.target.closest('[data-filter]'); if (f) { filter = f.dataset.filter; render(); return; }
    const rv = e.target.closest('[data-rv]')?.dataset.rv;
    if (rv === 'align') { aligned = !aligned; try { localStorage.setItem(ALIGN, aligned ? 'on' : 'off'); } catch { /* no storage */ } render(); return; }
    if (rv === 'close') { show(false); editor.commands.focus(); return; }
    if (rv === 'acceptAll' || rv === 'rejectAll') { api.all(rv === 'acceptAll'); return; }
    const b = e.target.closest('[data-act]');
    if (b) {
      const x = items[+b.dataset.i]; if (!x) return;
      const act = b.dataset.act;
      if (act === 'accept' || act === 'reject') { editor.view.dispatch(settle(editor.state, x, act === 'accept')); editor.commands.focus(); }
      else if (act === 'resolve') { editor.view.dispatch(resolveThread(editor.state, x)); editor.commands.focus(); }
      else if (act === 'delComment') dropComment(x, +b.dataset.k);
      else if (act === 'save') saveDraft(x, b.closest('.rv-card').querySelector('textarea').value);
      else if (act === 'cancel') dropComment(x, x.comments.length - 1);
      return;
    }
    const c = e.target.closest('.rv-card'); if (c && !e.target.closest('input, textarea')) go(items[+c.dataset.i]);
  });
  pane.addEventListener('change', (e) => { if (e.target.dataset.rv === 'suggest') api.suggest(e.target.checked); });
  const saveDraft = (x, text) => {
    text = text.trim(); const c = x.comments.at(-1);
    if (!text) { dropComment(x, x.comments.length - 1); return; }
    setBody(c.pos, commentBody(c.author || author(), text, c.date || undefined)); editor.commands.focus();
  };
  pane.addEventListener('keydown', (e) => {
    const ta = e.target.closest('textarea[data-edit]');
    if (ta && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveDraft(items[+ta.dataset.edit], ta.value); }
    if (ta && e.key === 'Escape') { e.preventDefault(); const x = items[+ta.dataset.edit]; dropComment(x, x.comments.length - 1); editor.commands.focus(); }
    const r = e.target.closest('input[data-reply]');
    if (r && e.key === 'Enter' && r.value.trim()) { e.preventDefault(); const x = items[+r.dataset.reply]; editor.view.dispatch(editor.state.tr.insert(x.end, editor.schema.nodes.criticComment.create({ body: commentBody(author(), r.value.trim()) }))); }
    if (r && e.key === 'Escape') { r.value = ''; editor.commands.focus(); }
  });
  pane.addEventListener('focusout', (e) => {
    const ta = e.target.closest?.('textarea[data-edit]');
    if (ta && ta.isConnected && !ta.value.trim() && !pane.contains(e.relatedTarget)) setTimeout(() => { if (!ta.isConnected || document.activeElement === ta) return; const x = items[+ta.dataset.edit]; if (x && !x.comments.at(-1).text) dropComment(x, x.comments.length - 1); }, 150);
  });
  // a click on a comment bubble in the text opens its card
  editor.view.dom.addEventListener('click', (e) => { if (e.target.closest('.critic-comment, .critic-hl')) { if (!visible()) show(true); setTimeout(() => pane.querySelector('.rv-card.is-active')?.focus({ preventScroll: true }), 30); } });

  /* resting on a suggestion in the text offers Accept and Reject right there (Word, Docs) */
  const bar = document.createElement('div'); bar.className = 'rv-hover'; bar.hidden = true; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Suggestion');
  bar.innerHTML = `<button type="button" data-hv="accept" aria-label="${esc(t('review.acceptLabel'))}">${ic('check')}<span>${esc(t('review.accept'))}</span></button><button type="button" data-hv="reject" aria-label="${esc(t('review.rejectLabel'))}">${ic('close')}<span>${esc(t('review.reject'))}</span></button>`;
  host.append(bar);
  let hoverEl = null, hoverTimer = 0;
  const hideBar = () => { clearTimeout(hoverTimer); bar.hidden = true; hoverEl = null; };
  const changeAt = (el) => {
    let pos; try { pos = editor.view.posAtDOM(el, 0); } catch { return null; }
    return docReview(editor.state.doc).find((c) => ['ins', 'del', 'sub'].includes(c.kind) && pos >= c.from && pos <= c.to) || null;
  };
  editor.view.dom.addEventListener('mouseover', (e) => {
    const el = e.target.closest?.('.critic-ins, .critic-del, .critic-sub'); if (!el || !editor.isEditable) return;
    const root = el.closest('.critic-sub') || el; clearTimeout(hoverTimer);
    if (hoverEl === root && !bar.hidden) return;
    if (!changeAt(root)) return;
    hoverEl = root; const r = root.getBoundingClientRect(); bar.hidden = false;
    const w = bar.offsetWidth || 160; bar.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`; bar.style.top = `${r.top > 44 ? r.top - 34 : r.bottom + 4}px`;
  });
  editor.view.dom.addEventListener('mouseout', (e) => { if (hoverEl && !bar.contains(e.relatedTarget)) { clearTimeout(hoverTimer); hoverTimer = setTimeout(hideBar, 260); } });
  bar.addEventListener('mouseenter', () => clearTimeout(hoverTimer));
  bar.addEventListener('mouseleave', () => { hoverTimer = setTimeout(hideBar, 260); });
  bar.addEventListener('mousedown', (e) => e.preventDefault());
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-hv]'); if (!b || !hoverEl) return;
    const x = changeAt(hoverEl); hideBar(); if (!x) return;
    editor.view.dispatch(settle(editor.state, x, b.dataset.hv === 'accept')); editor.commands.focus();
  });
  scroll.addEventListener('scroll', hideBar, { passive: true });
  editor.on('transaction', ({ transaction }) => { if (transaction.docChanged) hideBar(); });

  const api = {
    get open() { return visible(); },
    toggle() { show(!visible()); if (visible()) render(); },
    show(on = true) { show(on); if (on) render(); },
    /* Docs: select text and comment; with no selection the word at the cursor is used */
    comment() {
      let { from, to, empty, $from } = sel();
      if (empty) { const t = $from.parent.textContent; let a = $from.parentOffset, b = a; while (a > 0 && /[\p{L}\p{N}_]/u.test(t[a - 1])) a--; while (b < t.length && /[\p{L}\p{N}_]/u.test(t[b])) b++; from = $from.start() + a; to = $from.start() + b; }
      if (editor.state.doc.resolve(from).parent.type.spec.code) return false;
      const { schema } = editor.state; const tr = editor.state.tr;
      if (to > from && !editor.state.doc.rangeHasMark(from, to, schema.marks.criticHl)) tr.addMark(from, to, schema.marks.criticHl.create());
      tr.insert(to, schema.nodes.criticComment.create({ body: commentBody(author(), '') }));
      tr.setSelection(TextSelection.create(tr.doc, to));
      focusDraft = true; show(true); editor.view.dispatch(tr); render();
      return true;
    },
    mode(m) {
      if (m === 'view') { editor.storage.suggestMode.on = false; editor.setEditable(false); }
      else { editor.setEditable(true); editor.storage.suggestMode.on = m === 'suggest'; }
      host.classList.toggle('is-suggesting', m === 'suggest'); host.classList.toggle('is-viewing', m === 'view');
      render(); onToggle?.(visible()); return m;
    },
    suggest(on = !editor.storage.suggestMode.on) { if (!editor.isEditable) editor.setEditable(true); host.classList.remove('is-viewing'); editor.storage.suggestMode.on = on; host.classList.toggle('is-suggesting', on); render(); onToggle?.(visible()); return on; },
    /* the next or previous change or comment after the cursor */
    step(dir) {
      const list = items.filter((x) => x.kind !== 'hl'); if (!list.length) return false;
      const at = sel().from; const pos = (x) => (x.kind === 'thread' ? x.from : x.from);
      const next = dir > 0 ? list.find((x) => pos(x) > at) || list[0] : [...list].reverse().find((x) => pos(x) < at) || list.at(-1);
      go(next); return true;
    },
    /* accept or reject the change at the cursor, then move to the next one (Word) */
    settleHere(ok) {
      const list = items.filter((x) => x.kind === 'ins' || x.kind === 'del' || x.kind === 'sub'); if (!list.length) return false;
      const { from } = sel(); const x = list.find((c) => from >= c.from && from <= c.to) || list.find((c) => c.from >= from) || list[0];
      editor.view.dispatch(settle(editor.state, x, ok)); setTimeout(() => api.step(1), 150); return true;
    },
    all(ok) {
      const list = docReview(editor.state.doc).filter((x) => x.kind === 'ins' || x.kind === 'del' || x.kind === 'sub');
      const tr = editor.state.tr; for (const x of list) settle(editor.state, x, ok, tr); editor.view.dispatch(tr); editor.commands.focus(); return list.length;
    },
    resolveAll() { const tr = editor.state.tr; for (const t of docReview(editor.state.doc).filter((x) => x.kind === 'thread')) resolveThread(editor.state, t, tr); editor.view.dispatch(tr); },
    render,
    counts() { const r = docReview(editor.state.doc); return { comments: r.filter((x) => x.kind === 'thread').length, changes: r.filter((x) => ['ins', 'del', 'sub'].includes(x.kind)).length }; },
  };
  render();
  return api;
}
