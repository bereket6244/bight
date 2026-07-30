# Bight feature audit

Every feature requested in the specification appears below with one of four
statuses:

| Status | Meaning |
| --- | --- |
| **Verified working** | Implemented and covered by a passing automated test, or directly observed. |
| **Working with fallback** | Implemented, but a different approach than first specified. Reason recorded. |
| **Working with limitation** | Implemented, with a stated boundary on what has been proven. |
| **Not verified on hardware** | Implemented and unit/integration tested, but requires a physical device or emulator that was not available. |

Nothing is omitted. Where something could not be proven, it says so plainly
rather than being described as done.

---

## Environment: what the brief assumed vs what was there

The brief opened by stating the machine was "already connected to a Git
repository" with "Android development tools prepared". Neither was fully true,
and the differences shaped several decisions below.

| Assumed | Actual | Consequence |
| --- | --- | --- |
| Connected Git repository | No repository, no remote, no `gh` CLI, no git identity configured | A fresh repository was initialised at `Desktop/bight` on `main`. **No remote exists, so nothing has been pushed.** See "Push" at the end. |
| Android tools prepared | SDK Platform 35, Build-Tools 35.0.0, platform-tools present. **No emulator, no system image.** | APK builds. Emulator smoke testing was not possible without downloading a system image; see "Android validation". |
| — | Node 18.18.0 | Capped the stack at Vite 5 / Capacitor 6 / Vitest 2. Capacitor 7 and Vite 7 both require Node 20+. |
| Samsung Galaxy S25 Ultra as target | No device connected over ADB | On-device testing did not happen. Layout was verified at S25-Ultra-equivalent dimensions in a browser only. |

---

## A. Coordinate recognition

| Feature | Status | Evidence |
| --- | --- | --- |
| Coordinate → square (tap the square) | Verified working | `App.integration.test.tsx` "accepts a tap on the prompted square" |
| Square → coordinate (name it) | Verified working | "accepts an answer from the two-tap keypad and advances" |
| Two-step file-then-rank keypad | Verified working | Ranks are disabled until a file is chosen; asserted in the same test |
| Android keyboard never opens for coordinates | Verified working | "never opens a text input for coordinate entry" asserts no `textbox` role exists |
| Tapping the highlighted square is not accepted as the answer | Verified working | Answer kind is `coordinate`, not `single-square`; the board has no submit path in that mode |
| Taps register on squares occupied by pieces | Verified working | `Board.test.tsx` "registers a tap on a square occupied by a decorative piece"; integration test repeats it with the full starting position |
| Empty board / starting position | Verified working | `layout` setting; asserted in generator tests |
| White / black / random / alternating orientation | Verified working | `engine.test.ts` "alternates orientation between questions" and "produces both orientations over a random session" |
| Labels shown / hidden | Verified working | `Board.test.tsx` label tests; integration test "hides coordinate labels when asked" |
| Selected files / ranks / both | Verified working | `generators.test.ts` "honours combined file and rank filters" |
| Board quadrants | Verified working | `generators.test.ts` "honours a quadrant filter" |
| Weak-square practice | Verified working | `progress.test.ts` weak-square selection; `generators.test.ts` adaptive weighting |
| Timed and untimed sessions | Verified working | `engine.test.ts` timer suite |
| Memory variant: flash a square, then name it | Verified working | `memory-square-to-coordinate` mode; `Board.test.tsx` "hides prompt marks after the reveal window" |
| Memory variant: flash a coordinate, then tap | Verified working | `memory-coordinate-to-square` mode |
| Configurable display duration | Verified working | `revealMs` setting, clamped 200–5000ms; "passes the reveal duration to memory variants" |
| Board-hidden / reduced-visibility variant | Verified working | `blindfold` variant; "hides the board entirely in the blindfold variant" |
| Audio pronunciation of the coordinate | **Working with limitation** | Implemented via `speechSynthesis` (`src/services/speech.ts`), off by default, degrades silently. **Not verified audibly** — no audio device in the test environment. Android system TTS works offline once a voice is installed; if none is, nothing is spoken and the session is unaffected. |

## B. Square-colour training

