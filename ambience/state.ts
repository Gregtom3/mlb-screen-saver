// Crowd-ambience state model. Read by /audio (bed gain, reaction synths,
// walk-up jingles) and by /render (wave lift, density, lighting). Same state
// powers both so audio and visuals never drift.

import type { PlayerId } from '../world/types.js';

// Continuous crowd model. Updated every frame from the simEvent stream + a
// running mirror of game state (inning, count, outs, bases, score, batter).
//
//   energy    — slow-moving baseline excitement. Floor in late-and-close
//               situations; ceiling when the home crowd has checked out.
//   arousal   — short-term spike that decays in ~1.5s. A roar lifts arousal,
//               nothing keeps it pinned.
//   mood      — home-perspective valence: positive while the home team is
//               winning / rallying, negative when getting blown out.
//   attention — focus on the play vs. ambient chatter. Drops between innings
//               and during blowouts; rises with two-strike counts and
//               late-and-close situations.
export interface CrowdState {
  readonly energy: number;     // 0..1
  readonly arousal: number;    // 0..1
  readonly mood: number;       // -1..1
  readonly attention: number;  // 0..1
  readonly homeBatting: boolean;
  readonly batterId: PlayerId | null;
  readonly batterIsStar: boolean;
  // Game phase reflected from the event log; matches scene-state phase.
  readonly phase: 'pre-game' | 'live' | 'final';
}

export type PulseKind =
  | 'cheer'           // home strikeout, mid-leverage hit
  | 'roar'            // home HR, walk-off, sustained
  | 'oo'              // anticipation lift (loud crack, 2-out rally)
  | 'gasp'            // suspense — close play, deep fly
  | 'groan'           // home rally killed, away HR, double play
  | 'rally-clap'      // organized clapping in a building rally
  | 'two-strike-clap' // two-strike count, home pitching
  | 'walkup-start'    // new home/away batter steps in
  | 'applause-tail';  // sustained applause that decays out

export interface ReactionPulse {
  readonly kind: PulseKind;
  readonly intensity: number;          // 0..1
  readonly durationMs: number;
  readonly side: 'home' | 'away' | 'all';
  // Optional spray-angle center for the visual wave; degrees from straight-
  // away CF, negative = LF, positive = RF. Mostly populated for hit pulses.
  readonly centerAngleDeg?: number;
  // Optional id for reactions that have continuous identity, e.g. so the
  // walk-up player matches across consecutive frames. Walk-up jingles use it.
  readonly playerId?: PlayerId;
}

// Default state with everything at rest. Useful as the seed for the reducer
// and as a fallback for tests / scene-only callers that don't drive ambience.
export const initialCrowdState = (): CrowdState => ({
  energy: 0.25,
  arousal: 0,
  mood: 0,
  attention: 0.4,
  homeBatting: false,
  batterId: null,
  batterIsStar: false,
  phase: 'pre-game',
});

// Quantize a continuous signal so deterministic hashes (e.g. crowd flicker
// keys) stay stable per simTime bucket instead of churning every frame.
export const quantize = (v: number, step: number): number =>
  Math.round(v / step) * step;
