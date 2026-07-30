import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  applyMove,
  attackedSquaresByColor,
  attackersOf,
  allLegalDestinations,
  isLegalMove,
  isValidPosition,
  legalDestinations,
  loadPosition,
  pieceAt,
  sideToMove,
  IllegalPositionError,
} from './legal';
import { geometricTargets } from './geometry';
import { occupancyFromFen, STARTING_FEN } from './position';
import type { SquareName } from './types';

const KINGS_ONLY = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';

describe('position loading', () => {
  it('accepts the starting position', () => {
    expect(isValidPosition(STARTING_FEN)).toBe(true);
    expect(sideToMove(STARTING_FEN)).toBe('white');
  });

  it('rejects positions without kings unless validation is skipped', () => {
    const loneKnight = '8/8/8/3N4/8/8/8/8 w - - 0 1';
    expect(isValidPosition(loneKnight)).toBe(false);
    expect(() => loadPosition(loneKnight)).toThrow(IllegalPositionError);
    expect(() => loadPosition(loneKnight, { skipValidation: true })).not.toThrow();
  });

  it('reports the piece standing on a square', () => {
    expect(pieceAt(STARTING_FEN, 'e1')).toEqual({ type: 'king', color: 'white' });
    expect(pieceAt(STARTING_FEN, 'g8')).toEqual({ type: 'knight', color: 'black' });
    expect(pieceAt(STARTING_FEN, 'e4')).toBeNull();
  });
});

describe('legal destinations', () => {
  it('gives the knight its two opening moves from g1', () => {
    // e2 is blocked by White's own pawn, so only f3 and h3 remain.
    expect(legalDestinations(STARTING_FEN, 'g1')).toEqual(['f3', 'h3']);
  });

  it('gives every pawn a single and double push at the start', () => {
    expect(legalDestinations(STARTING_FEN, 'e2')).toEqual(['e3', 'e4']);
  });

  it('returns nothing for an empty square or a blocked piece', () => {
    expect(legalDestinations(STARTING_FEN, 'e4')).toEqual([]);
    expect(legalDestinations(STARTING_FEN, 'c1')).toEqual([]);
    expect(legalDestinations(STARTING_FEN, 'a1')).toEqual([]);
  });

  it('collapses the four promotion moves to one destination square', () => {
    const fen = '8/4P3/8/8/8/8/8/4K2k w - - 0 1';
    const moves = new Chess(fen).moves({ square: 'e7' as never, verbose: true });
    expect(moves.length).toBe(4); // Q, R, B, N
    expect(legalDestinations(fen, 'e7')).toEqual(['e8']);
  });

  it('includes castling as a king destination', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    expect(legalDestinations(fen, 'e1')).toContain('g1');
    expect(legalDestinations(fen, 'e1')).toContain('c1');
  });

  it('includes en passant as a pawn destination', () => {
    const fen = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';
    expect(legalDestinations(fen, 'e5')).toContain('d6');
  });

  it('respects pins - a pinned knight has no legal moves', () => {
    // Black knight on e7 is pinned to the king on e8 by the rook on e1.
    const fen = '4k3/4n3/8/8/8/8/8/4R1K1 b - - 0 1';
    expect(legalDestinations(fen, 'e7')).toEqual([]);
    // Geometry still sees the knight's eight squares - the two are different
    // questions, and Bight must never conflate them.
    expect(geometricTargets({ type: 'knight', color: 'black' }, 'e7').length).toBeGreaterThan(0);
  });

  it('forces check evasion', () => {
    // White king on e1 is checked by the rook on e8; only sideways moves work.
    const fen = '4r2k/8/8/8/8/8/8/4K3 w - - 0 1';
    const destinations = legalDestinations(fen, 'e1');
    expect(destinations).not.toContain('e2');
    expect(destinations).toEqual(['d1', 'd2', 'f1', 'f2']);
  });

  it('only generates moves for the side to move', () => {
    expect(legalDestinations(STARTING_FEN, 'e7')).toEqual([]);
    const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    expect(legalDestinations(afterE4, 'e7')).toEqual(['e5', 'e6']);
  });

  it('groups every legal move by origin square', () => {
    const grouped = allLegalDestinations(STARTING_FEN);
    // 8 pawns x 2 + 2 knights x 2 = 20 moves from 10 squares.
    expect(grouped.size).toBe(10);
    expect([...grouped.values()].flat()).toHaveLength(20);
    expect(grouped.get('b1')).toEqual(['a3', 'c3']);
  });
});

