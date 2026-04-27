// Maps SimEvents that just crossed the playback cursor to procedural SFX calls.
// The render loop hands batches of events here in order; the dispatcher itself
// is stateless beyond an enabled flag (the audio bus owns mute / volume).
//
// `enabled` exists because creating an AudioContext outside a user gesture
// produces one stuck in 'suspended' state. We keep the dispatcher inert until
// the user has explicitly unlocked audio — then it stays enabled for the
// session and mute is handled separately on the bus.

import type { SimEvent } from '../sim/types.js';
import {
  catcherMittPop,
  fielderGlovePop,
  batCrack,
  hardHitWoosh,
  foulTick,
  organStinger,
  strike3Call,
  ballToss,
} from './sfx.js';

const HARD_HIT_MPH = 95;

// Animation-driven audio cues fired by the renderer at deterministic ticks
// derived from the event log (around-the-horn throw catches, inning-end
// ball tosses). These aren't real SimEvents — the sim doesn't model them —
// but they need the same fire-once-when-crossed semantics. Loop emits them
// alongside the SimEvent stream; dispatcher maps each kind to a sound.
export type AnimAudioCue =
  // Ball arriving in a fielder's glove — bright pop.
  | { readonly t: number; readonly kind: 'toss-glove' }
  // Ball arriving back in the pitcher's mitt or a soft warmup pat — softer.
  | { readonly t: number; readonly kind: 'toss-mitt' }
  // A throw releasing — light whoosh; layered under the catch so the eye/
  // ear locks onto the catch frame.
  | { readonly t: number; readonly kind: 'toss-throw' };

export interface SfxDispatcher {
  dispatch(events: readonly SimEvent[]): void;
  dispatchAnim(cues: readonly AnimAudioCue[]): void;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
}

export const createSfxDispatcher = (): SfxDispatcher => {
  let enabled = false;
  return {
    dispatch(events) {
      if (!enabled) return;
      for (const e of events) {
        switch (e.kind) {
          case 'pitch': {
            const r = e.pitch.result;
            if (r === 'foul' || r === 'foul-tip-caught') foulTick();
            else if (r !== 'in-play') catcherMittPop();
            // 'in-play' is silent here — the contact event fires the bat crack.
            break;
          }
          case 'contact': {
            batCrack();
            if (e.ballPath.exitVeloMph >= HARD_HIT_MPH) hardHitWoosh();
            break;
          }
          case 'baserunner': {
            if (e.out) fielderGlovePop();
            break;
          }
          case 'atBatEnd': {
            if (e.outcome === 'strikeout-swinging' || e.outcome === 'strikeout-looking') {
              strike3Call();
            } else if (e.outcome === 'home-run') {
              organStinger();
            }
            break;
          }
          case 'gameEnd': {
            organStinger();
            break;
          }
          // gameStart / sub / inningEnd: intentionally silent.
        }
      }
    },
    dispatchAnim(cues) {
      if (!enabled) return;
      for (const c of cues) {
        switch (c.kind) {
          case 'toss-throw':
            ballToss();
            break;
          case 'toss-glove':
            fielderGlovePop();
            break;
          case 'toss-mitt':
            catcherMittPop();
            break;
        }
      }
    },
    setEnabled(b) {
      enabled = b;
    },
    isEnabled() {
      return enabled;
    },
  };
};
