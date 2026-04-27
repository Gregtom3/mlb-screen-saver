import type { Player, PlayerId, Position } from '../world/types.js';
import type { PRNG } from './prng.js';
import { createPRNG } from './prng.js';
import type {
  AtBatOutcome,
  BallPath,
  GameInput,
  Pitch,
  PitchResult,
  PitchType,
  SideInput,
  SimEvent,
} from './types.js';
import { adjustmentsFor, type QuirkAdjustments } from './stadium-effects.js';
import type { StadiumQuirk } from '../world/types.js';

// =========================================================================
// Phase 1 pitch-by-pitch sim.
//
// Probabilistic, not physics-based. Stadium quirks land in Phase 4 once the
// effect-plugin registry is in place. Manager nudges, pinch-hitting, steals,
// shifts, intentional walks, wild pitches, errors are all deferred.
//
// Determinism is the contract: same seed + same GameInput → same SimEvent[].
// All randomness flows through the threaded PRNG; no Math.random() anywhere.
// =========================================================================

type Side = 'home' | 'away';

interface BasesState {
  first: PlayerId | null;
  second: PlayerId | null;
  third: PlayerId | null;
}

interface SideState {
  readonly input: SideInput;
  batterIdx: number;
  currentPitcherId: PlayerId;
  pitcherPitches: number;
  pitcherBattersFaced: number;
  pitcherRunsAllowed: number;
  bullpenIdx: number;
}

interface GameState {
  t: number;
  inning: number;
  half: 'top' | 'bottom';
  outs: number;
  bases: BasesState;
  runs: { home: number; away: number };
  hits: { home: number; away: number };
  errors: { home: number; away: number };
  home: SideState;
  away: SideState;
  events: SimEvent[];
}

const TIME_PITCH = 25; // arbitrary "ticks" between pitches
// PA_END is the gap after a plate appearance ends. The renderer uses this
// window to choreograph the full play (fielder approach → throw → relay →
// return-to-mound → settle hold) before the next pitch fires. It needs to
// be wide enough that the longest play (a pop-up that hangs forever) fits
// completely inside it.
const TIME_PA_END = 50;
const TIME_INNING_GAP = 60;

const newSideState = (input: SideInput): SideState => ({
  input,
  batterIdx: 0,
  currentPitcherId: input.startingPitcherId,
  pitcherPitches: 0,
  pitcherBattersFaced: 0,
  pitcherRunsAllowed: 0,
  bullpenIdx: 0,
});

const battingSide = (s: GameState): Side => (s.half === 'top' ? 'away' : 'home');
const fieldingSide = (s: GameState): Side => (s.half === 'top' ? 'home' : 'away');

const sideState = (s: GameState, side: Side): SideState => (side === 'home' ? s.home : s.away);

const requirePlayer = (idx: ReadonlyMap<PlayerId, Player>, id: PlayerId): Player => {
  const p = idx.get(id);
  if (!p) throw new Error(`Unknown player id: ${id}`);
  return p;
};

// ---- pitch model -------------------------------------------------------

interface PitchOutcome {
  readonly result: PitchResult;
  readonly pitchType: PitchType;
  readonly velocityMph: number;
  readonly locationZone: number;
}

const pitchTypeFor = (pitcher: Player, rng: PRNG): PitchType => {
  // Pitchers with strong breaking-ball / changeup ratings lean off-speed.
  // Velocity-heavy arms lean fastball.
  const r = rng.next();
  const breakingHeavy = pitcher.ratings.breakingBall > 65;
  const changeupHeavy = pitcher.ratings.changeup > 65;
  const fbHeavy = pitcher.ratings.velocity > 70;
  if (breakingHeavy || changeupHeavy) {
    if (r < 0.45) return 'fastball';
    if (r < (breakingHeavy ? 0.78 : 0.7)) return 'breaking';
    if (r < 0.95) return 'offspeed';
    return 'specialty';
  }
  if (r < (fbHeavy ? 0.65 : 0.6)) return 'fastball';
  if (r < 0.85) return 'breaking';
  return 'offspeed';
};

const velocityFor = (pitcher: Player, type: PitchType, rng: PRNG): number => {
  // velocity rating drives fastball MPH; off-speed bands trail behind.
  const base = type === 'fastball' ? 92 : type === 'breaking' ? 82 : type === 'offspeed' ? 78 : 86;
  const v = pitcher.ratings.velocity;
  return Math.round(base + (v - 50) * 0.08 + (rng.next() - 0.5) * 4);
};

