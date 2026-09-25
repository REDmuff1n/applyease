// Checks AI-written letters, answers and CVs before they reach a form:
// recruiter-cliché phrases, chatbot leftovers, unfilled placeholders and
// numbers that don't appear anywhere in the applicant's own material.

const CLICHES = [
  'passionate about', 'i am excited to', "i'm excited to", 'thrilled to', 'eager to',
  'proven track record', 'track record of success', 'team player', 'self-starter', 'go-getter',
  'fast learner', 'quick learner', 'hard-working', 'hardworking', 'detail-oriented', 'results-driven',
  'highly motivated', 'think outside the box', 'synergy', 'leverage my', 'leveraged', 'spearheaded',
  'cutting-edge', 'state-of-the-art', 'world-class', 'best-in-class', 'dynamic environment',
  'fast-paced environment', 'perfect fit', 'ideal candidate', 'unique blend', 'wealth of experience',
  'extensive experience', 'deep understanding', 'strong communicator', 'excellent communication skills',
  'i believe i would be', 'i am confident that', 'furthermore', 'moreover', 'in conclusion'
];

const LEAKS = [
  'as an ai', 'as a language model', 'i cannot', "i can't help", 'here is the', "here's the", 'here is a',
  'below is', 'certainly!', 'sure!', 'i hope this helps', 'let me know if', 'feel free to adjust',
  'i have rewritten', 'i have tailored', 'note:', 'disclaimer:'
];

const PLACEHOLDER = /\[[^\]\n]{2,40}\]|\{[a-z_ ]{2,30}\}|<[A-Z][A-Za-z ]{2,30}>|\b(company name|hiring manager name|your name)\b/i;

// Numbers worth protecting: percentages, money, counts like "20+" or "3x".
function numbersIn(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/(?:[$€£]\s?)?\d[\d,.]*\s?(?:%|\+|x\b|k\b|m\b)?/gi)) {
    const n = m[0].replace(/[\s,$€£]/g, '').toLowerCase();
    if (/^(19|20)\d\d$/.test(n)) continue; // years
    if (/^\d$/.test(n)) continue; // single digits are usually harmless (e.g. "3 projects")
    out.add(n.replace(/\.$/, ''));
  }
  return out;
}

// source: all of the applicant's real material (profile + CV + saved answers).
function checkWriting(text, { source = '', minWords = 0 } = {}) {
  const t = String(text || '');
  const lower = t.toLowerCase();
  const issues = [];
  const cliches = CLICHES.filter((p) => lower.includes(p));
  if (cliches.length) issues.push(`Cliché phrases: ${cliches.slice(0, 6).map((c) => `"${c}"`).join(', ')}`);
  const leaks = LEAKS.filter((p) => lower.includes(p));
  if (leaks.length) issues.push(`Chatbot wording left in: ${leaks.slice(0, 4).map((c) => `"${c}"`).join(', ')}`);
  const ph = t.match(PLACEHOLDER);
  if (ph) issues.push(`Unfilled placeholder: ${ph[0]}`);
  if (/[#*]{2,}|^#+\s/m.test(t)) issues.push('Contains markdown formatting');
  if (minWords && t.split(/\s+/).filter(Boolean).length < minWords) issues.push('Too short');
  if (source) {
    const real = numbersIn(source);
    const invented = [...numbersIn(t)].filter((n) => !real.has(n) && !real.has(n.replace(/[%+xkm]$/, '')));
    if (invented.length) issues.push(`Numbers not found in your profile or CV (check they're true): ${invented.slice(0, 6).join(', ')}`);
  }
  return { ok: issues.length === 0, issues };
}

module.exports = { checkWriting, numbersIn, CLICHES, LEAKS };
