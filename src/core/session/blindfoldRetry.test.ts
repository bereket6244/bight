/**
 * Blindfold sessions under the retry system, and the statistical properties of
 * a long run of generated questions.
 *
 * Everything here is deterministic: fixed seeds, injected clock. "Statistical"
 * means the assertions are about distributions over many questions, not that
 * the test itself is random.
 */

import { describe, expect, it } from 'vitest';
import {
  submitAnswer,
  startSession,
  tick,
  type SessionState,
} from './engine';
import { defaultSettings, type SessionSettings } from './settings';
import { emptyAnswerFor } from '../training/grade';
import type { SubmittedAnswer } from '../training/types';
import type { SquareName } from '../chess/types';

const T0 = 1_700_000_000_000;
const STEP = 400;

function session(overrides: Partial<SessionSettings> = {}): SessionState {
  return startSession(
    {
      ...defaultSettings('blindfold-tracking', 'mixed'),
      blindfoldPlies: 4,
      limit: { kind: 'questions', count: 20 },
      adaptive: false,
      ...overrides,
    },
    { seed: 20260731 },
    T0,
  );
}

/** The answer that completes whatever question is up. */
function correctAnswer(state: SessionState): SubmittedAnswer {
  const expected = state.current?.expected;
  if (expected === undefined) throw new Error('No current question');
  switch (expected.kind) {
    case 'coordinate':
      return { kind: 'coordinate', square: expected.square };
    case 'choice':
      return { kind: 'choice', choice: expected.correct };
    case 'placement':
      return { kind: 'placement', placed: [...expected.required] };
    default:
      throw new Error(`No helper for ${expected.kind}`);
  }
}

/** A deliberately wrong answer of the right shape. */
function wrongAnswer(state: SessionState): SubmittedAnswer {
  const expected = state.current?.expected;
  if (expected === undefined) throw new Error('No current question');
  switch (expected.kind) {
    case 'coordinate':
      return {
        kind: 'coordinate',
        square: (expected.square === 'a1' ? 'h8' : 'a1') as SquareName,
      };
    case 'choice': {
      const other = expected.choices.find((choice) => choice !== expected.correct);
      return { kind: 'choice', choice: other ?? expected.correct };
    }
    case 'placement':
      return { kind: 'placement', placed: [] };
    default:
      return emptyAnswerFor(expected);
  }
}

interface Run {
  final: SessionState;
  /** Question ids in the order they were asked. */
  order: string[];
  /** Sequences as SAN strings, in the order they were presented. */
  sequences: string[];
}

/**
 * Plays a whole session, answering according to `answerAt`.
 * Returns once the session finishes or the guard trips.
 */
function play(
  start: SessionState,
  answerAt: (index: number) => 'correct' | 'wrong',
): Run {
  let state = start;
  const order: string[] = [];
  const sequences: string[] = [];
  let clock = T0;

  for (let i = 0; i < 400 && state.phase !== 'finished'; i += 1) {
    const question = state.current;
    if (question === null) break;
    if (order[order.length - 1] !== question.id) {
      order.push(question.id);
      if (question.blindfold !== undefined) sequences.push(question.blindfold.san.join(' '));
    }

    clock += STEP;
    const answer =
      answerAt(i) === 'correct' ? correctAnswer(state) : wrongAnswer(state);
    state = submitAnswer(state, answer, 'touch', {}, clock);
  }

  return { final: state, order, sequences };
}

