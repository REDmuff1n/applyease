// Cover letters, answers, AI fit scores and tailored CVs. Uses Claude when the
// user adds their own API key, otherwise falls back to templates where it can.
const { checkWriting } = require('./quality');

async function callClaude({ apiKey, model, system, prompt, maxTokens = 1200 }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || res.statusText;
    throw new Error(`Claude API error (${res.status}): ${msg}`);
  }
  return (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

function profileBlock(state) {
  const p = state.profile;
  const answers = (state.answers || []).filter((a) => a.a).map((a) => `- ${a.q}: ${a.a}`).join('\n');
  return [
    `Name: ${p.firstName} ${p.lastName}`,
    p.preferredName && `Preferred name: ${p.preferredName}`,
    p.headline && `Headline: ${p.headline}`,
    p.yearsExperience && `Years of work experience: ${p.yearsExperience}`,
    `Education: ${[p.degree, p.major, p.university, p.gradYear && 'grad ' + p.gradYear, p.gpa && 'GPA ' + p.gpa].filter(Boolean).join(', ')}`,
    p.summary && `Experience summary:\n${p.summary}`,
    p.skills && `Skills: ${p.skills}`,
    p.languages && `Languages: ${p.languages}`,
    p.city && `Based in: ${[p.city, p.region, p.country].filter(Boolean).join(', ')}`,
    p.relocate && `Willing to relocate: ${p.relocate}`,
    p.startDate && `Can start: ${p.startDate}`,
    p.coverLetterBase && `Their own cover letter base (match this voice):\n${p.coverLetterBase}`,
    answers && `Saved answers:\n${answers}`,
    p.cvText && `Full CV:\n${String(p.cvText).slice(0, 12000)}`
  ].filter(Boolean).join('\n');
}

// Everything the applicant wrote themselves: used to spot invented numbers.
function sourceMaterial(state) {
  const p = state.profile;
  return [p.summary, p.skills, p.headline, p.cvText, p.coverLetterBase, p.gpa, p.yearsExperience, ...(state.answers || []).map((a) => a.a)].filter(Boolean).join('\n');
}

// Ask Claude, check the result, and retry once with the problems spelled out.
async function writeChecked({ apiKey, model, system, prompt, maxTokens, source, minWords, render = (x) => x }) {
  let raw = await callClaude({ apiKey, model, system, prompt, maxTokens });
  let check = checkWriting(render(raw), { source, minWords });
  if (!check.ok) {
    const retry = `${prompt}\n\nYour previous draft had these problems, fix all of them:\n- ${check.issues.join('\n- ')}`;
    raw = await callClaude({ apiKey, model, system, prompt: retry, maxTokens });
    check = checkWriting(render(raw), { source, minWords });
  }
  return { raw, issues: check.issues };
}

const SYSTEM = `You help a university student apply for internships and junior jobs.
Write in first person as the applicant. Be specific, warm and concise. Never invent
experience, employers, numbers or skills that are not in the profile. Plain text only,
no markdown, no placeholders in brackets. Sound like a real person: no recruiter
clichés ("passionate", "team player", "proven track record", "eager to", "leverage")
and no preamble such as "Here is".`;

function templateLetter(state, job) {
  const p = state.profile;
  const name = `${p.firstName} ${p.lastName}`.trim() || 'Your Name';
  const company = job.company || 'your company';
  const role = job.role || 'this role';
  if (p.coverLetterBase) {
    return p.coverLetterBase
      .replace(/\{company\}/gi, company)
      .replace(/\{role\}/gi, role)
      .replace(/\{name\}/gi, name);
  }
  const edu = [p.degree, p.major].filter(Boolean).join(' in ');
  const skills = (p.skills || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 4).join(', ');
  return `Dear Hiring Team at ${company},

I am writing to apply for the ${role} position. I am currently studying ${edu || 'at university'}${p.university ? ' at ' + p.university : ''}, and this role is a strong match for what I want to learn and contribute.

${p.summary ? p.summary.split('\n')[0] + '\n\n' : ''}${skills ? `I would bring skills in ${skills}, ` : 'I would bring '}a quick learning pace, and a reliable, detail-oriented way of working. I am available to start ${String(p.startDate || 'soon').toLowerCase()}${p.languages ? ' and work in ' + p.languages : ''}.

Thank you for considering my application. I would welcome the chance to discuss how I can help ${company}.

Kind regards,
${name}
${[p.email, p.phone].filter(Boolean).join(' | ')}`;
}

async function coverLetter(state, apiKey, job) {
  if (!state.settings.aiEnabled || !apiKey) return { text: templateLetter(state, job), source: 'template' };
  const prompt = `APPLICANT PROFILE\n${profileBlock(state)}\n\nJOB\nCompany: ${job.company || 'unknown'}\nRole: ${job.role || 'unknown'}\nDescription:\n${String(job.text || '').slice(0, 9000)}\n\nWrite a cover letter of 180-260 words tailored to this job. Connect 2-3 concrete things from the profile to the job's needs. End with the applicant's name.`;
  const { raw, issues } = await writeChecked({ apiKey, model: state.settings.model, system: SYSTEM, prompt, source: sourceMaterial(state), minWords: 120 });
  return { text: raw, source: 'claude', issues };
}

// Answer open questions found on an application form.
async function answerQuestions(state, apiKey, job, questions) {
  if (!questions.length) return [];
  if (!state.settings.aiEnabled || !apiKey) {
    return questions.map((q) => ({ id: q.id, answer: matchSaved(state, q.label) }));
  }
  const prompt = `APPLICANT PROFILE\n${profileBlock(state)}\n\nJOB PAGE (may be partial)\n${String(job.text || '').slice(0, 6000)}\n\nAnswer each application-form question below in 40-120 words (shorter if the question clearly wants a short answer). Return ONLY JSON: an array of {"id": string, "answer": string} in the same order.\n\nQUESTIONS\n${JSON.stringify(questions.map((q) => ({ id: q.id, question: q.label, maxLength: q.maxLength || null })))}`;
  const raw = await callClaude({ apiKey, model: state.settings.model, system: SYSTEM, prompt, maxTokens: 2500 });
  const json = raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1);
  try { return JSON.parse(json); } catch { throw new Error('Could not read the AI answer. Try again.'); }
}

