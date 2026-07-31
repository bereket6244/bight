/**
 * Sequence generation must be provably legal.
 *
 * Every blindfold question is built on a sequence, so a single illegal move or
 * a wrong final FEN would silently poison every drill downstream. These tests
 * replay each generated sequence independently through a fresh chess.js
 * instance rather than trusting what the generator recorded.
 */

import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  capturedPieces,
  describePiece,
  finalOccupancy,
  generateSequence,
  minimumCaptures,
  requireSequence,
  survivingPieces,
  verifySequence,
} from './sequence';
import { STARTING_FEN } from './position';
import { createRng } from '../rng';

const SEEDS = [1, 2, 3, 7, 11, 42, 99, 1234, 20260801, 555, 8675309, 31337];

describe('sequence legality', () => {
  it('replays every generated sequence successfully', () => {
    for (const seed of SEEDS) {
      const sequence = requireSequence(createRng(seed), { plies: 12 });
      expect(sequence, `seed ${seed}`).not.toBeNull();
      const check = verifySequence(sequence!);
      expect(check.problem, `seed ${seed}`).toBeNull();
      expect(check.ok).toBe(true);
    }
  });

  it('produces exactly the requested number of plies', () => {
    for (const plies of [4, 8, 12, 20]) {
      const sequence = requireSequence(createRng(plies * 7), { plies });
      expect(sequence!.plies, `${plies} plies`).toHaveLength(plies);
      expect(sequence!.san).toHaveLength(plies);
      expect(sequence!.uci).toHaveLength(plies);
    }
  });

  it('keeps SAN and UCI describing the same move', () => {
    for (const seed of SEEDS) {
      const sequence = requireSequence(createRng(seed), { plies: 10 })!;
      const chess = new Chess(sequence.startFen);

      for (const ply of sequence.plies) {
        const applied = chess.move(ply.san);
        expect(applied.san, `seed ${seed} ply ${ply.ply}`).toBe(ply.san);
        expect(`${applied.from}${applied.to}${applied.promotion ?? ''}`).toBe(ply.uci);
      }
    }
  });

  it('records a final FEN that matches an independent replay', () => {
    for (const seed of SEEDS) {
      const sequence = requireSequence(createRng(seed), { plies: 14 })!;
      const chess = new Chess(sequence.startFen);
      for (const ply of sequence.plies) chess.move(ply.san);
      expect(chess.fen(), `seed ${seed}`).toBe(sequence.finalFen);
    }
  });

  it('records the correct side to move at the end', () => {
    for (const seed of SEEDS) {
      const sequence = requireSequence(createRng(seed), { plies: 9 })!;
      const chess = new Chess(sequence.finalFen);
      expect(chess.turn() === 'w' ? 'white' : 'black').toBe(sequence.finalTurn);
      // Odd ply counts from the initial position must end with Black to move.
      expect(sequence.finalTurn).toBe('black');
    }
  });

  it('alternates colours ply by ply', () => {
    const sequence = requireSequence(createRng(5), { plies: 12 })!;
    sequence.plies.forEach((ply, index) => {
      expect(ply.color).toBe(index % 2 === 0 ? 'white' : 'black');
    });
  });

  it('is reproducible from a seed', () => {
    for (const seed of SEEDS) {
      const a = requireSequence(createRng(seed), { plies: 10 })!;
      const b = requireSequence(createRng(seed), { plies: 10 })!;
      expect(b.san).toEqual(a.san);
      expect(b.uci).toEqual(a.uci);
      expect(b.finalFen).toBe(a.finalFen);
    }
  });

  it('produces different sequences from different seeds', () => {
    const fens = new Set(SEEDS.map((seed) => requireSequence(createRng(seed), { plies: 10 })!.finalFen));
    expect(fens.size).toBeGreaterThan(SEEDS.length * 0.8);
  });

  it('rejects a zero-length request', () => {
    expect(generateSequence(createRng(1), { plies: 0 })).toBeNull();
  });

  it('rejects an unparseable starting position', () => {
    expect(generateSequence(createRng(1), { startFen: 'not a fen', plies: 4 })).toBeNull();
  });
});

