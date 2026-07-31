# Codex handoff

Practical engineering notes for continuing Bight. Read `AGENTS.md` first for
the rules; this file is about the current state and where the bodies are
buried.

## Current state

| | |
| --- | --- |
| Branch | `feature/blindfold-stockfish-handoff` |
| Base | `main` @ `5838304` (MIT, no engine, unchanged) |
| Phase A checkpoint | `bab8ae1` — `feat: add blindfold training drills` |
| Phase A completion | `67a442b` — presets, progress model, real-Chromium review |
| Engine commit | `3cb106d` — the offline Stockfish opponent |
| App version | **2.0.0** (`src/core/version.ts` is the source of truth) |
| Android versionCode | 20000 (derived: major×10000 + minor×100 + patch) |
| Storage schema | **1, unchanged** — the blindfold fields are optional |
| Backup format | `bight-backup`, schemaVersion 1; 1.3.0 backups import untouched |
| Licence | **GPL-3.0-or-later on this branch.** `main` stays MIT. |
| Tests | Vitest, **878 across 32 files**, plus 48 real-browser layout checks |

### APKs

| File | Size | SHA-256 | Engine | Licence |
| --- | --- | --- | --- | --- |
| `release/Bight.apk` | 59.70 MB | `2f8d92e7358b487bad0f2a27e844358bf03691e14906d97879d9017b96eaa166` | yes | GPLv3 |
| `release/Bight-engine.apk` | 59.70 MB | identical to the above | yes | GPLv3 |
| `release/Bight-blindfold-checkpoint.apk` | 54.31 MB | `55a36c07eb5a53b47054cc5522b529a15c20fdad7bb9c6abd0a0d56fc32ad7d2` | **no** | MIT |

All debug-signed. No production signing key exists for this project and none
was fabricated. The checkpoint APK is kept deliberately: if the engine has to
be withdrawn, a known-good engine-free build already exists.

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
- The progressive ladder is **per-session**; it does not remember the stage
  reached last time.
- `speakMoves` has no blindfold-specific test.
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
| APK cost | +5.4 MB (54.31 → 59.70 MB) |
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
| `ui/EngineGame.integration.test.tsx` | 17 — the screen, including failure recovery |
| `scripts/engine-smoke.mjs` | the real engine in real Chromium, dev **and** production build |
| `scripts/engine-game-check.mjs` | a real game played against the real engine |
| `scripts/inspect-apk.mjs` | engine assets asserted present in the APK |

### Engine gaps

- **No Android hardware or emulator run.** The biggest gap by far.
- **No saved unfinished game.** Leaving the screen ends it. The brief called
  this "where practical"; it was not done.
- Backgrounding stops the search but does not persist the game.
- No MultiPV or deliberate-error model — weakness is `Skill Level` and depth,
  which cannot produce a nonsensical move.

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

### 4. Persist an unfinished engine game

The game state is already a plain serialisable value, so this is small.

### 5. Curated sequences

Real games or thematic positions instead of weighted-random legal moves.

### 6. Speech for blindfold moves

`speakMoves` is wired; it needs a test and a listen on a device.

## The GPL question, for whoever decides it

**`main` is MIT and ships no engine. This branch is GPLv3 because it does.**
Nothing has been merged and nothing about `main` has changed.

Three options, all legitimate:

1. **Leave the branch unmerged.** `main` stays MIT and engine-free; the engine
   build is available from this branch. Nothing more to do.
2. **Merge it.** `main` becomes GPLv3. That is the repository owner's decision
   and it is one-way for the distributed application. Bight's own code stays
   available under MIT because there is a single copyright holder.
3. **Split it.** An MIT drills-only line and a GPL engine line. More
   maintenance, cleanest licensing.

To undo the engine entirely, `ENGINE_INTEGRATION.md` lists the exact five
steps. Nothing outside those files depends on it — that is what the isolated
boundary was for.

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
