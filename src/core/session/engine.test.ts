import { describe, expect, it } from 'vitest';
import {
  clearRejection,
  elapsedMs,
  exitSession,
  pause,
  questionSecondsLeft,
  resume,
  restartSession,
  selectSquare,
  sessionProgress,
  startSession,
  submitAnswer,
  summarise,
  tick,
  ADVANCE_LOCK_MS,
  type SessionState,
} from './engine';
import {
  defaultSettings,
  questionTimerActive,
  validateSettings,
  type SessionSettings,
} from './settings';
import { knightTargets } from '../chess/geometry';
import { shortestKnightRoute } from '../chess/knightRoute';
import type { SubmittedAnswer } from '../training/types';
import { emptyFilters } from '../training/types';
import type { SquareName } from '../chess/types';

const T0 = 1_700_000_000_000;

function settings(overrides: Partial<SessionSettings> = {}): SessionSettings {
  return { ...defaultSettings('square-color', 'coordinate'), ...overrides };
}

/** The answer that completes the current question. */
function correctAnswer(state: SessionState): SubmittedAnswer {
  const expected = state.current?.expected;
  if (expected === undefined) throw new Error('No current question');
  switch (expected.kind) {
    case 'single-square':
      return { kind: 'single-square', square: expected.square };
    case 'coordinate':
      return { kind: 'coordinate', square: expected.square };
    case 'square-set':
      return { kind: 'square-set', squares: [...expected.squares] };
    case 'square-color':
      return { kind: 'square-color', color: expected.color };
    case 'choice':
      return { kind: 'choice', choice: expected.correct };
    case 'move':
      return { kind: 'move', from: expected.from, to: expected.to };
    case 'square-path':
      return { kind: 'square-path', squares: expected.exampleRoute.slice(1) };
    case 'piece-journey':
      return { kind: 'piece-journey', path: expected.exampleRoute.slice(1) };
    case 'placement':
      return { kind: 'placement', placed: [...expected.required] };
  }
}

function wrongAnswer(state: SessionState): SubmittedAnswer {
  const expected = state.current?.expected;
  if (expected === undefined) throw new Error('No current question');
  if (expected.kind === 'square-color') {
    return { kind: 'square-color', color: expected.color === 'light' ? 'dark' : 'light' };
  }
  throw new Error(`No wrong-answer helper for ${expected.kind}`);
}

/** Answers correctly `count` times, stepping the clock so nothing is locked out. */
function playCorrect(initial: SessionState, count: number, stepMs = 1000): SessionState {
  let state = initial;
  let now = T0;
  for (let i = 0; i < count; i += 1) {
    if (state.phase !== 'question' || state.current === null) break;
    now += stepMs;
    state = submitAnswer(state, correctAnswer(state), 'touch', {}, now);
  }
  return state;
}

describe('session start', () => {
  it('starts on a question with no feedback phase to pass through', () => {
    const state = startSession(settings(), { seed: 1 }, T0);
    expect(state.phase).toBe('question');
    expect(state.current).not.toBeNull();
    expect(state.attempts).toEqual([]);
    expect(state.questionsCompleted).toBe(0);
    expect(state.selected).toEqual([]);
    expect(state.rejected).toBeNull();
  });

  it('is reproducible from a seed', () => {
    const a = startSession(settings(), { seed: 42 }, T0);
    const b = startSession(settings(), { seed: 42 }, T0);
    expect(b.current?.expected).toEqual(a.current?.expected);
  });
});

