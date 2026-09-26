// Job discovery, JSON-LD extraction and the writing checker, with a stubbed network.
const assert = require('assert');
const { discover, parseBoard } = require('../src/discover');
const { extractJobPosting, htmlToText } = require('../src/jobdata');
const { checkWriting } = require('../src/quality');

// ---- board links ----
assert.deepStrictEqual(parseBoard('https://boards.greenhouse.io/wise'), { ats: 'greenhouse', slug: 'wise' });
assert.deepStrictEqual(parseBoard('https://job-boards.eu.greenhouse.io/embed/job_board?for=acme'), { ats: 'greenhouse', slug: 'acme' });
assert.deepStrictEqual(parseBoard('jobs.lever.co/palantir/123-abc'), { ats: 'lever', slug: 'palantir' });
assert.deepStrictEqual(parseBoard('https://jobs.ashbyhq.com/ramp'), { ats: 'ashby', slug: 'ramp' });
assert.deepStrictEqual(parseBoard('https://apply.workable.com/huggingface/'), { ats: 'workable', slug: 'huggingface' });
assert.deepStrictEqual(parseBoard('smartrecruiters:Bosch'), { ats: 'smartrecruiters', slug: 'Bosch' });
assert.strictEqual(parseBoard('https://example.com/careers'), null);
assert.deepStrictEqual(parseBoard('smartrecruiters:Wise?country=hu'), { ats: 'smartrecruiters', slug: 'Wise', query: 'country=hu' });
assert.deepStrictEqual(parseBoard('https://careers.smartrecruiters.com/BoschGroup?country=hu&utm=x'), { ats: 'smartrecruiters', slug: 'BoschGroup', query: 'country=hu' });

// ---- which jobs count as "mine" ----
const { matchJob } = require('../src/match');
const me = { roles: 'analyst, finance', places: 'Budapest, Remote', home: ['Hungary', 'Budapest'] };
const ok = (role, location) => matchJob({ role, location }, me);
assert(ok('Finance Intern', 'Budapest, Hungary'));
assert(ok('Data Analyst', 'Remote'));
assert(ok('Data Analyst', 'Remote · Worldwide'));
assert(ok('Data Analyst', 'Remote, EMEA'));
assert(ok('Data Analyst', 'Remote - Hungary'));
assert(ok('Data Analyst', ''), 'unknown location is kept');
assert(!ok('Data Analyst', 'Remote - USA'), 'US-only remote');
assert(!ok('Data Analyst', 'US-Remote-CA, US-San Francisco'));
assert(!ok('Data Analyst', 'Berlin · Remote'), 'remote inside another country');
assert(!ok('Data Analyst', 'London'));
assert(!ok('Software Engineer', 'Budapest'), 'role must match');
assert(matchJob({ role: 'Engineer', location: 'Berlin' }, { roles: '', places: '' }), 'no prefs = everything');
const { jobTypes } = require('../src/match');
assert.deepStrictEqual(jobTypes({ role: 'Finance Intern' }), ['internship']);
assert.deepStrictEqual(jobTypes({ role: 'HR business partner gyakornok' }), ['internship']);
assert.deepStrictEqual(jobTypes({ role: 'Werkstudent Vertrieb', tags: ['Part Time'] }), ['student', 'parttime']);
assert.deepStrictEqual(jobTypes({ role: 'Analyst' }, 'This is a full-time, permanent role.'), ['fulltime']);
assert.deepStrictEqual(jobTypes({ role: 'Customer Success Manager - 1 Year Maternity Cover' }), ['contract']);
assert.deepStrictEqual(jobTypes({ role: 'Analyst' }, 'Great team.'), [], 'not stated');
const { placeMatch } = require('../src/match');
assert(!ok('Finance Analyst III - NA', 'Remote'), 'region in the title');
assert(!ok('Strategic Finance Analyst - San Francisco', 'Remote'));
assert(!ok('Commercial Analyst, DACH', 'Remote'));
assert(ok('Finance Analyst - EMEA', 'Remote'), 'EMEA in the title is fine');
assert(ok('Analyst, Budapest team', 'Remote'));
assert(placeMatch({ role: 'Analyst', location: '' }, 'Budapest', []), 'lenient: unknown location kept');
assert(!placeMatch({ role: 'Analyst', location: '' }, 'Budapest', [], { strict: true }), 'strict: unknown location dropped');

// ---- JSON-LD ----
const page = `<html><head><title>x</title><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Other"},
  {"@type":"JobPosting","title":"Finance Intern","hiringOrganization":{"@type":"Organization","name":"Acme &amp; Co"},
   "jobLocation":{"@type":"Place","address":{"addressLocality":"Budapest","addressCountry":"HU"}},
   "baseSalary":{"@type":"MonetaryAmount","currency":"HUF","value":{"minValue":300000,"maxValue":350000,"unitText":"MONTH"}},
   "description":"&lt;p&gt;Support the &lt;b&gt;finance&lt;/b&gt; team.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Excel&lt;/li&gt;&lt;/ul&gt;"}]}</script></head><body>nav nav nav</body></html>`;
