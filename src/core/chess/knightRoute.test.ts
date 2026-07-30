import { describe, expect, it } from 'vitest';
import {
  allShortestKnightRoutes,
  isValidKnightRoute,
  knightDistance,
  maximumKnightDistance,
  shortestKnightRoute,
  squarePairsAtDistance,
} from './knightRoute';
import { knightTargets } from './geometry';
import { ALL_SQUARES } from './square';
import type { SquareName } from './types';

describe('knight routing', () => {
  it('returns a single-square route when origin equals target', () => {
    expect(shortestKnightRoute('d4', 'd4')).toEqual(['d4']);
    expect(knightDistance('d4', 'd4')).toBe(0);
  });

  it('returns a two-square route for a single knight move', () => {
    expect(knightDistance('g1', 'f3')).toBe(1);
    expect(shortestKnightRoute('g1', 'f3')).toEqual(['g1', 'f3']);
  });

  it('reaches every square from every square on an empty board', () => {
    for (const from of ALL_SQUARES) {
      for (const to of ALL_SQUARES) {
        const distance = knightDistance(from, to);
        expect(distance, `${from} -> ${to}`).not.toBeNull();
      }
    }
  });

  it('never needs more than 6 moves on an empty board', () => {
    expect(maximumKnightDistance()).toBe(6);
  });

  it('needs exactly 6 moves for the classic a1-h8 corner problem', () => {
    // a1 to h8 is the known worst case for a knight on an empty board.
    expect(knightDistance('a1', 'h8')).toBe(6);
  });

  it('needs 4 moves between diagonally adjacent corner squares', () => {
    // a1 to b2 is the well-known 4-move case, not 2.
    expect(knightDistance('a1', 'b2')).toBe(4);
  });

  it('is symmetric for every pair of squares', () => {
    for (const from of ALL_SQUARES) {
      for (const to of ALL_SQUARES) {
        expect(knightDistance(from, to), `${from}/${to}`).toBe(knightDistance(to, from));
      }
    }
  });

  it('produces routes that are genuinely legal knight moves', () => {
    for (const from of ALL_SQUARES) {
      for (const to of ALL_SQUARES) {
        const route = shortestKnightRoute(from, to);
        expect(route, `${from} -> ${to}`).not.toBeNull();
        const path = route as SquareName[];
        expect(path[0]).toBe(from);
        expect(path[path.length - 1]).toBe(to);
        for (let i = 1; i < path.length; i += 1) {
          expect(knightTargets(path[i - 1] as SquareName), `${path[i - 1]} -> ${path[i]}`).toContain(
            path[i],
          );
        }
        expect(isValidKnightRoute(path)).toBe(true);
      }
    }
  });

  it('agrees with the BFS distance on route length', () => {
    for (const from of ALL_SQUARES) {
      for (const to of ALL_SQUARES) {
        const route = shortestKnightRoute(from, to) as SquareName[];
        expect(route.length - 1).toBe(knightDistance(from, to));
      }
    }
  });

  it('is deterministic across repeated calls', () => {
    for (let i = 0; i < 5; i += 1) {
      expect(shortestKnightRoute('a1', 'h8')).toEqual(shortestKnightRoute('a1', 'h8'));
    }
  });
});

describe('knight routing with blockers', () => {
  it('routes around a blocked square', () => {
    const direct = shortestKnightRoute('g1', 'f3') as SquareName[];
    expect(direct).toEqual(['g1', 'f3']);

    const blocked = shortestKnightRoute('g1', 'f3', { blocked: new Set<SquareName>(['f3']) });
    expect(blocked).toBeNull();
  });

  it('lengthens a route when an intermediate square is unavailable', () => {
    const open = knightDistance('a1', 'c2');
    expect(open).toBe(1);
    const closed = knightDistance('a1', 'c2', { blocked: new Set<SquareName>(['c2']) });
    expect(closed).toBeNull();
  });

  it('returns null when the knight is completely walled in', () => {
    // A knight on a1 has only b3 and c2; block both.
    const blocked = new Set<SquareName>(['b3', 'c2']);
    expect(shortestKnightRoute('a1', 'h8', { blocked })).toBeNull();
    expect(knightDistance('a1', 'h8', { blocked })).toBeNull();
  });

  it('never routes through a blocked square', () => {
    const blocked = new Set<SquareName>(['c3', 'd2', 'e4']);
    for (const to of ALL_SQUARES) {
      const route = shortestKnightRoute('a1', to, { blocked });
      if (route === null) continue;
      for (const square of route.slice(1)) {
        expect(blocked.has(square), `${square} in route to ${to}`).toBe(false);
      }
    }
  });
});

describe('all shortest routes', () => {
  it('finds every shortest route and they all have the same length', () => {
    const routes = allShortestKnightRoutes('a1', 'b2');
    expect(routes.length).toBeGreaterThan(1);
    const distance = knightDistance('a1', 'b2') as number;
    for (const route of routes) {
      expect(route.length - 1).toBe(distance);
      expect(isValidKnightRoute(route)).toBe(true);
      expect(route[0]).toBe('a1');
      expect(route[route.length - 1]).toBe('b2');
    }
  });

  it('includes the route the shortest-path search returns', () => {
    const single = shortestKnightRoute('b1', 'e4') as SquareName[];
    const all = allShortestKnightRoutes('b1', 'e4');
    expect(all.some((route) => route.join() === single.join())).toBe(true);
  });

  it('returns one trivial route for identical squares', () => {
    expect(allShortestKnightRoutes('d4', 'd4')).toEqual([['d4']]);
  });
});

describe('route validation', () => {
  it('rejects a path containing a non-knight move', () => {
    expect(isValidKnightRoute(['a1', 'a2'])).toBe(false);
    expect(isValidKnightRoute(['a1', 'b3', 'b4'])).toBe(false);
  });

  it('accepts a legal path', () => {
    expect(isValidKnightRoute(['a1', 'b3', 'd4'])).toBe(true);
  });

  it('rejects an empty path', () => {
    expect(isValidKnightRoute([])).toBe(false);
  });
});

describe('pair generation by distance', () => {
  it('finds pairs at each supported distance', () => {
    for (let distance = 1; distance <= 5; distance += 1) {
      const pairs = squarePairsAtDistance(distance);
      expect(pairs.length, `distance ${distance}`).toBeGreaterThan(0);
      for (const [from, to] of pairs.slice(0, 10)) {
        expect(knightDistance(from, to)).toBe(distance);
      }
    }
  });

  it('finds exactly the two corner pairs at distance 6', () => {
    // Both long diagonals produce a 6-move corner-to-corner problem.
    const pairs = squarePairsAtDistance(6);
    expect(pairs).toEqual([
      ['a1', 'h8'],
      ['a8', 'h1'],
    ]);
  });
});
