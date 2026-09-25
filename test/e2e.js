// End-to-end test: launches the real app against a local fake job form.
// Run: npx electron test/e2e.js   (use xvfb-run on a headless Linux box)
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

process.env.APPLYEASE_TEST = '1';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'applyease-'));
app.setPath('userData', tmp);
const shots = process.env.SHOTS_DIR;

const cv = path.join(tmp, 'Test_CV.pdf');
fs.writeFileSync(cv, '%PDF-1.4 test');
fs.writeFileSync(path.join(tmp, 'applyease-data.json'), JSON.stringify({
  profile: {
    firstName: 'Arian', lastName: 'Aowsaf', email: 'arian@example.com', phone: '+36 30 123 4567',
    city: 'Budapest', country: 'Bangladesh', linkedin: 'https://linkedin.com/in/example',
    university: 'Corvinus University of Budapest', degree: 'BSc', major: 'International Business',
    skills: 'Excel, financial modelling, Python', languages: 'English C1, Bengali native, Hungarian A1',
    startDate: 'Immediately', howHeard: 'LinkedIn', workAuth: 'Yes', needsSponsorship: 'No', cvPath: cv, cvName: 'Test_CV.pdf',
    preferredName: 'Ari', relocate: 'No',
    summary: 'Feature writer at a national newspaper; freelance designer for 20+ clients.'
  },
  answers: [{ q: 'Why do you want to work here', a: 'Because I want hands-on experience in financial analysis.' }],
  preferences: { targetRoles: 'analyst, finance', locations: 'Budapest, Remote', avoidKeywords: '', paidOnly: true },
  settings: { allowedSites: ['127.0.0.1'] },
  jobs: [
    { id: 'a1', company: 'Wise', role: 'Business Analyst Intern', status: 'Interview', dateApplied: '2026-09-20', fit: 82, url: 'https://example.com', notes: 'Call on Monday' },
    { id: 'a2', company: 'BlackRock', role: 'Finance Intern', status: 'Applied', dateApplied: '2026-09-22', fit: 74, url: 'https://example.com', notes: '' },
    { id: 'a3', company: 'Morgan Stanley', role: 'IB Summer Analyst', status: 'Saved', dateApplied: '', fit: 58, url: 'https://example.com', notes: '' }
  ],
  onboarded: true
}));

const server = http.createServer((req, res) => {
  if (req.url === '/frame.html') {
    res.end('<!doctype html><body style="font-family:sans-serif"><label for="c">City</label><input id="c"><label for="z">Postal code</label><input id="z"></body>');
  } else {
    res.setHeader('content-type', 'text/html');
    res.end(fs.readFileSync(path.join(__dirname, 'form.html')));
  }
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function snap(wc, name) {
  if (!shots) return;
  const img = await wc.capturePage();
  fs.writeFileSync(path.join(shots, name), img.toPNG());
}

require('../src/main.js');

app.whenReady().then(async () => {
  try {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}/apply`;
    await wait(1500);
    const main = BrowserWindow.getAllWindows()[0];
    for (const tab of ['home', 'profile', 'find', 'check', 'tracker', 'settings']) {
      await main.webContents.executeJavaScript(`document.querySelector('[data-tab=${tab}]').click()`);
      await wait(300);
      await snap(main.webContents, `main-${tab}.png`);
    }

    const { openJobWindow, store } = global.__applyease;
    const ctx = openJobWindow(url);
    await new Promise((r) => ctx.site.webContents.once('did-finish-load', r));
    await wait(800);
    const tb = (code) => ctx.toolbar.webContents.executeJavaScript(code);

    const fit = await tb('tb.fit()');
    console.log('fit', fit.score, fit.verdict);
    assert(fit.score >= 70, 'fake listing should be a strong fit');

    const rep = await tb('tb.fill()');
    console.log('fill report', JSON.stringify(rep));
    const v = (sel) => ctx.site.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(sel)}).value`);
    assert.strictEqual(await v('#fn'), 'Arian');
    assert.strictEqual(await v('#ln'), 'Aowsaf');
    assert.strictEqual(await v('[name=email]'), 'arian@example.com');
    assert.strictEqual(await v('#ph'), '+36 30 123 4567');
    assert.strictEqual(await v('[name="urls[LinkedIn]"]'), 'https://linkedin.com/in/example');
    assert.strictEqual(await v('#co'), 'bd');
    assert.strictEqual(await v('#uni'), 'Corvinus University of Budapest');
    assert.strictEqual(await v('#st'), 'Immediately');
    assert.strictEqual(await v('#hear'), 'LinkedIn');
    assert.strictEqual(await v('#ref'), '', 'employer name must not get the applicant name');
    assert.strictEqual(await v('#vis'), 'No');
    assert.strictEqual(await v('#pref'), 'Ari', 'preferred name');
    assert.strictEqual(await v('#gen'), 'Decline To Self Identify', '"Prefer not to say" picks the decline option');
    assert.strictEqual(await ctx.site.webContents.executeJavaScript('document.querySelector("[name=reloc]:checked")?.value'), '0', 'relocate radio = No');
    assert.strictEqual(rep.questions.length, 2, 'two open questions');
    const frame = ctx.site.webContents.mainFrame.frames[0];
    assert.strictEqual(await frame.executeJavaScript('document.querySelector("#c").value'), 'Budapest', 'iframe field filled');

    const att = await tb('tb.attachCv()');
    assert.strictEqual(att.file, 'Test_CV.pdf');
    assert.strictEqual(await ctx.site.webContents.executeJavaScript('document.querySelector("#cvf").files[0]?.name'), 'Test_CV.pdf');

    const ans = await tb('tb.answer()');
    console.log('answers', JSON.stringify(ans));
    assert.strictEqual(await v('#why'), 'Because I want hands-on experience in financial analysis.');
    const letter = await v('#cl');
    assert(letter.includes('Acme') && letter.includes('Arian Aowsaf'), 'cover letter from template: ' + letter.slice(0, 120));

    await tb(`document.getElementById('status').textContent = 'Filled 11 fields (green) · CV attached · 2 answers written (blue). Read them, then press Submit.'; document.getElementById('status').className='ok'`);
    await wait(300);
    await snap(ctx.toolbar.webContents, 'job-toolbar.png');
    await snap(ctx.site.webContents, 'job-site.png');

    const saved = await tb('tb.save("Applied")');
    console.log('saved', JSON.stringify(saved));
    const jobs = store.get().jobs;
    assert.strictEqual(jobs.length, 4);
    assert.strictEqual(jobs[0].status, 'Applied');
    assert.strictEqual(jobs[0].company, 'Acme Capital', 'company from JSON-LD');
    assert.strictEqual(jobs[0].location, 'Budapest, Hungary', 'location from JSON-LD');

    const title = await ctx.site.webContents.executeJavaScript('document.title');
    assert.notStrictEqual(title, 'SUBMITTED', 'app must never submit');
    console.log('E2E PASSED');
    app.exit(0);
  } catch (e) {
    console.error('E2E FAILED', e);
    app.exit(1);
  }
});