| Feature | Status | Evidence |
| --- | --- | --- |
| Show coordinate, ask light/dark | Verified working | `square-color` / `coordinate` variant; board deliberately hidden so the answer cannot be read off it |
| Highlight/flash a square, ask light/dark | Verified working | `highlighted` and `flashed` variants |
| Large touch buttons as the reliable path | Verified working | `ColorChoice`, 64px minimum height; "accepts a light/dark answer from the large buttons" |
| Voice answers for "light"/"dark" | **Working with limitation** | Grammar and parser fully implemented and tested (`grammar.test.ts` covers every colour alias). End-to-end audio unverified — see section I. |
| Selected files / ranks / both | Verified working | Shared filter system |
| Timed / untimed, endless / fixed | Verified working | `engine.test.ts` session-limit suite |
| Weak-square practice | Verified working | Shared adaptive weighting |
| Colour rule verified for all 64 squares | Verified working | `square.test.ts` checks all 64 against an independently-derived parity reference, plus a behavioural cross-check via chess.js bishop reachability |

## C. Knight vision

All nine variants are implemented in `src/core/training/generators/knight.ts`.

| Variant | Status | Evidence |
| --- | --- | --- |
| Tap every square a knight attacks | Verified working | `generators.test.ts` "knight vision answers match knightTargets" |
| Geometric attacks with other pieces present | Verified working | "geometry-with-pieces answers ignore occupancy entirely" — asserts the board really has other pieces on it |
| Legal destinations considering occupancy | Verified working | "knight legal-destination answers respect occupancy" — asserts friendly-occupied squares are excluded |
| Geometry and legal kept as separate, labelled variants | Verified working | Distinct variant ids, distinct prompts, `semantics` shown in the session bar |
| Show a move, ask what it sees from the destination | Verified working | `from-destination` variant |
| Coordinate only, no knight shown | Verified working | "knight 'from memory' answers match the coordinate in the prompt" — asserts the board is genuinely empty |
| Candidate squares, which are attacked | Verified working | `candidates` variant |
| Move a knight to a named legal destination | Verified working | `move-to-target`; destination comes from chess.js, so it is provably legal |
| Shortest-route exercises | Verified working | BFS routing; `knightRoute.test.ts` proves reachability for all 4,096 square pairs, symmetry, and that the maximum distance is 6 |
| Any-route exercises, distinct from shortest | Verified working | Separate `any-route` variant; grading accepts any valid path |
| Multi-square selection is obvious | Verified working | `aria-pressed` plus a coloured ring; "selects, deselects and submits a set of squares" |
| Done/Submit control | Verified working | Nothing is graded until Submit; asserted in the same test |
| Deselection supported | Verified working | Same test |
| Missed and wrongly-selected reported separately | Verified working | "reports missed and wrongly-selected squares separately" |
| Does not advance until submitted or timer ends | Verified working | Engine only leaves `question` phase on submit or timeout |
| Blockers, orientation, labels, hints, timing, filters | Verified working | Shared session settings |

## D. Other piece vision and movement

| Feature | Status | Evidence |
| --- | --- | --- |
| Bishop / rook / queen / king / pawn attack squares | Verified working | "piece vision answers match attackedSquares" for all five |
| Legal destinations with pieces in the way | Verified working | `*-blocked` variants |
| Every square on a diagonal | Verified working | `diagonal` variant |
| Every square on a file and rank | Verified working | `file-and-rank` variant |
| Queen rays | Verified working | `queen-geometry` and `queen-blocked` |
| King-adjacent squares | Verified working | `king-geometry` |
| Pawn moves vs captures distinguished | Verified working | "pawn capture variant never includes a push square" |
| Two squares share rank / file / diagonal | Verified working | `alignment` mode |
| Move a piece to a named legal destination | Verified working | `piece-movement` mode, all five piece types |
| Squares blocked by the first occupied square on a ray | Verified working | `blockers` mode; `firstBlockers` tested directly |
| Short coordinate sequences, name the final square | Verified working | `sequence` mode; walk is built step-by-step so the destination is always on-board |
| Blindfold tracking through a sequence | Verified working | `sequence` / `blindfold` variant |

## E. Movable pieces

| Feature | Status | Evidence |
| --- | --- | --- |
| Tap-piece then tap-destination | Verified working | `Board.test.tsx` "moves by tapping the piece and then the destination" |
| Drag and drop | **Working with limitation** | Implemented with HTML5 drag events; `draggable` attribute asserted in tests. **The drag gesture itself is not simulated** — jsdom does not implement a real drag data transfer, and no touch device was available. Tap-to-move is fully tested and is the primary path on a phone. |
| Obvious selected-piece feedback | Verified working | `square--origin` ring; asserted |
| Piece can be put back down | Verified working | "puts the piece back down when tapped twice" |
| Optional legal-destination markers | Verified working | `showHints` setting drives `hint` marks |
| Hidden markers for testing | Verified working | Default is hidden |
| Snap-back on illegal attempts | Verified working | Board never mutates the position itself; an illegal move is graded and the piece stays put |
| Correct capture/occupancy handling | Verified working | Delegated to chess.js in legal modes |
| chess.js used for complete legal positions | Verified working | `legal.ts` is the only source of legal-move answers |
| Tested generators for isolated vision exercises | Verified working | `geometry.ts`, cross-checked against chess.js |

