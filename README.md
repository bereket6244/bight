# Bight

**Board sight.** An offline Android trainer for chess coordinates and board
vision.

Bight is not a chess app. You cannot play a game in it, there is no engine, no
puzzles, no opponent and no multiplayer. It trains one narrow thing: knowing
the board — naming any square instantly, seeing what a piece attacks from
where it stands, and holding all of that in your head without looking.

Everything runs on the device. No account, no server, no adverts, no
telemetry, no network calls of any kind after installation.

---

## What it trains

**Coordinates**
- See a coordinate, tap the square — on an empty board or a full one, from
  either side, with labels on or off.
- See a highlighted square, name it on a two-tap keypad.
- Memory variants: the coordinate or the highlight flashes and disappears.
- A blindfold variant that hides the board entirely.

**Square colour** — light or dark, from the coordinate alone with no board, or
from a flashed square.

**Knight vision** — nine variants, because the knight is the piece people
actually struggle to see: what it attacks, what it can legally reach with
pieces in the way, what it sees from where it lands, what it attacks from a
square with no knight shown, and shortest-route problems across the board.

**Other pieces** — bishops, rooks, queens, kings and pawns: attack squares,
legal destinations through traffic, whole diagonals, files and ranks, the
difference between a pawn push and a pawn capture, and which piece blocks each
ray.

**Board relations** — whether two squares share a rank, file or diagonal, and
coordinate walks you follow in your head.

**Moving pieces** — drag or tap-then-tap a piece to a named square.

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
| `THIRD_PARTY_NOTICES.md` | Dependencies and licences |

## Licence

MIT — see `LICENSE`.

All chess artwork in Bight is original. It bundles no Lichess or Chess.com
assets and is not affiliated with either. See `THIRD_PARTY_NOTICES.md`.
