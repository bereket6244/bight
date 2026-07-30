import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  attackedSquares,
  bishopTargets,
  diagonalsThrough,
  fileSquares,
  firstBlockers,
  geometricTargets,
  kingTargets,
  knightTargets,
  pawnCaptureSquares,
  pawnCaptureTargets,
  pawnDirection,
  pawnPromotionRank,
  pawnPushTargets,
  pawnStartRank,
  queenTargets,
  rankSquares,
  rookTargets,
  sortSquares,
  squaresBetween,
  traceRay,
  BISHOP_DIRECTIONS,
  KNIGHT_VECTORS,
  QUEEN_DIRECTIONS,
  ROOK_DIRECTIONS,
} from './geometry';
import { ALL_SQUARES, toCoordinates, toSquare } from './square';
import { occupancyFromPieces } from './position';
import { toChessJsPiece } from './legal';
import type { Occupancy, Piece, PieceColor, PieceType, PlacedPiece, SquareName } from './types';

/* ------------------------------------------------------------------ *
 * Independent reference implementations.
 *
 * These are written as predicates over square pairs rather than as vector
 * tables, so they share no code path with the production implementation.
 * ------------------------------------------------------------------ */

function delta(from: SquareName, to: SquareName): { df: number; dr: number } {
  const a = toCoordinates(from);
  const b = toCoordinates(to);
  return { df: b.file - a.file, dr: b.rank - a.rank };
}

function referenceTargets(
  from: SquareName,
  predicate: (df: number, dr: number) => boolean,
): SquareName[] {
  return sortSquares(
    ALL_SQUARES.filter((to) => {
      if (to === from) return false;
      const { df, dr } = delta(from, to);
      return predicate(df, dr);
    }),
  );
}

const isKnightDelta = (df: number, dr: number): boolean => {
  const [small, large] = [Math.abs(df), Math.abs(dr)].sort((x, y) => x - y);
  return small === 1 && large === 2;
};
const isKingDelta = (df: number, dr: number): boolean =>
  Math.max(Math.abs(df), Math.abs(dr)) === 1;
const isBishopDelta = (df: number, dr: number): boolean => Math.abs(df) === Math.abs(dr) && df !== 0;
const isRookDelta = (df: number, dr: number): boolean => (df === 0) !== (dr === 0);
const isQueenDelta = (df: number, dr: number): boolean => isBishopDelta(df, dr) || isRookDelta(df, dr);

