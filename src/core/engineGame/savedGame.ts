/**
 * Saving an unfinished game against the engine.
 *
 * Leaving the screen used to throw the game away silently. What is stored is
 * deliberately minimal: the moves in UCI and the handful of settings the game
 * was played under. The position itself is *not* stored — it is replayed
 * through chess.js on restore, so a save can never disagree with the rules,
 * and a corrupted or hand-edited save fails to replay rather than producing a
 * position that never existed.
 *
 * Nothing about the engine is stored. Worker state, search state and hash
 * tables are all rebuilt from nothing when the game resumes.
 */

import { Chess } from 'chess.js';
import type { PieceColor } from '../chess/types';
import { startGame, type EngineGameState } from './game';

/**
 * Bumped only when the shape below changes incompatibly. A save from an older
 * format is discarded rather than guessed at — losing one unfinished game is
 * a far smaller harm than restoring a wrong position.
 */
export const SAVED_GAME_VERSION = 1;

export const SAVED_GAME_KEY = 'bight.engineGame.v1';

export interface SavedEngineGame {
  version: number;
  /** Which side the user was playing. */
  userSide: PieceColor;
  /** Difficulty id, as stored — not the display label. */
  difficulty: string;
  /** How much of the board was being shown. */
  visibility: string;
  /** How much of the move list was being shown. */
  history: string;
  speakMoves: boolean;
  /** Every move so far, in UCI, from the standard starting position. */
  moves: string[];
  /** True when the computer owed a move at the moment of saving. */
  enginePending: boolean;
  savedAt: number;
  appVersion: string;
}

export interface SaveInput {
  state: EngineGameState;
  difficulty: string;
  visibility: string;
  history: string;
  speakMoves: boolean;
  appVersion: string;
  now?: number;
}

/** Builds the record to store. Returns null when there is nothing worth saving. */
export function buildSave(input: SaveInput): SavedEngineGame | null {
  const { state } = input;

  // A finished game is not resumable, and an empty one is not worth resuming.
  if (state.result.kind !== 'in-progress') return null;
  if (state.uciHistory.length === 0) return null;

  return {
    version: SAVED_GAME_VERSION,
    userSide: state.userSide,
    difficulty: input.difficulty,
    visibility: input.visibility,
    history: input.history,
    speakMoves: input.speakMoves,
    moves: [...state.uciHistory],
    enginePending: state.turn !== state.userSide,
    savedAt: input.now ?? Date.now(),
    appVersion: input.appVersion,
  };
}

export interface RestoredGame {
  state: EngineGameState;
  saved: SavedEngineGame;
}

/**
 * Replays a save into a live game, or returns null if it cannot be trusted.
 *
 * Every move is re-applied through chess.js. A save whose moves do not replay
 * — truncated, tampered with, or written by a version that meant something
 * else by them — is refused outright.
 */
export function restoreSave(raw: unknown): RestoredGame | null {
  if (!isSavedGame(raw)) return null;
  if (raw.version !== SAVED_GAME_VERSION) return null;

  const chess = new Chess();
  for (const uci of raw.moves) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(uci)) return null;
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4]?.toLowerCase() : undefined,
      });
      if (move === null) return null;
    } catch {
      return null;
    }
  }

  // A game that has already ended is not resumable.
  if (chess.isGameOver()) return null;

  // Rebuild by replaying through the game module, so the restored value is
  // identical in shape to one that was played rather than loaded.
  let state = startGame(raw.userSide);
  const replay = new Chess();
  for (const uci of raw.moves) {
    const move = replay.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4]?.toLowerCase() : undefined,
    });
    state = {
      ...state,
      fen: replay.fen(),
      placement: replay.fen().split(' ')[0] as string,
      turn: replay.turn() === 'w' ? 'white' : 'black',
      inCheck: replay.isCheck(),
      history: [
        ...state.history,
        {
          san: move.san,
          uci,
          color: move.color === 'w' ? 'white' : 'black',
          moveNumber:
            Number(replay.fen().split(' ')[5] ?? 1) - (move.color === 'b' ? 1 : 0),
          captured: move.captured ?? null,
          check: replay.isCheck(),
          checkmate: replay.isCheckmate(),
        },
      ],
      uciHistory: [...state.uciHistory, uci],
    };
  }

  return { state, saved: raw };
}

function isSavedGame(value: unknown): value is SavedEngineGame {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SavedEngineGame>;
  return (
    typeof candidate.version === 'number' &&
    (candidate.userSide === 'white' || candidate.userSide === 'black') &&
    Array.isArray(candidate.moves) &&
    candidate.moves.every((move) => typeof move === 'string') &&
    typeof candidate.difficulty === 'string' &&
    typeof candidate.visibility === 'string'
  );
}

/** Short description for the resume prompt. */
export function describeSave(saved: SavedEngineGame): string {
  const moves = Math.ceil(saved.moves.length / 2);
  const side = saved.userSide === 'white' ? 'White' : 'Black';
  return `${side}, ${moves} move${moves === 1 ? '' : 's'} played`;
}
