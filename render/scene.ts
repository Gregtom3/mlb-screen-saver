import type { Player, PlayerId, Stadium, StadiumId, TeamId } from '../world/types.js';
import type { AtBatOutcome, BallPath, GameInput, SimEvent } from '../sim/types.js';
import {
  HOME_PLATE,
  PITCHERS_MOUND,
  FIRST_BASE,
  SECOND_BASE,
  THIRD_BASE,
  FIELDER_HOME_POSITIONS,
  DUGOUT_DOORWAY_HOME,
  DUGOUT_DOORWAY_AWAY,
  ON_DECK_LEFT,
  ON_DECK_RIGHT,
  baseFor,
  lerpPoint,
} from './field-geometry.js';
import type {
  BatterCardStats,
  BigPlayInfo,
  BvpStats,
  FieldPoint,
  InningTransitionInfo,
  PitcherCardStats,
  RunScoredPopup,
  SceneLineScore,
  ScenePlayer,
  SceneState,
  SeasonBatterStats,
  StrikeZonePitchMark,
  StrikeZoneViewerInfo,
  VictoryCelebration,
} from './types.js';
import type { BattingLine, BvpLine, SeasonAggregates } from '../stats/types.js';
import { buildBoxScore } from '../sim/box-score.js';
import {
  buildAllPlayChoreos,
  buildFielderIdsByPos,
  ballStateForChoreo,
  fielderPositionForChoreo,
  type FielderPos,
  type PlayChoreo,
} from './choreo.js';

// =========================================================================
// buildScene — pure (events, simTime, ctx) → SceneState.
//
// The renderer holds NO state. Each frame it walks the prefix of the event
// log up to simTime and reconstructs what the field looks like. This is
// what CLAUDE.md means by "the renderer is a pure function of the log + tick."
// =========================================================================

// One sim tick ≈ one second of in-game time (see /sim/game.ts: TIME_PITCH=25
// roughly matches the 20–25 sec real-MLB inter-pitch gap). The renderer picks
// how long each animation primitive lasts in those units.
//
// The default playback rate of 20 sim-ticks/wall-sec means we render at ~20×
// real-time, which lands the ~30-min-per-game screensaver target.
//
// BALL_TIME_SCALE stretches every ball-flight primitive (pitch + post-contact)
// by this factor. The trajectory shape stays the same — the parabola still
// returns to z=0 at frac=1 — but the visual flight takes proportionally
// longer, so the eye can actually track each ball.
const BALL_TIME_SCALE = 3;
// Pitches get a snappier visual than the old 4× tick budget — a real
// fastball arrives in well under a second, and the prior 12-tick flight
// (~0.6s wall-clock at 20 ticks/sec) read as a lazy lob. Halve it.
const PITCH_FLIGHT_TICKS = 2 * BALL_TIME_SCALE;        // mound→plate ball flight
// After a non-in-play pitch, the catcher cradles the ball for a beat and then
// lobs it back to the mound. The lob is intentionally lazy — it reads as the
// pitcher and catcher resetting between pitches rather than a real throw.
const CATCHER_HOLD_TICKS = 3;
// Halved vs. the prior 21-tick lob: the slow arc was hanging in the air a
// beat too long. 10 ticks (~0.5 wall-sec at default playback) reads as a
// relaxed reset without dragging.
const CATCHER_LOB_TICKS = 10;
// First pitch of every at-bat is delayed by this many ticks of ball-still-
// at-mound before the visual flight begins. Anchored to the moment the new
// batter has walked into the box; gives the eye a beat to register the new
// matchup before the action starts. ~30 ticks ≈ 1.5 wall-sec at the default
// 20 ticks/sec playback rate.
const FIRST_PITCH_HOLD_TICKS = 30;
const RUNNER_TRAVEL_TICKS_PER_BASE = 7; // ~7 sim sec/base — pleasant screensaver pace, slower than real-time
// Swing read-out pacing. The pitch flight is only ~6 ticks, so without a
// follow-through hold the entire swing lives inside a tenth of a wall-second
// and reads as a twitch. Hold the finished swing, then ease back to ready —
// that's what makes a swing-and-miss legible.
const SWING_HOLD_TICKS = 10;
const SWING_RESET_TICKS = 8;
// The batter sprints toward 1B on any ball put in play (nobody knows the fly
// is caught until it's caught). Capped short of the bag so a retired batter
// never visually "arrives safe".
const BATTER_RUN_OUT_CAP = 0.85;
// Between-pitch baserunning theater pacing — mirrors the sim's event gaps
// (TIME_PICKOFF_THROW / TIME_ERRANT_DEFLECT / TIME_BACKUP_THROW / TIME_TAG /
// TIME_STEAL_RACE in sim/baserunning.ts) so arcs land exactly when the
// follow-up events fire.
const PICKOFF_FLIGHT_TICKS = 4;
const ERRANT_FLIGHT_TICKS = 8;
const BACKUP_RETRIEVE_TICKS = 14;
const RELAY_FLIGHT_TICKS = 4;
const STEAL_RACE_TICKS = 14;
// Pickoff dive-back: collapse the lead to the bag, hug it, ease back out.
const DIVE_IN_TICKS = 3;
const DIVE_HUG_TICKS = 12;
const DIVE_EASE_OUT_TICKS = 8;
// Defensive-shift ramp: ease from the previous batter's alignment.
const SHIFT_RAMP_TICKS = 20;
// On-deck batter pacing during the gap between at-bats. The 25-tick gap
// between atBatEnd and the next pitch breaks down as: a settle window
// (previous play finishes, walk-up jingle leads in), then a slow walk
// from the on-deck circle to the batter's box. Tuned generous so the
// hand-off reads — the user specifically wants this slower than feels
// natural.
const ON_DECK_SETTLE_TICKS = 6;
const ON_DECK_WALK_TO_BOX_TICKS = 18;
// Grounders need a small extra rolling tail for readability.
const GROUNDER_EXTRA_TICKS = 0.5 * BALL_TIME_SCALE;

interface RunnerLatest {
  readonly from: 0 | 1 | 2 | 3;
  readonly to: 0 | 1 | 2 | 3;
  readonly out: boolean;
  readonly t: number;
  readonly perBaseTicks: number;
}

// Runner's current lead state (Phase baserunning). The reducer stamps this
// from `lead` events; the runner-render path lerps the at-rest runner a
// few feet toward the next base, plus a deterministic sway from simTime
// for the "building a lead" idle animation.
interface RunnerLead {
  readonly leadFt: number;
  readonly aggression: number;
  readonly base: 1 | 2 | 3;
}

// Lerp the runner's resting position toward the next base by leadFt and
// add a small sinusoidal sway. A unit-vector step from base→next-base
// gives the lead direction; the sway swings perpendicular to that vector.
const applyLead = (
  basePos: FieldPoint,
  lead: RunnerLead,
  runnerId: PlayerId,
  simTime: number,
): FieldPoint => {
  const nextBase: 0 | 1 | 2 | 3 = ((lead.base + 1) % 4) as 0 | 1 | 2 | 3;
  const nextPos = baseFor(nextBase);
  const dx = nextPos.x - basePos.x;
  const dy = nextPos.y - basePos.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  // Lead distance along the base→next vector.
  const offsetFt = lead.leadFt;
  // Sway: amplitude scales with aggression; phase per-runner so the line
  // doesn't sway in unison. Period ~3 sim seconds for a believable rock.
  const phase = idHash01(runnerId) * Math.PI * 2;
  const sway = Math.sin((simTime / 3) * Math.PI * 2 + phase) * lead.aggression * 1.2;
  return {
    x: basePos.x + ux * offsetFt + -uy * sway,
    y: basePos.y + uy * offsetFt + ux * sway,
  };
};

// How long an out runner lingers — walking off toward the dugout — after
// they reach the base where they were retired. Long enough to read clearly,
// short enough to clear before the next pitch.
const WALK_OFF_TICKS = 24;
// Lifetime of the "+1" run-scored popup at home plate. Slightly longer
// than the big-play popup so a stack of multiple runs (grand slam) all
// get to float up and fade before the next pitch lands.
const RUN_SCORED_POPUP_TICKS = 18;
// Stylized dugouts — runners and fielders head to the dugout of THEIR team:
// home → 1B-side (right), away → 3B-side (left). The doorway points come
// from the canonical dugout rectangles so any future re-anchoring of the
// dugout shapes carries through to walk-off paths automatically.
const dugoutDoorwayForSide = (side: 'home' | 'away'): FieldPoint =>
  side === 'home' ? DUGOUT_DOORWAY_HOME : DUGOUT_DOORWAY_AWAY;
const onDeckCircleForSide = (side: 'home' | 'away'): FieldPoint =>
  side === 'home' ? ON_DECK_RIGHT : ON_DECK_LEFT;

// Inning transition pacing. The walk-off window starts after the 3rd-out
// play choreo settles and runs up to the inningEnd event; the walk-on
// window runs from inningEnd up until just before the next half-inning's
// first pitch (which fires at inningEnd.t + TIME_PITCH = 25 in sim time).
//
// Inside the global window, each fielder gets a per-position duration and
// a per-position start delay so the team doesn't move as one rigid block —
// the catcher and pitcher walk (slower, no delay) while the rest jog
// (faster, with small staggered delays) for a "team trickle" feel.
// The sim leaves a 60-tick event-free gap before each inningEnd; starting
// the walk-off ~46 ticks out (instead of 18) gives every fielder time to
// cover their real distance at a believable pace instead of teleport-
// sprinting in the final second.
const INNING_WALK_OFF_TICKS = 46;
const INNING_WALK_ON_TICKS = 24;
// Per-fielder pacing is SPEED-based, not duration-based: the corner
// outfielder has ~270 ft to cover and the catcher ~50, so giving everyone
// the same duration made the outfielders fly. Distances divide by these.
const WALK_SPEED_FT_PER_TICK = 2.2;       // catcher + pitcher amble off
const JOG_SPEED_FT_PER_TICK = 7.5;        // position players jog off
const TAKE_FIELD_SPEED_FT_PER_TICK = 12;  // everyone runs out to take the field
const POS_DELAY_MAX_TICKS = 6;            // max staggered delay per position

// Deterministic 0..1 hash so animation choices (toss counts, around-the-
// horn yes/no, per-position delays) are reproducible from the event log.
const hash01 = (s: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 0x1_0000_0000;
};
// Same hash, sugar for "give me a stable 0..1 from this player id".
const idHash01 = (id: string): number => hash01(`id|${id}`);

const isWalkPosition = (slot: FielderPos): boolean =>
  slot === 'P' || slot === 'C';
