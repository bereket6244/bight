/**
 * Contract tests every generator must satisfy.
 *
 * These run each mode and variant many times with different seeds and assert
 * the generated question is well-formed and, crucially, that the stored
 * expected answer is the one the chess core independently computes. A
 * generator that invents its own answer table would fail here.
 */

import { describe, expect, it } from 'vitest';
import { geometricTargets, knightTargets, sortSquares } from '../chess/geometry';
import { isValidKnightRoute, knightDistance } from '../chess/knightRoute';
import { occupancyFromFen } from '../chess/position';
import { ALL_SQUARES, isSquareName, squareColor } from '../chess/square';
import type { SquareName } from '../chess/types';
import { createRng } from '../rng';
import { gradeQuestion } from './grade';
import { questionModeVariants, MODES } from './registry';
import { emptyFilters, type GeneratorContext, type Question, type SubmittedAnswer } from './types';

function context(overrides: Partial<GeneratorContext> = {}): GeneratorContext {
  return {
    filters: emptyFilters(),
    orientation: 'white',
    labels: 'always',
    layout: 'empty',
    ...overrides,
  };
}

/** Builds the perfect answer for a question, straight from its expectation. */
function perfectAnswer(question: Question): SubmittedAnswer {
  const expected = question.expected;
  switch (expected.kind) {
    case 'single-square':
      return { kind: 'single-square', square: expected.square };
    case 'coordinate':
      return { kind: 'coordinate', square: expected.square };
    case 'square-set':
      return { kind: 'square-set', squares: [...expected.squares] };
    case 'square-color':
      return { kind: 'square-color', color: expected.color };
    case 'choice':
      return { kind: 'choice', choice: expected.correct };
    case 'move':
      return { kind: 'move', from: expected.from, to: expected.to };
    case 'square-path':
      return { kind: 'square-path', squares: expected.exampleRoute.slice(1) };
    case 'piece-journey':
      return { kind: 'piece-journey', path: expected.exampleRoute.slice(1) };
    case 'placement':
      return { kind: 'placement', placed: [...expected.required] };
  }
}

const SEEDS = [1, 2, 3, 7, 11, 42, 99, 1234, 20260730, 987654];

/**
 * Seeds for the sweeps that run every mode and variant. Notation questions
 * generate real games, so the full seed list there costs a minute for no extra
 * coverage - each of these still exercises every registered variant.
 */
const CONTRACT_SEEDS = SEEDS.slice(0, 4);

describe('generator contract', () => {
  it('covers every mode in the registry', () => {
    expect(MODES.length).toBeGreaterThanOrEqual(11);
    for (const mode of MODES) {
      expect(mode.variants.length, mode.id).toBeGreaterThan(0);
      expect(typeof mode.generate).toBe('function');
    }
  });

  it('produces a well-formed question for every mode, variant and seed', () => {
    for (const { mode, variant } of questionModeVariants()) {
      for (const seed of CONTRACT_SEEDS) {
        const rng = createRng(seed);
        const question = mode.generate(context(), rng, variant.id);
        const where = `${mode.id}/${variant.id}/seed ${seed}`;

        expect(question.id, where).toBeTruthy();
        expect(question.modeId, where).toBe(mode.id);
        expect(question.prompt.text.length, where).toBeGreaterThan(0);
        expect(question.board.fen, where).toBeTruthy();
        expect(() => occupancyFromFen(question.board.fen), where).not.toThrow();

        for (const square of question.focusSquares) {
          expect(isSquareName(square), `${where}: focus ${square}`).toBe(true);
        }
        for (const square of question.board.highlights) {
          expect(isSquareName(square), `${where}: highlight ${square}`).toBe(true);
        }
      }
    }
  });

  it('never generates an off-board or duplicated answer square', () => {
    for (const { mode, variant } of questionModeVariants()) {
      for (const seed of CONTRACT_SEEDS) {
        const question = mode.generate(context(), createRng(seed), variant.id);
        const where = `${mode.id}/${variant.id}/seed ${seed}`;
        const expected = question.expected;

        if (expected.kind === 'square-set') {
          for (const square of expected.squares) {
            expect(ALL_SQUARES, `${where}: ${square}`).toContain(square);
          }
          expect(new Set(expected.squares).size, `${where}: duplicates`).toBe(
            expected.squares.length,
          );
        }
        if (expected.kind === 'single-square' || expected.kind === 'coordinate') {
          expect(ALL_SQUARES, where).toContain(expected.square);
        }
        if (expected.kind === 'move') {
          expect(ALL_SQUARES, where).toContain(expected.from);
          expect(ALL_SQUARES, where).toContain(expected.to);
          expect(expected.from, where).not.toBe(expected.to);
        }
      }
    }
  });

  it('always produces at least one correct answer where one is required', () => {
    for (const { mode, variant } of questionModeVariants()) {
      for (const seed of CONTRACT_SEEDS) {
        const question = mode.generate(context(), createRng(seed), variant.id);
        const where = `${mode.id}/${variant.id}/seed ${seed}`;
        const expected = question.expected;

        if (expected.kind === 'square-set') {
          // "Which of these are attacked" may legitimately have an empty
          // answer; every other set question must offer something to tap.
          if (variant.id !== 'candidates') {
            expect(expected.squares.length, where).toBeGreaterThan(0);
          }
        }
        if (expected.kind === 'choice') {
          expect(expected.choices, where).toContain(expected.correct);
        }
        if (expected.kind === 'square-path') {
          expect(expected.shortestLength, where).toBeGreaterThan(0);
          expect(isValidKnightRoute(expected.exampleRoute), where).toBe(true);
        }
      }
    }
  });

  it('grades its own perfect answer as correct', () => {
    for (const { mode, variant } of questionModeVariants()) {
      for (const seed of CONTRACT_SEEDS) {
        const question = mode.generate(context(), createRng(seed), variant.id);
        const grade = gradeQuestion(question, perfectAnswer(question));
        expect(grade.correct, `${mode.id}/${variant.id}/seed ${seed}: ${grade.explanation}`).toBe(
          true,
        );
        expect(grade.missed).toEqual([]);
        expect(grade.extra).toEqual([]);
      }
    }
  });

  it('is reproducible from a seed', () => {
    for (const { mode, variant } of questionModeVariants()) {
      const a = mode.generate(context(), createRng(777), variant.id);
      const b = mode.generate(context(), createRng(777), variant.id);
      expect(b.expected, `${mode.id}/${variant.id}`).toEqual(a.expected);
      expect(b.board.fen).toEqual(a.board.fen);
      expect(b.prompt.text).toEqual(a.prompt.text);
    }
  });
});

