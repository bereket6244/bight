# Bight build status

<!-- APK figures in this file are filled in from an actual build, never estimated. -->

## Repository

| | |
| --- | --- |
| Location | `C:\Users\Bereket\Desktop\bight` |
| Branch | `feature/blindfold-stockfish-handoff` |
| Remote | `https://github.com/bereket6244/bight` (private) |
| Base | `main` @ `5838304` |

## Application

| | |
| --- | --- |
| App name | Bight |
| Version | **1.4.0** (source of truth: src/core/version.ts) |
| Android versionCode | 10400 |
| Storage schema | 1 (unchanged — the new attempt fields are optional) |
| Package identifier | `io.github.bereketgirma.bight` |
| Target | Android, portrait, edge-to-edge |
| Min / target SDK | Capacitor 6 defaults (min 22, target 34) |
| Compile SDK | 34 |

The package id follows the `io.github.<owner>.bight` convention the brief
suggested, derived from the repository owner.

## Licensing on this branch

**This branch is GPLv3, because it bundles Stockfish.** `main` is MIT and ships
no engine. The distributed application is offered as a whole under GPLv3;
Bight's own code remains available under MIT in `LICENSE-MIT`. See
`GPL_COMPLIANCE.md`, `ENGINE_SOURCE.md` and `ENGINE_LICENSES.md`.

## The two APKs in `release/`

| File | Size | SHA-256 | Engine | Licence |
| --- | --- | --- | --- | --- |
| `Bight.apk` | 59.89 MB | `c26ef94b4a76e159963fd8e59fa470d1cd438fe54000159264807b7222958a8e` | Stockfish 18 lite single-threaded | GPLv3 |
| `Bight-blindfold-checkpoint.apk` | 54.31 MB | `55a36c07eb5a53b47054cc5522b529a15c20fdad7bb9c6abd0a0d56fc32ad7d2` | none | MIT |

The checkpoint APK is the Phase A build, kept deliberately: if the engine ever
needs withdrawing, a known-good engine-free build already exists and does not
need rebuilding. Both are **debug-signed** — no production signing key exists
for this project, and none was fabricated.

## Engine assets

| | |
| --- | --- |
| Package | `stockfish@18.0.8`, pinned exactly |
| Build | lite single-threaded WebAssembly |
| Worker script | `stockfish-18-lite-single.js`, 21,429 bytes |
| WebAssembly | `stockfish-18-lite-single.wasm`, 7,295,411 bytes |
| In the APK | `assets/public/engine/`, asserted by `scripts/inspect-apk.mjs` |
| Network at runtime | none |

Assets are copied from `node_modules` by `scripts/prepare-engine.mjs` and are
not committed, the same treatment the Vosk voice model gets.

## Toolchain used for this build

| | |
| --- | --- |
| OS | Windows 11 Pro 10.0.26200 |
| Node | 18.18.0 |
| npm | 9.8.1 |
| JDK | Eclipse Adoptium 21.0.12.8 |
| Gradle | 8.2.1 (wrapper, `bin` distribution) |
| Android Gradle Plugin | 8.2.1 |
| Android SDK | Platform 34 + 35, Build-Tools 35.0.0 |
| Vite | 5.4.21 |
| Capacitor | 6.2.1 |

Node 18.18.0 is what pinned the stack: Capacitor 7 and Vite 7 both require
Node 20 or newer.

## APK

| | |
| --- | --- |
| Path | `release/Bight.apk` |
| Variant | debug (debug-signed) |
| Size | **59.89 MB** (62,800,533 bytes) |
| SHA-256 | `c26ef94b4a76e159963fd8e59fa470d1cd438fe54000159264807b7222958a8e` |
| Gradle result | `BUILD SUCCESSFUL` — 267 actionable tasks |

**Verified APK contents** (read back out of the built archive, not assumed):

| Entry | Size |
| --- | --- |
| `classes.dex` + 3 more | 10.0 MB total |
| `assets/public/index.html` + JS/CSS bundles | web app |
| `assets/public/models/vosk-model-small-en-us-0.15.tar` | 70.9 MB uncompressed, 42.5 MB in-APK |
| `assets/public/engine/stockfish-18-lite-single.wasm` | 7.0 MB |
| `assets/public/engine/stockfish-18-lite-single.js` | 21 KB |
| `META-INF/CERT.SF`, `META-INF/CERT.RSA` | debug signature present |
| Total entries | 517 |

Most of the 60 MB is the offline speech model (42.5 MB in-APK) and the chess
engine (about 5.5 MB in-APK). Without either, the app itself is around 13.7 MB.

The APK is debug-signed, which the brief accepts. **No production signing key
is committed**, and none should be — `*.jks`, `*.keystore` and
`keystore.properties` are all in `.gitignore`.

The APK is committed deliberately, despite the usual rule against committing
build output, because a working installable APK is the primary deliverable.

## Build commands

Full pipeline, from a clean clone:

```bash
npm install
```

```bash
npm run fetch:voice-model
```

