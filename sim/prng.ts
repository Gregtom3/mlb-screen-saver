// Seedable PRNG. CLAUDE.md: "All randomness flows through a single seedable PRNG
// threaded through the sim. Same seed + same world = byte-identical game."
//
// Using Mulberry32 — small, fast, good enough for game sim, well-distributed.

export interface PRNG {
  readonly seed: number;
  next(): number; // [0, 1)
  int(maxExclusive: number): number; // [0, maxExclusive)
  range(minInclusive: number, maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  fork(label: string): PRNG;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const hashLabel = (label: string, seed: number): number => {
  let h = seed ^ FNV_OFFSET;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
};

export const createPRNG = (seed: number): PRNG => {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const api: PRNG = {
    seed,
    next,
    int: (max) => Math.floor(next() * max),
    range: (lo, hi) => lo + (hi - lo) * next(),
    pick: (items) => {
      if (items.length === 0) throw new Error('PRNG.pick called with empty array');
      const idx = Math.floor(next() * items.length);
      const value = items[idx];
      // noUncheckedIndexedAccess narrowing
      if (value === undefined) throw new Error('PRNG.pick: unreachable index');
      return value;
    },
    // Forking lets a subsystem (e.g. one game, one team's draft) own a sub-stream
    // deterministically derived from its parent — no global counter coupling.
    fork: (label) => createPRNG(hashLabel(label, state)),
  };
  return api;
};
