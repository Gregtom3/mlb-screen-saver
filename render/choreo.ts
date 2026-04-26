import type { Player, PlayerId } from '../world/types.js';
import type { AtBatOutcome, BallPath, SimEvent } from '../sim/types.js';
import {
  HOME_PLATE,
  FIRST_BASE,
  SECOND_BASE,
  THIRD_BASE,
  FIELDER_HOME_POSITIONS,
} from './field-geometry.js';
import type { FieldPoint } from './types.js';

// =========================================================================
// Per-contact play choreography.
//
// The /sim event log captures *what happened* (outcome, runner movements,
// ball trajectory) but not the moment-to-moment *visual timing* of how the
// play unfolds — when the fielder reaches the ball, when the throw goes,
// when each runner starts. The renderer synthesizes that timing here so
// every visual is grounded in the same canonical event log.
//
// The output is a Map<contactT, PlayChoreo>. A frame at simTime t looks up
// the most recent contact ≤ t, walks its choreo segments, and renders ball,
// fielder, and runner positions accordingly.
// =========================================================================

export type FielderPos = '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF';

const ALL_FIELDER_POSITIONS: readonly FielderPos[] = ['1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
const INFIELD_POSITIONS: readonly FielderPos[] = ['1B', '2B', '3B', 'SS'];
const OUTFIELD_POSITIONS: readonly FielderPos[] = ['LF', 'CF', 'RF'];

// Animation pacing — sim ticks ≈ seconds.
export const BALL_TIME_SCALE = 3; // visual flight is 3× physics
const FIELDING_PICKUP_TICKS = 6;
const THROW_TICKS = 8;
const RELAY_TICKS = 7; // 2B → 1B for the back end of a double play

interface BallSegment {
  readonly startT: number;
  readonly endT: number;
  readonly from: FieldPoint;
  readonly to: FieldPoint;
  readonly arc: 'parabola' | 'flat' | 'rolling';
  // Physics hangtime for parabola segments — used to scale z(t) to land at
  // the segment's end regardless of how much we stretch the visual duration.
  readonly physicsHangTimeSec?: number;
}

export interface PlayChoreo {
  readonly contactT: number;
  readonly endT: number;
  readonly ballSegments: readonly BallSegment[];
  // The fielder primarily handling the ball — moves from home toward landing
  // during the flight, holds during the pickup window.
  readonly primaryFielder?: {
    readonly playerId: PlayerId;
    readonly fielderPos: FielderPos;
    readonly fromPos: FieldPoint;
    readonly toPos: FieldPoint;
    readonly approachStartT: number;
    readonly approachEndT: number;
  };
  // Optional second fielder, used for double-play relay (covers 1B for the
  // back end of the throw).
  readonly relayFielder?: {
    readonly playerId: PlayerId;
    readonly fielderPos: FielderPos;
    readonly fromPos: FieldPoint;
    readonly toPos: FieldPoint;
    readonly startT: number;
    readonly endT: number;
  };
  // Per-runner overrides: when their motion starts and how long each base
  // segment takes. Keyed by runnerId. Runners not in the map use defaults.
  readonly runnerOverrides: ReadonlyMap<
    PlayerId,
    { readonly startT: number; readonly perBaseTicks: number }
  >;
}

const distSq = (a: FieldPoint, b: FieldPoint) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

const pickClosestFielder = (
  landing: FieldPoint,
  fielderIdsByPos: ReadonlyMap<FielderPos, PlayerId>,
  candidates: readonly FielderPos[],
): { pos: FielderPos; playerId: PlayerId; homePos: FieldPoint } => {
  let bestPos: FielderPos = candidates[0]!;
  let bestDist = Infinity;
  for (const pos of candidates) {
    const home = FIELDER_HOME_POSITIONS[pos];
    const d = distSq(landing, home);
    if (d < bestDist) {
      bestDist = d;
      bestPos = pos;
    }
  }
  const playerId = fielderIdsByPos.get(bestPos);
  if (!playerId) throw new Error(`No fielder at ${bestPos}`);
  return { pos: bestPos, playerId, homePos: FIELDER_HOME_POSITIONS[bestPos] };
};

const throwTargetFor = (outcome: AtBatOutcome): { base: 0 | 1 | 2 | 3; pos: FieldPoint } | null => {
  switch (outcome) {
    case 'groundout':
    case 'reached-on-error':
      return { base: 1, pos: FIRST_BASE };
    case 'fielders-choice':
    case 'double-play':
      return { base: 2, pos: SECOND_BASE };
    case 'sac-fly':
      return { base: 0, pos: HOME_PLATE };
    case 'single':
      return { base: 2, pos: SECOND_BASE };
    case 'double':
      return { base: 3, pos: THIRD_BASE };
    case 'triple':
      return { base: 3, pos: THIRD_BASE };
    // No throws — caught in air or out of play.
    case 'flyout':
    case 'lineout':
    case 'popout':
    case 'sac-bunt':
    case 'home-run':
    case 'triple-play':
      return null;
    // No contact:
    case 'walk':
    case 'hit-by-pitch':
    case 'strikeout-looking':
    case 'strikeout-swinging':
      return null;
  }
};

const baseFor = (b: 0 | 1 | 2 | 3): FieldPoint => {
  if (b === 0) return HOME_PLATE;
  if (b === 1) return FIRST_BASE;
  if (b === 2) return SECOND_BASE;
  return THIRD_BASE;
};

const isOutfieldHit = (landing: FieldPoint): boolean => landing.y > 130;
const isCaught = (outcome: AtBatOutcome): boolean =>
  outcome === 'flyout' ||
  outcome === 'lineout' ||
  outcome === 'popout' ||
  outcome === 'sac-fly';

interface BuildContext {
  readonly fielderIdsByPos: ReadonlyMap<FielderPos, PlayerId>;
}

const buildOneChoreo = (
  contactEvent: Extract<SimEvent, { kind: 'contact' }>,
  outcome: AtBatOutcome,
  baserunnerEvents: readonly Extract<SimEvent, { kind: 'baserunner' }>[],
  ctx: BuildContext,
): PlayChoreo => {
  const contactT = contactEvent.t;
  const path = contactEvent.ballPath;
  const landing: FieldPoint = { x: path.landingX, y: path.landingY };

  // Phase 1: ball in flight (parabola or rolling).
  const flightTicks = Math.max(3, path.hangTimeSec * BALL_TIME_SCALE);
  const flightEndT = contactT + flightTicks;

  // Phase 2: fielding window — ball at landing, fielder picking it up.
  const pickupEndT = flightEndT + FIELDING_PICKUP_TICKS;

  // Determine primary fielder.
  const candidates = isOutfieldHit(landing) ? OUTFIELD_POSITIONS : INFIELD_POSITIONS;
  const primary = pickClosestFielder(landing, ctx.fielderIdsByPos, candidates);

  // Throw target.
  const throwTarget = throwTargetFor(outcome);

  // Phase 3: throw to target base (if any).
  const segments: BallSegment[] = [];
  const flightSeg: BallSegment =
    path.launchAngleDeg > 0
      ? {
          startT: contactT,
          endT: flightEndT,
          from: HOME_PLATE,
          to: landing,
          arc: 'parabola',
          physicsHangTimeSec: path.hangTimeSec,
        }
      : {
          startT: contactT,
          endT: flightEndT,
          from: HOME_PLATE,
          to: landing,
          arc: 'rolling',
        };
  segments.push(flightSeg);

  let endT = pickupEndT;
  let relayFielder: PlayChoreo['relayFielder'];

  if (throwTarget) {
    // Throw segment.
    const throwEndT = pickupEndT + THROW_TICKS;
    segments.push({
      startT: pickupEndT,
      endT: throwEndT,
      from: landing,
      to: throwTarget.pos,
      arc: 'flat',
    });
    endT = throwEndT;

    // Double-play relay — second throw from 2B to 1B.
    if (outcome === 'double-play') {
      const relayStart = throwEndT;
      const relayEnd = relayStart + RELAY_TICKS;
      segments.push({
        startT: relayStart,
        endT: relayEnd,
        from: SECOND_BASE,
        to: FIRST_BASE,
        arc: 'flat',
      });
      const relayId = ctx.fielderIdsByPos.get('2B');
      if (relayId) {
        relayFielder = {
          playerId: relayId,
          fielderPos: '2B',
          fromPos: FIELDER_HOME_POSITIONS['2B'],
          toPos: SECOND_BASE,
          startT: pickupEndT - 2,
          endT: throwEndT,
        };
      }
      endT = relayEnd;
    }
  }

  // Fielder approach — start at contact, arrive when ball lands.
  const approachStartT = contactT;
  const approachEndT = isCaught(outcome)
    ? flightEndT // caught on the descent — fielder is at landing as ball arrives
    : Math.min(flightEndT, contactT + flightTicks);

  // Per-runner timing overrides.
  const runnerOverrides = new Map<
    PlayerId,
    { startT: number; perBaseTicks: number }
  >();
  for (const ev of baserunnerEvents) {
    let startT = contactT;
    const perBaseTicks = 7;
    // Sac fly: runner from 3rd waits for the catch to tag up.
    if (outcome === 'sac-fly' && ev.from === 3 && ev.to === 0) {
      startT = flightEndT;
    }
    // Caught fly with runners on base — they hold and don't move; their
    // sim baserunner events should not exist for non-tag-up cases. If they
    // do (e.g. defensive choices), keep at contact time.
    runnerOverrides.set(ev.runnerId, { startT, perBaseTicks });
  }

  return {
    contactT,
    endT,
    ballSegments: segments,
    primaryFielder: {
      playerId: primary.playerId,
      fielderPos: primary.pos,
      fromPos: primary.homePos,
      toPos: landing,
      approachStartT,
      approachEndT,
    },
    ...(relayFielder ? { relayFielder } : {}),
    runnerOverrides,
  };
};

// Walk the event log once and produce the per-contact map. For each
// contact event we look ahead to find the matching atBatEnd's outcome and
// collect the baserunner events that fired between them.
export const buildAllPlayChoreos = (
  events: readonly SimEvent[],
  fielderIdsByPosBySide: {
    readonly home: ReadonlyMap<FielderPos, PlayerId>;
    readonly away: ReadonlyMap<FielderPos, PlayerId>;
  },
): ReadonlyMap<number, PlayChoreo> => {
  const out = new Map<number, PlayChoreo>();
  let half: 'top' | 'bottom' = 'top';

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    if (ev.kind === 'inningEnd') {
      half = ev.halfInning === 'top' ? 'bottom' : 'top';
      continue;
    }
    if (ev.kind !== 'contact') continue;

    // Find the matching atBatEnd and any baserunner events between them.
    let outcome: AtBatOutcome | null = null;
    const baserunners: Extract<SimEvent, { kind: 'baserunner' }>[] = [];
    for (let j = i + 1; j < events.length; j++) {
      const inner = events[j]!;
      if (inner.kind === 'baserunner') baserunners.push(inner);
      else if (inner.kind === 'atBatEnd') {
        outcome = inner.outcome;
        break;
      } else if (inner.kind === 'inningEnd') {
        break;
      }
    }
    if (!outcome) continue;

    // Fielding side is opposite the batting side.
    const fieldingSide = half === 'top' ? 'home' : 'away';
    const fielderIds = fielderIdsByPosBySide[fieldingSide];

    out.set(
      ev.t,
      buildOneChoreo(ev, outcome, baserunners, { fielderIdsByPos: fielderIds }),
    );
  }
  return out;
};