describe('answers agree with the chess core', () => {
  it('knight vision answers match knightTargets', () => {
    const knight = MODES.find((m) => m.id === 'knight-vision');
    expect(knight).toBeDefined();

    for (const seed of SEEDS) {
      const question = knight!.generate(context(), createRng(seed), 'attack-squares');
      const origin = question.primarySquare as SquareName;
      expect(question.expected).toEqual({
        kind: 'square-set',
        squares: knightTargets(origin),
      });
    }
  });

  it('knight "from memory" answers match the coordinate in the prompt', () => {
    const knight = MODES.find((m) => m.id === 'knight-vision');
    for (const seed of SEEDS) {
      const question = knight!.generate(context(), createRng(seed), 'from-memory');
      const origin = question.prompt.coordinate as SquareName;
      const expected = question.expected as { kind: 'square-set'; squares: SquareName[] };
      expect(expected.squares).toEqual(knightTargets(origin));
      // The board really is empty in this variant.
      expect(occupancyFromFen(question.board.fen).size).toBe(0);
    }
  });

  it('knight legal-destination answers respect occupancy', () => {
    const knight = MODES.find((m) => m.id === 'knight-vision');
    for (const seed of SEEDS) {
      const question = knight!.generate(context(), createRng(seed), 'legal-destinations');
      const origin = question.primarySquare as SquareName;
      const occupancy = occupancyFromFen(question.board.fen);
      const expected = question.expected as { kind: 'square-set'; squares: SquareName[] };

      expect(expected.squares).toEqual(
        geometricTargets({ type: 'knight', color: 'white' }, origin, { occupancy }),
      );
      // Occupancy must actually matter, or the variant trains nothing.
      for (const square of expected.squares) {
        expect(occupancy.get(square)?.color).not.toBe('white');
      }
    }
  });

  it('square-colour answers match the parity rule', () => {
    const mode = MODES.find((m) => m.id === 'square-color');
    for (const variant of mode!.variants) {
      for (const seed of SEEDS) {
        const question = mode!.generate(context(), createRng(seed), variant.id);
        const square = question.primarySquare as SquareName;
        expect(question.expected).toEqual({
          kind: 'square-color',
          color: squareColor(square),
        });
      }
    }
  });

  it('sliding-piece answers respect blockers', () => {
    const mode = MODES.find((m) => m.id === 'piece-vision');
    for (const piece of ['bishop', 'rook', 'queen'] as const) {
      for (const seed of SEEDS) {
        const question = mode!.generate(context(), createRng(seed), `${piece}-blocked`);
        const origin = question.primarySquare as SquareName;
        const occupancy = occupancyFromFen(question.board.fen);
        const expected = question.expected as { kind: 'square-set'; squares: SquareName[] };

        expect(expected.squares, `${piece} on ${origin}`).toEqual(
          geometricTargets({ type: piece, color: 'white' }, origin, { occupancy }),
        );
        // Occupancy must actually matter, or the drill is empty-board collection.
        expect(occupancy.size).toBeGreaterThan(1);
      }
    }
  });

  it('knight route answers are genuinely shortest', () => {
    const knight = MODES.find((m) => m.id === 'knight-route');
    for (const seed of SEEDS) {
      const question = knight!.generate(context(), createRng(seed), 'shortest-route');
      const expected = question.expected as {
        kind: 'square-path';
        from: SquareName;
        to: SquareName;
        shortestLength: number;
        exampleRoute: SquareName[];
      };
      expect(expected.shortestLength).toBe(knightDistance(expected.from, expected.to));
      expect(expected.exampleRoute[0]).toBe(expected.from);
      expect(expected.exampleRoute[expected.exampleRoute.length - 1]).toBe(expected.to);
    }
  });

});

