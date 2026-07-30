/**
 * What the user actually practices, derived from local session history.
 *
 * This replaces the hard-coded "Recommended" list, which was the same four
 * modes for everyone and reflected nothing about the person using the app.
 *
 * Both sections are computed from completed sessions only, so opening a mode
 * and immediately backing out never shapes the home screen. Everything is
 * local: there is no profile, no server and no model — just counting.
 */

import { isActiveMode } from '../training/registry';
import type { ModeId } from '../training/types';
import type { StoredSession } from '../storage/types';

/** How many entries each home section shows. */
export const RECENT_LIMIT = 5;
export const FREQUENT_LIMIT = 4;

/**
 * A session must be at least this long to count toward frequency.
 *
 * Without it, starting a mode and answering one question would rank it
 * alongside a mode genuinely practiced for twenty minutes.
 */
export const MIN_SESSION_QUESTIONS = 5;

/** Frequency weight halves after this many days. */
export const FREQUENCY_HALF_LIFE_DAYS = 21;

export interface ModeUsage {
  modeId: ModeId;
  variantId: string;
  /** Sessions that met the minimum length. */
  sessions: number;
  questions: number;
  lastUsedAt: number;
  /** Recency-weighted score used for ranking. */
  score: number;
}

function key(modeId: string, variantId: string): string {
  return `${modeId}:${variantId}`;
}

/** Only sessions for modes the app still offers. */
function usableSessions(sessions: readonly StoredSession[]): StoredSession[] {
  return sessions.filter((session) => isActiveMode(session.modeId));
}

/**
 * Most recently practiced mode/variant pairs, newest first.
 *
 * Deduplicated on the pair while keeping the most recent position, so a mode
 * practiced this morning and last week appears once, at the top.
 */
export function recentModes(
  sessions: readonly StoredSession[],
  limit = RECENT_LIMIT,
): Array<{ modeId: ModeId; variantId: string; lastUsedAt: number }> {
  const seen = new Set<string>();
  const out: Array<{ modeId: ModeId; variantId: string; lastUsedAt: number }> = [];

  const ordered = [...usableSessions(sessions)].sort((a, b) => b.startedAt - a.startedAt);

  for (const session of ordered) {
    const id = key(session.modeId, session.variantId);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      modeId: session.modeId,
      variantId: session.variantId,
      lastUsedAt: session.startedAt,
    });
    if (out.length >= limit) break;
  }

  return out;
}

/**
 * Frequency ranking, weighted toward recent practice.
 *
 * A session contributes `0.5 ^ (ageInDays / halfLife)`, so a month of daily
 * practice outranks a single marathon from last year without erasing it
 * entirely. Deliberately simple and explainable rather than pretending to be
 * clever.
 */
export function frequentModes(
  sessions: readonly StoredSession[],
  limit = FREQUENT_LIMIT,
  now: number = Date.now(),
): ModeUsage[] {
  const byKey = new Map<string, ModeUsage>();

  for (const session of usableSessions(sessions)) {
    if (session.total < MIN_SESSION_QUESTIONS) continue;

    const id = key(session.modeId, session.variantId);
    const ageDays = Math.max(0, (now - session.startedAt) / 86_400_000);
    const weight = Math.pow(0.5, ageDays / FREQUENCY_HALF_LIFE_DAYS);

    const existing = byKey.get(id);
    if (existing === undefined) {
      byKey.set(id, {
        modeId: session.modeId,
        variantId: session.variantId,
        sessions: 1,
        questions: session.total,
        lastUsedAt: session.startedAt,
        score: weight,
      });
    } else {
      existing.sessions += 1;
      existing.questions += session.total;
      existing.lastUsedAt = Math.max(existing.lastUsedAt, session.startedAt);
      existing.score += weight;
    }
  }

  return [...byKey.values()]
    .sort((a, b) => b.score - a.score || b.lastUsedAt - a.lastUsedAt)
    .slice(0, limit);
}

/**
 * Whether there is enough history to show personalized sections at all.
 * Below this the home screen shows a plain "Start here" list instead of
 * dressing up defaults as recommendations.
 */
export function hasEnoughHistory(sessions: readonly StoredSession[]): boolean {
  return usableSessions(sessions).some((session) => session.total >= MIN_SESSION_QUESTIONS);
}

/** The most recent still-available mode, for the "carry on" entry. */
export function lastPracticedMode(
  sessions: readonly StoredSession[],
): { modeId: ModeId; variantId: string } | null {
  const recent = recentModes(sessions, 1);
  return recent.length === 0
    ? null
    : { modeId: recent[0]!.modeId, variantId: recent[0]!.variantId };
}
