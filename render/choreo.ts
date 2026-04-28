import type { Player, PlayerId } from '../world/types.js';
import type { AtBatOutcome, SimEvent } from '../sim/types.js';
import {
  HOME_PLATE,
  FIRST_BASE,
  SECOND_BASE,
  THIRD_BASE,
  FIELDER_HOME_POSITIONS,
  PITCHERS_MOUND,
} from './field-geometry.js';
import type { FieldPoint } from './types.js';

// =========================================================================
// Per-contact play choreography.
//
// Synthesizes a richer visualization on top of the canonical SimEvent log:
//   - which fielder fields the ball
//   - which fielder COVERS the throw target base
//   - ball trajectory: home → landing → fielder pickup → throw to base →
//     (relay if DP) → throw back to the mound
//   - timed fielder motions: approach, hold at base, return home
//   - per-runner start times so sac-fly tag-ups wait for the catch
//
// Determinism is preserved — choreo is a pure function of the event log.
// =========================================================================

export type FielderPos = 'P' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF';

const ALL_FIELDER_POSITIONS: readonly FielderPos[] = [
  'P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF',
];
// Catcher is included so dribblers and tappers in front of the plate get
// fielded by C — the pitcher otherwise wins the closest-fielder lookup
// for anything landing within ~30 ft of home, since none of the corner
// infielders are positioned that shallow.
const INFIELD_PRIMARY: readonly FielderPos[] = ['1B', '2B', '3B', 'SS', 'P', 'C'];
const OUTFIELD_PRIMARY: readonly FielderPos[] = ['LF', 'CF', 'RF'];

// =========== Pacing constants (sim ticks ≈ seconds) =====================

export const BALL_TIME_SCALE = 6;     // visual ball flight is 6× the physics
const FIELDING_PICKUP_TICKS = 8;       // fielder cradles ball + winds up
const THROW_TICKS = 10;                // throw to a base
const RELAY_TICKS = 8;                 // 2B → 1B for DP back end
const RETURN_TO_MOUND_TICKS = 12;      // ball back to pitcher
const POST_PLAY_HOLD_TICKS = 12;       // visual settle pause so the result sinks in
const FIELDER_TRAVEL_LEAD_TICKS = 4;   // coverer arrives at base before ball
const FIELDER_RETURN_TICKS = 14;       // back to home

// =========== Coverage map ==============================================

// Per-base coverage priority. The first available position who isn't already
// the primary fielder (and isn't already used as the relay coverer) covers
// the bag. Pitcher is included for 1B coverage (3-1 / 1-3 putouts).
const COVERAGE: Record<0 | 1 | 2 | 3, readonly FielderPos[]> = {
  0: ['C'],
  1: ['1B', '2B', 'P', '3B'],
  2: ['2B', 'SS'],
  3: ['3B', 'SS'],
};

// =========== Public types ==============================================

interface BallSegment {
  readonly startT: number;
  readonly endT: number;
  readonly from: FieldPoint;
  readonly to: FieldPoint;
  readonly arc: 'parabola' | 'flat' | 'rolling' | 'low-throw';
  readonly physicsHangTimeSec?: number;
}

export interface FielderRole {
  readonly playerId: PlayerId;
  readonly fielderPos: FielderPos;
  readonly fromPos: FieldPoint;
  readonly toPos: FieldPoint;
  readonly approachStartT: number;
  readonly approachEndT: number;
  readonly returnStartT: number;
  readonly returnEndT: number;
}

export interface PlayChoreo {
  readonly contactT: number;
  // Action ends — last ball segment finishes. Used for runner tag-up timing.
  readonly actionEndT: number;
  // Choreo end including post-play settle. Renderer holds visuals stable
  // until this point so the viewer can read the result before next pitch.
  readonly endT: number;
  readonly ballSegments: readonly BallSegment[];
  readonly fielderRoles: readonly FielderRole[]; // primary, coverer(s)
  readonly runnerOverrides: ReadonlyMap<
    PlayerId,
    { readonly startT: number; readonly perBaseTicks: number }
  >;
}

// =========== Helpers ====================================================

const distSq = (a: FieldPoint, b: FieldPoint) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const lerp = (a: FieldPoint, b: FieldPoint, t: number): FieldPoint => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

const baseFor = (b: 0 | 1 | 2 | 3): FieldPoint => {
  if (b === 0) return HOME_PLATE;
  if (b === 1) return FIRST_BASE;
  if (b === 2) return SECOND_BASE;
  return THIRD_BASE;
};

