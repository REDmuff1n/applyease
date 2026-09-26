// Live feed refresh: parsing, merging, "first seen", dedupe, age filter, rate limits and keys.
const assert = require('assert');
const { refresh, boardSearchLinks, SOURCES } = require('../src/feeds');

const NOW = Date.parse('2026-09-25T12:00:00Z');
const calls = [];
const responses = {
  arbeitnow: (page) => ({ data: page === 1 ? [
    { slug: 'fin-1', company_name: 'Acme', title: 'Finance Intern', description: '<p>Paid. Excel.</p>', remote: false, url: 'https://arbeitnow.com/fin-1', location: 'Berlin', created_at: NOW / 1000 - 3600, job_types: ['internship'] },
    { slug: 'old', company_name: 'OldCo', title: 'Analyst', description: '', url: 'https://arbeitnow.com/old', location: 'Berlin', created_at: NOW / 1000 - 30 * 86400 }
  ] : [], links: { next: null } }),
  remotive: { jobs: [
    { id: 9, url: 'https://remotive.com/9', title: 'Finance Intern', company_name: 'ACME', candidate_required_location: 'Europe', publication_date: '2026-09-24T10:00:00', description: 'same job, other board' },
    { id: 10, url: 'https://remotive.com/10', title: 'Data Analyst', company_name: 'Beta', candidate_required_location: 'Worldwide', publication_date: '2026-09-24T10:00:00', description: 'remote analyst' }
  ] }
};
const fetchFn = async (url, init) => {
  calls.push({ url, init });
  let body;
  if (url.includes('arbeitnow')) body = responses.arbeitnow(+new URL(url).searchParams.get('page'));
  else if (url.includes('remotive')) body = responses.remotive;
  else if (url.includes('jsearch')) body = { status: 'OK', data: { cursor: null, jobs: [{ job_id: 'j1', job_title: 'Finance Analyst Intern', employer_name: 'Gamma', job_publisher: 'LinkedIn', job_apply_link: 'https://linkedin.com/jobs/view/1', job_description: 'Excel', job_city: 'Budapest', job_country: 'HU', job_posted_at_datetime_utc: '2026-09-25T08:00:00Z', job_employment_types: ['FULLTIME'] }] } };
  else return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => body };
};

const state = {
  preferences: { targetRoles: 'finance, analyst', locations: 'Budapest, Remote' },
  feeds: { arbeitnow: true, remotive: true, jsearch: true, maxAgeDays: 7 }
};