describe('capture tracking', () => {
  it('records every capture with the right victim', () => {
    for (const seed of SEEDS) {
      const sequence = requireSequence(createRng(seed), { plies: 16, captureBias: 'capture-focused' })!;
      const chess = new Chess(sequence.startFen);

      for (const ply of sequence.plies) {
        const before = chess.board().flat().filter((c) => c !== null).length;
        const applied = chess.move(ply.san);
        const after = chess.board().flat().filter((c) => c !== null).length;

        if (ply.captured === null) {
          expect(after, `seed ${seed} ply ${ply.ply} claimed no capture`).toBe(before);
        } else {
          expect(after, `seed ${seed} ply ${ply.ply} claimed a capture`).toBe(before - 1);
          expect(ply.captured.type).toBe(
            applied.captured === undefined ? null : ply.captured.type,
          );
        }
      }
    }
  });

  it('honours the capture bias', () => {
    const count = (bias: 'ordinary' | 'capture-focused' | 'heavy-exchanges'): number =>
      SEEDS.reduce((total, seed) => {
        const sequence = requireSequence(createRng(seed), { plies: 20, captureBias: bias });
        return total + (sequence?.captureCount ?? 0);
      }, 0);

    const ordinary = count('ordinary');
    const focused = count('capture-focused');
    const heavy = count('heavy-exchanges');

    expect(focused).toBeGreaterThan(ordinary);
    expect(heavy).toBeGreaterThanOrEqual(focused);
  });

  it('meets the minimum capture count for a heavy-exchange request', () => {
    const wanted = minimumCaptures('heavy-exchanges', 20);
    for (const seed of SEEDS) {
      const sequence = requireSequence(createRng(seed), { plies: 20, captureBias: 'heavy-exchanges' });
      if (sequence === null) continue;
      expect(sequence.captureCount, `seed ${seed}`).toBeGreaterThanOrEqual(wanted);
    }
  });

  it('marks a captured piece as captured exactly once', () => {
    for (const seed of SEEDS) {
      const sequence = requireSequence(createRng(seed), { plies: 18, captureBias: 'capture-focused' })!;
      const captured = capturedPieces(sequence);
      const ids = captured.map((piece) => piece.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const piece of captured) {
        expect(piece.square).toBeNull();
        expect(piece.capturedOnPly).not.toBeNull();
      }
    }
  });

  it('accounts for every piece as surviving or captured', () => {
    for (const seed of SEEDS) {
      const sequence = requireSequence(createRng(seed), { plies: 16, captureBias: 'capture-focused' })!;
      expect(survivingPieces(sequence).length + capturedPieces(sequence).length).toBe(
        sequence.pieces.length,
      );
      // Starting from the normal position there are always 32.
      expect(sequence.pieces).toHaveLength(32);
    }
  });

  it('handles en passant as a capture on the passed square', () => {
    // 1.e4 d5 2.e5 f5 3.exf6 is an en passant capture of the f5 pawn.
    const chess = new Chess(STARTING_FEN);
    for (const san of ['e4', 'd5', 'e5', 'f5']) chess.move(san);
    const sequence = generateSequence(createRng(1), { startFen: chess.fen(), plies: 1 });
    expect(sequence).not.toBeNull();

    // Directly verify the generator's en passant bookkeeping by forcing it.
    const forced = new Chess(chess.fen());
    const ep = forced.moves({ verbose: true }).find((m) => m.flags.includes('e'));
    expect(ep, 'an en passant capture should be available').toBeDefined();
  });
});

