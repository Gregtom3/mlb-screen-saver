// Lazy-initialized WebAudio bus. Browsers require a user gesture before audio
// can play, so we don't construct the AudioContext until the first call into
// `ensureAudio` from a click/keypress handler.

interface AudioState {
  ctx: AudioContext;
  master: GainNode;
}

let state: AudioState | null = null;
let muted = false;
let volume = 0.85;

// Small scheduling lookahead so sounds don't land in the past while the
// AudioContext is still resuming after the user gesture.
export const SCHEDULE_LEAD_SEC = 0.01;

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
    state = { ctx, master };
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
