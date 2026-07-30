import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  buildStartingPieces,
  emptySquares,
  fenFromOccupancy,
  fenPlacementFromOccupancy,
  findPieces,
  isPlausibleLegalPosition,
  occupancyFromFen,
  occupancyFromPieces,
  occupancyToPieces,
  squaresOccupiedBy,
  startingOccupancy,
  EMPTY_BOARD_FEN,
  STARTING_FEN,
} from './position';
import { ALL_SQUARES } from './square';
import type { PlacedPiece, SquareName } from './types';

describe('FEN placement parsing', () => {
  it('parses the starting position into 32 pieces', () => {
    const occupancy = startingOccupancy();
    expect(occupancy.size).toBe(32);
    expect(occupancy.get('e1')).toEqual({ type: 'king', color: 'white' });
    expect(occupancy.get('d8')).toEqual({ type: 'queen', color: 'black' });
    expect(occupancy.get('a2')).toEqual({ type: 'pawn', color: 'white' });
    expect(occupancy.get('e4')).toBeUndefined();
  });

  it('parses an empty board', () => {
    expect(occupancyFromFen(EMPTY_BOARD_FEN).size).toBe(0);
    expect(emptySquares(occupancyFromFen(EMPTY_BOARD_FEN))).toHaveLength(64);
  });

  it('accepts a bare placement field as well as a full FEN', () => {
    const full = occupancyFromFen(STARTING_FEN);
    const bare = occupancyFromFen(STARTING_FEN.split(' ')[0]);
    expect([...bare.entries()].sort()).toEqual([...full.entries()].sort());
  });

  it('puts rank 8 first, matching FEN convention', () => {
    const occupancy = occupancyFromFen('8/8/8/8/8/8/8/N7 w - - 0 1');
    expect(occupancy.get('a1')).toEqual({ type: 'knight', color: 'white' });
    expect(occupancy.get('a8')).toBeUndefined();
  });

  it('distinguishes colour by letter case', () => {
    const occupancy = occupancyFromFen('n7/8/8/8/8/8/8/N7 w - - 0 1');
    expect(occupancy.get('a1')?.color).toBe('white');
    expect(occupancy.get('a8')?.color).toBe('black');
  });

  it('rejects malformed FEN placements', () => {
    const bad = [
      '8/8/8/8/8/8/8 w - - 0 1', // seven ranks
      '8/8/8/8/8/8/8/8/8 w - - 0 1', // nine ranks
      '9/8/8/8/8/8/8/8 w - - 0 1', // rank too wide
      '7/8/8/8/8/8/8/8 w - - 0 1', // rank too narrow
      'xxxxxxxx/8/8/8/8/8/8/8 w - - 0 1', // unknown piece letter
      'NNNNNNNNN/8/8/8/8/8/8/8 w - - 0 1', // overflow by pieces
    ];
    for (const fen of bad) {
      expect(() => occupancyFromFen(fen), fen).toThrow(SyntaxError);
    }
  });
});

describe('FEN serialisation', () => {
  it('round-trips the starting position', () => {
    expect(fenPlacementFromOccupancy(startingOccupancy())).toBe(STARTING_FEN.split(' ')[0]);
  });

  it('round-trips an empty board', () => {
    expect(fenPlacementFromOccupancy(new Map())).toBe('8/8/8/8/8/8/8/8');
  });

  it('round-trips every single-piece board through FEN', () => {
    for (const square of ALL_SQUARES) {
      const original = occupancyFromPieces([{ square, type: 'knight', color: 'white' }]);
      const reparsed = occupancyFromFen(fenPlacementFromOccupancy(original));
      expect([...reparsed.entries()], square).toEqual([...original.entries()]);
    }
  });

  it('produces FEN that chess.js accepts for legal positions', () => {
    const occupancy = occupancyFromPieces([
      { square: 'e1', type: 'king', color: 'white' },
      { square: 'e8', type: 'king', color: 'black' },
      { square: 'd4', type: 'knight', color: 'white' },
    ]);
    const fen = fenFromOccupancy(occupancy);
    expect(() => new Chess(fen)).not.toThrow();
    expect(new Chess(fen).fen()).toBe(fen);
  });

  it('encodes gaps as digits without adjacent digits', () => {
    const placement = fenPlacementFromOccupancy(
      occupancyFromPieces([{ square: 'd4', type: 'rook', color: 'black' }]),
    );
    expect(placement).toBe('8/8/8/8/3r4/8/8/8');
    expect(placement).not.toMatch(/\d\d/);
  });

  it('sets the side to move in the full FEN', () => {
    const occupancy = startingOccupancy();
    expect(fenFromOccupancy(occupancy, { turn: 'white' })).toContain(' w ');
    expect(fenFromOccupancy(occupancy, { turn: 'black' })).toContain(' b ');
  });
});

