// Sustained crowd bed. Procedural-only — three layered noise generators with
// long pink-noise loops, gentle filter modulation, and a faint formant pad
// that gives the wash a vocal-ish "ahhh" quality without any vowel drift
// landing as recognizable speech.
//
// Sources are created once on `start()` and run for the life of the page.
// `setLevel(state)` re-points filter and gain values from the live CrowdState
// so audio reactions and visual reactions stay in lockstep.

import { ensureAudio, makePinkNoise, SCHEDULE_LEAD_SEC } from './bus.js';
import type { CrowdState } from '../ambience/state.js';

interface BedNodes {
  readonly murmur: { src: AudioBufferSourceNode; bp: BiquadFilterNode; gain: GainNode };
  readonly hiss: { src: AudioBufferSourceNode; hp: BiquadFilterNode; gain: GainNode };
  readonly pad: { osc: OscillatorNode; lfoFreq: OscillatorNode; lfoGain: GainNode; gain: GainNode };
}

let nodes: BedNodes | null = null;
let started = false;

// Bed levels at peak (energy=1) per layer. Each is a fraction of the bedGain
// channel — bedGain itself controls the overall mix level.
const MURMUR_PEAK = 0.85;
const HISS_PEAK = 0.18;
const PAD_PEAK = 0.06;

// Floor level for the murmur. Below this the bed feels "off" rather than
// "quiet" so we never go to zero while the game is live.
const MURMUR_FLOOR = 0.18;

const BED_LOOP_SEC = 6.0; // long enough that the loop seam isn't perceptible

export function startBed(): void {
  if (started) return;
  const { ctx, bedGain } = ensureAudio();
  const t0 = ctx.currentTime + SCHEDULE_LEAD_SEC;

  // Layer 1: pink-noise murmur through a moving bandpass. This is the
  // bulk of the crowd. Bandpass center modulates gently with simulated
  // attention.
  const murmurBuf = makePinkNoise(ctx, BED_LOOP_SEC);
  const murmurSrc = ctx.createBufferSource();
  murmurSrc.buffer = murmurBuf;
  murmurSrc.loop = true;
  const murmurBp = ctx.createBiquadFilter();
  murmurBp.type = 'bandpass';
  murmurBp.frequency.value = 600;
  murmurBp.Q.value = 0.7;
  const murmurGain = ctx.createGain();
  murmurGain.gain.value = 0;
  murmurSrc.connect(murmurBp).connect(murmurGain).connect(bedGain);
  murmurSrc.start(t0);

  // Layer 2: a thin highpassed hiss for "air" — keeps the bed from sounding
  // muffled at high energy.
  const hissBuf = makePinkNoise(ctx, BED_LOOP_SEC);
  const hissSrc = ctx.createBufferSource();
  hissSrc.buffer = hissBuf;
  hissSrc.loop = true;
  const hissHp = ctx.createBiquadFilter();
  hissHp.type = 'highpass';
  hissHp.frequency.value = 1800;
  const hissGain = ctx.createGain();
  hissGain.gain.value = 0;
  hissSrc.connect(hissHp).connect(hissGain).connect(bedGain);
  hissSrc.start(t0);

  // Layer 3: a barely-audible "ahhh" pad — sine fundamental at ~220 Hz with
  // a slow LFO on its frequency so it never sits still. Adds vocal warmth
  // beneath the noise wash.
  const pad = ctx.createOscillator();
  pad.type = 'sine';
  pad.frequency.value = 220;
  const padGain = ctx.createGain();
  padGain.gain.value = 0;
  pad.connect(padGain).connect(bedGain);
  pad.start(t0);

  // LFO on the pad frequency. Output range ~±6 Hz so the pad drifts subtly.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.13;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 6;
  lfo.connect(lfoGain).connect(pad.frequency);
  lfo.start(t0);

  nodes = {
    murmur: { src: murmurSrc, bp: murmurBp, gain: murmurGain },
    hiss: { src: hissSrc, hp: hissHp, gain: hissGain },
    pad: { osc: pad, lfoFreq: lfo, lfoGain, gain: padGain },
  };
  started = true;
}

export function isBedRunning(): boolean {
  return started;
}

// Update bed parameters from the live CrowdState. Called every frame from
// the dispatcher; we don't ramp here because the CrowdState already
// changes smoothly and per-frame setTargetAtTime would queue up tons of
// micro-ramps.
export function setBedFromState(state: CrowdState): void {
  if (!nodes) return;
  const { ctx } = ensureAudio();
  const now = ctx.currentTime;

  // Murmur volume: blend energy with attention. Low attention (between
  // innings, blowouts) drops the bed even if base energy is moderate.
  const murmurLevel =
    state.phase === 'live'
      ? MURMUR_FLOOR + (MURMUR_PEAK - MURMUR_FLOOR) * (state.energy * 0.7 + state.attention * 0.3)
      : state.phase === 'final'
        ? Math.max(0.1, MURMUR_PEAK * state.energy * 0.6)
        : 0.06;

  // Filter brightness — more attention = wider mids = clearer "people" tone.
  const bpHz = 480 + 360 * state.attention + state.arousal * 240;

  // Hiss rises with arousal so loud moments feel airy.
  const hissLevel = HISS_PEAK * (0.25 + state.arousal * 0.75) * (state.phase === 'live' || state.phase === 'final' ? 1 : 0);

  // Pad level: only audible at higher energy, helps a tied late game feel
  // tense.
  const padLevel = PAD_PEAK * Math.max(0, state.energy - 0.4) * 1.5;

  // Smooth ramps so frame-by-frame updates don't click.
  setSmooth(nodes.murmur.gain.gain, murmurLevel, now, 0.08);
  setSmooth(nodes.murmur.bp.frequency, bpHz, now, 0.15);
  setSmooth(nodes.hiss.gain.gain, hissLevel, now, 0.10);
  setSmooth(nodes.pad.gain.gain, padLevel, now, 0.20);
}

const setSmooth = (param: AudioParam, target: number, now: number, tau: number): void => {
  // setTargetAtTime with a small tau is cheap and avoids click vs. setting
  // .value directly. Cancel only future scheduled events to avoid stomping
  // ducks scheduled by SFX (those run on bedGain, one level up, so they're
  // independent).
  param.cancelScheduledValues(now);
  param.setTargetAtTime(target, now, tau);
};

// Optional explicit shutdown — used in tests / hot-reload scenarios.
export function stopBed(): void {
  if (!nodes) return;
  try {
    nodes.murmur.src.stop();
    nodes.hiss.src.stop();
    nodes.pad.osc.stop();
    nodes.pad.lfoFreq.stop();
  } catch {
    // already stopped
  }
  nodes = null;
  started = false;
}
