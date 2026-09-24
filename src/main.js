const { app, BrowserWindow, BaseWindow, WebContentsView, ipcMain, dialog, shell, session, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const { checkFit, guessMeta } = require('./fit');
const ai = require('./ai');
const { fillSource, answerSource, infoSource } = require('./autofill');

app.setName('ApplyEase');
if (!app.requestSingleInstanceLock()) app.quit();

let mainWin = null;
const jobWindows = new Map(); // toolbar webContents id -> ctx

const TOOLBAR_H = 96;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'ApplyEase',
    backgroundColor: '#f7f7f5',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWin.on('closed', () => { mainWin = null; });
}

function notifyMain() {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('state:changed', store.publicState());
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function normaliseUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

// ---------- Job browser window (toolbar + website) ----------

function openJobWindow(url) {
  url = normaliseUrl(url);
  const win = new BaseWindow({ width: 1280, height: 900, title: 'ApplyEase — Apply', backgroundColor: '#ffffff' });
  const toolbar = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'toolbar-preload.js'), contextIsolation: true, sandbox: true }
  });
  const site = new WebContentsView({
    webPreferences: { partition: 'persist:jobsites', contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  win.contentView.addChildView(site);
  win.contentView.addChildView(toolbar);

  const layout = () => {
    const { width, height } = win.getContentBounds();
    toolbar.setBounds({ x: 0, y: 0, width, height: TOOLBAR_H });
    site.setBounds({ x: 0, y: TOOLBAR_H, width, height: Math.max(0, height - TOOLBAR_H) });
  };
  layout();
  win.on('resize', layout);

  const ctx = { win, toolbar, site, questions: [], lastFit: null };
  jobWindows.set(toolbar.webContents.id, ctx);

  toolbar.webContents.loadFile(path.join(__dirname, 'renderer', 'toolbar.html'));
  site.webContents.setUserAgent(UA);
  site.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:/.test(u)) site.webContents.loadURL(u);
    return { action: 'deny' };
  });
  const sendNav = () => {
    if (toolbar.webContents.isDestroyed()) return;
    toolbar.webContents.send('tb:navigated', {
      url: site.webContents.getURL(),
      title: site.webContents.getTitle(),
      canBack: site.webContents.navigationHistory.canGoBack(),
      canForward: site.webContents.navigationHistory.canGoForward()
    });
  };
  site.webContents.on('did-navigate', () => { ctx.questions = []; ctx.lastFit = null; sendNav(); });
  site.webContents.on('did-navigate-in-page', sendNav);
  site.webContents.on('page-title-updated', sendNav);
  site.webContents.on('did-fail-load', (_e, code, desc, failedUrl, isMain) => {
    if (isMain && code !== -3) toolbar.webContents.send('tb:status', { kind: 'error', text: `Could not load page (${desc}).` });
  });

  win.on('closed', () => {
    jobWindows.delete(toolbar.webContents.id);
    try { site.webContents.close(); } catch { /* ignore */ }
    try { toolbar.webContents.close(); } catch { /* ignore */ }
  });

  if (url) site.webContents.loadURL(url);
  return ctx;
}

function ctxFor(event) {
  const ctx = jobWindows.get(event.sender.id);
  if (!ctx) throw new Error('Job window not found');
  return ctx;
}

async function runInFrames(ctx, source, args) {
  const frames = ctx.site.webContents.mainFrame.framesInSubtree;
  const code = `(${source})(${args.map((a) => JSON.stringify(a)).join(',')})`;
  const results = [];
  for (const frame of frames) {
    try {
      const r = await frame.executeJavaScript(code);
      results.push({ frame, result: r });
    } catch { /* cross-origin or detached frame: skip */ }
  }
  return results;
}

async function pageInfo(ctx) {
  const r = await ctx.site.webContents.mainFrame.executeJavaScript(`(${infoSource})()`);
  return { ...r, url: ctx.site.webContents.getURL() };
}

async function askSitePermission(ctx, host) {
  const s = store.get().settings;
  if (s.allowedSites.includes(host)) return true;
  const { response } = await dialog.showMessageBox(ctx.win, {
    type: 'question',
    buttons: ['Always allow on this site', 'Allow once', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'Allow form filling?',
    message: `Let ApplyEase fill in forms on ${host}?`,
    detail: 'It will type your saved profile details into the form fields on this page. It never presses Submit — you review everything and send it yourself. You can remove this site any time in Settings.'
  });
  if (response === 0) {
    store.update({ settings: { allowedSites: [...s.allowedSites, host] } });
    notifyMain();
  }
  return response !== 2;
}

// ---------- IPC: main window ----------

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try { return { ok: true, data: await fn(event, ...args) }; } catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
}

handle('state:get', () => store.publicState());
handle('state:update', (_e, partial) => store.update(partial));

