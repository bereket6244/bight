/**
 * Where the engine lives and how hard it thinks.
 *
 * The asset paths are relative to the web root, which is what both the Vite
 * dev server and a Capacitor WebView serve from. They are deliberately plain
 * strings rather than a bundler import: the `.wasm` is 7 MB and must be a
 * copied asset, not something Vite tries to inline or hash, and the worker
 * script finds its own `.wasm` by replacing `.js` in its own URL.
 */

import type { EngineDifficulty } from './engineTypes';

/** Path the Worker is constructed from. Copied by scripts/prepare-engine.mjs. */
export const ENGINE_WORKER_PATH = 'engine/stockfish-18-lite-single.js';
export const ENGINE_WASM_PATH = 'engine/stockfish-18-lite-single.wasm';

/**
 * The exact build in use.
 *
 * Lite and single-threaded on purpose: the full build is 113 MB, and the
 * multi-threaded builds need cross-origin isolation, which a Capacitor WebView
 * does not provide. See ENGINE_SOURCE.md.
 */
export const ENGINE_PACKAGE = 'stockfish';
export const ENGINE_PACKAGE_VERSION = '18.0.8';
export const ENGINE_BUILD = 'lite single-threaded WebAssembly';

/** Longest wait for `uciok` and the first `readyok`. */
export const HANDSHAKE_TIMEOUT_MS = 30_000;
/** Longest wait for a `bestmove` beyond the search's own limit. */
export const SEARCH_GRACE_MS = 10_000;
/** Longest wait for a bare `isready`. */
export const READY_TIMEOUT_MS = 15_000;

/**
 * @deprecated Superseded by `WEAK_PLAY_POLICY` in weakPlay.ts, which owns
 * search limits, Skill Level and the weak-move policy together. Kept only so
 * an external importer does not break; nothing in the app reads it.
 */
export interface DifficultySettings {
  label: string;
  /** One line describing how it plays, in behaviour rather than in rating. */
  detail: string;
  /** Stockfish `Skill Level`, 0–20. */
  skill: number;
  /** Milliseconds per move. */
  movetimeMs: number;
  /** Depth cap, which is what actually holds the weak levels back. */
  depth: number;
}

/**
 * Four levels, described by how they play rather than by a rating.
 *
 * No Elo is claimed. Stockfish's `UCI_Elo` is calibrated against its own
 * search rather than against any site's rating pool, and effective strength
 * moves with the time control, so a number here would be one we have not
 * measured. `Skill Level` plus a depth cap is used instead, because a shallow
 * search makes recognisable human-scale mistakes rather than merely playing
 * fast.
 */
export const DIFFICULTY_SETTINGS: Record<EngineDifficulty, DifficultySettings> = {
  'very-easy': {
    label: 'Very easy',
    detail: 'Looks barely a move ahead and hangs pieces.',
    skill: 0,
    movetimeMs: 100,
    depth: 1,
  },
  easy: {
    label: 'Easy',
    detail: 'Sees immediate threats, misses most plans.',
    skill: 3,
    movetimeMs: 200,
    depth: 3,
  },
  moderate: {
    label: 'Moderate',
    detail: 'Punishes loose pieces and simple tactics.',
    skill: 8,
    movetimeMs: 400,
    depth: 6,
  },
  strong: {
    label: 'Strong',
    detail: 'Plays properly. Expect to lose.',
    skill: 20,
    movetimeMs: 1000,
    depth: 12,
  },
};

export const DIFFICULTY_ORDER: readonly EngineDifficulty[] = Object.freeze([
  'very-easy',
  'easy',
  'moderate',
  'strong',
]);
