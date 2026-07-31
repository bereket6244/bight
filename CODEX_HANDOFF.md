# Codex handoff

Practical engineering notes for continuing Bight. Read `AGENTS.md` first for
the rules; this file is about the current state and where the bodies are
buried.

## Current state

| | |
| --- | --- |
| Branch | `main` |
| App version | 1.3.0 (`src/core/version.ts` is the source of truth) |
| Android versionCode | 10300 (derived: major×10000 + minor×100 + patch) |
| Storage schema | 1 (unchanged — the third pass added only optional fields) |
| Backup format | `bight-backup`, schemaVersion 1 |
| APK | `release/Bight.apk` (debug-signed, committed deliberately) |
| Tests | Vitest, ~640 across 21 files, plus 24 real-browser layout checks |

## Modes

Eleven, in six categories. `src/core/training/registry.ts` is the only list.

Coordinates: `coordinate-to-square`, `square-to-coordinate`, `alignment`
Square color: `square-color`
Knight: `knight-vision`, `knight-route`
Forks: `knight-fork`, `queen-fork`
Notation: `notation`
Position: `piece-vision`, `blockers`

### Removed, with ids still alive at the data layer

`memory-coordinate-to-square`, `memory-square-to-coordinate`,
`piece-movement`, `sequence`, plus a dozen variants. See
`src/core/training/legacy.ts`. History and old backups render readable labels;
Home refuses to launch them.

## Architecture notes worth knowing

### Fork generation is constructive, not rejection-based

`src/core/training/generators/fork.ts`. It picks the **answer square first**,
then chooses targets from what that square attacks, then scatters decoys and
**recomputes** the solution set against the final board.

This matters because the previous rejection-sampling approach failed 200/200
times for the queen and fell back to a hard-coded position. If you change fork
generation, keep the constructive order — and keep the rule that the answer is
recomputed *after* all material is placed, since a decoy can block a queen's
line.

There is deliberately **no fallback position**. If generation fails it throws,
and the mode's error boundary isolates it. Do not add a canned board.

### Journey answers

"Play the fork" uses the `piece-journey` answer kind: the piece may need
several moves. Rules:

- the piece **slides to empty squares only** — no captures while manoeuvring,
  because capturing a target would change the question underneath the user
- intermediate legal moves are **not** mistakes and never flash red
- only an *illegal* move is rejected
- `planJourney()` (BFS in `core/chess/fork.ts`) proves a solution exists and
  records `minMoves`; solving in more moves is recorded as `suboptimal` on the
  attempt, never as a wrong answer

### Mastery is multiplicative

`score = skill × confidence × spacing × breadth × retention`, all 0..1.

Raising the bar means raising a factor, not a threshold. The old model reported
~29 mastered squares after very little practice because confidence maxed out at
six attempts and nothing else was required.

Notation attempts credit **two** squares: origin (did you pick the right
piece?) and destination (did you know where it goes?), from
`attempt.originSquare` / `originCorrect` / `destinationCorrect`. These fields
are optional, so historical attempts still load.

### Session engine is pure

`src/core/session/engine.ts`. Time is always injected. Selection state
(`selected`, `journey`) lives in the engine, not the UI, because "is this
complete?" is the question that decides whether to advance.

## Fragile files

| File | Why |
| --- | --- |
| `core/training/generators/fork.ts` | Constructive generation with several interacting constraints; easy to make unsolvable |
| `core/session/engine.ts` | Every mode flows through it; the retry-queue interaction with limits has bitten twice |
| `core/progress/mastery.ts` | Five multiplied factors; changing one silently moves every reported number |
| `services/voice/permission.ts` | Written around Android WebView timing that cannot be tested here |
| `ui/theme.css` app shell | `100dvh` + safe-area + pinned nav; verified only in a desktop browser |

## Reproducing reported bugs

Development builds accept URL overrides:

```
?mode=queen-fork&variant=play&seed=12345&debug=1
```

`debug=1` also shows a diagnostics panel with the question id, seed, FEN,
expected answer, retry queue and a copy-paste repro URL. It is compiled out of
production builds (`import.meta.env.DEV`), because it prints the answer.

