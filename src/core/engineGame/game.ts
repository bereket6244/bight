/**
 * A blindfold game against the engine.
 *
 * chess.js is the only authority here. The engine proposes a move as four
 * characters of text; this module asks chess.js whether that is a legal move
 * in the current position, and refuses it if not. An engine that returns
 * nonsense, or a move from a position it was never given, loses the argument.
 *
 * The state is a plain value and every transition is a pure function, so the
 * awkward cases — an illegal engine move, a game that ends on the engine's
 * move, a promotion — are testable without a worker or a browser.
 */

import { Chess } from 'chess.js';
import type { PieceColor, SquareName } from '../chess/types';

export type GameResult =
  | { kind: 'in-progress' }
  | { kind: 'checkmate'; winner: PieceColor }
  | { kind: 'stalemate' }
  | { kind: 'draw'; reason: 'insufficient-material' | 'threefold' | 'fifty-move' | 'other' }
  | { kind: 'resigned'; winner: PieceColor }
  /** The engine could not play. The game stops rather than pretending. */
  | { kind: 'abandoned'; reason: string };

export interface PlayedMove {
  san: string;
  uci: string;
  color: PieceColor;
  /** Full-move number, as it would be written in a score sheet. */
  moveNumber: number;
  /** Piece taken by this move, if any. */
  captured: string | null;
  check: boolean;
  checkmate: boolean;
}

export interface EngineGameState {
  /** Which side the user is playing. */
  userSide: PieceColor;
  /** Full FEN of the current position. */
  fen: string;
  /** Placement field only, for drawing. */
  placement: string;
  /** Every move so far, in order. */
  history: PlayedMove[];
  /** UCI moves from the starting position, for the engine's `position`. */
  uciHistory: string[];
  turn: PieceColor;
  inCheck: boolean;
  result: GameResult;
  /** Set when the last user input was rejected, for a brief flash. */
  rejection: string | null;
}

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function colorOf(chess: Chess): PieceColor {
  return chess.turn() === 'w' ? 'white' : 'black';
}

function placementOf(fen: string): string {
  return fen.split(' ')[0] as string;
}

/** Reads the position out of chess.js into a state value. */
function snapshot(
  chess: Chess,
  base: Pick<EngineGameState, 'userSide' | 'history' | 'uciHistory'>,
  result: GameResult,
  rejection: string | null = null,
): EngineGameState {
  const fen = chess.fen();
  return {
    ...base,
    fen,
    placement: placementOf(fen),
    turn: colorOf(chess),
    inCheck: chess.isCheck(),
    result,
    rejection,
  };
}

/** Whatever chess.js says the game is, expressed in this module's terms. */
export function resultOf(chess: Chess): GameResult {
  if (chess.isCheckmate()) {
    // The side to move is the one that has been mated.
    return { kind: 'checkmate', winner: chess.turn() === 'w' ? 'black' : 'white' };
  }
  if (chess.isStalemate()) return { kind: 'stalemate' };
  if (chess.isInsufficientMaterial()) {
    return { kind: 'draw', reason: 'insufficient-material' };
  }
  if (chess.isThreefoldRepetition()) return { kind: 'draw', reason: 'threefold' };
  if (chess.isDraw()) return { kind: 'draw', reason: 'fifty-move' };
  return { kind: 'in-progress' };
}

export function startGame(userSide: PieceColor): EngineGameState {
  const chess = new Chess(STARTING_FEN);
  return snapshot(chess, { userSide, history: [], uciHistory: [] }, { kind: 'in-progress' });
}

/** Rebuilds a chess.js instance from a state. */
function board(state: EngineGameState): Chess {
  return new Chess(state.fen);
}

function record(chess: Chess, move: ReturnType<Chess['move']>): PlayedMove {
  const uci = `${move.from}${move.to}${move.promotion ?? ''}`;
  return {
    san: move.san,
    uci,
    color: move.color === 'w' ? 'white' : 'black',
    // chess.js increments the number after Black moves, so the number that
    // belongs to this move is read before the increment for White.
    moveNumber: Number(chess.fen().split(' ')[5] ?? 1) - (move.color === 'b' ? 1 : 0),
    captured: move.captured ?? null,
    check: chess.isCheck(),
    checkmate: chess.isCheckmate(),
  };
}

export interface MoveRequest {
  from: SquareName;
  to: SquareName;
  /** Required only when the move promotes. */
  promotion?: 'q' | 'r' | 'b' | 'n';
}

/**
 * Plays the user's move, if it is legal.
 *
 * An illegal move is not an error and not a state change beyond the flash: in
 * a blindfold game the user is working from memory, and a rejected move is
 * ordinary. It never advances the game or hands the turn over.
 */
export function playUserMove(state: EngineGameState, request: MoveRequest): EngineGameState {
  if (state.result.kind !== 'in-progress') return state;
  if (state.turn !== state.userSide) return state;

  const chess = board(state);
  let move: ReturnType<Chess['move']>;
  try {
    move = chess.move({ from: request.from, to: request.to, promotion: request.promotion ?? 'q' });
  } catch {
    return { ...state, rejection: `${request.from}${request.to}` };
  }
  if (move === null) return { ...state, rejection: `${request.from}${request.to}` };

  const played = record(chess, move);
  return snapshot(
    chess,
    {
      userSide: state.userSide,
      history: [...state.history, played],
      uciHistory: [...state.uciHistory, played.uci],
    },
    resultOf(chess),
  );
}

