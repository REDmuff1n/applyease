// Checks the Claude request shape and response parsing with a stubbed network.
const assert = require('assert');
const ai = require('../src/ai');
let sent;
let calls = 0;
global.fetch = async (url, opts) => {
  calls++;
  sent = { url, headers: opts.headers, body: JSON.parse(opts.body) };
  const p = sent.body.messages[0].content;
  let text = 'Dear Acme team, ... Arian';
  if (p.includes('QUESTIONS')) text = 'Here you go:\n[{"id":"q1","answer":"Because I love finance."}]';
  else if (p.includes('Score how well')) text = '{"score": 12, "matches": ["Excel"], "gaps": ["No Python"], "keywords": ["modelling"], "reasoning": "Good fit."}';
  else if (p.includes('Rewrite the applicant')) {
    // first draft invents a number; the retry (which lists the problem) fixes it
    text = p.includes('fix all of them')
      ? '{"name":"Fake","headline":"Finance Intern","summary":"Economics student who built Excel models for 20+ clients.","skills":["Excel"],"sections":[{"title":"Experience","items":[{"heading":"Designer, Freelance","sub":"2024","bullets":["Built models for 20+ clients"]}]}]}'
      : '{"headline":"Finance Intern","summary":"Grew revenue 300% for clients.","skills":["Excel"],"sections":[]}';
  }
  return { ok: true, json: async () => ({ content: [{ type: 'text', text }] }) };
};
const state = {
  profile: { firstName: 'Arian', lastName: 'A', email: 'a@x.com', skills: 'Excel', cvText: 'Freelance designer for 20+ clients (2024).' },
  answers: [], preferences: {}, settings: { aiEnabled: true, model: 'claude-sonnet-5' }
};
(async () => {
  const l = await ai.coverLetter(state, 'sk-test', { company: 'Acme', role: 'Intern', text: 'job' });
  assert.strictEqual(l.source, 'claude');
  assert(l.issues.includes('Too short'), 'short letter flagged after retry');
  assert.strictEqual(sent.url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(sent.headers['x-api-key'], 'sk-test');
  assert.strictEqual(sent.body.model, 'claude-sonnet-5');
  const a = await ai.answerQuestions(state, 'sk-test', { text: 'job' }, [{ id: 'q1', label: 'Why us?' }]);
  assert.deepStrictEqual(a, [{ id: 'q1', answer: 'Because I love finance.' }]);
  const off = await ai.coverLetter({ ...state, settings: { aiEnabled: false } }, '', { company: 'Acme', role: 'Intern' });
  assert.strictEqual(off.source, 'template');

  const fit = await ai.aiFit(state, 'sk-test', { company: 'Acme', role: 'Intern', text: 'Excel modelling' });
  assert.strictEqual(fit.score, 10, 'score clamped to 10');
  assert.deepStrictEqual(fit.gaps, ['No Python']);

  calls = 0;
  const cv = await ai.tailorCv(state, 'sk-test', { company: 'Acme', role: 'Intern', text: 'job' });
  assert.strictEqual(calls, 2, 'retried once because of the invented 300%');
  assert.deepStrictEqual(cv.issues, []);
  assert.strictEqual(cv.cv.name, 'Arian A', 'name comes from the profile, not the AI');
  assert(cv.text.includes('• Built models for 20+ clients') && cv.text.includes('EXPERIENCE'), cv.text);
  await assert.rejects(ai.tailorCv({ ...state, profile: { firstName: 'A' } }, 'sk-test', {}), /CV text/);
  console.log('ai tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
