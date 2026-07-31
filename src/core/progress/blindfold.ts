/**
 * Blindfold progress, deliberately kept apart from square mastery.
 *
 * A blindfold attempt names squares — "where is the knight that started on
 * g1" has an answer of e5 — but getting it wrong says nothing about whether
 * the user knows where e5 is. It says they lost track of a piece. Folding
 * those attempts into the per-square model would make the board look weak in
 * places the user knows perfectly well, and would then feed that error back
 * through adaptive practice.
 *
 * So blindfold results are measured on their own terms: how long a sequence
 * the user can hold, how much of the board they needed to see, and how much of
 * that was unaided.
 */

import type { StoredAttempt } from '../storage/types';

/** Mode ids whose attempts belong to this model and to no other. */
export const BLINDFOLD_MODE_IDS: readonly string[] = Object.freeze([
  'blindfold-tracking',
  'blindfold-reconstruction',
  'blindfold-progressive',
]);

export function isBlindfoldMode(modeId: string): boolean {
  return BLINDFOLD_MODE_IDS.includes(modeId);
}

/** Attempts that belong to the square-mastery model — everything else. */
export function excludeBlindfold(attempts: readonly StoredAttempt[]): StoredAttempt[] {
  return attempts.filter((attempt) => !isBlindfoldMode(attempt.modeId));
}

export function onlyBlindfold(attempts: readonly StoredAttempt[]): StoredAttempt[] {
  return attempts.filter((attempt) => isBlindfoldMode(attempt.modeId));
}

export interface BlindfoldTally {
  attempts: number;
  correct: number;
  accuracy: number;
  /** Attempts answered without taking a hint. */
  unaided: number;
  unaidedCorrect: number;
  /**
   * Accuracy counting only unaided answers.
   *
   * Reported separately rather than as a penalty: a hinted answer is not a
   * mistake, it is simply not evidence of unaided recall.
   */
  unaidedAccuracy: number;
  hintsTaken: number;
  medianMs: number | null;
}

export interface BlindfoldProgress {
  overall: BlindfoldTally;
  byMode: Map<string, BlindfoldTally>;
  /**
   * Accuracy against sequence length in plies, which is the honest measure of
   * how far the skill actually reaches.
   */
  byLength: Map<number, BlindfoldTally>;
  /** Accuracy against how much of the board the user was shown. */
  byVisibility: Map<string, BlindfoldTally>;
  /** Accuracy per question kind: piece location, occupancy, captures, … */
  byKind: Map<string, BlindfoldTally>;
  /** Accuracy from each side of the board. */
  byOrientation: Map<string, BlindfoldTally>;
  /**
   * The longest sequence answered correctly at least `PROVEN_ATTEMPTS` times
   * without hints, or null before there is enough evidence. Deliberately not
   * "the longest they ever got right once".
   */
  provenPlies: number | null;
  /** Distinct sessions and distinct local days with blindfold practice. */
  sessions: number;
  days: number;
  /** Accuracy over the most recent `RETENTION_WINDOW` attempts. */
  recentAccuracy: number | null;
  /** Milliseconds since the last blindfold attempt, or null if there is none. */
  sinceLastMs: number | null;
  recommendation: BlindfoldRecommendation;
}

/**
 * What to practice next, derived only from the numbers above.
 *
 * Every recommendation names the evidence that produced it, because a
 * suggestion the user cannot check is indistinguishable from a guess.
 */
export interface BlindfoldRecommendation {
  action: 'start' | 'more-evidence' | 'hold' | 'longer' | 'less-board' | 'weakest-kind';
  headline: string;
  because: string;
  /** Where the recommendation points, when it points at something concrete. */
  plies?: number;
  visibility?: string;
  kind?: string;
}

/** Correct unaided answers needed at a length before it counts as proven. */
export const PROVEN_ATTEMPTS = 5;
/** Accuracy needed at that length as well, so volume alone is not enough. */
export const PROVEN_ACCURACY = 0.7;

function emptyTally(): BlindfoldTally {
  return {
    attempts: 0,
    correct: 0,
    accuracy: 0,
    unaided: 0,
    unaidedCorrect: 0,
    unaidedAccuracy: 0,
    hintsTaken: 0,
    medianMs: null,
  };
}

interface Accumulator {
  tally: BlindfoldTally;
  times: number[];
}

