/**
 * Blindfold progress, deliberately kept apart from square mastery.
 *
 * A blindfold attempt names squares — "where is the knight that started on
 * g1" has an answer of e5 — but getting it wrong says nothing about whether
 * the user knows where e5 is. It says they lost track of a piece. Folding
 * those attempts into the per-square model would make the board look weak in
 * places the user knows perfectly well, and would then feed that error back
 * through adaptive practice.
 *
 * So blindfold results are measured on their own terms: how long a sequence
 * the user can hold, how much of the board they needed to see, and how much of
 * that was unaided.
 */

import type { StoredAttempt } from '../storage/types';

/** Mode ids whose attempts belong to this model and to no other. */
export const BLINDFOLD_MODE_IDS: readonly string[] = Object.freeze([
  'blindfold-tracking',
  'blindfold-reconstruction',
  'blindfold-progressive',
]);

export function isBlindfoldMode(modeId: string): boolean {
  return BLINDFOLD_MODE_IDS.includes(modeId);
}

/** Attempts that belong to the square-mastery model — everything else. */
export function excludeBlindfold(attempts: readonly StoredAttempt[]): StoredAttempt[] {
  return attempts.filter((attempt) => !isBlindfoldMode(attempt.modeId));
}

export function onlyBlindfold(attempts: readonly StoredAttempt[]): StoredAttempt[] {
  return attempts.filter((attempt) => isBlindfoldMode(attempt.modeId));
}

export interface BlindfoldTally {
  attempts: number;
  correct: number;
  accuracy: number;
  /** Attempts answered without taking a hint. */
  unaided: number;
  unaidedCorrect: number;
  /**
   * Accuracy counting only unaided answers.
   *
   * Reported separately rather than as a penalty: a hinted answer is not a
   * mistake, it is simply not evidence of unaided recall.
   */
  unaidedAccuracy: number;
  hintsTaken: number;
  medianMs: number | null;
}

export interface BlindfoldProgress {
  overall: BlindfoldTally;
  byMode: Map<string, BlindfoldTally>;
  /**
   * Accuracy against sequence length in plies, which is the honest measure of
   * how far the skill actually reaches.
   */
  byLength: Map<number, BlindfoldTally>;
  /** Accuracy against how much of the board the user was shown. */
  byVisibility: Map<string, BlindfoldTally>;
  /**
   * The longest sequence answered correctly at least `PROVEN_ATTEMPTS` times
   * without hints, or null before there is enough evidence. Deliberately not
   * "the longest they ever got right once".
   */
  provenPlies: number | null;
}

/** Correct unaided answers needed at a length before it counts as proven. */
export const PROVEN_ATTEMPTS = 5;
/** Accuracy needed at that length as well, so volume alone is not enough. */
export const PROVEN_ACCURACY = 0.7;

function emptyTally(): BlindfoldTally {
  return {
    attempts: 0,
    correct: 0,
    accuracy: 0,
    unaided: 0,
    unaidedCorrect: 0,
    unaidedAccuracy: 0,
    hintsTaken: 0,
    medianMs: null,
  };
}

interface Accumulator {
  tally: BlindfoldTally;
  times: number[];
}

function accumulate(store: Map<string | number, Accumulator>, key: string | number, attempt: StoredAttempt): void {
  let entry = store.get(key);
  if (entry === undefined) {
    entry = { tally: emptyTally(), times: [] };
    store.set(key, entry);
  }
  const hints = attempt.hintsUsed ?? 0;
  entry.tally.attempts += 1;
  entry.tally.hintsTaken += hints;
  if (attempt.correct) entry.tally.correct += 1;
  if (hints === 0) {
    entry.tally.unaided += 1;
    if (attempt.correct) entry.tally.unaidedCorrect += 1;
  }
  if (attempt.correct) entry.times.push(attempt.responseMs);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2)
    : (sorted[middle] as number);
}

function finish(entry: Accumulator): BlindfoldTally {
  const tally = entry.tally;
  return {
    ...tally,
    accuracy: tally.attempts === 0 ? 0 : tally.correct / tally.attempts,
    unaidedAccuracy: tally.unaided === 0 ? 0 : tally.unaidedCorrect / tally.unaided,
    medianMs: median(entry.times),
  };
}

function harvest<K extends string | number>(
  store: Map<string | number, Accumulator>,
): Map<K, BlindfoldTally> {
  const out = new Map<K, BlindfoldTally>();
  for (const [key, entry] of store) out.set(key as K, finish(entry));
  return out;
}

/**
 * How long the sequence was, and how much of the board was shown.
 *
 * Both are optional on the attempt, so anything written before this pass —
 * including an imported backup from an earlier version — reads back as null
 * rather than as a wrong number.
 */
export function pliesOf(attempt: StoredAttempt): number | null {
  return typeof attempt.plies === 'number' && Number.isFinite(attempt.plies)
    ? attempt.plies
    : null;
}

export function visibilityOf(attempt: StoredAttempt): string | null {
  return typeof attempt.boardVisibility === 'string' ? attempt.boardVisibility : null;
}

export function blindfoldProgress(attempts: readonly StoredAttempt[]): BlindfoldProgress {
  const blindfold = onlyBlindfold(attempts);

  const overall = new Map<string | number, Accumulator>();
  const byMode = new Map<string | number, Accumulator>();
  const byLength = new Map<string | number, Accumulator>();
  const byVisibility = new Map<string | number, Accumulator>();

  for (const attempt of blindfold) {
    accumulate(overall, 'all', attempt);
    accumulate(byMode, attempt.modeId, attempt);
    const plies = pliesOf(attempt);
    if (plies !== null) accumulate(byLength, plies, attempt);
    const visibility = visibilityOf(attempt);
    if (visibility !== null) accumulate(byVisibility, visibility, attempt);
  }

  const lengths = harvest<number>(byLength);

  let provenPlies: number | null = null;
  for (const [plies, tally] of lengths) {
    if (tally.unaidedCorrect < PROVEN_ATTEMPTS) continue;
    if (tally.unaidedAccuracy < PROVEN_ACCURACY) continue;
    if (provenPlies === null || plies > provenPlies) provenPlies = plies;
  }

  return {
    overall: overall.has('all') ? finish(overall.get('all') as Accumulator) : emptyTally(),
    byMode: harvest<string>(byMode),
    byLength: lengths,
    byVisibility: harvest<string>(byVisibility),
    provenPlies,
  };
}
