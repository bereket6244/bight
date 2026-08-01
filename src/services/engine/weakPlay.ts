/**
 * Making the computer play badly, on purpose and in a controlled way.
 *
 * ## Why this exists
 *
 * A real user reported that "Easy" plays much too well. It did: the only
 * weakening was `Skill Level` plus a shallow depth, and shallow Stockfish is
 * still a strong club player. Nothing about a 3-ply search makes it hang a
 * knight the way a beginner does.
 *
 * The obvious lever does not reach either. The bundled build advertises
 * `UCI_LimitStrength` with `UCI_Elo` **minimum 1320** — already a decent
 * club-level opponent, and well above a beginner. So the floor has to be built
 * here.
 *
 * ## How it works
 *
 * Stockfish is asked for several candidate moves at once (MultiPV) with a
 * score for each. This module picks one of *those* — never a random legal
 * move, never a move the engine has not evaluated. Every candidate is
 * something Stockfish considered worth reporting, so even a bad choice is a
 * plausible one rather than nonsense: a beginner hangs a knight, they do not
 * play Rh1-h4 into three captures for no reason.
 *
 * Selection is seeded, so a given position and seed always produce the same
 * move and the behaviour can be tested rather than described.
 *
 * **This is behavioural weakening, not calibrated Elo.** No level here claims
 * to correspond to any rating on any site, because none has been measured.
 */

import type { EngineDifficulty } from './engineTypes';

/** One move Stockfish reported, with its evaluation. */
export interface Candidate {
  /** The move, in UCI. */
  uci: string;
  /**
   * Centipawns from the side to move's point of view, as UCI reports it.
   * Absent when the line is a forced mate.
   */
  scoreCp?: number;
  /** Moves to mate, signed, from the side to move's point of view. */
  scoreMate?: number;
}

/**
 * A mate is worth more than any material score. Converting it to a very large
 * centipawn value keeps one ordering for everything, and the sign is
 * preserved so being mated is the worst possible outcome rather than the best.
 */
export const MATE_SCORE = 100_000;

export function scoreOf(candidate: Candidate): number {
  if (candidate.scoreMate !== undefined) {
    // Mating soon is better than mating later; being mated soon is worst.
    return candidate.scoreMate > 0
      ? MATE_SCORE - candidate.scoreMate
      : -MATE_SCORE - candidate.scoreMate;
  }
  return candidate.scoreCp ?? 0;
}

export interface WeakPlayPolicy {
  /** Shown to the user. */
  label: string;
  /** One line describing how it plays, in behaviour rather than in rating. */
  detail: string;
  /** How many candidates to ask Stockfish for. 1 disables weakening. */
  multiPv: number;
  /** Search depth for the candidate list. */
  depth: number;
  /** Milliseconds per move. */
  movetimeMs: number;
  /** `Skill Level`, still applied — it makes the candidate list itself weaker. */
  skill: number;
  /**
   * How much worse than the best move this level will tolerate, in
   * centipawns. Candidates beyond it are never chosen.
   */
  maxLossCp: number;
  /**
   * Chance of deliberately not playing the best available candidate.
   *
   * At 0 the best move is always played. At 0.75 the level usually picks
   * something worse, which is what makes a beginner miss a hanging piece.
   */
  mistakeChance: number;
  /**
   * Never throw away a forced mate, and never walk into one, however weak the
   * level. Losing to a beginner opponent is fine; watching it decline mate in
   * one is just broken.
   */
  keepsMate: boolean;
}

/**
 * The four levels.
 *
 * Internal ids are unchanged (`very-easy`, `easy`, `moderate`, `strong`) so
 * stored settings and backups keep working; only the labels shown to the user
 * changed, to the plainer Beginner/Easy/Intermediate/Strong.
 */
export const WEAK_PLAY_POLICY: Record<EngineDifficulty, WeakPlayPolicy> = {
  'very-easy': {
    label: 'Beginner',
    detail: 'Misses simple threats and gives pieces away.',
    multiPv: 12,
    depth: 4,
    movetimeMs: 300,
    skill: 0,
    maxLossCp: 900,
    mistakeChance: 0.8,
    keepsMate: true,
  },
  easy: {
    label: 'Easy',
    detail: 'Sees the obvious, misses most tactics.',
    multiPv: 8,
    depth: 6,
    movetimeMs: 400,
    skill: 3,
    maxLossCp: 350,
    mistakeChance: 0.55,
    keepsMate: true,
  },
  moderate: {
    label: 'Intermediate',
    detail: 'Punishes loose pieces and simple tactics.',
    multiPv: 4,
    depth: 10,
    movetimeMs: 600,
    skill: 12,
    maxLossCp: 90,
    mistakeChance: 0.2,
    keepsMate: true,
  },
  strong: {
    label: 'Strong',
    detail: 'Plays properly. Expect to lose.',
    multiPv: 1,
    depth: 14,
    movetimeMs: 1000,
    skill: 20,
    maxLossCp: 0,
    mistakeChance: 0,
    keepsMate: true,
  },
};

