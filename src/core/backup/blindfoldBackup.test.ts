/**
 * Backup round trips with blindfold attempts in them, and the promise that
 * adding blindfold training did not break anyone's existing data.
 *
 * The blindfold fields — `hintsUsed`, `plies`, `boardVisibility`,
 * `blindfoldKind` — are all optional additions to `Attempt`, so no schema bump
 * and no migration is involved: a backup written before this feature existed
 * loads unchanged, with those fields simply absent. These tests hold that
 * claim to account rather than assuming it.
 */

import { describe, expect, it } from 'vitest';
import { exportBackup, importBackup } from './service';
import { parseBackup, serialiseBackup, BACKUP_FORMAT_ID } from './format';
import { MemoryRepository } from '../storage/memory';
import { blindfoldProgress } from '../progress/blindfold';
import { computeMastery } from '../progress/mastery';
import { defaultPreferences, SCHEMA_VERSION } from '../storage/types';
import { defaultSettings } from '../session/settings';
import { APP_VERSION } from '../version';
import type { Attempt } from '../session/engine';
import type { SquareName } from '../chess/types';

const T0 = 1_700_000_000_000;

function blindfoldAttempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    questionId: 'bq1',
    modeId: 'blindfold-tracking',
    variantId: 'mixed',
    prompt: 'Where is the knight that started on g1?',
    expected: 'f3',
    answer: 'f3',
    correct: true,
    responseMs: 5200,
    source: 'keypad',
    orientation: 'white',
    labels: 'always',
    layout: 'custom',
    filters: 'none',
    timer: 'none',
    focusSquares: ['f3', 'g1'] as SquareName[],
    primarySquare: 'f3' as SquareName,
    missed: [],
    extra: [],
    timestamp: T0,
    isRetry: false,
    hintsUsed: 1,
    plies: 10,
    boardVisibility: 'never',
    blindfoldKind: 'piece-location',
    ...overrides,
  };
}

/** An attempt exactly as version 1.3.0 wrote it: no blindfold fields at all. */
function legacyAttempt(): Record<string, unknown> {
  return {
    questionId: 'old1',
    modeId: 'coordinate-to-square',
    variantId: 'standard',
    prompt: 'Tap e4',
    expected: 'e4',
    answer: 'e4',
    correct: true,
    responseMs: 900,
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
    timestamp: T0 - 86_400_000,
    isRetry: false,
  };
}

function legacyBackupJson(): string {
  return serialiseBackup({
    format: BACKUP_FORMAT_ID,
    schemaVersion: 1,
    appVersion: '1.3.0',
    exportedAt: T0 - 86_400_000,
    data: {
      attempts: [legacyAttempt()] as never,
      sessions: [],
      daily: [],
      achievements: [],
      preferences: defaultPreferences(),
    },
  } as never);
}

describe('backups carrying blindfold attempts', () => {
  it('round trips every blindfold field intact', async () => {
    const source = new MemoryRepository();
    await source.addAttempts('s1', [
      blindfoldAttempt(),
      blindfoldAttempt({ questionId: 'bq2', hintsUsed: 0, plies: 4, correct: false }),
    ]);

    const json = await exportBackup(source, T0);

    const target = new MemoryRepository();
    const result = await importBackup(target, json, 'replace');
    expect(result.ok, result.errors.join('; ')).toBe(true);

    const restored = await target.getAttempts({ limit: 100 });
    expect(restored).toHaveLength(2);

    const first = restored.find((a) => a.questionId === 'bq1');
    expect(first?.hintsUsed).toBe(1);
    expect(first?.plies).toBe(10);
    expect(first?.boardVisibility).toBe('never');
    expect(first?.blindfoldKind).toBe('piece-location');
  });

  it('derives the same blindfold progress before and after a round trip', async () => {
    const source = new MemoryRepository();
    const attempts = Array.from({ length: 8 }, (_, i) =>
      blindfoldAttempt({
        questionId: `bq${i}`,
        timestamp: T0 + i * 1000,
        correct: i % 4 !== 0,
        hintsUsed: i === 2 ? 1 : 0,
      }),
    );
    await source.addAttempts('s1', attempts);

    const before = blindfoldProgress(await source.getAttempts({ limit: 100 }), T0);

    const target = new MemoryRepository();
    await importBackup(target, await exportBackup(source, T0), 'replace');
    const after = blindfoldProgress(await target.getAttempts({ limit: 100 }), T0);

    expect(after.overall).toEqual(before.overall);
    expect([...after.byLength.entries()]).toEqual([...before.byLength.entries()]);
    expect([...after.byKind.entries()]).toEqual([...before.byKind.entries()]);
    expect(after.recommendation).toEqual(before.recommendation);
  });

  it('keeps blindfold attempts out of square mastery after a round trip too', async () => {
    const source = new MemoryRepository();
    await source.addAttempts(
      's1',
      Array.from({ length: 20 }, (_, i) =>
        blindfoldAttempt({
          questionId: `bq${i}`,
          correct: false,
          missed: ['f3'] as SquareName[],
          timestamp: T0 + i * 86_400_000,
        }),
      ),
    );

    const target = new MemoryRepository();
    await importBackup(target, await exportBackup(source, T0), 'replace');

    const mastery = computeMastery(await target.getAttempts({ limit: 100 }));
    expect(mastery.get('f3' as SquareName)).toBeUndefined();
  });
});

