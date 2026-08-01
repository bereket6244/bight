# AGENTS.md — working on Bight

Instructions for any agent (or person) picking this repository up.

## What Bight is

An **offline Android trainer for chess coordinates and board vision**. "Bight"
means *board sight*. It trains one narrow thing: knowing the board — naming any
square instantly, seeing what a piece attacks, holding it in your head.

## Non-goals

Not a chess app. **Never add** any of these:

- playing a game, an engine, evaluation, or an opponent
- puzzles with a "best move", tactics ratings, or material judgement
- accounts, a backend, cloud sync, telemetry, analytics, or advertising
- multiplayer, social features, or leaderboards
- any network call after installation

## Architecture

```
src/core/chess/       Deterministic chess truth. No UI, no storage.
src/core/training/    Modes, generators, grading, the registry.
src/core/session/     The session state machine (pure, time injected).
src/core/progress/    Mastery, statistics, streaks, usage ranking.
src/core/storage/     Repository contract + SQLite/IndexedDB/memory engines.
src/core/backup/      Versioned JSON backup, validation, migrations.
src/core/dev/         Development-only diagnostics. Gated out of production.
src/services/         Speech, haptics, sound, voice recognition.
src/services/engine/  Stockfish behind one interface (engine branch only).
src/core/engineGame/  The engine game, with chess.js as the only authority.
src/ui/               React screens and components.
scripts/              Build, icon, version, setup and inspection tooling.
```

**Dependency direction is one-way**: `ui → services → core`. Core never imports
from `ui`. Nothing in `core/chess` imports storage or React.

## Commands

```bash
npm run setup          # check Node/Java/SDK, install, report what is missing
npm run verify         # version + icon check, lint, typecheck, full test suite
npm run test:browser   # real-browser layout tests (needs puppeteer)
npm run android:build  # sync version, build web, cap sync, assemble APK
npm run inspect:apk    # read the built APK's entry list back
```

Toolchain, as built: Node 18.18, JDK 21, Android SDK 34+35, Vite 5,
Capacitor 6, Vitest 2. **Node 18 is what pins the stack** — Vite 7 and
Capacitor 7 both need Node 20+.

## The rules that matter

### Chess truth is programmatic

No answer is ever hand-written. Every correct answer is computed at runtime.

- **Geometry** (`core/chess/geometry.ts`) — where a movement pattern reaches,
  ignoring occupancy, turn order and check.
- **Legality** (`core/chess/legal.ts`) — delegated entirely to `chess.js`,
  including SAN and disambiguation.

These are different questions with different answers. **Never blur them.**
Every mode declares which it means, and the UI shows it.

### Continuous practice

Non-negotiable, and enforced by a test that runs over every registered mode:

- no Next button, no Continue button, no per-question Submit
- no blocking "Correct" screen
- a correct answer advances **immediately**
- a wrong answer flashes red, keeps the same question, and **never reveals the
  answer**
- multi-square questions complete themselves when the set is complete
- input locks for `ADVANCE_LOCK_MS` (180ms) when a question is replaced

### Offline and private

Everything is on-device. The only network use in the whole repository is
`scripts/fetch-voice-model.mjs`, a build-time download.

### Adding a mode

1. Write a generator in `src/core/training/generators/`.
2. Export a `ModeDefinition` with `category`, a **one-line** `summary` (60 chars
   max, asserted by test), and its variants.
3. Register it in `src/core/training/registry.ts`.
4. That is all — the browser, Home, setup and every contract test read the
   registry, so nothing else needs touching.

The generator contract tests will immediately require that it produces
well-formed, solvable, reproducible questions whose stored answer matches what
the chess core independently computes.

### Removing a mode

Never just delete the id. Add it to `src/core/training/legacy.ts` so stored
history and old backups still render a readable label, and point it at a
replacement if one exists.

### Versioning

`src/core/version.ts` is the **single source of truth**. Run
`npm run sync:version` to propagate it; `npm run verify` fails if package.json
or the Android `versionName`/`versionCode` disagree. Never write a version
literal anywhere else — a test forbids it.

