import { describe, expect, it } from 'vitest';
import type { Coach, CoachRatings, CoachingStaff } from '../world/types.js';
import {
  NEUTRAL_COACHING_MODS,
  modsForCoaching,
} from './coaching-effects.js';

const ratings = (overrides: Partial<CoachRatings> = {}): CoachRatings => ({
  tactics: 50,
  morale: 50,
  baserunningCoaching: 50,
  pickoffAwareness: 50,
  aggression: 50,
  judgment: 50,
  ...overrides,
});

const coach = (
  id: string,
  role: Coach['role'],
  overrides: Partial<CoachRatings> = {},
): Coach => ({
  id,
  firstName: 'Test',
  lastName: 'Coach',
  role,
  ratings: ratings(overrides),
});

const staffWith = (
  head: Partial<CoachRatings>,
  firstBase: Partial<CoachRatings>,
  thirdBase: Partial<CoachRatings>,
): CoachingStaff => ({
  head: coach('h', 'head', head),
  firstBase: coach('1b', 'first-base', firstBase),
  thirdBase: coach('3b', 'third-base', thirdBase),
});

describe('coaching-effects.modsForCoaching', () => {
  it('returns neutral mods when no staff is provided', () => {
    expect(modsForCoaching(undefined)).toEqual(NEUTRAL_COACHING_MODS);
  });

  it('a 50/50 staff matches the neutral baseline values', () => {
    const mods = modsForCoaching(staffWith({}, {}, {}));
    expect(mods.sendOnSingleRate).toBeCloseTo(NEUTRAL_COACHING_MODS.sendOnSingleRate, 5);
    expect(mods.tagUpSuccessRate).toBeCloseTo(NEUTRAL_COACHING_MODS.tagUpSuccessRate, 5);
    expect(mods.infieldShiftDeg).toBe(0);
    expect(mods.stealAdvantage).toBe(1);
    expect(mods.pickoffPrevention).toBe(1);
  });

  it('a high-aggression 3B coach raises the send-on-single rate', () => {
    const aggressive = modsForCoaching(staffWith({}, {}, { aggression: 99 }));
    const cautious = modsForCoaching(staffWith({}, {}, { aggression: 1 }));
    expect(aggressive.sendOnSingleRate).toBeGreaterThan(cautious.sendOnSingleRate);
    expect(aggressive.sendOnSingleRate).toBeGreaterThan(NEUTRAL_COACHING_MODS.sendOnSingleRate);
    expect(cautious.sendOnSingleRate).toBeLessThan(NEUTRAL_COACHING_MODS.sendOnSingleRate);
    // Probability stays in [0, 1] across the rating range.
    expect(aggressive.sendOnSingleRate).toBeLessThanOrEqual(1);
    expect(cautious.sendOnSingleRate).toBeGreaterThanOrEqual(0);
  });

  it('a high-judgment 3B coach raises the tag-up success rate', () => {
    const sharp = modsForCoaching(staffWith({}, {}, { judgment: 99 }));
    const fuzzy = modsForCoaching(staffWith({}, {}, { judgment: 1 }));
    expect(sharp.tagUpSuccessRate).toBeGreaterThan(fuzzy.tagUpSuccessRate);
    expect(sharp.tagUpSuccessRate).toBeLessThanOrEqual(1);
    expect(fuzzy.tagUpSuccessRate).toBeGreaterThanOrEqual(0);
  });

  it('head coach tactics rating drives a non-negative infield shift', () => {
    const elite = modsForCoaching(staffWith({ tactics: 99 }, {}, {}));
    const average = modsForCoaching(staffWith({ tactics: 50 }, {}, {}));
    const poor = modsForCoaching(staffWith({ tactics: 1 }, {}, {}));
    // A coach below the neutral threshold can't pull the shift negative —
    // 50 is the baseline (no shift) and only above-50 produces a tilt.
    expect(elite.infieldShiftDeg).toBeGreaterThan(0);
    expect(average.infieldShiftDeg).toBe(0);
    expect(poor.infieldShiftDeg).toBe(0);
  });

  it('1B coach ratings populate steal/pickoff fields (data-only until steals ship)', () => {
    const elite1B = modsForCoaching(
      staffWith({}, { baserunningCoaching: 99, pickoffAwareness: 99 }, {}),
    );
    const poor1B = modsForCoaching(
      staffWith({}, { baserunningCoaching: 1, pickoffAwareness: 1 }, {}),
    );
    expect(elite1B.stealAdvantage).toBeGreaterThan(1);
    expect(poor1B.stealAdvantage).toBeLessThan(1);
    // Pickoff prevention is inverted: high awareness = lower opponent
    // pickoff success multiplier.
    expect(elite1B.pickoffPrevention).toBeLessThan(1);
    expect(poor1B.pickoffPrevention).toBeGreaterThan(1);
  });
});