describe('correct answers advance immediately', () => {
  it('replaces the question with no intermediate phase', () => {
    const state = startSession(settings({ limit: { kind: 'endless' } }), { seed: 1 }, T0);
    const firstId = state.current?.id;

    const after = submitAnswer(state, correctAnswer(state), 'touch', {}, T0 + 1500);

    // Straight back to a question - never 'feedback'.
    expect(after.phase).toBe('question');
    expect(after.current).not.toBeNull();
    expect(after.current?.id).not.toBe(firstId);
    expect(after.questionsCompleted).toBe(1);
    expect(after.correctCount).toBe(1);
    expect(after.streak).toBe(1);
    expect(after.advanceToken).toBe(1);
  });

  it('records the attempt with its response time', () => {
    let state = startSession(settings(), { seed: 1 }, T0);
    state = submitAnswer(state, correctAnswer(state), 'touch', {}, T0 + 1500);
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]).toMatchObject({ correct: true, responseMs: 1500, isRetry: false });
  });

  it('restarts the question clock for the new question', () => {
    const state = startSession(settings({ limit: { kind: 'endless' } }), { seed: 1 }, T0);
    const after = submitAnswer(state, correctAnswer(state), 'touch', {}, T0 + 4000);
    expect(after.questionStartedAt).toBe(T0 + 4000);
  });

  it('keeps advancing through many questions without any button', () => {
    const state = playCorrect(
      startSession(settings({ limit: { kind: 'endless' } }), { seed: 1 }, T0),
      25,
    );
    expect(state.attempts).toHaveLength(25);
    expect(state.questionsCompleted).toBe(25);
    expect(state.phase).toBe('question');
    expect(state.bestStreak).toBe(25);
  });
});

describe('wrong answers keep the question active', () => {
  it('does not advance, does not reveal, and records the miss', () => {
    const state = startSession(settings(), { seed: 1 }, T0);
    const questionId = state.current?.id;

    const after = submitAnswer(state, wrongAnswer(state), 'touch', {}, T0 + 900);

    expect(after.phase).toBe('question');
    expect(after.current?.id).toBe(questionId);
    expect(after.questionsCompleted).toBe(0);
    expect(after.advanceToken).toBe(0);
    expect(after.attempts).toHaveLength(1);
    expect(after.attempts[0]?.correct).toBe(false);
    // Nothing about the right answer is disclosed.
    expect(after.attempts[0]?.missed).toEqual([]);
  });

  it('flags the rejected input for a red flash', () => {
    const state = startSession(settings(), { seed: 1 }, T0);
    const after = submitAnswer(state, wrongAnswer(state), 'touch', {}, T0 + 900);
    expect(after.rejected).not.toBeNull();
    expect(after.rejected?.token).toBe(1);
  });

  it('increments the flash token on each successive miss', () => {
    let state = startSession(settings(), { seed: 1 }, T0);
    state = submitAnswer(state, wrongAnswer(state), 'touch', {}, T0 + 900);
    state = clearRejection(state);
    state = submitAnswer(state, wrongAnswer(state), 'touch', {}, T0 + 1800);
    expect(state.rejected?.token).toBe(2);
  });

  it('resets the streak but keeps the best', () => {
    let state = playCorrect(
      startSession(settings({ limit: { kind: 'endless' } }), { seed: 1 }, T0),
      3,
    );
    expect(state.bestStreak).toBe(3);
    state = submitAnswer(state, wrongAnswer(state), 'touch', {}, T0 + 9000);
    expect(state.streak).toBe(0);
    expect(state.bestStreak).toBe(3);
  });

  it('lets the same question be answered correctly afterwards', () => {
    let state = startSession(settings({ limit: { kind: 'endless' } }), { seed: 1 }, T0);
    const questionId = state.current?.id;

    state = submitAnswer(state, wrongAnswer(state), 'touch', {}, T0 + 900);
    state = submitAnswer(state, correctAnswer(state), 'touch', {}, T0 + 1800);

    expect(state.current?.id).not.toBe(questionId);
    expect(state.questionsCompleted).toBe(1);
    // Both the miss and the recovery are on record.
    expect(state.attempts).toHaveLength(2);
    expect(state.attempts.map((a) => a.correct)).toEqual([false, true]);
    expect(state.attempts[1]?.isRetry).toBe(true);
  });

  it('records every wrong attempt, not just the first', () => {
    let state = startSession(settings({ limit: { kind: 'endless' } }), { seed: 1 }, T0);
    for (let i = 1; i <= 4; i += 1) {
      state = submitAnswer(state, wrongAnswer(state), 'touch', {}, T0 + i * 500);
    }
    expect(state.attempts).toHaveLength(4);
    expect(state.attempts.every((a) => !a.correct)).toBe(true);
    expect(state.questionsCompleted).toBe(0);
  });
});

