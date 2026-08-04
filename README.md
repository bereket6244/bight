# Bight

**Board sight.** An offline Android trainer for chess coordinates and board
vision.

Bight trains one narrow thing: knowing the board — naming any square instantly,
seeing what a piece attacks from where it stands, and holding all of that in
your head without looking. There are no puzzles, no multiplayer, and no chess
library of openings or games.

Since 2.0.0 it can also play you a blindfold game against Stockfish running on
your phone, as the end of that progression rather than as a general chess app.

Everything runs on the device. No account, no server, no adverts, no
telemetry, no network calls of any kind after installation.

**Use Bight on the web:** <https://bereket6244.github.io/bight/>. The public
web version keeps progress only for the current browser session; refreshing or
closing the page clears it. The Android app continues to store progress and
unfinished engine games on the device.

---

## What you can practice

Fifteen modes in seven groups. Variants that differ only by timing, orientation
or prompt visibility are settings inside a mode, not separate cards.

**Coordinates** — Find the square (see a coordinate, tap it), Name the square
(see a highlight, name it on the two-tap keypad), Alignment (do two named
squares share a rank, file or diagonal?).

**Square color** — a coordinate is shown with no board, and you say light or
dark. There is deliberately no board: seeing the square would answer it.

**Knight vision** — what it attacks, where it can legally go, what it sees
after landing, and the same from memory with no knight drawn. Plus Knight
routes, with an optional "fewest moves" requirement.

**Forks** — knight and queen, on realistic boards of 8–14 pieces. Two targets
are named; either **find** a square that attacks both, or **play** the piece
there over as many moves as it takes. While manoeuvring, the piece slides to
empty squares only — capturing a target would change the question underneath
you. Legal moves that do not yet fork are never marked wrong; solving in more
moves than necessary is recorded as suboptimal, not as a mistake. Every valid
square is accepted, not one arbitrary answer.

**Notation** — read a move like Nbd2 and play it in a realistic position
(10–26 pieces, both kings). The "Which knight?" exercise guarantees both
knights are on the board, so you have to work out which one is meant.

**Position vision** — sliding pieces in traffic, and which piece stops each
ray. Empty-board target collection was removed: the board gave the answer away.

### Prompt visibility and hidden boards

Flashing a prompt is a setting, not a mode. On the coordinate modes you can
choose whether the prompt stays up or flashes, and for how long; Name the
square can hide the board entirely for visualization practice.

### Home

Home shows what you actually practice, derived from local session history:
**Recent** (deduplicated, most recent first) and **You practice these most**
(weighted so recent practice counts more, and short sessions do not count at
all). Before there is enough history it shows a plainly-labelled **Start here**
list rather than pretending a fixed list is personalized.

### Session setup

The controls people change often are visible above Start: orientation, labels,
session length and its value, per-question time, prompt visibility, board
layout, and voice where the mode supports it. Weak-square filters, adaptive
weighting and retry scheduling live under **More settings**.

### Sound, spoken prompts and voice answers

Three separate things, with separate controls:

| | What it does | Microphone? |
| --- | --- | --- |
| Sound effects | Short tones for right and wrong | No |
| Spoken prompts | Reads coordinates aloud via the system voice | No |
| Voice answers | On-device recognition of your spoken answer | Yes, requested only when you turn it on |

Settings shows whether voice answers are available and why not if they are not.
Touch and keypad input always keep working.

### How practice flows

Practice is continuous. There is no Next button, no Submit button, and no
result screen between questions:

- **Correct** → the next question appears immediately. Nothing to press.
- **Wrong** → the square or button you chose flashes red and the *same*
  question stays up. The answer is never revealed; you just try again.
- **Multi-square questions** (knight vision and the like) complete themselves.
  Each correct square stays lit, and the moment the set is complete the next
  question loads. Tapping a square you already got right is ignored, not
  punished.

Every attempt is recorded either way, so a question you got wrong twice before
getting right counts as two mistakes in your statistics — the accuracy figures
reflect what actually happened, not just the final answer.

Input is locked for 180ms when a question is replaced, so a double tap can
never accidentally answer the question that follows.

A summary appears only when the session ends, is paused, or you exit.

### Geometry vs legal moves

Bight keeps these strictly apart, because they are different questions with
different answers, and confusing them teaches the wrong thing:

- **Geometry** — where a piece's movement pattern reaches, ignoring occupancy,
  turn order and check. A knight on a1 always sees b3 and c2.
- **Legal moves** — what is actually playable in a real position, including
  blocking, captures, pins, check, castling and en passant.

Every mode says which it means. Geometry comes from Bight's own tested
movement code; legality is delegated to `chess.js`.

**No answer in Bight is hand-written.** Every correct answer is computed at
runtime from tested rules, and the test suite cross-checks Bight's attack
generation against `chess.js` for every piece type, colour and origin square.

---

## Blindfold training

The drills that teach holding a position in your head and updating it as moves
go by. Full detail in `BLINDFOLD_TRAINING.md`.

**Track a Position** — a legal move sequence is played out, then one targeted
question about the position it produced: where a piece ended, what stands on a
square, whether a square is occupied, whose move it is, whether a named piece
survived, what a capture took, or what attacks what.

**Reconstruct a Position** — rebuild it by tapping a piece then a square.
Either a named subset, the whole position, or repair one shown with a few
deliberate errors. Correct placements stay, wrong ones flash and are discarded,
and the question completes itself. The palette always offers all twelve pieces
and shows no counts — a palette listing only what you still need would hand
over the material balance.

**Progressive Blindfold** — the same questions up a six-stage ladder that
removes visual help a stage at a time. The hardest stage you have held without
hints is restored next session.

**Blindfold vs Computer** — a whole game against Stockfish 18, bundled and run
on the device with no network at any point. When the pieces are hidden you
still get a **visible, empty coordinate grid**: tap origin, tap destination.
The move you played and the computer's reply are marked on it in amber and
stated in words, and the computer always takes a moment so you can tell that
something happened.

Lost the position? **Show pieces** draws it in full, and **Hide pieces** puts
the blindfold back on. It is a look, not a setting: your choice of what to show
is untouched, and a game you come back to is hidden again.

Four opponent levels — Beginner, Easy, Intermediate, Strong. They are described
by how they play, never by a rating: Beginner hangs material and misses simple
threats; Strong plays properly. **No Elo is claimed**, because none has been
measured.

## Requirements

| | |
| --- | --- |
| Node.js | 18.18+ (built and tested on 18.18.0) |
| JDK | 17 or 21 (built with Adoptium 21) |
| Android SDK | Platform 35, Build-Tools 35.0.0 |

Set `JAVA_HOME` to your JDK and make sure the Android SDK location is in
`android/local.properties` (`sdk.dir=...`). That file is machine-specific and
is deliberately not committed.

## Build and run

```bash
npm install
```

```bash
npm run dev
```

Opens the app in a browser at `http://localhost:5173`. Everything except the
native plugins works there; storage falls back to IndexedDB.

### Public web version

GitHub Pages deploys the static web target from `main` through
`.github/workflows/pages.yml`:

```bash
npm run fetch:voice-model
npm run build:pages
npm run test:pages
```

The Pages build is served beneath `/bight/`, runs Stockfish locally in a Web
Worker, and hosts the Vosk model as a same-origin static file that is loaded
only when voice input is used. It deliberately selects the in-memory
repository and bypasses unfinished-game `localStorage`, so attempts, mastery,
history, recommendations, preferences, and engine games do not survive a
refresh. Session statistics and the end-of-session summary still work until
then. See `WEB_DEPLOYMENT.md` for the deployment and verification contract.

### Optional: offline voice answers

The Vosk speech model is ~39 MB and is not committed to the repository. Fetch
it before building if you want voice input:

```bash
npm run fetch:voice-model
```

Without it the app runs normally and reports voice as unavailable in Settings;
the two-tap keypad is always the primary input.

### Android APK

```bash
npm run android:build
```

That runs the production web build, syncs Capacitor, and assembles a
debug-signed APK. The result is copied to `release/Bight.apk`.

To do it by hand:

```bash
npm run build && npx cap sync android && cd android && ./gradlew assembleDebug
```

### Install on a device

```bash
adb install -r release/Bight.apk
```

The APK is debug-signed, which is fine for installing directly. No production
signing key is committed to this repository, and none should be.

## Tests

```bash
npm test
```

```bash
npm run verify
```

`verify` runs lint and the full test suite. `npm run typecheck` runs
TypeScript on its own.