function accumulate(store: Map<string | number, Accumulator>, key: string | number, attempt: StoredAttempt): void {
  let entry = store.get(key);
  if (entry === undefined) {
    entry = { tally: emptyTally(), times: [] };
    store.set(key, entry);
  }
  const hints = attempt.hintsUsed ?? 0;
  entry.tally.attempts += 1;
  entry.tally.hintsTaken += hints;
  if (attempt.correct) entry.tally.correct += 1;
  if (hints === 0) {
    entry.tally.unaided += 1;
    if (attempt.correct) entry.tally.unaidedCorrect += 1;
  }
  if (attempt.correct) entry.times.push(attempt.responseMs);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2)
    : (sorted[middle] as number);
}

function finish(entry: Accumulator): BlindfoldTally {
  const tally = entry.tally;
  return {
    ...tally,
    accuracy: tally.attempts === 0 ? 0 : tally.correct / tally.attempts,
    unaidedAccuracy: tally.unaided === 0 ? 0 : tally.unaidedCorrect / tally.unaided,
    medianMs: median(entry.times),
  };
}

function harvest<K extends string | number>(
  store: Map<string | number, Accumulator>,
): Map<K, BlindfoldTally> {
  const out = new Map<K, BlindfoldTally>();
  for (const [key, entry] of store) out.set(key as K, finish(entry));
  return out;
}

/**
 * How long the sequence was, and how much of the board was shown.
 *
 * Both are optional on the attempt, so anything written before this pass —
 * including an imported backup from an earlier version — reads back as null
 * rather than as a wrong number.
 */
export function pliesOf(attempt: StoredAttempt): number | null {
  return typeof attempt.plies === 'number' && Number.isFinite(attempt.plies)
    ? attempt.plies
    : null;
}

export function visibilityOf(attempt: StoredAttempt): string | null {
  return typeof attempt.boardVisibility === 'string' ? attempt.boardVisibility : null;
}

export function kindOf(attempt: StoredAttempt): string | null {
  const kind = attempt.blindfoldKind;
  return typeof kind === 'string' && kind !== 'unknown' ? kind : null;
}

