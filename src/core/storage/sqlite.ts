/**
 * SQLite repository, backed by @capacitor-community/sqlite.
 *
 * Only usable inside the Android app; in a browser the plugin is absent and
 * `sqliteAvailable()` returns false, so `createRepository` falls through to
 * IndexedDB. Every method mirrors IndexedDbRepository exactly - the contract
 * test suite is the specification both must satisfy.
 *
 * JSON columns are used for the array-valued fields (focusSquares, missed,
 * extra, settings). Bight never queries inside them, so normalising them into
 * side tables would add joins and migration surface for no benefit.
 */

import type { Attempt } from '../session/engine';
import { APP_VERSION } from '../version';
import { isBetter } from './memory';
import {
  defaultPreferences,
  SCHEMA_VERSION,
  type AchievementRecord,
  type AttemptQuery,
  type BightData,
  type BightRepository,
  type DailyRecord,
  type PersonalBest,
  type PreferencesRecord,
  type StoredAttempt,
  type StoredSession,
} from './types';

const DB_NAME = 'bight';

/** Minimal structural types so this module never imports the plugin eagerly. */
interface SqliteConnection {
  open: () => Promise<void>;
  close: () => Promise<void>;
  execute: (statements: string) => Promise<unknown>;
  run: (statement: string, values?: unknown[]) => Promise<unknown>;
  query: (statement: string, values?: unknown[]) => Promise<{ values?: unknown[] }>;
}

