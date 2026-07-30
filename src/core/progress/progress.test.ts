import { describe, expect, it } from 'vitest';
import {
  computeMastery,
  fullBoardMastery,
  masteryOverview,
  practiceWeight,
  practiceWeights,
  slowButCorrect,
  weakestSquares,
  CONFIDENCE_SAMPLE,
  FAST_MS,
  RETENTION_HALF_LIFE_DAYS,
} from './mastery';
import {
  buildDailyRecords,
  computeStreak,
  dailyGoalProgress,
  evaluateAchievements,
  rollingWeek,
  sessionCountsForStreak,
  ACHIEVEMENTS,
  MIN_STREAK_QUESTIONS,
} from './streak';
import {
  accuracyTrend,
  bestStreak,
  improvement,
  mostMissedTargets,
  mostWronglySelected,
  overallStats,
  personalBestsFromSessions,
  statsByFile,
  statsByMode,
  statsByOrientation,
  statsByRank,
  statsBySquare,
  timingStats,
} from './stats';
import { MAX_WEIGHT } from '../training/pool';
import { defaultSettings } from '../session/settings';
import type { StoredAttempt, StoredSession } from '../storage/types';
import type { SquareName } from '../chess/types';

const T0 = new Date(2026, 6, 30, 12, 0, 0).getTime();
const DAY = 86_400_000;

function att(overrides: Partial<StoredAttempt> = {}): StoredAttempt {
  return {
    id: 1,
    sessionId: 's1',
    schemaVersion: 1,
    appVersion: '1.0.0',
    questionId: 'q1',
    modeId: 'square-color',
    variantId: 'coordinate',
    prompt: 'p',
    expected: 'e',
    answer: 'a',
    correct: true,
    responseMs: 1500,
    source: 'touch',
    orientation: 'white',
    labels: 'always',
    layout: 'empty',
    filters: 'none',
    timer: 'none',
    focusSquares: ['e4'],
    primarySquare: 'e4',
    missed: [],
    extra: [],
    timestamp: T0,
    isRetry: false,
    ...overrides,
  };
}

function ses(overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    id: 's1',
    modeId: 'square-color',
    variantId: 'coordinate',
    startedAt: T0,
    endedAt: T0 + 60_000,
    total: 20,
    correct: 18,
    accuracy: 0.9,
    averageMs: 1500,
    medianMs: 1400,
    fastestCorrectMs: 800,
    bestStreak: 9,
    durationMs: 60_000,
    endedEarly: false,
    settings: defaultSettings('square-color', 'coordinate'),
    schemaVersion: 1,
    appVersion: '1.0.0',
    ...overrides,
  };
}

/** n attempts on one square, all correct, fast and recent. */
function goodRun(square: SquareName, count: number, at = T0): StoredAttempt[] {
  return Array.from({ length: count }, (_, i) =>
    att({ primarySquare: square, focusSquares: [square], correct: true, responseMs: 900, timestamp: at + i }),
  );
}

