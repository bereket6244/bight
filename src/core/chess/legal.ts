/**
 * Legal-move semantics, delegated entirely to chess.js.
 *
 * Nothing here re-derives chess rules. When a drill asks "what can this piece
 * legally play in this position", the answer comes from chess.js so that
 * castling, en passant, pins, check evasion and promotion are handled by a
 * tested reference implementation rather than by Bight.
 *
 * Geometry ("what does this piece see") lives in `geometry.ts` instead.
 */

import { Chess, SQUARES, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';
import { sortSquares } from './geometry';
import { normalizeSquare } from './square';
import {
  LETTER_TO_PIECE,
  PIECE_LETTERS,
  type Piece,
  type PieceColor,
  type PieceType,
  type SquareName,
} from './types';

export function toChessJsColor(color: PieceColor): Color {
  return color === 'white' ? 'w' : 'b';
}

export function fromChessJsColor(color: Color): PieceColor {
  return color === 'w' ? 'white' : 'black';
}

export function toChessJsPiece(type: PieceType): PieceSymbol {
  return PIECE_LETTERS[type] as PieceSymbol;
}

export function fromChessJsPiece(symbol: PieceSymbol): PieceType {
  const type = LETTER_TO_PIECE[symbol];
  if (type === undefined) throw new RangeError(`Unknown chess.js piece symbol: ${symbol}`);
  return type;
}

/** chess.js uses the same algebraic names, but the cast is made explicit. */
export function toChessJsSquare(square: SquareName): Square {
  return square as unknown as Square;
}

export function fromChessJsSquare(square: Square): SquareName {
  const normalized = normalizeSquare(square as unknown as string);
  if (normalized === null) throw new RangeError(`chess.js returned an unknown square: ${square}`);
  return normalized;
}

export class IllegalPositionError extends Error {
  constructor(fen: string, cause: unknown) {
    super(`chess.js rejected the position "${fen}": ${String(cause)}`);
    this.name = 'IllegalPositionError';
  }
}

/**
 * Loads a FEN into chess.js.
 *
 * `skipValidation` is exposed because vision drills legitimately use boards
 * that are not legal chess positions (a lone knight, no kings). Callers that
 * need true legal-move semantics must leave validation on.
 */
export function loadPosition(fen: string, options: { skipValidation?: boolean } = {}): Chess {
  try {
    return new Chess(fen, { skipValidation: options.skipValidation ?? false });
  } catch (cause) {
    throw new IllegalPositionError(fen, cause);
  }
}

export function isValidPosition(fen: string): boolean {
  try {
    loadPosition(fen);
    return true;
  } catch {
    return false;
  }
}

export function sideToMove(fen: string): PieceColor {
  return fromChessJsColor(loadPosition(fen, { skipValidation: true }).turn());
}

export function pieceAt(fen: string, square: SquareName): Piece | null {
  const chess = loadPosition(fen, { skipValidation: true });
  const found = chess.get(toChessJsSquare(square));
  if (found === undefined) return null;
  return { type: fromChessJsPiece(found.type), color: fromChessJsColor(found.color) };
}

/** Verbose legal moves for one square, in chess.js's own representation. */
export function legalMovesFrom(fen: string, from: SquareName): Move[] {
  const chess = loadPosition(fen);
  return chess.moves({ square: toChessJsSquare(from), verbose: true });
}

/**
 * Distinct legal destination squares for a piece.
 *
 * Promotions collapse to a single destination: a pawn reaching e8 offers four
 * moves in chess.js but is one square to the trainee.
 */
export function legalDestinations(fen: string, from: SquareName): SquareName[] {
  // A pawn reaching the last rank yields four chess.js moves (Q/R/B/N) that
  // share one destination square, so the set is deduplicated.
  return sortSquares(new Set(legalMovesFrom(fen, from).map((move) => fromChessJsSquare(move.to))));
}

export function allLegalDestinations(fen: string): Map<SquareName, SquareName[]> {
  const chess = loadPosition(fen);
  const grouped = new Map<SquareName, SquareName[]>();
  for (const move of chess.moves({ verbose: true })) {
    const from = fromChessJsSquare(move.from);
    const list = grouped.get(from) ?? [];
    list.push(fromChessJsSquare(move.to));
    grouped.set(from, list);
  }
  for (const [from, list] of grouped) grouped.set(from, sortSquares(new Set(list)));
  return grouped;
}

export function isLegalMove(fen: string, from: SquareName, to: SquareName): boolean {
  return legalDestinations(fen, from).includes(to);
}

export interface AppliedMove {
  fen: string;
  san: string;
  captured: PieceType | null;
  isPromotion: boolean;
  isEnPassant: boolean;
  isCastle: boolean;
}

/**
 * Plays a move and returns the resulting position, or null when the move is
 * not legal. Never mutates caller state — a fresh Chess instance is used.
 */
export function applyMove(
  fen: string,
  from: SquareName,
  to: SquareName,
  promotion: PieceType = 'queen',
): AppliedMove | null {
  const chess = loadPosition(fen);
  try {
    const move = chess.move({
      from: toChessJsSquare(from),
      to: toChessJsSquare(to),
      promotion: toChessJsPiece(promotion),
    });
    return {
      fen: chess.fen(),
      san: move.san,
      captured: move.captured === undefined ? null : fromChessJsPiece(move.captured),
      isPromotion: move.promotion !== undefined,
      isEnPassant: move.isEnPassant(),
      isCastle: move.isKingsideCastle() || move.isQueensideCastle(),
    };
  } catch {
    // chess.js throws on illegal moves; the trainer treats that as "no".
    return null;
  }
}

/**
 * Squares attacked by a colour, per chess.js. Used to cross-check Bight's own
 * geometry in tests rather than at runtime.
 */
export function attackedSquaresByColor(fen: string, color: PieceColor): SquareName[] {
  const chess = loadPosition(fen, { skipValidation: true });
  const attackedBy = toChessJsColor(color);
  const attacked = SQUARES.filter((square) => chess.isAttacked(square, attackedBy));
  return sortSquares(attacked.map(fromChessJsSquare));
}

/** Squares from which `color` attacks the given square. */
export function attackersOf(fen: string, square: SquareName, color: PieceColor): SquareName[] {
  const chess = loadPosition(fen, { skipValidation: true });
  const found = chess.attackers(toChessJsSquare(square), toChessJsColor(color));
  return sortSquares(found.map(fromChessJsSquare));
}
