# Engine integration

How Stockfish is wired into Bight, what was verified, and what to do if it
needs removing.

Licensing lives in `GPL_COMPLIANCE.md`; the exact binary and its source in
`ENGINE_SOURCE.md`; the licence chain in `ENGINE_LICENSES.md`.

## The Phase A safety gate

The engine work began only after a clean, known-good blindfold checkpoint
existed, and that checkpoint remains intact and independently useful.

| | |
| --- | --- |
| Checkpoint commit | `bab8ae156c22ab63e327967375971fbe25a49e7b` |
| Message | `feat: add blindfold training drills` |
| Version | 1.4.0 |
| Licence at that commit | MIT |
| Tests at that commit | 752 passing, 26 files |
| APK at that commit | `4b767cdf11e9d8ac032c6021cff879828e7772fcbd74aac2f22df15e523e7f00` |

Phase A was finished off in a follow-up commit, `67a442b`, which added the
difficulty presets, the fuller progress model and the real-Chromium review, and
took the suite to 800 tests. That commit's APK is the one kept in the tree:

| | |
| --- | --- |
| Checkpoint APK | `release/Bight-blindfold-checkpoint.apk` |
| SHA-256 | `55a36c07eb5a53b47054cc5522b529a15c20fdad7bb9c6abd0a0d56fc32ad7d2` |
| Size | 54.31 MB |
| Engine | none — `inspect-apk` reports `NONE (engine-free build)` |

Both commits contain no engine code and no GPL obligation. Returning to either
restores an MIT-licensed app with the blindfold drills fully working.

`release/Bight.apk` is the engine build (59.89 MB). The checkpoint APK is kept
alongside it deliberately: if the engine ever needs to be withdrawn, the
known-good engine-free build is already there and does not need rebuilding.

Working tree was clean and APK inspection passed before Phase B started.

## Verdict

**The integration succeeded.** The engine loads, plays, and is bundled into the
APK with no network access at any point.

| Check | Result |
| --- | --- |
| Boots in Chromium (dev server) | 229 ms to `uciok` |
| Boots in Chromium (production build) | 205 ms to `uciok` |
| Identifies itself | `Stockfish 18 Lite WASM` |
| Finds mate in one | `bestmove a1a8` from `6k1/5ppp/8/8/8/8/5PPP/R5K1 w` |
| Responds to `Skill Level 0` | yes, still returns legal moves |
| WASM served correctly | `application/wasm` |
| Present in the APK | 4 files under `assets/public/engine/`, wasm included |
| APK size | 54.31 MB → 59.76 MB (+5.45 MB) |

## Architecture

```
src/services/engine/
  engineTypes.ts             the vocabulary; imports nothing from Bight
  engineConfig.ts            asset paths, timeouts, difficulty presets
  UciParser.ts               pure text parsing, exhaustively tested
  EngineWorkerClient.ts      Worker lifecycle, one outstanding request, timeouts
  StockfishEngineService.ts  the EngineService implementation
  index.ts                   the only import surface

src/core/engineGame/game.ts  the game itself, chess.js-authoritative
src/ui/screens/EngineGameScreen.tsx   the only screen that touches the engine
```

### The rules this design enforces

- **chess.js is the authority, always.** `applyEngineMove` asks chess.js
  whether the engine's four characters are a legal move here. If they are not,
  the move is thrown out and the game stops with a stated reason rather than
  continuing from a position nobody can reproduce. The engine is a suggestion
  and nothing more.
- **Never on the main thread.** All search runs in a Worker.
- **One outstanding request.** UCI has no request ids, so a `bestmove` cannot
  be matched to a particular `go`. `EngineWorkerClient` therefore permits
  exactly one expectation at a time and stamps it with a token; a reply that
  arrives after its request was abandoned is dropped rather than answering the
  wrong question. `StockfishEngineService` serialises everything through one
  queue.
- **Position set explicitly for every search.** Never inferred from what the
  engine might remember.
