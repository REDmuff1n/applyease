/* global api */
let S = null; // current state
let tab = 'home';
let checkResult = null; // { job, fit, letter }

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

async function safe(fn) {
  try { return await fn(); } catch (e) { toast(e.message); return undefined; }
}

let saveTimer;
function saveSoon(partial) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => { S = await api.update(partial()); updateCounts(); }, 400);
}

function go(t) {
  tab = t;
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  render();
  $('main').scrollTop = 0;
}

function updateCounts() {
  $('#trackerCount').textContent = S.jobs.length || '';
}

function render() {
  const view = $('#view');
  view.innerHTML = PAGES[tab]();
  (BIND[tab] || (() => {}))(view);
  updateCounts();
}

// ---------------- Home ----------------

function setupSteps() {
  const p = S.profile;
  return [
    { done: Boolean(p.firstName && p.email && p.phone), text: 'Add your name, email and phone', tab: 'profile' },
    { done: Boolean(p.university && p.degree), text: 'Add your studies', tab: 'profile' },
    { done: Boolean(p.cvPath), text: 'Upload your CV (PDF)', tab: 'profile' },
    { done: S.answers.filter((a) => a.a).length >= 2, text: 'Write at least two saved answers', tab: 'answers' },
    { done: Boolean(S.preferences.targetRoles && S.preferences.locations), text: 'Set the roles and places you want', tab: 'check' },
    { done: S.settings.hasApiKey && S.settings.aiEnabled, text: 'Optional: turn on Claude for tailored letters', tab: 'settings' }
  ];
}

const PAGES = {};
const BIND = {};

PAGES.home = () => {
  const jobs = S.jobs;
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const applied = jobs.filter((j) => j.status !== 'Saved').length;
  const thisWeek = jobs.filter((j) => j.dateApplied && j.dateApplied >= weekAgo).length;
  const interviews = jobs.filter((j) => j.status === 'Interview' || j.status === 'Offer').length;
  const saved = jobs.filter((j) => j.status === 'Saved').length;
  const steps = setupSteps();
  const left = steps.filter((s) => !s.done).length;
  const name = S.profile.firstName ? `Hi ${esc(S.profile.firstName)}` : 'Welcome to ApplyEase';
  return `<div class="page">
    <div class="page-head"><h1>${name}</h1><p>Set up your profile once. Then every application is: open, fill, check, submit.</p></div>
    <div class="card">
      <h2>Apply to a job</h2>
      <p class="muted small">Paste a link to the job or its application form. It opens in an ApplyEase window with the fill buttons on top.</p>
      <div class="apply-bar"><input id="applyUrl" placeholder="https://jobs.lever.co/company/…" spellcheck="false"><button class="primary" id="applyGo">Open &amp; apply</button><button id="checkGo">Check fit first</button></div>
    </div>
    <div class="stats">
      <div class="stat"><b>${applied}</b><span>Applications sent</span></div>
      <div class="stat"><b>${thisWeek}</b><span>In the last 7 days</span></div>
      <div class="stat"><b>${interviews}</b><span>Interviews &amp; offers</span></div>
      <div class="stat"><b>${saved}</b><span>Saved for later</span></div>
    </div>
    ${left ? `<div class="card"><h2>Finish setup <span class="pill">${steps.length - left}/${steps.length}</span></h2>
      <ul class="checklist">${steps.map((s) => `<li class="${s.done ? 'done' : ''}"><span class="dot">${s.done ? '✓' : ''}</span>${esc(s.text)}${s.done ? '' : `<button data-go="${s.tab}">Go</button>`}</li>`).join('')}</ul></div>` : ''}
    <div class="card"><h2>How it works</h2>
      <div class="steps">
        <div><b>Fill form</b><br><span class="muted">Your details go into the fields. Green = filled.</span></div>
        <div><b>Attach CV</b><br><span class="muted">Your saved CV is uploaded into the file field.</span></div>
        <div><b>Write answers</b><br><span class="muted">Open questions and cover letter boxes get drafts. Blue = written.</span></div>
        <div><b>You submit</b><br><span class="muted">Read it over, press the site's Submit, then Mark applied.</span></div>
      </div>
      <p class="small muted" style="margin-top:12px">The first time you fill a form on a new website, ApplyEase asks your permission for that site.</p>
    </div>
  </div>`;
};
BIND.home = (v) => {
  const open = () => { const u = $('#applyUrl', v).value.trim(); if (!u) return toast('Paste a job link first'); safe(() => api.openJob(u)); };
  $('#applyGo', v).onclick = open;
  $('#applyUrl', v).onkeydown = (e) => { if (e.key === 'Enter') open(); };
  $('#checkGo', v).onclick = () => { const u = $('#applyUrl', v).value.trim(); go('check'); if (u) { $('#jobUrl').value = u; $('#fetchBtn').click(); } };
  $$('[data-go]', v).forEach((b) => { b.onclick = () => go(b.dataset.go); });
};

