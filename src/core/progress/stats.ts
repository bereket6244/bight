/**
 * Progress statistics derived from stored attempts.
 *
 * Everything is computed on demand from the attempt log rather than kept as
 * running totals, so an imported backup produces identical figures to the
 * device that exported it.
 */

import { FILE_LETTERS } from '../chess/types';
import { fileOf, rankOf } from '../chess/square';
import type { SquareName } from '../chess/types';
import { localDateKey, type StoredAttempt, type StoredSession } from '../storage/types';

export interface Tally {
  attempts: number;
  correct: number;
  accuracy: number;
  averageMs: number;
}

function tally(attempts: readonly StoredAttempt[]): Tally {
  const count = attempts.length;
  if (count === 0) return { attempts: 0, correct: 0, accuracy: 0, averageMs: 0 };
  const correct = attempts.filter((a) => a.correct).length;
  const totalMs = attempts.reduce((sum, a) => sum + a.responseMs, 0);
  return {
    attempts: count,
    correct,
    accuracy: correct / count,
    averageMs: Math.round(totalMs / count),
  };
}

function groupBy<K>(
  attempts: readonly StoredAttempt[],
  keyOf: (attempt: StoredAttempt) => K | null,
): Map<K, StoredAttempt[]> {
  const out = new Map<K, StoredAttempt[]>();
  for (const attempt of attempts) {
    const key = keyOf(attempt);
    if (key === null) continue;
    const list = out.get(key) ?? [];
    list.push(attempt);
    out.set(key, list);
  }
  return out;
}

function tallyMap<K>(grouped: Map<K, StoredAttempt[]>): Map<K, Tally> {
  const out = new Map<K, Tally>();
  for (const [key, list] of grouped) out.set(key, tally(list));
  return out;
}

export function overallStats(attempts: readonly StoredAttempt[]): Tally {
  return tally(attempts);
}

export function statsByMode(attempts: readonly StoredAttempt[]): Map<string, Tally> {
  return tallyMap(groupBy(attempts, (a) => a.modeId));
}

export function statsByVariant(attempts: readonly StoredAttempt[]): Map<string, Tally> {
  return tallyMap(groupBy(attempts, (a) => `${a.modeId}:${a.variantId}`));
}

export function statsBySquare(attempts: readonly StoredAttempt[]): Map<SquareName, Tally> {
  return tallyMap(groupBy(attempts, (a) => a.primarySquare));
}

export function statsByFile(attempts: readonly StoredAttempt[]): Map<string, Tally> {
  return tallyMap(
    groupBy(attempts, (a) => (a.primarySquare === null ? null : FILE_LETTERS[fileOf(a.primarySquare)])),
  );
}

export function statsByRank(attempts: readonly StoredAttempt[]): Map<number, Tally> {
  return tallyMap(
    groupBy(attempts, (a) => (a.primarySquare === null ? null : rankOf(a.primarySquare) + 1)),
  );
}

export function statsByOrientation(attempts: readonly StoredAttempt[]): Map<string, Tally> {
  return tallyMap(groupBy(attempts, (a) => a.orientation));
}

export function statsByDay(attempts: readonly StoredAttempt[]): Map<string, Tally> {
  return tallyMap(groupBy(attempts, (a) => localDateKey(a.timestamp)));
}

/** Response-time percentiles over correct answers. */
export interface TimingStats {
  averageMs: number;
  medianMs: number;
  fastestCorrectMs: number | null;
  slowestCorrectMs: number | null;
}

export function timingStats(attempts: readonly StoredAttempt[]): TimingStats {
  const all = attempts.map((a) => a.responseMs).sort((a, b) => a - b);
  const correct = attempts.filter((a) => a.correct).map((a) => a.responseMs).sort((a, b) => a - b);

  const median =
    all.length === 0
      ? 0
      : all.length % 2 === 1
        ? (all[(all.length - 1) / 2] as number)
        : ((all[all.length / 2 - 1] as number) + (all[all.length / 2] as number)) / 2;

  return {
    averageMs: all.length === 0 ? 0 : Math.round(all.reduce((s, t) => s + t, 0) / all.length),
    medianMs: Math.round(median),
    fastestCorrectMs: correct.length === 0 ? null : (correct[0] as number),
    slowestCorrectMs: correct.length === 0 ? null : (correct[correct.length - 1] as number),
  };
}

