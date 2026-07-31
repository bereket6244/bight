/**
 * The session engine: a pure state machine over questions, answers and time.
 *
 * Time is always passed in rather than read from the clock, so pausing and
 * both timer kinds are deterministically testable. The React layer supplies
 * `Date.now()`; tests supply whatever they like.
 *
 * ## Flow
 *
 * Practice is continuous. There is no feedback phase and no confirmation step:
 *
 *  - A **correct** answer records the attempt and immediately replaces the
 *    question. Nothing is shown in between beyond a brief input lock.
 *  - A **wrong** answer records the attempt and leaves the same question
 *    active so the user can try again. The answer is never revealed.
 *  - Multi-square questions complete themselves: each correct square stays
 *    selected, and the moment the set is complete the question advances.
 *
 * Selection state lives here rather than in the UI, because "is this set
 * complete yet" is the question that decides whether to advance, and that is
 * engine logic.
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
  Question,
  RequiredPlacement,
  SubmittedAnswer,
} from '../training/types';
import { knightTargets } from '../chess/geometry';
import { forksFrom, journeyMoves } from '../chess/fork';
import { knightDistance } from '../chess/knightRoute';
import { occupancyFromFen } from '../chess/position';
import type { Orientation, PieceColor, PieceType, SquareName } from '../chess/types';
import { createRng, type Rng } from '../rng';
import { questionTimerActive, type SessionSettings } from './settings';

export type SessionPhase = 'question' | 'paused' | 'finished';

/**
 * How long input is ignored after a question is replaced.
 *
 * Long enough that a double tap cannot answer the next question by accident,
 * short enough to be invisible during rapid practice.
 */
export const ADVANCE_LOCK_MS = 180;

export interface Attempt {
  questionId: string;
  modeId: string;
  variantId: string;
  prompt: string;
  expected: string;
  answer: string;
  correct: boolean;
  /** Milliseconds from the question appearing to this submission. */
  responseMs: number;
  source: AnswerSource;
  orientation: Orientation;
  labels: string;
  layout: string;
  filters: string;
  timer: string;
  focusSquares: SquareName[];
  primarySquare: SquareName | null;
  missed: SquareName[];
  extra: SquareName[];
  timestamp: number;
  /**
   * True for every attempt after the first on the same question — that is,
   * every retry following a wrong answer. The question limit counts completed
   * questions, not attempts, so retries never shorten a session.
   */
  isRetry: boolean;
  /**
   * Journey answers only: solved, but in more moves than necessary. Recorded
   * separately so it never counts as a wrong chess answer.
   */
  suboptimal?: boolean;
  /**
   * Move answers only: the square the piece should have been moved *from*.
   *
   * Notation questions test two separable things — picking the right piece and
   * knowing where it goes. Recording only the destination, as the first
   * version did, made origin-selection skill invisible to the mastery model.
   */
  originSquare?: SquareName | null;
  /** Whether the right piece was chosen, independent of the destination. */
  originCorrect?: boolean;
  /** Whether the right destination was chosen, independent of the origin. */
  destinationCorrect?: boolean;
  /**
   * Hints taken before this answer. Optional, so attempts written by earlier
   * versions load unchanged. Blindfold progress reports hint-free accuracy
   * separately, because a hinted answer is not unaided recall.
   */
  hintsUsed?: number;
  /**
   * Blindfold only: how long the sequence actually was, in plies, and how much
   * of the board the user was actually shown.
   *
   * Denormalised onto the attempt exactly as `labels` and `timer` already are,
   * because the progressive ladder can move the stage mid-session — the
   * session's stored settings would say what the user *chose*, not what they
   * were given.
   */
  plies?: number;
  boardVisibility?: string;
}

/** A square the user got wrong, flashed briefly by the UI. */
export interface RejectedInput {
  squares: SquareName[];
  /** Non-square answers (a colour, a choice) so the UI can flash that control. */
  label: string | null;
  /** Increments on every rejection so the UI can retrigger its animation. */
  token: number;
}

