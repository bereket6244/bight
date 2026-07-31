/**
 * Grading details that are easy to get subtly wrong.
 *
 * The generator contract tests already check that every mode grades its own
 * perfect answer as correct. What is here is the rendering of answers for the
 * review screen and stored history, where an ambiguous description is not a
 * crash but is still wrong.
 */

import { describe, expect, it } from 'vitest';
import { describeExpected, describeSubmitted } from './grade';
import type { ExpectedAnswer } from './types';
import type { SquareName } from '../chess/types';

describe('placement descriptions are unambiguous', () => {
  it('distinguishes a knight from a king', () => {
    // Both words start with "k". Rendering both as "k" made a described
    // placement impossible to read back, which is how this was found.
    const expected: ExpectedAnswer = {
      kind: 'placement',
      required: [
        { square: 'g1' as SquareName, type: 'knight', color: 'white' },
        { square: 'e1' as SquareName, type: 'king', color: 'white' },
      ],
      exact: true,
      subsetLabel: 'both',
    };
    expect(describeExpected(expected)).toBe('wNg1 wKe1');
  });

  it('uses the same letters for a submitted answer', () => {
    expect(
      describeSubmitted({
        kind: 'placement',
        placed: [
          { square: 'b8' as SquareName, type: 'knight', color: 'black' },
          { square: 'd8' as SquareName, type: 'queen', color: 'black' },
        ],
      }),
    ).toBe('bNb8 bQd8');
  });

  it('gives every piece type a distinct letter', () => {
    const letters = new Set(
      (['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const).map((type) =>
        describeExpected({
          kind: 'placement',
          required: [{ square: 'a1' as SquareName, type, color: 'white' }],
          exact: true,
          subsetLabel: 'one',
        }),
      ),
    );
    expect(letters.size).toBe(6);
  });
});
