import { describe, expect, it } from 'vitest';
import {
  frequentModes,
  hasEnoughHistory,
  lastPracticedMode,
  recentModes,
  FREQUENCY_HALF_LIFE_DAYS,
  MIN_SESSION_QUESTIONS,
  RECENT_LIMIT,
} from './usage';
import { defaultSettings } from '../session/settings';
import type { StoredSession } from '../storage/types';
import type { ModeId } from '../training/types';

const T0 = new Date(2026, 6, 31, 12, 0, 0).getTime();
const DAY = 86_400_000;

function session(overrides: Partial<StoredSession> = {}): StoredSession {
  const modeId = (overrides.modeId ?? 'square-color') as ModeId;
  return {
    id: `s-${Math.random().toString(36).slice(2)}`,
    modeId,
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
    settings: defaultSettings(modeId, overrides.variantId ?? 'coordinate'),
    schemaVersion: 1,
    appVersion: '1.0.0',
    ...overrides,
  };
}

describe('recent modes', () => {
  it('orders by most recent first', () => {
    const recent = recentModes([
      session({ modeId: 'square-color', startedAt: T0 - 2 * DAY }),
      session({ modeId: 'knight-vision', variantId: 'attack-squares', startedAt: T0 }),
      session({ modeId: 'notation', variantId: 'play-the-move', startedAt: T0 - DAY }),
    ]);

    expect(recent.map((entry) => entry.modeId)).toEqual([
      'knight-vision',
      'notation',
      'square-color',
    ]);
  });

  it('deduplicates a repeated mode, keeping its most recent position', () => {
    const recent = recentModes([
      session({ modeId: 'square-color', startedAt: T0 - 5 * DAY }),
      session({ modeId: 'knight-vision', variantId: 'attack-squares', startedAt: T0 - 2 * DAY }),
      session({ modeId: 'square-color', startedAt: T0 }),
    ]);

    expect(recent).toHaveLength(2);
    expect(recent[0]!.modeId).toBe('square-color');
    expect(recent[0]!.lastUsedAt).toBe(T0);
  });

  it('treats different variants of one mode as separate entries', () => {
    const recent = recentModes([
      session({ modeId: 'knight-vision', variantId: 'attack-squares', startedAt: T0 }),
      session({ modeId: 'knight-vision', variantId: 'from-memory', startedAt: T0 - DAY }),
    ]);
    expect(recent).toHaveLength(2);
  });

  it('respects the display limit', () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      session({ modeId: 'square-color', variantId: `v${i}`, startedAt: T0 - i * 1000 }),
    );
    expect(recentModes(sessions)).toHaveLength(RECENT_LIMIT);
    expect(recentModes(sessions, 2)).toHaveLength(2);
  });

  it('excludes modes the app no longer offers', () => {
    const recent = recentModes([
      session({ modeId: 'sequence' as ModeId, startedAt: T0 }),
      session({ modeId: 'memory-square-to-coordinate' as ModeId, startedAt: T0 - 1000 }),
      session({ modeId: 'square-color', startedAt: T0 - 2000 }),
    ]);

    // A removed mode must never be offered as something to launch.
    expect(recent.map((entry) => entry.modeId)).toEqual(['square-color']);
  });

  it('includes short sessions - recency is about what you opened', () => {
    const recent = recentModes([session({ modeId: 'square-color', total: 1, startedAt: T0 })]);
    expect(recent).toHaveLength(1);
  });

  it('handles an empty history', () => {
    expect(recentModes([])).toEqual([]);
    expect(lastPracticedMode([])).toBeNull();
  });

  it('reports the most recent usable mode', () => {
    expect(
      lastPracticedMode([
        session({ modeId: 'sequence' as ModeId, startedAt: T0 }),
        session({ modeId: 'notation', variantId: 'play-the-move', startedAt: T0 - DAY }),
      ]),
    ).toEqual({ modeId: 'notation', variantId: 'play-the-move' });
  });
});

