// Procedural 8-bit-ish SFX. Each function schedules a short sound on the shared
// audio bus. All are fire-and-forget; nodes are GC'd after they finish playing.

import { ensureAudio, makeNoise, SCHEDULE_LEAD_SEC } from './bus.js';

// Attack → brief hold at peak → release. The hold is what makes a transient
// audible on speakers; without it the perceptual loudness collapses.
function envADR(
  g: GainNode,
  t0: number,
  peak: number,
  attack: number,
  hold: number,
  release: number,
): void {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.setValueAtTime(peak, t0 + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
}

/** Catcher mitt pop: leather snap with a soft sub-thump. Triggered on called/swinging strikes and balls received cleanly. */
export function catcherMittPop(when = 0): void {
  const { ctx, master } = ensureAudio();
  const t0 = ctx.currentTime + when + SCHEDULE_LEAD_SEC;

  const noise = ctx.createBufferSource();
  noise.buffer = makeNoise(ctx, 0.09);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2400;
  bp.Q.value = 4;
  const ng = ctx.createGain();
  envADR(ng, t0, 0.95, 0.003, 0.012, 0.07);
  noise.connect(bp).connect(ng).connect(master);
  noise.start(t0);
  noise.stop(t0 + 0.1);

  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(140, t0);
  sub.frequency.exponentialRampToValueAtTime(60, t0 + 0.05);
  const sg = ctx.createGain();
  envADR(sg, t0, 0.55, 0.005, 0.01, 0.07);
  sub.connect(sg).connect(master);
  sub.start(t0);
  sub.stop(t0 + 0.1);
}

/** Fielder glove pop: brighter and tighter than the catcher's mitt — a routine fly-out or grounder caught cleanly. */
export function fielderGlovePop(when = 0): void {
  const { ctx, master } = ensureAudio();
  const t0 = ctx.currentTime + when + SCHEDULE_LEAD_SEC;

  const noise = ctx.createBufferSource();
  noise.buffer = makeNoise(ctx, 0.07);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 3500;
  bp.Q.value = 3;
  const ng = ctx.createGain();
  envADR(ng, t0, 0.9, 0.002, 0.01, 0.06);
  noise.connect(bp).connect(ng).connect(master);
  noise.start(t0);
  noise.stop(t0 + 0.08);

  const body = ctx.createOscillator();
  body.type = 'triangle';
  body.frequency.setValueAtTime(220, t0);
  body.frequency.exponentialRampToValueAtTime(120, t0 + 0.04);
  const bg = ctx.createGain();
  envADR(bg, t0, 0.4, 0.004, 0.008, 0.05);
  body.connect(bg).connect(master);
  body.start(t0);
  body.stop(t0 + 0.08);
}

/** Bat crack: sharp noise burst with a square-wave ping. Fires on every batted ball; layer hardHitWoosh under it for scorched contact. */
export function batCrack(when = 0): void {
  const { ctx, master } = ensureAudio();
  const t0 = ctx.currentTime + when + SCHEDULE_LEAD_SEC;

  const noise = ctx.createBufferSource();
  noise.buffer = makeNoise(ctx, 0.13);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1500;
  const ng = ctx.createGain();
  envADR(ng, t0, 1.0, 0.002, 0.012, 0.1);
  noise.connect(hp).connect(ng).connect(master);
  noise.start(t0);
  noise.stop(t0 + 0.13);

  const ping = ctx.createOscillator();
  ping.type = 'square';
  ping.frequency.setValueAtTime(900, t0);
  ping.frequency.exponentialRampToValueAtTime(280, t0 + 0.06);
  const pg = ctx.createGain();
  envADR(pg, t0, 0.5, 0.003, 0.01, 0.07);
  ping.connect(pg).connect(master);
  ping.start(t0);
  ping.stop(t0 + 0.09);
}

/** Hard-hit woosh: low filtered-noise sweep that follows a scorched line drive or deep fly. Layer with batCrack. */
export function hardHitWoosh(when = 0): void {
  const { ctx, master } = ensureAudio();
  const t0 = ctx.currentTime + when + SCHEDULE_LEAD_SEC;

  const noise = ctx.createBufferSource();
  noise.buffer = makeNoise(ctx, 0.5);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(900, t0);
  bp.frequency.exponentialRampToValueAtTime(180, t0 + 0.4);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.7, t0 + 0.05);
  g.gain.setValueAtTime(0.7, t0 + 0.15);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
  noise.connect(bp).connect(g).connect(master);
  noise.start(t0);
  noise.stop(t0 + 0.5);
}

/** Foul tick: tiny glancing blow on the bat. Ticks off the bat into the catcher's mitt. */
export function foulTick(when = 0): void {
  const { ctx, master } = ensureAudio();
  const t0 = ctx.currentTime + when + SCHEDULE_LEAD_SEC;

  const noise = ctx.createBufferSource();
  noise.buffer = makeNoise(ctx, 0.06);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  const g = ctx.createGain();
  envADR(g, t0, 0.7, 0.002, 0.008, 0.05);
  noise.connect(hp).connect(g).connect(master);
  noise.start(t0);
  noise.stop(t0 + 0.07);
}

/** Big-play organ stinger: short two-note square blip. Inning ends, big plays. Used sparingly. */
export function organStinger(when = 0): void {
  const { ctx, master } = ensureAudio();
  const t0 = ctx.currentTime + when + SCHEDULE_LEAD_SEC;

  const notes = [
    { freq: 392, start: 0, dur: 0.16 }, // G4
    { freq: 523, start: 0.14, dur: 0.26 }, // C5
  ];
  for (const n of notes) {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = n.freq;
    const g = ctx.createGain();
    const ts = t0 + n.start;
    g.gain.setValueAtTime(0.0001, ts);
    g.gain.exponentialRampToValueAtTime(0.32, ts + 0.012);
    g.gain.setValueAtTime(0.32, ts + n.dur * 0.65);
    g.gain.exponentialRampToValueAtTime(0.0001, ts + n.dur);
    osc.connect(g).connect(master);
    osc.start(ts);
    osc.stop(ts + n.dur + 0.02);
  }
}

/** Test tone: clearly audible 440 Hz sine for 250 ms. Use in the audition page to verify the bus is wired up. */
export function testTone(when = 0): void {
  const { ctx, master } = ensureAudio();
  const t0 = ctx.currentTime + when + SCHEDULE_LEAD_SEC;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 440;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.01);
  g.gain.setValueAtTime(0.5, t0 + 0.2);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.27);
}
