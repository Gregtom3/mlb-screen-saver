// Procedural crowd-reaction one-shots. Each function corresponds to one
// PulseKind from /ambience: roar, cheer, oo, gasp, groan, rally-clap,
// two-strike-clap, applause-tail. All routed through the reactionGain
// channel and ducking the bed + walk-up briefly so they sit on top.

import { duckBed, duckWalkup, ensureAudio, makeNoise, makePinkNoise, SCHEDULE_LEAD_SEC } from './bus.js';

// Light envelope helper — linear ramps for the crowd layers, since
// transient SFX shapes don't apply.
function envSwell(
  g: GainNode,
  t0: number,
  peak: number,
  attack: number,
  hold: number,
  release: number,
): void {
  g.gain.cancelScheduledValues(t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.setValueAtTime(peak, t0 + attack + hold);
  g.gain.linearRampToValueAtTime(0.0001, t0 + attack + hold + release);
}

/** Roar: layered noise + formant fundamentals. The big home-run / walkoff cheer. */
export function roar(intensity: number, durationMs: number): void {
  const I = clamp01(intensity);
  const dSec = durationMs / 1000;
  const { ctx, reactionGain } = ensureAudio();
  duckBed(0.95);
  duckWalkup(1.0);
  const t0 = ctx.currentTime + SCHEDULE_LEAD_SEC;

  const noise = ctx.createBufferSource();
  noise.buffer = makePinkNoise(ctx, dSec + 0.5);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.5;
  bp.frequency.setValueAtTime(900, t0);
  bp.frequency.exponentialRampToValueAtTime(1700, t0 + dSec * 0.25);
  bp.frequency.exponentialRampToValueAtTime(700, t0 + dSec);
  const ng = ctx.createGain();
  envSwell(ng, t0, 0.95 * I, dSec * 0.18, dSec * 0.55, dSec * 0.27);
  noise.connect(bp).connect(ng).connect(reactionGain);
  noise.start(t0);
  noise.stop(t0 + dSec + 0.6);

  // Formant cluster — three sine partials around 350 / 700 / 1300 Hz add
  // a "voice" feeling without sounding like a synth lead.
  const partials: ReadonlyArray<{ freq: number; level: number }> = [
    { freq: 320, level: 0.18 },
    { freq: 700, level: 0.10 },
    { freq: 1280, level: 0.06 },
  ];
  for (const p of partials) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = p.freq;
    const og = ctx.createGain();
    envSwell(og, t0, p.level * I, dSec * 0.25, dSec * 0.5, dSec * 0.25);
    o.connect(og).connect(reactionGain);
    o.start(t0);
    o.stop(t0 + dSec + 0.2);
  }
}

/** Cheer: shorter, brighter, more sustained than a roar; rallies and Ks. */
export function cheer(intensity: number, durationMs: number): void {
  const I = clamp01(intensity);
  const dSec = durationMs / 1000;
  const { ctx, reactionGain } = ensureAudio();
  duckBed(0.7);
  duckWalkup(0.8);
  const t0 = ctx.currentTime + SCHEDULE_LEAD_SEC;

  const noise = ctx.createBufferSource();
  noise.buffer = makePinkNoise(ctx, dSec + 0.3);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.6;
  bp.frequency.setValueAtTime(1200, t0);
  bp.frequency.exponentialRampToValueAtTime(1900, t0 + dSec * 0.4);
  bp.frequency.exponentialRampToValueAtTime(900, t0 + dSec);
  const ng = ctx.createGain();
  envSwell(ng, t0, 0.55 * I, dSec * 0.14, dSec * 0.5, dSec * 0.36);
  noise.connect(bp).connect(ng).connect(reactionGain);
  noise.start(t0);
  noise.stop(t0 + dSec + 0.4);

  const partial = ctx.createOscillator();
  partial.type = 'sine';
  partial.frequency.setValueAtTime(540, t0);
  partial.frequency.linearRampToValueAtTime(420, t0 + dSec);
  const pg = ctx.createGain();
  envSwell(pg, t0, 0.10 * I, dSec * 0.2, dSec * 0.4, dSec * 0.4);
  partial.connect(pg).connect(reactionGain);
  partial.start(t0);
  partial.stop(t0 + dSec + 0.2);
}

/** Oo: anticipation lift — short ascending bandpass swell. */
export function oo(intensity: number, durationMs: number): void {
  const I = clamp01(intensity);
  const dSec = durationMs / 1000;
  const { ctx, reactionGain } = ensureAudio();
  duckBed(0.4);
  const t0 = ctx.currentTime + SCHEDULE_LEAD_SEC;

  const noise = ctx.createBufferSource();
  noise.buffer = makePinkNoise(ctx, dSec + 0.2);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.0;
  bp.frequency.setValueAtTime(500, t0);
  bp.frequency.exponentialRampToValueAtTime(1300, t0 + dSec * 0.7);
  bp.frequency.exponentialRampToValueAtTime(1100, t0 + dSec);
  const ng = ctx.createGain();
  envSwell(ng, t0, 0.45 * I, dSec * 0.3, dSec * 0.4, dSec * 0.3);
  noise.connect(bp).connect(ng).connect(reactionGain);
  noise.start(t0);
  noise.stop(t0 + dSec + 0.3);
}

