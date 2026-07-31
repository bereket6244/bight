/**
 * The engine boundary, tested without an engine.
 *
 * UCI parsing is pure text handling, and the service's job is almost entirely
 * about failure — timeouts, crashes, stale replies — which a real engine is
 * the worst possible way to reproduce. A scripted fake worker produces those
 * on demand and deterministically.
 *
 * That the real engine works is a separate question, answered in a real
 * browser by `scripts/engine-smoke.mjs`.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  goCommand,
  isUciMove,
  parseBestMove,
  parseIdName,
  parseInfo,
  positionCommand,
  setOptionCommand,
} from './UciParser';
import { EngineWorkerClient } from './EngineWorkerClient';
import { StockfishEngineService } from './StockfishEngineService';

/* ------------------------------------------------------------------ *
 * A scripted worker
 * ------------------------------------------------------------------ */

type Reply = (command: string, emit: (line: string) => void) => void;

/**
 * A Worker that answers UCI from a script.
 *
 * Replies are delivered asynchronously, as a real worker's would be, so any
 * accidental reliance on synchronous ordering shows up here.
 */
class FakeWorker implements Worker {
  onmessage: ((this: Worker, ev: MessageEvent) => unknown) | null = null;
  onmessageerror: ((this: Worker, ev: MessageEvent) => unknown) | null = null;
  onerror: ((this: AbstractWorker, ev: ErrorEvent) => unknown) | null = null;

  readonly sent: string[] = [];
  terminated = false;

  private readonly messageListeners = new Set<(event: MessageEvent) => void>();
  private readonly errorListeners = new Set<(event: ErrorEvent) => void>();

  constructor(private readonly reply: Reply) {}

  postMessage(command: unknown): void {
    const text = String(command);
    this.sent.push(text);
    if (this.terminated) return;
    this.reply(text, (line) => this.emit(line));
  }

  emit(line: string): void {
    queueMicrotask(() => {
      if (this.terminated) return;
      const event = { data: line } as MessageEvent;
      for (const listener of this.messageListeners) listener(event);
    });
  }

  crash(message = 'worker died'): void {
    const event = { message } as ErrorEvent;
    for (const listener of this.errorListeners) listener(event);
  }

  terminate(): void {
    this.terminated = true;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') this.messageListeners.add(listener as (e: MessageEvent) => void);
    if (type === 'error') this.errorListeners.add(listener as (e: ErrorEvent) => void);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') this.messageListeners.delete(listener as (e: MessageEvent) => void);
    if (type === 'error') this.errorListeners.delete(listener as (e: ErrorEvent) => void);
  }

  dispatchEvent(): boolean {
    return true;
  }
}

/** A worker that handshakes properly and answers every `go` with `move`. */
function politeWorker(move = 'e2e4'): FakeWorker {
  const worker: FakeWorker = new FakeWorker((command, emit) => {
    if (command === 'uci') {
      emit('id name Stockfish 18 Lite WASM');
      emit('option name Skill Level type spin default 20 min 0 max 20');
      emit('uciok');
    } else if (command === 'isready') {
      emit('readyok');
    } else if (command.startsWith('go')) {
      emit('info depth 1 score cp 20 pv e2e4');
      emit(`bestmove ${move} ponder e7e5`);
    }
  });
  return worker;
}

function serviceWith(worker: FakeWorker): StockfishEngineService {
  return new StockfishEngineService({ createWorker: () => worker as unknown as Worker });
}

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

describe('parseBestMove', () => {
  it('reads a plain move', () => {
    const move = parseBestMove('bestmove e2e4', 120);
    expect(move).toEqual({
      uci: 'e2e4',
      from: 'e2',
      to: 'e4',
      promotion: null,
      ponder: null,
      elapsedMs: 120,
    });
  });

  it('reads a promotion', () => {
    expect(parseBestMove('bestmove e7e8q')?.promotion).toBe('q');
    expect(parseBestMove('bestmove a2a1N')?.promotion).toBe('n');
  });

  it('reads the ponder move without acting on it', () => {
    expect(parseBestMove('bestmove d2d4 ponder d7d5')?.ponder).toBe('d7d5');
  });

  it('returns null for "bestmove (none)" in a finished position', () => {
    expect(parseBestMove('bestmove (none)')).toBeNull();
    expect(parseBestMove('bestmove 0000')).toBeNull();
  });

  it('returns null rather than throwing on garbage', () => {
    for (const line of ['', '   ', 'info depth 3', 'bestmove', 'bestmove xyz', 'bestmove e2e']) {
      expect(parseBestMove(line), line).toBeNull();
    }
  });

  it('ignores a ponder token that is not a move', () => {
    expect(parseBestMove('bestmove e2e4 ponder (none)')?.ponder).toBeNull();
  });
});

