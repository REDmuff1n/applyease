# ApplyEase

A desktop app that makes internship and job applications fast. Set up your profile once, then for each job:

1. **Fill form**: your details go into the application form (name, email, phone, LinkedIn, university, country, start date, visa questions…). Filled fields turn green.
2. **Attach CV**: your saved CV is uploaded into the form's file field.
3. **Write answers**: open questions ("Why do you want to work here?") and cover letter boxes get drafts, from your saved answers or tailored by AI. Written fields turn blue.
4. **You submit**: read it over, press the site's own Submit button, then **Mark applied** to log it in the tracker.

It also has:

- **Live jobs**: a dashboard of the newest listings that match your roles and places, refreshed every time you open the app (and every 30 minutes while it's open). New jobs since your last visit get a badge. Sources: Arbeitnow, Himalayas, Remotive, Remote OK, The Muse and your company boards (no key needed), plus Adzuna, Jooble and **JSearch**, which brings in jobs posted on LinkedIn, Indeed and Glassdoor through Google for Jobs (free keys). One click also opens LinkedIn, Indeed or Glassdoor's own search, filtered to the last 24 hours, in the apply window.
- **Company boards**: in Settings → Live job sources, paste the careers-page links of companies you like (Greenhouse, Lever, Ashby, Workable, SmartRecruiters; add `?country=hu` to a SmartRecruiters link for one country). Every open role there appears on the Live jobs dashboard, for as long as the company lists it.
- **Fit checker**: scores a listing against what you want (roles, city/remote, paid only, language requirements vs. your levels, years of experience asked for). Job pages are read from their structured `JobPosting` data when the site publishes it, so the company, title, location and salary come through cleanly.
- **Any AI provider**: Claude, ChatGPT, Gemini (free tier), DeepSeek, Groq (free tier, open models), OpenRouter, Mistral, a free model on your own computer with **Ollama** or LM Studio, or any other OpenAI-compatible server. "Load list" shows the models your provider offers.
- **Score & tailor saved jobs** (Tracker): one button goes through every saved job, gives it an AI score, and for good matches writes a tailored CV (PDF) and cover letter into Documents › ApplyEase. When you open that job later, Attach CV and Write answers use the tailored versions.
- **AI score** (optional): a 1–10 recruiter-style score with your strengths, gaps and the keywords to mirror.
- **Tailored CV** (optional): rewrites your CV for one job (reorders and rewords, never adds employers, tools or numbers) and saves it as a one-page PDF.
- **Writing check**: AI letters, answers and CVs are checked for clichés, chatbot leftovers ("Here is…"), unfilled placeholders and numbers that aren't in your own profile or CV. The AI gets one retry, and anything still wrong is shown to you.
- **Cover letter writer** and an **application tracker** with CSV export.

The form filler handles text fields, dropdowns and yes/no radio buttons, including relocation, 18+, preferred name, state/region, GitHub, years of experience and voluntary diversity (EEO) questions. "Prefer not to say" picks whichever decline option the site uses.

## Permissions and privacy

- **Per-site permission**: the first time you fill a form on a new website, ApplyEase asks. You pick *Always allow*, *Allow once* or *Cancel*. You can remove sites in Settings.
- **Never submits**: the app only types into fields and attaches your CV. You always press Submit yourself.
- **Local data**: your profile, answers and tracker are saved on your computer (Settings → Open data folder). Nothing is uploaded except requests to the AI provider and job sources you turn on.
- **AI is optional**: pick a provider in Settings and add your own key (or run a local model with Ollama, which needs no key and keeps everything offline). Keys are encrypted with your OS keychain and only sent to the provider you picked.
- **No scraping**: LinkedIn, Indeed and Glassdoor forbid scraping and ban accounts for it, so ApplyEase never scrapes them. Their listings come through JSearch (Google for Jobs), and their own search pages open in the apply window, where you browse as yourself.
- **Websites opened inside the app** can't use your camera, microphone, location or notifications.

## Install (users)

Download the installer for your system from the [Releases page](https://github.com/REDmuff1n/applyease/releases/latest):

| System | File | First launch |
|---|---|---|
| Windows | `ApplyEase Setup x.y.z.exe` | If SmartScreen warns, click **More info → Run anyway** (the app isn't code-signed yet). |
| macOS | `ApplyEase-x.y.z.dmg` | Right-click the app → **Open** the first time (not notarised yet). |
| Linux | `ApplyEase-x.y.z.AppImage` | `chmod +x ApplyEase-*.AppImage` then run it. |

## Develop

```bash
npm install
npm start          # run the app
npm test           # unit tests + end-to-end test (Linux: prefix with xvfb-run -a)
```

## Build installers

```bash
npm run dist:win     # Windows .exe (on Linux this needs wine)
npm run dist:mac     # macOS .dmg (must run on a Mac)
npm run dist:linux   # Linux .AppImage
```

Or let GitHub do it. Push this folder to a GitHub repo, then:

```bash
git tag v1.0.0 && git push --tags
```

`.github/workflows/release.yml` builds Windows, macOS and Linux installers and attaches them to a GitHub Release.

## Project layout

```
src/main.js            app window, apply window, permissions, IPC
src/autofill.js        the form-filling script run inside job pages
src/fit.js             offline job-fit scoring
src/discover.js        company boards: Greenhouse / Lever / Ashby / Workable / SmartRecruiters APIs
src/match.js           role / place / job-type matching for the dashboard
src/site-preload.js    runs in job websites: stops the automatic passkey pop-up
src/jobdata.js         JSON-LD JobPosting extraction and HTML-to-text
src/quality.js         clichés, AI leftovers, placeholders and invented-number checks
src/ai.js              cover letters, answers, AI score, tailored CV (AI or templates)
src/llm.js             AI providers: Anthropic + any OpenAI-compatible API (OpenAI, Gemini, DeepSeek, Groq, Ollama…)
src/feeds.js           Live jobs sources, refresh limits, merging and "new" tracking
src/store.js           local storage, encrypted API key
src/preload.js         safe bridge for the main UI
src/toolbar-preload.js safe bridge for the apply-window toolbar
src/renderer/          UI (plain HTML/CSS/JS, no build step)
test/                  unit tests, end-to-end test and a fake job form
```

## Before you sell or widely share it

- **Code signing** removes the Windows/macOS warnings: a Windows certificate (about $100–300/yr) and an Apple Developer account ($99/yr). Add them as GitHub secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`…) and remove `CSC_IDENTITY_AUTO_DISCOVERY: false` from the workflow.
- **Site terms**: some job boards (LinkedIn in particular) don't allow automation. ApplyEase only fills fields you could type yourself and never submits, but it works best on company career pages and ATS forms (Greenhouse, Lever, Workable, Ashby, SmartRecruiters, Teamtailor…).

MIT licence.
