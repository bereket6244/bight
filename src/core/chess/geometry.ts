/**
 * Piece geometry: movement patterns derived from vectors and ray tracing.
 *
 * This module answers the "vision" question — where does a piece's movement
 * pattern reach — and deliberately knows nothing about turn order, check,
 * pins or castling. For destinations that are *legal in a real position*,
 * use `legal.ts`, which delegates to chess.js.
 *
 * Keeping the two apart is a correctness requirement of the app: a knight on
 * a1 always "sees" b3 and c2 geometrically, but may have no legal move there.
 */

import {
  isOnBoard,
  toCoordinates,
  toSquare,
  toSquareOrNull,
  BOARD_SIZE,
} from './square';
import type {
  Occupancy,
  Piece,
  PieceColor,
  PieceType,
  SquareName,
  Vector,
} from './types';

/** The eight knight leaps, in clockwise order starting from "up-right". */
export const KNIGHT_VECTORS: readonly Vector[] = Object.freeze([
  { df: 1, dr: 2 },
  { df: 2, dr: 1 },
  { df: 2, dr: -1 },
  { df: 1, dr: -2 },
  { df: -1, dr: -2 },
  { df: -2, dr: -1 },
  { df: -2, dr: 1 },
  { df: -1, dr: 2 },
]);

/** The eight king steps, in clockwise order starting from "up". */
export const KING_VECTORS: readonly Vector[] = Object.freeze([
  { df: 0, dr: 1 },
  { df: 1, dr: 1 },
  { df: 1, dr: 0 },
  { df: 1, dr: -1 },
  { df: 0, dr: -1 },
  { df: -1, dr: -1 },
  { df: -1, dr: 0 },
  { df: -1, dr: 1 },
]);

export const BISHOP_DIRECTIONS: readonly Vector[] = Object.freeze([
  { df: 1, dr: 1 },
  { df: 1, dr: -1 },
  { df: -1, dr: -1 },
  { df: -1, dr: 1 },
]);

export const ROOK_DIRECTIONS: readonly Vector[] = Object.freeze([
  { df: 0, dr: 1 },
  { df: 1, dr: 0 },
  { df: 0, dr: -1 },
  { df: -1, dr: 0 },
]);

export const QUEEN_DIRECTIONS: readonly Vector[] = Object.freeze([
  ...ROOK_DIRECTIONS,
  ...BISHOP_DIRECTIONS,
]);

/** Sliding pieces repeat their direction vectors until blocked or off-board. */
export const SLIDING_PIECES: readonly PieceType[] = Object.freeze(['bishop', 'rook', 'queen']);

export function isSlidingPiece(type: PieceType): boolean {
  return SLIDING_PIECES.includes(type);
}

export function directionsFor(type: PieceType): readonly Vector[] {
  switch (type) {
    case 'bishop':
      return BISHOP_DIRECTIONS;
    case 'rook':
      return ROOK_DIRECTIONS;
    case 'queen':
      return QUEEN_DIRECTIONS;
    case 'king':
      return KING_VECTORS;
    case 'knight':
      return KNIGHT_VECTORS;
    case 'pawn':
      return [];
  }
}

