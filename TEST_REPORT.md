# Bight test report

---

# Third pass test report

## Baseline before any change

`main` @ `eec4534`, version 1.0.0. Lint clean, typecheck clean,
**555 tests passing**. One test was intermittently failing (~1 run in 64) and
was fixed during the pass.

## Final commands

```bash
npm run verify
```
Runs version sync check, icon freshness check, lint, typecheck and the suite.
**Pass** — 0 lint errors, 0 type errors, **637 tests in 21 files**.

```bash
npm run test:browser
```
**Pass** — **24 real-browser layout checks**, 4 viewports.

```bash
npm run android:build && npm run inspect:apk
```
**Pass** — `BUILD SUCCESSFUL`, 267 tasks.

| | |
| --- | --- |
| Path | `release/Bight.apk` |
| Size | 54.17 MB (56,805,062 bytes) |
| SHA-256 | `154a82d97c26aaa0bd5fe745f831425a07b5cc5fbff097cd841da04884e8504e` |
| Entries | 513 |
| Manifest | `versionCode='10300' versionName='1.3.0'`, package `io.github.bereketgirma.bight` |
| Icons | `mipmap-anydpi-v21` + `mipmap-anydpi-v26` present; **0** stock PNG launcher icons |
| Voice model | `assets/public/models/vosk-model-small-en-us-0.15.tar` |
| Signature | `META-INF/CERT.SF`, `META-INF/CERT.RSA` (debug) |

## Test counts

| File | Tests | Covers |
| --- | ---: | --- |
| `core/training/generators/fork.generator.test.ts` | 36 | No a1/h8 fallback, distinct boards, density, answer kinds, solution recomputation, journeys |
| `core/chess/fork.test.ts` | 27 | Fork geometry, all-pairs cross-check, BFS journeys, blockers, pins |
| `core/session/coverage.test.ts` | 12 | Full-board coverage, adaptive bounds, immediate repeats, retry queue |
| `services/voice/state.test.ts` | 14 | Voice state machine, preference reconciliation, no false "Ready" |
| `src/thirdPass.test.ts` | 19 | Version sync, branding, handoff files, gated diagnostics |
| `core/progress/progress.test.ts` | 47 | Mastery incl. anti-inflation, skills, spacing |
| *(existing suites)* | ~482 | Chess core, engine, storage, backup, generators, UI |
| **Total** | **637** | |

## Real-browser layout verification

Driven with Puppeteer against the dev server. jsdom cannot answer these — it
has no layout engine.

| Viewport | Nav pinned while scrolling | No control under Start (More open) | Start clear of nav | Start scrollable into view | No horizontal overflow |
| --- | --- | --- | --- | --- | --- |
| 360×640 | pass | pass | pass | pass | pass |
| 412×915 | pass | pass | pass | pass | pass |
| 480×1080 (S25-Ultra-class) | pass | pass | pass | pass | pass |
| 915×412 (landscape) | pass | pass | pass | pass | pass |

The Start check samples five scroll positions and tests every
`.segmented__item`, `.chip`, toggle input and `.setup-row__label` for
intersection with the Start button's rectangle.

## Manual browser review (Chromium, 412×915)

| Check | Result |
| --- | --- |
| Queen Fork "Play the fork" | "Move the queen to attack both f3 and e5", **15 pieces**, 6 legal-move hints |
| Setup controls shown | Exercise, Orientation, Coordinate labels, **Board material**, Session length, How many, Time per question |
| Illegal queen move | Flashed red on a8; question unchanged; queen stayed on h3 |
| Legal non-forking moves | h8, h7, h6, h5, h4 all accepted **silently** — no red flash, queen position updated each time |
| Reaching the fork | g3 completed the question and loaded a **new** one with **new** targets (g7, b8) |
| Settings audio controls | Four independent: sound effects, haptics, spoken prompts, voice answers |
| Voice status | Badge "Blocked", checkbox off, message "Microphone access is blocked for this app" |
| False "Ready" claim | **Absent** — the status never says "runs on this device" unless usable |

