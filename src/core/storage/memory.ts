/**
 * In-memory repository.
 *
 * Used by tests, and as the last-resort fallback when neither SQLite nor
 * IndexedDB is available. Training still works in that case; only persistence
 * across restarts is lost, and the UI says so rather than failing silently.
 */

import type { Attempt } from '../session/engine';
import { APP_VERSION } from '../version';
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

export class MemoryRepository implements BightRepository {
  readonly engine = 'memory' as const;

  private attempts: StoredAttempt[] = [];
  private sessions: StoredSession[] = [];
  private daily = new Map<string, DailyRecord>();
  private achievements = new Map<string, AchievementRecord>();
  private personalBests = new Map<string, PersonalBest>();
  private preferences: PreferencesRecord = defaultPreferences();
  private nextId = 1;

  async init(): Promise<void> {
    // Nothing to open.
  }

  async addAttempts(sessionId: string, attempts: readonly Attempt[]): Promise<void> {
    for (const attempt of attempts) {
      this.attempts.push({
        ...attempt,
        id: this.nextId,
        sessionId,
        schemaVersion: SCHEMA_VERSION,
        appVersion: APP_VERSION,
      });
      this.nextId += 1;
    }
  }

  async getAttempts(query: AttemptQuery = {}): Promise<StoredAttempt[]> {
    let rows = this.attempts;
    if (query.modeId !== undefined) rows = rows.filter((a) => a.modeId === query.modeId);
    if (query.since !== undefined) rows = rows.filter((a) => a.timestamp >= (query.since as number));
    rows = [...rows].sort((a, b) => b.timestamp - a.timestamp);
    return query.limit === undefined ? rows : rows.slice(0, query.limit);
  }

  async addSession(session: StoredSession): Promise<void> {
    this.sessions.push(session);
  }

  async getSessions(limit?: number): Promise<StoredSession[]> {
    const rows = [...this.sessions].sort((a, b) => b.startedAt - a.startedAt);
    return limit === undefined ? rows : rows.slice(0, limit);
  }

  async getDaily(): Promise<DailyRecord[]> {
    return [...this.daily.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  async upsertDaily(record: DailyRecord): Promise<void> {
    this.daily.set(record.date, record);
  }

  async getAchievements(): Promise<AchievementRecord[]> {
    return [...this.achievements.values()];
  }

  async upsertAchievement(record: AchievementRecord): Promise<void> {
    this.achievements.set(record.id, record);
  }

  async getPersonalBests(): Promise<PersonalBest[]> {
    return [...this.personalBests.values()];
  }

  async upsertPersonalBest(record: PersonalBest): Promise<void> {
    this.personalBests.set(record.key, record);
  }

  async getPreferences(): Promise<PreferencesRecord> {
    // Spread over defaults so a preference added in a later version is present,
    // matching IndexedDbRepository exactly.
    return { ...defaultPreferences(), ...this.preferences };
  }

  async savePreferences(preferences: PreferencesRecord): Promise<void> {
    this.preferences = { ...preferences };
  }

  async exportAll(): Promise<BightData> {
    return {
      attempts: [...this.attempts],
      sessions: [...this.sessions],
      daily: await this.getDaily(),
      achievements: await this.getAchievements(),
      personalBests: await this.getPersonalBests(),
      preferences: { ...this.preferences },
    };
  }

  async importAll(data: BightData): Promise<void> {
    this.attempts = [...data.attempts];
    this.sessions = [...data.sessions];
    this.daily = new Map(data.daily.map((d) => [d.date, d]));
    this.achievements = new Map(data.achievements.map((a) => [a.id, a]));
    this.personalBests = new Map(data.personalBests.map((p) => [p.key, p]));
    this.preferences = { ...data.preferences };
    this.nextId = Math.max(0, ...this.attempts.map((a) => a.id)) + 1;
  }

  /**
   * Merge keeps existing history and adds only what is genuinely new.
   * Attempts are identified by (questionId, timestamp), which is stable across
   * devices and prevents importing the same history twice.
   */
  async mergeAll(data: BightData): Promise<void> {
    const seen = new Set(this.attempts.map((a) => `${a.questionId}@${a.timestamp}`));
    for (const attempt of data.attempts) {
      const key = `${attempt.questionId}@${attempt.timestamp}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.attempts.push({ ...attempt, id: this.nextId });
      this.nextId += 1;
    }

    const sessionIds = new Set(this.sessions.map((s) => s.id));
    for (const session of data.sessions) {
      if (!sessionIds.has(session.id)) this.sessions.push(session);
    }

    for (const day of data.daily) {
      const existing = this.daily.get(day.date);
      this.daily.set(
        day.date,
        existing === undefined
          ? day
          : {
              date: day.date,
              sessions: Math.max(existing.sessions, day.sessions),
              questions: Math.max(existing.questions, day.questions),
              correct: Math.max(existing.correct, day.correct),
              counted: existing.counted || day.counted,
            },
      );
    }

    for (const achievement of data.achievements) {
      const existing = this.achievements.get(achievement.id);
      if (existing === undefined || achievement.unlockedAt < existing.unlockedAt) {
        this.achievements.set(achievement.id, achievement);
      }
    }

    for (const best of data.personalBests) {
      const existing = this.personalBests.get(best.key);
      if (existing === undefined || isBetter(best.key, best.value, existing.value)) {
        this.personalBests.set(best.key, best);
      }
    }
  }

  async clear(): Promise<void> {
    this.attempts = [];
    this.sessions = [];
    this.daily.clear();
    this.achievements.clear();
    this.personalBests.clear();
    this.preferences = defaultPreferences();
    this.nextId = 1;
  }
}

/** Time-based bests improve downward; everything else improves upward. */
export function isBetter(key: string, candidate: number, current: number): boolean {
  const lowerIsBetter = key.includes('fastest') || key.includes('time');
  return lowerIsBetter ? candidate < current : candidate > current;
}
