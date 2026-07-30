/**
 * Streaks, daily goals and achievements.
 *
 * The streak rule, stated once here and repeated in the README:
 * a day counts toward your streak when you finish at least one session of
 * MIN_STREAK_QUESTIONS scored questions. Opening the app does not count, and
 * neither does answering one question and leaving - the streak is meant to
 * track practice, not visits.
 *
 * There are no guilt messages, no streak-freeze purchases and no notifications
 * pressuring a return. A broken streak simply starts again at one.
 */

import { daysBetween, localDateKey, type DailyRecord, type StoredSession } from '../storage/types';

/** Scored questions in a single session before the day counts. */
export const MIN_STREAK_QUESTIONS = 10;

export interface StreakSummary {
  current: number;
  longest: number;
  /** The most recent day that counted, or null if none ever did. */
  lastCountedDate: string | null;
  /** True when today already counts. */
  todayCounted: boolean;
  /** True when the streak survives only if the user practises today. */
  atRisk: boolean;
}

/** Whether one session is substantial enough to count toward the streak. */
export function sessionCountsForStreak(session: {
  total: number;
  endedEarly: boolean;
}): boolean {
  // Ending early is fine as long as enough questions were actually answered.
  return session.total >= MIN_STREAK_QUESTIONS;
}

/**
 * Rebuilds daily records from session history.
 * Derived rather than incrementally maintained, so an imported backup produces
 * exactly the same streak as the device that created it.
 */
export function buildDailyRecords(sessions: readonly StoredSession[]): DailyRecord[] {
  const byDate = new Map<string, DailyRecord>();

  for (const session of sessions) {
    const date = localDateKey(session.startedAt);
    const existing = byDate.get(date) ?? {
      date,
      sessions: 0,
      questions: 0,
      correct: 0,
      counted: false,
    };
    existing.sessions += 1;
    existing.questions += session.total;
    existing.correct += session.correct;
    existing.counted = existing.counted || sessionCountsForStreak(session);
    byDate.set(date, existing);
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Current and longest streak from daily records.
 *
 * A streak is unbroken while consecutive counted days are one day apart.
 * Today not yet being practised does not break the streak - yesterday still
 * counts until the day ends.
 */
export function computeStreak(daily: readonly DailyRecord[], now: number = Date.now()): StreakSummary {
  const counted = daily
    .filter((day) => day.counted)
    .map((day) => day.date)
    .sort();

  if (counted.length === 0) {
    return { current: 0, longest: 0, lastCountedDate: null, todayCounted: false, atRisk: false };
  }

  let longest = 1;
  let run = 1;
  for (let i = 1; i < counted.length; i += 1) {
    const gap = daysBetween(counted[i - 1] as string, counted[i] as string);
    run = gap === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  const today = localDateKey(now);
  const last = counted[counted.length - 1] as string;
  const gapToToday = daysBetween(last, today);

  // The run ending on the last counted day is the current streak, but only if
  // that day was today or yesterday.
  let current = 0;
  if (gapToToday <= 1) {
    current = 1;
    for (let i = counted.length - 1; i > 0; i -= 1) {
      if (daysBetween(counted[i - 1] as string, counted[i] as string) === 1) current += 1;
      else break;
    }
  }

  return {
    current,
    longest: Math.max(longest, current),
    lastCountedDate: last,
    todayCounted: gapToToday === 0,
    atRisk: gapToToday === 1,
  };
}

/** Questions answered today, against the user's daily goal. */
export interface DailyGoalProgress {
  goal: number;
  done: number;
  met: boolean;
}

export function dailyGoalProgress(
  daily: readonly DailyRecord[],
  goal: number,
  now: number = Date.now(),
): DailyGoalProgress {
  const today = daily.find((day) => day.date === localDateKey(now));
  const done = today?.questions ?? 0;
  return { goal, done, met: done >= goal };
}

/** Rolling seven-day activity, oldest first, including days with no practice. */
export function rollingWeek(
  daily: readonly DailyRecord[],
  now: number = Date.now(),
): DailyRecord[] {
  const byDate = new Map(daily.map((day) => [day.date, day]));
  const out: DailyRecord[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = localDateKey(now - offset * 86_400_000);
    out.push(
      byDate.get(date) ?? { date, sessions: 0, questions: 0, correct: 0, counted: false },
    );
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Achievements - a small, meaningful set. No paid unlocks, no grinding.
 * ------------------------------------------------------------------ */

export interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
  /** Returns progress from 0 to 1. At 1 the achievement unlocks. */
  progress: (context: AchievementContext) => number;
}

export interface AchievementContext {
  totalQuestions: number;
  totalCorrect: number;
  sessions: readonly StoredSession[];
  streak: StreakSummary;
  masteredSquares: number;
  bestSessionAccuracy: number;
  bestStreakInSession: number;
  fastestCorrectMs: number | null;
  modesPractised: ReadonlySet<string>;
  totalModes: number;
}

export const ACHIEVEMENTS: readonly AchievementDefinition[] = Object.freeze([
  {
    id: 'first-session',
    title: 'First light',
    description: 'Finish your first session.',
    progress: (c) => Math.min(1, c.sessions.length),
  },
  {
    id: 'hundred-questions',
    title: 'Getting your eye in',
    description: 'Answer 100 questions.',
    progress: (c) => Math.min(1, c.totalQuestions / 100),
  },
  {
    id: 'thousand-questions',
    title: 'Board sight',
    description: 'Answer 1,000 questions.',
    progress: (c) => Math.min(1, c.totalQuestions / 1000),
  },
  {
    id: 'week-streak',
    title: 'Seven days',
    description: 'Practise seven days in a row.',
    progress: (c) => Math.min(1, c.streak.longest / 7),
  },
  {
    id: 'month-streak',
    title: 'Thirty days',
    description: 'Practise thirty days in a row.',
    progress: (c) => Math.min(1, c.streak.longest / 30),
  },
  {
    id: 'flawless',
    title: 'Flawless',
    description: 'Finish a session of at least 20 questions with no mistakes.',
    progress: (c) =>
      c.sessions.some((s) => s.total >= 20 && s.correct === s.total) ? 1 : 0,
  },
  {
    id: 'quarter-board',
    title: 'Quarter board',
    description: 'Master 16 squares.',
    progress: (c) => Math.min(1, c.masteredSquares / 16),
  },
  {
    id: 'whole-board',
    title: 'Whole board',
    description: 'Master all 64 squares.',
    progress: (c) => Math.min(1, c.masteredSquares / 64),
  },
  {
    id: 'quick-eye',
    title: 'Quick eye',
    description: 'Answer correctly in under one second.',
    progress: (c) => (c.fastestCorrectMs !== null && c.fastestCorrectMs < 1000 ? 1 : 0),
  },
  {
    id: 'all-modes',
    title: 'Full tour',
    description: 'Practise every mode at least once.',
    progress: (c) => (c.totalModes === 0 ? 0 : Math.min(1, c.modesPractised.size / c.totalModes)),
  },
  {
    id: 'long-streak-in-session',
    title: 'On a run',
    description: 'Get 25 right in a row within one session.',
    progress: (c) => Math.min(1, c.bestStreakInSession / 25),
  },
]);

export interface AchievementStatus {
  definition: AchievementDefinition;
  progress: number;
  unlocked: boolean;
}

export function evaluateAchievements(context: AchievementContext): AchievementStatus[] {
  return ACHIEVEMENTS.map((definition) => {
    const progress = Math.max(0, Math.min(1, definition.progress(context)));
    return { definition, progress, unlocked: progress >= 1 };
  });
}
