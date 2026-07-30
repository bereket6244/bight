/**
 * The session engine: a pure state machine over questions, answers and time.
 *
 * Time is always passed in rather than read from the clock, so pausing,
 * per-question timers and total-session limits are all deterministically
 * testable. The React layer supplies `Date.now()`; tests supply whatever they
 * like.
 */

import { getMode, getVariant } from '../training/registry';
import {
  describeExpected,
  describeSubmitted,
  emptyAnswerFor,
  gradeQuestion,
} from '../training/grade';
import type {
  AnswerSource,
  GeneratorContext,
  Grade,
  Question,
  SubmittedAnswer,
} from '../training/types';
import type { Orientation, SquareName } from '../chess/types';
import { createRng, type Rng } from '../rng';
import { questionTimerActive, type SessionSettings } from './settings';

export type SessionPhase =
  /** A question is on screen awaiting an answer. */
  | 'question'
  /** The answer has been graded and feedback is showing. */
  | 'feedback'
  | 'paused'
  | 'finished';

export interface Attempt {
  questionId: string;
  modeId: string;
  variantId: string;
  /** Prompt text as the user saw it. */
  prompt: string;
  expected: string;
  answer: string;
  correct: boolean;
  /** Milliseconds from question shown to answer submitted. */
  responseMs: number;
  source: AnswerSource;
  orientation: Orientation;
  labels: string;
  layout: string;
  filters: string;
  timer: string;
  /** Squares this attempt informs mastery for. */
  focusSquares: SquareName[];
  primarySquare: SquareName | null;
  /** Squares missed and wrongly selected, for multi-square questions. */
  missed: SquareName[];
  extra: SquareName[];
  timestamp: number;
  /** True when the attempt was a retry of an earlier miss. */
  isRetry: boolean;
}

export interface SessionState {
  settings: SessionSettings;
  phase: SessionPhase;
  current: Question | null;
  lastGrade: Grade | null;
  /** Questions answered so far, in order. */
  attempts: Attempt[];
  /** Questions queued for a later retry within this session. */
  retryQueue: Question[];
  questionNumber: number;
  correctCount: number;
  streak: number;
  bestStreak: number;
  startedAt: number;
  questionStartedAt: number;
  /** Total milliseconds spent paused, excluded from all timing. */
  pausedMs: number;
  pausedAt: number | null;
  /** Set when the session ended early rather than by reaching its limit. */
  endedEarly: boolean;
  rng: Rng;
  /** Alternates for the "alternating" orientation policy. */
  orientationFlip: boolean;
}

export interface SessionDeps {
  /** Per-square practice weights from the mastery model. */
  weights?: ReadonlyMap<SquareName, number>;
  seed?: number;
}

function resolveOrientation(state: SessionState): Orientation {
  switch (state.settings.orientation) {
    case 'white':
      return 'white';
    case 'black':
      return 'black';
    case 'random':
      return state.rng.chance(0.5) ? 'white' : 'black';
    case 'alternating':
      return state.orientationFlip ? 'black' : 'white';
  }
}

function generatorContext(state: SessionState, deps: SessionDeps): GeneratorContext {
  return {
    filters: state.settings.filters,
    orientation: resolveOrientation(state),
    labels: state.settings.labels,
    layout: state.settings.layout,
    weights: state.settings.adaptive ? deps.weights : undefined,
    revealMs: state.settings.revealMs,
    showHints: state.settings.showHints,
  };
}

function nextQuestion(state: SessionState, deps: SessionDeps): Question {
  // A queued retry takes priority so misses come back within the session.
  const queued = state.retryQueue[0];
  if (queued !== undefined && state.questionNumber > 0 && state.questionNumber % 3 === 0) {
    state.retryQueue = state.retryQueue.slice(1);
    return queued;
  }

  const mode = getMode(state.settings.modeId);
  const variant = getVariant(state.settings.modeId, state.settings.variantId);
  return mode.generate(generatorContext(state, deps), state.rng, variant.id);
}

export function startSession(
  settings: SessionSettings,
  deps: SessionDeps = {},
  now: number = Date.now(),
): SessionState {
  const state: SessionState = {
    settings,
    phase: 'question',
    current: null,
    lastGrade: null,
    attempts: [],
    retryQueue: [],
    questionNumber: 1,
    correctCount: 0,
    streak: 0,
    bestStreak: 0,
    startedAt: now,
    questionStartedAt: now,
    pausedMs: 0,
    pausedAt: null,
    endedEarly: false,
    rng: createRng(deps.seed ?? Date.now()),
    orientationFlip: false,
  };

  state.current = nextQuestion(state, deps);
  return state;
}

/** Elapsed session milliseconds, excluding time spent paused. */
export function elapsedMs(state: SessionState, now: number): number {
  const pausedNow = state.pausedAt === null ? 0 : now - state.pausedAt;
  return Math.max(0, now - state.startedAt - state.pausedMs - pausedNow);
}

