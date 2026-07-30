# Bight build status

<!-- APK figures in this file are filled in from an actual build, never estimated. -->

## Repository

| | |
| --- | --- |
| Location | `C:\Users\Bereket\Desktop\bight` |
| Branch | `main` |
| Remote | **none configured** — see "Push" below |
| Commits | 5, one per milestone |

## Application

| | |
| --- | --- |
| App name | Bight |
| Version | 1.0.0 |
| Package identifier | `io.github.bereketgirma.bight` |
| Target | Android, portrait, edge-to-edge |
| Min / target SDK | Capacitor 6 defaults (min 22, target 34) |
| Compile SDK | 34 |

The package id follows the `io.github.<owner>.bight` convention the brief
suggested, derived from the repository owner.

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
| Size | **54.38 MB** (57,024,833 bytes) |
| SHA-256 | `2be5748f577363d43cb817a75e8baa60b9310f2a8e2d2ea1e5d2171bf0f904cd` |
| Final commit | `516dc8fbd11cc4de59498680b3723738000f61f4` |
| Gradle result | `BUILD SUCCESSFUL` — 267 actionable tasks |

**Verified APK contents** (read back out of the built archive, not assumed):

| Entry | Size |
| --- | --- |
| `classes.dex` + 3 more | 10.0 MB total |
| `assets/public/index.html` + JS/CSS bundles | web app |
| `assets/public/models/vosk-model-small-en-us-0.15.tar` | 70.9 MB uncompressed, 42.5 MB in-APK |
| `META-INF/CERT.SF`, `META-INF/CERT.RSA` | debug signature present |
| Total entries | 521 |

Most of the 54 MB is the offline speech model. Without it the APK is 13.7 MB.

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
| A — Coordinate recognition, both directions plus memory variants | Complete |
| B — Square-colour training | Complete |
| C — Knight vision, nine variants | Complete |
| D — Other piece vision and movement | Complete |
| E — Movable pieces | Complete (drag wired, gesture untested — see audit) |
| F — Session controls | Complete |
| G — Progress, mastery, adaptive practice | Complete |
| H — Restrained gamification | Complete |
| I — Offline voice input | Implemented; audio path unverified — see audit |
| J — Backup, restore, migration | Complete |

## Unresolved items

These are stated plainly rather than buried:

1. **Nothing has been pushed.** No Git remote exists on this machine. This is
   not an auth failure — there was no repository at all when work began. All
   work is committed locally on `main`. See "Push" below.

2. **No emulator or device testing.** No Android emulator, no system image,
   and no device connected over ADB. The APK builds and is installable, but
   **it has never been launched**. Layout was verified in a real browser at
   412×915 and 360×640; behaviour was verified by 436 automated tests.

3. **Voice audio path unverified.** Grammar and parsing have 29 passing tests
   and the model is packaged, but Vosk WASM loading, microphone capture and
   recognition accuracy have not been executed once.

4. **SQLite never run.** Implemented against the same contract IndexedDB and
   the in-memory engine both pass, but it requires a native platform.

5. **Drag gestures unsimulated.** jsdom has no drag data transfer. Tap-to-move
   is fully tested and is the primary path on a phone.

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

**Not pushed — no remote exists.**

```bash
git remote add origin https://github.com/<owner>/<repo>.git
```

```bash
git push -u origin main
```

Full reasoning is in `AUDIT_REPORT.md` under "Push".
