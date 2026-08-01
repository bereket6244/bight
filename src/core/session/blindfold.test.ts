/**
 * The session engine's blindfold behaviour: placing pieces, repairing a
 * damaged position, and recording hints.
 *
 * These drive the real reconstruction generator rather than a hand-written
 * question, so the interaction is tested against the questions users actually
 * get, including the awkward ones with thirty pieces on the board.
 */

import { describe, expect, it } from 'vitest';
import {
  placePiece,
  recordHint,
  removePlacement,
  startSession,
  type SessionState,
} from './engine';
import { defaultSettings, type SessionSettings } from './settings';
import type { RequiredPlacement } from '../training/types';
import type { SquareName } from '../chess/types';
import { ALL_SQUARES } from '../chess/square';

const T0 = 1_700_000_000_000;

function session(variantId: string, overrides: Partial<SessionSettings> = {}): SessionState {
  const settings: SessionSettings = {
    ...defaultSettings('blindfold-reconstruction', variantId),
    blindfoldPlies: 6,
    ...overrides,
  };
  return startSession(settings, { seed: 4242 }, T0);
}

function required(state: SessionState): RequiredPlacement[] {
  const expected = state.current?.expected;
  if (expected?.kind !== 'placement') throw new Error('Not a placement question');
  return [...expected.required];
}

/** Places every piece the question asks for, one tap at a time. */
function placeAll(state: SessionState, pieces: readonly RequiredPlacement[]): SessionState {
  let current = state;
  let clock = T0;
  for (const piece of pieces) {
    clock += 500;
    current = placePiece(current, piece, 'touch', {}, clock);
  }
  return current;
}

describe('reconstruction: placing pieces', () => {
  it('starts a full reconstruction with an empty board', () => {
    const state = session('full');
    expect(state.placed).toEqual([]);
    expect(state.current?.board.fen).toBe('8/8/8/8/8/8/8/8');
  });

  it('completes the question the moment the last piece goes down, with no Submit', () => {
    const state = session('full');
    const pieces = required(state);
    expect(pieces.length).toBeGreaterThan(2);

    // One short of the answer: still the same question, nothing recorded.
    const nearly = placeAll(state, pieces.slice(0, -1));
    expect(nearly.questionsCompleted).toBe(0);
    expect(nearly.attempts).toHaveLength(0);
    expect(nearly.placed).toHaveLength(pieces.length - 1);

    const done = placeAll(nearly, pieces.slice(-1));
    expect(done.questionsCompleted).toBe(1);
    expect(done.correctCount).toBe(1);
    expect(done.attempts[0]?.correct).toBe(true);
    // And the next question is already up.
    expect(done.current).not.toBeNull();
  });

  it('rejects a piece that does not belong and does not leave it standing', () => {
    const state = session('full');
    const pieces = required(state);
    const emptySquare = ALL_SQUARES.find(
      (square) => !pieces.some((piece) => piece.square === square),
    ) as SquareName;

    const after = placePiece(
      state,
      { square: emptySquare, type: 'queen', color: 'white' },
      'touch',
      {},
      T0 + 500,
    );

    expect(after.rejected?.squares).toEqual([emptySquare]);
    expect(after.placed).toHaveLength(0);
    expect(after.attempts[0]?.correct).toBe(false);
    // A wrong placement is an attempt, never a completed question.
    expect(after.questionsCompleted).toBe(0);
    expect(after.current?.id).toBe(state.current?.id);
  });

  it('rejects the right piece on the wrong square', () => {
    const state = session('full');
    const piece = required(state)[0] as RequiredPlacement;
    const elsewhere = ALL_SQUARES.find(
      (square) => !required(state).some((p) => p.square === square),
    ) as SquareName;

    const after = placePiece(state, { ...piece, square: elsewhere }, 'touch', {}, T0 + 500);
    expect(after.placed).toHaveLength(0);
    expect(after.rejected).not.toBeNull();
  });

  it('ignores a repeated tap on a piece already placed', () => {
    const state = session('full');
    const piece = required(state)[0] as RequiredPlacement;

    const once = placePiece(state, piece, 'touch', {}, T0 + 500);
    const twice = placePiece(once, piece, 'touch', {}, T0 + 1000);

    expect(twice.placed).toHaveLength(1);
    expect(twice.attempts).toHaveLength(0);
    expect(twice.rejected).toBeNull();
  });

  it('accepts the partial subset without needing the rest of the board', () => {
    const state = session('partial');
    const pieces = required(state);
    expect(pieces.length).toBeLessThanOrEqual(10);

    const done = placeAll(state, pieces);
    expect(done.questionsCompleted).toBe(1);
    expect(done.attempts[0]?.correct).toBe(true);
  });
});

