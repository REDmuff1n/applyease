// Cover letters and answers. Uses Claude when the user adds their own API key,
// otherwise falls back to a fill-in-the-blanks template.

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
    p.headline && `Headline: ${p.headline}`,
    `Education: ${[p.degree, p.major, p.university, p.gradYear && 'grad ' + p.gradYear, p.gpa && 'GPA ' + p.gpa].filter(Boolean).join(', ')}`,
    p.summary && `Experience summary:\n${p.summary}`,
    p.skills && `Skills: ${p.skills}`,
    p.languages && `Languages: ${p.languages}`,
    p.city && `Based in: ${[p.city, p.country].filter(Boolean).join(', ')}`,
    p.startDate && `Can start: ${p.startDate}`,
    p.coverLetterBase && `Their own cover letter base (match this voice):\n${p.coverLetterBase}`,
    answers && `Saved answers:\n${answers}`
  ].filter(Boolean).join('\n');
}

const SYSTEM = `You help a university student apply for internships and junior jobs.
Write in first person as the applicant. Be specific, warm and concise. Never invent
experience, employers, numbers or skills that are not in the profile. Plain text only,
no markdown, no placeholders in brackets.`;

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
  const text = await callClaude({ apiKey, model: state.settings.model, system: SYSTEM, prompt });
  return { text, source: 'claude' };
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

async function testKey(apiKey, model) {
  await callClaude({ apiKey, model, system: 'Reply with OK.', prompt: 'ping', maxTokens: 5 });
  return true;
}

module.exports = { coverLetter, answerQuestions, parseCv, testKey, matchSaved };
