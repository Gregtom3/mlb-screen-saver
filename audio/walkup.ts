// Procedural batter walk-up jingles. Each player gets a deterministic
// signature riff seeded by their playerId — so as a season unfolds you start
// to recognize a star's intro. Squarewave melody + triangle sub + a hint of
// noise hi-hat, all on the existing WebAudio primitives.
//
// The jingle plays on a `walkup-start` pulse and fades on the next pitch.
// Active jingles are tracked so a channel switch / new batter cleanly stops
// the prior one.

import { ensureAudio, makeNoise, SCHEDULE_LEAD_SEC } from './bus.js';

interface ActiveJingle {
  readonly nodes: readonly { osc?: OscillatorNode; src?: AudioBufferSourceNode; gain: GainNode }[];
  readonly endTime: number;
}

let active: ActiveJingle | null = null;

// Tiny seeded PRNG so the same playerId always produces the same melody.
const fnv = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

const mulberry32 = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Pentatonic-ish scales keyed by the team color hint; pleasant for chiptune
// without locking into any one mode. Each scale is a list of MIDI offsets
// from the root.
const MAJOR_PENT = [0, 2, 4, 7, 9, 12];
const MINOR_PENT = [0, 3, 5, 7, 10, 12];

// Convert a MIDI note (where 69 = A4 / 440 Hz) to frequency.
const midiToHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

interface WalkupOpts {
  readonly playerId: string;
  /** 0..1 — louder for stars. */
  readonly intensity: number;
  /** Total duration the jingle is allowed to play. */
  readonly durationMs: number;
  /** Optional team hint — affects scale choice (light vs. minor). */
  readonly teamColorHint?: string;
}

/** Start a walk-up jingle for a batter. Stops any prior jingle first. */
export function startWalkup(opts: WalkupOpts): void {
  stopWalkup();
  const intensity = clamp01(opts.intensity);
  const dSec = opts.durationMs / 1000;
  const { ctx, walkupGain } = ensureAudio();
  const t0 = ctx.currentTime + SCHEDULE_LEAD_SEC;

  // Seed melody from playerId; fold the team hint into seed so two players
  // sharing a name pool still differ.
  const seed = fnv(`${opts.playerId}|${opts.teamColorHint ?? ''}`);
  const rand = mulberry32(seed);

  // Scale + key. Stars get a slightly higher base octave so their riff
  // perks above the bed; non-stars stay grounded.
  const isMinor = rand() < 0.45;
  const scale = isMinor ? MINOR_PENT : MAJOR_PENT;
  const rootMidi = 60 + Math.floor(rand() * 7); // C4..G4

  // Melody length scales with intensity — stars get a longer intro.
  const noteCount = Math.max(4, Math.min(12, Math.round(4 + intensity * 8)));

  const beatSec = Math.min(0.32, dSec / Math.max(noteCount + 1, 5));
  const nodes: { osc?: OscillatorNode; src?: AudioBufferSourceNode; gain: GainNode }[] = [];

  for (let i = 0; i < noteCount; i++) {
    const noteIdx = Math.floor(rand() * scale.length);
    const midi = rootMidi + scale[noteIdx]!;
    const freq = midiToHz(midi);
    const ts = t0 + i * beatSec;

    // Square-wave melody.
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, ts);
    og.gain.linearRampToValueAtTime(0.18 * intensity, ts + 0.01);
    og.gain.setValueAtTime(0.18 * intensity, ts + beatSec * 0.55);
    og.gain.linearRampToValueAtTime(0.0001, ts + beatSec * 0.95);
    osc.connect(og).connect(walkupGain);
    osc.start(ts);
    osc.stop(ts + beatSec * 0.97);
    nodes.push({ osc, gain: og });

    // Triangle sub one octave below — adds body without competing with bed.
    if (i % 2 === 0) {
      const sub = ctx.createOscillator();
      sub.type = 'triangle';
      sub.frequency.value = freq / 2;
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, ts);
      sg.gain.linearRampToValueAtTime(0.10 * intensity, ts + 0.01);
      sg.gain.setValueAtTime(0.10 * intensity, ts + beatSec * 0.55);
      sg.gain.linearRampToValueAtTime(0.0001, ts + beatSec * 0.95);
      sub.connect(sg).connect(walkupGain);
      sub.start(ts);
      sub.stop(ts + beatSec * 0.97);
      nodes.push({ osc: sub, gain: sg });
    }

    // Noise hi-hat off-beat for groove.
    if (i % 2 === 1 && intensity > 0.5) {
      const hh = ctx.createBufferSource();
      hh.buffer = makeNoise(ctx, 0.06);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 6000;
      const hg = ctx.createGain();
      hg.gain.setValueAtTime(0.0001, ts);
      hg.gain.linearRampToValueAtTime(0.06 * intensity, ts + 0.005);
      hg.gain.linearRampToValueAtTime(0.0001, ts + beatSec * 0.4);
      hh.connect(hp).connect(hg).connect(walkupGain);
      hh.start(ts);
      hh.stop(ts + beatSec * 0.5);
      nodes.push({ src: hh, gain: hg });
    }
  }

  active = { nodes, endTime: t0 + dSec };
}

/** Cut any active jingle quickly (used when first pitch fires or batter changes). */
export function stopWalkup(): void {
  if (!active) return;
  const { ctx } = ensureAudio();
  const t = ctx.currentTime + SCHEDULE_LEAD_SEC;
  for (const n of active.nodes) {
    try {
      n.gain.gain.cancelScheduledValues(t);
      n.gain.gain.setTargetAtTime(0.0001, t, 0.05);
      if (n.osc) n.osc.stop(t + 0.2);
      if (n.src) n.src.stop(t + 0.2);
    } catch {
      // already stopped or not yet started
    }
  }
  active = null;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
