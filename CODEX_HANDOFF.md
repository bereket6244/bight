# Codex handoff

Practical engineering notes for continuing Bight. Read `AGENTS.md` first for
the rules; this file is about the current state and where the bodies are
buried.

## Current state

| | |
| --- | --- |
| Branch | `main` |
| Merged | `feature/blindfold-stockfish-handoff`, non-squash, full history |
| Phase A checkpoint | `bab8ae1` — `feat: add blindfold training drills` |
| Phase A completion | `67a442b` — presets, progress model, real-Chromium review |
| Engine commit | `3cb106d` — the offline Stockfish opponent |
| Repair pass | `e45104c`, `163cb51`, `85d933a`, `d38e59e`, `91b4675` — the four device-reported failures and the release pipeline |
| Reveal control | 2.2.0 — Show/Hide pieces in the engine game, without touching the visibility setting |
| Public web | `https://bereket6244.github.io/bight/`, deployed from `main` by `.github/workflows/pages.yml` |
| Web storage | Session-only `MemoryRepository`; no IndexedDB or engine-game `localStorage` |
| App version | **2.2.0** (`src/core/version.ts` is the source of truth) |
| Android versionCode | 20200 (derived: major×10000 + minor×100 + patch) |
| Storage schema | **1, unchanged** — the blindfold fields are optional |
| Backup format | `bight-backup`, schemaVersion 1; 1.3.0 backups import untouched |
| Licence | **GPL-3.0-or-later.** 1.4.0 was the last engine-free MIT build. |
| Tests | Vitest, **1,003 across 37 files**, plus 48 layout + 64 blindfold-layout + 11 Pages checks |

### APKs

| File | Size | SHA-256 | Engine | Licence |
| --- | --- | --- | --- | --- |
| `release/Bight-v2.2.0-GPL-engine.apk` | 59.71 MB | `8346b925cd507e5d72766d3b9e4c777841f8948ff4f3b5c794d8dea09e51f6c4` | yes | GPLv3 |
| `release/Bight-v2.1.0-GPL-engine.apk` | 59.71 MB | `afe1681a2f21218c2a46efd7438550753b44e2e78fc8fee597f4d00f856708d6` | yes | GPLv3 |
| `release/Bight.apk` | 59.71 MB | byte-identical convenience copy of the above | yes | GPLv3 |
| `release/Bight-v1.4.0-MIT-blindfold.apk` | 54.31 MB | `55a36c07eb5a53b47054cc5522b529a15c20fdad7bb9c6abd0a0d56fc32ad7d2` | **no** | MIT |

All debug-signed. No production signing key exists for this project and none
was fabricated. The 1.4.0 build is kept deliberately: if the engine has to be
withdrawn, a known-good engine-free build already exists. Full index with
provenance in `release/RELEASES.md`.

## Public web target

The GitHub Pages build is a separate runtime target, not a weakening of the
Android app. `scripts/build-pages.mjs` sets `VITE_BIGHT_TARGET=web-demo`; Vite
uses `/bight/` as the base, while ordinary builds keep the Capacitor-safe `./`
base. `core/runtimeTarget.ts` owns the target and `assetUrl()` boundary used by
Stockfish, Vosk, icons, and web licence links.

Pages goes directly to `MemoryRepository`. Attempts, sessions, mastery,
recommendations, preferences, and unfinished games live only until refresh;
session summaries still use the same in-memory repository during the current
page. Android keeps SQLite -> IndexedDB -> memory and persistent unfinished-game
resume. Do not fold these policies together.

The Pages artifact includes Stockfish, the fetched Vosk model, `.nojekyll`, a
`404.html` SPA fallback, and the GPL/source-notice documents. The large Vosk
model is probed with HEAD and loaded only when voice input is actually used;
ordinary drills and the engine do not depend on it. `npm run test:pages` serves
the production artifact beneath a simulated `/bight/`, checks paths and MIME
types, boots the real engine, and asserts that no IndexedDB database appears.
Full operational notes are in `WEB_DEPLOYMENT.md`.

## Modes

Fifteen, in seven categories. `src/core/training/registry.ts` is the only list.

Coordinates: `coordinate-to-square`, `square-to-coordinate`, `alignment`
Square color: `square-color`
Knight: `knight-vision`, `knight-route`
Forks: `knight-fork`, `queen-fork`
Notation: `notation`
Position: `piece-vision`, `blockers`
Blindfold: `blindfold-tracking`, `blindfold-reconstruction`,
`blindfold-progressive`, `blindfold-engine-game`

