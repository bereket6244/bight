/**
 * The persistence contract.
 *
 * Training code never talks to IndexedDB or SQLite directly - it talks to a
 * `BightRepository`. That is what lets the SQLite plugin fail on a device and
 * fall back to IndexedDB without any mode noticing, and what keeps the backup
 * format independent of the storage engine.
 */

import type { Attempt } from '../session/engine';
import type { SessionSettings } from '../session/settings';
import type { ModeId } from '../training/types';

/**
 * Bumped whenever the stored shape changes. Backups carry this number and the
 * migration framework upgrades older ones on import.
 */
export const SCHEMA_VERSION = 1;

export interface StoredAttempt extends Attempt {
  /** Auto-assigned, monotonic within a store. */
  id: number;
  sessionId: string;
  schemaVersion: number;
  appVersion: string;
}

export interface StoredSession {
  id: string;
  modeId: ModeId;
  variantId: string;
  startedAt: number;
  endedAt: number;
  total: number;
  correct: number;
  accuracy: number;
  averageMs: number;
  medianMs: number;
  fastestCorrectMs: number | null;
  bestStreak: number;
  durationMs: number;
  endedEarly: boolean;
  /** Serialised settings, so a session can be repeated exactly. */
  settings: SessionSettings;
  schemaVersion: number;
  appVersion: string;
}

/** One row per day the user practiced, in the device's local timezone. */
export interface DailyRecord {
  /** Local date as YYYY-MM-DD. */
  date: string;
  sessions: number;
  questions: number;
  correct: number;
  /** True once the day met the streak threshold. */
  counted: boolean;
}

export interface AchievementRecord {
  id: string;
  unlockedAt: number;
  /** Progress toward the achievement, for partially-earned ones. */
  progress: number;
}

export interface PersonalBest {
  key: string;
  value: number;
  achievedAt: number;
}

export interface PreferencesRecord {
  theme: 'dark' | 'light' | 'system';
  boardTheme: string;
  pieceSet: string;
  sound: boolean;
  haptics: boolean;
  speakPrompts: boolean;
  voiceInput: boolean;
  /** Daily goal in scored questions. */
  dailyGoal: number;
  /** Last mode the user practiced, restored on next launch. */
  lastModeId: ModeId | null;
  lastVariantId: string | null;
  /** Whether the first-run explanation has been dismissed. */
  onboarded: boolean;
  /** Per-mode saved session settings. */
  savedSettings: Partial<Record<ModeId, SessionSettings>>;
}

export function defaultPreferences(): PreferencesRecord {
  return {
    theme: 'dark',
    boardTheme: 'green',
    pieceSet: 'bight',
    sound: true,
    haptics: true,
    speakPrompts: false,
    voiceInput: false,
    dailyGoal: 40,
    lastModeId: null,
    lastVariantId: null,
    onboarded: false,
    savedSettings: {},
  };
}

/** Everything a backup contains, and everything the repository can restore. */
export interface BightData {
  attempts: StoredAttempt[];
  sessions: StoredSession[];
  daily: DailyRecord[];
  achievements: AchievementRecord[];
  personalBests: PersonalBest[];
  preferences: PreferencesRecord;
}

export interface AttemptQuery {
  modeId?: ModeId;
  since?: number;
  limit?: number;
}

export interface BightRepository {
  /** Human-readable name of the backing engine, shown in Settings. */
  readonly engine: 'sqlite' | 'indexeddb' | 'memory';

  init(): Promise<void>;

  addAttempts(sessionId: string, attempts: readonly Attempt[]): Promise<void>;
  getAttempts(query?: AttemptQuery): Promise<StoredAttempt[]>;

  addSession(session: StoredSession): Promise<void>;
  getSessions(limit?: number): Promise<StoredSession[]>;

  getDaily(): Promise<DailyRecord[]>;
  upsertDaily(record: DailyRecord): Promise<void>;

  getAchievements(): Promise<AchievementRecord[]>;
  upsertAchievement(record: AchievementRecord): Promise<void>;

  getPersonalBests(): Promise<PersonalBest[]>;
  upsertPersonalBest(record: PersonalBest): Promise<void>;

  getPreferences(): Promise<PreferencesRecord>;
  savePreferences(preferences: PreferencesRecord): Promise<void>;

  /** Full export, used by the backup service. */
  exportAll(): Promise<BightData>;
  /**
   * Full replace. The backup service takes a snapshot first, so this is only
   * ever called with validated data.
   */
  importAll(data: BightData): Promise<void>;
  /** Merge without losing existing history. */
  mergeAll(data: BightData): Promise<void>;

  clear(): Promise<void>;
}

/** Local date key (YYYY-MM-DD) for streaks, in the device's own timezone. */
export function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Parses a YYYY-MM-DD key back to local midnight. */
export function dateKeyToTimestamp(key: string): number {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year as number, (month as number) - 1, day as number).getTime();
}

/** Whole days between two local date keys. */
export function daysBetween(earlier: string, later: string): number {
  const ms = dateKeyToTimestamp(later) - dateKeyToTimestamp(earlier);
  return Math.round(ms / 86_400_000);
}
