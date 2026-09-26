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
app.setPath('documents', tmp); // batch output goes to Documents/ApplyEase
const shots = process.env.SHOTS_DIR;

// A cached Live jobs list (the real feeds aren't called in tests).
const hoursAgo = (h) => new Date(Date.now() - h * 36e5).toISOString();
fs.writeFileSync(path.join(tmp, 'live-jobs.json'), JSON.stringify({
  fetchedAt: hoursAgo(0.2), lastViewedAt: hoursAgo(5),
  status: { arbeitnow: { ok: true, count: 3 }, jsearch: { ok: false, error: 'add your RapidAPI key in Settings' } },
  jobs: [
    { id: 'an-1', source: 'arbeitnow', role: 'Finance Intern', company: 'Deutsche Bank', location: 'Remote', url: 'https://example.com/an-1', posted: hoursAgo(2), firstSeen: hoursAgo(1), text: 'Paid internship. Excel. Fluent English.' },
    { id: 'an-2', source: 'arbeitnow', role: 'Junior Financial Analyst', company: 'OTP Bank', location: 'Budapest', url: 'https://example.com/an-2', posted: hoursAgo(30), firstSeen: hoursAgo(20), text: 'Entry-level analyst, salary in HUF.' },
    { id: 'an-3', source: 'arbeitnow', role: 'Senior Backend Engineer', company: 'Other', location: 'Berlin', url: 'https://example.com/an-3', posted: hoursAgo(3), firstSeen: hoursAgo(1), text: '7+ years of experience.' },
    // 30 older matching jobs, to test the pages
    ...Array.from({ length: 30 }, (_, i) => ({ id: 'bd-' + i, source: 'boards', role: `Finance Analyst ${i + 1}`, company: 'Bosch', location: 'Budapest, HU', url: `https://example.com/bd-${i}`, posted: hoursAgo(48 + i), firstSeen: hoursAgo(10), text: 'Finance analyst role in Budapest.' }))
  ]
}));

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
  feeds: { jsearch: true },
  jobs: [
    { id: 'a1', company: 'Wise', role: 'Business Analyst Intern', status: 'Interview', dateApplied: '2026-09-20', fit: 82, url: 'https://example.com', notes: 'Call on Monday' },
    { id: 'a2', company: 'BlackRock', role: 'Finance Intern', status: 'Applied', dateApplied: '2026-09-22', fit: 74, url: 'https://example.com', notes: '' },
    { id: 'a3', company: 'Morgan Stanley', role: 'IB Summer Analyst', status: 'Saved', dateApplied: '', fit: 58, url: 'https://example.com', notes: '' }
  ],
  onboarded: true
}));

// Fake OpenAI-compatible AI server, standing in for Ollama / DeepSeek / etc.
const LETTER = 'Dear Acme Capital team,\n\nI built Excel models for 20+ clients as a freelance designer. ' + 'I study International Business at Corvinus and want to support your analyst team. '.repeat(8) + '\n\nArian Aowsaf';
function fakeAi(body) {
  const p = body.messages.map((m) => m.content).join('\n');
  if (p.includes('Score how well')) return '{"score": 8, "matches": ["Excel"], "gaps": ["No Hungarian"], "keywords": ["modelling"], "reasoning": "Strong student fit."}';
  if (p.includes('Rewrite the applicant')) return '{"headline":"Finance Intern","summary":"International Business student who builds Excel models.","skills":["Excel","Python"],"sections":[{"title":"Experience","items":[{"heading":"Freelance designer","sub":"Budapest","bullets":["Delivered work for 20+ clients"]}]}]}';
  if (p.includes('QUESTIONS')) {
    const qs = JSON.parse(p.slice(p.indexOf('[', p.indexOf('QUESTIONS')), p.lastIndexOf(']') + 1));
    return JSON.stringify(qs.map((q) => ({ id: q.id, answer: 'Because I want hands-on experience in financial analysis.' })));
  }
  return LETTER;
}