describe('mastery scoring', () => {
  it('gives an unseen square a zero score and the unseen level', () => {
    const mastery = fullBoardMastery([], { now: T0 });
    const entry = mastery.get('a1');
    expect(entry?.attempts).toBe(0);
    expect(entry?.score).toBe(0);
    expect(entry?.level).toBe('unseen');
  });

  it('never marks a square mastered on one lucky fast answer', () => {
    const mastery = computeMastery(goodRun('e4', 1), { now: T0 });
    const entry = mastery.get('e4');
    expect(entry?.attempts).toBe(1);
    expect(entry?.level).not.toBe('mastered');
    // Confidence caps the score at 1/CONFIDENCE_SAMPLE of its potential.
    expect(entry?.score).toBeLessThanOrEqual(1 / CONFIDENCE_SAMPLE + 0.001);
  });

  it('reaches mastery only after sustained correct, fast practice', () => {
    const entry = computeMastery(goodRun('e4', CONFIDENCE_SAMPLE * 2), { now: T0 }).get('e4');
    expect(entry?.level).toBe('mastered');
    expect(entry?.score).toBeGreaterThanOrEqual(0.9);
  });

  it('scores a slow but correct square below a fast one', () => {
    const fast = computeMastery(
      goodRun('e4', 10).map((a) => ({ ...a, responseMs: 900 })),
      { now: T0 },
    ).get('e4');
    const slow = computeMastery(
      goodRun('d5', 10).map((a) => ({ ...a, primarySquare: 'd5', responseMs: 7000 })),
      { now: T0 },
    ).get('d5');

    expect(slow?.score).toBeLessThan(fast?.score as number);
    expect(slow?.recentAccuracy).toBeCloseTo(fast?.recentAccuracy as number, 5);
  });

  it('decays a score that has not been practiced recently', () => {
    const attempts = goodRun('e4', 10);
    const fresh = computeMastery(attempts, { now: T0 }).get('e4');
    const stale = computeMastery(attempts, { now: T0 + RETENTION_HALF_LIFE_DAYS * DAY }).get('e4');

    expect(stale?.score).toBeLessThan(fresh?.score as number);
    // One half-life should halve it, within rounding.
    expect(stale?.score).toBeCloseTo((fresh?.score as number) / 2, 2);
  });

  it('weights recent answers more heavily than old ones', () => {
    const improving = [
      ...Array.from({ length: 5 }, (_, i) => att({ correct: false, timestamp: T0 + i })),
      ...Array.from({ length: 5 }, (_, i) => att({ correct: true, timestamp: T0 + 100 + i })),
    ];
    const declining = [
      ...Array.from({ length: 5 }, (_, i) => att({ correct: true, timestamp: T0 + i })),
      ...Array.from({ length: 5 }, (_, i) => att({ correct: false, timestamp: T0 + 100 + i })),
    ];

    const up = computeMastery(improving, { now: T0 }).get('e4');
    const down = computeMastery(declining, { now: T0 }).get('e4');

    expect(up?.accuracy).toBeCloseTo(down?.accuracy as number, 5);
    expect(up?.recentAccuracy).toBeGreaterThan(down?.recentAccuracy as number);
  });

  it('counts missed squares from multi-square questions against them', () => {
    const attempts = [
      att({
        modeId: 'knight-vision',
        primarySquare: 'd4',
        correct: false,
        missed: ['b5', 'c6'],
        extra: ['a1'],
      }),
    ];
    const mastery = computeMastery(attempts, { now: T0 });
    expect(mastery.get('b5')?.attempts).toBe(1);
    expect(mastery.get('b5')?.correct).toBe(0);
    expect(mastery.get('c6')?.correct).toBe(0);
    expect(mastery.get('a1')?.correct).toBe(0);
  });
});

describe('practice weighting', () => {
  it('keeps every weight inside the documented bounds', () => {
    for (const score of [0, 0.25, 0.5, 0.75, 1]) {
      const weight = practiceWeight(score, 10);
      expect(weight).toBeGreaterThanOrEqual(1);
      expect(weight).toBeLessThanOrEqual(MAX_WEIGHT);
    }
    expect(practiceWeight(0, 0)).toBe(3);
  });

  it('weights a weak square above a mastered one', () => {
    const attempts = [
      ...goodRun('e4', 12),
      ...Array.from({ length: 12 }, (_, i) =>
        att({ primarySquare: 'h7', focusSquares: ['h7'], correct: false, timestamp: T0 + i }),
      ),
    ];
    const weights = practiceWeights(attempts, { now: T0 });
    expect(weights.get('h7') as number).toBeGreaterThan(weights.get('e4') as number);
  });

  it('never drops a mastered square out of rotation entirely', () => {
    const weights = practiceWeights(goodRun('e4', 30), { now: T0 });
    expect(weights.get('e4') as number).toBeGreaterThanOrEqual(1);
  });

  it('produces a weight for all 64 squares', () => {
    expect(practiceWeights([], { now: T0 }).size).toBe(64);
  });
});