/** Elapsed milliseconds on the current question, excluding pauses. */
export function questionElapsedMs(state: SessionState, now: number): number {
  if (state.pausedAt !== null) return Math.max(0, state.pausedAt - state.questionStartedAt);
  return Math.max(0, now - state.questionStartedAt);
}

export function sessionStats(state: SessionState): { attempts: number; accuracy: number } {
  const attempts = state.attempts.length;
  return {
    attempts,
    accuracy: attempts === 0 ? 1 : state.correctCount / attempts,
  };
}

/** Seconds left on the per-question timer, or null when it is not running. */
export function questionSecondsLeft(state: SessionState, now: number): number | null {
  const timer = state.settings.questionTimer;
  if (timer.kind !== 'per-question') return null;
  if (!questionTimerActive(state.settings, sessionStats(state))) return null;
  if (state.phase !== 'question') return null;
  return Math.max(0, timer.seconds - questionElapsedMs(state, now) / 1000);
}

/** Seconds left in the whole session, or null when there is no total limit. */
export function sessionSecondsLeft(state: SessionState, now: number): number | null {
  if (state.settings.limit.kind !== 'total-time') return null;
  return Math.max(0, state.settings.limit.seconds - elapsedMs(state, now) / 1000);
}

function hasReachedLimit(state: SessionState, now: number): boolean {
  const limit = state.settings.limit;
  switch (limit.kind) {
    case 'questions':
      return state.attempts.filter((a) => !a.isRetry).length >= limit.count;
    case 'total-time':
      return elapsedMs(state, now) >= limit.seconds * 1000;
    case 'endless':
      return false;
  }
}

function describeFiltersShort(state: SessionState): string {
  const { files, ranks, quadrants, weakSquaresOnly } = state.settings.filters;
  const parts: string[] = [];
  if (files.length > 0) parts.push(`f:${files.join('')}`);
  if (ranks.length > 0) parts.push(`r:${ranks.join('')}`);
  if (quadrants.length > 0) parts.push(`q:${quadrants.length}`);
  if (weakSquaresOnly) parts.push('weak');
  return parts.join(' ') || 'none';
}

/**
 * Records an answer and moves to feedback.
 *
 * A recognition failure is not an answer: callers pass `source: 'voice'` only
 * once the utterance has been confidently parsed, so a misheard word never
 * lands here as a wrong chess answer.
 */
export function submitAnswer(
  state: SessionState,
  submitted: SubmittedAnswer,
  source: AnswerSource,
  deps: SessionDeps = {},
  now: number = Date.now(),
): SessionState {
  if (state.phase !== 'question' || state.current === null) return state;

  const question = state.current;
  const grade = gradeQuestion(question, submitted);
  const responseMs = questionElapsedMs(state, now);
  const isRetry = state.attempts.some((attempt) => attempt.questionId === question.id);

  const attempt: Attempt = {
    questionId: question.id,
    modeId: question.modeId,
    variantId: question.variantId,
    prompt: question.prompt.text,
    expected: describeExpected(question.expected),
    answer: describeSubmitted(submitted),
    correct: grade.correct,
    responseMs,
    source,
    orientation: question.board.orientation,
    labels: question.board.labels,
    layout: state.settings.layout,
    filters: describeFiltersShort(state),
    timer:
      state.settings.questionTimer.kind === 'per-question'
        ? `${state.settings.questionTimer.seconds}s`
        : 'none',
    focusSquares: question.focusSquares,
    primarySquare: question.primarySquare,
    missed: grade.missed,
    extra: grade.extra,
    timestamp: now,
    isRetry,
  };

  const streak = grade.correct ? state.streak + 1 : 0;
  const retryQueue = shouldQueueRetry(state, grade)
    ? [...state.retryQueue, question]
    : state.retryQueue;

  const next: SessionState = {
    ...state,
    attempts: [...state.attempts, attempt],
    correctCount: state.correctCount + (grade.correct ? 1 : 0),
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    lastGrade: grade,
    retryQueue,
    phase: 'feedback',
  };

  // With end-of-session feedback the user is not shown the result, so the
  // engine advances immediately instead of waiting for a "next" tap.
  if (state.settings.feedback === 'end-of-session') {
    return advance(next, deps, now);
  }

  // Immediate retry re-asks the same question straight away.
  if (!grade.correct && (state.settings.retry === 'immediate' || state.settings.retry === 'both')) {
    return next;
  }

  return next;
}

function shouldQueueRetry(state: SessionState, grade: Grade): boolean {
  if (grade.correct) return false;
  return state.settings.retry === 'later' || state.settings.retry === 'both';
}

/**
 * Moves from feedback to the next question, ending the session if a limit has
 * been reached.
 */
