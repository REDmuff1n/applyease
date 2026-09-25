const { contextBridge, ipcRenderer } = require('electron');

const call = async (channel, ...args) => {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

contextBridge.exposeInMainWorld('api', {
  getState: () => call('state:get'),
  update: (partial) => call('state:update', partial),
  setApiKey: (key) => call('apikey:set', key),
  testApiKey: () => call('apikey:test'),
  checkFit: (text) => call('fit:check', text),
  fetchJob: (url) => call('job:fetch', url),
  coverLetter: (job) => call('letter:generate', job),
  aiFit: (job) => call('fit:ai', job),
  tailorCv: (job) => call('cv:tailor', job),
  saveCvPdf: (cv, job) => call('cv:savePdf', cv, job),
  discover: (opts) => call('jobs:discover', opts),
  pickCv: () => call('cv:pick'),
  importCv: (text) => call('cv:import', text),
  openJob: (url) => call('job:open', url),
  exportCsv: () => call('tracker:export'),
  openDataFolder: () => call('data:openFolder'),
  resetAll: () => call('data:reset'),
  openLink: (url) => call('link:open', url),
  onState: (fn) => ipcRenderer.on('state:changed', (_e, s) => fn(s))
});