describe('isUciMove', () => {
  it('accepts real moves and rejects everything else', () => {
    for (const good of ['e2e4', 'a1h8', 'e7e8q', 'b2b1r']) expect(isUciMove(good), good).toBe(true);
    for (const bad of ['', 'e2', 'e2e9', 'i1a2', '(none)', '0000', 'e2e4x', 'Nf3']) {
      expect(isUciMove(bad), bad).toBe(false);
    }
  });
});

describe('parseInfo', () => {
  it('reads depth, score and the principal variation', () => {
    const info = parseInfo('info depth 12 seldepth 15 multipv 1 score cp 34 nodes 5000 time 210 pv e2e4 e7e5 g1f3');
    expect(info).toMatchObject({
      depth: 12,
      multipv: 1,
      scoreCp: 34,
      nodes: 5000,
      timeMs: 210,
      pv: ['e2e4', 'e7e5', 'g1f3'],
    });
  });

  it('reads a mate score', () => {
    expect(parseInfo('info depth 5 score mate -2 pv a1a8')).toMatchObject({ scoreMate: -2 });
  });

  it('ignores engine chatter and non-info lines', () => {
    expect(parseInfo('info string NNUE evaluation using nn-9067e33176e')).toBeNull();
    expect(parseInfo('bestmove e2e4')).toBeNull();
    expect(parseInfo('uciok')).toBeNull();
  });

  it('survives a truncated line', () => {
    expect(parseInfo('info depth')).toEqual({});
    expect(parseInfo('info score cp')).toEqual({});
  });
});

