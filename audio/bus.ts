// Lazy-initialized WebAudio bus. Browsers require a user gesture before audio
// can play, so we don't construct the AudioContext until the first call into
// `ensureAudio` from a click/keypress handler.
//
// The bus has four channel groups under master so the mix balances:
//   sfxGain      — bat crack, glove pop, organ stinger
//   reactionGain — crowd reactions (roar, cheer, groan, applause)
//   bedGain      — sustained crowd murmur
//   walkupGain   — procedural batter walk-up jingles
//
// SFX and reactions side-chain duck the bed and walk-up so transient sounds
// pop above the wash without us actually hearing the wash collapse.

interface AudioState {
  ctx: AudioContext;
  master: GainNode;
  sfxGain: GainNode;
  reactionGain: GainNode;
  bedGain: GainNode;
  walkupGain: GainNode;
}

let state: AudioState | null = null;
let muted = false;
let volume = 0.85;

// Small scheduling lookahead so sounds don't land in the past while the
// AudioContext is still resuming after the user gesture.
export const SCHEDULE_LEAD_SEC = 0.01;

// Channel-group target levels at full master gain. Tuned so the bed sits
// quietly under reactions, reactions peak below SFX, and walk-up sneaks in
// at conversation volume.
const SFX_GAIN = 1.0;        // 0 dB
const REACTION_GAIN = 0.6;   // ~ -4 dB
const BED_GAIN = 0.32;       // ~ -10 dB
const WALKUP_GAIN = 0.55;    // ~ -5 dB

// Duck depths and recovery times. We push a gain ramp on each duck event;
// JS-side scheduling rather than AudioParam automation graphs so it stays
// simple and lookahead-friendly.
const DUCK_BED_DEPTH = 0.45; // bed drops to 45% of its level on a reaction
const DUCK_BED_RECOVER_SEC = 0.45;
const DUCK_WALKUP_DEPTH = 0.25;
const DUCK_WALKUP_RECOVER_SEC = 0.35;

export function ensureAudio(): AudioState {
  if (!state) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error('WebAudio not supported in this browser');
    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);

    const sfxGain = ctx.createGain();
    sfxGain.gain.value = SFX_GAIN;
    sfxGain.connect(master);

    const reactionGain = ctx.createGain();
    reactionGain.gain.value = REACTION_GAIN;
    reactionGain.connect(master);

    const bedGain = ctx.createGain();
    bedGain.gain.value = BED_GAIN;
    bedGain.connect(master);

    const walkupGain = ctx.createGain();
    walkupGain.gain.value = WALKUP_GAIN;
    walkupGain.connect(master);

    state = { ctx, master, sfxGain, reactionGain, bedGain, walkupGain };
  }
  if (state.ctx.state === 'suspended') void state.ctx.resume();
  return state;
}

export function setMuted(m: boolean): void {
  muted = m;
  if (state) state.master.gain.value = m ? 0 : volume;
}

export function isMuted(): boolean {
  return muted;
}

export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  if (state && !muted) state.master.gain.value = volume;
}

export function getVolume(): number {
  return volume;
}

// Shared white-noise buffer factory. Cached by duration to avoid re-allocating
// on every shot.
const noiseCache = new Map<number, AudioBuffer>();

export function makeNoise(ctx: AudioContext, durationSec: number): AudioBuffer {
  const key = Math.round(durationSec * 1000);
  const cached = noiseCache.get(key);
  if (cached) return cached;
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * durationSec));
  const buf = ctx.createBuffer(1, length, sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  noiseCache.set(key, buf);
  return buf;
}

// Pink noise — equal energy per octave. Better for a sustained crowd bed than
// white noise, which sounds harsh. One-pole filter cascade approximation
// (Voss-McCartney style) gives a 3 dB/octave roll-off close enough for the
// bed's purposes. Cached by duration like makeNoise.
const pinkNoiseCache = new Map<number, AudioBuffer>();

export function makePinkNoise(ctx: AudioContext, durationSec: number): AudioBuffer {
  const key = Math.round(durationSec * 1000);
  const cached = pinkNoiseCache.get(key);
  if (cached) return cached;
  const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // Voss-McCartney 7-row pink-noise generator.
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    data[i] = pink * 0.11; // scale to roughly ±1
  }
  pinkNoiseCache.set(key, buf);
  return buf;
}

// Schedule a brief duck on the bed gain. Used by SFX + reaction layers so the
// sustained wash never masks transient hits.
export function duckBed(intensity = 1.0): void {
  if (!state) return;
  scheduleDuck(
    state.bedGain,
    BED_GAIN,
    DUCK_BED_DEPTH + (1 - intensity) * (1 - DUCK_BED_DEPTH),
    DUCK_BED_RECOVER_SEC,
    state.ctx.currentTime + SCHEDULE_LEAD_SEC,
  );
}

// Schedule a brief duck on walk-up music. Triggered by SFX + reactions so the
// jingle never fights a play call.
export function duckWalkup(intensity = 1.0): void {
  if (!state) return;
  scheduleDuck(
    state.walkupGain,
    WALKUP_GAIN,
    DUCK_WALKUP_DEPTH + (1 - intensity) * (1 - DUCK_WALKUP_DEPTH),
    DUCK_WALKUP_RECOVER_SEC,
    state.ctx.currentTime + SCHEDULE_LEAD_SEC,
  );
}

function scheduleDuck(
  g: GainNode,
  baseLevel: number,
  duckedFraction: number,
  recoverSec: number,
  t0: number,
): void {
  // Cancel any in-flight ramps so consecutive ducks chain cleanly.
  g.gain.cancelScheduledValues(t0);
  g.gain.setValueAtTime(g.gain.value, t0);
  g.gain.linearRampToValueAtTime(baseLevel * duckedFraction, t0 + 0.04);
  g.gain.linearRampToValueAtTime(baseLevel, t0 + 0.04 + recoverSec);
}