describe('move application', () => {
  it('plays a legal move and returns the new position', () => {
    const result = applyMove(STARTING_FEN, 'e2', 'e4');
    expect(result).not.toBeNull();
    expect(result?.san).toBe('e4');
    expect(result?.fen).toContain(' b ');
    expect(occupancyFromFen(result!.fen).get('e4')).toEqual({ type: 'pawn', color: 'white' });
    expect(occupancyFromFen(result!.fen).get('e2')).toBeUndefined();
  });

  it('returns null for an illegal move instead of throwing', () => {
    expect(applyMove(STARTING_FEN, 'e2', 'e5')).toBeNull();
    expect(applyMove(STARTING_FEN, 'e4', 'e5')).toBeNull();
    expect(applyMove(STARTING_FEN, 'e7', 'e5')).toBeNull();
  });

  it('never mutates the position it was given', () => {
    const before = STARTING_FEN;
    applyMove(before, 'e2', 'e4');
    expect(before).toBe(STARTING_FEN);
    expect(legalDestinations(STARTING_FEN, 'e2')).toEqual(['e3', 'e4']);
  });

  it('reports captures, promotion, en passant and castling', () => {
    const capture = applyMove('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 'e4', 'd5');
    expect(capture?.captured).toBe('pawn');

    const promotion = applyMove('8/4P3/8/8/8/8/8/4K2k w - - 0 1', 'e7', 'e8', 'queen');
    expect(promotion?.isPromotion).toBe(true);

    const enPassant = applyMove('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5', 'd6');
    expect(enPassant?.isEnPassant).toBe(true);

    const castle = applyMove('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1', 'g1');
    expect(castle?.isCastle).toBe(true);
    expect(castle?.san).toBe('O-O');
  });

  it('honours the requested promotion piece', () => {
    const fen = '8/4P3/8/8/8/8/8/4K2k w - - 0 1';
    expect(applyMove(fen, 'e7', 'e8', 'knight')?.san).toContain('N');
    expect(applyMove(fen, 'e7', 'e8', 'queen')?.san).toContain('Q');
  });
});

describe('attack queries', () => {
  it('reports squares attacked by a colour', () => {
    const fen = '4k3/8/8/8/8/8/8/4K1N1 w - - 0 1';
    const attacked = attackedSquaresByColor(fen, 'white');
    expect(attacked).toContain('f3'); // knight on g1
    expect(attacked).toContain('h3');
    expect(attacked).toContain('e2'); // king on e1
    expect(attacked).not.toContain('a5');
  });

  it('reports which squares attack a target', () => {
    const fen = '4k3/8/8/8/8/5N2/8/4K2R w - - 0 1';
    expect(attackersOf(fen, 'g5', 'white')).toEqual(['f3']);
    expect(attackersOf(fen, 'h5', 'white')).toEqual(['h1']);
  });

  it('counts a defended friendly piece as attacked', () => {
    // The rook on h1 defends the knight on h3.
    const fen = '4k3/8/8/8/8/7N/8/4K2R w - - 0 1';
    expect(attackersOf(fen, 'h3', 'white')).toContain('h1');
  });

  it('finds no attackers for an unreachable square', () => {
    expect(attackersOf(KINGS_ONLY, 'd5', 'white')).toEqual([]);
  });
});

describe('legal and geometric semantics stay distinct', () => {
  it('shows geometry ignoring occupancy where legality does not', () => {
    // A rook on a1 at the start sees the whole a-file geometrically, but has
    // no legal move because its own pawn blocks it.
    const geometric = geometricTargets({ type: 'rook', color: 'white' }, 'a1');
    expect(geometric).toContain('a8');
    expect(legalDestinations(STARTING_FEN, 'a1')).toEqual([]);
  });

  it('agrees when the position imposes no extra constraint', () => {
    // Lone white knight on d4 with distant kings: legal moves equal geometry.
    const fen = '7k/8/8/8/3N4/8/8/K7 w - - 0 1';
    const geometric = geometricTargets({ type: 'knight', color: 'white' }, 'd4');
    expect(legalDestinations(fen, 'd4')).toEqual(geometric);
  });

  it('matches geometry-with-occupancy for a queen among blockers', () => {
    const fen = '7k/8/8/3p4/3Q4/8/3P4/K7 w - - 0 1';
    const occupancy = occupancyFromFen(fen);
    const geometric = geometricTargets({ type: 'queen', color: 'white' }, 'd4', { occupancy });
    // d5 is a capture, d2 is blocked by White's own pawn.
    expect(geometric).toContain('d5');
    expect(geometric).not.toContain('d2');
    expect(geometric).not.toContain('d6');
    expect(legalDestinations(fen, 'd4')).toEqual(geometric);
  });
});

describe('exhaustive legal-move agreement for lone pieces', () => {
  /**
   * For every piece type on every square, with kings tucked into corners far
   * from the action, chess.js legal moves must equal Bight's occupancy-aware
   * geometry. This is the strongest available statement that the two layers
   * agree when legality adds no constraints.
   */
  it('matches chess.js for a lone piece on every reachable square', () => {
    const types = ['knight', 'bishop', 'rook', 'queen'] as const;
    const whiteKing: SquareName = 'a1';
    const blackKing: SquareName = 'h8';

    for (const type of types) {
      for (const square of ['b3', 'c4', 'd4', 'e5', 'f6', 'd1', 'a4', 'h5', 'g2'] as SquareName[]) {
        if (square === whiteKing || square === blackKing) continue;

        const chess = new Chess();
        chess.clear();
        chess.put({ type: 'k', color: 'w' }, whiteKing as never);
        chess.put({ type: 'k', color: 'b' }, blackKing as never);
        chess.put(
          { type: type === 'knight' ? 'n' : type[0], color: 'w' } as never,
          square as never,
        );

        const fen = chess.fen();
        if (!isValidPosition(fen)) continue;

        const occupancy = occupancyFromFen(fen);
        const geometric = geometricTargets({ type, color: 'white' }, square, { occupancy });
        expect(legalDestinations(fen, square), `${type} on ${square}`).toEqual(geometric);
      }
    }
  });
});

describe('isLegalMove', () => {
  it('answers directly for common cases', () => {
    expect(isLegalMove(STARTING_FEN, 'e2', 'e4')).toBe(true);
    expect(isLegalMove(STARTING_FEN, 'e2', 'e5')).toBe(false);
    expect(isLegalMove(STARTING_FEN, 'g1', 'f3')).toBe(true);
    expect(isLegalMove(STARTING_FEN, 'g1', 'g3')).toBe(false);
  });
});