Optional — downloads the ~39 MB Apache-2.0 Vosk model into `public/models/`
so voice answers work offline. Skip it and the app runs normally with voice
reported as unavailable.

```bash
npm run android:build
```

That single command runs the web build, syncs Capacitor, assembles the APK,
copies it to `release/Bight.apk`, and prints its size and SHA-256.

Equivalent manual steps:

```bash
npm run build && npx cap sync android && cd android && ./gradlew assembleDebug --no-daemon
```

## Install

```bash
adb install -r release/Bight.apk
```

## Verification commands

```bash
npm run verify
```

Runs ESLint (0 warnings tolerated), `tsc --noEmit`, and the full Vitest suite.

## Completed feature groups

| Group | State |
| --- | --- |
| A — Coordinate recognition, both directions | Complete (flash is now a setting) |
| B — Square-color training | Complete (board-revealing variants removed) |
| C — Knight vision | Complete (4 variants + separate Knight routes mode) |
| D — Other piece vision | Complete (sliders in traffic; empty-board collection removed) |
| E — Movable pieces | Complete (drag wired, gesture untested — see audit) |
| F — Session controls | Complete |
| Continuous practice flow (no Next/Submit, auto-advance) | Complete |
| Forks — knight and queen | Complete (new in second pass) |
| Notation and piece selection | Complete (new in second pass) |
| Pinned bottom navigation and app shell | Complete (browser-verified) |
| Home Recent / Frequently used | Complete |
| Separated sound, spoken prompts, voice answers | Complete |
| G — Progress, mastery, adaptive practice | Complete |
| H — Restrained gamification | Complete |
| I — Offline voice input | Implemented; audio path unverified — see audit |
| J — Backup, restore, migration | Complete |

## Unresolved items

These are stated plainly rather than buried:

1. **No emulator or device testing.** No Android emulator, no system image,
   and no device connected over ADB. The APK builds and is installable, but
   **it has never been launched**. Layout was verified in a real browser at
   412×915 and 360×640; behaviour was verified by 637 automated tests and 24 real-browser layout checks.

2. **Voice audio path unverified.** Grammar and parsing have 29 passing tests
   and the model is packaged, but Vosk WASM loading, microphone capture and
   recognition accuracy have not been executed once.

3. **SQLite never run.** Implemented against the same contract IndexedDB and
   the in-memory engine both pass, but it requires a native platform.

4. **Drag gestures unsimulated.** jsdom has no drag data transfer. Tap-to-move
   is fully tested and is the primary path on a phone.

5. **Package id does not match the GitHub handle.** The id is
   `io.github.bereketgirma.bight`, derived from the owner's name; the GitHub
   account is `bereket6244`. Both are valid and stable, but the
   `io.github.<handle>` convention would give `io.github.bereket6244.bight`.
   Worth deciding before anyone installs the app — changing a package id later
   forces an uninstall/reinstall rather than an upgrade.

## Environment problems worked around

Recorded because a future build on a clean machine may hit them:

- **Gradle wrapper download kept truncating.** `gradle-8.2.1-all.zip` (~200 MB)
  failed twice with `SocketException: Connection reset`. Switching the wrapper
  to `gradle-8.2.1-bin.zip` fixed it.
- **Android SDK Platform 34 arrived corrupt.** Capacitor 6 compiles against
  SDK 34, which was not installed — only 35 was. Both Gradle's auto-download
  and `sdkmanager` produced `ZipException: Archive is not a ZIP archive` at
  ~33%. Downloading `platform-34-ext7_r03.zip` directly (60.3 MB, verified as
  a valid archive with 13,790 entries) and extracting it into
  `platforms/android-34` resolved it.

Both were network reliability problems on large transfers, not project faults.

## A packaging detail worth knowing

AAPT **gunzips `.gz` assets** when building the APK — APK entries are already
deflate-compressed, so it avoids compressing twice. The model ships on disk as
`vosk-model-small-en-us-0.15.tar.gz` but lands in the APK as
`...0.15.tar`, without the `.gz`.

This was found by reading the entry list out of the built APK. Had it gone
unnoticed, the recogniser's `fetch()` would have 404'd on device and voice
would have reported itself unavailable despite the model shipping correctly.
`recognizer.ts` now probes both names.

## Push

**Pushed.** The second pass was fast-forwarded into `main` at
<https://github.com/bereket6244/bight>, including a rebuilt
`release/Bight.apk`. The `second-pass` branch has been deleted; `main` is now
the only branch, local and remote.

No history was rewritten — the merge was a fast-forward and the push was not
forced, so every commit from both passes is intact and reachable from `main`.

The repository is **private**. To publish it:

```bash
gh repo edit bereket6244/bight --visibility public
```

GitHub warns that `release/Bight.apk` (54.36 MB) exceeds its recommended
50 MB file size. It is under the 100 MB hard limit so it pushes fine, but if
the APK is rebuilt often the history will grow quickly. Git LFS, or attaching
the APK to a GitHub Release instead of committing it, would avoid that.

No credential is stored in `.git/config` — the remote is a plain HTTPS URL,
and the token used for the initial push was removed afterwards.