interface SqlitePlugin {
  createConnection: (
    database: string,
    encrypted: boolean,
    mode: string,
    version: number,
    readonly: boolean,
  ) => Promise<SqliteConnection>;
  closeConnection?: (database: string, readonly: boolean) => Promise<void>;
  isConnection?: (database: string, readonly: boolean) => Promise<{ result: boolean }>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId TEXT NOT NULL,
  questionId TEXT NOT NULL,
  modeId TEXT NOT NULL,
  variantId TEXT NOT NULL,
  prompt TEXT NOT NULL,
  expected TEXT NOT NULL,
  answer TEXT NOT NULL,
  correct INTEGER NOT NULL,
  responseMs INTEGER NOT NULL,
  source TEXT NOT NULL,
  orientation TEXT NOT NULL,
  labels TEXT NOT NULL,
  layout TEXT NOT NULL,
  filters TEXT NOT NULL,
  timer TEXT NOT NULL,
  focusSquares TEXT NOT NULL,
  primarySquare TEXT,
  missed TEXT NOT NULL,
  extra TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  isRetry INTEGER NOT NULL,
  schemaVersion INTEGER NOT NULL,
  appVersion TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_timestamp ON attempts(timestamp);
CREATE INDEX IF NOT EXISTS idx_attempts_mode ON attempts(modeId);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  modeId TEXT NOT NULL,
  variantId TEXT NOT NULL,
  startedAt INTEGER NOT NULL,
  endedAt INTEGER NOT NULL,
  total INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  accuracy REAL NOT NULL,
  averageMs INTEGER NOT NULL,
  medianMs INTEGER NOT NULL,
  fastestCorrectMs INTEGER,
  bestStreak INTEGER NOT NULL,
  durationMs INTEGER NOT NULL,
  endedEarly INTEGER NOT NULL,
  settings TEXT NOT NULL,
  schemaVersion INTEGER NOT NULL,
  appVersion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily (
  date TEXT PRIMARY KEY,
  sessions INTEGER NOT NULL,
  questions INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  counted INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  unlockedAt INTEGER NOT NULL,
  progress REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS personalBests (
  key TEXT PRIMARY KEY,
  value REAL NOT NULL,
  achievedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS preferences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL
);
`;

/**
 * The plugin is returned boxed, never bare.
 *
 * Capacitor plugin objects are proxies that throw `UNIMPLEMENTED` for unknown
 * properties. Resolving a promise with one makes the engine probe it for
 * `.then` to test thenability, which trips the proxy and surfaces as an
 * unhandled rejection. Wrapping it keeps the proxy off the resolution path.
 */
async function loadPlugin(): Promise<{ plugin: SqlitePlugin | null }> {
  try {
    const module = (await import('@capacitor-community/sqlite')) as unknown as {
      CapacitorSQLite?: SqlitePlugin;
    };
    return { plugin: module.CapacitorSQLite ?? null };
  } catch {
    return { plugin: null };
  }
}

/** True only inside a native Capacitor shell with the plugin present. */
export async function sqliteAvailable(): Promise<boolean> {
  try {
    const { Capacitor } = (await import('@capacitor/core')) as unknown as {
      Capacitor: { isNativePlatform: () => boolean };
    };
    if (!Capacitor.isNativePlatform()) return false;
    const { plugin } = await loadPlugin();
    return plugin !== null;
  } catch {
    return false;
  }
}

function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function fromJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToAttempt(row: Record<string, unknown>): StoredAttempt {
  return {
    id: Number(row.id),
    sessionId: String(row.sessionId),
    questionId: String(row.questionId),
    modeId: String(row.modeId) as StoredAttempt['modeId'],
    variantId: String(row.variantId),
    prompt: String(row.prompt),
    expected: String(row.expected),
    answer: String(row.answer),
    correct: Number(row.correct) === 1,
    responseMs: Number(row.responseMs),
    source: String(row.source) as StoredAttempt['source'],
    orientation: String(row.orientation) as StoredAttempt['orientation'],
    labels: String(row.labels),
    layout: String(row.layout),
    filters: String(row.filters),
    timer: String(row.timer),
    focusSquares: fromJson(row.focusSquares, [] as StoredAttempt['focusSquares']),
    primarySquare: row.primarySquare === null ? null : (String(row.primarySquare) as never),
    missed: fromJson(row.missed, [] as StoredAttempt['missed']),
    extra: fromJson(row.extra, [] as StoredAttempt['extra']),
    timestamp: Number(row.timestamp),
    isRetry: Number(row.isRetry) === 1,
    schemaVersion: Number(row.schemaVersion),
    appVersion: String(row.appVersion),
  };
}

export class SqliteRepository implements BightRepository {
  readonly engine = 'sqlite' as const;

  private connection: SqliteConnection | null = null;

  async init(): Promise<void> {
    if (this.connection !== null) return;
    const { plugin } = await loadPlugin();
    if (plugin === null) throw new Error('Capacitor SQLite plugin is not available');

    this.connection = await plugin.createConnection(DB_NAME, false, 'no-encryption', 1, false);
    await this.connection.open();
    await this.connection.execute(SCHEMA);
  }

  private db(): SqliteConnection {
    if (this.connection === null) throw new Error('Repository used before init()');
    return this.connection;
  }

  private async select(statement: string, values: unknown[] = []): Promise<Array<Record<string, unknown>>> {
    const result = await this.db().query(statement, values);
    return (result.values ?? []) as Array<Record<string, unknown>>;
  }

  async addAttempts(sessionId: string, attempts: readonly Attempt[]): Promise<void> {
    for (const attempt of attempts) {
      await this.db().run(
        `INSERT INTO attempts (sessionId, questionId, modeId, variantId, prompt, expected, answer,
          correct, responseMs, source, orientation, labels, layout, filters, timer, focusSquares,
          primarySquare, missed, extra, timestamp, isRetry, schemaVersion, appVersion)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          sessionId,
          attempt.questionId,
          attempt.modeId,
          attempt.variantId,
          attempt.prompt,
          attempt.expected,
          attempt.answer,
          attempt.correct ? 1 : 0,
          attempt.responseMs,
          attempt.source,
          attempt.orientation,
          attempt.labels,
          attempt.layout,
          attempt.filters,
          attempt.timer,
          toJson(attempt.focusSquares),
          attempt.primarySquare,
          toJson(attempt.missed),
          toJson(attempt.extra),
          attempt.timestamp,
          attempt.isRetry ? 1 : 0,
          SCHEMA_VERSION,
          APP_VERSION,
        ],
      );
    }
  }

  async getAttempts(query: AttemptQuery = {}): Promise<StoredAttempt[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (query.modeId !== undefined) {
      clauses.push('modeId = ?');
      values.push(query.modeId);
    }
    if (query.since !== undefined) {
      clauses.push('timestamp >= ?');
      values.push(query.since);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    const limit = query.limit === undefined ? '' : ` LIMIT ${Math.max(0, Math.floor(query.limit))}`;
    const rows = await this.select(
      `SELECT * FROM attempts${where} ORDER BY timestamp DESC${limit}`,
      values,
    );
    return rows.map(rowToAttempt);
  }

  async addSession(session: StoredSession): Promise<void> {
    await this.db().run(
      `INSERT OR REPLACE INTO sessions (id, modeId, variantId, startedAt, endedAt, total, correct,
        accuracy, averageMs, medianMs, fastestCorrectMs, bestStreak, durationMs, endedEarly,
        settings, schemaVersion, appVersion)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        session.id,
        session.modeId,
        session.variantId,
        session.startedAt,
        session.endedAt,
        session.total,
        session.correct,
        session.accuracy,
        session.averageMs,
        session.medianMs,
        session.fastestCorrectMs,
        session.bestStreak,
        session.durationMs,
        session.endedEarly ? 1 : 0,
        toJson(session.settings),
        SCHEMA_VERSION,
        APP_VERSION,
      ],
    );
  }

  async getSessions(limit?: number): Promise<StoredSession[]> {
    const clause = limit === undefined ? '' : ` LIMIT ${Math.max(0, Math.floor(limit))}`;
    const rows = await this.select(`SELECT * FROM sessions ORDER BY startedAt DESC${clause}`);
    return rows.map((row) => ({
      id: String(row.id),
      modeId: String(row.modeId) as StoredSession['modeId'],
      variantId: String(row.variantId),
      startedAt: Number(row.startedAt),
      endedAt: Number(row.endedAt),
      total: Number(row.total),
      correct: Number(row.correct),
      accuracy: Number(row.accuracy),
      averageMs: Number(row.averageMs),
      medianMs: Number(row.medianMs),
      fastestCorrectMs: row.fastestCorrectMs === null ? null : Number(row.fastestCorrectMs),
      bestStreak: Number(row.bestStreak),
      durationMs: Number(row.durationMs),
      endedEarly: Number(row.endedEarly) === 1,
      settings: fromJson(row.settings, {} as StoredSession['settings']),
      schemaVersion: Number(row.schemaVersion),
      appVersion: String(row.appVersion),
    }));
  }

  async getDaily(): Promise<DailyRecord[]> {
    const rows = await this.select('SELECT * FROM daily ORDER BY date ASC');
    return rows.map((row) => ({
      date: String(row.date),
      sessions: Number(row.sessions),
      questions: Number(row.questions),
      correct: Number(row.correct),
      counted: Number(row.counted) === 1,
    }));
  }

  async upsertDaily(record: DailyRecord): Promise<void> {
    await this.db().run(
      `INSERT OR REPLACE INTO daily (date, sessions, questions, correct, counted) VALUES (?,?,?,?,?)`,
      [record.date, record.sessions, record.questions, record.correct, record.counted ? 1 : 0],
    );
  }

  async getAchievements(): Promise<AchievementRecord[]> {
    const rows = await this.select('SELECT * FROM achievements');
    return rows.map((row) => ({
      id: String(row.id),
      unlockedAt: Number(row.unlockedAt),
      progress: Number(row.progress),
    }));
  }

  async upsertAchievement(record: AchievementRecord): Promise<void> {
    await this.db().run(
      'INSERT OR REPLACE INTO achievements (id, unlockedAt, progress) VALUES (?,?,?)',
      [record.id, record.unlockedAt, record.progress],
    );
  }

  async getPersonalBests(): Promise<PersonalBest[]> {
    const rows = await this.select('SELECT * FROM personalBests');
    return rows.map((row) => ({
      key: String(row.key),
      value: Number(row.value),
      achievedAt: Number(row.achievedAt),
    }));
  }

  async upsertPersonalBest(record: PersonalBest): Promise<void> {
    await this.db().run(
      'INSERT OR REPLACE INTO personalBests (key, value, achievedAt) VALUES (?,?,?)',
      [record.key, record.value, record.achievedAt],
    );
  }

  async getPreferences(): Promise<PreferencesRecord> {
    const rows = await this.select('SELECT json FROM preferences WHERE id = 1');
    if (rows.length === 0) return defaultPreferences();
    return { ...defaultPreferences(), ...fromJson(rows[0]?.json, {}) };
  }

  async savePreferences(preferences: PreferencesRecord): Promise<void> {
    await this.db().run('INSERT OR REPLACE INTO preferences (id, json) VALUES (1, ?)', [
      toJson(preferences),
    ]);
  }

  async exportAll(): Promise<BightData> {
    return {
      attempts: await this.getAttempts(),
      sessions: await this.getSessions(),
      daily: await this.getDaily(),
      achievements: await this.getAchievements(),
      personalBests: await this.getPersonalBests(),
      preferences: await this.getPreferences(),
    };
  }

  async importAll(data: BightData): Promise<void> {
    await this.clear();
    await this.insertAll(data);
  }

  private async insertAll(data: BightData): Promise<void> {
    for (const attempt of data.attempts) {
      await this.addAttempts(attempt.sessionId ?? 'imported', [attempt]);
    }
    for (const session of data.sessions) await this.addSession(session);
    for (const day of data.daily) await this.upsertDaily(day);
    for (const achievement of data.achievements) await this.upsertAchievement(achievement);
    for (const best of data.personalBests) await this.upsertPersonalBest(best);
    await this.savePreferences(data.preferences);
  }

  async mergeAll(data: BightData): Promise<void> {
    const existing = await this.exportAll();
    const seen = new Set(existing.attempts.map((a) => `${a.questionId}@${a.timestamp}`));
    const sessionIds = new Set(existing.sessions.map((s) => s.id));

    for (const attempt of data.attempts) {
      const key = `${attempt.questionId}@${attempt.timestamp}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await this.addAttempts(attempt.sessionId ?? 'imported', [attempt]);
    }

    for (const session of data.sessions) {
      if (!sessionIds.has(session.id)) await this.addSession(session);
    }

    const existingDaily = new Map(existing.daily.map((d) => [d.date, d]));
    for (const day of data.daily) {
      const current = existingDaily.get(day.date);
      await this.upsertDaily(
        current === undefined
          ? day
          : {
              date: day.date,
              sessions: Math.max(current.sessions, day.sessions),
              questions: Math.max(current.questions, day.questions),
              correct: Math.max(current.correct, day.correct),
              counted: current.counted || day.counted,
            },
      );
    }

    const existingAchievements = new Map(existing.achievements.map((a) => [a.id, a]));
    for (const achievement of data.achievements) {
      const current = existingAchievements.get(achievement.id);
      if (current === undefined || achievement.unlockedAt < current.unlockedAt) {
        await this.upsertAchievement(achievement);
      }
    }

    const existingBests = new Map(existing.personalBests.map((b) => [b.key, b]));
    for (const best of data.personalBests) {
      const current = existingBests.get(best.key);
      if (current === undefined || isBetter(best.key, best.value, current.value)) {
        await this.upsertPersonalBest(best);
      }
    }
  }

  async clear(): Promise<void> {
    for (const table of ['attempts', 'sessions', 'daily', 'achievements', 'personalBests', 'preferences']) {
      await this.db().run(`DELETE FROM ${table}`);
    }
  }
}
