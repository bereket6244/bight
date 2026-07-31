/**
 * Blindfold progress, and the boundary between it and square mastery.
 *
 * The load-bearing test here is the one asserting that a wrong blindfold
 * answer about e5 does not make e5 look weak. That separation is the whole
 * reason this module exists.
 */

import { describe, expect, it } from 'vitest';
import {
  BLINDFOLD_MODE_IDS,
  blindfoldProgress,
  excludeBlindfold,
  isBlindfoldMode,
  onlyBlindfold,
  PROVEN_ACCURACY,
  PROVEN_ATTEMPTS,
} from './blindfold';
import { computeMastery, practiceWeights } from './mastery';
import type { StoredAttempt } from '../storage/types';
import type { SquareName } from '../chess/types';

const DAY = 86_400_000;
const T0 = 1_750_000_000_000;

let nextId = 1;

function attempt(overrides: Partial<StoredAttempt> = {}): StoredAttempt {
  return {
    id: nextId++,
    sessionId: 's1',
    schemaVersion: 1,
    appVersion: '1.4.0',
    questionId: `q${nextId}`,
    modeId: 'blindfold-tracking',
    variantId: 'mixed',
    prompt: 'Where is the knight that started on g1?',
    expected: 'e5',
    answer: 'e5',
    correct: true,
    responseMs: 4000,
    source: 'touch',
    orientation: 'white',
    labels: 'always',
    layout: 'custom',
    filters: 'none',
    timer: 'none',
    focusSquares: ['e5'] as SquareName[],
    primarySquare: 'e5' as SquareName,
    missed: [],
    extra: [],
    timestamp: T0,
    isRetry: false,
    plies: 6,
    boardVisibility: 'start-only',
    ...overrides,
  };
}

describe('classification', () => {
  it('names exactly the three blindfold modes', () => {
    expect([...BLINDFOLD_MODE_IDS].sort()).toEqual([
      'blindfold-progressive',
      'blindfold-reconstruction',
      'blindfold-tracking',
    ]);
    expect(isBlindfoldMode('blindfold-tracking')).toBe(true);
    expect(isBlindfoldMode('knight-vision')).toBe(false);
  });

  it('splits a mixed list both ways without losing anything', () => {
    const mixed = [
      attempt(),
      attempt({ modeId: 'knight-vision' }),
      attempt({ modeId: 'blindfold-reconstruction' }),
    ];
    expect(onlyBlindfold(mixed)).toHaveLength(2);
    expect(excludeBlindfold(mixed)).toHaveLength(1);
  });
});

describe('kept out of square mastery', () => {
  it('does not let a wrong blindfold answer weaken the square it named', () => {
    // Twenty wrong blindfold answers all pointing at e5.
    const blindfold = Array.from({ length: 20 }, (_, i) =>
      attempt({
        correct: false,
        missed: ['e5'] as SquareName[],
        timestamp: T0 + i * DAY,
        sessionId: `s${i}`,
      }),
    );

    expect(computeMastery(blindfold).get('e5' as SquareName)).toBeUndefined();
  });

  it('leaves ordinary attempts on the same square untouched', () => {
    const ordinary = Array.from({ length: 6 }, (_, i) =>
      attempt({
        modeId: 'coordinate-to-square',
        timestamp: T0 + i * DAY,
        sessionId: `s${i}`,
        plies: undefined,
        boardVisibility: undefined,
      }),
    );
    const withBlindfoldNoise = [
      ...ordinary,
      ...Array.from({ length: 30 }, () => attempt({ correct: false, missed: ['e5'] as SquareName[] })),
    ];

    const clean = computeMastery(ordinary).get('e5' as SquareName);
    const noisy = computeMastery(withBlindfoldNoise).get('e5' as SquareName);
    expect(noisy?.score).toBe(clean?.score);
    expect(noisy?.attempts).toBe(clean?.attempts);
  });

  it('does not let blindfold results steer adaptive practice', () => {
    const blindfold = Array.from({ length: 30 }, () =>
      attempt({ correct: false, missed: ['e5'] as SquareName[] }),
    );
    const weights = practiceWeights(blindfold);
    // Every square is equally unpracticed, so none stands out.
    const distinct = new Set([...weights.values()]);
    expect(distinct.size).toBe(1);
  });
});

