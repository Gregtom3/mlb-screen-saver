import { describe, expect, it } from 'vitest';
import { adjustmentsFor, NEUTRAL_ADJUSTMENTS } from './stadium-effects.js';

describe('stadium-effects.adjustmentsFor', () => {
  it('returns neutral for missing or cosmetic-only quirks', () => {
    expect(adjustmentsFor(undefined)).toEqual(NEUTRAL_ADJUSTMENTS);
    expect(adjustmentsFor({ kind: 'ivy-wall', side: 'left' })).toEqual(NEUTRAL_ADJUSTMENTS);
    expect(adjustmentsFor({ kind: 'hill-cf' })).toEqual(NEUTRAL_ADJUSTMENTS);
    expect(adjustmentsFor({ kind: 'pond-beyond-rf' })).toEqual(NEUTRAL_ADJUSTMENTS);
  });

  it('short-porch leaves HR rate neutral (Phase 5: HR uptick is emergent from geometry)', () => {
    const longPorch = adjustmentsFor({ kind: 'short-porch', side: 'right', distanceFt: 318 });
    const shortPorch = adjustmentsFor({ kind: 'short-porch', side: 'right', distanceFt: 305 });
    expect(longPorch.hrRateMul).toBe(1.0);
    expect(shortPorch.hrRateMul).toBe(1.0);
    // Doubles still get a small bump — the high short-porch wall ricochets
    // some flies into wall-balls.
    expect(longPorch.doubleRateMul).toBeGreaterThan(1);
  });

  it('boosts HR rate at altitude proportional to elevation', () => {
    const denver = adjustmentsFor({ kind: 'altitude-thin-air', elevationFt: 5430 });
    expect(denver.hrRateMul).toBeGreaterThan(1.1);
    expect(denver.tripleRateMul).toBeGreaterThan(1);
  });

  it('wind-tunnel out boosts, wind-tunnel in suppresses', () => {
    const out = adjustmentsFor({ kind: 'wind-tunnel', direction: 'out' });
    const inn = adjustmentsFor({ kind: 'wind-tunnel', direction: 'in' });
    const cross = adjustmentsFor({ kind: 'wind-tunnel', direction: 'cross' });
    expect(out.hrRateMul).toBeGreaterThan(1);
    expect(inn.hrRateMul).toBeLessThan(1);
    expect(cross).toEqual(NEUTRAL_ADJUSTMENTS);
  });

  it('deep center leaves HR rate neutral (Phase 5: HR cut is emergent from geometry); still adds triples', () => {
    const deep = adjustmentsFor({ kind: 'deep-center', distanceFt: 425 });
    expect(deep.hrRateMul).toBe(1.0);
    expect(deep.tripleRateMul).toBeGreaterThan(1);
  });
});
