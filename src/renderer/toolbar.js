const $ = (id) => document.getElementById(id);
const status = (text, kind = '') => { const s = $('status'); s.textContent = text; s.className = kind; s.title = text; };

async function run(btn, fn) {
  const b = $(btn);
  const label = b.textContent;
  b.disabled = true;
  try { await fn(); } catch (e) { status(e.message, 'error'); } finally { b.disabled = false; b.textContent = label; }
}

function showFit(f) {
  const el = $('fit');
  el.textContent = `Fit: ${f.score} · ${f.verdict}`;
  el.className = 'pill ' + (f.score >= 70 ? 'good' : f.score >= 45 ? 'warn' : 'bad');
  el.title = [...f.good.map((x) => '✓ ' + x), ...f.warn.map((x) => '! ' + x), ...f.bad.map((x) => '✗ ' + x)].join('\n') || f.verdict;
}

let fitTimer;
tb.onNav((d) => {
  if (document.activeElement !== $('url')) $('url').value = d.url;
  $('back').disabled = !d.canBack;
  $('forward').disabled = !d.canForward;
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => tb.fit().then(showFit).catch(() => {}), 1800);
});
tb.onStatus((d) => status(d.text, d.kind));

$('back').onclick = () => tb.nav('back');
$('forward').onclick = () => tb.nav('forward');
$('reload').onclick = () => tb.nav('reload');
$('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') tb.nav('go', e.target.value); });
$('fit').onclick = () => tb.fit().then(showFit).catch((e) => status(e.message, 'error'));

$('fill').onclick = () => run('fill', async () => {
  status('Filling…');
  const r = await tb.fill();
  if (r.cancelled) return status('Cancelled — nothing was filled.');
  const parts = [`Filled ${r.filled.length} field${r.filled.length === 1 ? '' : 's'} (green)`];
  if (r.questions.length) parts.push(`${r.questions.length} open question${r.questions.length === 1 ? '' : 's'} (yellow) — press Write answers`);
  if (r.review.length) parts.push(`${r.review.length} required field${r.review.length === 1 ? '' : 's'} need you (yellow)`);
  if (r.hasFileInput) parts.push('CV upload found — press Attach CV');
  if (!r.filled.length && !r.questions.length) parts[0] = 'No form fields found yet — click "Apply" on the site first, then Fill again';
  status(parts.join(' · '), r.filled.length ? 'ok' : '');
});

$('cv').onclick = () => run('cv', async () => {
  status('Attaching CV…');
  const r = await tb.attachCv();
  if (r.cancelled) return status('Cancelled.');
  status(`Attached ${r.tailored ? 'your tailored CV ' : ''}${r.file}. Check the site shows it.`, 'ok');
});

$('answer').onclick = () => run('answer', async () => {
  status('Writing answers…');
  const r = await tb.answer();
  const warn = r.warnings?.length ? ` Check: ${r.warnings.join('; ')}` : '';
  status(`Wrote ${r.count} of ${r.total} answers (blue)${r.usedAi ? ' with AI' : ' from your saved answers'}. Read them before you submit.${warn}`, r.count && !warn ? 'ok' : '');
});

$('applied').onclick = () => run('applied', async () => {
  const r = await tb.save('Applied');
  status(`${r.updated ? 'Updated' : 'Logged'}: ${r.role || 'role'} at ${r.company || 'company'} — edit details in the Tracker.`, 'ok');
});

$('later').onclick = () => run('later', async () => {
  const r = await tb.save('Saved');
  status(`Saved ${r.role || 'this job'} for later.`, 'ok');
});

tb.init().then((d) => {
  $('url').value = d.url || '';
  if (!d.hasCv) $('cv').title = 'Add your CV in the Profile tab to use this';
  if (!d.aiReady) $('answer').title = 'Uses your saved answers. Turn on AI in Settings for tailored answers.';
  if (!d.url) $('url').focus();
});
