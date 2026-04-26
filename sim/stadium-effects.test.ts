import { describe, expect, it } from 'vitest';
import { adjustmentsFor, NEUTRAL_ADJUSTMENTS } from './stadium-effects.js';

describe('stadium-effects.adjustmentsFor', () => {
  it('returns neutral for missing or cosmetic-only quirks', () => {
    expect(adjustmentsFor(undefined)).toEqual(NEUTRAL_ADJUSTMENTS);
    expect(adjustmentsFor({ kind: 'ivy-wall', side: 'left' })).toEqual(NEUTRAL_ADJUSTMENTS);
    expect(adjustmentsFor({ kind: 'hill-cf' })).toEqual(NEUTRAL_ADJUSTMENTS);
    expect(adjustmentsFor({ kind: 'pond-beyond-rf' })).toEqual(NEUTRAL_ADJUSTMENTS);
  });

  it('boosts HR rate for short porches, more so the shorter the porch', () => {
    const longPorch = adjustmentsFor({ kind: 'short-porch', side: 'right', distanceFt: 318 });
    const shortPorch = adjustmentsFor({ kind: 'short-porch', side: 'right', distanceFt: 305 });
    expect(longPorch.hrRateMul).toBeGreaterThan(1);
    expect(shortPorch.hrRateMul).toBeGreaterThan(longPorch.hrRateMul);
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

  it('deep center cuts HR but adds triples', () => {
    const deep = adjustmentsFor({ kind: 'deep-center', distanceFt: 425 });
    expect(deep.hrRateMul).toBeLessThan(1);
    expect(deep.tripleRateMul).toBeGreaterThan(1);
  });
});