const simulatePitch = (
  pitcher: Player,
  batter: Player,
  count: { balls: number; strikes: number },
  pitchType: PitchType,
  rng: PRNG,
): PitchOutcome => {
  const type = pitchType;
  const velocity = velocityFor(pitcher, type, rng);

  // In-zone probability — driven by `control`. Tired starters drift off the
  // edges, so stamina pulls down once it's deep in the count.
  const zoneProb = 0.42 + (pitcher.ratings.control - 50) * 0.004;
  const inZone = rng.next() < zoneProb;
  const locationZone = inZone ? 1 + Math.floor(rng.next() * 9) : 0; // 0 = outside

  // Hitter aggression depends on count, discipline, and pitch type.
  // pitchRecognition reduces chase rate specifically on breaking / off-speed.
  const discAdj = (batter.ratings.discipline - 50) * 0.004;
  const recogAdj =
    type === 'breaking' || type === 'offspeed'
      ? (batter.ratings.pitchRecognition - 50) * 0.005
      : 0;
  const ahead = count.balls > count.strikes ? 0.05 : 0;
  const behind = count.strikes > count.balls ? -0.05 : 0;
  const swingInZone = 0.66 - discAdj + ahead + behind;
  const swingOutZone = 0.28 - discAdj * 1.5 - recogAdj + behind;
  const swingProb = Math.max(0.02, Math.min(0.95, inZone ? swingInZone : swingOutZone));
  const swing = rng.next() < swingProb;

  if (!swing) {
    return {
      result: inZone ? 'called-strike' : 'ball',
      pitchType: type,
      velocityMph: velocity,
      locationZone,
    };
  }

  // Hit-by-pitch: rare random event on out-of-zone pitches.
  if (!inZone && rng.next() < 0.005) {
    return { result: 'hit-by-pitch', pitchType: type, velocityMph: velocity, locationZone };
  }

  // Stuff resists contact: high velocity + high breaking-ball / changeup
  // rating on its own pitch type lifts swing-and-miss rate.
  const stuffPenalty =
    (pitcher.ratings.velocity - 50) * 0.0008 +
    (type === 'breaking' ? (pitcher.ratings.breakingBall - 50) * 0.001 : 0) +
    (type === 'offspeed' ? (pitcher.ratings.changeup - 50) * 0.001 : 0);
  const contactProb =
    0.78 +
    (batter.ratings.contact - 50) * 0.003 -
    stuffPenalty -
    (inZone ? 0 : 0.12);
  const contact = rng.next() < contactProb;
  if (!contact) {
    return { result: 'swinging-strike', pitchType: type, velocityMph: velocity, locationZone };
  }

  // Foul probability stays elevated even at 2 strikes (foul-with-2 is allowed).
  const foulProb = 0.36 + (count.strikes === 2 ? 0.18 : 0) - (batter.ratings.contact - 50) * 0.001;
  if (rng.next() < foulProb) {
    return { result: 'foul', pitchType: type, velocityMph: velocity, locationZone };
  }

  return { result: 'in-play', pitchType: type, velocityMph: velocity, locationZone };
};

// ---- in-play model -----------------------------------------------------
//
// Split into two phases:
//   1) Decide the outcome from rating-driven probabilities (HR / 2B / 3B /
//      1B / OUT, then OUT subtype, then sac-fly / DP refinements).
//   2) Synthesize a BallPath that physically matches that outcome — exit
//      velo, launch angle, and spray ranges are picked per outcome so the
//      renderer can show e.g. a high-and-short pop-up vs. a deep fly.
//
// This decoupling means the visualization never disagrees with the result:
// a popout is a tall, short trajectory; a HR is a long arc.

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// Calibrated drag factor: turns vacuum-physics distances into roughly real
// MLB distances (e.g. 100 mph at 30° → ~415 ft). Keeps hangtime credible.
const DRAG_FACTOR = 1.4;
const G_FPS2 = 32.2;
const MPH_TO_FPS = 1.467;

interface BallPathInputs {
  readonly evMin: number;
  readonly evMax: number;
  readonly angleMin: number;
  readonly angleMax: number;
  // Optional spray override; otherwise spray is uniform across fair territory.
  readonly sprayCenter?: number;
  readonly spraySpread?: number;
}