export interface SessionState {
  settings: SessionSettings;
  phase: SessionPhase;
  current: Question | null;
  attempts: Attempt[];
  /** Questions queued to be asked again later in this session. */
  retryQueue: Question[];
  /** Squares selected so far on the current multi-square question, in order. */
  selected: SquareName[];
  /**
   * Squares a journey piece has moved through, excluding its origin.
   * Empty for every other kind of question.
   */
  journey: SquareName[];
  /** Pieces placed so far on a reconstruction question. */
  placed: RequiredPlacement[];
  /** Hints taken on the current question. Reset when the question changes. */
  hintsUsed: number;
  /** The most recent wrong input, for a brief red flash. */
  rejected: RejectedInput | null;
  /**
   * Monotonic count of rejections for the whole session.
   *
   * Kept separately from `rejected` because clearing the flash sets `rejected`
   * to null — deriving the next token from it would restart at 1, and the UI,
   * having already animated token 1, would not flash the second miss.
   */
  rejectionCount: number;
  /** Increments each time a question is replaced; keys UI transitions. */
  advanceToken: number;
  /** Questions answered correctly or timed out. Drives the question limit. */
  questionsCompleted: number;
  questionNumber: number;
  correctCount: number;
  streak: number;
  bestStreak: number;
  startedAt: number;
  questionStartedAt: number;
  pausedMs: number;
  pausedAt: number | null;
  /** Input is ignored until this timestamp. */
  lockedUntil: number;
  endedEarly: boolean;
  rng: Rng;
  orientationFlip: boolean;
}

export interface SessionDeps {
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
    // `revealMs` is what makes a prompt flash, so it is only passed when the
    // user actually asked for a flash. Passing it unconditionally would hide
    // every prompt after a second, which is not the default behaviour.
    revealMs: state.settings.promptVisibility === 'flash' ? state.settings.revealMs : undefined,
    hideBoard: state.settings.hideBoard,
    density: state.settings.density,
    showHints: state.settings.showHints,
    difficulty: state.settings.blindfoldDifficulty,
    plies: state.settings.blindfoldPlies,
    captureBias: state.settings.captureBias,
    boardVisibility: state.settings.boardVisibility,
    moveHistory: state.settings.moveHistory,
    pacing: state.settings.pacing,
    speakMoves: state.settings.speakMoves,
    streak: state.streak,
    recentAccuracy: recentAccuracy(state),
  };
}

/** Attempts considered "recent" by the progressive ladder. */
const RECENT_WINDOW = 8;

/**
 * Accuracy over the last few attempts, or undefined before there are enough
 * to mean anything. Undefined keeps the ladder from demoting on question two.
 */
function recentAccuracy(state: SessionState): number | undefined {
  if (state.attempts.length < RECENT_WINDOW) return undefined;
  const recent = state.attempts.slice(-RECENT_WINDOW);
  return recent.filter((attempt) => attempt.correct).length / recent.length;
}

/**
 * The pieces already standing on the board when a question begins.
 *
 * Reconstruction's correction variant draws a position with a few deliberate
 * errors in it, and repairing it means adding what is missing and clearing
 * what should not be there. Seeding `placed` from the drawn position makes
 * those the same two actions as ordinary placement rather than a second
 * mechanism. Questions that start from an empty board seed nothing.
 */
function initialPlacements(question: Question | null): RequiredPlacement[] {
  if (question === null || question.expected.kind !== 'placement') return [];
  const placements: RequiredPlacement[] = [];
  for (const [square, piece] of occupancyFromFen(question.board.fen)) {
    placements.push({ square, type: piece.type, color: piece.color });
  }
  return placements;
}

function nextQuestion(state: SessionState, deps: SessionDeps): Question {
  // A queued retry comes back every few questions so misses are revisited
  // without dominating the session.
  const queued = state.retryQueue[0];
  if (queued !== undefined && state.questionsCompleted > 0 && state.questionsCompleted % 3 === 0) {
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
    attempts: [],
    retryQueue: [],
    selected: [],
    journey: [],
    placed: [],
    hintsUsed: 0,
    rejected: null,
    rejectionCount: 0,
    advanceToken: 0,
    questionsCompleted: 0,
    questionNumber: 1,
    correctCount: 0,
    streak: 0,
    bestStreak: 0,
    startedAt: now,
    questionStartedAt: now,
    pausedMs: 0,
    pausedAt: null,
    lockedUntil: 0,
    endedEarly: false,
    rng: createRng(deps.seed ?? Date.now()),
    orientationFlip: false,
  };

  state.current = nextQuestion(state, deps);
  state.placed = initialPlacements(state.current);
  return state;
}

