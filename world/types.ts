// Persistent league state — the "world" that survives across games and seasons.
// /sim treats these as read-only inputs; /persist owns durability.

export type PlayerId = string;
export type TeamId = string;
export type StadiumId = string;
export type GameId = string;

// Hidden true ratings, 1-99. Each one drives a single named sim hook so the
// numbers feel earned. 50 is neutral. Display layer renders these as 1-5
// scout stars (`/stats/grades.ts → starRating`). Phase 5.5 part 2 expanded
// the original 8 lumped fields into a richer set; the four continuous
// "personality" flags from part 1 (clutch, streaky, durable, injury-prone)
// became the scalars below.
export interface PlayerRatings {
  // ---- Hitting ----
  readonly contact: number; // bat-to-ball; lowers whiff rate on swings
  readonly power: number; // exit-velocity distribution → HR / XBH
  readonly discipline: number; // (was "eye") chase rate on out-of-zone pitches → BB%
  readonly pitchRecognition: number; // swing decisions on breaking / off-speed
  readonly bunting: number; // sac / drag bunt success
  readonly platoonBias: number; // 50 = even; >50 = bigger same-hand penalty
  readonly clutch: number; // 50 = neutral; >50 = better in high-leverage states

  // ---- Pitching ----
  readonly velocity: number; // fastball MPH; raises foul/whiff rate
  readonly control: number; // in-zone strike rate → BB%
  readonly command: number; // within-zone targeting → HR allowed
  readonly stamina: number; // pitch-count fatigue curve
  readonly breakingBall: number; // SwStr% on slider/curve
  readonly changeup: number; // off-speed deception; reduces opp-hand penalty
  readonly holdRunners: number; // SB attempt rate + success against
  readonly groundballTendency: number; // GB/FB profile → DP rate, HR allowed

  // ---- Fielding ----
  readonly range: number; // probability of reaching balls in zone
  readonly glove: number; // (was "fielding") error rate conditional on reach
  readonly armStrength: number; // (was "arm") throw velocity
  readonly armAccuracy: number; // throw precision; cut-off success
  readonly transferSpeed: number; // DP turn time (IF)
  readonly framing: number; // ±N called strikes per game (C only)
  readonly blocking: number; // PB / WP rate (C only)
  readonly popTime: number; // CS rate (C only)

  // ---- Baserunning ----
  readonly speed: number; // raw foot speed; BABIP on grounders, triple rate
  readonly stealing: number; // SB technique independent of raw speed
  readonly baserunningIQ: number; // taking the extra base; avoids TOOTBLAN

  // ---- Mental ----
  readonly composure: number; // performance under pressure; resists clutch
  readonly consistency: number; // game-to-game variance (replaces "streaky")
  readonly durability: number; // injury chance + recovery (replaces durable/injury-prone)
  readonly workEthic: number; // aging-curve modifier (later peak, slower decline)
  readonly coachability: number; // in-season development drift
}

// Personality flags now only contain qualitative tags. Continuous traits
// (clutch, streaky, durable, injury-prone) graduated to scalar ratings.
export type PersonalityFlag = 'hot-headed' | 'glove-first';

// Strike-zone grid. The sim emits `locationZone` on every pitch; downstream
// code shares this convention so the renderer, stats aggregator, and HUD
// agree on layout:
//
//   1 | 2 | 3       top row  (high)
//  ---+---+---
//   4 | 5 | 6       middle row
//  ---+---+---
//   7 | 8 | 9       bottom row (low)
//
// `0` = outside the strike zone (a ball location, never a called strike).
// Tuples below are length-10, indexed 0..9, so `[5]` is the middle of the
// zone and `[0]` is the catch-all "off the plate" bucket.
export type ZoneIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type ZoneTuple = readonly [number, number, number, number, number, number, number, number, number, number];

