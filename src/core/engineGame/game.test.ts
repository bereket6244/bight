/**
 * The engine game, tested without an engine.
 *
 * The load-bearing test here is that an illegal engine move is refused. The
 * whole safety argument for shipping a chess engine is that chess.js decides
 * what is legal and the engine only suggests, so that claim is checked
 * directly, including for moves that are legal-looking but wrong for the
 * position.
 */

import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  abandon,
  applyEngineMove,
  capturedBy,
  clearRejection,
  describeResult,
  legalDestinations,
  moveListText,
  needsPromotion,
  playUserMove,
  resign,
  resultOf,
  startGame,
  type EngineGameState,
} from './game';
import type { SquareName } from '../chess/types';

/** Plays a list of user/engine moves alternately from the start. */
function playAll(state: EngineGameState, ucis: readonly string[]): EngineGameState {
  let current = state;
  for (const uci of ucis) {
    if (current.turn === current.userSide) {
      current = playUserMove(current, {
        from: uci.slice(0, 2) as SquareName,
        to: uci.slice(2, 4) as SquareName,
        promotion: uci.length > 4 ? (uci[4] as 'q') : undefined,
      });
    } else {
      const outcome = applyEngineMove(current, uci);
      if (!outcome.ok) throw new Error(outcome.reason);
      current = outcome.state;
    }
  }
  return current;
}

describe('starting a game', () => {
  it('starts from the standard position with White to move', () => {
    const game = startGame('white');
    expect(game.placement).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
    expect(game.turn).toBe('white');
    expect(game.result.kind).toBe('in-progress');
    expect(game.history).toHaveLength(0);
  });

  it('lets the user take either side', () => {
    expect(startGame('black').userSide).toBe('black');
    // Black to play means the engine moves first; the position is unchanged.
    expect(startGame('black').turn).toBe('white');
  });
});

describe('the user moving', () => {
  it('plays a legal move and hands the turn over', () => {
    const game = playUserMove(startGame('white'), { from: 'e2' as SquareName, to: 'e4' as SquareName });
    expect(game.history.map((m) => m.san)).toEqual(['e4']);
    expect(game.turn).toBe('black');
    expect(game.rejection).toBeNull();
  });

  it('refuses an illegal move without ending the turn', () => {
    const game = playUserMove(startGame('white'), { from: 'e2' as SquareName, to: 'e5' as SquareName });
    expect(game.history).toHaveLength(0);
    expect(game.turn).toBe('white');
    expect(game.rejection).toBe('e2e5');
  });

  it('refuses a move from an empty square', () => {
    const game = playUserMove(startGame('white'), { from: 'e4' as SquareName, to: 'e5' as SquareName });
    expect(game.rejection).toBe('e4e5');
    expect(game.history).toHaveLength(0);
  });

  it('refuses to move when it is not the user to move', () => {
    const game = startGame('black');
    const after = playUserMove(game, { from: 'e7' as SquareName, to: 'e5' as SquareName });
    expect(after).toBe(game);
  });

  it('clears the rejection flash on request', () => {
    const rejected = playUserMove(startGame('white'), {
      from: 'e2' as SquareName,
      to: 'e5' as SquareName,
    });
    expect(clearRejection(rejected).rejection).toBeNull();
  });

  it('offers the legal destinations for a piece', () => {
    const game = startGame('white');
    expect(legalDestinations(game, 'g1' as SquareName).sort()).toEqual(['f3', 'h3']);
    expect(legalDestinations(game, 'e4' as SquareName)).toEqual([]);
  });
});

describe('the engine moving', () => {
  it('accepts a legal move', () => {
    const afterUser = playUserMove(startGame('white'), {
      from: 'e2' as SquareName,
      to: 'e4' as SquareName,
    });
    const outcome = applyEngineMove(afterUser, 'e7e5');

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.state.history.map((m) => m.san)).toEqual(['e4', 'e5']);
    expect(outcome.state.turn).toBe('white');
  });

  it('refuses a move that is not legal in this position, and stops the game', () => {
    // e7e5 is a legal-looking move — but it is White to play.
    const game = startGame('white');
    const outcome = applyEngineMove({ ...game, userSide: 'black' }, 'e7e5');

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/not legal/);
    expect(outcome.state.result.kind).toBe('abandoned');
  });

  it('refuses a piece that is not there', () => {
    const afterUser = playUserMove(startGame('white'), {
      from: 'e2' as SquareName,
      to: 'e4' as SquareName,
    });
    const outcome = applyEngineMove(afterUser, 'e5e4');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.state.result.kind).toBe('abandoned');
  });

  it('refuses malformed output rather than trying to play it', () => {
    const afterUser = playUserMove(startGame('white'), {
      from: 'e2' as SquareName,
      to: 'e4' as SquareName,
    });

    for (const garbage of ['', '(none)', '0000', 'e7e', 'xyzzy', 'Nf6', 'e7e9']) {
      const outcome = applyEngineMove(afterUser, garbage);
      expect(outcome.ok, garbage).toBe(false);
      if (!outcome.ok) expect(outcome.state.result.kind).toBe('abandoned');
    }
  });

  it('never lets an engine move be the source of chess truth', () => {
    // A game replayed independently through chess.js must reach the same
    // position, which it only can if every accepted move was really legal.
    const game = playAll(startGame('white'), ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5']);

    const replay = new Chess();
    for (const move of game.history) replay.move(move.san);
    expect(replay.fen()).toBe(game.fen);
  });

  it('refuses to move when it is the user to move', () => {
    const game = startGame('white');
    const outcome = applyEngineMove(game, 'e2e4');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toMatch(/not the engine/);
      // Refused, but not treated as engine failure — nothing was abandoned.
      expect(outcome.state.result.kind).toBe('in-progress');
    }
  });
});

