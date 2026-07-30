/**
 * Square identity: parsing, formatting, indexing, colour and orientation.
 *
 * Every value here is derived arithmetically. Nothing is table-driven from a
 * hand-written list, so there is no opportunity for a transcription error.
 */

import {
  FILE_LETTERS,
  RANK_DIGITS,
  type Coordinates,
  type FileIndex,
  type FileLetter,
  type Orientation,
  type RankDigit,
  type RankIndex,
  type SquareColor,
  type SquareIndex,
  type SquareName,
} from './types';

export const BOARD_SIZE = 8;
export const SQUARE_COUNT = BOARD_SIZE * BOARD_SIZE;

export function isFileIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < BOARD_SIZE;
}

export function isRankIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < BOARD_SIZE;
}

export function isOnBoard(file: number, rank: number): boolean {
  return isFileIndex(file) && isRankIndex(rank);
}

/** Builds a square name from zero-based coordinates. Throws if off-board. */
export function toSquare(file: FileIndex, rank: RankIndex): SquareName {
  if (!isOnBoard(file, rank)) {
    throw new RangeError(`Off-board coordinates: file=${file}, rank=${rank}`);
  }
  return `${FILE_LETTERS[file] as FileLetter}${RANK_DIGITS[rank] as RankDigit}`;
}

/** Builds a square name, or returns null when the coordinates are off-board. */
export function toSquareOrNull(file: number, rank: number): SquareName | null {
  return isOnBoard(file, rank) ? toSquare(file, rank) : null;
}

/** Parses "e4" into zero-based coordinates. Throws on malformed input. */
export function toCoordinates(square: SquareName): Coordinates {
  const parsed = parseSquare(square);
  if (parsed === null) {
    throw new RangeError(`Not a valid square name: ${String(square)}`);
  }
  return parsed;
}

/**
 * Lenient parser for arbitrary user/voice input. Accepts surrounding
 * whitespace and any letter case; rejects everything else.
 */
export function parseSquare(input: string): Coordinates | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length !== 2) return null;
  const file = FILE_LETTERS.indexOf(trimmed[0] as FileLetter);
  const rank = RANK_DIGITS.indexOf(trimmed[1] as RankDigit);
  if (file === -1 || rank === -1) return null;
  return { file, rank };
}

/** Returns a normalised square name, or null when the input is not a square. */
export function normalizeSquare(input: string): SquareName | null {
  const coords = parseSquare(input);
  return coords === null ? null : toSquare(coords.file, coords.rank);
}

export function isSquareName(input: unknown): input is SquareName {
  return typeof input === 'string' && parseSquare(input) !== null;
}

export function squareToIndex(square: SquareName): SquareIndex {
  const { file, rank } = toCoordinates(square);
  return rank * BOARD_SIZE + file;
}

export function indexToSquare(index: SquareIndex): SquareName {
  if (!Number.isInteger(index) || index < 0 || index >= SQUARE_COUNT) {
    throw new RangeError(`Off-board square index: ${index}`);
  }
  return toSquare(index % BOARD_SIZE, Math.floor(index / BOARD_SIZE));
}

/**
 * Square colour from file/rank parity.
 *
 * a1 (file 0, rank 0) is dark, which fixes the parity for the whole board:
 * an even file+rank sum is dark, an odd sum is light.
 */
export function squareColor(square: SquareName): SquareColor {
  const { file, rank } = toCoordinates(square);
  return (file + rank) % 2 === 0 ? 'dark' : 'light';
}

export function isLightSquare(square: SquareName): boolean {
  return squareColor(square) === 'light';
}

export function isDarkSquare(square: SquareName): boolean {
  return squareColor(square) === 'dark';
}

/** All 64 squares in index order, a1 … h8. */
export const ALL_SQUARES: readonly SquareName[] = Object.freeze(
  Array.from({ length: SQUARE_COUNT }, (_, i) => indexToSquare(i)),
);