describe('multi-square questions complete themselves', () => {
  const knight = settings({
    modeId: 'knight-vision',
    variantId: 'attack-squares',
    limit: { kind: 'endless' },
  });

  function expectedSquares(state: SessionState): SquareName[] {
    const expected = state.current?.expected;
    if (expected?.kind !== 'square-set') throw new Error('not a square-set question');
    return [...expected.squares];
  }

  it('keeps correct squares selected as they are tapped', () => {
    let state = startSession(knight, { seed: 5 }, T0);
    const targets = expectedSquares(state);

    state = selectSquare(state, targets[0] as SquareName, 'touch', {}, T0 + 100);
    expect(state.selected).toEqual([targets[0]]);
    expect(state.phase).toBe('question');

    state = selectSquare(state, targets[1] as SquareName, 'touch', {}, T0 + 200);
    expect(state.selected).toEqual([targets[0], targets[1]]);
  });

  it('advances the moment the set is complete, with no submit step', () => {
    let state = startSession(knight, { seed: 5 }, T0);
    const targets = expectedSquares(state);
    const questionId = state.current?.id;

    for (let i = 0; i < targets.length - 1; i += 1) {
      state = selectSquare(state, targets[i] as SquareName, 'touch', {}, T0 + 100 * (i + 1));
      expect(state.current?.id, `after ${i + 1} of ${targets.length}`).toBe(questionId);
    }

    state = selectSquare(state, targets[targets.length - 1] as SquareName, 'touch', {}, T0 + 2000);

    expect(state.current?.id).not.toBe(questionId);
    expect(state.questionsCompleted).toBe(1);
    expect(state.selected).toEqual([]);
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]?.correct).toBe(true);
  });

  it('flashes a wrong square, records it, and keeps every correct selection', () => {
    let state = startSession(knight, { seed: 5 }, T0);
    const targets = expectedSquares(state);
    const origin = state.current?.primarySquare as SquareName;
    const wrong = (['a1', 'h8', 'd4', 'e5'] as SquareName[]).find(
      (sq) => !targets.includes(sq) && sq !== origin,
    ) as SquareName;

    state = selectSquare(state, targets[0] as SquareName, 'touch', {}, T0 + 100);
    state = selectSquare(state, wrong, 'touch', {}, T0 + 200);

    expect(state.rejected?.squares).toEqual([wrong]);
    expect(state.selected).toEqual([targets[0]]); // preserved
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]?.correct).toBe(false);
    expect(state.attempts[0]?.extra).toEqual([wrong]);
    expect(state.questionsCompleted).toBe(0);
  });

  it('can finish the set after a wrong tap', () => {
    let state = startSession(knight, { seed: 5 }, T0);
    const targets = expectedSquares(state);
    const origin = state.current?.primarySquare as SquareName;
    const wrong = (['a1', 'h8', 'd4', 'e5'] as SquareName[]).find(
      (sq) => !targets.includes(sq) && sq !== origin,
    ) as SquareName;

    state = selectSquare(state, wrong, 'touch', {}, T0 + 50);
    targets.forEach((square, i) => {
      state = selectSquare(state, square, 'touch', {}, T0 + 100 * (i + 2));
    });

    expect(state.questionsCompleted).toBe(1);
    expect(state.attempts.map((a) => a.correct)).toEqual([false, true]);
  });

  it('ignores a repeat tap on an already-credited square', () => {
    let state = startSession(knight, { seed: 5 }, T0);
    const targets = expectedSquares(state);

    state = selectSquare(state, targets[0] as SquareName, 'touch', {}, T0 + 100);
    const before = state;
    state = selectSquare(state, targets[0] as SquareName, 'touch', {}, T0 + 200);

    // Identical state: no penalty, no duplicate, no attempt recorded.
    expect(state).toBe(before);
    expect(state.selected).toEqual([targets[0]]);
    expect(state.attempts).toHaveLength(0);
  });

  it('never records a duplicate square in the completed answer', () => {
    let state = startSession(knight, { seed: 5 }, T0);
    const targets = expectedSquares(state);
    targets.forEach((square, i) => {
      state = selectSquare(state, square, 'touch', {}, T0 + 100 * (i + 1));
      state = selectSquare(state, square, 'touch', {}, T0 + 100 * (i + 1) + 10);
    });
    expect(state.questionsCompleted).toBe(1);
    expect(state.attempts).toHaveLength(1);
  });
});