## F. Session controls

Every item below is covered by `engine.test.ts` (36 tests).

Untimed practice · time per question · total session time · fixed question
count · endless · pause · resume · restart · early exit with a partial summary
· configurable counts and limits · immediate or end-of-session feedback ·
retry immediately / later / both / never · accuracy-first mode · orientation ·
labels · piece layout · file, rank and quadrant filters · sound and haptic
toggles — **all Verified working**.

Two behaviours worth calling out because they were bugs found by tests:

- **Pause freezes the per-question timer.** The session clock and the question
  clock are excluded from pause separately; an early version only handled the
  session clock, so resuming instantly expired the question timer.
- **Retries do not count against the question limit.** A 20-question session
  with retries enabled still asks 20 *new* questions.

## G. Progress, mastery and adaptive practice

| Feature | Status | Evidence |
| --- | --- | --- |
| Every attempt stored with full context | Verified working | `engine.test.ts` "records every field needed to reconstruct performance" — mode, variant, prompt, expected, answer, correctness, response time, orientation, labels, layout, filters, timer, timestamp, schema and app version |
| Overall and per-mode accuracy | Verified working | `progress.test.ts` statistics suite |
| Average / median / fastest response | Verified working | `timingStats` |
| Best in-session streak | Verified working | `bestStreak` |
| Performance by square / file / rank / orientation | Verified working | Four separate breakdowns, all tested |
| Performance over recent days and weeks | Verified working | `accuracyTrend` |
| Frequently missed knight targets | Verified working | `mostMissedTargets`, fed by the `missed` array on each attempt |
| Weak origins and weak targets | Verified working | `weakestSquares`, `mostWronglySelected` |
| Improvement trends | Verified working | `improvement` compares recent against earlier halves |
| Session history and personal bests | Verified working | History screen; `personalBestsFromSessions` |
| Mastery weighs accuracy, recency, sample size and time | Verified working | `progress.test.ts` — including "never marks a square mastered on one lucky fast answer" |
| Weak-square / weak-file / weak-rank practice | Verified working | Filters plus adaptive weights |
| Spaced repetition for mistakes | Verified working | Retention decay with a ~21-day half-life brings old squares back |
| More frequent review of slow-but-correct answers | Verified working | `slowButCorrect`; speed is 25% of the mastery score |
| Reduced repetition after mastery | Verified working | Weight is the inverse of mastery, floored at 1 so nothing disappears |
| Mindless repetition prevented from dominating | Verified working | Weights capped at 6×; `pickSquareAvoiding` prevents immediate repeats |
| Mastery explained in-app and in docs | Verified working | `MASTERY_EXPLANATION` shown on Progress and in Settings; also in README |

## H. Restrained gamification

Daily streak · current and longest streak · daily goal · personal bests · mode
milestones · eleven achievements · rolling seven-day summary — **all Verified
working**, covered by `progress.test.ts`.

**Streak rule:** a day counts once you finish a session of at least **10
scored questions**. Opening the app does not count; nor does answering one
question and leaving. Documented in-app, in the README and here.

No dark patterns are present: no guilt messaging, no energy system, no
artificial waiting, no advertising, no paid unlocks, no notifications. New
personal bests are acknowledged in the summary without animation.

## I. Offline voice input

**Status: Working with limitation — implemented and unit-tested, not verified end-to-end.**

What is done and proven:

- **Grammar and parser**: complete, with 29 passing tests. Accepts `e four`,
  `echo four`, `letter e four`, and the compact `e4`. Robust aliases for the
  commonly confused letters b/d/e/g (`bee`, `dee`, `ee`, `gee`, `jee`, plus
  full NATO words), number homophones (`for`/`four`, `to`/`two`, `ate`/`eight`,
  `won`/`one`), and `light`/`dark` with synonyms. All 64 squares are verified
  parseable from their spoken NATO form.
- **Restricted vocabulary**: `buildVocabulary()` emits only the words the
  current exercise can accept, following the Lichess approach of constraining
  recognition rather than doing open dictation.
- **Confidence handling**: below 0.6 confidence an utterance is flagged
  `lowConfidence` and is **not scored as a chess answer**. Only a confidently
  recognised wrong coordinate counts as wrong. Recognition failures are
  recorded with `source: 'voice'` separately from touch answers, so speech
  errors and chess errors stay distinguishable in statistics.
