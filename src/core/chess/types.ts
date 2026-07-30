/**
 * Core chess types for Bight.
 *
 * Everything in `src/core/chess` is deterministic and free of UI or storage
 * concerns so it can be exhaustively unit-tested and reused by every training
 * mode. No training mode is allowed to re-implement these rules.
 */

export const FILE_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
export const RANK_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

export type FileLetter = (typeof FILE_LETTERS)[number];
export type RankDigit = (typeof RANK_DIGITS)[number];

/** Algebraic square name, e.g. "e4". Exactly 64 values exist. */
export type SquareName = `${FileLetter}${RankDigit}`;

/**
 * Zero-based file index. 0 = a-file … 7 = h-file.
 * Kept as a plain number for arithmetic; use `isFileIndex` to validate input.
 */
export type FileIndex = number;

/** Zero-based rank index. 0 = rank 1 … 7 = rank 8. */
export type RankIndex = number;

/** Zero-based square index, `rank * 8 + file`. 0 = a1, 63 = h8. */
export type SquareIndex = number;

export interface Coordinates {
  file: FileIndex;
  rank: RankIndex;
}

/** Colour of a board square, decided purely by file/rank parity. */
export type SquareColor = 'light' | 'dark';

/** Colour of a piece / the side to move. */
export type PieceColor = 'white' | 'black';

export type PieceType = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';

export interface Piece {
  type: PieceType;
  color: PieceColor;
}

/** A piece placed on a specific square. */
export interface PlacedPiece extends Piece {
  square: SquareName;
}

/** Which side is shown at the bottom of the board. */
export type Orientation = 'white' | 'black';

/**
 * Sparse occupancy map. Absent key means the square is empty.
 * Used by the geometry layer, which never needs full position semantics.
 */
export type Occupancy = ReadonlyMap<SquareName, Piece>;

/** A single step on the board expressed as a (file, rank) delta. */
export interface Vector {
  df: number;
  dr: number;
}

/**
 * Distinguishes the two answer semantics the app trains. Mixing these up
 * silently is the single most likely source of wrong answers, so the
 * distinction is carried in the type system and shown in the UI.
 */
export type MoveSemantics =
  /** Movement pattern only. Occupancy, turn order, check and pins are ignored. */
  | 'geometry'
  /** Destinations legal in a complete position, delegated to chess.js. */
  | 'legal';

export const PIECE_LETTERS: Record<PieceType, string> = {
  pawn: 'p',
  knight: 'n',
  bishop: 'b',
  rook: 'r',
  queen: 'q',
  king: 'k',
};

export const LETTER_TO_PIECE: Record<string, PieceType> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};
