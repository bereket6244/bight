/**
 * The Bight board.
 *
 * Written rather than adapted from Chessground because the modes need
 * behaviour a playing board does not offer: taps that register on a square
 * even when a decorative piece sits there, arbitrary multi-square selection
 * with a submit step, ordered route tracing, timed reveal-then-hide, and a
 * fully hidden board for blindfold work. Each square is a real <button>, which
 * also gives keyboard and screen-reader access for free.
 *
 * Every square is 1/8th of the board, so the board scales to any width and the
 * touch targets grow with it - on a large phone each square is comfortably
 * past the 48dp Android guidance.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BOARD_SIZE,
  fileLetterOf,
  rankDigitOf,
  squaresInDisplayOrder,
  toDisplayPosition,
} from '../../core/chess/square';
import { occupancyFromFen } from '../../core/chess/position';
import type { Orientation, Piece, SquareName } from '../../core/chess/types';
import type { LabelMode } from '../../core/training/types';
import { ChessPiece } from './Pieces';

export type SquareMark =
  /** Part of the prompt: "this square". */
  | 'prompt'
  /** The user has selected it as part of their answer. */
  | 'selected'
  /** Correct, shown in feedback. */
  | 'correct'
  /** Wrong, shown in feedback. */
  | 'wrong'
  /** Should have been selected, shown in feedback. */
  | 'missed'
  /** A legal/geometric destination hint. */
  | 'hint'
  /** The piece currently picked up. */
  | 'origin'
  /** Where the last move started. */
  | 'last-from'
  /** Where the last move ended. */
  | 'last-to';

/**
 * What the board is for right now.
 *
 * This used to be a single `hidden` boolean, which conflated two states that
 * need opposite treatment and shipped a genuinely unusable screen: in
 * Blindfold vs Computer the board *is* the move-entry surface, so hiding it
 * left the user with nothing to tap, while in reconstruction the hidden board
 * reserved a board-sized blank gap the user had to scroll past. Both were
 * reported from a real Android device.
 */
export type BoardDisplayMode =
  /** Pieces drawn, normal interaction. */
  | 'position'
  /**
   * The grid and its labels are drawn; the pieces are not. Taps still work,
   * so a blindfold game can be played on it. Nothing about the hidden
   * position may be exposed — not through pieces, not through hint marks, not
   * through square labels.
   */
  | 'empty-input'
  /**
   * No board at all, and **no layout space reserved**. For when there is
   * nothing to look at and nothing to tap.
   */
  | 'collapsed';

export interface BoardProps {
  /** FEN placement field. */
  fen: string;
  orientation: Orientation;
  labels: LabelMode;
  /** Marks drawn on squares, keyed by square. */
  marks?: ReadonlyMap<SquareName, SquareMark>;
  /** Ordinal badges, used to number a traced route. */
  badges?: ReadonlyMap<SquareName, number>;
  onSquareTap?: (square: SquareName) => void;
  /** Drag-and-drop and tap-to-move handler. */
  onMove?: (from: SquareName, to: SquareName) => void;
  /** Squares whose pieces may be picked up. Empty means none are movable. */
  movableSquares?: readonly SquareName[];
  /**
   * Pieces are scenery: they never intercept a tap, so coordinate drills work
   * on a board with pieces on it.
   */
  decorativePieces?: boolean;
  /**
   * What the board is for. Defaults to `position`.
   *
   * `collapsed` renders nothing at all, so the caller does not need to guard
   * the element itself — but a caller that has nothing to show may simply not
   * render a `<Board>`.
   */
  displayMode?: BoardDisplayMode;
  /**
   * Milliseconds before prompt marks are hidden. Undefined keeps them visible.
   * The board keeps rendering; only the marks disappear.
   */
  revealMs?: number;
  disabled?: boolean;
  /** Accessible description of what the board is showing. */
  ariaLabel?: string;
}

const FILES_ARRAY = Array.from({ length: BOARD_SIZE }, (_, i) => i);

function isDarkSquareAt(square: SquareName): boolean {
  return (square.charCodeAt(0) - 97 + (Number(square[1]) - 1)) % 2 === 0;
}

