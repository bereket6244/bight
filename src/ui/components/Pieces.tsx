/**
 * The Bight piece set.
 *
 * Drawn here as original SVG rather than bundling an existing set. Lichess's
 * cburnett pieces are GPL and Chess.com's are proprietary; drawing our own
 * keeps the whole repository publishable under one permissive licence with no
 * third-party asset obligations.
 *
 * The shapes are traditional Staunton silhouettes: solid fills with a
 * contrasting outline, so they stay legible at the small sizes a phone board
 * uses and in both themes.
 */

import { memo } from 'react';
import type { Piece, PieceType } from '../../core/chess/types';

interface PieceProps {
  piece: Piece;
  /** Rendered size in CSS pixels; the SVG scales to it. */
  size?: number;
  className?: string;
}

/** Path data for each piece, drawn on a 45x45 grid. */
const PIECE_PATHS: Record<PieceType, string> = {
  pawn: 'M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z',
  knight:
    'M 22,10 C 32.5,11 38.5,18 38,39 L 15,39 C 15,30 25,32.5 23,18 M 24,18 C 24.38,20.91 18.45,25.37 16,27 C 13,29 13.18,31.34 11,31 C 9.958,30.06 12.41,27.96 11,28 C 10,28 11.19,29.23 10,30 C 9,30 5.997,31 6,26 C 6,24 12,14 12,14 C 12,14 13.89,12.1 14,10.5 C 13.27,9.506 13.5,8.5 13.5,7.5 C 14.5,6.5 16.5,10 16.5,10 L 18.5,10 C 18.5,10 19.28,8.008 21,7 C 22,7 22,10 22,10',
  bishop:
    'M 9,36 C 12.39,35.03 19.11,36.43 22.5,34 C 25.89,36.43 32.61,35.03 36,36 C 36,36 37.65,36.54 39,38 C 38.32,38.97 37.35,38.99 36,38.5 C 32.61,37.53 25.89,38.96 22.5,37.5 C 19.11,38.96 12.39,37.53 9,38.5 C 7.646,38.99 6.677,38.97 6,38 C 7.354,36.06 9,36 9,36 z M 15,32 C 17.5,34.5 27.5,34.5 30,32 C 30.5,30.5 30,30 30,30 C 30,27.5 27.5,26 27.5,26 C 33,24.5 33.5,14.5 22.5,10.5 C 11.5,14.5 12,24.5 17.5,26 C 17.5,26 15,27.5 15,30 C 15,30 14.5,30.5 15,32 z M 25,8 A 2.5,2.5 0 1,1 20,8 A 2.5,2.5 0 1,1 25,8 z',
  rook: 'M 9,39 L 36,39 L 36,36 L 9,36 L 9,39 z M 12.5,32 L 14,29.5 L 31,29.5 L 32.5,32 L 12.5,32 z M 12,36 L 12,32 L 33,32 L 33,36 L 12,36 z M 14,29.5 L 14,16.5 L 31,16.5 L 31,29.5 L 14,29.5 z M 14,16.5 L 11,14 L 34,14 L 31,16.5 L 14,16.5 z M 11,14 L 11,9 L 15,9 L 15,11 L 20,11 L 20,9 L 25,9 L 25,11 L 30,11 L 30,9 L 34,9 L 34,14 L 11,14 z',
  queen:
    'M 9,26 C 17.5,24.5 30,24.5 36,26 L 38.5,13.5 L 31,25 L 30.7,10.9 L 25.5,24.5 L 22.5,10 L 19.5,24.5 L 14.3,10.9 L 14,25 L 6.5,13.5 L 9,26 z M 9,26 C 9,28 10.5,28 11.5,30 C 12.5,31.5 12.5,31 12,33.5 C 10.5,34.5 10.5,36 10.5,36 C 9,37.5 11,38.5 11,38.5 C 17.5,39.5 27.5,39.5 34,38.5 C 34,38.5 35.5,37.5 34,36 C 34,36 34.5,34.5 33,33.5 C 32.5,31 32.5,31.5 33.5,30 C 34.5,28 36,28 36,26 L 9,26 z M 11.5,30 C 15,29 30,29 33.5,30 M 12,33.5 C 18,32.5 27,32.5 33,33.5',
  king: 'M 22.5,11.63 L 22.5,6 M 20,8 L 25,8 M 22.5,25 C 22.5,25 27,17.5 25.5,14.5 C 25.5,14.5 24.5,12 22.5,12 C 20.5,12 19.5,14.5 19.5,14.5 C 18,17.5 22.5,25 22.5,25 M 12.5,37 C 18,40.5 27,40.5 32.5,37 L 32.5,30 C 32.5,30 41.5,25.5 38.5,19.5 C 34.5,13 25,16 22.5,23.5 L 22.5,27 L 22.5,23.5 C 20,16 10.5,13 6.5,19.5 C 3.5,25.5 12.5,30 12.5,30 L 12.5,37 z',
};

/**
 * Pieces are pure geometry with no per-piece state, so memoising avoids
 * re-rendering all 32 of them whenever a highlight changes.
 */
export const ChessPiece = memo(function ChessPiece({ piece, size = 45, className }: PieceProps) {
  const isWhite = piece.color === 'white';
  return (
    <svg
      viewBox="0 0 45 45"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <g
        fill={isWhite ? 'var(--piece-white-fill)' : 'var(--piece-black-fill)'}
        stroke={isWhite ? 'var(--piece-white-stroke)' : 'var(--piece-black-stroke)'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={PIECE_PATHS[piece.type]} />
        {piece.type === 'knight' ? (
          <>
            {/* Eye and muzzle, so the knight reads as a horse at small sizes. */}
            <circle cx="15.5" cy="21.5" r="1.2" fill={isWhite ? 'var(--piece-white-stroke)' : 'var(--piece-black-stroke)'} />
            <path
              d="M 20.5,15 A 1.5,1 30 1,1 20,14 z"
              fill={isWhite ? 'var(--piece-white-stroke)' : 'var(--piece-black-stroke)'}
            />
          </>
        ) : null}
      </g>
    </svg>
  );
});

/** Full name for screen readers and feedback text. */
export function pieceName(piece: Piece): string {
  return `${piece.color} ${piece.type}`;
}
