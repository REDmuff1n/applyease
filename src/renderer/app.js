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
  // Leaving Live jobs: everything shown there is no longer "new".
  if (tab === 'live' && t !== 'live' && LIVE) {
    api.liveMarkSeen().then(() => { LIVE.lastViewedAt = new Date().toISOString(); updateLiveCount(); }).catch(() => {});
  }
  tab = t;
  if (t === 'live' && LIVE) loadLive().catch(() => {}); // picks up changed preferences
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
    { done: Boolean(S.settings.aiReady), text: 'Optional: turn on AI (Claude, ChatGPT, Gemini, DeepSeek, Ollama…) for tailored letters', tab: 'settings' }
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
      <details style="margin-top:12px"><summary>Fill this profile from my CV text (uses AI)</summary>
        <p class="small muted" style="margin-top:8px">Open your CV, copy all the text, paste it here. Needs AI turned on in Settings.</p>
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
  <div class="page-head"><h1>Saved answers</h1><p>Reused for open questions on forms. With AI on, they guide tailored answers instead.</p></div>
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
        <button id="aiScore" ${aiReady() ? '' : 'disabled title="Turn on AI in Settings"'}>${r.ai ? 'Re-score' : 'AI score'}</button>
        <button id="tailor" ${aiReady() ? '' : 'disabled title="Turn on AI in Settings"'}>${r.tailored ? 'Re-tailor' : 'Tailor my CV'}</button></div>
    </div></div></div>` : ''}
    ${r?.ai ? `<div class="card"><div class="fit"><div class="score ${r.ai.score >= 7 ? 'good' : r.ai.score >= 5 ? 'warn' : 'bad'}">${r.ai.score}<small>/10</small></div><div style="flex:1">
      <h2>AI score <span class="pill">${esc(S.settings.model)}</span></h2><p>${esc(r.ai.reasoning)}</p>
      <ul class="reasons">${r.ai.matches.map((x) => `<li class="g">${esc(x)}</li>`).join('')}${r.ai.gaps.map((x) => `<li class="b">${esc(x)}</li>`).join('')}</ul>
      ${r.ai.keywords.length ? `<p class="small muted" style="margin-top:8px">Words from the ad to mirror in your CV: ${r.ai.keywords.map(esc).join(', ')}</p>` : ''}
    </div></div></div>` : ''}
    ${r?.letter ? `<div class="card"><div class="row"><h2 style="margin:0">Cover letter</h2><span class="pill">${r.letterSource === 'ai' ? 'Written by AI' : 'From your template'}</span><span class="spacer"></span><button id="copyLetter">Copy</button></div>
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

const aiReady = () => Boolean(S.settings.aiReady);
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
        <td><div class="row" style="flex-wrap:nowrap;gap:4px"><button class="ghost f-check">Check</button><button class="ghost f-save">${S.jobs.some((x) => x.url === j.url) ? 'Saved ✓' : 'Save'}</button><button class="ghost f-open">Apply ↗</button></div></td>
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
    const entry = trackerEntry(j, j.fit);
    S = await api.update({ jobs: [entry, ...S.jobs] });
    b.textContent = 'Saved ✓'; updateCounts();
  }); });
};

// ---------------- Live jobs ----------------

let LIVE = null; // from api.live()
const liveUI = { q: '', age: 0, source: 'all', mine: true, newOnly: false, sort: 'new', page: 0 };
const PER_PAGE = 20;