describe('blindfold tallies', () => {
  it('reports accuracy and hint-free accuracy separately', () => {
    const attempts = [
      attempt({ correct: true, hintsUsed: 0 }),
      attempt({ correct: true, hintsUsed: 0 }),
      attempt({ correct: true, hintsUsed: 1 }),
      attempt({ correct: false, hintsUsed: 0 }),
    ];
    const progress = blindfoldProgress(attempts);

    expect(progress.overall.attempts).toBe(4);
    expect(progress.overall.accuracy).toBeCloseTo(0.75);
    // Three answers were unaided, two of them right.
    expect(progress.overall.unaided).toBe(3);
    expect(progress.overall.unaidedAccuracy).toBeCloseTo(2 / 3);
    expect(progress.overall.hintsTaken).toBe(1);
  });

  it('treats a missing hint count as unaided, so old data still reads', () => {
    const progress = blindfoldProgress([attempt({ hintsUsed: undefined })]);
    expect(progress.overall.unaided).toBe(1);
  });

  it('breaks results down by sequence length and by how much board was shown', () => {
    const attempts = [
      attempt({ plies: 4, boardVisibility: 'each-ply' }),
      attempt({ plies: 4, boardVisibility: 'each-ply', correct: false }),
      attempt({ plies: 10, boardVisibility: 'never' }),
    ];
    const progress = blindfoldProgress(attempts);

    expect(progress.byLength.get(4)?.attempts).toBe(2);
    expect(progress.byLength.get(4)?.accuracy).toBeCloseTo(0.5);
    expect(progress.byLength.get(10)?.accuracy).toBe(1);
    expect(progress.byVisibility.get('never')?.attempts).toBe(1);
  });

  it('ignores attempts with no recorded length rather than guessing one', () => {
    const progress = blindfoldProgress([attempt({ plies: undefined })]);
    expect(progress.overall.attempts).toBe(1);
    expect(progress.byLength.size).toBe(0);
  });

  it('reports a median time over correct answers only', () => {
    const progress = blindfoldProgress([
      attempt({ correct: true, responseMs: 1000 }),
      attempt({ correct: true, responseMs: 3000 }),
      attempt({ correct: false, responseMs: 99_000 }),
    ]);
    expect(progress.overall.medianMs).toBe(2000);
  });
});

describe('proven sequence length', () => {
  it('needs a run of unaided correct answers, not one lucky one', () => {
    const one = blindfoldProgress([attempt({ plies: 18, correct: true, hintsUsed: 0 })]);
    expect(one.provenPlies).toBeNull();

    const enough = blindfoldProgress(
      Array.from({ length: PROVEN_ATTEMPTS }, () =>
        attempt({ plies: 18, correct: true, hintsUsed: 0 }),
      ),
    );
    expect(enough.provenPlies).toBe(18);
  });

  it('does not count hinted answers towards it', () => {
    const hinted = blindfoldProgress(
      Array.from({ length: PROVEN_ATTEMPTS * 2 }, () =>
        attempt({ plies: 18, correct: true, hintsUsed: 1 }),
      ),
    );
    expect(hinted.provenPlies).toBeNull();
  });

  it('needs accuracy at that length, not just volume', () => {
    const attempts = [
      ...Array.from({ length: PROVEN_ATTEMPTS }, () =>
        attempt({ plies: 24, correct: true, hintsUsed: 0 }),
      ),
      // Enough misses to drag accuracy below the bar.
      ...Array.from({ length: 20 }, () => attempt({ plies: 24, correct: false, hintsUsed: 0 })),
    ];
    const progress = blindfoldProgress(attempts);
    expect(progress.byLength.get(24)?.unaidedAccuracy).toBeLessThan(PROVEN_ACCURACY);
    expect(progress.provenPlies).toBeNull();
  });

  it('reports the longest proven length, not the most recent', () => {
    const attempts = [
      ...Array.from({ length: PROVEN_ATTEMPTS }, () =>
        attempt({ plies: 18, correct: true, hintsUsed: 0 }),
      ),
      ...Array.from({ length: PROVEN_ATTEMPTS }, () =>
        attempt({ plies: 6, correct: true, hintsUsed: 0 }),
      ),
    ];
    expect(blindfoldProgress(attempts).provenPlies).toBe(18);
  });

  it('reports nothing at all before any blindfold practice', () => {
    const progress = blindfoldProgress([attempt({ modeId: 'knight-vision' })]);
    expect(progress.overall.attempts).toBe(0);
    expect(progress.provenPlies).toBeNull();
  });
});