const PROFILES: Record<AtBatOutcome, BallPathInputs | null> = {
  'home-run': { evMin: 100, evMax: 115, angleMin: 23, angleMax: 36 },
  'triple': { evMin: 92, evMax: 108, angleMin: 12, angleMax: 28, sprayCenter: 0, spraySpread: 30 },
  'double': { evMin: 90, evMax: 108, angleMin: 12, angleMax: 26 },
  'single': { evMin: 78, evMax: 98, angleMin: -2, angleMax: 22 },
  'flyout': { evMin: 75, evMax: 92, angleMin: 28, angleMax: 46 },
  'popout': { evMin: 60, evMax: 82, angleMin: 55, angleMax: 80 },
  'lineout': { evMin: 88, evMax: 102, angleMin: 6, angleMax: 16 },
  'groundout': { evMin: 70, evMax: 95, angleMin: -14, angleMax: 4 },
  'double-play': { evMin: 78, evMax: 100, angleMin: -10, angleMax: 2 },
  'fielders-choice': { evMin: 72, evMax: 92, angleMin: -10, angleMax: 4 },
  'sac-fly': { evMin: 78, evMax: 92, angleMin: 30, angleMax: 48 },
  'sac-bunt': { evMin: 50, evMax: 65, angleMin: -2, angleMax: 14 },
  'reached-on-error': { evMin: 75, evMax: 95, angleMin: 4, angleMax: 22 },
  'triple-play': { evMin: 70, evMax: 95, angleMin: -8, angleMax: 8 },
  // Outcomes without contact don't have a BallPath.
  'walk': null,
  'hit-by-pitch': null,
  'strikeout-looking': null,
  'strikeout-swinging': null,
};

const buildBallPath = (
  outcome: AtBatOutcome,
  batter: Player,
  pitcher: Player,
  rng: PRNG,
): BallPath => {
  const profile = PROFILES[outcome];
  if (!profile) throw new Error(`buildBallPath called for non-contact outcome: ${outcome}`);

  // Player-rating modulation, layered on top of the profile band.
  const powerAdj = (batter.ratings.power - 50) * 0.12;
  const contactAdj = (batter.ratings.contact - 50) * 0.04;
  const pitcherSuppression = (pitcher.ratings.stamina - 50) * 0.08;
  let exitVeloMph =
    profile.evMin + rng.next() * (profile.evMax - profile.evMin) + powerAdj - pitcherSuppression;
  exitVeloMph = clamp(exitVeloMph, 45, 115); // hard cap at 115 — top-end MLB EV.

  let launchAngleDeg = profile.angleMin + rng.next() * (profile.angleMax - profile.angleMin);
  launchAngleDeg += contactAdj * 0.3; // good contact tightens angle slightly upward
  launchAngleDeg = clamp(launchAngleDeg, -25, 88);

  const sprayBias = batter.bats === 'L' ? +6 : batter.bats === 'R' ? -6 : 0;
  let sprayDeg: number;
  if (profile.sprayCenter !== undefined && profile.spraySpread !== undefined) {
    sprayDeg = profile.sprayCenter + (rng.next() - 0.5) * 2 * profile.spraySpread + sprayBias;
  } else {
    sprayDeg = -42 + rng.next() * 84 + sprayBias;
  }
  sprayDeg = clamp(sprayDeg, -44, 44);

  // Physics: vacuum trajectory scaled by an effective gravity to model drag.
  const vFps = exitVeloMph * MPH_TO_FPS;
  const thetaRad = (launchAngleDeg * Math.PI) / 180;
  let hangTimeSec: number;
  let distance: number;
  if (launchAngleDeg <= 0) {
    // Ground ball — short rolling distance, fixed-ish hangtime.
    hangTimeSec = 1.0 + rng.next() * 0.6;
    distance = vFps * hangTimeSec * 0.42; // friction decay during the roll
  } else {
    const vZ = vFps * Math.sin(thetaRad);
    const vH = vFps * Math.cos(thetaRad);
    const gEff = G_FPS2 * DRAG_FACTOR;
    hangTimeSec = (2 * vZ) / gEff;
    distance = vH * hangTimeSec;
  }

  const sprayRad = (sprayDeg * Math.PI) / 180;
  return {
    launchAngleDeg: Math.round(launchAngleDeg),
    exitVeloMph: Math.round(exitVeloMph),
    landingX: Math.round(Math.sin(sprayRad) * distance),
    landingY: Math.round(Math.cos(sprayRad) * distance),
    hangTimeSec: Math.round(hangTimeSec * 100) / 100,
  };
};

