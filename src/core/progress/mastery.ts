/**
 * The mastery model.
 *
 * ## Why this was rebuilt
 *
 * The first version reported ~29 mastered squares after very little practice.
 * Full confidence arrived after six attempts, a score of 0.9 counted as
 * mastered, and every appearance of a square counted the same — so a handful
 * of fast taps in one sitting was enough. It also read only `primarySquare`,
 * which for a notation question is the *destination*, so "which knight moves
 * there" contributed nothing at all.
 *
 * Mastery now means durable, cross-context knowledge:
 *
 *   score = skill x confidence x spacing x breadth x retention
 *
 *   skill        recent accuracy and speed
 *   confidence   grows with sample size — a dozen exposures, not six
 *   spacing      requires several distinct sessions and separate days
 *   breadth      requires the square in more than one kind of exercise
 *   retention    decays as the square goes unpracticed
 *
 * Every factor is 0..1 and they multiply, so a square cannot be mastered by
 * being strong in one dimension alone. Cramming in a single sitting caps the
 * spacing factor; being fast at tapping coordinates caps the breadth factor.
 */

import { ALL_SQUARES } from '../chess/square';
import type { SquareName } from '../chess/types';
import { localDateKey, type StoredAttempt } from '../storage/types';
import { MAX_WEIGHT } from '../training/pool';

/**
 * Exposures before confidence reaches its maximum.
 * Doubled from 6: six answers in one sitting is not evidence of knowing a
 * square, and six was the single biggest cause of inflated mastery.
 */
export const CONFIDENCE_SAMPLE = 12;

/** Distinct sessions before the spacing factor is satisfied. */
export const REQUIRED_SESSIONS = 3;

/** Distinct calendar days before the spacing factor is satisfied. */
export const REQUIRED_DAYS = 2;

/** Distinct skill dimensions before the breadth factor is satisfied. */
export const REQUIRED_DIMENSIONS = 2;

/** Response time treated as fully fast, and the point where speed scores zero. */
export const FAST_MS = 2000;
export const SLOW_MS = 9000;

/** Days of no practice after which retention has decayed to about a half. */
export const RETENTION_HALF_LIFE_DAYS = 21;

/** Weight of the most recent attempt in the accuracy average. */
export const RECENCY_ALPHA = 0.35;

/**
 * The kinds of knowledge Bight trains.
 *
 * These are genuinely different skills: someone can tap e4 instantly and still
 * hesitate over which knight the notation Nbd2 means.
 */
export type SkillDimension =
  /** See a coordinate, tap the square. */
  | 'recognition'
  /** See a square, name the coordinate. */
  | 'recall'
  /** Read notation, pick the right piece and the right destination. */
  | 'notation'
  /** See what a piece attacks: knight vision, forks, blockers. */
  | 'vision';

export const SKILL_LABELS: Record<SkillDimension, string> = {
  recognition: 'Find the square',
  recall: 'Name the square',
  notation: 'Notation',
  vision: 'Piece vision',
};

/**
 * Which skill an attempt exercised, derived from its mode.
 *
 * Derived rather than stored so historical attempts — which predate this
 * model entirely — still classify correctly without a data migration.
 */
export function skillOf(modeId: string): SkillDimension {
  switch (modeId) {
    case 'coordinate-to-square':
    case 'memory-coordinate-to-square':
      return 'recognition';
    case 'square-to-coordinate':
    case 'memory-square-to-coordinate':
    case 'square-color':
    case 'alignment':
    case 'sequence':
      return 'recall';
    case 'notation':
    case 'piece-movement':
      return 'notation';
    default:
      return 'vision';
  }
}

export type MasteryLevel = 'unseen' | 'learning' | 'familiar' | 'strong' | 'mastered';

export interface SkillStat {
  attempts: number;
  correct: number;
  accuracy: number;
}

export interface SquareMastery {
  square: SquareName;
  attempts: number;
  correct: number;
  accuracy: number;
  recentAccuracy: number;
  averageMs: number;
  fastestMs: number | null;
  lastSeenAt: number | null;
  /** Distinct sessions this square appeared in. */
  sessions: number;
  /** Distinct calendar days this square was practiced on. */
  days: number;
  /** Per-skill breakdown, so the UI can say *what* is weak. */
  skills: Partial<Record<SkillDimension, SkillStat>>;
  /** Board orientations the square has been answered from. */
  orientations: number;
  /** 0 to 1. */
  score: number;
  level: MasteryLevel;
  weight: number;
  /** Which requirement is currently holding the square back. */
  limitedBy: 'evidence' | 'spacing' | 'breadth' | 'accuracy' | 'recency' | null;
}

export interface MasteryOptions {
  now?: number;
}

function speedScore(averageMs: number): number {
  if (!Number.isFinite(averageMs) || averageMs <= 0) return 0;
  if (averageMs <= FAST_MS) return 1;
  if (averageMs >= SLOW_MS) return 0;
  return (SLOW_MS - averageMs) / (SLOW_MS - FAST_MS);
}

function confidenceFactor(attempts: number): number {
  return Math.min(1, attempts / CONFIDENCE_SAMPLE);
}

