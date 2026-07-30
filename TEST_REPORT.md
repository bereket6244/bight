# Bight test report

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
**Result: pass** — 13 files, **436 tests passed, 0 failed, 0 skipped**.

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
`release/Bight.apk`, 54.38 MB, debug-signed,
SHA-256 `2be5748f577363d43cb817a75e8baa60b9310f2a8e2d2ea1e5d2171bf0f904cd`.

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
| `src/core/session/engine.test.ts` | 36 | Session state machine, timers, pause, retry, limits, settings validation |
| `src/services/voice/grammar.test.ts` | 29 | Voice vocabulary, parsing, aliases, confidence handling |
| `src/core/chess/legal.test.ts` | 27 | chess.js bridge: legality, pins, castling, en passant, promotion |
| `src/core/chess/square.test.ts` | 27 | Coordinates, square colour, orientation mapping, quadrants |
| `src/core/backup/backup.test.ts` | 26 | Backup format, validation, migration, import safety |
| `src/core/training/generators.test.ts` | 26 | Generator contract across every mode, variant and seed |
| `src/ui/components/Board.test.tsx` | 26 | Board rendering, taps, orientation, marks, reveal timing, moves |
| `src/core/chess/position.test.ts` | 23 | FEN parsing and serialisation |
| `src/core/chess/knightRoute.test.ts` | 22 | BFS knight routing over the whole board |
| `src/ui/App.integration.test.tsx` | 67 | Whole-app flows: navigation, every mode opening, answering, settings, backup |
| **Total** | **436** | |

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
| Multiple-square selection and submission | Yes — select, deselect, submit, and separate missed/extra reporting |
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
| Installable APK produced | Pass — 54.38 MB, debug-signed, contents verified |
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
| Selecting all 8 knight targets on d4 and submitting | Pass — "All 8 squares correct." |
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
