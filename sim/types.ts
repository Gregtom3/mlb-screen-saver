// Simulation primitives. The /sim package exists to produce a typed event log;
// downstream packages render, score, and react to that log.

import type { Player, PlayerId, TeamId, StadiumId, GameId } from '../world/types.js';

export type Side = 'home' | 'away';
export type Base = 0 | 1 | 2 | 3; // 0 = home plate, 1/2/3 bases

export type PitchType = 'fastball' | 'breaking' | 'offspeed' | 'specialty';

export type PitchResult =
  | 'ball'
  | 'called-strike'
  | 'swinging-strike'
  | 'foul'
  | 'foul-tip-caught'
  | 'hit-by-pitch'
  | 'in-play';

export type AtBatOutcome =
  | 'strikeout-swinging'
  | 'strikeout-looking'
  | 'walk'
  | 'hit-by-pitch'
  | 'single'
  | 'double'
  | 'triple'
  | 'home-run'
  | 'groundout'
  | 'flyout'
  | 'lineout'
  | 'popout'
  | 'sac-fly'
  | 'sac-bunt'
  | 'fielders-choice'
  | 'reached-on-error'
  | 'double-play'
  | 'triple-play';

export type SubReason =
  | 'pinch-hit'
  | 'pinch-run'
  | 'defensive-replacement'
  | 'defensive-shift'
  | 'pitching-change'
  | 'injury'
  | 'manager-nudge';

export interface Pitch {
  readonly id: string;
  readonly pitcherId: PlayerId;
  readonly batterId: PlayerId;
  readonly type: PitchType;
  readonly result: PitchResult;
  readonly velocityMph: number;
  readonly locationZone: number; // 1..9 strike-zone grid + 0 for outside
}

// Ball-in-play trajectory. Concrete physics enters in Phase 1; this is the contract.
export interface BallPath {
  readonly launchAngleDeg: number;
  readonly exitVeloMph: number;
  readonly landingX: number; // feet from home plate, +x = toward right field
  readonly landingY: number; // feet from home plate, +y = toward center
  readonly hangTimeSec: number;
}

export interface AtBat {
  readonly id: string;
  readonly inning: number;
  readonly halfInning: 'top' | 'bottom';
  readonly batterId: PlayerId;
  readonly pitcherId: PlayerId;
  readonly pitches: readonly Pitch[];
  readonly outcome: AtBatOutcome;
  readonly rbis: number;
}

export interface Inning {
  readonly index: number; // 1..9+
  readonly top: readonly AtBat[];
  readonly bottom: readonly AtBat[];
  readonly runsTop: number;
  readonly runsBottom: number;
}

export interface BoxScore {
  readonly gameId: GameId;
  readonly home: TeamId;
  readonly away: TeamId;
  readonly innings: readonly Inning[];
  readonly runs: { readonly home: number; readonly away: number };
  readonly hits: { readonly home: number; readonly away: number };
  readonly errors: { readonly home: number; readonly away: number };
  readonly leftOnBase: { readonly home: number; readonly away: number };
}

// Discriminated union of every event the sim emits. The renderer, audio,
// UI, and box-score builders all consume this stream — and only this stream.
export type SimEvent =
  | { readonly t: number; readonly kind: 'gameStart'; readonly gameId: GameId; readonly stadiumId: StadiumId }
  | {
      readonly t: number;
      readonly kind: 'pitch';
      readonly pitcherId: PlayerId;
      readonly batterId: PlayerId;
      readonly pitch: Pitch;
    }
  | {
      readonly t: number;
      readonly kind: 'contact';
      readonly batterId: PlayerId;
      readonly ballPath: BallPath;
      readonly fielderId?: PlayerId;
    }
  | {
      readonly t: number;
      readonly kind: 'baserunner';
      readonly runnerId: PlayerId;
      readonly from: Base;
      readonly to: Base;
      readonly out: boolean;
    }
  | {
      readonly t: number;
      readonly kind: 'atBatEnd';
      readonly atBatId: string;
      readonly outcome: AtBatOutcome;
      readonly rbis: number;
    }
  | {
      readonly t: number;
      readonly kind: 'sub';
      readonly outPlayerId: PlayerId;
      readonly inPlayerId: PlayerId;
      readonly reason: SubReason;
    }
  | { readonly t: number; readonly kind: 'inningEnd'; readonly halfInning: 'top' | 'bottom'; readonly inning: number; readonly runs: number }
  | { readonly t: number; readonly kind: 'gameEnd'; readonly gameId: GameId; readonly finalRuns: { home: number; away: number } };

export type SimEventKind = SimEvent['kind'];

// What runGame() needs to play out one matchup. The caller (e.g. /app)
// assembles this from /world data and a /season Lineup. /sim never reaches
// back into /world; everything it needs is already in here.
export interface SideInput {
  readonly teamId: TeamId;
  readonly battingOrder: readonly PlayerId[]; // exactly 9
  readonly startingPitcherId: PlayerId;
  readonly bullpen: readonly PlayerId[];
}

export interface GameInput {
  readonly gameId: GameId;
  readonly stadiumId: StadiumId;
  readonly home: SideInput;
  readonly away: SideInput;
  readonly playerIndex: ReadonlyMap<PlayerId, Player>;
  readonly seed: number;
}