interface InPlayResult {
  readonly outcome: AtBatOutcome;
  readonly ballPath: BallPath;
  readonly fielderId?: PlayerId;
}

// ---- fielder-error model -----------------------------------------------
//
// Errors only fire on would-be outs that involve fielding a ball. The
// responsible fielder is picked from the ball's spray + launch; their
// `glove` rating drives the per-chance error probability. League-average
// glove → ~2.2%; combined with ~20 fielding chances per side per game,
// that's ~0.4 errors per team per game (MLB sits around 0.6).

const sprayDegOf = (ballPath: BallPath): number =>
  (Math.atan2(ballPath.landingX, Math.max(1, ballPath.landingY)) * 180) / Math.PI;

const pickInfieldPosition = (spray: number): Position => {
  if (spray < -18) return '3B';
  if (spray < -6) return 'SS';
  if (spray < 6) return 'P';
  if (spray < 18) return '2B';
  return '1B';
};

const pickOutfieldPosition = (spray: number): Position => {
  if (spray < -15) return 'LF';
  if (spray < 15) return 'CF';
  return 'RF';
};

const fielderPositionFor = (outcome: AtBatOutcome, ballPath: BallPath): Position | null => {
  const spray = sprayDegOf(ballPath);
  switch (outcome) {
    case 'groundout':
    case 'double-play':
    case 'fielders-choice':
    case 'popout':
      return pickInfieldPosition(spray);
    case 'flyout':
    case 'sac-fly':
      return pickOutfieldPosition(spray);
    case 'lineout':
      return ballPath.launchAngleDeg < 14
        ? pickInfieldPosition(spray)
        : pickOutfieldPosition(spray);
    default:
      return null;
  }
};

const errorProbForGlove = (glove: number): number =>
  clamp(0.022 - (glove - 50) * 0.0006, 0.003, 0.06);

