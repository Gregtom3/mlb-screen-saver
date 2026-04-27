import type { CoachingStaff } from '../world/types.js';

// Coaching-staff plugin registry. Mirrors stadium-effects.ts: each coach
// rating maps to a small set of multipliers / probabilities the core sim
// reads. Coaches never fabricate outcomes — they shift the odds.
//
// Wired today (Phase 5 coaching pass):
//   - Third-base coach: send-on-single rate, tag-up success.
//   - Head coach: infield-shift slice nudge against pull hitters.
//
// Defined here but not yet wired (Phase 6+ activations, listed for clarity):
//   - First-base coach: stealing technique boost, pickoff prevention. Steals
//     and pickoffs aren't in the sim yet; once they land, a single read of
//     CoachingMods.stealAdvantage / pickoffPrevention is the activation.
//   - Head coach `morale`: team-wide rating multiplier. Needs a morale
//     subsystem (clubhouse state across games) to be meaningful; deferred
//     so we don't fake a one-game effect that would confuse later work.

export interface CoachingMods {
  /** 0..1. Probability that a runner on 2B attempts to score on a single. */
  readonly sendOnSingleRate: number;
  /** 0..1. Probability that a runner on 3B successfully tags up on a sac fly. */
  readonly tagUpSuccessRate: number;
  /**
   * Slice-boundary shift applied to pickInfieldPosition, in degrees of
   * spray angle. Positive = boundaries move toward right field (pull side
   * of a LHB); the caller flips sign for RHBs. Magnitude is small —
   * coaches nudge, not flip.
   */
  readonly infieldShiftDeg: number;
  /**
   * Multiplier on stolen-base success rate. Activated when steals ship.
   * Keeps the field non-optional so the data path is exercised today.
   */
  readonly stealAdvantage: number;
  /** Multiplier on pickoff success against this team's runners. <1 = harder. */
  readonly pickoffPrevention: number;
}

export const NEUTRAL_COACHING_MODS: CoachingMods = {
  sendOnSingleRate: 0.85, // baseline: most runners on 2B score on a single
  tagUpSuccessRate: 0.92, // baseline: tag-ups usually work on a sac fly
  infieldShiftDeg: 0,
  stealAdvantage: 1.0,
  pickoffPrevention: 1.0,
};

// Convert a coaching staff into per-game modifiers. Pure function — same
// input always yields the same output, no rng. The sim threads its rng
// separately when consuming these probabilities.
export const modsForCoaching = (
  staff: CoachingStaff | undefined,
): CoachingMods => {
  if (!staff) return NEUTRAL_COACHING_MODS;

  // Third-base coach. Aggression raises the send rate; judgment raises tag-up
  // reliability. A 99/99 coach lifts send rate ~0.85 → ~0.96 and tag-up
  // ~0.92 → ~0.99; a 1/1 coach drops them to ~0.74 / ~0.85.
  const tb = staff.thirdBase.ratings;
  const sendOnSingleRate = clamp01(
    NEUTRAL_COACHING_MODS.sendOnSingleRate + (tb.aggression - 50) * 0.0022,
  );
  const tagUpSuccessRate = clamp01(
    NEUTRAL_COACHING_MODS.tagUpSuccessRate + (tb.judgment - 50) * 0.0014,
  );

  // Head coach. Tactics drives the magnitude of the infield shift. The sim
  // applies the shift in the direction of the batter's pull side, so this
  // value is always non-negative. A 99-tactics coach moves slice boundaries
  // ~3 degrees on a pull hitter; a 50 coach moves them by 0.
  const tactics = staff.head.ratings.tactics;
  const infieldShiftDeg = Math.max(0, (tactics - 50) * 0.06);

  // First-base coach (deferred wiring). Compute the values now so the data
  // path is real and tests can assert direction; the sim doesn't read them
  // yet because steals/pickoffs aren't implemented.
  const fb = staff.firstBase.ratings;
  const stealAdvantage = 1 + (fb.baserunningCoaching - 50) * 0.003;
  const pickoffPrevention = 1 - (fb.pickoffAwareness - 50) * 0.003;

  return {
    sendOnSingleRate,
    tagUpSuccessRate,
    infieldShiftDeg,
    stealAdvantage,
    pickoffPrevention,
  };
};

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
