# Bight web deployment

## Public site

<https://bereket6244.github.io/bight/>

The site is a static GitHub Pages project site. It needs no account, backend,
database server, API route, secret, analytics, advertising, or runtime package
installation. Stockfish and voice recognition run locally in the browser.

## Workflow and build

`.github/workflows/pages.yml` runs on every push to `main` and on manual
dispatch. It installs with `npm ci`, fetches the Vosk model, builds and tests
the Pages artifact, uploads only `dist/`, and deploys with the official GitHub
Pages Actions.

Reproduce it locally:

```bash
npm ci
npm run fetch:voice-model
npm run build:pages
npm run test:pages
```

`scripts/build-pages.mjs` sets `VITE_BIGHT_TARGET=web-demo`. `vite.config.ts`
then uses `/bight/` as `base`; the normal Android/local build keeps `./`.
The build adds `.nojekyll`, copies `index.html` to `404.html`, copies the GPL
and engine-source documents, and refuses to finish if required engine, voice,
or licence files are absent.

## Storage policy

The web target selects `MemoryRepository` immediately. It does not probe
SQLite or IndexedDB. Attempts, sessions, mastery, history, recommendations,
preferences, and backup imports exist only in the current page session.
Current-session statistics and the end-of-session summary work normally; a
refresh or closed tab starts clean.

Unfinished engine games bypass `localStorage`, so refresh never offers Resume.
The ordinary app target is unchanged: SQLite where available, then IndexedDB,
then memory, plus persistent unfinished-game resume.

## Static asset paths

Runtime files copied from `public/` use `assetUrl()` in
`src/core/runtimeTarget.ts`, which is based on `import.meta.env.BASE_URL`.
Never construct absolute `/engine/`, `/models/`, icon, sound, or generated
asset URLs in application code.

For Pages, the important URLs are:

- `/bight/engine/stockfish-18-lite-single.js`
- `/bight/engine/stockfish-18-lite-single.wasm`
- `/bight/models/vosk-model-small-en-us-0.15.tar.gz`

For Capacitor they resolve relative to its local web root. The Stockfish Worker
and WASM remain beside one another, so the Worker can locate its WASM by
replacing its own `.js` suffix.

## Voice model

The workflow downloads the Apache-2.0 Vosk small English model during the
build and publishes it inside `/bight/models/`. Opening Bight probes it with a
HEAD request only; the roughly 39 MB model is downloaded when the user enables
voice input. A workflow model-download failure fails the deployment rather
than publishing a build that appears voice-capable without the model. Ordinary
drills, keypad/touch input, and Blindfold vs Computer do not depend on voice.

## Verification

`npm run test:pages` serves `dist/` under a simulated `/bight/` path and uses
real Chromium to verify:

- the app and SPA fallback boot;
- the session-only notice is visible;
- Worker, WASM, and voice-model URLs return 200;
- WASM is served as `application/wasm`;
- Stockfish reaches UCI readiness and returns a move;
- no IndexedDB database is created;
- the console and ordinary asset requests have no failures.

After a deployment, also inspect the Actions run and use a real browser at the
public URL to complete a normal session, refresh to confirm it clears, and play
at least one move in Blindfold vs Computer with pieces hidden and revealed.

## Licensing

The Pages artifact distributes Stockfish and is GPL-3.0-or-later. It publishes
`LICENSE`, `LICENSE-MIT`, `GPL_COMPLIANCE.md`, `ENGINE_SOURCE.md`,
`ENGINE_LICENSES.md`, and `THIRD_PARTY_NOTICES.md`; the Settings About card
links to them in the web target.

## Disable Pages safely

In repository Settings -> Pages, unpublish the site or change the source away
from GitHub Actions. Then remove or disable `.github/workflows/pages.yml` in a
normal reviewed commit. Do not delete Android release artifacts or change the
default branch, repository visibility, licence, or Android build to disable
the web deployment.