const transitionTimingFor = (
  slot: FielderPos,
  inningEndT: number,
  windowTicks: number,
  distFt: number,
  phase: 'walk-off' | 'walk-on',
): { delay: number; duration: number } => {
  // Walking off, the battery ambles and everyone else jogs; taking the
  // field, everyone runs out (which is what real teams do) so even the
  // corner outfielders make it before the first pitch.
  const speed =
    phase === 'walk-on'
      ? isWalkPosition(slot)
        ? JOG_SPEED_FT_PER_TICK
        : TAKE_FIELD_SPEED_FT_PER_TICK
      : isWalkPosition(slot)
        ? WALK_SPEED_FT_PER_TICK
        : JOG_SPEED_FT_PER_TICK;
  // Catcher + pitcher get little to no delay (they're already near the
  // mound/plate when the inning ends, no sense lingering); other fielders
  // get a variable lag — kept short on walk-on where the window is tight.
  const delaySpread = isWalkPosition(slot) ? 1 : phase === 'walk-on' ? 2 : POS_DELAY_MAX_TICKS;
  const delay = hash01(`delay|${inningEndT}|${slot}`) * delaySpread;
  const duration = Math.min(distFt / speed, windowTicks - delay);
  return { delay, duration: Math.max(4, duration) };
};

// Pixel-art high-five line for the winning team. Two staggered ranks
// straddle the area between the mound and second base. The renderer
// pulses a cheer wave through the line off the elapsed time.
const VICTORY_LINE_POSITIONS: readonly FieldPoint[] = [
  { x: -50, y: 100 },
  { x: -25, y: 100 },
  { x: 0, y: 100 },
  { x: 25, y: 100 },
  { x: 50, y: 100 },
  { x: -38, y: 122 },
  { x: -13, y: 122 },
  { x: 13, y: 122 },
  { x: 38, y: 122 },
];
// How long the winning team takes to walk in from their dugout to the line.
const VICTORY_WALK_IN_TICKS = 30;

interface SceneContext {
  readonly input: GameInput;
  readonly teamColors: ReadonlyMap<TeamId, { primary: string; secondary: string; accent: string }>;
  readonly teamAbbr: ReadonlyMap<TeamId, string>;
  readonly stadiumName: string;
  // Per-stadium grass shade pulled from the stadium record's atmosphere.
  readonly grassShade: string;
  // Per-stadium sky tint — typically derived from the home team's primary
  // color blended with a dark base, so each park has its own ambient feel.
  readonly skyColor: string;
  // Optional full Stadium record for the renderer's stadium-chrome layers
  // (warning track, foul poles, dugouts, crowd, quirk visuals). Optional so
  // tests and ad-hoc callers can build a SceneContext without one — the
  // renderer falls back to a placeholder ballpark when absent.
  readonly stadium?: Stadium;
  // Optional home-team primary color — used by the dugout trim layer to
  // tint the 1B-side (home) dugout's roof rim. Optional so tests can build
  // a SceneContext without one — the renderer falls back to a neutral grey.
  readonly homeTeamPrimary?: string;
  // Optional away-team primary color — used by the dugout trim layer to
  // tint the 3B-side (away) dugout's roof rim.
  readonly awayTeamPrimary?: string;
  // Optional predicate identifying "star" batters. The renderer's anim-cue
  // computation reads this to scale walk-up jingle intensity + duration.
  // Pure stand-in for the /ambience StarSet; we keep the type minimal here
  // so /render doesn't depend on /ambience.
  readonly isStarBatter?: (playerId: PlayerId) => boolean;
  // Season aggregates for the year. When provided, the scene reducer
  // surfaces the active batter's season top line (AVG/HR/RBI) and adds
  // any current-season vs-this-pitcher matchup line into the HUD's BvP
  // view. Optional so existing scene-test fixtures keep working.
  readonly seasonAggregates?: SeasonAggregates;
  // Career batter-vs-pitcher matchup totals across prior seasons (built
  // by /season/history.ts). Combined with the current season's matchup
  // counts before being surfaced as the BvpStats on the HUD.
  readonly careerBvp?: ReadonlyMap<PlayerId, ReadonlyMap<PlayerId, BvpLine>>;
  // Per-game weather (decided upstream in /app — no weather logic lives in
  // the renderer). The loop draws the matching overlay; absent = clear.
  readonly weather?: import('./weather.js').WeatherKind;
}

const fielderPositionFor = (
  pos: keyof typeof FIELDER_HOME_POSITIONS,
): FieldPoint => FIELDER_HOME_POSITIONS[pos];

// Walk forward through the integer bases between from and to, including endpoints.
// HR (from=0, to=0) is the only round-trip case.
const basePath = (from: 0 | 1 | 2 | 3, to: 0 | 1 | 2 | 3): readonly (0 | 1 | 2 | 3)[] => {
  if (from === 0 && to === 0) return [0, 1, 2, 3, 0];
  const out: (0 | 1 | 2 | 3)[] = [from];
  let cur: 0 | 1 | 2 | 3 = from;
  while (cur !== to) {
    cur = (((cur + 1) % 4) as 0 | 1 | 2 | 3);
    out.push(cur);
  }
  return out;
};

interface RunnerRender {
  readonly runnerId: PlayerId;
  readonly position: FieldPoint;
  readonly stillVisible: boolean;
}

const computeRunnerRender = (
  latest: RunnerLatest,
  simTime: number,
  runnerId: PlayerId,
  battingDugout: FieldPoint,
  lead: RunnerLead | undefined,
  pickoffDiveT?: number,
): RunnerRender => {
  const path = basePath(latest.from, latest.to);
  const segmentLen = latest.perBaseTicks;
  const totalDuration = (path.length - 1) * segmentLen;
  const elapsed = simTime - latest.t;

  // Pre-motion: runner waiting at `from`.
  if (elapsed <= 0) {
    return { runnerId, position: baseFor(latest.from), stillVisible: true };
  }

  // Mid-run: lerp along the path. Out runners run too — they don't stop
  // mid-stride knowing they'll be retired. They reach the bag, then walk off.
  if (elapsed < totalDuration) {
    const segIdx = Math.floor(elapsed / segmentLen);
    const segLocal = (elapsed % segmentLen) / segmentLen;
    const a = path[segIdx];
    const b = path[segIdx + 1];
    if (a === undefined || b === undefined) {
      return { runnerId, position: baseFor(latest.to), stillVisible: true };
    }
    return { runnerId, position: lerpPoint(baseFor(a), baseFor(b), segLocal), stillVisible: true };
  }

  // Arrived at `to`.
  const postArrival = elapsed - totalDuration;
  const arrivedAt = baseFor(latest.to);

  if (latest.out) {
    // Walk off slowly toward the nearest dugout. Disappear after the walk-off.
    if (postArrival >= WALK_OFF_TICKS) {
      return { runnerId, position: arrivedAt, stillVisible: false };
    }
    const frac = postArrival / WALK_OFF_TICKS;
    return { runnerId, position: lerpPoint(arrivedAt, battingDugout, frac), stillVisible: true };
  }

  // Safe — stays at base. Scoring runners leave the field.
  if (latest.to === 0) return { runnerId, position: HOME_PLATE, stillVisible: false };
  // Apply lead offset + idle sway when the runner is settled at a runnable
  // base (1/2/3) and we have a fresh `lead` event for them. Skip if no
  // lead is known — falls back to standing on the bag.
  if (lead && (latest.to === 1 || latest.to === 2 || latest.to === 3)) {
    const leadPos = applyLead(arrivedAt, lead, runnerId, simTime);
    // Pickoff move in progress: dive back to the bag, hug it while the
    // throw comes over, then ease back out to the lead.
    if (pickoffDiveT !== undefined && simTime >= pickoffDiveT) {
      const since = simTime - pickoffDiveT;
      let leadFrac = 1;
      if (since < DIVE_IN_TICKS) leadFrac = 1 - since / DIVE_IN_TICKS;
      else if (since < DIVE_IN_TICKS + DIVE_HUG_TICKS) leadFrac = 0;
      else if (since < DIVE_IN_TICKS + DIVE_HUG_TICKS + DIVE_EASE_OUT_TICKS) {
        leadFrac = (since - DIVE_IN_TICKS - DIVE_HUG_TICKS) / DIVE_EASE_OUT_TICKS;
      }
      return {
        runnerId,
        position: lerpPoint(arrivedAt, leadPos, leadFrac),
        stillVisible: true,
      };
    }
    return { runnerId, position: leadPos, stillVisible: true };
  }
  return { runnerId, position: arrivedAt, stillVisible: true };
};

const describeOutcome = (outcome: AtBatOutcome, batterName: string): string => {
  switch (outcome) {
    case 'home-run': return `${batterName} homers`;
    case 'triple': return `${batterName} triples`;
    case 'double': return `${batterName} doubles`;
    case 'single': return `${batterName} singles`;
    case 'walk': return `${batterName} walks`;
    case 'hit-by-pitch': return `${batterName} HBP`;
    case 'strikeout-swinging': return `${batterName} K (swinging)`;
    case 'strikeout-looking': return `${batterName} K (looking)`;
    case 'groundout': return `${batterName} grounds out`;
    case 'flyout': return `${batterName} flies out`;
    case 'lineout': return `${batterName} lines out`;
    case 'popout': return `${batterName} pops out`;
    case 'sac-fly': return `${batterName} sac fly, run scores`;
    case 'sac-bunt': return `${batterName} sac bunt`;
    case 'fielders-choice': return `${batterName} reaches on fielder's choice`;
    case 'reached-on-error': return `${batterName} reaches on error`;
    case 'double-play': return `${batterName} grounds into DP`;
    case 'triple-play': return `${batterName} into triple play`;
  }
};

// =========================================================================
// Around-the-horn choreography (post-strikeout, empty bases, ~50% of the
// time). Catcher → 3B → SS → 2B → soft lob to the pitcher. Anchored to the
// third-strike pitch's `t` so the ball flies smoothly out of the catcher's
// mitt instead of teleporting after atBatEnd fires 50 ticks later.
//
// Each segment has a flight time and a "hold" beat at the receiving end so
// the ball reads as caught-then-thrown rather than ricocheting.
// =========================================================================
const HORN_CATCHER_HOLD = 5;       // ticks after the pitch lands in the mitt
const HORN_THROW_TICKS = 7;        // each throw between bags
const HORN_LOB_TICKS = 9;          // softer return throw to the pitcher
const HORN_BAG_HOLD = 3;           // pause at each bag before the next throw

interface HornSegment {
  readonly startT: number;
  readonly endT: number;
  readonly from: FieldPoint;
  readonly to: FieldPoint;
  readonly arc: 'flat' | 'lob';
  // Audio cue: when the ball arrives. The throw end is when a glove pop or
  // mitt pop should fire.
  readonly arrivalSfx: 'glove' | 'mitt';
}

