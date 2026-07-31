/**
 * Fork geometry: from which squares does one piece attack two targets at once?
 *
 * This is pure board geometry, not evaluation. Bight does not judge whether a
 * fork wins material — it trains the act of seeing that one square hits two
 * things. Whether the fork is *good* is a question for a puzzle app.
 *
 * Every answer is computed by intersecting attack sets, so the full solution
 * set is always available and a generator can never present a problem it has
 * not proved solvable.
 */

import { attackedSquares, geometricTargets } from './geometry';
import { legalDestinations } from './legal';
import { fenFromOccupancy, occupancyFromFen, occupancyFromPieces } from './position';
import { ALL_SQUARES } from './square';
import type { Occupancy, PieceColor, PieceType, PlacedPiece, SquareName } from './types';

export interface ForkOptions {
  /** Pieces already on the board. Blockers matter for the queen. */
  occupancy?: Occupancy;
  /** Squares the forking piece may not stand on (occupied, or the targets). */
  excluded?: readonly SquareName[];
}

/**
 * Every square from which `piece` attacks all of `targets` simultaneously.
 *
 * Occupancy is honoured for sliding pieces: a queen cannot fork through a
 * blocker. The forking square itself is excluded if something already stands
 * there, and the targets are never valid forking squares.
 */
export function forkSquares(
  piece: { type: PieceType; color: PieceColor },
  targets: readonly SquareName[],
  options: ForkOptions = {},
): SquareName[] {
  if (targets.length < 2) return [];

  const { occupancy, excluded = [] } = options;
  const blocked = new Set<SquareName>([...targets, ...excluded]);

  return ALL_SQUARES.filter((square) => {
    if (blocked.has(square)) return false;
    // A square already holding a piece cannot host the forker.
    if (occupancy?.has(square) === true) return false;

    // The forker stands on `square`, so it must be part of the occupancy used
    // for ray tracing - otherwise a queen would "see through" itself.
    const withForker =
      occupancy === undefined
        ? undefined
        : new Map(occupancy).set(square, { type: piece.type, color: piece.color });

    const attacks = attackedSquares(piece, square, { occupancy: withForker });
    return targets.every((target) => attacks.includes(target));
  });
}

/** True when a piece on `from` attacks every target. */
export function attacksAll(
  piece: { type: PieceType; color: PieceColor },
  from: SquareName,
  targets: readonly SquareName[],
  occupancy?: Occupancy,
): boolean {
  const attacks = attackedSquares(piece, from, { occupancy });
  return targets.length > 0 && targets.every((target) => attacks.includes(target));
}

export interface LegalForkOptions {
  /** Full FEN of the position. */
  fen: string;
  /** Where the forking piece currently stands. */
  from: SquareName;
  piece: { type: PieceType; color: PieceColor };
  targets: readonly SquareName[];
}

/**
 * Fork squares reachable by a *legal move* in a real position.
 *
 * This is the stricter of the two semantics Bight trains: the square must both
 * fork the targets and be somewhere the piece may legally go, which rules out
 * pinned pieces, blocked paths and moves that leave the king in check.
 * chess.js decides legality; the fork test is geometric.
 */
export function legalForkMoves(options: LegalForkOptions): SquareName[] {
  const { fen, from, piece, targets } = options;

  let destinations: SquareName[];
  try {
    destinations = legalDestinations(fen, from);
  } catch {
    return [];
  }

  let base: Occupancy;
  try {
    base = occupancyFromFen(fen);
  } catch {
    return [];
  }

  return destinations.filter((to) => {
    // Rebuild occupancy with the piece moved, so its own ray tracing is right
    // and a captured target no longer blocks.
    const occupancy = new Map(base);
    occupancy.delete(from);
    occupancy.set(to, { type: piece.type, color: piece.color });
    return attacksAll(piece, to, targets, occupancy);
  });
}

/** Builds a FEN for a geometric fork problem. Kings are included so it loads. */
export function forkPositionFen(pieces: readonly PlacedPiece[], turn: PieceColor = 'white'): string {
  return fenFromOccupancy(occupancyFromPieces([...pieces]), { turn });
}

