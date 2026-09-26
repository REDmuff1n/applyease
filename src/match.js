// Does a job match the user's roles and places? Shared by Find jobs and Live jobs.

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
  return locs.includes('remote') && remoteOpenTo(job, [...fixed, ...home.map((h) => String(h).toLowerCase())]);
}

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

// The user's own prefs from app state.
function prefsOf(state) {
  const p = state.profile || {};
  return { roles: state.preferences?.targetRoles, places: state.preferences?.locations, home: [p.country, p.city].filter(Boolean) };
}

module.exports = { matchJob, roleMatch, placeMatch, remoteOk, remoteOpenTo, jobTypes, prefsOf, listOf };
