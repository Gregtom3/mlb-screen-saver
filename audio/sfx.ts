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

/** Slide: gravelly dirt-scrape sweep. Baserunner sliding into a base. */
export function slide(when = 0): void {
  const { ctx, master } = ensureAudio();
  const t0 = ctx.currentTime + when + SCHEDULE_LEAD_SEC;

  const noise = ctx.createBufferSource();
  noise.buffer = makeNoise(ctx, 0.6);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.6;
  bp.frequency.setValueAtTime(1800, t0);
  bp.frequency.exponentialRampToValueAtTime(450, t0 + 0.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.6, t0 + 0.04);
  g.gain.setValueAtTime(0.6, t0 + 0.22);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
  noise.connect(bp).connect(g).connect(master);
  noise.start(t0);
  noise.stop(t0 + 0.6);

  // Low rumble layer for body — the runner's weight on dirt.
  const rumble = ctx.createBufferSource();
  rumble.buffer = makeNoise(ctx, 0.5);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 250;
  const rg = ctx.createGain();
  rg.gain.setValueAtTime(0.0001, t0);
  rg.gain.exponentialRampToValueAtTime(0.35, t0 + 0.05);
  rg.gain.setValueAtTime(0.35, t0 + 0.2);
  rg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
  rumble.connect(lp).connect(rg).connect(master);
  rumble.start(t0);
  rumble.stop(t0 + 0.5);
}

/** Ball toss: light leather whoosh + soft glove pat. Used for casual inter-pitch / inter-inning ball flips and the "around-the-horn" sequence after a strikeout. Quieter than `fielderGlovePop` since these are routine, not putouts. */
export function ballToss(when = 0): void {
  const { ctx, master } = ensureAudio();
  const t0 = ctx.currentTime + when + SCHEDULE_LEAD_SEC;

  // Whoosh: a short bandpassed noise sweep that hints at the ball slicing
  // through the air.
  const whoosh = ctx.createBufferSource();
  whoosh.buffer = makeNoise(ctx, 0.12);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(2400, t0);
  bp.frequency.exponentialRampToValueAtTime(1200, t0 + 0.1);
  const wg = ctx.createGain();
  envADR(wg, t0, 0.35, 0.005, 0.02, 0.08);
  whoosh.connect(bp).connect(wg).connect(master);
  whoosh.start(t0);
  whoosh.stop(t0 + 0.13);

  // Soft pat at the catch — slightly later than the whoosh peak so it reads
  // as "ball arriving in glove".
  const patT = t0 + 0.09;
  const pat = ctx.createBufferSource();
  pat.buffer = makeNoise(ctx, 0.05);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2000;
  const pg = ctx.createGain();
  envADR(pg, patT, 0.5, 0.002, 0.008, 0.04);
  pat.connect(hp).connect(pg).connect(master);
  pat.start(patT);
  pat.stop(patT + 0.06);
}

/** Strike 3 call: chiptune punch-out fanfare — three ascending square-wave notes. Pitch result is third strike. */
export function strike3Call(when = 0): void {
  const { ctx, master } = ensureAudio();
  const t0 = ctx.currentTime + when + SCHEDULE_LEAD_SEC;

  const notes: ReadonlyArray<{ freq: number; start: number; dur: number; peak: number }> = [
    { freq: 392, start: 0, dur: 0.08, peak: 0.32 }, // G4
    { freq: 523, start: 0.09, dur: 0.08, peak: 0.32 }, // C5
    { freq: 659, start: 0.18, dur: 0.26, peak: 0.36 }, // E5 — held
  ];
  for (const n of notes) {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = n.freq;
    const g = ctx.createGain();
    const ts = t0 + n.start;
    g.gain.setValueAtTime(0.0001, ts);
    g.gain.exponentialRampToValueAtTime(n.peak, ts + 0.008);
    g.gain.setValueAtTime(n.peak, ts + n.dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, ts + n.dur);
    osc.connect(g).connect(master);
    osc.start(ts);
    osc.stop(ts + n.dur + 0.02);
  }
}

/** Bat snap: violent wood snap with a splintering tail. Rare frustration trigger after a strikeout. */
export function batSnap(when = 0): void {
  const { ctx, master } = ensureAudio();
  const t0 = ctx.currentTime + when + SCHEDULE_LEAD_SEC;

  // Sharp wood-snap transient: highpassed noise.
  const snap = ctx.createBufferSource();
  snap.buffer = makeNoise(ctx, 0.06);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1800;
  const sg = ctx.createGain();
  envADR(sg, t0, 1.1, 0.001, 0.008, 0.05);
  snap.connect(hp).connect(sg).connect(master);
  snap.start(t0);
  snap.stop(t0 + 0.07);

  // Low thud — bat striking ground / weight of the break.
  const thud = ctx.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(120, t0);
  thud.frequency.exponentialRampToValueAtTime(50, t0 + 0.07);
  const tg = ctx.createGain();
  envADR(tg, t0, 0.7, 0.003, 0.012, 0.09);
  thud.connect(tg).connect(master);
  thud.start(t0);
  thud.stop(t0 + 0.12);

  // Sawtooth crack — the audible split.
  const crack = ctx.createOscillator();
  crack.type = 'sawtooth';
  crack.frequency.setValueAtTime(420, t0);
  crack.frequency.exponentialRampToValueAtTime(110, t0 + 0.06);
  const cg = ctx.createGain();
  envADR(cg, t0, 0.45, 0.002, 0.01, 0.08);
  crack.connect(cg).connect(master);
  crack.start(t0);
  crack.stop(t0 + 0.1);

  // Splintering tail: bandpassed noise that fades over ~250ms.
  const tail = ctx.createBufferSource();
  tail.buffer = makeNoise(ctx, 0.3);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 2;
  bp.frequency.setValueAtTime(2200, t0);
  bp.frequency.exponentialRampToValueAtTime(900, t0 + 0.25);
  const tlg = ctx.createGain();
  tlg.gain.setValueAtTime(0.0001, t0 + 0.02);
  tlg.gain.exponentialRampToValueAtTime(0.4, t0 + 0.04);
  tlg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.27);
  tail.connect(bp).connect(tlg).connect(master);
  tail.start(t0);
  tail.stop(t0 + 0.3);
}