describe('route questions complete themselves', () => {
  const route = settings({
    modeId: 'knight-route',
    variantId: 'shortest-route',
    limit: { kind: 'endless' },
  });

  it('advances when the route reaches the target', () => {
    let state = startSession(route, { seed: 11 }, T0);
    const expected = state.current?.expected;
    if (expected?.kind !== 'square-path') throw new Error('not a path question');
    const questionId = state.current?.id;
    const steps = expected.exampleRoute.slice(1);

    steps.forEach((square, i) => {
      state = selectSquare(state, square, 'touch', {}, T0 + 200 * (i + 1));
    });

    expect(state.current?.id).not.toBe(questionId);
    expect(state.questionsCompleted).toBe(1);
    expect(state.attempts[0]?.correct).toBe(true);
  });

  it('rejects a step that is not a knight move and keeps the route so far', () => {
    let state = startSession(route, { seed: 11 }, T0);
    const expected = state.current?.expected;
    if (expected?.kind !== 'square-path') throw new Error('not a path question');

    const first = expected.exampleRoute[1] as SquareName;
    state = selectSquare(state, first, 'touch', {}, T0 + 200);

    // A square that is not a knight hop from `first`.
    const illegal = (['a1', 'h8', 'd4'] as SquareName[]).find(
      (sq) => !knightTargets(first).includes(sq) && sq !== first,
    ) as SquareName;
    state = selectSquare(state, illegal, 'touch', {}, T0 + 400);

    expect(state.rejected?.squares).toEqual([illegal]);
    expect(state.selected).toEqual([first]);
    expect(state.attempts[0]?.correct).toBe(false);
  });

  it('rejects a legal knight move that leaves the shortest path', () => {
    let state = startSession(route, { seed: 11 }, T0);
    const expected = state.current?.expected;
    if (expected?.kind !== 'square-path') throw new Error('not a path question');

    // A first hop that is legal but does not shorten the distance enough.
    const detour = knightTargets(expected.from).find((square) => {
      const viaRoute = shortestKnightRoute(square, expected.to);
      return viaRoute !== null && viaRoute.length - 1 > expected.shortestLength - 1;
    });

    if (detour === undefined) return; // No detour exists from this origin.

    state = selectSquare(state, detour, 'touch', {}, T0 + 200);
    expect(state.rejected?.squares).toEqual([detour]);
    expect(state.selected).toEqual([]);
  });
});

describe('input safety', () => {
  it('ignores a second tap immediately after advancing', () => {
    const state = startSession(settings({ limit: { kind: 'endless' } }), { seed: 1 }, T0);
    const advanced = submitAnswer(state, correctAnswer(state), 'touch', {}, T0 + 1000);

    // A double tap lands inside the lock window and must be swallowed.
    const doubleTap = submitAnswer(
      advanced,
      correctAnswer(advanced),
      'touch',
      {},
      T0 + 1000 + ADVANCE_LOCK_MS - 1,
    );
    expect(doubleTap).toBe(advanced);
    expect(doubleTap.attempts).toHaveLength(1);
  });

  it('accepts input once the lock has elapsed', () => {
    const state = startSession(settings({ limit: { kind: 'endless' } }), { seed: 1 }, T0);
    const advanced = submitAnswer(state, correctAnswer(state), 'touch', {}, T0 + 1000);
    const next = submitAnswer(
      advanced,
      correctAnswer(advanced),
      'touch',
      {},
      T0 + 1000 + ADVANCE_LOCK_MS + 1,
    );
    expect(next.attempts).toHaveLength(2);
  });

  it('locks square selection too', () => {
    const knight = settings({
      modeId: 'knight-vision',
      variantId: 'attack-squares',
      limit: { kind: 'endless' },
    });
    let state = startSession(knight, { seed: 5 }, T0);
    const expected = state.current?.expected;
    if (expected?.kind !== 'square-set') throw new Error('not a set question');

    expected.squares.forEach((square, i) => {
      state = selectSquare(state, square, 'touch', {}, T0 + 100 * (i + 1));
    });

    const lockedAt = state.lockedUntil - 1;
    const before = state;
    state = selectSquare(state, 'a1', 'touch', {}, lockedAt);
    expect(state).toBe(before);
  });

  it('keeps the lock brief', () => {
    expect(ADVANCE_LOCK_MS).toBeLessThanOrEqual(250);
    expect(ADVANCE_LOCK_MS).toBeGreaterThan(0);
  });
});

