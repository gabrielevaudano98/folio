// Folio — preload. The renderer's only door to the system.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = async (ch, ...a) => {
  const r = await ipcRenderer.invoke(ch, ...a);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const on = (ch) => (fn) => {
  const l = (_e, d) => fn(d);
  ipcRenderer.on(ch, l);
  return () => ipcRenderer.removeListener(ch, l);
};

contextBridge.exposeInMainWorld('folio', {
  init: () => call('app:init'),
  setSettings: (p) => call('settings:set', p),
  chooseWorkspace: () => call('workspace:choose'),
  openWorkspace: (d) => call('workspace:open', d),
  closeWorkspace: () => call('workspace:close'),
  reveal: (rel) => call('workspace:reveal', rel),
  tree: () => call('fs:tree'),
  list: () => call('fs:list'),
  read: (p) => call('fs:read', p),
  write: (p, c) => call('fs:write', p, c),
  create: (p, c) => call('fs:create', p, c),
  mkdir: (p) => call('fs:mkdir', p),
  rename: (a, b) => call('fs:rename', a, b),
  trash: (p) => call('fs:trash', p),
  search: (q, o) => call('fs:search', q, o),
  backlinks: (p) => call('fs:backlinks', p),
  userName: () => call('app:user-name'),
  unlinked: (p) => call('fs:unlinked', p),
  brokenLinks: (p) => call('fs:broken-links', p),
  saveImage: (note, name, bytes) => call('fs:save-image', note, name, bytes),
  absUrl: (p) => call('fs:abs-url', p),
  pickImage: (note) => call('fs:pick-image', note),
  pickMedia: (note, kind) => call('fs:pick-media', note, kind),
  assetsSync: (note, before, after) => call('assets:sync', note, before, after),
  assetsRestore: (paths) => call('assets:restore', paths),
  assetsHeal: (note, text) => call('assets:heal', note, text),
  assetsRemove: (paths, permanent) => call('assets:remove', paths, permanent),
  assetsUsage: () => call('assets:usage'),
  assetsMigrate: () => call('assets:migrate'),
  openFile: (rel) => call('shell:open-file', rel),
  fetchTemplate: (url) => call('templates:fetch', url),
  importTemplateFiles: () => call('templates:import-files'),
  openExternal: (u) => call('shell:open', u),
  copy: (t) => call('clipboard:write', t),
  historyList: (p) => call('history:list', p),
  historyGet: (p, id) => call('history:get', p, id),
  historySnapshot: (p, text, reason, force) => call('history:snapshot', p, text, reason, force),
  historyName: (p, id, label, note) => call('history:name', p, id, label, note),
  historyDeleted: () => call('history:deleted'),
  historyClear: (p) => call('history:clear', p),
  readClipboard: () => call('clipboard:read'),
  importDocument: () => call('import:document'),
  exportHtml: (p, html) => call('export:html', p, html),
  exportPdf: (p, html, o) => call('export:pdf', p, html, o),
  exportBinary: (p, ext, bytes) => call('export:binary', p, ext, bytes),
  dataUrl: (src, note) => call('fs:data-url', src, note),
  mcpStatus: () => call('mcp:status'),
  mcpToken: () => call('mcp:token'),
  rotateToken: () => call('mcp:rotate-token'),
  connections: () => call('connections:list'),
  install: (id) => call('connections:install', id),
  uninstall: (id) => call('connections:remove', id),
  pathForFile: (f) => webUtils.getPathForFile(f),
  answer: (id, value) => ipcRenderer.send('ai:answer', { id, value }),
  closeOk: () => ipcRenderer.send('app:close-ok'),
  onTreeChanged: on('fs:tree-changed'),
  onFileChanged: on('fs:file-changed'),
  onAiEdit: on('ai:edit'),
  onAiMove: on('ai:move'),
  onAiAsk: on('ai:ask'),
  onAiActivity: on('ai:activity'),
  onMenu: on('menu:command'),
  onTheme: on('theme:changed'),
  onSwitched: on('workspace:switched'),
  onBeforeClose: on('app:before-close'),
});
