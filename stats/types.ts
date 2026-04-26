import type { PlayerId, TeamId } from '../world/types.js';

// Aggregate tables — Tier 2 of the data model in dev_polish_001.md.
// Rebuilt from the canonical SimEvent log (Tier 1) by /stats/aggregator.
// Rate stats (AVG, OBP, ERA, ...) are derived at read time in /stats/derived.

export interface BattingLine {
  readonly playerId: PlayerId;
  readonly teamId: TeamId;
  G: number;
  PA: number;
  AB: number; // PA - BB - HBP - SF - SH
  R: number;
  H: number;
  doubles: number;
  triples: number;
  HR: number;
  RBI: number;
  BB: number;
  HBP: number;
  SO: number;
  SF: number;
  SH: number;
  GIDP: number;
  // Cumulative win-probability added across all plate appearances. Convention:
  // positive = the batter's team gained WP on the play.
  WPA: number;
}

export interface PitchingLine {
  readonly playerId: PlayerId;
  readonly teamId: TeamId;
  G: number;
  GS: number; // games started
  W: number;
  L: number;
  SV: number;
  IPouts: number; // store IP as outs; presented as innings.fraction by /derived
  H: number;
  R: number;
  ER: number;
  HR: number;
  BB: number;
  HBP: number;
  SO: number;
  BF: number; // batters faced
  // Convention: pitcher WPA mirrors batter WPA — positive = pitcher's TEAM
  // gained WP from the play. So a strikeout while the batting team rallies
  // is still positive for the pitcher (their team's WP rose).
  WPA: number;
}

export interface TeamLine {
  readonly teamId: TeamId;
  W: number;
  L: number;
  RS: number; // runs scored
  RA: number; // runs allowed
  homeW: number;
  homeL: number;
  awayW: number;
  awayL: number;
  divW: number;
  divL: number;
  // Last-10 record + current streak. Held as derived but cheap to track inline.
  resultsTimeline: ('W' | 'L')[]; // append-only, for last10 + streak
}

export interface SeasonAggregates {
  readonly seasonYear: number;
  readonly batting: Map<PlayerId, BattingLine>;
  readonly pitching: Map<PlayerId, PitchingLine>;
  readonly teams: Map<TeamId, TeamLine>;
  readonly gamesProcessed: number;
}

export const emptyBattingLine = (playerId: PlayerId, teamId: TeamId): BattingLine => ({
  playerId, teamId,
  G: 0, PA: 0, AB: 0, R: 0, H: 0,
  doubles: 0, triples: 0, HR: 0, RBI: 0,
  BB: 0, HBP: 0, SO: 0, SF: 0, SH: 0, GIDP: 0,
  WPA: 0,
});

export const emptyPitchingLine = (playerId: PlayerId, teamId: TeamId): PitchingLine => ({
  playerId, teamId,
  G: 0, GS: 0, W: 0, L: 0, SV: 0,
  IPouts: 0, H: 0, R: 0, ER: 0, HR: 0,
  BB: 0, HBP: 0, SO: 0, BF: 0,
  WPA: 0,
});

export const emptyTeamLine = (teamId: TeamId): TeamLine => ({
  teamId,
  W: 0, L: 0, RS: 0, RA: 0,
  homeW: 0, homeL: 0, awayW: 0, awayL: 0,
  divW: 0, divL: 0,
  resultsTimeline: [],
});

export const emptySeasonAggregates = (seasonYear: number): SeasonAggregates => ({
  seasonYear,
  batting: new Map(),
  pitching: new Map(),
  teams: new Map(),
  gamesProcessed: 0,
});