export function advance(
  state: SessionState,
  deps: SessionDeps = {},
  now: number = Date.now(),
): SessionState {
  if (state.phase === 'finished') return state;

  if (hasReachedLimit(state, now)) {
    // Drain queued retries before finishing, so "retry later" really happens.
    if (state.retryQueue.length > 0 && state.settings.retry !== 'none') {
      const [next, ...rest] = state.retryQueue;
      return {
        ...state,
        current: next as Question,
        retryQueue: rest,
        phase: 'question',
        questionNumber: state.questionNumber + 1,
        questionStartedAt: now,
        lastGrade: null,
        orientationFlip: !state.orientationFlip,
      };
    }
    return { ...state, phase: 'finished', current: null };
  }

  const working: SessionState = {
    ...state,
    orientationFlip: !state.orientationFlip,
    questionNumber: state.questionNumber + 1,
  };
  const question = nextQuestion(working, deps);

  return {
    ...working,
    current: question,
    retryQueue: working.retryQueue,
    phase: 'question',
    questionStartedAt: now,
    lastGrade: null,
  };
}

/** Re-asks the current question without recording a new attempt. */
export function retryCurrent(state: SessionState, now: number = Date.now()): SessionState {
  if (state.current === null) return state;
  return { ...state, phase: 'question', lastGrade: null, questionStartedAt: now };
}

export function pause(state: SessionState, now: number = Date.now()): SessionState {
  if (state.phase === 'paused' || state.phase === 'finished') return state;
  return { ...state, phase: 'paused', pausedAt: now };
}

export function resume(state: SessionState, now: number = Date.now()): SessionState {
  if (state.phase !== 'paused' || state.pausedAt === null) return state;
  const pausedFor = now - state.pausedAt;
  return {
    ...state,
    phase: state.current === null ? 'finished' : 'question',
    // `pausedMs` keeps the session clock honest; shifting the question start
    // does the same for the per-question timer, which would otherwise treat
    // the whole pause as thinking time.
    pausedMs: state.pausedMs + pausedFor,
    questionStartedAt: state.questionStartedAt + pausedFor,
    pausedAt: null,
  };
}

/** Ends the session immediately, keeping every attempt made so far. */
export function exitSession(state: SessionState, now: number = Date.now()): SessionState {
  void now;
  return { ...state, phase: 'finished', current: null, endedEarly: true };
}

export function restartSession(
  state: SessionState,
  deps: SessionDeps = {},
  now: number = Date.now(),
): SessionState {
  return startSession(state.settings, deps, now);
}

/**
 * Advances time. Returns a new state when a timer expired, otherwise the same
 * state, so React can bail out of re-rendering cheaply.
 *
 * An expired per-question timer submits an empty answer, which grades as
 * incorrect - the spec requires the session not to advance silently.
 */
export function tick(
  state: SessionState,
  deps: SessionDeps = {},
  now: number = Date.now(),
): SessionState {
  if (state.phase === 'paused' || state.phase === 'finished') return state;

  if (state.settings.limit.kind === 'total-time' && elapsedMs(state, now) >= state.settings.limit.seconds * 1000) {
    return { ...state, phase: 'finished', current: null };
  }

  if (state.phase === 'question') {
    const left = questionSecondsLeft(state, now);
    if (left !== null && left <= 0 && state.current !== null) {
      return submitAnswer(state, emptyAnswerFor(state.current.expected), 'timeout', deps, now);
    }
  }

  return state;
}

export interface SessionSummary {
  total: number;
  correct: number;
  accuracy: number;
  averageMs: number;
  medianMs: number;
  fastestCorrectMs: number | null;
  bestStreak: number;
  durationMs: number;
  endedEarly: boolean;
  /** Attempts the user got wrong, for the review list. */
  mistakes: Attempt[];
}

export function summarise(state: SessionState, now: number = Date.now()): SessionSummary {
  const attempts = state.attempts;
  const total = attempts.length;
  const correct = attempts.filter((a) => a.correct).length;
  const times = attempts.map((a) => a.responseMs).sort((a, b) => a - b);
  const correctTimes = attempts.filter((a) => a.correct).map((a) => a.responseMs);

  const median =
    times.length === 0
      ? 0
      : times.length % 2 === 1
        ? (times[(times.length - 1) / 2] as number)
        : ((times[times.length / 2 - 1] as number) + (times[times.length / 2] as number)) / 2;

  return {
    total,
    correct,
    accuracy: total === 0 ? 0 : correct / total,
    averageMs: total === 0 ? 0 : Math.round(times.reduce((sum, t) => sum + t, 0) / total),
    medianMs: Math.round(median),
    fastestCorrectMs: correctTimes.length === 0 ? null : Math.min(...correctTimes),
    bestStreak: state.bestStreak,
    durationMs: elapsedMs(state, now),
    endedEarly: state.endedEarly,
    mistakes: attempts.filter((a) => !a.correct),
  };
}

/** Progress through the session, for the progress bar. */
export function sessionProgress(state: SessionState, now: number): { done: number; total: number | null } {
  const limit = state.settings.limit;
  const answered = state.attempts.filter((a) => !a.isRetry).length;
  switch (limit.kind) {
    case 'questions':
      return { done: answered, total: limit.count };
    case 'total-time':
      return { done: Math.round(elapsedMs(state, now) / 1000), total: limit.seconds };
    case 'endless':
      return { done: answered, total: null };
  }
}
