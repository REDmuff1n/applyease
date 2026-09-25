// Checks the Claude request shape and response parsing with a stubbed network.
const assert = require('assert');
const ai = require('../src/ai');
const llm = require('../src/llm');
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
const cfg = { provider: 'anthropic', apiKey: 'sk-test', model: 'claude-sonnet-5' };
(async () => {
  const l = await ai.coverLetter(state, cfg, { company: 'Acme', role: 'Intern', text: 'job' });
  assert.strictEqual(l.source, 'ai');
  assert(l.issues.includes('Too short'), 'short letter flagged after retry');
  assert.strictEqual(sent.url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(sent.headers['x-api-key'], 'sk-test');
  assert.strictEqual(sent.body.model, 'claude-sonnet-5');
  const a = await ai.answerQuestions(state, cfg, { text: 'job' }, [{ id: 'q1', label: 'Why us?' }]);
  assert.deepStrictEqual(a, [{ id: 'q1', answer: 'Because I love finance.' }]);
  const off = await ai.coverLetter(state, null, { company: 'Acme', role: 'Intern' });
  assert.strictEqual(off.source, 'template');

  const fit = await ai.aiFit(state, cfg, { company: 'Acme', role: 'Intern', text: 'Excel modelling' });
  assert.strictEqual(fit.score, 10, 'score clamped to 10');
  assert.deepStrictEqual(fit.gaps, ['No Python']);

  calls = 0;
  const cv = await ai.tailorCv(state, cfg, { company: 'Acme', role: 'Intern', text: 'job' });
  assert.strictEqual(calls, 2, 'retried once because of the invented 300%');
  assert.deepStrictEqual(cv.issues, []);
  assert.strictEqual(cv.cv.name, 'Arian A', 'name comes from the profile, not the AI');
  assert(cv.text.includes('• Built models for 20+ clients') && cv.text.includes('EXPERIENCE'), cv.text);
  await assert.rejects(ai.tailorCv({ ...state, profile: { firstName: 'A' } }, cfg, {}), /CV text/);

  // OpenAI-compatible providers (Ollama here): URL, body shape, no key, <think> stripped
  global.fetch = async (url, opts) => {
    sent = { url, headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null };
    if (url.endsWith('/models')) return { ok: true, json: async () => ({ data: [{ id: 'qwen3' }, { id: 'llama3.1' }] }) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '<think>hmm</think>Dear Acme, I built Excel models.' } }] }) };
  };
  const ollama = { provider: 'ollama', model: 'llama3.1', apiKey: '' };
  const ol = await ai.coverLetter(state, ollama, { company: 'Acme', role: 'Intern', text: 'job' });
  assert.strictEqual(sent.url, 'http://localhost:11434/v1/chat/completions');
  assert.strictEqual(sent.headers.authorization, undefined, 'no key sent to a local model');
  assert.deepStrictEqual(sent.body.messages.map((m) => m.role), ['system', 'user']);
  assert.strictEqual(sent.body.max_tokens, 1200);
  assert.strictEqual(ol.text, 'Dear Acme, I built Excel models.');
  const ds = { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'ds-key' };
  await ai.aiFit(state, ds, { text: 'x' }).catch(() => {});
  assert.strictEqual(sent.url, 'https://api.deepseek.com/v1/chat/completions');
  assert.strictEqual(sent.headers.authorization, 'Bearer ds-key');
  await ai.coverLetter(state, { provider: 'openai', model: 'gpt-5-mini', apiKey: 'k' }, { text: 'job' });
  assert.strictEqual(sent.body.max_tokens, undefined, 'OpenAI gets no max_tokens');
  await ai.coverLetter(state, { provider: 'custom', baseUrl: 'https://my.server/v1/', model: 'm', apiKey: '' }, { text: 'job' });
  assert.strictEqual(sent.url, 'https://my.server/v1/chat/completions');
  assert.deepStrictEqual(await llm.listModels({ provider: 'ollama' }), ['llama3.1', 'qwen3']);
  await assert.rejects(llm.chat({ provider: 'gemini', model: 'g', apiKey: '' }, { system: '', prompt: '' }), /API key/);
  global.fetch = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(llm.chat(ollama, { system: '', prompt: '' }), /Could not reach Ollama at http:\/\/localhost:11434\. Is it running\?/);
  console.log('ai tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