- **Timeouts everywhere.** Handshake 30 s, `isready` 15 s, a search gets its
  own movetime plus 10 s of grace. A search that times out is stopped, and the
  engine stays usable afterwards.
- **Never running in the background.** The engine is started when a game
  starts and disposed when the game ends or the screen unmounts, whichever
  comes first.
- **Failure is contained.** The mode has its own screen, inside the error
  boundary that already isolates modes. An engine failure shows an explanation
  and cannot reach any other mode; the ordinary session machinery never sees
  the engine at all.

### What was deliberately not built

No analysis, no evaluation display, no opening book, no puzzle generation, no
engine hints inside the ordinary drills, no cloud anything. The engine exists
to play one game and nothing else. The `EngineService` interface has no method
that would return an evaluation.

## Assets

`scripts/prepare-engine.mjs` copies two files out of `node_modules/stockfish`
into `public/engine/`, verifying checksums, and writes a manifest. Vite copies
`public/` into `dist/`; Capacitor copies `dist/` into the APK.

The assets are **not committed**, matching how the Vosk voice model is handled:
7 MB of WebAssembly would otherwise be cloned by everyone. Unlike the voice
model, no download is involved — the files come from the pinned npm package
already in `package-lock.json`, so `npm ci && node scripts/prepare-engine.mjs`
reproduces them offline.

The Worker finds its own `.wasm` by replacing `.js` in its own URL, which is
why both files sit in the same directory under a plain path. No bundler import,
no hashing, no inlining.

## Difficulty

Four labels — Very easy, Easy, Moderate, Strong — implemented as `Skill Level`
plus a depth cap and a movetime.

**No Elo is claimed.** Stockfish's `UCI_LimitStrength`/`UCI_Elo` is calibrated
against its own search rather than any site's rating pool, and effective
strength shifts with the time control, so a number here would be one this
project has not measured. The labels describe how the level plays instead.

## Verification

| Command | What it proves |
| --- | --- |
| `npx vitest run src/services/engine/engine.test.ts` | 33 tests: UCI parsing, timeouts, crashes, stale replies, dispose |
| `npx vitest run src/core/engineGame/game.test.ts` | 26 tests: legality enforcement, illegal engine moves refused, promotion, every ending |
| `npx vitest run src/ui/EngineGame.integration.test.tsx` | 14 tests: the screen, with an injected engine that misbehaves on demand |
| `node scripts/engine-smoke.mjs` | the real engine, in real Chromium, on the dev server |
| `node scripts/engine-smoke.mjs --dist` | the same against the production build |
| `node scripts/inspect-apk.mjs` | the engine assets are actually inside the APK |

The unit tests use a scripted fake Worker: the failure modes that matter —
a search that never answers, a worker that dies, a reply arriving after its
request was abandoned — are all but impossible to trigger reliably with the
real engine, and trivial to trigger with a fake.

## Not verified

- **No emulator or device run.** The engine has not been exercised on Android
  hardware. Everything above is Chromium on the development machine plus APK
  inspection. Whether a 7 MB WebAssembly module loads acceptably fast in an
  Android WebView on a real phone is **unmeasured**.
- **Effective playing strength is unmeasured.** The difficulty labels are
  described, not calibrated.

## Removing the engine

If the GPL obligation is unwanted, or the engine causes trouble on device:

1. Delete `src/services/engine/`, `src/core/engineGame/`,
   `src/ui/screens/EngineGameScreen.tsx` and their tests.
2. Remove `blindfoldEngineGameMode` from `blindfold.ts` and the registry, and
   the `isEngineGame` branch in `App.tsx`.
3. Delete `scripts/prepare-engine.mjs`, `scripts/engine-smoke.mjs` and
   `public/engine/`.
4. `npm uninstall stockfish`.
5. Restore `LICENSE` from `LICENSE-MIT` and set `package.json` back to `MIT`.

Nothing else depends on any of it. That is what the isolated boundary was for.