The blindfold category is at its cap of four cards. A fifth needs a new
category or a variant on an existing card — `secondPass.test.ts` will refuse
it, and that guard is doing its job.

### Removed, with ids still alive at the data layer

`memory-coordinate-to-square`, `memory-square-to-coordinate`,
`piece-movement`, `sequence`, plus a dozen variants. See
`src/core/training/legacy.ts`. History and old backups render readable labels;
Home refuses to launch them.

## Blindfold drills

Full detail in **`BLINDFOLD_TRAINING.md`**. What matters before touching them:

- Sequences come from `core/chess/sequence.ts` and are **replayed through a
  fresh chess.js** before use, so SAN, per-ply positions, the final FEN and
  every capture are facts rather than the generator's opinion.
- Pieces are tracked by **identity**, so a promoted pawn and a castled rook are
  each followed correctly.
- Seven tracking question kinds, each with a deliberate answer balance so no
  question type is guessable.
- Reconstruction is tap-piece-then-tap-square, auto-completing, no Submit. The
  palette shows all twelve pieces with **no counts** — counts would give away
  the material balance.
- **Blindfold results are excluded from square mastery**, in `computeMastery`.
  Losing track of a piece is not the same as not knowing a square.
- Everything is seeded and reproducible.

### Reproducing anything

```bash
npm run dev
```
then in the browser:
```
?mode=blindfold-tracking&variant=mixed&seed=12345&debug=1
```

The diagnostics panel prints the expected answer, the question kind, the whole
sequence, the ply count, hints used and pieces placed. Development builds only.

```bash
node scripts/blindfold-walkthrough.mjs   # all 15 flows, in real Chromium
node scripts/browser-tests.mjs           # 48 layout checks, 4 viewports
```

### Known limitations

- Sequences are **generated, not curated** — legal and varied, but not
  instructive. A curated source would be a real improvement.
- Speech is asserted in tests but has never been *heard* on a device.
- No blindfold drill has been used on Android hardware.

## Engine

**Integration succeeded.** Detail in `ENGINE_INTEGRATION.md`; licensing in
`GPL_COMPLIANCE.md`, `ENGINE_SOURCE.md`, `ENGINE_LICENSES.md`.

| | |
| --- | --- |
| Mode id | `blindfold-engine-game` |
| Package | `stockfish@18.0.8`, pinned; tarball SHA-1 `f361d4b05f4c829a6f17da5cf18328525c5268f6` |
| Build | lite single-threaded WebAssembly |
| Worker | `stockfish-18-lite-single.js`, 21,429 bytes, SHA-256 `5243fd9b…c4a391` |
| WASM | `stockfish-18-lite-single.wasm`, 7,295,411 bytes, SHA-256 `a8fbc05e…9096f1` |
| Upstream | Stockfish 18 via <https://github.com/nmrugg/stockfish.js> tag `v18.0.8` |
| APK cost | +5.4 MB (54.31 → 59.71 MB) |
| Boot time | 229 ms dev, 205 ms production, desktop Chromium |

`EngineService` → `StockfishEngineService` → `EngineWorkerClient` → Worker.
UCI parsing is pure and separately tested. Everything is serialised through one
queue, **including the handshake**. chess.js validates every engine move in
`core/engineGame/game.ts`; an illegal one stops the game rather than being
played.

Difficulty is four labels backed by `Skill Level` plus a depth cap.
**Uncalibrated — no Elo is claimed** and none should be without measurement.

### Engine test status

| | |
| --- | --- |
| `services/engine/engine.test.ts` | 35 — parsing, timeouts, crashes, stale replies, handshake race |
| `core/engineGame/game.test.ts` | 26 — legality enforcement, promotion, every ending |
| `ui/EngineGame.integration.test.tsx` | 51 — hidden play, cadence, history, background/resume, resume-a-save |
| `services/engine/weakPlay.test.ts` | 28 — the difficulty ladder, measured over seeded runs |
| `core/engineGame/savedGame.test.ts` | 14 — saves replay or are refused |
| `scripts/engine-difficulty-check.mjs` | the weakening reaches the real engine |
| `scripts/engine-smoke.mjs` | the real engine in real Chromium, dev **and** production build |
| `scripts/engine-game-check.mjs` | a real game played against the real engine |
| `scripts/inspect-apk.mjs` | engine assets asserted present in the APK |

