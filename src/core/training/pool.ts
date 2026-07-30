/**
 * Square selection: which squares a question may be drawn from, and how
 * strongly each is favoured.
 *
 * Every generator routes its square choice through here so filters, quadrants
 * and adaptive weighting behave identically in every mode.
 */

import { ALL_SQUARES, fileOf, quadrantOf, rankOf, type Quadrant } from '../chess/square';
import type { SquareName } from '../chess/types';
import type { Rng } from '../rng';
import type { GeneratorContext, SquareFilters } from './types';

/** Weight given to a square with no recorded history. */
export const DEFAULT_WEIGHT = 1;

/** Ceiling on adaptive weighting so one bad square cannot crowd out the rest. */
export const MAX_WEIGHT = 6;

/**
 * Applies the file/rank/quadrant filters.
 *
 * Files and ranks intersect: selecting files {a,b} and ranks {1,2} yields the
 * four squares a1, a2, b1, b2 rather than the union of the file and rank.
 * Quadrants are applied as a further intersection.
 *
 * An over-restrictive combination that selects nothing falls back to the full
 * board, because a mode with no questions is worse than an unfiltered one.
 */
export function applyFilters(
  squares: readonly SquareName[],
  filters: SquareFilters,
): SquareName[] {
  const { files, ranks, quadrants } = filters;

  const filtered = squares.filter((square) => {
    if (files.length > 0 && !files.includes(fileOf(square))) return false;
    if (ranks.length > 0 && !ranks.includes(rankOf(square))) return false;
    if (quadrants.length > 0 && !quadrants.includes(quadrantOf(square))) return false;
    return true;
  });

  return filtered.length > 0 ? filtered : [...squares];
}

/** True when the filters would select nothing from the full board. */
export function filtersAreUnsatisfiable(filters: SquareFilters): boolean {
  const { files, ranks, quadrants } = filters;
  return ALL_SQUARES.every((square) => {
    if (files.length > 0 && !files.includes(fileOf(square))) return true;
    if (ranks.length > 0 && !ranks.includes(rankOf(square))) return true;
    if (quadrants.length > 0 && !quadrants.includes(quadrantOf(square as SquareName))) return true;
    return false;
  });
}

/**
 * The pool a generator may draw from, after filters.
 * `restrictTo` lets a mode narrow the board further (e.g. squares a knight
 * can actually reach).
 */
export function buildPool(
  context: GeneratorContext,
  restrictTo?: readonly SquareName[],
): SquareName[] {
  const base = restrictTo ?? ALL_SQUARES;
  return applyFilters(base, context.filters);
}

/**
 * Picks a square, favouring weak ones when weights are supplied.
 *
 * Weighting is deliberately gentle: a square the user always gets wrong is at
 * most `MAX_WEIGHT` times likelier than a mastered one, so practice stays
 * varied instead of drilling a single square into the ground.
 */
export function pickSquare(
  pool: readonly SquareName[],
  rng: Rng,
  weights?: ReadonlyMap<SquareName, number>,
): SquareName {
  if (pool.length === 0) throw new RangeError('Cannot pick a square from an empty pool');
  if (weights === undefined || weights.size === 0) return rng.pick(pool);
  return rng.pickWeighted(pool, (square) =>
    Math.min(MAX_WEIGHT, Math.max(0.01, weights.get(square) ?? DEFAULT_WEIGHT)),
  );
}

/** Picks `count` distinct squares, respecting weighting for the first pick. */
export function pickSquares(
  pool: readonly SquareName[],
  count: number,
  rng: Rng,
  weights?: ReadonlyMap<SquareName, number>,
): SquareName[] {
  const remaining = [...pool];
  const out: SquareName[] = [];
  for (let i = 0; i < count && remaining.length > 0; i += 1) {
    const chosen = pickSquare(remaining, rng, weights);
    out.push(chosen);
    remaining.splice(remaining.indexOf(chosen), 1);
  }
  return out;
}

/**
 * Avoids asking the same square twice in a row, which otherwise happens often
 * on a narrow pool and makes practice feel broken.
 */
export function pickSquareAvoiding(
  pool: readonly SquareName[],
  avoid: readonly SquareName[],
  rng: Rng,
  weights?: ReadonlyMap<SquareName, number>,
): SquareName {
  const preferred = pool.filter((square) => !avoid.includes(square));
  return pickSquare(preferred.length > 0 ? preferred : pool, rng, weights);
}

export const ALL_QUADRANTS: readonly Quadrant[] = [
  'queenside-white',
  'kingside-white',
  'queenside-black',
  'kingside-black',
];

/** Human-readable summary of the active filters, shown on the session screen. */
export function describeFilters(filters: SquareFilters): string {
  const parts: string[] = [];
  if (filters.files.length > 0) {
    parts.push(`files ${filters.files.map((f) => 'abcdefgh'[f]).join('')}`);
  }
  if (filters.ranks.length > 0) {
    parts.push(`ranks ${filters.ranks.map((r) => r + 1).join('')}`);
  }
  if (filters.quadrants.length > 0) {
    parts.push(`${filters.quadrants.length} quadrant${filters.quadrants.length > 1 ? 's' : ''}`);
  }
  if (filters.weakSquaresOnly) parts.push('weak squares');
  return parts.length === 0 ? 'Whole board' : parts.join(', ');
}