const simulateInPlay = (
  batter: Player,
  pitcher: Player,
  outs: number,
  bases: BasesState,
  rng: PRNG,
  quirk: StadiumQuirk | undefined,
  highLeverage: boolean,
): InPlayResult => {
  // Outcome roll from a rating-modulated probability table, then multiplied
  // by stadium-quirk adjustments (Phase 4 plugin). Quirks shift odds; they
  // never change ratings or fabricate outcomes directly.
  // Platoon penalty: when batter and pitcher share handedness, batter loses
  // a small amount of effective contact + power. `platoonBias` >50 amplifies
  // the penalty; <50 dampens it (reverse-split hitter).
  const sameHand =
    (batter.bats === 'L' && pitcher.throws === 'L') ||
    (batter.bats === 'R' && pitcher.throws === 'R');
  const platoonStrength = sameHand ? (batter.ratings.platoonBias - 50) * 0.0005 : 0;
  // Composure (pitcher) vs clutch (batter) net out in high-leverage states.
  // 50 vs 50 = 0; both elite ≈ 0; one-sided shifts by up to ~3% on each rate.
  const leverageNet = highLeverage
    ? (batter.ratings.clutch - 50 - (pitcher.ratings.composure - 50)) * 0.0006
    : 0;

  const power = batter.ratings.power - 50;
  const speed = batter.ratings.speed - 50;
  const contact = batter.ratings.contact - 50 - platoonStrength * 100;
  // `command` keeps pitches off the heart of the plate → fewer barrels →
  // lower HR rate. `groundballTendency` further suppresses HR + bumps
  // grounders. `velocity` slightly suppresses contact-quality across the board.
  const cmd = pitcher.ratings.command - 50;
  const gb = pitcher.ratings.groundballTendency - 50;
  const stuff = (pitcher.ratings.velocity - 50) * 0.5;

  const adj: QuirkAdjustments = adjustmentsFor(quirk);
  const hrRate = Math.max(
    0.005,
    (0.04 + power * 0.0018 - cmd * 0.0008 - gb * 0.0006 - stuff * 0.0004 + leverageNet) *
      adj.hrRateMul,
  );
  const dblRate = Math.max(
    0.02,
    (0.07 + power * 0.0009 + contact * 0.0004 - stuff * 0.0002 + leverageNet * 0.5) *
      adj.doubleRateMul,
  );
  const tplRate = Math.max(0.001, (0.005 + speed * 0.0003) * adj.tripleRateMul);
  const sglRate = Math.max(0.05, 0.2 + contact * 0.0011 - stuff * 0.0003 + leverageNet * 0.5);

  const r = rng.next();
  let outcome: AtBatOutcome;
  if (r < hrRate) outcome = 'home-run';
  else if (r < hrRate + dblRate) outcome = 'double';
  else if (r < hrRate + dblRate + tplRate) outcome = 'triple';
  else if (r < hrRate + dblRate + tplRate + sglRate) outcome = 'single';
  else {
    // OUT subtype split — `groundballTendency` shifts the GB↔FB mix.
    const sub = rng.next();
    const gbShift = (pitcher.ratings.groundballTendency - 50) * 0.002;
    const gbCutoff = 0.45 + gbShift;
    const lineCutoff = gbCutoff + 0.20;
    const flyCutoff = lineCutoff + 0.20;
    if (sub < gbCutoff) outcome = 'groundout';
    else if (sub < lineCutoff) outcome = 'lineout';
    else if (sub < flyCutoff) outcome = 'flyout';
    else outcome = 'popout';

    // Sac fly: <2 outs, runner on 3rd, on a fly ball variant.
    if (
      outs < 2 &&
      bases.third &&
      (outcome === 'flyout' || outcome === 'lineout') &&
      rng.next() < 0.45
    ) {
      outcome = 'sac-fly';
    }
    // Force-play escalation: <2 outs, runner on 1st, on a grounder. The
    // defense will almost always try the force at 2B — outcome is either a
    // double play, a fielder's choice (lead runner out, batter safe), or
    // (rarely) a beat-the-force grounder where everyone holds.
    if (outs < 2 && bases.first && outcome === 'groundout') {
      const r = rng.next();
      if (r < 0.55) outcome = 'double-play';
      else if (r < 0.88) outcome = 'fielders-choice';
      // else stays as groundout — defense couldn't get the force.
    }
  }

  const ballPath = buildBallPath(outcome, batter, pitcher, rng);
  return { outcome, ballPath };
};

// ---- baserunning model -------------------------------------------------

interface AdvanceResult {
  readonly newBases: BasesState;
  readonly runsScored: number;
  readonly outsAdded: number;
  readonly runnerEvents: ReadonlyArray<{
    runnerId: PlayerId;
    from: 0 | 1 | 2 | 3;
    to: 0 | 1 | 2 | 3;
    out: boolean;
  }>;
}

type RunnerEvent = { runnerId: PlayerId; from: 0 | 1 | 2 | 3; to: 0 | 1 | 2 | 3; out: boolean };