/** Small deterministic PRNG so blocker layouts are reproducible. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('knight geometry', () => {
  it('matches the independent reference from all 64 origins', () => {
    for (const from of ALL_SQUARES) {
      expect(knightTargets(from), from).toEqual(referenceTargets(from, isKnightDelta));
    }
  });

  it('produces the known target counts by board region', () => {
    // A knight has 2 targets in a corner, 8 in the centre, and never more.
    expect(knightTargets('a1')).toEqual(['b3', 'c2']);
    expect(knightTargets('h8')).toEqual(['f7', 'g6']);
    expect(knightTargets('d4')).toEqual(['b3', 'b5', 'c2', 'c6', 'e2', 'e6', 'f3', 'f5']);
    expect(knightTargets('a4')).toHaveLength(4);
    expect(knightTargets('b1')).toHaveLength(3);
  });

  it('never leaves the board and is always reciprocal', () => {
    for (const from of ALL_SQUARES) {
      const targets = knightTargets(from);
      expect(targets.length).toBeGreaterThanOrEqual(2);
      expect(targets.length).toBeLessThanOrEqual(8);
      for (const to of targets) {
        expect(ALL_SQUARES).toContain(to);
        expect(knightTargets(to), `${to} should see back to ${from}`).toContain(from);
      }
    }
  });

  it('always changes square colour', () => {
    for (const from of ALL_SQUARES) {
      const { file, rank } = toCoordinates(from);
      const originIsDark = (file + rank) % 2 === 0;
      for (const to of knightTargets(from)) {
        const c = toCoordinates(to);
        expect((c.file + c.rank) % 2 === 0, `${from} -> ${to}`).not.toBe(originIsDark);
      }
    }
  });

  it('uses eight distinct vectors', () => {
    const seen = new Set(KNIGHT_VECTORS.map((v) => `${v.df},${v.dr}`));
    expect(seen.size).toBe(8);
  });
});

describe('king geometry', () => {
  it('matches the independent reference from all 64 origins', () => {
    for (const from of ALL_SQUARES) {
      expect(kingTargets(from), from).toEqual(referenceTargets(from, isKingDelta));
    }
  });

  it('yields 3 targets in a corner, 5 on an edge and 8 in the centre', () => {
    expect(kingTargets('a1')).toEqual(['a2', 'b1', 'b2']);
    expect(kingTargets('a4')).toHaveLength(5);
    expect(kingTargets('e4')).toHaveLength(8);
    expect(kingTargets('h8')).toEqual(['g7', 'g8', 'h7']);
  });
});

describe('sliding geometry without occupancy', () => {
  it('matches the independent bishop reference from all 64 origins', () => {
    for (const from of ALL_SQUARES) {
      expect(bishopTargets(from), from).toEqual(referenceTargets(from, isBishopDelta));
    }
  });

  it('matches the independent rook reference from all 64 origins', () => {
    for (const from of ALL_SQUARES) {
      expect(rookTargets(from), from).toEqual(referenceTargets(from, isRookDelta));
    }
  });

  it('matches the independent queen reference from all 64 origins', () => {
    for (const from of ALL_SQUARES) {
      expect(queenTargets(from), from).toEqual(referenceTargets(from, isQueenDelta));
    }
  });

  it('gives a rook 14 targets from every square', () => {
    for (const from of ALL_SQUARES) {
      expect(rookTargets(from), from).toHaveLength(14);
    }
  });

  it('gives a bishop 7 targets in the corners and 13 in the centre', () => {
    expect(bishopTargets('a1')).toHaveLength(7);
    expect(bishopTargets('h8')).toHaveLength(7);
    expect(bishopTargets('d4')).toHaveLength(13);
    expect(bishopTargets('e5')).toHaveLength(13);
  });

  it('makes queen targets the exact union of rook and bishop targets', () => {
    for (const from of ALL_SQUARES) {
      const union = sortSquares(new Set([...rookTargets(from), ...bishopTargets(from)]));
      expect(queenTargets(from), from).toEqual(union);
    }
  });

  it('keeps a bishop on its own colour and a rook off diagonals', () => {
    for (const from of ALL_SQUARES) {
      for (const to of bishopTargets(from)) {
        const { df, dr } = delta(from, to);
        expect(Math.abs(df)).toBe(Math.abs(dr));
      }
      for (const to of rookTargets(from)) {
        const { df, dr } = delta(from, to);
        expect(df === 0 || dr === 0).toBe(true);
      }
    }
  });
});

describe('ray tracing with blockers', () => {
  function occ(pieces: PlacedPiece[]): Occupancy {
    return occupancyFromPieces(pieces);
  }

  it('stops at a friendly piece and excludes it', () => {
    const occupancy = occ([{ square: 'd6', type: 'pawn', color: 'white' }]);
    const targets = rookTargets('d4', { occupancy, moverColor: 'white' });
    expect(targets).toContain('d5');
    expect(targets).not.toContain('d6');
    expect(targets).not.toContain('d7');
  });

  it('stops at an enemy piece and includes it as a capture', () => {
    const occupancy = occ([{ square: 'd6', type: 'pawn', color: 'black' }]);
    const targets = rookTargets('d4', { occupancy, moverColor: 'white' });
    expect(targets).toContain('d5');
    expect(targets).toContain('d6');
    expect(targets).not.toContain('d7');
  });

  it('excludes the blocker entirely under the quiet-move policy', () => {
    const occupancy = occ([{ square: 'd6', type: 'pawn', color: 'black' }]);
    const targets = rookTargets('d4', {
      occupancy,
      moverColor: 'white',
      blockerPolicy: 'exclude',
    });
    expect(targets).toContain('d5');
    expect(targets).not.toContain('d6');
  });

  it('counts a friendly blocker as defended under the attack policy', () => {
    const occupancy = occ([{ square: 'd6', type: 'pawn', color: 'white' }]);
    const moves = rookTargets('d4', { occupancy, moverColor: 'white' });
    const attacks = rookTargets('d4', {
      occupancy,
      moverColor: 'white',
      blockerPolicy: 'include-any',
    });
    expect(moves).not.toContain('d6');
    expect(attacks).toContain('d6');
    expect(attacks).not.toContain('d7');
  });

  it('treats an adjacent blocker as blocking the whole ray', () => {
    const occupancy = occ([{ square: 'd5', type: 'rook', color: 'white' }]);
    const targets = rookTargets('d4', { occupancy, moverColor: 'white' });
    for (const square of ['d5', 'd6', 'd7', 'd8'] as SquareName[]) {
      expect(targets, square).not.toContain(square);
    }
    expect(targets).toContain('d3');
  });

  it('blocks each direction independently', () => {
    const occupancy = occ([
      { square: 'b4', type: 'pawn', color: 'white' },
      { square: 'f4', type: 'pawn', color: 'black' },
    ]);
    const targets = rookTargets('d4', { occupancy, moverColor: 'white' });
    expect(targets).toContain('c4');
    expect(targets).not.toContain('b4');
    expect(targets).not.toContain('a4');
    expect(targets).toContain('e4');
    expect(targets).toContain('f4');
    expect(targets).not.toContain('g4');
    // The vertical ray is untouched.
    expect(targets).toContain('d8');
    expect(targets).toContain('d1');
  });

  it('reports the first blocker per direction', () => {
    const occupancy = occ([
      { square: 'd6', type: 'pawn', color: 'black' },
      { square: 'd7', type: 'pawn', color: 'black' },
      { square: 'b4', type: 'pawn', color: 'white' },
    ]);
    expect(firstBlockers('d4', ROOK_DIRECTIONS, occupancy)).toEqual(['b4', 'd6']);
  });

  it('returns an empty ray when the very first square is off-board', () => {
    expect(traceRay('a1', { df: -1, dr: 0 })).toEqual([]);
    expect(traceRay('h8', { df: 1, dr: 1 })).toEqual([]);
  });

  it('orders ray squares by increasing distance', () => {
    expect(traceRay('a1', { df: 1, dr: 1 })).toEqual(['b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8']);
    expect(traceRay('d4', { df: 0, dr: 1 })).toEqual(['d5', 'd6', 'd7', 'd8']);
  });
});

describe('pawn geometry', () => {
  it('uses the correct direction and start rank per colour', () => {
    expect(pawnDirection('white')).toBe(1);
    expect(pawnDirection('black')).toBe(-1);
    expect(pawnStartRank('white')).toBe(1);
    expect(pawnStartRank('black')).toBe(6);
    expect(pawnPromotionRank('white')).toBe(7);
    expect(pawnPromotionRank('black')).toBe(0);
  });

  it('offers a double push only from the starting rank', () => {
    expect(pawnPushTargets('e2', 'white')).toEqual(['e3', 'e4']);
    expect(pawnPushTargets('e3', 'white')).toEqual(['e4']);
    expect(pawnPushTargets('e7', 'black')).toEqual(['e5', 'e6']);
    expect(pawnPushTargets('e6', 'black')).toEqual(['e5']);
  });

  it('blocks the single and double push independently', () => {
    const blockedSingle = occupancyFromPieces([{ square: 'e3', type: 'pawn', color: 'black' }]);
    expect(pawnPushTargets('e2', 'white', blockedSingle)).toEqual([]);

    const blockedDouble = occupancyFromPieces([{ square: 'e4', type: 'pawn', color: 'black' }]);
    expect(pawnPushTargets('e2', 'white', blockedDouble)).toEqual(['e3']);
  });

  it('never treats a push as a capture', () => {
    const enemyAhead = occupancyFromPieces([{ square: 'e3', type: 'rook', color: 'black' }]);
    expect(pawnPushTargets('e2', 'white', enemyAhead)).toEqual([]);
  });

  it('gives two capture squares in the centre and one on a file edge', () => {
    expect(pawnCaptureSquares('e4', 'white')).toEqual(['d5', 'f5']);
    expect(pawnCaptureSquares('a4', 'white')).toEqual(['b5']);
    expect(pawnCaptureSquares('h4', 'white')).toEqual(['g5']);
    expect(pawnCaptureSquares('e5', 'black')).toEqual(['d4', 'f4']);
    expect(pawnCaptureSquares('a5', 'black')).toEqual(['b4']);
  });

  it('only reports captures where an enemy actually stands', () => {
    const occupancy = occupancyFromPieces([
      { square: 'd5', type: 'pawn', color: 'black' },
      { square: 'f5', type: 'pawn', color: 'white' },
    ]);
    expect(pawnCaptureTargets('e4', 'white', occupancy)).toEqual(['d5']);
  });

  it('returns nothing for a pawn standing on its promotion rank', () => {
    expect(pawnPushTargets('e8', 'white')).toEqual([]);
    expect(pawnCaptureSquares('e8', 'white')).toEqual([]);
    expect(pawnPushTargets('e1', 'black')).toEqual([]);
    expect(pawnCaptureSquares('e1', 'black')).toEqual([]);
  });

  it('separates attacks from moves in the geometry entry point', () => {
    const pawn: Piece = { type: 'pawn', color: 'white' };
    expect(geometricTargets(pawn, 'e2', { pawnCaptureMode: 'pushes-only' })).toEqual(['e3', 'e4']);
    expect(geometricTargets(pawn, 'e2', { pawnCaptureMode: 'attacks-only' })).toEqual(['d3', 'f3']);
    expect(attackedSquares(pawn, 'e2')).toEqual(['d3', 'f3']);
  });
});

describe('geometricTargets entry point', () => {
  const types: PieceType[] = ['knight', 'bishop', 'rook', 'queen', 'king'];

  it('drops friendly-occupied squares for leapers', () => {
    const occupancy = occupancyFromPieces([
      { square: 'b3', type: 'pawn', color: 'white' },
      { square: 'c2', type: 'pawn', color: 'black' },
    ]);
    const targets = geometricTargets({ type: 'knight', color: 'white' }, 'a1', { occupancy });
    expect(targets).toEqual(['c2']);
  });

  it('ignores occupancy entirely when none is supplied', () => {
    for (const type of types) {
      for (const from of ALL_SQUARES) {
        const withoutOccupancy = geometricTargets({ type, color: 'white' }, from);
        const emptyOccupancy = geometricTargets({ type, color: 'white' }, from, {
          occupancy: new Map(),
        });
        expect(withoutOccupancy, `${type} on ${from}`).toEqual(emptyOccupancy);
      }
    }
  });

  it('never returns the origin square itself', () => {
    for (const type of [...types, 'pawn' as PieceType]) {
      for (const from of ALL_SQUARES) {
        expect(geometricTargets({ type, color: 'white' }, from), `${type} ${from}`).not.toContain(
          from,
        );
      }
    }
  });

  it('always returns at least one target for every non-pawn piece and square', () => {
    for (const type of types) {
      for (const from of ALL_SQUARES) {
        expect(geometricTargets({ type, color: 'white' }, from).length, `${type} ${from}`).
          toBeGreaterThan(0);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Cross-check against chess.js.
 *
 * `attackers()` is generated from chess.js's own attack tables and ignores
 * pins and turn order, which is exactly the semantics of Bight's geometry
 * layer. Comparing against it validates blocker handling on real positions
 * without the two implementations sharing any code.
 * ------------------------------------------------------------------ */
