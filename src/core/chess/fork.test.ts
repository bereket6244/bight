import { describe, expect, it } from 'vitest';
import {
  attacksAll,
  forkSquares,
  isUsefulForkProblem,
  legalForkMoves,
} from './fork';
import { attackedSquares, knightTargets } from './geometry';
import { occupancyFromFen, occupancyFromPieces } from './position';
import { ALL_SQUARES } from './square';
import type { PieceType, SquareName } from './types';

const KNIGHT = { type: 'knight' as PieceType, color: 'white' as const };
const QUEEN = { type: 'queen' as PieceType, color: 'white' as const };

describe('knight fork squares', () => {
  it('finds the square that attacks both targets', () => {
    // A knight on c7 attacks both a8 and e8.
    const squares = forkSquares(KNIGHT, ['a8', 'e8']);
    expect(squares).toContain('c7');
  });

  it('returns every solution, not just one', () => {
    // c3 and c7 are forked from both b5 and d5.
    const targets: SquareName[] = ['c3', 'c7'];
    const squares = forkSquares(KNIGHT, targets);
    // Verified independently: intersect the two knight-target sets.
    const expected = knightTargets('c3').filter((sq) => knightTargets('c7').includes(sq));
    expect([...squares].sort()).toEqual([...expected].sort());
    expect([...squares].sort()).toEqual(['b5', 'd5']);
  });

  it('agrees with an independent intersection for every pair of squares', () => {
    for (const a of ALL_SQUARES) {
      for (const b of ALL_SQUARES) {
        if (a >= b) continue;
        const mine = forkSquares(KNIGHT, [a, b]);
        const reference = knightTargets(a)
          .filter((sq) => knightTargets(b).includes(sq))
          .filter((sq) => sq !== a && sq !== b);
        expect([...mine].sort(), `${a}/${b}`).toEqual([...reference].sort());
      }
    }
  });

  it('never returns a target square as a solution', () => {
    for (const [a, b] of [
      ['a1', 'a3'],
      ['d4', 'e6'],
      ['b1', 'c3'],
    ] as Array<[SquareName, SquareName]>) {
      const squares = forkSquares(KNIGHT, [a, b]);
      expect(squares).not.toContain(a);
      expect(squares).not.toContain(b);
    }
  });

  it('never returns an off-board or duplicated square', () => {
    for (const a of ALL_SQUARES.slice(0, 20)) {
      for (const b of ALL_SQUARES.slice(20, 40)) {
        const squares = forkSquares(KNIGHT, [a, b]);
        for (const square of squares) expect(ALL_SQUARES).toContain(square);
        expect(new Set(squares).size).toBe(squares.length);
      }
    }
  });

  it('every returned square genuinely attacks both targets', () => {
    for (const a of ALL_SQUARES.slice(0, 24)) {
      for (const b of ALL_SQUARES.slice(24, 48)) {
        for (const square of forkSquares(KNIGHT, [a, b])) {
          const attacks = attackedSquares(KNIGHT, square);
          expect(attacks, `${square} -> ${a}`).toContain(a);
          expect(attacks, `${square} -> ${b}`).toContain(b);
        }
      }
    }
  });

  it('returns nothing when no square attacks both', () => {
    // Two squares a knight can never hit from one square.
    const squares = forkSquares(KNIGHT, ['a1', 'b2']);
    expect(squares).toEqual([]);
  });

  it('requires at least two targets', () => {
    expect(forkSquares(KNIGHT, ['a1'])).toEqual([]);
    expect(forkSquares(KNIGHT, [])).toEqual([]);
  });

  it('handles three targets', () => {
    const targets: SquareName[] = ['a8', 'e8', 'a4'];
    for (const square of forkSquares(KNIGHT, targets)) {
      const attacks = attackedSquares(KNIGHT, square);
      for (const target of targets) expect(attacks).toContain(target);
    }
  });

  it('excludes squares that are already occupied', () => {
    const occupancy = occupancyFromPieces([{ square: 'b5', type: 'pawn', color: 'white' }]);
    const withBlocker = forkSquares(KNIGHT, ['c3', 'c7'], { occupancy });
    expect(withBlocker).not.toContain('b5');
    expect(withBlocker).toContain('d5');
  });

  it('honours an explicit exclusion list', () => {
    expect(forkSquares(KNIGHT, ['c3', 'c7'], { excluded: ['b5'] })).toEqual(['d5']);
  });
});