export const Board = memo(function Board({
  fen,
  orientation,
  labels,
  marks,
  badges,
  onSquareTap,
  onMove,
  movableSquares = [],
  decorativePieces = false,
  displayMode = 'position',
  revealMs,
  disabled = false,
  ariaLabel = 'Chess board',
}: BoardProps) {
  const showPieces = displayMode === 'position';
  const occupancy = useMemo(() => {
    try {
      return occupancyFromFen(fen);
    } catch {
      // A malformed FEN must not take the whole session down.
      return new Map<SquareName, Piece>();
    }
  }, [fen]);

  const squares = useMemo(() => squaresInDisplayOrder(orientation), [orientation]);
  const movable = useMemo(() => new Set(movableSquares), [movableSquares]);

  const [selectedOrigin, setSelectedOrigin] = useState<SquareName | null>(null);
  const [dragOver, setDragOver] = useState<SquareName | null>(null);
  const [promptVisible, setPromptVisible] = useState(true);

  // Reveal-then-hide. Restarts whenever the prompt changes, keyed by fen and
  // the marks identity so a new question always gets a fresh reveal.
  useEffect(() => {
    if (revealMs === undefined) {
      setPromptVisible(true);
      return;
    }
    setPromptVisible(true);
    const timer = window.setTimeout(() => setPromptVisible(false), revealMs);
    return () => window.clearTimeout(timer);
  }, [revealMs, fen, marks]);

  // A new question clears any half-finished move selection.
  useEffect(() => {
    setSelectedOrigin(null);
  }, [fen]);

  const handleSquareActivate = useCallback(
    (square: SquareName) => {
      if (disabled) return;

      // Move flow: first tap picks a movable piece up, second tap drops it.
      if (onMove !== undefined && movable.size > 0) {
        if (selectedOrigin === null) {
          if (movable.has(square)) {
            setSelectedOrigin(square);
            return;
          }
        } else if (selectedOrigin === square) {
          // Tapping the piece again puts it back down.
          setSelectedOrigin(null);
          return;
        } else {
          onMove(selectedOrigin, square);
          setSelectedOrigin(null);
          return;
        }
      }

      onSquareTap?.(square);
    },
    [disabled, movable, onMove, onSquareTap, selectedOrigin],
  );

  const dragSource = useRef<SquareName | null>(null);

  const markFor = useCallback(
    (square: SquareName): SquareMark | undefined => {
      const mark = marks?.get(square);
      // Prompt marks are the ones that flash and hide; answers and feedback
      // must stay put.
      if (mark === 'prompt' && !promptVisible) return undefined;
      return mark;
    },
    [marks, promptVisible],
  );

  // Nothing to look at and nothing to tap: render nothing, so no layout space
  // is reserved. A hidden-but-present board left a board-sized blank gap the
  // user had to scroll past, which is what a real device found.
  if (displayMode === 'collapsed') return null;

  return (
    <div
      className={`board-wrap${showPieces ? '' : ' board-wrap--empty'}`}
      data-testid="board"
      data-display-mode={displayMode}
      data-orientation={orientation}
    >
      <div
        className="board"
        role="grid"
        aria-label={
          showPieces
            ? ariaLabel
            : 'Empty coordinate board. Select origin, then destination.'
        }
      >
        {squares.map((square) => {
          const piece = occupancy.get(square);
          const mark = markFor(square);
          const badge = badges?.get(square);
          const isOrigin = selectedOrigin === square;
          const showLabelFile =
            labels !== 'never' && toDisplayPosition(square, orientation).row === BOARD_SIZE - 1;
          const showLabelRank =
            labels !== 'never' && toDisplayPosition(square, orientation).col === 0;

          const classes = [
            'square',
            isDarkSquareAt(square) ? 'square--dark' : 'square--light',
            mark !== undefined ? `square--${mark}` : '',
            isOrigin ? 'square--origin' : '',
            dragOver === square ? 'square--dragover' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <button
              key={square}
              type="button"
              role="gridcell"
              className={classes}
              data-square={square}
              data-testid={`square-${square}`}
              aria-label={
                // On an empty-input board the label is the coordinate and
                // nothing else. Naming the piece would read the hidden
                // position out to a screen reader.
                piece === undefined || !showPieces
                  ? square
                  : `${square}, ${piece.color} ${piece.type}`
              }
              aria-pressed={mark === 'selected'}
              disabled={disabled}
              onClick={() => handleSquareActivate(square)}
              onDragOver={(event) => {
                if (onMove === undefined) return;
                event.preventDefault();
                setDragOver(square);
              }}
              onDragLeave={() => setDragOver((current) => (current === square ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(null);
                const from = dragSource.current;
                if (from !== null && from !== square) onMove?.(from, square);
                dragSource.current = null;
                setSelectedOrigin(null);
              }}
            >
              {/* Labels and the last-move marks belong to the grid, not to
                  the position, so they survive into `empty-input`. Pieces,
                  hint dots and badges do not: each of them would give away
                  something the user is meant to be holding in their head. */}
              {showLabelFile ? (
                <span className="square-label square-label--file" aria-hidden="true">
                  {fileLetterOf(square)}
                </span>
              ) : null}
              {showLabelRank ? (
                <span className="square-label square-label--rank" aria-hidden="true">
                  {rankDigitOf(square)}
                </span>
              ) : null}
              {showPieces ? (
                <>
                  {piece === undefined ? null : (
                    <span
                      className={`piece${decorativePieces ? ' piece--decorative' : ''}`}
                      draggable={onMove !== undefined && movable.has(square)}
                      onDragStart={() => {
                        dragSource.current = square;
                        setSelectedOrigin(square);
                      }}
                      onDragEnd={() => {
                        dragSource.current = null;
                        setSelectedOrigin(null);
                      }}
                      data-testid={`piece-${square}`}
                    >
                      <ChessPiece piece={piece} />
                    </span>
                  )}
                  {mark === 'hint' ? <span className="hint-dot" aria-hidden="true" /> : null}
                  {badge !== undefined ? <span className="square-badge">{badge}</span> : null}
                </>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
});

/** Convenience for building the marks map from the usual pieces of state. */
export function buildMarks(options: {
  prompt?: readonly SquareName[];
  selected?: readonly SquareName[];
  correct?: readonly SquareName[];
  wrong?: readonly SquareName[];
  missed?: readonly SquareName[];
  hints?: readonly SquareName[];
}): Map<SquareName, SquareMark> {
  const marks = new Map<SquareName, SquareMark>();
  // Later entries win, so feedback overrides selection overrides hints.
  for (const square of options.hints ?? []) marks.set(square, 'hint');
  for (const square of options.prompt ?? []) marks.set(square, 'prompt');
  for (const square of options.selected ?? []) marks.set(square, 'selected');
  for (const square of options.missed ?? []) marks.set(square, 'missed');
  for (const square of options.wrong ?? []) marks.set(square, 'wrong');
  for (const square of options.correct ?? []) marks.set(square, 'correct');
  return marks;
}

export { FILES_ARRAY };
