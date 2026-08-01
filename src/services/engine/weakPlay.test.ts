/**
 * The difficulty model, tested as behaviour rather than as configuration.
 *
 * A real user reported that "Easy" plays much too well. Asserting that
 * `skill === 3` would not have caught that and would not catch it coming back.
 * These tests instead run the selection over fixed candidate sets — a hanging
 * queen, a free knight, a forced mate — many times with seeded randomness, and
 * assert how often each level actually takes the best move.
 *
 * All of this is deliberate weakening. No level claims a rating.
 */

import { describe, expect, it } from 'vitest';
import {
  chooseCandidate,
  collectCandidates,
  MATE_SCORE,
  scoreOf,
  WEAK_PLAY_POLICY,
  type Candidate,
} from './weakPlay';
import { createRng } from '../../core/rng';
import type { EngineDifficulty } from './engineTypes';

const LEVELS: EngineDifficulty[] = ['very-easy', 'easy', 'moderate', 'strong'];

/**
 * Runs one position many times with different seeds and reports how often the
 * best candidate was chosen.
 */
function bestMoveRate(
  candidates: readonly Candidate[],
  difficulty: EngineDifficulty,
  runs = 400,
): number {
  const best = [...candidates].sort((a, b) => scoreOf(b) - scoreOf(a))[0] as Candidate;
  let taken = 0;
  for (let seed = 1; seed <= runs; seed += 1) {
    const rng = createRng(seed);
    const chosen = chooseCandidate(candidates, difficulty, () => rng.next());
    if (chosen?.uci === best.uci) taken += 1;
  }
  return taken / runs;
}

/* ------------------------------------------------------------------ *
 * Fixed positions, as candidate lists Stockfish would report
 * ------------------------------------------------------------------ */

/** The opponent's queen is hanging: one move wins it, the rest are quiet. */
const HANGING_QUEEN: Candidate[] = [
  { uci: 'd1h5', scoreCp: 900 },
  { uci: 'g1f3', scoreCp: 30 },
  { uci: 'b1c3', scoreCp: 25 },
  { uci: 'd2d4', scoreCp: 20 },
  { uci: 'a2a3', scoreCp: 5 },
  { uci: 'h2h4', scoreCp: -10 },
];

/** A free minor piece, a smaller prize than the queen. */
const FREE_KNIGHT: Candidate[] = [
  { uci: 'f3e5', scoreCp: 320 },
  { uci: 'd2d4', scoreCp: 40 },
  { uci: 'c2c3', scoreCp: 25 },
  { uci: 'a2a3', scoreCp: 10 },
];

/** A quiet opening where everything is reasonable. */
const QUIET_OPENING: Candidate[] = [
  { uci: 'e2e4', scoreCp: 35 },
  { uci: 'd2d4', scoreCp: 32 },
  { uci: 'g1f3', scoreCp: 30 },
  { uci: 'c2c4', scoreCp: 28 },
];

/** A tempting pawn grab that loses material. */
const POISONED_PAWN: Candidate[] = [
  { uci: 'g1f3', scoreCp: 40 },
  { uci: 'd1b3', scoreCp: 20 },
  { uci: 'f3e5', scoreCp: -260 },
];

/** Mate in one is available. */
const FORCED_MATE: Candidate[] = [
  { uci: 'a1a8', scoreMate: 1 },
  { uci: 'g1h1', scoreCp: 400 },
  { uci: 'h2h3', scoreCp: 120 },
];

/** Every move loses; one loses much faster. */
const ABOUT_TO_BE_MATED: Candidate[] = [
  { uci: 'g1h1', scoreCp: -400 },
  { uci: 'f2f3', scoreCp: -500 },
  { uci: 'h2h3', scoreMate: -1 },
];

describe('score ordering', () => {
  it('puts a forced mate above any material score', () => {
    expect(scoreOf({ uci: 'a1a8', scoreMate: 1 })).toBeGreaterThan(
      scoreOf({ uci: 'x', scoreCp: 9000 }),
    );
    expect(scoreOf({ uci: 'a1a8', scoreMate: 1 })).toBeLessThan(MATE_SCORE + 1);
  });

  it('prefers a faster mate to a slower one', () => {
    expect(scoreOf({ uci: 'a', scoreMate: 1 })).toBeGreaterThan(scoreOf({ uci: 'b', scoreMate: 4 }));
  });

  it('treats being mated as the worst outcome there is', () => {
    expect(scoreOf({ uci: 'a', scoreMate: -1 })).toBeLessThan(scoreOf({ uci: 'b', scoreCp: -9000 }));
  });
});