describe('recommendations', () => {
  it('suggests starting when there is nothing to go on', () => {
    const progress = blindfoldProgress([]);
    expect(progress.recommendation.action).toBe('start');
    expect(progress.recommendation.plies).toBe(4);
    expect(progress.recommendation.because).toMatch(/no blindfold practice/i);
  });

  it('asks for more evidence before acting on a handful of attempts', () => {
    const progress = blindfoldProgress(
      Array.from({ length: 3 }, () => attempt({ plies: 10, correct: true })),
    );
    expect(progress.recommendation.action).toBe('more-evidence');
  });

  it('holds the current length when it is not being held', () => {
    const progress = blindfoldProgress(
      Array.from({ length: 12 }, (_, i) =>
        attempt({ plies: 10, correct: i < 5, hintsUsed: 0 }),
      ),
    );
    expect(progress.recommendation.action).toBe('hold');
    expect(progress.recommendation.plies).toBe(10);
    // The reason quotes the numbers it acted on, so the user can check it.
    expect(progress.recommendation.because).toMatch(/\d+% correct without hints/);
  });

  it('names the weakest question type when one stands out', () => {
    const progress = blindfoldProgress([
      // Ten occupancy questions, mostly wrong.
      ...Array.from({ length: 10 }, (_, i) =>
        attempt({ plies: 10, blindfoldKind: 'occupancy', correct: i < 2 }),
      ),
      // Ten piece-location questions, all right.
      ...Array.from({ length: 10 }, () =>
        attempt({ plies: 10, blindfoldKind: 'piece-location', correct: true }),
      ),
    ]);
    expect(progress.recommendation.action).toBe('weakest-kind');
    expect(progress.recommendation.kind).toBe('occupancy');
    expect(progress.recommendation.headline).toContain('Occupied or empty');
  });

  it('takes the board away before making the sequence longer', () => {
    const progress = blindfoldProgress(
      Array.from({ length: 12 }, () =>
        attempt({ plies: 10, correct: true, hintsUsed: 0, boardVisibility: 'start-only' }),
      ),
    );
    expect(progress.recommendation.action).toBe('less-board');
    expect(progress.recommendation.visibility).toBe('never');
  });

  it('only suggests a longer sequence once the board is already gone', () => {
    const progress = blindfoldProgress(
      Array.from({ length: 12 }, () =>
        attempt({ plies: 10, correct: true, hintsUsed: 0, boardVisibility: 'never' }),
      ),
    );
    expect(progress.recommendation.action).toBe('longer');
    expect(progress.recommendation.plies).toBe(14);
  });

  it('never recommends anything without naming the evidence', () => {
    for (const attempts of [
      [],
      [attempt({ plies: 10 })],
      Array.from({ length: 12 }, () => attempt({ plies: 10, correct: false })),
      Array.from({ length: 12 }, () => attempt({ plies: 10, boardVisibility: 'never' })),
    ]) {
      const { recommendation } = blindfoldProgress(attempts);
      expect(recommendation.because.length).toBeGreaterThan(10);
      expect(recommendation.headline.length).toBeGreaterThan(5);
    }
  });
});

describe('spacing, retention and orientation', () => {
  it('counts distinct sessions and distinct days', () => {
    const progress = blindfoldProgress([
      attempt({ sessionId: 'a', timestamp: T0 }),
      attempt({ sessionId: 'a', timestamp: T0 + 1000 }),
      attempt({ sessionId: 'b', timestamp: T0 + DAY }),
    ]);
    expect(progress.sessions).toBe(2);
    expect(progress.days).toBe(2);
  });

  it('reports accuracy over the recent window only', () => {
    const progress = blindfoldProgress([
      // Older run of misses, then a clean recent run.
      ...Array.from({ length: 30 }, (_, i) => attempt({ correct: false, timestamp: T0 + i })),
      ...Array.from({ length: 20 }, (_, i) => attempt({ correct: true, timestamp: T0 + 100 + i })),
    ]);
    expect(progress.overall.accuracy).toBeCloseTo(0.4);
    expect(progress.recentAccuracy).toBe(1);
  });

  it('reports how long it has been since the last blindfold attempt', () => {
    const progress = blindfoldProgress([attempt({ timestamp: T0 })], T0 + DAY * 3);
    expect(progress.sinceLastMs).toBe(DAY * 3);
    expect(blindfoldProgress([], T0).sinceLastMs).toBeNull();
  });

  it('splits accuracy by orientation', () => {
    const progress = blindfoldProgress([
      attempt({ orientation: 'white', correct: true }),
      attempt({ orientation: 'black', correct: false }),
      attempt({ orientation: 'black', correct: false }),
    ]);
    expect(progress.byOrientation.get('white')?.accuracy).toBe(1);
    expect(progress.byOrientation.get('black')?.accuracy).toBe(0);
  });

  it('groups by question kind, ignoring an unrecorded one', () => {
    const progress = blindfoldProgress([
      attempt({ blindfoldKind: 'occupancy', correct: true }),
      attempt({ blindfoldKind: 'occupancy', correct: false }),
      attempt({ blindfoldKind: 'unknown' }),
      attempt({ blindfoldKind: undefined }),
    ]);
    expect(progress.byKind.get('occupancy')?.attempts).toBe(2);
    expect(progress.byKind.has('unknown')).toBe(false);
    expect(progress.overall.attempts).toBe(4);
  });
});
