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
} from './sfx.js';

const HARD_HIT_MPH = 95;

export interface SfxDispatcher {
  dispatch(events: readonly SimEvent[]): void;
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
    setEnabled(b) {
      enabled = b;
    },
    isEnabled() {
      return enabled;
    },
  };
};