describe('session limits count questions, not attempts', () => {
  it('finishes after the configured number of questions', () => {
    const state = playCorrect(
      startSession(settings({ limit: { kind: 'questions', count: 5 }, retry: 'none' }), { seed: 1 }, T0),
      8,
    );
    expect(state.phase).toBe('finished');
    expect(state.questionsCompleted).toBe(5);
  });

  it('does not let wrong answers shorten the session', () => {
    let state = startSession(
      settings({ limit: { kind: 'questions', count: 3 }, retry: 'none' }),
      { seed: 1 },
      T0,
    );
    let now = T0;

    for (let q = 0; q < 3; q += 1) {
      // Two misses then a hit, for every question.
      now += 400;
      state = submitAnswer(state, wrongAnswer(state), 'touch', {}, now);
      now += 400;
      state = submitAnswer(state, wrongAnswer(state), 'touch', {}, now);
      now += 400;
      state = submitAnswer(state, correctAnswer(state), 'touch', {}, now);
    }

    expect(state.questionsCompleted).toBe(3);
    expect(state.phase).toBe('finished');
    expect(state.attempts).toHaveLength(9);
  });

  it('never ends an endless session on its own', () => {
    const state = playCorrect(
      startSession(settings({ limit: { kind: 'endless' }, retry: 'none' }), { seed: 1 }, T0),
      30,
    );
    expect(state.phase).toBe('question');
  });

  it('finishes when the total session time runs out', () => {
    let state = startSession(
      settings({ limit: { kind: 'total-time', seconds: 10 }, retry: 'none' }),
      { seed: 1 },
      T0,
    );
    state = tick(state, {}, T0 + 5000);
    expect(state.phase).toBe('question');
    state = tick(state, {}, T0 + 10_001);
    expect(state.phase).toBe('finished');
  });

  it('reports progress as completed questions', () => {
    let state = startSession(
      settings({ limit: { kind: 'questions', count: 4 }, retry: 'none' }),
      { seed: 1 },
      T0,
    );
    expect(sessionProgress(state, T0)).toEqual({ done: 0, total: 4 });
    state = playCorrect(state, 2);
    expect(sessionProgress(state, T0)).toEqual({ done: 2, total: 4 });
  });
});