/** Sorts squares into a stable order so answer sets compare predictably. */
export function sortSquares(squares: Iterable<SquareName>): SquareName[] {
  return [...squares].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function uniqueSorted(squares: Iterable<SquareName>): SquareName[] {
  return sortSquares(new Set(squares));
}

/** Applies a single vector from a square; null when it lands off-board. */
export function step(from: SquareName, vector: Vector): SquareName | null {
  const { file, rank } = toCoordinates(from);
  return toSquareOrNull(file + vector.df, rank + vector.dr);
}

/** Single-step targets (knight, king): every vector applied exactly once. */
export function leaperTargets(from: SquareName, vectors: readonly Vector[]): SquareName[] {
  const out: SquareName[] = [];
  for (const vector of vectors) {
    const target = step(from, vector);
    if (target !== null) out.push(target);
  }
  return uniqueSorted(out);
}

export function knightTargets(from: SquareName): SquareName[] {
  return leaperTargets(from, KNIGHT_VECTORS);
}

export function kingTargets(from: SquareName): SquareName[] {
  return leaperTargets(from, KING_VECTORS);
}

export interface RayOptions {
  /**
   * Occupancy to trace against. When omitted, rays run to the board edge —
   * that is the "ignore occupancy" vision case.
   */
  occupancy?: Occupancy;
  /**
   * Colour of the moving piece. Required to decide whether the first blocking
   * square is a capture (included) or a friendly piece (excluded).
   */
  moverColor?: PieceColor;
  /**
   * What happens to the first occupied square on a ray. It always terminates
   * the ray; this decides whether it counts as a target.
   *
   * - `include-enemy` (default): move semantics. An enemy piece is a capture
   *   target, a friendly piece is not.
   * - `include-any`: attack/defence semantics. The square is attacked whoever
   *   stands on it — this is what "is this square defended" means, and what
   *   chess.js `attackers()` reports.
   * - `exclude`: quiet moves only. No occupied square is ever a target.
   */
  blockerPolicy?: 'include-enemy' | 'include-any' | 'exclude';
}

/**
 * Traces one ray from a square until it leaves the board or meets a piece.
 *
 * Returns the squares in order of increasing distance. The blocking square is
 * included only when it holds an enemy piece and captures are enabled.
 */
export function traceRay(
  from: SquareName,
  direction: Vector,
  options: RayOptions = {},
): SquareName[] {
  const { occupancy, moverColor, blockerPolicy = 'include-enemy' } = options;
  const { file, rank } = toCoordinates(from);
  const out: SquareName[] = [];

  for (let distance = 1; distance < BOARD_SIZE; distance += 1) {
    const f = file + direction.df * distance;
    const r = rank + direction.dr * distance;
    if (!isOnBoard(f, r)) break;

    const square = toSquare(f, r);
    const blocker = occupancy?.get(square);
    if (blocker === undefined) {
      out.push(square);
      continue;
    }

    // The first occupied square always terminates the ray; the policy decides
    // whether it is itself a target.
    if (blockerPolicy === 'include-any') {
      out.push(square);
    } else if (blockerPolicy === 'include-enemy') {
      const isEnemy = moverColor !== undefined && blocker.color !== moverColor;
      if (isEnemy) out.push(square);
    }
    break;
  }

  return out;
}

/** All rays for a set of directions, flattened and sorted. */
export function slidingTargets(
  from: SquareName,
  directions: readonly Vector[],
  options: RayOptions = {},
): SquareName[] {
  const out: SquareName[] = [];
  for (const direction of directions) {
    out.push(...traceRay(from, direction, options));
  }
  return uniqueSorted(out);
}

/** Each ray kept separate — used by "identify the diagonal / file" drills. */
export function raysFrom(
  from: SquareName,
  directions: readonly Vector[],
  options: RayOptions = {},
): SquareName[][] {
  return directions.map((direction) => traceRay(from, direction, options));
}

export function bishopTargets(from: SquareName, options: RayOptions = {}): SquareName[] {
  return slidingTargets(from, BISHOP_DIRECTIONS, options);
}

export function rookTargets(from: SquareName, options: RayOptions = {}): SquareName[] {
  return slidingTargets(from, ROOK_DIRECTIONS, options);
}

export function queenTargets(from: SquareName, options: RayOptions = {}): SquareName[] {
  return slidingTargets(from, QUEEN_DIRECTIONS, options);
}

/** Forward rank delta for a pawn of the given colour. */
export function pawnDirection(color: PieceColor): number {
  return color === 'white' ? 1 : -1;
}

/** Zero-based starting rank index: rank 2 for White, rank 7 for Black. */
export function pawnStartRank(color: PieceColor): number {
  return color === 'white' ? 1 : 6;
}

/** Zero-based promotion rank index: rank 8 for White, rank 1 for Black. */
export function pawnPromotionRank(color: PieceColor): number {
  return color === 'white' ? 7 : 0;
}

export function isPawnOnStartRank(square: SquareName, color: PieceColor): boolean {
  return toCoordinates(square).rank === pawnStartRank(color);
}

export function isPawnPromotionSquare(square: SquareName, color: PieceColor): boolean {
  return toCoordinates(square).rank === pawnPromotionRank(color);
}

/**
 * Pawn pushes (never captures).
 *
 * The double push is offered only from the starting rank, and — when an
 * occupancy map is supplied — only when both intervening squares are empty.
 */
export function pawnPushTargets(
  from: SquareName,
  color: PieceColor,
  occupancy?: Occupancy,
): SquareName[] {
  const { file, rank } = toCoordinates(from);
  const dir = pawnDirection(color);

  // A pawn cannot legally stand on its own promotion rank.
  if (rank === pawnPromotionRank(color)) return [];

  const out: SquareName[] = [];
  const single = toSquareOrNull(file, rank + dir);
  if (single === null) return out;
  if (occupancy?.get(single) !== undefined) return out;
  out.push(single);

  if (rank === pawnStartRank(color)) {
    const double = toSquareOrNull(file, rank + dir * 2);
    if (double !== null && occupancy?.get(double) === undefined) out.push(double);
  }

  return uniqueSorted(out);
}

/**
 * The two diagonal squares a pawn attacks, regardless of occupancy.
 * This is the geometry answer — "where could this pawn capture".
 */
export function pawnCaptureSquares(from: SquareName, color: PieceColor): SquareName[] {
  const { file, rank } = toCoordinates(from);
  const dir = pawnDirection(color);
  if (rank === pawnPromotionRank(color)) return [];
  const out: SquareName[] = [];
  for (const df of [-1, 1]) {
    const target = toSquareOrNull(file + df, rank + dir);
    if (target !== null) out.push(target);
  }
  return uniqueSorted(out);
}

/** Diagonal squares holding an enemy piece — actual available captures. */
export function pawnCaptureTargets(
  from: SquareName,
  color: PieceColor,
  occupancy: Occupancy,
): SquareName[] {
  return pawnCaptureSquares(from, color).filter((square) => {
    const occupant = occupancy.get(square);
    return occupant !== undefined && occupant.color !== color;
  });
}

export interface GeometryOptions {
  /**
   * When supplied, sliding rays stop at pieces and same-colour squares are
   * excluded. When omitted, the pure movement pattern is returned.
   */
  occupancy?: Occupancy;
  /** Include pawn capture squares even when no enemy piece stands there. */
  pawnCaptureMode?: 'attacks-only' | 'pushes-only' | 'both';
}

/**
 * The single entry point every training mode uses for "what does this piece
 * see from here", so no mode re-implements movement rules.
 *
 * With no occupancy supplied this is pure vision: rays extend to the board
 * edge and leapers ignore what stands on their landing squares. With an
 * occupancy map, friendly-occupied squares drop out and rays stop at the
 * first blocker, including it when it is capturable.
 */
export function geometricTargets(
  piece: Piece,
  from: SquareName,
  options: GeometryOptions = {},
): SquareName[] {
  const { occupancy, pawnCaptureMode = 'both' } = options;
  const rayOptions: RayOptions = { occupancy, moverColor: piece.color };

  switch (piece.type) {
    case 'knight':
    case 'king': {
      const vectors = piece.type === 'knight' ? KNIGHT_VECTORS : KING_VECTORS;
      const targets = leaperTargets(from, vectors);
      if (occupancy === undefined) return targets;
      return targets.filter((square) => {
        const occupant = occupancy.get(square);
        return occupant === undefined || occupant.color !== piece.color;
      });
    }
    case 'bishop':
      return bishopTargets(from, rayOptions);
    case 'rook':
      return rookTargets(from, rayOptions);
    case 'queen':
      return queenTargets(from, rayOptions);
    case 'pawn': {
      const pushes =
        pawnCaptureMode === 'attacks-only' ? [] : pawnPushTargets(from, piece.color, occupancy);
      const captures =
        pawnCaptureMode === 'pushes-only'
          ? []
          : occupancy === undefined
            ? pawnCaptureSquares(from, piece.color)
            : pawnCaptureTargets(from, piece.color, occupancy);
      return uniqueSorted([...pushes, ...captures]);
    }
  }
}

/**
 * Squares a piece *attacks* — equivalently, the squares it covers or defends.
 *
 * This differs from `geometricTargets` in two ways that matter:
 *  - a square occupied by a friendly piece is still attacked (it is defended),
 *    whereas it is not a legal destination;
 *  - a pawn attacks only diagonally, so its pushes are excluded.
 *
 * These are the semantics of chess.js `attackers()`, which the test suite
 * cross-checks this function against.
 */
export function attackedSquares(
  piece: Piece,
  from: SquareName,
  options: { occupancy?: Occupancy } = {},
): SquareName[] {
  const { occupancy } = options;

  switch (piece.type) {
    case 'pawn':
      return pawnCaptureSquares(from, piece.color);
    case 'knight':
      return knightTargets(from);
    case 'king':
      return kingTargets(from);
    default:
      return slidingTargets(from, directionsFor(piece.type), {
        occupancy,
        moverColor: piece.color,
        blockerPolicy: 'include-any',
      });
  }
}

/**
 * For each sliding direction, the first occupied square encountered.
 * Backs the "which squares block this piece" drill.
 */
export function firstBlockers(
  from: SquareName,
  directions: readonly Vector[],
  occupancy: Occupancy,
): SquareName[] {
  const out: SquareName[] = [];
  const { file, rank } = toCoordinates(from);
  for (const direction of directions) {
    for (let distance = 1; distance < BOARD_SIZE; distance += 1) {
      const f = file + direction.df * distance;
      const r = rank + direction.dr * distance;
      if (!isOnBoard(f, r)) break;
      const square = toSquare(f, r);
      if (occupancy.get(square) !== undefined) {
        out.push(square);
        break;
      }
    }
  }
  return uniqueSorted(out);
}

/**
 * Squares strictly between two aligned squares. Empty when the squares do not
 * share a rank, file or diagonal, or when they are adjacent.
 */
export function squaresBetween(a: SquareName, b: SquareName): SquareName[] {
  const ca = toCoordinates(a);
  const cb = toCoordinates(b);
  const df = Math.sign(cb.file - ca.file);
  const dr = Math.sign(cb.rank - ca.rank);
  const fileSpan = Math.abs(cb.file - ca.file);
  const rankSpan = Math.abs(cb.rank - ca.rank);

  const aligned = fileSpan === 0 || rankSpan === 0 || fileSpan === rankSpan;
  if (!aligned || (fileSpan === 0 && rankSpan === 0)) return [];

  const steps = Math.max(fileSpan, rankSpan);
  const out: SquareName[] = [];
  for (let i = 1; i < steps; i += 1) {
    out.push(toSquare(ca.file + df * i, ca.rank + dr * i));
  }
  return out;
}

/**
 * Whole diagonal through a square in one bishop direction, including the
 * square itself — used by "name every square on this diagonal".
 */
export function fullLineThrough(from: SquareName, direction: Vector): SquareName[] {
  const forward = traceRay(from, direction);
  const backward = traceRay(from, { df: -direction.df, dr: -direction.dr });
  return uniqueSorted([...forward, ...backward, from]);
}

export function fileSquares(from: SquareName): SquareName[] {
  return fullLineThrough(from, { df: 0, dr: 1 });
}

export function rankSquares(from: SquareName): SquareName[] {
  return fullLineThrough(from, { df: 1, dr: 0 });
}

/** Both diagonals through a square, each including the square itself. */
export function diagonalsThrough(from: SquareName): SquareName[][] {
  return [
    fullLineThrough(from, { df: 1, dr: 1 }),
    fullLineThrough(from, { df: 1, dr: -1 }),
  ];
}