/** Human wording for a question kind, used by Progress. */
export const KIND_LABELS: Record<string, string> = {
  'piece-location': 'Where a piece ended',
  'square-contents': 'What is on a square',
  occupancy: 'Occupied or empty',
  'side-to-move': 'Whose move',
  'was-captured': 'Still on the board',
  'what-was-captured': 'What was taken',
  attacks: 'What attacks what',
  'partial-reconstruction': 'Rebuild some pieces',
  'full-reconstruction': 'Rebuild the position',
  'correction-reconstruction': 'Repair a position',
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

/** Attempts considered "recent" for retention. */
export const RETENTION_WINDOW = 20;
/** Below this, a stage is not being held and should not be pushed further. */
export const COMFORTABLE_ACCURACY = 0.8;
/** Attempts at a length before its accuracy is worth acting on. */
export const RECOMMENDATION_SAMPLE = 10;

/** Visibility stages from most help to none, for "take more board away". */
const VISIBILITY_LADDER: readonly string[] = Object.freeze([
  'always',
  'each-ply',
  'each-move',
  'every-four',
  'checkpoint-flash',
  'start-only',
  'never',
]);

function localDay(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/**
 * Turns the tallies into one suggestion.
 *
 * The rules are deliberately dull and in a fixed order: no evidence, not
 * enough evidence, not holding the current level, holding it with the board
 * still on, holding it without the board. Nothing here models the user; it
 * only reads what they have already done.
 */
function recommend(
  progress: Omit<BlindfoldProgress, 'recommendation'>,
): BlindfoldRecommendation {
  if (progress.overall.attempts === 0) {
    return {
      action: 'start',
      headline: 'Start with a four-ply sequence',
      because: 'No blindfold practice recorded yet.',
      plies: 4,
    };
  }

  // The length most recently practiced enough to say anything about.
  const lengths = [...progress.byLength.entries()].sort((a, b) => b[0] - a[0]);
  const current = lengths.find(([, tally]) => tally.attempts >= RECOMMENDATION_SAMPLE);

  if (current === undefined) {
    const longest = lengths[0];
    return {
      action: 'more-evidence',
      headline: 'Keep going at this length',
      because: `Fewer than ${RECOMMENDATION_SAMPLE} attempts so far at any one sequence length.`,
      plies: longest?.[0],
    };
  }

  const [plies, tally] = current;

  if (tally.unaidedAccuracy < COMFORTABLE_ACCURACY) {
    // Point at the weakest question kind, which is more useful than "try
    // harder" — but only when there is enough of it to mean something.
    const weakest = [...progress.byKind.entries()]
      .filter(([, entry]) => entry.attempts >= RECOMMENDATION_SAMPLE)
      .sort((a, b) => a[1].accuracy - b[1].accuracy)[0];

    if (weakest !== undefined && weakest[1].accuracy < COMFORTABLE_ACCURACY) {
      return {
        action: 'weakest-kind',
        headline: `Work on “${kindLabel(weakest[0])}”`,
        because: `${Math.round(weakest[1].accuracy * 100)}% correct over ${weakest[1].attempts} of those, against ${Math.round(tally.unaidedAccuracy * 100)}% overall at ${plies} plies.`,
        kind: weakest[0],
        plies,
      };
    }

    return {
      action: 'hold',
      headline: `Stay at ${plies} plies for now`,
      because: `${Math.round(tally.unaidedAccuracy * 100)}% correct without hints over ${tally.attempts} attempts, below the ${Math.round(COMFORTABLE_ACCURACY * 100)}% this looks for.`,
      plies,
    };
  }

  // Holding this length. Take the board away before making it longer: seeing
  // less is the harder half of the skill, and it does not add memory load.
  const visibilities = [...progress.byVisibility.entries()]
    .filter(([, entry]) => entry.attempts > 0)
    .sort(
      (a, b) => VISIBILITY_LADDER.indexOf(b[0]) - VISIBILITY_LADDER.indexOf(a[0]),
    );
  const hardestUsed = visibilities[0]?.[0];
  const hardestIndex = hardestUsed === undefined ? -1 : VISIBILITY_LADDER.indexOf(hardestUsed);

  if (hardestIndex >= 0 && hardestIndex < VISIBILITY_LADDER.length - 1) {
    const next = VISIBILITY_LADDER[hardestIndex + 1] as string;
    return {
      action: 'less-board',
      headline: 'Take more of the board away',
      because: `${Math.round(tally.unaidedAccuracy * 100)}% without hints at ${plies} plies, with the board still shown.`,
      visibility: next,
      plies,
    };
  }

  return {
    action: 'longer',
    headline: `Try ${plies + 4} plies`,
    because: `${Math.round(tally.unaidedAccuracy * 100)}% without hints over ${tally.attempts} attempts at ${plies}, with no board.`,
    plies: plies + 4,
  };
}

export function blindfoldProgress(
  attempts: readonly StoredAttempt[],
  now: number = Date.now(),
): BlindfoldProgress {
  const blindfold = onlyBlindfold(attempts);

  const overall = new Map<string | number, Accumulator>();
  const byMode = new Map<string | number, Accumulator>();
  const byLength = new Map<string | number, Accumulator>();
  const byVisibility = new Map<string | number, Accumulator>();
  const byKind = new Map<string | number, Accumulator>();
  const byOrientation = new Map<string | number, Accumulator>();

  const sessions = new Set<string>();
  const days = new Set<string>();
  let lastAt: number | null = null;

  for (const attempt of blindfold) {
    accumulate(overall, 'all', attempt);
    accumulate(byMode, attempt.modeId, attempt);
    accumulate(byOrientation, attempt.orientation, attempt);

    const plies = pliesOf(attempt);
    if (plies !== null) accumulate(byLength, plies, attempt);
    const visibility = visibilityOf(attempt);
    if (visibility !== null) accumulate(byVisibility, visibility, attempt);
    const kind = kindOf(attempt);
    if (kind !== null) accumulate(byKind, kind, attempt);

    sessions.add(attempt.sessionId ?? 'unknown');
    days.add(localDay(attempt.timestamp));
    if (lastAt === null || attempt.timestamp > lastAt) lastAt = attempt.timestamp;
  }

  const lengths = harvest<number>(byLength);

  let provenPlies: number | null = null;
  for (const [plies, tally] of lengths) {
    if (tally.unaidedCorrect < PROVEN_ATTEMPTS) continue;
    if (tally.unaidedAccuracy < PROVEN_ACCURACY) continue;
    if (provenPlies === null || plies > provenPlies) provenPlies = plies;
  }

  const recent = [...blindfold]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-RETENTION_WINDOW);

  const partial: Omit<BlindfoldProgress, 'recommendation'> = {
    overall: overall.has('all') ? finish(overall.get('all') as Accumulator) : emptyTally(),
    byMode: harvest<string>(byMode),
    byLength: lengths,
    byVisibility: harvest<string>(byVisibility),
    byKind: harvest<string>(byKind),
    byOrientation: harvest<string>(byOrientation),
    provenPlies,
    sessions: blindfold.length === 0 ? 0 : sessions.size,
    days: blindfold.length === 0 ? 0 : days.size,
    recentAccuracy:
      recent.length === 0
        ? null
        : recent.filter((attempt) => attempt.correct).length / recent.length,
    sinceLastMs: lastAt === null ? null : Math.max(0, now - lastAt),
  };

  return { ...partial, recommendation: recommend(partial) };
}
