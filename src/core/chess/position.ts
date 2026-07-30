/**
 * Lightweight position handling: FEN placement parsing, occupancy maps and
 * the standard starting array.
 *
 * Bight needs to describe boards that are *not* legal chess positions — a lone
 * knight on d4, or three bishops and no kings — because vision drills care
 * about geometry, not legality. chess.js rejects such positions, so the
 * occupancy layer has its own parser. `legal.ts` is where chess.js takes over
 * for genuinely legal positions.
 */

import { ALL_SQUARES, toSquare, toCoordinates, BOARD_SIZE } from './square';
import {
  LETTER_TO_PIECE,
  PIECE_LETTERS,
  type Occupancy,
  type Piece,
  type PieceColor,
  type PieceType,
  type PlacedPiece,
  type SquareName,
} from './types';

export const EMPTY_BOARD_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';
export const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export type MutableOccupancy = Map<SquareName, Piece>;

export function emptyOccupancy(): MutableOccupancy {
  return new Map<SquareName, Piece>();
}

export function cloneOccupancy(occupancy: Occupancy): MutableOccupancy {
  return new Map(occupancy);
}

export function occupancyFromPieces(pieces: readonly PlacedPiece[]): MutableOccupancy {
  const map = emptyOccupancy();
  for (const { square, type, color } of pieces) {
    map.set(square, { type, color });
  }
  return map;
}

export function occupancyToPieces(occupancy: Occupancy): PlacedPiece[] {
  return ALL_SQUARES.filter((square) => occupancy.has(square)).map((square) => {
    const piece = occupancy.get(square) as Piece;
    return { square, type: piece.type, color: piece.color };
  });
}

function pieceFromFenChar(char: string): Piece | null {
  const type = LETTER_TO_PIECE[char.toLowerCase()];
  if (type === undefined) return null;
  const color: PieceColor = char === char.toUpperCase() ? 'white' : 'black';
  return { type, color };
}

function fenCharFromPiece(piece: Piece): string {
  const letter = PIECE_LETTERS[piece.type];
  return piece.color === 'white' ? letter.toUpperCase() : letter;
}

/**
 * Parses the placement field of a FEN string into an occupancy map.
 * Accepts a full FEN or just the placement field. Throws on malformed input.
 */
export function occupancyFromFen(fen: string): MutableOccupancy {
  const placement = fen.trim().split(/\s+/)[0] ?? '';
  const rows = placement.split('/');
  if (rows.length !== BOARD_SIZE) {
    throw new SyntaxError(`FEN placement needs ${BOARD_SIZE} ranks, got ${rows.length}: ${fen}`);
  }

  const map = emptyOccupancy();
  rows.forEach((row, rowIndex) => {
    // FEN lists rank 8 first, so row 0 is rank index 7.
    const rank = BOARD_SIZE - 1 - rowIndex;
    let file = 0;
    for (const char of row) {
      if (/[1-8]/.test(char)) {
        file += Number(char);
        continue;
      }
      const piece = pieceFromFenChar(char);
      if (piece === null) {
        throw new SyntaxError(`Unknown FEN piece character "${char}" in: ${fen}`);
      }
      if (file >= BOARD_SIZE) {
        throw new SyntaxError(`FEN rank "${row}" overflows the board in: ${fen}`);
      }
      map.set(toSquare(file, rank), piece);
      file += 1;
    }
    if (file !== BOARD_SIZE) {
      throw new SyntaxError(`FEN rank "${row}" describes ${file} files, expected ${BOARD_SIZE}`);
    }
  });

  return map;
}

/** Serialises an occupancy map back to a FEN placement field. */
export function fenPlacementFromOccupancy(occupancy: Occupancy): string {
  const rows: string[] = [];
  for (let rank = BOARD_SIZE - 1; rank >= 0; rank -= 1) {
    let row = '';
    let gap = 0;
    for (let file = 0; file < BOARD_SIZE; file += 1) {
      const piece = occupancy.get(toSquare(file, rank));
      if (piece === undefined) {
        gap += 1;
        continue;
      }
      if (gap > 0) {
        row += String(gap);
        gap = 0;
      }
      row += fenCharFromPiece(piece);
    }
    if (gap > 0) row += String(gap);
    rows.push(row);
  }
  return rows.join('/');
}

/** Full FEN with sensible defaults for the fields Bight does not model. */
export function fenFromOccupancy(
  occupancy: Occupancy,
  options: { turn?: PieceColor; castling?: string; enPassant?: string } = {},
): string {
  const { turn = 'white', castling = '-', enPassant = '-' } = options;
  return `${fenPlacementFromOccupancy(occupancy)} ${turn === 'white' ? 'w' : 'b'} ${castling} ${enPassant} 0 1`;
}

export function startingOccupancy(): MutableOccupancy {
  return occupancyFromFen(STARTING_FEN);
}

const BACK_RANK_ORDER: readonly PieceType[] = [
  'rook',
  'knight',
  'bishop',
  'queen',
  'king',
  'bishop',
  'knight',
  'rook',
];

/**
 * Built arithmetically rather than parsed, so the FEN constant and this
 * function cross-check each other in tests.
 */
export function buildStartingPieces(): PlacedPiece[] {
  const pieces: PlacedPiece[] = [];
  for (let file = 0; file < BOARD_SIZE; file += 1) {
    pieces.push({ square: toSquare(file, 0), type: BACK_RANK_ORDER[file], color: 'white' });
    pieces.push({ square: toSquare(file, 1), type: 'pawn', color: 'white' });
    pieces.push({ square: toSquare(file, 6), type: 'pawn', color: 'black' });
    pieces.push({ square: toSquare(file, 7), type: BACK_RANK_ORDER[file], color: 'black' });
  }
  return pieces;
}

export function isSquareEmpty(occupancy: Occupancy, square: SquareName): boolean {
  return !occupancy.has(square);
}

export function emptySquares(occupancy: Occupancy): SquareName[] {
  return ALL_SQUARES.filter((square) => !occupancy.has(square));
}

/** Squares occupied by a given colour. */
export function squaresOccupiedBy(occupancy: Occupancy, color: PieceColor): SquareName[] {
  return ALL_SQUARES.filter((square) => occupancy.get(square)?.color === color);
}

export function findPieces(occupancy: Occupancy, predicate: (piece: Piece) => boolean): SquareName[] {
  return ALL_SQUARES.filter((square) => {
    const piece = occupancy.get(square);
    return piece !== undefined && predicate(piece);
  });
}

/**
 * True when a position could be handed to chess.js — it needs exactly one king
 * per side and no pawns on the first or last rank.
 */
export function isPlausibleLegalPosition(occupancy: Occupancy): boolean {
  const whiteKings = findPieces(occupancy, (p) => p.type === 'king' && p.color === 'white');
  const blackKings = findPieces(occupancy, (p) => p.type === 'king' && p.color === 'black');
  if (whiteKings.length !== 1 || blackKings.length !== 1) return false;

  const badPawn = findPieces(occupancy, (p) => p.type === 'pawn').some((square) => {
    const { rank } = toCoordinates(square);
    return rank === 0 || rank === BOARD_SIZE - 1;
  });
  return !badPawn;
}
