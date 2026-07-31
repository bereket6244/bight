/**
 * Stockfish behind the `EngineService` interface.
 *
 * Every UCI exchange is serialised through one queue. Two overlapping searches
 * would be answered by whichever `bestmove` arrived first, and UCI gives no way
 * to tell them apart, so the fix is not to have two.
 *
 * The engine is never the source of chess truth here. This class hands out a
 * move token and nothing else; whether that token is a legal move in the
 * position is decided by chess.js, in the caller.
 */

import {
  DIFFICULTY_SETTINGS,
  ENGINE_WORKER_PATH,
  HANDSHAKE_TIMEOUT_MS,
  READY_TIMEOUT_MS,
  SEARCH_GRACE_MS,
} from './engineConfig';
import { EngineWorkerClient } from './EngineWorkerClient';
import { goCommand, parseBestMove, parseIdName, positionCommand, setOptionCommand } from './UciParser';
import type {
  EngineDifficulty,
  EngineError,
  EngineMove,
  EngineMoveOptions,
  EngineService,
  EngineStatus,
} from './engineTypes';

export interface StockfishOptions {
  workerPath?: string;
  createWorker?: (url: string) => Worker;
  now?: () => number;
}

export class StockfishEngineService implements EngineService {
  private client: EngineWorkerClient | null = null;
  private status: EngineStatus = { state: 'idle', name: null, bootMs: null, error: null };
  private readonly options: StockfishOptions;
  private readonly now: () => number;

  /** Serialises every exchange, so only one is ever outstanding. */
  private queue: Promise<unknown> = Promise.resolve();
  /** The handshake in flight, so a second caller waits rather than racing it. */
  private starting: Promise<void> | null = null;
  private difficulty: EngineDifficulty = 'moderate';