// ---------------- Profile ----------------

const PROFILE_SECTIONS = [
  ['Personal', [
    ['firstName', 'First name'], ['lastName', 'Last name'], ['preferredName', 'Preferred name (optional)'], ['email', 'Email for applications'], ['phone', 'Phone (with country code)'],
    ['address', 'Street address'], ['city', 'City'], ['region', 'State / province / region'], ['postcode', 'Postcode'], ['country', 'Country'],
    ['linkedin', 'LinkedIn URL'], ['github', 'GitHub URL (optional)'], ['website', 'Portfolio / website'], ['pronouns', 'Pronouns (optional)']
  ]],
  ['Education', [
    ['university', 'University'], ['degree', 'Degree (e.g. BSc)'], ['major', 'Field of study'], ['gradYear', 'Graduation year'], ['gpa', 'GPA / average (optional)']
  ]],
  ['About you', [
    ['headline', 'One-line headline', 'wide'], ['summary', 'Experience summary (a few lines)', 'wide', 'textarea'],
    ['skills', 'Skills (comma separated)', 'wide'], ['languages', 'Languages you speak (e.g. English C1, Hungarian A1)', 'wide'],
    ['yearsExperience', 'Years of work experience (e.g. "1")']
  ]],
  ['Standard form answers', [
    ['workAuth', 'Allowed to work in this country? (e.g. "Yes")'], ['needsSponsorship', 'Need visa sponsorship? (e.g. "No")'],
    ['startDate', 'When can you start?'], ['salary', 'Expected pay'], ['howHeard', 'How did you hear about us?'],
    ['relocate', 'Willing to relocate? (e.g. "No")'], ['over18', 'Are you 18 or older?']
  ]],
  ['Voluntary questions (diversity / EEO)', [
    ['gender', 'Gender'], ['ethnicity', 'Race / ethnicity'], ['veteran', 'Veteran status'], ['disability', 'Disability status']
  ], 'These are optional on every form. "Prefer not to say" picks the closest decline option on each site.']
];

PAGES.profile = () => {
  const p = S.profile;
  const field = ([k, label, cls, type]) => `<div class="${cls || ''}"><label for="p_${k}">${esc(label)}</label>${type === 'textarea'
    ? `<textarea id="p_${k}" data-k="${k}" rows="4">${esc(p[k])}</textarea>`
    : `<input id="p_${k}" data-k="${k}" value="${esc(p[k])}">`}</div>`;
  return `<div class="page">
    <div class="page-head"><h1>Profile &amp; CV</h1><p>Filled into application forms. Saves as you type.</p></div>
    <div class="card"><h2>Your CV</h2>
      <div class="row"><span>${p.cvName ? `📄 <b>${esc(p.cvName)}</b>` : '<span class="muted">No CV added yet</span>'}</span><span class="spacer"></span><button id="pickCv" class="${p.cvName ? '' : 'primary'}">${p.cvName ? 'Replace' : 'Choose CV file'}</button></div>
      <details style="margin-top:12px"><summary>Fill this profile from my CV text (uses Claude)</summary>
        <p class="small muted" style="margin-top:8px">Open your CV, copy all the text, paste it here. Needs a Claude API key in Settings.</p>
        <textarea id="cvText" rows="6" placeholder="Paste CV text…"></textarea>
        <div class="row" style="margin-top:8px"><button id="importCv" class="primary">Fill profile from CV</button></div>
      </details>
      <div style="margin-top:12px"><label for="p_cvText">CV text: used to tailor your CV for each job. Paste the full text of your CV.</label>
        <textarea id="p_cvText" data-k="cvText" rows="6" placeholder="Paste your whole CV here…">${esc(p.cvText)}</textarea></div>
    </div>
    ${PROFILE_SECTIONS.map(([title, fields, note]) => `<div class="card"><h2>${title}</h2>${note ? `<p class="small muted">${esc(note)}</p>` : ''}<div class="grid">${fields.map(field).join('')}</div></div>`).join('')}
  </div>`;
};
BIND.profile = (v) => {
  $$('[data-k]', v).forEach((el) => {
    el.oninput = () => {
      S.profile[el.dataset.k] = el.value;
      saveSoon(() => ({ profile: collectProfile(v) }));
    };
  });
  $('#pickCv', v).onclick = () => safe(async () => { S = await api.pickCv(); render(); });
  $('#importCv', v).onclick = () => safe(async () => {
    const t = $('#cvText', v).value.trim();
    if (t.length < 100) return toast('Paste the full CV text first');
    $('#importCv', v).disabled = true; $('#importCv', v).textContent = 'Reading CV…';
    try { S = await api.importCv(t); render(); toast('Profile filled — check each field'); } finally { const b = $('#importCv'); if (b) { b.disabled = false; b.textContent = 'Fill profile from CV'; } }
  });
};
function collectProfile(v) {
  const out = {};
  $$('[data-k]', v).forEach((el) => { out[el.dataset.k] = el.value; });
  return out;
}

