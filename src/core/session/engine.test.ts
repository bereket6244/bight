import { describe, expect, it } from 'vitest';
import {
  advance,
  elapsedMs,
  exitSession,
  pause,
  questionSecondsLeft,
  resume,
  restartSession,
  retryCurrent,
  sessionProgress,
  startSession,
  submitAnswer,
  summarise,
  tick,
  type SessionState,
} from './engine';
import { defaultSettings, validateSettings, questionTimerActive, type SessionSettings } from './settings';
import { emptyAnswerFor } from '../training/grade';
import type { SubmittedAnswer } from '../training/types';
import { emptyFilters } from '../training/types';

const T0 = 1_700_000_000_000;

function settings(overrides: Partial<SessionSettings> = {}): SessionSettings {
  return { ...defaultSettings('square-color', 'coordinate'), ...overrides };
}

/** Answers the current question correctly by reading its own expectation. */
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
  }
}

function wrongAnswer(state: SessionState): SubmittedAnswer {
  const expected = state.current?.expected;
  if (expected === undefined) throw new Error('No current question');
  if (expected.kind === 'square-color') {
    return { kind: 'square-color', color: expected.color === 'light' ? 'dark' : 'light' };
  }
  return emptyAnswerFor(expected);
}

/** Plays a whole session, answering correctly or not per the pattern. */
function play(
  initial: SessionState,
  pattern: readonly boolean[],
  stepMs = 1000,
): SessionState {
  let state = initial;
  let now = T0;
  for (const shouldBeCorrect of pattern) {
    if (state.phase === 'finished' || state.current === null) break;
    now += stepMs;
    state = submitAnswer(
      state,
      shouldBeCorrect ? correctAnswer(state) : wrongAnswer(state),
      'touch',
      {},
      now,
    );
    if (state.phase === 'feedback') state = advance(state, {}, now);
  }
  return state;
}

describe('session start', () => {
  it('starts on a question with a generated prompt', () => {
    const state = startSession(settings(), { seed: 1 }, T0);
    expect(state.phase).toBe('question');
    expect(state.current).not.toBeNull();
    expect(state.questionNumber).toBe(1);
    expect(state.attempts).toEqual([]);
  });

  it('is reproducible from a seed', () => {
    const a = startSession(settings(), { seed: 42 }, T0);
    const b = startSession(settings(), { seed: 42 }, T0);
    expect(b.current?.expected).toEqual(a.current?.expected);
  });
});

describe('answering and scoring', () => {
  it('records a correct answer and increments the streak', () => {
    let state = startSession(settings(), { seed: 1 }, T0);
    state = submitAnswer(state, correctAnswer(state), 'touch', {}, T0 + 1500);

    expect(state.phase).toBe('feedback');
    expect(state.lastGrade?.correct).toBe(true);
    expect(state.attempts).toHaveLength(1);
    expect(state.correctCount).toBe(1);
    expect(state.streak).toBe(1);
    expect(state.attempts[0]?.responseMs).toBe(1500);
  });

  it('resets the streak on a wrong answer but keeps the best', () => {
    let state = startSession(settings({ retry: 'none' }), { seed: 1 }, T0);
    state = play(state, [true, true, true]);
    expect(state.bestStreak).toBe(3);

    state = submitAnswer(state, wrongAnswer(state), 'touch', {}, T0 + 9000);
    expect(state.streak).toBe(0);
    expect(state.bestStreak).toBe(3);
    expect(state.correctCount).toBe(3);
  });

  it('records every field needed to reconstruct performance', () => {
    let state = startSession(
      settings({
        orientation: 'black',
        labels: 'never',
        layout: 'starting',
        filters: { ...emptyFilters(), files: [0, 1] },
        questionTimer: { kind: 'per-question', seconds: 10 },
      }),
      { seed: 1 },
      T0,
    );
    state = submitAnswer(state, correctAnswer(state), 'keypad', {}, T0 + 800);

    const attempt = state.attempts[0];
    expect(attempt).toMatchObject({
      modeId: 'square-color',
      variantId: 'coordinate',
      correct: true,
      responseMs: 800,
      source: 'keypad',
      orientation: 'black',
      labels: 'never',
      layout: 'starting',
      timer: '10s',
      isRetry: false,
    });
    expect(attempt?.filters).toContain('f:01');
    expect(attempt?.timestamp).toBe(T0 + 800);
    expect(attempt?.prompt.length).toBeGreaterThan(0);
    expect(attempt?.expected.length).toBeGreaterThan(0);
  });

  it('ignores an answer submitted while showing feedback', () => {
    let state = startSession(settings(), { seed: 1 }, T0);
    state = submitAnswer(state, correctAnswer(state), 'touch', {}, T0 + 500);
    const afterFirst = state;
    state = submitAnswer(state, { kind: 'square-color', color: 'light' }, 'touch', {}, T0 + 600);
    expect(state).toBe(afterFirst);
    expect(state.attempts).toHaveLength(1);
  });
});

