// Folio — the Animations pane: the slide's transition and the build order of its animations.
import { EFFECTS, TRANSITIONS, DEFAULT_DUR, parseAnim, animText, setAnimations, buildSteps, parseTransition, transitionText } from './slides-motion.js';
import { scanObjects, setObjectAttrs, nextId } from './slides-objects.js';
import { setDirective, fragmentCount } from './slides-core.js';
import { t as tr } from './i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const KINDS = [['entrance', 'Entrance'], ['emphasis', 'Emphasis'], ['exit', 'Exit'], ['path', 'Motion path']];
const effectOptions = (sel) => KINDS.map(([k, l]) => `<optgroup label="${l}">${Object.entries(EFFECTS).filter(([, v]) => v[0] === k).map(([n, v]) => `<option value="${n}"${n === sel ? ' selected' : ''}>${v[1]}</option>`).join('')}</optgroup>`).join('');
const num = (v) => Math.round(v * 100) / 100;

/**
 * api: deck(), cur(), selection() → [{ index, id, kind }], edit(fn(chunk) → chunk), setGlobal(key, value), preview(), clearSlides(key)
 */
export function createAnimPane(el, api) {
  let addEffect = 'fade-in';
  const slide = () => api.deck().slides[api.cur()];
  const write = (list) => api.edit((c) => setAnimations(c, list));
  const label = (s, a) => { if (a.target === 'body') return 'Slide text'; const o = (s.objects || []).find((x) => x.id === a.target); if (!o) return `#${a.target} (missing)`; const txt = (o.body || '').replace(/[#*_`>\-[\]]/g, '').trim().split('\n')[0]; return `${o.kind} ${txt ? '“' + txt.slice(0, 18) + '”' : '#' + a.target}`; };
  function render() {
    if (el.hidden) return;
    const d = api.deck(); const s = slide(); if (!s) return;
    if (s.master) { el.innerHTML = '<div class="fp-head"><b>Animations</b><button type="button" class="dp-x" data-an="close" aria-label="Close">×</button></div><p class="fp-note">Masters do not animate. Pick a slide.</p>'; return; }
    const t = parseTransition(s.transition ?? d.global.transition ?? 'none');
    const own = s.transition != null;
    const steps = buildSteps(s.animations, () => 1);
    const stepOf = new Map(); steps.forEach((st, k) => st.forEach(({ anim }) => stepOf.set(anim, k + 1)));
    const sel = api.selection(); const frags = fragmentCount(s);
    el.innerHTML = `<div class="fp-head"><b>Animations</b><button type="button" class="dp-x" data-an="close" aria-label="Close">×</button></div>
      <section class="fp-sec"><h4>Transition to this slide</h4>
        <div class="fp-row"><select class="rb-select" data-an="t-name" aria-label="Transition">${Object.entries(TRANSITIONS).map(([n, [l]]) => `<option value="${n}"${n === t.name ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <label class="sf-field"><span>Seconds</span><input class="input sf-num" type="number" min="0.1" max="10" step="0.1" value="${num(t.duration)}" data-an="t-dur" aria-label="Transition duration in seconds"></label></div>
        <div class="fp-row"><button type="button" class="btn btn-quiet" data-an="t-all">Apply to all slides</button>${own ? '' : `<span class="fp-note">${t.name === 'none' ? '' : 'From the deck default'}</span>`}</div>
      </section>
      <section class="fp-sec"><h4>Add animation</h4>
        <div class="fp-row"><select class="rb-select" data-an="add-effect" aria-label="Effect">${effectOptions(addEffect)}</select>
        <button type="button" class="btn" data-an="add">${sel.length ? `Add to ${sel.length === 1 ? 'selection' : sel.length + ' objects'}` : 'Add to slide text'}</button></div>
        <p class="fp-note">${sel.length ? 'Each selected object gets its own line, in the order you picked them.' : 'Nothing selected: the slide text builds one paragraph per click.'}</p>
      </section>
      <section class="fp-sec"><h4>Order</h4>
        ${frags ? `<p class="fp-note an-fragments">${esc(tr('slides.fragments-note', { n: frags }))}</p>` : ''}
        ${s.animations.length ? `<ol class="an-list">${s.animations.map((a, n) => `<li class="an-item" data-n="${n}">
          <div class="an-top"><span class="an-step" title="Click ${stepOf.get(a)}">${a.trigger === 'click' ? stepOf.get(a) : a.trigger === 'with' ? '+' : '→'}</span><span class="an-name">${esc(label(s, a))}</span>
            <button type="button" class="icon-btn" data-an="up" aria-label="Earlier"${n ? '' : ' disabled'}>↑</button><button type="button" class="icon-btn" data-an="down" aria-label="Later"${n < s.animations.length - 1 ? '' : ' disabled'}>↓</button><button type="button" class="icon-btn" data-an="del" aria-label="Remove animation">×</button></div>
          <div class="an-fields"><select class="rb-select" data-af="effect" aria-label="Effect">${effectOptions(a.effect)}</select>
            <select class="rb-select sf-narrow" data-af="trigger" aria-label="Start"><option value="click"${a.trigger === 'click' ? ' selected' : ''}>On click</option><option value="with"${a.trigger === 'with' ? ' selected' : ''}>With previous</option><option value="after"${a.trigger === 'after' ? ' selected' : ''}>After previous</option></select>
            <label class="sf-field"><span>Seconds</span><input class="input sf-num" type="number" min="0.05" max="20" step="0.05" value="${num(a.duration)}" data-af="duration"></label>
            <label class="sf-field"><span>Delay</span><input class="input sf-num" type="number" min="0" max="20" step="0.1" value="${num(a.delay)}" data-af="delay"></label>
            <label class="sf-field"><span>Repeat</span><select class="rb-select sf-narrow" data-af="repeat">${[1, 2, 3, 5, 'loop'].map((r) => `<option value="${r}"${String(a.repeat === Infinity ? 'loop' : a.repeat) === String(r) ? ' selected' : ''}>${r === 'loop' ? 'Until next click' : r === 1 ? 'Once' : r + ' times'}</option>`).join('')}</select></label>
            <label class="sf-check"><input type="checkbox" data-af="by"${a.by === 'paragraph' ? ' checked' : ''}> By paragraph</label></div>
        </li>`).join('')}</ol>` : '<p class="fp-note">No animations on this slide.</p>'}
        <div class="fp-row"><button type="button" class="btn" data-an="preview"${s.animations.length || frags ? '' : ' disabled'}>Preview</button>${s.animations.length ? '<button type="button" class="btn btn-quiet" data-an="clear">Remove all</button>' : ''}</div>
      </section>`;
  }
  el.addEventListener('change', (e) => {
    const s = slide(); const t = e.target;
    if (t.dataset.an === 't-name' || t.dataset.an === 't-dur') {
      const name = el.querySelector('[data-an=t-name]').value; const dur = parseFloat(el.querySelector('[data-an=t-dur]').value) || 0.5;
      api.edit((c) => setDirective(c, 'transition', name === 'none' && !api.deck().global.transition ? null : transitionText({ name, duration: dur }) || 'none'));
      return;
    }
    if (t.dataset.an === 'add-effect') { addEffect = t.value; return; }
    const item = t.closest('.an-item'); if (!item) return;
    const n = +item.dataset.n; const list = s.animations.map((a) => ({ ...a }));
    const a = list[n]; const f = t.dataset.af;
    if (f === 'effect') { a.effect = t.value; const k = EFFECTS[t.value][0]; if (k !== a.kind) a.duration = DEFAULT_DUR[k]; a.kind = k; }
    else if (f === 'trigger') a.trigger = t.value;
    else if (f === 'duration') a.duration = Math.max(0.05, parseFloat(t.value) || DEFAULT_DUR[a.kind]);
    else if (f === 'delay') a.delay = Math.max(0, parseFloat(t.value) || 0);
    else if (f === 'repeat') a.repeat = t.value === 'loop' ? Infinity : +t.value;
    else if (f === 'by') a.by = t.checked ? 'paragraph' : null;
    // spread copies drop the typed form, so changed lines are rewritten; unchanged ones keep it
    write(list.map((x, k) => (k === n ? x : s.animations[k])));
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-an]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
    const s = slide(); const act = b.dataset.an;
    if (act === 'close') { api.close(); return; }
    if (act === 't-all') {
      const name = el.querySelector('[data-an=t-name]').value; const dur = parseFloat(el.querySelector('[data-an=t-dur]').value) || 0.5;
      api.applyAll(transitionText({ name, duration: dur })); return;
    }
    if (act === 'preview') { api.preview(); return; }
    if (act === 'clear') { write([]); return; }
    if (act === 'add') {
      const sel = api.selection();
      api.edit((c) => {
        let t = c; const lines = [...s.animations];
        if (!sel.length) lines.push(parseAnim(`body ${addEffect} by=paragraph`));
        for (const o of sel) {
          let id = scanObjects(t)[o.index]?.id;
          if (!id) { id = nextId(t, o.kind === 'image' ? 'image' : o.kind); t = setObjectAttrs(t, o.index, { id }); }
          lines.push(parseAnim(`#${id} ${addEffect}`));
        }
        return setAnimations(t, lines);
      });
      return;
    }
    const item = b.closest('.an-item'); if (!item) return; const n = +item.dataset.n; const list = [...s.animations];
    if (act === 'del') list.splice(n, 1);
    else if (act === 'up' && n > 0) [list[n - 1], list[n]] = [list[n], list[n - 1]];
    else if (act === 'down' && n < list.length - 1) [list[n + 1], list[n]] = [list[n], list[n + 1]];
    write(list);
  });
  return { render };
}

/** order badges on the canvas: the click number of each animated object */
export function badges(sec, s) {
  if (!sec || !s?.animations?.length) return;
  const steps = buildSteps(s.animations, () => 1); const seen = new Map();
  steps.forEach((st, k) => st.forEach(({ anim }) => { if (anim.target !== 'body' && !seen.has(anim.target)) seen.set(anim.target, k + 1); }));
  // badges sit on their own layer, so a box that clips its content cannot hide them
  const layer = sec.querySelector('.sl-placed') || sec;
  for (const [id, k] of seen) {
    const n = (s.objects || []).findIndex((o) => o.id === id); const el = n >= 0 && sec.querySelector(`.sl-placed > [data-obj="${n}"]`); if (!el) continue;
    el.dataset.anim = k;
    const b = document.createElement('span'); b.className = 'sl-anim-badge'; b.textContent = k; b.setAttribute('aria-hidden', 'true');
    b.style.left = el.offsetLeft + 'px'; b.style.top = el.offsetTop + 'px'; layer.appendChild(b);
  }
}
export { animText };