Deterministic seeds used in tests: fork generators sweep seeds 1–60;
`positionGenerator` uses `[1,2,3,7,11,42,99,1234,20260731,555]`; coverage tests
use 20260731, 4242, 7, 11, 99, 5.

## Where to look when something breaks

| Symptom | Start here |
| --- | --- |
| Same question repeating | `engine.ts` retry queue, `pool.ts` weighting, `coverage.test.ts` |
| A mode shows the same board every time | Generator fallback path — there should not be one |
| Wrong answer accepted | `grade.ts`, then the generator's stored `expected` |
| Mastery numbers look wrong | `mastery.ts` factors; check `limitedBy` on a square |
| Layout broken on a phone | `theme.css` app shell, then `npm run test:browser` |
| Start button overlapping | `.setup-start` — it must never be `position: sticky` |
| Voice says the wrong thing | `services/voice/state.ts`, then `permission.ts` |
| Icon missing or stock | `npm run icons`, then `npm run inspect:apk` |
| Version mismatch | `npm run sync:version` |

## Hardware status — read this before claiming anything

**No Android device or emulator has ever been available on the build machine.**
The APK builds, is debug-signed, and its contents are verified by reading the
archive back — but **it has never been launched**.

### Verified (desktop Chromium, real layout engine)

Bottom nav pinned at 360×640, 412×915, 480×1080 and landscape; no control
covered by Start with More settings expanded; no horizontal overflow; fork
generation, multi-solution acceptance, notation density, Home sections.

### Never executed

- the app running on Android at all
- Vosk WASM loading, microphone capture, recognition accuracy
- the SQLite repository (needs a native platform)
- Android 15 edge-to-edge, gesture nav, keyboard resize
- drag-and-drop gestures (jsdom has no drag data transfer)
- the backup file picker through the Storage Access Framework

### Device test steps for voice, in order

The voice bug was reported from a real phone, so this is the sequence to run:

1. Clean install (uninstall first — the package id has not changed, but a
   stale `voiceInput` preference is exactly what caused the original bug).
2. Open Settings. **Voice answers must show "Needs permission" and be off.**
3. Toggle Voice answers on.
4. Accept "While using this app".
5. Confirm the switch stays on and the badge reads "Ready".
6. Start a Name-the-square or Square-color session with voice on.
7. Confirm the listening indicator appears.
8. Speak a coordinate ("echo four"). Confirm it is graded like a tap.
9. Pause, then exit. Confirm the microphone indicator goes out.
10. Deny permission on a fresh install; confirm "Try again" works.
11. Deny permanently; confirm the settings path is shown.
12. Relaunch; confirm the state reconciles rather than showing a stale "Ready".

If step 4 still ends in a denial, the WebView is rejecting `getUserMedia`
before the Android grant propagates. `services/voice/permission.ts` already
re-queries and retries once; the next thing to try is a native permission
plugin (`@capacitor/device`-style) rather than more WebView retries.

## Known technical debt

1. **No native app-settings route.** When permission is permanently blocked the
   UI prints the manual path. A Capacitor settings plugin would fix it; the one
   I tried to add does not exist on npm under the name I expected.
2. **Voice is unproven end to end.** Grammar has 29 tests, the model ships in
   the APK, and the session wiring exists — but no audio has ever gone through
   it.
3. **`vosk-browser` is 5.8 MB** and the model 39 MB, which is most of the
   54 MB APK. Splitting voice into a downloadable asset pack would shrink it
   substantially.
4. **Android CI is not wired up.** The workflow runs lint/typecheck/tests/build;
   the Gradle build is not in CI because the SDK setup was not verified here.
5. **Package id is `io.github.bereketgirma.bight`** while the GitHub handle is
   `bereket6244`. Both valid; changing it after an install forces a reinstall.
6. **`piece-vision` and `blockers` overlap.** Both ask about sliding pieces in
   traffic. A future pass could merge them.

## Likely next features

- Merge `piece-vision` and `blockers`
- Pin/skewer recognition, reusing `fork.ts` geometry
- A "why is this square not mastered yet" breakdown using `limitedBy`
- Per-skill progress views from `masteryOverview().bySkill`
- Split the voice model out of the APK to cut ~40 MB