describe('session limits', () => {
  it('finishes after a fixed number of questions', () => {
    const state = play(
      startSession(settings({ limit: { kind: 'questions', count: 5 }, retry: 'none' }), { seed: 1 }, T0),
      [true, true, true, true, true, true, true],
    );
    expect(state.phase).toBe('finished');
    expect(state.attempts.filter((a) => !a.isRetry)).toHaveLength(5);
  });

  it('never ends an endless session on its own', () => {
    const state = play(
      startSession(settings({ limit: { kind: 'endless' }, retry: 'none' }), { seed: 1 }, T0),
      Array.from({ length: 30 }, () => true),
    );
    expect(state.phase).toBe('question');
    expect(state.attempts).toHaveLength(30);
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

  it('reports progress against the active limit', () => {
    let state = startSession(settings({ limit: { kind: 'questions', count: 4 }, retry: 'none' }), { seed: 1 }, T0);
    expect(sessionProgress(state, T0)).toEqual({ done: 0, total: 4 });
    state = play(state, [true, true]);
    expect(sessionProgress(state, T0)).toEqual({ done: 2, total: 4 });

    const endless = startSession(settings({ limit: { kind: 'endless' } }), { seed: 1 }, T0);
    expect(sessionProgress(endless, T0).total).toBeNull();
  });
});

describe('per-question timer', () => {
  const timed = settings({
    questionTimer: { kind: 'per-question', seconds: 5 },
    accuracyFirst: false,
    retry: 'none',
  });

  it('counts down and expires', () => {
    let state = startSession(timed, { seed: 1 }, T0);
    expect(questionSecondsLeft(state, T0)).toBe(5);
    expect(questionSecondsLeft(state, T0 + 2000)).toBe(3);

    state = tick(state, {}, T0 + 2000);
    expect(state.phase).toBe('question');

    state = tick(state, {}, T0 + 5001);
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]?.correct).toBe(false);
    expect(state.attempts[0]?.source).toBe('timeout');
  });

  it('does not advance silently - it records the miss and shows feedback', () => {
    let state = startSession(timed, { seed: 1 }, T0);
    state = tick(state, {}, T0 + 6000);
    expect(state.phase).toBe('feedback');
    expect(state.lastGrade?.correct).toBe(false);
  });

  it('is suppressed by accuracy-first until accuracy is proven', () => {
    const accuracyFirst = settings({
      questionTimer: { kind: 'per-question', seconds: 5 },
      accuracyFirst: true,
      limit: { kind: 'endless' },
      retry: 'none',
    });
    let state = startSession(accuracyFirst, { seed: 1 }, T0);
    expect(questionSecondsLeft(state, T0)).toBeNull();

    // 25 correct answers clears the gate.
    state = play(state, Array.from({ length: 25 }, () => true));
    expect(questionSecondsLeft(state, state.questionStartedAt)).toBe(5);
  });

  it('keeps the gate closed when accuracy is low', () => {
    const accuracyFirst = settings({
      questionTimer: { kind: 'per-question', seconds: 5 },
      accuracyFirst: true,
      limit: { kind: 'endless' },
      retry: 'none',
    });
    let state = startSession(accuracyFirst, { seed: 1 }, T0);
    state = play(
      state,
      Array.from({ length: 25 }, (_, i) => i % 2 === 0),
    );
    expect(questionSecondsLeft(state, state.questionStartedAt)).toBeNull();
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

    // Time passing while paused must not count.
    expect(elapsedMs(state, T0 + 10_000)).toBe(2000);

    state = resume(state, T0 + 10_000);
    expect(state.phase).toBe('question');
    expect(elapsedMs(state, T0 + 12_000)).toBe(4000);
  });

  it('freezes the per-question timer while paused', () => {
    const timed = settings({ questionTimer: { kind: 'per-question', seconds: 10 }, accuracyFirst: false });
    let state = startSession(timed, { seed: 1 }, T0);
    state = pause(state, T0 + 3000);
    expect(questionSecondsLeft(state, T0 + 60_000)).toBeNull();

    state = resume(state, T0 + 60_000);
    // Only the 3s before pausing counted.
    expect(questionSecondsLeft(state, T0 + 60_000)).toBe(7);
  });

  it('does not expire a timer while paused', () => {
    const timed = settings({ questionTimer: { kind: 'per-question', seconds: 5 }, accuracyFirst: false });
    let state = startSession(timed, { seed: 1 }, T0);
    state = pause(state, T0 + 1000);
    state = tick(state, {}, T0 + 100_000);
    expect(state.phase).toBe('paused');
    expect(state.attempts).toHaveLength(0);
  });

  it('ignores resume when not paused', () => {
    const state = startSession(settings(), { seed: 1 }, T0);
    expect(resume(state, T0 + 100)).toBe(state);
  });
});

