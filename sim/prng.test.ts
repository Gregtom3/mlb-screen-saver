import { describe, expect, it } from 'vitest';
import { createPRNG } from './prng.js';

describe('createPRNG', () => {
  it('is deterministic for a given seed', () => {
    const a = createPRNG(42);
    const b = createPRNG(42);
    const seqA = Array.from({ length: 16 }, () => a.next());
    const seqB = Array.from({ length: 16 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('diverges for different seeds', () => {
    const a = createPRNG(1);
    const b = createPRNG(2);
    expect(a.next()).not.toEqual(b.next());
  });

  it('produces values in [0, 1)', () => {
    const r = createPRNG(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('forks deterministically by label', () => {
    const parent = createPRNG(99);
    const a1 = parent.fork('teams');
    const parent2 = createPRNG(99);
    const a2 = parent2.fork('teams');
    expect(a1.next()).toEqual(a2.next());
  });

  it('fork labels produce independent streams', () => {
    const parent = createPRNG(99);
    const teams = parent.fork('teams');
    const draft = parent.fork('draft');
    expect(teams.next()).not.toEqual(draft.next());
  });
});