// Compute ball position + altitude at simTime given a choreo.
export const ballStateForChoreo = (
  choreo: PlayChoreo,
  simTime: number,
): { position: FieldPoint; heightFt: number; visible: boolean; inFlight: boolean } | null => {
  if (simTime < choreo.contactT) return null;
  if (simTime >= choreo.endT) {
    return null;
  }
  for (const seg of choreo.ballSegments) {
    if (simTime < seg.startT) {
      // Between segments — ball is at the previous segment's `to` point,
      // sitting in the fielder's hands during pickup.
      return {
        position: seg.from,
        heightFt: 0,
        visible: true,
        inFlight: false,
      };
    }
    if (simTime <= seg.endT) {
      const dur = seg.endT - seg.startT;
      const frac = dur > 0 ? Math.min(1, (simTime - seg.startT) / dur) : 1;
      const pos: FieldPoint = {
        x: seg.from.x + (seg.to.x - seg.from.x) * frac,
        y: seg.from.y + (seg.to.y - seg.from.y) * frac,
      };
      let heightFt = 0;
      if (seg.arc === 'parabola' && seg.physicsHangTimeSec) {
        const G = 32.2;
        const vZ = (G * seg.physicsHangTimeSec) / 2;
        const physicsElapsed = (frac * seg.physicsHangTimeSec); // map visual frac to physics time
        heightFt = Math.max(0, vZ * physicsElapsed - 0.5 * G * physicsElapsed * physicsElapsed);
      } else if (seg.arc === 'flat') {
        // Throws have a small arc.
        heightFt = 8 * Math.sin(frac * Math.PI);
      }
      return {
        position: pos,
        heightFt,
        visible: true,
        inFlight: seg.arc !== 'rolling' || frac < 1,
      };
    }
  }
  return null;
};

