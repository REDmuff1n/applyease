// This function is serialised and run inside each frame of the job page.
// It only types into fields. It never clicks buttons or submits anything.
function applyEaseFill(profile, opts) {
  const OVERWRITE = !!(opts && opts.overwrite);
  const RULES = [
    // [profile key, regex on field description, autocomplete tokens]
    ['email', /e-?mail/, ['email']],
    ['linkedin', /linked\s?in/, []],
    ['firstName', /first[\s_-]?name|given[\s_-]?name|fore[\s_-]?name|\bfname\b|vorname|keresztn/, ['given-name']],
    ['lastName', /last[\s_-]?name|sur[\s_-]?name|family[\s_-]?name|\blname\b|nachname|vezet[eé]kn/, ['family-name']],
    ['fullName', /^\s*(your\s+)?(full\s+|legal\s+|candidate\s+)?name\s*\*?\s*$|full[\s_-]?name|\bname\b(?!.*(company|school|university|employer|reference|manager))/, ['name']],
    ['phone', /phone|mobile|telephone|\btel\b|cell/, ['tel', 'tel-national']],
    ['postcode', /zip|postal|post[\s_-]?code/, ['postal-code']],
    ['city', /\bcity\b|\btown\b|location\s*\(city\)/, ['address-level2']],
    ['country', /\bcountry\b/, ['country', 'country-name']],
    ['address', /address|street/, ['street-address', 'address-line1']],
    ['website', /website|portfolio|personal\s+(site|url)|github|other\s+url/, ['url']],
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

  function pickOption(sel, value) {
    const v = clean(value).toLowerCase();
    if (!v) return false;
    const opts = Array.from(sel.options).filter((o) => o.value !== '' && !o.disabled);
    let o = opts.find((x) => clean(x.text).toLowerCase() === v)
      || opts.find((x) => clean(x.text).toLowerCase().startsWith(v))
      || opts.find((x) => v.length > 2 && clean(x.text).toLowerCase().includes(v))
      || opts.find((x) => { const t = clean(x.text).toLowerCase(); return t.length > 2 && v.includes(t); });
    if (!o) return false;
    setValue(sel, o.value);
    return true;
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
  return {
    title: og('og:title') || document.title || h1,
    h1,
    site: og('og:site_name'),
    text: (document.body?.innerText || '').slice(0, 20000)
  };
}

module.exports = {
  fillSource: applyEaseFill.toString(),
  answerSource: applyEaseAnswer.toString(),
  infoSource: applyEasePageInfo.toString()
};
