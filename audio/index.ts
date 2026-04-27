// /audio — chiptune SFX. Subscribes to sim events; never reads back into /sim.
// Phase 4 (audio bring-up). Procedural WebAudio, no asset files.

export { ensureAudio, setMuted, isMuted, setVolume, getVolume } from './bus.js';
export {
  catcherMittPop,
  fielderGlovePop,
  batCrack,
  hardHitWoosh,
  foulTick,
  organStinger,
  testTone,
  slide,
  strike3Call,
  batSnap,
  ballToss,
} from './sfx.js';
export {
  createSfxDispatcher,
  type AnimAudioCue,
  type SfxDispatcher,
} from './dispatcher.js';
