# Changelog

All notable changes to Bight. Dates are the day the work landed.

## Unreleased — 2026-07-31 (offline engine, on this branch only)

**This section describes work on `feature/blindfold-stockfish-handoff`, not on
`main`.** It bundles Stockfish, which changes the licence of the distributed
application. `main` remains MIT and ships no engine.

### Added

- **Blindfold vs Computer** (`blindfold-engine-game`): a whole game against
  Stockfish 18 running on the device. Choose a side, one of four strengths, how
  much of the board you keep, and whether moves are read aloud. Moves are made
  by tapping origin then destination on a board you may not be able to see.
- **An isolated engine boundary** in `src/services/engine/`: a Worker client
  that permits exactly one outstanding UCI request and drops replies belonging
  to abandoned searches, a pure UCI parser, and a service that serialises every
  exchange. The engine never runs on the main thread and is disposed the moment
  a game ends.
- `scripts/prepare-engine.mjs` copies the engine out of the pinned npm package
  with checksum verification; `scripts/engine-smoke.mjs` proves the real engine
  boots and plays in real Chromium, against both the dev server and the
  production build; `scripts/inspect-apk.mjs` now asserts the engine assets are
  actually inside the APK.

### Changed

- **Licensing.** Stockfish is GPLv3, so the application distributed from this
  branch is offered as a whole under GPLv3. `LICENSE` is now the GPLv3 text and
  the previous MIT licence is preserved verbatim as `LICENSE-MIT` — Bight's own
  code, written by a single copyright holder, remains available under MIT. No
  permissive dependency has been relicensed. See `GPL_COMPLIANCE.md`,
  `ENGINE_SOURCE.md` and `ENGINE_LICENSES.md`.
- The APK grew from 54.31 MB to 59.76 MB.

### Notes

- **chess.js remains the only authority on legality.** The engine proposes four
  characters of text; `applyEngineMove` asks chess.js whether that is a legal
  move in this position, and stops the game with a stated reason if it is not.
- No analysis, no evaluation display, no engine hints in the ordinary drills.
  The engine exists to play one game.
- **Not run on Android hardware or an emulator.** Whether 7 MB of WebAssembly
  loads acceptably in a real Android WebView is unmeasured.

## 1.4.0 — 2026-07-31 (blindfold training)

A new top-level category that teaches holding a position in your head. No
engine is involved: every sequence is generated and validated through chess.js,
and the app stays entirely offline.

### Added

- **Blindfold category, three modes.** *Track a Position* plays a legal move
  sequence and asks one targeted question about the position it produced —
  where a piece ended, what stands on a square, whether a square is occupied,
  whose move it is, whether a named piece survived, what a capture took, or
  what attacks what. *Reconstruct a Position* asks you to rebuild it, either a
  named subset, the whole thing, or by repairing a position shown with a few
  deliberate errors in it. *Progressive Blindfold* runs the same tracking
  questions up a six-stage ladder that removes visual help a stage at a time,
  either guided by your accuracy or held wherever you put it.
- **A validated sequence core** (`core/chess/sequence.ts`). Sequences are
  replayed through a fresh chess.js instance before they are used, so SAN, UCI,
  the position after every ply, the final FEN, the side to move and every
  capture are recorded facts rather than the generator's own bookkeeping.
  Pieces are tracked by identity, so a promoted pawn and a castled rook are
  each followed to where they actually end up.
- **Reconstruction by tapping**: pick a piece, tap a square. Correct placements
  stay, wrong ones flash and are discarded, and the question completes itself
  the moment the position is right. No Submit button, in keeping with the rest
  of the app. The palette always offers all twelve pieces and shows no counts,
  because a palette listing only what you still need would hand over the whole
  material balance.
- **Four difficulty presets** that write into the ordinary settings rather than
  forming a separate system, so any one of them can then be adjusted. No preset
  claims to correspond to a chess rating.
- **Restrained hints.** One control, which gives back the move list you were
  shown. Its use is recorded and reported separately as hint-free accuracy; it
  is never counted as a mistake.
- **A separate blindfold progress model** (`core/progress/blindfold.ts`) with a
  transparent "what to practice next" recommendation that always names the
  numbers it acted on.

### Changed

- **Blindfold attempts are excluded from square mastery outright.** Getting
  "where is the knight that started on g1" wrong means you lost track of a
  piece, not that you do not know where e5 is. Crediting it to e5 would have
  made squares the user knows perfectly well look weak, and adaptive practice
  would then have drilled the wrong thing.
- The mode-count guard rose from 12 to 15 to admit exactly one new category of
  three cards. The per-category cap of four and the four-variants-per-mode cap
  are unchanged, which is why the progressive ladder's six stages live in setup
  rather than as six mode variants.

### Notes

