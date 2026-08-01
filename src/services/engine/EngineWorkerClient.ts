/**
 * The thin layer between "a Worker that emits text" and "a request that
 * resolves".
 *
 * UCI is a stream, not a request/response protocol: a `go` produces a burst of
 * `info` lines and eventually one `bestmove`, and nothing in the reply says
 * which `go` it belongs to. This client therefore owns exactly one outstanding
 * expectation at a time and stamps it with a token, so a `bestmove` arriving
 * from a search that has already been abandoned is dropped rather than
 * answering the wrong question.
 *
 * Everything here is about failure: timeouts, crashes and stale replies. The
 * engine is a 7 MB WebAssembly program that can die, and the game it is part
 * of must survive that.
 */

export type EngineLineListener = (line: string) => void;

export interface WorkerClientOptions {
  /** Path the Worker is constructed from, relative to the web root. */
  workerPath: string;
  /** Injected in tests. Defaults to the real `Worker`. */
  createWorker?: (url: string) => Worker;
  /** Injected in tests, so timeouts do not need real time. */
  now?: () => number;
}

interface Expectation {
  token: number;
  matches: (line: string) => boolean;
  resolve: (line: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class EngineWorkerClient {
  private worker: Worker | null = null;
  private expectation: Expectation | null = null;
  private tokenCounter = 0;
  private disposed = false;
  private readonly listeners = new Set<EngineLineListener>();
  private readonly options: WorkerClientOptions;

  /** Every line received, capped, for diagnostics after a failure. */
  private readonly recentLines: string[] = [];
  private static readonly RECENT_LIMIT = 200;

  constructor(options: WorkerClientOptions) {
    this.options = options;
  }

  get running(): boolean {
    return this.worker !== null && !this.disposed;
  }

  /**
   * Starts the Worker.
   *
   * Rejects rather than throwing synchronously, because a missing asset shows
   * up as an `error` event rather than a constructor throw in some browsers.
   */
  start(): void {
    if (this.disposed) throw new Error('This engine client has been disposed.');
    if (this.worker !== null) return;

    const create = this.options.createWorker ?? ((url: string) => new Worker(url));
    const worker = create(this.options.workerPath);

    worker.addEventListener('message', (event: MessageEvent) => {
      this.handleLine(typeof event.data === 'string' ? event.data : String(event.data));
    });

    // A worker that dies takes the outstanding request with it, with an error
    // that says what happened rather than a silent hang.
    worker.addEventListener('error', (event: ErrorEvent) => {
      this.failOutstanding(
        new Error(`The engine worker failed: ${event.message || 'unknown error'}`),
      );
    });

    this.worker = worker;
  }

  /** Registers a listener for every line, used for diagnostics and logging. */
  onLine(listener: EngineLineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(command: string): void {
    if (this.worker === null) throw new Error('The engine worker is not running.');
    this.worker.postMessage(command);
  }

  /**
   * Sends a command and waits for the first line satisfying `matches`.
   *
   * Only one wait may be outstanding: UCI has no request ids, so a second
   * concurrent wait could be answered by the first one's output. Callers
   * serialise through this method rather than around it.
   */
  async request(
    command: string | null,
    matches: (line: string) => boolean,
    timeoutMs: number,
    what: string,
  ): Promise<string> {
    if (this.disposed) throw new Error('This engine client has been disposed.');
    if (this.worker === null) throw new Error('The engine worker is not running.');
    if (this.expectation !== null) {
      throw new Error('The engine is already waiting for a reply.');
    }

    this.tokenCounter += 1;
    const token = this.tokenCounter;

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Abandon it. A late reply will be dropped by the token check.
        if (this.expectation?.token === token) this.expectation = null;
        reject(new Error(`The engine did not respond with ${what} in time.`));
      }, timeoutMs);

      this.expectation = { token, matches, resolve, reject, timer };

      if (command !== null) {
        try {
          this.send(command);
        } catch (error) {
          clearTimeout(timer);
          this.expectation = null;
          reject(error as Error);
        }
      }
    });
  }

  /** Drops any outstanding expectation without killing the worker. */
  abandon(): void {
    if (this.expectation === null) return;
    clearTimeout(this.expectation.timer);
    this.expectation = null;
  }

  dispose(): void {
    this.disposed = true;
    this.failOutstanding(new Error('The engine was shut down.'));
    if (this.worker !== null) {
      try {
        // Ask politely first so the engine can stop its search, then insist.
        this.worker.postMessage('quit');
      } catch {
        // Already dead; terminating is enough.
      }
      this.worker.terminate();
      this.worker = null;
    }
    this.listeners.clear();
  }

  /** The last lines received, oldest first. For error reports. */
  getRecentLines(): readonly string[] {
    return [...this.recentLines];
  }

  private handleLine(line: string): void {
    this.recentLines.push(line);
    if (this.recentLines.length > EngineWorkerClient.RECENT_LIMIT) this.recentLines.shift();

    for (const listener of this.listeners) {
      try {
        listener(line);
      } catch {
        // A broken listener must not break the engine.
      }
    }

    const expectation = this.expectation;
    if (expectation === null) return;
    if (!expectation.matches(line)) return;

    clearTimeout(expectation.timer);
    this.expectation = null;
    expectation.resolve(line);
  }

  private failOutstanding(error: Error): void {
    const expectation = this.expectation;
    if (expectation === null) return;
    clearTimeout(expectation.timer);
    this.expectation = null;
    expectation.reject(error);
  }
}