describe('queen fork squares', () => {
  it('finds squares attacking both targets on an empty board', () => {
    const squares = forkSquares(QUEEN, ['a1', 'h8']);
    expect(squares.length).toBeGreaterThan(0);
    for (const square of squares) {
      const attacks = attackedSquares(QUEEN, square);
      expect(attacks).toContain('a1');
      expect(attacks).toContain('h8');
    }
  });

  it('does not fork through a blocker', () => {
    // A queen on d1 would see d8 down the file, but d4 blocks it.
    const occupancy = occupancyFromPieces([{ square: 'd4', type: 'pawn', color: 'black' }]);
    const squares = forkSquares(QUEEN, ['d8', 'a1'], { occupancy });
    expect(squares).not.toContain('d1');
  });

  it('counts the forker itself when tracing its own rays', () => {
    // With no occupancy at all the queen sees everything on its lines; adding
    // the forker to the map must not make it block itself.
    const empty = occupancyFromPieces([]);
    const withOccupancy = forkSquares(QUEEN, ['a1', 'h8'], { occupancy: empty });
    const withoutOccupancy = forkSquares(QUEEN, ['a1', 'h8']);
    expect(withOccupancy).toEqual(withoutOccupancy);
  });

  it('every solution attacks both targets given the blockers', () => {
    const occupancy = occupancyFromPieces([
      { square: 'd4', type: 'pawn', color: 'black' },
      { square: 'e5', type: 'pawn', color: 'white' },
    ]);
    for (const square of forkSquares(QUEEN, ['b7', 'g2'], { occupancy })) {
      const withForker = new Map(occupancy).set(square, { type: 'queen', color: 'white' });
      const attacks = attackedSquares(QUEEN, square, { occupancy: withForker });
      expect(attacks, square).toContain('b7');
      expect(attacks, square).toContain('g2');
    }
  });
});

describe('attacksAll', () => {
  it('confirms a known knight fork', () => {
    expect(attacksAll(KNIGHT, 'c7', ['a8', 'e8'])).toBe(true);
  });

  it('rejects a square that hits only one target', () => {
    expect(attacksAll(KNIGHT, 'c7', ['a8', 'h1'])).toBe(false);
  });

  it('rejects an empty target list', () => {
    expect(attacksAll(KNIGHT, 'c7', [])).toBe(false);
  });
});

describe('legal fork moves in a real position', () => {
  /**
   * Black rooks on c8 and g8. The only square a knight forks both from is e7,
   * so the knight is placed on d5, from which e7 is one legal hop.
   */
  const REACHABLE = '2r3r1/8/8/3N4/8/8/8/K6k w - - 0 1';

  it('finds a legal knight move that forks two pieces', () => {
    const moves = legalForkMoves({
      fen: REACHABLE,
      from: 'd5',
      piece: { type: 'knight', color: 'white' },
      targets: ['c8', 'g8'],
    });
    expect(moves).toEqual(['e7']);
  });

  it('every returned move is both legal and a genuine fork', () => {
    const moves = legalForkMoves({
      fen: REACHABLE,
      from: 'd5',
      piece: { type: 'knight', color: 'white' },
      targets: ['c8', 'g8'],
    });
    expect(moves.length).toBeGreaterThan(0);

    for (const to of moves) {
      const occupancy = occupancyFromFen(REACHABLE);
      occupancy.delete('d5');
      occupancy.set(to, { type: 'knight', color: 'white' });
      const attacks = attackedSquares({ type: 'knight', color: 'white' }, to, { occupancy });
      expect(attacks, to).toContain('c8');
      expect(attacks, to).toContain('g8');
    }
  });

  it('excludes fork squares the piece cannot legally reach', () => {
    // Targets c3 and c7 are forked from either b5 or d5. A knight on a3 can
    // reach b5 but not d5, so legality is strictly narrower than geometry.
    const fen = '7k/2r5/8/8/8/N1r5/8/7K w - - 0 1';
    const legal = legalForkMoves({
      fen,
      from: 'a3',
      piece: { type: 'knight', color: 'white' },
      targets: ['c3', 'c7'],
    });
    const geometric = forkSquares({ type: 'knight', color: 'white' }, ['c3', 'c7']);

    expect([...geometric].sort()).toEqual(['b5', 'd5']);
    expect(legal).toEqual(['b5']);

    // This is the distinction the app must never blur.
    expect(geometric.length).toBeGreaterThan(legal.length);
    for (const move of legal) expect(geometric).toContain(move);
  });

  it('returns nothing when the forking piece is pinned', () => {
    // The knight on e2 is pinned to the king on e1 by the rook on e8.
    const fen = '4r3/8/8/8/8/8/4N3/4K2k w - - 0 1';
    const moves = legalForkMoves({
      fen,
      from: 'e2',
      piece: { type: 'knight', color: 'white' },
      targets: ['c1', 'g1'],
    });
    expect(moves).toEqual([]);
  });

  it('returns nothing for an unparseable position', () => {
    expect(
      legalForkMoves({
        fen: 'not a fen',
        from: 'e5',
        piece: { type: 'knight', color: 'white' },
        targets: ['c8', 'g8'],
      }),
    ).toEqual([]);
  });
});

describe('problem usefulness filter', () => {
  it('rejects unsolvable problems', () => {
    expect(isUsefulForkProblem([])).toBe(false);
  });

  it('accepts a problem with a small number of solutions', () => {
    expect(isUsefulForkProblem(['a1'])).toBe(true);
    expect(isUsefulForkProblem(['a1', 'b2', 'c3'])).toBe(true);
  });

  it('rejects a problem with too many trivial solutions', () => {
    const many = ALL_SQUARES.slice(0, 20);
    expect(isUsefulForkProblem(many)).toBe(false);
  });

  it('respects a custom ceiling', () => {
    expect(isUsefulForkProblem(['a1', 'b2', 'c3'], 2)).toBe(false);
  });
});
