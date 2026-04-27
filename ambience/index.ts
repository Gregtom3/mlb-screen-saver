// /ambience — continuous "crowd model" computed from the SimEvent stream.
// Both /audio (bed, reactions, walk-up) and /render (wave, lighting,
// density) subscribe to the same output so they react cohesively.
//
// /ambience never imports from /render, /ui, /audio, /app or /sim/internals.
// It reads SimEvent shapes, /world types, and (optionally) /stats aggregates.

export type { CrowdState, ReactionPulse, PulseKind } from './state.js';
export { initialCrowdState, quantize } from './state.js';
export { createAmbienceReducer, type AmbienceReducer, type AmbienceFrame, type AmbienceReducerInit } from './reducer.js';
export { buildStarSet, EMPTY_STAR_SET, type StarSet } from './star.js';
export { computeLeverage, type LeverageState } from './leverage.js';
export { createWaveTracker, type WaveTracker } from './wave.js';