- **Model**: `vosk-model-small-en-us-0.15` (Apache-2.0, redistributable) is
  fetched by `npm run fetch:voice-model` into `public/models/` and packaged
  into the APK, so recognition needs no network after installation.
- **Permission**: `RECORD_AUDIO` is declared but only requested when a session
  starts with voice enabled — `getUserMedia` is called at that moment and
  nowhere else.
- **Isolation**: unavailable voice is a state, not an error. The keypad is
  always present.

What is **not** proven:

- No microphone, and no Android device or emulator, was available. **The audio
  path — Vosk WASM loading in the Android WebView, microphone capture, and
  real recognition accuracy — has not been executed once.**
- The `ScriptProcessorNode` used for capture is deprecated in favour of
  `AudioWorklet`. It still works in current WebViews but is the first thing to
  revisit.

One packaging bug in this area *was* caught, by reading the entry list out of
the built APK rather than trusting the build: **AAPT gunzips `.gz` assets**, so
the model ships as `...0.15.tar`, not `...0.15.tar.gz`. The recogniser had been
fetching the `.gz` name, which would have 404'd on device and reported voice as
unavailable despite the model being present. It now probes both names.

A future developer should: build with the model fetched, install on a device,
enable voice in Settings, and watch `adb logcat` while starting a session. If
WASM performance is inadequate, the specification's fallback is a native Vosk
integration behind a Capacitor plugin; the `VoiceSession` interface in
`recognizer.ts` is the seam for that, and nothing above it would change.

The model is **not committed to the repository** — 39 MB of binary that every
clone would pay for whether or not they want voice. One documented command
fetches it. This is a deliberate deviation from "include required voice model
files", made because the APK still contains the model and offline recognition
after installation is therefore unaffected.

## J. Backup, restore and forward compatibility

| Feature | Status | Evidence |
| --- | --- | --- |
| Export backup | Verified working | `backup.test.ts` round-trip |
| Import backup | Verified working | Same |
| Contains progress, attempts, sessions, streaks, mastery inputs, achievements, settings | Verified working | Mastery and streaks are *derived* from attempts and sessions, so restoring those restores them exactly |
| Versioned, portable JSON | Verified working | `schemaVersion`, `appVersion`, `exportedAt`, `format` |
| Validate before changing anything | Verified working | "leaves existing data untouched when the file is invalid" |
| Reject malformed files safely | Verified working | Malformed JSON, wrong format, bad attempts, too-new schema all rejected |
| Never erase data because validation failed | Verified working | Two separate tests assert data survives a rejected import |
| Automatic pre-import snapshot | Verified working | "restores a snapshot when the write itself fails" injects a mid-import failure and asserts recovery |
| Merge and replace | Verified working | Both tested |
| Duplicate import prevented | Verified working | "does not duplicate history when the same backup is merged twice" |
| Migration framework for older versions | Verified working | Chain walk; a test asserts the chain is continuous, so a missing migration fails the build |
| Export/import round trip tested | Verified working | Yes |
| Older-schema fixture imported into current schema | Verified working | A schema-0 fixture is migrated end-to-end |
| Format documented | Verified working | `BACKUP_FORMAT.md` |
| Uses document picker, no broad storage permission | **Not verified on hardware** | Implemented via the browser download and file-picker paths that Capacitor maps to the Storage Access Framework. No storage permission is declared in the manifest — confirmed by reading it. The picker UI itself was not exercised on a device. |

---

## Deviations from the specification, and why

### 1. Custom board component instead of Chessground

**Status: Working with fallback.** `chessground@9.1.1` was installed and
evaluated, then removed.

Chessground is a board for *playing*. Four of Bight's requirements work
against that model:

1. **Taps must register on squares occupied by pieces.** Chessground's
   interaction model treats a piece as the thing you grabbed; Bight needs the
   square underneath, with the piece as scenery.
2. **Arbitrary multi-square selection with a submit step.** Knight vision asks
   for up to eight squares selected, deselected and then submitted together.
   Chessground has no such concept.
3. **Ordered route tracing with ordinal badges.**
4. **Timed reveal-then-hide, and a fully hidden board.**

Each could be bolted on by fighting the library's own state, and the result
would be harder to test than the 180 lines the custom board actually takes.
The specification explicitly permits "a focused custom TypeScript/CSS board
component" as the fallback.

What was gained: every square is a real `<button>`, so keyboard navigation and
screen-reader labelling work without extra code, and `Board.test.tsx` can
assert behaviour through ordinary DOM queries.

### 2. Original piece set instead of Lichess assets

