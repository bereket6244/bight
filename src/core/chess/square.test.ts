import { describe, expect, it } from 'vitest';
import { Chess, SQUARES } from 'chess.js';
import {
  ALL_SQUARES,
  BOARD_SIZE,
  fileOf,
  fromDisplayPosition,
  indexToSquare,
  isDarkSquare,
  isLightSquare,
  isSquareName,
  kingDistance,
  normalizeSquare,
  parseSquare,
  quadrantOf,
  rankOf,
  sameDiagonal,
  sameFile,
  sameRank,
  squareColor,
  squaresInDisplayOrder,
  squaresInQuadrant,
  squareToIndex,
  toCoordinates,
  toDisplayPosition,
  toSquare,
} from './square';
import { FILE_LETTERS, RANK_DIGITS, type Orientation, type SquareName } from './types';

describe('square identity', () => {
  it('enumerates exactly 64 unique squares', () => {
    expect(ALL_SQUARES).toHaveLength(64);
    expect(new Set(ALL_SQUARES).size).toBe(64);
  });

  it('matches the square list chess.js uses', () => {
    expect([...ALL_SQUARES].sort()).toEqual([...SQUARES].sort());
  });

  it('round-trips every square through coordinates', () => {
    for (const square of ALL_SQUARES) {
      const { file, rank } = toCoordinates(square);
      expect(toSquare(file, rank)).toBe(square);
    }
  });

  it('round-trips every square through its index', () => {
    for (let index = 0; index < 64; index += 1) {
      expect(squareToIndex(indexToSquare(index))).toBe(index);
    }
  });

  it('places a1 at index 0 and h8 at index 63', () => {
    expect(indexToSquare(0)).toBe('a1');
    expect(indexToSquare(63)).toBe('h8');
  });

  it('parses every square name in any case, with padding', () => {
    for (const square of ALL_SQUARES) {
      expect(normalizeSquare(square)).toBe(square);
      expect(normalizeSquare(square.toUpperCase())).toBe(square);
      expect(normalizeSquare(`  ${square}  `)).toBe(square);
    }
  });

  it('rejects input that is not a square', () => {
    const bad = ['', 'a', 'a0', 'a9', 'i4', 'e44', '4e', 'zz', '11', '-', 'e-4', 'e 4'];
    for (const input of bad) {
      expect(parseSquare(input), input).toBeNull();
      expect(normalizeSquare(input), input).toBeNull();
      expect(isSquareName(input), input).toBe(false);
    }
  });

  it('never produces an off-board coordinate', () => {
    const offBoard: Array<[number, number]> = [
      [-1, 0],
      [0, -1],
      [8, 0],
      [0, 8],
      [8, 8],
      [1.5, 2],
      [NaN, 0],
    ];
    for (const [file, rank] of offBoard) {
      expect(() => toSquare(file, rank), `${file},${rank}`).toThrow(RangeError);
    }
  });
});

describe('square colour', () => {
  /**
   * Independent reference: a1 is dark and colour alternates along both axes,
   * so a square is light exactly when the number of steps from a1 is odd.
   * Derived without reusing the production parity expression.
   */
  function referenceColor(square: SquareName): 'light' | 'dark' {
    const fileSteps = FILE_LETTERS.indexOf(square[0] as never);
    const rankSteps = RANK_DIGITS.indexOf(square[1] as never);
    const flips = fileSteps + rankSteps;
    return flips % 2 === 1 ? 'light' : 'dark';
  }

  it('agrees with the independent reference on all 64 squares', () => {
    for (const square of ALL_SQUARES) {
      expect(squareColor(square), square).toBe(referenceColor(square));
    }
  });

  it('pins the four corners and the classic mnemonics', () => {
    expect(squareColor('a1')).toBe('dark');
    expect(squareColor('h1')).toBe('light');
    expect(squareColor('a8')).toBe('light');
    expect(squareColor('h8')).toBe('dark');
    // "White on the right": h1 is light for both players.
    expect(isLightSquare('h1')).toBe(true);
    expect(isDarkSquare('a1')).toBe(true);
  });

  it('splits the board into 32 light and 32 dark squares', () => {
    const light = ALL_SQUARES.filter(isLightSquare);
    const dark = ALL_SQUARES.filter(isDarkSquare);
    expect(light).toHaveLength(32);
    expect(dark).toHaveLength(32);
  });

  it('alternates between every pair of orthogonally adjacent squares', () => {
    for (const square of ALL_SQUARES) {
      const { file, rank } = toCoordinates(square);
      for (const [df, dr] of [
        [1, 0],
        [0, 1],
      ]) {
        const f = file + df;
        const r = rank + dr;
        if (f > 7 || r > 7) continue;
        expect(squareColor(toSquare(f, r)), `${square} -> ${toSquare(f, r)}`).not.toBe(
          squareColor(square),
        );
      }
    }
  });

  it('keeps every diagonal neighbour the same colour', () => {
    for (const square of ALL_SQUARES) {
      const { file, rank } = toCoordinates(square);
      const f = file + 1;
      const r = rank + 1;
      if (f > 7 || r > 7) continue;
      expect(squareColor(toSquare(f, r))).toBe(squareColor(square));
    }
  });

  /**
   * chess.js exposes no colour helper, so this cross-checks the parity rule
   * through behaviour instead: a bishop never leaves its starting colour.
   * Every destination chess.js generates must share the origin's colour, and
   * every square of the other colour must be unreachable.
   */
  it('agrees with chess.js bishop reachability on all 64 squares', () => {
    for (const origin of ALL_SQUARES) {
      const kingSquares: SquareName[] = origin === 'a1' ? ['h1', 'h8'] : ['a1', 'a8'];
      if (kingSquares.includes(origin)) continue;

      const chess = new Chess();
      chess.clear();
      chess.put({ type: 'b', color: 'w' }, origin as never);
      chess.put({ type: 'k', color: 'w' }, kingSquares[0] as never);
      chess.put({ type: 'k', color: 'b' }, kingSquares[1] as never);

      const destinations = chess
        .moves({ square: origin as never, verbose: true })
        .map((move) => move.to as unknown as SquareName);

      expect(destinations.length, `bishop on ${origin} should have moves`).toBeGreaterThan(0);
      for (const destination of destinations) {
        expect(squareColor(destination), `${origin} -> ${destination}`).toBe(squareColor(origin));
      }
    }
  });
});