describe('cross-check against chess.js attack generation', () => {
  const types: PieceType[] = ['knight', 'bishop', 'rook', 'queen', 'king', 'pawn'];

  function buildPosition(
    origin: SquareName,
    piece: Piece,
    blockers: PlacedPiece[],
  ): { chess: Chess; occupancy: Occupancy } {
    const chess = new Chess();
    chess.clear();
    chess.put(
      { type: toChessJsPiece(piece.type), color: piece.color === 'white' ? 'w' : 'b' },
      origin as never,
    );
    for (const blocker of blockers) {
      chess.put(
        { type: toChessJsPiece(blocker.type), color: blocker.color === 'white' ? 'w' : 'b' },
        blocker.square as never,
      );
    }
    const occupancy = occupancyFromPieces([
      { square: origin, type: piece.type, color: piece.color },
      ...blockers,
    ]);
    return { chess, occupancy };
  }

  it('agrees on attacked squares for every piece type on every origin', () => {
    const random = makeRandom(20260730);

    for (const type of types) {
      for (const color of ['white', 'black'] as PieceColor[]) {
        for (const origin of ALL_SQUARES) {
          // A pawn cannot stand on the first or last rank.
          const { rank } = toCoordinates(origin);
          if (type === 'pawn' && (rank === 0 || rank === 7)) continue;

          // Scatter a handful of blockers that never sit on the origin.
          const blockers: PlacedPiece[] = [];
          const used = new Set<SquareName>([origin]);
          for (let i = 0; i < 6; i += 1) {
            const candidate = ALL_SQUARES[Math.floor(random() * 64)] as SquareName;
            const candidateRank = toCoordinates(candidate).rank;
            if (used.has(candidate)) continue;
            if (candidateRank === 0 || candidateRank === 7) continue;
            used.add(candidate);
            blockers.push({
              square: candidate,
              type: 'pawn',
              color: random() < 0.5 ? 'white' : 'black',
            });
          }

          const piece: Piece = { type, color };
          const { chess, occupancy } = buildPosition(origin, piece, blockers);

          const mine = new Set(attackedSquares(piece, origin, { occupancy }));

          for (const target of ALL_SQUARES) {
            if (target === origin) continue;
            const attackerSquares = chess
              .attackers(target as never, color === 'white' ? 'w' : 'b')
              .map((sq) => sq as unknown as SquareName);
            const theirs = attackerSquares.includes(origin);
            expect(
              mine.has(target),
              `${color} ${type} on ${origin} -> ${target} (blockers: ${blockers
                .map((b) => `${b.color[0]}${b.square}`)
                .join(',')})`,
            ).toBe(theirs);
          }
        }
      }
    }
  });
});

