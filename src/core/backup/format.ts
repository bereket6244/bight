/**
 * Backup format, validation and migration.
 *
 * The format is plain versioned JSON so it stays readable and portable. The
 * migration chain means a backup written by any earlier Bight can be imported
 * by any later one: each migration moves data forward exactly one version, and
 * `migrate` walks the chain.
 *
 * Nothing here touches storage. Validation runs to completion before the
 * repository is asked to change anything, so a malformed file can never leave
 * the user with half-imported data.
 */

import { APP_VERSION } from '../version';
import { defaultPreferences, SCHEMA_VERSION, type BightData } from '../storage/types';

export const BACKUP_FORMAT_ID = 'bight-backup';

export interface BackupFile {
  format: typeof BACKUP_FORMAT_ID;
  schemaVersion: number;
  appVersion: string;
  exportedAt: number;
  data: BightData;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Present only when `ok` is true. */
  backup?: BackupFile;
}

export function createBackup(data: BightData, now: number = Date.now()): BackupFile {
  return {
    format: BACKUP_FORMAT_ID,
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: now,
    data,
  };
}

export function serialiseBackup(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2);
}

/** Filename Bight suggests when exporting. */
export function backupFilename(now: number = Date.now()): string {
  const date = new Date(now);
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
  ].join('');
  return `bight-backup-${stamp}.json`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a parsed backup without mutating it.
 *
 * Unknown future versions are rejected rather than guessed at: importing a
 * newer backup into an older Bight could silently drop fields.
 */
export function validateBackup(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObject(input)) {
    return { ok: false, errors: ['The file is not a JSON object.'], warnings };
  }
  if (input.format !== BACKUP_FORMAT_ID) {
    errors.push(`Not a Bight backup: expected format "${BACKUP_FORMAT_ID}".`);
  }

  const schemaVersion = input.schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 0) {
    errors.push('Missing or invalid schemaVersion.');
  } else if (schemaVersion > SCHEMA_VERSION) {
    errors.push(
      `This backup was written by a newer version of Bight (schema ${schemaVersion}, this build understands ${SCHEMA_VERSION}). Update Bight and try again.`,
    );
  }

  if (!isObject(input.data)) {
    errors.push('The backup contains no data section.');
    return { ok: false, errors, warnings };
  }

  const data = input.data;
  for (const key of ['attempts', 'sessions', 'daily', 'achievements'] as const) {
    if (data[key] !== undefined && !Array.isArray(data[key])) {
      errors.push(`data.${key} must be an array.`);
    }
  }
  if (data.preferences !== undefined && !isObject(data.preferences)) {
    errors.push('data.preferences must be an object.');
  }

  if (Array.isArray(data.attempts)) {
    const bad = data.attempts.findIndex(
      (attempt) =>
        !isObject(attempt) ||
        typeof attempt.timestamp !== 'number' ||
        typeof attempt.correct !== 'boolean',
    );
    if (bad !== -1) errors.push(`data.attempts[${bad}] is missing timestamp or correct.`);
  }

  if (typeof input.exportedAt !== 'number') {
    warnings.push('exportedAt is missing; using the current time.');
  }
  if (typeof input.appVersion !== 'string') {
    warnings.push('appVersion is missing.');
  }

  if (errors.length > 0) return { ok: false, errors, warnings };

  return {
    ok: true,
    errors,
    warnings,
    backup: {
      format: BACKUP_FORMAT_ID,
      schemaVersion: schemaVersion as number,
      appVersion: typeof input.appVersion === 'string' ? input.appVersion : 'unknown',
      exportedAt: typeof input.exportedAt === 'number' ? input.exportedAt : Date.now(),
      data: normaliseData(data),
    },
  };
}