// Decide whether the primary fielder should be an outfielder. For explicit
// hits (single/double/triple), the ball got past the infield by definition,
// so prefer outfield candidates — the lone exception is a legit infield
// single whose ball stays in the dirt. For outs and other contact, use the
// classic geometric cutoff.
const isOutfieldHit = (landing: FieldPoint, outcome: AtBatOutcome): boolean => {
  if (outcome === 'double' || outcome === 'triple') return true;
  if (outcome === 'single') return landing.y > 100;
  return landing.y > 130;
};
const isCaughtInAir = (outcome: AtBatOutcome): boolean =>
  outcome === 'flyout' ||
  outcome === 'lineout' ||
  outcome === 'popout' ||
  outcome === 'sac-fly';

const findPositionForPlayer = (
  fielderIdsByPos: ReadonlyMap<FielderPos, PlayerId>,
  playerId: PlayerId,
): FielderPos | null => {
  for (const [pos, id] of fielderIdsByPos) {
    if (id === playerId) return pos;
  }
  return null;
};

const pickClosestFielder = (
  landing: FieldPoint,
  fielderIdsByPos: ReadonlyMap<FielderPos, PlayerId>,
  candidates: readonly FielderPos[],
): { pos: FielderPos; playerId: PlayerId; homePos: FieldPoint } => {
  let bestPos: FielderPos | null = null;
  let bestDist = Infinity;
  for (const pos of candidates) {
    if (!fielderIdsByPos.has(pos)) continue;
    const home = FIELDER_HOME_POSITIONS[pos];
    const d = distSq(landing, home);
    if (d < bestDist) {
      bestDist = d;
      bestPos = pos;
    }
  }
  if (!bestPos) {
    // Fallback: take the first candidate that exists.
    for (const pos of candidates) {
      if (fielderIdsByPos.has(pos)) {
        bestPos = pos;
        break;
      }
    }
  }
  if (!bestPos) throw new Error(`pickClosestFielder: no available fielder`);
  return {
    pos: bestPos,
    playerId: fielderIdsByPos.get(bestPos)!,
    homePos: FIELDER_HOME_POSITIONS[bestPos],
  };
};

const pickCoverer = (
  base: 0 | 1 | 2 | 3,
  fielderIdsByPos: ReadonlyMap<FielderPos, PlayerId>,
  excludePositions: ReadonlySet<FielderPos>,
): { pos: FielderPos; playerId: PlayerId; homePos: FieldPoint } | null => {
  for (const pos of COVERAGE[base]) {
    if (excludePositions.has(pos)) continue;
    const playerId = fielderIdsByPos.get(pos);
    if (playerId) {
      return { pos, playerId, homePos: FIELDER_HOME_POSITIONS[pos] };
    }
  }
  // Fallback: any covering position even if also excluded (e.g., DP odd cases).
  for (const pos of COVERAGE[base]) {
    const playerId = fielderIdsByPos.get(pos);
    if (playerId) {
      return { pos, playerId, homePos: FIELDER_HOME_POSITIONS[pos] };
    }
  }
  return null;
};

