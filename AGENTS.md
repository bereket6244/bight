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

## Workflow for a future agent

1. Read `AGENTS.md`, `CODEX_HANDOFF.md`, `AUDIT_REPORT.md`, `TEST_REPORT.md`,
   `BUILD_STATUS.md`, `CHANGELOG.md`.
2. Reproduce the current behaviour — in a browser, or with a seeded test.
3. Add a **failing** regression test first.
4. Implement the smallest coherent fix.
5. `npm run verify`, then `npm run test:browser` for anything visual.
6. `npm run android:build` and `npm run inspect:apk` for anything that touches
   Android.
7. Update the docs and `CHANGELOG.md`.
8. **Never claim hardware verification without evidence.** There is no device
   or emulator on the build machine; say so plainly.

## Prohibited regressions

- reintroducing Next/Continue/Submit or a blocking result screen
- revealing the answer after a wrong response
- hand-written answer tables
- a fixed fallback question shown to users (this shipped once — see the audit)
- claiming "Ready" for voice without a proven microphone
- network calls at runtime
- committing `local.properties`, keystores, tokens or machine paths
- lowering the mastery bar to make numbers look better
