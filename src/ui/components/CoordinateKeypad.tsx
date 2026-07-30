/**
 * The two-tap coordinate keypad.
 *
 * The spec is explicit that naming a square must never open the Android
 * keyboard, so this is the only coordinate entry path: tap a file, then tap a
 * rank. Buttons are full-width eighths with a 48px minimum height, which is
 * comfortably past Android's touch-target guidance even on a small phone.
 */

import { useCallback, useEffect, useState } from 'react';
import { FILE_LETTERS, RANK_DIGITS } from '../../core/chess/types';
import { normalizeSquare } from '../../core/chess/square';
import type { SquareName } from '../../core/chess/types';

export interface CoordinateKeypadProps {
  /** Called once both halves have been tapped. */
  onSubmit: (square: SquareName) => void;
  disabled?: boolean;
  /** Resets the half-entered coordinate when this changes. */
  resetKey?: string;
}

export function CoordinateKeypad({ onSubmit, disabled = false, resetKey }: CoordinateKeypadProps) {
  const [file, setFile] = useState<string | null>(null);

  // A new question clears anything half-typed.
  useEffect(() => {
    setFile(null);
  }, [resetKey]);

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
      <div className="keypad__readout" aria-live="polite" data-testid="keypad-readout">
        <span data-filled={file !== null ? 'true' : 'false'}>{file ?? ' '}</span>
        <span data-filled="false">{' '}</span>
      </div>

      <div className="keypad__row" role="group" aria-label="File">
        {FILE_LETTERS.map((letter) => (
          <button
            key={letter}
            type="button"
            className={`keypad__key${file === letter ? ' keypad__key--active' : ''}`}
            onClick={() => setFile(letter)}
            disabled={disabled}
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
               is chosen - this is what enforces the two-step entry. */
            disabled={disabled || file === null}
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
  disabled?: boolean;
}

/** Large light/dark buttons for the square-colour mode. */
export function ColorChoice({ onChoose, disabled = false }: ColorChoiceProps) {
  return (
    <div className="button-row" style={{ marginTop: 'var(--gap)' }}>
      <button
        type="button"
        className="button"
        style={{ background: 'var(--board-light)', color: '#14171c', minHeight: 64 }}
        onClick={() => onChoose('light')}
        disabled={disabled}
        data-testid="choice-light"
      >
        Light
      </button>
      <button
        type="button"
        className="button"
        style={{ background: 'var(--board-dark)', color: '#f4f6ee', minHeight: 64 }}
        onClick={() => onChoose('dark')}
        disabled={disabled}
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
  disabled?: boolean;
}

export function ChoiceButtons({ choices, onChoose, disabled = false }: ChoiceButtonsProps) {
  return (
    <div className="button-row" style={{ marginTop: 'var(--gap)' }}>
      {choices.map((choice) => (
        <button
          key={choice}
          type="button"
          className="button"
          style={{ flex: '1 1 45%' }}
          onClick={() => onChoose(choice)}
          disabled={disabled}
          data-testid={`choice-${choice.toLowerCase().replace(/\s+/g, '-')}`}
        >
          {choice}
        </button>
      ))}
    </div>
  );
}