### Backup compatibility

Old backups must keep importing. New attempt fields must be optional. Bump
`SCHEMA_VERSION` only when a shape genuinely changes, and add a migration plus
a fixture when you do.

### UI conventions

- The app shell is a `100dvh` flex column; only `.app__main` scrolls.
- The bottom nav is pinned and content is padded past it plus
  `env(safe-area-inset-bottom)`.
- **Never** use `position: sticky` for an action bar inside the scroller — that
  caused the Start-button overlap bug. Put actions in the scroll flow.
- Mode cards: name plus one line. Longer text goes behind the info button.
- Segmented controls carry text labels; icons alone are not enough.
- American spelling. A test fails the build on "practise"/"practising".

### Voice

Three separate capabilities, and they must stay separate:

| | Microphone? |
| --- | --- |
| Sound effects | No |
| Spoken prompts (TTS) | No |
| Voice answers (Vosk) | Yes, on explicit user action only |

`ready` means model **and** library **and** permission **and** a stream that
actually opened. Never report readiness from model presence alone — that was a
real shipped bug. See `src/services/voice/state.ts`.

## Blindfold training

Full detail in `BLINDFOLD_TRAINING.md`. What an agent needs before touching it:

### Modes

| Mode id | Card |
| --- | --- |
| `blindfold-tracking` | Track a Position |
| `blindfold-reconstruction` | Reconstruct a Position |
| `blindfold-progressive` | Progressive Blindfold |
| `blindfold-engine-game` | Blindfold vs Computer (engine branch only) |

Variants live in **setup pages**, never as extra cards. The guards in
`secondPass.test.ts` cap cards per category and variants per mode; when one
fires, that is the guard working, not an obstacle to route around.

### Sequences

`core/chess/sequence.ts` generates legal move sequences and then **replays them
through a fresh chess.js instance** to confirm them. SAN, UCI, per-ply
positions, the final FEN, the side to move and every capture are recorded
facts.

- Pieces are tracked by **identity** (`${color}-${type}-${origin}`), so a piece
  survives promotion and castling.
- En passant victims are resolved before the move is applied — the captured
  pawn is not on the destination square.
- Capture bias is a *preference*: an unmeetable request degrades to the
  capture-heaviest sequence found rather than failing.
- If no legal sequence can be built, generation **throws**. There is no canned
  fallback position.

**The position the moves produce is never drawn while the question is live**,
at any stage. It is the answer.

### Reproducing a question

```
?mode=blindfold-tracking&variant=mixed&seed=<seed>&debug=1
```

`?debug=1` shows the diagnostics panel: mode, variant, seed, expected answer,
and for blindfold questions the kind, ply count, visibility, whole SAN
sequence, hints used and pieces placed. Development builds only.

In a test: `generateTrackingQuestion(context(), createRng(seed), variantId)`.

### Reconstruction grading

`state.placed` is the live board, seeded from `question.board.fen` — empty for
`partial`/`full`, the damaged position for `correction`. Completion is decided
by `gradeQuestion`, never by counting pieces, so "finished" and "correct"
cannot drift apart. Clearing a square is a real answer and can complete the
question; clearing a piece that belongs there is a mistake.

The palette always shows **all twelve pieces with no counts**. Showing only
what is still needed would give away the material balance.

### Progress

`core/progress/blindfold.ts`. **Blindfold attempts are excluded from
`computeMastery` outright** — losing track of a piece is not the same as not
knowing a square, and folding them in would make adaptive practice drill the
wrong thing.

Four optional `Attempt` fields carry the context: `hintsUsed`, `plies`,
`boardVisibility`, `blindfoldKind`. Optional by design, so **the schema version
is unchanged and no migration exists**; 1.3.0 backups import untouched and
absent fields read as "not recorded".

### Adding a question type

Add the kind to `TrackingKind` and `kindsForVariant`; derive `expected` from
the sequence, never invent it; give it a `kind` string and a `KIND_LABELS`
entry; balance the answer; add a test that re-derives the answer from an
independent replay. Never assert against the generator's own bookkeeping.

## The engine

