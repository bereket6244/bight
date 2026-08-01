# Bight releases

Every verified build, what is in it, and how to get it.

Filenames carry the version, the licence and the variant, because a file
called `Bight.apk` tells you none of the three:

    Bight-v<version>-<licence>-<variant>.apk

`release/Bight.apk` is a convenience copy of the newest build and is written
byte-for-byte from the versioned file, so the two cannot drift apart.

Every version below was **read out of the APK's own AndroidManifest**, not
assumed from its filename — `node scripts/apk-identify.mjs` does that, and is
what should be used before renaming or indexing any historical build.

All builds are **debug-signed**. No production signing key exists for this
project and none has been fabricated.

## Builds

| Version | Tag | File | Commit | Engine | Licence | Size | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **2.1.0** | `v2.1.0-gpl-engine` | `Bight-v2.1.0-GPL-engine.apk` | `d38e59e` | Stockfish 18 lite | GPL-3.0-or-later | 59.71 MB | `afe1681a2f21218c2a46efd7438550753b44e2e78fc8fee597f4d00f856708d6` |
| 2.0.0 | `v2.0.0-gpl-engine` | not kept in the tree | `171ad51` | Stockfish 18 lite | GPL-3.0-or-later | 59.70 MB | `2f8d92e7358b487bad0f2a27e844358bf03691e14906d97879d9017b96eaa166` |
| 1.4.0 | `v1.4.0-mit-blindfold` | `Bight-v1.4.0-MIT-blindfold.apk` | `67a442b` | none | MIT | 54.31 MB | `55a36c07eb5a53b47054cc5522b529a15c20fdad7bb9c6abd0a0d56fc32ad7d2` |

The 2.1.0 row is completed by `npm run release:android`, which prints the
commit, size and checksum of the build it produces.

### Why 2.0.0 is not a file here

Its binary is byte-identical to what was committed at `171ad51` and is
recoverable from that commit or from the `v2.0.0-gpl-engine` tag. It is also
the build a real Android device found unplayable — the hidden board removed the
only move input — so it is recorded for provenance rather than offered as a
download. It previously existed twice under two names (`Bight.apk` and
`Bight-engine.apk`) with identical bytes; the duplicate has been removed.

### 1.3.0 and earlier

Version 1.3.0 and earlier shipped only as `release/Bight.apk`, overwritten in
place at each release. Those binaries exist in git history at their release
commits, but **no versioned copy was ever produced**, and the checksums were
not recorded at the time. They are listed here as history rather than as
verified artifacts:

| Version | Commit | Notes |
| --- | --- | --- |
| 1.3.0 | `5838304` | Third pass. MIT, no engine, no blindfold modes. |
| 1.2.0 and earlier | see `CHANGELOG.md` | Not separately archived. |

Recovering one of them means checking out that commit and reading
`release/Bight.apk`. Its version can be confirmed with
`node scripts/apk-identify.mjs`.

## What is in each release

### 2.1.0 — blindfold repairs (this release)

Fixes four failures reported from a real Android phone:

- Blindfold vs Computer was unplayable once the pieces disappeared: the board
  is the move-entry surface, and hiding it left nothing to tap. The board now
  has explicit display modes and keeps a usable empty coordinate grid.
- Reconstruction reserved a board-sized blank gap during hidden playback. The
  board is now removed from layout rather than blanked.
- The computer replied too fast to perceive. There is now a minimum
  presentation interval, last-move marks, and a "Computer played …" line.
- "Easy" played far too strongly. Beginner and Easy now choose among MultiPV
  candidates with a seeded, per-level weighted distribution.

Plus: background/resume no longer strands the game, unfinished games can be
resumed, the move-history setting is configurable, the progressive stage
survives a session, and both sides are spoken when speech is on.

### 2.0.0 — offline Stockfish

Added Blindfold vs Computer with Stockfish 18 (lite, single-threaded) bundled
locally. Changed the distributed licence to GPL-3.0-or-later. **Superseded by
2.1.0; not recommended.**

### 1.4.0 — blindfold training

Three blindfold drills — tracking, reconstruction, progressive — with no
engine, under MIT. Still a good build if the GPL obligation is unwanted.

## Getting a build

Preferred: the GitHub Release for the tag, which carries the APK and its
`.sha256`.

If no GitHub Release exists for a tag, the versioned APK in `release/` at that
tag is the artifact. Verify it before installing:

```bash
sha256sum -c release/Bight-v2.1.0-GPL-engine.apk.sha256
```

```bash
adb install -r release/Bight-v2.1.0-GPL-engine.apk
```

## Licensing

2.0.0 and later bundle Stockfish and are distributed under **GPL-3.0-or-later**
as a combined work. Bight's own code remains available under MIT
(`LICENSE-MIT`). 1.4.0 and earlier contain no engine and are MIT throughout.

See `GPL_COMPLIANCE.md`, `ENGINE_SOURCE.md` and `ENGINE_LICENSES.md`.

## Android verification status

| Version | Ran on a real Android device? |
| --- | --- |
| 2.1.0 | **Not yet.** Built and verified in desktop Chromium and by APK inspection. The device retest checklist is in `BUILD_STATUS.md`. |
| 2.0.0 | Yes — by the repository owner, who found the four failures 2.1.0 repairs. |
| 1.4.0 | No. |
