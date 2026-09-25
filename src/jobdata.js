// Turning job pages into clean data. Reads schema.org JobPosting (JSON-LD) first,
// which most ATS and job boards publish, and falls back to plain page text.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: '–', mdash: '—', hellip: '…', bull: '•' };

function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function htmlToText(html) {
  let s = String(html || '');
  // Some APIs (Greenhouse) send escaped HTML: decode once so the tags can be stripped.
  if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s);
  return decodeEntities(s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<(br|\/p|\/li|\/h\d|\/div|\/ul|\/ol|\/tr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Find a JobPosting object anywhere in a parsed JSON-LD value (@graph, arrays…).
function findPosting(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) { const f = findPosting(n, depth + 1); if (f) return f; }
    return null;
  }
  const type = [].concat(node['@type'] || []).map(String);
  if (type.includes('JobPosting')) return node;
  for (const v of Object.values(node)) { const f = findPosting(v, depth + 1); if (f) return f; }
  return null;
}

function placeText(loc) {
  const one = (l) => {
    const a = l?.address || l || {};
    if (typeof a === 'string') return a;
    return [a.addressLocality, a.addressRegion, typeof a.addressCountry === 'object' ? a.addressCountry?.name : a.addressCountry].filter(Boolean).join(', ');
  };
  return [].concat(loc || []).map(one).filter(Boolean).join(' / ');
}

function salaryText(bs) {
  if (!bs || typeof bs !== 'object') return typeof bs === 'string' ? bs : '';
  const v = bs.value || {};
  const cur = bs.currency || v.currency || '';
  const unit = String(v.unitText || '').toLowerCase();
  const num = (x) => (x == null || x === '' ? '' : Number(x).toLocaleString('en-US'));
  const range = v.minValue != null && v.maxValue != null ? `${num(v.minValue)}–${num(v.maxValue)}` : num(v.value ?? v.minValue ?? v.maxValue);
  return range ? `${range} ${cur}${unit ? ' per ' + unit : ''}`.trim() : '';
}

// Normalise a JobPosting object into the fields ApplyEase uses.
function fromPosting(p) {
  if (!p) return null;
  const org = p.hiringOrganization;
  const remote = /telecommute/i.test(String(p.jobLocationType || '')) ? 'Remote' : '';
  const out = {
    role: decodeEntities(p.title || '').trim(),
    company: decodeEntities(typeof org === 'string' ? org : org?.name || '').trim(),
    location: [placeText(p.jobLocation), remote].filter(Boolean).join(' · '),
    employmentType: [].concat(p.employmentType || []).join(', '),
    salary: salaryText(p.baseSalary),
    datePosted: String(p.datePosted || '').slice(0, 10),
    description: htmlToText(p.description || '')
  };
  return out.role || out.description ? out : null;
}

// From a full HTML page (main process fetch).
function extractJobPosting(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of String(html || '').matchAll(re)) {
    try {
      const found = fromPosting(findPosting(JSON.parse(m[1].trim())));
      if (found) return found;
    } catch { /* malformed JSON-LD: try the next block */ }
  }
  return null;
}

// A readable job text for scoring and AI prompts, with the key facts on top.
function jobText(posting, fallback = '') {
  if (!posting) return fallback;
  const head = [
    posting.role && `Job title: ${posting.role}`,
    posting.company && `Company: ${posting.company}`,
    posting.location && `Location: ${posting.location}`,
    posting.employmentType && `Employment type: ${posting.employmentType}`,
    posting.salary && `Salary: ${posting.salary}`
  ].filter(Boolean).join('\n');
  return `${head}\n\n${posting.description || fallback}`.trim();
}

module.exports = { extractJobPosting, fromPosting, findPosting, htmlToText, decodeEntities, jobText };
