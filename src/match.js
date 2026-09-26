// Does a job match the user's roles and places? Used by the Live jobs dashboard.

const listOf = (s) => String(s || '').split(/[,;\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean);

const OPEN = /\b(europe|european|emea|eu|worldwide|anywhere|global|international)\b/;

// "Remote" only helps if the job isn't tied to some other country or city:
// "Remote", "Remote · Europe" or "Remote, Hungary" count; "Remote - USA" or
// "Berlin · Remote" don't (unless Berlin is one of the user's places).
function remoteOk(where, okPlaces = []) {
  if (!/remote|anywhere|worldwide|work from home/.test(where)) return false;
  const rest = where.replace(/remote|fully|hybrid|work from home|wfh|anywhere|worldwide|global|first|only|[-–—·,;:/|()[\]&]|\band\b|\bor\b/g, ' ').trim();
  if (!rest) return true;
  return OPEN.test(where) || okPlaces.some((p) => p && where.includes(p));
}

// Title contains one of the user's role words?
function roleMatch(job, roles) {
  const r = listOf(roles);
  const title = String(job.role || '').toLowerCase();
  return !r.length || r.some((k) => title.includes(k));
}

// Remote jobs often put the region in the title instead: "Account Executive - NA",
// "Sales Lead, DACH", "… - San Francisco".
const ELSEWHERE_TITLE = /\b(na|north america|americas|us|usa|u\.s\.|united states|canada|latam|apac|anz|india|japan|singapore|australia|san francisco|new york|london|dach|nordics?|benelux|uk|ireland|poland|germany|france|spain|italy|netherlands|portugal)\b/i;

function remoteOpenTo(job, okPlaces = []) {
  const where = String(job.location || '').toLowerCase();
  if (!remoteOk(where, okPlaces)) return false;
  const title = String(job.role || '').toLowerCase();
  return !ELSEWHERE_TITLE.test(title) || okPlaces.some((p) => p && title.includes(p)) || /\b(europe|emea|eu|global|worldwide)\b/.test(title);
}

// Location is one of the user's places (or remote that's open to them)?
// strict: a job with no location at all doesn't count.
function placeMatch(job, places, home = [], { strict = false } = {}) {
  const locs = listOf(places);
  const where = String(job.location || '').toLowerCase();
  if (!locs.length) return true;
  if (!where) return !strict;
  const fixed = locs.filter((l) => l !== 'remote');
  if (fixed.some((l) => where.includes(l))) return true;
  // A job listed only by country ("Hungary") counts for a place in that country ("Budapest").
  const c = countryOf(job.location);
  if (c && !cityOf(job.location) && !/remote/.test(where) && fixed.some((l) => placeCountry(l) === c)) return true;
  return locs.includes('remote') && remoteOpenTo(job, [...fixed, ...home.map((h) => String(h).toLowerCase())]);
}

// The country a place the user typed is in: "Budapest" → Hungary, "Hungary" → Hungary.
const placeCountry = (place) => COUNTRIES[String(place).toLowerCase()] || CITY_COUNTRY[String(place).toLowerCase()] || '';

// prefs: { roles: 'a, b', places: 'Budapest, Remote', home: ['hungary', 'budapest'] }
function matchJob(job, { roles, places, home = [] }) {
  return roleMatch(job, roles) && placeMatch(job, places, home);
}

// Employment types a listing mentions (from the feed's own data, the title and the
// start of the description). Empty when the listing doesn't say.
const TYPES = [
  ['internship', /\bintern(ship)?s?\b|praktik|gyakornok|\btrainee|stagiaire|\bstage\b|placement year/],
  ['student', /working student|werkstudent|student job|student worker|diákmunka|\bstudent\b.*\b(assistant|position|role|job)\b/],
  ['parttime', /part[- ]?time|teilzeit|részmunkaidő|\bmini[- ]?job\b/],
  ['fulltime', /full[- ]?time|vollzeit|teljes munkaidő|\bpermanent\b|\bfull_time\b/],
  ['contract', /\bcontract(or)?\b|freelanc|fixed[- ]term|\btemporary\b|\btemp\b|befristet|maternity cover/]
];
function jobTypes(job, text = '') {
  const head = `${job.role || ''} ${(job.tags || []).join(' ')} ${String(text).slice(0, 2500)}`.toLowerCase();
  return TYPES.filter(([, re]) => re.test(head)).map(([t]) => t);
}

// ---- Country and city of a job ----
// Locations come as "Budapest, HU", "Budapest, Hungary", "Hungary", "Berlin",
// "Remote · Germany"… These work out the country and the city behind them.

const COUNTRIES = {
  hungary: 'Hungary', magyarország: 'Hungary', germany: 'Germany', deutschland: 'Germany', austria: 'Austria', österreich: 'Austria',
  switzerland: 'Switzerland', schweiz: 'Switzerland', france: 'France', spain: 'Spain', españa: 'Spain', italy: 'Italy', italia: 'Italy',
  portugal: 'Portugal', netherlands: 'Netherlands', 'the netherlands': 'Netherlands', belgium: 'Belgium', luxembourg: 'Luxembourg',
  ireland: 'Ireland', 'united kingdom': 'United Kingdom', uk: 'United Kingdom', england: 'United Kingdom', scotland: 'United Kingdom',
  poland: 'Poland', polska: 'Poland', czechia: 'Czechia', 'czech republic': 'Czechia', slovakia: 'Slovakia', slovenia: 'Slovenia',
  romania: 'Romania', bulgaria: 'Bulgaria', croatia: 'Croatia', serbia: 'Serbia', greece: 'Greece', cyprus: 'Cyprus', malta: 'Malta',
  denmark: 'Denmark', sweden: 'Sweden', norway: 'Norway', finland: 'Finland', estonia: 'Estonia', latvia: 'Latvia', lithuania: 'Lithuania',
  ukraine: 'Ukraine', turkey: 'Turkey', türkiye: 'Turkey', israel: 'Israel', 'united arab emirates': 'United Arab Emirates', uae: 'United Arab Emirates',
  'united states': 'United States', usa: 'United States', 'u.s.': 'United States', canada: 'Canada', mexico: 'Mexico', brazil: 'Brazil',
  argentina: 'Argentina', colombia: 'Colombia', chile: 'Chile', india: 'India', pakistan: 'Pakistan', bangladesh: 'Bangladesh',
  china: 'China', japan: 'Japan', 'south korea': 'South Korea', korea: 'South Korea', singapore: 'Singapore', philippines: 'Philippines',
  indonesia: 'Indonesia', malaysia: 'Malaysia', vietnam: 'Vietnam', thailand: 'Thailand', australia: 'Australia', 'new zealand': 'New Zealand',
  'south africa': 'South Africa', nigeria: 'Nigeria', kenya: 'Kenya', egypt: 'Egypt', 'saudi arabia': 'Saudi Arabia'
};
// Two-letter codes, only trusted when written in capitals ("Budapest, HU").
const CODES = {
  HU: 'Hungary', DE: 'Germany', AT: 'Austria', CH: 'Switzerland', FR: 'France', ES: 'Spain', IT: 'Italy', PT: 'Portugal', NL: 'Netherlands',
  BE: 'Belgium', LU: 'Luxembourg', IE: 'Ireland', GB: 'United Kingdom', UK: 'United Kingdom', PL: 'Poland', CZ: 'Czechia', SK: 'Slovakia',
  SI: 'Slovenia', RO: 'Romania', BG: 'Bulgaria', HR: 'Croatia', RS: 'Serbia', GR: 'Greece', CY: 'Cyprus', MT: 'Malta', DK: 'Denmark',
  SE: 'Sweden', NO: 'Norway', FI: 'Finland', EE: 'Estonia', LV: 'Latvia', LT: 'Lithuania', UA: 'Ukraine', TR: 'Turkey', IL: 'Israel',
  AE: 'United Arab Emirates', US: 'United States', CA: 'Canada', MX: 'Mexico', BR: 'Brazil', IN: 'India', SG: 'Singapore', AU: 'Australia', JP: 'Japan'
};
// Cities that often appear without their country.
const CITY_COUNTRY = {
  budapest: 'Hungary', debrecen: 'Hungary', szeged: 'Hungary', pécs: 'Hungary', pecs: 'Hungary', győr: 'Hungary', gyor: 'Hungary', miskolc: 'Hungary',
  székesfehérvár: 'Hungary', kecskemét: 'Hungary', hatvan: 'Hungary', veszprém: 'Hungary',
  berlin: 'Germany', munich: 'Germany', münchen: 'Germany', hamburg: 'Germany', frankfurt: 'Germany', 'frankfurt am main': 'Germany', cologne: 'Germany', köln: 'Germany',
  düsseldorf: 'Germany', stuttgart: 'Germany', leipzig: 'Germany', dresden: 'Germany', hannover: 'Germany', nürnberg: 'Germany', nuremberg: 'Germany',
  bremen: 'Germany', essen: 'Germany', dortmund: 'Germany', bonn: 'Germany', mannheim: 'Germany', karlsruhe: 'Germany', aachen: 'Germany', göttingen: 'Germany', würzburg: 'Germany',
  vienna: 'Austria', wien: 'Austria', graz: 'Austria', linz: 'Austria', salzburg: 'Austria', zurich: 'Switzerland', zürich: 'Switzerland', geneva: 'Switzerland', basel: 'Switzerland',
  london: 'United Kingdom', manchester: 'United Kingdom', edinburgh: 'United Kingdom', dublin: 'Ireland', cork: 'Ireland',
  paris: 'France', lyon: 'France', amsterdam: 'Netherlands', rotterdam: 'Netherlands', utrecht: 'Netherlands', brussels: 'Belgium',
  madrid: 'Spain', barcelona: 'Spain', lisbon: 'Portugal', porto: 'Portugal', milan: 'Italy', milano: 'Italy', rome: 'Italy',
  warsaw: 'Poland', krakow: 'Poland', kraków: 'Poland', wroclaw: 'Poland', wrocław: 'Poland', gdansk: 'Poland', poznan: 'Poland',
  prague: 'Czechia', praha: 'Czechia', brno: 'Czechia', bratislava: 'Slovakia', bucharest: 'Romania', cluj: 'Romania', sofia: 'Bulgaria', zagreb: 'Croatia',
  belgrade: 'Serbia', athens: 'Greece', copenhagen: 'Denmark', stockholm: 'Sweden', oslo: 'Norway', helsinki: 'Finland', tallinn: 'Estonia', riga: 'Latvia', vilnius: 'Lithuania',
  'new york': 'United States', 'san francisco': 'United States', boston: 'United States', seattle: 'United States', chicago: 'United States', austin: 'United States',
  'los angeles': 'United States', toronto: 'Canada', vancouver: 'Canada', montreal: 'Canada', bangalore: 'India', bengaluru: 'India', mumbai: 'India', dubai: 'United Arab Emirates'
};

// One name per city, so "München" and "Munich" aren't listed twice.
const CITY_NAMES = {
  münchen: 'Munich', köln: 'Cologne', wien: 'Vienna', praha: 'Prague', zürich: 'Zurich', milano: 'Milan', roma: 'Rome', warszawa: 'Warsaw',
  kraków: 'Krakow', wrocław: 'Wroclaw', lisboa: 'Lisbon', bruxelles: 'Brussels', 'frankfurt am main': 'Frankfurt', bengaluru: 'Bangalore',
  nürnberg: 'Nuremberg', pecs: 'Pécs', gyor: 'Győr', bucurești: 'Bucharest', athina: 'Athens'
};

const REMOTE_WORD =/^(remote|anywhere|worldwide|global|hybrid|on-?site|work from home|europe|emea|eu|americas|apac|latam|north america)$/i;
const parts = (loc) => String(loc || '').split(/[,·/;|()\n]+|\s[-–—]\s/).map((p) => p.trim()).filter(Boolean);

function countryOf(location) {
  for (const p of parts(location)) {
    const low = p.toLowerCase().replace(/^remote[\s-]+/, '');
    if (COUNTRIES[low]) return COUNTRIES[low];
    if (/^[A-Z]{2}$/.test(p) && CODES[p]) return CODES[p];
    if (CITY_COUNTRY[low]) return CITY_COUNTRY[low];
  }
  return '';
}

// The first part that isn't a country, a code or a word like "Remote".
function cityOf(location) {
  for (const p of parts(location)) {
    const low = p.toLowerCase();
    if (REMOTE_WORD.test(p) || /remote/i.test(p) || COUNTRIES[low] || /^[A-Z]{2}$/.test(p) || /\d/.test(p) || p.length > 30) continue;
    return CITY_NAMES[low] || p.charAt(0).toUpperCase() + p.slice(1);
  }
  return '';
}

// The user's own prefs from app state.
function prefsOf(state) {
  const p = state.profile || {};
  return { roles: state.preferences?.targetRoles, places: state.preferences?.locations, home: [p.country, p.city].filter(Boolean) };
}

module.exports = { matchJob, roleMatch, placeMatch, remoteOk, remoteOpenTo, jobTypes, countryOf, cityOf, placeCountry, prefsOf, listOf };
