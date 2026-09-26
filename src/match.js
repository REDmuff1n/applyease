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

// prefs: { roles: 'a, b', places: 'Budapest, Remote', home: ['hungary', 'budapest'] }
function matchJob(job, { roles, places, home = [] }) {
  const r = listOf(roles);
  const locs = listOf(places);
  const title = String(job.role || '').toLowerCase();
  const where = String(job.location || '').toLowerCase();
  if (r.length && !r.some((k) => title.includes(k))) return false;
  if (!locs.length || !where) return true;
  const fixed = locs.filter((l) => l !== 'remote');
  if (fixed.some((l) => where.includes(l))) return true;
  return locs.includes('remote') && remoteOk(where, [...fixed, ...home.map((h) => String(h).toLowerCase())]);
}

// The user's own prefs from app state.
function prefsOf(state) {
  const p = state.profile || {};
  return { roles: state.preferences?.targetRoles, places: state.preferences?.locations, home: [p.country, p.city].filter(Boolean) };
}

module.exports = { matchJob, remoteOk, prefsOf, listOf };
