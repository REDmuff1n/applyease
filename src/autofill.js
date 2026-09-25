// This function is serialised and run inside each frame of the job page.
// It only types into fields. It never clicks buttons or submits anything.
function applyEaseFill(profile, opts) {
  const OVERWRITE = !!(opts && opts.overwrite);
  const RULES = [
    // [profile key, regex on field description, autocomplete tokens]
    ['email', /e-?mail/, ['email']],
    ['linkedin', /linked\s?in/, []],
    ['github', /git\s?hub/, []],
    ['gender', /\bgender\b|\bsex\b/, ['sex']],
    ['ethnicity', /\brace\b|ethnic/, []],
    ['veteran', /veteran/, []],
    ['disability', /disabilit/, []],
    ['over18', /\b18\s*(years|\+)|over\s+(the\s+age\s+of\s+)?18|at\s+least\s+18|legal\s+age|age\s+of\s+majority/, []],
    ['preferredName', /preferred\s+(first\s+)?name|nick\s?name|goes\s+by/, ['nickname']],
    ['firstName', /first[\s_-]?name|given[\s_-]?name|fore[\s_-]?name|\bfname\b|vorname|keresztn/, ['given-name']],
    ['lastName', /last[\s_-]?name|sur[\s_-]?name|family[\s_-]?name|\blname\b|nachname|vezet[eé]kn/, ['family-name']],
    ['fullName', /^\s*(your\s+)?(full\s+|legal\s+|candidate\s+)?name\s*\*?\s*$|full[\s_-]?name|\bname\b(?!.*(company|school|university|employer|reference|manager))/, ['name']],
    ['phone', /phone|mobile|telephone|\btel\b|cell/, ['tel', 'tel-national']],
    ['relocate', /relocat/, []],
    ['yearsExperience', /years?\s+of\s+(relevant\s+|professional\s+|work\s+)?experience|how\s+many\s+years/, []],
    ['postcode', /zip|postal|post[\s_-]?code/, ['postal-code']],
    ['city', /\bcity\b|\btown\b|location\s*\(city\)/, ['address-level2']],
    ['country', /\bcountry\b/, ['country', 'country-name']],
    ['address', /address|street/, ['street-address', 'address-line1']],
    ['website', /website|portfolio|personal\s+(site|url)|other\s+url/, ['url']],
    ['university', /school|university|college|institution|\buni\b/, []],
    ['degree', /degree|qualification|education\s+level/, []],
    ['major', /major|field\s+of\s+study|discipline|programme|program\b|subject/, []],
    ['gradYear', /graduat|completion|end\s+year|expected\s+(finish|end)/, []],
    ['gpa', /\bgpa\b|grade\s+(point\s+)?average|\bgrades?\b/, []],
    ['salary', /salary|compensation|pay\s+expect|expected\s+pay|desired\s+pay|rate\s+expect/, []],
    ['startDate', /start\s+date|available\s+(from|to\s+start)|availability|notice\s+period|earliest\s+start|when\s+can\s+you\s+start/, []],
    ['needsSponsorship', /sponsor|visa/, []],
    ['workAuth', /authori[sz]|work\s+permit|right\s+to\s+work|legally|eligible\s+to\s+work/, []],
    ['howHeard', /how\s+did\s+you\s+(hear|find)|where\s+did\s+you\s+(hear|find)|referral\s+source|\bsource\b/, []],
    ['pronouns', /pronoun/, []],
    ['headline', /headline|current\s+title|job\s+title/, ['organization-title']],
    ['languages', /languages?\s+(you\s+)?spok|which\s+languages|language\s+skills/, []],
    ['region', /\b(state|province|region|county)\b/, ['address-level1']],
    ['coverLetter', /cover\s*letter|motivation(al)?\s+letter/, []]
  ];

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const skipTypes = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'password', 'file', 'checkbox', 'radio', 'range', 'color', 'search']);

  function describe(el) {
    const bits = [];
    if (el.id) {
      try { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) bits.push(l.innerText); } catch (e) { /* ignore */ }
    }
    const wrap = el.closest('label'); if (wrap) bits.push(wrap.innerText);
    if (el.getAttribute('aria-label')) bits.push(el.getAttribute('aria-label'));
    const lb = el.getAttribute('aria-labelledby');
    if (lb) lb.split(/\s+/).forEach((id) => { const n = document.getElementById(id); if (n) bits.push(n.innerText); });
    if (el.placeholder) bits.push(el.placeholder);
    if (!bits.length) {
      // nearest text above the field inside its container
      let p = el.parentElement;
      for (let i = 0; i < 3 && p && !bits.length; i++, p = p.parentElement) {
        const txt = clean(Array.from(p.childNodes).filter((n) => n !== el && !(n.contains && n.contains(el))).map((n) => n.innerText || n.textContent || '').join(' '));
        if (txt && txt.length < 200) bits.push(txt);
      }
    }
    bits.push(el.name || '', el.id || '');
    return clean(bits.join(' | ')).toLowerCase();
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // "Prefer not to say" is worded differently on every form.
  const DECLINE = /decline|prefer\s+not|rather\s+not|(do\s+not|don.?t)\s+(wish|want)|not\s+(wish|want)\s+to|not\s+to\s+(say|answer|disclose|self)/;
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // items: [{ text, ... }]; returns the item that best matches the saved value.
  function bestChoice(items, value) {
    const v = clean(value).toLowerCase();
    if (!v) return null;
    const t = (x) => clean(x.text).toLowerCase();
    const starts = new RegExp('^' + reEsc(v) + '(\\b|$)');
    return items.find((x) => t(x) === v)
      || items.find((x) => starts.test(t(x)))
      || items.find((x) => v.length > 2 && t(x).includes(v))
      || items.find((x) => { const s = t(x); return s.length > 2 && new RegExp('\\b' + reEsc(s) + '\\b').test(v); })
      || (DECLINE.test(v) ? items.find((x) => DECLINE.test(t(x))) : null);
  }

  function pickOption(sel, value) {
    const opts = Array.from(sel.options).filter((o) => o.value !== '' && !o.disabled);
    const o = bestChoice(opts, value);
    if (!o) return false;
    setValue(sel, o.value);
    return true;
  }

  function radioLabel(r) {
    const bits = [];
    if (r.id) { try { const l = document.querySelector(`label[for="${CSS.escape(r.id)}"]`); if (l) bits.push(l.innerText); } catch (e) { /* ignore */ } }
    const wrap = r.closest('label'); if (wrap) bits.push(wrap.innerText);
    if (r.getAttribute('aria-label')) bits.push(r.getAttribute('aria-label'));
    return clean(bits[0] || r.value);
  }

  // The question text of a radio group: fieldset legend, radiogroup label, or the text around it.
  function groupQuestion(radios) {
    const first = radios[0];
    const fs = first.closest('fieldset');
    const legend = fs && fs.querySelector('legend');
    if (legend && clean(legend.innerText)) return clean(legend.innerText).toLowerCase();
    const rg = first.closest('[role=radiogroup]');
    if (rg) {
      const lb = rg.getAttribute('aria-labelledby');
      const txt = rg.getAttribute('aria-label') || (lb ? lb.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ') : '');
      if (clean(txt)) return clean(txt).toLowerCase();
    }
    let box = first.parentElement;
    while (box && !radios.every((r) => box.contains(r))) box = box.parentElement;
    const optionText = radios.map(radioLabel);
    for (let i = 0; box && i < 3; i++, box = box.parentElement) {
      let txt = clean(box.innerText);
      optionText.forEach((o) => { txt = txt.replace(o, ' '); });
      txt = clean(txt);
      if (txt.length > 3) return txt.slice(0, 300).toLowerCase();
    }
    return clean(first.name).toLowerCase();
  }

  function mark(el, color) {
    el.style.outline = `2px solid ${color}`;
    el.style.outlineOffset = '1px';
  }

  const values = Object.assign({}, profile, {
    fullName: clean(`${profile.firstName || ''} ${profile.lastName || ''}`)
  });

  const filled = [];
  const review = [];
  const questions = [];
  let n = 0;

  const fields = Array.from(document.querySelectorAll('input, textarea, select'));
  for (const el of fields) {
    if (el.disabled || el.readOnly) continue;
    if (el.tagName === 'INPUT' && skipTypes.has((el.type || 'text').toLowerCase())) continue;
    if (!visible(el)) continue;
    const desc = describe(el);
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/).pop();
    const label = desc.split(' | ')[0].slice(0, 140);
    const already = el.tagName === 'SELECT' ? el.selectedIndex > 0 : clean(el.value) !== '';
    if (already && !OVERWRITE) continue;

    let key = null;
    for (const [k, re, acs] of RULES) {
      if ((ac && acs.includes(ac)) || re.test(desc)) { key = k; break; }
    }
    if (key === 'fullName' && /(company|school|university|employer|reference|manager|user|file|middle|preferred)\s*name/.test(desc)) key = null;
    if (key === 'coverLetter' && el.tagName !== 'TEXTAREA') key = null;

    const val = key ? values[key] : '';
    if (key && val) {
      const ok = el.tagName === 'SELECT' ? pickOption(el, val) : (setValue(el, val), true);
      if (ok) { mark(el, '#22a06b'); filled.push(label || key); continue; }
    }

    const required = el.required || el.getAttribute('aria-required') === 'true' || /\*/.test(desc);
    if (el.tagName === 'TEXTAREA' || (key === 'coverLetter')) {
      const id = 'ae-q-' + (++n) + '-' + Math.random().toString(36).slice(2, 7);
      el.setAttribute('data-applyease-q', id);
      questions.push({ id, label: label || 'Open question', maxLength: el.maxLength > 0 ? el.maxLength : null, isCoverLetter: key === 'coverLetter' });
      mark(el, '#e2a400');
    } else if (required) {
      mark(el, '#e2a400');
      review.push(label || 'field');
    }
  }

  // Radio button groups (yes/no questions, EEO). Picking an option is the same as typing an answer.
  const groups = new Map();
  for (const r of document.querySelectorAll('input[type=radio]')) {
    if (r.disabled || !visible(r) && !visible(r.closest('label') || r)) continue;
    const k = r.name || r.closest('[role=radiogroup],fieldset') || r;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const radios of groups.values()) {
    if (radios.some((r) => r.checked) && !OVERWRITE) continue;
    const q = groupQuestion(radios);
    let key = null;
    for (const [k, re] of RULES) { if (re.test(q)) { key = k; break; } }
    if (!key || ['fullName', 'firstName', 'lastName', 'email', 'phone', 'coverLetter'].includes(key)) {
      if (radios.some((r) => r.required)) { mark(radios[0].closest('fieldset,[role=radiogroup]') || radios[0].parentElement, '#e2a400'); review.push(q.slice(0, 140)); }
      continue;
    }
    const pick = bestChoice(radios.map((r) => ({ text: radioLabel(r), r })), values[key]);
    if (!pick) { review.push(q.slice(0, 140)); continue; }
    pick.r.click();
    if (!pick.r.checked) { pick.r.checked = true; pick.r.dispatchEvent(new Event('change', { bubbles: true })); }
    mark(pick.r.closest('fieldset,[role=radiogroup]') || pick.r.parentElement, '#22a06b');
    filled.push(q.slice(0, 140));
  }

  // Mark the most likely CV upload input so the app can attach the file.
  const files = Array.from(document.querySelectorAll('input[type=file]'));
  let cv = files.find((f) => /resume|cv|curriculum/.test(describe(f))) || files[0];
  files.forEach((f) => f.removeAttribute('data-applyease-file'));
  if (cv) cv.setAttribute('data-applyease-file', '1');

  return { filled, review, questions, hasFileInput: !!cv, fieldCount: fields.length };
}

