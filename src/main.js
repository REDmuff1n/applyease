const { app, BrowserWindow, BaseWindow, WebContentsView, ipcMain, dialog, shell, session, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const { checkFit, guessMeta } = require('./fit');
const ai = require('./ai');
const { fillSource, answerSource, infoSource } = require('./autofill');
const { extractJobPosting, fromPosting, htmlToText, jobText } = require('./jobdata');
const { discover } = require('./discover');
const { checkWriting } = require('./quality');
const llm = require('./llm');
const feeds = require('./feeds');
const { matchJob, prefsOf } = require('./match');

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

// Company, role, location and a clean text for the job on the current page.
function jobFromInfo(info) {
  const posting = fromPosting(info.posting);
  const meta = guessMeta(info.title, info.text, info.url);
  if (info.h1 && !meta.role) meta.role = info.h1.slice(0, 120);
  if (info.site) meta.company = info.site;
  return {
    url: info.url,
    company: posting?.company || meta.company,
    role: posting?.role || meta.role,
    location: posting?.location || '',
    text: posting ? jobText(posting, info.text) : info.text
  };
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

// The AI settings as the ai module needs them, or null when AI is off / not set up.
function aiConfig() {
  const s = store.get().settings;
  if (!store.publicState().settings.aiReady) return null;
  return { provider: s.aiProvider, model: s.model, baseUrl: s.baseUrl, apiKey: store.getApiKey() };
}
// Same, but for Test / model list buttons that work before AI is switched on.
function aiConfigDraft() {
  const s = store.get().settings;
  return { provider: s.aiProvider, model: s.model, baseUrl: s.baseUrl, apiKey: store.getApiKey(), timeoutMs: 60000 };
}

handle('ai:providers', () => Object.fromEntries(Object.entries(llm.PROVIDERS).map(([id, p]) => [id, { ...p, needsKey: llm.needsKey(id) }])));
handle('apikey:set', async (_e, key) => { store.setApiKey(key); return store.publicState(); });
handle('apikey:test', async () => { await ai.testKey(aiConfigDraft()); return true; });
handle('ai:models', async () => llm.listModels(aiConfigDraft()));
handle('secret:set', async (_e, name, value) => {
  if (!/^feed:[a-z]+$/.test(name)) throw new Error('Unknown key');
  store.setSecret(name, value);
  return store.publicState();
});

handle('fit:check', (_e, text) => checkFit(text, store.get()));

handle('job:fetch', (_e, url) => fetchJobPage(url));

async function fetchJobPage(url) {
  url = normaliseUrl(url);
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`The site answered ${res.status}. Open it with "Apply" instead, or paste the text.`);
  const html = await res.text();
  const title = htmlToText((html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '');
  const posting = extractJobPosting(html);
  const text = htmlToText(html);
  const meta = guessMeta(title, text, url);
  if (posting) {
    // Structured JobPosting data: clean description, exact company and title.
    return { url, title, company: posting.company || meta.company, role: posting.role || meta.role, location: posting.location, text: jobText(posting, text).slice(0, 20000), structured: true };
  }
  return { url, title, text: text.slice(0, 20000), ...meta };
}

handle('letter:generate', async (_e, job) => ai.coverLetter(store.get(), aiConfig(), job));
handle('fit:ai', async (_e, job) => ai.aiFit(store.get(), aiConfig(), job));
handle('cv:tailor', async (_e, job) => ai.tailorCv(store.get(), aiConfig(), job));

const safeName = (s) => String(s || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_');

async function writeCvPdf(cv, filePath) {
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(cvHtml(cv)));
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'custom', top: 0.5, bottom: 0.5, left: 0.6, right: 0.6 } });
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, pdf);
  } finally { win.destroy(); }
  return filePath;
}