/** Half from distinct sessions, half from distinct days. */
function spacingFactor(sessions: number, days: number): number {
  return (
    0.5 * Math.min(1, sessions / REQUIRED_SESSIONS) + 0.5 * Math.min(1, days / REQUIRED_DAYS)
  );
}

function breadthFactor(dimensions: number): number {
  return Math.min(1, dimensions / REQUIRED_DIMENSIONS);
}

function retentionFactor(lastSeenAt: number | null, now: number): number {
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

function weightedAccuracy(results: readonly boolean[]): number {
  if (results.length === 0) return 0;
  let value = results[0] === true ? 1 : 0;
  for (let i = 1; i < results.length; i += 1) {
    value = value * (1 - RECENCY_ALPHA) + (results[i] === true ? 1 : 0) * RECENCY_ALPHA;
  }
  return value;
}

export function practiceWeight(score: number, attempts: number): number {
  if (attempts === 0) return 3;
  const raw = 1 + (1 - score) * (MAX_WEIGHT - 1);
  return Math.min(MAX_WEIGHT, Math.max(1, Number(raw.toFixed(3))));
}

interface Accumulator {
  results: boolean[];
  totalMs: number;
  timedCount: number;
  fastestMs: number | null;
  lastSeenAt: number | null;
  sessions: Set<string>;
  days: Set<string>;
  orientations: Set<string>;
  skills: Map<SkillDimension, { attempts: number; correct: number }>;
}

function emptyAccumulator(): Accumulator {
  return {
    results: [],
    totalMs: 0,
    timedCount: 0,
    fastestMs: null,
    lastSeenAt: null,
    sessions: new Set(),
    days: new Set(),
    orientations: new Set(),
    skills: new Map(),
  };
}

/**
 * Per-square mastery from the attempt history.
 *
 * A notation attempt contributes to *two* squares: the origin (did you pick
 * the right piece?) and the destination (did you know where it goes?). They
 * are credited independently, so choosing the wrong knight but the right
 * square penalises origin knowledge without punishing destination knowledge.
 */
export function computeMastery(
  attempts: readonly StoredAttempt[],
  options: MasteryOptions = {},
): Map<SquareName, SquareMastery> {
  const now = options.now ?? Date.now();
  const bySquare = new Map<SquareName, Accumulator>();

  const ensure = (square: SquareName): Accumulator => {
    let entry = bySquare.get(square);
    if (entry === undefined) {
      entry = emptyAccumulator();
      bySquare.set(square, entry);
    }
    return entry;
  };

  const record = (
    square: SquareName,
    attempt: StoredAttempt,
    correct: boolean,
    timed: boolean,
  ): void => {
    const entry = ensure(square);
    const skill = skillOf(attempt.modeId);

    entry.results.push(correct);
    entry.lastSeenAt = attempt.timestamp;
    entry.sessions.add(attempt.sessionId ?? 'unknown');
    entry.days.add(localDateKey(attempt.timestamp));
    entry.orientations.add(attempt.orientation);

    const stat = entry.skills.get(skill) ?? { attempts: 0, correct: 0 };
    stat.attempts += 1;
    if (correct) stat.correct += 1;
    entry.skills.set(skill, stat);

    if (timed) {
      entry.totalMs += attempt.responseMs;
      entry.timedCount += 1;
      if (correct) {
        entry.fastestMs =
          entry.fastestMs === null ? attempt.responseMs : Math.min(entry.fastestMs, attempt.responseMs);
      }
    }
  };

  // Oldest first so the weighted accuracy walks forward in time.
  const ordered = [...attempts].sort((a, b) => a.timestamp - b.timestamp);

  for (const attempt of ordered) {
    const origin = attempt.originSquare ?? null;
    const hasSplit = origin !== null && attempt.originCorrect !== undefined;

    if (hasSplit) {
      // Notation: credit origin and destination on their own merits.
      record(origin, attempt, attempt.originCorrect === true, true);
      if (attempt.primarySquare !== null) {
        record(attempt.primarySquare, attempt, attempt.destinationCorrect === true, true);
      }
    } else if (attempt.primarySquare !== null) {
      record(attempt.primarySquare, attempt, attempt.correct, true);
    }

    // Squares the user actually missed count against them individually.
    for (const square of attempt.missed) record(square, attempt, false, false);
    for (const square of attempt.extra) record(square, attempt, false, false);
  }

  const out = new Map<SquareName, SquareMastery>();

  for (const [square, entry] of bySquare) {
    const attemptCount = entry.results.length;
    const correct = entry.results.filter(Boolean).length;
    const accuracy = attemptCount === 0 ? 0 : correct / attemptCount;
    const recentAccuracy = weightedAccuracy(entry.results);
    const averageMs = entry.timedCount === 0 ? 0 : entry.totalMs / entry.timedCount;

    const skill = 0.75 * recentAccuracy + 0.25 * speedScore(averageMs);
    const confidence = confidenceFactor(attemptCount);
    const spacing = spacingFactor(entry.sessions.size, entry.days.size);
    const breadth = breadthFactor(entry.skills.size);
    const retention = retentionFactor(entry.lastSeenAt, now);

    const score = Number((skill * confidence * spacing * breadth * retention).toFixed(4));

    const skills: Partial<Record<SkillDimension, SkillStat>> = {};
    for (const [dimension, stat] of entry.skills) {
      skills[dimension] = {
        attempts: stat.attempts,
        correct: stat.correct,
        accuracy: stat.attempts === 0 ? 0 : stat.correct / stat.attempts,
      };
    }

    out.set(square, {
      square,
      attempts: attemptCount,
      correct,
      accuracy,
      recentAccuracy,
      averageMs: Math.round(averageMs),
      fastestMs: entry.fastestMs,
      lastSeenAt: entry.lastSeenAt,
      sessions: entry.sessions.size,
      days: entry.days.size,
      skills,
      orientations: entry.orientations.size,
      score,
      level: masteryLevel(score, attemptCount),
      weight: practiceWeight(score, attemptCount),
      limitedBy: limitingFactor({ confidence, spacing, breadth, skill, retention }),
    });
  }

  return out;
}

/** Which factor is furthest from 1, so the UI can say what to do next. */
function limitingFactor(factors: {
  confidence: number;
  spacing: number;
  breadth: number;
  skill: number;
  retention: number;
}): SquareMastery['limitedBy'] {
  const entries: Array<[SquareMastery['limitedBy'], number]> = [
    ['evidence', factors.confidence],
    ['spacing', factors.spacing],
    ['breadth', factors.breadth],
    ['accuracy', factors.skill],
    ['recency', factors.retention],
  ];
  const worst = entries.reduce((a, b) => (b[1] < a[1] ? b : a));
  return worst[1] >= 0.95 ? null : worst[0];
}

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
      sessions: 0,
      days: 0,
      skills: {},
      orientations: 0,
      score: 0,
      level: 'unseen',
      weight: practiceWeight(0, 0),
      limitedBy: 'evidence',
    });
  }
  return computed;
}