interface HornChoreo {
  readonly segments: readonly HornSegment[];
  readonly endT: number;
}

const buildHornChoreo = (pitchT: number): HornChoreo => {
  // Pitch flight is owned by the existing pitch-ball code; the horn picks
  // up after the catcher cradles the third strike.
  const ballArrivesT = pitchT + PITCH_FLIGHT_TICKS;
  let cursor = ballArrivesT + HORN_CATCHER_HOLD;
  const catcher = FIELDER_HOME_POSITIONS.C;
  const _3B = FIELDER_HOME_POSITIONS['3B'];
  const _SS = FIELDER_HOME_POSITIONS.SS;
  const _2B = FIELDER_HOME_POSITIONS['2B'];
  const segments: HornSegment[] = [];
  const pushThrow = (
    from: FieldPoint,
    to: FieldPoint,
    flight: number,
    arc: 'flat' | 'lob',
    arrivalSfx: 'glove' | 'mitt',
  ) => {
    segments.push({
      startT: cursor,
      endT: cursor + flight,
      from,
      to,
      arc,
      arrivalSfx,
    });
    cursor += flight + HORN_BAG_HOLD;
  };
  pushThrow(catcher, _3B, HORN_THROW_TICKS, 'flat', 'glove');
  pushThrow(_3B, _SS, HORN_THROW_TICKS, 'flat', 'glove');
  pushThrow(_SS, _2B, HORN_THROW_TICKS, 'flat', 'glove');
  pushThrow(_2B, PITCHERS_MOUND, HORN_LOB_TICKS, 'lob', 'mitt');
  return { segments, endT: cursor };
};

interface PitchInProgress {
  readonly t: number;
  readonly outcomeKnown: boolean;
  // Whether this pitch was actually swung at — drives the bat-swing animation.
  // Take pitches (ball / called-strike / hit-by-pitch) shouldn't move the bat.
  readonly wasSwing: boolean;
  // True for the first pitch of a new at-bat. The renderer delays the
  // ball's visual flight by FIRST_PITCH_HOLD_TICKS so the new batter has a
  // beat to settle in the box before the action starts.
  readonly isFirstOfAtBat: boolean;
}
interface ContactInProgress {
  readonly t: number;
  readonly path: BallPath;
}