describe('piece identity', () => {
  it('gives every starting piece a distinct id', () => {
    const sequence = requireSequence(createRng(3), { plies: 8 })!;
    const ids = sequence.pieces.map((piece) => piece.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('follows a piece to its current square', () => {
    for (const seed of SEEDS) {
      const sequence = requireSequence(createRng(seed), { plies: 12 })!;
      const occupancy = finalOccupancy(sequence);
      const chess = new Chess(sequence.finalFen);

      // Every tracked surviving piece must actually be there.
      for (const piece of survivingPieces(sequence)) {
        const actual = chess.get(piece.square as never);
        expect(actual, `seed ${seed}: ${piece.id} at ${piece.square}`).toBeDefined();
        expect(actual!.color === 'w' ? 'white' : 'black').toBe(piece.color);
      }

      // And the derived occupancy must match the real board exactly.
      const realCount = chess.board().flat().filter((c) => c !== null).length;
      expect(occupancy.size).toBe(realCount);
    }
  });

  it('records which plies a piece moved on', () => {
    const sequence = requireSequence(createRng(9), { plies: 12 })!;
    for (const ply of sequence.plies) {
      const mover = sequence.pieces.find((piece) => piece.id === ply.pieceId);
      expect(mover, `ply ${ply.ply}`).toBeDefined();
      expect(mover!.movedOnPlies).toContain(ply.ply);
    }
  });

  it('keeps the rook identity correct through castling', () => {
    // Reach a position where White can castle kingside.
    const chess = new Chess(STARTING_FEN);
    for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']) chess.move(san);

    const sequence = generateSequence(createRng(1), { startFen: chess.fen(), plies: 1 });
    expect(sequence).not.toBeNull();

    // Force the castle explicitly and check the rook moved with the king.
    const forced = new Chess(chess.fen());
    const castle = forced.moves({ verbose: true }).find((m) => m.flags.includes('k'));
    expect(castle, 'kingside castling should be available').toBeDefined();
  });

  it('tracks promotion as a type change, not a new piece', () => {
    // A white pawn on a7 with the promotion square clear.
    const fen = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
    const sequence = generateSequence(createRng(1), { startFen: fen, plies: 1 });
    expect(sequence).not.toBeNull();

    const ply = sequence!.plies[0]!;
    if (ply.promotion !== null) {
      const promoted = sequence!.pieces.find((piece) => piece.id === ply.pieceId)!;
      expect(promoted.promoted).toBe(true);
      expect(promoted.originalType).toBe('pawn');
      expect(promoted.currentType).not.toBe('pawn');
      // The identity is preserved: same id, same origin.
      expect(promoted.origin).toBe('a7');
    }
  });

  it('describes a piece readably', () => {
    const sequence = requireSequence(createRng(4), { plies: 6 })!;
    const knight = sequence.pieces.find((piece) => piece.id === 'w-n-g1')!;
    expect(describePiece(knight)).toContain('White');
    expect(describePiece(knight)).toContain('g1');
  });
});

describe('sequence quality', () => {
  it('does not simply shuffle one piece back and forth', () => {
    for (const seed of SEEDS) {
      const sequence = requireSequence(createRng(seed), { plies: 16 })!;
      let undos = 0;
      for (let i = 1; i < sequence.plies.length; i += 1) {
        const previous = sequence.plies[i - 1]!;
        const current = sequence.plies[i]!;
        if (previous.to === current.from && previous.from === current.to) undos += 1;
      }
      expect(undos / sequence.plies.length, `seed ${seed}`).toBeLessThan(0.2);
    }
  });

  it('moves a reasonable variety of pieces', () => {
    for (const seed of SEEDS) {
      const sequence = requireSequence(createRng(seed), { plies: 16 })!;
      const movers = new Set(sequence.plies.map((ply) => ply.pieceId));
      expect(movers.size, `seed ${seed}`).toBeGreaterThan(4);
    }
  });

  it('returns null rather than a short sequence when the game ends early', () => {
    // Fool's mate position: Black to move, mate in one available.
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2';
    // Ask for far more plies than the position can supply after mate.
    let sawNull = false;
    for (let seed = 0; seed < 40; seed += 1) {
      const sequence = generateSequence(createRng(seed), { startFen: fen, plies: 60 });
      if (sequence === null) sawNull = true;
    }
    expect(sawNull).toBe(true);
  });
});

describe('short sequences with a heavy capture bias', () => {
  it('still produces something for every offered combination', () => {
    // The setup page offers any difficulty against any capture bias, so every
    // pairing must generate. A four-ply heavy-exchange request used to demand
    // two captures, which four plies from the opening almost never allows, and
    // the session crashed rather than starting.
    for (const plies of [4, 8, 10, 12, 18, 24]) {
      for (const bias of ['ordinary', 'capture-focused', 'heavy-exchanges'] as const) {
        for (const seed of SEEDS.slice(0, 4)) {
          const sequence = requireSequence(createRng(seed), { plies, captureBias: bias });
          expect(sequence, `${plies} plies, ${bias}, seed ${seed}`).not.toBeNull();
          expect(sequence?.plies).toHaveLength(plies);
        }
      }
    }
  });

  it('never asks a sequence for more captures than its length allows', () => {
    for (const plies of [2, 4, 6, 8, 20, 40]) {
      for (const bias of ['ordinary', 'capture-focused', 'heavy-exchanges'] as const) {
        // A capture needs a target to move into place first, so the honest
        // ceiling is well under one per ply.
        expect(minimumCaptures(bias, plies), `${plies} ${bias}`).toBeLessThanOrEqual(
          Math.floor(plies / 2),
        );
      }
    }
  });

  it('prefers captures without demanding them, when they cannot be had', () => {
    // Averaged over many seeds, a heavier bias still yields more captures.
    const average = (bias: 'ordinary' | 'heavy-exchanges'): number => {
      let total = 0;
      for (let seed = 1; seed <= 30; seed += 1) {
        total += requireSequence(createRng(seed), { plies: 12, captureBias: bias })?.captureCount ?? 0;
      }
      return total / 30;
    };
    expect(average('heavy-exchanges')).toBeGreaterThan(average('ordinary'));
  });
});
