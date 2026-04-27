// Wave-envelope tracker. Each ReactionPulse with a `centerAngleDeg` becomes
// a short-lived wave on the bowl. We layer simultaneous waves by picking
// the strongest one each frame and decaying envelopes per dt.

import type { ReactionPulse } from './state.js';

interface WaveEnvelope {
  centerAngleDeg: number;
  // Current envelope value 0..1.
  level: number;
  // Peak target the envelope ramps toward during attack.
  peak: number;
  // Time remaining in the attack phase (seconds). Once 0 we hold, then release.
  attackLeft: number;
  // Time remaining in the sustain (seconds).
  sustainLeft: number;
  // Release tau (seconds) — exponential decay constant after sustain.
  releaseTau: number;
}

export interface WaveTracker {
  /** Spawn waves for each pulse in the batch that has a centerAngleDeg. */
  spawnFromPulses(pulses: readonly ReactionPulse[]): void;
  /** Advance every active envelope by dt seconds and prune expired ones. */
  advance(dtSeconds: number): void;
  /** Read the current dominant wave for the renderer. */
  current(): { centerAngleDeg?: number; strength?: number };
  /** Drop all active waves (channel switch, game reset). */
  reset(): void;
}

const ATTACK_SEC = 0.08;
const RELEASE_TAU = 0.6;

export const createWaveTracker = (): WaveTracker => {
  let envelopes: WaveEnvelope[] = [];

  const spawnFromPulses = (pulses: readonly ReactionPulse[]): void => {
    for (const p of pulses) {
      if (p.centerAngleDeg === undefined) continue;
      // Walkup pulses don't drive a wave — they're at the plate.
      if (p.kind === 'walkup-start') continue;
      envelopes.push({
        centerAngleDeg: p.centerAngleDeg,
        level: 0,
        peak: Math.min(1, p.intensity),
        attackLeft: ATTACK_SEC,
        sustainLeft: Math.max(0, p.durationMs / 1000 - ATTACK_SEC),
        releaseTau: RELEASE_TAU,
      });
    }
  };

  const advance = (dt: number): void => {
    const next: WaveEnvelope[] = [];
    for (const e of envelopes) {
      if (e.attackLeft > 0) {
        const step = Math.min(dt, e.attackLeft);
        e.level += (e.peak - e.level) * (step / Math.max(0.001, e.attackLeft));
        e.attackLeft -= step;
      } else if (e.sustainLeft > 0) {
        e.sustainLeft -= dt;
      } else {
        e.level *= Math.pow(0.5, dt / e.releaseTau);
      }
      if (e.level > 0.02 || e.sustainLeft > 0 || e.attackLeft > 0) next.push(e);
    }
    envelopes = next;
  };

  const current = (): { centerAngleDeg?: number; strength?: number } => {
    if (envelopes.length === 0) return {};
    let best = envelopes[0]!;
    for (let i = 1; i < envelopes.length; i++) {
      const e = envelopes[i]!;
      if (e.level > best.level) best = e;
    }
    return { centerAngleDeg: best.centerAngleDeg, strength: best.level };
  };

  const reset = (): void => {
    envelopes = [];
  };

  return { spawnFromPulses, advance, current, reset };
};