function matchSaved(state, label) {
  const words = (s) => new Set(String(s).toLowerCase().match(/[a-z]{4,}/g) || []);
  const lw = words(label);
  let best = { score: 0, a: '' };
  for (const item of state.answers || []) {
    if (!item.a) continue;
    const qw = words(item.q);
    let s = 0;
    for (const w of qw) if (lw.has(w)) s++;
    if (s > best.score) best = { score: s, a: item.a };
  }
  return best.a;
}

async function parseCv(state, apiKey, cvText) {
  if (!apiKey) throw new Error('Add your Claude API key in Settings to import from a CV.');
  const keys = ['firstName', 'lastName', 'email', 'phone', 'address', 'city', 'postcode', 'country', 'linkedin', 'website', 'university', 'degree', 'major', 'gradYear', 'gpa', 'headline', 'summary', 'skills', 'languages'];
  const prompt = `Extract the applicant's details from this CV. Return ONLY a JSON object with these string keys (empty string if unknown): ${keys.join(', ')}.\n"summary" = 3-5 lines describing their experience. "skills" and "languages" = comma-separated.\n\nCV:\n${String(cvText).slice(0, 15000)}`;
  const raw = await callClaude({ apiKey, model: state.settings.model, system: 'You extract structured data. Output JSON only.', prompt, maxTokens: 1500 });
  const obj = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  const out = {};
  for (const k of keys) if (typeof obj[k] === 'string') out[k] = obj[k];
  return out;
}

function parseJson(raw) {
  const i = raw.indexOf('{');
  const j = raw.lastIndexOf('}');
  if (i < 0 || j < i) throw new Error('Could not read the AI answer. Try again.');
  return JSON.parse(raw.slice(i, j + 1));
}