describe('lines, diagonals and between-squares', () => {
  it('returns the whole file and rank including the origin', () => {
    expect(fileSquares('d4')).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8']);
    expect(rankSquares('d4')).toEqual(['a4', 'b4', 'c4', 'd4', 'e4', 'f4', 'g4', 'h4']);
    for (const square of ALL_SQUARES) {
      expect(fileSquares(square), square).toHaveLength(8);
      expect(rankSquares(square), square).toHaveLength(8);
      expect(fileSquares(square)).toContain(square);
    }
  });

  it('returns both diagonals through a square, each including the origin', () => {
    const [rising, falling] = diagonalsThrough('d4');
    expect(rising).toEqual(['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8']);
    expect(falling).toEqual(['a7', 'b6', 'c5', 'd4', 'e3', 'f2', 'g1']);
  });

  it('computes squares strictly between aligned squares', () => {
    expect(squaresBetween('a1', 'a4')).toEqual(['a2', 'a3']);
    expect(squaresBetween('a1', 'd4')).toEqual(['b2', 'c3']);
    expect(squaresBetween('d4', 'a1')).toEqual(['c3', 'b2']);
    expect(squaresBetween('a1', 'b2')).toEqual([]);
    expect(squaresBetween('a1', 'a1')).toEqual([]);
  });

  it('returns nothing between unaligned squares', () => {
    expect(squaresBetween('a1', 'b4')).toEqual([]);
    expect(squaresBetween('d4', 'e6')).toEqual([]);
  });

  it('keeps every between-square on the connecting line', () => {
    for (const from of ALL_SQUARES) {
      for (const to of queenTargets(from)) {
        for (const mid of squaresBetween(from, to)) {
          expect(queenTargets(from), `${from}-${mid}-${to}`).toContain(mid);
        }
      }
    }
  });
});

describe('direction tables', () => {
  it('defines 4 rook, 4 bishop and 8 queen directions', () => {
    expect(ROOK_DIRECTIONS).toHaveLength(4);
    expect(BISHOP_DIRECTIONS).toHaveLength(4);
    expect(QUEEN_DIRECTIONS).toHaveLength(8);
    expect(new Set(QUEEN_DIRECTIONS.map((v) => `${v.df},${v.dr}`)).size).toBe(8);
  });

  it('keeps every direction a unit step', () => {
    for (const vector of QUEEN_DIRECTIONS) {
      expect(Math.abs(vector.df)).toBeLessThanOrEqual(1);
      expect(Math.abs(vector.dr)).toBeLessThanOrEqual(1);
      expect(vector.df === 0 && vector.dr === 0).toBe(false);
    }
  });
});

describe('board construction helpers used by drills', () => {
  it('builds an occupancy that agrees with toSquare arithmetic', () => {
    const occupancy = occupancyFromPieces([{ square: toSquare(4, 3), type: 'knight', color: 'white' }]);
    expect(occupancy.get('e4')).toEqual({ type: 'knight', color: 'white' });
  });
});