/** Anything that produces a number in [0, 1). Seeded in tests. */
export type RandomSource = () => number;

export interface Selection {
  uci: string;
  /** How much worse than the best candidate this move is, in centipawns. */
  lossCp: number;
  /** True when a deliberately weaker move was taken. */
  deliberateMistake: boolean;
  /** Index in the candidate list, best first. */
  index: number;
}

/**
 * Chooses which candidate to play.
 *
 * Pure, so the whole difficulty model is testable without a browser, a worker
 * or a chess engine. The caller still validates the result through chess.js —
 * this returns a move token and claims nothing about its legality.
 */
export function chooseCandidate(
  candidates: readonly Candidate[],
  difficulty: EngineDifficulty,
  random: RandomSource,
): Selection | null {
  if (candidates.length === 0) return null;

  const policy = WEAK_PLAY_POLICY[difficulty];

  // Best first. Stockfish already orders MultiPV lines this way, but the list
  // is assembled from streamed output and must not depend on arrival order.
  const ranked = [...candidates].sort((a, b) => scoreOf(b) - scoreOf(a));
  const best = ranked[0] as Candidate;
  const bestScore = scoreOf(best);

  const play = (candidate: Candidate, deliberate: boolean): Selection => ({
    uci: candidate.uci,
    lossCp: Math.max(0, bestScore - scoreOf(candidate)),
    deliberateMistake: deliberate,
    index: ranked.indexOf(candidate),
  });

  // A forced mate is taken, and a forced loss is not made worse, at every
  // level. Weakness should look like bad chess, not like a broken opponent.
  if (policy.keepsMate && best.scoreMate !== undefined && best.scoreMate > 0) {
    return play(best, false);
  }

  if (policy.multiPv <= 1 || policy.mistakeChance <= 0 || ranked.length === 1) {
    return play(best, false);
  }

  if (random() >= policy.mistakeChance) return play(best, false);

  /*
   * Everything within the level's tolerance is a possible choice, weighted so
   * the worse moves are the more likely ones — that is what produces a hung
   * piece rather than a slightly inferior developing move. The best move is
   * excluded here because this branch has already decided not to play it.
   */
  const affordable = ranked
    .slice(1)
    .filter((candidate) => {
      const loss = bestScore - scoreOf(candidate);
      if (loss > policy.maxLossCp) return false;
      // Never choose a move that walks into being mated.
      if (candidate.scoreMate !== undefined && candidate.scoreMate < 0) return false;
      return true;
    });

  if (affordable.length === 0) return play(best, false);

  const weights = affordable.map((candidate) => {
    const loss = bestScore - scoreOf(candidate);
    // Weight grows with the size of the mistake, so a beginner reaches for the
    // worse option, but never so steeply that the single worst move dominates.
    return 1 + loss / 100;
  });

  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let ticket = random() * total;
  for (let i = 0; i < affordable.length; i += 1) {
    ticket -= weights[i] as number;
    if (ticket <= 0) return play(affordable[i] as Candidate, true);
  }
  return play(affordable[affordable.length - 1] as Candidate, true);
}

/**
 * Collects MultiPV `info` lines into one candidate per line index.
 *
 * Stockfish re-reports each line as the search deepens, so the last report for
 * a given `multipv` index is the one that counts. Lines without a move or a
 * score are ignored rather than guessed at.
 */
export function collectCandidates(
  infos: ReadonlyArray<{ multipv?: number; scoreCp?: number; scoreMate?: number; pv?: string[] }>,
): Candidate[] {
  const byIndex = new Map<number, Candidate>();

  for (const info of infos) {
    const move = info.pv?.[0];
    if (move === undefined) continue;
    if (info.scoreCp === undefined && info.scoreMate === undefined) continue;

    byIndex.set(info.multipv ?? 1, {
      uci: move,
      scoreCp: info.scoreCp,
      scoreMate: info.scoreMate,
    });
  }

  return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, candidate]) => candidate);
}