describe('retry policies', () => {
  it('queues a miss for later and re-asks it in the same session', () => {
    let state = startSession(
      settings({ limit: { kind: 'questions', count: 10 }, retry: 'later' }),
      { seed: 3 },
      T0,
    );
    const firstId = state.current?.id;
    state = submitAnswer(state, wrongAnswer(state), 'touch', {}, T0 + 1000);
    expect(state.retryQueue).toHaveLength(1);

    // Play on; the queued question must reappear.
    state = play(state, Array.from({ length: 9 }, () => true));
    const retried = state.attempts.filter((a) => a.questionId === firstId);
    expect(retried.length).toBeGreaterThan(1);
    expect(retried.some((a) => a.isRetry)).toBe(true);
  });

  it('does not queue anything when retry is off', () => {
    let state = startSession(settings({ retry: 'none' }), { seed: 3 }, T0);
    state = submitAnswer(state, wrongAnswer(state), 'touch', {}, T0 + 1000);
    expect(state.retryQueue).toEqual([]);
  });

  it('does not count a retry against the question limit', () => {
    const state = play(
      startSession(settings({ limit: { kind: 'questions', count: 5 }, retry: 'later' }), { seed: 3 }, T0),
      [false, true, true, true, true, true, true, true],
    );
    expect(state.attempts.filter((a) => !a.isRetry)).toHaveLength(5);
  });

  it('re-asks the current question without recording an extra attempt', () => {
    let state = startSession(settings({ retry: 'immediate' }), { seed: 3 }, T0);
    state = submitAnswer(state, wrongAnswer(state), 'touch', {}, T0 + 1000);
    const before = state.attempts.length;
    state = retryCurrent(state, T0 + 2000);
    expect(state.phase).toBe('question');
    expect(state.attempts).toHaveLength(before);
    expect(state.questionStartedAt).toBe(T0 + 2000);
  });
});

