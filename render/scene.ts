import type { Player, PlayerId, StadiumId, TeamId } from '../world/types.js';
import type { AtBatOutcome, BallPath, GameInput, SimEvent } from '../sim/types.js';
import {
  HOME_PLATE,
  PITCHERS_MOUND,
  FIELDER_HOME_POSITIONS,
  baseFor,
  lerpPoint,
} from './field-geometry.js';
import type { FieldPoint, ScenePlayer, SceneState } from './types.js';

// =========================================================================
// buildScene — pure (events, simTime, ctx) → SceneState.
//
// The renderer holds NO state. Each frame it walks the prefix of the event
// log up to simTime and reconstructs what the field looks like. This is
// what CLAUDE.md means by "the renderer is a pure function of the log + tick."
// =========================================================================

// Sim time units are arbitrary integers (see /sim/game.ts). The renderer
// picks how long animation primitives last in those units.
const PITCH_FLIGHT_TICKS = 4;
const RUNNER_TRAVEL_TICKS_PER_BASE = 3;
const CONTACT_FLIGHT_TICKS = 14;

interface RunnerLatest {
  readonly from: 0 | 1 | 2 | 3;
  readonly to: 0 | 1 | 2 | 3;
  readonly out: boolean;
  readonly t: number;
}

interface SceneContext {
  readonly input: GameInput;
  readonly teamColors: ReadonlyMap<TeamId, { primary: string; secondary: string; accent: string }>;
  readonly teamAbbr: ReadonlyMap<TeamId, string>;
  readonly stadiumName: string;
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
  if (latest.out) {
    // Phase 2: thrown-out runners disappear instantly. Future polish: linger
    // briefly between bases as a "tagged out" sprite.
    return { runnerId, position: baseFor(latest.from), stillVisible: false };
  }
  const path = basePath(latest.from, latest.to);
  const totalDuration = (path.length - 1) * RUNNER_TRAVEL_TICKS_PER_BASE;
  const elapsed = simTime - latest.t;
  if (totalDuration <= 0 || elapsed >= totalDuration) {
    // Runner has fully arrived. Scoring (to=0) means they leave the field of view.
    if (latest.to === 0) return { runnerId, position: HOME_PLATE, stillVisible: false };
    return { runnerId, position: baseFor(latest.to), stillVisible: true };
  }
  if (elapsed <= 0) {
    return { runnerId, position: baseFor(latest.from), stillVisible: true };
  }
  const segmentLen = RUNNER_TRAVEL_TICKS_PER_BASE;
  const segIdx = Math.floor(elapsed / segmentLen);
  const segLocal = (elapsed % segmentLen) / segmentLen;
  const a = path[segIdx];
  const b = path[segIdx + 1];
  if (a === undefined || b === undefined) {
    return { runnerId, position: baseFor(latest.to), stillVisible: latest.to !== 0 };
  }
  return { runnerId, position: lerpPoint(baseFor(a), baseFor(b), segLocal), stillVisible: true };
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

  for (const ev of events) {
    if (ev.t > simTime) break;
    switch (ev.kind) {
      case 'gameStart':
        phase = 'live';
        break;
      case 'pitch': {
        currentBatterId = ev.batterId;
        // Track count progression per pitch result.
        const r = ev.pitch.result;
        if (r === 'ball') balls += 1;
        else if (r === 'called-strike' || r === 'swinging-strike') strikes += 1;
        else if (r === 'foul' && strikes < 2) strikes += 1;
        // hit-by-pitch / in-play / foul-tip-caught resolve at atBatEnd.
        lastPitch = { t: ev.t, outcomeKnown: r === 'in-play' };
        break;
      }
      case 'contact': {
        lastContact = { t: ev.t, path: ev.ballPath };
        break;
      }
      case 'baserunner': {
        runnerLatest.set(ev.runnerId, { from: ev.from, to: ev.to, out: ev.out, t: ev.t });
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
          }
        }
        break;
      }
      case 'atBatEnd': {
        const batter = currentBatterId ? ctx.input.playerIndex.get(currentBatterId) : null;
        const batterLast = batter ? batter.lastName : '';
        lastPlay = describeOutcome(ev.outcome, batterLast);
        // Outs from this PA (matches the sim's accounting).
        outs += outsAddedFor(ev.outcome);
        // Reset count for next batter.
        balls = 0;
        strikes = 0;
        currentBatterId = null;
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
        if (ev.halfInning === 'top') {
          half = 'bottom';
        } else {
          inning += 1;
          half = 'top';
        }
        break;
      }
      case 'gameEnd':
        phase = 'final';
        break;
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

