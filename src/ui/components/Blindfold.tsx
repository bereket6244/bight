/**
 * Blindfold presentation: playing a sequence out, and rebuilding a position.
 *
 * Nothing here knows any chess. The playback hook is handed SAN and a
 * placement string per ply, already validated by `core/chess/sequence.ts`, and
 * only decides *when* to show them. The palette reports "this piece, on this
 * square" and lets the engine decide whether that is right.
 *
 * Playback state lives in a hook rather than inside the sequence component
 * because the session screen draws the board, and the board is exactly what
 * the reveal schedule controls.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChessPiece } from './Pieces';
import type { BlindfoldPresentation, MoveHistoryVisibility } from '../../core/training/types';
import type { PieceColor, PieceType } from '../../core/chess/types';
import { speak } from '../../services/speech';

/** Milliseconds between moves for each automatic pace. */
const PACE_MS: Record<string, number> = { slow: 2400, medium: 1500, fast: 850 };

/** How long the board stays up when a stage only flashes it. */
export const FLASH_REVEAL_MS = 1100;

/** Plies between checkpoints, used by the every-four and flash stages. */
export const CHECKPOINT_PLIES = 4;

/** How long a move stays readable when the history is meant to be hidden. */
const TRANSIENT_MOVE_MS = 1400;

/**
 * Whether the board should be drawn after `shown` plies.
 *
 * `checkpoint-flash` reports true at each checkpoint; the caller takes the
 * board away again once the flash has elapsed.
 */
export function boardVisibleAt(visibility: string, shown: number, total: number): boolean {
  switch (visibility) {
    case 'always':
    case 'each-ply':
      return true;
    case 'start-only':
      return shown === 0;
    case 'each-move':
      // After Black's reply, so a full move has been completed.
      return shown === 0 || shown % 2 === 0;
    case 'every-four':
      return shown === 0 || shown % CHECKPOINT_PLIES === 0;
    case 'checkpoint-flash':
      return shown === 0 || shown % CHECKPOINT_PLIES === 0 || shown === total;
    case 'never':
      return false;
    default:
      return shown === 0;
  }
}

/** Move list text for the plies revealed so far. */
export function historyText(
  presentation: BlindfoldPresentation,
  shown: number,
  history: MoveHistoryVisibility,
): string {
  if (history === 'hidden' || shown === 0) return '';

  const from = history === 'latest-only' ? shown - 1 : 0;
  const parts: string[] = [];
  for (let i = from; i < shown; i += 1) {
    // Ply index counted from White's first move, so numbering reads correctly
    // even when the sequence happens to start with Black to play.
    const ply = presentation.startTurn === 'white' ? i : i + 1;
    const moveNumber = Math.floor(ply / 2) + 1;
    if (ply % 2 === 0) parts.push(`${moveNumber}. ${presentation.san[i]}`);
    else if (i === from) parts.push(`${moveNumber}… ${presentation.san[i]}`);
    else parts.push(presentation.san[i] as string);
  }
  return parts.join(' ');
}

export interface Playback {
  /** Plies revealed so far. */
  shown: number;
  /** True once every ply has been played and the question can be answered. */
  finished: boolean;
  /** Placement string to draw right now, or null to draw nothing. */
  boardFen: string | null;
  /** The move list, already trimmed to what this history setting allows. */
  moves: string;
  /** True when the pace is manual and a tap is needed. */
  manual: boolean;
  advance: () => void;
}

/**
 * Plays a move sequence out to the user, one ply at a time.
 *
 * Manual pacing needs a tap, which is not the Next button the app refuses to
 * have: it advances the *presentation*, never an answer, and it is gone once
 * the sequence is done.
 */
