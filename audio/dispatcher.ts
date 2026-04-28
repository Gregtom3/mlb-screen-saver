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
  ballToss,
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
  | { readonly t: number; readonly kind: 'toss-throw' }
  // Walk-up jingle for the batter just stepping in. Anchored to the
  // post-play-settle moment (not the first pitch) so the song doesn't
  // step on the previous play's runners + ball flight. The renderer
  // owns the timing because the choreo settle window (post-contact,
  // around-the-horn, etc.) varies per play.
  | {
      readonly t: number;
      readonly kind: 'walkup-start';
      readonly playerId: string;
      readonly intensity: number;
      readonly durationMs: number;
    };

export interface AmbienceTick {
  readonly state: CrowdState;
  readonly pulses: readonly ReactionPulse[];
}

export interface SfxDispatcher {
  /** Discrete-event SFX (existing bat-crack, glove-pop, etc.). */
  dispatch(events: readonly SimEvent[]): void;
  /** Animation-driven cues (around-the-horn, inning-end tosses). */
  dispatchAnim(cues: readonly AnimAudioCue[]): void;
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
          case 'pickoffThrow': {
            // Pitcher's throw to the bag — soft mitt pop on accurate
            // throws so the catcher mitt SFX doesn't dominate. Errant
            // throws skip this and fire on the deflection arrival.
            if (e.accurate) catcherMittPop();
            break;
          }
          case 'errantThrow': {
            // The "oh no" beat — a high foul-style tick at the deflection
            // moment. The follow-up backupPlay glove pop reads as the
            // "oh wait" recovery a beat later.
            foulTick();
            break;
          }
          case 'backupPlay': {
            // Backup OF retrieves and fires — lighter glove pop on
            // pickup, the actual tag arrival fires off tagAttempt below.
            fielderGlovePop();
            break;
          }
          case 'tagAttempt': {
            // Tag swipe at the bag — runner safe or out, the pop reads
            // either way; the half-inning state tells the eye.
            fielderGlovePop();
            break;
          }
          // gameStart / sub / inningEnd / lead / pickoffAttempt /
          // stealAttempt: silent here — the renderer's animations carry
          // the visual beat and the surrounding events fire the SFX.
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
          case 'walkup-start':
            startWalkup({
              playerId: c.playerId,
              intensity: c.intensity,
              durationMs: c.durationMs,
            });
            break;
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