handle('cv:savePdf', async (_e, cv, job) => {
  const r = await dialog.showSaveDialog(mainWin, {
    title: 'Save tailored CV',
    defaultPath: path.join(app.getPath('documents'), `${safeName(cv.name) || 'CV'}_${safeName(job?.company) || 'tailored'}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (r.canceled || !r.filePath) return false;
  await writeCvPdf(cv, r.filePath);
  shell.openPath(r.filePath);
  return r.filePath;
});

function cvHtml(cv) {
  const e = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sections = (cv.sections || []).map((s) => `<h2>${e(s.title)}</h2>${(s.items || []).map((it) => `
    <div class="item"><div class="ih"><b>${e(it.heading)}</b><span>${e(it.sub)}</span></div>
    ${it.bullets?.length ? `<ul>${it.bullets.map((b) => `<li>${e(b)}</li>`).join('')}</ul>` : ''}</div>`).join('')}`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:10.5pt;color:#111;line-height:1.32;margin:0}
    h1{font-size:20pt;margin:0}.contact{color:#444;margin:2px 0 6px}.headline{font-weight:600;margin-bottom:6px}
    h2{font-size:11pt;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #999;margin:10px 0 4px;padding-bottom:1px}
    .item{margin-bottom:5px}.ih{display:flex;justify-content:space-between;gap:12px}.ih span{color:#444;white-space:nowrap}
    ul{margin:2px 0 0 16px;padding:0}li{margin:1px 0}p{margin:0}
  </style></head><body>
    <h1>${e(cv.name)}</h1><div class="contact">${e(cv.contact)}</div>
    ${cv.headline ? `<div class="headline">${e(cv.headline)}</div>` : ''}
    ${cv.summary ? `<h2>Summary</h2><p>${e(cv.summary)}</p>` : ''}
    ${cv.skills?.length ? `<h2>Skills</h2><p>${cv.skills.map(e).join(' · ')}</p>` : ''}
    ${sections}
  </body></html>`;
}

handle('jobs:discover', async (_e, opts) => {
  const st = store.get();
  if (opts && typeof opts.boards === 'string') store.update({ preferences: { boards: opts.boards } });
  return discover(st, { boards: opts?.boards ?? st.preferences.boards, keywords: opts?.keywords, locations: opts?.locations });
});

// ---------- Live jobs dashboard ----------
// Cached in its own file so the main data file stays small.

let liveCache = null;
let liveBusy = null;
const liveFile = () => path.join(app.getPath('userData'), 'live-jobs.json');

function loadLive() {
  if (liveCache) return liveCache;
  try { liveCache = JSON.parse(fs.readFileSync(liveFile(), 'utf8')); } catch { liveCache = { jobs: [], status: {}, lastViewedAt: '' }; }
  return liveCache;
}

function saveLive() {
  const tmp = liveFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(liveCache));
  fs.renameSync(tmp, liveFile());
}

// What the dashboard shows: every cached job with its fit score, without the long text.
function liveView() {
  const st = store.get();
  const c = loadLive();
  const prefs = prefsOf(st);
  return {
    fetchedAt: c.fetchedAt || '',
    lastViewedAt: c.lastViewedAt || '',
    refreshing: Boolean(liveBusy),
    status: c.status || {},
    sources: Object.fromEntries(Object.entries(feeds.SOURCES).map(([id, s]) => [id, { label: s.label, about: s.about, key: s.key || '', keyUrl: s.keyUrl || '', enabled: Boolean(st.feeds[id]) }])),
    links: feeds.boardSearchLinks(st.preferences, 1),
    jobs: c.jobs.map(({ text, ...j }) => {
      const f = liveFit(j, text, st);
      return { ...j, fit: f.score, verdict: f.verdict, mine: matchJob(j, prefs) };
    })
  };
}

// Fit scores are remembered per job and only worked out again when the profile or
// preferences change, so opening or refreshing the dashboard never freezes the app.
const fitMemo = { key: '', scores: new Map() };
function liveFit(j, text, st) {
  const key = JSON.stringify([st.profile.skills, st.profile.languages, st.preferences]);
  if (key !== fitMemo.key) { fitMemo.key = key; fitMemo.scores.clear(); }
  const id = `${j.id}|${j.url}`;
  let f = fitMemo.scores.get(id);
  if (!f) {
    // title, company and place count too: some feeds only send a short description
    f = checkFit(`Job title: ${j.role}\nCompany: ${j.company}\nLocation: ${j.location}\n${(j.tags || []).join(', ')}\n\n${text || ''}`, st);
    fitMemo.scores.set(id, { score: f.score, verdict: f.verdict });
  }
  return f;
}

function refreshLive(force) {
  if (liveBusy) return liveBusy;
  const st = store.get();
  const keys = Object.fromEntries(Object.values(feeds.SOURCES).filter((s) => s.key).map((s) => [s.key, store.getSecret(s.key)]));
  liveBusy = feeds.refresh(st, loadLive(), { keys, force })
    .then((c) => { liveCache = c; saveLive(); })
    .finally(() => { liveBusy = null; if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('live:changed'); });
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('live:changed');
  return liveBusy;
}

let liveTimer = null;
function scheduleLive() {
  clearInterval(liveTimer);
  const mins = Number(store.get().feeds.autoRefreshMins) || 0;
  if (mins > 0) liveTimer = setInterval(() => refreshLive(false).catch(() => {}), mins * 60000);
}

handle('live:get', () => liveView());
handle('live:refresh', async (_e, force) => { await refreshLive(Boolean(force)); return liveView(); });
handle('live:markSeen', () => { loadLive().lastViewedAt = new Date().toISOString(); saveLive(); return true; });
handle('live:job', (_e, id) => loadLive().jobs.find((j) => j.id === id) || null);
handle('live:reschedule', () => { scheduleLive(); return true; });

// ---------- Batch: score and tailor saved jobs ----------

let batch = null; // { cancel: boolean }

function sendBatch(p) { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('batch:progress', p); }

function updateJob(id, patch) {
  store.update({ jobs: store.get().jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) });
  notifyMain();
}

async function jobTextFor(job) {
  if (job.text && job.text.length > 200) return job.text;
  const live = loadLive().jobs.find((j) => j.url === job.url);
  if (live?.text?.length > 200) return live.text;
  const page = await fetchJobPage(job.url);
  return page.text;
}

handle('batch:run', async (_e, opts) => {
  if (batch) throw new Error('A batch is already running.');
  const cfg = aiConfig();
  const o = { ...store.get().settings.batch, ...(opts || {}) };
  store.update({ settings: { batch: o } });
  if ((o.aiScore || o.tailor || o.letter) && !cfg) throw new Error('Turn on AI in Settings to score and tailor.');
  const ids = opts?.ids?.length ? opts.ids : store.get().jobs.filter((j) => j.status === 'Saved' && j.url).map((j) => j.id);
  batch = { cancel: false };
  const summary = { done: 0, total: ids.length, tailored: 0, skipped: 0, errors: [] };
  const outRoot = path.join(app.getPath('documents'), 'ApplyEase');
  try {
    for (const id of ids) {
      if (batch.cancel) break;
      const job = store.get().jobs.find((j) => j.id === id);
      if (!job) continue;
      const name = `${job.role || 'Role'} at ${job.company || 'company'}`;
      try {
        sendBatch({ ...summary, step: `Reading ${name}` });
        const text = await jobTextFor(job);
        if (!text || text.length < 150) throw new Error('could not read the job description');
        const st = store.get();
        const full = { url: job.url, company: job.company, role: job.role, text };
        const patch = { fit: checkFit(text, st).score, text: text.slice(0, 6000) };
        if (o.aiScore && cfg) {
          sendBatch({ ...summary, step: `Scoring ${name}` });
          const s = await ai.aiFit(st, cfg, full);
          Object.assign(patch, { aiScore: s.score, aiReason: [s.reasoning, s.gaps.length && 'Gaps: ' + s.gaps.join(', ')].filter(Boolean).join(' ') });
        }
        const good = patch.aiScore != null ? patch.aiScore >= Number(o.minScore || 0) : patch.fit >= 60;
        if ((o.tailor || o.letter) && cfg && good && !batch.cancel) {
          const folder = path.join(outRoot, safeName(`${job.company || 'Company'} - ${job.role || 'Role'}`).slice(0, 90));
          patch.folder = folder;
          if (o.tailor) {
            sendBatch({ ...summary, step: `Tailoring CV for ${name}` });
            const t = await ai.tailorCv(st, cfg, full);
            patch.cvPdf = await writeCvPdf(t.cv, path.join(folder, `${safeName(t.cv.name) || 'CV'}_CV.pdf`));
            if (t.issues.length) patch.notes = [job.notes, 'CV check: ' + t.issues.join('; ')].filter(Boolean).join(' | ');
          }
          if (o.letter) {
            sendBatch({ ...summary, step: `Writing cover letter for ${name}` });
            const l = await ai.coverLetter(st, cfg, full);
            patch.letterFile = path.join(folder, 'Cover letter.txt');
            fs.mkdirSync(folder, { recursive: true });
            fs.writeFileSync(patch.letterFile, l.text);
          }
          summary.tailored++;
        } else if (o.tailor || o.letter) {
          summary.skipped++;
        }
        updateJob(id, patch);
      } catch (e) {
        summary.errors.push(`${name}: ${e.message}`);
      }
      summary.done++;
      sendBatch({ ...summary, step: '' });
    }
  } finally {
    const cancelled = batch.cancel;
    batch = null;
    sendBatch({ ...summary, finished: true, cancelled });
  }
  return summary;
});
handle('batch:cancel', () => { if (batch) batch.cancel = true; return true; });
handle('path:open', (_e, p) => {
  // only files ApplyEase wrote itself
  const job = store.get().jobs.find((j) => j.folder === p || j.cvPdf === p || j.letterFile === p);
  if (!job) throw new Error('Unknown file');
  return shell.openPath(p);
});

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
  const fields = await ai.parseCv(store.get(), aiConfig(), text);
  return store.update({ profile: { ...fields, cvText: String(text).slice(0, 30000) } });
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
  liveCache = { jobs: [], status: {}, lastViewedAt: '' };
  saveLive();
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
    aiReady: Boolean(aiConfig()),
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
  ctx.lastFit = checkFit(jobFromInfo(info).text, store.get());
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
  delete profile.cvText;
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
  const cfg = aiConfig();
  const job = jobFromInfo(await pageInfo(ctx));
  const letterQs = ctx.questions.filter((q) => q.isCoverLetter);
  const otherQs = ctx.questions.filter((q) => !q.isCoverLetter);
  const answers = [];
  if (letterQs.length) {
    // A letter the batch already wrote for this job wins over a new one.
    const saved = trackedJob(job.url)?.letterFile;
    const text = saved && fs.existsSync(saved) ? fs.readFileSync(saved, 'utf8') : (await ai.coverLetter(st, cfg, job)).text;
    letterQs.forEach((q) => answers.push({ id: q.id, answer: text }));
  }
  if (otherQs.length) answers.push(...(await ai.answerQuestions(st, cfg, job, otherQs.map(({ frame, ...q }) => q))));
  let count = 0;
  for (const q of ctx.questions) {
    const mine = answers.filter((a) => a.id === q.id);
    if (!mine.length) continue;
    try { count += await q.frame.executeJavaScript(`(${answerSource})(${JSON.stringify(mine)})`); } catch { /* frame gone */ }
  }
  const usedAi = Boolean(cfg);
  const warnings = usedAi ? answers.flatMap((a) => checkWriting(a.answer).issues) : [];
  return { count, total: ctx.questions.length, usedAi, warnings: [...new Set(warnings)] };
});

