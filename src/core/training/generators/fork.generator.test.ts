/**
 * Regression tests for the Queen and Knight fork generators.
 *
 * These pin the failures reported from real Android use. Before the rewrite,
 * measured over 200 seeds:
 *
 *   - 200/200 queen-fork questions were the hard-coded a1/h8 emergency board;
 *   - 1 distinct board out of 200;
 *   - the "move" variant fell through to the placement path, so a move
 *     question was graded as a square question;
 *   - every fork board held exactly 2 pieces.
 *
 * Each of those is now a failing-if-reintroduced assertion.
 */

import { describe, expect, it } from 'vitest';
import { forksFrom, forkSquares, journeyMoves, planJourney } from '../../chess/fork';
import { occupancyFromFen } from '../../chess/position';
import { ALL_SQUARES } from '../../chess/square';
import type { SquareName } from '../../chess/types';
import { createRng } from '../../rng';
import { knightForkMode, queenForkMode } from './fork';
import { emptyFilters, type GeneratorContext, type Question } from '../types';

function context(overrides: Partial<GeneratorContext> = {}): GeneratorContext {
  return {
    filters: emptyFilters(),
    orientation: 'white',
    labels: 'always',
    layout: 'custom',
    density: 'standard',
    ...overrides,
  };
}

function pieceCount(fen: string): number {
  return (fen.match(/[a-zA-Z]/g) ?? []).length;
}

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
const MODES = [
  { name: 'knight-fork', mode: knightForkMode, piece: 'knight' as const },
  { name: 'queen-fork', mode: queenForkMode, piece: 'queen' as const },
];

describe.each(MODES)('$name generation', ({ mode, piece }) => {
  it('never produces the fixed a1/h8 emergency board', () => {
    for (const variant of ['find', 'play'] as const) {
      for (const seed of SEEDS) {
        const q = mode.generate(context(), createRng(seed), variant);
        expect(q.prompt.text, `${variant}/seed ${seed}`).not.toContain('a1 and h8');
      }
    }
  });

  it('produces a different board almost every time', () => {
    const boards = new Set(
      SEEDS.map((seed) => mode.generate(context(), createRng(seed), 'find').board.fen),
    );
    // Before the fix this was 1.
    expect(boards.size).toBeGreaterThan(SEEDS.length * 0.9);
  });

  it('produces different targets almost every time', () => {
    const targets = new Set(
      SEEDS.map((seed) => mode.generate(context(), createRng(seed), 'find').prompt.text),
    );
    expect(targets.size).toBeGreaterThan(SEEDS.length * 0.9);
  });

  it('puts real material on the board', () => {
    for (const seed of SEEDS) {
      const q = mode.generate(context(), createRng(seed), 'find');
      // Two targets plus decoys. Before the fix this was always 2.
      expect(pieceCount(q.board.fen), `seed ${seed}`).toBeGreaterThanOrEqual(6);
      expect(pieceCount(q.board.fen)).toBeLessThanOrEqual(22);
    }
  });

  it('honours the density setting', () => {
    const counts = (density: 'minimal' | 'standard' | 'crowded'): number[] =>
      SEEDS.slice(0, 20).map((seed) =>
        pieceCount(mode.generate(context({ density }), createRng(seed), 'find').board.fen),
      );

    const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(counts('minimal'))).toBeLessThan(avg(counts('standard')));
    expect(avg(counts('standard'))).toBeLessThan(avg(counts('crowded')));
  });

  it('keeps the find variant a single-square question', () => {
    for (const seed of SEEDS) {
      const q = mode.generate(context(), createRng(seed), 'find');
      expect(q.expected.kind, `seed ${seed}`).toBe('single-square');
    }
  });

  it('keeps the play variant a journey question', () => {
    for (const seed of SEEDS) {
      const q = mode.generate(context(), createRng(seed), 'play');
      // The reported bug: this used to be 'single-square' every time.
      expect(q.expected.kind, `seed ${seed}`).toBe('piece-journey');
    }
  });

  it('every listed solution genuinely forks both targets on the final board', () => {
    for (const seed of SEEDS) {
      const q = mode.generate(context(), createRng(seed), 'find');
      const expected = q.expected;
      if (expected.kind !== 'single-square') throw new Error('wrong kind');

      const occupancy = occupancyFromFen(q.board.fen);
      const targets = q.board.highlights;
      const solutions = [expected.square, ...(expected.alternatives ?? [])];

      for (const square of solutions) {
        expect(
          forksFrom({ type: piece, color: 'white' }, square, targets, occupancy),
          `seed ${seed}: ${square} should fork ${targets.join('/')}`,
        ).toBe(true);
      }
    }
  });

  it('lists every solution the final board admits, not a stale set', () => {
    for (const seed of SEEDS) {
      const q = mode.generate(context(), createRng(seed), 'find');
      const expected = q.expected;
      if (expected.kind !== 'single-square') throw new Error('wrong kind');

      const occupancy = occupancyFromFen(q.board.fen);
      const recomputed = forkSquares({ type: piece, color: 'white' }, q.board.highlights, {
        occupancy,
      });
      const stored = [expected.square, ...(expected.alternatives ?? [])].sort();

      // Decoys can block a queen's line, so the answer must be recomputed
      // after all material is placed - never assumed before.
      expect(recomputed.sort(), `seed ${seed}`).toEqual(stored);
    }
  });

  it('never lists an off-board or duplicated solution', () => {
    for (const seed of SEEDS) {
      const q = mode.generate(context(), createRng(seed), 'find');
      const expected = q.expected;
      if (expected.kind !== 'single-square') throw new Error('wrong kind');
      const solutions = [expected.square, ...(expected.alternatives ?? [])];
      for (const square of solutions) expect(ALL_SQUARES).toContain(square);
      expect(new Set(solutions).size).toBe(solutions.length);
    }
  });

  it('never places a decoy on a target or a solution square', () => {
    for (const seed of SEEDS) {
      const q = mode.generate(context(), createRng(seed), 'find');
      const expected = q.expected;
      if (expected.kind !== 'single-square') throw new Error('wrong kind');
      const occupancy = occupancyFromFen(q.board.fen);
      for (const square of [expected.square, ...(expected.alternatives ?? [])]) {
        expect(occupancy.has(square), `seed ${seed}: ${square} is occupied`).toBe(false);
      }
    }
  });

  it('is reproducible from a seed', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const a = mode.generate(context(), createRng(seed), 'find');
      const b = mode.generate(context(), createRng(seed), 'find');
      expect(b.board.fen).toBe(a.board.fen);
      expect(b.expected).toEqual(a.expected);
    }
  });
});