export function elapsedMs(state: SessionState, now: number): number {
  const pausedNow = state.pausedAt === null ? 0 : now - state.pausedAt;
  return Math.max(0, now - state.startedAt - state.pausedMs - pausedNow);
}

export function questionElapsedMs(state: SessionState, now: number): number {
  if (state.pausedAt !== null) return Math.max(0, state.pausedAt - state.questionStartedAt);
  return Math.max(0, now - state.questionStartedAt);
}

export function sessionStats(state: SessionState): { attempts: number; accuracy: number } {
  const attempts = state.attempts.length;
  return { attempts, accuracy: attempts === 0 ? 1 : state.correctCount / attempts };
}

export function questionSecondsLeft(state: SessionState, now: number): number | null {
  const timer = state.settings.questionTimer;
  if (timer.kind !== 'per-question') return null;
  if (!questionTimerActive(state.settings, sessionStats(state))) return null;
  if (state.phase !== 'question') return null;
  return Math.max(0, timer.seconds - questionElapsedMs(state, now) / 1000);
}

export function sessionSecondsLeft(state: SessionState, now: number): number | null {
  if (state.settings.limit.kind !== 'total-time') return null;
  return Math.max(0, state.settings.limit.seconds - elapsedMs(state, now) / 1000);
}

function hasReachedLimit(state: SessionState, now: number): boolean {
  const limit = state.settings.limit;
  switch (limit.kind) {
    case 'questions':
      // Completed questions, not attempts: retrying a miss must not shorten
      // the session.
      return state.questionsCompleted >= limit.count;
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

function buildAttempt(
  state: SessionState,
  question: Question,
  submitted: SubmittedAnswer,
  correct: boolean,
  missed: SquareName[],
  extra: SquareName[],
  source: AnswerSource,
  now: number,
): Attempt {
  // Move questions carry two separable skills. Splitting them here is what
  // lets mastery penalise "picked the wrong knight" differently from
  // "picked the wrong square".
  const expected = question.expected;
  const moveDetail =
    expected.kind === 'move' && submitted.kind === 'move'
      ? {
          originSquare: expected.from,
          originCorrect: submitted.from === expected.from,
          destinationCorrect:
            submitted.to === expected.to ||
            (expected.alternativeTargets ?? []).includes(submitted.to as SquareName),
        }
      : {};

  return {
    ...moveDetail,
    questionId: question.id,
    modeId: question.modeId,
    variantId: question.variantId,
    prompt: question.prompt.text,
    expected: describeExpected(question.expected),
    answer: describeSubmitted(submitted),
    correct,
    responseMs: questionElapsedMs(state, now),
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
    missed,
    extra,
    timestamp: now,
    isRetry: state.attempts.some((attempt) => attempt.questionId === question.id),
    hintsUsed: state.hintsUsed,
    plies: question.blindfold?.san.length,
    boardVisibility: question.blindfold?.visibility,
  };
}

/**
 * Whether the session should queue this question to be asked again later.
 *
 * Once the question limit is reached the queue is drained but never refilled.
 * Without that, a miss on a queued retry would queue it again, and a
 * "10 questions" session could run indefinitely — a 10-question session was
 * observed reaching 40 before this check existed.
 */
function shouldQueueRetry(state: SessionState, question: Question): boolean {
  const policy = state.settings.retry;
  if (policy === 'none' || policy === 'immediate') return false;

  const limit = state.settings.limit;
  if (limit.kind === 'questions' && state.questionsCompleted >= limit.count) return false;

  return !state.retryQueue.some((queued) => queued.id === question.id);
}

/**
 * Records a correct answer and moves straight to the next question.
 * The session finishes here if the limit has been reached.
 */
function completeQuestion(
  state: SessionState,
  attempt: Attempt,
  deps: SessionDeps,
  now: number,
): SessionState {
  const streak = state.streak + 1;
  const completed = state.questionsCompleted + 1;

  const base: SessionState = {
    ...state,
    attempts: [...state.attempts, attempt],
    correctCount: state.correctCount + 1,
    questionsCompleted: completed,
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    selected: [],
    journey: [],
    placed: [],
    hintsUsed: 0,
    rejected: null,
    lockedUntil: now + ADVANCE_LOCK_MS,
    advanceToken: state.advanceToken + 1,
  };

  return advanceFrom(base, deps, now);
}

/** Replaces the current question, or finishes the session. */
function advanceFrom(state: SessionState, deps: SessionDeps, now: number): SessionState {
  if (hasReachedLimit(state, now)) {
    // Drain queued retries before finishing, so "come back to it later"
    // actually happens.
    const [queued, ...rest] = state.retryQueue;
    if (queued !== undefined) {
      return {
        ...state,
        current: queued,
        retryQueue: rest,
        phase: 'question',
        questionNumber: state.questionNumber + 1,
        questionStartedAt: now,
        selected: [],
        journey: [],
        placed: initialPlacements(queued),
        hintsUsed: 0,
        orientationFlip: !state.orientationFlip,
      };
    }
    return {
      ...state,
      phase: 'finished',
      current: null,
      selected: [],
      journey: [],
      placed: [],
      hintsUsed: 0,
    };
  }

  const working: SessionState = {
    ...state,
    orientationFlip: !state.orientationFlip,
    questionNumber: state.questionNumber + 1,
  };

  const current = nextQuestion(working, deps);

  return {
    ...working,
    current,
    phase: 'question',
    questionStartedAt: now,
    selected: [],
    journey: [],
    placed: initialPlacements(current),
    hintsUsed: 0,
  };
}

/** Records a wrong answer and leaves the same question active. */
function rejectAnswer(
  state: SessionState,
  question: Question,
  attempt: Attempt,
  squares: SquareName[],
  label: string | null,
): SessionState {
  const token = state.rejectionCount + 1;
  return {
    ...state,
    attempts: [...state.attempts, attempt],
    streak: 0,
    retryQueue: shouldQueueRetry(state, question)
      ? [...state.retryQueue, question]
      : state.retryQueue,
    rejectionCount: token,
    rejected: { squares, label, token },
  };
}

function isLocked(state: SessionState, now: number): boolean {
  return now < state.lockedUntil;
}

/**
 * Submits a whole answer: a tapped square, a typed coordinate, a colour, a
 * choice, or a move. Correct answers advance; wrong ones do not.
 *
 * Multi-square and route questions are answered a square at a time through
 * `selectSquare` instead.
 */
export function submitAnswer(
  state: SessionState,
  submitted: SubmittedAnswer,
  source: AnswerSource,
  deps: SessionDeps = {},
  now: number = Date.now(),
): SessionState {
  if (state.phase !== 'question' || state.current === null) return state;
  if (isLocked(state, now) && source !== 'timeout') return state;

  const question = state.current;
  const grade = gradeQuestion(question, submitted);

  if (grade.correct) {
    const attempt = buildAttempt(state, question, submitted, true, [], [], source, now);
    return completeQuestion(state, attempt, deps, now);
  }

  // A timeout ends the question rather than leaving it open forever.
  if (source === 'timeout') {
    const attempt = buildAttempt(
      state,
      question,
      submitted,
      false,
      grade.missed,
      grade.extra,
      source,
      now,
    );
    const next: SessionState = {
      ...state,
      attempts: [...state.attempts, attempt],
      streak: 0,
      questionsCompleted: state.questionsCompleted + 1,
      retryQueue: shouldQueueRetry(state, question)
        ? [...state.retryQueue, question]
        : state.retryQueue,
      selected: [],
      journey: [],
      placed: [],
      hintsUsed: 0,
      rejected: null,
      lockedUntil: now + ADVANCE_LOCK_MS,
      advanceToken: state.advanceToken + 1,
    };
    return advanceFrom(next, deps, now);
  }

  // Wrong: record it, flash the offending input, keep the question.
  // `missed` stays empty so nothing about the real answer is revealed.
  const attempt = buildAttempt(state, question, submitted, false, [], grade.extra, source, now);
  return rejectAnswer(state, question, attempt, grade.extra, describeSubmitted(submitted));
}

/**
 * Taps one square on a multi-square or route question.
 *
 * Correct squares accumulate and stay selected. Re-tapping an already-correct
 * square is ignored rather than penalised. The question completes itself the
 * moment the set is complete, with no confirmation step.
 */
export function selectSquare(
  state: SessionState,
  square: SquareName,
  source: AnswerSource,
  deps: SessionDeps = {},
  now: number = Date.now(),
): SessionState {
  if (state.phase !== 'question' || state.current === null) return state;
  if (isLocked(state, now)) return state;

  const question = state.current;
  const expected = question.expected;

  if (expected.kind === 'square-set') {
    // Re-tapping a square already credited is a no-op, never a mistake.
    if (state.selected.includes(square)) return state;

    if (!expected.squares.includes(square)) {
      const submitted: SubmittedAnswer = { kind: 'square-set', squares: [square] };
      const attempt = buildAttempt(state, question, submitted, false, [], [square], source, now);
      return rejectAnswer(state, question, attempt, [square], null);
    }

    const selected = [...state.selected, square];
    if (selected.length < expected.squares.length) {
      return { ...state, selected, rejected: null };
    }

    // The set is complete — no Submit needed.
    const submitted: SubmittedAnswer = { kind: 'square-set', squares: selected };
    const attempt = buildAttempt(state, question, submitted, true, [], [], source, now);
    return completeQuestion({ ...state, selected }, attempt, deps, now);
  }

  if (expected.kind === 'square-path') {
    const from = state.selected[state.selected.length - 1] ?? expected.from;
    const stepsTaken = state.selected.length + 1;

    const legalStep = knightTargets(from).includes(square);
    const remainingAfter = knightDistance(square, expected.to);
    const onShortestPath =
      !expected.requireShortest ||
      (remainingAfter !== null && stepsTaken + remainingAfter === expected.shortestLength);

    if (!legalStep || !onShortestPath) {
      const submitted: SubmittedAnswer = { kind: 'square-path', squares: [...state.selected, square] };
      const attempt = buildAttempt(state, question, submitted, false, [], [square], source, now);
      return rejectAnswer(state, question, attempt, [square], null);
    }

    const selected = [...state.selected, square];
    if (square !== expected.to) {
      return { ...state, selected, rejected: null };
    }

    const submitted: SubmittedAnswer = { kind: 'square-path', squares: selected };
    const attempt = buildAttempt(state, question, submitted, true, [], [], source, now);
    return completeQuestion({ ...state, selected }, attempt, deps, now);
  }

  // Single-square questions go through the ordinary submit path.
  return submitAnswer(state, { kind: 'single-square', square }, source, deps, now);
}

/**
 * Moves the piece one step in a "play the fork" question.
 *
 * Intermediate moves are not mistakes: the piece may need several moves to
 * reach a forking square, and flashing red on every non-forking move would
 * punish correct play. Only an *illegal* move is rejected. The question
 * completes the instant the piece attacks every target.
 */
export function moveJourneyPiece(
  state: SessionState,
  to: SquareName,
  source: AnswerSource,
  deps: SessionDeps = {},
  now: number = Date.now(),
): SessionState {
  if (state.phase !== 'question' || state.current === null) return state;
  if (isLocked(state, now)) return state;

  const question = state.current;
  const expected = question.expected;
  if (expected.kind !== 'piece-journey') return state;

  const from = state.journey[state.journey.length - 1] ?? expected.from;
  if (to === from) return state;

  // Occupancy with the piece where it currently stands.
  const occupancy = occupancyFromFen(expected.fen);
  occupancy.delete(expected.from);
  const piece = { type: expected.piece, color: expected.color };

  const legal = journeyMoves(piece, from, withPieceAt(occupancy, from, piece));
  if (!legal.includes(to)) {
    const submitted: SubmittedAnswer = { kind: 'piece-journey', path: [...state.journey, to] };
    const attempt = buildAttempt(state, question, submitted, false, [], [to], source, now);
    return rejectAnswer(state, question, attempt, [to], null);
  }

  const journey = [...state.journey, to];
  const forks = forksFrom(piece, to, expected.targets, occupancy);

  if (!forks) {
    // A legal step that has not arrived yet. No penalty, no advance.
    return { ...state, journey, rejected: null };
  }

  const submitted: SubmittedAnswer = { kind: 'piece-journey', path: journey };
  const attempt = buildAttempt(state, question, submitted, true, [], [], source, now);
  const graded = gradeQuestion(question, submitted);

  return completeQuestion(
    { ...state, journey },
    // Solving the long way round is still solved; the attempt records whether
    // it was optimal so statistics can tell the difference.
    { ...attempt, suboptimal: graded.optimal === false },
    deps,
    now,
  );
}

function withPieceAt(
  occupancy: ReturnType<typeof occupancyFromFen>,
  square: SquareName,
  piece: { type: PieceType; color: PieceColor },
): ReturnType<typeof occupancyFromFen> {
  const next = new Map(occupancy);
  next.set(square, { type: piece.type, color: piece.color });
  return next;
}

/**
 * Places one piece on a reconstruction question.
 *
 * Reconstruction is answered a piece at a time, in the same continuous style
 * as multi-square questions: a correct placement stays on the board, a wrong
 * one flashes red and is discarded, and the question completes itself the
 * moment every required piece stands on its square. There is no Submit.
 *
 * Wrongness here means "not one of the pieces this question asked for". A
 * partial-reconstruction question asks about a subset, so a piece that really
 * is on the board but outside the subset is still not part of this answer.
 */
export function placePiece(
  state: SessionState,
  placement: RequiredPlacement,
  source: AnswerSource,
  deps: SessionDeps = {},
  now: number = Date.now(),
): SessionState {
  if (state.phase !== 'question' || state.current === null) return state;
  if (isLocked(state, now)) return state;

  const question = state.current;
  const expected = question.expected;
  if (expected.kind !== 'placement') return state;

  const placementKey = placementIdentity(placement);

  // Re-placing a piece already standing there is a no-op, never a mistake.
  if (state.placed.some((p) => placementIdentity(p) === placementKey)) return state;

  if (!expected.required.some((p) => placementIdentity(p) === placementKey)) {
    const submitted: SubmittedAnswer = {
      kind: 'placement',
      placed: [...state.placed, placement],
    };
    const attempt = buildAttempt(
      state,
      question,
      submitted,
      false,
      [],
      [placement.square],
      source,
      now,
    );
    return rejectAnswer(state, question, attempt, [placement.square], null);
  }

  // One piece to a square: a correct placement replaces anything standing there.
  const placed = [...state.placed.filter((p) => p.square !== placement.square), placement];
  return settlePlacement(state, question, placed, source, deps, now);
}

/**
 * Clears a square on a reconstruction question.
 *
 * On the correction variant this is how a wrongly-placed piece is thrown out,
 * so it is a real answer and can complete the question. Clearing a piece that
 * genuinely belongs there is a mistake and is rejected like any other, which
 * costs the user nothing beyond a flash — the piece stays put.
 */
export function removePlacement(
  state: SessionState,
  square: SquareName,
  source: AnswerSource,
  deps: SessionDeps = {},
  now: number = Date.now(),
): SessionState {
  if (state.phase !== 'question' || state.current === null) return state;
  if (isLocked(state, now)) return state;

  const question = state.current;
  const expected = question.expected;
  if (expected.kind !== 'placement') return state;

  const target = state.placed.find((p) => p.square === square);
  if (target === undefined) return state;

  const belongs = expected.required.some(
    (p) => placementIdentity(p) === placementIdentity(target),
  );
  if (belongs) {
    const submitted: SubmittedAnswer = { kind: 'placement', placed: state.placed };
    const attempt = buildAttempt(state, question, submitted, false, [], [square], source, now);
    return rejectAnswer(state, question, attempt, [square], null);
  }

  const placed = state.placed.filter((p) => p.square !== square);
  return settlePlacement(state, question, placed, source, deps, now);
}

function placementIdentity(placement: RequiredPlacement): string {
  return `${placement.square}:${placement.color}:${placement.type}`;
}

/**
 * Applies a new board to a placement question, completing it if that board is
 * now the answer.
 *
 * Completion is decided by `gradeQuestion`, not by counting pieces, so the
 * "is this finished" rule and the "was this right" rule cannot drift apart —
 * which matters on the correction variant, where a leftover piece in the wrong
 * place is a failure even though nothing is missing.
 */
function settlePlacement(
  state: SessionState,
  question: Question,
  placed: RequiredPlacement[],
  source: AnswerSource,
  deps: SessionDeps,
  now: number,
): SessionState {
  const submitted: SubmittedAnswer = { kind: 'placement', placed };
  if (!gradeQuestion(question, submitted).correct) {
    return { ...state, placed, rejected: null };
  }
  const attempt = buildAttempt(state, question, submitted, true, [], [], source, now);
  return completeQuestion({ ...state, placed }, attempt, deps, now);
}

/**
 * Records that the user took a hint on the current question.
 *
 * Hints are counted, not blocked, and nothing about the answer is revealed
 * here — the UI decides what a hint shows. The count rides along on the
 * attempt so blindfold progress can report unaided recall separately from
 * assisted answers.
 */
export function recordHint(state: SessionState): SessionState {
  if (state.phase !== 'question' || state.current === null) return state;
  if (!state.settings.allowHints) return state;
  return { ...state, hintsUsed: state.hintsUsed + 1 };
}

/** Clears the red flash once the UI has shown it. */
export function clearRejection(state: SessionState): SessionState {
  return state.rejected === null ? state : { ...state, rejected: null };
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
    lockedUntil: now + ADVANCE_LOCK_MS,
  };
}

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
 * Advances time. Returns the same state when nothing changed, so React can
 * bail out of re-rendering cheaply.
 */
export function tick(
  state: SessionState,
  deps: SessionDeps = {},
  now: number = Date.now(),
): SessionState {
  if (state.phase === 'paused' || state.phase === 'finished') return state;

  if (
    state.settings.limit.kind === 'total-time' &&
    elapsedMs(state, now) >= state.settings.limit.seconds * 1000
  ) {
    return { ...state, phase: 'finished', current: null };
  }

  if (state.phase === 'question') {
    const left = questionSecondsLeft(state, now);
    if (left !== null && left <= 0 && state.current !== null) {
      // An expired question is recorded as missed and replaced; leaving it
      // open would stall the session.
      const expected = state.current.expected;
      const submitted: SubmittedAnswer =
        expected.kind === 'square-set'
          ? { kind: 'square-set', squares: state.selected }
          : emptyAnswerFor(expected);
      return submitAnswer(state, submitted, 'timeout', deps, now);
    }
  }

  return state;
}

export interface SessionSummary {
  /** Every submission, including retries after a wrong answer. */
  total: number;
  correct: number;
  accuracy: number;
  /** Questions finished, which is what the session limit counts. */
  questionsCompleted: number;
  averageMs: number;
  medianMs: number;
  fastestCorrectMs: number | null;
  bestStreak: number;
  durationMs: number;
  endedEarly: boolean;
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
    questionsCompleted: state.questionsCompleted,
    averageMs: total === 0 ? 0 : Math.round(times.reduce((sum, t) => sum + t, 0) / total),
    medianMs: Math.round(median),
    fastestCorrectMs: correctTimes.length === 0 ? null : Math.min(...correctTimes),
    bestStreak: state.bestStreak,
    durationMs: elapsedMs(state, now),
    endedEarly: state.endedEarly,
    mistakes: attempts.filter((a) => !a.correct),
  };
}

export function sessionProgress(
  state: SessionState,
  now: number,
): { done: number; total: number | null } {
  const limit = state.settings.limit;
  switch (limit.kind) {
    case 'questions':
      return { done: state.questionsCompleted, total: limit.count };
    case 'total-time':
      return { done: Math.round(elapsedMs(state, now) / 1000), total: limit.seconds };
    case 'endless':
      return { done: state.questionsCompleted, total: null };
  }
}