const advanceForOutcome = (
  outcome: AtBatOutcome,
  batterId: PlayerId,
  bases: BasesState,
): AdvanceResult => {
  const runnerEvents: RunnerEvent[] = [];
  let runs = 0;
  let outsAdded = 0;
  const next: BasesState = { first: null, second: null, third: null };
  const carryRunners = () => {
    next.first = bases.first;
    next.second = bases.second;
    next.third = bases.third;
  };

  const score = (id: PlayerId, from: 0 | 1 | 2 | 3) => {
    runs += 1;
    runnerEvents.push({ runnerId: id, from, to: 0, out: false });
  };
  const advanceTo = (id: PlayerId, from: 0 | 1 | 2 | 3, to: 1 | 2 | 3) => {
    runnerEvents.push({ runnerId: id, from, to, out: false });
    if (to === 1) next.first = id;
    else if (to === 2) next.second = id;
    else next.third = id;
  };

  switch (outcome) {
    case 'walk':
    case 'hit-by-pitch': {
      if (bases.first && bases.second && bases.third) {
        score(bases.third, 3);
        advanceTo(bases.second, 2, 3);
        advanceTo(bases.first, 1, 2);
        advanceTo(batterId, 0, 1);
      } else if (bases.first && bases.second) {
        if (bases.third) next.third = bases.third;
        advanceTo(bases.second, 2, 3);
        advanceTo(bases.first, 1, 2);
        advanceTo(batterId, 0, 1);
      } else if (bases.first) {
        if (bases.third) next.third = bases.third;
        if (bases.second) next.second = bases.second;
        advanceTo(bases.first, 1, 2);
        advanceTo(batterId, 0, 1);
      } else {
        if (bases.third) next.third = bases.third;
        if (bases.second) next.second = bases.second;
        advanceTo(batterId, 0, 1);
      }
      break;
    }
    case 'single': {
      if (bases.third) score(bases.third, 3);
      if (bases.second) score(bases.second, 2);
      if (bases.first) advanceTo(bases.first, 1, 3);
      advanceTo(batterId, 0, 1);
      break;
    }
    case 'double': {
      if (bases.third) score(bases.third, 3);
      if (bases.second) score(bases.second, 2);
      if (bases.first) score(bases.first, 1);
      advanceTo(batterId, 0, 2);
      break;
    }
    case 'triple': {
      if (bases.third) score(bases.third, 3);
      if (bases.second) score(bases.second, 2);
      if (bases.first) score(bases.first, 1);
      advanceTo(batterId, 0, 3);
      break;
    }
    case 'home-run': {
      if (bases.third) score(bases.third, 3);
      if (bases.second) score(bases.second, 2);
      if (bases.first) score(bases.first, 1);
      score(batterId, 0);
      break;
    }
    case 'sac-fly': {
      if (bases.third) score(bases.third, 3);
      if (bases.first) next.first = bases.first;
      if (bases.second) next.second = bases.second;
      // batter out (caught fly) — encoded by outcome, no baserunner event needed
      outsAdded += 1;
      break;
    }
    case 'double-play': {
      if (bases.first) {
        runnerEvents.push({ runnerId: bases.first, from: 1, to: 2, out: true });
        outsAdded += 1;
      }
      if (bases.second) next.third = bases.second;
      if (bases.third) score(bases.third, 3);
      // batter out at 1st
      runnerEvents.push({ runnerId: batterId, from: 0, to: 1, out: true });
      outsAdded += 1;
      break;
    }
    case 'triple-play': {
      // Rare — encoded as 3 outs, runners cleared.
      outsAdded += 3;
      break;
    }
    case 'fielders-choice': {
      if (bases.first) {
        runnerEvents.push({ runnerId: bases.first, from: 1, to: 2, out: true });
        outsAdded += 1;
      }
      if (bases.second) next.second = bases.second;
      if (bases.third) next.third = bases.third;
      advanceTo(batterId, 0, 1);
      break;
    }
    case 'reached-on-error': {
      if (bases.third) score(bases.third, 3);
      if (bases.second) advanceTo(bases.second, 2, 3);
      if (bases.first) advanceTo(bases.first, 1, 2);
      advanceTo(batterId, 0, 1);
      break;
    }
    case 'groundout': {
      // Batter thrown out at first. Runners hold (Phase 1 simplification).
      carryRunners();
      runnerEvents.push({ runnerId: batterId, from: 0, to: 1, out: true });
      outsAdded += 1;
      break;
    }
    case 'strikeout-swinging':
    case 'strikeout-looking':
    case 'flyout':
    case 'lineout':
    case 'popout':
    case 'sac-bunt': {
      // Batter out without baserunning; encoded by outcome alone. Runners hold.
      carryRunners();
      outsAdded += 1;
      break;
    }
  }

  return { newBases: next, runsScored: runs, outsAdded, runnerEvents };
};

// ---- bullpen management ------------------------------------------------

const STARTER_PITCH_LIMIT = 95;
const STARTER_TROUBLE_LIMIT = 70;
const RELIEVER_PITCH_LIMIT = 30;

const swapPitcherIfNeeded = (state: GameState, side: Side): void => {
  const sideSt = sideState(state, side);
  const isStarter = sideSt.currentPitcherId === sideSt.input.startingPitcherId;
  const limit = isStarter
    ? sideSt.pitcherRunsAllowed >= 4
      ? STARTER_TROUBLE_LIMIT
      : STARTER_PITCH_LIMIT
    : RELIEVER_PITCH_LIMIT;
  if (sideSt.pitcherPitches < limit) return;
  if (sideSt.bullpenIdx >= sideSt.input.bullpen.length) return; // out of relievers
  const newPitcher = sideSt.input.bullpen[sideSt.bullpenIdx];
  if (!newPitcher) return;
  const oldPitcher = sideSt.currentPitcherId;
  sideSt.bullpenIdx += 1;
  sideSt.currentPitcherId = newPitcher;
  sideSt.pitcherPitches = 0;
  sideSt.pitcherBattersFaced = 0;
  sideSt.pitcherRunsAllowed = 0;
  state.t += 30;
  state.events.push({
    t: state.t,
    kind: 'sub',
    outPlayerId: oldPitcher,
    inPlayerId: newPitcher,
    reason: 'pitching-change',
  });
};