/** Longest run of correct answers anywhere in the history. */
export function bestStreak(attempts: readonly StoredAttempt[]): number {
  const ordered = [...attempts].sort((a, b) => a.timestamp - b.timestamp);
  let best = 0;
  let run = 0;
  for (const attempt of ordered) {
    run = attempt.correct ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * Squares most often missed as *targets* in multi-square questions.
 * This is what surfaces "frequently missed knight targets".
 */
export function mostMissedTargets(
  attempts: readonly StoredAttempt[],
  limit = 10,
): Array<{ square: SquareName; misses: number }> {
  const counts = new Map<SquareName, number>();
  for (const attempt of attempts) {
    for (const square of attempt.missed) {
      counts.set(square, (counts.get(square) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([square, misses]) => ({ square, misses }))
    .sort((a, b) => b.misses - a.misses)
    .slice(0, limit);
}

/** Squares most often selected wrongly - the false positives. */
export function mostWronglySelected(
  attempts: readonly StoredAttempt[],
  limit = 10,
): Array<{ square: SquareName; times: number }> {
  const counts = new Map<SquareName, number>();
  for (const attempt of attempts) {
    for (const square of attempt.extra) {
      counts.set(square, (counts.get(square) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([square, times]) => ({ square, times }))
    .sort((a, b) => b.times - a.times)
    .slice(0, limit);
}

/** Daily accuracy and volume over a window, oldest first. */
export interface TrendPoint {
  date: string;
  attempts: number;
  accuracy: number;
  averageMs: number;
}

export function accuracyTrend(
  attempts: readonly StoredAttempt[],
  days = 30,
  now: number = Date.now(),
): TrendPoint[] {
  const byDay = statsByDay(attempts);
  const out: TrendPoint[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = localDateKey(now - offset * 86_400_000);
    const stats = byDay.get(date);
    out.push({
      date,
      attempts: stats?.attempts ?? 0,
      accuracy: stats?.accuracy ?? 0,
      averageMs: stats?.averageMs ?? 0,
    });
  }
  return out;
}

/**
 * Whether performance is improving, by comparing the recent half of the
 * history against the earlier half. Null when there is too little data.
 */
export interface Improvement {
  accuracyDelta: number;
  speedDeltaMs: number;
  sampleSize: number;
}

export function improvement(attempts: readonly StoredAttempt[]): Improvement | null {
  if (attempts.length < 20) return null;
  const ordered = [...attempts].sort((a, b) => a.timestamp - b.timestamp);
  const midpoint = Math.floor(ordered.length / 2);
  const earlier = tally(ordered.slice(0, midpoint));
  const recent = tally(ordered.slice(midpoint));
  return {
    accuracyDelta: Number((recent.accuracy - earlier.accuracy).toFixed(4)),
    // Negative means faster, which is an improvement.
    speedDeltaMs: recent.averageMs - earlier.averageMs,
    sampleSize: ordered.length,
  };
}

/** Personal-best keys, kept in one place so writers and readers agree. */
export const PERSONAL_BEST_KEYS = {
  sessionAccuracy: (modeId: string) => `${modeId}:best-accuracy`,
  sessionStreak: (modeId: string) => `${modeId}:best-streak`,
  fastestCorrect: (modeId: string) => `${modeId}:fastest-correct`,
} as const;

/** Per-mode personal bests derived from session history. */
export function personalBestsFromSessions(
  sessions: readonly StoredSession[],
): Array<{ key: string; value: number; achievedAt: number }> {
  const out = new Map<string, { key: string; value: number; achievedAt: number }>();

  const consider = (key: string, value: number, achievedAt: number, lowerIsBetter: boolean): void => {
    if (!Number.isFinite(value)) return;
    const existing = out.get(key);
    if (
      existing === undefined ||
      (lowerIsBetter ? value < existing.value : value > existing.value)
    ) {
      out.set(key, { key, value, achievedAt });
    }
  };

  for (const session of sessions) {
    if (session.total === 0) continue;
    consider(PERSONAL_BEST_KEYS.sessionAccuracy(session.modeId), session.accuracy, session.startedAt, false);
    consider(PERSONAL_BEST_KEYS.sessionStreak(session.modeId), session.bestStreak, session.startedAt, false);
    if (session.fastestCorrectMs !== null) {
      consider(
        PERSONAL_BEST_KEYS.fastestCorrect(session.modeId),
        session.fastestCorrectMs,
        session.startedAt,
        true,
      );
    }
  }

  return [...out.values()];
}
