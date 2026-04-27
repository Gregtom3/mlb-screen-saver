// Leverage heuristic — late-and-close situations score higher. Ported (not
// imported) from /stats/wp.ts so /ambience doesn't drag /stats onto the
// per-frame critical path. The math is simpler than full WP: we just want
// "how much does this pitch matter?" on a 0..1 scale.

export interface LeverageState {
  readonly inning: number;
  readonly half: 'top' | 'bottom';
  readonly outs: number;
  readonly scoreHome: number;
  readonly scoreAway: number;
  readonly bases: { first: boolean; second: boolean; third: boolean };
}

export const computeLeverage = (s: LeverageState): number => {
  const inning = Math.max(1, s.inning);
  const scoreDiff = Math.abs(s.scoreHome - s.scoreAway);

  // Lateness: rises through the game. 1st inning = 0.10, 9th = 0.60.
  const lateness = Math.min(0.6, 0.1 + (inning - 1) * 0.0625);

  // Closeness: tied = 1.0, 1 run = 0.85, 2 = 0.65, 3 = 0.45, 5+ = 0.10.
  const closeness =
    scoreDiff === 0 ? 1
      : scoreDiff === 1 ? 0.85
        : scoreDiff === 2 ? 0.65
          : scoreDiff === 3 ? 0.45
            : scoreDiff === 4 ? 0.25
              : 0.1;

  // Base-out pressure: runners on with few outs is a higher-tension state.
  const baseValue =
    (s.bases.first ? 0.06 : 0) +
    (s.bases.second ? 0.10 : 0) +
    (s.bases.third ? 0.13 : 0);
  const outsFactor = (3 - Math.min(2, s.outs)) / 3;
  const baseOut = baseValue * outsFactor * 3.4; // scale to 0..~1

  // Late-and-close magnification matches /stats/wp.ts spirit.
  const magnify = inning >= 8 && scoreDiff <= 2 ? 1 + (inning - 7) * 0.18 : 1;

  const raw = (lateness * 0.5 + closeness * 0.35 + baseOut * 0.15) * magnify;
  return Math.max(0, Math.min(1, raw));
};