const jp = extractJobPosting(page);
assert.strictEqual(jp.role, 'Finance Intern');
assert.strictEqual(jp.company, 'Acme & Co');
assert.strictEqual(jp.location, 'Budapest, HU');
assert.strictEqual(jp.salary, '300,000–350,000 HUF per month');
assert(jp.description.includes('Support the finance team.') && jp.description.includes('• Excel'), jp.description);
assert.strictEqual(extractJobPosting('<script type="application/ld+json">{bad json</script>'), null);
assert.strictEqual(htmlToText('a&nbsp;&amp;&#39;b&#x41;'), "a &'bA");

// ---- writing checker ----
const bad = checkWriting('Here is the letter. I am passionate about finance and cut costs by 45%. Regards, [Your Name]', { source: 'I cut costs by 30% at work.' });
assert(bad.issues.some((i) => /Cliché/.test(i)), 'cliché flagged');
assert(bad.issues.some((i) => /Chatbot/.test(i)), 'leak flagged');
assert(bad.issues.some((i) => /placeholder/.test(i)), 'placeholder flagged');
assert(bad.issues.some((i) => /45%/.test(i)) && !bad.issues.some((i) => /30%/.test(i)), 'invented number flagged: ' + bad.issues);
assert(checkWriting('I cut costs by 30% in 2024 over 3 months.', { source: 'cut costs by 30%' }).ok, 'real numbers and years pass');

// ---- discovery ----
const responses = {
  'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true': { jobs: [
    { id: 1, title: 'Finance Intern', absolute_url: 'https://boards.greenhouse.io/acme/jobs/1', location: { name: 'Budapest, Hungary' }, updated_at: '2026-09-01T00:00:00Z', content: '&lt;p&gt;Paid internship. Excel and Python. Fluent English.&lt;/p&gt;' },
    { id: 2, title: 'Senior Software Engineer', absolute_url: 'https://boards.greenhouse.io/acme/jobs/2', location: { name: 'Budapest' }, content: '' },
    { id: 3, title: 'Business Analyst Intern', absolute_url: 'https://boards.greenhouse.io/acme/jobs/3', location: { name: 'New York' }, content: 'Unpaid.' }
  ] },
  'https://api.lever.co/v0/postings/beta?mode=json': [
    { id: 'x', text: 'Junior Financial Analyst', hostedUrl: 'https://jobs.lever.co/beta/x', categories: { location: 'Remote' }, workplaceType: 'remote', createdAt: 1767225600000, descriptionPlain: 'Entry-level analyst role, salary 2000 EUR per month.', lists: [{ text: 'You have', content: '<li>Excel</li>' }] }
  ]
};
const fetchFn = async (url) => (responses[url]
  ? { ok: true, status: 200, json: async () => responses[url] }
  : { ok: false, status: 404, json: async () => ({}) });

const state = {
  profile: { skills: 'Excel, Python', languages: 'English C1' },
  preferences: { targetRoles: 'analyst, finance', locations: 'Budapest, Remote', avoidKeywords: '', paidOnly: true }
};

(async () => {
  const r = await discover(state, { boards: 'https://boards.greenhouse.io/acme\njobs.lever.co/beta\nashby:missing\nnot a board', fetchFn });
  assert.strictEqual(r.boards, 3);
  assert.strictEqual(r.total, 4);
  assert.deepStrictEqual(r.results.map((j) => j.role).sort(), ['Finance Intern', 'Junior Financial Analyst'], JSON.stringify(r.results.map((j) => j.role)));
  assert(r.errors.some((e) => /ashby:missing — board not found/.test(e)), r.errors.join());
  assert(r.errors.some((e) => /Not a supported board/.test(e)));
  assert(r.results[0].fit >= r.results[1].fit, 'sorted by fit');
  assert.strictEqual(r.results.find((j) => j.ats === 'lever').company, 'Beta');

  const all = await discover(state, { boards: 'greenhouse:acme', keywords: '', locations: '', fetchFn });
  assert.strictEqual(all.results.length, 3, 'no filter keeps everything');

  // SmartRecruiters: filters are passed on and pages are followed
  const srUrls = [];
  const srFetch = async (url) => {
    srUrls.push(url);
    const offset = +new URL(url).searchParams.get('offset');
    const content = Array.from({ length: offset < 200 ? 100 : 20 }, (_, k) => ({ id: String(offset + k), name: 'Finance Analyst', location: { city: 'Budapest', country: 'hu' }, company: { name: 'Wise' } }));
    return { ok: true, status: 200, json: async () => ({ totalFound: 220, content }) };
  };
  const sr = await discover(state, { boards: 'smartrecruiters:Wise?country=hu', fetchFn: srFetch });
  assert.strictEqual(srUrls.length, 3, 'three pages for 220 jobs');
  assert(srUrls.every((u) => u.includes('&country=hu')), srUrls[0]);
  assert.strictEqual(sr.total, 220);
  assert.strictEqual(sr.results[0].location, 'Budapest, HU');
  console.log('discover/jobdata/quality tests passed', r.results.map((j) => `${j.role}=${j.fit}`).join(', '));
})().catch((e) => { console.error(e); process.exit(1); });