describe('feedback modes', () => {
  it('shows feedback between questions when immediate', () => {
    let state = startSession(settings({ feedback: 'immediate' }), { seed: 1 }, T0);
    state = submitAnswer(state, correctAnswer(state), 'touch', {}, T0 + 500);
    expect(state.phase).toBe('feedback');
  });

  it('skips straight to the next question when review is deferred', () => {
    let state = startSession(
      settings({ feedback: 'end-of-session', limit: { kind: 'questions', count: 5 } }),
      { seed: 1 },
      T0,
    );
    state = submitAnswer(state, correctAnswer(state), 'touch', {}, T0 + 500);
    expect(state.phase).toBe('question');
    expect(state.attempts).toHaveLength(1);
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
    for (let i = 0; i < 4; i += 1) {
      seen.push(state.current?.board.orientation as string);
      state = submitAnswer(state, correctAnswer(state), 'touch', {}, T0 + (i + 1) * 1000);
      state = advance(state, {}, T0 + (i + 1) * 1000);
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
    for (let i = 0; i < 30; i += 1) {
      seen.add(state.current?.board.orientation as string);
      state = submitAnswer(state, correctAnswer(state), 'touch', {}, T0 + (i + 1) * 1000);
      state = advance(state, {}, T0 + (i + 1) * 1000);
    }
    expect(seen).toEqual(new Set(['white', 'black']));
  });
});

describe('early exit and restart', () => {
  it('keeps a partial summary when the user exits early', () => {
    let state = startSession(settings({ limit: { kind: 'questions', count: 20 } }), { seed: 1 }, T0);
    state = play(state, [true, true, false]);
    state = exitSession(state, T0 + 5000);

    expect(state.phase).toBe('finished');
    expect(state.endedEarly).toBe(true);

    const summary = summarise(state, T0 + 5000);
    expect(summary.total).toBe(3);
    expect(summary.correct).toBe(2);
    expect(summary.endedEarly).toBe(true);
    expect(summary.mistakes).toHaveLength(1);
  });

  it('restarts with the same settings and a clean slate', () => {
    let state = startSession(settings(), { seed: 1 }, T0);
    state = play(state, [true, false]);
    const restarted = restartSession(state, { seed: 2 }, T0 + 10_000);

    expect(restarted.attempts).toEqual([]);
    expect(restarted.phase).toBe('question');
    expect(restarted.settings).toEqual(state.settings);
    expect(restarted.startedAt).toBe(T0 + 10_000);
  });
});

describe('summary statistics', () => {
  it('computes accuracy, averages, median and fastest correct', () => {
    let state = startSession(settings({ limit: { kind: 'endless' }, retry: 'none' }), { seed: 1 }, T0);
    let now = T0;
    const durations = [1000, 3000, 2000, 500];
    const results = [true, true, false, true];

    for (let i = 0; i < durations.length; i += 1) {
      now += durations[i] as number;
      state = submitAnswer(
        state,
        results[i] ? correctAnswer(state) : wrongAnswer(state),
        'touch',
        {},
        now,
      );
      state = advance(state, {}, now);
    }

    const summary = summarise(state, now);
    expect(summary.total).toBe(4);
    expect(summary.correct).toBe(3);
    expect(summary.accuracy).toBeCloseTo(0.75);
    expect(summary.averageMs).toBe(1625);
    expect(summary.medianMs).toBe(1500);
    expect(summary.fastestCorrectMs).toBe(500);
  });

  it('handles an empty session without dividing by zero', () => {
    const state = exitSession(startSession(settings(), { seed: 1 }, T0), T0);
    const summary = summarise(state, T0);
    expect(summary.total).toBe(0);
    expect(summary.accuracy).toBe(0);
    expect(summary.averageMs).toBe(0);
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
      settings({ filters: { files: [0, 8, -1, 3, 3], ranks: [7, 99], quadrants: [], weakSquaresOnly: false } }),
    );
    expect(repaired.filters.files).toEqual([0, 3]);
    expect(repaired.filters.ranks).toEqual([7]);
  });

  it('handles NaN without producing NaN settings', () => {
    const repaired = validateSettings(settings({ limit: { kind: 'questions', count: NaN } }));
    expect(repaired.limit).toEqual({ kind: 'questions', count: 5 });
  });
});