function applyEaseAnswer(answers) {
  let count = 0;
  for (const { id, answer } of answers) {
    if (!answer) continue;
    const el = document.querySelector(`[data-applyease-q="${id}"]`);
    if (!el) continue;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    let text = answer;
    if (el.maxLength > 0) text = text.slice(0, el.maxLength);
    el.focus();
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.style.outline = '2px solid #4c6ef5';
    count++;
  }
  return count;
}

function applyEasePageInfo() {
  const og = (p) => document.querySelector(`meta[property="${p}"]`)?.content || '';
  const h1 = document.querySelector('h1')?.innerText || '';
  // schema.org JobPosting, if the page publishes one (most ATS and job boards do).
  const find = (n, d) => {
    if (!n || typeof n !== 'object' || d > 6) return null;
    if (Array.isArray(n)) { for (const x of n) { const f = find(x, d + 1); if (f) return f; } return null; }
    if ([].concat(n['@type'] || []).includes('JobPosting')) return n;
    for (const v of Object.values(n)) { const f = find(v, d + 1); if (f) return f; }
    return null;
  };
  let posting = null;
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { posting = find(JSON.parse(s.textContent), 0); } catch (e) { /* ignore */ }
    if (posting) break;
  }
  return {
    title: og('og:title') || document.title || h1,
    h1,
    site: og('og:site_name'),
    posting,
    text: (document.body?.innerText || '').slice(0, 20000)
  };
}

module.exports = {
  fillSource: applyEaseFill.toString(),
  answerSource: applyEaseAnswer.toString(),
  infoSource: applyEasePageInfo.toString()
};