/**
 * True when the move is legal in this position, without playing it.
 * Used to decide whether a tapped destination is worth offering.
 */
export function legalDestinations(state: EngineGameState, from: SquareName): SquareName[] {
  if (state.result.kind !== 'in-progress') return [];
  const chess = board(state);
  return chess
    .moves({ square: from as never, verbose: true })
    .map((move) => move.to as SquareName);
}

/** True when moving from → to would need a promotion piece choosing. */
export function needsPromotion(state: EngineGameState, from: SquareName, to: SquareName): boolean {
  if (state.result.kind !== 'in-progress') return false;
  const chess = board(state);
  return chess
    .moves({ square: from as never, verbose: true })
    .some((move) => move.to === to && move.promotion !== undefined);
}

export type EngineMoveOutcome =
  | { ok: true; state: EngineGameState }
  /**
   * The engine returned something that is not legal here. The game is
   * abandoned rather than continued from a position nobody can reproduce.
   */
  | { ok: false; state: EngineGameState; reason: string };

/**
 * Applies the engine's move, having first checked it against chess.js.
 *
 * This is the boundary the whole engine integration hangs on: the engine is a
 * suggestion, and this function is where the suggestion is either accepted as
 * a legal move or thrown out. Nothing else in the app trusts engine output.
 */
export function applyEngineMove(state: EngineGameState, uci: string): EngineMoveOutcome {
  if (state.result.kind !== 'in-progress') {
    return { ok: false, state, reason: 'The game is already over.' };
  }
  if (state.turn === state.userSide) {
    return { ok: false, state, reason: 'It is not the engine to move.' };
  }

  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(uci)) {
    return {
      ok: false,
      state: abandon(state, `The engine returned "${uci}", which is not a move.`),
      reason: `The engine returned "${uci}", which is not a move.`,
    };
  }

  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4]?.toLowerCase() : undefined;

  const chess = board(state);
  let move: ReturnType<Chess['move']>;
  try {
    move = chess.move({ from, to, promotion });
  } catch {
    const reason = `The engine tried ${uci}, which is not legal in this position.`;
    return { ok: false, state: abandon(state, reason), reason };
  }
  if (move === null) {
    const reason = `The engine tried ${uci}, which is not legal in this position.`;
    return { ok: false, state: abandon(state, reason), reason };
  }

  const played = record(chess, move);
  return {
    ok: true,
    state: snapshot(
      chess,
      {
        userSide: state.userSide,
        history: [...state.history, played],
        uciHistory: [...state.uciHistory, played.uci],
      },
      resultOf(chess),
    ),
  };
}

/** Stops the game with a stated reason. Used when the engine fails. */
export function abandon(state: EngineGameState, reason: string): EngineGameState {
  return { ...state, result: { kind: 'abandoned', reason }, rejection: null };
}

/** The user gives up. The engine wins; nothing is pretended otherwise. */
export function resign(state: EngineGameState): EngineGameState {
  if (state.result.kind !== 'in-progress') return state;
  return {
    ...state,
    result: { kind: 'resigned', winner: state.userSide === 'white' ? 'black' : 'white' },
  };
}

export function clearRejection(state: EngineGameState): EngineGameState {
  return state.rejection === null ? state : { ...state, rejection: null };
}

/** One line describing how the game ended, for the user. */
export function describeResult(result: GameResult, userSide: PieceColor): string {
  switch (result.kind) {
    case 'in-progress':
      return 'Game in progress.';
    case 'checkmate':
      return result.winner === userSide ? 'Checkmate — you win.' : 'Checkmate — the computer wins.';
    case 'stalemate':
      return 'Stalemate. A draw.';
    case 'draw':
      switch (result.reason) {
        case 'insufficient-material':
          return 'Draw — neither side has enough material to mate.';
        case 'threefold':
          return 'Draw by threefold repetition.';
        case 'fifty-move':
          return 'Draw by the fifty-move rule.';
        default:
          return 'Draw.';
      }
    case 'resigned':
      return result.winner === userSide ? 'The computer resigned.' : 'You resigned.';
    case 'abandoned':
      return `Game stopped: ${result.reason}`;
  }
}

/** The moves so far, written out as a score sheet. */
export function moveListText(history: readonly PlayedMove[]): string {
  const parts: string[] = [];
  for (const move of history) {
    if (move.color === 'white') parts.push(`${move.moveNumber}. ${move.san}`);
    else if (parts.length === 0) parts.push(`${move.moveNumber}… ${move.san}`);
    else parts.push(move.san);
  }
  return parts.join(' ');
}

/** Material the given side has captured, heaviest first. */
export function capturedBy(history: readonly PlayedMove[], color: PieceColor): string[] {
  const order = 'qrbnp';
  return history
    .filter((move) => move.color === color && move.captured !== null)
    .map((move) => move.captured as string)
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));
}