/** Gasp: quick filter-rising swell. Suspense rather than celebration. */
export function gasp(intensity: number, durationMs: number): void {
  const I = clamp01(intensity);
  const dSec = durationMs / 1000;
  const { ctx, reactionGain } = ensureAudio();
  duckBed(0.5);
  const t0 = ctx.currentTime + SCHEDULE_LEAD_SEC;

  const noise = ctx.createBufferSource();
  noise.buffer = makeNoise(ctx, dSec + 0.1);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(700, t0);
  bp.frequency.linearRampToValueAtTime(2500, t0 + dSec);
  const ng = ctx.createGain();
  envSwell(ng, t0, 0.4 * I, dSec * 0.4, dSec * 0.3, dSec * 0.3);
  noise.connect(bp).connect(ng).connect(reactionGain);
  noise.start(t0);
  noise.stop(t0 + dSec + 0.2);
}

/** Groan: descending lowpassed sweep. Disappointed home crowd. */
export function groan(intensity: number, durationMs: number): void {
  const I = clamp01(intensity);
  const dSec = durationMs / 1000;
  const { ctx, reactionGain } = ensureAudio();
  duckBed(0.55);
  const t0 = ctx.currentTime + SCHEDULE_LEAD_SEC;

  const noise = ctx.createBufferSource();
  noise.buffer = makePinkNoise(ctx, dSec + 0.3);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1500, t0);
  lp.frequency.exponentialRampToValueAtTime(450, t0 + dSec);
  const ng = ctx.createGain();
  envSwell(ng, t0, 0.55 * I, dSec * 0.2, dSec * 0.3, dSec * 0.5);
  noise.connect(lp).connect(ng).connect(reactionGain);
  noise.start(t0);
  noise.stop(t0 + dSec + 0.3);

  // A sub-oscillator dropping in pitch makes "ohhh" read.
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(260, t0);
  o.frequency.linearRampToValueAtTime(150, t0 + dSec);
  const og = ctx.createGain();
  envSwell(og, t0, 0.18 * I, dSec * 0.2, dSec * 0.3, dSec * 0.5);
  o.connect(og).connect(reactionGain);
  o.start(t0);
  o.stop(t0 + dSec + 0.2);
}

/** Two-strike clap: rhythmic claps locked at ~120 bpm for the duration. */
export function twoStrikeClap(intensity: number, durationMs: number): void {
  const I = clamp01(intensity);
  rhythmicClap(I * 0.55, durationMs, 120);
}

/** Rally clap: slower, building. Fans clapping in unison during a rally. */
export function rallyClap(intensity: number, durationMs: number): void {
  const I = clamp01(intensity);
  rhythmicClap(I * 0.7, durationMs, 92);
}

function rhythmicClap(level: number, durationMs: number, bpm: number): void {
  const { ctx, reactionGain } = ensureAudio();
  duckBed(0.4);
  const beatSec = 60 / bpm;
  const total = Math.max(1, Math.floor(durationMs / 1000 / beatSec));
  const t0 = ctx.currentTime + SCHEDULE_LEAD_SEC;
  for (let i = 0; i < total; i++) {
    const ts = t0 + i * beatSec;
    // Each clap = short noise burst + tiny square ping for clarity.
    const noise = ctx.createBufferSource();
    noise.buffer = makeNoise(ctx, 0.06);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 2;
    const ng = ctx.createGain();
    // Light fade-in across the bar so claps build rather than starting full.
    const fadeIn = Math.min(1, (i + 1) / 4);
    envSwell(ng, ts, level * 0.7 * fadeIn, 0.005, 0.012, 0.06);
    noise.connect(bp).connect(ng).connect(reactionGain);
    noise.start(ts);
    noise.stop(ts + 0.08);
  }
}

/** Applause tail: dense flickering noise that fades out over duration. */
export function applauseTail(intensity: number, durationMs: number): void {
  const I = clamp01(intensity);
  const dSec = durationMs / 1000;
  const { ctx, reactionGain } = ensureAudio();
  duckBed(0.45);
  const t0 = ctx.currentTime + SCHEDULE_LEAD_SEC;

  const noise = ctx.createBufferSource();
  noise.buffer = makePinkNoise(ctx, dSec + 0.5);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1800;
  bp.Q.value = 0.9;
  const ng = ctx.createGain();
  envSwell(ng, t0, 0.5 * I, dSec * 0.1, dSec * 0.25, dSec * 0.65);
  noise.connect(bp).connect(ng).connect(reactionGain);
  noise.start(t0);
  noise.stop(t0 + dSec + 0.5);

  // LFO on filter cutoff makes the wash flicker like dense individual claps.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 7;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 600;
  lfo.connect(lfoGain).connect(bp.frequency);
  lfo.start(t0);
  lfo.stop(t0 + dSec + 0.5);
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