## Reproduction evidence for the Queen Fork bug

Measured over 200 seeds, before and after:

| | Before | After |
| --- | ---: | ---: |
| a1/h8 fallback questions | 200 / 200 | **0 / 200** |
| Distinct boards | 1 / 200 | **200 / 200** |
| Board piece count (min–max) | 2 – 2 | **8 – 14** |
| "move" variant with wrong answer kind | 200 / 200 | **0 / 60** |

## Flaky test fixed

`advances immediately on a correct keypad answer` waited for the prompt square
to *change*, which fails about 1 run in 64 when the next question picks the
same square. It now asserts on the session progress counter. Three consecutive
clean runs confirmed.

## Not verified — hardware only

- The app running on an Android device or emulator **at all**.
- Vosk WASM loading, microphone capture, recognition accuracy. The permission
  layer is written around Android WebView timing that cannot be exercised here.
- The SQLite repository (needs a native platform).
- Android 15 edge-to-edge, gesture navigation, keyboard resize against the
  `100dvh` shell.
- Drag-and-drop gestures (jsdom has no drag data transfer).
- Backup file picker through the Storage Access Framework.
- Launcher icon rendering under circular, squircle, rounded-square and square
  masks, and as a themed monochrome icon. The resources are present and
  correctly declared in the APK, but no launcher has drawn them.


---

# Second pass test report

## Commands run

```bash
npx eslint . --max-warnings 0
```
**Pass**, 0 errors, 0 warnings.

```bash
npx tsc --noEmit
```
**Pass**, 0 errors, with `strict`, `noUnusedLocals` and `noUnusedParameters`.

```bash
npx vitest run
```
**Pass** — 17 files, **555 tests passed, 0 failed, 0 skipped** (was 501).

```bash
npm run build && npx cap sync android && node scripts/build-apk.mjs
```
**Pass** — `BUILD SUCCESSFUL`, 267 actionable tasks.

```bash
node scripts/inspect-apk.mjs
```
**Pass** — read back out of the built archive, not assumed:

| | |
| --- | --- |
| Size | 54.36 MB (57,002,115 bytes) |
| SHA-256 | `cd296591b085d6022577d6c709698ab4998dcb2a0e6b481cde8e7fef57e8ceee` |
| Entries | 521 |
| Dex | `classes.dex` … `classes4.dex` |
| Web bundle | `assets/public/index.html` present, 16 asset entries |
| Voice model | `assets/public/models/vosk-model-small-en-us-0.15.tar` present |
| Signature | `META-INF/CERT.SF`, `META-INF/CERT.RSA` (debug) |

## New test files

| File | Tests | Covers |
| --- | ---: | --- |
| `src/core/chess/fork.test.ts` | 27 | Fork squares for knight and queen, all-pairs cross-check against an independent intersection, blockers, occupancy, legal-vs-geometric fork moves, pins, problem-usefulness filter |
| `src/core/chess/positionGenerator.test.ts` | 22 | Legal position generation, 10–26 piece density, both kings, side to move, check avoidance, two-knight requirement, SAN from chess.js, rival detection, disambiguation |
| `src/core/training/secondPass.test.ts` | 20 | Mode registry shape, every removed exercise asserted absent, new modes present, legacy labels, and the spelling guard |
| `src/core/progress/usage.test.ts` | 20 | Recency ordering, deduplication, frequency weighting and half-life, removed-mode filtering, fresh-install fallback |

Plus 2 regression tests added to `engine.test.ts` for the retry-queue bug.

## Real-browser layout verification

jsdom has no layout engine, so the pinned-navigation requirement was verified
by driving the running app in Chromium at phone viewports.

### 360×640 (compact phone)

