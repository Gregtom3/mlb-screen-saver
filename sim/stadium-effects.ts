import type { StadiumQuirk } from '../world/types.js';

// Phase 4 stadium-quirk plugin registry.
//
// Per CLAUDE.md "stadium quirks affect simulation, not just rendering."
// Each quirk variant gets a small adjustments record that simulateInPlay
// multiplies into its outcome rolls. Cosmetic-only quirks (clock tower,
// mascot statue, ivy, hill, pond) currently return NEUTRAL — they're
// flavor and the renderer can do something visual with them in a later
// pass without the sim caring.
//
// The deliberate constraint: quirks adjust PROBABILITIES, not outcomes
// directly. They can't make a HR; they can shift the odds of one.

export interface QuirkAdjustments {
  /** Multiplier on the home-run probability per in-play roll. */
  readonly hrRateMul: number;
  /** Multiplier on doubles probability — short porches double up too. */
  readonly doubleRateMul: number;
  /** Multiplier on triples probability — deep parks reward speed. */
  readonly tripleRateMul: number;
}

export const NEUTRAL_ADJUSTMENTS: QuirkAdjustments = {
  hrRateMul: 1.0,
  doubleRateMul: 1.0,
  tripleRateMul: 1.0,
};

export const adjustmentsFor = (quirk: StadiumQuirk | undefined): QuirkAdjustments => {
  if (!quirk) return NEUTRAL_ADJUSTMENTS;
  switch (quirk.kind) {
    case 'short-porch': {
      // A short porch puts more flies into the seats on that side. The
      // outcome roll is direction-agnostic in our sim, so we model the
      // *overall* HR uptick — empirically about +10% across the league.
      // Distance-aware boost: shorter porch = bigger effect.
      const distAdj = Math.max(0, (320 - quirk.distanceFt) / 320); // 0..1
      return { hrRateMul: 1.08 + distAdj * 0.18, doubleRateMul: 1.05, tripleRateMul: 1.0 };
    }
    case 'altitude-thin-air': {
      // Thinner air = the ball flies further. Coors-style ~+15% HRs.
      const heightAdj = Math.max(0, (quirk.elevationFt - 1500) / 5000); // 0..~0.8
      return {
        hrRateMul: 1.0 + heightAdj * 0.25,
        doubleRateMul: 1.0 + heightAdj * 0.10,
        tripleRateMul: 1.0 + heightAdj * 0.15, // deep gaps + thin air = more triples
      };
    }
    case 'wind-tunnel': {
      if (quirk.direction === 'out') {
        return { hrRateMul: 1.18, doubleRateMul: 1.05, tripleRateMul: 1.0 };
      }
      if (quirk.direction === 'in') {
        return { hrRateMul: 0.82, doubleRateMul: 0.95, tripleRateMul: 1.0 };
      }
      // Cross-wind — no net change in HR rate; could affect spray (later).
      return NEUTRAL_ADJUSTMENTS;
    }
    case 'deep-center': {
      // Deep CF turns would-be HRs into outs / triples. Baseline 410 ft;
      // each foot deeper drops HR rate slightly.
      const beyondBaseline = Math.max(0, quirk.distanceFt - 410); // 0..30 typical
      const cut = Math.min(0.18, beyondBaseline * 0.005);
      return {
        hrRateMul: 1.0 - cut,
        doubleRateMul: 1.0,
        tripleRateMul: 1.0 + cut * 0.5, // some HRs become triples instead
      };
    }
    case 'ivy-wall':
    case 'hill-cf':
    case 'pond-beyond-rf':
    case 'clock-tower-in-play':
    case 'mascot-statue':
      // Pure flavor (for now). Phase 5+ may wire in fielding wonkiness for
      // hill-cf and ricochet quirks for ivy/clock-tower.
      return NEUTRAL_ADJUSTMENTS;
  }
};
