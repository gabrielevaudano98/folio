// Folio — chat mode surface: the conversation, approval cards, the composer and the Settings → AI group.
// Loaded on first use. All thinking happens in the main process (src/main/chat); this file only draws and sends.
import { t as tr } from './i18n.js';
import { icons } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STEP = { waiting: 'chat.step-waiting', run: 'chat.step-run', done: 'chat.step-done', error: 'chat.step-error', denied: 'chat.step-denied' };
const NOTE = /\.(md|markdown|mdx|txt)$/i;
/** a short line for a tool step: "edit note Plan.md", "move note a.md → b.md" */
export const stepLabel = (name, a = {}) => `${name.replace(/_/g, ' ')}${a.path || a.from || a.query ? ' ' + (a.path || a.from || a.query) : ''}${a.to ? ' → ' + a.to : ''}`;

export function createChat({ folio, host, toast, openSettings, openNote, setLayout, getLayout }) {
  const root = host;
  root.innerHTML = `
    <header class="chat-head">
      <div class="chat-id"><span class="chat-folder" id="chat-folder"></span><span class="chat-model" id="chat-model"></span></div>
      <div class="chat-actions">
        <button class="icon-btn" type="button" id="chat-history" aria-haspopup="menu" aria-label="${esc(tr('chat.conversations'))}" data-tip="${esc(tr('chat.conversations'))}">${icons.more}</button>
        <button class="icon-btn" type="button" id="chat-new" aria-label="${esc(tr('chat.new'))}" data-tip="${esc(tr('chat.new'))}">${icons.plus}</button>
        <button class="icon-btn" type="button" id="chat-layout" aria-label="${esc(tr('chat.minimise'))}" data-tip="${esc(tr('chat.minimise'))}"></button>
      </div>
    </header>
    <div class="chat-notice" id="chat-notice" hidden></div>
    <div class="chat-scroll" id="chat-scroll"><div class="chat-log" id="chat-log" role="log" aria-live="polite" aria-relevant="additions"></div></div>
    <form class="chat-composer" id="chat-form">
      <textarea id="chat-input" rows="1" placeholder="${esc(tr('chat.placeholder'))}" aria-label="${esc(tr('chat.message'))}" spellcheck="true"></textarea>
      <button class="btn btn-primary" type="submit" id="chat-send">${esc(tr('chat.send'))}</button>
      <button class="btn" type="button" id="chat-stop" hidden>${esc(tr('chat.stop'))}</button>
    </form>`;
  const $ = (s) => root.querySelector(s);
  const log = $('#chat-log'), scroll = $('#chat-scroll'), input = $('#chat-input');
  let st = null, convId = null, busy = false, bubble = null, bubbleText = '', renderMd = null, raf = 0;

  const md = async () => (renderMd ||= (await import('./markdown.js')).render);
  const stick = () => { const near = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80; return () => { if (near) scroll.scrollTop = scroll.scrollHeight; }; };
  const add = (html, cls) => { const keep = stick(); const d = document.createElement('div'); d.className = cls; d.innerHTML = html; log.appendChild(d); keep(); return d; };

  /* ---------- messages ---------- */
  const userBubble = (text) => add(esc(text).replace(/\n/g, '<br>'), 'chat-msg chat-user');
  function assistantBubble() { bubble = add('', 'chat-msg chat-ai prose'); bubbleText = ''; return bubble; }
  async function paintBubble(el, text) { const r = await md(); el.innerHTML = r(text); el.querySelectorAll('a').forEach((a) => { a.setAttribute('rel', 'noopener'); if (!a.dataset.wikilink) a.setAttribute('tabindex', '0'); }); }
  async function flush() { cancelAnimationFrame(raf); raf = 0; const el = bubble, text = bubbleText; if (el) { const keep = stick(); await paintBubble(el, text); keep(); } }
  function stream(delta) {
    if (!bubble) assistantBubble();
    bubbleText += delta;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; flush(); });
  }
  const stepEl = (id) => log.querySelector(`.chat-step[data-id="${CSS.escape(id)}"]`);
  function step(ev) {
    flush(); bubble = null;
    let el = stepEl(ev.id);
    if (!el) { const keep = stick(); el = document.createElement('div'); el.className = 'chat-step'; el.dataset.id = ev.id; log.appendChild(el); keep(); }
    el.dataset.status = ev.status;
    const p = ev.args?.path || ev.args?.to || ev.args?.from;
    const open = p && NOTE.test(p) && ev.status === 'done' ? `<button class="chat-link" type="button" data-open="${esc(ev.args.to || p)}">${esc(tr('chat.open'))}</button>` : '';
    const detail = ev.status === 'error' || ev.status === 'denied' ? ` <span class="chat-step-detail">${esc(ev.detail || '')}</span>` : '';
    const keepTok = el.querySelector('[data-restore]')?.outerHTML || '';
    el.innerHTML = `<span class="chat-step-dot" aria-hidden="true"></span><span class="chat-step-line"><span class="sr-only">${esc(tr(STEP[ev.status] || 'chat.step-error'))}: </span>${esc(stepLabel(ev.name, ev.args))}${detail}</span>${open}${keepTok}`;
  }
  function approval(ev) {
    const el = stepEl(ev.id) || (step({ ...ev, status: 'waiting' }), stepEl(ev.id));
    const card = document.createElement('div'); card.className = 'chat-approve'; card.setAttribute('role', 'group'); card.setAttribute('aria-label', tr('chat.approval'));
    const target = [ev.args?.path, ev.args?.from && `${ev.args.from} → ${ev.args.to}`].filter(Boolean).join(', ');
    card.innerHTML = `<p class="chat-approve-title">${esc(ev.reason || '')}</p><p class="chat-approve-target">${esc(target)}</p>${ev.args?.reason ? `<p class="chat-approve-why">${esc(ev.args.reason)}</p>` : ''}
      <div class="chat-approve-btns"><button class="btn" type="button" data-answer="once">${esc(tr('chat.allow-once'))}</button>${ev.remember ? `<button class="btn" type="button" data-answer="chat">${esc(tr('chat.allow-chat'))}</button>` : ''}<button class="btn btn-quiet" type="button" data-answer="deny">${esc(tr('chat.deny'))}</button></div>`;
    el.after(card); card.querySelector('button').focus({ preventScroll: false });
    card.onclick = async (e) => { const b = e.target.closest('[data-answer]'); if (!b) return; card.remove(); (log.querySelector('.chat-approve [data-answer]') || input).focus(); try { await folio.chat.approve(ev.id, b.dataset.answer); } catch (er) { toast(er.message, { kind: 'error' }); } };
    scroll.scrollTop = scroll.scrollHeight;
  }
  const line = (text, cls = 'chat-sys') => add(esc(text), cls);

  function onEvent(ev) {
    if (ev.type === 'start') { convId = ev.convId; setBusy(true); return; }
    if (ev.convId !== convId) return;
    if (ev.type === 'text') stream(ev.delta);
    else if (ev.type === 'tool') step(ev);
    else if (ev.type === 'approval') approval(ev);
    else if (ev.type === 'trashed') { const el = stepEl(ev.id); if (el && !el.querySelector('[data-restore]')) el.insertAdjacentHTML('beforeend', `<button class="chat-link" type="button" data-restore="${esc(ev.token)}">${esc(tr('chat.restore'))}</button>`); }
    else if (ev.type === 'notice') line(ev.message);
    else if (ev.type === 'error') { flush(); bubble = null; line(ev.message, 'chat-sys chat-error'); }
    else if (ev.type === 'done') { flush(); bubble = null; }
    else if (ev.type === 'idle') { flush(); bubble = null; setBusy(false); refresh(); }
  }
  folio.chat.onEvent(onEvent);

  /* ---------- history of a stored conversation ---------- */
  async function showConversation(c) {
    log.innerHTML = ''; bubble = null; convId = c?.id || null;
    if (!c) return empty();
    const results = new Map(); for (const m of c.messages) if (m.role === 'tool') for (const r of m.results) results.set(r.id, r);
    for (const m of c.messages) {
      if (m.role === 'user') userBubble(m.text);
      else if (m.role === 'assistant') {
        if (m.text) { await paintBubble(assistantBubble(), m.text); bubble = null; }
        for (const call of m.toolCalls || []) { const r = results.get(call.id); step({ id: call.id, name: call.name, args: call.args, status: !r ? 'error' : r.isError ? (/^(Not allowed|The person declined)/.test(r.text) ? 'denied' : 'error') : 'done', detail: r?.isError ? r.text.slice(0, 160) : '' }); }
      }
    }
    bubble = null; scroll.scrollTop = scroll.scrollHeight;
  }
  function empty() {
    const ok = ready();
    log.innerHTML = ok ? `<div class="chat-empty"><h2>${esc(tr('chat.empty-title'))}</h2><p>${esc(tr('chat.empty-body'))}</p>
      <ul class="chat-ideas">${['chat.idea-1', 'chat.idea-2', 'chat.idea-3'].map((k) => `<li><button type="button" class="chat-idea" data-idea="${esc(tr(k))}">${esc(tr(k))}</button></li>`).join('')}</ul></div>`
      : `<div class="chat-empty"><h2>${esc(tr('chat.setup-title'))}</h2><p>${esc(tr('chat.setup-body', { provider: st?.providers?.[st.config.provider]?.label || '' }))}</p><button class="btn btn-primary" type="button" data-settings>${esc(tr('chat.add-key'))}</button><p class="chat-privacy">${esc(tr('chat.privacy'))}</p></div>`;
  }
  const ready = () => !!st && (st.keys[st.config.provider]?.has || (st.config.provider === 'openai' && st.config.openaiBase));

  /* ---------- state ---------- */
  function paintLayoutBtn() {
    const full = getLayout() === 'full'; const b = $('#chat-layout');
    b.innerHTML = full ? icons.sidebar : icons.focus; const label = tr(full ? 'chat.minimise' : 'chat.expand');
    b.setAttribute('aria-label', label); b.dataset.tip = label;
  }
  async function refresh() {
    try { st = await folio.chat.state(); } catch (e) { toast(e.message, { kind: 'error' }); return; }
    $('#chat-folder').textContent = host.dataset.folder || '';
    const p = st.config.provider; $('#chat-model').textContent = `${st.providers[p].label} · ${st.config.models[p] || tr('chat.no-model')}`;
    const n = $('#chat-notice');
    n.hidden = st.allowWrite; if (!st.allowWrite) n.innerHTML = `<span>${esc(tr('chat.read-only'))}</span><button class="btn btn-quiet" type="button" data-allow>${esc(tr('chat.allow-edits'))}</button>`;
    setBusy(st.busy); paintLayoutBtn();
    if (!log.children.length || log.querySelector('.chat-empty')) empty();
    input.disabled = !ready();
  }
  function setBusy(b) { busy = b; $('#chat-send').hidden = b; $('#chat-stop').hidden = !b; root.dataset.busy = String(b); }

  async function send(text) {
    text = text.trim(); if (!text || busy) return;
    if (!ready()) { openSettings(); return; }
    log.querySelector('.chat-empty')?.remove();
    userBubble(text); input.value = ''; grow(); bubble = null;
    try { const r = await folio.chat.send(text); convId = r.id; }
    catch (e) { line(e.message, 'chat-sys chat-error'); setBusy(false); }
  }
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px'; input.style.overflowY = input.scrollHeight > 200 ? 'auto' : 'hidden'; };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); } });
  $('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
  $('#chat-stop').onclick = () => folio.chat.stop().catch(() => {});
  $('#chat-layout').onclick = () => setLayout(getLayout() === 'full' ? 'dock' : 'full');
  $('#chat-new').onclick = async () => { try { await folio.chat.newChat(); await showConversation(null); await refresh(); input.focus(); } catch (e) { toast(e.message, { kind: 'error' }); } };
  $('#chat-history').onclick = (e) => {
    const list = st?.conversations || []; document.querySelector('.chat-menu')?.remove();
    const m = document.createElement('div'); m.className = 'chat-menu'; m.setAttribute('aria-label', tr('chat.conversations'));
    m.innerHTML = list.length ? list.map((c) => `<div class="chat-menu-row"><button type="button" data-conv="${esc(c.id)}">${esc(c.title || tr('chat.untitled'))}</button><button class="icon-btn" type="button" data-del="${esc(c.id)}" aria-label="${esc(tr('chat.delete'))}">${icons.close}</button></div>`).join('') : `<p class="chat-menu-empty">${esc(tr('chat.no-conversations'))}</p>`;
    root.appendChild(m); const close = (ev) => { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', close, true); } }; setTimeout(() => document.addEventListener('pointerdown', close, true));
    m.onclick = async (ev) => {
      const o = ev.target.closest('[data-conv]'), d = ev.target.closest('[data-del]');
      try {
        if (o) { m.remove(); await showConversation(await folio.chat.open(o.dataset.conv)); }
        else if (d) { await folio.chat.delete(d.dataset.del); d.closest('.chat-menu-row').remove(); if (convId === d.dataset.del) { await showConversation(null); } await refresh(); }
      } catch (er) { toast(er.message, { kind: 'error' }); }
    };
    m.querySelector('button')?.focus(); m.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { m.remove(); document.removeEventListener('pointerdown', close, true); $('#chat-history').focus(); } });
  };
  root.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-settings]')) openSettings('chat');
    else if (t.closest('[data-allow]')) { try { await folio.setSettings({ allowWrite: true }); await refresh(); host.dispatchEvent(new CustomEvent('folio:allow-write')); } catch (er) { toast(er.message, { kind: 'error' }); } }
    else if (t.closest('[data-idea]')) { input.value = t.closest('[data-idea]').dataset.idea; grow(); input.focus(); }
    else if (t.closest('[data-open]')) openNote(t.closest('[data-open]').dataset.open);
    else if (t.closest('[data-restore]')) { const b = t.closest('[data-restore]'); b.disabled = true; try { const rel = await folio.untrash(b.dataset.restore); b.outerHTML = `<span class="chat-step-detail">${esc(tr('chat.restored', { path: rel }))}</span>`; host.dispatchEvent(new CustomEvent('folio:tree-dirty')); } catch (er) { b.disabled = false; toast(er.message, { kind: 'error' }); } }
  });

  return {
    async show() { await refresh(); const cur = await folio.chat.current().catch(() => null); if (cur && cur.id !== convId) await showConversation(cur); else if (!convId && !log.children.length) empty(); if (!input.disabled) input.focus(); },
    refresh, paintLayoutBtn,
    reset() { convId = null; log.innerHTML = ''; empty(); },
  };
}

