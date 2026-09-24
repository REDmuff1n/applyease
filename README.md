# ApplyEase

A desktop app that makes internship and job applications fast. Set up your profile once, then for each job:

1. **Fill form**: your details go into the application form (name, email, phone, LinkedIn, university, country, start date, visa questions…). Filled fields turn green.
2. **Attach CV**: your saved CV is uploaded into the form's file field.
3. **Write answers**: open questions ("Why do you want to work here?") and cover letter boxes get drafts, from your saved answers or tailored by Claude. Written fields turn blue.
4. **You submit**: read it over, press the site's own Submit button, then **Mark applied** to log it in the tracker.

It also has a **fit checker** that scores a listing against what you want (roles, city/remote, paid only, language requirements vs. your levels, years of experience asked for), a **cover letter writer**, and an **application tracker** with CSV export.

## Permissions and privacy

- **Per-site permission**: the first time you fill a form on a new website, ApplyEase asks. You pick *Always allow*, *Allow once* or *Cancel*. You can remove sites in Settings.
- **Never submits**: the app only types into fields and attaches your CV. You always press Submit yourself.
- **Local data**: your profile, answers and tracker are saved in one JSON file on your computer (Settings → Open data folder). Nothing is uploaded.
- **AI is optional**: turn on Claude in Settings with your own API key for tailored letters and answers. The key is encrypted with your OS keychain and only sent to `api.anthropic.com`.
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
src/ai.js              cover letters / answers (Claude or templates)
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