describe('difficulty is a real ladder', () => {
  /**
   * Averaged across positions on purpose.
   *
   * A single position cannot rank all four levels: a hanging queen is a
   * 900-centipawn mistake, which only Beginner's tolerance reaches, so every
   * other level takes it every time and the measurements tie at 1. The ladder
   * is a claim about play in general, so it is measured over a set of
   * positions with mistakes of different sizes.
   */
  const POSITIONS = [HANGING_QUEEN, FREE_KNIGHT, QUIET_OPENING, POISONED_PAWN];

  function overallBestMoveRate(difficulty: EngineDifficulty): number {
    const rates = POSITIONS.map((position) => bestMoveRate(position, difficulty, 200));
    return rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
  }

  it('takes the best move more often as the level rises', () => {
    const rates = LEVELS.map(overallBestMoveRate);
    for (let i = 1; i < rates.length; i += 1) {
      expect(
        rates[i],
        `${LEVELS[i]} vs ${LEVELS[i - 1]}: ${rates.map((r) => r.toFixed(3)).join(', ')}`,
      ).toBeGreaterThan(rates[i - 1] as number);
    }
  });

  it('Beginner plays a non-best move substantially more often than Easy', () => {
    expect(1 - overallBestMoveRate('very-easy')).toBeGreaterThan(
      (1 - overallBestMoveRate('easy')) * 1.5,
    );
  });

  it('Easy plays a non-best move more often than Intermediate', () => {
    expect(1 - overallBestMoveRate('easy')).toBeGreaterThan(1 - overallBestMoveRate('moderate'));
  });

  it('Beginner usually fails to take a hanging queen', () => {
    // The whole complaint was that the weak levels punished everything. A
    // beginner does not.
    expect(bestMoveRate(HANGING_QUEEN, 'very-easy')).toBeLessThan(0.4);
  });

  it('Strong always punishes a hanging queen', () => {
    expect(bestMoveRate(HANGING_QUEEN, 'strong')).toBe(1);
  });

  it('Easy and above still take a free queen — that much is not subtle', () => {
    // Weak does not mean blind. A queen left en prise is beyond the tolerance
    // of every level above Beginner, so they take it.
    expect(bestMoveRate(HANGING_QUEEN, 'easy')).toBe(1);
    expect(bestMoveRate(HANGING_QUEEN, 'moderate')).toBe(1);
  });

  it('Beginner and Easy both sometimes miss a free minor piece', () => {
    expect(bestMoveRate(FREE_KNIGHT, 'very-easy')).toBeLessThan(0.6);
    expect(bestMoveRate(FREE_KNIGHT, 'easy')).toBeLessThan(1);
    expect(bestMoveRate(FREE_KNIGHT, 'strong')).toBe(1);
  });

  it('Intermediate mostly prefers strong candidates', () => {
    expect(bestMoveRate(FREE_KNIGHT, 'moderate')).toBeGreaterThan(0.7);
  });
});

describe('weakness stays plausible', () => {
  it('never plays a move outside the level tolerance', () => {
    for (const level of LEVELS) {
      const limit = WEAK_PLAY_POLICY[level].maxLossCp;
      for (let seed = 1; seed <= 200; seed += 1) {
        const rng = createRng(seed);
        const chosen = chooseCandidate(POISONED_PAWN, level, () => rng.next());
        expect(chosen?.lossCp, `${level} seed ${seed}`).toBeLessThanOrEqual(limit);
      }
    }
  });

  it('never declines a forced mate, at any level', () => {
    for (const level of LEVELS) {
      for (let seed = 1; seed <= 200; seed += 1) {
        const rng = createRng(seed);
        expect(chooseCandidate(FORCED_MATE, level, () => rng.next())?.uci, level).toBe('a1a8');
      }
    }
  });

  it('never walks into being mated when something else is available', () => {
    for (const level of LEVELS) {
      for (let seed = 1; seed <= 200; seed += 1) {
        const rng = createRng(seed);
        const chosen = chooseCandidate(ABOUT_TO_BE_MATED, level, () => rng.next());
        expect(chosen?.uci, `${level} seed ${seed}`).not.toBe('h2h3');
      }
    }
  });

  it('only ever returns a move the engine actually offered', () => {
    // No random legal moves, ever: every choice is something Stockfish
    // evaluated and reported.
    const offered = new Set(HANGING_QUEEN.map((c) => c.uci));
    for (const level of LEVELS) {
      for (let seed = 1; seed <= 200; seed += 1) {
        const rng = createRng(seed);
        expect(offered).toContain(chooseCandidate(HANGING_QUEEN, level, () => rng.next())?.uci);
      }
    }
  });

  it('plays reasonably in a quiet position at every level', () => {
    // Where every move is fine, even a beginner cannot go far wrong.
    for (const level of LEVELS) {
      for (let seed = 1; seed <= 100; seed += 1) {
        const rng = createRng(seed);
        expect(chooseCandidate(QUIET_OPENING, level, () => rng.next())?.lossCp).toBeLessThanOrEqual(
          10,
        );
      }
    }
  });
});