**Status: Working with fallback.** The specification allowed license-compatible
Lichess assets. The obvious set (cburnett) is **GPL**, which would force the
entire application under the GPL. Chess.com's assets are proprietary and were
never an option.

The pieces in `src/ui/components/Pieces.tsx` are original SVG, so Bight ships
under a clean MIT licence with no third-party asset obligations. They are
traditional Staunton silhouettes with a contrasting outline, legible at phone
board sizes in both themes.

### 3. SQLite implemented but IndexedDB is what has been exercised

**Status: Working with fallback.** `SqliteRepository` is fully implemented
against `@capacitor-community/sqlite` and is first in the fallback chain on a
native platform. **It has not been run**, because that requires a device.

The contract test suite runs against IndexedDB and the in-memory engine, both
of which pass all 41 tests. SQLite implements the identical interface. The
factory verifies an engine by actually opening it and reading preferences
before committing to it, so a plugin that loads but fails on first use falls
through to IndexedDB rather than breaking the app.

### 4. Voice model fetched, not committed

Covered under section I above.

---

## Android validation

| Check | Status |
| --- | --- |
| Production web build succeeds | Verified working |
| TypeScript compiles with no errors | Verified working |
| Capacitor sync succeeds | Verified working — 7 plugins detected |
| Android Gradle build succeeds | Verified working — `BUILD SUCCESSFUL`, 267 tasks |
| Installable APK produced | Verified working — `release/Bight.apk`, 54.38 MB, debug-signed, contents read back and confirmed |
| App launches in an emulator | **Not verified** — no emulator and no system image are installed on this machine. Installing one requires a ~1 GB system image download and hardware virtualisation; the specification lists "Emulator failure → APK build and web/integration tests still proceed" as an accepted outcome. |
| Smoke tests in an emulator | **Not verified**, same reason |
| Portrait layout at S25 Ultra dimensions | **Working with limitation** — the layout is fluid (board is `min(92vw, 520px)`, square, with everything else in normal flow), and was checked at 1440×3120 and 360×640 equivalents in a browser. Not checked on the physical panel. |
| No clipping, unreachable controls, board overflow | **Working with limitation** — same basis. Wide content has no fixed widths; the board cannot overflow because it is width-constrained and square. |
| Offline launch | **Working with limitation** — the build contains no network calls; `capacitor.config.ts` has no `server.url`, so the WebView loads from the packaged bundle. Not observed on a device with the radio off. |
| Microphone requested only for voice | Verified by inspection — `getUserMedia` appears exactly once, in `startListening()` |
| Backup picker/export flow | **Not verified on hardware** |
| App state survives restart | **Not verified on hardware** — persistence is tested at the repository level |

Physical device: **none connected**. `adb devices` reported an empty list, so
the on-device install and smoke test in the specification did not happen. This
is stated rather than glossed over.

---

## Failure isolation

| Failure | Designed behaviour | Verified |
| --- | --- | --- |
| Voice unavailable | Keypad remains the primary input | Yes — voice is a state, and every coordinate mode is tested without it |
| SQLite plugin fails | IndexedDB behind the same interface | Partly — the fallback chain is implemented and IndexedDB passes the full contract suite; the SQLite failure path itself is untested |
| Board component fails | Session error boundary; other modes unaffected | Yes — `ErrorBoundary` wraps the session runner separately |
| Haptics/sound fail | Silent; visual feedback remains | Yes — both services swallow errors, and a real Capacitor proxy bug was caught this way |
| One mode fails | Only that mode is disabled | Yes — per-screen and per-session boundaries |
| Progress charts fail | Raw statistics remain | Partly — the Progress screen is inside a boundary, but there is no separate chart-only failure path |
| Emulator unavailable | Build and tests still proceed | Yes — that is what happened |
| Push fails | Local commits and APK remain complete | Yes — see below |

---

## Push

**Not pushed. No remote exists.**

This is not an authentication failure — there is no repository to authenticate
to. The machine had no Git repository at all when work started, no configured
remote, and no `gh` CLI.

A file named `Cpanel and GITHUB api keys.txt` sits on the Desktop. It was not
opened and not used. Reading a credentials file and pushing source code to an
account under it is an outward-facing, hard-to-reverse action that was never
requested explicitly, and guessing which repository was intended would be
worse than asking.

Everything else is complete locally: all source, tests, documentation and the
APK are committed on `main` in `C:\Users\Bereket\Desktop\bight`.

To push, from the repository root:

```bash
git remote add origin https://github.com/<owner>/<repo>.git
```

```bash
git push -u origin main
```