describe('orientation mapping', () => {
  const orientations: Orientation[] = ['white', 'black'];

  it('round-trips display position for every square and orientation', () => {
    for (const orientation of orientations) {
      for (const square of ALL_SQUARES) {
        const { row, col } = toDisplayPosition(square, orientation);
        expect(row).toBeGreaterThanOrEqual(0);
        expect(row).toBeLessThan(BOARD_SIZE);
        expect(col).toBeGreaterThanOrEqual(0);
        expect(col).toBeLessThan(BOARD_SIZE);
        expect(fromDisplayPosition(row, col, orientation), `${square}/${orientation}`).toBe(square);
      }
    }
  });

  it('puts a8 top-left and h1 bottom-right for White', () => {
    expect(fromDisplayPosition(0, 0, 'white')).toBe('a8');
    expect(fromDisplayPosition(7, 7, 'white')).toBe('h1');
    expect(toDisplayPosition('a1', 'white')).toEqual({ row: 7, col: 0 });
  });

  it('rotates a half-turn for Black: h1 top-left, a8 bottom-right', () => {
    expect(fromDisplayPosition(0, 0, 'black')).toBe('h1');
    expect(fromDisplayPosition(7, 7, 'black')).toBe('a8');
    expect(toDisplayPosition('a1', 'black')).toEqual({ row: 0, col: 7 });
  });

  it('is exactly a 180-degree rotation between the two orientations', () => {
    for (const square of ALL_SQUARES) {
      const white = toDisplayPosition(square, 'white');
      const black = toDisplayPosition(square, 'black');
      expect(black.row).toBe(BOARD_SIZE - 1 - white.row);
      expect(black.col).toBe(BOARD_SIZE - 1 - white.col);
    }
  });

  it('lists all 64 squares once in display order', () => {
    for (const orientation of orientations) {
      const order = squaresInDisplayOrder(orientation);
      expect(order).toHaveLength(64);
      expect(new Set(order).size).toBe(64);
    }
  });

  it('rejects off-board display positions', () => {
    expect(() => fromDisplayPosition(-1, 0, 'white')).toThrow(RangeError);
    expect(() => fromDisplayPosition(0, 8, 'white')).toThrow(RangeError);
  });
});

describe('alignment relations', () => {
  it('detects shared files, ranks and diagonals', () => {
    expect(sameFile('e2', 'e7')).toBe(true);
    expect(sameFile('e2', 'd2')).toBe(false);
    expect(sameRank('a4', 'h4')).toBe(true);
    expect(sameRank('a4', 'a5')).toBe(false);
    expect(sameDiagonal('c1', 'h6')).toBe(true);
    expect(sameDiagonal('c1', 'c2')).toBe(false);
  });

  it('does not call a square diagonal to itself', () => {
    for (const square of ALL_SQUARES) {
      expect(sameDiagonal(square, square), square).toBe(false);
    }
  });

  it('computes king distance symmetrically', () => {
    expect(kingDistance('a1', 'h8')).toBe(7);
    expect(kingDistance('d4', 'e5')).toBe(1);
    expect(kingDistance('d4', 'd4')).toBe(0);
    for (const a of ALL_SQUARES) {
      for (const b of ALL_SQUARES) {
        expect(kingDistance(a, b)).toBe(kingDistance(b, a));
      }
    }
  });
});

describe('quadrants', () => {
  it('assigns every square to exactly one quadrant of 16', () => {
    const counts = new Map<string, number>();
    for (const square of ALL_SQUARES) {
      const quadrant = quadrantOf(square);
      counts.set(quadrant, (counts.get(quadrant) ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual([16, 16, 16, 16]);
  });

  it('places the named corner squares correctly', () => {
    expect(quadrantOf('a1')).toBe('queenside-white');
    expect(quadrantOf('d4')).toBe('queenside-white');
    expect(quadrantOf('e1')).toBe('kingside-white');
    expect(quadrantOf('h4')).toBe('kingside-white');
    expect(quadrantOf('a5')).toBe('queenside-black');
    expect(quadrantOf('h8')).toBe('kingside-black');
  });

  it('returns 16 squares per quadrant', () => {
    expect(squaresInQuadrant('queenside-white')).toHaveLength(16);
    expect(squaresInQuadrant('kingside-black')).toHaveLength(16);
  });
});

describe('file and rank accessors', () => {
  it('reports zero-based file and rank for every square', () => {
    for (const square of ALL_SQUARES) {
      expect(fileOf(square)).toBe(FILE_LETTERS.indexOf(square[0] as never));
      expect(rankOf(square)).toBe(RANK_DIGITS.indexOf(square[1] as never));
    }
  });
});