describe('determinism', () => {
  it('gives the same move for the same seed and position', () => {
    for (const level of LEVELS) {
      const once = chooseCandidate(HANGING_QUEEN, level, createRng(42).next);
      const twice = chooseCandidate(HANGING_QUEEN, level, createRng(42).next);
      expect(twice, level).toEqual(once);
    }
  });

  it('gives variety across seeds at the weak levels', () => {
    const chosen = new Set<string>();
    for (let seed = 1; seed <= 60; seed += 1) {
      const rng = createRng(seed);
      chosen.add(chooseCandidate(HANGING_QUEEN, 'very-easy', () => rng.next())?.uci ?? '');
    }
    expect(chosen.size).toBeGreaterThan(2);
  });
});

describe('edges', () => {
  it('returns null when there is nothing to choose from', () => {
    expect(chooseCandidate([], 'easy', Math.random)).toBeNull();
  });

  it('plays the only move when there is only one', () => {
    const only: Candidate[] = [{ uci: 'e2e4', scoreCp: 10 }];
    for (const level of LEVELS) {
      expect(chooseCandidate(only, level, Math.random)?.uci, level).toBe('e2e4');
    }
  });

  it('reports whether the choice was a deliberate mistake', () => {
    expect(chooseCandidate(HANGING_QUEEN, 'strong', Math.random)?.deliberateMistake).toBe(false);
  });
});

describe('reading the candidate list off UCI output', () => {
  it('keeps the deepest report for each line', () => {
    const candidates = collectCandidates([
      { multipv: 1, scoreCp: 10, pv: ['e2e4'] },
      { multipv: 2, scoreCp: 5, pv: ['d2d4'] },
      // Deeper search revises the first line.
      { multipv: 1, scoreCp: 40, pv: ['g1f3'] },
    ]);

    expect(candidates).toEqual([
      { uci: 'g1f3', scoreCp: 40, scoreMate: undefined },
      { uci: 'd2d4', scoreCp: 5, scoreMate: undefined },
    ]);
  });

  it('ignores lines with no move or no score', () => {
    expect(
      collectCandidates([
        { multipv: 1, scoreCp: 10 },
        { multipv: 2, pv: ['d2d4'] },
        { multipv: 3, scoreCp: 5, pv: ['e2e4'] },
      ]),
    ).toEqual([{ uci: 'e2e4', scoreCp: 5, scoreMate: undefined }]);
  });

  it('treats a missing multipv index as line one', () => {
    expect(collectCandidates([{ scoreCp: 12, pv: ['e2e4'] }])).toHaveLength(1);
  });

  it('carries mate scores through', () => {
    expect(collectCandidates([{ multipv: 1, scoreMate: 2, pv: ['a1a8'] }])[0]?.scoreMate).toBe(2);
  });
});

describe('what is claimed about the levels', () => {
  it('describes behaviour and never a rating', () => {
    for (const level of LEVELS) {
      const policy = WEAK_PLAY_POLICY[level];
      expect(policy.detail.length).toBeGreaterThan(10);
      expect(policy.detail, level).not.toMatch(/\b(elo|rated|rating|\d{3,4})\b/i);
      expect(policy.label, level).not.toMatch(/\d/);
    }
  });

  it('keeps the stored setting ids unchanged, so old saves still load', () => {
    // The labels changed to Beginner/Easy/Intermediate/Strong; the ids did not.
    expect(Object.keys(WEAK_PLAY_POLICY).sort()).toEqual([
      'easy',
      'moderate',
      'strong',
      'very-easy',
    ]);
    expect(WEAK_PLAY_POLICY['very-easy'].label).toBe('Beginner');
    expect(WEAK_PLAY_POLICY.moderate.label).toBe('Intermediate');
  });

  it('asks for more candidates at the weaker levels, and none at the strongest', () => {
    expect(WEAK_PLAY_POLICY['very-easy'].multiPv).toBeGreaterThan(
      WEAK_PLAY_POLICY.easy.multiPv,
    );
    expect(WEAK_PLAY_POLICY.easy.multiPv).toBeGreaterThan(WEAK_PLAY_POLICY.moderate.multiPv);
    expect(WEAK_PLAY_POLICY.strong.multiPv).toBe(1);
  });
});