// AI fit score (1-10) with the reasons, next to the offline rule-based score.
async function aiFit(state, apiKey, job) {
  if (!apiKey) throw new Error('Add your Claude API key in Settings to get an AI score.');
  const pr = state.preferences || {};
  const prompt = `APPLICANT PROFILE\n${profileBlock(state)}\n\nWHAT THEY WANT\nRoles: ${pr.targetRoles || '-'}\nPlaces: ${pr.locations || '-'}\nAvoid: ${pr.avoidKeywords || '-'}\nPaid only: ${pr.paidOnly ? 'yes' : 'no'}\n\nJOB\nCompany: ${job.company || 'unknown'}\nRole: ${job.role || 'unknown'}\n${String(job.text || '').slice(0, 9000)}

Score how well this applicant fits this job and how likely they are to get an interview.
9-10 = meets nearly every requirement; 7-8 = most requirements, small gaps; 5-6 = some relevant skills but key gaps; 3-4 = big gaps; 1-2 = different field or level.
Be realistic about seniority, years of experience, required languages, location and work permit.
Return ONLY JSON: {"score": 1-10, "matches": [up to 6 short strengths], "gaps": [up to 5 short gaps], "keywords": [up to 10 words from the job ad worth mirroring in the CV], "reasoning": "2 sentences"}`;
  const raw = await callClaude({ apiKey, model: state.settings.model, system: 'You are a realistic recruiter. Output JSON only.', prompt, maxTokens: 900 });
  const o = parseJson(raw);
  const arr = (x) => (Array.isArray(x) ? x.map(String).slice(0, 10) : []);
  return { score: Math.max(1, Math.min(10, Math.round(Number(o.score) || 1))), matches: arr(o.matches), gaps: arr(o.gaps), keywords: arr(o.keywords), reasoning: String(o.reasoning || '') };
}

function cvToText(cv) {
  const lines = [cv.name, cv.contact, '', cv.headline, '', 'SUMMARY', cv.summary, ''];
  if (cv.skills?.length) lines.push('SKILLS', cv.skills.join(' · '), '');
  for (const sec of cv.sections || []) {
    lines.push(String(sec.title || '').toUpperCase());
    for (const it of sec.items || []) {
      lines.push([it.heading, it.sub].filter(Boolean).join(' | '));
      for (const b of it.bullets || []) lines.push('• ' + b);
    }
    lines.push('');
  }
  return lines.filter((l) => l != null).join('\n').trim();
}

// Rewrites the applicant's CV for one job: reorders and rewords, never invents.
async function tailorCv(state, apiKey, job) {
  if (!apiKey) throw new Error('Add your Claude API key in Settings to tailor your CV.');
  const p = state.profile;
  if (!p.cvText && !p.summary) throw new Error('Paste your CV text in Profile & CV first (the "CV text" box).');
  const prompt = `APPLICANT PROFILE\n${profileBlock(state)}\n\nJOB\nCompany: ${job.company || 'unknown'}\nRole: ${job.role || 'unknown'}\n${String(job.text || '').slice(0, 8000)}

Rewrite the applicant's CV for this job so a recruiter scanning for 6 seconds sees the fit.
- Headline: match the job's title and level, stay truthful (a student stays a student).
- Summary: 2-3 sentences leading with what this job needs most.
- Skills: only skills from the profile/CV, most relevant first. You may use the job's wording for a skill the applicant clearly has.
- Experience, projects, education, activities: keep every real employer, school, title and date exactly. Reorder bullets by relevance and reword them as strong verb + what was done + result. Max 4 bullets per item. Drop what is irrelevant.
- NEVER add employers, degrees, certificates, tools or numbers that are not in the profile/CV. Keep every number exactly as written.
- Must fit on one page.
Return ONLY JSON: {"headline": "", "summary": "", "skills": [""], "sections": [{"title": "Experience", "items": [{"heading": "Role, Organisation", "sub": "City | dates", "bullets": [""]}]}]}`;
  const header = {
    name: `${p.firstName} ${p.lastName}`.trim(),
    contact: [p.email, p.phone, [p.city, p.country].filter(Boolean).join(', '), p.linkedin, p.github || p.website].filter(Boolean).join(' | ')
  };
  const render = (raw) => { try { return cvToText({ ...parseJson(raw), ...header }); } catch { return raw; } };
  const { raw, issues } = await writeChecked({ apiKey, model: state.settings.model, system: SYSTEM + '\nOutput JSON only.', prompt, maxTokens: 3000, source: sourceMaterial(state), render });
  const cv = { ...parseJson(raw), ...header }; // name and contact always come from the profile, never the AI
  return { cv, text: cvToText(cv), issues };
}

async function testKey(apiKey, model) {
  await callClaude({ apiKey, model, system: 'Reply with OK.', prompt: 'ping', maxTokens: 5 });
  return true;
}

module.exports = { coverLetter, answerQuestions, parseCv, testKey, matchSaved, aiFit, tailorCv, cvToText };
