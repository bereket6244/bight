/**
 * Blindfold vs Computer.
 *
 * This screen is the only place in Bight that touches the engine, and it is
 * deliberately separate from `SessionScreen`: a game is not a stream of
 * questions, and forcing it into that shape would have put engine failure
 * modes inside the machinery every other mode depends on.
 *
 * The engine is started when a game starts and disposed when it ends or the
 * screen unmounts. It never runs in the background.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board, type SquareMark } from '../components/Board';
import { ChessPiece } from '../components/Pieces';
import {
  applyEngineMove,
  capturedBy,
  clearRejection,
  describeResult,
  legalDestinations,
  moveListText,
  needsPromotion,
  playUserMove,
  resign,
  startGame,
  type EngineGameState,
} from '../../core/engineGame/game';
import {
  DIFFICULTY_ORDER,
  engineSupported,
  getEngine,
  releaseEngine,
  WEAK_PLAY_POLICY,
  type EngineDifficulty,
} from '../../services/engine';
import type { PieceColor, PieceType, SquareName } from '../../core/chess/types';
import { speak } from '../../services/speech';
import { vibrate } from '../../services/haptics';
import { playTone } from '../../services/sound';
import { useApp } from '../state/AppContext';
import {
  buildSave,
  describeSave,
  restoreSave,
  SAVED_GAME_KEY,
  type RestoredGame,
} from '../../core/engineGame/savedGame';
import { APP_VERSION } from '../../core/version';

/** How long a rejected move stays red. */
const FLASH_MS = 420;

/**
 * Shortest time the computer's turn is allowed to take, from the user's move
 * to the reply appearing.
 *
 * This is not an artificial slowdown of the search: the wait runs alongside
 * it, so a level that genuinely thinks for a second is unaffected and only an
 * implausibly fast reply is held. It exists because a move that lands in 40 ms
 * reads as nothing having happened at all — which is exactly what a real
 * device reported. 800 ms is long enough to register a state change and short
 * enough not to feel like waiting.
 */
export const MIN_THINKING_MS = 800;

/** How much of the board the user gets during the game. */
type GameVisibility = 'always' | 'first-moves' | 'never';

const VISIBILITY_LABELS: Record<GameVisibility, string> = {
  always: 'Always',
  'first-moves': 'First 6 plies',
  never: 'Never',
};

/**
 * How much of the move list the user keeps.
 *
 * The full score sheet was previously shown unconditionally, which quietly
 * removed most of the difficulty: remembering the position is easy when every
 * move is still on screen.
 */
type GameHistoryMode = 'full' | 'latest-only' | 'hidden' | 'hidden-reveal';

const HISTORY_LABELS: Record<GameHistoryMode, string> = {
  full: 'All moves',
  'latest-only': 'Last move',
  hidden: 'Hidden',
  'hidden-reveal': 'Hidden, revealable',
};

export interface EngineGameScreenProps {
  onExit: () => void;
  /** Injected in tests so the screen can be driven without real Stockfish. */
  engineFactory?: typeof getEngine;
}

type Phase = 'setup' | 'playing' | 'over';