| Check | Result |
| --- | --- |
| Bottom nav within viewport | Pass — occupies y 581–640, exactly the viewport bottom |
| Document does not scroll | Pass — `body.scrollHeight` 640 = viewport height |
| Content scrolls internally | Pass — `.app__main` 735 scroll / 581 client |
| Nav pinned at 0%, 50%, 100% scroll | Pass — y 581–640 at every position |
| Last element clears the nav | Pass — bottom 511 vs nav top 581 |
| Horizontal overflow | None |

### 360×640, Practice tab (long page)

| Check | Result |
| --- | --- |
| Content height | 1121px, nearly 2× the viewport |
| Categories rendered | Coordinates, Square color, Knight vision, Forks, Notation and piece selection, Position vision |
| Mode cards | 11 |
| Nav still pinned after scrolling to the end | Pass |
| Last card clears the nav | Pass |
| Horizontal overflow | None |

### 412×915

| Check | Result |
| --- | --- |
| Setup shows common controls above Start | Pass — Exercise, Orientation, Coordinate labels, Session length, How many, Time per question |
| Advanced settings hidden by default | Pass |
| Bottom nav absent during a session | Pass — sessions use a focused shell; Pause and End remain |
| Horizontal overflow | None |

## Feature verification in the browser

| Check | Result |
| --- | --- |
| Knight fork question | "Tap the square where a knight forks e6 and e4", detail "2 squares work - any one counts" |
| Multiple fork solutions accepted | Pass — tapped `g5`, advanced with no red flash, proving the non-listed solution is accepted |
| Notation position realism | "Play Nxf6" with **26 pieces** on the board and detail "Both knights are on the board" |
| Home before history | "Start here" section only; no Recent or Frequent, no fake personalization |
| Home after a real session | "Recent" (5 deduplicated entries) and "You practice these most" (1 session); "Start here" gone |
| Session ends at its limit | Pass after fix — 10-question session finished in 14 iterations (10 + drained retries) |

## Bug found in the browser, missed by the suite

A 10-question session was observed running to **40 / 10** and still going. A
miss on a *queued retry* re-queued the question, so the retry queue refilled
faster than it drained. The automated tests answered correctly too often to
reach the condition. Fixed by refusing to queue new retries once the question
limit is reached; two regression tests added.

## Flaky test fixed

`advances immediately on a correct keypad answer` waited for the prompt square
to *change*, which fails roughly 1 run in 64 when the next question picks the
same square. It now asserts on the session progress counter instead.
Confirmed with three consecutive clean runs of the integration suite.

## Not verified — hardware only

- App launch on an Android device or emulator (none available).
- Vosk WASM load, microphone capture, recognition accuracy.
- SQLite repository (requires a native platform).
- Android 15 edge-to-edge, gesture navigation, and keyboard-resize interaction
  with the `100dvh` shell and safe-area insets.
- Drag-and-drop gestures (jsdom has no drag data transfer).
- Backup file picker through the Android Storage Access Framework.


---

# First pass test report (v1.0.0)

All figures below come from runs on this machine. Nothing is estimated.

**Environment**

| | |
| --- | --- |
| OS | Windows 11 Pro 10.0.26200 |
| Node | 18.18.0 |
| npm | 9.8.1 |
| JDK | Eclipse Adoptium 21.0.12.8 |
| Android SDK | Platform 35, Build-Tools 35.0.0 |
| Test runner | Vitest 2.1.9, jsdom 25 |

---

## Commands run

```bash
npx eslint . --max-warnings 0
```
**Result: pass**, 0 errors, 0 warnings.

```bash
npx tsc --noEmit
```
**Result: pass**, 0 errors, with `strict`, `noUnusedLocals` and
`noUnusedParameters` all enabled.

```bash
npx vitest run
```
**Result: pass** — 13 files, **501 tests passed, 0 failed, 0 skipped**.

```bash
npm run build
```
**Result: pass** — 95 modules transformed.

```bash
npx cap sync android
```
**Result: pass** — 7 Capacitor plugins detected and wired.