// Compute the primary fielder's position at simTime.
export const primaryFielderPositionAtTime = (
  choreo: PlayChoreo,
  simTime: number,
): FieldPoint | null => {
  if (!choreo.primaryFielder) return null;
  const f = choreo.primaryFielder;
  if (simTime <= f.approachStartT) return f.fromPos;
  if (simTime >= f.approachEndT) {
    // After approach: fielder stays at toPos until the play resolves, then
    // returns to home. Simple: stay at toPos for the remainder of the play.
    return f.toPos;
  }
  const dur = f.approachEndT - f.approachStartT;
  const frac = dur > 0 ? (simTime - f.approachStartT) / dur : 1;
  return {
    x: f.fromPos.x + (f.toPos.x - f.fromPos.x) * frac,
    y: f.fromPos.y + (f.toPos.y - f.fromPos.y) * frac,
  };
};

export const relayFielderPositionAtTime = (
  choreo: PlayChoreo,
  simTime: number,
): FieldPoint | null => {
  const f = choreo.relayFielder;
  if (!f) return null;
  if (simTime <= f.startT) return f.fromPos;
  if (simTime >= f.endT) return f.toPos;
  const dur = f.endT - f.startT;
  const frac = dur > 0 ? (simTime - f.startT) / dur : 1;
  return {
    x: f.fromPos.x + (f.toPos.x - f.fromPos.x) * frac,
    y: f.fromPos.y + (f.toPos.y - f.fromPos.y) * frac,
  };
};

export const buildFielderIdsByPos = (
  battingOrder: readonly PlayerId[],
  startingPitcherId: PlayerId,
  playerIndex: ReadonlyMap<PlayerId, Player>,
): ReadonlyMap<FielderPos, PlayerId> => {
  // Pull each defensive position's player from the lineup. The starting
  // pitcher fills P (not used for batted-ball fielding here).
  const out = new Map<FielderPos, PlayerId>();
  for (const pos of ALL_FIELDER_POSITIONS) {
    for (const id of battingOrder) {
      const p = playerIndex.get(id);
      if (p && p.primaryPosition === pos) {
        out.set(pos, id);
        break;
      }
    }
  }
  // Fallbacks: if a position has no primary, leave it empty — pickClosest
  // throws if its candidate set is empty, but candidate sets always include
  // multiple positions so at least one will be filled.
  void startingPitcherId;
  return out;
};
