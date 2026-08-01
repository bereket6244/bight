# Engine licences

Every licence attaching to the chess engine Bight distributes, and the chain of
authorship behind it.

For what this means for the application as a whole, see `GPL_COMPLIANCE.md`.
For exactly which binary ships and where its source is, see `ENGINE_SOURCE.md`.

## The chain

```
Stockfish                       GPLv3    official-stockfish/Stockfish
  └─ compiled to WebAssembly by
     Stockfish.js               GPLv3    nmrugg/stockfish.js
       └─ published as
          npm `stockfish`       GPLv3    stockfish@18.0.8
            └─ two files copied verbatim into
               Bight            GPLv3 as a combined work
```

## Stockfish

> Stockfish, a UCI chess playing engine derived from Glaurung 2.1
> Copyright (C) 2004-2026 The Stockfish developers (see AUTHORS file)
>
> Stockfish is free software: you can redistribute it and/or modify it under
> the terms of the GNU General Public License as published by the Free Software
> Foundation, either version 3 of the License, or (at your option) any later
> version.
>
> Stockfish is distributed in the hope that it will be useful, but WITHOUT ANY
> WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
> A PARTICULAR PURPOSE. See the GNU General Public License for more details.

Named in the original attribution: T. Romstad, M. Costalba, J. Kiiski,
G. Linscott and other contributors. Full list in the upstream `AUTHORS` file.

## Stockfish.js

> Stockfish.js 18 (c) 2026, Chess.com, LLC
> https://github.com/nmrugg/stockfish.js
> License: GPLv3
>
> Based on Stockfish (c) T. Romstad, M. Costalba, J. Kiiski, G. Linscott and
> other contributors.

Author: Nathan Rugg. Development sponsored by Chess.com. This notice is the
header of the shipped `stockfish-18-lite-single.js`, reproduced verbatim.

Credited by the Stockfish.js project for prior work on browser Stockfish
builds: exoticorn, ddugovic, niklasf (stockfish.js, stockfish.wasm,
stockfish-web), hi-ogawa, linrock.

## The NNUE network

The evaluation network `nn-9067e33176e`, by Linmiao Xu (linrock), is embedded
in the `.wasm`. Stockfish's networks are distributed as part of Stockfish and
under the same GPLv3 terms; they are not a separately-licensed component with
its own conditions.

## Small print inside the package

Two files in the npm package carry an MIT header rather than GPLv3:
`index.js` and `scripts/postinstall.js`. Neither is distributed by Bight —
`index.js` is a Node convenience wrapper Bight does not use, and
`postinstall.js` only creates symlinks at install time. Only the two engine
files listed in `ENGINE_SOURCE.md` are shipped, and both are GPLv3.

## Bight's own components, unchanged

Adding the engine relicensed the combined distributed work. It did not change
what any third-party component is licensed under, and it did not change the
terms Bight's own code is available under.

| Component | Licence | Note |
| --- | --- | --- |
| Bight source | MIT (`LICENSE-MIT`) and GPLv3 as part of the combined work | Sole copyright holder |
| Piece set, board, icon, wordmark | Original work, MIT | No third-party chess artwork anywhere |
| `chess.js` | BSD-2-Clause | Unchanged |
| `react`, `react-dom` | MIT | Unchanged |
| Capacitor packages | MIT | Unchanged |
| `vosk-browser`, Vosk model | Apache-2.0 | Unchanged |

No permissive dependency has been relicensed. Each keeps its own notice; see
`THIRD_PARTY_NOTICES.md`.

## Full licence texts

- GPLv3: `LICENSE` in this repository, `public/engine/COPYING-stockfish.txt`
  beside the binary, and <https://www.gnu.org/licenses/gpl-3.0.html>
- Bight's MIT licence: `LICENSE-MIT`
- Everything else: `THIRD_PARTY_NOTICES.md`