describe('weak square selection', () => {
  it('puts never-seen squares first', () => {
    const weakest = weakestSquares(goodRun('e4', 10), 5, { now: T0 });
    expect(weakest.every((entry) => entry.attempts === 0)).toBe(true);
    expect(weakest.map((e) => e.square)).not.toContain('e4');
  });

  it('ranks a failing square below a passing one', () => {
    const attempts = [
      ...goodRun('e4', 8),
      ...Array.from({ length: 8 }, (_, i) =>
        att({ primarySquare: 'h7', focusSquares: ['h7'], correct: false, timestamp: T0 + i }),
      ),
    ];
    const seen = weakestSquares(attempts, 64, { now: T0 }).filter((e) => e.attempts > 0);
    expect(seen[0]?.square).toBe('h7');
  });

  it('identifies slow but correct squares', () => {
    const attempts = Array.from({ length: 6 }, (_, i) =>
      att({ primarySquare: 'g2', focusSquares: ['g2'], correct: true, responseMs: 6000, timestamp: T0 + i }),
    );
    const slow = slowButCorrect(attempts, { now: T0 });
    expect(slow[0]?.square).toBe('g2');
    expect(slow[0]?.averageMs).toBeGreaterThan(FAST_MS);
  });
});

describe('mastery overview', () => {
  it('accounts for all 64 squares', () => {
    const overview = masteryOverview(goodRun('e4', 12), { now: T0 });
    const total =
      overview.mastered + overview.strong + overview.familiar + overview.learning + overview.unseen;
    expect(total).toBe(64);
    expect(overview.mastered).toBe(1);
    expect(overview.unseen).toBe(63);
  });
});

describe('streaks', () => {
  it('requires a substantial session for a day to count', () => {
    expect(sessionCountsForStreak({ total: MIN_STREAK_QUESTIONS, endedEarly: false })).toBe(true);
    expect(sessionCountsForStreak({ total: MIN_STREAK_QUESTIONS - 1, endedEarly: false })).toBe(false);
    expect(sessionCountsForStreak({ total: 1, endedEarly: false })).toBe(false);
  });

  it('counts an early exit that still answered enough questions', () => {
    expect(sessionCountsForStreak({ total: 15, endedEarly: true })).toBe(true);
  });

  it('builds daily records from sessions', () => {
    const daily = buildDailyRecords([
      ses({ id: 'a', startedAt: T0, total: 20, correct: 18 }),
      ses({ id: 'b', startedAt: T0 + 3600_000, total: 5, correct: 5 }),
      ses({ id: 'c', startedAt: T0 - DAY, total: 12, correct: 10 }),
    ]);

    expect(daily).toHaveLength(2);
    const today = daily[1];
    expect(today?.sessions).toBe(2);
    expect(today?.questions).toBe(25);
    expect(today?.counted).toBe(true);
  });

  it('does not count a day of only short sessions', () => {
    const daily = buildDailyRecords([ses({ total: 3, correct: 3 })]);
    expect(daily[0]?.counted).toBe(false);
    expect(computeStreak(daily, T0).current).toBe(0);
  });

  it('counts consecutive days', () => {
    const daily = buildDailyRecords([
      ses({ id: 'a', startedAt: T0 - 2 * DAY }),
      ses({ id: 'b', startedAt: T0 - DAY }),
      ses({ id: 'c', startedAt: T0 }),
    ]);
    const streak = computeStreak(daily, T0);
    expect(streak.current).toBe(3);
    expect(streak.longest).toBe(3);
    expect(streak.todayCounted).toBe(true);
    expect(streak.atRisk).toBe(false);
  });

  it('breaks the streak when a day is skipped', () => {
    const daily = buildDailyRecords([
      ses({ id: 'a', startedAt: T0 - 5 * DAY }),
      ses({ id: 'b', startedAt: T0 - 4 * DAY }),
      ses({ id: 'c', startedAt: T0 }),
    ]);
    const streak = computeStreak(daily, T0);
    expect(streak.current).toBe(1);
    expect(streak.longest).toBe(2);
  });

  it('keeps yesterday\'s streak alive but flags it as at risk', () => {
    const daily = buildDailyRecords([
      ses({ id: 'a', startedAt: T0 - 2 * DAY }),
      ses({ id: 'b', startedAt: T0 - DAY }),
    ]);
    const streak = computeStreak(daily, T0);
    expect(streak.current).toBe(2);
    expect(streak.todayCounted).toBe(false);
    expect(streak.atRisk).toBe(true);
  });

  it('reports no streak when the last practice was long ago', () => {
    const daily = buildDailyRecords([ses({ startedAt: T0 - 10 * DAY })]);
    const streak = computeStreak(daily, T0);
    expect(streak.current).toBe(0);
    expect(streak.longest).toBe(1);
  });

  it('handles an empty history', () => {
    const streak = computeStreak([], T0);
    expect(streak).toEqual({
      current: 0,
      longest: 0,
      lastCountedDate: null,
      todayCounted: false,
      atRisk: false,
    });
  });

  it('crosses a month boundary correctly', () => {
    const aug1 = new Date(2026, 7, 1, 12).getTime();
    const daily = buildDailyRecords([
      ses({ id: 'a', startedAt: aug1 - DAY }),
      ses({ id: 'b', startedAt: aug1 }),
    ]);
    expect(computeStreak(daily, aug1).current).toBe(2);
  });
});