const throwTargetFor = (outcome: AtBatOutcome): { base: 0 | 1 | 2 | 3 } | null => {
  switch (outcome) {
    case 'groundout':
    case 'reached-on-error':
      return { base: 1 };
    case 'fielders-choice':
    case 'double-play':
      return { base: 2 };
    case 'sac-fly':
      return { base: 0 };
    case 'single':
      return { base: 2 };
    case 'double':
      return { base: 3 };
    case 'triple':
      return { base: 3 };
    case 'flyout':
    case 'lineout':
    case 'popout':
    case 'sac-bunt':
    case 'home-run':
    case 'triple-play':
    case 'walk':
    case 'hit-by-pitch':
    case 'strikeout-looking':
    case 'strikeout-swinging':
      return null;
  }
};

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

  const flightTicks = Math.max(6, path.hangTimeSec * BALL_TIME_SCALE);
  const flightEndT = contactT + flightTicks;

  // Primary fielder — the one who fields the ball.
  //
  // The sim stamps `fielderId` onto the contact event for outs that involve
  // fielding (groundouts / popouts / flyouts / lineouts / sac-flies / etc.)
  // using its spray-band geometry. Honor that when present — it's the
  // canonical answer. Falling back to a Cartesian-closest heuristic gives
  // the pitcher (mound at y≈60ft) almost every grounder up the middle
  // because the actual middle infielders sit deeper at y≈118ft.
  //
  // For hits (single / double / triple) the sim doesn't stamp a fielder —
  // the closest-fielder geometry still picks the right outfielder, and the
  // rare infield single naturally lands close to an infielder home.
  const stamped = contactEvent.fielderId;
  const stampedPos =
    stamped !== undefined ? findPositionForPlayer(ctx.fielderIdsByPos, stamped) : null;
  const primary =
    stamped !== undefined && stampedPos !== null
      ? { pos: stampedPos, playerId: stamped, homePos: FIELDER_HOME_POSITIONS[stampedPos] }
      : pickClosestFielder(
          landing,
          ctx.fielderIdsByPos,
          isOutfieldHit(landing, outcome) ? OUTFIELD_PRIMARY : INFIELD_PRIMARY,
        );

  const segments: BallSegment[] = [];
  const fielderRoles: FielderRole[] = [];
  const usedPositions = new Set<FielderPos>([primary.pos]);

  // Phase 1: ball flight to landing.
  if (path.launchAngleDeg > 0) {
    segments.push({
      startT: contactT,
      endT: flightEndT,
      from: HOME_PLATE,
      to: landing,
      arc: 'parabola',
      physicsHangTimeSec: path.hangTimeSec,
    });
  } else {
    segments.push({
      startT: contactT,
      endT: flightEndT,
      from: HOME_PLATE,
      to: landing,
      arc: 'rolling',
    });
  }

  // For caught-in-air outcomes (flyouts, popouts, lineouts, sac-flies), the
  // primary fielder catches the ball IN THE AIR — there's no on-ground pickup.
  // Otherwise, ball sits at landing during a pickup window.
  const caught = isCaughtInAir(outcome);
  const pickupEndT = caught ? flightEndT : flightEndT + FIELDING_PICKUP_TICKS;

  // Phase 2: throws.
  let actionEndT = pickupEndT;
  const throwTarget = throwTargetFor(outcome);
  let lastBallPos: FieldPoint = landing;
  let finalCoverer: { pos: FielderPos; playerId: PlayerId; homePos: FieldPoint } | null = null;

  if (throwTarget) {
    // Pick the coverer for this base.
    const coverer = pickCoverer(throwTarget.base, ctx.fielderIdsByPos, usedPositions);
    if (coverer) {
      usedPositions.add(coverer.pos);
      finalCoverer = coverer;
      // Coverer movement: arrive at the base just before the throw arrives.
      const throwStartT = pickupEndT;
      const throwEndT = throwStartT + THROW_TICKS;
      const coverArrive = throwEndT - FIELDER_TRAVEL_LEAD_TICKS;
      fielderRoles.push({
        playerId: coverer.playerId,
        fielderPos: coverer.pos,
        fromPos: coverer.homePos,
        toPos: baseFor(throwTarget.base),
        approachStartT: contactT,
        approachEndT: coverArrive,
        returnStartT: throwEndT + 4,
        returnEndT: throwEndT + 4 + FIELDER_RETURN_TICKS,
      });
      // Ball segment for the throw.
      segments.push({
        startT: throwStartT,
        endT: throwEndT,
        from: landing,
        to: baseFor(throwTarget.base),
        arc: 'flat',
      });
      lastBallPos = baseFor(throwTarget.base);
      actionEndT = throwEndT;

      // DP relay: 2B → 1B. The 2B coverer (who just caught the force throw)
      // throws to a 1B coverer.
      if (outcome === 'double-play') {
        const relayCoverer = pickCoverer(1, ctx.fielderIdsByPos, usedPositions);
        if (relayCoverer) {
          usedPositions.add(relayCoverer.pos);
          finalCoverer = relayCoverer;
          const relayStartT = throwEndT;
          const relayEndT = relayStartT + RELAY_TICKS;
          const relayArrive = relayEndT - FIELDER_TRAVEL_LEAD_TICKS;
          fielderRoles.push({
            playerId: relayCoverer.playerId,
            fielderPos: relayCoverer.pos,
            fromPos: relayCoverer.homePos,
            toPos: FIRST_BASE,
            approachStartT: contactT,
            approachEndT: relayArrive,
            returnStartT: relayEndT + 4,
            returnEndT: relayEndT + 4 + FIELDER_RETURN_TICKS,
          });
          segments.push({
            startT: relayStartT,
            endT: relayEndT,
            from: SECOND_BASE,
            to: FIRST_BASE,
            arc: 'flat',
          });
          lastBallPos = FIRST_BASE;
          actionEndT = relayEndT;
        }
      }
    }
  }

  // Phase 3: ball back to the mound (skip on HR — ball is gone).
  if (outcome !== 'home-run') {
    const returnStartT = actionEndT + 2;
    const returnEndT = returnStartT + RETURN_TO_MOUND_TICKS;
    segments.push({
      startT: returnStartT,
      endT: returnEndT,
      from: lastBallPos,
      to: PITCHERS_MOUND,
      arc: 'low-throw',
    });
    actionEndT = returnEndT;
  }

  // Primary fielder role — approach + hold + return.
  // Caught-in-air: arrives at landing just as ball does. HOME RUNS skip
  // this entirely: the ball is over the fence, no one chases it. Without
  // this guard, the primary fielder would jog over the wall trying to
  // catch a HR, which the user (correctly) flagged as silly.
  if (outcome !== 'home-run') {
    fielderRoles.push({
      playerId: primary.playerId,
      fielderPos: primary.pos,
      fromPos: primary.homePos,
      toPos: landing,
      approachStartT: contactT,
      approachEndT: flightEndT,
      returnStartT: pickupEndT + 4,
      returnEndT: pickupEndT + 4 + FIELDER_RETURN_TICKS,
    });
  }

  // Per-runner timing overrides. Out runners get a slower pace so their
  // arrival roughly coincides with the throw (otherwise they'd look obviously
  // safe and the "out" wouldn't read). Safe runners use a brisker default.
  const runnerOverrides = new Map<
    PlayerId,
    { startT: number; perBaseTicks: number }
  >();
  // Throw arrival timing — used to pace out runners so they reach the bag
  // about when the ball does.
  const firstThrowArrival = pickupEndT + THROW_TICKS; // when ball arrives at first throw target
  const relayArrival = firstThrowArrival + RELAY_TICKS; // DP back-end
  const SAFE_PER_BASE = 9;
  for (const ev of baserunnerEvents) {
    let startT = contactT;
    let perBaseTicks = SAFE_PER_BASE;
    if (outcome === 'sac-fly' && ev.from === 3 && ev.to === 0) {
      startT = flightEndT;
    }
    if (ev.out) {
      // Pace this runner so they "arrive" at their out base around the time
      // the relevant throw arrives. For DP back end (batter to 1B), the
      // relevant throw is the relay; for the lead force at 2B, it's the
      // first throw.
      const baseDistance = Math.max(1, Math.abs(ev.to - ev.from));
      const targetArrivalT =
        outcome === 'double-play' && ev.from === 0
          ? relayArrival
          : firstThrowArrival;
      const totalDuration = Math.max(SAFE_PER_BASE, targetArrivalT - startT);
      perBaseTicks = Math.round(totalDuration / baseDistance);
    }
    runnerOverrides.set(ev.runnerId, { startT, perBaseTicks });
  }

  // End of choreo: action complete + a settle hold so the viewer reads the play.
  const endT = actionEndT + POST_PLAY_HOLD_TICKS;

  return {
    contactT,
    actionEndT,
    endT,
    ballSegments: segments,
    fielderRoles,
    runnerOverrides,
  };
};

