/**
 * The engine's public surface.
 *
 * Import from here, never from the files inside. The whole point of this
 * directory is that the engine can be removed by deleting it and the one mode
 * that uses it, and nothing else in Bight would notice.
 */

export type {
  EngineDifficulty,
  EngineError,
  EngineMove,
  EngineMoveOptions,
  EngineService,
  EngineState,
  EngineStatus,
} from './engineTypes';

export {
  DIFFICULTY_ORDER,
  DIFFICULTY_SETTINGS,
  ENGINE_BUILD,
  ENGINE_PACKAGE,
  ENGINE_PACKAGE_VERSION,
  ENGINE_WASM_PATH,
  ENGINE_WORKER_PATH,
} from './engineConfig';

export {
  chooseCandidate,
  collectCandidates,
  scoreOf,
  WEAK_PLAY_POLICY,
  type Candidate,
  type Selection,
  type WeakPlayPolicy,
} from './weakPlay';
export { StockfishEngineService } from './StockfishEngineService';
export { EngineWorkerClient } from './EngineWorkerClient';
export {
  goCommand,
  isUciMove,
  parseBestMove,
  parseIdName,
  parseInfo,
  positionCommand,
  setOptionCommand,
} from './UciParser';

import { StockfishEngineService } from './StockfishEngineService';
import type { EngineService } from './engineTypes';

/**
 * Whether this build can run the engine at all.
 *
 * Checked before offering the mode, so a browser without Workers sees an
 * honest explanation rather than a card that fails when tapped.
 */
export function engineSupported(): boolean {
  return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';
}

let shared: EngineService | null = null;

/**
 * The one engine instance.
 *
 * A second Stockfish would be another 7 MB of WebAssembly and another thread
 * competing for the same phone CPU, so the mode shares one. It is disposed
 * when the game ends — the engine never runs in the background.
 */
export function getEngine(): EngineService {
  shared ??= new StockfishEngineService();
  return shared;
}

/** Shuts the shared engine down and forgets it. */
export async function releaseEngine(): Promise<void> {
  const engine = shared;
  shared = null;
  await engine?.dispose();
}