// ---------------- Answers ----------------

PAGES.answers = () => `<div class="page">
  <div class="page-head"><h1>Saved answers</h1><p>Reused for open questions on forms. With Claude on, they guide tailored answers instead.</p></div>
  <div class="card"><h2>Cover letter base</h2>
    <p class="small muted">Write your usual letter. Use <code>{company}</code>, <code>{role}</code> and <code>{name}</code> — they're swapped in for each job.</p>
    <textarea id="clBase" rows="10" placeholder="Dear Hiring Team at {company},&#10;&#10;I am applying for the {role} position…">${esc(S.profile.coverLetterBase)}</textarea>
  </div>
  <div class="card"><h2>Common questions</h2>
    <div id="qaList">${S.answers.map((a, i) => `<div class="qa" data-i="${i}">
      <input class="q" value="${esc(a.q)}" placeholder="Question or topic">
      <textarea class="a" rows="3" placeholder="Your answer">${esc(a.a)}</textarea>
      <button class="ghost danger del" title="Remove">✕</button></div>`).join('')}</div>
    <div class="row" style="margin-top:10px"><button id="addQa">+ Add question</button></div>
  </div>
</div>`;
BIND.answers = (v) => {
  const collect = () => $$('.qa', v).map((r) => ({ q: $('.q', r).value, a: $('.a', r).value }));
  $('#clBase', v).oninput = (e) => { S.profile.coverLetterBase = e.target.value; saveSoon(() => ({ profile: { coverLetterBase: S.profile.coverLetterBase } })); };
  $$('.q, .a', v).forEach((el) => { el.oninput = () => { S.answers = collect(); saveSoon(() => ({ answers: S.answers })); }; });
  $$('.del', v).forEach((b) => { b.onclick = async () => { const i = +b.closest('.qa').dataset.i; S.answers.splice(i, 1); S = await api.update({ answers: S.answers }); render(); }; });
  $('#addQa', v).onclick = async () => { S.answers.push({ q: '', a: '' }); S = await api.update({ answers: S.answers }); render(); $$('.qa .q').pop().focus(); };
};

// ---------------- Check a job ----------------