  constructor(options: StockfishOptions = {}) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
  }

  getStatus(): EngineStatus {
    return { ...this.status };
  }

  isReady(): boolean {
    return this.status.state === 'ready';
  }

  async initialize(): Promise<void> {
    if (this.status.state === 'ready') return;
    if (this.status.state === 'disposed') {
      throw new Error('This engine has been disposed.');
    }
    /*
     * A second caller waits for the handshake in flight rather than returning
     * as though the engine were ready.
     *
     * Returning early was wrong in a way that only showed up in a real game:
     * the caller went straight on to search, and because the handshake's own
     * `uci`/`isready` exchanges are not in the serialising queue, the search
     * collided with them and was refused with "the engine is already waiting
     * for a reply" — ending the game on the user's first move.
     */
    if (this.starting !== null) return this.starting;

    // An injected factory is its own proof that a worker can be made; the
    // global is only required when we are the ones constructing it.
    if (this.options.createWorker === undefined && typeof Worker === 'undefined') {
      this.fail({ kind: 'unsupported', message: 'This browser cannot run Web Workers.' });
      throw new Error('Web Workers are unavailable.');
    }

    this.status = { state: 'starting', name: null, bootMs: null, error: null };

    // Queued like every other exchange, so a caller that races ahead — a user
    // tapping a move while the engine is still booting — waits its turn
    // instead of colliding with the handshake.
    this.starting = this.serialise(() => this.handshake(this.now()));
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async handshake(started: number): Promise<void> {
    try {
      const client = new EngineWorkerClient({
        workerPath: this.options.workerPath ?? ENGINE_WORKER_PATH,
        createWorker: this.options.createWorker,
      });
      client.start();
      this.client = client;

      let name: string | null = null;
      const stopListening = client.onLine((line) => {
        const parsed = parseIdName(line);
        if (parsed !== null) name = parsed;
      });

      await client.request('uci', (line) => line.trim() === 'uciok', HANDSHAKE_TIMEOUT_MS, 'uciok');
      await client.request(
        'isready',
        (line) => line.trim() === 'readyok',
        HANDSHAKE_TIMEOUT_MS,
        'readyok',
      );
      stopListening();

      this.status = {
        state: 'ready',
        name,
        bootMs: Math.round(this.now() - started),
        error: null,
      };

      await this.applyDifficulty(this.difficulty);
    } catch (error) {
      this.fail({
        kind: this.status.state === 'starting' ? 'handshake-timeout' : 'load-failed',
        message: (error as Error).message,
      });
      throw error;
    }
  }

  async newGame(): Promise<void> {
    await this.serialise(async () => {
      const client = this.requireClient();
      // `ucinewgame` has no reply of its own, so `isready` is what fences it.
      client.send('ucinewgame');
      await client.request(
        'isready',
        (line) => line.trim() === 'readyok',
        READY_TIMEOUT_MS,
        'readyok',
      );
    });
  }

  async setPosition(fen: string, moves: readonly string[] = []): Promise<void> {
    await this.serialise(async () => {
      const client = this.requireClient();
      client.send(positionCommand(fen, moves));
      await client.request(
        'isready',
        (line) => line.trim() === 'readyok',
        READY_TIMEOUT_MS,
        'readyok',
      );
    });
  }

  async chooseMove(options: EngineMoveOptions): Promise<EngineMove> {
    return this.serialise(async () => {
      const client = this.requireClient();
      const settings = DIFFICULTY_SETTINGS[this.difficulty];
      const movetimeMs = options.movetimeMs ?? settings.movetimeMs;
      const depth = options.depth ?? settings.depth;
      const timeoutMs = options.timeoutMs ?? movetimeMs + SEARCH_GRACE_MS;

      this.status = { ...this.status, state: 'searching' };
      const started = this.now();

      try {
        client.send(positionCommand(options.fen, options.moves ?? []));
        const line = await client.request(
          goCommand({ movetimeMs, depth }),
          (candidate) => candidate.trim().startsWith('bestmove'),
          timeoutMs,
          'a move',
        );

        const move = parseBestMove(line.trim(), Math.round(this.now() - started));
        if (move === null) {
          // `bestmove (none)` in a finished position, or garbage. Either way
          // it is not a move, and the caller must not be handed one.
          throw new Error(`The engine did not return a move: "${line.trim()}"`);
        }

        this.status = { ...this.status, state: 'ready' };
        return move;
      } catch (error) {
        // A search that timed out leaves the engine thinking. Stop it, so the
        // next request is not answered by this one's leftovers.
        this.status = { ...this.status, state: 'ready' };
        client.abandon();
        try {
          client.send('stop');
        } catch {
          // The worker is gone; dispose will clean up.
        }
        throw error;
      }
    });
  }

  async stop(): Promise<void> {
    const client = this.client;
    if (client === null || !client.running) return;
    client.abandon();
    try {
      client.send('stop');
    } catch {
      // Nothing to stop.
    }
  }

  async setDifficulty(level: EngineDifficulty): Promise<void> {
    this.difficulty = level;
    if (this.status.state === 'idle' || this.status.state === 'failed') return;
    await this.serialise(() => this.applyDifficulty(level));
  }

  async dispose(): Promise<void> {
    this.client?.dispose();
    this.client = null;
    this.status = { state: 'disposed', name: this.status.name, bootMs: this.status.bootMs, error: null };
  }

  /** Lines the engine most recently emitted. For the diagnostics panel. */
  getRecentLines(): readonly string[] {
    return this.client?.getRecentLines() ?? [];
  }

  private async applyDifficulty(level: EngineDifficulty): Promise<void> {
    const client = this.requireClient();
    const settings = DIFFICULTY_SETTINGS[level];
    client.send(setOptionCommand('Skill Level', settings.skill));
    await client.request(
      'isready',
      (line) => line.trim() === 'readyok',
      READY_TIMEOUT_MS,
      'readyok',
    );
  }

  private requireClient(): EngineWorkerClient {
    const client = this.client;
    if (client === null || !client.running) {
      throw new Error('The engine is not running.');
    }
    return client;
  }

  /**
   * Runs `work` after everything already queued, whether that succeeded or
   * not — a failed exchange must not wedge the queue for good.
   */
  private serialise<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private fail(error: EngineError): void {
    this.status = { state: 'failed', name: this.status.name, bootMs: this.status.bootMs, error };
  }
}
