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
  else if (url.includes('jsearch')) body = { data: [{ job_id: 'j1', job_title: 'Finance Analyst Intern', employer_name: 'Gamma', job_publisher: 'LinkedIn', job_apply_link: 'https://linkedin.com/jobs/view/1', job_description: 'Excel', job_city: 'Budapest', job_country: 'HU', job_posted_at_datetime_utc: '2026-09-25T08:00:00Z' }] };
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
  assert.strictEqual(calls.filter((x) => x.url.includes('jsearch')).length, 2, 'one JSearch request per place');
  assert.strictEqual(c.jobs.find((j) => j.role === 'Finance Intern').firstSeen, new Date(NOW).toISOString(), 'first-seen time kept');
  const li = c.jobs.find((j) => j.source === 'jsearch');
  assert.strictEqual(li.via, 'LinkedIn');
  assert.strictEqual(li.firstSeen, new Date(later).toISOString());

  // Turning a source off hides its jobs.
  c = await refresh({ ...state, feeds: { ...state.feeds, remotive: false } }, c, { fetchFn, now: later });
  assert(!c.jobs.some((j) => j.source === 'remotive'));

  const links = boardSearchLinks(state.preferences, 1);
  assert.deepStrictEqual(links.map((l) => l.label), ['LinkedIn', 'Indeed', 'Glassdoor']);
  assert(links[0].url.includes('keywords=finance%20OR%20analyst') && links[0].url.includes('location=Budapest') && links[0].url.includes('f_TPR=r86400'), links[0].url);
  assert(Object.values(SOURCES).every((s) => s.label && s.about && typeof s.fetch === 'function'));
  console.log('feeds tests passed', c.jobs.length, 'jobs');
})().catch((e) => { console.error(e); process.exit(1); });