describe('backups written before blindfold training existed', () => {
  it('validates without complaint', () => {
    const validation = parseBackup(legacyBackupJson());
    expect(validation.ok, validation.errors.join('; ')).toBe(true);
  });

  it('imports and keeps the old attempt exactly as it was', async () => {
    const target = new MemoryRepository();
    const result = await importBackup(target, legacyBackupJson(), 'replace');

    expect(result.ok, result.errors.join('; ')).toBe(true);
    const [restored] = await target.getAttempts({ limit: 10 });
    expect(restored?.questionId).toBe('old1');
    expect(restored?.correct).toBe(true);
    // Absent rather than defaulted to a number that would be a lie.
    expect(restored?.plies).toBeUndefined();
    expect(restored?.hintsUsed).toBeUndefined();
    expect(restored?.blindfoldKind).toBeUndefined();
  });

  it('reads as no blindfold practice at all, not as zero-ply practice', async () => {
    const target = new MemoryRepository();
    await importBackup(target, legacyBackupJson(), 'replace');

    const progress = blindfoldProgress(await target.getAttempts({ limit: 10 }), T0);
    expect(progress.overall.attempts).toBe(0);
    expect(progress.byLength.size).toBe(0);
    expect(progress.provenPlies).toBeNull();
    expect(progress.recommendation.action).toBe('start');
  });

  it('still contributes to square mastery, which is where it belongs', async () => {
    const target = new MemoryRepository();
    await importBackup(target, legacyBackupJson(), 'replace');

    const mastery = computeMastery(await target.getAttempts({ limit: 10 }));
    expect(mastery.get('e4' as SquareName)?.attempts).toBe(1);
  });

  it('merges old and new attempts side by side', async () => {
    const target = new MemoryRepository();
    await target.addAttempts('new', [blindfoldAttempt()]);
    const result = await importBackup(target, legacyBackupJson(), 'merge');

    expect(result.ok, result.errors.join('; ')).toBe(true);
    const all = await target.getAttempts({ limit: 100 });
    expect(all).toHaveLength(2);
    expect(all.filter((a) => a.modeId === 'blindfold-tracking')).toHaveLength(1);
    expect(all.filter((a) => a.modeId === 'coordinate-to-square')).toHaveLength(1);
  });
});

describe('the blindfold fields did not need a schema bump', () => {
  it('still writes schema version 1', async () => {
    const repository = new MemoryRepository();
    await repository.addAttempts('s1', [blindfoldAttempt()]);
    const parsed = JSON.parse(await exportBackup(repository, T0));
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('stamps the current app version so the origin of a backup is knowable', async () => {
    const repository = new MemoryRepository();
    await repository.addSession({
      id: 's1',
      modeId: 'blindfold-tracking',
      variantId: 'mixed',
      startedAt: T0,
      endedAt: T0 + 60_000,
      total: 10,
      correct: 8,
      accuracy: 0.8,
      averageMs: 5000,
      medianMs: 4800,
      fastestCorrectMs: 2100,
      bestStreak: 5,
      durationMs: 60_000,
      endedEarly: false,
      settings: defaultSettings('blindfold-tracking', 'mixed'),
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
    });

    const parsed = JSON.parse(await exportBackup(repository, T0));
    expect(parsed.appVersion).toBe(APP_VERSION);
    expect(parsed.data.sessions[0].settings.blindfoldPlies).toBeDefined();
    expect(parsed.data.sessions[0].settings.boardVisibility).toBeDefined();
  });
});
