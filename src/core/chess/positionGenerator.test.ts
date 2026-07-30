import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  contestedMoves,
  describeMoves,
  fenPieceCount,
  generatePosition,
  movesByType,
  MAX_PIECES,
  MIN_PIECES,
} from './positionGenerator';
import { createRng } from '../rng';

const SEEDS = [1, 2, 3, 7, 11, 42, 99, 1234, 20260731, 555];

describe('position generation', () => {
  it('produces a legal position chess.js accepts', () => {
    for (const seed of SEEDS) {
      const position = generatePosition(createRng(seed));
      expect(position, `seed ${seed}`).not.toBeNull();
      expect(() => new Chess(position!.fen)).not.toThrow();
    }
  });

  it('respects the piece-density window', () => {
    for (const seed of SEEDS) {
      const position = generatePosition(createRng(seed));
      expect(position!.pieceCount).toBeGreaterThanOrEqual(MIN_PIECES);
      expect(position!.pieceCount).toBeLessThanOrEqual(MAX_PIECES);
      // The FEN itself agrees with the reported count.
      expect(fenPieceCount(position!.fen)).toBe(position!.pieceCount);
    }
  });

  it('never produces a sparse two-or-three-piece board', () => {
    for (const seed of SEEDS) {
      const position = generatePosition(createRng(seed));
      expect(position!.pieceCount).toBeGreaterThan(3);
    }
  });

  it('always includes both kings', () => {
    for (const seed of SEEDS) {
      const position = generatePosition(createRng(seed));
      const placement = position!.fen.split(' ')[0] as string;
      expect(placement, `seed ${seed}`).toContain('K');
      expect(placement).toContain('k');
    }
  });

  it('honours a requested side to move', () => {
    for (const seed of SEEDS) {
      const white = generatePosition(createRng(seed), { turn: 'white' });
      expect(white!.fen.split(' ')[1]).toBe('w');
      const black = generatePosition(createRng(seed), { turn: 'black' });
      expect(black!.fen.split(' ')[1]).toBe('b');
    }
  });

  it('avoids positions where the side to move is in check', () => {
    for (const seed of SEEDS) {
      const position = generatePosition(createRng(seed), { avoidCheck: true });
      expect(new Chess(position!.fen).isCheck(), `seed ${seed}`).toBe(false);
    }
  });

  it('never returns a finished game', () => {
    for (const seed of SEEDS) {
      const position = generatePosition(createRng(seed));
      const chess = new Chess(position!.fen);
      expect(chess.isGameOver(), `seed ${seed}`).toBe(false);
      expect(chess.moves().length).toBeGreaterThan(0);
    }
  });

  it('can require two knights of the moving side', () => {
    for (const seed of SEEDS) {
      const position = generatePosition(createRng(seed), {
        turn: 'white',
        require: { type: 'knight', color: 'white', count: 2 },
      });
      expect(position, `seed ${seed}`).not.toBeNull();

      const knights = new Chess(position!.fen)
        .board()
        .flat()
        .filter((sq) => sq !== null && sq.type === 'n' && sq.color === 'w');
      expect(knights.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('can request a narrower density band', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const position = generatePosition(createRng(seed), { minPieces: 20, maxPieces: 26 });
      if (position === null) continue;
      expect(position.pieceCount).toBeGreaterThanOrEqual(20);
      expect(position.pieceCount).toBeLessThanOrEqual(26);
    }
  });

  it('is reproducible from a seed', () => {
    for (const seed of SEEDS) {
      expect(generatePosition(createRng(seed))!.fen).toBe(generatePosition(createRng(seed))!.fen);
    }
  });

  it('returns null rather than looping forever on an impossible request', () => {
    // No position from the standard start has 40 pieces.
    expect(generatePosition(createRng(1), { minPieces: 40, maxPieces: 64 }, 5)).toBeNull();
  });
});

describe('move description', () => {
  it('uses SAN produced by chess.js', () => {
    for (const seed of SEEDS) {
      const position = generatePosition(createRng(seed));
      const chess = new Chess(position!.fen);
      const sanFromChessJs = new Set(chess.moves());

      for (const move of describeMoves(position!.fen)) {
        expect(sanFromChessJs, `${position!.fen}: ${move.san}`).toContain(move.san);
      }
    }
  });

  it('reports every legal move', () => {
    for (const seed of SEEDS) {
      const position = generatePosition(createRng(seed));
      expect(describeMoves(position!.fen).length).toBe(new Chess(position!.fen).moves().length);
    }
  });

  it('every described move is legal in the position', () => {
    for (const seed of SEEDS) {
      const position = generatePosition(createRng(seed));
      for (const move of describeMoves(position!.fen)) {
        const chess = new Chess(position!.fen);
        expect(() => chess.move({ from: move.from, to: move.to, promotion: 'q' })).not.toThrow();
      }
    }
  });

  it('identifies rival pieces competing for a destination', () => {
    // Two white knights on b1 and f3 can both reach d2.
    const fen = 'rnbqkbnr/pppppppp/8/8/8/5N2/PPP1PPPP/RNBQKB1R w KQkq - 0 1';
    const moves = describeMoves(fen).filter((m) => m.to === 'd2' && m.type === 'knight');
    expect(moves.length).toBe(2);
    for (const move of moves) expect(move.rivals.length).toBe(1);
    expect(moves.map((m) => m.from).sort()).toEqual(['b1', 'f3']);
  });

  it('marks SAN that chess.js disambiguated', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/5N2/PPP1PPPP/RNBQKB1R w KQkq - 0 1';
    const moves = describeMoves(fen).filter((m) => m.to === 'd2' && m.type === 'knight');
    for (const move of moves) {
      expect(move.isDisambiguated, move.san).toBe(true);
      expect(move.san).toMatch(/^N[bf]d2$/);
    }
  });

  it('does not mark an unambiguous move as disambiguated', () => {
    const opening = describeMoves('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    const nf3 = opening.find((m) => m.san === 'Nf3');
    expect(nf3).toBeDefined();
    expect(nf3!.isDisambiguated).toBe(false);
    expect(nf3!.rivals).toEqual([]);
  });

  it('finds contested moves across generated positions', () => {
    let found = 0;
    for (const seed of SEEDS) {
      const position = generatePosition(createRng(seed), { turn: 'white' });
      found += contestedMoves(position!.fen).length;
    }
    // Real positions routinely contain contested destinations.
    expect(found).toBeGreaterThan(0);
  });

  it('filters contested moves by piece type', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/5N2/PPP1PPPP/RNBQKB1R w KQkq - 0 1';
    const knightOnly = contestedMoves(fen, 'knight');
    expect(knightOnly.length).toBeGreaterThan(0);
    for (const move of knightOnly) expect(move.type).toBe('knight');
  });

  it('filters moves by type', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/5N2/PPP1PPPP/RNBQKB1R w KQkq - 0 1';
    for (const type of ['knight', 'queen', 'rook', 'king'] as const) {
      const moves = movesByType(fen, type);
      for (const move of moves) expect(move.type, move.san).toBe(type);
    }
    expect(movesByType(fen, 'knight').length).toBeGreaterThan(0);
  });

  it('returns nothing for an unparseable position', () => {
    expect(describeMoves('not a fen')).toEqual([]);
  });
});

describe('piece counting', () => {
  it('counts pieces in a FEN placement', () => {
    expect(fenPieceCount('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe(32);
    expect(fenPieceCount('8/8/8/8/8/8/8/K6k w - - 0 1')).toBe(2);
  });
});
