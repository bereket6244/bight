# Changelog

All notable changes to Bight. Dates are the day the work landed.

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