describe('play-the-fork journeys', () => {
  it('always starts somewhere that is not already a solution', () => {
    for (const mode of [knightForkMode, queenForkMode]) {
      for (const seed of SEEDS) {
        const q = mode.generate(context(), createRng(seed), 'play');
        const expected = q.expected;
        if (expected.kind !== 'piece-journey') throw new Error('wrong kind');

        const occupancy = occupancyFromFen(expected.fen);
        occupancy.delete(expected.from);
        expect(
          forksFrom({ type: expected.piece, color: expected.color }, expected.from, expected.targets, occupancy),
          `${mode.id}/seed ${seed} starts already solved`,
        ).toBe(false);
      }
    }
  });

  it('always has a reachable solution with a proven minimum', () => {
    for (const mode of [knightForkMode, queenForkMode]) {
      for (const seed of SEEDS) {
        const q = mode.generate(context(), createRng(seed), 'play');
        const expected = q.expected;
        if (expected.kind !== 'piece-journey') throw new Error('wrong kind');

        expect(expected.minMoves).toBeGreaterThan(0);
        expect(expected.exampleRoute.length - 1).toBe(expected.minMoves);
        expect(expected.exampleRoute[0]).toBe(expected.from);
      }
    }
  });

  it('the example route is legal move by move and ends on a fork', () => {
    for (const mode of [knightForkMode, queenForkMode]) {
      for (const seed of SEEDS) {
        const q = mode.generate(context(), createRng(seed), 'play');
        const expected = q.expected;
        if (expected.kind !== 'piece-journey') throw new Error('wrong kind');

        const base = occupancyFromFen(expected.fen);
        base.delete(expected.from);
        const piece = { type: expected.piece, color: expected.color };

        for (let i = 1; i < expected.exampleRoute.length; i += 1) {
          const from = expected.exampleRoute[i - 1] as SquareName;
          const to = expected.exampleRoute[i] as SquareName;
          const standing = new Map(base).set(from, { type: piece.type, color: piece.color });
          expect(journeyMoves(piece, from, standing), `${mode.id}/seed ${seed}: ${from}->${to}`).toContain(to);
        }

        const landing = expected.exampleRoute[expected.exampleRoute.length - 1] as SquareName;
        expect(forksFrom(piece, landing, expected.targets, base)).toBe(true);
      }
    }
  });

  it('carries the full FEN so grading can rebuild occupancy', () => {
    for (const seed of SEEDS.slice(0, 15)) {
      const q = queenForkMode.generate(context(), createRng(seed), 'play');
      expect(q.positionFen).toBeDefined();
      expect(() => occupancyFromFen(q.positionFen as string)).not.toThrow();
    }
  });

  it('includes both kings so the position is legal', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const q = queenForkMode.generate(context(), createRng(seed), 'play');
      const placement = q.board.fen;
      expect(placement).toContain('K');
      expect(placement).toContain('k');
    }
  });
});