- `Attempt` gained four optional fields (`hintsUsed`, `plies`,
  `boardVisibility`, `blindfoldKind`). They are optional by design: the schema
  version is unchanged, backups written by 1.3.0 import untouched, and absent
  fields read as "not recorded" rather than as a default that would be a lie.

## 1.3.0 — 2026-07-31 (third pass)

Fixes for problems reported from real Android use, plus handoff scaffolding.

### Fixed

- **Queen forks were a single repeated question.** Measured over 200 seeds,
  200/200 generated questions were the same hard-coded emergency board (two
  black rooks on a1 and h8), on a board holding exactly two pieces. The
  generator picked two random targets and rejected any problem with more than
  three solutions — which, for a queen, is nearly all of them — so every
  attempt failed into the fallback. Generation is now constructive: the
  forking square is chosen first, targets are chosen from what it attacks, and
  the solution set is recomputed after decoys are placed. There is no fallback
  position; failure throws and the mode is isolated.
- **The "Play the fork" variant graded the wrong answer type.** It fell through
  into the placement code path after generation failed, so a move question was
  graded as a square question, 200/200 times.
- **The Start button overlapped setup controls.** `.setup-start` was
  `position: sticky` inside the same scroller as the options, so rows slid
  underneath it and the button hovered above the bottom navigation. It is now
  an ordinary block in the scroll flow.
- **Voice answers could never be enabled.** Three separate faults: readiness
  was reported from model presence alone without ever consulting microphone
  permission; the stored preference was rendered directly as the checkbox, so
  a stale `true` showed voice as on; and permission was inferred from a single
  `getUserMedia()` call, which an Android WebView can reject while its own
  dialog is still open.
- **The recognizer was never connected to sessions.** `startListening()` was
  called from nowhere in the app. Turning voice on did nothing at all.
- **Mastery was far too generous** (~29 squares after very little practice).
- **Versions were stuck at 1.0.0** across two major passes, with a hard-coded
  literal in session persistence.

### Added

- **Multi-move fork navigation.** The queen (or knight) can be manoeuvred over
  several moves. It slides to empty squares only — capturing a target would
  change the question underneath the user. Intermediate moves are never
  mistakes. Breadth-first search proves a solution exists and records the
  minimum; solving in more moves is recorded as *suboptimal*, not wrong.
- **Board density setting** (Minimal / Standard / Crowded) for fork exercises,
  defaulting to Standard. Fork boards now carry 8–14 pieces instead of 2.
- **Skill-aware mastery.** Four dimensions — recognition, recall, notation,
  vision. Notation credits origin and destination squares separately, so
  picking the wrong knight penalises piece selection without punishing
  destination knowledge.
- **An original launcher icon**: a cream eye whose iris is a small chessboard,
  on Bight's board green. Adaptive, round, themed-monochrome and legacy layers,
  all regenerated from SVG by `npm run icons`.
- **Handoff scaffolding**: `AGENTS.md`, `CODEX_HANDOFF.md`, this changelog,
  development diagnostics behind `?debug=1`, deterministic seed replay
  (`?mode=…&variant=…&seed=…`), `npm run setup`, `npm run test:browser`,
  `npm run inspect:apk`, and a GitHub Actions workflow.

### Changed

- Mastery now requires ~12 exposures across at least 3 sessions and 2 days, in
  at least 2 different kinds of exercise, with retention decay — all
  multiplied, so no single dimension can carry a square to "mastered".
- `src/core/version.ts` is the single source of truth for the version;
  `npm run verify` fails if package.json or the Android manifest disagree.
- The stock Capacitor launcher PNGs are gone, including the `drawable-v24`
  foreground that would have overridden the new icon on API 24+.

### Migration notes

- **No schema bump.** The new attempt fields (`originSquare`, `originCorrect`,
  `destinationCorrect`, `suboptimal`) are all optional, so records written by
  1.0.0 load unchanged and simply contribute less detail to mastery.
- Mastery scores are **derived, never stored**, so existing history is
  re-scored under the stricter model on first launch. Expect the mastered
  count to drop sharply — that is the fix, not a regression.
- Old backups import unchanged. Removed mode ids still resolve to readable
  labels through `src/core/training/legacy.ts`.

### Known limitations

- **The APK has never been launched.** No Android device or emulator was
  available. Layout was verified in desktop Chromium at four viewports.
- **Voice remains unproven end to end.** The permission layer is written around
  Android WebView timing that cannot be exercised here.
- Android Gradle build is not in CI.

## 1.0.0 — earlier passes

First release and the second-pass redesign: 11 modes in 6 categories, forks and
notation added, weak exercises removed, continuous no-Next practice flow, and
the pinned bottom navigation. See `AUDIT_REPORT.md` for the full history.