function ago(isoStr) {
  const t = Date.parse(isoStr);
  if (!t) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 60) return `${m || 1} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  const d = Math.round(m / 1440);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

// Worked out in the main process (src/match.js), same rule as Find jobs.
const matchesMe = (j) => Boolean(j.mine);

const isNew = (j) => Boolean(LIVE?.lastViewedAt) && j.firstSeen > LIVE.lastViewedAt;

function liveRows() {
  if (!LIVE) return [];
  const q = liveUI.q.trim().toLowerCase();
  const since = liveUI.age ? Date.now() - liveUI.age * 864e5 : 0;
  const rows = LIVE.jobs.filter((j) => (liveUI.source === 'all' || j.source === liveUI.source)
    && (!liveUI.mine || matchesMe(j))
    && (!liveUI.newOnly || isNew(j))
    && (!since || (Date.parse(j.posted || j.firstSeen) || Date.now()) >= since)
    && (!q || `${j.role} ${j.company} ${j.location} ${(j.tags || []).join(' ')}`.toLowerCase().includes(q)));
  if (liveUI.sort === 'fit') rows.sort((a, b) => b.fit - a.fit);
  return rows;
}

function updateLiveCount() {
  const n = LIVE ? LIVE.jobs.filter((j) => isNew(j) && matchesMe(j)).length : 0;
  $('#liveCount').textContent = n ? String(n) : '';
}

async function loadLive() {
  LIVE = await api.live();
  updateLiveCount();
  if (tab === 'live') render();
}

function liveTable() {
  const rows = liveRows();
  const srcLabel = (j) => (j.via ? `${j.via} (JSearch)` : LIVE.sources[j.source]?.label || j.source);
  if (!rows.length) {
    return `<div class="empty">${LIVE.jobs.length ? 'No jobs match these filters. Try “All posted dates” or turn off “Only my roles & places”.' : 'No jobs yet. Press Refresh, or turn on more sources in Settings.'}</div>`;
  }
  const pages = Math.ceil(rows.length / PER_PAGE);
  liveUI.page = Math.min(liveUI.page, pages - 1);
  const from = liveUI.page * PER_PAGE;
  return `<p class="small muted" style="margin:6px 4px">Showing ${from + 1}–${Math.min(from + PER_PAGE, rows.length)} of ${rows.length} job${rows.length === 1 ? '' : 's'}.</p>
    <table><thead><tr><th style="width:6%">Fit</th><th>Role</th><th style="width:16%">Company</th><th style="width:17%">Location</th><th style="width:13%">Source</th><th style="width:9%">Posted</th><th style="width:196px"></th></tr></thead><tbody>
    ${rows.slice(from, from + PER_PAGE).map((j) => `<tr data-id="${esc(j.id)}">
      <td><span class="pill ${j.fit >= 70 ? 'good' : j.fit >= 45 ? 'warn' : 'bad'}" title="${esc(j.verdict)}">${j.fit}</span></td>
      <td>${isNew(j) ? '<span class="pill new">New</span> ' : ''}${esc(j.role)}</td><td>${esc(j.company)}</td>
      <td class="small">${esc(j.location)}</td><td class="small muted">${esc(srcLabel(j))}</td><td class="small muted" title="${esc(j.posted)}">${esc(ago(j.posted || j.firstSeen))}</td>
      <td><div class="row" style="flex-wrap:nowrap;gap:4px"><button class="ghost l-check">Check</button><button class="ghost l-save">${S.jobs.some((x) => x.url === j.url) ? 'Saved ✓' : 'Save'}</button><button class="ghost l-open">Apply ↗</button></div></td>
    </tr>`).join('')}</tbody></table>
    ${pager(liveUI.page, pages)}`;
}

// « Prev  1 2 3 … 9  Next »: a window of pages around the current one.
function pager(page, pages) {
  if (pages <= 1) return '';
  const nums = [...new Set([0, page - 2, page - 1, page, page + 1, page + 2, pages - 1])].filter((n) => n >= 0 && n < pages).sort((a, b) => a - b);
  const parts = [];
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1] > 1) parts.push('<span class="muted">…</span>');
    parts.push(`<button class="${n === page ? 'primary' : 'ghost'}" data-page="${n}" ${n === page ? 'aria-current="page"' : ''}>${n + 1}</button>`);
  });
  return `<div class="pager"><button class="ghost" data-page="${page - 1}" ${page === 0 ? 'disabled' : ''}>‹ Prev</button>${parts.join('')}<button class="ghost" data-page="${page + 1}" ${page >= pages - 1 ? 'disabled' : ''}>Next ›</button></div>`;
}

PAGES.live = () => {
  if (!LIVE) return '<div class="page"><div class="page-head"><h1>Live jobs</h1><p>Loading…</p></div></div>';
  const enabled = Object.entries(LIVE.sources).filter(([, s]) => s.enabled);
  const problems = enabled.flatMap(([id, s]) => { const st = LIVE.status[id]; if (!st) return []; return st.ok ? (st.warnings || []).map((w) => `${s.label}: ${w}`) : [`${s.label}: ${st.error}`]; });
  const newCount = LIVE.jobs.filter((j) => isNew(j) && matchesMe(j)).length;
  return `<div class="page" style="max-width:1200px">
    <div class="page-head row"><div><h1>Live jobs</h1><p>The newest listings from ${enabled.length} source${enabled.length === 1 ? '' : 's'}, matched to what you're looking for. ${LIVE.fetchedAt ? 'Updated ' + ago(LIVE.fetchedAt) + '.' : ''}</p></div><span class="spacer"></span>
      ${newCount ? `<span class="pill new">${newCount} new since your last visit</span>` : ''}
      <button id="liveRefresh" class="primary" ${LIVE.refreshing ? 'disabled' : ''}>${LIVE.refreshing ? 'Refreshing…' : 'Refresh'}</button></div>
    <div class="card row" style="gap:8px">
      <span class="small muted">Search the big boards yourself (last 24 h, your roles and city):</span>
      ${LIVE.links.map((l, i) => `<button class="ghost" data-link="${i}">${esc(l.label)} ↗</button>`).join('')}
      <span class="spacer"></span><button class="ghost" id="liveSources">Sources &amp; keys…</button>
    </div>
    <div class="card" style="padding:10px 12px">
      <div class="row" style="gap:8px">
        <input id="liveQ" placeholder="Filter by title, company, place…" value="${esc(liveUI.q)}" style="flex:1;min-width:200px">
        <select id="liveAge" style="width:auto">${[[1, 'Last 24 hours'], [3, 'Last 3 days'], [7, 'Last 7 days'], [0, 'All posted dates']].map(([d, l]) => `<option value="${d}" ${liveUI.age === d ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select id="liveSource" style="width:auto"><option value="all">All sources</option>${enabled.map(([id, s]) => `<option value="${id}" ${liveUI.source === id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
        <select id="liveSort" style="width:auto"><option value="new" ${liveUI.sort === 'new' ? 'selected' : ''}>Newest first</option><option value="fit" ${liveUI.sort === 'fit' ? 'selected' : ''}>Best fit first</option></select>
      </div>
      <div class="row" style="gap:16px;margin-top:8px">
        <label class="switch"><input type="checkbox" id="liveMine" ${liveUI.mine ? 'checked' : ''}> Only my roles &amp; places (${esc(S.preferences.targetRoles || 'any')} · ${esc(S.preferences.locations || 'anywhere')})</label>
        <label class="switch"><input type="checkbox" id="liveNew" ${liveUI.newOnly ? 'checked' : ''}> New only</label>
      </div>
      ${problems.length ? `<div class="issues"><ul>${problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    </div>
    <div class="card" style="padding:6px 10px" id="liveList">${liveTable()}</div>
  </div>`;
};
BIND.live = (v) => {
  const redrawList = () => { liveUI.page = 0; $('#liveList', v).innerHTML = liveTable(); bindLiveList(v); };
  $('#liveRefresh', v).onclick = () => safe(async () => { LIVE = { ...LIVE, refreshing: true }; render(); try { LIVE = await api.liveRefresh(true); } finally { await loadLive(); } });
  $$('[data-link]', v).forEach((b) => { b.onclick = () => safe(() => api.openJob(LIVE.links[+b.dataset.link].url)); });
  $('#liveSources', v).onclick = () => { go('settings'); setTimeout(() => $('#sourcesCard')?.scrollIntoView({ behavior: 'smooth' }), 50); };
  $('#liveQ', v).oninput = (e) => { liveUI.q = e.target.value; redrawList(); };
  $('#liveAge', v).onchange = (e) => { liveUI.age = +e.target.value; redrawList(); };
  $('#liveSource', v).onchange = (e) => { liveUI.source = e.target.value; redrawList(); };
  $('#liveSort', v).onchange = (e) => { liveUI.sort = e.target.value; redrawList(); };
  $('#liveMine', v).onchange = (e) => { liveUI.mine = e.target.checked; redrawList(); };
  $('#liveNew', v).onchange = (e) => { liveUI.newOnly = e.target.checked; redrawList(); };
  bindLiveList(v);
};
function bindLiveList(v) {
  const jobAt = (b) => LIVE.jobs.find((j) => j.id === b.closest('tr').dataset.id);
  $$('[data-page]', v).forEach((b) => { b.onclick = () => {
    liveUI.page = +b.dataset.page;
    $('#liveList', v).innerHTML = liveTable(); bindLiveList(v);
    $('#liveList', v).scrollIntoView({ block: 'start' });
  }; });
  $$('.l-open', v).forEach((b) => { b.onclick = () => safe(() => api.openJob(jobAt(b).url)); });
  $$('.l-check', v).forEach((b) => { b.onclick = () => safe(async () => {
    const j = await api.liveJob(jobAt(b).id);
    if (!j) return toast('That job is no longer in the list');
    const text = `Job title: ${j.role}\nCompany: ${j.company}\nLocation: ${j.location}\n\n${j.text}`;
    checkResult = { job: { url: j.url, text, company: j.company, role: j.role }, fit: await api.checkFit(text) };
    go('check');
  }); });
  $$('.l-save', v).forEach((b) => { b.onclick = () => safe(async () => {
    const j = await api.liveJob(jobAt(b).id);
    if (!j) return;
    if (S.jobs.some((x) => x.url === j.url)) return toast('Already in your tracker');
    S = await api.update({ jobs: [trackerEntry(j, jobAt(b).fit), ...S.jobs] });
    b.textContent = 'Saved ✓'; updateCounts();
  }); });
}

function trackerEntry(j, fit) {
  return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), company: j.company || '', role: j.role || '', location: j.location || '', url: j.url, status: 'Saved', dateApplied: '', fit, notes: '', text: String(j.text || '').slice(0, 6000) };
}

// ---------------- Tracker ----------------

const STATUSES = ['Saved', 'Applied', 'Interview', 'Offer', 'Rejected'];
let trackerFilter = 'All';
let batchState = null; // progress of "Score & tailor"
let batchOpen = false;

function batchPanel() {
  const o = S.settings.batch;
  const saved = S.jobs.filter((j) => j.status === 'Saved' && j.url).length;
  if (batchState && !batchState.finished) {
    const pct = batchState.total ? Math.round((batchState.done / batchState.total) * 100) : 0;
    return `<div class="card"><div class="row"><h2 style="margin:0">Scoring &amp; tailoring… ${batchState.done}/${batchState.total}</h2><span class="spacer"></span><button id="batchCancel" class="danger">Stop</button></div>
      <div class="bar"><div style="width:${pct}%"></div></div><p class="small muted">${esc(batchState.step || '')}</p></div>`;
  }
  const last = batchState?.finished ? `<div class="issues" style="background:var(--good-soft)"><b>${batchState.cancelled ? 'Stopped' : 'Done'}:</b> ${batchState.done} job${batchState.done === 1 ? '' : 's'} processed, ${batchState.tailored} tailored${batchState.skipped ? `, ${batchState.skipped} below your score limit` : ''}. Tailored files are in Documents › ApplyEase.
    ${batchState.errors.length ? `<ul>${batchState.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>` : '';
  if (!batchOpen) return last;
  return `<div class="card"><h2>Score &amp; tailor your saved jobs</h2>
    <p class="small muted">Goes through the ${saved} job${saved === 1 ? '' : 's'} with status “Saved”: reads each description, gives it an AI score, and for good matches writes a tailored CV (PDF) and cover letter into Documents › ApplyEase. When you later open the job and press Attach CV / Write answers, the tailored versions are used.</p>
    ${S.settings.aiReady ? '' : '<div class="issues">Turn on AI in Settings first.</div>'}
    <div class="row" style="gap:18px;margin:10px 0">
      <label class="switch"><input type="checkbox" id="bScore" ${o.aiScore ? 'checked' : ''}> AI score</label>
      <label class="switch"><input type="checkbox" id="bTailor" ${o.tailor ? 'checked' : ''}> Tailored CV</label>
      <label class="switch"><input type="checkbox" id="bLetter" ${o.letter ? 'checked' : ''}> Cover letter</label>
      <label class="switch">only if AI score ≥ <select id="bMin" style="width:auto">${[5, 6, 7, 8, 9].map((n) => `<option ${+o.minScore === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    </div>
    <div class="row"><button id="batchGo" class="primary" ${S.settings.aiReady && saved ? '' : 'disabled'}>Start (${saved} job${saved === 1 ? '' : 's'})</button><button id="batchClose" class="ghost">Close</button></div>
    ${last}</div>`;
}

PAGES.tracker = () => {
  const rows = S.jobs.filter((j) => trackerFilter === 'All' || j.status === trackerFilter);
  return `<div class="page" style="max-width:1200px">
    <div class="page-head row"><div><h1>Tracker</h1><p>Every job you saved or applied to. Click a cell to edit.</p></div><span class="spacer"></span>
      <select id="filter" style="width:auto">${['All', ...STATUSES].map((s) => `<option ${s === trackerFilter ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <button id="batchOpen" ${batchState && !batchState.finished ? 'disabled' : ''}>✦ Score &amp; tailor saved jobs</button><button id="addJob">+ Add</button><button id="exportCsv">Export CSV</button></div>
    ${batchPanel()}
    <div class="card" style="padding:6px 10px">
    ${rows.length ? `<table><thead><tr><th style="width:17%">Company</th><th style="width:21%">Role</th><th style="width:12%">Status</th><th style="width:11%">Applied</th><th style="width:5%">Fit</th><th style="width:5%">AI</th><th>Notes</th><th style="width:112px"></th></tr></thead><tbody>
      ${rows.map((j) => `<tr data-id="${esc(j.id)}">
        <td><input data-f="company" value="${esc(j.company)}"></td>
        <td><input data-f="role" value="${esc(j.role)}"></td>
        <td><select data-f="status">${STATUSES.map((s) => `<option ${s === j.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td><input data-f="dateApplied" type="date" value="${esc(j.dateApplied)}"></td>
        <td>${j.fit === '' || j.fit == null ? '' : `<span class="pill ${j.fit >= 70 ? 'good' : j.fit >= 45 ? 'warn' : 'bad'}">${esc(j.fit)}</span>`}</td>
        <td>${j.aiScore == null ? '' : `<span class="pill ${j.aiScore >= 7 ? 'good' : j.aiScore >= 5 ? 'warn' : 'bad'}" title="${esc(j.aiReason || '')}">${esc(j.aiScore)}</span>`}</td>
        <td><input data-f="notes" value="${esc(j.notes)}" placeholder="—"></td>
        <td><div class="row" style="flex-wrap:nowrap;gap:2px">${j.folder ? `<button class="ghost folder" title="Open tailored CV and letter">📁</button>` : ''}${j.url ? `<button class="ghost open" title="Open in apply window">↗</button>` : ''}<button class="ghost danger del" title="Delete">✕</button></div></td>
      </tr>`).join('')}</tbody></table>`
    : `<div class="empty">${S.jobs.length ? 'Nothing with this status.' : 'No applications yet. Save jobs from Live jobs or Find jobs, or open a job from Home and press “Mark applied” after you submit.'}</div>`}
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
  $$('.folder', v).forEach((b) => { b.onclick = () => { const j = S.jobs.find((x) => x.id === b.closest('tr').dataset.id); safe(() => api.openPath(j.folder)); }; });
  $('#filter', v).onchange = (e) => { trackerFilter = e.target.value; render(); };
  $('#addJob', v).onclick = async () => {
    S = await api.update({ jobs: [{ id: Date.now().toString(36), company: '', role: '', location: '', url: '', status: 'Applied', dateApplied: new Date().toISOString().slice(0, 10), fit: '', notes: '' }, ...S.jobs] });
    trackerFilter = 'All'; render(); $('td input').focus();
  };
  $('#exportCsv', v).onclick = () => safe(async () => { const p = await api.exportCsv(); if (p) toast('Exported'); });
  $('#batchOpen', v).onclick = () => { batchOpen = true; if (batchState?.finished) batchState = null; render(); };
  $('#batchClose', v)?.addEventListener('click', () => { batchOpen = false; batchState = null; render(); });
  $('#batchCancel', v)?.addEventListener('click', () => api.batchCancel());
  const opts = () => ({ aiScore: $('#bScore', v).checked, tailor: $('#bTailor', v).checked, letter: $('#bLetter', v).checked, minScore: +$('#bMin', v).value });
  ['#bScore', '#bTailor', '#bLetter', '#bMin'].forEach((id) => $(id, v)?.addEventListener('change', () => { S.settings.batch = opts(); saveSoon(() => ({ settings: { batch: S.settings.batch } })); }));
  $('#batchGo', v)?.addEventListener('click', () => {
    batchState = { done: 0, total: 0, step: 'Starting…', errors: [] };
    render();
    api.batchRun(opts()).catch((e) => { batchState = null; toast(e.message); render(); });
  });
};

// ---------------- Settings ----------------

let PROV = {}; // AI providers, from the main process
let modelList = [];

PAGES.settings = () => {
  const s = S.settings;
  const p = PROV[s.aiProvider] || {};
  const f = S.feeds;
  const src = LIVE?.sources || {};
  const secret = (name) => s.secretsSet?.[name];
  const keyRow = (name, placeholder) => `<div class="row" style="flex-wrap:nowrap"><input type="password" data-secret="${name}" placeholder="${secret(name) ? '••••••••  (saved)' : placeholder}" autocomplete="off"><button data-save-secret="${name}">Save</button>${secret(name) ? `<button class="danger" data-del-secret="${name}">Remove</button>` : ''}</div>`;
  const cloud = Object.entries(PROV).filter(([, x]) => !x.local && !x.custom);
  const local = Object.entries(PROV).filter(([, x]) => x.local || x.custom);
  const opt = ([id, x]) => `<option value="${id}" ${id === s.aiProvider ? 'selected' : ''}>${esc(x.label)}</option>`;
  return `<div class="page">
    <div class="page-head"><h1>Settings</h1><p>AI, job sources, permissions and your data.</p></div>
    <div class="card"><h2>AI (optional)</h2>
      <p class="small muted">Without AI, ApplyEase uses your templates and saved answers. With AI it writes tailored cover letters, answers and CVs, and scores jobs. Use any provider: Claude, ChatGPT, Gemini, DeepSeek, Groq, OpenRouter, Mistral, or a free model running on your own computer with Ollama or LM Studio. Keys are encrypted on this computer and only sent to the provider you pick.</p>
      <label class="switch" style="margin:10px 0"><input type="checkbox" id="aiOn" ${s.aiEnabled ? 'checked' : ''}> Use AI to write letters, answers and CVs</label>
      <div class="grid">
        <div><label for="provider">Provider</label><select id="provider"><optgroup label="Cloud">${cloud.map(opt).join('')}</optgroup><optgroup label="On your computer / other">${local.map(opt).join('')}</optgroup></select></div>
        <div><label for="model">Model</label><div class="row" style="flex-wrap:nowrap"><input id="model" list="modelList" value="${esc(s.model)}" placeholder="${esc(p.model || 'model name')}"><button id="loadModels" title="Load the models this provider offers">Load list</button></div>
          <datalist id="modelList">${modelList.map((m) => `<option value="${esc(m)}">`).join('')}</datalist></div>
        ${p.local || p.custom ? `<div class="wide"><label for="baseUrl">Server URL</label><input id="baseUrl" value="${esc(s.baseUrl)}" placeholder="${esc(p.base || 'https://your-server/v1')}"></div>` : ''}
        ${p.needsKey || p.custom ? `<div class="wide"><label>API key ${s.hasApiKey ? '<span class="pill good">saved</span>' : ''}${p.custom ? ' <span class="muted small">(if your server needs one)</span>' : ''}</label>
          <div class="row" style="flex-wrap:nowrap"><input id="apiKey" type="password" placeholder="${s.hasApiKey ? '••••••••••••  (saved)' : 'Paste your key'}" autocomplete="off"><button id="saveKey">Save</button>${s.hasApiKey ? '<button id="delKey" class="danger">Remove</button>' : ''}</div></div>` : ''}
      </div>
      <div class="row" style="margin-top:10px"><button id="testKey">Test connection</button>${p.keyUrl ? `<a href="#" id="keyLink" class="small">${p.local ? 'Download' : 'Get a key'} ↗</a>` : ''}<span class="spacer"></span>
        <span class="small muted">${s.aiProvider === 'ollama' ? 'Install Ollama, run “ollama pull llama3.1”, then press Test.' : s.aiProvider === 'gemini' || s.aiProvider === 'groq' ? 'This provider has a free tier.' : ''}</span></div>
    </div>
    <div class="card" id="sourcesCard"><h2>Live job sources</h2>
      <p class="small muted">Where the Live jobs page gets listings. Jobs refresh every time you open ApplyEase${f.autoRefreshMins ? ` and every ${f.autoRefreshMins} minutes while it's open` : ''}. LinkedIn, Indeed and Glassdoor don't allow scraping, so their listings come through JSearch (Google for Jobs) with a free key. You can also open their own search from the Live jobs page.</p>
      <div class="sources">${Object.entries(src).map(([id, x]) => `<div class="source">
        <label class="switch"><input type="checkbox" data-feed="${id}" ${f[id] ? 'checked' : ''}> <b>${esc(x.label)}</b></label>
        <p class="small muted">${esc(x.about)} ${x.keyUrl ? `<a href="#" data-url="${esc(x.keyUrl)}">Get a free key ↗</a>` : ''}</p>
        ${id === 'adzuna' ? `<div class="row" style="flex-wrap:nowrap;margin-bottom:6px"><input id="adzunaId" placeholder="App ID" value="${esc(f.adzunaAppId)}" style="width:140px">
          <select id="adzunaCountry" style="width:auto">${['gb', 'us', 'de', 'at', 'nl', 'pl', 'fr', 'it', 'es', 'be', 'ch', 'ca', 'au', 'in', 'sg'].map((c) => `<option ${c === f.adzunaCountry ? 'selected' : ''}>${c}</option>`).join('')}</select></div>` : ''}
        ${x.key ? keyRow(x.key, id === 'adzuna' ? 'App key' : 'API key') : ''}
      </div>`).join('')}</div>
      <div class="row" style="margin-top:12px;gap:18px">
        <label class="switch">Keep jobs posted in the last <select id="maxAge" style="width:auto">${[1, 3, 7, 14, 30].map((d) => `<option value="${d}" ${+f.maxAgeDays === d ? 'selected' : ''}>${d} day${d === 1 ? '' : 's'}</option>`).join('')}</select></label>
        <label class="switch">Auto-refresh <select id="autoRefresh" style="width:auto">${[[0, 'off'], [15, 'every 15 min'], [30, 'every 30 min'], [60, 'every hour'], [180, 'every 3 hours']].map(([m, l]) => `<option value="${m}" ${+f.autoRefreshMins === m ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
    </div>
    <div class="card"><h2>Websites allowed to be filled</h2>
      <p class="small muted">ApplyEase asks before filling forms on a new site. Remove a site to be asked again.</p>
      ${s.allowedSites.length ? `<ul class="sites">${s.allowedSites.map((h) => `<li>${esc(h)}<button class="ghost danger" data-site="${esc(h)}">Remove</button></li>`).join('')}</ul>` : '<p class="muted">None yet.</p>'}
      <label class="switch" style="margin-top:12px"><input type="checkbox" id="overwrite" ${s.overwriteFilled ? 'checked' : ''}> Replace text already in a field (off = only fill empty fields)</label>
    </div>
    <div class="card"><h2>Your data</h2>
      <p class="small muted">Everything is stored on this computer. Nothing is uploaded except requests to the AI provider and job sources you turn on.</p>
      <div class="row"><button id="openFolder">Open data folder</button><button id="resetAll" class="danger">Delete all my data</button></div>
    </div>
    <p class="small muted">ApplyEase never presses Submit on a website. You stay in control of every application.</p>
  </div>`;
};
BIND.settings = (v) => {
  $('#aiOn', v).onchange = async (e) => { S = await api.update({ settings: { aiEnabled: e.target.checked } }); render(); if (e.target.checked && !S.settings.aiReady) toast('Finish setting up your provider below'); };
  $('#provider', v).onchange = async (e) => {
    const id = e.target.value;
    modelList = [];
    S = await api.update({ settings: { aiProvider: id, model: PROV[id]?.model || '', baseUrl: '' } });
    render();
  };
  $('#model', v).oninput = (e) => saveSoon(() => ({ settings: { model: e.target.value.trim() } }));
  $('#baseUrl', v)?.addEventListener('input', (e) => saveSoon(() => ({ settings: { baseUrl: e.target.value.trim() } })));
  $('#loadModels', v).onclick = () => safe(async () => {
    $('#loadModels', v).textContent = 'Loading…';
    try { modelList = await api.listModels(); toast(`${modelList.length} models: click the Model box to pick one`); } finally { render(); }
  });
  $('#saveKey', v)?.addEventListener('click', () => safe(async () => {
    const k = $('#apiKey', v).value.trim();
    if (!k) return toast('Paste your key first');
    S = await api.setApiKey(k);
    if (!S.settings.aiEnabled) S = await api.update({ settings: { aiEnabled: true } });
    render(); toast('Key saved');
  }));
  $('#delKey', v)?.addEventListener('click', () => safe(async () => { S = await api.setApiKey(''); render(); }));
  $('#testKey', v).onclick = () => safe(async () => {
    clearTimeout(saveTimer);
    S = await api.update({ settings: { model: $('#model', v).value.trim(), ...($('#baseUrl', v) ? { baseUrl: $('#baseUrl', v).value.trim() } : {}) } });
    const b = $('#testKey', v); b.textContent = 'Testing…'; b.disabled = true;
    try { await api.testApiKey(); toast('Connected ✓'); } finally { b.textContent = 'Test connection'; b.disabled = false; }
  });
  $('#keyLink', v)?.addEventListener('click', (e) => { e.preventDefault(); api.openLink(PROV[S.settings.aiProvider].keyUrl); });

  // live job sources
  const feedsChanged = async (partial) => { S = await api.update({ feeds: partial }); await api.liveReschedule(); loadLive(); };
  $$('[data-feed]', v).forEach((el) => { el.onchange = () => feedsChanged({ [el.dataset.feed]: el.checked }); });
  $$('[data-url]', v).forEach((a) => { a.onclick = (e) => { e.preventDefault(); api.openLink(a.dataset.url); }; });
  $('#adzunaId', v)?.addEventListener('input', (e) => saveSoon(() => ({ feeds: { adzunaAppId: e.target.value.trim() } })));
  $('#adzunaCountry', v)?.addEventListener('change', (e) => feedsChanged({ adzunaCountry: e.target.value }));
  $('#maxAge', v).onchange = (e) => feedsChanged({ maxAgeDays: +e.target.value });
  $('#autoRefresh', v).onchange = (e) => feedsChanged({ autoRefreshMins: +e.target.value });
  $$('[data-save-secret]', v).forEach((b) => { b.onclick = () => safe(async () => {
    const name = b.dataset.saveSecret;
    const val = $(`[data-secret="${name}"]`, v).value.trim();
    if (!val) return toast('Paste the key first');
    S = await api.setSecret(name, val);
    render(); toast('Key saved. Press Refresh on Live jobs.');
  }); });
  $$('[data-del-secret]', v).forEach((b) => { b.onclick = () => safe(async () => { S = await api.setSecret(b.dataset.delSecret, ''); render(); }); });

  $('#overwrite', v).onchange = async (e) => { S = await api.update({ settings: { overwriteFilled: e.target.checked } }); };
  $$('[data-site]', v).forEach((b) => { b.onclick = async () => { S = await api.update({ settings: { allowedSites: S.settings.allowedSites.filter((h) => h !== b.dataset.site) } }); render(); }; });
  $('#openFolder', v).onclick = () => api.openDataFolder();
  $('#resetAll', v).onclick = () => safe(async () => { S = await api.resetAll(); checkResult = null; LIVE = null; loadLive(); go('home'); });
};

// ---------------- Boot ----------------

$$('.tab').forEach((b) => { b.onclick = () => go(b.dataset.tab); });
api.onState((s) => { S = s; if (tab === 'tracker' || tab === 'home' || tab === 'settings') render(); else updateCounts(); });
api.onLive(() => loadLive().catch(() => {}));
api.onBatch((p) => { batchState = p; if (p.finished) batchOpen = true; if (tab === 'tracker') render(); });
Promise.all([api.getState(), api.providers()]).then(async ([s, prov]) => {
  S = s;
  PROV = prov;
  if (!S.onboarded) { S = await api.update({ onboarded: true }); }
  go('home');
  loadLive().catch(() => {});
});