// The tracker entry for the job on this page (apply pages often add /apply or a query).
function trackedJob(url) {
  const bare = (u) => String(u || '').split(/[?#]/)[0].replace(/\/(apply|application)\/?$/i, '').replace(/\/+$/, '').toLowerCase();
  const b = bare(url);
  if (!b) return null;
  return store.get().jobs.find((j) => j.url && (bare(j.url) === b || b.startsWith(bare(j.url) + '/'))) || null;
}

handle('tb:attachCv', async (e) => {
  const ctx = ctxFor(e);
  const tailored = trackedJob(ctx.site.webContents.getURL())?.cvPdf;
  const cvPath = tailored && fs.existsSync(tailored) ? tailored : store.get().profile.cvPath;
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
  return { file: path.basename(cvPath), tailored: cvPath === tailored };
});

handle('tb:save', async (e, status) => {
  const ctx = ctxFor(e);
  const info = await pageInfo(ctx);
  const st = store.get();
  const meta = jobFromInfo(info);
  const fit = ctx.lastFit || checkFit(meta.text, st);
  const existing = st.jobs.find((j) => j.url === info.url);
  const today = new Date().toISOString().slice(0, 10);
  let jobs;
  if (existing) {
    jobs = st.jobs.map((j) => (j.url === info.url ? { ...j, status: status || j.status, dateApplied: status === 'Applied' ? today : j.dateApplied } : j));
  } else {
    jobs = [{
      id: Date.now().toString(36),
      company: meta.company, role: meta.role, location: meta.location || '',
      url: info.url, status: status || 'Applied',
      dateApplied: status === 'Saved' ? '' : today,
      fit: fit.score, notes: ''
    }, ...st.jobs];
  }
  store.update({ jobs });
  notifyMain();
  return { company: meta.company, role: meta.role, location: meta.location, updated: Boolean(existing) };
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
  // Fresh jobs every time the app opens, then every N minutes while it's open.
  if (!process.env.APPLYEASE_TEST) {
    mainWin.webContents.once('did-finish-load', () => refreshLive(true).catch(() => {}));
    scheduleLive();
  }
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
