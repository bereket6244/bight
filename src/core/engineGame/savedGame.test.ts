/**
 * Saving and restoring an unfinished game.
 *
 * The load-bearing property is that a save is *replayed* rather than trusted:
 * only the moves are stored, so a save that has been truncated, hand-edited or
 * written by a version that meant something else by those moves fails to
 * replay and is discarded, instead of producing a position that never existed.
 */

import { describe, expect, it } from 'vitest';
import {
  buildSave,
  describeSave,
  restoreSave,
  SAVED_GAME_VERSION,
  type SavedEngineGame,
} from './savedGame';
import { applyEngineMove, playUserMove, resign, startGame } from './game';
import type { SquareName } from '../chess/types';

const T0 = 1_800_000_000_000;

/** Plays 1. e4 e5 2. Nf3 from White's point of view. */
function shortGame() {
  let state = playUserMove(startGame('white'), {
    from: 'e2' as SquareName,
    to: 'e4' as SquareName,
  });
  const reply = applyEngineMove(state, 'e7e5');
  if (!reply.ok) throw new Error(reply.reason);
  state = playUserMove(reply.state, { from: 'g1' as SquareName, to: 'f3' as SquareName });
  return state;
}

function save(overrides: Partial<Parameters<typeof buildSave>[0]> = {}) {
  return buildSave({
    state: shortGame(),
    difficulty: 'easy',
    visibility: 'never',
    history: 'latest-only',
    speakMoves: false,
    appVersion: '2.1.0',
    now: T0,
    ...overrides,
  });
}

describe('what gets saved', () => {
  it('stores the moves and the settings, and no position', () => {
    const record = save();
    expect(record).not.toBeNull();
    expect(record?.moves).toEqual(['e2e4', 'e7e5', 'g1f3']);
    expect(record?.userSide).toBe('white');
    expect(record?.difficulty).toBe('easy');
    expect(record?.visibility).toBe('never');
    expect(record?.history).toBe('latest-only');
    expect(record?.version).toBe(SAVED_GAME_VERSION);
    // The position is rebuilt on restore, never stored.
    expect(JSON.stringify(record)).not.toContain('rnbq');
  });

  it('records whether the computer owed a move', () => {
    // After 1. e4 e5 2. Nf3 it is Black — the engine — to play.
    expect(save()?.enginePending).toBe(true);
  });

  it('saves nothing for a game that has not started', () => {
    expect(save({ state: startGame('white') })).toBeNull();
  });

  it('saves nothing for a finished game', () => {
    expect(save({ state: resign(shortGame()) })).toBeNull();
  });
});

describe('restoring', () => {
  it('replays the moves back into the same position', () => {
    const record = save() as SavedEngineGame;
    const restored = restoreSave(record);

    expect(restored).not.toBeNull();
    expect(restored?.state.fen).toBe(shortGame().fen);
    expect(restored?.state.history.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3']);
    expect(restored?.state.uciHistory).toEqual(['e2e4', 'e7e5', 'g1f3']);
    expect(restored?.state.turn).toBe('black');
    expect(restored?.state.userSide).toBe('white');
  });

  it('restores a game the user was playing as Black', () => {
    const black = applyEngineMove(startGame('black'), 'd2d4');
    if (!black.ok) throw new Error(black.reason);
    const record = save({ state: black.state }) as SavedEngineGame;

    const restored = restoreSave(record);
    expect(restored?.state.userSide).toBe('black');
    expect(restored?.state.turn).toBe('black');
    expect(restored?.state.history[0]?.san).toBe('d4');
  });

  it('refuses a save whose moves do not replay', () => {
    const record = save() as SavedEngineGame;
    // e7e5 twice: legal once, impossible the second time.
    expect(restoreSave({ ...record, moves: ['e2e4', 'e7e5', 'e7e5'] })).toBeNull();
  });

  it('refuses malformed move text rather than guessing', () => {
    const record = save() as SavedEngineGame;
    for (const moves of [['not-a-move'], ['e2e9'], [''], ['e2e4', 'xyzzy']]) {
      expect(restoreSave({ ...record, moves }), moves.join()).toBeNull();
    }
  });

  it('refuses a save from a different format version', () => {
    const record = save() as SavedEngineGame;
    expect(restoreSave({ ...record, version: SAVED_GAME_VERSION + 1 })).toBeNull();
    expect(restoreSave({ ...record, version: 0 })).toBeNull();
  });

  it('refuses anything that is not a save at all', () => {
    for (const junk of [null, undefined, 42, 'nonsense', {}, { moves: 'e2e4' }, []]) {
      expect(restoreSave(junk), JSON.stringify(junk)).toBeNull();
    }
  });

  it('refuses a game that has already ended', () => {
    // Fool's mate: the save is real, but there is nothing to resume.
    const record = save() as SavedEngineGame;
    expect(
      restoreSave({ ...record, moves: ['f2f3', 'e7e5', 'g2g4', 'd8h4'] }),
    ).toBeNull();
  });

  it('round trips a promotion', () => {
    const base = startGame('white');
    const promoting = {
      ...base,
      fen: '7k/1P6/8/8/8/8/8/7K w - - 0 1',
      placement: '7k/1P6/8/8/8/8/8/7K',
    };
    const promoted = playUserMove(promoting, {
      from: 'b7' as SquareName,
      to: 'b8' as SquareName,
      promotion: 'q',
    });

    // Saved from a custom position, the moves alone cannot replay — which the
    // restore correctly refuses rather than inventing a position for.
    const record = save({ state: promoted }) as SavedEngineGame;
    expect(record.moves[0]).toBe('b7b8q');
    expect(restoreSave(record)).toBeNull();
  });
});

describe('describing a save', () => {
  it('says which side and how far along', () => {
    expect(describeSave(save() as SavedEngineGame)).toBe('White, 2 moves played');
  });

  it('gets the singular right', () => {
    const one = playUserMove(startGame('white'), {
      from: 'e2' as SquareName,
      to: 'e4' as SquareName,
    });
    expect(describeSave(save({ state: one }) as SavedEngineGame)).toBe('White, 1 move played');
  });
});
