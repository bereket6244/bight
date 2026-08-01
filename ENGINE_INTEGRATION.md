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
| Checkpoint APK | `release/Bight-v1.4.0-MIT-blindfold.apk` |
| SHA-256 | `55a36c07eb5a53b47054cc5522b529a15c20fdad7bb9c6abd0a0d56fc32ad7d2` |
| Size | 54.31 MB |
| Engine | none — `inspect-apk` reports `NONE (engine-free build)` |

Both commits contain no engine code and no GPL obligation. Returning to either
restores an MIT-licensed app with the blindfold drills fully working.

`release/Bight.apk` is the current engine build. The checkpoint APK is kept
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
| APK size | 54.31 MB → 59.71 MB (+5.4 MB) |

## Architecture

```
src/services/engine/
  engineTypes.ts             the vocabulary; imports nothing from Bight
  engineConfig.ts            asset paths and timeouts
  weakPlay.ts                the difficulty model: MultiPV candidate selection
  UciParser.ts               pure text parsing, exhaustively tested
  EngineWorkerClient.ts      Worker lifecycle, one outstanding request, timeouts
  StockfishEngineService.ts  the EngineService implementation
  index.ts                   the only import surface

src/core/engineGame/game.ts       the game itself, chess.js-authoritative
src/core/engineGame/savedGame.ts  resuming an unfinished game
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

## Move presentation

A reply that lands in 40ms reads as nothing having happened. The engine turn
therefore has a **minimum presentation interval** (`MIN_THINKING_MS`, 800ms)
that runs *concurrently* with the search: a level that genuinely thinks for a
second is unaffected, and only an implausibly fast reply is held back.

Alongside it: amber last-move marks on origin and destination, distinct from
the selection and rejection marks; a "Computer played …" live region so the
information is never carried by colour alone; and both sides spoken when
speech is on.

Every computer turn carries a token. Resign, Try again, Play again, unmount
and backgrounding all invalidate it, so a reply arriving afterwards is dropped
rather than played onto a game that has moved on.

## Lifecycle across backgrounding

Hiding the app abandons the turn and records that the computer still owes a
move; returning plays exactly one, never two. Unfinished games are saved as
their move list and replayed through chess.js on return — see
`core/engineGame/savedGame.ts`. Nothing about the engine is stored.

## Difficulty

Four labels — **Beginner, Easy, Intermediate, Strong** — implemented in
`services/engine/weakPlay.ts`.

A real user reported that "Easy" played much too well, and it did: `Skill
Level` plus a shallow depth is not a beginner model, because shallow Stockfish
is still a strong club player. The obvious lever does not reach either — the
bundled build advertises `UCI_LimitStrength` with **`UCI_Elo` minimum 1320**,
already well above a beginner.

So the engine is asked for several candidates at once (MultiPV) with a score
for each, and one of *those* is chosen by a seeded, per-level weighted
distribution:

| Level | Candidates | Tolerance | Deviates |
| --- | --- | --- | --- |
| Beginner | 12 | 900 cp | 80% |
| Easy | 8 | 350 cp | 55% |
| Intermediate | 4 | 90 cp | 20% |
| Strong | 1 | — | never |

Every choice is a move Stockfish evaluated and reported, so a bad one is
plausible rather than nonsense. No level declines a forced mate or walks into
one, and none exceeds its own tolerance. Selection is pure and seeded, so the
behaviour is asserted rather than described, and chess.js still validates the
result.

Stored setting ids are unchanged (`very-easy`, `easy`, `moderate`, `strong`),
so saved settings and backups keep working.

**No Elo is claimed.** `UCI_Elo` is calibrated against Stockfish's own search
rather than any site's rating pool, and effective strength shifts with the time
control, so a number here would be one this project has not measured. This is
behavioural weakening, and is documented as such.

## Verification

| Command | What it proves |
| --- | --- |
| `npx vitest run src/services/engine/engine.test.ts` | 35 tests: UCI parsing, timeouts, crashes, stale replies, dispose |
| `npx vitest run src/core/engineGame/game.test.ts` | 26 tests: legality enforcement, illegal engine moves refused, promotion, every ending |
| `npx vitest run src/ui/EngineGame.integration.test.tsx` | 51 tests: the screen, with an injected engine that misbehaves on demand |
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