```bash
node scripts/build-apk.mjs
```
**Result: pass** — `BUILD SUCCESSFUL`, 267 actionable tasks.
`release/Bight.apk`, 54.36 MB, debug-signed,
SHA-256 `d57ac2565ee8b436a5096fd3fb8e72228f84be2a1f66b2fe5604986312a4ee4c`.

The APK's own entry list was read back and checked: 521 entries, `classes.dex`
present, web assets present, the speech model present, and a debug signature
in `META-INF`. That readback is what caught bugs 8 and 9 below.

---

## Test breakdown

| File | Tests | Covers |
| --- | ---: | --- |
| `src/core/chess/geometry.test.ts` | 44 | Movement vectors, ray tracing, blockers, pawn rules, and the chess.js cross-check |
| `src/core/storage/repository.test.ts` | 41 | The repository contract, run against both IndexedDB and in-memory |
| `src/core/progress/progress.test.ts` | 42 | Mastery scoring, weighting, streaks, achievements, statistics |
| `src/core/session/engine.test.ts` | 55 | Session state machine, auto-advance, wrong-answer handling, multi-square completion, input locking, timers, pause, limits, settings validation |
| `src/services/voice/grammar.test.ts` | 29 | Voice vocabulary, parsing, aliases, confidence handling |
| `src/core/chess/legal.test.ts` | 27 | chess.js bridge: legality, pins, castling, en passant, promotion |
| `src/core/chess/square.test.ts` | 27 | Coordinates, square colour, orientation mapping, quadrants |
| `src/core/backup/backup.test.ts` | 26 | Backup format, validation, migration, import safety |
| `src/core/training/generators.test.ts` | 26 | Generator contract across every mode, variant and seed |
| `src/ui/components/Board.test.tsx` | 26 | Board rendering, taps, orientation, marks, reveal timing, moves |
| `src/core/chess/position.test.ts` | 23 | FEN parsing and serialisation |
| `src/core/chess/knightRoute.test.ts` | 22 | BFS knight routing over the whole board |
| `src/ui/App.integration.test.tsx` | 113 | Whole-app flows: navigation, every mode opening, absence of progression controls in every mode, auto-advance, wrong-answer flashes, settings, backup |
| **Total** | **501** | |

---

## Coverage of the specification's required checks

### Unit tests

| Required | Covered |
| --- | --- |
| All chess geometry and coordinate rules | Yes — 44 + 27 + 22 tests |
| All 64 square colours | Yes — against an independent parity reference **and** behaviourally via chess.js bishop reachability |
| Coordinate parsing/formatting for all 64 squares | Yes |
| White and black orientation mapping | Yes — round-tripped for all 64 squares in both orientations |
| All knight destinations from all 64 origins | Yes — against an independent predicate reference |
| Bishop, rook, queen, king, pawn geometry from edges, corners, centre | Yes |
| Blocker handling for sliding pieces | Yes — including per-direction independence |
| Friendly and enemy occupancy behaviour | Yes |
| Pawn direction, start rank, double move, capture direction, promotion boundary | Yes |
| En passant where legal-move mode uses it | Yes — `legal.test.ts` |
| Drag and tap movement validation | Tap: yes. Drag: partial — see limitation below |
| Legal-move integration against known chess.js results | Yes |
| No invalid off-board coordinates | Yes — explicitly asserted, including NaN and fractional input |
| Every generator returns at least one valid answer when required | Yes — this check found a real bug (blockers could seal a piece in) |
| Session scoring | Yes |
| Mastery calculations | Yes |
| Streak calculation across dates and local time | Yes — including month boundaries, a leap year, and a DST boundary |
| Settings validation | Yes — clamping, unknown enums, NaN |
| Persistence repository | Yes — same suite against two engines |
| Backup export/import | Yes |
| Schema migrations | Yes — schema-0 fixture migrated end to end |
| Voice command parsing | Yes — 29 tests |
| Weak-square selection | Yes |

