/**
 * IndexedDB repository.
 *
 * This is the fallback engine when the Capacitor SQLite plugin is unavailable,
 * and the primary engine in a browser. It implements exactly the same contract
 * as the SQLite repository, so nothing above the storage layer can tell them
 * apart beyond the `engine` label shown in Settings.
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
const DB_VERSION = 1;

const STORE_ATTEMPTS = 'attempts';
const STORE_SESSIONS = 'sessions';
const STORE_DAILY = 'daily';
const STORE_ACHIEVEMENTS = 'achievements';
const STORE_BESTS = 'personalBests';
const STORE_PREFERENCES = 'preferences';
const PREFERENCES_KEY = 'singleton';

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export function indexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

export class IndexedDbRepository implements BightRepository {
  readonly engine = 'indexeddb' as const;

  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db !== null) return;
    if (!indexedDbAvailable()) throw new Error('IndexedDB is not available');

    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_ATTEMPTS)) {
          const store = db.createObjectStore(STORE_ATTEMPTS, {
            keyPath: 'id',
            autoIncrement: true,
          });
          store.createIndex('timestamp', 'timestamp');
          store.createIndex('modeId', 'modeId');
        }
        if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
          const store = db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
          store.createIndex('startedAt', 'startedAt');
        }
        if (!db.objectStoreNames.contains(STORE_DAILY)) {
          db.createObjectStore(STORE_DAILY, { keyPath: 'date' });
        }
        if (!db.objectStoreNames.contains(STORE_ACHIEVEMENTS)) {
          db.createObjectStore(STORE_ACHIEVEMENTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_BESTS)) {
          db.createObjectStore(STORE_BESTS, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_PREFERENCES)) {
          db.createObjectStore(STORE_PREFERENCES);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
    });
  }

  private requireDb(): IDBDatabase {
    if (this.db === null) throw new Error('Repository used before init()');
    return this.db;
  }

  private async readAll<T>(storeName: string): Promise<T[]> {
    const tx = this.requireDb().transaction(storeName, 'readonly');
    const rows = await promisify(tx.objectStore(storeName).getAll() as IDBRequest<T[]>);
    return rows;
  }

  async addAttempts(sessionId: string, attempts: readonly Attempt[]): Promise<void> {
    if (attempts.length === 0) return;
    const tx = this.requireDb().transaction(STORE_ATTEMPTS, 'readwrite');
    const store = tx.objectStore(STORE_ATTEMPTS);
    for (const attempt of attempts) {
      // `id` is omitted so IndexedDB assigns the auto-increment key.
      store.add({
        ...attempt,
        sessionId,
        schemaVersion: SCHEMA_VERSION,
        appVersion: APP_VERSION,
      });
    }
    await transactionDone(tx);
  }

  async getAttempts(query: AttemptQuery = {}): Promise<StoredAttempt[]> {
    let rows = await this.readAll<StoredAttempt>(STORE_ATTEMPTS);
    if (query.modeId !== undefined) rows = rows.filter((a) => a.modeId === query.modeId);
    if (query.since !== undefined) rows = rows.filter((a) => a.timestamp >= (query.since as number));
    rows.sort((a, b) => b.timestamp - a.timestamp);
    return query.limit === undefined ? rows : rows.slice(0, query.limit);
  }

  async addSession(session: StoredSession): Promise<void> {
    const tx = this.requireDb().transaction(STORE_SESSIONS, 'readwrite');
    tx.objectStore(STORE_SESSIONS).put(session);
    await transactionDone(tx);
  }

  async getSessions(limit?: number): Promise<StoredSession[]> {
    const rows = await this.readAll<StoredSession>(STORE_SESSIONS);
    rows.sort((a, b) => b.startedAt - a.startedAt);
    return limit === undefined ? rows : rows.slice(0, limit);
  }

  async getDaily(): Promise<DailyRecord[]> {
    const rows = await this.readAll<DailyRecord>(STORE_DAILY);
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }

  async upsertDaily(record: DailyRecord): Promise<void> {
    const tx = this.requireDb().transaction(STORE_DAILY, 'readwrite');
    tx.objectStore(STORE_DAILY).put(record);
    await transactionDone(tx);
  }

  async getAchievements(): Promise<AchievementRecord[]> {
    return this.readAll<AchievementRecord>(STORE_ACHIEVEMENTS);
  }

  async upsertAchievement(record: AchievementRecord): Promise<void> {
    const tx = this.requireDb().transaction(STORE_ACHIEVEMENTS, 'readwrite');
    tx.objectStore(STORE_ACHIEVEMENTS).put(record);
    await transactionDone(tx);
  }

  async getPersonalBests(): Promise<PersonalBest[]> {
    return this.readAll<PersonalBest>(STORE_BESTS);
  }

  async upsertPersonalBest(record: PersonalBest): Promise<void> {
    const tx = this.requireDb().transaction(STORE_BESTS, 'readwrite');
    tx.objectStore(STORE_BESTS).put(record);
    await transactionDone(tx);
  }

  async getPreferences(): Promise<PreferencesRecord> {
    const tx = this.requireDb().transaction(STORE_PREFERENCES, 'readonly');
    const stored = await promisify(
      tx.objectStore(STORE_PREFERENCES).get(PREFERENCES_KEY) as IDBRequest<PreferencesRecord>,
    );
    // Spread over defaults so a preference added in a later version is present.
    return stored === undefined ? defaultPreferences() : { ...defaultPreferences(), ...stored };
  }

  async savePreferences(preferences: PreferencesRecord): Promise<void> {
    const tx = this.requireDb().transaction(STORE_PREFERENCES, 'readwrite');
    tx.objectStore(STORE_PREFERENCES).put(preferences, PREFERENCES_KEY);
    await transactionDone(tx);
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
    const db = this.requireDb();
    const tx = db.transaction(
      [STORE_ATTEMPTS, STORE_SESSIONS, STORE_DAILY, STORE_ACHIEVEMENTS, STORE_BESTS, STORE_PREFERENCES],
      'readwrite',
    );
    const attempts = tx.objectStore(STORE_ATTEMPTS);
    for (const attempt of data.attempts) attempts.put(attempt);
    const sessions = tx.objectStore(STORE_SESSIONS);
    for (const session of data.sessions) sessions.put(session);
    const daily = tx.objectStore(STORE_DAILY);
    for (const day of data.daily) daily.put(day);
    const achievements = tx.objectStore(STORE_ACHIEVEMENTS);
    for (const achievement of data.achievements) achievements.put(achievement);
    const bests = tx.objectStore(STORE_BESTS);
    for (const best of data.personalBests) bests.put(best);
    tx.objectStore(STORE_PREFERENCES).put(data.preferences, PREFERENCES_KEY);
    await transactionDone(tx);
  }

  async mergeAll(data: BightData): Promise<void> {
    const existing = await this.exportAll();
    const seen = new Set(existing.attempts.map((a) => `${a.questionId}@${a.timestamp}`));
    const sessionIds = new Set(existing.sessions.map((s) => s.id));

    const tx = this.requireDb().transaction(
      [STORE_ATTEMPTS, STORE_SESSIONS, STORE_DAILY, STORE_ACHIEVEMENTS, STORE_BESTS],
      'readwrite',
    );

    const attempts = tx.objectStore(STORE_ATTEMPTS);
    for (const attempt of data.attempts) {
      const key = `${attempt.questionId}@${attempt.timestamp}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const { id: _ignored, ...rest } = attempt;
      void _ignored;
      attempts.add(rest as StoredAttempt);
    }

    const sessions = tx.objectStore(STORE_SESSIONS);
    for (const session of data.sessions) {
      if (!sessionIds.has(session.id)) sessions.put(session);
    }

    const dailyStore = tx.objectStore(STORE_DAILY);
    const existingDaily = new Map(existing.daily.map((d) => [d.date, d]));
    for (const day of data.daily) {
      const current = existingDaily.get(day.date);
      dailyStore.put(
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

    const achievementStore = tx.objectStore(STORE_ACHIEVEMENTS);
    const existingAchievements = new Map(existing.achievements.map((a) => [a.id, a]));
    for (const achievement of data.achievements) {
      const current = existingAchievements.get(achievement.id);
      if (current === undefined || achievement.unlockedAt < current.unlockedAt) {
        achievementStore.put(achievement);
      }
    }

    const bestStore = tx.objectStore(STORE_BESTS);
    const existingBests = new Map(existing.personalBests.map((b) => [b.key, b]));
    for (const best of data.personalBests) {
      const current = existingBests.get(best.key);
      if (current === undefined || isBetter(best.key, best.value, current.value)) {
        bestStore.put(best);
      }
    }

    await transactionDone(tx);
  }

  async clear(): Promise<void> {
    const db = this.requireDb();
    const stores = [
      STORE_ATTEMPTS,
      STORE_SESSIONS,
      STORE_DAILY,
      STORE_ACHIEVEMENTS,
      STORE_BESTS,
      STORE_PREFERENCES,
    ];
    const tx = db.transaction(stores, 'readwrite');
    for (const store of stores) tx.objectStore(store).clear();
    await transactionDone(tx);
  }

  /** Closes the connection; used by tests and when switching engines. */
  close(): void {
    this.db?.close();
    this.db = null;
  }
}
