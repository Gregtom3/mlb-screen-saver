// Dispatcher: maps SimEvents to short SFX, and fans CrowdState pulses out to
// the bed / reaction / walk-up modules. Stateless beyond `enabled` — the
// audio bus owns mute / volume, and /ambience owns the crowd model.
//
// `enabled` exists because creating an AudioContext outside a user gesture
// produces one stuck in 'suspended' state. We keep the dispatcher inert until
// the user has explicitly unlocked audio — then it stays enabled for the
// session and mute is handled separately on the bus.

import type { SimEvent } from '../sim/types.js';
import type { CrowdState, ReactionPulse } from '../ambience/state.js';
import {
  catcherMittPop,
  fielderGlovePop,
  batCrack,
  hardHitWoosh,
  foulTick,
  organStinger,
  strike3Call,
} from './sfx.js';
import { setBedFromState, startBed } from './bed.js';
import {
  applauseTail,
  cheer,
  gasp,
  groan,
  oo,
  rallyClap,
  roar,
  twoStrikeClap,
} from './reactions.js';
import { startWalkup, stopWalkup } from './walkup.js';

const HARD_HIT_MPH = 95;

export interface AmbienceTick {
  readonly state: CrowdState;
  readonly pulses: readonly ReactionPulse[];
}

export interface SfxDispatcher {
  /** Discrete-event SFX (existing bat-crack, glove-pop, etc.). */
  dispatch(events: readonly SimEvent[]): void;
  /** Continuous crowd state + reactions. Optional — callers without
   *  /ambience wired up still get the legacy SFX behavior. */
  applyAmbience?(tick: AmbienceTick): void;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
}

export const createSfxDispatcher = (): SfxDispatcher => {
  let enabled = false;
  let bedStarted = false;

  const ensureBed = (): void => {
    if (bedStarted) return;
    startBed();
    bedStarted = true;
  };

  const firePulse = (p: ReactionPulse): void => {
    // Home-side and all-side pulses are audible; away-side pulses currently
    // pipe down (we're rendering the home park's POV). Walkup-start fires
    // regardless of side because the music is a stadium PA cue.
    if (p.side === 'away' && p.kind !== 'walkup-start') return;
    switch (p.kind) {
      case 'roar':
        roar(p.intensity, p.durationMs);
        break;
      case 'cheer':
        cheer(p.intensity, p.durationMs);
        break;
      case 'oo':
        oo(p.intensity, p.durationMs);
        break;
      case 'gasp':
        gasp(p.intensity, p.durationMs);
        break;
      case 'groan':
        groan(p.intensity, p.durationMs);
        break;
      case 'rally-clap':
        rallyClap(p.intensity, p.durationMs);
        break;
      case 'two-strike-clap':
        twoStrikeClap(p.intensity, p.durationMs);
        break;
      case 'applause-tail':
        applauseTail(p.intensity, p.durationMs);
        break;
      case 'walkup-start':
        if (p.playerId) {
          startWalkup({
            playerId: p.playerId,
            intensity: p.intensity,
            durationMs: p.durationMs,
          });
        }
        break;
    }
  };

  return {
    dispatch(events) {
      if (!enabled) return;
      for (const e of events) {
        switch (e.kind) {
          case 'pitch': {
            // Any pitch arriving means the at-bat is live — kill the walk-up
            // jingle so it doesn't fight the play.
            stopWalkup();
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
    applyAmbience(tick) {
      if (!enabled) return;
      ensureBed();
      setBedFromState(tick.state);
      for (const pulse of tick.pulses) firePulse(pulse);
    },
    setEnabled(b) {
      enabled = b;
    },
    isEnabled() {
      return enabled;
    },
  };
};
