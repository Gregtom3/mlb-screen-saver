import type { Player, PlayerId } from '../world/types.js';
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
const TIME_PA_END = 8;
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
  // Heuristic: pitchers with high power-suppressing stamina lean fastball,
  // high composure lean offspeed/breaking. No real arsenals yet — Phase 4.
  const r = rng.next();
  if (pitcher.ratings.composure > 65) {
    if (r < 0.45) return 'fastball';
    if (r < 0.78) return 'breaking';
    if (r < 0.95) return 'offspeed';
    return 'specialty';
  }
  if (r < 0.6) return 'fastball';
  if (r < 0.85) return 'breaking';
  return 'offspeed';
};

const velocityFor = (pitcher: Player, type: PitchType, rng: PRNG): number => {
  const base = type === 'fastball' ? 92 : type === 'breaking' ? 82 : type === 'offspeed' ? 78 : 86;
  const stamina = pitcher.ratings.stamina;
  return Math.round(base + (stamina - 50) * 0.06 + (rng.next() - 0.5) * 4);
};

const simulatePitch = (
  pitcher: Player,
  batter: Player,
  count: { balls: number; strikes: number },
  rng: PRNG,
): PitchOutcome => {
  const type = pitchTypeFor(pitcher, rng);
  const velocity = velocityFor(pitcher, type, rng);

  // Probability the pitch is in the strike zone, modulated by control proxy (composure).
  const zoneProb = 0.42 + (pitcher.ratings.composure - 50) * 0.004;
  const inZone = rng.next() < zoneProb;
  const locationZone = inZone ? 1 + Math.floor(rng.next() * 9) : 0; // 0 = outside

  // Hitter aggression depends on count and eye.
  const eyeAdj = (batter.ratings.eye - 50) * 0.004;
  const ahead = count.balls > count.strikes ? 0.05 : 0;
  const behind = count.strikes > count.balls ? -0.05 : 0;
  const swingInZone = 0.66 - eyeAdj + ahead + behind;
  const swingOutZone = 0.28 - eyeAdj * 1.5 + behind;
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

  const contactProb =
    0.78 +
    (batter.ratings.contact - 50) * 0.003 -
    (pitcher.ratings.stamina - 50) * 0.0015 -
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

const simulateBallPath = (batter: Player, pitcher: Player, rng: PRNG): BallPath => {
  const power = batter.ratings.power;
  const exitVelo = 80 + (power - 50) * 0.6 + (rng.next() - 0.5) * 20;
  // Launch angle from -20 (worm-burner) to +60 (popup), centered ~12.
  const launchAngle = -20 + rng.next() * 80;
  // Spray: -45 (foul left) to +45 (foul right) — bias by handedness.
  const sprayBias = batter.bats === 'L' ? +5 : batter.bats === 'R' ? -5 : 0;
  const sprayDeg = -45 + rng.next() * 90 + sprayBias;
  // Approximate landing distance based on exit velo and angle.
  const angleEff = Math.max(0, Math.min(45, launchAngle));
  const dist = exitVelo * 4 * (angleEff / 45 + 0.4);
  const sprayRad = (sprayDeg * Math.PI) / 180;
  return {
    launchAngleDeg: Math.round(launchAngle),
    exitVeloMph: Math.round(exitVelo),
    landingX: Math.round(Math.sin(sprayRad) * dist),
    landingY: Math.round(Math.cos(sprayRad) * dist),
    hangTimeSec: Math.round((Math.max(0, launchAngle) / 45 + 0.6) * 10) / 10,
  };
};

interface InPlayResult {
  readonly outcome: AtBatOutcome;
  readonly ballPath: BallPath;
  readonly fielderId?: PlayerId; // best-effort — not used by sim, just stamped on the contact event
}

const simulateInPlay = (
  batter: Player,
  pitcher: Player,
  outs: number,
  bases: BasesState,
  rng: PRNG,
): InPlayResult => {
  const ballPath = simulateBallPath(batter, pitcher, rng);

  // Outcome roll from a flat probability table, modulated by ratings.
  const power = batter.ratings.power - 50;
  const speed = batter.ratings.speed - 50;
  const contact = batter.ratings.contact - 50;
  const pitcherStrength = pitcher.ratings.stamina - 50;

  const hrRate = Math.max(0.005, 0.04 + power * 0.0018 - pitcherStrength * 0.0006);
  const dblRate = Math.max(0.02, 0.07 + power * 0.0009 + contact * 0.0004);
  const tplRate = Math.max(0.001, 0.005 + speed * 0.0003);
  const sglRate = Math.max(0.05, 0.2 + contact * 0.0011 - pitcherStrength * 0.0005);

  const r = rng.next();
  let outcome: AtBatOutcome;
  if (r < hrRate) outcome = 'home-run';
  else if (r < hrRate + dblRate) outcome = 'double';
  else if (r < hrRate + dblRate + tplRate) outcome = 'triple';
  else if (r < hrRate + dblRate + tplRate + sglRate) outcome = 'single';
  else {
    // Outs split: more grounders for low-launch, more flies for high.
    const sub = rng.next();
    if (ballPath.launchAngleDeg < 10) outcome = 'groundout';
    else if (ballPath.launchAngleDeg > 35) outcome = 'popout';
    else if (sub < 0.55) outcome = 'flyout';
    else outcome = 'lineout';

    // Sac fly: <2 outs, runner on 3rd, fly-ball-ish trajectory.
    if (
      outs < 2 &&
      bases.third &&
      (outcome === 'flyout' || outcome === 'lineout') &&
      ballPath.launchAngleDeg > 18 &&
      rng.next() < 0.45
    ) {
      outcome = 'sac-fly';
    }

    // Double play: <2 outs, runner on 1st, grounder.
    if (outs < 2 && bases.first && outcome === 'groundout' && rng.next() < 0.32) {
      outcome = 'double-play';
    }
  }

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
    const po = simulatePitch(pitcher, batter, { balls, strikes }, rng);
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
        inPlayResult = simulateInPlay(batter, pitcher, state.outs, state.bases, rng);
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

const playHalfInning = (state: GameState, rng: PRNG, playerIndex: ReadonlyMap<PlayerId, Player>): void => {
  state.outs = 0;
  state.bases = { first: null, second: null, third: null };
  while (state.outs < 3) {
    const result = simulateAtBat(state, rng, playerIndex);
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
    playHalfInning(state, rng, input.playerIndex);

    // Skip bottom of 9th+ if home is winning.
    if (state.inning >= 9 && state.runs.home > state.runs.away) break;
    state.half = 'bottom';
    playHalfInning(state, rng, input.playerIndex);

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
