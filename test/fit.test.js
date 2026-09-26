const assert = require('assert');
const { checkFit, guessMeta } = require('../src/fit');

const state = {
  profile: { skills: 'Excel, financial modelling, Python', languages: 'English C1, Bengali native, Hungarian A1' },
  preferences: { targetRoles: 'analyst, finance', locations: 'Budapest, Remote', avoidKeywords: 'commission only', paidOnly: true }
};

const good = checkFit(`Finance Intern - Budapest. Paid internship for university students. You will support the financial analyst team
with Excel models and reporting. Fluent English required. Monthly salary 350,000 HUF.`, state);
assert(good.score >= 70, 'good job should score high: ' + JSON.stringify(good));

const hu = checkFit(`Junior Financial Analyst in Budapest. Fluent Hungarian is a must. Excellent English. Salary competitive.`, state);
assert(hu.bad.some((b) => b.includes('Hungarian')), 'should flag Hungarian: ' + JSON.stringify(hu));
assert(!hu.bad.some((b) => b.includes('English')), 'should not flag English');
assert(hu.score < 50, 'fluent Hungarian should sink the score');
const basicHu = checkFit('Finance intern in Budapest, paid. Basic Hungarian is a plus. English fluent.', state);
assert(!basicHu.bad.length, 'basic Hungarian plus should not be flagged: ' + JSON.stringify(basicHu));

const unpaid = checkFit(`Marketing internship, unpaid, remote. Great experience for students looking to grow their network.`, state);
assert(unpaid.score < 40 && unpaid.bad.some((b) => /unpaid/i.test(b)), 'unpaid should be flagged: ' + JSON.stringify(unpaid));

const senior = checkFit(`Senior Finance Manager. 7+ years of experience in corporate finance required. Budapest office.`, state);
assert(senior.score < 50, 'senior should be low: ' + JSON.stringify(senior));

assert.deepStrictEqual(guessMeta('Business Analyst Intern at Wise | LinkedIn', '', ''), { company: 'Wise', role: 'Business Analyst Intern' });
assert.strictEqual(guessMeta('', '', 'https://jobs.lever.co/morgan-stanley/123').company, 'Morgan Stanley');

// Speed: the Live dashboard scores up to 2,000 jobs; this must not freeze the app.
const long = 'We are a fast growing company in Budapest looking for people who enjoy analysis and teamwork. '.repeat(60);
let t0 = Date.now();
for (let i = 0; i < 2000; i++) checkFit(`Job title: Analyst ${i}
${long}`, state);
const ms = Date.now() - t0;
assert(ms < 4000, `2000 fit checks took ${ms} ms`);

console.log('fit tests passed', { speed2000: ms + 'ms', good: good.score, hu: hu.score, unpaid: unpaid.score, senior: senior.score });