const server = http.createServer((req, res) => {
  if (req.url === '/v1/chat/completions') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: fakeAi(JSON.parse(raw)) } }] }));
    });
  } else if (req.url === '/frame.html') {
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
    const ui = (code) => main.webContents.executeJavaScript(code);

    // Live jobs: badge counts new jobs matching the preferences; filters work.
    assert.strictEqual(await ui('document.querySelector("#liveCount").textContent'), '1', 'one new matching job (the senior one does not match)');
    await ui(`document.querySelector('[data-tab=live]').click()`);
    await wait(400);
    const rows = () => ui('document.querySelectorAll("#liveList tbody tr").length');
    assert.strictEqual(await rows(), 20, 'page 1 shows 20 of the 32 matching jobs (the senior Berlin one does not match)');
    assert(await ui('document.querySelector("#liveList").innerText.includes("Showing 1–20 of 32 jobs")'));
    await ui('document.querySelector("[data-page=\\"1\\"]").click()');
    assert.strictEqual(await rows(), 12, 'page 2 shows the other 12');
    assert(await ui('document.querySelector("#liveList").innerText.includes("Showing 21–32 of 32 jobs")'));
    assert(await ui('document.querySelector(".pager button:last-child").disabled'), 'Next is disabled on the last page');
    assert(await ui('+document.querySelector("#liveList .pill").textContent > 50'), 'fit uses title and place too');
    assert(await ui('document.body.innerText.includes("add your RapidAPI key")'), 'source problems shown');
    await ui(`(() => { const s = document.querySelector('#liveAge'); s.value = '1'; s.dispatchEvent(new Event('change')); })()`);
    await wait(100);
    assert.strictEqual(await rows(), 1, 'last 24 hours (and back to page 1)');
    assert.strictEqual(await ui('document.querySelectorAll(".pager").length'), 0, 'no pager for a single page');
    const pick = (id, value) => ui(`(() => { const s = document.querySelector('#${id}'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change')); })()`);
    const listText = () => ui('document.querySelector("#liveList").innerText');
    await ui('document.querySelector("#liveReset").click()');
    await pick('liveType', 'internship');
    assert.strictEqual(await rows(), 1, 'job type: internship');
    assert((await listText()).includes('Finance Intern'));
    await pick('liveType', 'any');
    await pick('livePlace', 'remote');
    assert.strictEqual(await rows(), 1, 'location: remote open to Europe');
    await pick('livePlace', 'any');
    await ui(`(() => { const i = document.querySelector('#liveExclude'); i.value = 'analyst'; i.dispatchEvent(new Event('input')); })()`);
    assert.strictEqual(await rows(), 1, 'hide titles with "analyst"');
    await ui('document.querySelector("#liveShowAll").click()');
    await wait(50);
    assert((await listText()).includes('Showing 1–20 of 33 jobs · page 1 of 2'), 'Show all jobs: ' + (await listText()).slice(0, 80));
    const places = await ui('[...document.querySelectorAll("#livePlace option")].map((o) => o.value)');
    assert(places.includes('city:Budapest') && places.includes('city:Berlin'), 'cities offered: ' + places);
    assert(places.includes('country:Hungary') && places.includes('country:Germany'), 'countries offered: ' + places);
    assert.deepStrictEqual(await ui('[...document.querySelectorAll("#livePlace optgroup")].map((g) => g.label)'), ['Countries', 'Cities']);
    await pick('livePlace', 'country:Germany');
    assert.strictEqual(await rows(), 1, 'country: Germany (the Berlin job)');
    await pick('livePlace', 'city:Budapest');
    assert((await listText()).includes('of 31 jobs'), 'city: Budapest');
    await pick('livePlace', 'any');
    const typeRoles = (text) => ui(`(() => { const i = document.querySelector('#liveRolesText'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input')); })()`);
    await typeRoles('backend');
    assert.strictEqual(await rows(), 1, 'typing target roles filters straight away (and ticks "Only my target roles")');
    assert(await ui('document.querySelector("#liveRoles").checked'));
    await wait(1200); // preferences are saved 0.4 s after the last change
    assert.strictEqual(global.__applyease.store.get().preferences.targetRoles, 'backend', 'target roles saved');
    assert.strictEqual(global.__applyease.store.get().preferences.liveFilters.roles, true, 'filters remembered');
    await typeRoles('analyst, finance');
    await wait(1200);
    await ui('document.querySelector("#liveReset").click()');
    await snap(main.webContents, 'main-live.png');

    const { openJobWindow, store } = global.__applyease;
    // AI through an OpenAI-compatible server (what Ollama, DeepSeek, Groq… use)
    store.update({ settings: { aiEnabled: true, aiProvider: 'custom', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fake-model' } });
    for (const tab of ['home', 'profile', 'check', 'settings']) {
      await ui(`document.querySelector('[data-tab=${tab}]').click()`);
      await wait(300);
      await snap(main.webContents, `main-${tab}.png`);
    }
    assert.strictEqual(await ui('document.querySelector("#liveCount").textContent'), '', 'leaving Live jobs marks them seen');
    assert.strictEqual(await ui('document.querySelectorAll("[data-tab=find]").length'), 0, 'Find jobs merged into Live jobs');
    assert(await ui('!!document.querySelector("#boardsSource #boards") && !!document.querySelector("#saveBoards")'), 'company boards are edited in Settings');
    await ui('api.testApiKey()');

    // Batch: score + tailor + letter for a saved job
    store.update({ jobs: [{ id: 'b1', company: 'Acme Capital', role: 'Junior Financial Analyst Intern', status: 'Saved', url, fit: '', notes: '' }, ...store.get().jobs] });
    const sum = await ui(`api.batchRun({ ids: ['b1'], aiScore: true, tailor: true, letter: true, minScore: 7 })`);
    console.log('batch', JSON.stringify(sum));
    const b1 = store.get().jobs.find((j) => j.id === 'b1');
    assert.strictEqual(b1.aiScore, 8);
    assert(fs.existsSync(b1.cvPdf) && fs.readFileSync(b1.cvPdf).subarray(0, 5).toString() === '%PDF-', 'tailored PDF written');
    assert(b1.cvPdf.startsWith(path.join(tmp, 'ApplyEase')), b1.cvPdf);
    assert.strictEqual(fs.readFileSync(b1.letterFile, 'utf8'), LETTER);
    await ui(`document.querySelector('[data-tab=tracker]').click()`);
    await wait(300);
    assert(await ui('!!document.querySelector("tr[data-id=b1] .folder")'), 'folder button shown');
    assert.strictEqual(b1.notes || '', '', 'no false alarms from the CV check (e.g. the phone number)');
    await snap(main.webContents, 'main-tracker.png');

    const ctx = openJobWindow(url);
    await new Promise((r) => ctx.site.webContents.once('did-finish-load', r));
    await wait(800);
    const tb = (code) => ctx.toolbar.webContents.executeJavaScript(code);

    // Sign-in pages check the browser: one consistent Chrome version, no "Electron", no passkey pop-up on load
    const ua = await ctx.site.webContents.executeJavaScript('navigator.userAgent');
    assert(ua.includes(`Chrome/${process.versions.chrome.split('.')[0]}.0.0.0`) && !/Electron|applyease/i.test(ua), ua);
    assert(await ctx.site.webContents.executeJavaScript('!/native code/.test(String(navigator.credentials.get))'), 'passkey autofill request is handled');
    assert.strictEqual(await ctx.site.webContents.executeJavaScript('typeof require'), 'undefined', 'websites get nothing from the app');
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
    assert.strictEqual(att.tailored, true, 'the tailored CV from the batch is attached');
    assert.strictEqual(att.file, 'Arian_Aowsaf_CV.pdf');
    assert.strictEqual(await ctx.site.webContents.executeJavaScript('document.querySelector("#cvf").files[0]?.name'), 'Arian_Aowsaf_CV.pdf');

    const ans = await tb('tb.answer()');
    console.log('answers', JSON.stringify(ans));
    assert.strictEqual(await v('#why'), 'Because I want hands-on experience in financial analysis.');
    const letter = await v('#cl');
    assert.strictEqual(letter, LETTER, 'the letter the batch wrote is reused');
    assert.strictEqual(ans.usedAi, true);

    await tb(`document.getElementById('status').textContent = 'Filled 11 fields (green) · CV attached · 2 answers written (blue). Read them, then press Submit.'; document.getElementById('status').className='ok'`);
    await wait(300);
    await snap(ctx.toolbar.webContents, 'job-toolbar.png');
    await snap(ctx.site.webContents, 'job-site.png');

    const saved = await tb('tb.save("Applied")');
    console.log('saved', JSON.stringify(saved));
    const jobs = store.get().jobs;
    assert.strictEqual(jobs.length, 4, 'existing tracker entry updated, not duplicated');
    assert.strictEqual(saved.updated, true);
    assert.strictEqual(jobs.find((j) => j.id === 'b1').status, 'Applied');
    assert.strictEqual(saved.company, 'Acme Capital', 'company from JSON-LD');
    assert.strictEqual(saved.location, 'Budapest, Hungary', 'location from JSON-LD');

    const title = await ctx.site.webContents.executeJavaScript('document.title');
    assert.notStrictEqual(title, 'SUBMITTED', 'app must never submit');
    console.log('E2E PASSED');
    app.exit(0);
  } catch (e) {
    console.error('E2E FAILED', e);
    app.exit(1);
  }
});