export function practiceWeights(
  attempts: readonly StoredAttempt[],
  options: MasteryOptions = {},
): Map<SquareName, number> {
  const mastery = fullBoardMastery(attempts, options);
  const weights = new Map<SquareName, number>();
  for (const [square, entry] of mastery) weights.set(square, entry.weight);
  return weights;
}

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

export function slowButCorrect(
  attempts: readonly StoredAttempt[],
  options: MasteryOptions = {},
): SquareMastery[] {
  return [...computeMastery(attempts, options).values()]
    .filter((entry) => entry.attempts >= 2 && entry.recentAccuracy >= 0.8 && entry.averageMs > FAST_MS)
    .sort((a, b) => b.averageMs - a.averageMs);
}

export interface MasteryOverview {
  mastered: number;
  strong: number;
  familiar: number;
  learning: number;
  unseen: number;
  averageScore: number;
  /** Per-skill accuracy across the whole board. */
  bySkill: Partial<Record<SkillDimension, SkillStat>>;
}

export function masteryOverview(
  attempts: readonly StoredAttempt[],
  options: MasteryOptions = {},
): MasteryOverview {
  const all = [...fullBoardMastery(attempts, options).values()];
  const count = (level: MasteryLevel): number => all.filter((m) => m.level === level).length;

  const bySkill: Partial<Record<SkillDimension, SkillStat>> = {};
  for (const entry of all) {
    for (const [dimension, stat] of Object.entries(entry.skills) as Array<[SkillDimension, SkillStat]>) {
      const current = bySkill[dimension] ?? { attempts: 0, correct: 0, accuracy: 0 };
      current.attempts += stat.attempts;
      current.correct += stat.correct;
      current.accuracy = current.attempts === 0 ? 0 : current.correct / current.attempts;
      bySkill[dimension] = current;
    }
  }

  return {
    mastered: count('mastered'),
    strong: count('strong'),
    familiar: count('familiar'),
    learning: count('learning'),
    unseen: count('unseen'),
    averageScore:
      all.length === 0 ? 0 : Number((all.reduce((sum, m) => sum + m.score, 0) / all.length).toFixed(4)),
    bySkill,
  };
}

/** Plain-language explanation shown next to the mastery figures. */
export const MASTERY_EXPLANATION = [
  'A square counts as mastered only when all of these are true at once:',
  `you have answered it about ${CONFIDENCE_SAMPLE} times;`,
  `across at least ${REQUIRED_SESSIONS} separate sessions and ${REQUIRED_DAYS} different days;`,
  `in at least ${REQUIRED_DIMENSIONS} different kinds of exercise — tapping a coordinate is not the same skill as knowing which knight the notation means;`,
  'with high recent accuracy and quick answers;',
  'and recently enough that you have not forgotten it.',
  `Mastery fades: a square left alone for about ${RETENTION_HALF_LIFE_DAYS} days drops to roughly half its score, which is why old ground comes back around.`,
  'Because all of these multiply together, a burst of fast taps in one sitting can never be enough on its own.',
].join(' ');
