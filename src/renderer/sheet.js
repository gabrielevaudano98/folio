// Folio — sheet surface: an Excel-style grid over sheet-md.
import { parseWorkbook, serializeWorkbook, evaluator, display, colName, colIndex, addr, parseAddr, shiftFormula, FORMATS, formulaRefs } from './sheet-core.js';
import { chartHtml, CHART_TYPES, specToText } from './chart.js';
import { perDoc } from './history.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DEFAULT_W = 104;
const FUNCS = ['SUM', 'AVERAGE', 'COUNT', 'COUNTA', 'COUNTIF', 'SUMIF', 'AVERAGEIF', 'MIN', 'MAX', 'IF', 'IFS', 'IFERROR', 'AND', 'OR', 'NOT', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'ABS', 'VLOOKUP', 'HLOOKUP', 'XLOOKUP', 'INDEX', 'MATCH', 'CONCATENATE', 'TEXTJOIN', 'LEFT', 'RIGHT', 'MID', 'LEN', 'UPPER', 'LOWER', 'TRIM', 'TODAY', 'NOW', 'YEAR', 'MONTH', 'DAY', 'DATE', 'MEDIAN', 'STDEV', 'POWER', 'SQRT', 'PMT', 'NPV', 'IRR'];

export function mountSheet(host, ctx) {
  const { icons } = ctx;
  host.innerHTML = `
    <div class="sf-toolbar" role="toolbar" aria-label="Sheet">
      <button class="rb" type="button" data-s="undo" aria-label="Undo" data-tip="Undo (${ctx.keyLabel('Mod+Z')})">${icons.undo}</button>
      <button class="rb" type="button" data-s="redo" aria-label="Redo" data-tip="Redo (${ctx.keyLabel('Mod+Shift+Z')})">${icons.redo}</button>
      <div class="sf-sep"></div>
      <label class="visually-hidden" for="sh-fmt-${host.id}">Number format</label>
      <select class="rb-select sh-fmt" id="sh-fmt-${host.id}" data-tip="Number format">${FORMATS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <button class="rb" type="button" data-s="bold" aria-label="Bold" data-tip="Bold (${ctx.keyLabel('Mod+B')})">${icons.bold}</button>
      <button class="rb" type="button" data-s="italic" aria-label="Italic" data-tip="Italic (${ctx.keyLabel('Mod+I')})">${icons.italic}</button>
      <button class="rb" type="button" data-s="align-left" aria-label="Align left">${icons.alignLeft}</button>
      <button class="rb" type="button" data-s="align-center" aria-label="Align center">${icons.alignCenter}</button>
      <button class="rb" type="button" data-s="align-right" aria-label="Align right">${icons.alignRight}</button>
      <div class="sf-sep"></div>
      <button class="btn" type="button" data-s="insert" aria-haspopup="menu">Insert</button>
      <button class="btn" type="button" data-s="delete" aria-haspopup="menu">Delete</button>
      <button class="btn" type="button" data-s="sort" aria-haspopup="menu">Sort</button>
      <button class="btn" type="button" data-s="sum" data-tip="Insert a SUM below the selection">Σ Sum</button>
      <button class="btn" type="button" data-s="chart" data-tip="Chart the selected cells">${icons.chart} Chart</button>
      <div class="sf-spacer"></div>
      <div class="segmented sh-views" role="radiogroup" aria-label="Sheet view">
        <button type="button" role="radio" data-sv="grid" aria-checked="true" aria-label="Grid" data-tip="Grid">${icons.grid}</button>
        <button type="button" role="radio" data-sv="kanban" aria-checked="false" aria-label="Kanban" data-tip="Kanban by a column">${icons.kanban}</button>
      </div>
      <button class="btn" type="button" data-s="export" aria-haspopup="menu">${icons.export} Export</button>
    </div>
    <div class="sh-formula">
      <input class="sh-addr" aria-label="Cell address, type one to jump" spellcheck="false">
      <span class="sh-fx" aria-hidden="true">fx</span>
      <input class="sh-input" aria-label="Cell contents" spellcheck="false" autocomplete="off">
    </div>
    <div class="sh-body">
      <div class="sh-wrap" tabindex="0" aria-label="Spreadsheet grid">
        <table class="sh-grid" role="grid"><colgroup></colgroup><thead></thead><tbody></tbody></table>
        <div class="sh-sel" hidden><div class="sh-fill" title="Drag to fill"></div></div>
        <textarea class="sh-editor" hidden spellcheck="false" aria-label="Edit cell"></textarea>
        <ul class="sh-suggest" hidden role="listbox"></ul>
      </div>
      <div class="sh-kanban" hidden></div>
      <aside class="sh-charts" aria-label="Charts" hidden></aside>
    </div>
    <div class="sh-tabs" role="tablist" aria-label="Sheets"></div>`;

  const wrap = host.querySelector('.sh-wrap'), table = host.querySelector('.sh-grid'), selBox = host.querySelector('.sh-sel');
  const editor = host.querySelector('.sh-editor'), fInput = host.querySelector('.sh-input'), aInput = host.querySelector('.sh-addr');
  const suggest = host.querySelector('.sh-suggest'), kanban = host.querySelector('.sh-kanban');

  let text = '', blocks = [], si = 0, ev = null;
  let anchor = [0, 0], focus = [0, 0], editing = null, colSel = false;
  const undo = [], redo = [];
  const docs = perDoc(undo, redo); let seen = false;
  let clip = null;

  const sheets = () => blocks.filter((b) => b.type === 'sheet');
  const sheet = () => sheets()[si];
  const rows = () => sheet().rows;
  const meta = () => (sheet().meta ||= {});
  const raw = (r, c) => rows()[r]?.[c] ?? '';
  function setRaw(r, c, v) { const R = rows(); while (R.length <= r) R.push([]); const row = R[r]; while (row.length <= c) row.push(''); row[c] = v; }
  const range = () => [Math.min(anchor[0], focus[0]), Math.min(anchor[1], focus[1]), Math.max(anchor[0], focus[0]), Math.max(anchor[1], focus[1])];
  const extent = () => { const R = rows(); return [Math.max(R.length + 40, 60), Math.max(14, Math.max(0, ...R.map((r) => r.length)) + 8)]; };
  const fmtOf = (r, c) => meta().cells?.[addr(r, c)]?.format ?? meta().cols?.[colName(c)]?.format ?? '';
  const styleOf = (r, c) => ({ ...(meta().cols?.[colName(c)] || {}), ...(meta().cells?.[addr(r, c)] || {}) });
  const width = (c) => meta().cols?.[colName(c)]?.width || (c === 0 ? 140 : DEFAULT_W);

  /* ---------- io ---------- */
  let external = null, extKey = '', extSeq = 0;
  function load(t) { text = t; blocks = parseWorkbook(t); si = Math.min(si, sheets().length - 1); }
  /** values for {{refs}} in formulas, fetched from other documents; re-renders when they arrive */
  function syncExternals(force = false) {
    const key = formulaRefs(text).join('\n');
    if (!key) { external = null; extKey = ''; return; }
    if (key === extKey && !force) return;
    extKey = key; const n = ++extSeq;
    import('./refs.js').then(({ loadExternals }) => loadExternals(text, { ...ctx.refEnv(), seen: [ctx.getPath()] })).then((m) => { if (n === extSeq) { external = m; render(); } }).catch(() => {});
  }
  function commit({ history = true } = {}) {
    if (history) { undo.push(text); if (undo.length > 200) undo.shift(); redo.length = 0; }
    text = serializeWorkbook(blocks);
    render(); ctx.onChange(text);
  }

  /* ---------- render ---------- */
  function render() {
    syncExternals();
    ev = evaluator(sheet(), { external });
    const [nr, nc] = extent();
    const header = meta().header !== false;
    table.querySelector('colgroup').innerHTML = `<col style="width:46px">${Array.from({ length: nc }, (_, c) => `<col style="width:${width(c)}px">`).join('')}`;
    table.style.width = `${46 + Array.from({ length: nc }, (_, c) => width(c)).reduce((a, b) => a + b, 0)}px`;
    table.querySelector('thead').innerHTML = `<tr><th class="sh-corner" data-all></th>${Array.from({ length: nc }, (_, c) => `<th class="sh-ch" data-col="${c}" scope="col">${colName(c)}<span class="sh-resize" data-resize="${c}"></span></th>`).join('')}</tr>`;
    let body = '';
    for (let r = 0; r < nr; r++) {
      body += `<tr${r === 0 && header ? ' class="sh-head-row"' : ''}><th class="sh-rh" data-row="${r}" scope="row">${r + 1}</th>`;
      for (let c = 0; c < nc; c++) {
        const rv = raw(r, c);
        if (rv === '') { body += '<td></td>'; continue; }
        const v = ev.value(r, c), st = styleOf(r, c);
        const err = ev.isError(v);
        const isNum = typeof v === 'number' && !err;
        const al = st.align || (isNum ? 'right' : '');
        const cls = [al && 'a-' + al, st.bold && 'b', st.italic && 'i', err && 'err', String(rv).startsWith('=') && 'f'].filter(Boolean).join(' ');
        body += `<td${cls ? ` class="${cls}"` : ''}${err ? ` title="${esc(errorHelp(v))}"` : ''}>${esc(display(v, fmtOf(r, c)))}</td>`;
      }
      body += '</tr>';
    }
    table.querySelector('tbody').innerHTML = body;
    renderTabs(); drawSel(); syncToolbar();
    host.querySelector('[data-s="undo"]').disabled = !undo.length;
    host.querySelector('[data-s="redo"]').disabled = !redo.length;
    const isK = meta().view === 'kanban';
    wrap.hidden = isK; kanban.hidden = !isK;
    host.querySelectorAll('[data-sv]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.sv === (isK ? 'kanban' : 'grid'))));
    if (isK) renderKanban();
    renderCharts();
  }
  function rangeValues(range) {
    const [a, b] = range.split(':').map(parseAddr); if (!a || !b) return [];
    const out = [];
    for (let r = a[0]; r <= b[0]; r++) { const row = []; for (let c = a[1]; c <= b[1]; c++) { const v = ev.value(r, c); row.push(ev.isError(v) ? null : v); } out.push(row); }
    return out;
  }
  function renderCharts() {
    const list = meta().charts || [];
    const panel = host.querySelector('.sh-charts');
    panel.hidden = !list.length;
    if (!list.length) { panel.innerHTML = ''; return; }
    panel.innerHTML = `<h3 class="bd-ins-h">Charts</h3>` + list.map((c, i) => `<section class="sh-chart" data-chart="${i}">
      <div class="sh-chart-head"><input class="input" data-ch="title" value="${esc(c.title || '')}" placeholder="Chart title" aria-label="Chart title">
        <select class="select" data-ch="type" aria-label="Chart type">${CHART_TYPES.map(([v, l]) => `<option value="${v}"${(c.type || 'column') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="sh-chart-svg">${chartHtml(rangeValues(c.range), c, { width: 420, height: 260 })}</div>
      <div class="bd-ins-row"><button class="btn btn-quiet" type="button" data-ch-act="select">${esc(c.range)}</button>
        <label class="sf-check"><input type="checkbox" data-ch="stacked"${c.stacked ? ' checked' : ''}> Stacked</label>
        <label class="sf-check"><input type="checkbox" data-ch="rows"${c.by === 'rows' ? ' checked' : ''}> Series in rows</label></div>
      <div class="bd-ins-row"><button class="btn" type="button" data-ch-act="copy">Copy for slides or pages</button><button class="btn" type="button" data-ch-act="delete">Delete</button></div>
    </section>`).join('');
  }
  const errorHelp = (v) => ({ '#DIV/0!': 'Division by zero', '#NAME?': 'Unknown function or name', '#REF!': 'Reference to a cell that does not exist', '#VALUE!': 'Wrong type of value', '#N/A': 'Value not found', '#CYCLE!': 'The formula refers to itself', '#ERROR!': 'The formula could not be read', '#NUM!': 'Invalid number' }[v] || 'Error');
  function cellEl(r, c) { return table.tBodies[0].rows[r]?.cells[c + 1]; }
  function drawSel() {
    const [r0, c0, r1, c1] = range();
    const a = cellEl(r0, c0), b = cellEl(r1, c1);
    if (!a || !b) { selBox.hidden = true; return; }
    selBox.hidden = false;
    Object.assign(selBox.style, { left: `${a.offsetLeft}px`, top: `${a.offsetTop}px`, width: `${b.offsetLeft + b.offsetWidth - a.offsetLeft}px`, height: `${b.offsetTop + b.offsetHeight - a.offsetTop}px` });
    host.querySelectorAll('.sh-ch.on, .sh-rh.on').forEach((x) => x.classList.remove('on'));
    for (let c = c0; c <= c1; c++) table.tHead.rows[0].cells[c + 1]?.classList.add('on');
    for (let r = r0; r <= r1; r++) table.tBodies[0].rows[r]?.cells[0].classList.add('on');
    aInput.value = r0 === r1 && c0 === c1 ? addr(focus[0], focus[1]) : `${addr(r0, c0)}:${addr(r1, c1)}`;
    if (document.activeElement !== fInput) fInput.value = raw(focus[0], focus[1]);
    // status: sum, average, count like Excel
    const nums = []; let count = 0;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { if (raw(r, c) === '') continue; count++; const v = ev.value(r, c); if (typeof v === 'number' && Number.isFinite(v)) nums.push(v); }
    const f = (v) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(v);
    ctx.onStatus?.(count > 1 ? `${nums.length ? `Sum ${f(nums.reduce((s, v) => s + v, 0))}   Average ${f(nums.reduce((s, v) => s + v, 0) / nums.length)}   ` : ''}Count ${count}` : `${sheets().length} ${sheets().length === 1 ? 'sheet' : 'sheets'}, ${rows().length} rows`);
  }
  function scrollIntoView(r, c) {
    const el = cellEl(r, c); if (!el) return;
    const hh = table.tHead.offsetHeight + (meta().header !== false ? (table.tBodies[0].rows[0]?.offsetHeight || 0) : 0);
    if (el.offsetTop - hh < wrap.scrollTop && r > 0) wrap.scrollTop = el.offsetTop - hh;
    if (el.offsetTop + el.offsetHeight > wrap.scrollTop + wrap.clientHeight) wrap.scrollTop = el.offsetTop + el.offsetHeight - wrap.clientHeight;
    if (el.offsetLeft - 46 < wrap.scrollLeft) wrap.scrollLeft = el.offsetLeft - 46;
    if (el.offsetLeft + el.offsetWidth > wrap.scrollLeft + wrap.clientWidth) wrap.scrollLeft = el.offsetLeft + el.offsetWidth - wrap.clientWidth;
  }
  function select(r, c, extend = false) {
    const [nr, nc] = extent();
    r = Math.max(0, Math.min(r, nr - 1)); c = Math.max(0, Math.min(c, nc - 1));
    focus = [r, c]; if (!extend) anchor = [r, c];
    colSel = false; drawSel(); scrollIntoView(r, c); syncToolbar();
  }
  function syncToolbar() {
    const st = styleOf(focus[0], focus[1]);
    host.querySelector('.sh-fmt').value = fmtOf(focus[0], focus[1]);
    host.querySelector('[data-s="bold"]').setAttribute('aria-pressed', String(!!st.bold));
    host.querySelector('[data-s="italic"]').setAttribute('aria-pressed', String(!!st.italic));
    for (const a of ['left', 'center', 'right']) host.querySelector(`[data-s="align-${a}"]`).setAttribute('aria-pressed', String(st.align === a));
  }
  function renderTabs() {
    host.querySelector('.sh-tabs').innerHTML = sheets().map((s, i) => `<button type="button" role="tab" class="sh-tab" data-tab="${i}" aria-selected="${i === si}">${esc(s.name)}</button>`).join('') + `<button type="button" class="rb sh-addtab" data-addtab aria-label="Add sheet" data-tip="Add sheet">${icons.plus}</button>`;
  }

  /* ---------- editing ---------- */
  function startEdit(initial) {
    const [r, c] = focus;
    const el = cellEl(r, c); if (!el) return;
    editing = [r, c];
    editor.hidden = false;
    Object.assign(editor.style, { left: `${el.offsetLeft}px`, top: `${el.offsetTop}px`, minWidth: `${el.offsetWidth}px`, height: `${el.offsetHeight}px` });
    editor.value = initial ?? raw(r, c);
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
    fInput.value = editor.value;
  }
  function endEdit(save, move) {
    if (!editing) return;
    const [r, c] = editing; editing = null;
    editor.hidden = true; suggest.hidden = true;
    if (save && editor.value !== raw(r, c)) { setRaw(r, c, editor.value); commit(); }
    if (move) select(r + move[0], c + move[1]); else drawSel();
    wrap.focus();
  }
  function setRange(fn) {
    const [r0, c0, r1, c1] = range();
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(r, c);
    commit();
  }
  function styleRange(key, value) {
    const [r0, c0, r1, c1] = range();
    const m = meta();
    if (colSel) { m.cols ||= {}; for (let c = c0; c <= c1; c++) { const k = colName(c); m.cols[k] = { ...(m.cols[k] || {}), [key]: value }; if (!value) delete m.cols[k][key]; } }
    else { m.cells ||= {}; for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const k = addr(r, c); m.cells[k] = { ...(m.cells[k] || {}), [key]: value }; if (!value) delete m.cells[k][key]; } }
    commit();
  }

  /* formula autocomplete */
  function updateSuggest() {
    const v = editor.value, pos = editor.selectionStart;
    const m = v.startsWith('=') && v.slice(0, pos).match(/([A-Z]{2,})$/i);
    if (!m) { suggest.hidden = true; return; }
    const list = FUNCS.filter((f) => f.startsWith(m[1].toUpperCase())).slice(0, 8);
    if (!list.length) { suggest.hidden = true; return; }
    suggest.innerHTML = list.map((f, i) => `<li role="option" data-fn="${f}" aria-selected="${i === 0}">${f}</li>`).join('');
    suggest.hidden = false;
    Object.assign(suggest.style, { left: editor.style.left, top: `${parseFloat(editor.style.top) + editor.offsetHeight + 2}px` });
  }
  function applySuggest(fn) {
    const pos = editor.selectionStart, v = editor.value;
    const start = v.slice(0, pos).search(/[A-Z]+$/i);
    editor.value = v.slice(0, start) + fn + '(' + v.slice(pos);
    editor.setSelectionRange(start + fn.length + 1, start + fn.length + 1);
    suggest.hidden = true; fInput.value = editor.value;
  }

  /* ---------- grid events ---------- */
  let dragSel = null, fillDrag = null, resize = null;
  wrap.addEventListener('mousedown', (e) => {
    const rz = e.target.closest('[data-resize]');
    if (rz) { e.preventDefault(); const c = Number(rz.dataset.resize); resize = { c, x: e.clientX, w: width(c) }; return; }
    if (e.target.closest('.sh-fill')) { e.preventDefault(); fillDrag = { to: [...focus] }; return; }
    const td = e.target.closest('td'), th = e.target.closest('th');
    if (editing && td && editor.value.startsWith('=') && /[=(,+\-*/:&<>^ ]$/.test(editor.value.slice(0, editor.selectionStart))) {
      e.preventDefault();
      const r = td.parentElement.rowIndex - 1, c = td.cellIndex - 1;
      const pos = editor.selectionStart;
      editor.value = editor.value.slice(0, pos) + addr(r, c) + editor.value.slice(pos);
      editor.focus(); editor.setSelectionRange(pos + addr(r, c).length, pos + addr(r, c).length);
      fInput.value = editor.value; return;
    }
    if (editing) endEdit(true);
    if (td) { const r = td.parentElement.rowIndex - 1, c = td.cellIndex - 1; select(r, c, e.shiftKey); dragSel = true; }
    else if (th?.dataset.col) { const c = Number(th.dataset.col); anchor = [0, e.shiftKey ? anchor[1] : c]; focus = [Math.max(rows().length - 1, 0), c]; colSel = true; drawSel(); syncToolbar(); }
    else if (th?.dataset.row) { const r = Number(th.dataset.row); anchor = [r, 0]; focus = [r, Math.max(...rows().map((x) => x.length), 1) - 1]; colSel = false; drawSel(); }
    else if (th?.dataset.all !== undefined) { anchor = [0, 0]; focus = [rows().length - 1, Math.max(...rows().map((x) => x.length)) - 1]; drawSel(); }
    wrap.focus();
  });
  document.addEventListener('mousemove', (e) => {
    if (resize) { const w = Math.max(40, resize.w + e.clientX - resize.x); const col = table.querySelectorAll('col')[resize.c + 1]; if (col) col.style.width = `${w}px`; resize.now = w; drawSel(); return; }
    if (!dragSel && !fillDrag) return;
    const td = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.sh-grid td');
    if (!td || !host.contains(td)) return;
    const r = td.parentElement.rowIndex - 1, c = td.cellIndex - 1;
    if (dragSel) { focus = [r, c]; drawSel(); }
    if (fillDrag) {
      fillDrag.to = [r, c];
      const [r0, c0, r1, c1] = range();
      const down = Math.abs(r - r1) >= Math.abs(c - c1);
      const t = down ? [Math.min(r0, r), c0, Math.max(r1, r), c1] : [r0, Math.min(c0, c), r1, Math.max(c1, c)];
      const a = cellEl(t[0], t[1]), b = cellEl(t[2], t[3]);
      if (a && b) Object.assign(selBox.style, { left: `${a.offsetLeft}px`, top: `${a.offsetTop}px`, width: `${b.offsetLeft + b.offsetWidth - a.offsetLeft}px`, height: `${b.offsetTop + b.offsetHeight - a.offsetTop}px` });
      fillDrag.target = t;
    }
  });
  document.addEventListener('mouseup', () => {
    if (resize) { const m = meta(); m.cols ||= {}; const k = colName(resize.c); if (resize.now) { m.cols[k] = { ...(m.cols[k] || {}), width: Math.round(resize.now) }; commit(); } resize = null; }
    if (fillDrag) { const t = fillDrag.target; fillDrag = null; if (t) fill(t); else drawSel(); }
    dragSel = null;
  });
  wrap.addEventListener('dblclick', (e) => { if (e.target.closest('td')) startEdit(); });
  wrap.addEventListener('scroll', () => { if (editing) endEdit(true); });

  function fill(target) {
    const [r0, c0, r1, c1] = range();
    const [t0, u0, t1, u1] = target;
    const h = r1 - r0 + 1, w = c1 - c0 + 1;
    // numeric series when the source is a single column or row of plain numbers
    const series = (cells) => { const n = cells.map(Number); if (cells.length < 2 || cells.some((v) => v === '' || String(v).startsWith('=') || Number.isNaN(Number(v)))) return null; const step = n[1] - n[0]; return n.every((v, i) => i === 0 || Math.abs(v - n[i - 1] - step) < 1e-9) ? [n.at(-1), step] : null; };
    for (let r = t0; r <= t1; r++) for (let c = u0; c <= u1; c++) {
      if (r >= r0 && r <= r1 && c >= c0 && c <= c1) continue;
      const sr = r0 + (((r - r0) % h) + h) % h, sc = c0 + (((c - c0) % w) + w) % w;
      const colCells = Array.from({ length: h }, (_, i) => raw(r0 + i, c)), rowCells = Array.from({ length: w }, (_, i) => raw(r, c0 + i));
      const s = r > r1 || r < r0 ? series(colCells) : series(rowCells);
      if (s) { const k = r > r1 ? r - r1 : r < r0 ? r - r0 : c > c1 ? c - c1 : c - c0; setRaw(r, c, String(Math.round((s[0] + s[1] * k) * 1e10) / 1e10)); continue; }
      setRaw(r, c, shiftFormula(raw(sr, sc), r - sr, c - sc));
    }
    anchor = [t0, u0]; focus = [t1, u1]; commit();
  }

  wrap.addEventListener('keydown', (e) => {
    if (editing) return;
    const m = e.metaKey || e.ctrlKey;
    const [r, c] = focus;
    const nav = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (nav) {
      e.preventDefault();
      if (m) { // jump to the edge of data, like Excel
        let [rr, cc] = [r, c]; const filled = (a, b) => raw(a, b) !== '';
        do { rr += nav[0]; cc += nav[1]; } while (rr > 0 && cc > 0 && rr < rows().length && filled(rr, cc) && filled(rr + nav[0], cc + nav[1]));
        return select(rr, cc, e.shiftKey);
      }
      return select(r + nav[0], c + nav[1], e.shiftKey);
    }
    if (e.key === 'Tab') { e.preventDefault(); return select(r, c + (e.shiftKey ? -1 : 1)); }
    if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) return select(r - 1, c); return startEdit(); }
    if (e.key === 'F2') { e.preventDefault(); return startEdit(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return setRange((a, b) => { if (raw(a, b) !== '') setRaw(a, b, ''); }); }
    if (e.key === 'Home') { e.preventDefault(); return select(m ? 0 : r, 0, e.shiftKey); }
    if (e.key === 'End') { e.preventDefault(); return select(m ? rows().length - 1 : r, Math.max(0, (rows()[r]?.length || 1) - 1), e.shiftKey); }
    if (e.key === 'PageDown') { e.preventDefault(); return select(r + 20, c, e.shiftKey); }
    if (e.key === 'PageUp') { e.preventDefault(); return select(r - 20, c, e.shiftKey); }
    if (m && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? doRedo() : doUndo(); }
    if (m && e.key.toLowerCase() === 'y') { e.preventDefault(); return doRedo(); }
    if (m && e.key.toLowerCase() === 'b') { e.preventDefault(); return styleRange('bold', !styleOf(r, c).bold); }
    if (m && e.key.toLowerCase() === 'i') { e.preventDefault(); return styleRange('italic', !styleOf(r, c).italic); }
    if (m && e.key.toLowerCase() === 'a') { e.preventDefault(); anchor = [0, 0]; focus = [rows().length - 1, Math.max(...rows().map((x) => x.length)) - 1]; return drawSel(); }
    if (m && e.key.toLowerCase() === 'd') { e.preventDefault(); const [r0, c0, r1, c1] = range(); if (r1 > r0) { const keep = [anchor, focus]; anchor = [r0, c0]; focus = [r0, c1]; fill([r0, c0, r1, c1]); [anchor, focus] = keep; drawSel(); } return; }
    if (m && e.key.toLowerCase() === 'r') { e.preventDefault(); const [r0, c0, r1, c1] = range(); if (c1 > c0) { anchor = [r0, c0]; focus = [r1, c0]; fill([r0, c0, r1, c1]); } return; }
    if (e.key.length === 1 && !m && !e.altKey) { e.preventDefault(); startEdit(e.key); updateSuggest(); }
  });
  editor.addEventListener('keydown', (e) => {
    if (!suggest.hidden && (e.key === 'Tab' || e.key === 'Enter') && suggest.querySelector('[aria-selected="true"]')) { e.preventDefault(); return applySuggest(suggest.querySelector('[aria-selected="true"]').dataset.fn); }
    if (!suggest.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault(); const items = [...suggest.children]; const i = items.findIndex((x) => x.getAttribute('aria-selected') === 'true');
      items.forEach((x) => x.setAttribute('aria-selected', 'false')); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].setAttribute('aria-selected', 'true'); return;
    }
    if (e.key === 'Enter' && !e.altKey) { e.preventDefault(); return endEdit(true, e.shiftKey ? [-1, 0] : [1, 0]); }
    if (e.key === 'Enter' && e.altKey) return;
    if (e.key === 'Tab') { e.preventDefault(); return endEdit(true, [0, e.shiftKey ? -1 : 1]); }
    if (e.key === 'Escape') { e.preventDefault(); return endEdit(false); }
  });
  editor.addEventListener('input', () => { fInput.value = editor.value; updateSuggest(); });
  editor.addEventListener('blur', (e) => { if (e.relatedTarget === fInput) return; setTimeout(() => { if (editing && document.activeElement !== editor && document.activeElement !== fInput) endEdit(true); }, 0); });
  suggest.addEventListener('mousedown', (e) => { const li = e.target.closest('[data-fn]'); if (li) { e.preventDefault(); applySuggest(li.dataset.fn); editor.focus(); } });

  fInput.addEventListener('focus', () => { if (!editing) { editing = [...focus]; editor.value = raw(...focus); } });
  fInput.addEventListener('input', () => { editor.value = fInput.value; });
  fInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); editor.value = fInput.value; endEdit(true, [1, 0]); }
    if (e.key === 'Escape') { e.preventDefault(); endEdit(false); }
  });
  fInput.addEventListener('blur', () => { if (editing && editor.hidden) { editor.value = fInput.value; endEdit(true); } });
  aInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return; e.preventDefault();
    const [a, b] = aInput.value.split(':').map(parseAddr);
    if (a) { anchor = a; focus = b || a; drawSel(); scrollIntoView(...focus); wrap.focus(); } else aInput.value = addr(...focus);
  });

  /* clipboard: tab-separated, works with Excel and Google Sheets */
  wrap.addEventListener('copy', (e) => { if (editing) return; e.preventDefault(); copyRange(e.clipboardData); });
  wrap.addEventListener('cut', (e) => { if (editing) return; e.preventDefault(); copyRange(e.clipboardData); setRange((a, b) => setRaw(a, b, '')); });
  wrap.addEventListener('paste', (e) => {
    if (editing) return; e.preventDefault();
    const txt = e.clipboardData.getData('text/plain');
    const [r0, c0] = range();
    if (clip && clip.text === txt) {
      clip.cells.forEach((row, i) => row.forEach((v, j) => setRaw(r0 + i, c0 + j, shiftFormula(v, r0 + i - (clip.r + i), c0 + j - (clip.c + j)))));
      anchor = [r0, c0]; focus = [r0 + clip.cells.length - 1, c0 + clip.cells[0].length - 1];
    } else {
      const grid = txt.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
      grid.forEach((row, i) => row.forEach((v, j) => setRaw(r0 + i, c0 + j, v)));
      anchor = [r0, c0]; focus = [r0 + grid.length - 1, c0 + Math.max(...grid.map((g) => g.length)) - 1];
    }
    commit();
  });
  function copyRange(dt) {
    const [r0, c0, r1, c1] = range();
    const cells = [], vals = [];
    for (let r = r0; r <= r1; r++) { const a = [], b = []; for (let c = c0; c <= c1; c++) { a.push(raw(r, c)); b.push(display(ev.value(r, c), fmtOf(r, c))); } cells.push(a); vals.push(b.join('\t')); }
    const txt = vals.join('\n');
    clip = { text: txt, cells, r: r0, c: c0 };
    dt.setData('text/plain', txt);
  }

  /* ---------- rows, columns, sort ---------- */
  function adjustAll(axis, at, count) {
    for (const row of rows()) for (let c = 0; c < row.length; c++) {
      const v = row[c]; if (!String(v).startsWith('=')) continue;
      row[c] = v.replace(/"[^"]*"|(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\w(])/g, (mm, ca, col, ra, rw) => {
        if (mm.startsWith('"')) return mm;
        let cc = colIndex(col), rr = Number(rw) - 1;
        const idx = axis === 'row' ? rr : cc;
        if (count < 0 && idx >= at && idx < at - count) return '#REF!';
        if (idx >= at) { if (axis === 'row') rr += count; else cc += count; }
        return `${ca}${colName(cc)}${ra}${rr + 1}`;
      });
    }
  }
  function insertRows(at, n = 1) { adjustAll('row', at, n); rows().splice(at, 0, ...Array.from({ length: n }, () => [])); commit(); }
  function deleteRows(at, n = 1) { if (at >= rows().length) return; rows().splice(at, n); adjustAll('row', at, -n); if (!rows().length) rows().push(['']); commit(); select(Math.min(at, rows().length - 1), focus[1]); }
  function insertCols(at, n = 1) { adjustAll('col', at, n); for (const row of rows()) { while (row.length < at) row.push(''); row.splice(at, 0, ...Array(n).fill('')); } commit(); }
  function deleteCols(at, n = 1) { for (const row of rows()) row.splice(at, n); adjustAll('col', at, -n); commit(); }
  function sortBy(c, dir) {
    const header = meta().header !== false ? 1 : 0;
    const body = rows().slice(header).map((row, i) => ({ row, i, v: ev.value(i + header, c) }));
    body.sort((a, b) => {
      const x = a.v, y = b.v;
      if (x === '' || x == null) return 1; if (y === '' || y == null) return -1;
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
      return dir * r;
    });
    const sorted = body.map(({ row, i }, k) => row.map((v) => shiftFormula(v, k - i, 0)));
    sheet().rows = [...rows().slice(0, header), ...sorted];
    commit();
  }
  function insertSum() {
    const [r0, c0, r1, c1] = range();
    const target = r1 + 1;
    for (let c = c0; c <= c1; c++) setRaw(target, c, `=SUM(${addr(r0, c)}:${addr(r1, c)})`);
    anchor = [target, c0]; focus = [target, c1]; commit();
  }

  /* ---------- kanban (Airtable style) ---------- */
  function guessGroup() {
    const R = rows(); const head = R[0] || [];
    const named = head.findIndex((h) => /status|stage|state|stato|fase|phase|category|categoria|priority|priorit/i.test(h));
    if (named > 0) return named;
    let best = -1, bestN = Infinity;
    head.forEach((h, c) => {
      if (c === 0) return;
      const vals = R.slice(1).map((r) => r[c] ?? '').filter((v) => v !== '' && !String(v).startsWith('=') && Number.isNaN(Number(v)));
      const n = new Set(vals).size;
      if (vals.length && n > 1 && n <= 8 && n < bestN) { best = c; bestN = n; }
    });
    return best > 0 ? best : Math.min(1, head.length - 1);
  }
  const groupCol = () => meta().kanbanBy ?? guessGroup();
  function renderKanban() {
    const R = rows(); const head = R[0] || [];
    const by = groupCol();
    const groups = new Map();
    R.slice(1).forEach((row, i) => { if (row.every((v) => v === '')) return; const k = String(display(ev.value(i + 1, by), fmtOf(i + 1, by)) || 'No value'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i + 1); });
    kanban.innerHTML = `<div class="kb-bar"><label class="sf-field"><span>Group by</span><select class="rb-select" data-kb-by>${head.map((h, c) => `<option value="${c}"${c === by ? ' selected' : ''}>${esc(h || colName(c))}</option>`).join('')}</select></label><span class="kb-hint">Drag cards between columns to change “${esc(head[by] || colName(by))}”.</span></div>
      <div class="kb-cols">${[...groups.entries()].map(([k, list]) => `<section class="kb-col" data-group="${esc(k)}"><h3>${esc(k)} <span>${list.length}</span></h3>
        ${list.map((r) => `<article class="kb-card" draggable="true" data-row="${r}" tabindex="0"><h4>${esc(display(ev.value(r, 0), fmtOf(r, 0)) || 'Untitled')}</h4>
          <dl>${head.map((h, c) => (c === 0 || c === by || raw(r, c) === '' ? '' : `<dt>${esc(h || colName(c))}</dt><dd>${esc(display(ev.value(r, c), fmtOf(r, c)))}</dd>`)).join('')}</dl></article>`).join('')}
        <button class="kb-add btn btn-quiet" type="button" data-kb-add="${esc(k)}">${icons.plus} Add</button></section>`).join('')}</div>`;
  }
  kanban.addEventListener('change', (e) => { if (e.target.matches('[data-kb-by]')) { meta().kanbanBy = Number(e.target.value); commit(); } });
  let kbDrag = null;
  kanban.addEventListener('dragstart', (e) => { kbDrag = Number(e.target.closest('[data-row]')?.dataset.row); });
  kanban.addEventListener('dragover', (e) => { if (kbDrag != null && e.target.closest('.kb-col')) e.preventDefault(); });
  kanban.addEventListener('drop', (e) => { const col = e.target.closest('.kb-col'); if (col && kbDrag != null) { e.preventDefault(); const by = groupCol(); setRaw(kbDrag, by, col.dataset.group === 'No value' ? '' : col.dataset.group); kbDrag = null; commit(); } });
  kanban.addEventListener('click', async (e) => {
    const add = e.target.closest('[data-kb-add]');
    if (add) { const name = await ctx.prompt({ title: 'New card', label: rows()[0][0] || 'Title', value: '', action: 'Add', validate: false }); if (!name) return; const by = groupCol(); const r = rows().length; setRaw(r, 0, name); setRaw(r, by, add.dataset.kbAdd === 'No value' ? '' : add.dataset.kbAdd); commit(); }
    const card = e.target.closest('[data-row]');
    if (card && !add) { meta().view = 'grid'; render(); select(Number(card.dataset.row), 0); commit({ history: false }); }
  });

  /* ---------- toolbar ---------- */
  const doUndo = () => { if (!undo.length) return; redo.push(text); load(undo.pop()); render(); ctx.onChange(text); };
  const doRedo = () => { if (!redo.length) return; undo.push(text); load(redo.pop()); render(); ctx.onChange(text); };
  host.querySelector('.sf-toolbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-s],[data-sv]'); if (!b) return;
    const a = b.dataset.s, [r0, c0, r1, c1] = range();
    if (b.dataset.sv) { meta().view = b.dataset.sv === 'kanban' ? 'kanban' : undefined; if (!meta().view) delete meta().view; return commit(); }
    if (a === 'undo') doUndo(); if (a === 'redo') doRedo();
    if (a === 'bold') styleRange('bold', !styleOf(...focus).bold);
    if (a === 'italic') styleRange('italic', !styleOf(...focus).italic);
    if (a?.startsWith('align-')) { const v = a.slice(6); styleRange('align', styleOf(...focus).align === v ? '' : v); }
    if (a === 'sum') insertSum();
    if (a === 'chart') {
      let [r0, c0, r1, c1] = range();
      if (r0 === r1 && c0 === c1) { r0 = 0; c0 = 0; r1 = rows().length - 1; c1 = Math.max(...rows().map((x) => x.length)) - 1; }
      (meta().charts ||= []).push({ type: 'column', title: '', range: `${addr(r0, c0)}:${addr(r1, c1)}` });
      commit();
    }
    if (a === 'insert') ctx.showMenu(b, [{ label: 'Row above', run: () => insertRows(r0, r1 - r0 + 1) }, { label: 'Row below', run: () => insertRows(r1 + 1, r1 - r0 + 1) }, { label: 'Column left', run: () => insertCols(c0, c1 - c0 + 1) }, { label: 'Column right', run: () => insertCols(c1 + 1, c1 - c0 + 1) }]);
    if (a === 'delete') ctx.showMenu(b, [{ label: r1 > r0 ? `Rows ${r0 + 1} to ${r1 + 1}` : `Row ${r0 + 1}`, run: () => deleteRows(r0, r1 - r0 + 1) }, { label: c1 > c0 ? `Columns ${colName(c0)} to ${colName(c1)}` : `Column ${colName(c0)}`, run: () => deleteCols(c0, c1 - c0 + 1) }, '-', { label: 'Clear contents', run: () => setRange((x, y) => setRaw(x, y, '')) }]);
    if (a === 'sort') ctx.showMenu(b, [{ label: `Sort by ${rows()[0]?.[c0] || colName(c0)}, A to Z`, run: () => sortBy(c0, 1) }, { label: `Sort by ${rows()[0]?.[c0] || colName(c0)}, Z to A`, run: () => sortBy(c0, -1) }]);
    if (a === 'export') ctx.showMenu(b, [{ label: 'CSV (this sheet)…', run: exportCsv }, { label: 'Excel workbook (.xlsx)…', run: exportXlsx }]);
  });
  host.querySelector('.sh-fmt').addEventListener('change', (e) => styleRange('format', e.target.value));
  const chartsPanel = host.querySelector('.sh-charts');
  chartsPanel.addEventListener('change', (e) => {
    const box = e.target.closest('[data-chart]'); if (!box) return;
    const c = meta().charts[Number(box.dataset.chart)], k = e.target.dataset.ch;
    if (k === 'type') c.type = e.target.value;
    if (k === 'title') c.title = e.target.value;
    if (k === 'stacked') { if (e.target.checked) c.stacked = true; else delete c.stacked; }
    if (k === 'rows') { if (e.target.checked) c.by = 'rows'; else delete c.by; }
    commit();
  });
  chartsPanel.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ch-act]'); if (!b) return;
    const i = Number(b.closest('[data-chart]').dataset.chart), c = meta().charts[i];
    if (b.dataset.chAct === 'delete') { meta().charts.splice(i, 1); if (!meta().charts.length) delete meta().charts; commit(); }
    if (b.dataset.chAct === 'select') { const [a, z] = c.range.split(':').map(parseAddr); anchor = a; focus = z; drawSel(); wrap.focus(); }
    if (b.dataset.chAct === 'copy') {
      const block = '```chart\n' + specToText({ ...c, source: '/' + ctx.getPath(), sheet: sheet().name }) + '\n```';
      await ctx.copy(block); ctx.toast('Chart copied. Paste it into a page or a slide; it stays linked to this sheet.');
    }
  });

  /* tabs */
  host.querySelector('.sh-tabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { si = Number(t.dataset.tab); anchor = focus = [0, 0]; render(); wrap.focus(); return; }
    if (e.target.closest('[data-addtab]')) {
      let n = sheets().length + 1; while (sheets().some((s) => s.name === `Sheet${n}`)) n++;
      blocks.push({ type: 'sheet', name: `Sheet${n}`, named: true, headingLines: [], rows: [['', '', '']], align: [], meta: {} });
      si = sheets().length - 1; commit();
    }
  });
  host.querySelector('.sh-tabs').addEventListener('dblclick', async (e) => {
    const t = e.target.closest('[data-tab]'); if (!t) return;
    const s = sheets()[Number(t.dataset.tab)];
    const name = await ctx.prompt({ title: 'Rename sheet', label: 'Name', value: s.name, action: 'Rename' });
    if (name) { s.name = name; s.named = true; commit(); }
  });
  host.querySelector('.sh-tabs').addEventListener('contextmenu', (e) => {
    const t = e.target.closest('[data-tab]'); if (!t) return; e.preventDefault();
    const i = Number(t.dataset.tab);
    ctx.showMenu(null, [{ label: 'Rename…', run: () => t.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) }, { label: 'Delete sheet', danger: true, run: async () => {
      if (sheets().length === 1) return ctx.toast('A workbook needs at least one sheet.');
      if (!(await ctx.confirm({ title: `Delete “${sheets()[i].name}”?`, body: 'You can undo this.', action: 'Delete', danger: true }))) return;
      blocks.splice(blocks.indexOf(sheets()[i]), 1); si = Math.max(0, i - 1); commit();
    } }], { x: e.clientX, y: e.clientY });
  });

  wrap.addEventListener('contextmenu', (e) => {
    const td = e.target.closest('td, th'); if (!td) return; e.preventDefault();
    const [r0, c0, r1, c1] = range();
    ctx.showMenu(null, [
      { label: 'Cut', key: 'Mod+X', run: () => document.execCommand('cut') }, { label: 'Copy', key: 'Mod+C', run: () => document.execCommand('copy') }, { label: 'Paste', key: 'Mod+V', run: () => document.execCommand('paste') }, '-',
      { label: 'Insert row above', run: () => insertRows(r0) }, { label: 'Insert column left', run: () => insertCols(c0) },
      { label: 'Delete row', run: () => deleteRows(r0, r1 - r0 + 1) }, { label: 'Delete column', run: () => deleteCols(c0, c1 - c0 + 1) }, '-',
      { label: 'Sort A to Z', run: () => sortBy(c0, 1) }, { label: 'Sort Z to A', run: () => sortBy(c0, -1) }, '-',
      ...(() => {
        const nm = /^[\w-]+$/.test(sheets()[si].name) ? sheets()[si].name : `'${sheets()[si].name}'`;
        const part = `${nm}!${addr(r0, c0)}${r1 > r0 || c1 > c0 ? ':' + addr(r1, c1) : ''}`;
        const one = r1 === r0 && c1 === c0;
        return [one ? { label: 'Copy live value reference', run: () => ctx.copyRef?.(part, 'value') } : { label: 'Copy embed reference', run: () => ctx.copyRef?.(part, 'embed') }, { label: 'Copy link to cells', run: () => ctx.copyRef?.(part, 'link') }];
      })(),
    ], { x: e.clientX, y: e.clientY });
  });

  /* ---------- export ---------- */
  async function exportCsv() {
    const R = rows(); const n = Math.max(...R.map((r) => r.length));
    const q = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const csv = R.map((row, r) => Array.from({ length: n }, (_, c) => q(display(ev.value(r, c), fmtOf(r, c)))).join(',')).join('\n');
    const out = await ctx.saveBinary('csv', new TextEncoder().encode(csv));
    if (out) ctx.toast('Sheet exported as CSV.');
  }
  async function exportXlsx() {
    try {
      const { buildXlsx } = await import('./sheet-xlsx.js');
      const bytes = await buildXlsx(sheets());
      const out = await ctx.saveBinary('xlsx', bytes);
      if (out) ctx.toast('Workbook exported for Excel.');
    } catch (e) { ctx.toast(`Export failed. ${e.message}`, { kind: 'error' }); }
  }

  return {
    setText(t) {
      const moved = docs.bind(ctx.docKey?.()); const had = seen; seen = true; if (t === text) { if (moved) render(); return; }
      if (!moved && had) { undo.push(text); if (undo.length > 200) undo.shift(); redo.length = 0; } // an outside change is its own undo step
      load(t); render();
    },
    setMode() { requestAnimationFrame(drawSel); },
    selectAtLine() {},
    refresh() { syncExternals(true); },
    gotoCell(part) {
      const bang = part.lastIndexOf('!'); const name = bang >= 0 ? part.slice(0, bang).replace(/^'|'$/g, '') : '';
      const cell = (bang >= 0 ? part.slice(bang + 1) : part).split(':')[0];
      const i = name ? sheets().findIndex((s) => s.name.toLowerCase() === name.toLowerCase()) : -1;
      if (i >= 0) si = i;
      const a = parseAddr(cell) || null; render();
      if (a) select(a[0], a[1]); wrap.focus();
    },
    undo: () => doUndo(), redo: () => doRedo(), canUndo: () => undo.length > 0, canRedo: () => redo.length > 0,
    focus() { wrap.focus(); },
  };
}
