const { contextBridge, ipcRenderer } = require('electron');

const call = async (channel, ...args) => {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

contextBridge.exposeInMainWorld('tb', {
  init: () => call('tb:init'),
  nav: (action, url) => call('tb:nav', action, url),
  fit: () => call('tb:fit'),
  fill: () => call('tb:fill'),
  answer: () => call('tb:answer'),
  attachCv: () => call('tb:attachCv'),
  save: (status) => call('tb:save', status),
  external: () => call('tb:external'),
  onNav: (fn) => ipcRenderer.on('tb:navigated', (_e, d) => fn(d)),
  onStatus: (fn) => ipcRenderer.on('tb:status', (_e, d) => fn(d))
});