/**
 * Whether a fork problem is worth asking.
 *
 * Rejects problems with no solution, and problems so loose that almost any
 * square works — a queen forking two adjacent squares has dozens of answers
 * and trains nothing.
 */
export function isUsefulForkProblem(solutions: readonly SquareName[], maxSolutions = 6): boolean {
  return solutions.length >= 1 && solutions.length <= maxSolutions;
}

/* ------------------------------------------------------------------ *
 * Manoeuvring a piece to a fork square
 * ------------------------------------------------------------------ */

/**
 * Squares a piece can slide or leap to while manoeuvring, without capturing.
 *
 * Captures are excluded on purpose. The exercise asks the user to *reach* a
 * square that forks two targets; letting the queen capture would remove a
 * target mid-problem and change the question underneath them. Keeping the
 * position fixed is what makes a minimum-move count meaningful.
 */
export function journeyMoves(
  piece: { type: PieceType; color: PieceColor },
  from: SquareName,
  occupancy: Occupancy,
): SquareName[] {
  const withoutSelf = new Map(occupancy);
  withoutSelf.delete(from);

  // `blockerPolicy: 'exclude'` stops rays at the first piece and never counts
  // the occupied square itself, which is exactly "slide to an empty square".
  return geometricTargets(piece, from, { occupancy: withoutSelf }).filter(
    (square) => !withoutSelf.has(square),
  );
}

/** True when a piece standing on `square` attacks every target. */
export function forksFrom(
  piece: { type: PieceType; color: PieceColor },
  square: SquareName,
  targets: readonly SquareName[],
  occupancy: Occupancy,
): boolean {
  const withPiece = new Map(occupancy);
  withPiece.delete(square);
  withPiece.set(square, { type: piece.type, color: piece.color });
  return attacksAll(piece, square, targets, withPiece);
}

export interface JourneyPlan {
  /** Fewest moves needed to reach a forking square, or null if unreachable. */
  minMoves: number;
  /** One shortest route, starting at the origin. */
  route: SquareName[];
  /** Every square from which the piece forks the targets and can be reached. */
  goals: SquareName[];
}

/**
 * Breadth-first search for the fewest moves that put a piece on a square
 * attacking both targets.
 *
 * Nodes are squares the piece may occupy; edges are non-capturing moves.
 * Returns null when no forking square is reachable, which is how the generator
 * rejects an unsolvable problem before ever showing it.
 */
export function planJourney(
  piece: { type: PieceType; color: PieceColor },
  from: SquareName,
  targets: readonly SquareName[],
  occupancy: Occupancy,
  maxMoves = 4,
): JourneyPlan | null {
  // Already forking: zero moves needed.
  if (forksFrom(piece, from, targets, occupancy)) {
    return { minMoves: 0, route: [from], goals: [from] };
  }

  const previous = new Map<SquareName, SquareName>();
  const visited = new Set<SquareName>([from]);
  let frontier: SquareName[] = [from];
  let depth = 0;

  while (frontier.length > 0 && depth < maxMoves) {
    depth += 1;
    const next: SquareName[] = [];

    for (const square of frontier) {
      // The piece is standing on `square` for this hop.
      const here = new Map(occupancy);
      here.delete(from);
      here.set(square, { type: piece.type, color: piece.color });

      for (const destination of journeyMoves(piece, square, here)) {
        if (visited.has(destination)) continue;
        visited.add(destination);
        previous.set(destination, square);

        if (forksFrom(piece, destination, targets, occupancy)) {
          const route: SquareName[] = [destination];
          let current = destination;
          while (current !== from) {
            const step = previous.get(current) as SquareName;
            route.push(step);
            current = step;
          }
          route.reverse();

          return {
            minMoves: depth,
            route,
            goals: collectGoals(piece, targets, occupancy, visited),
          };
        }

        next.push(destination);
      }
    }

    frontier = next;
  }

  return null;
}

function collectGoals(
  piece: { type: PieceType; color: PieceColor },
  targets: readonly SquareName[],
  occupancy: Occupancy,
  reachable: ReadonlySet<SquareName>,
): SquareName[] {
  return [...reachable].filter((square) => forksFrom(piece, square, targets, occupancy)).sort();
}