describe('daily goal and rolling week', () => {
  it('tracks progress toward the daily goal', () => {
    const daily = buildDailyRecords([ses({ total: 25 })]);
    expect(dailyGoalProgress(daily, 40, T0)).toEqual({ goal: 40, done: 25, met: false });
    expect(dailyGoalProgress(daily, 20, T0)).toEqual({ goal: 20, done: 25, met: true });
  });

  it('returns seven days including empty ones', () => {
    const week = rollingWeek(buildDailyRecords([ses({ startedAt: T0 })]), T0);
    expect(week).toHaveLength(7);
    expect(week[6]?.questions).toBe(20);
    expect(week[0]?.questions).toBe(0);
  });
});

describe('achievements', () => {
  const base = {
    totalQuestions: 0,
    totalCorrect: 0,
    sessions: [] as StoredSession[],
    streak: { current: 0, longest: 0, lastCountedDate: null, todayCounted: false, atRisk: false },
    masteredSquares: 0,
    bestSessionAccuracy: 0,
    bestStreakInSession: 0,
    fastestCorrectMs: null,
    modesPracticed: new Set<string>(),
    totalModes: 11,
  };

  it('starts with nothing unlocked', () => {
    const statuses = evaluateAchievements(base);
    expect(statuses).toHaveLength(ACHIEVEMENTS.length);
    expect(statuses.every((s) => !s.unlocked)).toBe(true);
  });

  it('unlocks the first session', () => {
    const statuses = evaluateAchievements({ ...base, sessions: [ses()] });
    expect(statuses.find((s) => s.definition.id === 'first-session')?.unlocked).toBe(true);
  });

  it('reports partial progress', () => {
    const statuses = evaluateAchievements({ ...base, totalQuestions: 50 });
    const hundred = statuses.find((s) => s.definition.id === 'hundred-questions');
    expect(hundred?.progress).toBeCloseTo(0.5);
    expect(hundred?.unlocked).toBe(false);
  });

  it('unlocks flawless only for a long clean session', () => {
    expect(
      evaluateAchievements({ ...base, sessions: [ses({ total: 20, correct: 20 })] }).find(
        (s) => s.definition.id === 'flawless',
      )?.unlocked,
    ).toBe(true);
    expect(
      evaluateAchievements({ ...base, sessions: [ses({ total: 5, correct: 5 })] }).find(
        (s) => s.definition.id === 'flawless',
      )?.unlocked,
    ).toBe(false);
  });

  it('clamps progress into 0..1', () => {
    const statuses = evaluateAchievements({ ...base, totalQuestions: 999_999, masteredSquares: 999 });
    expect(statuses.every((s) => s.progress >= 0 && s.progress <= 1)).toBe(true);
  });
});