// ---- at-bat ------------------------------------------------------------

interface AtBatResult {
  readonly outcome: AtBatOutcome;
  readonly runsScored: number;
  readonly outsAdded: number;
  readonly newBases: BasesState;
}

let pitchSeq = 0;

const simulateAtBat = (
  state: GameState,
  rng: PRNG,
  playerIndex: ReadonlyMap<PlayerId, Player>,
  stadiumQuirk: StadiumQuirk | undefined,
): AtBatResult => {
  const fieldingSide_ = fieldingSide(state);
  const battingSide_ = battingSide(state);
  const fielding = sideState(state, fieldingSide_);
  const batting = sideState(state, battingSide_);

  swapPitcherIfNeeded(state, fieldingSide_);

  const batterId = batting.input.battingOrder[batting.batterIdx % 9]!;
  const pitcherId = fielding.currentPitcherId;
  const batter = requirePlayer(playerIndex, batterId);
  const pitcher = requirePlayer(playerIndex, pitcherId);

  let balls = 0;
  let strikes = 0;
  let outcome: AtBatOutcome | null = null;
  let inPlayResult: InPlayResult | null = null;

  while (outcome === null) {
    const ptype = pitchTypeFor(pitcher, rng);
    const po = simulatePitch(pitcher, batter, { balls, strikes }, ptype, rng);
    state.t += TIME_PITCH;
    pitchSeq += 1;
    fielding.pitcherPitches += 1;

    const pitch: Pitch = {
      id: `p-${pitchSeq}`,
      pitcherId,
      batterId,
      type: po.pitchType,
      result: po.result,
      velocityMph: po.velocityMph,
      locationZone: po.locationZone,
    };
    state.events.push({ t: state.t, kind: 'pitch', pitcherId, batterId, pitch });

    switch (po.result) {
      case 'ball':
        balls += 1;
        if (balls >= 4) outcome = 'walk';
        break;
      case 'called-strike':
        strikes += 1;
        if (strikes >= 3) outcome = 'strikeout-looking';
        break;
      case 'swinging-strike':
        strikes += 1;
        if (strikes >= 3) outcome = 'strikeout-swinging';
        break;
      case 'foul':
        if (strikes < 2) strikes += 1;
        break;
      case 'foul-tip-caught':
        outcome = 'strikeout-swinging';
        break;
      case 'hit-by-pitch':
        outcome = 'hit-by-pitch';
        break;
      case 'in-play': {
        // High-leverage = 7th+ inning, score within 2 runs (clutch / composure
        // matters here). Conservative definition; matches the late-and-close
        // bucket used by /stats/aggregator splits.
        const scoreDiff = Math.abs(state.runs.home - state.runs.away);
        const highLeverage = state.inning >= 7 && scoreDiff <= 2;
        inPlayResult = simulateInPlay(
          batter,
          pitcher,
          state.outs,
          state.bases,
          rng,
          stadiumQuirk,
          highLeverage,
        );
        outcome = inPlayResult.outcome;
        state.events.push({
          t: state.t,
          kind: 'contact',
          batterId,
          ballPath: inPlayResult.ballPath,
        });
        break;
      }
    }
  }

  // Fielder-error roll: would-be outs convert to reached-on-error based on
  // the responsible fielder's glove rating. P slot uses the active pitcher
  // (defenseByPosition.P is set at lineup time and goes stale on a sub).
  if (inPlayResult) {
    const fieldPos = fielderPositionFor(outcome, inPlayResult.ballPath);
    if (fieldPos !== null) {
      const fielderId =
        fieldPos === 'P'
          ? pitcherId
          : fielding.input.defenseByPosition[fieldPos];
      if (fielderId) {
        const fielder = playerIndex.get(fielderId);
        if (fielder && rng.next() < errorProbForGlove(fielder.ratings.glove)) {
          outcome = 'reached-on-error';
        }
      }
    }
  }

  // Apply baserunning.
  const advance = advanceForOutcome(outcome, batterId, state.bases);

  // Emit baserunner events for each movement.
  for (const ev of advance.runnerEvents) {
    state.events.push({
      t: state.t,
      kind: 'baserunner',
      runnerId: ev.runnerId,
      from: ev.from,
      to: ev.to,
      out: ev.out,
    });
  }

  // RBI calculation: batter credited for runs scored on hits / sac-flies / walks-with-bases-loaded.
  let rbis = 0;
  if (outcome === 'home-run' || outcome === 'single' || outcome === 'double' || outcome === 'triple' || outcome === 'sac-fly' || outcome === 'reached-on-error') {
    rbis = advance.runsScored;
  } else if ((outcome === 'walk' || outcome === 'hit-by-pitch') && advance.runsScored > 0) {
    rbis = advance.runsScored;
  } else if (outcome === 'groundout' || outcome === 'fielders-choice') {
    rbis = advance.runsScored; // productive out
  }

  fielding.pitcherBattersFaced += 1;
  fielding.pitcherRunsAllowed += advance.runsScored;

  state.t += TIME_PA_END;
  state.events.push({
    t: state.t,
    kind: 'atBatEnd',
    atBatId: `${batting.input.teamId}-${battingSide_}-${batting.batterIdx}`,
    outcome,
    rbis,
  });

  // Update score, hits, runs.
  if (advance.runsScored > 0) {
    if (battingSide_ === 'home') state.runs.home += advance.runsScored;
    else state.runs.away += advance.runsScored;
  }
  if (outcome === 'single' || outcome === 'double' || outcome === 'triple' || outcome === 'home-run') {
    if (battingSide_ === 'home') state.hits.home += 1;
    else state.hits.away += 1;
  }

  batting.batterIdx += 1;

  return {
    outcome,
    runsScored: advance.runsScored,
    outsAdded: advance.outsAdded,
    newBases: advance.newBases,
  };
};

