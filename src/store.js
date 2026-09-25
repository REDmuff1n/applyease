// Local JSON storage in the user's app-data folder. Nothing leaves the computer
// except the optional Claude API calls the user turns on in Settings.
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const { needsKey } = require('./llm');

const DEFAULTS = {
  profile: {
    firstName: '', lastName: '', preferredName: '', email: '', phone: '',
    address: '', city: '', region: '', postcode: '', country: '',
    linkedin: '', github: '', website: '',
    university: '', degree: '', major: '', gradYear: '', gpa: '',
    headline: '', summary: '', skills: '', languages: '', yearsExperience: '',
    workAuth: '', needsSponsorship: '', startDate: 'Immediately', salary: 'Open to discussion',
    relocate: '', over18: 'Yes',
    howHeard: 'LinkedIn', pronouns: '',
    gender: 'Prefer not to say', ethnicity: 'Prefer not to say', veteran: 'Prefer not to say', disability: 'Prefer not to say',
    coverLetterBase: '',
    cvText: '',
    cvPath: '', cvName: ''
  },
  answers: [
    { q: 'Why do you want to work here / why this role', a: '' },
    { q: 'Greatest strength', a: '' },
    { q: 'Greatest weakness', a: '' },
    { q: 'Tell us about a challenge you overcame', a: '' }
  ],
  preferences: {
    targetRoles: 'analyst, finance, business',
    locations: 'Remote',
    avoidKeywords: 'unpaid, commission only',
    paidOnly: true,
    boards: ''
  },
  jobs: [],
  settings: {
    aiEnabled: false,
    aiProvider: 'anthropic',
    model: 'claude-sonnet-5',
    baseUrl: '', // only for local servers and custom providers
    secretsEnc: {}, // API keys by name ("ai:openai", "feed:jsearch"…), encrypted
    secretsPlain: {}, // fallback when the OS keychain is unavailable
    allowedSites: [],
    overwriteFilled: false,
    batch: { aiScore: true, tailor: true, letter: true, minScore: 7 }
  },
  feeds: {
    arbeitnow: true, himalayas: true, remotive: true, remoteok: false, themuse: true, boards: true,
    adzuna: false, adzunaAppId: '', adzunaCountry: 'gb',
    jooble: false, jsearch: false,
    maxAgeDays: 7, autoRefreshMins: 30
  },
  onboarded: false
};

let file;
let data;

function load() {
  file = path.join(app.getPath('userData'), 'applyease-data.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    data = deepMerge(structuredClone(DEFAULTS), raw);
  } catch {
    data = structuredClone(DEFAULTS);
  }
  // 1.0/1.1 kept a single Claude key: move it to the per-provider store.
  const s = data.settings;
  if (s.apiKeyEnc || s.apiKeyPlain) {
    if (s.apiKeyEnc) s.secretsEnc['ai:anthropic'] = s.apiKeyEnc;
    if (s.apiKeyPlain) s.secretsPlain['ai:anthropic'] = s.apiKeyPlain;
    delete s.apiKeyEnc;
    delete s.apiKeyPlain;
  }
  return data;
}

function deepMerge(base, extra) {
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      base[k] = deepMerge(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
}

function save() {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function get() { return data; }

// What the UI is allowed to see: everything except the raw API keys.
function publicState() {
  const s = structuredClone(data);
  const names = [...Object.keys(data.settings.secretsEnc || {}), ...Object.keys(data.settings.secretsPlain || {})];
  s.settings.secretsSet = Object.fromEntries(names.filter((n) => getSecret(n)).map((n) => [n, true]));
  s.settings.hasApiKey = Boolean(getApiKey());
  s.settings.aiReady = Boolean(data.settings.aiEnabled && data.settings.model && (s.settings.hasApiKey || !needsKey(data.settings.aiProvider)));
  delete s.settings.secretsEnc;
  delete s.settings.secretsPlain;
  return s;
}

function update(partial) {
  const clean = structuredClone(partial);
  if (clean.settings) {
    for (const k of ['secretsEnc', 'secretsPlain', 'secretsSet', 'hasApiKey', 'apiKeyEnc', 'apiKeyPlain']) delete clean.settings[k];
  }
  deepMerge(data, clean);
  // arrays are replaced wholesale by deepMerge, which is what we want
  save();
  return publicState();
}

// API keys (AI providers and job sources), encrypted with the OS keychain.
function setSecret(name, value) {
  value = String(value || '').trim();
  const s = data.settings;
  delete s.secretsEnc[name];
  delete s.secretsPlain[name];
  if (value) {
    if (safeStorage.isEncryptionAvailable()) s.secretsEnc[name] = safeStorage.encryptString(value).toString('base64');
    else s.secretsPlain[name] = value; // OS keychain unavailable (some Linux setups)
  }
  save();
}

function getSecret(name) {
  const enc = data.settings.secretsEnc?.[name];
  if (enc) {
    try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return ''; }
  }
  return data.settings.secretsPlain?.[name] || '';
}

// Key for the AI provider currently picked in Settings.
const setApiKey = (key, provider = data.settings.aiProvider) => setSecret('ai:' + provider, key);
const getApiKey = (provider = data.settings.aiProvider) => getSecret('ai:' + provider);

function reset() {
  data = structuredClone(DEFAULTS);
  save();
}

module.exports = { load, save, get, update, publicState, setApiKey, getApiKey, setSecret, getSecret, reset, filePath: () => file };
