// Finds open jobs on company career boards through the public job-board APIs
// that Greenhouse, Lever, Ashby, Workable and SmartRecruiters publish for
// exactly this purpose. No scraping, no logins.
const { htmlToText } = require('./jobdata');
const { checkFit } = require('./fit');
const { matchJob, prefsOf } = require('./match');

const pretty = (slug) => String(slug).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Accepts "greenhouse:stripe", "lever/palantir" or a board URL like
// https://boards.greenhouse.io/stripe or https://jobs.ashbyhq.com/ramp.
// SmartRecruiters links may add filters, e.g. "smartrecruiters:BoschGroup?country=hu".
function parseBoard(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const m = s.match(/^(greenhouse|lever|ashby|workable|smartrecruiters)\s*[:/]\s*([\w.-]+)(\?\S*)?/i);
  if (m) {
    const b = { ats: m[1].toLowerCase(), slug: m[2] };
    const f = b.ats === 'smartrecruiters' && m[3] ? srFilters(new URLSearchParams(m[3])) : '';
    return f ? { ...b, query: f } : b;
  }
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  const q = u.searchParams;
  if (/greenhouse\.io$/.test(host)) {
    const slug = q.get('for') || (parts[0] === 'embed' ? q.get('for') : parts[0]);
    return slug ? { ats: 'greenhouse', slug } : null;
  }
  if (/lever\.co$/.test(host) && parts[0]) return { ats: 'lever', slug: parts[0] };
  if (/ashbyhq\.com$/.test(host) && parts[0]) return { ats: 'ashby', slug: parts[0] };
  if (/workable\.com$/.test(host)) {
    const sub = host.split('.')[0];
    const slug = host.startsWith('apply.') ? parts[0] : sub;
    return slug && slug !== 'www' ? { ats: 'workable', slug } : null;
  }
  if (/smartrecruiters\.com$/.test(host) && parts[0]) {
    const f = srFilters(q);
    return f ? { ats: 'smartrecruiters', slug: parts[0], query: f } : { ats: 'smartrecruiters', slug: parts[0] };
  }
  return null;
}

// Filters the SmartRecruiters postings API understands.
function srFilters(params) {
  const keep = new URLSearchParams();
  for (const k of ['country', 'city', 'region', 'department', 'q']) if (params.get(k)) keep.set(k, params.get(k));
  return keep.toString();
}

const boardName = (b) => `${b.ats}:${b.slug}${b.query ? '?' + b.query : ''}`;

