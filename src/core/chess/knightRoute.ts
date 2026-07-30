/**
 * Knight routing: shortest paths between squares, by breadth-first search over
 * the knight graph.
 *
 * BFS makes "shortest" a proven property rather than an asserted one, and the
 * whole graph is only 64 nodes, so exhaustive verification is cheap.
 */

import { knightTargets } from './geometry';
import { ALL_SQUARES } from './square';
import type { Occupancy, SquareName } from './types';

export interface KnightRouteOptions {
  /** Squares the knight may not land on. Blocked squares are simply skipped. */
  blocked?: ReadonlySet<SquareName>;
  /** Occupancy whose occupied squares are treated as blocked. */
  occupancy?: Occupancy;
}

function blockedSet(options: KnightRouteOptions): ReadonlySet<SquareName> {
  if (options.blocked !== undefined) return options.blocked;
  if (options.occupancy !== undefined) return new Set(options.occupancy.keys());
  return new Set<SquareName>();
}

/**
 * One shortest knight path from `from` to `to`, inclusive of both ends.
 * Returns null when no route exists (only possible with blockers).
 *
 * Ties are broken by the alphabetical square order that `knightTargets`
 * returns, which keeps the result deterministic.
 */
export function shortestKnightRoute(
  from: SquareName,
  to: SquareName,
  options: KnightRouteOptions = {},
): SquareName[] | null {
  if (from === to) return [from];

  const blocked = blockedSet(options);
  if (blocked.has(to)) return null;

  const previous = new Map<SquareName, SquareName>();
  const visited = new Set<SquareName>([from]);
  let frontier: SquareName[] = [from];

  while (frontier.length > 0) {
    const nextFrontier: SquareName[] = [];
    for (const square of frontier) {
      for (const neighbour of knightTargets(square)) {
        if (visited.has(neighbour) || blocked.has(neighbour)) continue;
        visited.add(neighbour);
        previous.set(neighbour, square);
        if (neighbour === to) return reconstruct(previous, from, to);
        nextFrontier.push(neighbour);
      }
    }
    frontier = nextFrontier;
  }

  return null;
}

function reconstruct(
  previous: ReadonlyMap<SquareName, SquareName>,
  from: SquareName,
  to: SquareName,
): SquareName[] {
  const path: SquareName[] = [to];
  let current = to;
  while (current !== from) {
    const step = previous.get(current);
    if (step === undefined) throw new Error(`Broken knight route between ${from} and ${to}`);
    path.push(step);
    current = step;
  }
  return path.reverse();
}

/** Number of knight moves between two squares, or null when unreachable. */
export function knightDistance(
  from: SquareName,
  to: SquareName,
  options: KnightRouteOptions = {},
): number | null {
  const route = shortestKnightRoute(from, to, options);
  return route === null ? null : route.length - 1;
}

/** Every shortest route between two squares, for validating a user's path. */
export function allShortestKnightRoutes(
  from: SquareName,
  to: SquareName,
  options: KnightRouteOptions = {},
): SquareName[][] {
  const distance = knightDistance(from, to, options);
  if (distance === null) return [];
  if (distance === 0) return [[from]];

  const blocked = blockedSet(options);
  const routes: SquareName[][] = [];

  const walk = (path: SquareName[]): void => {
    const current = path[path.length - 1] as SquareName;
    if (path.length - 1 === distance) {
      if (current === to) routes.push([...path]);
      return;
    }
    for (const neighbour of knightTargets(current)) {
      if (blocked.has(neighbour) || path.includes(neighbour)) continue;
      // Only follow steps that stay on a shortest path.
      const remaining = knightDistance(neighbour, to, options);
      if (remaining === null || remaining !== distance - path.length) continue;
      walk([...path, neighbour]);
    }
  };

  walk([from]);
  return routes;
}

/** True when the path is a legal sequence of knight moves from start to end. */
export function isValidKnightRoute(
  route: readonly SquareName[],
  options: KnightRouteOptions = {},
): boolean {
  if (route.length === 0) return false;
  const blocked = blockedSet(options);
  for (let i = 1; i < route.length; i += 1) {
    const previous = route[i - 1] as SquareName;
    const current = route[i] as SquareName;
    if (blocked.has(current)) return false;
    if (!knightTargets(previous).includes(current)) return false;
  }
  return true;
}

/**
 * Pairs of squares at a given knight distance. Used to generate route
 * exercises of a chosen difficulty without trial and error.
 */
export function squarePairsAtDistance(distance: number): Array<[SquareName, SquareName]> {
  const pairs: Array<[SquareName, SquareName]> = [];
  for (const from of ALL_SQUARES) {
    for (const to of ALL_SQUARES) {
      if (from >= to) continue;
      if (knightDistance(from, to) === distance) pairs.push([from, to]);
    }
  }
  return pairs;
}

/** The largest knight distance on an empty board. */
export function maximumKnightDistance(): number {
  let max = 0;
  for (const from of ALL_SQUARES) {
    for (const to of ALL_SQUARES) {
      const distance = knightDistance(from, to);
      if (distance !== null && distance > max) max = distance;
    }
  }
  return max;
}