describe('statistics', () => {
  const attempts = [
    att({ id: 1, modeId: 'square-color', primarySquare: 'e4', correct: true, responseMs: 1000, orientation: 'white' }),
    att({ id: 2, modeId: 'square-color', primarySquare: 'e4', correct: false, responseMs: 3000, orientation: 'white' }),
    att({ id: 3, modeId: 'knight-vision', primarySquare: 'd4', correct: true, responseMs: 2000, orientation: 'black' }),
    att({ id: 4, modeId: 'knight-vision', primarySquare: 'a1', correct: true, responseMs: 500, orientation: 'black' }),
  ];

  it('computes overall accuracy and averages', () => {
    const stats = overallStats(attempts);
    expect(stats.attempts).toBe(4);
    expect(stats.correct).toBe(3);
    expect(stats.accuracy).toBe(0.75);
    expect(stats.averageMs).toBe(1625);
  });

  it('breaks down by mode, square, file, rank and orientation', () => {
    expect(statsByMode(attempts).get('square-color')?.accuracy).toBe(0.5);
    expect(statsByMode(attempts).get('knight-vision')?.accuracy).toBe(1);
    expect(statsBySquare(attempts).get('e4')?.attempts).toBe(2);
    expect(statsByFile(attempts).get('e')?.attempts).toBe(2);
    expect(statsByFile(attempts).get('a')?.attempts).toBe(1);
    expect(statsByRank(attempts).get(4)?.attempts).toBe(3);
    expect(statsByRank(attempts).get(1)?.attempts).toBe(1);
    expect(statsByOrientation(attempts).get('black')?.accuracy).toBe(1);
  });

  it('computes timing statistics', () => {
    const timing = timingStats(attempts);
    expect(timing.averageMs).toBe(1625);
    expect(timing.medianMs).toBe(1500);
    expect(timing.fastestCorrectMs).toBe(500);
    expect(timing.slowestCorrectMs).toBe(2000);
  });

  it('handles empty input everywhere', () => {
    expect(overallStats([])).toEqual({ attempts: 0, correct: 0, accuracy: 0, averageMs: 0 });
    expect(timingStats([]).fastestCorrectMs).toBeNull();
    expect(bestStreak([])).toBe(0);
    expect(improvement([])).toBeNull();
  });

  it('finds the longest run of correct answers', () => {
    const run = [
      att({ correct: true, timestamp: T0 }),
      att({ correct: true, timestamp: T0 + 1 }),
      att({ correct: false, timestamp: T0 + 2 }),
      att({ correct: true, timestamp: T0 + 3 }),
      att({ correct: true, timestamp: T0 + 4 }),
      att({ correct: true, timestamp: T0 + 5 }),
    ];
    expect(bestStreak(run)).toBe(3);
  });

  it('ranks most-missed and most-wrongly-selected targets', () => {
    const knight = [
      att({ missed: ['b5', 'c6'], extra: ['a1'] }),
      att({ missed: ['b5'], extra: ['a1'] }),
      att({ missed: ['c6'], extra: [] }),
    ];
    expect(mostMissedTargets(knight)[0]).toEqual({ square: 'b5', misses: 2 });
    expect(mostWronglySelected(knight)[0]).toEqual({ square: 'a1', times: 2 });
  });

  it('reports an accuracy trend with a point per day', () => {
    const trend = accuracyTrend(attempts, 7, T0);
    expect(trend).toHaveLength(7);
    expect(trend[6]?.attempts).toBe(4);
    expect(trend[0]?.attempts).toBe(0);
  });

  it('detects improvement between halves of the history', () => {
    const history = [
      ...Array.from({ length: 10 }, (_, i) => att({ correct: false, responseMs: 4000, timestamp: T0 + i })),
      ...Array.from({ length: 10 }, (_, i) => att({ correct: true, responseMs: 1000, timestamp: T0 + 100 + i })),
    ];
    const result = improvement(history);
    expect(result?.accuracyDelta).toBeCloseTo(1);
    expect(result?.speedDeltaMs).toBeLessThan(0);
    expect(result?.sampleSize).toBe(20);
  });

  it('needs enough data before claiming a trend', () => {
    expect(improvement(attempts)).toBeNull();
  });

  it('derives per-mode personal bests', () => {
    const bests = personalBestsFromSessions([
      ses({ id: 'a', modeId: 'square-color', accuracy: 0.8, bestStreak: 5, fastestCorrectMs: 900 }),
      ses({ id: 'b', modeId: 'square-color', accuracy: 0.95, bestStreak: 3, fastestCorrectMs: 1200 }),
    ]);
    const map = new Map(bests.map((b) => [b.key, b.value]));
    expect(map.get('square-color:best-accuracy')).toBe(0.95);
    expect(map.get('square-color:best-streak')).toBe(5);
    expect(map.get('square-color:fastest-correct')).toBe(900);
  });
});
