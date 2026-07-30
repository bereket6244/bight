/**
 * Seedable pseudo-random number generator.
 *
 * Every exercise generator takes an Rng rather than calling Math.random, so
 * generated questions are reproducible in tests and a failing question can be
 * regenerated from its seed when diagnosing a bug report.
 */

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, max). Returns 0 when max <= 0. */
  nextInt(max: number): number;
  /** Integer in [min, max] inclusive. */
  nextIntBetween(min: number, max: number): number;
  /** Uniform choice. Throws on an empty list. */
  pick<T>(items: readonly T[]): T;
  /** Weighted choice. Weights must be non-negative; falls back to uniform. */
  pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number): T;
  /** Uniform sample without replacement, up to `count` items. */
  sample<T>(items: readonly T[], count: number): T[];
  /** Fisher-Yates shuffle returning a new array. */
  shuffle<T>(items: readonly T[]): T[];
  /** True with the given probability. */
  chance(probability: number): boolean;
}

/**
 * mulberry32 — small, fast, and good enough for exercise selection.
 * Not cryptographic; nothing here needs to be unpredictable to an attacker.
 */
export function createRng(seed: number = Date.now()): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const nextInt = (max: number): number => (max <= 0 ? 0 : Math.floor(next() * max));

  const rng: Rng = {
    next,
    nextInt,
    nextIntBetween: (min, max) => min + nextInt(max - min + 1),
    pick: <T,>(items: readonly T[]): T => {
      if (items.length === 0) throw new RangeError('Cannot pick from an empty list');
      return items[nextInt(items.length)] as T;
    },
    pickWeighted: <T,>(items: readonly T[], weightOf: (item: T) => number): T => {
      if (items.length === 0) throw new RangeError('Cannot pick from an empty list');
      const weights = items.map((item) => Math.max(0, weightOf(item)));
      const total = weights.reduce((sum, w) => sum + w, 0);
      if (total <= 0) return rng.pick(items);
      let threshold = next() * total;
      for (let i = 0; i < items.length; i += 1) {
        threshold -= weights[i] as number;
        if (threshold <= 0) return items[i] as T;
      }
      return items[items.length - 1] as T;
    },
    sample: <T,>(items: readonly T[], count: number): T[] =>
      rng.shuffle(items).slice(0, Math.max(0, Math.min(count, items.length))),
    shuffle: <T,>(items: readonly T[]): T[] => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = nextInt(i + 1);
        [out[i], out[j]] = [out[j] as T, out[i] as T];
      }
      return out;
    },
    chance: (probability) => next() < probability,
  };

  return rng;
}

/** Seed derived from the clock, kept in one place so tests can stub it. */
export function randomSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}