/** Fills in absent collections so downstream code never sees undefined. */
function normaliseData(data: Record<string, unknown>): BightData {
  return {
    attempts: Array.isArray(data.attempts) ? (data.attempts as BightData['attempts']) : [],
    sessions: Array.isArray(data.sessions) ? (data.sessions as BightData['sessions']) : [],
    daily: Array.isArray(data.daily) ? (data.daily as BightData['daily']) : [],
    achievements: Array.isArray(data.achievements)
      ? (data.achievements as BightData['achievements'])
      : [],
    personalBests: Array.isArray(data.personalBests)
      ? (data.personalBests as BightData['personalBests'])
      : [],
    preferences: isObject(data.preferences)
      ? { ...defaultPreferences(), ...(data.preferences as object) }
      : defaultPreferences(),
  };
}

export function parseBackup(json: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return {
      ok: false,
      errors: [`The file is not valid JSON: ${(error as Error).message}`],
      warnings: [],
    };
  }
  return validateBackup(parsed);
}

/* ------------------------------------------------------------------ *
 * Migrations
 * ------------------------------------------------------------------ */

export interface Migration {
  from: number;
  to: number;
  describe: string;
  apply: (data: BightData) => BightData;
}

/**
 * One entry per schema step. Adding a schema version means adding a migration
 * here and a fixture to the test suite; nothing else needs to change.
 *
 * Schema 0 was the pre-release layout: it had no personalBests collection and
 * recorded a single `square` per attempt instead of `primarySquare` plus the
 * missed/extra breakdown.
 */
export const MIGRATIONS: readonly Migration[] = Object.freeze([
  {
    from: 0,
    to: 1,
    describe: 'Rename attempt.square to primarySquare; add personalBests, missed and extra.',
    apply: (data) => ({
      ...data,
      attempts: data.attempts.map((attempt) => {
        const legacy = attempt as unknown as Record<string, unknown>;
        const square = legacy.square;
        return {
          ...attempt,
          primarySquare:
            attempt.primarySquare ?? (typeof square === 'string' ? (square as never) : null),
          focusSquares:
            attempt.focusSquares ?? (typeof square === 'string' ? ([square] as never) : []),
          missed: attempt.missed ?? [],
          extra: attempt.extra ?? [],
          isRetry: attempt.isRetry ?? false,
          source: attempt.source ?? 'touch',
        };
      }),
      personalBests: data.personalBests ?? [],
    }),
  },
]);

export interface MigrationResult {
  data: BightData;
  applied: string[];
  fromVersion: number;
  toVersion: number;
}

/**
 * Walks the migration chain from the backup's version to the current one.
 * Throws when no path exists, which validation has already ruled out for
 * versions Bight knows about.
 */
export function migrate(backup: BackupFile): MigrationResult {
  let version = backup.schemaVersion;
  let data = backup.data;
  const applied: string[] = [];

  while (version < SCHEMA_VERSION) {
    const migration = MIGRATIONS.find((m) => m.from === version);
    if (migration === undefined) {
      throw new Error(`No migration from schema ${version} to ${SCHEMA_VERSION}.`);
    }
    data = migration.apply(data);
    applied.push(`${migration.from} -> ${migration.to}: ${migration.describe}`);
    version = migration.to;
  }

  return { data, applied, fromVersion: backup.schemaVersion, toVersion: version };
}

/** Rough count of what an import would bring in, shown before confirming. */
export interface BackupPreview {
  attempts: number;
  sessions: number;
  days: number;
  achievements: number;
  exportedAt: number;
  appVersion: string;
  schemaVersion: number;
  needsMigration: boolean;
}

export function previewBackup(backup: BackupFile): BackupPreview {
  return {
    attempts: backup.data.attempts.length,
    sessions: backup.data.sessions.length,
    days: backup.data.daily.length,
    achievements: backup.data.achievements.length,
    exportedAt: backup.exportedAt,
    appVersion: backup.appVersion,
    schemaVersion: backup.schemaVersion,
    needsMigration: backup.schemaVersion < SCHEMA_VERSION,
  };
}