describe('blindfold sessions finish', () => {
  it('reaches the question limit and stops', () => {
    const run = play(session(), () => 'correct');
    expect(run.final.phase).toBe('finished');
    expect(run.final.questionsCompleted).toBe(20);
  });

  it('counts completed questions, not attempts, so retries never shorten it', () => {
    // Every third answer wrong: the same question comes back immediately.
    const run = play(session(), (i) => (i % 3 === 2 ? 'wrong' : 'correct'));
    expect(run.final.phase).toBe('finished');
    // At least the limit — never fewer. Queued retries are drained *after* the
    // limit is reached rather than counted towards it, so a session with
    // misses in it ends up slightly longer, not shorter.
    expect(run.final.questionsCompleted).toBeGreaterThanOrEqual(20);
    expect(run.final.attempts.length).toBeGreaterThan(run.final.questionsCompleted);
  });

  it('drains the retry queue rather than leaving misses unasked', () => {
    const run = play(session({ retry: 'later' }), (i) => (i % 4 === 0 ? 'wrong' : 'correct'));
    expect(run.final.phase).toBe('finished');
    expect(run.final.retryQueue).toHaveLength(0);
  });

  it('does not loop forever when every single answer is wrong', () => {
    // A wrong answer keeps the question, so only the timer can end this. With
    // no timer the guard in `play` is what stops it — the assertion is that
    // the queue never grows without bound.
    const run = play(session({ retry: 'both' }), () => 'wrong');
    expect(run.final.retryQueue.length).toBeLessThanOrEqual(20);
    expect(run.final.questionsCompleted).toBe(0);
  });

  it('ends a timed-out question rather than holding the session open', () => {
    let state = session({
      questionTimer: { kind: 'per-question', seconds: 5 },
      accuracyFirst: false,
      limit: { kind: 'questions', count: 3 },
    });
    let clock = T0;
    for (let i = 0; i < 30 && state.phase !== 'finished'; i += 1) {
      clock += 6000;
      state = tick(state, {}, clock);
    }
    expect(state.phase).toBe('finished');
  });
});

describe('question variety across a long run', () => {
  const run = play(session({ limit: { kind: 'questions', count: 120 } }), () => 'correct');

  it('never asks the identical sequence twice in a row', () => {
    for (let i = 1; i < run.sequences.length; i += 1) {
      expect(run.sequences[i], `question ${i + 1}`).not.toBe(run.sequences[i - 1]);
    }
  });

  it('produces overwhelmingly distinct sequences', () => {
    const distinct = new Set(run.sequences);
    expect(distinct.size / run.sequences.length).toBeGreaterThan(0.95);
  });

  it('spreads questions across several kinds rather than repeating one', () => {
    const kinds = new Map<string, number>();
    for (const attempt of run.final.attempts) {
      const kind = attempt.blindfoldKind ?? 'unknown';
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }
    expect(kinds.size).toBeGreaterThanOrEqual(4);
    // No single kind dominates the session.
    const most = Math.max(...kinds.values());
    expect(most / run.final.attempts.length).toBeLessThan(0.6);
  });

  it('asks about both colours', () => {
    const white = run.final.attempts.filter((a) => a.prompt.includes('White')).length;
    const black = run.final.attempts.filter((a) => a.prompt.includes('Black')).length;
    // Not every prompt names a colour, so this only checks neither is absent
    // wherever colour is mentioned at all.
    if (white + black > 10) {
      expect(white).toBeGreaterThan(0);
      expect(black).toBeGreaterThan(0);
    }
  });

  it('covers a broad spread of the board', () => {
    const squares = new Set<string>();
    for (const attempt of run.final.attempts) {
      for (const square of attempt.focusSquares) squares.add(square);
    }
    // Over a hundred questions the questions should touch most of the board.
    expect(squares.size).toBeGreaterThan(30);
  });

  it('records the sequence length and visibility on every attempt', () => {
    for (const attempt of run.final.attempts) {
      expect(attempt.plies).toBe(4);
      expect(attempt.boardVisibility).toBe('start-only');
      expect(attempt.blindfoldKind).toBeDefined();
    }
  });

  it('is reproducible: the same seed replays the same session', () => {
    const again = play(session({ limit: { kind: 'questions', count: 20 } }), () => 'correct');
    const first = play(session({ limit: { kind: 'questions', count: 20 } }), () => 'correct');
    expect(again.sequences).toEqual(first.sequences);
  });
});