describe('promotion', () => {
  it('knows when a move needs a piece chosen', () => {
    // White pawn on b7, both kings, White to move.
    const base = startGame('white');
    const promoting: EngineGameState = {
      ...base,
      fen: '7k/1P6/8/8/8/8/8/7K w - - 0 1',
      placement: '7k/1P6/8/8/8/8/8/7K',
    };

    expect(needsPromotion(promoting, 'b7' as SquareName, 'b8' as SquareName)).toBe(true);
    expect(needsPromotion(startGame('white'), 'e2' as SquareName, 'e4' as SquareName)).toBe(false);
  });

  it('promotes to the chosen piece', () => {
    const base = startGame('white');
    const promoting: EngineGameState = {
      ...base,
      fen: '7k/1P6/8/8/8/8/8/7K w - - 0 1',
      placement: '7k/1P6/8/8/8/8/8/7K',
    };

    const knight = playUserMove(promoting, {
      from: 'b7' as SquareName,
      to: 'b8' as SquareName,
      promotion: 'n',
    });
    expect(knight.history[0]?.san).toBe('b8=N');
  });

  it('accepts an engine promotion in UCI', () => {
    const base = startGame('white');
    const promoting: EngineGameState = {
      ...base,
      userSide: 'white',
      fen: '7K/8/8/8/8/8/1p6/7k b - - 0 1',
      placement: '7K/8/8/8/8/8/1p6/7k',
      turn: 'black',
    };

    const outcome = applyEngineMove(promoting, 'b2b1q');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.state.history[0]?.san).toContain('=Q');
  });
});

describe('how a game ends', () => {
  it('sees checkmate and names the winner', () => {
    // Fool's mate, with the user as White walking into it.
    const game = playAll(startGame('white'), ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
    expect(game.result).toEqual({ kind: 'checkmate', winner: 'black' });
    expect(describeResult(game.result, 'white')).toContain('computer wins');
  });

  it('sees stalemate', () => {
    const chess = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(resultOf(chess)).toEqual({ kind: 'stalemate' });
  });

  it('sees a draw by insufficient material', () => {
    const chess = new Chess('7k/8/6K1/8/8/8/8/8 w - - 0 1');
    expect(resultOf(chess)).toEqual({ kind: 'draw', reason: 'insufficient-material' });
  });

  it('lets the user resign, and does not pretend it was anything else', () => {
    const game = resign(startGame('white'));
    expect(game.result).toEqual({ kind: 'resigned', winner: 'black' });
    expect(describeResult(game.result, 'white')).toBe('You resigned.');
  });

  it('stops the game when the engine cannot play', () => {
    const game = abandon(startGame('white'), 'The engine stopped responding.');
    expect(game.result.kind).toBe('abandoned');
    expect(describeResult(game.result, 'white')).toContain('stopped responding');
  });

  it('refuses further moves once the game is over', () => {
    const finished = resign(startGame('white'));
    expect(playUserMove(finished, { from: 'e2' as SquareName, to: 'e4' as SquareName })).toBe(
      finished,
    );
    expect(applyEngineMove(finished, 'e2e4').ok).toBe(false);
  });
});

describe('what the user is told', () => {
  it('numbers the moves like a score sheet', () => {
    const game = playAll(startGame('white'), ['e2e4', 'e7e5', 'g1f3']);
    expect(moveListText(game.history)).toBe('1. e4 e5 2. Nf3');
  });

  it('lists captured material', () => {
    const game = playAll(startGame('white'), ['e2e4', 'd7d5', 'e4d5']);
    expect(capturedBy(game.history, 'white')).toEqual(['p']);
    expect(capturedBy(game.history, 'black')).toEqual([]);
  });

  it('reports check', () => {
    const game = playAll(startGame('white'), ['e2e4', 'f7f5', 'd1h5']);
    expect(game.inCheck).toBe(true);
    expect(game.history[game.history.length - 1]?.check).toBe(true);
  });
});