// Walk the event log once, build a Map<contactT, PlayChoreo>. Tracks
// half-inning + active pitcher per side so coverer/fielder lookups use the
// correct side's defense.
export const buildAllPlayChoreos = (
  events: readonly SimEvent[],
  fielderIdsByPosBySide: {
    readonly home: ReadonlyMap<FielderPos, PlayerId>;
    readonly away: ReadonlyMap<FielderPos, PlayerId>;
  },
): ReadonlyMap<number, PlayChoreo> => {
  const out = new Map<number, PlayChoreo>();
  let half: 'top' | 'bottom' = 'top';
  // Mutable copies so a mid-game pitching change updates the 'P' slot —
  // otherwise a relief pitcher's contact-event fielderId wouldn't resolve
  // back to a position in the map.
  const fielderIdsBySide = {
    home: new Map(fielderIdsByPosBySide.home),
    away: new Map(fielderIdsByPosBySide.away),
  };

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    if (ev.kind === 'inningEnd') {
      half = ev.halfInning === 'top' ? 'bottom' : 'top';
      continue;
    }
    if (ev.kind === 'sub') {
      // Phase 1 only emits subs for pitching changes. The fielding side is
      // home in the top of the inning, away in the bottom.
      const fieldingSide = half === 'top' ? 'home' : 'away';
      fielderIdsBySide[fieldingSide].set('P', ev.inPlayerId);
      continue;
    }
    if (ev.kind !== 'contact') continue;

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

    const fieldingSide = half === 'top' ? 'home' : 'away';
    const fielderIds = fielderIdsBySide[fieldingSide];
    out.set(ev.t, buildOneChoreo(ev, outcome, baserunners, { fielderIdsByPos: fielderIds }));
  }
  return out;
};