PAGES.check = () => {
  const r = checkResult;
  const pr = S.preferences;
  const cls = r ? (r.fit.score >= 70 ? 'good' : r.fit.score >= 45 ? 'warn' : 'bad') : '';
  return `<div class="page">
    <div class="page-head"><h1>Check a job</h1><p>See if a listing fits before you spend time on it, and get a cover letter.</p></div>
    <div class="card">
      <label for="jobUrl">Job link</label>
      <div class="apply-bar"><input id="jobUrl" value="${esc(r?.job.url || '')}" placeholder="https://…" spellcheck="false"><button id="fetchBtn">Load</button></div>
      <p class="small muted" style="margin:8px 0 4px">…or paste the job description (works for LinkedIn and sites that need a login)</p>
      <textarea id="jobText" rows="6" placeholder="Paste the full job description">${esc(r?.job.text || '')}</textarea>
      <div class="grid" style="margin-top:10px"><div><label>Company</label><input id="jobCompany" value="${esc(r?.job.company || '')}"></div><div><label>Role</label><input id="jobRole" value="${esc(r?.job.role || '')}"></div></div>
      <div class="row" style="margin-top:12px"><button id="checkBtn" class="primary">Check fit</button></div>
    </div>
    ${r ? `<div class="card"><div class="fit"><div class="score ${cls}">${r.fit.score}</div><div style="flex:1">
      <h2>${esc(r.fit.verdict)}</h2>
      <ul class="reasons">${r.fit.good.map((x) => `<li class="g">${esc(x)}</li>`).join('')}${r.fit.warn.map((x) => `<li class="w">${esc(x)}</li>`).join('')}${r.fit.bad.map((x) => `<li class="b">${esc(x)}</li>`).join('')}</ul>
      <div class="row" style="margin-top:14px">${r.job.url ? '<button id="openApply" class="primary">Open &amp; apply</button>' : ''}<button id="saveLater">Save to tracker</button><button id="makeLetter">${r.letter ? 'Rewrite' : 'Write'} cover letter</button>
        <button id="aiScore" ${aiReady() ? '' : 'disabled title="Turn on Claude in Settings"'}>${r.ai ? 'Re-score' : 'AI score'}</button>
        <button id="tailor" ${aiReady() ? '' : 'disabled title="Turn on Claude in Settings"'}>${r.tailored ? 'Re-tailor' : 'Tailor my CV'}</button></div>
    </div></div></div>` : ''}
    ${r?.ai ? `<div class="card"><div class="fit"><div class="score ${r.ai.score >= 7 ? 'good' : r.ai.score >= 5 ? 'warn' : 'bad'}">${r.ai.score}<small>/10</small></div><div style="flex:1">
      <h2>AI score <span class="pill">Claude</span></h2><p>${esc(r.ai.reasoning)}</p>
      <ul class="reasons">${r.ai.matches.map((x) => `<li class="g">${esc(x)}</li>`).join('')}${r.ai.gaps.map((x) => `<li class="b">${esc(x)}</li>`).join('')}</ul>
      ${r.ai.keywords.length ? `<p class="small muted" style="margin-top:8px">Words from the ad to mirror in your CV: ${r.ai.keywords.map(esc).join(', ')}</p>` : ''}
    </div></div></div>` : ''}
    ${r?.letter ? `<div class="card"><div class="row"><h2 style="margin:0">Cover letter</h2><span class="pill">${r.letterSource === 'claude' ? 'Written by Claude' : 'From your template'}</span><span class="spacer"></span><button id="copyLetter">Copy</button></div>
      ${issuesBox(r.letterIssues)}
      <textarea id="letter" rows="16" style="margin-top:10px">${esc(r.letter)}</textarea></div>` : ''}
    ${r?.tailored ? `<div class="card"><div class="row"><h2 style="margin:0">Tailored CV</h2><span class="pill">For ${esc(r.job.company || 'this job')}</span><span class="spacer"></span><button id="copyCv">Copy</button><button id="saveCvPdf" class="primary">Save as PDF</button></div>
      ${issuesBox(r.tailored.issues)}
      <textarea id="cvOut" rows="20" style="margin-top:10px" readonly>${esc(r.tailored.text)}</textarea>
      <p class="small muted" style="margin-top:6px">Your real employers, dates and numbers are kept; the AI only reorders and rewords. Read it before you send it.</p></div>` : ''}
    <div class="card"><h2>What you're looking for</h2><p class="small muted">Used to score every job.</p>
      <div class="grid">
        <div class="wide"><label>Target roles / keywords (comma separated)</label><input data-pref="targetRoles" value="${esc(pr.targetRoles)}"></div>
        <div class="wide"><label>Places (e.g. Budapest, Remote)</label><input data-pref="locations" value="${esc(pr.locations)}"></div>
        <div class="wide"><label>Skip jobs that mention</label><input data-pref="avoidKeywords" value="${esc(pr.avoidKeywords)}"></div>
        <div class="wide"><label class="switch"><input type="checkbox" data-pref="paidOnly" ${pr.paidOnly ? 'checked' : ''}> Paid positions only</label></div>
      </div>
    </div>
  </div>`;
};
BIND.check = (v) => {
  const job = () => ({ url: $('#jobUrl', v).value.trim(), text: $('#jobText', v).value, company: $('#jobCompany', v).value.trim(), role: $('#jobRole', v).value.trim() });
  $('#fetchBtn', v).onclick = () => safe(async () => {
    const url = $('#jobUrl', v).value.trim();
    if (!url) return toast('Paste a link first');
    $('#fetchBtn', v).textContent = 'Loading…';
    try {
      const j = await api.fetchJob(url);
      if (j.text.length < 200) toast('That page had little text — paste the description instead');
      const fit = await api.checkFit(j.text);
      checkResult = { job: j, fit };
      render();
    } finally { const b = $('#fetchBtn'); if (b) b.textContent = 'Load'; }
  });
  $('#checkBtn', v).onclick = () => safe(async () => {
    const j = job();
    const fit = await api.checkFit(j.text);
    checkResult = { job: j, fit, letter: checkResult?.letter, letterSource: checkResult?.letterSource };
    render();
  });
  $$('[data-pref]', v).forEach((el) => {
    const upd = () => { S.preferences[el.dataset.pref] = el.type === 'checkbox' ? el.checked : el.value; saveSoon(() => ({ preferences: S.preferences })); };
    el.oninput = upd; el.onchange = upd;
  });
  if (!checkResult) return;
  $('#openApply', v)?.addEventListener('click', () => safe(() => api.openJob(checkResult.job.url)));
  $('#saveLater', v).onclick = () => safe(async () => {
    const j = { ...checkResult.job, ...job() };
    const entry = { id: Date.now().toString(36), company: j.company, role: j.role, location: '', url: j.url, status: 'Saved', dateApplied: '', fit: checkResult.fit.score, notes: '' };
    S = await api.update({ jobs: [entry, ...S.jobs] });
    updateCounts();
    toast('Saved to tracker');
  });
  $('#makeLetter', v).onclick = () => safe(async () => {
    const b = $('#makeLetter', v); b.disabled = true; b.textContent = 'Writing…';
    try {
      const j = { ...checkResult.job, ...job() };
      const r = await api.coverLetter(j);
      checkResult = { ...checkResult, job: j, letter: r.text, letterSource: r.source, letterIssues: r.issues };
      render();
    } finally { const bb = $('#makeLetter'); if (bb) bb.disabled = false; }
  });
  $('#copyLetter', v)?.addEventListener('click', () => { navigator.clipboard.writeText($('#letter').value); toast('Copied'); });
  const busy = (id, label, fn) => safe(async () => {
    const b = $(id, v); b.disabled = true; b.textContent = label;
    try { await fn(); } finally { const bb = $(id); if (bb) { bb.disabled = false; } render(); }
  });
  $('#aiScore', v).onclick = () => busy('#aiScore', 'Scoring…', async () => {
    const j = { ...checkResult.job, ...job() };
    checkResult = { ...checkResult, job: j, ai: await api.aiFit(j) };
  });
  $('#tailor', v).onclick = () => busy('#tailor', 'Tailoring…', async () => {
    const j = { ...checkResult.job, ...job() };
    checkResult = { ...checkResult, job: j, tailored: await api.tailorCv(j) };
  });
  $('#copyCv', v)?.addEventListener('click', () => { navigator.clipboard.writeText(checkResult.tailored.text); toast('Copied'); });
  $('#saveCvPdf', v)?.addEventListener('click', () => safe(async () => { const p = await api.saveCvPdf(checkResult.tailored.cv, checkResult.job); if (p) toast('Saved PDF'); }));
};

