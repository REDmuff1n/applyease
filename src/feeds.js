// Live job feeds for the "Live jobs" dashboard. Every source here is an
// official API or feed its owner publishes for reuse. LinkedIn, Indeed and
// Glassdoor listings come through JSearch (Google for Jobs), not by scraping.
const { htmlToText } = require('./jobdata');
const { discover } = require('./discover');

const HOUR = 36e5;
const iso = (x) => {
  if (x == null || x === '') return '';
  const d = typeof x === 'number' ? new Date(x < 1e12 ? x * 1000 : x) : new Date(x);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
};
const words = (s) => String(s || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

async function getJson(fetchFn, url, init = {}) {
  const res = await fetchFn(url, { ...init, headers: { accept: 'application/json', 'user-agent': 'ApplyEase (+https://github.com/REDmuff1n/applyease)', ...(init.headers || {}) } });
  if (res.status === 401 || res.status === 403) throw new Error('key rejected or access denied');
  if (res.status === 429) throw new Error('rate limit reached, try again later');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// id: settings key; minHours: shortest refresh interval (some feeds ask for this);
// key: name of the API key secret, if one is needed.
const SOURCES = {
  arbeitnow: {
    label: 'Arbeitnow', about: 'Europe-focused job board (lots of Germany, English-speaking roles). No key needed.', minHours: 0.3,
    async fetch({ fetchFn }) {
      const out = [];
      for (let page = 1; page <= 3; page++) {
        const d = await getJson(fetchFn, `https://www.arbeitnow.com/api/job-board-api?page=${page}`);
        for (const j of d.data || []) {
          out.push({ id: 'an-' + j.slug, role: j.title, company: j.company_name, location: [j.location, j.remote ? 'Remote' : ''].filter(Boolean).join(' · '), url: j.url, posted: iso(j.created_at), text: htmlToText(j.description), tags: [...(j.job_types || []), ...(j.tags || [])] });
        }
        if (!d.links?.next) break;
      }
      return out;
    }
  },
  himalayas: {
    label: 'Himalayas', about: 'Remote jobs worldwide, with location and seniority. No key needed.', minHours: 0.3,
    async fetch({ fetchFn, keywords }) {
      const map = (j) => ({ id: 'hi-' + j.guid, role: j.title, company: j.companyName, location: ['Remote', ...(j.locationRestrictions || [])].join(' · '), url: j.applicationLink || j.guid, posted: iso(j.pubDate), text: htmlToText(j.description || j.excerpt), tags: [j.employmentType, ...(j.seniority || [])].filter(Boolean) });
      const out = [];
      for (const k of keywords.slice(0, 4)) {
        const d = await getJson(fetchFn, `https://himalayas.app/jobs/api/search?q=${encodeURIComponent(k)}&limit=20`);
        out.push(...(d.jobs || []).map(map));
      }
      let cursor = '';
      for (let i = 0; i < 3; i++) {
        const d = await getJson(fetchFn, `https://himalayas.app/jobs/api?limit=20${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
        out.push(...(d.jobs || []).map(map));
        if (!d.nextCursor) break;
        cursor = d.nextCursor;
      }
      return out;
    }
  },
  remotive: {
    label: 'Remotive', about: 'Remote jobs. Remotive asks apps to refresh at most 4 times a day and to credit them, so listings link back to Remotive. No key needed.', minHours: 6,
    async fetch({ fetchFn, keywords }) {
      const out = [];
      for (const k of (keywords.length ? keywords : ['']).slice(0, 3)) {
        const d = await getJson(fetchFn, `https://remotive.com/api/remote-jobs?limit=100${k ? '&search=' + encodeURIComponent(k) : ''}`);
        out.push(...(d.jobs || []).map((j) => ({ id: 'rm-' + j.id, role: j.title, company: j.company_name, location: ['Remote', j.candidate_required_location].filter(Boolean).join(' · '), url: j.url, posted: iso(j.publication_date), text: [htmlToText(j.description), j.salary && 'Salary: ' + j.salary].filter(Boolean).join('\n'), tags: [j.job_type, j.category].filter(Boolean) })));
      }
      return out;
    }
  },
  remoteok: {
    label: 'Remote OK', about: 'Remote tech jobs. Listings link back to Remote OK as their terms ask. No key needed.', minHours: 1,
    async fetch({ fetchFn }) {
      const d = await getJson(fetchFn, 'https://remoteok.com/api');
      return (Array.isArray(d) ? d : []).filter((j) => j.id && j.position).map((j) => ({ id: 'ro-' + j.id, role: j.position, company: j.company, location: ['Remote', j.location].filter(Boolean).join(' · '), url: j.url, posted: iso(j.date || j.epoch), text: htmlToText(j.description), tags: j.tags || [] }));
    }
  },
  themuse: {
    label: 'The Muse', about: 'Internships and entry-level jobs, mostly US. No key needed.', minHours: 1,
    async fetch({ fetchFn }) {
      const out = [];
      for (let page = 0; page < 5; page++) {
        const d = await getJson(fetchFn, `https://www.themuse.com/api/public/jobs?page=${page}&level=Internship&level=Entry%20Level`);
        out.push(...(d.results || []).map((j) => ({ id: 'mu-' + j.id, role: j.name, company: j.company?.name, location: (j.locations || []).map((l) => l.name).join(' / '), url: j.refs?.landing_page, posted: iso(j.publication_date), text: htmlToText(j.contents), tags: (j.levels || []).map((l) => l.name) })));
        if (page + 1 >= (d.page_count || 0)) break;
      }
      return out;
    }
  },
  boards: {
    label: 'Your company boards', about: 'The career boards you added under Find jobs (Greenhouse, Lever, Ashby, Workable, SmartRecruiters).', minHours: 0.3,
    async fetch({ fetchFn, state }) {
      if (!String(state.preferences?.boards || '').trim()) return [];
      const r = await discover(state, { boards: state.preferences.boards, keywords: '', locations: '', fetchFn });
      const jobs = r.results.map((j) => ({ id: j.id, role: j.role, company: j.company, location: j.location, url: j.url, posted: iso(j.posted), text: j.text, tags: [j.ats] }));
      return { jobs, warnings: r.errors }; // one broken board shouldn't hide the others
    }
  },
  adzuna: {
    label: 'Adzuna', about: 'Big aggregator across the UK, US, Germany, Austria, Netherlands, Poland and more. Free key from developer.adzuna.com.', key: 'feed:adzuna', minHours: 0.5, keyUrl: 'https://developer.adzuna.com/signup',
    async fetch({ fetchFn, keywords, locations, keys, feeds }) {
      if (!feeds.adzunaAppId || !keys['feed:adzuna']) throw new Error('add your Adzuna App ID and key in Settings');
      const out = [];
      const where = locations.find((l) => !/remote/i.test(l)) || '';
      for (const k of (keywords.length ? keywords : ['']).slice(0, 3)) {
        const q = new URLSearchParams({ app_id: feeds.adzunaAppId, app_key: keys['feed:adzuna'], results_per_page: '50', max_days_old: String(feeds.maxAgeDays || 7), sort_by: 'date', what: k });
        if (where) q.set('where', where);
        const d = await getJson(fetchFn, `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(feeds.adzunaCountry || 'gb')}/search/1?${q}`);
        out.push(...(d.results || []).map((j) => ({ id: 'az-' + j.id, role: htmlToText(j.title), company: j.company?.display_name, location: j.location?.display_name, url: j.redirect_url, posted: iso(j.created), text: [htmlToText(j.description), j.salary_min && `Salary: ${Math.round(j.salary_min)}–${Math.round(j.salary_max || j.salary_min)}`].filter(Boolean).join('\n'), tags: [j.contract_time, j.contract_type].filter(Boolean) })));
      }
      return out;
    }
  },
  jooble: {
    label: 'Jooble', about: 'Aggregator covering 60+ countries, including Hungary and most of Europe. Free key from jooble.org/api/about.', key: 'feed:jooble', minHours: 0.5, keyUrl: 'https://jooble.org/api/about',
    async fetch({ fetchFn, keywords, locations, keys }) {
      if (!keys['feed:jooble']) throw new Error('add your Jooble key in Settings');
      const out = [];
      const where = locations.find((l) => !/remote/i.test(l)) || '';
      for (const k of (keywords.length ? keywords : ['']).slice(0, 3)) {
        const d = await getJson(fetchFn, `https://jooble.org/api/${encodeURIComponent(keys['feed:jooble'])}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keywords: k, location: where, page: '1' }) });
        out.push(...(d.jobs || []).map((j) => ({ id: 'jo-' + j.id, role: htmlToText(j.title), company: j.company, location: j.location, url: j.link, posted: iso(j.updated), text: [htmlToText(j.snippet), j.salary && 'Salary: ' + j.salary].filter(Boolean).join('\n'), tags: [j.type, j.source].filter(Boolean) })));
      }
      return out;
    }
  },
  jsearch: {
    label: 'LinkedIn · Indeed · Glassdoor (JSearch)', about: 'Jobs posted on LinkedIn, Indeed, Glassdoor, ZipRecruiter and company sites, through Google for Jobs. Free RapidAPI key (about 200 searches a month), so it refreshes twice a day.', key: 'feed:jsearch', minHours: 12, keyUrl: 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch',
    async fetch({ fetchFn, keywords, locations, keys, feeds }) {
      if (!keys['feed:jsearch']) throw new Error('add your RapidAPI key in Settings');
      const out = [];
      const age = (feeds.maxAgeDays || 7) <= 1 ? 'today' : feeds.maxAgeDays <= 3 ? '3days' : 'week';
      // One search per place (max 2) keeps a refresh to 2 requests of the free quota.
      const what = (keywords.length ? keywords : ['internship']).slice(0, 4).join(' OR ');
      for (const l of (locations.length ? locations : ['']).slice(0, 2)) {
        const query = /remote/i.test(l) ? `${what} remote` : l ? `${what} in ${l}` : what;
        const q = new URLSearchParams({ query, page: '1', num_pages: '1', date_posted: age });
        if (/remote/i.test(l)) q.set('work_from_home', 'true');
        const d = await getJson(fetchFn, `https://jsearch.p.rapidapi.com/search?${q}`, { headers: { 'x-rapidapi-key': keys['feed:jsearch'], 'x-rapidapi-host': 'jsearch.p.rapidapi.com' } });
        out.push(...(d.data || []).map((j) => ({ id: 'js-' + j.job_id, role: j.job_title, company: j.employer_name, location: [[j.job_city, j.job_country].filter(Boolean).join(', '), j.job_is_remote ? 'Remote' : ''].filter(Boolean).join(' · '), url: j.job_apply_link || j.job_google_link, posted: iso(j.job_posted_at_datetime_utc || j.job_posted_at_timestamp), text: htmlToText(j.job_description), tags: [j.job_publisher, j.job_employment_type].filter(Boolean), via: j.job_publisher })));
      }
      return out;
    }
  }
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Fetch every enabled source that is due, merge into the cache and return it.
// cache = { jobs: [], status: { [source]: { fetchedAt, ok, count, error } }, lastViewedAt }
async function refresh(state, cache, { keys = {}, force = false, fetchFn = fetch, now = Date.now() } = {}) {
  const feeds = state.feeds || {};
  const keywords = words(state.preferences?.targetRoles);
  const locations = words(state.preferences?.locations);
  const status = { ...(cache.status || {}) };
  const due = Object.entries(SOURCES).filter(([id, src]) => {
    if (!feeds[id]) return false;
    if (src.key && !keys[src.key]) {
      status[id] = { ...(status[id] || {}), ok: false, error: `add your ${id === 'jsearch' ? 'RapidAPI' : src.label} key in Settings` };
      return false;
    }
    const last = Date.parse(status[id]?.fetchedAt || 0) || 0;
    const failed = Date.parse(status[id]?.failedAt || 0) || 0;
    if (now - failed < 5 * 60000) return false; // a failed source gets a 5-minute pause
    // A manual refresh (or app start) may re-fetch after 5 minutes, except feeds
    // that ask for a longer gap or have a small free quota.
    const hours = force && src.minHours < 1 ? 1 / 12 : src.minHours;
    return now - last >= hours * HOUR;
  });

  // A source returns a list of jobs, or { jobs, warnings } when only part of it failed.
  const settled = await Promise.allSettled(due.map(([id, src]) => src.fetch({ fetchFn, keywords, locations, keys, feeds, state })
    .then((r) => (Array.isArray(r) ? { id, jobs: r, warnings: [] } : { id, jobs: r.jobs, warnings: r.warnings || [] }))));
  const fresh = [];
  settled.forEach((r, i) => {
    const id = due[i][0];
    if (r.status === 'fulfilled') {
      status[id] = { fetchedAt: new Date(now).toISOString(), ok: true, count: r.value.jobs.length, ...(r.value.warnings.length ? { warnings: r.value.warnings } : {}) };
      fresh.push(...r.value.jobs.map((j) => ({ ...j, source: id })));
    } else {
      // keep fetchedAt so a fixed key or a passing outage is retried soon
      status[id] = { ...(status[id] || {}), failedAt: new Date(now).toISOString(), ok: false, error: r.reason?.message || String(r.reason) };
    }
  });

  // Merge: keep when we first saw each job (for "New" badges), refresh its details.
  const byKey = new Map();
  const keyOf = (j) => j.url || `${norm(j.company)}|${norm(j.role)}`;
  for (const j of cache.jobs || []) if (feeds[j.source]) byKey.set(keyOf(j), j);
  const nowIso = new Date(now).toISOString();
  // Same role at the same company from a *different* source is a duplicate; one company
  // listing the same title in several cities is not.
  const dupes = new Map([...byKey.values()].map((j) => [`${norm(j.company)}|${norm(j.role)}`, j.source]));
  for (const j of fresh) {
    if (!j.url || !j.role) continue;
    const k = keyOf(j);
    const old = byKey.get(k);
    const sameJob = `${norm(j.company)}|${norm(j.role)}`;
    if (!old && dupes.has(sameJob) && dupes.get(sameJob) !== j.source) continue;
    if (!dupes.has(sameJob)) dupes.set(sameJob, j.source);
    byKey.set(k, { ...j, text: String(j.text || '').slice(0, 5000), firstSeen: old?.firstSeen || nowIso });
  }
  const maxAge = (feeds.maxAgeDays || 7) * 24 * HOUR;
  // Company boards only list jobs that are still open, so their older postings stay;
  // a fresh fetch replaces them, which drops the ones that closed.
  // (If some boards failed this time, keep what we had rather than dropping their jobs.)
  const boardUrls = due.some(([id]) => id === 'boards') && status.boards?.ok && !status.boards.warnings ? new Set(fresh.filter((j) => j.source === 'boards').map((j) => j.url)) : null;
  const jobs = [...byKey.values()]
    .filter((j) => (j.source === 'boards'
      ? !boardUrls || boardUrls.has(j.url)
      : now - (Date.parse(j.posted || j.firstSeen) || now) <= maxAge))
    .sort((a, b) => String(b.posted || b.firstSeen).localeCompare(String(a.posted || a.firstSeen)))
    .slice(0, 2000);
  return { ...cache, jobs, status, fetchedAt: nowIso };
}

// Quick searches on the big boards, opened in the ApplyEase window where the
// user browses (and logs in) themselves. Nothing is scraped.
function boardSearchLinks(prefs, maxAgeDays = 1) {
  const k = words(prefs?.targetRoles).slice(0, 3).join(' OR ');
  const l = words(prefs?.locations).find((x) => !/remote/i.test(x)) || '';
  const remote = /remote/i.test(prefs?.locations || '');
  const secs = Math.max(1, maxAgeDays) * 86400;
  const e = encodeURIComponent;
  return [
    { label: 'LinkedIn', url: `https://www.linkedin.com/jobs/search/?keywords=${e(k)}&location=${e(l)}&f_TPR=r${secs}${remote && !l ? '&f_WT=2' : ''}&sortBy=DD` },
    { label: 'Indeed', url: `https://www.indeed.com/jobs?q=${e(k)}&l=${e(l || (remote ? 'Remote' : ''))}&fromage=${Math.max(1, maxAgeDays)}&sort=date` },
    { label: 'Glassdoor', url: `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${e(k)}&locKeyword=${e(l)}&fromAge=${Math.max(1, maxAgeDays)}&sortBy=date_desc` }
  ];
}

module.exports = { SOURCES, refresh, boardSearchLinks };
