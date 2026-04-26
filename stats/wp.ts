// Win-probability heuristic.
//
// Phase 5.5 baseline: a closed-form formula that approximates Tom Tango-
// style WP/RE tables. Replace with a vendored lookup (`/stats/wpTable.json`)
// in a follow-up pass; the rest of the system reads through this function
// either way.

export interface WPState {
  readonly inning: number; // 1+
  readonly half: 'top' | 'bottom';
  readonly outs: number; // 0..2 (3 means inning's already over — clamp)
  readonly scoreHome: number;
  readonly scoreAway: number;
  readonly bases: { first: boolean; second: boolean; third: boolean };
}

// Returns P(home wins) given the state. Range: (0.005, 0.995).
export const homeWinProb = (s: WPState): number => {
  const inning = Math.max(1, s.inning);
  const half = s.half;
  const outs = Math.min(2, s.outs);
  const scoreDiff = s.scoreHome - s.scoreAway;

  // How many "team-half-innings" of offense remain. Used to scale how big
  // a deal each run is — early-game runs matter less than late-game runs.
  const halvesRemaining = Math.max(
    0.5,
    9 - inning + (half === 'top' ? 1.5 : 1),
  );

  let wp = 0.5;

  // Run impact. Per-run delta starts ~6% in the 1st inning and grows
  // through the game; capped so a 5-run lead in the 9th doesn't go to 99%
  // (extras can flip the script).
  const perRunDelta = Math.min(0.32, 0.06 + (10 - halvesRemaining) * 0.020);
  wp += scoreDiff * perRunDelta;

  // Home-field bump on tied games (scoreboard alone is symmetric, but the
  // home team gets last licks).
  if (scoreDiff === 0) wp += 0.04;

  // Base-out leverage for the batting team. Runners on with few outs is a
  // stronger position than the bare-out count would suggest.
  const baseValue =
    (s.bases.first ? 0.06 : 0) +
    (s.bases.second ? 0.10 : 0) +
    (s.bases.third ? 0.13 : 0);
  const outsFactor = (3 - outs) / 3;
  const leverageScale = 0.55; // tone down vs. raw leverage
  const baseAdj = baseValue * outsFactor * leverageScale;
  if (half === 'top') wp -= baseAdj; // away team batting → home WP drops
  else wp += baseAdj;

  // Late-and-close magnification: in the 8th+ with the score tight, every
  // bit of leverage matters more. Multiplies the bases-outs adjustment.
  if (inning >= 8 && Math.abs(scoreDiff) <= 2) {
    const magnify = 1 + (inning - 7) * 0.25;
    if (half === 'top') wp -= baseAdj * (magnify - 1);
    else wp += baseAdj * (magnify - 1);
  }

  return Math.max(0.005, Math.min(0.995, wp));
};