(async () => {
  let c = await refresh(state, {}, { fetchFn, now: NOW, keys: {} });
  assert.strictEqual(c.status.jsearch.ok, false);
  assert.match(c.status.jsearch.error, /RapidAPI key/);
  assert.deepStrictEqual(c.jobs.map((j) => j.role).sort(), ['Data Analyst', 'Finance Intern'], 'old job dropped, cross-board duplicate merged');
  const first = c.jobs.find((j) => j.role === 'Finance Intern');
  assert.strictEqual(first.source, 'arbeitnow');
  assert.strictEqual(first.firstSeen, new Date(NOW).toISOString());
  assert(calls.some((x) => x.url.includes('remotive.com/api/remote-jobs?limit=100&search=finance')));

  // 10 minutes later: arbeitnow is due only on a manual refresh, Remotive (6 h rule) never, JSearch with a key.
  calls.length = 0;
  const later = NOW + 10 * 60000; // past the 5-minute pause after JSearch failed
  c = await refresh(state, c, { fetchFn, now: later, keys: {} });
  assert.strictEqual(calls.length, 0, 'nothing due yet: ' + calls.map((x) => x.url));
  c = await refresh(state, c, { fetchFn, now: later, force: true, keys: { 'feed:jsearch': 'rk' } });
  assert(calls.some((x) => x.url.includes('arbeitnow')), 'manual refresh re-fetches arbeitnow');
  assert(!calls.some((x) => x.url.includes('remotive')), 'Remotive asks for max 4 refreshes a day');
  const js = calls.find((x) => x.url.includes('jsearch'));
  assert.strictEqual(js.init.headers['x-rapidapi-key'], 'rk');
  assert(js.url.startsWith('https://jsearch.p.rapidapi.com/search-v2?'), 'JSearch v2 endpoint: ' + js.url);
  assert(js.url.includes('country=us') && js.url.includes('language=en'), js.url);
  assert(js.url.includes('query=finance+analyst+jobs+in+Budapest') || js.url.includes('query=finance+analyst+remote'), 'plain phrase, not OR: ' + js.url);
  assert.strictEqual(calls.filter((x) => x.url.includes('jsearch')).length, 2, 'one JSearch request per place');
  assert.strictEqual(c.jobs.find((j) => j.role === 'Finance Intern').firstSeen, new Date(NOW).toISOString(), 'first-seen time kept');
  const li = c.jobs.find((j) => j.source === 'jsearch');
  assert.strictEqual(li.via, 'LinkedIn');
  assert.strictEqual(li.firstSeen, new Date(later).toISOString());

  assert.deepStrictEqual(li.tags, ['LinkedIn', 'FULLTIME']);

  // The service's own message is shown, not just the status code.
  const said = await refresh({ preferences: {}, feeds: { jsearch: true, jsearchCountry: 'de' } }, {}, { keys: { 'feed:jsearch': 'k' }, now: NOW,
    fetchFn: async (url) => ({ ok: false, status: 404, json: async () => ({ message: "Endpoint '/search' does not exist" }), url }) });
  assert.strictEqual(said.status.jsearch.error, "HTTP 404: Endpoint '/search' does not exist");

  // Turning a source off hides its jobs.
  c = await refresh({ ...state, feeds: { ...state.feeds, remotive: false } }, c, { fetchFn, now: later });
  assert(!c.jobs.some((j) => j.source === 'remotive'));

  // Company boards: old postings stay while listed, closed ones go on the next fetch.
  const boardsState = { preferences: { boards: 'greenhouse:acme' }, feeds: { boards: true, maxAgeDays: 7 } };
  let listed = [1, 2];
  const ghFetch = async () => ({ ok: true, status: 200, json: async () => ({ jobs: listed.map((n) => ({ id: n, title: 'Analyst ' + n, absolute_url: 'https://gh/' + n, location: { name: 'Budapest' }, first_published: '2026-08-01T00:00:00Z', content: 'x' })) }) });
  let b = await refresh(boardsState, {}, { fetchFn: ghFetch, now: NOW });
  assert.strictEqual(b.jobs.length, 2, 'open board jobs kept even when posted weeks ago');
  listed = [2];
  b = await refresh(boardsState, b, { fetchFn: ghFetch, now: NOW + 30 * 60000 });
  assert.deepStrictEqual(b.jobs.map((j) => j.role), ['Analyst 2'], 'closed job removed');

  // Same title in two cities from one company: both kept. A failing board: shown as a warning,
  // old jobs kept; and a rate-limited request is retried once.
  let calls429 = 0;
  const mixed = async (url) => {
    if (url.includes('greenhouse')) return { ok: true, status: 200, json: async () => ({ jobs: [
      { id: 1, title: 'Support Agent', absolute_url: 'https://gh/1', location: { name: 'Budapest' }, content: 'x' },
      { id: 2, title: 'Support Agent', absolute_url: 'https://gh/2', location: { name: 'Boston' }, content: 'x' }] }) };
    calls429++;
    return { ok: false, status: 429, json: async () => ({}) };
  };
  const two = { preferences: { boards: 'greenhouse:acme\nlever:beta' }, feeds: { boards: true } };
  const m = await refresh(two, { jobs: [{ id: 'old', source: 'boards', role: 'Old role', company: 'Beta', url: 'https://lever/old', posted: '2026-01-01', firstSeen: '2026-01-01' }] }, { fetchFn: mixed, now: NOW });
  assert.deepStrictEqual(m.jobs.filter((j) => j.role === 'Support Agent').map((j) => j.url).sort(), ['https://gh/1', 'https://gh/2']);
  assert.strictEqual(calls429, 2, 'retried once');
  assert.match(m.status.boards.warnings[0], /lever:beta — the site is rate-limiting/);
  assert(m.jobs.some((j) => j.id === 'old'), 'jobs from the failing board are kept');

  // Jooble: a city with no results is retried with the profile's country.
  const bodies = [];
  const jo = await refresh({ profile: { country: 'Hungary' }, preferences: { targetRoles: 'analyst', locations: 'Budapest, Remote' }, feeds: { jooble: true } }, {}, { keys: { 'feed:jooble': 'jk' }, now: NOW,
    fetchFn: async (url, init) => { const b = JSON.parse(init.body); bodies.push(b.location); return { ok: true, status: 200, json: async () => ({ totalCount: b.location === 'Hungary' ? 1 : 0, jobs: b.location === 'Hungary' ? [{ id: 7, title: 'Sr Analyst RTR', location: 'Hungary', link: 'https://jooble.org/desc/7', updated: '2026-09-25T00:00:00' }] : [] }) }; } });
  assert.deepStrictEqual(bodies, ['Budapest', 'Hungary']);
  assert.strictEqual(jo.jobs[0].role, 'Sr Analyst RTR');
  assert.strictEqual(jo.lastRefresh.added, 1);
  assert.deepStrictEqual(jo.lastRefresh.empty, []);

  // Company-board jobs are never pushed out by the feed-job limit.
  const many = Array.from({ length: 2600 }, (_, i) => ({ id: 'an-' + i, source: 'arbeitnow', role: 'Job ' + i, company: 'C' + i, url: 'https://a/' + i, posted: new Date(NOW - i * 60000).toISOString(), firstSeen: '2026-09-20T00:00:00Z' }));
  const boardsOld = Array.from({ length: 300 }, (_, i) => ({ id: 'gh-' + i, source: 'boards', role: 'Board ' + i, company: 'B', url: 'https://b/' + i, posted: '2026-06-01T00:00:00Z', firstSeen: '2026-09-20T00:00:00Z' }));
  const capped = await refresh({ preferences: {}, feeds: { arbeitnow: true, boards: true, maxAgeDays: 7 } }, { jobs: [...many, ...boardsOld], status: { arbeitnow: { fetchedAt: new Date(NOW).toISOString() }, boards: { fetchedAt: new Date(NOW).toISOString() } } }, { now: NOW + 1000, fetchFn });
  assert.strictEqual(capped.jobs.filter((j) => j.source === 'boards').length, 300, 'all board jobs kept');
  assert.strictEqual(capped.jobs.filter((j) => j.source === 'arbeitnow').length, 2500, 'feed jobs capped at 2,500');
  assert.deepStrictEqual(capped.lastRefresh.checked, [], 'nothing was due');

  const links = boardSearchLinks(state.preferences, 1);
  assert.deepStrictEqual(links.map((l) => l.label), ['LinkedIn', 'Indeed', 'Glassdoor']);
  assert(links[0].url.includes('keywords=finance%20OR%20analyst') && links[0].url.includes('location=Budapest') && links[0].url.includes('f_TPR=r86400'), links[0].url);
  assert(Object.values(SOURCES).every((s) => s.label && s.about && typeof s.fetch === 'function'));
  console.log('feeds tests passed', c.jobs.length, 'jobs');
})().catch((e) => { console.error(e); process.exit(1); });