export function EngineGameScreen({ onExit, engineFactory = getEngine }: EngineGameScreenProps) {
  // Sound and haptics follow the app-wide preferences, as in every other mode.
  const { preferences } = useApp();
  const [phase, setPhase] = useState<Phase>('setup');
  const [side, setSide] = useState<PieceColor>('white');
  const [difficulty, setDifficulty] = useState<EngineDifficulty>('easy');
  const [visibility, setVisibility] = useState<GameVisibility>('first-moves');
  /*
   * How much of the move list the user keeps.
   *
   * Defaults to `latest-only`: showing the whole score sheet is not blindfold
   * play, and showing nothing at all makes a first game unreasonably hard. The
   * latest move is always available long enough to perceive the reply unless
   * the user deliberately chooses otherwise.
   */
  const [history, setHistory] = useState<GameHistoryMode>('latest-only');
  /** True once the user has revealed a hidden history this game. */
  const [historyRevealed, setHistoryRevealed] = useState(false);
  const [speakMoves, setSpeakMoves] = useState(false);
  /** A saved unfinished game found on entry, offered as Resume. */
  const [resumable, setResumable] = useState<RestoredGame | null>(null);

  const [game, setGame] = useState<EngineGameState | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  /** True while the engine boots. Input is refused until it is ready. */
  const [starting, setStarting] = useState(false);
  const [engineName, setEngineName] = useState<string | null>(null);

  const [origin, setOrigin] = useState<SquareName | null>(null);
  const [promotion, setPromotion] = useState<{ from: SquareName; to: SquareName } | null>(null);

  const engineRef = useRef<ReturnType<typeof getEngine> | null>(null);
  /** Increments per computer turn, so a stale reply can be recognised. */
  const turnToken = useRef(0);
  /** The presentation delay in flight, cleared on unmount and on abandon. */
  const thinkingTimer = useRef<number | null>(null);
  /** True when backgrounding cut a computer turn short and it is still owed. */
  const interruptedTurn = useRef(false);
  /** The live game, so callbacks can read it without depending on it. */
  const gameRef = useRef<EngineGameState | null>(null);
  gameRef.current = game;

  /*
   * An injected engine is its own proof that one can run here, so the
   * environment check only applies when we are the ones about to build a
   * Worker. Same rule as `StockfishEngineService`, for the same reason.
   */
  const supported = useMemo(
    () => engineFactory !== getEngine || engineSupported(),
    [engineFactory],
  );

  /*
   * An unfinished game is written after every move and replayed on the way
   * back in. Only the moves are stored; the position is rebuilt through
   * chess.js, so a save can never disagree with the rules.
   */
  useEffect(() => {
    if (game === null) return;
    const record = buildSave({
      state: game,
      difficulty,
      visibility,
      history,
      speakMoves,
      appVersion: APP_VERSION,
    });
    try {
      if (record === null) window.localStorage.removeItem(SAVED_GAME_KEY);
      else window.localStorage.setItem(SAVED_GAME_KEY, JSON.stringify(record));
    } catch {
      // Storage may be full or blocked. Losing the ability to resume is not
      // worth interrupting a game over.
    }
  }, [difficulty, game, history, speakMoves, visibility]);

  // Look for a resumable game once, on entry.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_GAME_KEY);
      if (raw === null) return;
      const restored = restoreSave(JSON.parse(raw));
      if (restored === null) {
        // Unreadable, from an older format, or already finished. Discard it
        // rather than trying to interpret it.
        window.localStorage.removeItem(SAVED_GAME_KEY);
        return;
      }
      setResumable(restored);
    } catch {
      // A corrupt save must not stop the screen from opening.
    }
  }, []);

  /*
   * The engine is shut down when this screen goes away, whatever the reason:
   * navigating out, an error boundary catching, or the game ending. It is the
   * instance this screen actually used that gets disposed, not merely the
   * shared one — those are the same object in the app, but not when an engine
   * is injected, and "dispose what you started" is the rule that holds either
   * way.
   */
  useEffect(() => {
    return () => {
      void engineRef.current?.dispose();
      void releaseEngine();
    };
  }, []);


  /**
   * Invalidates the computer turn in flight, if any.
   *
   * Called wherever the game the turn belongs to stops being the game on
   * screen: resigning, retrying, starting again, unmounting. The token bump
   * makes any reply still coming recognisably stale, and the timer clear stops
   * a presentation delay firing into a game that no longer exists.
   */
  const abandonEngineTurn = useCallback(() => {
    turnToken.current += 1;
    if (thinkingTimer.current !== null) {
      window.clearTimeout(thinkingTimer.current);
      thinkingTimer.current = null;
    }
    setThinking(false);
    void engineRef.current?.stop();
  }, []);

  const failGame = useCallback((message: string) => {
    setEngineError(message);
    setThinking(false);
    setGame((current) =>
      current === null || current.result.kind !== 'in-progress'
        ? current
        : { ...current, result: { kind: 'abandoned', reason: message } },
    );
    setPhase('over');
  }, []);

  /**
   * Asks the engine for a move and applies it, or stops the game.
   *
   * The reply is held back until `MIN_THINKING_MS` has passed, because a
   * computer that answers in 40 ms is indistinguishable from one that did not
   * answer at all — reported from a real device as "I cannot tell that a move
   * occurred". The wait runs *concurrently* with the search rather than after
   * it, so a slow level is not slowed further; only an implausibly fast one is
   * held.
   */
  const takeEngineTurn = useCallback(
    async (state: EngineGameState) => {
      const engine = engineRef.current;
      if (engine === null) return;

      // Every turn carries a token. A reply belonging to an abandoned turn —
      // after resign, retry, a new game or unmount — is dropped rather than
      // played onto a position it was never computed for.
      turnToken.current += 1;
      const token = turnToken.current;
      const stale = (): boolean => turnToken.current !== token;

      setThinking(true);
      const startedAt = Date.now();

      try {
        const move = await engine.chooseMove({ fen: 'startpos', moves: state.uciHistory });
        if (stale()) return;

        const elapsed = Date.now() - startedAt;
        if (elapsed < MIN_THINKING_MS) {
          await new Promise<void>((resolve) => {
            thinkingTimer.current = window.setTimeout(resolve, MIN_THINKING_MS - elapsed);
          });
        }
        if (stale()) return;

        const outcome = applyEngineMove(state, move.uci);
        if (!outcome.ok) {
          // chess.js refused it. The engine is not allowed to be right about
          // this, so the game stops rather than continuing from a position
          // that cannot be reproduced.
          failGame(outcome.reason);
          return;
        }

        // Position, move list, last-move marks and turn indicator all come
        // from one state value, so they can never disagree with each other.
        setThinking(false);
        setGame(outcome.state);

        const played = outcome.state.history[outcome.state.history.length - 1];
        if (played !== undefined) {
          if (preferences.sound) playTone('correct');
          if (speakMoves) void speak(played.san);
        }
        if (outcome.state.result.kind !== 'in-progress') setPhase('over');
      } catch (error) {
        if (stale()) return;
        failGame(`The computer could not find a move: ${(error as Error).message}`);
      }
    },
    [failGame, preferences.sound, speakMoves],
  );

  const beginGame = useCallback(async () => {
    setEngineError(null);
    const fresh = startGame(side);
    setGame(fresh);
    setPhase('playing');
    setStarting(true);

    try {
      const engine = engineFactory();
      engineRef.current = engine;
      await engine.initialize();
      setEngineName(engine.getStatus().name);
      await engine.setDifficulty(difficulty);
      await engine.newGame();
      setStarting(false);

      // Playing Black means the engine opens.
      if (fresh.turn !== fresh.userSide) await takeEngineTurn(fresh);
    } catch (error) {
      failGame(
        `The chess engine could not start: ${(error as Error).message}. ` +
          'Every other mode is unaffected.',
      );
    }
  }, [difficulty, engineFactory, failGame, side, takeEngineTurn]);

  /*
   * Backgrounding and returning.
   *
   * A phone must not keep a chess engine searching for someone who has
   * switched away. Stopping the search alone was not enough, though: it left
   * `thinking` true with nothing running, so the game came back showing
   * "Computer thinking…" for ever and the user could neither move nor wait.
   *
   * On hide: abandon the turn, and remember that the computer still owes a
   * move. On show: play that move, once. Never twice, never silently changing
   * whose turn it is, and never losing the move the user already made.
   */
  useEffect(() => {
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        const current = gameRef.current;
        const owed =
          current !== null &&
          current.result.kind === 'in-progress' &&
          current.turn !== current.userSide;
        if (owed) interruptedTurn.current = true;
        abandonEngineTurn();
        return;
      }

      // Back in the foreground.
      if (!interruptedTurn.current) return;
      interruptedTurn.current = false;

      const current = gameRef.current;
      if (current === null || current.result.kind !== 'in-progress') return;
      if (current.turn === current.userSide) return;
      if (engineRef.current === null) return;

      void takeEngineTurn(current);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [abandonEngineTurn, takeEngineTurn]);

  /*
   * Any presentation delay in flight is dropped when the screen goes away.
   * Bumping the token first means a reply that arrives during teardown is
   * recognised as stale and never applied.
   */
  useEffect(() => {
    return () => {
      turnToken.current += 1;
      if (thinkingTimer.current !== null) window.clearTimeout(thinkingTimer.current);
    };
  }, []);

  // A rejected move flashes and clears itself.
  useEffect(() => {
    if (game?.rejection == null) return;
    if (preferences.haptics) vibrate('error');
    if (preferences.sound) playTone('wrong');
    const timer = window.setTimeout(() => {
      setGame((current) => (current === null ? current : clearRejection(current)));
    }, FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [game?.rejection, preferences.haptics, preferences.sound]);

  /*
   * The engine turn is started here rather than inside the `setGame` updater.
   *
   * React may invoke a state updater more than once — a render that gets
   * interrupted and restarted replays it — so an updater must be pure. Asking
   * the engine for a move from inside one produced two overlapping searches,
   * and the second was refused with "the engine is already waiting for a
   * reply", ending the game on the user's first move. The current game comes
   * from a ref so this stays correct without depending on `game` and
   * re-creating the callback after every move.
   */
  const commitMove = useCallback(
    (from: SquareName, to: SquareName, piece?: 'q' | 'r' | 'b' | 'n') => {
      const current = gameRef.current;
      if (current === null) return;

      const next = playUserMove(current, { from, to, promotion: piece });
      setGame(next);
      setOrigin(null);
      setPromotion(null);

      // Nothing was played: an illegal move, already flashed by `next`.
      if (next.history.length === current.history.length) return;

      if (preferences.sound) playTone('correct');

      // The user's own move is spoken too. Only the engine's was, which made
      // "read moves aloud" a half-feature: an illegal attempt is never spoken,
      // because it never became a move.
      const played = next.history[next.history.length - 1];
      if (played !== undefined && speakMoves) void speak(played.san);

      if (next.result.kind !== 'in-progress') setPhase('over');
      else void takeEngineTurn(next);
    },
    [preferences.sound, speakMoves, takeEngineTurn],
  );

  /**
   * Picks a saved game back up.
   *
   * The settings come from the save, so the game resumes as it was played
   * rather than as the setup screen currently reads. If the computer owed a
   * move when the game was put down, exactly one is requested.
   */
  const resumeGame = useCallback(
    async (restored: RestoredGame) => {
      setEngineError(null);
      setResumable(null);
      setSide(restored.saved.userSide);
      setDifficulty(restored.saved.difficulty as EngineDifficulty);
      setVisibility(restored.saved.visibility as GameVisibility);
      setHistory(restored.saved.history as GameHistoryMode);
      setSpeakMoves(restored.saved.speakMoves);
      setHistoryRevealed(false);
      setGame(restored.state);
      setPhase('playing');
      setStarting(true);

      try {
        const engine = engineFactory();
        engineRef.current = engine;
        await engine.initialize();
        setEngineName(engine.getStatus().name);
        await engine.setDifficulty(restored.saved.difficulty as EngineDifficulty);
        await engine.newGame();
        setStarting(false);

        if (restored.state.turn !== restored.state.userSide) {
          await takeEngineTurn(restored.state);
        }
      } catch (error) {
        setStarting(false);
        failGame(
          `The chess engine could not start: ${(error as Error).message}. ` +
            'Every other mode is unaffected.',
        );
      }
    },
    [engineFactory, failGame, takeEngineTurn],
  );

  const tapSquare = useCallback(
    (square: SquareName) => {
      if (game === null || game.result.kind !== 'in-progress') return;
      if (game.turn !== game.userSide || thinking || starting) return;

      if (origin === null) {
        setOrigin(square);
        return;
      }
      if (origin === square) {
        setOrigin(null);
        return;
      }
      if (needsPromotion(game, origin, square)) {
        setPromotion({ from: origin, to: square });
        return;
      }
      commitMove(origin, square);
    },
    [commitMove, game, origin, starting, thinking],
  );

  if (!supported) {
    return (
      <div className="card" data-testid="engine-unsupported">
        <h2 className="card__title">This device cannot run the engine</h2>
        <p className="card__subtitle">
          Playing the computer needs Web Workers and WebAssembly, which this browser does
          not provide. Every other mode works normally.
        </p>
        <button type="button" className="button button--primary" onClick={onExit}>
          Back to modes
        </button>
      </div>
    );
  }

  if (phase === 'setup') {
    return (
      <div data-testid="engine-setup">
        <h1 className="screen-title">Blindfold vs Computer</h1>
        <p className="card__subtitle" style={{ marginBottom: 'var(--gap)' }}>
          A whole game, played from memory. The computer runs on this device; nothing is
          sent anywhere.
        </p>

        {/* A game left unfinished is offered back rather than discarded. */}
        {resumable !== null ? (
          <div className="card" data-testid="engine-resume">
            <h2 className="card__title">Unfinished game</h2>
            <p className="card__subtitle">{describeSave(resumable.saved)}</p>
            <div className="button-row" style={{ marginTop: 'var(--gap)' }}>
              <button
                type="button"
                className="button button--primary"
                data-testid="engine-resume-yes"
                onClick={() => void resumeGame(resumable)}
              >
                Resume
              </button>
              <button
                type="button"
                className="button"
                data-testid="engine-resume-no"
                onClick={() => {
                  setResumable(null);
                  try {
                    window.localStorage.removeItem(SAVED_GAME_KEY);
                  } catch {
                    // Nothing to clean up if storage is unavailable.
                  }
                }}
              >
                Start a new game
              </button>
            </div>
          </div>
        ) : null}

        <Choice
          label="You play"
          value={side}
          options={[
            { value: 'white' as PieceColor, label: 'White' },
            { value: 'black' as PieceColor, label: 'Black' },
          ]}
          onChange={setSide}
          testId="engine-side"
        />

        <Choice
          label="Computer strength"
          value={difficulty}
          options={DIFFICULTY_ORDER.map((id) => ({
            value: id,
            label: WEAK_PLAY_POLICY[id].label,
          }))}
          onChange={setDifficulty}
          testId="engine-difficulty"
        />
        <p className="card__subtitle" data-testid="engine-difficulty-detail">
          {WEAK_PLAY_POLICY[difficulty].detail}
        </p>

        <Choice
          label="Show the board"
          value={visibility}
          options={(['always', 'first-moves', 'never'] as GameVisibility[]).map((id) => ({
            value: id,
            label: VISIBILITY_LABELS[id],
          }))}
          onChange={setVisibility}
          testId="engine-visibility"
        />

        <Choice
          label="Move list"
          value={history}
          options={(
            ['full', 'latest-only', 'hidden', 'hidden-reveal'] as GameHistoryMode[]
          ).map((id) => ({ value: id, label: HISTORY_LABELS[id] }))}
          onChange={setHistory}
          testId="engine-history"
        />

        <Choice
          label="Read moves aloud"
          value={speakMoves ? 'on' : 'off'}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'on', label: 'On' },
          ]}
          onChange={(v) => setSpeakMoves(v === 'on')}
          testId="engine-speak"
        />

        <div className="button-row" style={{ marginTop: 'var(--gap)' }}>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void beginGame()}
            data-testid="engine-start"
          >
            Start the game
          </button>
          <button type="button" className="button" onClick={onExit}>
            Back
          </button>
        </div>
      </div>
    );
  }

  if (game === null) return <p className="empty-note">Starting the engine…</p>;

  const boardVisible =
    visibility === 'always' ||
    (visibility === 'first-moves' && game.history.length < 6) ||
    game.result.kind !== 'in-progress';

  const lastMove = game.history[game.history.length - 1];

  /**
   * The move list as this history setting allows it, or null when there is
   * nothing to show. Null renders no element at all rather than an empty one,
   * so a hidden history leaves no blank strip behind.
   *
   * The "Computer played …" line is separate and always present: the latest
   * move stays perceivable at every setting, which is what stops a hidden
   * history from making the opponent's reply invisible.
   */
  const visibleHistoryText: string | null = (() => {
    if (game.history.length === 0) return null;
    if (history === 'full') return moveListText(game.history);
    if (history === 'latest-only') return moveListText(game.history.slice(-1));
    if (history === 'hidden-reveal' && historyRevealed) return moveListText(game.history);
    return null;
  })();

  const marks = new Map<SquareName, SquareMark>();

  /*
   * The last move, always — on a hidden board these marks are the only visual
   * sign that anything happened, and they give nothing away: the user can
   * already read the move in SAN.
   */
  if (lastMove !== undefined) {
    marks.set(lastMove.uci.slice(0, 2) as SquareName, 'last-from');
    marks.set(lastMove.uci.slice(2, 4) as SquareName, 'last-to');
  }

  if (origin !== null) {
    marks.set(origin, 'origin');
    /*
     * Legal destinations are shown only when the pieces are. On a hidden
     * board they would hand over the position one tap at a time — select a
     * square, read off what stands there from where it may go.
     */
    if (boardVisible) {
      for (const square of legalDestinations(game, origin)) marks.set(square, 'hint');
    }
  }
  if (game.rejection !== null) {
    marks.set(game.rejection.slice(2, 4) as SquareName, 'wrong');
  }

  const userCaptures = capturedBy(game.history, game.userSide);
  const engineCaptures = capturedBy(game.history, game.userSide === 'white' ? 'black' : 'white');

  return (
    <div data-testid="engine-game">
      <div className="session-bar">
        <div>
          <strong>Blindfold vs Computer</strong>
          <div className="session-bar__meta">
            {WEAK_PLAY_POLICY[difficulty].label} · you are{' '}
            {game.userSide === 'white' ? 'White' : 'Black'}
            {engineName === null ? '' : ` · ${engineName}`}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="session-bar__meta" data-testid="engine-turn">
            {game.result.kind !== 'in-progress'
              ? 'Game over'
              : starting
                ? 'Starting the engine…'
                : thinking
                  ? 'Computer thinking…'
                  : game.turn === game.userSide
                    ? 'Your move'
                    : 'Computer to move'}
          </div>
          {game.inCheck ? (
            <div className="session-bar__meta" data-testid="engine-check">
              Check
            </div>
          ) : null}
        </div>
      </div>

      {engineError !== null ? (
        <div className="card" role="alert" data-testid="engine-error">
          <h2 className="card__title">The engine stopped</h2>
          <p className="card__subtitle">{engineError}</p>
          <p className="card__subtitle">
            The position is safe and every other mode is unaffected.
          </p>
          <div className="button-row" style={{ marginTop: 'var(--gap)' }}>
            {/* Retry starts a fresh game rather than resuming this one: the
                engine was disposed, and resuming would mean handing it a
                position it has no record of. */}
            <button
              type="button"
              className="button button--primary"
              data-testid="engine-retry"
              onClick={() => {
                abandonEngineTurn();
                void (async () => {
                  await releaseEngine();
                  engineRef.current = null;
                  setEngineError(null);
                  setGame(null);
                  setPhase('setup');
                })();
              }}
            >
              Try again
            </button>
            <button type="button" className="button" onClick={onExit} data-testid="engine-end">
              End game
            </button>
          </div>
        </div>
      ) : null}

      <div className="blindfold">
        <div className="blindfold__row">
          <span className="blindfold__count">
            {game.history.length === 0
              ? 'No moves yet'
              : `Move ${Math.ceil(game.history.length / 2)}`}
          </span>
          {!boardVisible ? <span className="blindfold__tag">No board</span> : null}
        </div>
        {/* The move list obeys the history setting. Hidden leaves no blank
            gap — the element is simply not rendered — and the reveal action
            only exists on the setting that offers it. */}
        {visibleHistoryText !== null ? (
          <p className="blindfold__moves" data-testid="engine-moves">
            {visibleHistoryText || ' '}
          </p>
        ) : null}

        {history === 'hidden-reveal' && !historyRevealed ? (
          <button
            type="button"
            className="button"
            data-testid="engine-reveal-history"
            onClick={() => setHistoryRevealed(true)}
          >
            Show the moves
          </button>
        ) : null}
        {/* Who played what, in words. The last-move marks on the board are
            amber squares; on their own they would be information carried by
            colour alone, and on a hidden board they are all there is. This
            line is a live region, so a screen reader announces the computer's
            reply rather than the user having to go looking for it. */}
        {lastMove !== undefined ? (
          <p
            className="engine-last-move"
            data-testid="engine-last-move"
            role="status"
            aria-live="polite"
          >
            {lastMove.color === game.userSide ? 'You played' : 'Computer played'}{' '}
            <strong>{lastMove.san}</strong>
            {lastMove.captured !== null ? ` — took a ${pieceWord(lastMove.captured)}` : ''}
            {lastMove.checkmate ? ' — checkmate' : lastMove.check ? ' — check' : ''}
          </p>
        ) : null}
        {userCaptures.length + engineCaptures.length > 0 ? (
          <p className="card__subtitle" data-testid="engine-captures">
            You have taken {userCaptures.length || 'nothing'}
            {userCaptures.length > 0 ? ` (${userCaptures.map(pieceWord).join(', ')})` : ''} ·
            the computer has taken {engineCaptures.length || 'nothing'}
            {engineCaptures.length > 0 ? ` (${engineCaptures.map(pieceWord).join(', ')})` : ''}
          </p>
        ) : null}
      </div>

      <Board
        fen={game.placement}
        orientation={game.userSide}
        labels="always"
        marks={marks}
        displayMode={boardVisible ? 'position' : 'empty-input'}
        onSquareTap={tapSquare}
      />

      {promotion !== null ? (
        <div className="card" data-testid="engine-promotion">
          <h2 className="card__title">Promote to</h2>
          <div className="palette__row">
            {(['queen', 'rook', 'bishop', 'knight'] as PieceType[]).map((type) => (
              <button
                key={type}
                type="button"
                className="palette__piece"
                aria-label={type}
                data-testid={`promote-${type}`}
                onClick={() =>
                  commitMove(
                    promotion.from,
                    promotion.to,
                    type === 'queen' ? 'q' : type === 'rook' ? 'r' : type === 'bishop' ? 'b' : 'n',
                  )
                }
              >
                <ChessPiece piece={{ type, color: game.userSide }} size={28} />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {game.result.kind !== 'in-progress' ? (
        <div className="card" data-testid="engine-result">
          <h2 className="card__title">{describeResult(game.result, game.userSide)}</h2>
          <p className="card__subtitle">{moveListText(game.history)}</p>
          <div className="button-row" style={{ marginTop: 'var(--gap)' }}>
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                abandonEngineTurn();
                setGame(null);
                setEngineError(null);
                setPhase('setup');
                void releaseEngine();
              }}
              data-testid="engine-again"
            >
              Play again
            </button>
            <button type="button" className="button" onClick={onExit}>
              Back to modes
            </button>
          </div>
        </div>
      ) : (
        <div className="button-row" style={{ marginTop: 'var(--gap)' }}>
          <button
            type="button"
            className="button"
            onClick={() => {
              // Abandon any computer turn in flight first. Without this a
              // reply that arrives after the resignation is applied on top of
              // it, and the finished game silently resumes.
              abandonEngineTurn();
              setGame((current) => (current === null ? current : resign(current)));
              setPhase('over');
            }}
            data-testid="engine-resign"
          >
            Resign
          </button>
          <button type="button" className="button button--danger" onClick={onExit}>
            Leave
          </button>
        </div>
      )}
    </div>
  );
}

function pieceWord(letter: string): string {
  switch (letter.toLowerCase()) {
    case 'p':
      return 'pawn';
    case 'n':
      return 'knight';
    case 'b':
      return 'bishop';
    case 'r':
      return 'rook';
    case 'q':
      return 'queen';
    default:
      return 'piece';
  }
}

/** The same segmented control the setup page uses, kept local to this screen. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  testId: string;
}) {
  return (
    <div className="setup-row">
      <span className="setup-row__label" id={`${testId}-label`}>
        {label}
      </span>
      <div className="segmented" role="group" aria-labelledby={`${testId}-label`} data-testid={testId}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`segmented__item${option.value === value ? ' segmented__item--on' : ''}`}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
            data-testid={`${testId}-${option.value}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
