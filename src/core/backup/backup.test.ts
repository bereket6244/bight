import { describe, expect, it } from 'vitest';
import {
  backupFilename,
  createBackup,
  migrate,
  parseBackup,
  previewBackup,
  serialiseBackup,
  validateBackup,
  BACKUP_FORMAT_ID,
  MIGRATIONS,
} from './format';
import { exportBackup, importBackup, inspectBackup } from './service';
import { MemoryRepository } from '../storage/memory';
import { defaultPreferences, SCHEMA_VERSION, type BightData } from '../storage/types';
import { defaultSettings } from '../session/settings';
import type { Attempt } from '../session/engine';

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

async function populated(): Promise<MemoryRepository> {
  const repository = new MemoryRepository();
  await repository.init();
  await repository.addAttempts('s1', [attempt(), attempt({ questionId: 'q2', correct: false })]);
  await repository.addSession({
    id: 's1',
    modeId: 'square-color',
    variantId: 'coordinate',
    startedAt: T0,
    endedAt: T0 + 1000,
    total: 2,
    correct: 1,
    accuracy: 0.5,
    averageMs: 1200,
    medianMs: 1200,
    fastestCorrectMs: 1200,
    bestStreak: 1,
    durationMs: 1000,
    endedEarly: false,
    settings: defaultSettings('square-color', 'coordinate'),
    schemaVersion: 1,
    appVersion: '1.0.0',
  });
  await repository.upsertDaily({ date: '2026-07-30', sessions: 1, questions: 2, correct: 1, counted: false });
  await repository.upsertAchievement({ id: 'first-session', unlockedAt: T0, progress: 1 });
  await repository.upsertPersonalBest({ key: 'square-color:best-streak', value: 1, achievedAt: T0 });
  await repository.savePreferences({ ...defaultPreferences(), dailyGoal: 55 });
  return repository;
}