describe('command building', () => {
  it('builds position commands', () => {
    expect(positionCommand('startpos')).toBe('position startpos');
    expect(positionCommand('startpos', ['e2e4', 'e7e5'])).toBe(
      'position startpos moves e2e4 e7e5',
    );
    expect(positionCommand('8/8/8/8/8/8/8/K6k w - - 0 1')).toBe(
      'position fen 8/8/8/8/8/8/8/K6k w - - 0 1',
    );
  });

  it('never builds an unlimited search', () => {
    // A bare `go` searches until stopped, which would pin the CPU forever.
    expect(goCommand({})).toContain('movetime');
    expect(goCommand({ depth: 8 })).toBe('go depth 8');
    expect(goCommand({ movetimeMs: 500 })).toBe('go movetime 500');
    expect(goCommand({ depth: 8, movetimeMs: 500 })).toBe('go depth 8 movetime 500');
  });

  it('builds setoption commands', () => {
    expect(setOptionCommand('Skill Level', 3)).toBe('setoption name Skill Level value 3');
  });

  it('reads the engine name', () => {
    expect(parseIdName('id name Stockfish 18 Lite WASM')).toBe('Stockfish 18 Lite WASM');
    expect(parseIdName('id author the Stockfish developers')).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * The worker client
 * ------------------------------------------------------------------ */

describe('EngineWorkerClient', () => {
  it('resolves the first matching line', async () => {
    const worker = politeWorker();
    const client = new EngineWorkerClient({
      workerPath: 'x',
      createWorker: () => worker as unknown as Worker,
    });
    client.start();

    const line = await client.request('uci', (l) => l === 'uciok', 1000, 'uciok');
    expect(line).toBe('uciok');
    client.dispose();
  });

  it('times out rather than hanging when nothing answers', async () => {
    const worker = new FakeWorker(() => undefined);
    const client = new EngineWorkerClient({
      workerPath: 'x',
      createWorker: () => worker as unknown as Worker,
    });
    client.start();

    await expect(
      client.request('uci', (l) => l === 'uciok', 20, 'uciok'),
    ).rejects.toThrow(/did not respond/);
    client.dispose();
  });

  it('drops a reply that arrives after its request was abandoned', async () => {
    let emitLate: ((line: string) => void) | null = null;
    const worker = new FakeWorker((command, emit) => {
      if (command.startsWith('go')) emitLate = emit;
    });
    const client = new EngineWorkerClient({
      workerPath: 'x',
      createWorker: () => worker as unknown as Worker,
    });
    client.start();

    const abandoned = client.request('go movetime 10', (l) => l.startsWith('bestmove'), 20, 'a move');
    await expect(abandoned).rejects.toThrow(/did not respond/);

    // The late answer must not resolve anything, and must not throw.
    expect(() => emitLate?.('bestmove e2e4')).not.toThrow();

    // A fresh request still works.
    const next = client.request('isready', (l) => l === 'readyok', 1000, 'readyok');
    worker.emit('readyok');
    await expect(next).resolves.toBe('readyok');
    client.dispose();
  });

  it('refuses two overlapping requests', async () => {
    const worker = new FakeWorker(() => undefined);
    const client = new EngineWorkerClient({
      workerPath: 'x',
      createWorker: () => worker as unknown as Worker,
    });
    client.start();

    const first = client.request('a', () => false, 50, 'x');
    await expect(client.request('b', () => false, 50, 'y')).rejects.toThrow(/already waiting/);
    await expect(first).rejects.toThrow();
    client.dispose();
  });

  it('fails the outstanding request when the worker crashes', async () => {
    const worker = new FakeWorker(() => undefined);
    const client = new EngineWorkerClient({
      workerPath: 'x',
      createWorker: () => worker as unknown as Worker,
    });
    client.start();

    const pending = client.request('go', (l) => l.startsWith('bestmove'), 5000, 'a move');
    worker.crash('out of memory');
    await expect(pending).rejects.toThrow(/out of memory/);
    client.dispose();
  });

  it('sends quit and terminates on dispose', () => {
    const worker = politeWorker();
    const client = new EngineWorkerClient({
      workerPath: 'x',
      createWorker: () => worker as unknown as Worker,
    });
    client.start();
    client.dispose();

    expect(worker.sent).toContain('quit');
    expect(worker.terminated).toBe(true);
    expect(client.running).toBe(false);
  });

  it('keeps a bounded transcript for diagnostics', async () => {
    const worker = politeWorker();
    const client = new EngineWorkerClient({
      workerPath: 'x',
      createWorker: () => worker as unknown as Worker,
    });
    client.start();
    await client.request('uci', (l) => l === 'uciok', 1000, 'uciok');

    expect(client.getRecentLines()).toContain('uciok');
    expect(client.getRecentLines().length).toBeLessThanOrEqual(200);
    client.dispose();
  });
});

/* ------------------------------------------------------------------ *
 * The service
 * ------------------------------------------------------------------ */

describe('StockfishEngineService', () => {
  it('handshakes and reports itself ready', async () => {
    const worker = politeWorker();
    const engine = serviceWith(worker);

    expect(engine.getStatus().state).toBe('idle');
    await engine.initialize();

    expect(engine.isReady()).toBe(true);
    expect(engine.getStatus().name).toBe('Stockfish 18 Lite WASM');
    expect(worker.sent).toContain('uci');
    expect(worker.sent).toContain('isready');
    await engine.dispose();
  });

  it('returns a parsed move', async () => {
    const worker = politeWorker('d2d4');
    const engine = serviceWith(worker);
    await engine.initialize();

    const move = await engine.chooseMove({ fen: 'startpos', movetimeMs: 10 });
    expect(move.uci).toBe('d2d4');
    expect(move.from).toBe('d2');
    expect(move.to).toBe('d4');
    await engine.dispose();
  });

  it('sets the position before every search', async () => {
    const worker = politeWorker();
    const engine = serviceWith(worker);
    await engine.initialize();

    await engine.chooseMove({ fen: 'startpos', moves: ['e2e4'], movetimeMs: 10 });
    const positions = worker.sent.filter((c) => c.startsWith('position'));
    expect(positions).toContain('position startpos moves e2e4');

    // And again for the next one, rather than relying on remembered state.
    await engine.chooseMove({ fen: 'startpos', moves: ['e2e4', 'e7e5'], movetimeMs: 10 });
    expect(worker.sent.filter((c) => c.startsWith('position'))).toHaveLength(2);
    await engine.dispose();
  });

  it('serialises overlapping searches instead of confusing their replies', async () => {
    const worker = politeWorker('a2a3');
    const engine = serviceWith(worker);
    await engine.initialize();

    const both = await Promise.all([
      engine.chooseMove({ fen: 'startpos', movetimeMs: 10 }),
      engine.chooseMove({ fen: 'startpos', movetimeMs: 10 }),
    ]);

    expect(both[0].uci).toBe('a2a3');
    expect(both[1].uci).toBe('a2a3');
    expect(worker.sent.filter((c) => c.startsWith('go'))).toHaveLength(2);
    await engine.dispose();
  });

  it('rejects, and stays usable, when a search times out', async () => {
    let searches = 0;
    const worker: FakeWorker = new FakeWorker((command, emit) => {
      if (command === 'uci') {
        emit('id name Test');
        emit('uciok');
      } else if (command === 'isready') {
        emit('readyok');
      } else if (command.startsWith('go')) {
        searches += 1;
        // The first search never answers; later ones do.
        if (searches > 1) emit('bestmove c2c4');
      }
    });

    const engine = serviceWith(worker);
    await engine.initialize();

    await expect(
      engine.chooseMove({ fen: 'startpos', movetimeMs: 5, timeoutMs: 20 }),
    ).rejects.toThrow(/did not respond/);

    // It stopped the abandoned search rather than leaving it running.
    expect(worker.sent).toContain('stop');

    // And the engine still works.
    const move = await engine.chooseMove({ fen: 'startpos', movetimeMs: 5, timeoutMs: 500 });
    expect(move.uci).toBe('c2c4');
    await engine.dispose();
  });

  it('treats "bestmove (none)" as no move rather than as a move', async () => {
    const worker = new FakeWorker((command, emit) => {
      if (command === 'uci') {
        emit('uciok');
      } else if (command === 'isready') emit('readyok');
      else if (command.startsWith('go')) emit('bestmove (none)');
    });
    const engine = serviceWith(worker);
    await engine.initialize();

    await expect(engine.chooseMove({ fen: 'startpos', movetimeMs: 10 })).rejects.toThrow(
      /did not return a move/,
    );
    await engine.dispose();
  });

  it('fences ucinewgame with isready', async () => {
    const worker = politeWorker();
    const engine = serviceWith(worker);
    await engine.initialize();

    await engine.newGame();
    const newGameAt = worker.sent.indexOf('ucinewgame');
    expect(newGameAt).toBeGreaterThan(-1);
    expect(worker.sent.slice(newGameAt)).toContain('isready');
    await engine.dispose();
  });

  it('applies a difficulty as a Skill Level', async () => {
    const worker = politeWorker();
    const engine = serviceWith(worker);
    await engine.initialize();

    await engine.setDifficulty('very-easy');
    expect(worker.sent).toContain('setoption name Skill Level value 0');

    await engine.setDifficulty('strong');
    expect(worker.sent).toContain('setoption name Skill Level value 20');
    await engine.dispose();
  });

  it('reports a failed handshake instead of hanging', async () => {
    const silent = new FakeWorker(() => undefined);
    const engine = new StockfishEngineService({
      createWorker: () => silent as unknown as Worker,
    });

    // A real handshake timeout is 30s; this asserts the failure path, driven
    // by a worker that answers nothing, with fake timers to keep it instant.
    vi.useFakeTimers();
    const attempt = engine.initialize();
    const assertion = expect(attempt).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(31_000);
    await assertion;
    vi.useRealTimers();

    expect(engine.isReady()).toBe(false);
    expect(engine.getStatus().state).toBe('failed');
    expect(engine.getStatus().error?.kind).toBe('handshake-timeout');
    await engine.dispose();
  });

  it('shuts the worker down on dispose and stays shut', async () => {
    const worker = politeWorker();
    const engine = serviceWith(worker);
    await engine.initialize();
    await engine.dispose();

    expect(worker.terminated).toBe(true);
    expect(engine.getStatus().state).toBe('disposed');
    await expect(engine.initialize()).rejects.toThrow(/disposed/);
  });

  it('does not leave a search running when it is stopped', async () => {
    const worker = politeWorker();
    const engine = serviceWith(worker);
    await engine.initialize();
    await engine.stop();
    expect(worker.sent).toContain('stop');
    await engine.dispose();
  });
});

describe('a caller that races the handshake', () => {
  /**
   * A worker that takes its time answering `uci`, so a search can be issued
   * while the engine is still booting.
   */
  function slowWorker(): FakeWorker & { finishBoot: () => void } {
    // `finishBoot` may be called before or after `uci` is sent — the service
    // defers its work by a microtask — so both orders are handled.
    let released = false;
    let answerUci: (() => void) | null = null;

    const worker = new FakeWorker((command, emit) => {
      if (command === 'uci') {
        answerUci = () => {
          emit('id name Slow');
          emit('uciok');
        };
        if (released) answerUci();
      } else if (command === 'isready') emit('readyok');
      else if (command.startsWith('go')) emit('bestmove e2e4');
    }) as FakeWorker & { finishBoot: () => void };

    worker.finishBoot = () => {
      released = true;
      answerUci?.();
    };
    return worker;
  }

  it('queues a search issued mid-handshake instead of colliding with it', async () => {
    // This is the bug a real game found: the board went live before the engine
    // finished booting, the user moved, and the search was refused with "the
    // engine is already waiting for a reply" — ending the game on move one.
    const worker = slowWorker();
    const engine = serviceWith(worker);

    const booting = engine.initialize();
    const searching = engine.chooseMove({ fen: 'startpos', movetimeMs: 10 });

    worker.finishBoot();
    await booting;

    const move = await searching;
    expect(move.uci).toBe('e2e4');
    await engine.dispose();
  });

  it('lets a second initialize wait for the first rather than reporting ready', async () => {
    const worker = slowWorker();
    const engine = serviceWith(worker);

    const first = engine.initialize();
    const second = engine.initialize();
    expect(engine.isReady()).toBe(false);

    worker.finishBoot();
    await Promise.all([first, second]);

    expect(engine.isReady()).toBe(true);
    // One handshake, not two.
    expect(worker.sent.filter((c) => c === 'uci')).toHaveLength(1);
    await engine.dispose();
  });
});