export const buildScene = (
  events: readonly SimEvent[],
  simTime: number,
  ctx: SceneContext,
): SceneState => {
  // Per-side fielder lookup, used by the choreo to pick a responsible fielder
  // when a ball is hit. Computed once per call.
  const homeFielderIds = buildFielderIdsByPos(
    ctx.input.home.battingOrder,
    ctx.input.home.startingPitcherId,
    ctx.input.playerIndex,
  );
  const awayFielderIds = buildFielderIdsByPos(
    ctx.input.away.battingOrder,
    ctx.input.away.startingPitcherId,
    ctx.input.playerIndex,
  );
  const choreos = buildAllPlayChoreos(events, { home: homeFielderIds, away: awayFielderIds });

  // Game-level accumulators.
  let inning = 1;
  let half: 'top' | 'bottom' = 'top';
  let outs = 0;
  let balls = 0;
  let strikes = 0;
  let scoreHome = 0;
  let scoreAway = 0;
  let homePitcherId: PlayerId = ctx.input.home.startingPitcherId;
  let awayPitcherId: PlayerId = ctx.input.away.startingPitcherId;
  let currentBatterId: PlayerId | null = null;
  let lastPlay: string | null = null;
  let phase: SceneState['phase'] = 'pre-game';

  // Bases occupancy (post-event truth).
  const bases: { first: PlayerId | null; second: PlayerId | null; third: PlayerId | null } = {
    first: null,
    second: null,
    third: null,
  };
  // Last baserunner motion event per runner (for interpolation).
  const runnerLatest = new Map<PlayerId, RunnerLatest>();
  // Most recent `lead` event per runner — drives idle sway + lead offset
  // on at-rest baserunner sprites.
  const runnerLead = new Map<PlayerId, RunnerLead>();

  let lastPitch: PitchInProgress | null = null;
  let lastContact: ContactInProgress | null = null;
  let lastContactT: number | null = null; // for choreo lookup
  let lastBigPlay: BigPlayInfo | null = null;
  const runsScoredPopups: RunScoredPopup[] = [];
  // Pitches in the current at-bat, oldest first. Cleared at every atBatEnd
  // so the strike-zone viewer always reads as "this batter's pitch sequence".
  let currentAbPitches: StrikeZonePitchMark[] = [];

  // Tracks whether the current batter has already fired a baserunner event
  // with from === 0 (i.e. they hit the ball, walked, were HBP'd, etc.). When
  // the at-bat ends WITHOUT this happening (strikeout, flyout, lineout,
  // popout, sac-bunt) the batter quietly walks back to the dugout — there's
  // no runner sprite that handles their exit, so the scene reducer captures
  // them as `outgoingBatter` for a slow walk-off animation.
  let currentBatterRanOut = false;
  let lastOutgoingBatter: {
    readonly batterId: PlayerId;
    readonly atBatEndT: number;
    // Side of the batting team at the moment the at-bat ended — locks in
    // the dugout direction even after `half` flips on inningEnd.
    readonly battingSide: 'home' | 'away';
    // Where the walk-off starts. A batter who was running out a fly ball
    // peels off toward the dugout from wherever the catch caught him,
    // instead of teleporting back to the box.
    readonly fromPos?: FieldPoint;
  } | null = null;
  // Most recent atBatEnd we've consumed. Cleared on the next pitch event,
  // so `lastAtBatEndT !== null` (combined with no newer pitch) means we're
  // in the dead time between at-bats — the window during which the on-deck
  // batter slow-walks from the on-deck circle to the batter's box.
  let lastAtBatEndT: number | null = null;
  // Most recent strikeout with empty bases. Drives the around-the-horn
  // throw choreography: catcher → 3B → SS → 2B → P, fired ~50% of the time.
  let lastStrikeoutAroundTheHorn: {
    readonly atBatEndT: number;
    readonly pitchT: number; // the third-strike pitch event time
    readonly fielderIds: ReadonlyMap<FielderPos, PlayerId>;
  } | null = null;
  // Most recent third-strike pitch we've seen — needed by the around-the-
  // horn flag, since the choreo timing keys off the pitch (when the ball
  // landed in the catcher's mitt) rather than the atBatEnd 50 ticks later.
  let lastThirdStrikePitchT: number | null = null;
  // First pitch t of the at-bat in progress — used to tell whether the most
  // recent contact belongs to THIS at-bat (drives the batter run-out).
  let currentAbFirstPitchT: number | null = null;
  // Batter of the PREVIOUS at-bat — the defensive shift eases from the old
  // batter's alignment to the new one over the first pitches of an at-bat.
  let prevBatterForShift: PlayerId | null = null;
  // ---- Between-pitch baserunning theater (steals / pickoffs) -------------
  // Re-times a follow-up `baserunner` event so the runner visually breaks
  // when the sim said they broke (stealAttempt / errantThrow), not at the
  // arrival tick.
  const pendingRunStarts = new Map<PlayerId, { startT: number; perBaseTicks: number }>();
  // Most recent pickoff move per runner — drives the dive back to the bag.
  const pickoffDives = new Map<PlayerId, number>();
  // Last pickoff target — an errant throw turns him into a breaking runner.
  let lastPickoffMove: { runnerId: PlayerId; base: 1 | 2 | 3 } | null = null;
  // Runners sprinting NOW whose outcome event is still in the future (steal
  // breaks, errant-throw advances). Rendered mid-run until the follow-up
  // baserunner event takes over with the same startT, seamlessly.
  const breakingRunners = new Map<
    PlayerId,
    { t: number; from: 0 | 1 | 2 | 3; to: 0 | 1 | 2 | 3; perBaseTicks: number }
  >();
  // Ball throws between pitches: pickoffs, steal throws, backup relays.
  let interThrows: {
    startT: number;
    endT: number;
    from: FieldPoint;
    to: FieldPoint;
    holdAfter: number;
  }[] = [];
  // Backup outfielder chasing an errant pickoff throw.
  let backupRun: {
    fielderId: PlayerId;
    landing: FieldPoint;
    startT: number;
    pickupT: number;
    returnT: number;
  } | null = null;
  // Most recent inningEnd event, captured at the moment we apply it, plus
  // the fielding side that was on the field BEFORE the half flipped. The
  // walk-on phase reads this to know who's heading back to the dugout
  // (visible alongside the incoming team during the cross-fade).
  let lastInningEnd: {
    readonly t: number;
    readonly outgoingFieldingSide: 'home' | 'away';
  } | null = null;
  // Game-over capture: who won, and when. Drives the high-five line.
  let gameEnd: {
    readonly t: number;
    readonly winnerSide: 'home' | 'away';
  } | null = null;
  // Lookahead: if the next event past simTime is an inningEnd that's close
  // enough, we're in the walk-off window.
  let upcomingInningEnd: number | null = null;

  for (const ev of events) {
    if (ev.t > simTime) {
      // Lookahead for the imminent walk-off. The sim leaves a 60-tick gap
      // with no events between the 3rd-out atBatEnd and the inningEnd, so
      // the next event past simTime IS the upcoming inningEnd whenever
      // we're in that gap.
      if (ev.kind === 'inningEnd' && ev.t - simTime <= INNING_WALK_OFF_TICKS) {
        upcomingInningEnd = ev.t;
      }
      break;
    }
    switch (ev.kind) {
      case 'gameStart':
        phase = 'live';
        break;
      case 'pitch': {
        // New batter? Reset the "ran-out" flag so the next at-bat-end
        // triggers an outgoing-walk only if this batter never reaches base.
        const isNewBatter = ev.batterId !== currentBatterId;
        if (isNewBatter) {
          currentBatterRanOut = false;
          prevBatterForShift = currentBatterId;
        }
        currentBatterId = ev.batterId;
        // A new pitch closes any between-pitch baserunning theater.
        interThrows = [];
        pickoffDives.clear();
        pendingRunStarts.clear();
        breakingRunners.clear();
        lastPickoffMove = null;
        backupRun = null;
        // Any pitch event closes the inter-at-bat dead time (the on-deck
        // batter has reached the box; the at-bat is live).
        const wasInAtBatGap = lastAtBatEndT !== null;
        lastAtBatEndT = null;
        const r = ev.pitch.result;
        if (r === 'ball') balls += 1;
        else if (r === 'called-strike' || r === 'swinging-strike') strikes += 1;
        else if (r === 'foul' && strikes < 2) strikes += 1;
        const wasSwing =
          r === 'swinging-strike' ||
          r === 'foul' ||
          r === 'foul-tip-caught' ||
          r === 'in-play';
        // Capture the timestamp of the would-be third-strike pitch so the
        // around-the-horn animation can anchor to the moment the ball
        // arrived in the catcher's mitt, not 50 ticks later when atBatEnd
        // fires. We only really care when this turns into a strikeout —
        // any later pitch will overwrite this.
        if (
          (r === 'called-strike' || r === 'swinging-strike') &&
          strikes === 3
        ) {
          lastThirdStrikePitchT = ev.t;
        }
        // First pitch of an at-bat: gets the FIRST_PITCH_HOLD_TICKS visual
        // delay so the new batter has a beat at the plate before the ball
        // flies. Detected as either "new batterId" or "we just emerged
        // from the inter-at-bat gap" — gameStart's first pitch picks up
        // this flag too via the new-batter branch.
        const isFirstOfAtBat = isNewBatter || wasInAtBatGap;
        if (isFirstOfAtBat) currentAbFirstPitchT = ev.t;
        lastPitch = {
          t: ev.t,
          outcomeKnown: r === 'in-play',
          wasSwing,
          isFirstOfAtBat,
        };
        currentAbPitches.push({
          result: r,
          locationZone: ev.pitch.locationZone,
          firedAtT: ev.t,
        });
        break;
      }
      case 'contact': {
        lastContact = { t: ev.t, path: ev.ballPath };
        lastContactT = ev.t;
        break;
      }
      case 'lead': {
        runnerLead.set(ev.runnerId, {
          leadFt: ev.leadFt,
          aggression: ev.aggression,
          base: ev.base,
        });
        break;
      }
      case 'pickoffAttempt': {
        // Step-off: the runner dives back while the throw comes over.
        pickoffDives.set(ev.runnerId, ev.t);
        lastPickoffMove = { runnerId: ev.runnerId, base: ev.targetBase };
        break;
      }
      case 'pickoffThrow': {
        const target = baseFor(ev.targetBase);
        if (ev.accurate) {
          interThrows.push({
            startT: ev.t,
            endT: ev.t + PICKOFF_FLIGHT_TICKS,
            from: PITCHERS_MOUND,
            to: target,
            holdAfter: 6,
          });
          lastPlay = 'pickoff attempt!';
        } else {
          // Provisional sail-past arc — replaced by the exact landing once
          // the errantThrow event (TIME_ERRANT_DEFLECT later) is in scope.
          const overshoot = {
            x: target.x + (target.x - PITCHERS_MOUND.x) * 0.45,
            y: target.y + (target.y - PITCHERS_MOUND.y) * 0.45,
          };
          interThrows.push({
            startT: ev.t,
            endT: ev.t + ERRANT_FLIGHT_TICKS,
            from: PITCHERS_MOUND,
            to: overshoot,
            holdAfter: 0,
          });
        }
        break;
      }
      case 'errantThrow': {
        // Replace the provisional sail-past with the exact deflection path.
        interThrows.pop();
        const landing = { x: ev.landingX, y: ev.landingY };
        interThrows.push({
          startT: ev.t - ERRANT_FLIGHT_TICKS,
          endT: ev.t,
          from: PITCHERS_MOUND,
          to: landing,
          holdAfter: BACKUP_RETRIEVE_TICKS,
        });
        // The backup OF breaks for the ball; he picks it up when the
        // backupPlay event fires (BACKUP_RETRIEVE_TICKS later) and jogs
        // back to his spot after the relay.
        backupRun = {
          fielderId: ev.backupFielderId,
          landing,
          startT: ev.t - ERRANT_FLIGHT_TICKS,
          pickupT: ev.t + BACKUP_RETRIEVE_TICKS,
          returnT: ev.t + BACKUP_RETRIEVE_TICKS + 30,
        };
        // The runner who was diving back sees the ball get away and breaks
        // for the next base — animate the sprint before the outcome event.
        if (lastPickoffMove && lastPickoffMove.base === ev.targetBase) {
          pickoffDives.delete(lastPickoffMove.runnerId);
          breakingRunners.set(lastPickoffMove.runnerId, {
            t: ev.t,
            from: lastPickoffMove.base,
            to: (lastPickoffMove.base === 3 ? 0 : lastPickoffMove.base + 1) as 0 | 1 | 2 | 3,
            perBaseTicks: BACKUP_RETRIEVE_TICKS + RELAY_FLIGHT_TICKS,
          });
        }
        lastPlay = 'throw gets away — runner takes off!';
        break;
      }
      case 'backupPlay': {
        // Relay from the retrieved ball to the advancing runner's base, and
        // start that runner's advance back at the errant-throw moment.
        if (backupRun) {
          interThrows.push({
            startT: ev.t,
            endT: ev.t + RELAY_FLIGHT_TICKS,
            from: backupRun.landing,
            to: baseFor(ev.throwToBase),
            holdAfter: 8,
          });
          pendingRunStarts.set(ev.runnerId, {
            startT: backupRun.pickupT - BACKUP_RETRIEVE_TICKS,
            perBaseTicks: BACKUP_RETRIEVE_TICKS + RELAY_FLIGHT_TICKS,
          });
        }
        break;
      }
      case 'stealAttempt': {
        pendingRunStarts.set(ev.runnerId, {
          startT: ev.t,
          perBaseTicks: STEAL_RACE_TICKS,
        });
        breakingRunners.set(ev.runnerId, {
          t: ev.t,
          from: ev.from,
          to: ev.to,
          perBaseTicks: STEAL_RACE_TICKS,
        });
        pickoffDives.delete(ev.runnerId);
        // Defense fires to the bag — ball leaves shortly after the break so
        // it arrives just ahead of the tag.
        interThrows.push({
          startT: ev.t + 6,
          endT: ev.t + 12,
          from: PITCHERS_MOUND,
          to: baseFor(ev.to),
          holdAfter: 6,
        });
        const stealer = ctx.input.playerIndex.get(ev.runnerId);
        lastPlay = `${stealer?.lastName ?? 'runner'} takes off!`;
        break;
      }
      case 'tagAttempt': {
        const tagRunner = ctx.input.playerIndex.get(ev.runnerId);
        const nm = tagRunner?.lastName ?? 'runner';
        const wasSteal = pendingRunStarts.has(ev.runnerId);
        const baseName = ev.base === 1 ? '1st' : ev.base === 2 ? '2nd' : '3rd';
        lastPlay = ev.out
          ? wasSteal
            ? `${nm} caught stealing ${baseName}!`
            : `${nm} picked off!`
          : wasSteal
            ? `${nm} steals ${baseName}!`
            : `${nm} back in safely`;
        break;
      }
      case 'baserunner': {
        // A new arrival/advance overwrites any stale lead — the next
        // `lead` event for the runner re-establishes the correct base.
        runnerLead.delete(ev.runnerId);
        // Use choreo override start-time + per-base pace if available —
        // handles sac-fly tag-ups and pace-matches force-out runners to the
        // throw arrival so the "out" reads correctly.
        const choreo = lastContactT !== null ? choreos.get(lastContactT) : undefined;
        const override = choreo?.runnerOverrides.get(ev.runnerId);
        const pendingStart = pendingRunStarts.get(ev.runnerId);
        const startT = override?.startT ?? pendingStart?.startT ?? ev.t;
        const perBaseTicks =
          override?.perBaseTicks ?? pendingStart?.perBaseTicks ?? RUNNER_TRAVEL_TICKS_PER_BASE;
        // The batter became a runner — we don't need to draw an outgoing-
        // walk sprite for them; the runner sprite handles their motion
        // (including walk-off if they're put out at first).
        if (ev.from === 0 && ev.runnerId === currentBatterId) {
          currentBatterRanOut = true;
        }
        runnerLatest.set(ev.runnerId, {
          from: ev.from,
          to: ev.to,
          out: ev.out,
          t: startT,
          perBaseTicks,
        });
        // Update base occupancy: vacate `from`, occupy `to` (unless out or scoring).
        if (ev.from === 1) bases.first = null;
        else if (ev.from === 2) bases.second = null;
        else if (ev.from === 3) bases.third = null;
        if (!ev.out) {
          if (ev.to === 1) bases.first = ev.runnerId;
          else if (ev.to === 2) bases.second = ev.runnerId;
          else if (ev.to === 3) bases.third = ev.runnerId;
          else if (ev.to === 0) {
            if (half === 'top') scoreAway += 1;
            else scoreHome += 1;
            // Stack multiple runs scoring at the same simTime (e.g. grand
            // slam) so the HUD can float them up at separate heights.
            let stackIndex = 0;
            for (let i = runsScoredPopups.length - 1; i >= 0; i--) {
              if (runsScoredPopups[i]!.firedAtT === ev.t) stackIndex += 1;
              else break;
            }
            runsScoredPopups.push({ firedAtT: ev.t, stackIndex });
          }
        }
        break;
      }
      case 'atBatEnd': {
        const batter = currentBatterId ? ctx.input.playerIndex.get(currentBatterId) : null;
        const batterLast = batter ? batter.lastName : '';
        lastPlay = describeOutcome(ev.outcome, batterLast);
        outs += outsAddedFor(ev.outcome);
        balls = 0;
        strikes = 0;
        // Clear the strike-zone trail so the next batter starts fresh.
        currentAbPitches = [];
        // Set "big play" popup trigger for on-field fanfare + screen flash.
        const big = bigPlayFor(ev.outcome);
        if (big) {
          const battingTeamForBig =
            half === 'top' ? ctx.input.away.teamId : ctx.input.home.teamId;
          const colors = ctx.teamColors.get(battingTeamForBig);
          lastBigPlay = {
            firedAtT: ev.t,
            label: big.label,
            intensity: big.intensity,
            teamColor: colors?.primary ?? '#f1c40f',
          };
        }
        // Capture an outgoing-batter walk-off when the batter never became
        // a runner. K-types and air outs (sac flies included) qualify;
        // ground outs always fire a baserunner event so they go out the
        // runner path instead. If the batter was mid-sprint running out a
        // ball in play, the walk-off starts from that spot up the line.
        const isOut = outsAddedFor(ev.outcome) > 0;
        if (isOut && !currentBatterRanOut && currentBatterId) {
          let fromPos: FieldPoint | undefined;
          if (lastContactT !== null && batter) {
            const outBoxX = batter.bats === 'L' ? 4.5 : -4.5;
            const runFrac = Math.min(
              BATTER_RUN_OUT_CAP,
              Math.max(0, (ev.t - lastContactT) / RUNNER_TRAVEL_TICKS_PER_BASE),
            );
            fromPos = lerpPoint({ x: outBoxX, y: 2.5 }, FIRST_BASE, runFrac);
          }
          lastOutgoingBatter = {
            batterId: currentBatterId,
            atBatEndT: ev.t,
            battingSide: half === 'top' ? 'away' : 'home',
            ...(fromPos ? { fromPos } : {}),
          };
        }
        // Around-the-horn flag: strikeout + no one on base + not the 3rd
        // out + 85% chance. Skipping the 3rd-out case avoids a conflict
        // with the inning walk-off animation; otherwise we fire often so
        // the sequence reads as the standard post-K ritual it is.
        // Sequence runs catcher → 3B → SS → 2B → P; we record the third-
        // strike pitch time (ball in the mitt) and the active fielder
        // lineup so the per-frame ball-position logic below can play the
        // choreo back deterministically.
        // `outs` was already incremented above to include this K's out, so
        // outs >= 3 means this strikeout was the 3rd out — fielders walk
        // off, no horn.
        const inningEndedHere = outs >= 3;
        if (
          (ev.outcome === 'strikeout-swinging' ||
            ev.outcome === 'strikeout-looking') &&
          bases.first === null &&
          bases.second === null &&
          bases.third === null &&
          !inningEndedHere &&
          lastThirdStrikePitchT !== null &&
          hash01(`horn|${ev.t}`) < 0.85
        ) {
          const fielderIds = (half === 'top' ? homeFielderIds : awayFielderIds);
          lastStrikeoutAroundTheHorn = {
            atBatEndT: ev.t,
            pitchT: lastThirdStrikePitchT,
            fielderIds,
          };
        }
        // Reset the ran-out flag — a new batter steps in at the next pitch.
        currentBatterRanOut = false;
        // Mark the gap between at-bats so the on-deck batter's slow walk
        // to the box (and the buffered walk-up jingle) can anchor to it.
        lastAtBatEndT = ev.t;
        break;
      }
      case 'sub': {
        // Pitching change (Phase 1 only emits this for pitchers).
        const fieldingHome = half === 'top';
        if (fieldingHome) homePitcherId = ev.inPlayerId;
        else awayPitcherId = ev.inPlayerId;
        break;
      }
      case 'inningEnd': {
        bases.first = null;
        bases.second = null;
        bases.third = null;
        runnerLatest.clear();
        outs = 0;
        balls = 0;
        strikes = 0;
        currentAbPitches = [];
        // The half-inning is over; the outgoing batter (if any) has long
        // since reached the dugout, and any around-the-horn animation has
        // settled. Clear them so the inning-transition view is clean.
        lastOutgoingBatter = null;
        lastStrikeoutAroundTheHorn = null;
        lastThirdStrikePitchT = null;
        currentBatterId = null;
        currentBatterRanOut = false;
        lastAtBatEndT = null;
        // Capture the side that was just fielding so the walk-on phase can
        // still draw them retreating to their dugout while the new fielders
        // jog out.
        const outgoingFieldingSide: 'home' | 'away' = half === 'top' ? 'home' : 'away';
        lastInningEnd = { t: ev.t, outgoingFieldingSide };
        // Stale lookahead: once we've consumed the inningEnd we're past
        // its walk-off window.
        upcomingInningEnd = null;
        if (ev.halfInning === 'top') {
          half = 'bottom';
        } else {
          inning += 1;
          half = 'top';
        }
        // Cancel any in-flight pitch/contact state so the renderer doesn't
        // try to draw a stale ball during the inning gap.
        lastPitch = null;
        lastContact = null;
        lastContactT = null;
        break;
      }
      case 'gameEnd': {
        phase = 'final';
        const winnerSide: 'home' | 'away' =
          ev.finalRuns.home >= ev.finalRuns.away ? 'home' : 'away';
        gameEnd = { t: ev.t, winnerSide };
        // Suppress any leftover pitch / contact / inning-transition art
        // from the final out so the high-five line owns the screen.
        lastPitch = null;
        lastContact = null;
        lastContactT = null;
        lastInningEnd = null;
        break;
      }
    }
  }

  // Resolve current pitcher/batter from accumulators.
  const fieldingPitcherId = half === 'top' ? homePitcherId : awayPitcherId;
  const battingTeamId = half === 'top' ? ctx.input.away.teamId : ctx.input.home.teamId;
  const fieldingTeamId = half === 'top' ? ctx.input.home.teamId : ctx.input.away.teamId;

  const pitcher = ctx.input.playerIndex.get(fieldingPitcherId);
  const batter = currentBatterId ? ctx.input.playerIndex.get(currentBatterId) : null;

  const fieldingColors = ctx.teamColors.get(fieldingTeamId);
  const battingColors = ctx.teamColors.get(battingTeamId);
  if (!fieldingColors || !battingColors) throw new Error('team colors missing');

  // Active choreo for any in-progress play.
  const activeChoreo: PlayChoreo | undefined =
    lastContactT !== null ? choreos.get(lastContactT) : undefined;
  const choreoActive = activeChoreo !== undefined && simTime < activeChoreo.endT;

  // Inning transition: blocks live action during the inning gap so fielders
  // walk off (before inningEnd) and walk on (after). Walk-off and walk-on
  // share the role of overriding fielder positions; the renderer doesn't
  // need to know which side is on the field, only how to interpolate.
  let inningTransition: InningTransitionInfo | null = null;
  // Sub-window timing detail used by fielderPosFor to pace each position
  // independently. Set alongside inningTransition so per-fielder delays /
  // walk-vs-jog durations stay deterministic per inning.
  let transitionInningEndT: number | null = null;
  if (gameEnd === null) {
    if (
      upcomingInningEnd !== null &&
      upcomingInningEnd - simTime <= INNING_WALK_OFF_TICKS &&
      upcomingInningEnd - simTime >= 0
    ) {
      const progress =
        1 - (upcomingInningEnd - simTime) / INNING_WALK_OFF_TICKS;
      inningTransition = { phase: 'walk-off', progress };
      transitionInningEndT = upcomingInningEnd;
    } else if (
      lastInningEnd !== null &&
      simTime - lastInningEnd.t <= INNING_WALK_ON_TICKS &&
      simTime - lastInningEnd.t >= 0
    ) {
      const progress = (simTime - lastInningEnd.t) / INNING_WALK_ON_TICKS;
      inningTransition = { phase: 'walk-on', progress };
      transitionInningEndT = lastInningEnd.t;
    }
  }

  // Side currently fielding — used to pick which dugout each fielder heads
  // toward during walk-off (their team's dugout) and emerges from during
  // walk-on (the new fielding team's dugout). `half` is post-flip after an
  // inningEnd is processed, so this expression works for both phases.
  const fieldingSide: 'home' | 'away' = half === 'top' ? 'home' : 'away';
  const battingSide: 'home' | 'away' =
    fieldingSide === 'home' ? 'away' : 'home';
  const fieldingDugout = dugoutDoorwayForSide(fieldingSide);
  const battingDugout = dugoutDoorwayForSide(battingSide);

  // Pull a possibly-overridden position for the given fielder. Used uniformly
  // for pitcher, catcher, and the seven position players so any of them can
  // be choreographed (e.g. pitcher covering 1B, catcher in front of plate),
  // or — during the inning gap — sent on or off the field along a straight
  // path with per-position pacing (catcher + pitcher walk; others jog) plus
  // a small staggered delay so the team trickles rather than moving in lock-
  // step.
  // Pull-side defensive shift vs a batter: infield slides over for power
  // pull hitters (mirrors the sim's head-coach shift on outcome slices —
  // cosmetic alignment only). Eased between batters so nobody teleports.
  const shiftFor = (
    p: { bats: string; ratings: { power: number } } | null | undefined,
    slot: FielderPos,
  ): FieldPoint => {
    if (!p || slot === 'P' || slot === 'C') return { x: 0, y: 0 };
    const pull = p.bats === 'L' ? 1 : p.bats === 'R' ? -1 : 0;
    if (pull === 0) return { x: 0, y: 0 };
    const lean = Math.min(1, Math.max(0, (p.ratings.power - 55) / 44));
    if (lean <= 0) return { x: 0, y: 0 };
    const isInfield = slot === '1B' || slot === '2B' || slot === 'SS' || slot === '3B';
    return {
      x: pull * (isInfield ? 13 : 16) * lean,
      y: (isInfield ? 2 : 5) * lean,
    };
  };

  // Idle life at a position: the eased shift plus a slow two-frequency
  // wander (a few feet of pacing), larger between at-bats when fielders
  // re-set their depth. Catcher stays planted.
  const defensiveOffsetFor = (playerId: string, slot: FielderPos): FieldPoint => {
    const target = shiftFor(batter, slot);
    const prevBatter = prevBatterForShift
      ? ctx.input.playerIndex.get(prevBatterForShift)
      : null;
    const prev = shiftFor(prevBatter, slot);
    const ramp =
      currentAbFirstPitchT !== null
        ? Math.max(0, Math.min(1, (simTime - currentAbFirstPitchT) / SHIFT_RAMP_TICKS))
        : 1;
    const eased = easeInOut(ramp);
    const sx = prev.x + (target.x - prev.x) * eased;
    const sy = prev.y + (target.y - prev.y) * eased;
    if (slot === 'C') return { x: sx, y: sy };
    const phase = idHash01(playerId) * Math.PI * 2;
    const radius = (slot === 'P' ? 1.0 : 2.6) * (lastAtBatEndT !== null ? 1.8 : 1);
    const wx =
      Math.sin(simTime * 0.045 + phase) * radius +
      Math.sin(simTime * 0.017 + phase * 2.3) * radius * 0.7;
    const wy = Math.cos(simTime * 0.036 + phase * 1.4) * radius * 0.8;
    return { x: sx + wx, y: sy + wy };
  };

  // Returns null when the fielder is inside the dugout (walked off, or not
  // yet emerged) so the caller can skip the sprite entirely.
  const fielderPosFor = (
    playerId: string,
    slot: FielderPos,
    homePos: FieldPoint,
  ): FieldPoint | null => {
    if (inningTransition && transitionInningEndT !== null) {
      const windowTicks =
        inningTransition.phase === 'walk-off'
          ? INNING_WALK_OFF_TICKS
          : INNING_WALK_ON_TICKS;
      const distFt = Math.hypot(
        homePos.x - fieldingDugout.x,
        homePos.y - fieldingDugout.y,
      );
      const { delay, duration } = transitionTimingFor(
        slot,
        transitionInningEndT,
        windowTicks,
        distFt,
        inningTransition.phase,
      );
      // Local 0..1 progress for THIS fielder, clamped at the edges of their
      // delay/duration sub-window.
      let elapsedInWindow: number;
      if (inningTransition.phase === 'walk-off') {
        elapsedInWindow =
          INNING_WALK_OFF_TICKS - (transitionInningEndT - simTime);
      } else {
        elapsedInWindow = simTime - transitionInningEndT;
      }
      const localFrac = Math.max(
        0,
        Math.min(1, (elapsedInWindow - delay) / duration),
      );
      const eased = easeInOut(localFrac);
      if (inningTransition.phase === 'walk-off') {
        // Reached the doorway → inside the dugout, no sprite.
        if (localFrac >= 1) return null;
        return lerpPoint(homePos, fieldingDugout, eased);
      }
      // Walk-on: still in the dugout until their delay passes.
      if (elapsedInWindow < delay) return null;
      return lerpPoint(fieldingDugout, homePos, eased);
    }
    // Backup OF chasing an errant pickoff throw: sprint to the ball, relay,
    // jog back to the spot.
    if (backupRun && backupRun.fielderId === playerId) {
      const b = backupRun;
      if (simTime >= b.startT && simTime < b.pickupT) {
        const frac = (simTime - b.startT) / (b.pickupT - b.startT);
        return lerpPoint(homePos, b.landing, easeInOut(Math.min(1, frac)));
      }
      if (simTime >= b.pickupT && simTime < b.returnT) {
        const frac = (simTime - b.pickupT) / (b.returnT - b.pickupT);
        return lerpPoint(b.landing, homePos, easeInOut(frac));
      }
    }
    if (choreoActive && activeChoreo) {
      const overridden = fielderPositionForChoreo(activeChoreo, simTime, playerId);
      if (overridden) return overridden;
    }
    const off = defensiveOffsetFor(playerId, slot);
    return { x: homePos.x + off.x, y: homePos.y + off.y };
  };

  // Build fielders.
  const fieldingLineupIds =
    half === 'top' ? ctx.input.home.battingOrder : ctx.input.away.battingOrder;
  const heightScaleFor = (id: PlayerId): number => {
    const p = ctx.input.playerIndex.get(id);
    return p ? scaleFromHeight(p.heightFt) : 1;
  };
  const fielders: ScenePlayer[] = [];
  if (pitcher) {
    const pitcherPos = fielderPosFor(pitcher.id, 'P', fielderPositionFor('P'));
    if (pitcherPos) {
      fielders.push({
        id: pitcher.id,
        role: 'pitcher',
        position: pitcherPos,
        primaryColor: fieldingColors.primary,
        secondaryColor: fieldingColors.secondary,
        heightScale: scaleFromHeight(pitcher.heightFt),
      });
    }
  }
  const catcherPlayer = pickByPrimary(ctx.input.playerIndex, fieldingLineupIds, 'C');
  const catcherPos = catcherPlayer
    ? fielderPosFor(catcherPlayer.id, 'C', fielderPositionFor('C'))
    : null;
  const catcher: ScenePlayer | null =
    catcherPlayer && catcherPos
      ? {
          id: catcherPlayer.id,
          role: 'catcher',
          position: catcherPos,
          primaryColor: fieldingColors.primary,
          secondaryColor: fieldingColors.secondary,
          heightScale: scaleFromHeight(catcherPlayer.heightFt),
        }
      : null;
  if (catcher) fielders.push(catcher);

  for (const pos of ['1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const) {
    const p = pickByPrimary(ctx.input.playerIndex, fieldingLineupIds, pos);
    if (!p) continue;
    const fpos = fielderPosFor(p.id, pos, fielderPositionFor(pos));
    if (!fpos) continue;
    fielders.push({
      id: p.id,
      role: 'fielder',
      position: fpos,
      primaryColor: fieldingColors.primary,
      secondaryColor: fieldingColors.secondary,
      heightScale: scaleFromHeight(p.heightFt),
    });
  }

  // Batter sprite at the box. Hidden once the batter has fired a baserunner
  // event in this half-inning — otherwise we'd render them at the box AND
  // as a runner ("the dupe"). Also hidden during the inning gap and after
  // the game's over so the field is clear for the walk-on / high-five line.
  // Swing animation only fires on actual swing pitches; a take leaves the
  // bat in ready stance.
  const batterIsRunner = currentBatterId !== null && runnerLatest.has(currentBatterId);
  const fieldIsClearOfBatter = inningTransition !== null || gameEnd !== null;
  // During the dead time between at-bats, the just-finished batter is
  // either being drawn as `outgoingBatter` (slow walk to dugout) or has
  // already left as a runner. The on-deck batter is mid-walk to the box.
  // Either way, the active batter slot is empty until the next pitch fires.
  const inAtBatGap = lastAtBatEndT !== null;
  let batterScene: ScenePlayer | null = null;
  if (batter && phase === 'live' && !batterIsRunner && !fieldIsClearOfBatter && !inAtBatGap) {
    const boxX = batter.bats === 'L' ? 4.5 : -4.5;
    const boxPos = { x: boxX, y: 2.5 };
    let swingFrac = 0;
    if (lastPitch && lastPitch.wasSwing) {
      // First-pitch hold offsets the swing by the same amount as the ball
      // flight, so the bat moves with the actual pitch, not a phantom one.
      const flightOffset = lastPitch.isFirstOfAtBat ? FIRST_PITCH_HOLD_TICKS : 0;
      const elapsed = simTime - lastPitch.t - flightOffset;
      const swingStartT = PITCH_FLIGHT_TICKS * 0.55;
      const swingEndT = PITCH_FLIGHT_TICKS * 0.95;
      if (elapsed > swingStartT) {
        const x = (elapsed - swingStartT) / (swingEndT - swingStartT);
        if (x <= 1) {
          // Accelerating whip — loads slow, snaps through the zone.
          swingFrac = x * x;
        } else if (elapsed <= swingEndT + SWING_HOLD_TICKS) {
          // Hold the follow-through so the swing (and the miss) registers.
          swingFrac = 1;
        } else {
          // Ease the bat back to the ready stance.
          const back = (elapsed - swingEndT - SWING_HOLD_TICKS) / SWING_RESET_TICKS;
          swingFrac = Math.max(0, 1 - back);
        }
      }
    }
    // Ball in play and no baserunner event yet → the batter busts it up the
    // line toward 1B (you run out a fly ball; you don't admire it). On hits
    // and grounders the sim's baserunner event takes over within the same
    // tick, so this path only shows on air balls — exactly the case where
    // the batter used to stand at the plate watching.
    let batterPos = boxPos;
    const contactIsThisAb =
      lastContactT !== null &&
      currentAbFirstPitchT !== null &&
      lastContactT >= currentAbFirstPitchT;
    if (contactIsThisAb && simTime > lastContactT!) {
      const runFrac = Math.min(
        BATTER_RUN_OUT_CAP,
        (simTime - lastContactT!) / RUNNER_TRAVEL_TICKS_PER_BASE,
      );
      batterPos = lerpPoint(boxPos, FIRST_BASE, runFrac);
      swingFrac = 0; // bat's down, he's running
    }
    batterScene = {
      id: batter.id,
      role: 'batter',
      position: batterPos,
      primaryColor: battingColors.primary,
      secondaryColor: battingColors.secondary,
      swingFrac,
      heightScale: scaleFromHeight(batter.heightFt),
    };
  }

  // Runners: for each occupied base (or scored runner still in motion), use latest event.
  // Hidden during inning transitions (the half cleared its bases on inningEnd
  // anyway) and once the game's over (the high-five line owns the screen).
  const runners: ScenePlayer[] = [];
  // Note: the batter-as-runner appears here once a baserunner event fires for them.
  if (inningTransition === null && gameEnd === null) {
    for (const [runnerId, latest] of runnerLatest) {
      const breaking = breakingRunners.get(runnerId);
      const render =
        breaking && breaking.t > latest.t && simTime >= breaking.t
          ? {
              runnerId,
              position: lerpPoint(
                baseFor(breaking.from),
                baseFor(breaking.to),
                Math.min(1, (simTime - breaking.t) / breaking.perBaseTicks),
              ),
              stillVisible: true,
            }
          : computeRunnerRender(
              latest,
              simTime,
              runnerId,
              battingDugout,
              runnerLead.get(runnerId),
              pickoffDives.get(runnerId),
            );
      if (!render.stillVisible) continue;
      runners.push({
        id: runnerId,
        role: 'runner',
        position: render.position,
        primaryColor: battingColors.primary,
        secondaryColor: battingColors.secondary,
        heightScale: heightScaleFor(runnerId),
      });
    }
  }

  // Ball state — position (ground projection), height (for 2.5D), visibility,
  // and whether it's currently in flight (drives shadow rendering). The
  // ball is parked off-screen during inning transitions and after the
  // final out so neither the inning-gap walk nor the high-five line gets
  // a stray pellet sitting on the mound.
  let ballPos: FieldPoint = PITCHERS_MOUND;
  let ballHeight = 0;
  let ballVisible = phase === 'live' && inningTransition === null && gameEnd === null;
  let ballInFlight = false;

  if (lastContact && choreoActive && activeChoreo) {
    // Choreo drives the full play: ball flight → fielder pickup → throw.
    const ballState = ballStateForChoreo(activeChoreo, simTime);
    if (ballState) {
      ballPos = ballState.position;
      ballHeight = ballState.heightFt;
      ballVisible = ballState.visible;
      ballInFlight = ballState.inFlight;
    } else {
      ballVisible = false;
      ballInFlight = false;
    }
  } else if (lastPitch) {
    // First pitch of an at-bat: ball stays at the mound for FIRST_PITCH_
    // HOLD_TICKS (~1.5 wall-sec) after the new batter has settled in the
    // box, before the visual flight begins. Subsequent pitches use no
    // hold — the cradle-and-lob already paces the inter-pitch beat.
    const flightDelay = lastPitch.isFirstOfAtBat ? FIRST_PITCH_HOLD_TICKS : 0;
    const flightStartT = lastPitch.t + flightDelay;
    if (simTime < flightStartT) {
      // Pre-flight: ball sits on the mound, fully visible (the new batter
      // is staring down the pitcher).
      ballPos = PITCHERS_MOUND;
      ballHeight = 0;
      ballVisible = true;
      ballInFlight = false;
      // Fall through to the rest of the function — the rest of the ball-
      // state branches don't apply during this hold.
    } else {
    const elapsed = simTime - flightStartT;
    if (elapsed <= PITCH_FLIGHT_TICKS) {
      const frac = Math.max(0, Math.min(1, elapsed / PITCH_FLIGHT_TICKS));
      ballPos = lerpPoint(PITCHERS_MOUND, HOME_PLATE, frac);
      // A pitch arcs slightly. Peak ~6 ft mid-flight.
      ballHeight = 6 * Math.sin(frac * Math.PI);
      ballVisible = true;
      ballInFlight = frac > 0 && frac < 1;
    } else {
      // Catcher cradles, then lobs the ball back to the mound. Skipped when
      // a contact choreo is active (handled by the branch above) — only
      // takes/balls/strikes/HBP land here. After a strikeout with empty
      // bases, ~50% of the time the cradle-and-lob is replaced by an
      // around-the-horn sequence (catcher → 3B → SS → 2B → P).
      const catcherPos = FIELDER_HOME_POSITIONS.C;
      const horn =
        lastStrikeoutAroundTheHorn !== null &&
        lastStrikeoutAroundTheHorn.pitchT === lastPitch.t
          ? buildHornChoreo(lastPitch.t)
          : null;
      if (horn && simTime <= horn.endT) {
        const seg = horn.segments.find(
          (s) => simTime >= s.startT && simTime <= s.endT,
        );
        const bagAt = (t: number): { pos: FieldPoint; isAtBag: boolean } => {
          // Pre-segment-1 hold: ball in catcher's mitt.
          if (t < horn.segments[0]!.startT) {
            return { pos: catcherPos, isAtBag: true };
          }
          // Between segments: ball at the previous segment's `to`.
          for (let i = 0; i < horn.segments.length; i++) {
            const s = horn.segments[i]!;
            if (t < s.startT) return { pos: horn.segments[i - 1]!.to, isAtBag: true };
          }
          return { pos: horn.segments[horn.segments.length - 1]!.to, isAtBag: true };
        };
        if (seg) {
          const dur = seg.endT - seg.startT;
          const frac = dur > 0 ? Math.min(1, (simTime - seg.startT) / dur) : 1;
          ballPos = lerpPoint(seg.from, seg.to, frac);
          // Flat throws peak ~7 ft; soft lob peaks ~10 ft.
          const peak = seg.arc === 'lob' ? 10 : 7;
          ballHeight = peak * Math.sin(frac * Math.PI);
          ballVisible = true;
          ballInFlight = true;
        } else {
          const held = bagAt(simTime);
          ballPos = held.pos;
          ballHeight = 0;
          ballVisible = true;
          ballInFlight = false;
        }
      } else {
        // Default: catcher cradles + lobs back to mound.
        const holdElapsed = elapsed - PITCH_FLIGHT_TICKS;
        if (holdElapsed <= CATCHER_HOLD_TICKS) {
          ballPos = catcherPos;
          ballHeight = 0;
          ballVisible = true;
          ballInFlight = false;
        } else if (holdElapsed <= CATCHER_HOLD_TICKS + CATCHER_LOB_TICKS) {
          const frac = (holdElapsed - CATCHER_HOLD_TICKS) / CATCHER_LOB_TICKS;
          ballPos = lerpPoint(catcherPos, PITCHERS_MOUND, frac);
          // Low, gentle arc — peak ~5 ft so it reads as a relaxed lob.
          ballHeight = 5 * Math.sin(frac * Math.PI);
          ballVisible = true;
          ballInFlight = true;
        } else {
          ballPos = PITCHERS_MOUND;
          ballHeight = 0;
          ballVisible = true;
          ballInFlight = false;
        }
      }
    }
    } // end: else (simTime >= flightStartT)
  }

  // (Inning-end ball tossing was retired when the walk-off window grew to
  // cover the whole gap — fielders leave their positions too early to
  // receive casual lobs. Around-the-horn after mid-inning strikeouts stays.)

  // Between-pitch throws — pickoffs, steal plays, backup relays. These
  // override the parked ball while their window is live.
  for (const th of interThrows) {
    if (simTime >= th.startT && simTime <= th.endT + th.holdAfter) {
      if (simTime <= th.endT && th.endT > th.startT) {
        const frac = (simTime - th.startT) / (th.endT - th.startT);
        ballPos = lerpPoint(th.from, th.to, frac);
        ballHeight = 5 * Math.sin(frac * Math.PI);
        ballInFlight = true;
      } else {
        ballPos = th.to;
        ballHeight = 0;
        ballInFlight = false;
      }
      ballVisible = true;
    }
  }

  // HUD aggregates — derived from the same event prefix so the line score,
  // batter card, and on-deck indicator always agree with what's on the field.
  const eventsPrefix = events.filter((e) => e.t <= simTime);
  let batterStats: BatterCardStats | null = null;
  let pitcherStats: PitcherCardStats | null = null;
  let onDeckBatterId: PlayerId | null = null;
  let lineScore: SceneLineScore = {
    innings: [],
    home: { runs: 0, hits: 0, errors: 0 },
    away: { runs: 0, hits: 0, errors: 0 },
  };
  if (eventsPrefix.length > 0 && phase !== 'pre-game') {
    const box = buildBoxScore(eventsPrefix, ctx.input);
    lineScore = {
      innings: box.lineScore.innings,
      home: box.lineScore.home,
      away: box.lineScore.away,
    };
    if (currentBatterId) {
      const battersList = half === 'top' ? box.awayBatters : box.homeBatters;
      const row = battersList.find((b) => b.playerId === currentBatterId);
      if (row) {
        batterStats = {
          atBats: row.atBats,
          hits: row.hits,
          homeRuns: row.homeRuns,
          rbis: row.rbis,
          walks: row.walks,
          strikeouts: row.strikeouts,
        };
      }
    }
    const pitchersList = half === 'top' ? box.homePitchers : box.awayPitchers;
    const pRow = pitchersList.find((p) => p.playerId === fieldingPitcherId);
    if (pRow) {
      pitcherStats = {
        pitches: pRow.pitches,
        balls: pRow.balls,
        strikes: pRow.strikes,
      };
    }
    const battingOrder = half === 'top' ? ctx.input.away.battingOrder : ctx.input.home.battingOrder;
    if (currentBatterId) {
      const idx = battingOrder.indexOf(currentBatterId);
      if (idx >= 0) {
        onDeckBatterId = battingOrder[(idx + 1) % battingOrder.length] ?? null;
      }
    }
  }

  // Season + matchup top lines for the active batter. These come from
  // /stats SeasonAggregates and /season LeagueHistory.careerBvp via the
  // SceneContext — they're the same numbers the menus show. The HUD
  // batter card surfaces them as a stat strip beside the current-game
  // line. When the context lacks aggregates (tests, ad-hoc fixtures)
  // both fields stay null and the HUD falls back to the existing
  // current-game-only display.
  let seasonBatterStats: SeasonBatterStats | null = null;
  let bvpStats: BvpStats | null = null;
  if (currentBatterId && ctx.seasonAggregates) {
    seasonBatterStats = buildSeasonBatterStats(
      ctx.seasonAggregates.batting.get(currentBatterId),
    );
    bvpStats = buildBvpStats(
      currentBatterId,
      fieldingPitcherId,
      ctx.seasonAggregates,
      ctx.careerBvp,
    );
  }

  // Post-game: build the high-five line. We replace the regular fielders
  // with the winning team's nine, walking them in from their dugout for a
  // beat and then pulsing a cheer wave down the line. Bookkeeping above
  // (scoreHome, scoreAway, lineScore, etc.) is unaffected.
  let victory: VictoryCelebration | null = null;
  let displayPitcher: ScenePlayer | null =
    fielders.find((f) => f.role === 'pitcher') ?? null;
  let displayCatcher: ScenePlayer | null = catcher;
  let displayFielders: readonly ScenePlayer[] = fielders.filter(
    (f) => f.role !== 'pitcher' && f.role !== 'catcher',
  );
  if (gameEnd !== null) {
    const winnerSide = gameEnd.winnerSide;
    const winnerTeamId =
      winnerSide === 'home' ? ctx.input.home.teamId : ctx.input.away.teamId;
    const losingTeamId =
      winnerSide === 'home' ? ctx.input.away.teamId : ctx.input.home.teamId;
    const elapsed = simTime - gameEnd.t;
    victory = { winnerTeamId, losingTeamId, elapsed };
    const winnerColors = ctx.teamColors.get(winnerTeamId);
    if (winnerColors) {
      const winnerPitcherId =
        winnerSide === 'home' ? homePitcherId : awayPitcherId;
      const winnerLineupIds =
        winnerSide === 'home'
          ? ctx.input.home.battingOrder
          : ctx.input.away.battingOrder;
      const winnerIds = [winnerPitcherId, ...winnerLineupIds].slice(0, 9);
      const walkProgress = Math.max(
        0,
        Math.min(1, elapsed / VICTORY_WALK_IN_TICKS),
      );
      const walkInEased = easeInOut(walkProgress);
      const settled = walkProgress >= 1;

      // Winners spill out of THEIR dugout — home from 1B side, away from 3B.
      const winnerDugout = dugoutDoorwayForSide(winnerSide);
      const linePlayers: ScenePlayer[] = [];
      for (let i = 0; i < winnerIds.length; i++) {
        const pid = winnerIds[i]!;
        const linePos = VICTORY_LINE_POSITIONS[i] ?? VICTORY_LINE_POSITIONS[0]!;
        const pos = lerpPoint(winnerDugout, linePos, walkInEased);
        const cheerFrac = settled
          ? cheerWave(elapsed - VICTORY_WALK_IN_TICKS, i)
          : 0;
        // Role-tag the first as pitcher and second as catcher so the
        // existing draw order in /sprites picks them up uniformly.
        const role: ScenePlayer['role'] =
          i === 0 ? 'pitcher' : i === 1 ? 'catcher' : 'fielder';
        linePlayers.push({
          id: pid,
          role,
          position: pos,
          primaryColor: winnerColors.primary,
          secondaryColor: winnerColors.secondary,
          cheerFrac,
          heightScale: heightScaleFor(pid),
        });
      }
      displayPitcher = linePlayers[0] ?? null;
      displayCatcher = linePlayers[1] ?? null;
      displayFielders = linePlayers.slice(2);
    }
  }

  // ---- On-deck batter sprite ---------------------------------------------
  // Visible at the on-deck circle while a live at-bat is in progress. Takes
  // an idle warmup swing — slow, periodic, independent of the at-bat.
  let onDeckBatterScene: ScenePlayer | null = null;
  if (
    onDeckBatterId !== null &&
    phase === 'live' &&
    inningTransition === null &&
    gameEnd === null
  ) {
    const onDeckPlayer = ctx.input.playerIndex.get(onDeckBatterId);
    if (onDeckPlayer) {
      // Periodic swing — a 7-tick cycle (~7 sec at 1 tick/sec) with a
      // sharp peak so the bat reads "on the rise → through → reset".
      const phaseOff = idHash01(onDeckBatterId) * Math.PI * 2;
      const cyc = (simTime * 0.18 + phaseOff) % (Math.PI * 2);
      const tri = cyc < Math.PI ? cyc / Math.PI : 0; // half-cycle swings
      // Position: at the on-deck circle by default, but during the gap
      // between at-bats the on-deck batter slow-walks toward the box so
      // they're already at the plate when the next pitch fires. The walk
      // is intentionally slow — the user wants the eye to register the
      // hand-off cleanly. We delay the start of the walk by ON_DECK_SETTLE
      // ticks so the previous play has time to clear and the walk-up
      // jingle gets to lead in with a beat of pre-roll.
      const circle = onDeckCircleForSide(battingSide);
      const boxX = onDeckPlayer.bats === 'L' ? 4.5 : -4.5;
      const boxPos = { x: boxX, y: 2.5 };
      let pos = circle;
      let swingFrac = tri;
      let intoDugout = false;
      if (
        lastAtBatEndT !== null &&
        simTime > lastAtBatEndT + ON_DECK_SETTLE_TICKS
      ) {
        const elapsed = simTime - lastAtBatEndT - ON_DECK_SETTLE_TICKS;
        const frac = Math.min(1, elapsed / ON_DECK_WALK_TO_BOX_TICKS);
        if (outs >= 3) {
          // That at-bat ended the half — nobody walks up to hit. The
          // on-deck batter shoulders the bat and ducks back into the
          // dugout instead (he leads off next inning from there).
          const dugout = dugoutDoorwayForSide(battingSide);
          pos = lerpPoint(circle, dugout, easeInOut(frac));
          swingFrac = 0;
          intoDugout = frac >= 1;
        } else {
          pos = lerpPoint(circle, boxPos, easeInOut(frac));
          // Once they're walking, dampen the warmup swing so they look like
          // they're heading to work, not still loose in the on-deck circle.
          swingFrac = tri * (1 - frac);
        }
      }
      if (intoDugout) {
        onDeckBatterScene = null;
      } else
      onDeckBatterScene = {
        id: onDeckPlayer.id,
        role: 'on-deck',
        position: pos,
        primaryColor: battingColors.primary,
        secondaryColor: battingColors.secondary,
        swingFrac,
        heightScale: scaleFromHeight(onDeckPlayer.heightFt),
      };
    }
  }

  // ---- Outgoing batter (slow walk to dugout after a non-runner out) -------
  // Triggered for strikeouts, flyouts, lineouts, popouts and sac-bunts —
  // outcomes where the batter never fires a baserunner event. The sprite
  // walks from the batter's box to the batting team's dugout doorway over
  // ~22 ticks, then disappears so the next batter has a clean field.
  const OUTGOING_WALK_TICKS = 22;
  let outgoingBatterScene: ScenePlayer | null = null;
  if (
    lastOutgoingBatter !== null &&
    inningTransition === null &&
    gameEnd === null &&
    simTime - lastOutgoingBatter.atBatEndT <= OUTGOING_WALK_TICKS &&
    simTime - lastOutgoingBatter.atBatEndT >= 0
  ) {
    const outBatter = ctx.input.playerIndex.get(lastOutgoingBatter.batterId);
    if (outBatter) {
      const elapsed = simTime - lastOutgoingBatter.atBatEndT;
      const frac = easeInOut(elapsed / OUTGOING_WALK_TICKS);
      const boxX = outBatter.bats === 'L' ? 4.5 : -4.5;
      const boxPos = lastOutgoingBatter.fromPos ?? { x: boxX, y: 2.5 };
      const dugout = dugoutDoorwayForSide(lastOutgoingBatter.battingSide);
      const colors = ctx.teamColors.get(
        lastOutgoingBatter.battingSide === 'home'
          ? ctx.input.home.teamId
          : ctx.input.away.teamId,
      );
      outgoingBatterScene = {
        id: outBatter.id,
        role: 'outgoing',
        position: lerpPoint(boxPos, dugout, frac),
        primaryColor: colors?.primary ?? battingColors.primary,
        secondaryColor: colors?.secondary ?? battingColors.secondary,
        heightScale: scaleFromHeight(outBatter.heightFt),
      };
    }
  }

  return {
    phase,
    inning,
    half,
    outs,
    balls,
    strikes,
    scoreHome,
    scoreAway,
    basesOccupied: {
      first: bases.first !== null,
      second: bases.second !== null,
      third: bases.third !== null,
    },
    pitcher: displayPitcher,
    batter: batterScene,
    catcher: displayCatcher,
    fielders: displayFielders,
    runners,
    onDeckBatter: onDeckBatterScene,
    outgoingBatter: outgoingBatterScene,
    ball: { position: ballPos, heightFt: ballHeight, visible: ballVisible, inFlight: ballInFlight },
    lastPlay,
    homeTeamId: ctx.input.home.teamId,
    awayTeamId: ctx.input.away.teamId,
    stadiumId: ctx.input.stadiumId,
    stadiumName: ctx.stadiumName,
    homeAbbr: ctx.teamAbbr.get(ctx.input.home.teamId) ?? ctx.input.home.teamId,
    awayAbbr: ctx.teamAbbr.get(ctx.input.away.teamId) ?? ctx.input.away.teamId,
    batterStats,
    seasonBatterStats,
    bvpStats,
    pitcherStats,
    onDeckBatterId,
    strikeZone: buildStrikeZone(batter, currentAbPitches),
    lineScore,
    lastBigPlay,
    recentRunsScored: runsScoredPopups.filter((r) => {
      const age = simTime - r.firedAtT;
      return age >= 0 && age <= RUN_SCORED_POPUP_TICKS;
    }),
    inningTransition,
    victory,
    simTime,
  };
};

// Derive the active batter's season top line from their BattingLine. AVG is
// computed at read time so the SceneState carries primitives only — no
// references back into /stats. Returns null when the batter has no PAs
// yet (Day 1 game starts before any stats accumulate).
const buildSeasonBatterStats = (
  line: BattingLine | undefined,
): SeasonBatterStats | null => {
  if (!line || line.PA === 0) return null;
  const avg = line.AB > 0 ? line.H / line.AB : 0;
  return {
    avg,
    homeRuns: line.HR,
    rbi: line.RBI,
    hits: line.H,
    atBats: line.AB,
  };
};

// Build the all-time matchup line for a (batter, pitcher) pair: the sum
// of every prior-season matchup row in `careerBvp` plus the current
// season's matchup row in `seasonAggregates.bvpMatchups`. Returns null
// if neither source has the pair, or the combined PA count is zero.
const buildBvpStats = (
  batterId: PlayerId,
  pitcherId: PlayerId,
  seasonAggregates: SeasonAggregates,
  careerBvp: ReadonlyMap<PlayerId, ReadonlyMap<PlayerId, BvpLine>> | undefined,
): BvpStats | null => {
  const career = careerBvp?.get(batterId)?.get(pitcherId);
  const season = seasonAggregates.bvpMatchups.get(batterId)?.get(pitcherId);
  if (!career && !season) return null;
  const PA = (career?.PA ?? 0) + (season?.PA ?? 0);
  if (PA === 0) return null;
  return {
    pitcherId,
    plateAppearances: PA,
    atBats: (career?.AB ?? 0) + (season?.AB ?? 0),
    hits: (career?.H ?? 0) + (season?.H ?? 0),
    homeRuns: (career?.HR ?? 0) + (season?.HR ?? 0),
    rbi: (career?.RBI ?? 0) + (season?.RBI ?? 0),
    walks: (career?.BB ?? 0) + (season?.BB ?? 0),
    strikeouts: (career?.SO ?? 0) + (season?.SO ?? 0),
  };
};

// Map a player's listed height to a sprite-size multiplier. Reference 6.0 ft
// gets 1.0; a 5.55-ft player drops to ~0.93 and a 6.6-ft player rises to
// ~1.06. Subtle on purpose — too much variance makes the field look busy.
const scaleFromHeight = (heightFt: number): number => {
  const delta = heightFt - 6.0;
  return Math.max(0.92, Math.min(1.08, 1 + delta * 0.13));
};

// Cap the on-screen strike-zone trail at the number of pitches an at-bat
// can plausibly run to. We keep the most recent N so even long fouled-off
// at-bats stay readable instead of blanketing the grid.
const STRIKE_ZONE_MAX_PITCHES = 12;

const buildStrikeZone = (
  batter: import('../world/types.js').Player | null | undefined,
  pitches: readonly StrikeZonePitchMark[],
): StrikeZoneViewerInfo | null => {
  if (!batter) return null;
  const trimmed =
    pitches.length <= STRIKE_ZONE_MAX_PITCHES
      ? pitches
      : pitches.slice(pitches.length - STRIKE_ZONE_MAX_PITCHES);
  return {
    batterHeightFt: batter.heightFt,
    pitches: trimmed,
  };
};

// Smoothstep — runners bunching up if you lerp linearly from far apart;
// the easing softens both the launch out of the dugout and the arrival.
const easeInOut = (t: number): number => {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
};

// Periodic raised-arm wave through the high-five line. Each player's cheer
// peaks at a staggered phase, so the screensaver always has something
// gently rolling across the screen even after the action stops.
const cheerWave = (elapsedAfterWalkIn: number, lineIndex: number): number => {
  if (elapsedAfterWalkIn < 0) return 0;
  const phase = elapsedAfterWalkIn * 0.32 - lineIndex * 0.7;
  const raw = Math.sin(phase);
  // Compress to a sharper peak — most of the time arms are down, with a
  // quick raise as the wave passes.
  return Math.max(0, raw) ** 1.4;
};

// Decides whether an outcome triggers the on-field popup, what label to
// show, and whether the screen-edge flash should fire.
const bigPlayFor = (
  outcome: AtBatOutcome,
): { label: string; intensity: 'normal' | 'extra-base' } | null => {
  switch (outcome) {
    case 'home-run': return { label: 'HOME RUN!', intensity: 'extra-base' };
    case 'triple': return { label: 'TRIPLE!', intensity: 'extra-base' };
    case 'double': return { label: 'DOUBLE!', intensity: 'extra-base' };
    case 'single': return { label: 'SINGLE!', intensity: 'normal' };
    case 'strikeout-swinging':
    case 'strikeout-looking':
      return { label: 'K!', intensity: 'normal' };
    case 'double-play': return { label: 'DOUBLE PLAY!', intensity: 'normal' };
    default: return null;
  }
};

const outsAddedFor = (outcome: AtBatOutcome): number => {
  switch (outcome) {
    case 'strikeout-looking':
    case 'strikeout-swinging':
    case 'groundout':
    case 'flyout':
    case 'lineout':
    case 'popout':
    case 'sac-fly':
    case 'sac-bunt':
      return 1;
    case 'double-play':
      return 2;
    case 'triple-play':
      return 3;
    case 'fielders-choice':
      return 1;
    default:
      return 0;
  }
};

const pickByPrimary = (
  index: ReadonlyMap<PlayerId, Player>,
  ids: readonly PlayerId[],
  pos: Player['primaryPosition'],
): Player | null => {
  for (const id of ids) {
    const p = index.get(id);
    if (p && p.primaryPosition === pos) return p;
  }
  return null;
};

export type { SceneContext };