describe('backup format', () => {
  it('stamps format, schema, app version and timestamp', () => {
    const backup = createBackup(emptyData(), T0);
    expect(backup.format).toBe(BACKUP_FORMAT_ID);
    expect(backup.schemaVersion).toBe(SCHEMA_VERSION);
    expect(backup.appVersion).toBe('1.0.0');
    expect(backup.exportedAt).toBe(T0);
  });

  it('produces a dated filename', () => {
    expect(backupFilename(new Date(2026, 6, 30, 9, 5).getTime())).toBe(
      'bight-backup-202607300905.json',
    );
  });

  it('serialises to readable JSON', () => {
    const json = serialiseBackup(createBackup(emptyData(), T0));
    expect(json).toContain('"format": "bight-backup"');
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

describe('validation', () => {
  it('accepts a backup it produced', () => {
    const result = validateBackup(createBackup(emptyData(), T0));
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a non-object', () => {
    expect(validateBackup(null).ok).toBe(false);
    expect(validateBackup('nope').ok).toBe(false);
    expect(validateBackup(42).ok).toBe(false);
  });

  it('rejects a file that is not a Bight backup', () => {
    const result = validateBackup({ format: 'something-else', schemaVersion: 1, data: {} });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('Not a Bight backup');
  });

  it('rejects a newer schema than this build understands', () => {
    const result = validateBackup({
      format: BACKUP_FORMAT_ID,
      schemaVersion: SCHEMA_VERSION + 5,
      data: emptyData(),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('newer version of Bight');
  });

  it('rejects a missing or malformed data section', () => {
    expect(validateBackup({ format: BACKUP_FORMAT_ID, schemaVersion: 1 }).ok).toBe(false);
    expect(
      validateBackup({ format: BACKUP_FORMAT_ID, schemaVersion: 1, data: { attempts: 'no' } }).ok,
    ).toBe(false);
  });

  it('rejects attempts missing required fields', () => {
    const result = validateBackup({
      format: BACKUP_FORMAT_ID,
      schemaVersion: 1,
      data: { ...emptyData(), attempts: [{ questionId: 'x' }] },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('attempts[0]');
  });

  it('warns but accepts when optional metadata is missing', () => {
    const result = validateBackup({
      format: BACKUP_FORMAT_ID,
      schemaVersion: 1,
      data: emptyData(),
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('fills in absent collections', () => {
    const result = validateBackup({ format: BACKUP_FORMAT_ID, schemaVersion: 1, data: {} });
    expect(result.ok).toBe(true);
    expect(result.backup?.data.attempts).toEqual([]);
    expect(result.backup?.data.preferences).toEqual(defaultPreferences());
  });

  it('reports malformed JSON clearly', () => {
    const result = parseBackup('{ not json');
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('not valid JSON');
  });
});

describe('migration', () => {
  /** A schema-0 backup: no personalBests, attempts keyed by `square`. */
  const legacyBackup = {
    format: BACKUP_FORMAT_ID,
    schemaVersion: 0,
    appVersion: '0.9.0',
    exportedAt: T0,
    data: {
      attempts: [
        {
          questionId: 'legacy-1',
          modeId: 'square-color',
          variantId: 'coordinate',
          prompt: 'Is a1 light or dark?',
          expected: 'dark',
          answer: 'dark',
          correct: true,
          responseMs: 1800,
          orientation: 'white',
          labels: 'always',
          layout: 'empty',
          filters: 'none',
          timer: 'none',
          square: 'a1',
          timestamp: T0,
        },
      ],
      sessions: [],
      daily: [],
      achievements: [],
      preferences: { theme: 'light' },
    },
  };

  it('defines a continuous chain up to the current schema', () => {
    for (let version = 0; version < SCHEMA_VERSION; version += 1) {
      expect(
        MIGRATIONS.some((m) => m.from === version),
        `missing migration from ${version}`,
      ).toBe(true);
    }
  });

  it('accepts an older schema during validation', () => {
    const result = validateBackup(legacyBackup);
    expect(result.ok).toBe(true);
    expect(result.backup?.schemaVersion).toBe(0);
  });

  it('flags that migration is needed', () => {
    const backup = validateBackup(legacyBackup).backup!;
    expect(previewBackup(backup).needsMigration).toBe(true);
  });

  it('upgrades a schema-0 backup to the current schema', () => {
    const backup = validateBackup(legacyBackup).backup!;
    const result = migrate(backup);

    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(SCHEMA_VERSION);
    expect(result.applied).toHaveLength(1);

    const upgraded = result.data.attempts[0];
    expect(upgraded?.primarySquare).toBe('a1');
    expect(upgraded?.focusSquares).toEqual(['a1']);
    expect(upgraded?.missed).toEqual([]);
    expect(upgraded?.extra).toEqual([]);
    expect(upgraded?.source).toBe('touch');
    expect(result.data.personalBests).toEqual([]);
  });

  it('is a no-op for a current-schema backup', () => {
    const backup = createBackup(emptyData(), T0);
    const result = migrate(backup);
    expect(result.applied).toEqual([]);
    expect(result.data).toEqual(backup.data);
  });
});

describe('export and import round trip', () => {
  it('exports data that imports back identically', async () => {
    const source = await populated();
    const json = await exportBackup(source, T0);

    const target = new MemoryRepository();
    await target.init();
    const result = await importBackup(target, json, 'replace');

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);

    const before = await source.exportAll();
    const after = await target.exportAll();
    expect(after.attempts).toHaveLength(before.attempts.length);
    expect(after.sessions).toHaveLength(before.sessions.length);
    expect(after.preferences.dailyGoal).toBe(55);
    expect(after.achievements).toHaveLength(1);
  });

  it('previews a backup without importing it', async () => {
    const source = await populated();
    const json = await exportBackup(source, T0);
    const inspection = inspectBackup(json);

    expect(inspection.ok).toBe(true);
    expect(inspection.preview?.attempts).toBe(2);
    expect(inspection.preview?.sessions).toBe(1);
    expect(inspection.preview?.needsMigration).toBe(false);
  });
});

describe('import safety', () => {
  it('leaves existing data untouched when the file is invalid', async () => {
    const repository = await populated();
    const before = await repository.exportAll();

    const result = await importBackup(repository, '{ garbage', 'replace');

    expect(result.ok).toBe(false);
    expect(result.rolledBack).toBe(false);
    const after = await repository.exportAll();
    expect(after.attempts).toHaveLength(before.attempts.length);
    expect(after.preferences.dailyGoal).toBe(55);
  });

  it('leaves existing data untouched when the schema is too new', async () => {
    const repository = await populated();
    const json = JSON.stringify({
      format: BACKUP_FORMAT_ID,
      schemaVersion: SCHEMA_VERSION + 1,
      appVersion: '99.0.0',
      exportedAt: T0,
      data: emptyData(),
    });

    const result = await importBackup(repository, json, 'replace');
    expect(result.ok).toBe(false);
    expect((await repository.exportAll()).attempts).toHaveLength(2);
  });

  it('restores a snapshot when the write itself fails', async () => {
    const repository = await populated();
    const json = await exportBackup(repository, T0);

    // Force the write to fail after validation has passed.
    const broken = repository as unknown as { importAll: unknown };
    const original = repository.importAll.bind(repository);
    let calls = 0;
    broken.importAll = async (data: BightData) => {
      calls += 1;
      if (calls === 1) throw new Error('disk full');
      return original(data);
    };

    const result = await importBackup(repository, json, 'replace');

    expect(result.ok).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(result.errors[0]).toContain('restored');
    // The snapshot restore ran, so the original data is still there.
    expect((await repository.exportAll()).attempts).toHaveLength(2);
  });

  it('does not duplicate history when the same backup is merged twice', async () => {
    const repository = await populated();
    const json = await exportBackup(repository, T0);

    await importBackup(repository, json, 'merge');
    expect((await repository.exportAll()).attempts).toHaveLength(2);

    await importBackup(repository, json, 'merge');
    expect((await repository.exportAll()).attempts).toHaveLength(2);
  });

  it('merges new history alongside existing history', async () => {
    const repository = await populated();
    const other = new MemoryRepository();
    await other.init();
    await other.addAttempts('s2', [attempt({ questionId: 'elsewhere', timestamp: T0 + 50_000 })]);

    const result = await importBackup(repository, await exportBackup(other, T0), 'merge');
    expect(result.ok).toBe(true);

    const data = await repository.exportAll();
    expect(data.attempts).toHaveLength(3);
    expect(data.attempts.map((a) => a.questionId)).toContain('elsewhere');
  });

  it('replaces rather than merges when asked', async () => {
    const repository = await populated();
    const other = new MemoryRepository();
    await other.init();
    await other.addAttempts('s2', [attempt({ questionId: 'only-this', timestamp: T0 + 50_000 })]);

    await importBackup(repository, await exportBackup(other, T0), 'replace');
    const data = await repository.exportAll();
    expect(data.attempts).toHaveLength(1);
    expect(data.attempts[0]?.questionId).toBe('only-this');
  });

  it('imports a legacy backup end to end', async () => {
    const repository = new MemoryRepository();
    await repository.init();

    const legacyJson = JSON.stringify({
      format: BACKUP_FORMAT_ID,
      schemaVersion: 0,
      appVersion: '0.9.0',
      exportedAt: T0,
      data: {
        attempts: [
          {
            questionId: 'legacy-1',
            modeId: 'square-color',
            variantId: 'coordinate',
            prompt: 'p',
            expected: 'dark',
            answer: 'dark',
            correct: true,
            responseMs: 1800,
            orientation: 'white',
            labels: 'always',
            layout: 'empty',
            filters: 'none',
            timer: 'none',
            square: 'a1',
            timestamp: T0,
          },
        ],
        sessions: [],
        daily: [],
        achievements: [],
        preferences: { theme: 'light' },
      },
    });

    const result = await importBackup(repository, legacyJson, 'replace');
    expect(result.ok).toBe(true);
    expect(result.migrationsApplied).toHaveLength(1);

    const data = await repository.exportAll();
    expect(data.attempts[0]?.primarySquare).toBe('a1');
    expect(data.preferences.theme).toBe('light');
  });
});

function emptyData(): BightData {
  return {
    attempts: [],
    sessions: [],
    daily: [],
    achievements: [],
    personalBests: [],
    preferences: defaultPreferences(),
  };
}