See `TEST_REPORT.md` for what was actually run and what passed.

---

## How it is put together

```
src/
  core/
    chess/        Coordinates, geometry, ray tracing, knight routing,
                  and the chess.js bridge. Pure, exhaustively tested.
    training/     Question generators, one per mode, behind a registry.
    session/      The session state machine.
    progress/     Mastery model, statistics, streaks, achievements.
    storage/      One repository contract, three implementations.
    backup/       Versioned export/import with a migration chain.
  services/       Voice, speech, haptics, sound — all optional.
  ui/             Board, screens, app shell.
```

Four rules hold the design together:

1. **Chess rules live in one place.** No mode re-implements movement. A bug
   fixed in `core/chess` is fixed everywhere at once.
2. **Modes are data.** A mode contributes a generator to a registry; the
   session engine, progress views and settings all read from that list, so
   adding a mode touches nothing else.
3. **Optional things fail quietly.** Voice, sound, haptics and even
   persistence can each be unavailable without affecting anything else.
   Error boundaries wrap every screen and the session runner.
4. **Time is injected, never read.** The session engine takes `now` as an
   argument, which is why pausing and both timer kinds are testable rather
   than flaky.

### Storage

One `BightRepository` interface, three implementations, chosen at startup:

```
SQLite (on device) → IndexedDB (browser, or if the plugin fails) → in-memory
```

The same contract test suite runs against them, which is what makes the
fallback safe. If everything fails the app still trains — Settings just says
progress will not be saved.

The GitHub Pages target is an explicit storage exception: it selects the
in-memory repository immediately and never probes SQLite or IndexedDB. This
does not change the Android/development fallback chain described above.

### How mastery works

A square counts as mastered when four things are true together: you answer it
correctly (recent answers weigh most), quickly (under 2s scores full marks),
enough times (at least 6), and recently. Because sample size is part of the
score, **one lucky fast answer can never mark a square mastered**. Mastery
decays with a ~21-day half-life, so old ground comes back around.

Practice weighting is the inverse of mastery, capped at 6× so one weak square
cannot crowd out the rest of the board.

### Streaks

A day counts once you finish a session of at least **10 scored questions**.
Opening the app does not count, and neither does answering one question and
leaving.

There are no dark patterns: no guilt messages, no energy systems, no artificial
waiting, no paid unlocks and no notifications pressuring you back.

---

## Privacy

Bight collects nothing and sends nothing. All data stays in the app's private
storage on your device.

On the public web version, training data stays only in memory for the current
page session. Static JavaScript, engine, voice, artwork, and licence files are
served from the same `/bight/` Pages site; there is no backend or analytics.

The microphone permission is declared so voice answers can be offered, and is
only requested when you actually start a session with voice switched on.
Recognition runs entirely on-device.

Backup export and import use Android's document picker, so Bight never asks
for broad storage access.

## Documentation

| File | What it covers |
| --- | --- |
| `BUILD_STATUS.md` | Branch, commit, version, package id, APK checksum, build commands |
| `AUDIT_REPORT.md` | Every requested feature and its verified status |
| `TEST_REPORT.md` | Commands run, counts, results |
| `BACKUP_FORMAT.md` | Backup schema and migration policy |
| `WEB_DEPLOYMENT.md` | GitHub Pages target, storage, assets and verification |
| `THIRD_PARTY_NOTICES.md` | Dependencies and licences |

## Licence

**GPL-3.0-or-later.** Bight bundles Stockfish, which is GPLv3, so the
distributed application is offered as a whole under the GPL. Bight's own code
remains available under MIT — see `LICENSE-MIT`. Version 1.4.0 was the last
engine-free MIT build and is kept in `release/`.

See `GPL_COMPLIANCE.md`, `ENGINE_SOURCE.md` and `ENGINE_LICENSES.md`.

### Downloads

Builds are named for what they are:

    Bight-v<version>-<licence>-<variant>.apk

The latest is `release/Bight-v2.2.0-GPL-engine.apk`, with its `.sha256`
alongside. `release/Bight.apk` is a byte-identical convenience copy. Every
verified build is indexed in `release/RELEASES.md`.

---

All chess artwork in Bight is original. It bundles no Lichess or Chess.com
assets and is not affiliated with either. See `THIRD_PARTY_NOTICES.md`.
