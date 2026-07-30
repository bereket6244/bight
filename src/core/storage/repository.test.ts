/**
 * The same contract is run against every repository implementation, so the
 * IndexedDB and in-memory engines are provably interchangeable.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRepository, isBetter } from './memory';
import { IndexedDbRepository } from './indexedDb';
import {
  daysBetween,
  defaultPreferences,
  localDateKey,
  type BightRepository,
  type StoredSession,
} from './types';
import type { Attempt } from '../session/engine';
import type { SessionSettings } from '../session/settings';
import { defaultSettings } from '../session/settings';

const T0 = 1_700_000_000_000;

function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    questionId: 'q1',
    modeId: 'square-color',
    variantId: 'coordinate',
    prompt: 'Is e4 light or dark?',
    expected: 'light',
    answer: 'light',
    correct: true,
    responseMs: 1200,
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

function session(overrides: Partial<StoredSession> = {}): StoredSession {
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
    fastestCorrectMs: 700,
    bestStreak: 9,
    durationMs: 60_000,
    endedEarly: false,
    settings: defaultSettings('square-color', 'coordinate') as SessionSettings,
    schemaVersion: 1,
    appVersion: '1.0.0',
    ...overrides,
  };
}

const implementations: Array<{ name: string; create: () => BightRepository }> = [
  { name: 'MemoryRepository', create: () => new MemoryRepository() },
  { name: 'IndexedDbRepository', create: () => new IndexedDbRepository() },
];

describe.each(implementations)('$name', ({ create }) => {
  let repository: BightRepository;

  beforeEach(async () => {
    repository = create();
    await repository.init();
    await repository.clear();
  });

  it('starts empty', async () => {
    expect(await repository.getAttempts()).toEqual([]);
    expect(await repository.getSessions()).toEqual([]);
    expect(await repository.getDaily()).toEqual([]);
  });

  it('stores and reads back attempts', async () => {
    await repository.addAttempts('s1', [attempt(), attempt({ questionId: 'q2', correct: false })]);
    const rows = await repository.getAttempts();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.sessionId === 's1')).toBe(true);
    expect(rows.every((row) => row.schemaVersion === 1)).toBe(true);
    expect(rows.every((row) => typeof row.appVersion === 'string')).toBe(true);
  });

  it('assigns distinct ids to attempts', async () => {
    await repository.addAttempts('s1', [attempt(), attempt({ questionId: 'q2' })]);
    const ids = (await repository.getAttempts()).map((row) => row.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => typeof id === 'number')).toBe(true);
  });

  it('returns attempts newest first', async () => {
    await repository.addAttempts('s1', [
      attempt({ questionId: 'old', timestamp: T0 }),
      attempt({ questionId: 'new', timestamp: T0 + 10_000 }),
    ]);
    const rows = await repository.getAttempts();
    expect(rows[0]?.questionId).toBe('new');
  });

  it('filters attempts by mode, time and limit', async () => {
    await repository.addAttempts('s1', [
      attempt({ questionId: 'a', modeId: 'square-color', timestamp: T0 }),
      attempt({ questionId: 'b', modeId: 'knight-vision', timestamp: T0 + 1000 }),
      attempt({ questionId: 'c', modeId: 'knight-vision', timestamp: T0 + 2000 }),
    ]);

    expect(await repository.getAttempts({ modeId: 'knight-vision' })).toHaveLength(2);
    expect(await repository.getAttempts({ since: T0 + 1500 })).toHaveLength(1);
    expect(await repository.getAttempts({ limit: 2 })).toHaveLength(2);
  });

  it('handles an empty attempt batch', async () => {
    await repository.addAttempts('s1', []);
    expect(await repository.getAttempts()).toEqual([]);
  });

  it('stores and reads back sessions newest first', async () => {
    await repository.addSession(session({ id: 'a', startedAt: T0 }));
    await repository.addSession(session({ id: 'b', startedAt: T0 + 5000 }));
    const rows = await repository.getSessions();
    expect(rows.map((row) => row.id)).toEqual(['b', 'a']);
    expect(rows[0]?.settings.modeId).toBe('square-color');
  });

  it('upserts daily records by date', async () => {
    await repository.upsertDaily({ date: '2026-07-30', sessions: 1, questions: 20, correct: 18, counted: true });
    await repository.upsertDaily({ date: '2026-07-30', sessions: 2, questions: 40, correct: 35, counted: true });
    const rows = await repository.getDaily();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.questions).toBe(40);
  });

  it('upserts achievements and personal bests', async () => {
    await repository.upsertAchievement({ id: 'first-session', unlockedAt: T0, progress: 1 });
    await repository.upsertAchievement({ id: 'first-session', unlockedAt: T0, progress: 1 });
    expect(await repository.getAchievements()).toHaveLength(1);

    await repository.upsertPersonalBest({ key: 'k', value: 5, achievedAt: T0 });
    await repository.upsertPersonalBest({ key: 'k', value: 9, achievedAt: T0 + 1 });
    const bests = await repository.getPersonalBests();
    expect(bests).toHaveLength(1);
    expect(bests[0]?.value).toBe(9);
  });

  it('returns default preferences before any are saved', async () => {
    expect(await repository.getPreferences()).toEqual(defaultPreferences());
  });

  it('round-trips preferences', async () => {
    const preferences = { ...defaultPreferences(), theme: 'light' as const, dailyGoal: 100 };
    await repository.savePreferences(preferences);
    expect(await repository.getPreferences()).toMatchObject({ theme: 'light', dailyGoal: 100 });
  });

  it('fills in preferences added by a later version', async () => {
    // Simulates a record written before a field existed.
    await repository.savePreferences({ theme: 'light' } as never);
    const loaded = await repository.getPreferences();
    expect(loaded.theme).toBe('light');
    expect(loaded.dailyGoal).toBe(defaultPreferences().dailyGoal);
  });

  it('exports everything it holds', async () => {
    await repository.addAttempts('s1', [attempt()]);
    await repository.addSession(session());
    await repository.upsertDaily({ date: '2026-07-30', sessions: 1, questions: 20, correct: 18, counted: true });
    await repository.upsertAchievement({ id: 'a', unlockedAt: T0, progress: 1 });
    await repository.upsertPersonalBest({ key: 'k', value: 1, achievedAt: T0 });

    const data = await repository.exportAll();
    expect(data.attempts).toHaveLength(1);
    expect(data.sessions).toHaveLength(1);
    expect(data.daily).toHaveLength(1);
    expect(data.achievements).toHaveLength(1);
    expect(data.personalBests).toHaveLength(1);
    expect(data.preferences).toBeDefined();
  });

  it('replaces everything on importAll', async () => {
    await repository.addAttempts('s1', [attempt({ questionId: 'original' })]);
    const incoming = await repository.exportAll();
    incoming.attempts = [
      { ...attempt({ questionId: 'imported' }), id: 1, sessionId: 's9', schemaVersion: 1, appVersion: '1.0.0' },
    ];

    await repository.importAll(incoming);
    const rows = await repository.getAttempts();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.questionId).toBe('imported');
  });

  it('keeps existing history on mergeAll and skips duplicates', async () => {
    await repository.addAttempts('s1', [attempt({ questionId: 'mine', timestamp: T0 })]);
    const existing = await repository.exportAll();

    // Merging the same export back in must not duplicate anything.
    await repository.mergeAll(existing);
    expect(await repository.getAttempts()).toHaveLength(1);

    // A genuinely new attempt is added.
    await repository.mergeAll({
      ...existing,
      attempts: [
        { ...attempt({ questionId: 'theirs', timestamp: T0 + 999 }), id: 99, sessionId: 's2', schemaVersion: 1, appVersion: '1.0.0' },
      ],
    });
    const rows = await repository.getAttempts();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.questionId).sort()).toEqual(['mine', 'theirs']);
  });

  it('merges daily records by taking the higher counts', async () => {
    await repository.upsertDaily({ date: '2026-07-30', sessions: 1, questions: 10, correct: 8, counted: false });
    const existing = await repository.exportAll();
    await repository.mergeAll({
      ...existing,
      daily: [{ date: '2026-07-30', sessions: 3, questions: 30, correct: 25, counted: true }],
    });
    const rows = await repository.getDaily();
    expect(rows[0]).toMatchObject({ sessions: 3, questions: 30, correct: 25, counted: true });
  });

  it('merges personal bests keeping the better value', async () => {
    await repository.upsertPersonalBest({ key: 'best-streak', value: 10, achievedAt: T0 });
    await repository.upsertPersonalBest({ key: 'fastest-correct', value: 900, achievedAt: T0 });
    const existing = await repository.exportAll();

    await repository.mergeAll({
      ...existing,
      personalBests: [
        { key: 'best-streak', value: 4, achievedAt: T0 },
        { key: 'fastest-correct', value: 500, achievedAt: T0 },
      ],
    });

    const bests = new Map((await repository.getPersonalBests()).map((b) => [b.key, b.value]));
    expect(bests.get('best-streak')).toBe(10);
    expect(bests.get('fastest-correct')).toBe(500);
  });

  it('clears everything', async () => {
    await repository.addAttempts('s1', [attempt()]);
    await repository.addSession(session());
    await repository.clear();
    expect(await repository.getAttempts()).toEqual([]);
    expect(await repository.getSessions()).toEqual([]);
    expect(await repository.getPreferences()).toEqual(defaultPreferences());
  });
});

describe('personal-best direction', () => {
  it('treats time-like keys as lower-is-better', () => {
    expect(isBetter('mode:fastest-correct', 500, 900)).toBe(true);
    expect(isBetter('mode:fastest-correct', 900, 500)).toBe(false);
    expect(isBetter('mode:best-streak', 12, 9)).toBe(true);
    expect(isBetter('mode:best-streak', 3, 9)).toBe(false);
  });
});

describe('local date helpers', () => {
  it('formats a local date key', () => {
    const key = localDateKey(new Date(2026, 6, 30, 13, 45).getTime());
    expect(key).toBe('2026-07-30');
  });

  it('counts whole days between keys', () => {
    expect(daysBetween('2026-07-29', '2026-07-30')).toBe(1);
    expect(daysBetween('2026-07-30', '2026-07-30')).toBe(0);
    expect(daysBetween('2026-07-01', '2026-08-01')).toBe(31);
  });

  it('handles a month boundary and a leap year', () => {
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
  });

  it('is stable across a daylight-saving boundary', () => {
    // Whatever the local zone, consecutive calendar days differ by one.
    const march = new Date(2026, 2, 28, 12).getTime();
    const next = new Date(2026, 2, 29, 12).getTime();
    expect(daysBetween(localDateKey(march), localDateKey(next))).toBe(1);
  });
});