const aiReady = () => Boolean(S.settings.aiEnabled && S.settings.hasApiKey);
const issuesBox = (issues) => (issues?.length
  ? `<div class="issues"><b>Check before sending:</b><ul>${issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '');

// ---------------- Find jobs ----------------

let findState = { results: null, errors: [], total: 0, boards: 0, loading: false, filter: true };

PAGES.find = () => {
  const pr = S.preferences;
  const f = findState;
  const rows = f.results || [];
  return `<div class="page" style="max-width:1100px">
    <div class="page-head"><h1>Find jobs</h1><p>Search the career boards of companies you like. Results are ranked by how well they fit you.</p></div>
    <div class="card">
      <label for="boards">Company career boards (one per line)</label>
      <textarea id="boards" rows="5" spellcheck="false" placeholder="https://boards.greenhouse.io/company&#10;https://jobs.lever.co/company&#10;https://jobs.ashbyhq.com/company&#10;https://apply.workable.com/company&#10;smartrecruiters:Company">${esc(pr.boards)}</textarea>
      <p class="small muted" style="margin-top:6px">Works with Greenhouse, Lever, Ashby, Workable and SmartRecruiters: paste the company's careers page link. Uses the boards' official public job APIs.</p>
      <div class="row" style="margin-top:10px">
        <label class="switch"><input type="checkbox" id="useFilter" ${f.filter ? 'checked' : ''}> Only roles matching “${esc(pr.targetRoles || 'any')}” in “${esc(pr.locations || 'anywhere')}”</label>
        <span class="spacer"></span><button id="findGo" class="primary" ${f.loading ? 'disabled' : ''}>${f.loading ? 'Searching…' : 'Search'}</button>
      </div>
      ${f.errors.length ? `<div class="issues" style="margin-top:10px"><ul>${f.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    </div>
    ${f.results ? `<div class="card" style="padding:6px 10px">
      <p class="small muted" style="margin:6px 4px">${rows.length} match${rows.length === 1 ? '' : 'es'} out of ${f.total} open jobs on ${f.boards} board${f.boards === 1 ? '' : 's'}.</p>
      ${rows.length ? `<table><thead><tr><th style="width:6%">Fit</th><th>Role</th><th style="width:16%">Company</th><th style="width:20%">Location</th><th style="width:10%">Posted</th><th style="width:210px"></th></tr></thead><tbody>
      ${rows.slice(0, 300).map((j, i) => `<tr data-i="${i}">
        <td><span class="pill ${j.fit >= 70 ? 'good' : j.fit >= 45 ? 'warn' : 'bad'}" title="${esc(j.verdict)}">${j.fit}</span></td>
        <td>${esc(j.role)}</td><td>${esc(j.company)}</td><td class="small">${esc(j.location)}</td><td class="small muted">${esc(j.posted)}</td>
        <td class="row" style="flex-wrap:nowrap;gap:4px"><button class="ghost f-check">Check</button><button class="ghost f-save">${S.jobs.some((x) => x.url === j.url) ? 'Saved ✓' : 'Save'}</button><button class="ghost f-open">Apply ↗</button></td>
      </tr>`).join('')}</tbody></table>` : '<div class="empty">No matching jobs. Try turning off the filter or adding more boards.</div>'}
    </div>` : ''}
  </div>`;
};
BIND.find = (v) => {
  $('#boards', v).oninput = (e) => { S.preferences.boards = e.target.value; saveSoon(() => ({ preferences: { boards: S.preferences.boards } })); };
  $('#useFilter', v).onchange = (e) => { findState.filter = e.target.checked; };
  $('#findGo', v).onclick = () => safe(async () => {
    const boards = $('#boards', v).value;
    if (!boards.trim()) return toast('Add at least one career board link');
    findState.loading = true; render();
    try {
      const opts = findState.filter ? { boards } : { boards, keywords: '', locations: '' };
      findState = { ...findState, ...(await api.discover(opts)) };
    } finally { findState.loading = false; render(); }
  });
  const jobAt = (b) => findState.results[+b.closest('tr').dataset.i];
  $$('.f-open', v).forEach((b) => { b.onclick = () => safe(() => api.openJob(jobAt(b).url)); });
  $$('.f-check', v).forEach((b) => { b.onclick = () => safe(async () => {
    const j = jobAt(b);
    checkResult = { job: { url: j.url, text: j.text, company: j.company, role: j.role }, fit: await api.checkFit(j.text) };
    go('check');
  }); });
  $$('.f-save', v).forEach((b) => { b.onclick = () => safe(async () => {
    const j = jobAt(b);
    if (S.jobs.some((x) => x.url === j.url)) return toast('Already in your tracker');
    const entry = { id: Date.now().toString(36), company: j.company, role: j.role, location: j.location, url: j.url, status: 'Saved', dateApplied: '', fit: j.fit, notes: '' };
    S = await api.update({ jobs: [entry, ...S.jobs] });
    b.textContent = 'Saved ✓'; updateCounts();
  }); });
};

// ---------------- Tracker ----------------

const STATUSES = ['Saved', 'Applied', 'Interview', 'Offer', 'Rejected'];
let trackerFilter = 'All';

PAGES.tracker = () => {
  const rows = S.jobs.filter((j) => trackerFilter === 'All' || j.status === trackerFilter);
  return `<div class="page" style="max-width:1200px">
    <div class="page-head row"><div><h1>Tracker</h1><p>Every job you saved or applied to. Click a cell to edit.</p></div><span class="spacer"></span>
      <select id="filter" style="width:auto">${['All', ...STATUSES].map((s) => `<option ${s === trackerFilter ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <button id="addJob">+ Add</button><button id="exportCsv">Export CSV</button></div>
    <div class="card" style="padding:6px 10px">
    ${rows.length ? `<table><thead><tr><th style="width:18%">Company</th><th style="width:22%">Role</th><th style="width:13%">Status</th><th style="width:11%">Applied</th><th style="width:6%">Fit</th><th>Notes</th><th style="width:88px"></th></tr></thead><tbody>
      ${rows.map((j) => `<tr data-id="${esc(j.id)}">
        <td><input data-f="company" value="${esc(j.company)}"></td>
        <td><input data-f="role" value="${esc(j.role)}"></td>
        <td><select data-f="status">${STATUSES.map((s) => `<option ${s === j.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td><input data-f="dateApplied" type="date" value="${esc(j.dateApplied)}"></td>
        <td>${j.fit === '' || j.fit == null ? '' : `<span class="pill ${j.fit >= 70 ? 'good' : j.fit >= 45 ? 'warn' : 'bad'}">${esc(j.fit)}</span>`}</td>
        <td><input data-f="notes" value="${esc(j.notes)}" placeholder="—"></td>
        <td class="row" style="flex-wrap:nowrap;gap:2px">${j.url ? `<button class="ghost open" title="Open in apply window">↗</button>` : ''}<button class="ghost danger del" title="Delete">✕</button></td>
      </tr>`).join('')}</tbody></table>`
    : `<div class="empty">${S.jobs.length ? 'Nothing with this status.' : 'No applications yet. Open a job from Home and press “Mark applied” after you submit.'}</div>`}
    </div></div>`;
};
BIND.tracker = (v) => {
  const patch = async (id, f, val) => {
    S.jobs = S.jobs.map((j) => (j.id === id ? { ...j, [f]: val, ...(f === 'status' && val !== 'Saved' && !j.dateApplied ? { dateApplied: new Date().toISOString().slice(0, 10) } : {}) } : j));
    saveSoon(() => ({ jobs: S.jobs }));
  };
  $$('[data-f]', v).forEach((el) => {
    const id = el.closest('tr').dataset.id;
    el.oninput = () => patch(id, el.dataset.f, el.value);
    if (el.tagName === 'SELECT') el.onchange = async () => { await patch(id, 'status', el.value); setTimeout(render, 450); };
  });
  $$('.del', v).forEach((b) => { b.onclick = async () => { const id = b.closest('tr').dataset.id; S = await api.update({ jobs: S.jobs.filter((j) => j.id !== id) }); render(); }; });
  $$('.open', v).forEach((b) => { b.onclick = () => { const j = S.jobs.find((x) => x.id === b.closest('tr').dataset.id); safe(() => api.openJob(j.url)); }; });
  $('#filter', v).onchange = (e) => { trackerFilter = e.target.value; render(); };
  $('#addJob', v).onclick = async () => {
    S = await api.update({ jobs: [{ id: Date.now().toString(36), company: '', role: '', location: '', url: '', status: 'Applied', dateApplied: new Date().toISOString().slice(0, 10), fit: '', notes: '' }, ...S.jobs] });
    trackerFilter = 'All'; render(); $('td input').focus();
  };
  $('#exportCsv', v).onclick = () => safe(async () => { const p = await api.exportCsv(); if (p) toast('Exported'); });
};

// ---------------- Settings ----------------

PAGES.settings = () => {
  const s = S.settings;
  return `<div class="page">
    <div class="page-head"><h1>Settings</h1><p>Permissions, AI and your data.</p></div>
    <div class="card"><h2>Claude AI (optional)</h2>
      <p class="small muted">Without AI, ApplyEase uses your templates and saved answers. With your own Claude API key it writes a tailored cover letter and answers for each job. Your key is encrypted on this computer and only sent to Anthropic.</p>
      <label class="switch" style="margin:10px 0"><input type="checkbox" id="aiOn" ${s.aiEnabled ? 'checked' : ''}> Use Claude to write letters and answers</label>
      <div class="grid"><div class="wide"><label>API key ${s.hasApiKey ? '<span class="pill good">saved</span>' : ''}</label>
        <div class="row" style="flex-wrap:nowrap"><input id="apiKey" type="password" placeholder="${s.hasApiKey ? '••••••••••••  (saved)' : 'sk-ant-…'}" autocomplete="off"><button id="saveKey">Save</button><button id="testKey" ${s.hasApiKey ? '' : 'disabled'}>Test</button>${s.hasApiKey ? '<button id="delKey" class="danger">Remove</button>' : ''}</div>
        <p class="small muted" style="margin-top:6px">Get one at <a href="#" id="consoleLink">console.anthropic.com</a>. Each letter costs about a cent.</p></div>
        <div><label>Model</label><input id="model" value="${esc(s.model)}"></div>
      </div>
    </div>
    <div class="card"><h2>Websites allowed to be filled</h2>
      <p class="small muted">ApplyEase asks before filling forms on a new site. Remove a site to be asked again.</p>
      ${s.allowedSites.length ? `<ul class="sites">${s.allowedSites.map((h) => `<li>${esc(h)}<button class="ghost danger" data-site="${esc(h)}">Remove</button></li>`).join('')}</ul>` : '<p class="muted">None yet.</p>'}
      <label class="switch" style="margin-top:12px"><input type="checkbox" id="overwrite" ${s.overwriteFilled ? 'checked' : ''}> Replace text already in a field (off = only fill empty fields)</label>
    </div>
    <div class="card"><h2>Your data</h2>
      <p class="small muted">Everything is stored in one file on this computer. Nothing is uploaded except Claude requests you turn on.</p>
      <div class="row"><button id="openFolder">Open data folder</button><button id="resetAll" class="danger">Delete all my data</button></div>
    </div>
    <p class="small muted">ApplyEase never presses Submit on a website. You stay in control of every application.</p>
  </div>`;
};
BIND.settings = (v) => {
  $('#aiOn', v).onchange = async (e) => { S = await api.update({ settings: { aiEnabled: e.target.checked } }); if (e.target.checked && !S.settings.hasApiKey) toast('Add your API key below'); };
  $('#overwrite', v).onchange = async (e) => { S = await api.update({ settings: { overwriteFilled: e.target.checked } }); };
  $('#model', v).oninput = (e) => saveSoon(() => ({ settings: { model: e.target.value.trim() || 'claude-sonnet-5' } }));
  $('#saveKey', v).onclick = () => safe(async () => {
    const k = $('#apiKey', v).value.trim();
    if (!k) return toast('Paste your key first');
    S = await api.setApiKey(k);
    if (!S.settings.aiEnabled) S = await api.update({ settings: { aiEnabled: true } });
    render(); toast('Key saved');
  });
  $('#testKey', v).onclick = () => safe(async () => { $('#testKey', v).textContent = 'Testing…'; try { await api.testApiKey(); toast('Key works ✓'); } finally { const b = $('#testKey'); if (b) b.textContent = 'Test'; } });
  $('#delKey', v)?.addEventListener('click', () => safe(async () => { S = await api.setApiKey(''); render(); }));
  $('#consoleLink', v).onclick = (e) => { e.preventDefault(); api.openLink('https://console.anthropic.com/settings/keys'); };
  $$('[data-site]', v).forEach((b) => { b.onclick = async () => { S = await api.update({ settings: { allowedSites: S.settings.allowedSites.filter((h) => h !== b.dataset.site) } }); render(); }; });
  $('#openFolder', v).onclick = () => api.openDataFolder();
  $('#resetAll', v).onclick = () => safe(async () => { S = await api.resetAll(); checkResult = null; go('home'); });
};

// ---------------- Boot ----------------

$$('.tab').forEach((b) => { b.onclick = () => go(b.dataset.tab); });
api.onState((s) => { S = s; if (tab === 'tracker' || tab === 'home' || tab === 'settings') render(); else updateCounts(); });
api.getState().then(async (s) => {
  S = s;
  if (!S.onboarded) { S = await api.update({ onboarded: true }); }
  go('home');
});