// Per-pitcher zone-targeting tendencies. Each weight is unnormalized; the sim
// turns them into a distribution at sample time. Index 0 (outside) governs
// raw "miss the zone" rate alongside the pitcher's `control` rating, but it
// is the in-zone tilt (1..9) that produces a recognizable heat-map fingerprint
// over a season. Stable per player — generated once at player creation,
// never mutated.
export interface PitcherTendencies {
  readonly zoneWeights: ZoneTuple;
}

// Per-batter zone preferences. Multipliers applied to in-play hit-quality
// when a pitch ended up in that zone — values >1 mean "this batter feasts
// on pitches here", <1 means "weakness". The `xBA` field is the dimensionless
// quality multiplier; the sim converts it to slight shifts in HR / 2B / 1B
// rates. Stable per player — like tendencies, generated at creation.
export interface BatterZonePrefs {
  readonly xBA: ZoneTuple;
}

export type Position =
  | 'P'
  | 'C'
  | '1B'
  | '2B'
  | '3B'
  | 'SS'
  | 'LF'
  | 'CF'
  | 'RF'
  | 'DH';

export type Bats = 'L' | 'R' | 'S';
export type Throws = 'L' | 'R';

export interface Player {
  readonly id: PlayerId;
  readonly firstName: string;
  readonly lastName: string;
  readonly birthYear: number; // for aging curves
  readonly hometown: string; // flavor only; supports regional name pools
  readonly bats: Bats;
  readonly throws: Throws;
  readonly primaryPosition: Position;
  readonly secondaryPositions: readonly Position[];
  readonly ratings: PlayerRatings;
  readonly personality: readonly PersonalityFlag[];
  readonly teamId: TeamId | null; // null = free agent / retired
  readonly inMinors: boolean;
  // Listed height in feet. Drives strike-zone height (taller batters get a
  // taller zone, shorter batters get a smaller one) and slight sprite-scale
  // variance so individual players read as different sizes on the field.
  readonly heightFt: number;
  // Pitchers — zone-targeting fingerprint. Optional because position players
  // never pitch in this league; emergency-pitcher cases would carry a
  // generic/flat distribution.
  readonly pitcherTendencies?: PitcherTendencies;
  // All batters get a zone preference grid. Pitchers carry one too (they bat
  // when DH is not in use, and the field stays uniform across players).
  readonly batterZonePrefs: BatterZonePrefs;
}

export type Conference = 'West' | 'East';
export type Division = 'Pacific' | 'Mountain' | 'Heartland' | 'Atlantic';

export interface TeamColors {
  readonly primary: string; // hex
  readonly secondary: string; // hex
  readonly accent: string; // hex
}

// Coaching staff. Each coach role plugs into a different part of the sim
// through a modifier function in /sim/coaching-effects.ts. Ratings are
// 1-99, 50 = neutral, same scale as PlayerRatings.
//
//  - Head coach (`tactics`, `morale`): nudges infield-shift slices toward
//    the batter's pull side and (Phase 6+) team-wide morale modifier.
//  - First-base coach (`baserunningCoaching`, `pickoffAwareness`): wired
//    once steal/pickoff sim lands; rating exists today as data-only so the
//    activation is a one-line change in coaching-effects when steals ship.
//  - Third-base coach (`aggression`, `judgment`): gates "score from 2B on
//    single" and tag-up success on sac flies. Aggression raises the send
//    rate, judgment lowers TOOTBLAN risk.
export type CoachRole = 'head' | 'first-base' | 'third-base';

export interface CoachRatings {
  readonly tactics: number; // head — defensive shift quality
  readonly morale: number; // head — clubhouse / leadership (Phase 6+)
  readonly baserunningCoaching: number; // 1B — SB technique boost (deferred)
  readonly pickoffAwareness: number; // 1B — pickoff prevention (deferred)
  readonly aggression: number; // 3B — send rate
  readonly judgment: number; // 3B — avoiding outs at the plate
}

export interface Coach {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role: CoachRole;
  readonly ratings: CoachRatings;
}

export interface CoachingStaff {
  readonly head: Coach;
  readonly firstBase: Coach;
  readonly thirdBase: Coach;
}