export function useBlindfoldPlayback(
  presentation: BlindfoldPresentation | null,
  questionId: string,
  speakMoves: boolean,
): Playback {
  const total = presentation?.san.length ?? 0;
  const [shown, setShown] = useState(0);
  const [flashing, setFlashing] = useState(true);
  const [transient, setTransient] = useState(true);

  // A new question restarts the playthrough from the opening position.
  useEffect(() => {
    setShown(0);
    setFlashing(true);
    setTransient(true);
  }, [questionId]);

  const finished = presentation === null || shown >= total;

  const advance = useCallback(() => {
    setShown((current) => Math.min(total, current + 1));
    setFlashing(true);
    setTransient(true);
  }, [total]);

  // Automatic pacing. Manual pacing waits for a tap instead.
  const paceMs = presentation === null ? undefined : PACE_MS[presentation.pacing];
  useEffect(() => {
    if (paceMs === undefined || finished) return;
    const timer = window.setTimeout(advance, paceMs);
    return () => window.clearTimeout(timer);
  }, [paceMs, finished, shown, advance]);

  // The flashing stage shows the board for a moment and then removes it.
  const visibility = presentation?.visibility;
  useEffect(() => {
    if (visibility !== 'checkpoint-flash' || !flashing) return;
    const timer = window.setTimeout(() => setFlashing(false), FLASH_REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [visibility, flashing, shown]);

  // A hidden history still shows each move as it is played, briefly.
  const history = presentation?.history;
  useEffect(() => {
    if (history !== 'hidden' || shown === 0) return;
    setTransient(true);
    const timer = window.setTimeout(() => setTransient(false), TRANSIENT_MOVE_MS);
    return () => window.clearTimeout(timer);
  }, [history, shown]);

  const spokenRef = useRef<string>('');
  useEffect(() => {
    if (!speakMoves || presentation === null || shown === 0) return;
    const san = presentation.san[shown - 1];
    const key = `${questionId}:${shown}`;
    if (san === undefined || spokenRef.current === key) return;
    spokenRef.current = key;
    void speak(san);
  }, [speakMoves, shown, presentation, questionId]);

  if (presentation === null) {
    return { shown: 0, finished: true, boardFen: null, moves: '', manual: false, advance };
  }

  /*
   * The position after the last ply is never drawn, at any stage.
   *
   * That position is the answer to every tracking question, so showing it
   * would turn "hold the position in your head" into "read it off the board".
   * Even the most generous stage therefore stops one move short, and the user
   * always applies the final move themselves.
   */
  const atEnd = shown >= total;
  const visible =
    !atEnd &&
    (presentation.visibility === 'checkpoint-flash'
      ? flashing && boardVisibleAt(presentation.visibility, shown, total)
      : boardVisibleAt(presentation.visibility, shown, total));

  const boardFen = !visible
    ? null
    : shown === 0
      ? presentation.startFen
      : (presentation.fenAfterPly[shown - 1] ?? null);

  const moves =
    presentation.history === 'hidden'
      ? transient && shown > 0
        ? (presentation.san[shown - 1] as string)
        : ''
      : historyText(presentation, shown, presentation.history);

  return {
    shown,
    finished,
    boardFen,
    moves,
    manual: presentation.pacing === 'manual' && !finished,
    advance,
  };
}

export function BlindfoldSequenceView({
  playback,
  total,
  hideBoardEntirely,
}: {
  playback: Playback;
  total: number;
  hideBoardEntirely: boolean;
}) {
  return (
    <div className="blindfold" data-testid="blindfold-sequence">
      <div className="blindfold__row">
        <span className="blindfold__count" data-testid="blindfold-progress">
          {playback.finished ? 'Sequence complete' : `Move ${playback.shown} of ${total}`}
        </span>
        {hideBoardEntirely ? <span className="blindfold__tag">No board</span> : null}
      </div>

      <p className="blindfold__moves" data-testid="blindfold-moves">
        {playback.moves === '' ? ' ' : playback.moves}
      </p>

      {playback.manual ? (
        <button
          type="button"
          className="button button--primary blindfold__advance"
          onClick={playback.advance}
          data-testid="blindfold-advance"
        >
          {playback.shown === 0 ? 'Start the sequence' : 'Next move'}
        </button>
      ) : null}
    </div>
  );
}

const PALETTE_ORDER: PieceType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

export interface PiecePaletteProps {
  selected: { type: PieceType; color: PieceColor } | null;
  onSelect: (piece: { type: PieceType; color: PieceColor } | null) => void;
  /** True when the eraser is armed and the next tap clears a square. */
  erasing: boolean;
  onErase: (erasing: boolean) => void;
  /** Correction questions start with pieces on the board and need an eraser. */
  showEraser: boolean;
  flashWrong: boolean;
}

/**
 * The piece picker for reconstruction.
 *
 * Tap a piece, then tap a square. The selection stays armed, so a run of pawns
 * is six taps rather than twelve.
 *
 * Every piece is always offered, and none of them carries a count. A palette
 * that showed only the pieces still needed would be an answer key: it would
 * give away the whole material balance, which is exactly what the drill asks
 * the user to have held in their head.
 */
export function PiecePalette({
  selected,
  onSelect,
  erasing,
  onErase,
  showEraser,
  flashWrong,
}: PiecePaletteProps) {
  const colors: PieceColor[] = ['white', 'black'];

  return (
    <div className={`palette${flashWrong ? ' palette--wrong' : ''}`} data-testid="piece-palette">
      {colors.map((color) => (
        <div className="palette__row" key={color}>
          {PALETTE_ORDER.map((type) => {
            const active = selected !== null && selected.type === type && selected.color === color;
            return (
              <button
                type="button"
                key={`${color}-${type}`}
                className={`palette__piece${active ? ' palette__piece--active' : ''}`}
                aria-pressed={active}
                aria-label={`${color} ${type}`}
                data-testid={`palette-${color}-${type}`}
                onClick={() => {
                  onErase(false);
                  onSelect(active ? null : { type, color });
                }}
              >
                <ChessPiece piece={{ type, color }} size={28} />
              </button>
            );
          })}
        </div>
      ))}

      {showEraser ? (
        <button
          type="button"
          className={`button palette__eraser${erasing ? ' palette__eraser--active' : ''}`}
          aria-pressed={erasing}
          data-testid="palette-eraser"
          onClick={() => {
            onSelect(null);
            onErase(!erasing);
          }}
        >
          {erasing ? 'Tap a square to clear it' : 'Clear a square'}
        </button>
      ) : null}
    </div>
  );
}
