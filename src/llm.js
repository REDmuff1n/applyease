// One small client for every AI provider the user can pick in Settings.
// Anthropic has its own API; everything else speaks the OpenAI-compatible
// /chat/completions format (OpenAI, Gemini, DeepSeek, Groq, OpenRouter,
// Mistral, Ollama, LM Studio, or any other URL the user enters).

const PROVIDERS = {
  anthropic: { label: 'Anthropic Claude', base: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5', keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai: { label: 'OpenAI (ChatGPT)', base: 'https://api.openai.com/v1', model: 'gpt-5-mini', keyUrl: 'https://platform.openai.com/api-keys', noMaxTokens: true },
  gemini: { label: 'Google Gemini (free tier)', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', keyUrl: 'https://aistudio.google.com/apikey' },
  deepseek: { label: 'DeepSeek', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys' },
  groq: { label: 'Groq (free tier, open models)', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys' },
  openrouter: { label: 'OpenRouter (hundreds of models)', base: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', keyUrl: 'https://openrouter.ai/keys' },
  mistral: { label: 'Mistral', base: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', keyUrl: 'https://console.mistral.ai/api-keys' },
  ollama: { label: 'Ollama (runs on your computer, free)', base: 'http://localhost:11434/v1', model: 'llama3.1', keyUrl: 'https://ollama.com/download', local: true },
  lmstudio: { label: 'LM Studio (runs on your computer, free)', base: 'http://localhost:1234/v1', model: '', keyUrl: 'https://lmstudio.ai', local: true },
  custom: { label: 'Other (any OpenAI-compatible URL)', base: '', model: '', custom: true }
};

const provider = (id) => PROVIDERS[id] || PROVIDERS.anthropic;

// Local servers and custom URLs may run without a key.
const needsKey = (id) => !provider(id).local && !provider(id).custom;

function baseUrl(cfg) {
  const b = String(cfg.baseUrl || provider(cfg.provider).base || '').trim().replace(/\/+$/, '');
  if (!b) throw new Error('Enter the base URL of your AI server in Settings.');
  return b;
}

async function send(url, init, cfg) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(cfg.timeoutMs || 180000) });
  } catch (e) {
    if (provider(cfg.provider).local || /localhost|127\.0\.0\.1/.test(url)) {
      throw new Error(`Could not reach ${provider(cfg.provider).label.split(' (')[0]} at ${new URL(url).origin}. Is it running?`);
    }
    throw new Error(e.name === 'TimeoutError' ? 'The AI took too long to answer. Try again.' : `Network error: ${e.message}`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body?.error;
    const msg = (typeof err === 'string' ? err : err?.message) || body?.message || res.statusText;
    throw new Error(`${provider(cfg.provider).label.split(' (')[0]} error (${res.status}): ${msg}`);
  }
  return body;
}

function authHeaders(cfg) {
  const h = { 'content-type': 'application/json' };
  if (cfg.provider === 'anthropic') {
    h['x-api-key'] = cfg.apiKey;
    h['anthropic-version'] = '2023-06-01';
  } else if (cfg.apiKey) {
    h.authorization = `Bearer ${cfg.apiKey}`;
  }
  if (cfg.provider === 'openrouter') { h['http-referer'] = 'https://github.com/REDmuff1n/applyease'; h['x-title'] = 'ApplyEase'; }
  return h;
}

// Reasoning models (DeepSeek R1, Qwen…) sometimes put their thinking in the text.
const stripThinking = (s) => String(s || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

async function chat(cfg, { system, prompt, maxTokens = 1200 }) {
  if (!cfg) throw new Error('Turn on AI in Settings first.');
  if (needsKey(cfg.provider) && !cfg.apiKey) throw new Error('Add your API key in Settings.');
  if (!cfg.model) throw new Error('Choose a model in Settings.');
  const base = baseUrl(cfg);
  if (cfg.provider === 'anthropic') {
    const body = await send(`${base}/messages`, {
      method: 'POST', headers: authHeaders(cfg),
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] })
    }, cfg);
    return (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  }
  const req = { model: cfg.model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] };
  // OpenAI's newer models reject max_tokens; they stop on their own.
  if (!provider(cfg.provider).noMaxTokens) req.max_tokens = maxTokens;
  const body = await send(`${base}/chat/completions`, { method: 'POST', headers: authHeaders(cfg), body: JSON.stringify(req) }, cfg);
  const content = body.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map((c) => c.text || '').join('\n') : content;
  if (!text) throw new Error('The AI returned an empty answer. Try again or pick another model.');
  return stripThinking(text);
}

// Model names the provider offers, for the dropdown in Settings.
async function listModels(cfg) {
  if (needsKey(cfg.provider) && !cfg.apiKey) throw new Error('Add your API key first.');
  const body = await send(`${baseUrl(cfg)}/models`, { headers: authHeaders(cfg) }, { ...cfg, timeoutMs: 20000 });
  const ids = (body.data || body.models || []).map((m) => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean);
  return [...new Set(ids)].sort();
}

module.exports = { PROVIDERS, chat, listModels, needsKey, provider };