### Engine gaps

- **No Android hardware or emulator run.** The biggest gap by far.
- Engine-game saves are **local only** and not part of backup/restore. Losing
  them loses an unfinished game, nothing else.
- Difficulty is **uncalibrated**. The levels are measurably ordered against
  each other; none is tied to any rating.

## Architecture notes worth knowing

### Fork generation is constructive, not rejection-based

Pick the forking square first, then targets from what it attacks. The third
pass found the rejection-sampling version producing the same hard-coded
fallback board 200 times out of 200. There is no fallback position now;
failure throws.

### The session engine owns selection state

`selected`, `journey` and `placed` live in `core/session/engine.ts`, not in the
UI, because "is this set complete yet" decides whether to advance and that is
engine logic. `placed` doubles as the reconstruction board and is seeded from
the question's own FEN.

### Time is injected

Every session function takes `now`. Tests pass whatever they like; React passes
`Date.now()`. Nothing in `core/session` reads the clock.

### Fragile files

| File | Why |
| --- | --- |
| `core/chess/sequence.ts` | Everything blindfold rests on it. En passant victim resolution and castling rook identity are subtle; change with tests first. |
| `core/session/engine.ts` | Shared by every mode. |
| `core/progress/mastery.ts` | The `excludeBlindfold` call is load-bearing; removing it silently corrupts the board heat map. |
| `services/engine/EngineWorkerClient.ts` | The one-outstanding-request rule is what makes UCI safe. |

## What was never tested

Stated plainly, because it is the part most likely to be assumed:

1. **Anything on a real Android device or emulator.** No engine boot, no
   blindfold drill, no touch target, no APK install. Every layout and behaviour
   claim in these documents comes from Chromium at phone viewports on a desktop
   machine, plus reading the built APK's entry list.
2. **Engine playing strength.** The four labels are described, not measured.
3. **Voice or speech in blindfold modes.** The plumbing is shared with the rest
   of the app; no test exercises it here.
4. **A full game to checkmate against the real engine.** Only a handful of
   moves have been played through in a browser.
5. **Low-memory behaviour.** 7 MB of WASM plus a 42 MB voice model on a
   low-end phone is untested.

## Next tasks, highest value first

### 1. Run it on a real device

Everything else is guesswork until this happens.

```bash
node scripts/build-apk.mjs
adb install -r release/Bight.apk
adb logcat | grep -i -E "chromium|wasm|stockfish"
```

Check, in order: the app launches; ordinary drills work; the blindfold drills
work; **Blindfold vs Computer reaches "Your move"** — if the engine cannot
boot, that is where it will show.

If the engine fails to initialise on device, the fallback is already designed:
put the mode behind a capability check, keep the drills, document it. Do not
remove the drills.

### 2. Calibrate difficulty, or stop implying it is calibrated

Either measure the levels against a known opponent pool and say so, or leave
the labels as behavioural descriptions. Do not invent an Elo.

### 3. Reduce APK size

60 MB is large. The voice model is 42 MB of it and the engine 5.4 MB. Options:
download the voice model on demand, or ship an engine-free variant. Splitting
the engine out would also separate the GPL obligation cleanly.

### 4. Curated sequences

Real games or thematic positions instead of weighted-random legal moves.

### 5. Speech for blindfold moves

`speakMoves` is wired; it needs a test and a listen on a device.

## Licence state

`main` is GPL-3.0-or-later and ships Stockfish. Bight's own code remains
available under MIT in `LICENSE-MIT`; 1.4.0 is the preserved engine-free MIT
release. The Android APK and public Pages artifact both distribute Stockfish,
so both must retain the GPL, engine-source, and third-party notices.

## Workflow

Unchanged from the third pass, and still the fastest way to avoid trouble:

1. Reproduce the behaviour first — in a browser with `?debug=1&seed=…`, or
   with a seeded test.
2. Add a **failing** regression test.
3. Make the smallest coherent fix.
4. `npm run verify`, then `npm run test:browser` for anything visual, then the
   engine scripts for anything that touches the engine.
5. Update the docs and `CHANGELOG.md`.
6. **Never claim hardware verification without evidence.**
