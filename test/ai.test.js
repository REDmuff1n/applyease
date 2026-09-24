// Checks the Claude request shape and response parsing with a stubbed network.
const assert = require('assert');
const ai = require('../src/ai');
let sent;
global.fetch = async (url, opts) => {
  sent = { url, headers: opts.headers, body: JSON.parse(opts.body) };
  const text = sent.body.messages[0].content.includes('QUESTIONS')
    ? 'Here you go:\n[{"id":"q1","answer":"Because I love finance."}]'
    : 'Dear Acme team, ... Arian';
  return { ok: true, json: async () => ({ content: [{ type: 'text', text }] }) };
};
const state = { profile: { firstName: 'Arian', lastName: 'A', skills: 'Excel' }, answers: [], settings: { aiEnabled: true, model: 'claude-sonnet-4-5' } };
(async () => {
  const l = await ai.coverLetter(state, 'sk-test', { company: 'Acme', role: 'Intern', text: 'job' });
  assert.strictEqual(l.source, 'claude');
  assert.strictEqual(sent.url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(sent.headers['x-api-key'], 'sk-test');
  assert.strictEqual(sent.body.model, 'claude-sonnet-4-5');
  const a = await ai.answerQuestions(state, 'sk-test', { text: 'job' }, [{ id: 'q1', label: 'Why us?' }]);
  assert.deepStrictEqual(a, [{ id: 'q1', answer: 'Because I love finance.' }]);
  const off = await ai.coverLetter({ ...state, settings: { aiEnabled: false } }, '', { company: 'Acme', role: 'Intern' });
  assert.strictEqual(off.source, 'template');
  console.log('ai tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
