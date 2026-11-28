// Folio Sheets — the side panel. One panel at a time, like Excel's task panes: PivotTable fields, Queries, Data model,
// Scripts, Python, What-if, Protection, History… Each panel is a module loaded on first use:
//   export default { title, mount(body, env) → { update?(opts), refresh?(), dispose?(), ...actions } }
//   export const actions = { name(env, ...args) }      work a panel can do without being open (Refresh all, Run macro)
// env = { surface, ctx, icons, opts, close, L }
import { L } from '../i18n.js';

const LOADERS = {
  queries: () => import('./queries.js'), model: () => import('./model.js'), pivot: () => import('./pivot.js'),
  chart: () => import('./chart.js'), slicer: () => import('./slicer.js'), whatif: () => import('./whatif.js'),
  python: () => import('./python.js'), scripts: () => import('./scripts.js'), protect: () => import('./protect.js'),
  history: () => import('./history.js'), audit: () => import('./audit.js'), form: () => import('./form.js'),
  entity: () => import('./entity.js'), cf: () => import('./cf.js'), series: () => import('./series.js'),
  textToCols: () => import('./text-to-cols.js'), print: () => import('./print.js'),
};
export const PANEL_IDS = Object.keys(LOADERS);

export function createPanels({ host, surface, icons, ctx }) {
  const dock = host.querySelector('.xs-dock'), body = host.querySelector('.xs-dock-body'), title = host.querySelector('.xs-dock-title');
  let cur = null, opening = null, selT = 0;
  const mod = async (id) => { if (!LOADERS[id]) throw new Error(`No panel ${id}`); return (await LOADERS[id]()); };

  function close(focusGrid = true) {
    if (!cur) return;
    try { cur.inst?.dispose?.(); } catch { /* a panel that fails to clean up must not keep the dock open */ }
    cur = null; body.replaceChildren(); dock.hidden = true; host.classList.remove('xs-docked');
    if (focusGrid) surface.focusGrid?.();
  }
  async function open(id, opts = {}) {
    if (cur?.id === id) { cur.inst?.update?.(opts); dock.hidden = false; return cur.inst; }
    const token = (opening = {});
    const m = await mod(id);
    if (opening !== token) return null; // another panel was asked for while this one loaded
    close(false);
    const def = m.default;
    title.textContent = L(def.title);
    dock.dataset.panel = id; dock.hidden = false; host.classList.add('xs-docked');
    const env = { surface, ctx, icons, opts, close: () => close(), L, panels: api };
    let inst;
    try { inst = def.mount(body, env) || {}; } catch (e) { body.replaceChildren(); ctx.toast(e.message, { kind: 'error' }); close(); return null; }
    cur = { id, inst };
    requestAnimationFrame(() => (body.querySelector('.xs-tabbody input:not([type=hidden]):not([type=checkbox]), .xs-panel > .field input, .xs-panel > .field select, textarea') || title).focus({ preventScroll: true }));
    return inst;
  }
  const api = {
    open, close,
    current: () => cur?.id || null,
    refresh() { cur?.inst?.refresh?.(); },
    selectionChanged() { clearTimeout(selT); selT = setTimeout(() => cur?.inst?.onSelection?.(), 120); },
    /** run an action of a panel; opens it when the action needs the panel */
    async run(id, action, ...args) {
      const m = await mod(id);
      if (m.actions?.[action]) return m.actions[action]({ surface, ctx, icons, L, panels: api }, ...args);
      const inst = await open(id);
      return inst?.[action]?.(...args);
    },
  };
  dock.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented && !e.target.closest('.cm-editor')) { e.preventDefault(); close(); } });
  surface.__panels = api;
  return api;
}
