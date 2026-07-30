/**
 * The mastery model.
 *
 * A square is mastered when the user answers it correctly, quickly, repeatedly
 * and recently. All four matter, which is what stops a single lucky fast
 * answer from marking a square learned:
 *
 *   score = skill x confidence x retention
 *
 *   skill       accuracy (weighted toward recent attempts) and speed
 *   confidence  grows with sample size, so one attempt can never score high
 *   retention   decays as a square goes unpractised
 *
 * The same numbers drive adaptive practice: practice weight is the inverse of
 * mastery, capped so one weak square cannot crowd out the rest of the board.
 *
 * This file is the reference the in-app explanation and the README describe.
 */

import { ALL_SQUARES } from '../chess/square';
import type { SquareName } from '../chess/types';
import type { StoredAttempt } from '../storage/types';
import { MAX_WEIGHT } from '../training/pool';

/** Attempts needed before confidence reaches its maximum. */
export const CONFIDENCE_SAMPLE = 6;

/** Response time treated as fully fast, and the point where speed scores zero. */
export const FAST_MS = 2000;
export const SLOW_MS = 9000;

/** Days of no practice after which retention has decayed to about a half. */
export const RETENTION_HALF_LIFE_DAYS = 21;

/** Weight of the most recent attempt in the accuracy average. */
export const RECENCY_ALPHA = 0.35;

export type MasteryLevel = 'unseen' | 'learning' | 'familiar' | 'strong' | 'mastered';

export interface SquareMastery {
  square: SquareName;
  attempts: number;
  correct: number;
  /** Plain accuracy over all attempts. */
  accuracy: number;
  /** Accuracy weighted toward recent attempts. */
  recentAccuracy: number;
  averageMs: number;
  fastestMs: number | null;
  lastSeenAt: number | null;
  /** 0 to 1. */
  score: number;
  level: MasteryLevel;
  /** How strongly to favour this square in adaptive practice. */
  weight: number;
}

export interface MasteryOptions {
  /** "Now", so retention decay is testable. */
  now?: number;
}

function speedScore(averageMs: number): number {
  if (!Number.isFinite(averageMs) || averageMs <= 0) return 0;
  if (averageMs <= FAST_MS) return 1;
  if (averageMs >= SLOW_MS) return 0;
  return (SLOW_MS - averageMs) / (SLOW_MS - FAST_MS);
}

function confidence(attempts: number): number {
  return Math.min(1, attempts / CONFIDENCE_SAMPLE);
}

function retention(lastSeenAt: number | null, now: number): number {
  if (lastSeenAt === null) return 0;
  const days = Math.max(0, (now - lastSeenAt) / 86_400_000);
  return Math.pow(0.5, days / RETENTION_HALF_LIFE_DAYS);
}

export function masteryLevel(score: number, attempts: number): MasteryLevel {
  if (attempts === 0) return 'unseen';
  if (score >= 0.9) return 'mastered';
  if (score >= 0.72) return 'strong';
  if (score >= 0.45) return 'familiar';
  return 'learning';
}

/**
 * Exponentially weighted accuracy, oldest attempt first.
 * Recent results dominate, so improvement shows up quickly.
 */
function weightedAccuracy(results: readonly boolean[]): number {
  if (results.length === 0) return 0;
  let value = results[0] === true ? 1 : 0;
  for (let i = 1; i < results.length; i += 1) {
    value = value * (1 - RECENCY_ALPHA) + (results[i] === true ? 1 : 0) * RECENCY_ALPHA;
  }
  return value;
}

/**
 * Practice weight from mastery.
 *
 * A square never drops below weight 1 (so mastered squares still appear) and
 * never exceeds MAX_WEIGHT, which bounds how much adaptive practice can
 * distort the distribution. Unseen squares sit above the middle so new ground
 * gets covered before drilling old mistakes.
 */
export function practiceWeight(score: number, attempts: number): number {
  if (attempts === 0) return 3;
  const raw = 1 + (1 - score) * (MAX_WEIGHT - 1);
  return Math.min(MAX_WEIGHT, Math.max(1, Number(raw.toFixed(3))));
}

/**
 * Per-square mastery for every square that appears in the attempt history.
 *
 * A multi-square question (knight vision) attributes to its primary square,
 * and — at reduced strength — to the squares it asked about, so a knight drill
 * still teaches the app which target squares are weak.
 */