describe('per-question timer', () => {
  const timed = settings({
    questionTimer: { kind: 'per-question', seconds: 5 },
    accuracyFirst: false,
    limit: { kind: 'endless' },
    retry: 'none',
  });

  it('counts down', () => {
    const state = startSession(timed, { seed: 1 }, T0);
    expect(questionSecondsLeft(state, T0)).toBe(5);
    expect(questionSecondsLeft(state, T0 + 2000)).toBe(3);
  });

  it('records a timeout as a miss and moves on', () => {
    let state = startSession(timed, { seed: 1 }, T0);
    const questionId = state.current?.id;

    state = tick(state, {}, T0 + 5001);

    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]?.correct).toBe(false);
    expect(state.attempts[0]?.source).toBe('timeout');
    // A timeout must advance, or the session would stall forever.
    expect(state.questionsCompleted).toBe(1);
    expect(state.current?.id).not.toBe(questionId);
    expect(state.phase).toBe('question');
  });

  it('records the squares actually missed on a timed-out multi-square question', () => {
    const knight = settings({
      modeId: 'knight-vision',
      variantId: 'attack-squares',
      questionTimer: { kind: 'per-question', seconds: 5 },
      accuracyFirst: false,
      limit: { kind: 'endless' },
    });
    let state = startSession(knight, { seed: 5 }, T0);
    const expected = state.current?.expected;
    if (expected?.kind !== 'square-set') throw new Error('not a set question');

    state = selectSquare(state, expected.squares[0] as SquareName, 'touch', {}, T0 + 500);
    state = tick(state, {}, T0 + 5001);

    // The timeout reveals what was missed - unlike a wrong tap, which does not.
    expect(state.attempts[0]?.missed).toEqual(expected.squares.slice(1));
  });

  it('is suppressed by accuracy-first until accuracy is proven', () => {
    const accuracyFirst = { ...timed, accuracyFirst: true };
    let state = startSession(accuracyFirst, { seed: 1 }, T0);
    expect(questionSecondsLeft(state, T0)).toBeNull();

    state = playCorrect(state, 25);
    expect(questionSecondsLeft(state, state.questionStartedAt)).toBe(5);
  });

  it('exposes the gate as a pure predicate', () => {
    const s = settings({ questionTimer: { kind: 'per-question', seconds: 5 }, accuracyFirst: true });
    expect(questionTimerActive(s, { attempts: 5, accuracy: 1 })).toBe(false);
    expect(questionTimerActive(s, { attempts: 25, accuracy: 0.5 })).toBe(false);
    expect(questionTimerActive(s, { attempts: 25, accuracy: 0.95 })).toBe(true);
    expect(questionTimerActive({ ...s, accuracyFirst: false }, { attempts: 0, accuracy: 0 })).toBe(true);
  });
});

describe('pause and resume', () => {
  it('excludes paused time from the session clock', () => {
    let state = startSession(settings(), { seed: 1 }, T0);
    state = pause(state, T0 + 2000);
    expect(state.phase).toBe('paused');
    expect(elapsedMs(state, T0 + 10_000)).toBe(2000);

    state = resume(state, T0 + 10_000);
    expect(state.phase).toBe('question');
    expect(elapsedMs(state, T0 + 12_000)).toBe(4000);
  });

  it('freezes the per-question timer while paused', () => {
    const timed = settings({
      questionTimer: { kind: 'per-question', seconds: 10 },
      accuracyFirst: false,
    });
    let state = startSession(timed, { seed: 1 }, T0);
    state = pause(state, T0 + 3000);
    expect(questionSecondsLeft(state, T0 + 60_000)).toBeNull();

    state = resume(state, T0 + 60_000);
    expect(questionSecondsLeft(state, T0 + 60_000)).toBe(7);
  });

  it('does not expire a timer while paused', () => {
    const timed = settings({
      questionTimer: { kind: 'per-question', seconds: 5 },
      accuracyFirst: false,
    });
    let state = startSession(timed, { seed: 1 }, T0);
    state = pause(state, T0 + 1000);
    state = tick(state, {}, T0 + 100_000);
    expect(state.phase).toBe('paused');
    expect(state.attempts).toHaveLength(0);
  });

  it('locks input briefly on resume so the resume tap cannot answer', () => {
    let state = startSession(settings(), { seed: 1 }, T0);
    state = pause(state, T0 + 1000);
    state = resume(state, T0 + 5000);
    expect(state.lockedUntil).toBe(T0 + 5000 + ADVANCE_LOCK_MS);
  });

  it('ignores resume when not paused', () => {
    const state = startSession(settings(), { seed: 1 }, T0);
    expect(resume(state, T0 + 100)).toBe(state);
  });
});