Full detail in `ENGINE_INTEGRATION.md`, licensing in `GPL_COMPLIANCE.md`.

Bight bundles Stockfish and is distributed under GPL-3.0-or-later. Bight's own
code remains available under MIT (`LICENSE-MIT`). Version 1.4.0 was the last
engine-free MIT build and is kept in `release/`.

### Where it lives

```
src/services/engine/          the whole boundary; import only from index.ts
src/core/engineGame/game.ts   the game, chess.js-authoritative
src/ui/screens/EngineGameScreen.tsx   the only screen that touches it
public/engine/                the assets, copied by scripts/prepare-engine.mjs
```

| | |
| --- | --- |
| Package | `stockfish@18.0.8`, pinned exactly |
| Build | lite single-threaded WebAssembly (~7 MB) |
| Worker path | `engine/stockfish-18-lite-single.js` |
| WASM path | `engine/stockfish-18-lite-single.wasm` |

The Worker finds its own `.wasm` by replacing `.js` in its own URL, which is
why both sit in one directory under a plain path. Not a bundler import.

### UCI lifecycle

`uci` → wait `uciok` → `isready` → wait `readyok` → `ucinewgame` → `isready` →
per move: `position … moves …` then `go depth N movetime M` → wait `bestmove`.

UCI has **no request ids**, so exactly one exchange may be outstanding.
`EngineWorkerClient` enforces that and stamps each with a token; a reply to an
abandoned search is dropped. `StockfishEngineService` serialises everything —
including the handshake — through one queue.

### Non-negotiable engine rules

- **chess.js is the legality authority, always.** The engine proposes four
  characters of text; `applyEngineMove` asks chess.js whether that is legal
  here and stops the game with a stated reason if not. Never ask Stockfish to
  adjudicate legality or termination.
- **Ordinary drills must never depend on the engine**, and must keep working
  when it fails. The engine mode has its own screen for that reason.
- **Engine assets must never load for a non-engine mode.** The Worker is
  constructed when a game starts, not before.
- **Never on the main thread. No pondering, no background search, one Worker.**
- Disposed when the game ends or the screen unmounts; search stopped when the
  app is backgrounded.
- **No analysis, evaluation, opening book or engine hints in the drills.**

### Engine obligations

- The distributed application is **GPLv3**. `LICENSE` is GPLv3, `LICENSE-MIT`
  preserves the previous licence, and `package.json` says `GPL-3.0-or-later`.
- `ENGINE_SOURCE.md` must keep matching the binary actually shipped — package
  version, checksums, build steps. Changing the engine means updating it.
- Adding the engine is a **major** version bump: it changes what is
  distributed, the APK size, and the licence.
- `npm run inspect:apk` asserts the engine assets are inside the APK. A build
  with the worker but no wasm fails.

### Difficulty

Four labels backed by `Skill Level` plus a depth cap. **Never claim an Elo.**
Stockfish's `UCI_Elo` is calibrated against its own search, not any rating
pool, and strength moves with the time control. A test asserts the difficulty
descriptions contain no rating-shaped number.

### Hardware

**The engine has never been run on Android hardware or an emulator.** Whether
7 MB of WebAssembly loads acceptably in a real Android WebView is unmeasured.
Do not describe it as verified on device without running it on one.

## Definition of done (standing, for every task)

This applies to **every** repository-changing task, without being asked. Do not
wait for the user to say "handover", and do not write a new handoff document
each pass — the living documents below already exist.

1. Inspect the current repository and instructions before changing anything.
2. Work on the intended branch. `main` is the branch unless told otherwise.
3. Reproduce the problem first — in a browser with `?debug=1&seed=…`, or with a
   seeded test. **Add a failing regression test before the fix.**
4. Run the relevant verification (below).
5. Build the APK for anything user-facing or Android-affecting, and inspect it.
6. Bump the version when a release is produced, and use a versioned artifact
   filename.
7. Update `CHANGELOG.md` and `release/RELEASES.md`.
8. Update the living documents when behaviour or architecture changes.
9. Commit with a message that says what changed and why.
10. **Push.** Then verify the remote commit is what you think it is.
11. Report: branch, commit, tests, APK filename, checksum, and what is still
    unverified.

