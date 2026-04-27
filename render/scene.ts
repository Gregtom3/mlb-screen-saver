import type { Player, PlayerId, StadiumId, TeamId } from '../world/types.js';
import type { AtBatOutcome, BallPath, GameInput, SimEvent } from '../sim/types.js';
import {
  HOME_PLATE,
  PITCHERS_MOUND,
  FIELDER_HOME_POSITIONS,
  baseFor,
  lerpPoint,
} from './field-geometry.js';
import type {
  BatterCardStats,
  BigPlayInfo,
  FieldPoint,
  InningTransitionInfo,
  PitcherCardStats,
  RunScoredPopup,
  SceneLineScore,
  ScenePlayer,
  SceneState,
  VictoryCelebration,
} from './types.js';
import { buildBoxScore } from '../sim/box-score.js';
import {
  buildAllPlayChoreos,
  buildFielderIdsByPos,
  ballStateForChoreo,
  fielderPositionForChoreo,
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
const PITCH_FLIGHT_TICKS = 4 * BALL_TIME_SCALE;        // mound→plate ball flight
const RUNNER_TRAVEL_TICKS_PER_BASE = 7; // ~7 sim sec/base — pleasant screensaver pace, slower than real-time
// Grounders need a small extra rolling tail for readability.
const GROUNDER_EXTRA_TICKS = 0.5 * BALL_TIME_SCALE;

interface RunnerLatest {
  readonly from: 0 | 1 | 2 | 3;
  readonly to: 0 | 1 | 2 | 3;
  readonly out: boolean;
  readonly t: number;
  readonly perBaseTicks: number;
}

// How long an out runner lingers — walking off toward the dugout — after
// they reach the base where they were retired. Long enough to read clearly,
// short enough to clear before the next pitch.
const WALK_OFF_TICKS = 24;
// Lifetime of the "+1" run-scored popup at home plate. Slightly longer
// than the big-play popup so a stack of multiple runs (grand slam) all
// get to float up and fade before the next pitch lands.
const RUN_SCORED_POPUP_TICKS = 18;
// Two stylized dugouts — runners head to the side closer to where they
// were retired (1B-side for righty grounders, 3B-side for lefty / triples).
const DUGOUT_RIGHT: FieldPoint = { x: 75, y: -22 };
const DUGOUT_LEFT: FieldPoint = { x: -75, y: -22 };

// Inning transition pacing. The walk-off starts in the dead time after the
// 3rd-out play choreo settles and runs up to the inningEnd event; the
// walk-on runs from inningEnd up until just before the next half-inning's
// first pitch (which fires at inningEnd.t + TIME_PITCH = 25 in sim time).
const INNING_WALK_OFF_TICKS = 14;
const INNING_WALK_ON_TICKS = 18;

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

const computeRunnerRender = (latest: RunnerLatest, simTime: number, runnerId: PlayerId): RunnerRender => {
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
    const dugout = arrivedAt.x >= 0 ? DUGOUT_RIGHT : DUGOUT_LEFT;
    return { runnerId, position: lerpPoint(arrivedAt, dugout, frac), stillVisible: true };
  }

  // Safe — stays at base. Scoring runners leave the field.
  if (latest.to === 0) return { runnerId, position: HOME_PLATE, stillVisible: false };
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

interface PitchInProgress {
  readonly t: number;
  readonly outcomeKnown: boolean;
  // Whether this pitch was actually swung at — drives the bat-swing animation.
  // Take pitches (ball / called-strike / hit-by-pitch) shouldn't move the bat.
  readonly wasSwing: boolean;
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

  let lastPitch: PitchInProgress | null = null;
  let lastContact: ContactInProgress | null = null;
  let lastContactT: number | null = null; // for choreo lookup
  let lastBigPlay: BigPlayInfo | null = null;
  const runsScoredPopups: RunScoredPopup[] = [];

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
        currentBatterId = ev.batterId;
        const r = ev.pitch.result;
        if (r === 'ball') balls += 1;
        else if (r === 'called-strike' || r === 'swinging-strike') strikes += 1;
        else if (r === 'foul' && strikes < 2) strikes += 1;
        const wasSwing =
          r === 'swinging-strike' ||
          r === 'foul' ||
          r === 'foul-tip-caught' ||
          r === 'in-play';
        lastPitch = { t: ev.t, outcomeKnown: r === 'in-play', wasSwing };
        break;
      }
      case 'contact': {
        lastContact = { t: ev.t, path: ev.ballPath };
        lastContactT = ev.t;
        break;
      }
      case 'baserunner': {
        // Use choreo override start-time + per-base pace if available —
        // handles sac-fly tag-ups and pace-matches force-out runners to the
        // throw arrival so the "out" reads correctly.
        const choreo = lastContactT !== null ? choreos.get(lastContactT) : undefined;
        const override = choreo?.runnerOverrides.get(ev.runnerId);
        const startT = override?.startT ?? ev.t;
        const perBaseTicks = override?.perBaseTicks ?? RUNNER_TRAVEL_TICKS_PER_BASE;
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
  if (gameEnd === null) {
    if (
      upcomingInningEnd !== null &&
      upcomingInningEnd - simTime <= INNING_WALK_OFF_TICKS &&
      upcomingInningEnd - simTime >= 0
    ) {
      const progress =
        1 - (upcomingInningEnd - simTime) / INNING_WALK_OFF_TICKS;
      inningTransition = { phase: 'walk-off', progress };
    } else if (
      lastInningEnd !== null &&
      simTime - lastInningEnd.t <= INNING_WALK_ON_TICKS &&
      simTime - lastInningEnd.t >= 0
    ) {
      const progress = (simTime - lastInningEnd.t) / INNING_WALK_ON_TICKS;
      inningTransition = { phase: 'walk-on', progress };
    }
  }

  // Pull a possibly-overridden position for the given fielder. Used uniformly
  // for pitcher, catcher, and the seven position players so any of them can
  // be choreographed (e.g. pitcher covering 1B, catcher in front of plate),
  // or — during the inning gap — sent on or off the field along a straight
  // path to the nearest dugout.
  const fielderPosFor = (
    playerId: string,
    homePos: FieldPoint,
  ): FieldPoint => {
    if (inningTransition) {
      const dugout = homePos.x >= 0 ? DUGOUT_RIGHT : DUGOUT_LEFT;
      const eased = easeInOut(inningTransition.progress);
      if (inningTransition.phase === 'walk-off') {
        return lerpPoint(homePos, dugout, eased);
      }
      return lerpPoint(dugout, homePos, eased);
    }
    if (!choreoActive || !activeChoreo) return homePos;
    const overridden = fielderPositionForChoreo(activeChoreo, simTime, playerId);
    return overridden ?? homePos;
  };

  // Build fielders.
  const fieldingLineupIds =
    half === 'top' ? ctx.input.home.battingOrder : ctx.input.away.battingOrder;
  const fielders: ScenePlayer[] = [];
  if (pitcher) {
    fielders.push({
      id: pitcher.id,
      role: 'pitcher',
      position: fielderPosFor(pitcher.id, fielderPositionFor('P')),
      primaryColor: fieldingColors.primary,
      secondaryColor: fieldingColors.secondary,
    });
  }
  const catcherPlayer = pickByPrimary(ctx.input.playerIndex, fieldingLineupIds, 'C');
  const catcher: ScenePlayer | null = catcherPlayer
    ? {
        id: catcherPlayer.id,
        role: 'catcher',
        position: fielderPosFor(catcherPlayer.id, fielderPositionFor('C')),
        primaryColor: fieldingColors.primary,
        secondaryColor: fieldingColors.secondary,
      }
    : null;
  if (catcher) fielders.push(catcher);

  for (const pos of ['1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const) {
    const p = pickByPrimary(ctx.input.playerIndex, fieldingLineupIds, pos);
    if (!p) continue;
    fielders.push({
      id: p.id,
      role: 'fielder',
      position: fielderPosFor(p.id, fielderPositionFor(pos)),
      primaryColor: fieldingColors.primary,
      secondaryColor: fieldingColors.secondary,
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
  let batterScene: ScenePlayer | null = null;
  if (batter && phase === 'live' && !batterIsRunner && !fieldIsClearOfBatter) {
    const boxX = batter.bats === 'L' ? 4.5 : -4.5;
    let swingFrac = 0;
    if (lastPitch && lastPitch.wasSwing) {
      const elapsed = simTime - lastPitch.t;
      const swingStartT = PITCH_FLIGHT_TICKS * 0.55;
      const swingEndT = PITCH_FLIGHT_TICKS * 0.95;
      if (elapsed > swingStartT && elapsed < swingEndT + 4) {
        swingFrac = Math.max(
          0,
          Math.min(1, (elapsed - swingStartT) / (swingEndT - swingStartT)),
        );
      }
    }
    batterScene = {
      id: batter.id,
      role: 'batter',
      position: { x: boxX, y: 2.5 },
      primaryColor: battingColors.primary,
      secondaryColor: battingColors.secondary,
      swingFrac,
    };
  }

  // Runners: for each occupied base (or scored runner still in motion), use latest event.
  // Hidden during inning transitions (the half cleared its bases on inningEnd
  // anyway) and once the game's over (the high-five line owns the screen).
  const runners: ScenePlayer[] = [];
  // Note: the batter-as-runner appears here once a baserunner event fires for them.
  if (inningTransition === null && gameEnd === null) {
    for (const [runnerId, latest] of runnerLatest) {
      const render = computeRunnerRender(latest, simTime, runnerId);
      if (!render.stillVisible) continue;
      runners.push({
        id: runnerId,
        role: 'runner',
        position: render.position,
        primaryColor: battingColors.primary,
        secondaryColor: battingColors.secondary,
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
    const elapsed = simTime - lastPitch.t;
    const frac = Math.max(0, Math.min(1, elapsed / PITCH_FLIGHT_TICKS));
    ballPos = lerpPoint(PITCHERS_MOUND, HOME_PLATE, frac);
    // A pitch arcs slightly. Peak ~6 ft mid-flight.
    ballHeight = 6 * Math.sin(frac * Math.PI);
    ballVisible = true;
    ballInFlight = frac > 0 && frac < 1;
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

      const linePlayers: ScenePlayer[] = [];
      for (let i = 0; i < winnerIds.length; i++) {
        const pid = winnerIds[i]!;
        const linePos = VICTORY_LINE_POSITIONS[i] ?? VICTORY_LINE_POSITIONS[0]!;
        const dugout = linePos.x >= 0 ? DUGOUT_RIGHT : DUGOUT_LEFT;
        const pos = lerpPoint(dugout, linePos, walkInEased);
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
        });
      }
      displayPitcher = linePlayers[0] ?? null;
      displayCatcher = linePlayers[1] ?? null;
      displayFielders = linePlayers.slice(2);
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
    ball: { position: ballPos, heightFt: ballHeight, visible: ballVisible, inFlight: ballInFlight },
    lastPlay,
    homeTeamId: ctx.input.home.teamId,
    awayTeamId: ctx.input.away.teamId,
    stadiumId: ctx.input.stadiumId,
    stadiumName: ctx.stadiumName,
    homeAbbr: ctx.teamAbbr.get(ctx.input.home.teamId) ?? ctx.input.home.teamId,
    awayAbbr: ctx.teamAbbr.get(ctx.input.away.teamId) ?? ctx.input.away.teamId,
    batterStats,
    pitcherStats,
    onDeckBatterId,
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
