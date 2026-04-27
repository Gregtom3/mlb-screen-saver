// /audio — chiptune SFX + crowd ambience. Subscribes to sim events and the
// /ambience CrowdState; never reads back into /sim.
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
} from './sfx.js';
export {
  cheer,
  roar,
  oo,
  gasp,
  groan,
  twoStrikeClap,
  rallyClap,
  applauseTail,
} from './reactions.js';
export { startBed, stopBed, setBedFromState, isBedRunning } from './bed.js';
export { startWalkup, stopWalkup } from './walkup.js';
export {
  createSfxDispatcher,
  type SfxDispatcher,
  type AmbienceTick,
} from './dispatcher.js';