### Component and integration tests

| Required | Covered |
| --- | --- |
| Every visible mode opens | Yes — parameterised over every registered mode/variant pair |
| Taps register correctly | Yes |
| Occupied-square taps work in coordinate mode | Yes — explicitly, with the full starting position |
| Drag and tap-to-move both work | Tap: yes. Drag: partial |
| Multiple-square selection and completion | Yes — correct squares accumulate, wrong taps flash without losing progress, repeat taps are ignored, and the set completes itself |
| No Next/Continue/Submit control in any mode | Yes — asserted for every registered mode and variant, by test id and accessible name |
| Correct answers advance with no button press | Yes — engine tests plus live browser verification |
| Wrong answers keep the question and reveal nothing | Yes |
| Orientation changes map taps correctly | Yes — the same square is reported in both orientations |
| Labels settings work | Yes |
| Timer, pause, resume, exit, retry | Yes |
| Failed optional services do not break unrelated modes | Yes — and this caught the Capacitor proxy bug |
| Import validation does not overwrite data | Yes — twice, from different failure modes |
| Theme switching works | Yes — asserted on the document element |
| Progress updates after sessions | Partial — session persistence is tested at the repository level; the Progress screen's re-read after a session is not asserted end to end |

### Android validation

| Required | Result |
| --- | --- |
| Production web build succeeds | Pass |
| Capacitor sync succeeds | Pass |
| Android Gradle build succeeds | Pass |
| Installable APK produced | Pass — 54.36 MB, debug-signed, contents verified |
| App launches in an emulator | **Not run** — no emulator or system image installed |
| Emulator smoke tests | **Not run**, same reason |
| Portrait layout at S25 Ultra and a smaller phone | **Browser only** — checked at 1440×3120 and 360×640 equivalents |
| No clipping, unreachable controls, board overflow | **Browser only** |
| Offline launch | **Not run on device** — verified by inspection that no network calls exist |
| Microphone requested only for voice | **Verified by inspection** — one `getUserMedia` call site |
| Backup picker/export flow | **Not run on device** |
| App state survives restart | **Not run on device** |

---

## Manual verification in a real browser

Automated tests run in jsdom, which has no layout engine. These checks were
performed by driving the running dev server in a real Chromium browser at
phone viewports, so layout and computed styles are genuinely measured.

**At 412×915 (Pixel/S25-class portrait):**

| Check | Result |
| --- | --- |
| Home screen renders with streak, daily goal, week strip, recommended modes | Pass |
| Knight vision session opens | Pass — board 379×379, 64 squares, knight rendered |
| Square touch target | 47 CSS px per square |
| Selecting all 8 knight targets on d4 | Pass — the set completed itself and loaded the next question |
| Board colours | Light `rgb(235,236,208)` = `#EBECD0`, dark `rgb(119,149,86)` = `#779556` — the green/cream board |
| Two-tap keypad: prompted d4 | Ranks disabled until a file is tapped; after tapping `d` the readout showed `d` and ranks enabled; tapping `4` gave "d4 is correct." |
| Free-text inputs anywhere in coordinate entry | **Zero** — the Android keyboard cannot open |
| Early exit summary | Pass — "Session ended early", partial results kept, 1/1 correct |
| Progress screen after two real sessions | Pass — 2 questions, 100% accuracy, 2 sessions, 64-cell mastery heat map, 19 breakdown bars, achievements list |
| Backup export against live IndexedDB | Pass — valid `bight-backup` schema 1, 2 attempts, 2 sessions, 6,608 bytes, re-validates cleanly |
| Horizontal overflow | None |

**At 360×640 (small phone):**

| Check | Result |
| --- | --- |
| Board fits within the viewport | Pass — 331×331, fully inside |
| Square touch target | 41 CSS px |
| Horizontal overflow | None |

**Themes:** dark surface `rgb(22,24,28)`, light surface `rgb(246,247,249)` with
dark text. Board colours are **identical in both themes**, as required.