handle('apikey:set', async (_e, key) => { store.setApiKey(key); return store.publicState(); });
handle('apikey:test', async () => {
  const key = store.getApiKey();
  if (!key) throw new Error('No API key saved.');
  await ai.testKey(key, store.get().settings.model);
  return true;
});

handle('fit:check', (_e, text) => checkFit(text, store.get()));

handle('job:fetch', async (_e, url) => {
  url = normaliseUrl(url);
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`The site answered ${res.status}. Open it with "Apply" instead, or paste the text.`);
  const html = await res.text();
  const title = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|\/p|\/li|\/h\d|\/div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  const meta = guessMeta(decode(title), text, url);
  return { url, title: decode(title), text: text.slice(0, 20000), ...meta };
});

function decode(s) { return String(s).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim(); }

handle('letter:generate', async (_e, job) => ai.coverLetter(store.get(), store.getApiKey(), job));

handle('cv:pick', async () => {
  const r = await dialog.showOpenDialog(mainWin, {
    title: 'Choose your CV',
    properties: ['openFile'],
    filters: [{ name: 'CV', extensions: ['pdf', 'doc', 'docx'] }]
  });
  if (r.canceled || !r.filePaths[0]) return store.publicState();
  const src = r.filePaths[0];
  const dir = path.join(app.getPath('userData'), 'cv');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, path.basename(src));
  fs.copyFileSync(src, dest);
  return store.update({ profile: { cvPath: dest, cvName: path.basename(src) } });
});

handle('cv:import', async (_e, text) => {
  const fields = await ai.parseCv(store.get(), store.getApiKey(), text);
  return store.update({ profile: fields });
});

handle('job:open', (_e, url) => { openJobWindow(url); return true; });

