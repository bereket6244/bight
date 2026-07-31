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
  DIFFICULTY_SETTINGS,
  engineSupported,
  getEngine,
  releaseEngine,
  type EngineDifficulty,
} from '../../services/engine';
import type { PieceColor, PieceType, SquareName } from '../../core/chess/types';
import { speak } from '../../services/speech';
import { vibrate } from '../../services/haptics';
import { playTone } from '../../services/sound';

/** How long a rejected move stays red. */
const FLASH_MS = 420;

/** How much of the board the user gets during the game. */
type GameVisibility = 'always' | 'first-moves' | 'never';

const VISIBILITY_LABELS: Record<GameVisibility, string> = {
  always: 'Always',
  'first-moves': 'First 6 plies',
  never: 'Never',
};

export interface EngineGameScreenProps {
  onExit: () => void;
  /** Injected in tests so the screen can be driven without real Stockfish. */
  engineFactory?: typeof getEngine;
}

type Phase = 'setup' | 'playing' | 'over';

export function EngineGameScreen({ onExit, engineFactory = getEngine }: EngineGameScreenProps) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [side, setSide] = useState<PieceColor>('white');
  const [difficulty, setDifficulty] = useState<EngineDifficulty>('easy');
  const [visibility, setVisibility] = useState<GameVisibility>('first-moves');
  const [speakMoves, setSpeakMoves] = useState(false);

  const [game, setGame] = useState<EngineGameState | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  /** True while the engine boots. Input is refused until it is ready. */
  const [starting, setStarting] = useState(false);
  const [engineName, setEngineName] = useState<string | null>(null);

  const [origin, setOrigin] = useState<SquareName | null>(null);
  const [promotion, setPromotion] = useState<{ from: SquareName; to: SquareName } | null>(null);

  const engineRef = useRef<ReturnType<typeof getEngine> | null>(null);
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

  /*
   * A backgrounded app must not keep a chess engine searching.
   *
   * `stop` only abandons the current search; the Worker stays alive and the
   * game state is untouched, so returning to the app leaves the position
   * exactly as it was. If the search was for the computer's move, it is the
   * user's turn to notice nothing happened and the game is still playable —
   * the alternative, a phone burning battery on a search nobody is waiting
   * for, is worse.
   */
  useEffect(() => {
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') void engineRef.current?.stop();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
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

  /** Asks the engine for a move and applies it, or stops the game. */
  const takeEngineTurn = useCallback(
    async (state: EngineGameState) => {
      const engine = engineRef.current;
      if (engine === null) return;

      setThinking(true);
      try {
        const move = await engine.chooseMove({ fen: 'startpos', moves: state.uciHistory });
        const outcome = applyEngineMove(state, move.uci);

        if (!outcome.ok) {
          // chess.js refused it. The engine is not allowed to be right about
          // this, so the game stops rather than continuing from a position
          // that cannot be reproduced.
          failGame(outcome.reason);
          return;
        }

        setThinking(false);
        setGame(outcome.state);

        const played = outcome.state.history[outcome.state.history.length - 1];
        if (played !== undefined && speakMoves) void speak(played.san);
        if (outcome.state.result.kind !== 'in-progress') setPhase('over');
      } catch (error) {
        failGame(
          `The computer could not find a move: ${(error as Error).message}`,
        );
      }
    },
    [failGame, speakMoves],
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

  // A rejected move flashes and clears itself.
  useEffect(() => {
    if (game?.rejection == null) return;
    vibrate('error');
    playTone('wrong');
    const timer = window.setTimeout(() => {
      setGame((current) => (current === null ? current : clearRejection(current)));
    }, FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [game?.rejection]);

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

      playTone('correct');
      if (next.result.kind !== 'in-progress') setPhase('over');
      else void takeEngineTurn(next);
    },
    [takeEngineTurn],
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
            label: DIFFICULTY_SETTINGS[id].label,
          }))}
          onChange={setDifficulty}
          testId="engine-difficulty"
        />
        <p className="card__subtitle" data-testid="engine-difficulty-detail">
          {DIFFICULTY_SETTINGS[difficulty].detail}
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

  const marks = new Map<SquareName, SquareMark>();
  if (origin !== null) {
    marks.set(origin, 'origin');
    for (const square of legalDestinations(game, origin)) marks.set(square, 'hint');
  }
  if (game.rejection !== null) {
    marks.set(game.rejection.slice(2, 4) as SquareName, 'wrong');
  }

  const lastMove = game.history[game.history.length - 1];
  const userCaptures = capturedBy(game.history, game.userSide);
  const engineCaptures = capturedBy(game.history, game.userSide === 'white' ? 'black' : 'white');

  return (
    <div data-testid="engine-game">
      <div className="session-bar">
        <div>
          <strong>Blindfold vs Computer</strong>
          <div className="session-bar__meta">
            {DIFFICULTY_SETTINGS[difficulty].label} · you are{' '}
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
        <p className="blindfold__moves" data-testid="engine-moves">
          {moveListText(game.history) || ' '}
        </p>
        {lastMove !== undefined ? (
          <p className="card__subtitle" data-testid="engine-last-move">
            Last move: {lastMove.san}
            {lastMove.captured !== null ? ` (took a ${pieceWord(lastMove.captured)})` : ''}
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
        hidden={!boardVisible}
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
            onClick={() => setGame((current) => (current === null ? current : resign(current)))}
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
