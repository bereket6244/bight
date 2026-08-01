# GPL compliance for the engine-enabled build

**Short version:** Bight bundles Stockfish, which is GPLv3. The distributed
application is therefore offered as a whole under GPLv3. Bight's own code
remains available under MIT as well, and every third-party licence is preserved
unchanged.

This document records what was checked and why the conclusion follows. It is a
statement of the approach taken, not legal advice.

## Scope

| | |
| --- | --- |
| Branch | `main` (merged from `feature/blindfold-stockfish-handoff`) |
| Applies from | the commit that adds `public/engine` and `src/services/engine` |
| Applies to | every build from 2.0.0 onward |

The repository owner has decided to merge, so `main` is GPLv3 from 2.0.0
onward. Version 1.4.0 remains the last engine-free MIT build and is kept in
`release/` for anyone who wants Bight without the GPL obligation.

## Why GPLv3 rather than MIT plus a note

Stockfish is GPLv3. The Stockfish.js WebAssembly build is GPLv3. Both are
compiled into `public/engine/` and shipped inside the same APK as Bight's own
code, and the app drives the engine directly through a Worker and the UCI
protocol.

Whether a WebAssembly engine in a Worker is "mere aggregation" or a combined
work is exactly the kind of question this project should not be betting on.
The conservative reading — that an APK containing both, built together and
shipped as one application, is a combined work — is the one taken here. Under
that reading GPLv3 §5 requires the whole to be licensed under GPLv3.

The alternative, keeping the repository MIT while shipping a GPLv3 binary
inside it, would leave the distributed application's licensing ambiguous. That
was explicitly not acceptable.

## Licensing inventory

Performed before the engine was added.

### Bight's own code

| | |
| --- | --- |
| Copyright holder | Bereket Girma, sole holder |
| Contributors in git history | one (`git log --format='%aN'` returns a single name) |
| Previous licence | MIT |
| Third-party contributions | none |

The sole copyright holder can license their own work under any terms, so
nothing blocks offering it under GPLv3. Because there is exactly one
contributor, there is no need to obtain anyone else's agreement — which is the
condition that would otherwise have stopped this.

### Assets

All original work created for this project: the piece set
(`src/ui/components/Pieces.tsx`), the board, the app icon and the wordmark.
This was a deliberate choice recorded in `THIRD_PARTY_NOTICES.md` from the
first pass — GPL-licensed piece sets such as cburnett were rejected precisely
to avoid an unexamined GPL obligation. That the project has now taken one on
knowingly does not change the fact that the artwork remains unencumbered.

### Runtime dependencies

| Package | Licence | GPLv3-compatible? |
| --- | --- | --- |
| `react`, `react-dom` | MIT | Yes |
| `chess.js` | BSD-2-Clause | Yes |
| `@capacitor/*`, `@capacitor-community/sqlite` | MIT | Yes |
| `vosk-browser` | Apache-2.0 | Yes, into GPLv3 (one-way) |
| `vosk-model-small-en-us-0.15` | Apache-2.0 | Yes, into GPLv3 (one-way) |
| `stockfish` (Stockfish.js) | **GPL-3.0** | It is the obligation |

MIT and BSD-2-Clause are permissive and impose no condition that conflicts
with GPLv3. Apache-2.0 is one-way compatible with GPLv3: Apache-2.0 code may
be included in a GPLv3 work, though not the reverse. Nothing in the dependency
tree is licensed under terms that cannot be combined with GPLv3.

**No permissive dependency has been relicensed.** MIT-licensed React is still
MIT-licensed React. What is offered under GPLv3 is the combined distributed
work, and each component keeps its own notice.

### Build tooling

Vite, TypeScript, ESLint, Vitest, Puppeteer and the Capacitor CLI are
development tools. They are not distributed in the APK and place no conditions
on the output.

## What this repository does as a result

| File | Purpose |
| --- | --- |
| `LICENSE` | The GPLv3 text. The licence of the combined work. |
| `LICENSE-MIT` | The previous Bight MIT licence, preserved verbatim. Bight's own source is still available under these terms. |
| `THIRD_PARTY_NOTICES.md` | Every third-party component and its licence. |
| `ENGINE_LICENSES.md` | The engine's licence chain in full. |
| `ENGINE_SOURCE.md` | Exactly which binary ships, and where its source is. |
| `public/engine/COPYING-stockfish.txt` | GPLv3, copied next to the binary it covers. |

`package.json` declares `"license": "GPL-3.0-or-later"`.

`npm run verify:licenses` fails the build if the engine ships without any of
these, or if `ENGINE_SOURCE.md` stops naming the exact binary and checksums
that are actually bundled.

## Dual availability, stated precisely

Two things are true at once, and conflating them would be wrong:

1. **Bight's own source code** — everything in `src/`, `scripts/`, `android/`
   and the documentation — is the work of a single copyright holder and
   remains available under the MIT licence in `LICENSE-MIT`. Anyone who wants
   Bight without the engine can take it under MIT: remove `public/engine`,
   `src/services/engine` and the `blindfold-engine-game` mode, and no GPL
   obligation attaches to what is left. Version 1.4.0 is exactly that, and is
   kept as `release/Bight-v1.4.0-MIT-blindfold.apk`.

2. **The distributed application**, which contains Stockfish, is offered as a
   whole under GPLv3.

## Source-code obligation

GPLv3 §6 requires that anyone receiving the binary can get the corresponding
source. This is satisfied by:

- Bight's own source, in this repository.
- The engine's source, identified exactly in `ENGINE_SOURCE.md`: npm package
  and pinned version, upstream repository, the SHA-256 of every shipped file,
  and the steps to rebuild them.
- No modifications. The engine binaries are copied byte-for-byte out of the
  published npm package by `scripts/prepare-engine.mjs`, which verifies the
  checksum. Nothing is patched, so there are no local changes to publish.

If the APK is ever distributed to anyone outside this repository, the offer of
source must travel with it — a link to this repository at the exact commit is
sufficient, provided that repository stays reachable.

## What is deliberately not claimed

- **This is not legal advice**, and no legal certainty is invented. The
  conservative position is taken because it is conservative, not because a
  lawyer has confirmed it is required.
- **No claim that the engine is separable at runtime.** It could be argued
  that a Worker running a separate program is mere aggregation. That argument
  is not relied on.
- **No claim about anyone else's licensing.** Stockfish, Stockfish.js and
  Chess.com's sponsorship of that work are described as their own authors
  describe them.

## If the owner would rather not ship GPL code

The engine is contained in `src/services/engine/`, `src/core/engineGame/`,
`public/engine/` and the one mode `blindfold-engine-game`. Deleting those, and
reverting `LICENSE`/`package.json`, returns the project to MIT with the
blindfold drills intact — that is precisely the state of the Phase A
checkpoint commit recorded in `ENGINE_INTEGRATION.md`.