describe('retry queue', () => {
  it('queues a missed question to be asked again later', () => {
    let state = startSession(
      settings({ limit: { kind: 'questions', count: 10 }, retry: 'later' }),
      { seed: 3 },
      T0,
    );
    state = submitAnswer(state, wrongAnswer(state), 'touch', {}, T0 + 500);
    expect(state.retryQueue).toHaveLength(1);
  });

  it('does not queue the same question twice for repeated misses', () => {
    let state = startSession(
      settings({ limit: { kind: 'questions', count: 10 }, retry: 'later' }),
      { seed: 3 },
      T0,
    );
    state = submitAnswer(state, wrongAnswer(state), 'touch', {}, T0 + 500);
    state = submitAnswer(state, wrongAnswer(state), 'touch', {}, T0 + 1000);
    state = submitAnswer(state, wrongAnswer(state), 'touch', {}, T0 + 1500);
    expect(state.retryQueue).toHaveLength(1);
  });

  /**
   * Regression: a 10-question session was observed running to 40. Missing a
   * queued retry re-queued it, so the queue refilled faster than it drained
   * and the limit was never reached.
   */
  it('drains the retry queue at the limit without refilling it', () => {
    let state = startSession(
      settings({ limit: { kind: 'questions', count: 10 }, retry: 'later' }),
      { seed: 5 },
      T0,
    );
    let now = T0;

    // Answer every question wrong once, then right - the pattern a real user
    // produces and the one that exposed the bug.
    for (let guard = 0; guard < 200; guard += 1) {
      if (state.phase === 'finished') break;
      now += 300;
      state = submitAnswer(state, wrongAnswer(state), 'touch', {}, now);
      now += 300;
      state = submitAnswer(state, correctAnswer(state), 'touch', {}, now);
    }

    expect(state.phase).toBe('finished');
    // Ten scored questions, plus at most the retries queued before the limit.
    expect(state.questionsCompleted).toBeLessThanOrEqual(20);
    expect(state.retryQueue).toEqual([]);
  });

  it('stops queueing once the question limit is reached', () => {
    let state = startSession(
      settings({ limit: { kind: 'questions', count: 2 }, retry: 'later' }),
      { seed: 5 },
      T0,
    );
    let now = T0;
    for (let i = 0; i < 2; i += 1) {
      now += 300;
      state = submitAnswer(state, correctAnswer(state), 'touch', {}, now);
    }
    // The limit is met; a further miss must not extend the session.
    const queuedBefore = state.retryQueue.length;
    if (state.phase === 'question') {
      now += 300;
      state = submitAnswer(state, wrongAnswer(state), 'touch', {}, now);
      expect(state.retryQueue.length).toBeLessThanOrEqual(queuedBefore);
    }
  });

  it('does not queue anything when retry is off', () => {
    let state = startSession(settings({ retry: 'none' }), { seed: 3 }, T0);
    state = submitAnswer(state, wrongAnswer(state), 'touch', {}, T0 + 500);
    expect(state.retryQueue).toEqual([]);
  });
});

describe('orientation policies', () => {
  it('honours a fixed orientation', () => {
    for (const orientation of ['white', 'black'] as const) {
      const state = startSession(settings({ orientation }), { seed: 1 }, T0);
      expect(state.current?.board.orientation).toBe(orientation);
    }
  });

  it('alternates orientation between questions', () => {
    let state = startSession(
      settings({ orientation: 'alternating', limit: { kind: 'endless' }, retry: 'none' }),
      { seed: 1 },
      T0,
    );
    const seen: string[] = [];
    let now = T0;
    for (let i = 0; i < 4; i += 1) {
      seen.push(state.current?.board.orientation as string);
      now += 1000;
      state = submitAnswer(state, correctAnswer(state), 'touch', {}, now);
    }
    expect(seen).toEqual(['white', 'black', 'white', 'black']);
  });

  it('produces both orientations over a random session', () => {
    let state = startSession(
      settings({ orientation: 'random', limit: { kind: 'endless' }, retry: 'none' }),
      { seed: 9 },
      T0,
    );
    const seen = new Set<string>();
    let now = T0;
    for (let i = 0; i < 30; i += 1) {
      seen.add(state.current?.board.orientation as string);
      now += 1000;
      state = submitAnswer(state, correctAnswer(state), 'touch', {}, now);
    }
    expect(seen).toEqual(new Set(['white', 'black']));
  });
});