// One retry after a short pause for rate limits, server errors and network blips.
async function getJson(fetchFn, url, retries = 1) {
  let res;
  try {
    res = await fetchFn(url, { headers: { accept: 'application/json' } });
  } catch (e) {
    if (retries) { await pause(1500); return getJson(fetchFn, url, retries - 1); }
    throw e;
  }
  if (res.status === 404) throw new Error('board not found');
  if ((res.status === 429 || res.status >= 500) && retries) { await pause(2000); return getJson(fetchFn, url, retries - 1); }
  if (res.status === 429) throw new Error('the site is rate-limiting requests, try again later');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const FETCHERS = {
  async greenhouse(slug, f) {
    const d = await getJson(f, `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`);
    return (d.jobs || []).map((j) => ({
      id: 'gh-' + j.id, role: j.title, company: j.company_name || pretty(slug),
      location: j.location?.name || '', url: j.absolute_url,
      posted: String(j.first_published || j.updated_at || '').slice(0, 10),
      text: htmlToText(j.content || '')
    }));
  },
  async lever(slug, f) {
    const d = await getJson(f, `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`);
    return (Array.isArray(d) ? d : []).map((j) => ({
      id: 'lv-' + j.id, role: j.text, company: pretty(slug),
      location: [j.categories?.location, j.workplaceType === 'remote' ? 'Remote' : ''].filter(Boolean).join(' · '),
      url: j.hostedUrl || j.applyUrl,
      posted: j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : '',
      text: [j.descriptionPlain, ...(j.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`), j.additionalPlain, j.categories?.commitment].filter(Boolean).join('\n\n')
    }));
  },
  async ashby(slug, f) {
    const d = await getJson(f, `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`);
    return (d.jobs || []).filter((j) => j.isListed !== false).map((j) => ({
      id: 'ab-' + j.id, role: j.title, company: pretty(slug),
      location: [j.location, j.isRemote ? 'Remote' : ''].filter(Boolean).join(' · '),
      url: j.jobUrl || j.applyUrl,
      posted: String(j.publishedAt || '').slice(0, 10),
      text: [j.descriptionPlain || htmlToText(j.descriptionHtml), j.employmentType, j.compensation?.compensationTierSummary].filter(Boolean).join('\n\n')
    }));
  },
  async workable(slug, f) {
    const d = await getJson(f, `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}?details=true`);
    return (d.jobs || []).map((j) => ({
      id: 'wk-' + (j.shortcode || j.id), role: j.title, company: d.name || pretty(slug),
      location: [j.city, j.country, j.telecommuting ? 'Remote' : ''].filter(Boolean).join(', '),
      url: j.url || j.shortlink || `https://apply.workable.com/${slug}/j/${j.shortcode}/`,
      posted: String(j.published_on || j.created_at || '').slice(0, 10),
      text: htmlToText(j.description || '')
    }));
  },
  async smartrecruiters(slug, f, query = '') {
    // Big employers post thousands of jobs: page through up to 500 (add ?country=hu to narrow).
    const content = [];
    for (let offset = 0; offset < 500; offset += 100) {
      const d = await getJson(f, `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=100&offset=${offset}${query ? '&' + query : ''}`);
      content.push(...(d.content || []));
      if (!d.content?.length || offset + 100 >= (d.totalFound || 0)) break;
    }
    // The list endpoint has no description; title + location + type is enough to rank.
    return content.map((j) => ({
      id: 'sr-' + j.id, role: j.name, company: j.company?.name || pretty(slug),
      location: [j.location?.city, j.location?.country?.toUpperCase?.(), j.location?.remote ? 'Remote' : ''].filter(Boolean).join(', '),
      url: `https://jobs.smartrecruiters.com/${slug}/${j.id}`,
      posted: String(j.releasedDate || '').slice(0, 10),
      text: [j.name, j.experienceLevel?.label, j.typeOfEmployment?.label, j.function?.label].filter(Boolean).join('\n')
    }));
  }
};

// Search every board, keep jobs matching the keyword/location filters, score and sort them.
// score: false skips fit scoring (the Live dashboard scores and caches on its own).
async function discover(state, { boards, keywords, locations, fetchFn = fetch, score = true } = {}) {
  const parsed = [];
  const errors = [];
  for (const line of String(boards || '').split(/[\n,]+/)) {
    if (!line.trim()) continue;
    const b = parseBoard(line);
    if (b) parsed.push(b); else errors.push(`Not a supported board: ${line.trim()}`);
  }
  const prefs = { ...prefsOf(state), ...(keywords != null ? { roles: keywords } : {}), ...(locations != null ? { places: locations } : {}) };

  const settled = await Promise.allSettled(parsed.map((b) => FETCHERS[b.ats](b.slug, fetchFn, b.query).then((jobs) => ({ b, jobs }))));
  const seen = new Set();
  const results = [];
  let total = 0;
  settled.forEach((s, i) => {
    if (s.status === 'rejected') { errors.push(`${boardName(parsed[i])} — ${s.reason?.message || s.reason}`); return; }
    if (!s.value.jobs.length) errors.push(`${boardName(parsed[i])} — no open jobs (check the company name in the link)`);
    for (const j of s.value.jobs) {
      total++;
      if (!j.url || seen.has(j.url)) continue;
      seen.add(j.url);
      if (!matchJob(j, prefs)) continue;
      const full = `Job title: ${j.role}\nCompany: ${j.company}\nLocation: ${j.location}\n\n${j.text}`;
      const fit = score ? checkFit(full, state) : { score: 0, verdict: '' };
      results.push({ ...j, ats: s.value.b.ats, text: full.slice(0, 20000), fit: fit.score, verdict: fit.verdict });
    }
  });
  results.sort((a, b) => b.fit - a.fit || String(b.posted).localeCompare(String(a.posted)));
  return { results, total, boards: parsed.length, errors };
}

module.exports = { discover, parseBoard, FETCHERS };