export interface Team {
  readonly id: TeamId;
  readonly city: string;
  readonly nickname: string; // "Spiders"
  readonly abbr: string; // 3-letter, e.g. "LOU"
  readonly conference: Conference;
  readonly division: Division;
  readonly colors: TeamColors;
  readonly mascot: string;
  readonly stadiumId: StadiumId;
  readonly coachingStaff: CoachingStaff;
}

export type GrassPattern = 'plain' | 'checkerboard' | 'radial' | 'ringed' | 'striped';

// Stadium quirks affect simulation, not just rendering.
// CLAUDE.md: "The plugin interface for stadium effects is the same one used for
// weather and personality flags." Phase 4 ships the registry; this is the data shape.
export type StadiumQuirk =
  | { readonly kind: 'short-porch'; readonly side: 'left' | 'right'; readonly distanceFt: number }
  | { readonly kind: 'deep-center'; readonly distanceFt: number }
  | { readonly kind: 'ivy-wall'; readonly side: 'left' | 'right' | 'center' }
  | { readonly kind: 'hill-cf' }
  | { readonly kind: 'pond-beyond-rf' }
  | { readonly kind: 'clock-tower-in-play' }
  | { readonly kind: 'mascot-statue'; readonly side: 'left' | 'right' | 'center' }
  | { readonly kind: 'wind-tunnel'; readonly direction: 'in' | 'out' | 'cross' }
  | { readonly kind: 'altitude-thin-air'; readonly elevationFt: number };

export interface StadiumDimensions {
  readonly leftFt: number;
  readonly leftCenterFt: number;
  readonly centerFt: number;
  readonly rightCenterFt: number;
  readonly rightFt: number;
  readonly wallHeightFt: number; // simplified — single average; per-segment refinement in Phase 4
  readonly foulTerritoryRating: number; // 1 (cramped) to 10 (cavernous)
  readonly moundHeightIn: number; // standard 10
}

export interface StadiumAtmosphere {
  readonly grassPattern: GrassPattern;
  readonly grassShade: string; // hex
  readonly seatPalette: readonly string[]; // hex array, used by /render
  readonly dayGameBias: number; // 0..1 (0.5 = neutral)
  readonly crowdDensityCurve: 'home-heavy' | 'flat' | 'late-arrivers';
}

export interface Stadium {
  readonly id: StadiumId;
  readonly name: string;
  readonly teamId: TeamId;
  readonly dimensions: StadiumDimensions;
  readonly quirk: StadiumQuirk;
  readonly atmosphere: StadiumAtmosphere;
}

export type GameStatus = 'scheduled' | 'live' | 'final';

export interface GameLine {
  readonly runs: number;
  readonly hits: number;
  readonly errors: number;
}

export interface Game {
  readonly id: GameId;
  readonly seasonYear: number;
  readonly seasonDay: number; // 1..162 in regular season
  readonly homeTeamId: TeamId;
  readonly awayTeamId: TeamId;
  readonly stadiumId: StadiumId;
  readonly status: GameStatus;
  readonly home?: GameLine;
  readonly away?: GameLine;
  readonly seed: number; // PRNG seed for this specific game
}

export type SeasonPhase = 'regular' | 'playoffs' | 'offseason';

export interface StandingsRow {
  readonly teamId: TeamId;
  readonly wins: number;
  readonly losses: number;
  readonly runsFor: number;
  readonly runsAgainst: number;
}

export interface SeasonState {
  readonly year: number;
  readonly phase: SeasonPhase;
  readonly day: number;
  readonly standings: readonly StandingsRow[];
}

// Top-level snapshot — what /persist saves to one slot.
export interface LeagueSnapshot {
  readonly leagueId: string;
  readonly createdAtSeed: number; // master seed; everything derives from this
  readonly teams: readonly Team[];
  readonly stadiums: readonly Stadium[];
  readonly players: readonly Player[];
  readonly season: SeasonState;
}