handle('tracker:export', async () => {
  const jobs = store.get().jobs;
  const r = await dialog.showSaveDialog(mainWin, {
    title: 'Export applications',
    defaultPath: `applications-${new Date().toISOString().slice(0, 10)}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (r.canceled || !r.filePath) return false;
  const cols = ['company', 'role', 'location', 'status', 'dateApplied', 'fit', 'url', 'notes'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...jobs.map((j) => cols.map((c) => esc(j[c])).join(','))].join('\n');
  fs.writeFileSync(r.filePath, '﻿' + csv);
  return r.filePath;
});

handle('data:openFolder', () => shell.openPath(app.getPath('userData')));
handle('data:reset', async () => {
  const { response } = await dialog.showMessageBox(mainWin, {
    type: 'warning', buttons: ['Delete everything', 'Cancel'], defaultId: 1, cancelId: 1,
    message: 'Delete your profile, answers, tracker and settings?', detail: 'This cannot be undone.'
  });
  if (response !== 0) return store.publicState();
  store.reset();
  await session.fromPartition('persist:jobsites').clearStorageData();
  return store.publicState();
});
handle('link:open', (_e, url) => shell.openExternal(normaliseUrl(url)));

// ---------- IPC: job window toolbar ----------

handle('tb:init', (e) => {
  const ctx = ctxFor(e);
  const st = store.get();
  return {
    url: ctx.site.webContents.getURL(),
    aiReady: Boolean(st.settings.aiEnabled && store.getApiKey()),
    hasCv: Boolean(st.profile.cvPath && fs.existsSync(st.profile.cvPath))
  };
});

handle('tb:nav', (e, action, url) => {
  const wc = ctxFor(e).site.webContents;
  if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  else if (action === 'reload') wc.reload();
  else if (action === 'go' && url) wc.loadURL(normaliseUrl(url));
  return true;
});

handle('tb:fit', async (e) => {
  const ctx = ctxFor(e);
  const info = await pageInfo(ctx);
  ctx.lastFit = checkFit(info.text, store.get());
  return ctx.lastFit;
});

handle('tb:fill', async (e) => {
  const ctx = ctxFor(e);
  const url = ctx.site.webContents.getURL();
  const host = hostOf(url);
  if (!host) throw new Error('Open a job application page first.');
  if (!(await askSitePermission(ctx, host))) return { cancelled: true };
  const st = store.get();
  const profile = { ...st.profile };
  delete profile.cvPath;
  const results = await runInFrames(ctx, fillSource, [profile, { overwrite: st.settings.overwriteFilled }]);
  const report = { filled: [], review: [], questions: [], hasFileInput: false };
  ctx.questions = [];
  for (const { frame, result } of results) {
    if (!result) continue;
    report.filled.push(...result.filled);
    report.review.push(...result.review);
    report.hasFileInput ||= result.hasFileInput;
    for (const q of result.questions) {
      ctx.questions.push({ ...q, frame });
      report.questions.push({ id: q.id, label: q.label });
    }
  }
  return report;
});

handle('tb:answer', async (e) => {
  const ctx = ctxFor(e);
  if (!ctx.questions.length) throw new Error('Press "Fill form" first so I can find the open questions.');
  const st = store.get();
  const key = store.getApiKey();
  const info = await pageInfo(ctx);
  const meta = guessMeta(info.title, info.text, info.url);
  const job = { ...meta, text: info.text };
  const letterQs = ctx.questions.filter((q) => q.isCoverLetter);
  const otherQs = ctx.questions.filter((q) => !q.isCoverLetter);
  const answers = [];
  if (letterQs.length) {
    const { text } = await ai.coverLetter(st, key, job);
    letterQs.forEach((q) => answers.push({ id: q.id, answer: text }));
  }
  if (otherQs.length) answers.push(...(await ai.answerQuestions(st, key, job, otherQs.map(({ frame, ...q }) => q))));
  let count = 0;
  for (const q of ctx.questions) {
    const mine = answers.filter((a) => a.id === q.id);
    if (!mine.length) continue;
    try { count += await q.frame.executeJavaScript(`(${answerSource})(${JSON.stringify(mine)})`); } catch { /* frame gone */ }
  }
  return { count, total: ctx.questions.length, usedAi: Boolean(st.settings.aiEnabled && key) };
});

handle('tb:attachCv', async (e) => {
  const ctx = ctxFor(e);
  const cvPath = store.get().profile.cvPath;
  if (!cvPath || !fs.existsSync(cvPath)) throw new Error('Add your CV in the Profile tab first.');
  const host = hostOf(ctx.site.webContents.getURL());
  if (!(await askSitePermission(ctx, host))) return { cancelled: true };
  const mark = `(() => { const f = Array.from(document.querySelectorAll('input[type=file]'));
    const d = (el) => ((el.closest('label')?.innerText || '') + ' ' + (el.name || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.parentElement?.innerText || '')).toLowerCase();
    f.forEach((x) => x.removeAttribute('data-applyease-file'));
    const cv = f.find((x) => /resume|cv|curriculum/.test(d(x))) || f[0];
    if (cv) cv.setAttribute('data-applyease-file', '1');
    return !!cv; })()`;
  let found = false;
  for (const frame of ctx.site.webContents.mainFrame.framesInSubtree) {
    try { if (!found && (await frame.executeJavaScript(mark))) found = true; } catch { /* skip */ }
  }
  if (!found) throw new Error('No file upload field found on this page.');
  const dbg = ctx.site.webContents.debugger;
  const wasAttached = dbg.isAttached();
  if (!wasAttached) dbg.attach('1.3');
  try {
    await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
    const { searchId, resultCount } = await dbg.sendCommand('DOM.performSearch', { query: 'input[data-applyease-file]', includeUserAgentShadowDOM: false });
    if (!resultCount) throw new Error('The upload field is inside a protected frame — please attach your CV by hand.');
    const { nodeIds } = await dbg.sendCommand('DOM.getSearchResults', { searchId, fromIndex: 0, toIndex: resultCount });
    await dbg.sendCommand('DOM.setFileInputFiles', { files: [cvPath], nodeId: nodeIds[0] });
    await dbg.sendCommand('DOM.discardSearchResults', { searchId });
  } finally {
    if (!wasAttached) dbg.detach();
  }
  return { file: path.basename(cvPath) };
});

handle('tb:save', async (e, status) => {
  const ctx = ctxFor(e);
  const info = await pageInfo(ctx);
  const st = store.get();
  const meta = guessMeta(info.title, info.text, info.url);
  if (info.h1 && !meta.role) meta.role = info.h1.slice(0, 120);
  if (info.site) meta.company = info.site;
  const fit = ctx.lastFit || checkFit(info.text, st);
  const existing = st.jobs.find((j) => j.url === info.url);
  const today = new Date().toISOString().slice(0, 10);
  let jobs;
  if (existing) {
    jobs = st.jobs.map((j) => (j.url === info.url ? { ...j, status: status || j.status, dateApplied: status === 'Applied' ? today : j.dateApplied } : j));
  } else {
    jobs = [{
      id: Date.now().toString(36),
      company: meta.company, role: meta.role, location: '',
      url: info.url, status: status || 'Applied',
      dateApplied: status === 'Saved' ? '' : today,
      fit: fit.score, notes: ''
    }, ...st.jobs];
  }
  store.update({ jobs });
  notifyMain();
  return { company: meta.company, role: meta.role, updated: Boolean(existing) };
});

// ---------- App lifecycle ----------

app.whenReady().then(() => {
  store.load();
  const jobSession = session.fromPartition('persist:jobsites');
  // Websites opened inside ApplyEase never get camera, mic, location or notifications.
  jobSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'));
  jobSession.setUserAgent(UA);

  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Open data folder', click: () => shell.openPath(app.getPath('userData')) }] }
  ]));

  createMainWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createMainWindow(); });
});

app.on('second-instance', () => {
  if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// test hook: lets the automated test drive the app without clicking
if (process.env.APPLYEASE_TEST) {
  module.exports = { openJobWindow, store, jobWindows };
  global.__applyease = module.exports;
}