Standing rules:

- Never finish with uncommitted changes unless genuinely blocked — say so if
  you are.
- Never claim completion before pushing, when push access exists. If a push
  fails, report the exact error and leave a clean local commit.
- Never overwrite the only copy of a previous release artifact.
- Never let an unversioned APK be the sole authoritative release.
- **Never describe something as verified on Android without running it on
  Android.** Desktop Chromium is not a phone, and this project has already
  shipped a build that passed every automated check and was unusable on a
  device.

### Living documents

| File | Holds |
| --- | --- |
| `AGENTS.md` | permanent rules and workflow — this file |
| `CODEX_HANDOFF.md` | current architecture, fragile areas, active state, open limitations. Update when those change; it is not an essay to rewrite each pass. |
| `BUILD_STATUS.md` | facts about the latest build only |
| `release/RELEASES.md` | the historical build index |
| `CHANGELOG.md` | version history |
| `BLINDFOLD_TRAINING.md`, `ENGINE_INTEGRATION.md`, `GPL_COMPLIANCE.md` | subsystem detail |

### Verification commands

```bash
npm run verify            # engine assets, version sync, icons, lint, types, tests
npm run test:browser      # layout, 4 viewports, real Chromium
npm run test:layout       # blindfold layout: no hidden gaps, usable grid
npm run test:blindfold    # every blindfold flow, completed in a browser
npm run test:engine       # real Stockfish: smoke, a real game, difficulty
npm run verify:licenses   # GPL paperwork matches the shipped binary
npm run verify:release    # artifact naming, checksums, docs agree with source
npm run release:android   # versioned APK + .sha256 + convenience copy
npm run inspect:apk       # read the built APK's contents back
```

### Release artifact naming

Every authoritative APK carries its version, licence and variant:

    Bight-v<version>-<licence>-<variant>.apk

`release/Bight.apk` is a convenience copy of the newest build, written
byte-for-byte from the versioned file. `npm run verify:release` fails if they
drift, if a duplicate binary appears under two names, or if the documents stop
agreeing with the source version.

### Board display semantics

`Board` takes `displayMode`, never a `hidden` boolean:

| Mode | Draws | Interactive | Layout space |
| --- | --- | --- | --- |
| `position` | pieces | yes | yes |
| `empty-input` | grid + coordinate labels only | **yes** | yes |
| `collapsed` | nothing | no | **none** |

This distinction is not cosmetic. A single `hidden` boolean meaning
`visibility: hidden` shipped two device-breaking bugs at once: it made the only
move-entry surface in Blindfold vs Computer invisible while leaving its buttons
in the DOM, and it reserved a board-sized blank gap in reconstruction. When
adding a mode, choose deliberately:

- The board is how the user answers → `position` or `empty-input`.
- There is nothing to look at *and* nothing to tap → `collapsed`.

On `empty-input`, nothing about the hidden position may leak: no pieces, no
legal-destination marks (suppress them at the screen, not just in rendering),
no piece names in square labels. Last-move marks are allowed — the user can
already read the move in SAN.

## Prohibited regressions

- reintroducing Next/Continue/Submit or a blocking result screen
- revealing the answer after a wrong response
- hand-written answer tables
- a fixed fallback question shown to users (this shipped once — see the audit)
- claiming "Ready" for voice without a proven microphone
- network calls at runtime
- committing `local.properties`, keystores, tokens or machine paths
- lowering the mastery bar to make numbers look better
- a `hidden` boolean on the board, or any state that hides an input surface
  while leaving it in the DOM
- reserving board-sized layout space for a board that is not drawn
- an engine reply applied with no perceptible delay or last-move emphasis
- claiming a difficulty level corresponds to any rating
- folding blindfold results into square mastery
- letting the engine decide what is legal, or letting a drill depend on it
- loading engine assets for a non-engine mode
- claiming an Elo for the engine difficulty levels
- shipping engine binaries without keeping ENGINE_SOURCE.md accurate
