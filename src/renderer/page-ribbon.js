// Folio — the page ribbon. Two layouts of the same commands, as in Microsoft 365:
//   compact: one row with the everyday tools and an Insert menu (the default)
//   full:    Word's tabs (Home, Insert, Layout, Review, View) with labelled groups, plus a Table tab while the cursor
//            is in a table (Word's "Table Layout" contextual tab)
// Pure markup and wiring: every button carries a data-cmd that rich.js runs, so both layouts stay in step.
//   cmd       a rich.js command (bold, alignCenter, rowAfter…)
//   ins:<id>  an item of the insert registry (inserts.js)
//   app:<id>  a command the app owns (focus mode, outline, spelling)

import { t as tr, tl } from './i18n.js';
const L = (s) => tl('rib', s);

const MODE_KEY = 'folio.ribbon';
export const ribbonMode = (key = MODE_KEY, dflt = 'compact') => { try { const v = localStorage.getItem(key); return v === 'full' || v === 'compact' ? v : dflt; } catch { return dflt; } };
const saveMode = (m, key = MODE_KEY) => { try { localStorage.setItem(key, m); } catch { /* storage unavailable */ } };

/* style gallery (Word's Styles group): a tile shows the style itself */
export const STYLE_TILES = [['p', 'Normal'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['quote', 'Quote']];

/*
 * A group: { label, items } where items are columns; a column is one large button ({ big: true }) or a stack of up to
 * three rows, each row an array of buttons. A button: [cmd, label, icon, key?, { text: true } shows its label].
 */
const B = (cmd, label, icon, key, opts = {}) => ({ cmd, label, icon, key, ...opts });
const big = (cmd, label, icon, key, opts) => ({ ...B(cmd, label, icon, key, opts), big: true });
const txt = (cmd, label, icon, key, opts) => B(cmd, label, icon, key, { ...opts, text: true });

export const TABS = [
  { id: 'home', label: 'Home', groups: [
    { label: 'Clipboard', rank: 2, items: [big('painter', 'Format painter', 'brush', 'Mod+Alt+C', { pressable: true, tip: 'Copy formatting, then select text to apply it. Double-click to keep it on.' })] },
    { label: 'Font', items: [[
      [B('bold', 'Bold', 'bold', 'Mod+B'), B('italic', 'Italic', 'italic', 'Mod+I'), B('underline', 'Underline', 'underline', 'Mod+U'), B('strike', 'Strikethrough', 'strike', 'Mod+Shift+S'), B('code', 'Inline code', 'codeInline', 'Mod+E')],
      [B('superscript', 'Superscript', 'superscript', 'Mod+Shift+.'), B('subscript', 'Subscript', 'subscript', 'Mod+Shift+,'), B('highlight', 'Highlight', 'highlighter', 'Mod+Shift+H'), B('colour', 'Text colour', 'palette'), B('clear', 'Clear formatting', 'clear')],
    ]] },
    { label: 'Paragraph', items: [[
      [B('bullet', 'Bulleted list', 'listBullet', 'Mod+Shift+8'), B('ordered', 'Numbered list', 'listOrdered', 'Mod+Shift+7'), B('task', 'Checklist', 'listTask', 'Mod+L'), B('outdent', 'Decrease indent', 'outdent', 'Shift+Tab'), B('indent', 'Increase indent', 'indent', 'Tab')],
      [B('alignLeft', 'Align left', 'alignLeft', 'Mod+Shift+L'), B('alignCenter', 'Centre', 'alignCenter', 'Mod+Alt+E'), B('alignRight', 'Align right', 'alignRight', 'Mod+Shift+R'), B('alignJustify', 'Justify', 'alignJustify', 'Mod+Shift+J'), B('quote', 'Quote', 'quote')],
    ]] },
    { label: 'Styles', rank: 3, styles: true },
    { label: 'Editing', rank: 1, items: [[[txt('find', 'Find', 'find', 'Mod+F')], [txt('replace', 'Replace', 'replace', 'Mod+H')], [txt('selectAll', 'Select all', 'check', 'Mod+A')]]] },
  ] },
  { id: 'insert', label: 'Insert', groups: [
    { label: 'Pages', items: [big('ins:page', 'Sub-page', 'doc'), [[txt('ins:page-break', 'Page break', 'pageBreak', 'Mod+Alt+Enter')], [txt('ins:breadcrumb', 'Breadcrumb', 'folder')], [txt('addProperty', 'Property', 'tag', null, { tip: 'A field in the page properties (front matter)' })]]] },
    { label: 'Tables', rank: 4, items: [big('tableGrid', 'Table', 'table', null, { menu: true }), [[txt('ins:database-table', 'Database', 'sheet')], [txt('ins:database-board', 'Board', 'kanban')]]] },
    { label: 'Media', rank: 3, items: [big('ins:image', 'Picture', 'image'), [[txt('ins:video', 'Video', 'video')], [txt('ins:audio', 'Audio', 'audio')], [txt('ins:pdf', 'PDF', 'pdf')]], [[txt('ins:file', 'File', 'folder')], [txt('ins:bookmark', 'Bookmark', 'globe')], [txt('ins:web-embed', 'Web embed', 'embed')]]] },
    { label: 'Blocks', rank: 2, items: [big('ins:callout', 'Callout', 'callout'), [[txt('ins:toggle', 'Toggle', 'chevron')], [txt('ins:code', 'Code', 'codeBlock')], [txt('ins:divider', 'Divider', 'divider')]], [[txt('ins:mermaid', 'Diagram', 'board')], [txt('ins:chart', 'Chart', 'chart')], [txt('ins:synced', 'Synced block', 'copy')]]] },
    { label: 'Links', rank: 5, items: [big('ins:link', 'Link to page', 'link', 'Mod+Shift+K'), [[txt('link', 'Web link', 'link', 'Mod+K')], [txt('ins:embed', 'Embed page', 'doc')], [txt('ins:value', 'Live value', 'sheet')]], [[txt('ins:today', 'Date', 'calendar')], [txt('ins:status', 'Status', 'status')], [txt('emoji', 'Emoji', 'emoji')]]] },
    { label: 'Symbols', rank: 1, items: [big('blockMath', 'Equation', 'sigma'), [[txt('inlineMath', 'Inline maths', 'sigma', 'Mod+Shift+M')], [txt('footnote', 'Footnote', 'footnote', 'Mod+Alt+F')], [txt('hiddenComment', 'Hidden note', 'commentHidden')]]] },
    { label: 'Templates', rank: 6, items: [big('app:template', 'Template', 'doc', 'Mod+Alt+T', { tip: 'Insert a page from Templates/' }), [[txt('app:template-button', 'Button', 'plus', null, { tip: 'A button that inserts a template, as in Notion' })], [txt('app:daily-note', 'Today', 'calendar', 'Mod+Alt+D')]]] },
    { label: 'More', rank: 99, items: [big('slash', 'All blocks', 'plus', '/', { tip: 'Everything you can insert, as the / menu' })] },
  ] },
  { id: 'layout', label: 'Layout', groups: [
    { label: 'Columns', items: [big('ins:columns-2', 'Two columns', 'columns'), [[txt('ins:columns-3', 'Three', 'columns')], [txt('ins:columns-4', 'Four', 'columns')], [txt('ins:columns-5', 'Five', 'columns')]]] },
    { label: 'Page', items: [big('ins:page-break', 'Break', 'pageBreak'), [[txt('width:narrow', 'Narrow page', 'width', null, { pressable: true })], [txt('width:normal', 'Normal page', 'width', null, { pressable: true })], [txt('width:wide', 'Full width', 'width', null, { pressable: true })]]] },
    { label: 'Navigation', items: [big('ins:toc', 'Contents', 'outline'), [[txt('ins:breadcrumb', 'Breadcrumb', 'folder')], [txt('ins:toggle-h2', 'Toggle heading', 'chevron')]]] },
    { label: 'Indent', items: [[[txt('indent', 'Indent', 'indent', 'Tab')], [txt('outdent', 'Outdent', 'outdent', 'Shift+Tab')]]] },
  ] },
  { id: 'review', label: 'Review', groups: [
    { label: 'Proofing', rank: 1, items: [big('app:spellcheck', 'Spelling', 'spell', null, { pressable: true }), [[txt('counts', 'Word count', 'counter', 'Mod+Shift+C')], [txt('find', 'Find', 'find', 'Mod+F')], [txt('replace', 'Replace', 'replace', 'Mod+H')]]] },
    { label: 'Comments', rank: 4, items: [big('comment', 'New comment', 'comment', 'Mod+Alt+M'), [[txt('reviewPane', 'Show comments', 'outline', null, { pressable: true })], [txt('resolveAll', 'Resolve all', 'check', null, { tip: 'Remove every comment; the text stays' })], [txt('hiddenComment', 'Hidden note', 'commentHidden')]]] },
    { label: 'Tracking', rank: 5, items: [big('suggest', 'Suggesting', 'rename', null, { pressable: true, tip: 'What you type and delete becomes a suggestion to accept or reject ({++ ++} {-- --})' })] },
    { label: 'Changes', rank: 3, items: [big('acceptChange', 'Accept', 'check', null, { tip: 'Accept the change at the cursor and go to the next one' }), big('rejectChange', 'Reject', 'close', null, { tip: 'Reject the change at the cursor and go to the next one' }), [[txt('prevChange', 'Previous', 'arrowUp')], [txt('nextChange', 'Next', 'arrowDown')]], [[txt('acceptAll', 'Accept all', 'check')], [txt('rejectAll', 'Reject all', 'close')]]] },
    { label: 'Notes', rank: 2, items: [big('footnote', 'Footnote', 'footnote', 'Mod+Alt+F')] },
  ] },
  { id: 'view', label: 'View', groups: [
    { label: 'Focus', items: [big('app:focus', 'Focus mode', 'focus', 'Mod+Shift+Enter', { pressable: true }), big('typewriter', 'Typewriter', 'typewriter', null, { pressable: true, tip: 'Keep the line you are typing in the middle of the window' })] },
    { label: 'Show', items: [big('app:outline', 'Outline', 'outline', 'Mod+Shift+O', { pressable: true }), big('foldAll', 'Fold all', 'chevronUp', null, { tip: 'Fold every heading' }), big('unfoldAll', 'Unfold all', 'chevronDown')] },
    { label: 'Zoom', items: [[[B('zoomOut', 'Zoom out', 'zoomOut', 'Mod+-'), B('zoomReset', '100%', null, 'Mod+0', { label100: true }), B('zoomIn', 'Zoom in', 'zoomIn', 'Mod+=')]]] },
    { label: 'Page width', items: [[[txt('width:narrow', 'Narrow', 'width', null, { pressable: true })], [txt('width:normal', 'Normal', 'width', null, { pressable: true })], [txt('width:wide', 'Full width', 'width', null, { pressable: true })]]] },
  ] },
  { id: 'table', label: 'Table', contextual: true, groups: [
    { label: 'Rows and columns', items: [[[txt('rowBefore', 'Insert above', 'rowAbove')], [txt('rowAfter', 'Insert below', 'rowBelow')]], [[txt('colBefore', 'Insert left', 'colLeft')], [txt('colAfter', 'Insert right', 'colRight')]]] },
    { label: 'Delete', items: [[[txt('delRow', 'Row', 'rowDelete')], [txt('delCol', 'Column', 'colDelete')], [txt('delTable', 'Table', 'trash')]]] },
    { label: 'Move', items: [[[B('rowUp', 'Move row up', 'arrowUp'), B('rowDown', 'Move row down', 'arrowDown')], [B('colLeft', 'Move column left', 'arrowLeft'), B('colRight', 'Move column right', 'arrowRight')]]] },
    { label: 'Column alignment', items: [[[B('cellLeft', 'Align column left', 'alignLeft', null, { pressable: true }), B('cellCenter', 'Centre column', 'alignCenter', null, { pressable: true }), B('cellRight', 'Align column right', 'alignRight', null, { pressable: true })]]] },
    { label: 'Data', items: [big('sortAsc', 'Sort A to Z', 'sortAsc'), big('sortDesc', 'Sort Z to A', 'sortDesc'), big('tableToSheet', 'Open as sheet', 'sheet', null, { tip: 'Move this table into a sheet (formulas, charts) and embed it here' })] },
  ] },
];

/* the one-row layout: what people use every few minutes, the rest behind Insert and the full ribbon */
export const COMPACT = [
  [B('undo', 'Undo', 'undo', 'Mod+Z'), B('redo', 'Redo', 'redo', 'Mod+Shift+Z')],
  'style',
  [B('bold', 'Bold', 'bold', 'Mod+B'), B('italic', 'Italic', 'italic', 'Mod+I'), B('underline', 'Underline', 'underline', 'Mod+U'), B('strike', 'Strikethrough', 'strike', 'Mod+Shift+S'), B('highlight', 'Highlight', 'highlighter', 'Mod+Shift+H'), B('colour', 'Text colour', 'palette'), B('link', 'Link', 'link', 'Mod+K')],
  [B('bullet', 'Bulleted list', 'listBullet'), B('ordered', 'Numbered list', 'listOrdered'), B('task', 'Checklist', 'listTask', 'Mod+L'), B('align', 'Alignment', 'alignLeft', null, { menu: true })],
  [txt('insertMenu', 'Insert', 'plus', null, { menu: true }), B('comment', 'Comment', 'comment', 'Mod+Alt+M'), B('suggest', 'Suggesting', 'rename', null, { pressable: true })],
  'table',
];
/* the Insert menu of the compact ribbon: the common blocks, then everything (the / menu) */
export const COMPACT_INSERTS = ['table', 'image', 'callout', 'toggle', 'columns-2', 'code', 'math-block', 'divider', 'link', 'today', 'page'];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* other surfaces (sheets) pass their own `tabs`, `compact` row and `label` translator; a button may also be a `select` */
export function buildRibbon({ icons, keyLabel = (k) => k, styleOptions, tabs: TABS_ = TABS, compact: COMPACT_ = COMPACT, label: L_ = L, trailing = null }) {
  const L = L_;
  const ic = (n) => (n && icons[n]) || '';
  const tip = (b) => `${L(b.tip || b.label)}${b.key ? ` (${keyLabel(b.key)})` : ''}`;
  const button = (b, cls = '') => {
    if (b.select) return `<label class="visually-hidden" for="rb-${b.cmd}">${esc(L(b.label))}</label><select class="rb-select${b.wide ? ' rb-select-wide' : ''}" id="rb-${b.cmd}" data-cmd="${b.cmd}" data-tip="${esc(tip(b))}"${b.width ? ` style="width:${b.width}px"` : ''}>${b.select.map(([v, l]) => `<option value="${esc(v)}">${esc(L(l ?? v))}</option>`).join('')}</select>`;
    const pressed = b.pressable ? ' aria-pressed="false"' : '';
    const menu = b.menu ? ' aria-haspopup="menu" aria-expanded="false"' : '';
    if (b.big) return `<button type="button" class="rb rb-big${cls}" data-cmd="${b.cmd}" data-tip="${esc(tip(b))}"${pressed}${menu}>${ic(b.icon)}<span>${esc(L(b.label))}</span>${b.menu ? '<i class="rb-caret" aria-hidden="true"></i>' : ''}</button>`;
    if (b.text) return `<button type="button" class="rb rb-wide${cls}" data-cmd="${b.cmd}" data-tip="${esc(tip(b))}"${pressed}${menu}>${ic(b.icon)}<span>${esc(L(b.label))}</span>${b.menu ? '<i class="rb-caret" aria-hidden="true"></i>' : ''}</button>`;
    if (b.label100) return `<button type="button" class="rb rb-zoom" data-cmd="${b.cmd}" data-tip="${esc(tip(b))}" aria-label="${tr('rib.reset-zoom')}"><span class="rb-zoom-val">100%</span></button>`;
    return `<button type="button" class="rb${cls}" data-cmd="${b.cmd}" aria-label="${esc(L(b.label))}" data-tip="${esc(tip(b))}"${pressed}${menu}>${ic(b.icon)}${b.menu ? '<i class="rb-caret" aria-hidden="true"></i>' : ''}</button>`;
  };
  const styles = `<div class="rb-styles" role="listbox" aria-label="${tr('rib.styles')}">${STYLE_TILES.map(([v, l]) => `<button type="button" class="rb-style-tile" role="option" aria-selected="false" data-style="${v}"><span class="rb-style-sample" data-s="${v}">${v === 'code' ? 'code()' : 'AaBb'}</span><span class="rb-style-name">${L(l)}</span></button>`).join('')}</div>`;
  const groupIcon = (g) => (g.styles ? 'heading' : g.items.map((c) => (Array.isArray(c) ? c.flat()[0] : c)).find(Boolean)?.icon || 'more');
  const group = (g, i, all) => `<div class="rb-g" role="group" aria-label="${esc(L(g.label))}" data-rank="${g.rank ?? all.length - i}"><button type="button" class="rb rb-big rb-g-more" aria-haspopup="true" aria-expanded="false" data-tip="${esc(L(g.label))}">${ic(groupIcon(g))}<span>${esc(L(g.label))}</span><i class="rb-caret" aria-hidden="true"></i></button><div class="rb-g-body">${g.styles ? styles : g.items.map((col) => (Array.isArray(col)
    ? `<div class="rb-col">${col.map((row) => `<div class="rb-row">${row.map((b) => button(b)).join('')}</div>`).join('')}</div>`
    : button(col))).join('')}</div><div class="rb-g-label" aria-hidden="true">${esc(L(g.label))}</div></div>`;
  const tabs = TABS_.map((t) => `<button type="button" role="tab" class="rb-tab${t.contextual ? ' rb-tab-ctx' : ''}" id="rb-tab-${t.id}" data-tab="${t.id}" aria-controls="rb-panel-${t.id}" aria-selected="false" tabindex="-1"${t.contextual ? ' hidden' : ''}>${esc(L(t.label))}</button>`).join('');
  const panels = TABS_.map((t) => `<div class="rb-panel" role="tabpanel" id="rb-panel-${t.id}" aria-labelledby="rb-tab-${t.id}" data-panel="${t.id}" hidden>${t.groups.map(group).join('')}</div>`).join('');
  const compact = COMPACT_.map((g) => {
    if (g === 'style') return `<div class="rb-group"><label class="visually-hidden" for="rb-style">${tr('rib.paragraph-style')}</label><select class="rb-select" id="rb-style" data-tip="${tr('rib.paragraph-style')}">${styleOptions}</select></div>`;
    if (g === 'table') return `<div class="rb-group rb-table" role="group" aria-label="${tr('rib.table')}" hidden><span class="rb-label">${tr('rib.table')}</span>${[B('rowAfter', 'Row below', 'rowBelow'), B('colAfter', 'Column right', 'colRight'), B('delRow', 'Delete row', 'rowDelete'), B('delCol', 'Delete column', 'colDelete'), B('tableMenu', 'More table commands', 'more', null, { menu: true })].map((b) => button(b)).join('')}</div>`;
    return `<div class="rb-group">${g.map((b) => button(b)).join('')}</div>`;
  }).join('');
  const modeBtn = (to) => `<button type="button" class="rb rb-mode" data-cmd="ribbonMode" aria-label="${tr(to === 'full' ? 'rib.show-full' : 'rib.show-simple')}" data-tip="${tr(to === 'full' ? 'rib.tip-full' : 'rib.tip-simple')}">${ic(to === 'full' ? 'chevronDown' : 'chevronUp')}</button>`;
  return `<div class="ribbon" role="toolbar" aria-label="${tr('rib.formatting')}" data-mode="compact">
    <div class="rb-compact">${compact}<span class="rb-spacer"></span><div class="rb-group">${trailing ?? button(B('find', 'Find and replace', 'find', 'Mod+F'))}${modeBtn('full')}</div></div>
    <div class="rb-full">
      <div class="rb-tabs"><div class="rb-quick" role="group" aria-label="${tr('rib.quick-access')}">${button(B('undo', 'Undo', 'undo', 'Mod+Z'))}${button(B('redo', 'Redo', 'redo', 'Mod+Shift+Z'))}</div><div class="rb-tablist" role="tablist" aria-label="${tr('rib.ribbon-tabs')}">${tabs}</div><span class="rb-spacer"></span>${modeBtn('compact')}</div>
      <div class="rb-panels">${panels}</div>
    </div>
  </div>`;
}

/* tabs, layout switch and contextual tab; `run(cmd, button)` executes a command */
export function wireRibbon(ribbon, { run, onModeChange, modeKey = MODE_KEY, defaultMode = 'compact' }) {
  const tabs = [...ribbon.querySelectorAll('.rb-tab')];
  let current = 'home', inTable = false;
  let select = (id, { focus = false } = {}) => {
    current = id;
    for (const t of tabs) { const on = t.dataset.tab === id; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); }
    for (const p of ribbon.querySelectorAll('.rb-panel')) p.hidden = p.dataset.panel !== id;
  };
  let setMode = (m, persist = true) => { ribbon.dataset.mode = m; if (persist) saveMode(m, modeKey); onModeChange?.(m); };
  select('home'); setMode(ribbonMode(modeKey, defaultMode), false);
  ribbon.addEventListener('change', (e) => { const sel = e.target.closest('select[data-cmd]'); if (sel) run(sel.dataset.cmd, sel); });
  ribbon.querySelector('.rb-tablist').addEventListener('click', (e) => { const t = e.target.closest('.rb-tab'); if (t) select(t.dataset.tab); });
  ribbon.querySelector('.rb-tablist').addEventListener('dblclick', (e) => { if (e.target.closest('.rb-tab')) setMode('compact'); });
  ribbon.querySelector('.rb-tablist').addEventListener('keydown', (e) => {
    const shown = tabs.filter((t) => !t.hidden); const i = shown.findIndex((t) => t.dataset.tab === current);
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (step) { e.preventDefault(); select(shown[(i + step + shown.length) % shown.length].dataset.tab, { focus: true }); }
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); select((e.key === 'Home' ? shown[0] : shown.at(-1)).dataset.tab, { focus: true }); }
    if (e.key === 'ArrowDown') { e.preventDefault(); ribbon.querySelector(`#rb-panel-${current} button`)?.focus(); }
  });
  ribbon.addEventListener('mousedown', (e) => { if (e.target.closest('.rb, .rb-style-tile') && !e.target.closest('select')) e.preventDefault(); });
  ribbon.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b?.dataset.cmd === 'ribbonMode') return setMode(ribbon.dataset.mode === 'full' ? 'compact' : 'full');
    const tile = e.target.closest('.rb-style-tile');
    if (tile) return run('style:' + tile.dataset.style, tile);
    if (b && b.tagName !== 'SELECT') run(b.dataset.cmd, b);
  });
  /* narrow windows: groups fold from the right into one button that opens them, as in Word */
  const fit = () => {
    if (ribbon.dataset.mode !== 'full') return;
    const panel = ribbon.querySelector(`#rb-panel-${current}`); if (!panel || panel.hidden) return;
    const groups = [...panel.querySelectorAll('.rb-g')];
    groups.forEach((g) => g.classList.remove('is-collapsed'));
    const order = groups.slice(1).sort((a, b) => +a.dataset.rank - +b.dataset.rank);
    for (const g of order) { if (panel.scrollWidth <= panel.clientWidth + 1) break; g.classList.add('is-collapsed'); }
  };
  let fitRaf = 0;
  new ResizeObserver(() => { cancelAnimationFrame(fitRaf); fitRaf = requestAnimationFrame(fit); }).observe(ribbon);
  let fly = null;
  const closeFly = () => { if (!fly) return; fly.group.querySelector('.rb-g-more').setAttribute('aria-expanded', 'false'); fly.group.insertBefore(fly.body, fly.group.querySelector('.rb-g-label')); fly.el.remove(); fly = null; document.removeEventListener('mousedown', outsideFly, true); };
  const outsideFly = (e) => { if (fly && !fly.el.contains(e.target) && !fly.group.contains(e.target)) closeFly(); };
  ribbon.addEventListener('click', (e) => {
    const more = e.target.closest('.rb-g-more'); if (!more) return;
    e.stopPropagation(); const group = more.closest('.rb-g');
    if (fly?.group === group) return closeFly(); closeFly();
    const body = group.querySelector('.rb-g-body'); const el = document.createElement('div');
    el.className = 'rb-flyout'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', group.getAttribute('aria-label')); el.append(body); document.body.append(el);
    const r = more.getBoundingClientRect(); el.style.top = `${r.bottom + 4}px`; el.style.left = `${Math.max(8, Math.min(r.left, innerWidth - el.offsetWidth - 8))}px`;
    more.setAttribute('aria-expanded', 'true'); fly = { el, body, group };
    el.addEventListener('mousedown', (ev) => { if (ev.target.closest('.rb, .rb-style-tile')) ev.preventDefault(); });
    el.addEventListener('click', (ev) => { const tile = ev.target.closest('.rb-style-tile'); const b = ev.target.closest('[data-cmd]'); if (!tile && !b) return; if (b?.tagName === 'SELECT') return; closeFly(); if (tile) run('style:' + tile.dataset.style, tile); else run(b.dataset.cmd, more); });
    el.addEventListener('change', (ev) => { const sel = ev.target.closest('select[data-cmd]'); if (sel) run(sel.dataset.cmd, sel); });
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); closeFly(); more.focus(); } });
    document.addEventListener('mousedown', outsideFly, true);
    el.querySelector('button')?.focus({ preventScroll: true });
  }, true);
  const origSelect = select;
  select = (id, o) => { closeFly(); origSelect(id, o); requestAnimationFrame(fit); };
  const origMode = setMode;
  setMode = (m, persist) => { closeFly(); origMode(m, persist); requestAnimationFrame(fit); };
  return {
    get mode() { return ribbon.dataset.mode; },
    setMode,
    select,
    /* show the Table tab while the cursor is in a table, as Word does; leaving the table goes back to Home */
    setTable(on) {
      if (on === inTable) return; inTable = on;
      const g = ribbon.querySelector('.rb-table'); if (g) g.hidden = !on;
      const tb = ribbon.querySelector('#rb-tab-table'); if (tb) tb.hidden = !on;
      if (!on && current === 'table') select('home');
    },
  };
}