/* ---------- Settings → AI chat ---------- */
export async function renderSettings(el, { folio, toast }) {
  const load = async () => {
    const st = await folio.chat.state(); const c = st.config; const p = c.provider; const prov = st.providers[p]; const key = st.keys[p];
    el.innerHTML = `<h3>${esc(tr('chat.settings-title'))}</h3><p class="group-note">${esc(tr('chat.settings-note'))}</p><div class="rows">
      <div class="row"><div class="row-main"><label class="row-title" for="cs-provider">${esc(tr('chat.provider'))}</label></div>
        <select class="select" id="cs-provider">${Object.entries(st.providers).map(([id, v]) => `<option value="${id}" ${id === p ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>
      <div class="row"><div class="row-main"><label class="row-title" for="cs-model">${esc(tr('chat.model'))}</label><span class="row-sub">${esc(tr('chat.model-help'))}</span></div>
        <input class="input" id="cs-model" list="cs-models" value="${esc(c.models[p])}" autocomplete="off" spellcheck="false" style="width:14rem"><datalist id="cs-models">${prov.models.map((m) => `<option value="${esc(m)}">`).join('')}</datalist></div>
      ${prov.custom ? `<div class="row"><div class="row-main"><label class="row-title" for="cs-base">${esc(tr('chat.endpoint'))}</label><span class="row-sub">${esc(tr('chat.endpoint-help'))}</span></div>
        <input class="input" id="cs-base" value="${esc(c.openaiBase)}" placeholder="https://api.openai.com/v1" autocomplete="off" spellcheck="false" style="width:14rem"></div>` : ''}
      <div class="row"><div class="row-main"><label class="row-title" for="cs-key">${esc(tr('chat.key'))}</label><span class="row-sub" id="cs-key-sub">${esc(key ? tr('chat.key-saved', { last4: key.last4 }) : st.keychain ? tr('chat.key-none') : tr('chat.no-keychain'))}</span></div>
        <input class="input" id="cs-key" type="password" autocomplete="off" spellcheck="false" placeholder="${esc(key ? '••••••••' : 'sk-…')}" style="width:14rem" ${st.keychain ? '' : 'disabled'}></div>
      <div class="row"><div class="row-main"><span class="row-sub" id="cs-status" role="status" aria-live="polite"></span></div>
        <button class="btn" type="button" id="cs-save" ${st.keychain ? '' : 'disabled'}>${esc(tr('chat.save-key'))}</button>
        ${key ? `<button class="btn" type="button" id="cs-remove">${esc(tr('chat.remove-key'))}</button>` : ''}
        <button class="btn" type="button" id="cs-test">${esc(tr('chat.test'))}</button></div></div>
      <p class="group-note">${esc(tr('chat.privacy'))}</p>`;
    const say = (m, bad) => { const s = el.querySelector('#cs-status'); s.textContent = m; s.dataset.bad = String(!!bad); };
    const guard = async (fn) => { try { await fn(); } catch (e) { say(e.message, true); } };
    el.querySelector('#cs-provider').onchange = (e) => guard(async () => { await folio.chat.config({ provider: e.target.value }); await load(); });
    el.querySelector('#cs-model').onchange = (e) => guard(async () => { await folio.chat.config({ model: e.target.value }); say(tr('chat.saved')); });
    el.querySelector('#cs-base')?.addEventListener('change', (e) => guard(async () => { await folio.chat.config({ openaiBase: e.target.value.trim() }); say(tr('chat.saved')); }));
    el.querySelector('#cs-save').onclick = () => guard(async () => { const k = el.querySelector('#cs-key').value; await folio.chat.keySet(p, k); await load(); el.querySelector('#cs-status').textContent = tr('chat.saved'); });
    el.querySelector('#cs-remove')?.addEventListener('click', () => guard(async () => { await folio.chat.keyRemove(p); await load(); }));
    el.querySelector('#cs-test').onclick = () => guard(async () => { say(tr('chat.testing')); await folio.chat.test(); say(tr('chat.test-ok')); });
  };
  await load();
}
