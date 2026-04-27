import type { GameId, PlayerId, TeamId } from '../world/types.js';

// Aggregate tables — Tier 2 of the data model in dev_polish_001.md.
// Rebuilt from the canonical SimEvent log (Tier 1) by /stats/aggregator.
// Rate stats (AVG, OBP, ERA, ...) are derived at read time in /stats/derived.

// Splits are nested rows keyed by split name. Each split's value is a partial
// BattingLine / PitchingLine populated during aggregation. We use the full
// shape (not a subset) so the same derived helpers work uniformly.

export type BattingSplitKey =
  | 'vsLHP'
  | 'vsRHP'
  | 'home'
  | 'away'
  | 'RISP'
  | 'risp2Out'
  | 'lateAndClose';

export type PitchingSplitKey = 'vsLHB' | 'vsRHB' | 'home' | 'away' | 'lateAndClose';

// Per-zone batting result counters. Index 0 = pitches outside the strike
// zone (chase-bucket). 1..9 = the 3×3 zone grid. Captured at pitch time so
// the menu can show xBA-by-zone once a hitter has accumulated enough
// plate-appearances in that location to be readable.
export interface ZoneBattingCell {
  pitches: number; // total pitches seen in this zone, regardless of outcome
  PA: number; // ABs that ended on a pitch in this zone (last-pitch attribution)
  AB: number;
  H: number;
  HR: number;
}

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
  // Splits keyed by name. Built lazily during aggregation; absent = empty.
  splits: Partial<Record<BattingSplitKey, BattingLine>>;
  // Spray chart — landing-coords per batted ball.
  hitChart: HitLocation[];
  // Per-game results, in chronological order. Powers the game log + hot/cold.
  gameLog: BattingGameLogEntry[];
  // Per-month accumulator for the by-month split row.
  byMonth: Record<string, BattingLine>;
  // Zone batting line — index 0..9. Built incrementally from pitch +
  // atBatEnd events.
  zone: ZoneBattingCell[];
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
  splits: Partial<Record<PitchingSplitKey, PitchingLine>>;
  gameLog: PitchingGameLogEntry[];
  // Pitches thrown in each zone. Index 0 = outside the zone, 1..9 = the
  // 3×3 grid. Drives the in-menu heat map. The total pitch count is the
  // sum across all 10 cells.
  pitchesByZone: number[];
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

export interface HitLocation {
  readonly x: number; // feet from home; +x toward right field
  readonly y: number; // feet from home; +y toward center
  readonly outcome:
    | 'single'
    | 'double'
    | 'triple'
    | 'home-run'
    | 'out';
  readonly exitVeloMph: number;
  readonly launchAngleDeg: number;
}

export interface BattingGameLogEntry {
  readonly gameId: GameId;
  readonly day: number;
  readonly opponentTeamId: TeamId;
  readonly home: boolean;
  PA: number;
  AB: number;
  H: number;
  doubles: number;
  triples: number;
  HR: number;
  RBI: number;
  BB: number;
  SO: number;
  R: number;
  WPA: number;
}

export interface PitchingGameLogEntry {
  readonly gameId: GameId;
  readonly day: number;
  readonly opponentTeamId: TeamId;
  readonly home: boolean;
  IPouts: number;
  BF: number;
  H: number;
  R: number;
  ER: number;
  BB: number;
  SO: number;
  HR: number;
  WPA: number;
  decision: 'W' | 'L' | 'ND';
}

// One sample of (eventIdx, home WP). One entry per state change so the live
// view's chart can render the full curve and annotate big swings.
export interface GameWPTimeline {
  readonly gameId: GameId;
  readonly homeTeamId: TeamId;
  readonly awayTeamId: TeamId;
  readonly samples: Array<{
    eventIdx: number;
    wpHome: number;
    inning: number;
    half: 'top' | 'bottom';
    delta: number; // wpHome change vs. previous sample, batting-team-relative
    note?: string; // populated for big swings
  }>;
}

// Slim per-matchup line. Reuses the BattingLine counter set so the
// existing fold/derived helpers (AVG, OBP, SLG) work uniformly. We
// intentionally skip the heavy nested fields (splits, hitChart, gameLog,
// byMonth, zone) since matchup rows don't need them — they exist to
// power the on-canvas batter card's "vs this pitcher" stat line, not
// the menu's deeper drilldowns.
export interface BvpLine {
  readonly batterId: PlayerId;
  readonly pitcherId: PlayerId;
  PA: number;
  AB: number;
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
}

export interface SeasonAggregates {
  readonly seasonYear: number;
  readonly batting: Map<PlayerId, BattingLine>;
  readonly pitching: Map<PlayerId, PitchingLine>;
  readonly teams: Map<TeamId, TeamLine>;
  // WP timelines per finished game, keyed by gameId. Populated by the
  // aggregator so the Live view can play back the chart for any game.
  readonly wpTimelines: Map<GameId, GameWPTimeline>;
  // Batter-vs-pitcher matchup lines for the season. Outer key = batterId,
  // inner key = pitcherId. Used by the live HUD's batter card to show
  // "vs this pitcher: 4-13 .308 1HR" when sample size warrants. Populated
  // alongside the per-batter and per-pitcher top lines at every atBatEnd.
  readonly bvpMatchups: Map<PlayerId, Map<PlayerId, BvpLine>>;
  readonly gamesProcessed: number;
}

// ---- factories ----

const emptyZoneCells = (): ZoneBattingCell[] => {
  const cells: ZoneBattingCell[] = [];
  for (let i = 0; i < 10; i++) cells.push({ pitches: 0, PA: 0, AB: 0, H: 0, HR: 0 });
  return cells;
};

export const emptyBattingLine = (playerId: PlayerId, teamId: TeamId): BattingLine => ({
  playerId, teamId,
  G: 0, PA: 0, AB: 0, R: 0, H: 0,
  doubles: 0, triples: 0, HR: 0, RBI: 0,
  BB: 0, HBP: 0, SO: 0, SF: 0, SH: 0, GIDP: 0,
  WPA: 0,
  splits: {},
  hitChart: [],
  gameLog: [],
  byMonth: {},
  zone: emptyZoneCells(),
});

export const emptyPitchingLine = (playerId: PlayerId, teamId: TeamId): PitchingLine => ({
  playerId, teamId,
  G: 0, GS: 0, W: 0, L: 0, SV: 0,
  IPouts: 0, H: 0, R: 0, ER: 0, HR: 0,
  BB: 0, HBP: 0, SO: 0, BF: 0,
  WPA: 0,
  splits: {},
  gameLog: [],
  pitchesByZone: new Array(10).fill(0),
});

export const emptyTeamLine = (teamId: TeamId): TeamLine => ({
  teamId,
  W: 0, L: 0, RS: 0, RA: 0,
  homeW: 0, homeL: 0, awayW: 0, awayL: 0,
  divW: 0, divL: 0,
  resultsTimeline: [],
});

export const emptyBvpLine = (
  batterId: PlayerId,
  pitcherId: PlayerId,
): BvpLine => ({
  batterId,
  pitcherId,
  PA: 0,
  AB: 0,
  H: 0,
  doubles: 0,
  triples: 0,
  HR: 0,
  RBI: 0,
  BB: 0,
  HBP: 0,
  SO: 0,
  SF: 0,
  SH: 0,
});

export const emptySeasonAggregates = (seasonYear: number): SeasonAggregates => ({
  seasonYear,
  batting: new Map(),
  pitching: new Map(),
  teams: new Map(),
  wpTimelines: new Map(),
  bvpMatchups: new Map(),
  gamesProcessed: 0,
});
