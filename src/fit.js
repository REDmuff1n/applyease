// Rule-based "should I apply?" checker. Works offline, no AI needed.
const list = (s) => String(s || '').split(/[,;\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean);

const LANGS = ['english', 'hungarian', 'german', 'french', 'spanish', 'italian', 'dutch', 'polish', 'czech',
  'slovak', 'romanian', 'portuguese', 'russian', 'ukrainian', 'chinese', 'mandarin', 'japanese', 'korean',
  'arabic', 'turkish', 'swedish', 'danish', 'norwegian', 'finnish', 'greek', 'hindi', 'bengali', 'bangla', 'urdu'];


function checkFit(text, state) {
  const t = ' ' + String(text || '').toLowerCase().replace(/\s+/g, ' ') + ' ';
  const prefs = state.preferences || {};
  const profile = state.profile || {};
  const good = [];
  const bad = [];
  const warn = [];
  let score = 50;

  if (t.trim().length < 40) {
    return { score: 0, verdict: 'Not enough text', good, bad, warn: ['Paste the full job description or open the listing page.'] };
  }

  // Role match
  const roles = list(prefs.targetRoles);
  const roleHits = roles.filter((r) => t.includes(r));
  if (roleHits.length) { score += Math.min(20, roleHits.length * 8); good.push('Matches your target roles: ' + roleHits.join(', ')); }
  else if (roles.length) { score -= 10; warn.push('None of your target role keywords appear'); }

  // Skills match
  const skills = list(profile.skills);
  const skillHits = skills.filter((s) => s.length > 1 && t.includes(s));
  if (skillHits.length) { score += Math.min(15, skillHits.length * 3); good.push('Mentions your skills: ' + skillHits.slice(0, 8).join(', ')); }

  // Location
  const locs = list(prefs.locations);
  const locHits = locs.filter((l) => t.includes(l));
  if (locHits.length) { score += 10; good.push('Location fits: ' + locHits.join(', ')); }
  else if (locs.length) { warn.push('Could not confirm location (' + locs.join(', ') + ')'); }

  // Level
  if (/\b(intern|internship|trainee|graduate|junior|entry[- ]level|working student|student job|praktikum|gyakornok)\b/.test(t)) {
    score += 10; good.push('Entry-level / internship role');
  }
  const yrs = [...t.matchAll(/(\d{1,2})\s*\+?\s*(?:-\s*\d+\s*)?years?(?:'|’)?\s*(?:of\s+)?(?:relevant\s+|professional\s+|work\s+)?experience/g)].map((m) => +m[1]);
  const maxYrs = yrs.length ? Math.max(...yrs) : 0;
  if (maxYrs >= 3) { score -= 20; bad.push(`Asks for ${maxYrs}+ years of experience`); }
  else if (maxYrs >= 1) { warn.push(`Asks for ${maxYrs}+ year(s) of experience`); }
  if (/\b(senior|lead|principal|head of|director|manager)\b/.test(t.slice(0, 400))) { score -= 15; bad.push('Title looks senior'); }

  // Pay
  if (/\bunpaid\b|\bno (salary|compensation|pay)\b|\bvoluntary\b|\bvolunteer\b/.test(t)) {
    if (prefs.paidOnly) { score -= 35; bad.push('Looks unpaid'); } else warn.push('Looks unpaid');
  }
  if (/\b(salary|paid internship|compensation|€|eur|huf|\$|usd|gbp|£|per month|per hour|stipend)\b/.test(t)) good.push('Pay is mentioned');

  // Languages (compares the level the job asks for with the level you listed)
  const mine = languageLevels(profile.languages);
  for (const lang of LANGS) {
    const need = requiredLevel(t, lang);
    if (!need) continue;
    const key = lang === 'bangla' ? 'bengali' : lang === 'mandarin' ? 'chinese' : lang;
    const have = mine[key] || 0;
    if (have >= need) good.push(`Needs ${cap(lang)} — you have it`);
    else if (have) { score -= need - have >= 2 ? 35 : 15; bad.push(`Needs ${levelName(need)} ${cap(lang)} — you listed ${levelName(have)}`); }
    else { score -= 35; bad.push(`Needs ${cap(lang)} — not in your languages`); }
  }

  // Avoid keywords
  const avoid = list(prefs.avoidKeywords).filter((k) => t.includes(k));
  if (avoid.length) { score -= 15 * avoid.length; bad.push('Contains words you avoid: ' + avoid.join(', ')); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const verdict = score >= 70 ? 'Strong fit — apply' : score >= 50 ? 'Decent fit — worth a look' : score >= 30 ? 'Weak fit' : 'Skip';
  return { score, verdict, good, bad, warn };
}

function languageLevels(text) {
  const out = {};
  for (const part of String(text || '').toLowerCase().split(/[,;\n]/)) {
    const lang = LANGS.find((l) => part.includes(l));
    if (!lang) continue;
    const key = lang === 'bangla' ? 'bengali' : lang === 'mandarin' ? 'chinese' : lang;
    let lvl = 5;
    if (/native|mother|c2/.test(part)) lvl = 6;
    else if (/c1|fluent|proficient/.test(part)) lvl = 5;
    else if (/b2|upper|good|conversational/.test(part)) lvl = 4;
    else if (/b1|intermediate/.test(part)) lvl = 3;
    else if (/a2|elementary/.test(part)) lvl = 2;
    else if (/a1|basic|beginner|learning/.test(part)) lvl = 1;
    out[key] = Math.max(out[key] || 0, lvl);
  }
  return out;
}

// 0 = not required; otherwise the minimum level (1-6) the listing asks for
function requiredLevel(t, lang) {
  const near = new RegExp('[^.\\n]{0,45}\\b' + lang + '\\b[^.\\n]{0,35}', 'g');
  let need = 0;
  for (const m of t.matchAll(near)) {
    const s = m[0];
    let lvl = 0;
    if (/native|mother tongue|c2/.test(s)) lvl = 5;
    else if (/fluen|c1|business[- ]level|excellent|proficien|perfect/.test(s)) lvl = 5;
    else if (/strong|advanced|b2|very good/.test(s)) lvl = 4;
    else if (/intermediate|b1|good/.test(s)) lvl = 3;
    else if (/basic|a1|a2|beginner/.test(s)) lvl = 1;
    else if (/required|must|mandatory|essential|needed/.test(s)) lvl = 3;
    if (lvl && /(plus|advantage|nice to have|bonus|preferred|beneficial)/.test(s)) lvl = 0;
    need = Math.max(need, lvl);
  }
  return need;
}

function levelName(n) { return ['', 'basic', 'basic', 'intermediate', 'strong', 'fluent', 'native'][n] || 'some'; }

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Pull company / role guesses from listing text or a page title.
function guessMeta(title, text, url) {
  let company = '';
  let role = '';
  const tt = String(title || '');
  let m = tt.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s*[|\-–—].*)?$/i);
  if (m) { role = m[1]; company = m[2]; }
  else {
    m = tt.match(/^(.+?)\s*[|\-–—]\s*(.+?)(?:\s*[|\-–—].*)?$/);
    if (m) { role = m[1]; company = m[2]; }
  }
  if (!company && url) {
    try {
      const u = new URL(url);
      const parts = u.pathname.split('/').filter(Boolean);
      if (/lever\.co|greenhouse\.io|ashbyhq|workable|recruitee|teamtailor|personio|smartrecruiters/.test(u.hostname) && parts[0]) company = parts[0];
      else company = u.hostname.replace(/^www\.|^jobs\.|^careers\./, '').split('.')[0];
      company = company.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    } catch { /* ignore */ }
  }
  return { company: company.trim().slice(0, 80), role: role.trim().slice(0, 120) };
}

module.exports = { checkFit, guessMeta };