describe('filters restrict the squares questions are drawn from', () => {
  it('honours a file filter', () => {
    const mode = MODES.find((m) => m.id === 'coordinate-to-square');
    for (const seed of SEEDS) {
      const question = mode!.generate(
        context({ filters: { ...emptyFilters(), files: [0, 1] } }),
        createRng(seed),
        'standard',
      );
      expect(['a', 'b'], question.primarySquare ?? '').toContain(
        (question.primarySquare as SquareName)[0],
      );
    }
  });

  it('honours a rank filter', () => {
    const mode = MODES.find((m) => m.id === 'square-to-coordinate');
    for (const seed of SEEDS) {
      const question = mode!.generate(
        context({ filters: { ...emptyFilters(), ranks: [0] } }),
        createRng(seed),
        'standard',
      );
      expect((question.primarySquare as SquareName)[1]).toBe('1');
    }
  });

  it('honours combined file and rank filters', () => {
    const mode = MODES.find((m) => m.id === 'square-color');
    for (const seed of SEEDS) {
      const question = mode!.generate(
        context({ filters: { ...emptyFilters(), files: [4], ranks: [3] } }),
        createRng(seed),
        'coordinate',
      );
      expect(question.primarySquare).toBe('e4');
    }
  });

  it('honours a quadrant filter', () => {
    const mode = MODES.find((m) => m.id === 'coordinate-to-square');
    for (const seed of SEEDS) {
      const question = mode!.generate(
        context({ filters: { ...emptyFilters(), quadrants: ['kingside-black'] } }),
        createRng(seed),
        'standard',
      );
      const square = question.primarySquare as SquareName;
      expect('efgh', square).toContain(square[0]);
      expect(Number(square[1])).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('board settings flow into the generated board', () => {
  it('applies orientation and label settings', () => {
    for (const { mode, variant } of questionModeVariants()) {
      const question = mode.generate(
        context({ orientation: 'black', labels: 'never' }),
        createRng(5),
        variant.id,
      );
      expect(question.board.orientation, `${mode.id}/${variant.id}`).toBe('black');
      expect(question.board.labels).toBe('never');
    }
  });

  it('marks pieces decorative in coordinate modes so square taps register', () => {
    const mode = MODES.find((m) => m.id === 'coordinate-to-square');
    const question = mode!.generate(context({ layout: 'starting' }), createRng(3), 'standard');
    expect(question.board.decorativePieces).toBe(true);
    expect(occupancyFromFen(question.board.fen).size).toBe(32);
  });

  it('uses the starting layout when asked', () => {
    const mode = MODES.find((m) => m.id === 'square-to-coordinate');
    const question = mode!.generate(context({ layout: 'starting' }), createRng(3), 'standard');
    expect(occupancyFromFen(question.board.fen).size).toBe(32);
  });

  it('passes the reveal duration through as a setting, not a separate mode', () => {
    const mode = MODES.find((m) => m.id === 'square-to-coordinate');
    const question = mode!.generate(context({ revealMs: 400 }), createRng(3), 'standard');
    expect(question.board.revealMs).toBe(400);
  });

  it('hides the board when the hideBoard setting is on', () => {
    const mode = MODES.find((m) => m.id === 'square-to-coordinate');
    const question = mode!.generate(context({ hideBoard: true }), createRng(3), 'standard');
    expect(question.board.hidden).toBe(true);
  });
});

describe('adaptive weighting', () => {
  it('favours heavily weighted squares without excluding the rest', () => {
    const mode = MODES.find((m) => m.id === 'coordinate-to-square');
    const weights = new Map<SquareName, number>([['h7', 50]]);
    const seen = new Set<SquareName>();
    let h7Count = 0;

    for (let seed = 0; seed < 200; seed += 1) {
      const question = mode!.generate(context({ weights }), createRng(seed), 'standard');
      const square = question.primarySquare as SquareName;
      seen.add(square);
      if (square === 'h7') h7Count += 1;
    }

    // Weighting is capped, so h7 is common but far from exclusive.
    expect(h7Count).toBeGreaterThan(10);
    expect(h7Count).toBeLessThan(150);
    expect(seen.size).toBeGreaterThan(20);
  });
});

describe('answer sets are stable and sorted', () => {
  it('returns square sets in sorted order', () => {
    for (const { mode, variant } of questionModeVariants()) {
      for (const seed of SEEDS.slice(0, 4)) {
        const question = mode.generate(context(), createRng(seed), variant.id);
        if (question.expected.kind !== 'square-set') continue;
        expect(question.expected.squares, `${mode.id}/${variant.id}`).toEqual(
          sortSquares(question.expected.squares),
        );
      }
    }
  });
});