describe('frequent modes', () => {
  it('ranks by how often a mode is genuinely practiced', () => {
    const frequent = frequentModes(
      [
        session({ modeId: 'square-color', startedAt: T0 }),
        session({ modeId: 'square-color', startedAt: T0 - DAY }),
        session({ modeId: 'square-color', startedAt: T0 - 2 * DAY }),
        session({ modeId: 'knight-vision', variantId: 'attack-squares', startedAt: T0 }),
      ],
      4,
      T0,
    );

    expect(frequent[0]!.modeId).toBe('square-color');
    expect(frequent[0]!.sessions).toBe(3);
    expect(frequent[1]!.modeId).toBe('knight-vision');
  });

  it('ignores sessions too short to mean anything', () => {
    // One accidental open must not outrank real practice.
    const frequent = frequentModes(
      [
        session({ modeId: 'notation', variantId: 'play-the-move', total: MIN_SESSION_QUESTIONS - 1 }),
        session({ modeId: 'square-color', total: MIN_SESSION_QUESTIONS }),
      ],
      4,
      T0,
    );

    expect(frequent.map((entry) => entry.modeId)).toEqual(['square-color']);
  });

  it('weights recent practice above ancient practice', () => {
    const frequent = frequentModes(
      [
        // Five sessions a long time ago.
        ...Array.from({ length: 5 }, () =>
          session({ modeId: 'square-color', startedAt: T0 - 200 * DAY }),
        ),
        // Two sessions today.
        session({ modeId: 'knight-vision', variantId: 'attack-squares', startedAt: T0 }),
        session({ modeId: 'knight-vision', variantId: 'attack-squares', startedAt: T0 - 1000 }),
      ],
      4,
      T0,
    );

    expect(frequent[0]!.modeId).toBe('knight-vision');
  });

  it('halves a session\'s weight after one half-life', () => {
    const fresh = frequentModes([session({ startedAt: T0 })], 4, T0);
    const stale = frequentModes(
      [session({ startedAt: T0 - FREQUENCY_HALF_LIFE_DAYS * DAY })],
      4,
      T0,
    );
    expect(stale[0]!.score).toBeCloseTo(fresh[0]!.score / 2, 5);
  });

  it('does not let old practice vanish entirely', () => {
    const frequent = frequentModes([session({ startedAt: T0 - 100 * DAY })], 4, T0);
    expect(frequent).toHaveLength(1);
    expect(frequent[0]!.score).toBeGreaterThan(0);
  });

  it('excludes removed modes', () => {
    const frequent = frequentModes(
      [
        session({ modeId: 'sequence' as ModeId, startedAt: T0 }),
        session({ modeId: 'square-color', startedAt: T0 }),
      ],
      4,
      T0,
    );
    expect(frequent.map((entry) => entry.modeId)).toEqual(['square-color']);
  });

  it('respects the display limit', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session({ modeId: 'square-color', variantId: `v${i}`, startedAt: T0 - i * DAY }),
    );
    expect(frequentModes(sessions, 3, T0)).toHaveLength(3);
  });

  it('accumulates question counts per entry', () => {
    const frequent = frequentModes(
      [session({ total: 20, startedAt: T0 }), session({ total: 30, startedAt: T0 - DAY })],
      4,
      T0,
    );
    expect(frequent[0]!.questions).toBe(50);
  });
});

describe('fresh-install behaviour', () => {
  it('reports no history when nothing has been practiced', () => {
    expect(hasEnoughHistory([])).toBe(false);
  });

  it('reports no history when only trivial sessions exist', () => {
    expect(hasEnoughHistory([session({ total: 1 })])).toBe(false);
  });

  it('reports no history when only removed modes were used', () => {
    expect(hasEnoughHistory([session({ modeId: 'sequence' as ModeId, total: 50 })])).toBe(false);
  });

  it('reports history once a real session exists', () => {
    expect(hasEnoughHistory([session({ total: MIN_SESSION_QUESTIONS })])).toBe(true);
  });
});
