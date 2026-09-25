// Local JSON storage in the user's app-data folder. Nothing leaves the computer
// except the optional Claude API calls the user turns on in Settings.
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

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
    model: 'claude-sonnet-5',
    apiKeyEnc: '',
    apiKeyPlain: '',
    allowedSites: [],
    overwriteFilled: false
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

// What the UI is allowed to see: everything except the raw API key.
function publicState() {
  const s = structuredClone(data);
  s.settings.hasApiKey = Boolean(getApiKey());
  delete s.settings.apiKeyEnc;
  delete s.settings.apiKeyPlain;
  return s;
}

function update(partial) {
  const clean = structuredClone(partial);
  if (clean.settings) {
    delete clean.settings.apiKeyEnc;
    delete clean.settings.apiKeyPlain;
    delete clean.settings.hasApiKey;
  }
  deepMerge(data, clean);
  // arrays are replaced wholesale by deepMerge, which is what we want
  save();
  return publicState();
}

function setApiKey(key) {
  key = (key || '').trim();
  if (!key) {
    data.settings.apiKeyEnc = '';
    data.settings.apiKeyPlain = '';
  } else if (safeStorage.isEncryptionAvailable()) {
    data.settings.apiKeyEnc = safeStorage.encryptString(key).toString('base64');
    data.settings.apiKeyPlain = '';
  } else {
    data.settings.apiKeyPlain = key; // OS keychain unavailable (some Linux setups)
    data.settings.apiKeyEnc = '';
  }
  save();
}

function getApiKey() {
  if (data.settings.apiKeyEnc) {
    try { return safeStorage.decryptString(Buffer.from(data.settings.apiKeyEnc, 'base64')); } catch { return ''; }
  }
  return data.settings.apiKeyPlain || '';
}

function reset() {
  data = structuredClone(DEFAULTS);
  save();
}

module.exports = { load, save, get, update, publicState, setApiKey, getApiKey, reset, filePath: () => file };