// =========== Per-frame queries =========================================

export const ballStateForChoreo = (
  choreo: PlayChoreo,
  simTime: number,
): { position: FieldPoint; heightFt: number; visible: boolean; inFlight: boolean } | null => {
  if (simTime < choreo.contactT) return null;
  if (simTime >= choreo.endT) return null;

  // Walk segments in order. Between segments the ball is held at the
  // previous segment's `to` point (fielder cradling, batter taking position).
  let prevTo: FieldPoint | null = null;
  for (const seg of choreo.ballSegments) {
    if (simTime < seg.startT) {
      if (prevTo) {
        return { position: prevTo, heightFt: 0, visible: true, inFlight: false };
      }
      return { position: seg.from, heightFt: 0, visible: true, inFlight: false };
    }
    if (simTime <= seg.endT) {
      const dur = seg.endT - seg.startT;
      const frac = dur > 0 ? Math.min(1, (simTime - seg.startT) / dur) : 1;
      const pos = lerp(seg.from, seg.to, frac);
      let heightFt = 0;
      if (seg.arc === 'parabola' && seg.physicsHangTimeSec) {
        const G = 32.2;
        const vZ = (G * seg.physicsHangTimeSec) / 2;
        const physicsElapsed = frac * seg.physicsHangTimeSec;
        heightFt = Math.max(0, vZ * physicsElapsed - 0.5 * G * physicsElapsed * physicsElapsed);
      } else if (seg.arc === 'flat') {
        heightFt = 8 * Math.sin(frac * Math.PI);
      } else if (seg.arc === 'low-throw') {
        heightFt = 5 * Math.sin(frac * Math.PI);
      }
      return {
        position: pos,
        heightFt,
        visible: true,
        inFlight: seg.arc !== 'rolling',
      };
    }
    prevTo = seg.to;
  }
  // After the last segment but before endT (post-play hold) — ball at mound.
  if (prevTo) {
    return { position: prevTo, heightFt: 0, visible: false, inFlight: false };
  }
  return null;
};

const positionForRole = (role: FielderRole, simTime: number): FieldPoint => {
  if (simTime <= role.approachStartT) return role.fromPos;
  if (simTime <= role.approachEndT) {
    const dur = role.approachEndT - role.approachStartT;
    const frac = dur > 0 ? (simTime - role.approachStartT) / dur : 1;
    return lerp(role.fromPos, role.toPos, frac);
  }
  if (simTime <= role.returnStartT) return role.toPos;
  if (simTime <= role.returnEndT) {
    const dur = role.returnEndT - role.returnStartT;
    const frac = dur > 0 ? (simTime - role.returnStartT) / dur : 1;
    return lerp(role.toPos, role.fromPos, frac);
  }
  return role.fromPos;
};

// Returns the choreographed position for a given fielder, or null if not
// involved in this play (in which case the renderer keeps them at home).
export const fielderPositionForChoreo = (
  choreo: PlayChoreo,
  simTime: number,
  fielderId: PlayerId,
): FieldPoint | null => {
  for (const role of choreo.fielderRoles) {
    if (role.playerId === fielderId) {
      return positionForRole(role, simTime);
    }
  }
  return null;
};

export const buildFielderIdsByPos = (
  battingOrder: readonly PlayerId[],
  startingPitcherId: PlayerId,
  playerIndex: ReadonlyMap<PlayerId, Player>,
): ReadonlyMap<FielderPos, PlayerId> => {
  const out = new Map<FielderPos, PlayerId>();
  for (const pos of ALL_FIELDER_POSITIONS) {
    if (pos === 'P') {
      out.set('P', startingPitcherId);
      continue;
    }
    for (const id of battingOrder) {
      const p = playerIndex.get(id);
      if (p && p.primaryPosition === pos) {
        out.set(pos, id);
        break;
      }
    }
  }
  return out;
};