// ---- inning / game loop -----------------------------------------------

const playHalfInning = (
  state: GameState,
  rng: PRNG,
  playerIndex: ReadonlyMap<PlayerId, Player>,
  stadiumQuirk: StadiumQuirk | undefined,
): void => {
  state.outs = 0;
  state.bases = { first: null, second: null, third: null };
  while (state.outs < 3) {
    const result = simulateAtBat(state, rng, playerIndex, stadiumQuirk);
    state.outs += result.outsAdded;
    state.bases = result.newBases;
    if (state.outs >= 3) break;
  }
  state.t += TIME_INNING_GAP;
  state.events.push({
    t: state.t,
    kind: 'inningEnd',
    halfInning: state.half,
    inning: state.inning,
    runs: state.half === 'top' ? state.runs.away : state.runs.home,
  });
};

export const runGame = (input: GameInput): readonly SimEvent[] => {
  pitchSeq = 0; // reset per game so deterministic ids start at 1
  const rng = createPRNG(input.seed).fork(`game:${input.gameId}`);
  const state: GameState = {
    t: 0,
    inning: 1,
    half: 'top',
    outs: 0,
    bases: { first: null, second: null, third: null },
    runs: { home: 0, away: 0 },
    hits: { home: 0, away: 0 },
    errors: { home: 0, away: 0 },
    home: newSideState(input.home),
    away: newSideState(input.away),
    events: [],
  };

  state.events.push({
    t: 0,
    kind: 'gameStart',
    gameId: input.gameId,
    stadiumId: input.stadiumId,
  });

  // Top + bottom of innings 1..9, plus extras until decided.
  while (true) {
    state.half = 'top';
    playHalfInning(state, rng, input.playerIndex, input.stadiumQuirk);

    // Skip bottom of 9th+ if home is winning.
    if (state.inning >= 9 && state.runs.home > state.runs.away) break;
    state.half = 'bottom';
    playHalfInning(state, rng, input.playerIndex, input.stadiumQuirk);

    if (state.inning >= 9 && state.runs.home !== state.runs.away) break;

    state.inning += 1;
    if (state.inning > 20) {
      // Safety valve: shouldn't fire in practice but prevents infinite loops if model misfires.
      break;
    }
  }

  state.events.push({
    t: state.t + 30,
    kind: 'gameEnd',
    gameId: input.gameId,
    finalRuns: { home: state.runs.home, away: state.runs.away },
  });

  return state.events;
};
