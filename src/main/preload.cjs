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
  brokenLinks: (p) => call('fs:broken-links', p),
  saveImage: (note, name, bytes) => call('fs:save-image', note, name, bytes),
  absUrl: (p) => call('fs:abs-url', p),
  pickImage: (note) => call('fs:pick-image', note),
  pickMedia: (note) => call('fs:pick-media', note),
  openExternal: (u) => call('shell:open', u),
  copy: (t) => call('clipboard:write', t),
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