export function computeMastery(
  attempts: readonly StoredAttempt[],
  options: MasteryOptions = {},
): Map<SquareName, SquareMastery> {
  const now = options.now ?? Date.now();

  interface Accumulator {
    results: boolean[];
    totalMs: number;
    timedCount: number;
    fastestMs: number | null;
    lastSeenAt: number | null;
  }

  const bySquare = new Map<SquareName, Accumulator>();
  const ensure = (square: SquareName): Accumulator => {
    let entry = bySquare.get(square);
    if (entry === undefined) {
      entry = { results: [], totalMs: 0, timedCount: 0, fastestMs: null, lastSeenAt: null };
      bySquare.set(square, entry);
    }
    return entry;
  };

  // Oldest first so the weighted accuracy walks forward in time.
  const ordered = [...attempts].sort((a, b) => a.timestamp - b.timestamp);

  for (const attempt of ordered) {
    const primary = attempt.primarySquare;
    if (primary !== null) {
      const entry = ensure(primary);
      entry.results.push(attempt.correct);
      entry.totalMs += attempt.responseMs;
      entry.timedCount += 1;
      entry.lastSeenAt = attempt.timestamp;
      if (attempt.correct) {
        entry.fastestMs =
          entry.fastestMs === null ? attempt.responseMs : Math.min(entry.fastestMs, attempt.responseMs);
      }
    }

    // Squares the user actually missed count against them individually; this
    // is what surfaces "frequently missed knight targets".
    for (const square of attempt.missed) {
      const entry = ensure(square);
      entry.results.push(false);
      entry.lastSeenAt = attempt.timestamp;
    }
    for (const square of attempt.extra) {
      const entry = ensure(square);
      entry.results.push(false);
      entry.lastSeenAt = attempt.timestamp;
    }
  }

  const out = new Map<SquareName, SquareMastery>();
  for (const [square, entry] of bySquare) {
    const attemptCount = entry.results.length;
    const correct = entry.results.filter(Boolean).length;
    const accuracy = attemptCount === 0 ? 0 : correct / attemptCount;
    const recentAccuracy = weightedAccuracy(entry.results);
    const averageMs = entry.timedCount === 0 ? 0 : entry.totalMs / entry.timedCount;

    const skill = 0.75 * recentAccuracy + 0.25 * speedScore(averageMs);
    const score = Number(
      (skill * confidence(attemptCount) * retention(entry.lastSeenAt, now)).toFixed(4),
    );

    out.set(square, {
      square,
      attempts: attemptCount,
      correct,
      accuracy,
      recentAccuracy,
      averageMs: Math.round(averageMs),
      fastestMs: entry.fastestMs,
      lastSeenAt: entry.lastSeenAt,
      score,
      level: masteryLevel(score, attemptCount),
      weight: practiceWeight(score, attemptCount),
    });
  }

  return out;
}

/** Mastery for all 64 squares, filling in unseen ones. */
export function fullBoardMastery(
  attempts: readonly StoredAttempt[],
  options: MasteryOptions = {},
): Map<SquareName, SquareMastery> {
  const computed = computeMastery(attempts, options);
  for (const square of ALL_SQUARES) {
    if (computed.has(square)) continue;
    computed.set(square, {
      square,
      attempts: 0,
      correct: 0,
      accuracy: 0,
      recentAccuracy: 0,
      averageMs: 0,
      fastestMs: null,
      lastSeenAt: null,
      score: 0,
      level: 'unseen',
      weight: practiceWeight(0, 0),
    });
  }
  return computed;
}

/** The weight map the session engine feeds to generators. */
export function practiceWeights(
  attempts: readonly StoredAttempt[],
  options: MasteryOptions = {},
): Map<SquareName, number> {
  const mastery = fullBoardMastery(attempts, options);
  const weights = new Map<SquareName, number>();
  for (const [square, entry] of mastery) weights.set(square, entry.weight);
  return weights;
}

/** The weakest squares, worst first. Squares never seen come first of all. */
export function weakestSquares(
  attempts: readonly StoredAttempt[],
  count: number,
  options: MasteryOptions = {},
): SquareMastery[] {
  return [...fullBoardMastery(attempts, options).values()]
    .sort((a, b) => {
      if (a.attempts === 0 && b.attempts > 0) return -1;
      if (b.attempts === 0 && a.attempts > 0) return 1;
      return a.score - b.score;
    })
    .slice(0, count);
}

/** Squares answered correctly but slowly - the spec's "slow but correct". */
export function slowButCorrect(
  attempts: readonly StoredAttempt[],
  options: MasteryOptions = {},
): SquareMastery[] {
  return [...computeMastery(attempts, options).values()]
    .filter((entry) => entry.attempts >= 2 && entry.recentAccuracy >= 0.8 && entry.averageMs > FAST_MS)
    .sort((a, b) => b.averageMs - a.averageMs);
}

/** Board-wide mastery summary for the progress screen. */
export interface MasteryOverview {
  mastered: number;
  strong: number;
  familiar: number;
  learning: number;
  unseen: number;
  /** Mean score across all 64 squares. */
  averageScore: number;
}

export function masteryOverview(
  attempts: readonly StoredAttempt[],
  options: MasteryOptions = {},
): MasteryOverview {
  const all = [...fullBoardMastery(attempts, options).values()];
  const count = (level: MasteryLevel): number => all.filter((m) => m.level === level).length;
  return {
    mastered: count('mastered'),
    strong: count('strong'),
    familiar: count('familiar'),
    learning: count('learning'),
    unseen: count('unseen'),
    averageScore:
      all.length === 0 ? 0 : Number((all.reduce((sum, m) => sum + m.score, 0) / all.length).toFixed(4)),
  };
}

/** Plain-language explanation shown in the app next to the mastery figures. */
export const MASTERY_EXPLANATION = [
  'A square counts as mastered when four things are true at once:',
  `you get it right (recent answers count most), you answer it quickly (under ${FAST_MS / 1000}s scores full marks), you have answered it at least ${CONFIDENCE_SAMPLE} times, and you have practised it recently.`,
  `Mastery fades if you stop practising - a square left alone for about ${RETENTION_HALF_LIFE_DAYS} days drops to roughly half its score, which is why old ground comes back around.`,
  'Because sample size is part of the score, one lucky fast answer can never mark a square mastered.',
].join(' ');