describe('early exit, restart and summary', () => {
  it('keeps a partial summary when the user exits early', () => {
    let state = playCorrect(
      startSession(settings({ limit: { kind: 'questions', count: 20 } }), { seed: 1 }, T0),
      2,
    );
    state = submitAnswer(state, wrongAnswer(state), 'touch', {}, T0 + 3000);
    state = exitSession(state, T0 + 5000);

    const summary = summarise(state, T0 + 5000);
    expect(state.phase).toBe('finished');
    expect(summary.total).toBe(3);
    expect(summary.correct).toBe(2);
    expect(summary.questionsCompleted).toBe(2);
    expect(summary.endedEarly).toBe(true);
    expect(summary.mistakes).toHaveLength(1);
  });

  it('restarts with the same settings and a clean slate', () => {
    const state = playCorrect(startSession(settings(), { seed: 1 }, T0), 2);
    const restarted = restartSession(state, { seed: 2 }, T0 + 10_000);
    expect(restarted.attempts).toEqual([]);
    expect(restarted.questionsCompleted).toBe(0);
    expect(restarted.phase).toBe('question');
    expect(restarted.settings).toEqual(state.settings);
  });

  it('counts every attempt in accuracy, including recovered misses', () => {
    let state = startSession(settings({ limit: { kind: 'endless' } }), { seed: 1 }, T0);
    state = submitAnswer(state, wrongAnswer(state), 'touch', {}, T0 + 500);
    state = submitAnswer(state, correctAnswer(state), 'touch', {}, T0 + 1000);
    state = exitSession(state, T0 + 1500);

    const summary = summarise(state, T0 + 1500);
    // One question completed, but the miss still costs accuracy.
    expect(summary.questionsCompleted).toBe(1);
    expect(summary.total).toBe(2);
    expect(summary.accuracy).toBe(0.5);
  });

  it('handles an empty session without dividing by zero', () => {
    const state = exitSession(startSession(settings(), { seed: 1 }, T0), T0);
    const summary = summarise(state, T0);
    expect(summary.total).toBe(0);
    expect(summary.accuracy).toBe(0);
    expect(summary.fastestCorrectMs).toBeNull();
  });
});

describe('settings validation', () => {
  it('clamps out-of-range values instead of rejecting them', () => {
    const repaired = validateSettings(
      settings({
        limit: { kind: 'questions', count: 9999 },
        questionTimer: { kind: 'per-question', seconds: 0 },
        revealMs: 50,
      }),
    );
    expect(repaired.limit).toEqual({ kind: 'questions', count: 200 });
    expect(repaired.questionTimer).toEqual({ kind: 'per-question', seconds: 2 });
    expect(repaired.revealMs).toBe(200);
  });

  it('repairs unknown enum values to safe defaults', () => {
    const repaired = validateSettings({
      ...settings(),
      orientation: 'sideways' as never,
      labels: 'maybe' as never,
      retry: 'sometimes' as never,
      layout: 'chaos' as never,
    });
    expect(repaired.orientation).toBe('white');
    expect(repaired.labels).toBe('always');
    expect(repaired.retry).toBe('later');
    expect(repaired.layout).toBe('empty');
  });

  it('drops invalid file and rank filters', () => {
    const repaired = validateSettings(
      settings({
        filters: { files: [0, 8, -1, 3, 3], ranks: [7, 99], quadrants: [], weakSquaresOnly: false },
      }),
    );
    expect(repaired.filters.files).toEqual([0, 3]);
    expect(repaired.filters.ranks).toEqual([7]);
  });

  it('handles NaN without producing NaN settings', () => {
    const repaired = validateSettings(settings({ limit: { kind: 'questions', count: NaN } }));
    expect(repaired.limit).toEqual({ kind: 'questions', count: 5 });
  });

  it('records the filters in force on each attempt', () => {
    let state = startSession(
      settings({ filters: { ...emptyFilters(), files: [0, 1] } }),
      { seed: 1 },
      T0,
    );
    state = submitAnswer(state, correctAnswer(state), 'keypad', {}, T0 + 800);
    expect(state.attempts[0]?.filters).toContain('f:01');
    expect(state.attempts[0]?.source).toBe('keypad');
  });
});
