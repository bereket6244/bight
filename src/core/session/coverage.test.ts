/**
 * Question repetition and full-board coverage.
 *
 * Reported: "some questions appear repeatedly". Repetition is *expected* when
 * "Ask missed questions again later" or adaptive weak-square focus is on, so
 * the job here is not to remove it but to prove it is bounded — every square
 * stays reachable, nothing repeats back-to-back without cause, and the retry
 * queue always drains.
 */

import { describe, expect, it } from 'vitest';
import { startSession, submitAnswer, type SessionState } from './engine';
import { defaultSettings, type SessionSettings } from './settings';
import { ALL_SQUARES } from '../chess/square';
import type { SquareName } from '../chess/types';
import type { SubmittedAnswer } from '../training/types';

const T0 = 1_700_000_000_000;

function settings(overrides: Partial<SessionSettings> = {}): SessionSettings {
  return {
    ...defaultSettings('coordinate-to-square', 'standard'),
    limit: { kind: 'endless' },
    ...overrides,
  };
}

function correctAnswer(state: SessionState): SubmittedAnswer {
  const expected = state.current?.expected;
  if (expected?.kind !== 'single-square') throw new Error('expected a single-square question');
  return { kind: 'single-square', square: expected.square };
}

/** Plays `count` correct answers and records which square each asked about. */
function playAndCollect(initial: SessionState, count: number): SquareName[] {
  let state = initial;
  let now = T0;
  const asked: SquareName[] = [];

  for (let i = 0; i < count; i += 1) {
    if (state.phase !== 'question' || state.current === null) break;
    asked.push(state.current.primarySquare as SquareName);
    now += 1000;
    state = submitAnswer(state, correctAnswer(state), 'touch', {}, now);
  }
  return asked;
}

describe('full-board coverage', () => {
  it('reaches every one of the 64 squares over a long run', () => {
    const asked = playAndCollect(
      startSession(settings({ adaptive: false, retry: 'none' }), { seed: 20260731 }, T0),
      1200,
    );
    const seen = new Set(asked);
    const missing = ALL_SQUARES.filter((square) => !seen.has(square));
    expect(missing, `never asked: ${missing.join(', ')}`).toEqual([]);
  });

  it('covers the board reasonably evenly with adaptive focus off', () => {
    const asked = playAndCollect(
      startSession(settings({ adaptive: false, retry: 'none' }), { seed: 4242 }, T0),
      1280, // 20 per square on average
    );

    const counts = new Map<SquareName, number>();
    for (const square of asked) counts.set(square, (counts.get(square) ?? 0) + 1);

    const values = ALL_SQUARES.map((square) => counts.get(square) ?? 0);
    const max = Math.max(...values);
    const min = Math.min(...values);

    // Uniform sampling, so no square should be wildly over- or under-served.
    expect(min).toBeGreaterThan(0);
    expect(max).toBeLessThan(min * 6 + 10);
  });

  it('keeps every square reachable even under heavy adaptive weighting', () => {
    // One square weighted to the cap; the rest must still appear.
    const weights = new Map<SquareName, number>([['h7', 99]]);
    const asked = playAndCollect(
      startSession(settings({ adaptive: true, retry: 'none' }), { seed: 7, weights }, T0),
      1500,
    );

    const seen = new Set(asked);
    const missing = ALL_SQUARES.filter((square) => !seen.has(square));
    expect(missing, `unreachable under weighting: ${missing.join(', ')}`).toEqual([]);
  });

  it('does not let one weighted square dominate the session', () => {
    const weights = new Map<SquareName, number>([['h7', 99]]);
    const asked = playAndCollect(
      startSession(settings({ adaptive: true, retry: 'none' }), { seed: 11, weights }, T0),
      600,
    );
    const h7 = asked.filter((square) => square === 'h7').length;
    // The weight cap keeps a single square well under half the session.
    expect(h7 / asked.length).toBeLessThan(0.35);
    expect(h7).toBeGreaterThan(0);
  });

  it('honours file and rank filters while still covering their intersection', () => {
    const asked = playAndCollect(
      startSession(
        settings({
          adaptive: false,
          retry: 'none',
          filters: { files: [0, 1], ranks: [0, 1], quadrants: [], weakSquaresOnly: false },
        }),
        { seed: 3 },
        T0,
      ),
      400,
    );

    const allowed = new Set<SquareName>(['a1', 'a2', 'b1', 'b2']);
    for (const square of asked) expect(allowed.has(square), square).toBe(true);
    // All four are eventually reached.
    expect(new Set(asked).size).toBe(4);
  });
});

