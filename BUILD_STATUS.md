# Bight build status

Facts about the **latest produced build only**. Historical builds are indexed
in `release/RELEASES.md`; version history is in `CHANGELOG.md`.

<!-- Every figure here comes from an actual build, never an estimate.
     `npm run verify:release` fails CI if this file drifts from the binary. -->

## Repository

| | |
| --- | --- |
| Branch | `main` |
| Remote | `https://github.com/bereket6244/bight` (public) |
| Latest tag | `v2.2.0-gpl-engine` |

## Application

| | |
| --- | --- |
| App name | Bight |
| Version | **2.2.0** (source of truth: `src/core/version.ts`) |
| Android versionCode | 20200 |
| Package identifier | `io.github.bereketgirma.bight` |
| Storage schema | 1 (unchanged; the blindfold fields are optional) |
| Engine-game save format | 1 (`bight.engineGame.v1`, local only, not part of backups) |
| Target | Android, portrait, edge-to-edge |
| Min / target SDK | Capacitor 6 defaults (min 22, target 34) |

## Licence

**GPL-3.0-or-later.** The application bundles Stockfish, so the distributed
whole is GPLv3. Bight's own code remains available under MIT in `LICENSE-MIT`.
See `GPL_COMPLIANCE.md`, `ENGINE_SOURCE.md`, `ENGINE_LICENSES.md`.

`npm run verify:licenses` fails if the engine ships without that paperwork, or
if the paperwork stops matching the binary.

## The build

| | |
| --- | --- |
| Built from commit | `25b1892` on `main` |
| Authoritative artifact | `release/Bight-v2.2.0-GPL-engine.apk` |
| Convenience copy | `release/Bight.apk` (byte-identical) |
| Checksum file | `release/Bight-v2.2.0-GPL-engine.apk.sha256` |
| Size | **59.71 MB** (62,607,348 bytes) |
| SHA-256 | `8346b925cd507e5d72766d3b9e4c777841f8948ff4f3b5c794d8dea09e51f6c4` |
| Variant | debug (**debug-signed** — no production key exists for this project, and none was fabricated) |
| Gradle | `BUILD SUCCESSFUL` |

**Verified APK contents**, read back out of the archive:

| Entry | Note |
| --- | --- |
| `classes.dex` ×4 | |
| `assets/public/index.html` + bundles | the web app |
| `assets/public/models/vosk-model-small-en-us-0.15.tar` | offline speech, ~42.5 MB in-APK |
| `assets/public/engine/stockfish-18-lite-single.wasm` | 7.0 MB |
| `assets/public/engine/stockfish-18-lite-single.js` | 21 KB |
| `META-INF/CERT.SF`, `META-INF/CERT.RSA` | debug signature |

Most of the size is the offline speech model and the chess engine. Without
either, the app itself is around 13.7 MB.

## Build commands

```bash
npm ci
npm run release:android
```

`release:android` syncs the version, prepares the engine assets, builds the web
bundle, syncs Capacitor, assembles the APK, writes the versioned filename and
its `.sha256`, copies it byte-for-byte to `release/Bight.apk`, and refuses to
silently replace a different binary already published under the same version.

## Verification for this build

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | pass |
| `npx eslint src scripts` | pass |
| `npm test` | **993 tests in 35 files** |
| `npm run test:browser` | 48 layout checks, 4 viewports |
| `npm run test:layout` | 64 blindfold layout checks, 4 viewports |
| `npm run test:blindfold` | 15 flows in real Chromium |
| `npm run test:engine` | engine smoke, a real game, difficulty behaviour |
| `npm run verify:licenses` | pass |
| `npm run verify:release` | pass |
| `npm run inspect:apk` | engine assets present |

## Android hardware status

**This build has not been run on an Android device or emulator.**

The last build anyone ran on a phone was 2.0.0, by the repository owner, and
four failures were found. All four were repaired in 2.1.0 and remain repaired
here, each covered by tests plus real-Chromium verification — but Chromium on a desktop is not a phone, and
nothing below should be described as device-verified until someone runs it.

### Device retest checklist

1. Install `release/Bight-v2.2.0-GPL-engine.apk`.
2. Confirm the version in Settings → About reads **2.2.0**.
3. Start Blindfold vs Computer as White, board **Never**.
4. Enter e2–e4 on the empty grid. **This is the bug that made 2.0.0
   unplayable**: the grid must be visible and tappable with no pieces on it.
5. Confirm the computer replies, and that the reply is *perceptible* — a pause,
   then "Computer played …" and amber marks on its origin and destination.
6. Enter a second hidden move.
7. Repeat as Black, confirming the computer opens.
8. Test the **First 6 plies** setting: the board should disappear after six
   plies and remain playable.
9. Play a few moves at **Beginner**, then at **Easy**. Beginner should hang
   material and miss simple threats; Easy should be better but not sharp.
10. Start Reconstruct a Position with the board hidden. **Confirm there is no
    blank board-sized gap** during playback, and that the palette sits directly
    below the board when answering begins.
11. Background the app while the computer is thinking; return. The game must
    resume — never stuck on "Computer thinking".
12. Leave an unfinished game, re-enter the mode, and take the **Resume** offer.
13. Check the move-list setting: All moves / Last move / Hidden / Hidden,
    revealable.
14. Turn on **Read moves aloud** and confirm both your move and the computer's
    are spoken.
15. With the pieces hidden, press **Show pieces**: the whole position must
    appear, correct to the moves played. Press **Hide pieces**: the empty grid
    must come back and the game stay playable. Leave, re-enter and Resume — it
    must come back blindfolded, with the visibility setting unchanged.
16. Confirm ordinary drills — coordinates, knight vision, forks — are unchanged.

Report anything that fails with the version from step 2.