describe('reconstruction: repairing a damaged position', () => {
  it('starts with the drawn position already on the board', () => {
    const state = session('correction');
    expect(state.placed.length).toBeGreaterThan(10);
  });

  it('is not already finished, because the drawn position is wrong', () => {
    const state = session('correction');
    expect(state.questionsCompleted).toBe(0);
    expect(state.attempts).toHaveLength(0);
  });

  it('refuses to clear a piece that belongs where it stands', () => {
    const state = session('correction');
    const truth = required(state);
    const keeper = state.placed.find((placed) =>
      truth.some(
        (piece) =>
          piece.square === placed.square &&
          piece.type === placed.type &&
          piece.color === placed.color,
      ),
    ) as RequiredPlacement;

    const after = removePlacement(state, keeper.square, 'touch', {}, T0 + 500);
    expect(after.rejected?.squares).toEqual([keeper.square]);
    expect(after.placed).toHaveLength(state.placed.length);
    expect(after.attempts[0]?.correct).toBe(false);
  });

  it('repairs a position by clearing the intruders and filling the gaps', () => {
    const state = session('correction');
    const truth = required(state);
    const key = (p: RequiredPlacement): string => `${p.square}:${p.color}:${p.type}`;
    const truthKeys = new Set(truth.map(key));

    let current = state;
    let clock = T0;

    // Clear everything that should not be there.
    for (const placed of state.placed) {
      if (truthKeys.has(key(placed))) continue;
      clock += 500;
      current = removePlacement(current, placed.square, 'touch', {}, clock);
    }

    // Then fill in what is missing.
    const standing = new Set(current.placed.map(key));
    for (const piece of truth) {
      if (standing.has(key(piece))) continue;
      clock += 500;
      current = placePiece(current, piece, 'touch', {}, clock);
    }

    expect(current.questionsCompleted).toBe(1);
    expect(current.correctCount).toBe(1);
    expect(current.attempts.filter((attempt) => attempt.correct)).toHaveLength(1);
  });

  it('does not complete while an intruder is still standing', () => {
    const state = session('correction');
    const truth = required(state);
    const key = (p: RequiredPlacement): string => `${p.square}:${p.color}:${p.type}`;
    const truthKeys = new Set(truth.map(key));
    const standing = new Set(state.placed.map(key));

    // Fill the gaps but leave every intruder in place.
    let current = state;
    let clock = T0;
    for (const piece of truth) {
      if (standing.has(key(piece))) continue;
      // A square occupied by an intruder accepts the right piece over the top.
      clock += 500;
      current = placePiece(current, piece, 'touch', {}, clock);
    }

    const intrudersLeft = current.placed.filter((p) => !truthKeys.has(key(p)));
    if (intrudersLeft.length > 0) {
      expect(current.questionsCompleted).toBe(0);
    }
  });
});

describe('hints', () => {
  it('counts a hint and carries it onto the attempt', () => {
    const state = session('partial');
    const hinted = recordHint(state);
    expect(hinted.hintsUsed).toBe(1);

    const done = placeAll(hinted, required(hinted));
    expect(done.attempts[0]?.hintsUsed).toBe(1);
  });

  it('does not count hints when the user turned them off', () => {
    const state = session('partial', { allowHints: false });
    expect(recordHint(state).hintsUsed).toBe(0);
  });

  it('resets the count when the question changes', () => {
    const state = recordHint(session('partial'));
    const done = placeAll(state, required(state));
    expect(done.hintsUsed).toBe(0);
  });

  it('never turns a hint into a wrong answer', () => {
    const state = recordHint(recordHint(session('partial')));
    const done = placeAll(state, required(state));
    expect(done.attempts[0]?.correct).toBe(true);
    expect(done.attempts[0]?.hintsUsed).toBe(2);
  });
});