  // Build fielders. Phase 1 only swaps the pitcher; the rest of the field
  // can use the side's starting lineup defense as a stand-in.
  const fieldingLineupIds =
    half === 'top' ? ctx.input.home.battingOrder : ctx.input.away.battingOrder;
  const fielders: ScenePlayer[] = [];
  // Pitcher first.
  if (pitcher) {
    fielders.push({
      id: pitcher.id,
      role: 'pitcher',
      position: fielderPositionFor('P'),
      primaryColor: fieldingColors.primary,
      secondaryColor: fieldingColors.secondary,
    });
  }
  // Catcher: pick first fielding lineup player whose primary is C, fall back to first slot.
  const catcherPlayer = pickByPrimary(ctx.input.playerIndex, fieldingLineupIds, 'C');
  const catcher: ScenePlayer | null = catcherPlayer
    ? {
        id: catcherPlayer.id,
        role: 'catcher',
        position: fielderPositionFor('C'),
        primaryColor: fieldingColors.primary,
        secondaryColor: fieldingColors.secondary,
      }
    : null;
  if (catcher) fielders.push(catcher);

  // Other 7 defensive positions, mapped from lineup primary positions.
  for (const pos of ['1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const) {
    const p = pickByPrimary(ctx.input.playerIndex, fieldingLineupIds, pos);
    if (!p) continue;
    fielders.push({
      id: p.id,
      role: 'fielder',
      position: fielderPositionFor(pos),
      primaryColor: fieldingColors.primary,
      secondaryColor: fieldingColors.secondary,
    });
  }

  // Batter sprite at the box.
  let batterScene: ScenePlayer | null = null;
  if (batter && phase === 'live') {
    const boxX = batter.bats === 'L' ? 3.5 : -3.5;
    batterScene = {
      id: batter.id,
      role: 'batter',
      position: { x: boxX, y: 1.5 },
      primaryColor: battingColors.primary,
      secondaryColor: battingColors.secondary,
    };
  }

  // Runners: for each occupied base (or scored runner still in motion), use latest event.
  const runners: ScenePlayer[] = [];
  // Note: the batter-as-runner appears here once a baserunner event fires for them.
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

  // Ball position.
  // Default: at the mound (idle).
  let ballPos: FieldPoint = PITCHERS_MOUND;
  let ballVisible = phase === 'live';

  // If a contact event is in flight, follow the trajectory.
  if (lastContact && (!lastPitch || lastContact.t >= lastPitch.t)) {
    const elapsed = simTime - lastContact.t;
    const frac = Math.max(0, Math.min(1, elapsed / CONTACT_FLIGHT_TICKS));
    ballPos = {
      x: lastContact.path.landingX * frac,
      y: lastContact.path.landingY * frac,
    };
    if (frac >= 1) ballVisible = false; // ball "settled"; renderer can hide
    else ballVisible = true;
  } else if (lastPitch) {
    const elapsed = simTime - lastPitch.t;
    const frac = Math.max(0, Math.min(1, elapsed / PITCH_FLIGHT_TICKS));
    ballPos = lerpPoint(PITCHERS_MOUND, HOME_PLATE, frac);
    ballVisible = true;
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
    pitcher: fielders.find((f) => f.role === 'pitcher') ?? null,
    batter: batterScene,
    catcher,
    fielders: fielders.filter((f) => f.role !== 'pitcher' && f.role !== 'catcher'),
    runners,
    ball: { position: ballPos, visible: ballVisible },
    lastPlay,
    homeTeamId: ctx.input.home.teamId,
    awayTeamId: ctx.input.away.teamId,
    stadiumId: ctx.input.stadiumId,
    stadiumName: ctx.stadiumName,
    homeAbbr: ctx.teamAbbr.get(ctx.input.home.teamId) ?? ctx.input.home.teamId,
    awayAbbr: ctx.teamAbbr.get(ctx.input.away.teamId) ?? ctx.input.away.teamId,
  };
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
