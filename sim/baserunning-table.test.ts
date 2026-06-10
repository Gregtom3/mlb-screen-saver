import { describe, expect, it } from 'vitest';
import { advanceForOutcome } from './game.js';
import { NEUTRAL_COACHING_MODS } from './coaching-effects.js';
import { createPRNG } from './prng.js';
import type { BasesState } from './types.js';

const B = 'batter' as const;
const R1 = 'runner1' as const;
const R2 = 'runner2' as const;
const R3 = 'runner3' as const;

const bases = (first?: string, second?: string, third?: string): BasesState => ({
  first: first ?? null,
  second: second ?? null,
  third: third ?? null,
});

// Helper that runs advanceForOutcome with a fixed seed.
const adv = (
  outcome: Parameters<typeof advanceForOutcome>[0],
  b: BasesState,
  outs: number,
  seed = 42,
) => advanceForOutcome(outcome, B, b, outs, createPRNG(seed), NEUTRAL_COACHING_MODS);

describe('fielders-choice baserunning', () => {
  it('forces the runner on 2nd to 3rd when 1st and 2nd are occupied', () => {
    const res = adv('fielders-choice', bases(R1, R2), 0);
    expect(res.outsAdded).toBe(1);
    expect(res.newBases.first).toBe(B); // batter safe at 1st
    expect(res.newBases.second).toBeNull(); // lead runner forced out there
    expect(res.newBases.third).toBe(R2); // trailing force moved up
    expect(res.runsScored).toBe(0);
  });

  it('scores the forced runner from 3rd with the bases loaded', () => {
    const res = adv('fielders-choice', bases(R1, R2, R3), 1);
    expect(res.outsAdded).toBe(1);
    expect(res.runsScored).toBe(1);
    expect(res.newBases.third).toBe(R2);
    expect(res.newBases.first).toBe(B);
  });

  it('holds an unforced runner on 3rd (runners on 1st and 3rd)', () => {
    const res = adv('fielders-choice', bases(R1, undefined, R3), 0);
    expect(res.runsScored).toBe(0);
    expect(res.newBases.third).toBe(R3);
    expect(res.newBases.first).toBe(B);
  });
});

describe('double-play baserunning', () => {
  it('does not score the runner from 3rd when the DP ends the inning', () => {
    const res = adv('double-play', bases(R1, undefined, R3), 1);
    expect(res.outsAdded).toBe(2);
    expect(res.runsScored).toBe(0);
  });

  it('scores the runner from 3rd on a 0-out double play', () => {
    const res = adv('double-play', bases(R1, undefined, R3), 0);
    expect(res.outsAdded).toBe(2);
    expect(res.runsScored).toBe(1);
  });
});

describe('groundout productive outs', () => {
  it('advances forced runners when the grounder beats the force (<2 outs)', () => {
    // Runner on 1st only: a groundout in this state means the force was
    // beaten, so the runner takes 2nd.
    const res = adv('groundout', bases(R1), 0);
    expect(res.outsAdded).toBe(1);
    expect(res.newBases.first).toBeNull();
    expect(res.newBases.second).toBe(R1);
  });

  it('always scores the forced runner from 3rd with the bases loaded (<2 outs)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const res = adv('groundout', bases(R1, R2, R3), 1, seed);
      expect(res.runsScored).toBe(1);
      expect(res.newBases.third).toBe(R2);
      expect(res.newBases.second).toBe(R1);
      expect(res.newBases.first).toBeNull();
    }
  });

  it('holds all runners with 2 outs (inning-ending out)', () => {
    const res = adv('groundout', bases(R1, R2, R3), 2);
    expect(res.runsScored).toBe(0);
    expect(res.newBases.first).toBe(R1);
    expect(res.newBases.second).toBe(R2);
    expect(res.newBases.third).toBe(R3);
  });

  it('scores the runner from 3rd about half the time when unforced (<2 outs)', () => {
    let scored = 0;
    const trials = 400;
    for (let seed = 1; seed <= trials; seed++) {
      const res = adv('groundout', bases(undefined, undefined, R3), 0, seed);
      if (res.runsScored === 1) scored += 1;
      else expect(res.newBases.third).toBe(R3); // held runner stays put
    }
    expect(scored / trials).toBeGreaterThan(0.35);
    expect(scored / trials).toBeLessThan(0.65);
  });

  it('never stacks two runners on the same base', () => {
    for (let seed = 1; seed <= 200; seed++) {
      for (const state of [bases(R1, R2), bases(R1, undefined, R3), bases(undefined, R2, R3)]) {
        const res = adv('groundout', state, 0, seed);
        const occupied = [res.newBases.first, res.newBases.second, res.newBases.third].filter(
          (x) => x !== null,
        );
        expect(new Set(occupied).size).toBe(occupied.length);
      }
    }
  });
});