This also confirms the one item listed as partial above — session data really
does flow through persistence into the Progress screen — since the progress
figures came from two sessions actually played in the browser.

### Continuous-flow verification (real browser)

Run after the auto-advance refactor, driving the live app:

| Check | Result |
| --- | --- |
| Buttons present during a session | Only `pause` and `end-session`. No Next, Submit, Continue or feedback element in any mode. |
| Correct tap in coordinate mode | Prompt advanced `g1` → `g5` with no press and no result panel |
| Wrong tap | `square--wrong` present 60ms after the tap, gone after 600ms; prompt still `g5`; the correct square was **not** marked |
| Knight vision, six targets from c2 | Counter ran `6 left` → `1 left`, each correct square holding `square--correct` |
| Wrong tap mid-set (h8) | Flashed red; all five earlier selections survived; no result panel |
| Repeat tap on an already-correct square | Ignored — no red flash, counter unchanged |
| Final correct square | Question completed itself: knight moved c2 → b6, counter reset to `6 left`, selections cleared |

## Bugs found by the test suite

Recorded because they are the reason the suite is worth its length. Each was a
genuine defect, not a test-harness artefact.

1. **Attack semantics excluded defended pieces.** `attackedSquares` filtered
   out friendly-occupied squares, but a piece *defends* those squares. Caught
   by the chess.js `attackers()` cross-check on the first run.
2. **Generators could produce unanswerable questions.** Random blockers could
   seal a bishop or corner knight in completely, leaving zero valid answers.
   Caught by the "at least one valid answer" contract test.
3. **Promotions produced duplicate destinations.** chess.js returns four moves
   for one promotion square; `legalDestinations` returned `['e8','e8','e8','e8']`.
4. **Pause did not freeze the per-question timer.** Session time and question
   time needed separate handling; resuming after a long pause instantly expired
   the question.
5. **Two storage engines disagreed.** IndexedDB back-filled newly-added
   preference fields; the in-memory engine did not. The shared contract suite
   caught the divergence.
6. **`File.text()` is absent in older WebViews.** Backup import would have
   thrown on older Android WebViews; a `FileReader` fallback was added.
7. **Capacitor plugin proxies reject `.then` probing.** Returning a plugin
   object as an async function's resolution value makes the JS engine test it
   for thenability, which the proxy answers with `UNIMPLEMENTED`. This produced
   unhandled rejections and would have fired on device. Both the haptics and
   SQLite services now box the plugin.
8. **AAPT renames the speech model during packaging.** Found by reading the
   built APK's entry list, not by any test. Android's asset packager gunzips
   `.gz` assets, so `vosk-model-small-en-us-0.15.tar.gz` becomes
   `...0.15.tar` inside the APK. The recogniser was fetching the `.gz` name,
   which would have 404'd on device — voice would have silently reported
   itself unavailable while the model sat right there. It now probes both.
9. **The first APK shipped without the model at all.** The web build had run
   before the model was downloaded, so `dist/models/` was empty and the APK
   came out at 13.7 MB. Caught by checking the size against expectation rather
   than accepting "BUILD SUCCESSFUL" as proof.

---

## Known untested behaviour

Stated plainly rather than left implicit:

- **All hardware-specific behaviour.** No Android device and no emulator were
  available. The APK has never been installed or launched.
- **The voice audio path.** Grammar and parsing are thoroughly tested; Vosk
  WASM loading, microphone capture and real recognition accuracy have not been
  executed once.
- **SQLite persistence.** Implemented against the same contract the other two
  engines pass, but never run — it requires a native platform.
- **Real drag gestures.** jsdom does not implement drag data transfer. The
  `draggable` wiring is asserted; the gesture is not simulated. Tap-to-move is
  fully covered and is the primary path on a phone.
- **Speech synthesis output.** No audio device; the code path is exercised but
  nothing was heard.
- **Haptic output.** No vibration hardware.
