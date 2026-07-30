/**
 * Answer controls: the two-tap coordinate keypad, the light/dark buttons, and
 * generic choice buttons.
 *
 * None of them has a confirm step. Choosing an answer *is* submitting it —
 * the engine decides whether that completes the question. A wrong answer is
 * signalled by a brief red flash (`flashWrong`) and the control stays live so
 * the user can try again immediately.
 *
 * The keypad is the only coordinate entry path: naming a square must never
 * open the Android keyboard, so there is no text input anywhere.
 */

import { useCallback, useEffect, useState } from 'react';
import { FILE_LETTERS, RANK_DIGITS } from '../../core/chess/types';
import { normalizeSquare } from '../../core/chess/square';
import type { SquareName } from '../../core/chess/types';

export interface CoordinateKeypadProps {
  /** Called as soon as both halves have been tapped. */
  onSubmit: (square: SquareName) => void;
  /** Resets the half-entered coordinate when this changes. */
  resetKey?: string;
  /** Flash the readout red — the last coordinate was wrong. */
  flashWrong?: boolean;
}

export function CoordinateKeypad({ onSubmit, resetKey, flashWrong = false }: CoordinateKeypadProps) {
  const [file, setFile] = useState<string | null>(null);

  // A new question clears anything half-typed.
  useEffect(() => {
    setFile(null);
  }, [resetKey]);

  // A rejected coordinate clears the entry so the next attempt starts clean.
  useEffect(() => {
    if (flashWrong) setFile(null);
  }, [flashWrong]);

  const chooseRank = useCallback(
    (rank: string) => {
      if (file === null) return;
      const square = normalizeSquare(`${file}${rank}`);
      setFile(null);
      if (square !== null) onSubmit(square);
    },
    [file, onSubmit],
  );

  return (
    <div className="keypad" data-testid="keypad">
      <div
        className={`keypad__readout${flashWrong ? ' keypad__readout--wrong' : ''}`}
        aria-live="polite"
        data-testid="keypad-readout"
      >
        <span data-filled={file !== null ? 'true' : 'false'}>{file ?? ' '}</span>
        <span data-filled="false">{' '}</span>
      </div>

      <div className="keypad__row" role="group" aria-label="File">
        {FILE_LETTERS.map((letter) => (
          <button
            key={letter}
            type="button"
            className={`keypad__key${file === letter ? ' keypad__key--active' : ''}`}
            onClick={() => setFile(letter)}
            aria-pressed={file === letter}
            data-testid={`key-file-${letter}`}
          >
            {letter}
          </button>
        ))}
      </div>

      <div className="keypad__row" role="group" aria-label="Rank">
        {RANK_DIGITS.map((digit) => (
          <button
            key={digit}
            type="button"
            className="keypad__key"
            onClick={() => chooseRank(digit)}
            /* A rank alone is not an answer, so ranks stay inert until a file
               is chosen — this is what enforces the two-step entry. */
            disabled={file === null}
            data-testid={`key-rank-${digit}`}
          >
            {digit}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface ColorChoiceProps {
  onChoose: (color: 'light' | 'dark') => void;
  flashWrong?: boolean;
}

/** Large light/dark buttons for the square-colour mode. */
export function ColorChoice({ onChoose, flashWrong = false }: ColorChoiceProps) {
  const flash = flashWrong ? ' answer-button--wrong' : '';
  return (
    <div className="button-row" style={{ marginTop: 'var(--gap)' }}>
      <button
        type="button"
        className={`button answer-button${flash}`}
        style={{ background: 'var(--board-light)', color: '#14171c', minHeight: 64 }}
        onClick={() => onChoose('light')}
        data-testid="choice-light"
      >
        Light
      </button>
      <button
        type="button"
        className={`button answer-button${flash}`}
        style={{ background: 'var(--board-dark)', color: '#f4f6ee', minHeight: 64 }}
        onClick={() => onChoose('dark')}
        data-testid="choice-dark"
      >
        Dark
      </button>
    </div>
  );
}

export interface ChoiceButtonsProps {
  choices: readonly string[];
  onChoose: (choice: string) => void;
  flashWrong?: boolean;
}

export function ChoiceButtons({ choices, onChoose, flashWrong = false }: ChoiceButtonsProps) {
  return (
    <div className="button-row" style={{ marginTop: 'var(--gap)' }}>
      {choices.map((choice) => (
        <button
          key={choice}
          type="button"
          className={`button answer-button${flashWrong ? ' answer-button--wrong' : ''}`}
          style={{ flex: '1 1 45%' }}
          onClick={() => onChoose(choice)}
          data-testid={`choice-${choice.toLowerCase().replace(/\s+/g, '-')}`}
        >
          {choice}
        </button>
      ))}
    </div>
  );
}