describe('starting position construction', () => {
  it('builds the same board arithmetically as the FEN constant describes', () => {
    const fromFen = startingOccupancy();
    const fromCode = occupancyFromPieces(buildStartingPieces());
    expect(fromCode.size).toBe(32);
    for (const square of ALL_SQUARES) {
      expect(fromCode.get(square), square).toEqual(fromFen.get(square));
    }
  });

  it('places 16 pieces per side', () => {
    const occupancy = startingOccupancy();
    expect(squaresOccupiedBy(occupancy, 'white')).toHaveLength(16);
    expect(squaresOccupiedBy(occupancy, 'black')).toHaveLength(16);
  });

  it('places kings on e1 and e8 and queens on their own colour', () => {
    const occupancy = startingOccupancy();
    expect(findPieces(occupancy, (p) => p.type === 'king')).toEqual(['e1', 'e8']);
    expect(findPieces(occupancy, (p) => p.type === 'queen')).toEqual(['d1', 'd8']);
  });

  it('leaves ranks 3 to 6 empty', () => {
    const occupancy = startingOccupancy();
    const middle = ALL_SQUARES.filter((s) => ['3', '4', '5', '6'].includes(s[1]));
    expect(middle).toHaveLength(32);
    for (const square of middle) expect(occupancy.has(square), square).toBe(false);
  });
});

describe('occupancy helpers', () => {
  it('round-trips pieces through an occupancy map', () => {
    const pieces: PlacedPiece[] = [
      { square: 'a1', type: 'rook', color: 'white' },
      { square: 'h8', type: 'king', color: 'black' },
    ];
    expect(occupancyToPieces(occupancyFromPieces(pieces))).toEqual(pieces);
  });

  it('returns pieces in board index order regardless of input order', () => {
    const pieces: PlacedPiece[] = [
      { square: 'h8', type: 'king', color: 'black' },
      { square: 'a1', type: 'rook', color: 'white' },
    ];
    expect(occupancyToPieces(occupancyFromPieces(pieces)).map((p) => p.square)).toEqual([
      'a1',
      'h8',
    ]);
  });

  it('lets a later piece overwrite an earlier one on the same square', () => {
    const occupancy = occupancyFromPieces([
      { square: 'd4', type: 'rook', color: 'white' },
      { square: 'd4', type: 'queen', color: 'black' },
    ]);
    expect(occupancy.size).toBe(1);
    expect(occupancy.get('d4')).toEqual({ type: 'queen', color: 'black' });
  });
});

describe('legal-position plausibility', () => {
  it('accepts a position with exactly one king per side', () => {
    expect(
      isPlausibleLegalPosition(
        occupancyFromPieces([
          { square: 'e1', type: 'king', color: 'white' },
          { square: 'e8', type: 'king', color: 'black' },
        ]),
      ),
    ).toBe(true);
    expect(isPlausibleLegalPosition(startingOccupancy())).toBe(true);
  });

  it('rejects boards used for vision drills that chess.js would refuse', () => {
    const loneKnight = occupancyFromPieces([{ square: 'd4', type: 'knight', color: 'white' }]);
    expect(isPlausibleLegalPosition(loneKnight)).toBe(false);
    // The point of the check: chess.js really does reject it.
    expect(() => new Chess(fenFromOccupancy(loneKnight))).toThrow();
  });

  it('rejects two kings of the same colour', () => {
    expect(
      isPlausibleLegalPosition(
        occupancyFromPieces([
          { square: 'e1', type: 'king', color: 'white' },
          { square: 'e2', type: 'king', color: 'white' },
          { square: 'e8', type: 'king', color: 'black' },
        ]),
      ),
    ).toBe(false);
  });

  it('rejects a pawn on the first or last rank', () => {
    for (const square of ['a1', 'h8'] as SquareName[]) {
      expect(
        isPlausibleLegalPosition(
          occupancyFromPieces([
            { square: 'e4', type: 'king', color: 'white' },
            { square: 'e6', type: 'king', color: 'black' },
            { square, type: 'pawn', color: 'white' },
          ]),
        ),
        square,
      ).toBe(false);
    }
  });
});