describe('immediate repeats', () => {
  it('rarely asks the same square twice in a row when alternatives exist', () => {
    const asked = playAndCollect(
      startSession(settings({ adaptive: false, retry: 'none' }), { seed: 99 }, T0),
      800,
    );

    let backToBack = 0;
    for (let i = 1; i < asked.length; i += 1) {
      if (asked[i] === asked[i - 1]) backToBack += 1;
    }

    // Uniform sampling over 64 squares gives ~1.6% by chance; anything much
    // above that means the generator is sticking.
    expect(backToBack / asked.length).toBeLessThan(0.05);
  });

  it('never sticks on one square for a whole session', () => {
    const asked = playAndCollect(
      startSession(settings({ adaptive: false, retry: 'none' }), { seed: 5 }, T0),
      200,
    );
    const distinct = new Set(asked).size;
    expect(distinct).toBeGreaterThan(30);
  });
});

describe('retry queue behaviour', () => {
  function wrongAnswer(): SubmittedAnswer {
    return { kind: 'single-square', square: 'a1' };
  }

  it('brings a missed question back when retry is on', () => {
    let state = startSession(
      settings({ retry: 'later', limit: { kind: 'questions', count: 30 }, adaptive: false }),
      { seed: 3 },
      T0,
    );
    const firstId = state.current?.id;
    let now = T0;

    // Miss the first question deliberately, then answer everything correctly.
    now += 500;
    const expected = state.current?.expected;
    const wrong: SubmittedAnswer =
      expected?.kind === 'single-square' && expected.square === 'a1'
        ? { kind: 'single-square', square: 'h8' }
        : wrongAnswer();
    state = submitAnswer(state, wrong, 'touch', {}, now);
    expect(state.retryQueue.length).toBe(1);

    const seen: string[] = [];
    for (let i = 0; i < 40 && state.phase === 'question' && state.current !== null; i += 1) {
      seen.push(state.current.id);
      now += 500;
      state = submitAnswer(state, correctAnswer(state), 'touch', {}, now);
    }

    // The missed question reappeared.
    expect(seen.filter((id) => id === firstId).length).toBeGreaterThan(0);
  });

  it('drains the queue rather than replenishing it forever', () => {
    let state = startSession(
      settings({ retry: 'later', limit: { kind: 'questions', count: 12 }, adaptive: false }),
      { seed: 8 },
      T0,
    );
    let now = T0;

    // Miss every question once, then answer it - the pattern that used to
    // make a 10-question session run past 40.
    for (let guard = 0; guard < 300 && state.phase === 'question'; guard += 1) {
      const expected = state.current?.expected;
      if (expected?.kind !== 'single-square') break;
      const wrong: SquareName = expected.square === 'a1' ? 'h8' : 'a1';
      now += 300;
      state = submitAnswer(state, { kind: 'single-square', square: wrong }, 'touch', {}, now);
      if (state.phase !== 'question') break;
      now += 300;
      state = submitAnswer(state, correctAnswer(state), 'touch', {}, now);
    }

    expect(state.phase).toBe('finished');
    expect(state.retryQueue).toEqual([]);
  });

  it('produces no retry-driven repeats when retry is off', () => {
    let state = startSession(
      settings({ retry: 'none', limit: { kind: 'questions', count: 20 }, adaptive: false }),
      { seed: 6 },
      T0,
    );
    let now = T0;
    const ids: string[] = [];

    for (let i = 0; i < 40 && state.phase === 'question' && state.current !== null; i += 1) {
      ids.push(state.current.id);
      const expected = state.current.expected;
      if (expected.kind !== 'single-square') break;
      now += 400;
      // Always wrong, so a retry queue would fill if one existed.
      const wrong: SquareName = expected.square === 'a1' ? 'h8' : 'a1';
      state = submitAnswer(state, { kind: 'single-square', square: wrong }, 'touch', {}, now);
      if (state.phase !== 'question') break;
      now += 400;
      state = submitAnswer(state, correctAnswer(state), 'touch', {}, now);
    }

    expect(state.retryQueue).toEqual([]);
    // Every question id is distinct: nothing came back.
    expect(new Set(ids).size).toBe(ids.length);
  });
});