export function fileOf(square: SquareName): FileIndex {
  return toCoordinates(square).file;
}

export function rankOf(square: SquareName): RankIndex {
  return toCoordinates(square).rank;
}

export function fileLetterOf(square: SquareName): FileLetter {
  return FILE_LETTERS[fileOf(square)] as FileLetter;
}

export function rankDigitOf(square: SquareName): RankDigit {
  return RANK_DIGITS[rankOf(square)] as RankDigit;
}

/** Squares sharing a file, rank or diagonal — the basic "alignment" relations. */
export function sameFile(a: SquareName, b: SquareName): boolean {
  return fileOf(a) === fileOf(b);
}

export function sameRank(a: SquareName, b: SquareName): boolean {
  return rankOf(a) === rankOf(b);
}

export function sameDiagonal(a: SquareName, b: SquareName): boolean {
  const ca = toCoordinates(a);
  const cb = toCoordinates(b);
  return Math.abs(ca.file - cb.file) === Math.abs(ca.rank - cb.rank) && a !== b;
}

/** Chebyshev distance — the number of king moves between two squares. */
export function kingDistance(a: SquareName, b: SquareName): number {
  const ca = toCoordinates(a);
  const cb = toCoordinates(b);
  return Math.max(Math.abs(ca.file - cb.file), Math.abs(ca.rank - cb.rank));
}

/**
 * Maps a square to its position in the rendered grid.
 *
 * Row 0 is the top row as drawn. With white at the bottom, rank 8 is drawn
 * first; with black at the bottom the board is rotated a half-turn, so both
 * axes are mirrored.
 */
export function toDisplayPosition(
  square: SquareName,
  orientation: Orientation,
): { row: number; col: number } {
  const { file, rank } = toCoordinates(square);
  return orientation === 'white'
    ? { row: BOARD_SIZE - 1 - rank, col: file }
    : { row: rank, col: BOARD_SIZE - 1 - file };
}

/** Inverse of `toDisplayPosition`: which square is drawn at a grid cell. */
export function fromDisplayPosition(
  row: number,
  col: number,
  orientation: Orientation,
): SquareName {
  if (!isOnBoard(col, row)) {
    throw new RangeError(`Off-board display position: row=${row}, col=${col}`);
  }
  return orientation === 'white'
    ? toSquare(col, BOARD_SIZE - 1 - row)
    : toSquare(BOARD_SIZE - 1 - col, row);
}

/** Squares in the order they are drawn for the given orientation. */
export function squaresInDisplayOrder(orientation: Orientation): SquareName[] {
  const squares: SquareName[] = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      squares.push(fromDisplayPosition(row, col, orientation));
    }
  }
  return squares;
}

/**
 * Board quadrants, named from White's point of view.
 * Files a-d are queenside, e-h kingside; ranks 1-4 are White's half.
 */
export type Quadrant = 'queenside-white' | 'kingside-white' | 'queenside-black' | 'kingside-black';

export const QUADRANTS: readonly Quadrant[] = Object.freeze([
  'queenside-white',
  'kingside-white',
  'queenside-black',
  'kingside-black',
]);

export function quadrantOf(square: SquareName): Quadrant {
  const { file, rank } = toCoordinates(square);
  const kingside = file >= 4;
  const blackHalf = rank >= 4;
  if (kingside) return blackHalf ? 'kingside-black' : 'kingside-white';
  return blackHalf ? 'queenside-black' : 'queenside-white';
}

export function squaresInQuadrant(quadrant: Quadrant): SquareName[] {
  return ALL_SQUARES.filter((sq) => quadrantOf(sq) === quadrant);
}

export const QUADRANT_LABELS: Record<Quadrant, string> = {
  'queenside-white': 'Queenside, White half (a1-d4)',
  'kingside-white': 'Kingside, White half (e1-h4)',
  'queenside-black': 'Queenside, Black half (a5-d8)',
  'kingside-black': 'Kingside, Black half (e5-h8)',
};