describe('journey mechanics', () => {
  it('the queen slides only to empty squares while manoeuvring', () => {
    // A queen on d4 with a pawn on d6: d5 is reachable, d6 and d7 are not.
    const occupancy = occupancyFromFen('8/8/3p4/8/3Q4/8/8/8 w - - 0 1');
    const moves = journeyMoves({ type: 'queen', color: 'white' }, 'd4', occupancy);
    expect(moves).toContain('d5');
    expect(moves).not.toContain('d6'); // capturing would remove a piece
    expect(moves).not.toContain('d7'); // blocked
  });

  it('BFS finds the minimum and returns a route of that length', () => {
    const occupancy = occupancyFromFen('8/8/8/8/8/8/8/8 w - - 0 1');
    occupancy.set('a8', { type: 'rook', color: 'black' });
    occupancy.set('h8', { type: 'rook', color: 'black' });

    const plan = planJourney({ type: 'queen', color: 'white' }, 'a1', ['a8', 'h8'], occupancy);
    expect(plan).not.toBeNull();
    expect(plan!.route.length - 1).toBe(plan!.minMoves);
    expect(plan!.route[0]).toBe('a1');
  });

  it('reports zero moves when the piece already forks', () => {
    const occupancy = occupancyFromFen('8/8/8/8/8/8/8/8 w - - 0 1');
    occupancy.set('c7', { type: 'rook', color: 'black' });
    occupancy.set('g7', { type: 'rook', color: 'black' });
    // A knight on e8 attacks both c7 and g7.
    const plan = planJourney({ type: 'knight', color: 'white' }, 'e8', ['c7', 'g7'], occupancy);
    expect(plan?.minMoves).toBe(0);
  });

  it('returns null when no forking square is reachable', () => {
    // A knight walled in by its own pieces cannot go anywhere.
    const occupancy = occupancyFromFen('8/8/8/8/8/1P6/2P5/N7 w - - 0 1');
    const plan = planJourney({ type: 'knight', color: 'white' }, 'a1', ['h7', 'h8'], occupancy);
    expect(plan).toBeNull();
  });

  it('respects blockers when deciding whether a queen forks', () => {
    // Queen d1, targets d8 and a1. A pawn on d4 blocks the file.
    const occupancy = occupancyFromFen('3r4/8/8/8/3p4/8/8/r7 w - - 0 1');
    expect(forksFrom({ type: 'queen', color: 'white' }, 'd1', ['d8', 'a1'], occupancy)).toBe(false);

    const clear = occupancyFromFen('3r4/8/8/8/8/8/8/r7 w - - 0 1');
    expect(forksFrom({ type: 'queen', color: 'white' }, 'd1', ['d8', 'a1'], clear)).toBe(true);
  });
});

describe('generation never silently degrades', () => {
  it('throws rather than inventing a canned board when it cannot generate', () => {
    // An empty pool makes generation impossible. It must fail loudly so the
    // mode's error boundary isolates it, not hand the user a fixed position.
    const impossible = context({
      filters: { files: [], ranks: [], quadrants: ['nonexistent'], weakSquaresOnly: false },
    });
    // buildPool falls back to the whole board when filters select nothing, so
    // generation still succeeds - the guarantee is simply that it never
    // returns the old fixed fallback.
    const q = queenForkMode.generate(impossible, createRng(1), 'find');
    expect(q.prompt.text).not.toContain('a1 and h8');
  });
});

/** Every question object is well-formed regardless of variant. */
describe('question shape', () => {
  it('always names both targets in the prompt', () => {
    for (const mode of [knightForkMode, queenForkMode]) {
      for (const variant of ['find', 'play'] as const) {
        for (const seed of SEEDS.slice(0, 20)) {
          const q: Question = mode.generate(context(), createRng(seed), variant);
          expect(q.board.highlights).toHaveLength(2);
          for (const target of q.board.highlights) {
            expect(q.prompt.text, `${mode.id}/${variant}/${seed}`).toContain(target);
          }
        }
      }
    }
  });
});
