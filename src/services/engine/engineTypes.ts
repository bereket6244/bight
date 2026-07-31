/**
 * The engine boundary's vocabulary.
 *
 * Nothing here imports chess.js or any Bight module. The engine is a thing
 * that is handed a position and asked for a move; whether that move is legal,
 * and what it means, is decided elsewhere. Keeping the types this narrow is
 * what makes the engine removable.
 */

/** Where the engine is in its lifecycle. */
export type EngineState =
  /** Nothing has been started. */
  | 'idle'
  /** The worker is loading and handshaking. */
  | 'starting'
  /** Handshaken and idle, ready to search. */
  | 'ready'
  /** A search is running. */
  | 'searching'
  /** Unusable. `error` says why. */
  | 'failed'
  /** Deliberately shut down. */
  | 'disposed';

export interface EngineStatus {
  state: EngineState;
  /** What the engine called itself, once it has said so. */
  name: string | null;
  /** Milliseconds the handshake took, for diagnostics. */
  bootMs: number | null;
  /** Present only in the `failed` state. */
  error: EngineError | null;
}

/**
 * Why the engine is unusable, in terms a user-facing message can be written
 * from. The engine failing must never look like the app breaking.
 */
export interface EngineError {
  kind:
    /** No Worker support at all. */
    | 'unsupported'
    /** The worker script or wasm could not be loaded. */
    | 'load-failed'
    /** The handshake did not complete in time. */
    | 'handshake-timeout'
    /** A search did not return in time. */
    | 'search-timeout'
    /** The worker died. */
    | 'crashed'
    /** The engine returned something that is not a legal move. */
    | 'illegal-move'
    /** Used after dispose. */
    | 'disposed';
  message: string;
}

/** A move as the engine speaks it: long algebraic, e.g. `e2e4`, `e7e8q`. */
export interface EngineMove {
  /** The raw UCI token, exactly as the engine sent it. */
  uci: string;
  from: string;
  to: string;
  /** Promotion piece letter, lowercase, when the move promotes. */
  promotion: string | null;
  /** The engine's intended reply, when it offered one. Never acted upon. */
  ponder: string | null;
  /** How long the search actually took. */
  elapsedMs: number;
}

/**
 * How hard to think. Exactly one of `movetimeMs` or `depth` is required; both
 * may be given, in which case whichever the engine reaches first wins.
 */
export interface EngineMoveOptions {
  fen: string;
  /** Moves played from `fen`, in UCI, so the engine sees repetitions. */
  moves?: readonly string[];
  movetimeMs?: number;
  depth?: number;
  /** Abandon the search and report a timeout after this long. */
  timeoutMs?: number;
}

/**
 * The engine, as the rest of the app is allowed to see it.
 *
 * Every method may reject. A caller that does not handle rejection is a bug:
 * the game must survive the engine failing at any point.
 */
export interface EngineService {
  initialize(): Promise<void>;
  isReady(): boolean;
  newGame(): Promise<void>;
  setPosition(fen: string, moves?: readonly string[]): Promise<void>;
  chooseMove(options: EngineMoveOptions): Promise<EngineMove>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
  getStatus(): EngineStatus;
  /** Applies a difficulty preset. Safe to call between searches. */
  setDifficulty(level: EngineDifficulty): Promise<void>;
}

/**
 * Difficulty as a plain label.
 *
 * Deliberately not an Elo number. Stockfish's own limited-strength range is
 * calibrated against its own search, not against any particular site's rating
 * pool, and the effective strength depends on the time control too. Claiming
 * "1000 Elo" here would be a number we have not measured.
 */
export type EngineDifficulty = 'very-easy' | 'easy' | 'moderate' | 'strong';
