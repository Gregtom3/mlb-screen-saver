import type { Bats, Player, PlayerId, Position } from '../world/types.js';
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
import {
  modsForCoaching,
  type CoachingMods,
} from './coaching-effects.js';
import { resolveBetweenPitches } from './baserunning.js';
import type { StadiumQuirk, StadiumDimensions } from '../world/types.js';
import { wallDistanceAtAngle } from '../world/stadium-geometry.js';

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
  // (runnerId, base) pairs that already had a `lead` event emitted at
  // their current arrival. Reset at every half-inning since the bases
  // are cleared between innings.
  leadsEmitted: Set<string>;
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

// Sample one of the nine in-zone locations weighted by the pitcher's
// tendency fingerprint. Pitchers without explicit tendencies fall back to a
// uniform draw — preserves prior behavior for any future emergency-pitcher
// case that lacks a generated heat map.
const pickInZoneLocation = (pitcher: Player, rng: PRNG): number => {
  const tend = pitcher.pitcherTendencies;
  if (!tend) return 1 + Math.floor(rng.next() * 9);
  let total = 0;
  for (let z = 1; z <= 9; z++) total += tend.zoneWeights[z]!;
  if (total <= 0) return 1 + Math.floor(rng.next() * 9);
  let r = rng.next() * total;
  for (let z = 1; z <= 9; z++) {
    r -= tend.zoneWeights[z]!;
    if (r <= 0) return z;
  }
  return 9;
};

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

const velocityFor = (pitcher: Player, type: PitchType, fatigue: number, rng: PRNG): number => {
  // velocity rating drives fastball MPH; off-speed bands trail behind.
  // Fatigue shaves MPH off the fastball most aggressively (≈0.4 mph per
  // effective rating point lost).
  const base = type === 'fastball' ? 92 : type === 'breaking' ? 82 : type === 'offspeed' ? 78 : 86;
  const v = pitcher.ratings.velocity;
  const fatMph = fatigue * (type === 'fastball' ? 0.04 : 0.025);
  return Math.round(base + (v - 50) * 0.08 - fatMph + (rng.next() - 0.5) * 4);
};

// Per-pitch fatigue accumulator. After a stamina-dependent threshold, every
// further pitch shaves a fraction of an effective rating point off the
// pitcher's control + velocity + stuff. Returns the cumulative loss in
// rating-point units (0 when the pitcher is still fresh).
const fatigueLoss = (pitcher: Player, pitchCount: number): number => {
  // Threshold: a 50-stamina starter starts feeling it at ~30 pitches; an
  // elite-stamina starter (90) holds out until ~50; a low-stamina arm (20)
  // fades by ~15.
  const threshold = 30 + (pitcher.ratings.stamina - 50) * 0.5;
  const over = Math.max(0, pitchCount - threshold);
  // Decay rate: lower stamina → faster slide. Capped so the late innings
  // don't flatline a pitcher to nothing.
  const decayPerPitch = Math.max(0.15, 0.5 - (pitcher.ratings.stamina - 50) * 0.005);
  return Math.min(25, over * decayPerPitch);
};

const simulatePitch = (
  pitcher: Player,
  batter: Player,
  count: { balls: number; strikes: number },
  pitchType: PitchType,
  pitchCount: number,
  rng: PRNG,
): PitchOutcome => {
  const type = pitchType;
  const fatigue = fatigueLoss(pitcher, pitchCount);
  const velocity = velocityFor(pitcher, type, fatigue, rng);

  // In-zone probability — driven by `control`. Fatigue pulls effective
  // control down: a tired pitcher misses the strike zone more.
  const effControl = pitcher.ratings.control - fatigue;
  const zoneProb = 0.42 + (effControl - 50) * 0.004;
  const inZone = rng.next() < zoneProb;
  const locationZone = inZone ? pickInZoneLocation(pitcher, rng) : 0; // 0 = outside

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
  // rating on its own pitch type lifts swing-and-miss rate. Fatigue eats
  // into the pitcher's effective velocity here too.
  const effVelocity = pitcher.ratings.velocity - fatigue;
  const stuffPenalty =
    (effVelocity - 50) * 0.0008 +
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
  pitchCount: number,
  rng: PRNG,
): BallPath => {
  const baseProfile = PROFILES[outcome];
  if (!baseProfile) throw new Error(`buildBallPath called for non-contact outcome: ${outcome}`);

  // Singles and doubles get sub-typed at trajectory time so their on-screen
  // shape matches real baseball. A flat single profile concentrates too many
  // balls in the infield arc — every single ends up looking like a weak
  // dribbler scooped by P/1B. Real singles are mostly line drives over the
  // infield, with smaller shares of bloops, hard grounders through the hole,
  // and legit infield singles. Doubles cluster in the gaps and down the line.
  let profile = baseProfile;
  let manualSpray: number | undefined;
  if (outcome === 'single') {
    const r = rng.next();
    if (r < 0.10) {
      // Legit infield single — weak grounder fielded by P/1B/SS.
      profile = { evMin: 60, evMax: 80, angleMin: -10, angleMax: -2 };
    } else if (r < 0.30) {
      // Hard grounder through the 3-4 or 5-6 hole, into the outfield grass.
      profile = { evMin: 90, evMax: 102, angleMin: -3, angleMax: 4 };
      const sign = rng.next() < 0.5 ? -1 : 1;
      manualSpray = sign * (15 + rng.next() * 12);
    } else if (r < 0.85) {
      // Line drive over the infielders — the bread-and-butter outfield single.
      profile = { evMin: 88, evMax: 100, angleMin: 10, angleMax: 22 };
    } else {
      // Bloop / Texas leaguer — high arc, low velocity, drops in shallow OF.
      profile = { evMin: 64, evMax: 80, angleMin: 26, angleMax: 42 };
    }
  } else if (outcome === 'double') {
    // Trimodal: down the line, gap, and the occasional straight-away wall ball.
    const sign = rng.next() < 0.5 ? -1 : 1;
    const r = rng.next();
    if (r < 0.35) {
      manualSpray = sign * (26 + rng.next() * 16); // ±26..±42 — down the line
    } else if (r < 0.80) {
      manualSpray = sign * (12 + rng.next() * 14); // ±12..±26 — gap
    } else {
      manualSpray = sign * rng.next() * 14; // ±0..±14 — straight away
    }
  }

  // Player-rating modulation, layered on top of the profile band. Pitcher
  // suppression uses the fatigue-adjusted stamina, so a gassed starter gives
  // up more exit velocity than the same arm in the first inning.
  const fatigue = fatigueLoss(pitcher, pitchCount);
  const powerAdj = (batter.ratings.power - 50) * 0.12;
  const contactAdj = (batter.ratings.contact - 50) * 0.04;
  const pitcherSuppression = (pitcher.ratings.stamina - fatigue - 50) * 0.08;
  let exitVeloMph =
    profile.evMin + rng.next() * (profile.evMax - profile.evMin) + powerAdj - pitcherSuppression;
  exitVeloMph = clamp(exitVeloMph, 45, 115); // hard cap at 115 — top-end MLB EV.

  let launchAngleDeg = profile.angleMin + rng.next() * (profile.angleMax - profile.angleMin);
  launchAngleDeg += contactAdj * 0.3; // good contact tightens angle slightly upward
  launchAngleDeg = clamp(launchAngleDeg, -25, 88);

  const sprayBias = batter.bats === 'L' ? +6 : batter.bats === 'R' ? -6 : 0;
  let sprayDeg: number;
  if (manualSpray !== undefined) {
    sprayDeg = manualSpray + sprayBias;
  } else if (profile.sprayCenter !== undefined && profile.spraySpread !== undefined) {
    sprayDeg = profile.sprayCenter + (rng.next() - 0.5) * 2 * profile.spraySpread + sprayBias;
  } else {
    // Triangular distribution peaked at 0° — most contact goes up the middle,
    // pull/oppo corners are rarer. (U1 - U2) is symmetric triangular on [-1,1].
    sprayDeg = 42 * (rng.next() - rng.next()) + sprayBias;
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

// Each coverage boundary combines two independent adjustments:
//   1. `shiftDeg` — head coach's tactical infield shift: >0 pushes all
//      boundaries toward RF (vs LHB pull), <0 toward LF (vs RHB pull).
//   2. `rangeOf` — per-fielder range rating shifts each boundary individually:
//      a high-range SS steals ≤2.5° from P / 3B; a low-range one cedes it.
// Nominal zones: 3B(<-18), SS(-18…-1), P(-1…+1), 2B(+1…+18), 1B(>+18).
// The pitcher slot is intentionally narrow — a real pitcher only fields
// balls hit straight back at the mound. Anything pulled even slightly
// goes to SS or 2B, who have far better closing range from their depth.
// Exported for unit tests; not part of the public API.
const RANGE_SHIFT_SCALE = 0.05; // degrees per rating point from 50
export const pickInfieldPosition = (
  spray: number,
  shiftDeg: number,
  rangeOf: (pos: Position) => number = () => 50,
): Position => {
  const bnd = (left: Position, right: Position, nominal: number): number =>
    nominal + shiftDeg + (rangeOf(left) - rangeOf(right)) * RANGE_SHIFT_SCALE;
  if (spray < bnd('3B', 'SS', -18)) return '3B';
  if (spray < bnd('SS', 'P',   -1)) return 'SS';
  if (spray < bnd('P',  '2B',   1)) return 'P';
  if (spray < bnd('2B', '1B',  18)) return '2B';
  return '1B';
};

// Tighter CF band than naive equal thirds because the triangular spray
// distribution (peaked at 0deg) would otherwise hand center field >55% of
// outfield chances. Real MLB CF gets ~38-40%; this lands in that range.
const pickOutfieldPosition = (spray: number, shiftDeg: number): Position => {
  if (spray < -10 + shiftDeg) return 'LF';
  if (spray < 10 + shiftDeg) return 'CF';
  return 'RF';
};

// Direction-aware shift: head coach's `infieldShiftDeg` (always non-negative)
// is signed by the batter's pull side. LHB pull right → +shift; RHB pull
// left → -shift; switch hitters get no shift (no clear pull tendency).
const shiftDegForBats = (bats: Bats, mods: CoachingMods): number => {
  if (bats === 'L') return +mods.infieldShiftDeg;
  if (bats === 'R') return -mods.infieldShiftDeg;
  return 0;
};

// Balls landing within this radius of home plate (very weak dribblers,
// foul-line tappers, popups in front of the plate) are catcher's
// responsibility — the pitcher would have to charge a long way to beat
// the catcher to the ball. Using landingY as the proxy because the
// catcher sits ~8 ft behind the plate while the mound is 60.5 ft out.
const CATCHER_FIELDING_RADIUS_FT = 22;
const fielderPositionFor = (
  outcome: AtBatOutcome,
  ballPath: BallPath,
  shiftDeg: number,
  rangeOf: (pos: Position) => number = () => 50,
): Position | null => {
  const spray = sprayDegOf(ballPath);
  // Distance from home plate to the landing spot. Anything within the
  // catcher's range gets fielded by C — short of forcing the pitcher to
  // sprint off the mound for a five-foot dribbler.
  const landingDistFt = Math.hypot(ballPath.landingX, ballPath.landingY);
  switch (outcome) {
    case 'groundout':
    case 'double-play':
    case 'fielders-choice':
    case 'popout':
      if (landingDistFt < CATCHER_FIELDING_RADIUS_FT) return 'C';
      return pickInfieldPosition(spray, shiftDeg, rangeOf);
    case 'flyout':
    case 'sac-fly':
      return pickOutfieldPosition(spray, shiftDeg);
    case 'lineout':
      return ballPath.launchAngleDeg < 14
        ? pickInfieldPosition(spray, shiftDeg, rangeOf)
        : pickOutfieldPosition(spray, shiftDeg);
    default:
      return null;
  }
};

// Per-chance error probability. Two dials:
//   1) Base spread by glove rating — widened so an iron-glove butcher errs
//      noticeably more than league-average and an elite glove almost never.
//   2) Tough-hop multiplier on hot-shot batted balls (>95 mph EV). A great
//      glove still scoops them; a poor glove eats more bad hops on smashes.
const errorProbForGlove = (glove: number, exitVeloMph: number): number => {
  const base = 0.022 - (glove - 50) * 0.0009;
  const toughHopBonus = exitVeloMph > 95 ? Math.max(0, 95 - glove) * 0.00025 : 0;
  return clamp(base + toughHopBonus, 0.002, 0.085);
};

// Multiplier applied to in-play hit-quality from a batter's xBA grid at the
// pitch's location. Center it around the league mean (~1.0 by construction)
// so most pitches barely move the needle, but a pitch into a hitter's true
// hot zone (xBA ~ 1.3) raises HR/2B odds noticeably while a weakness zone
// (xBA ~ 0.7) suppresses them.
const xBAMultFor = (batter: Player, locationZone: number): number => {
  const z = batter.batterZonePrefs.xBA[locationZone];
  if (z === undefined) return 1;
  return z;
};

const simulateInPlay = (
  batter: Player,
  pitcher: Player,
  pitchCount: number,
  outs: number,
  bases: BasesState,
  rng: PRNG,
  quirk: StadiumQuirk | undefined,
  dimensions: StadiumDimensions | undefined,
  highLeverage: boolean,
  locationZone: number,
): InPlayResult => {
  // Outcome roll from a rating-modulated probability table, then multiplied
  // by stadium-quirk adjustments (Phase 4 plugin). Quirks shift odds; they
  // never change ratings or fabricate outcomes directly.
  // Platoon penalty: when batter and pitcher share handedness, batter loses
  // effective contact AND power. `platoonBias` >50 amplifies the penalty;
  // <50 dampens it (reverse-split hitter). Coefficient calibrated so a
  // typical bias-65 hitter sees a meaningful but not dominant same-hand dip.
  const sameHand =
    (batter.bats === 'L' && pitcher.throws === 'L') ||
    (batter.bats === 'R' && pitcher.throws === 'R');
  const platoonStrength = sameHand ? (batter.ratings.platoonBias - 50) * 0.0025 : 0;
  // Composure (pitcher) vs clutch (batter) net out in high-leverage states.
  // 50 vs 50 = 0; both elite ≈ 0; one-sided shifts by up to ~3% on each rate.
  const leverageNet = highLeverage
    ? (batter.ratings.clutch - 50 - (pitcher.ratings.composure - 50)) * 0.0006
    : 0;

  const power = batter.ratings.power - 50 - platoonStrength * 80;
  const speed = batter.ratings.speed - 50;
  const contact = batter.ratings.contact - 50 - platoonStrength * 100;
  // `command` keeps pitches off the heart of the plate → fewer barrels →
  // lower HR rate. `groundballTendency` further suppresses HR + bumps
  // grounders. `velocity` slightly suppresses contact-quality across the
  // board, fading as the pitcher tires.
  const fatigue = fatigueLoss(pitcher, pitchCount);
  const cmd = pitcher.ratings.command - 50;
  const gb = pitcher.ratings.groundballTendency - 50;
  const stuff = (pitcher.ratings.velocity - fatigue - 50) * 0.5;

  const adj: QuirkAdjustments = adjustmentsFor(quirk);
  // Batter zone preference at the pitch location. The scalar tilts the
  // hit-rate band, so a pitch served up in a hitter's hot zone produces
  // more barrels and a pitch jammed at a weak spot produces more weak
  // contact. The shift on each rate is intentionally modest — the zone
  // grid is one input among many, not a dominator.
  const xBAMult = xBAMultFor(batter, locationZone);
  const xBABoost = (xBAMult - 1) * 0.6; // -0.18..+0.18 from typical xBA span
  // Base HR rate bumped 0.040 → 0.043 (Phase 5) to absorb the ~5-8% of
  // rolled HRs the fence-aware filter downgrades to wall-balls in average
  // parks. Without this bump, league-wide HR/G would visibly drift down.
  const hrRate = Math.max(
    0.005,
    (0.043 + power * 0.0018 - cmd * 0.0008 - gb * 0.0006 - stuff * 0.0004 + leverageNet) *
      adj.hrRateMul *
      (1 + xBABoost),
  );
  const dblRate = Math.max(
    0.02,
    (0.07 + power * 0.0009 + contact * 0.0004 - stuff * 0.0002 + leverageNet * 0.5) *
      adj.doubleRateMul *
      (1 + xBABoost * 0.7),
  );
  // Speed lifts triples (raw foot speed in the gap) and gives a small bump
  // to overall single rate (legging out grounders + beating throws on bloop
  // hits). Infield-hit conversion happens after the outcome is picked, below.
  const tplRate = Math.max(0.001, (0.005 + speed * 0.0006) * adj.tripleRateMul);
  const sglRate = Math.max(
    0.05,
    (0.2 + contact * 0.0011 + speed * 0.0006 - stuff * 0.0003 + leverageNet * 0.5) *
      (1 + xBABoost * 0.5),
  );

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

    // Infield-hit conversion: a fast batter sometimes legs out a grounder
    // that would otherwise be an out. Caps near MLB's fastest "legs it out
    // ~12% of grounders" rate. Force-play states (DP / FC) are excluded —
    // those already accounted for the lead runner.
    if (outcome === 'groundout') {
      const infieldHitProb = clamp((batter.ratings.speed - 50) * 0.0015, 0, 0.06);
      if (rng.next() < infieldHitProb) outcome = 'single';
    }
  }

  const ballPath = buildBallPath(outcome, batter, pitcher, pitchCount, rng);

  // Fence-aware HR check (Phase 5). When dimensions are provided, validate
  // that a rolled home-run trajectory actually clears the wall at its spray
  // angle. The "effective" wall distance bumps the raw fence by 1.5 ft per
  // foot of wall height — a rough physics shortcut so a tall wall (Sapwood,
  // Beacon Field) can still rob what would otherwise be a HR.
  //
  // Downgrade rule (per the planning answer "Mixed by trajectory"):
  //   - High launch angle near the wall → wall-saving flyout (caught at the
  //     warning track).
  //   - Low rope or short of the wall   → wall-ball double.
  //
  // The BallPath itself is preserved so the renderer plays the same high
  // trajectory; the choreo treats it as the new outcome.
  if (outcome === 'home-run' && dimensions) {
    const sprayDeg =
      (Math.atan2(ballPath.landingX, Math.max(1, ballPath.landingY)) * 180) /
      Math.PI;
    const landingDist = Math.hypot(ballPath.landingX, ballPath.landingY);
    const wallDist = wallDistanceAtAngle(dimensions, sprayDeg);
    const effectiveWall = wallDist + dimensions.wallHeightFt * 1.5;
    if (landingDist < effectiveWall) {
      const nearWall = landingDist >= effectiveWall - 30;
      if (ballPath.launchAngleDeg > 28 && nearWall) {
        outcome = 'flyout';
      } else {
        outcome = 'double';
      }
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
  rng: PRNG,
  mods: CoachingMods,
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
      // 3B coach decides whether the runner on 2B attempts to score on the
      // single. Aggression-driven roll: a high-aggression coach sends in
      // most cases (~96%); a low-aggression coach holds more (~74%). Held
      // runners stop at 3B; that downstream effect cascades into the runner
      // from 1B holding at 2B (no double-stack on 3rd).
      let secondHeldAtThird = false;
      if (bases.second) {
        if (rng.next() < mods.sendOnSingleRate) {
          score(bases.second, 2);
        } else {
          advanceTo(bases.second, 2, 3);
          secondHeldAtThird = true;
        }
      }
      if (bases.first) {
        if (secondHeldAtThird) advanceTo(bases.first, 1, 2);
        else advanceTo(bases.first, 1, 3);
      }
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
      // 3B coach's tag-up call. A high-judgment coach reads the catch and
      // throw better and lands the runner safely (~99%); a poor judgment
      // coach holds the runner more often (~85%). Failures here are
      // modeled as "didn't tag" — the runner stays on third — rather than
      // out-at-home, which would inflate outs above the +1 the sac-fly
      // outcome encodes.
      if (bases.third) {
        if (rng.next() < mods.tagUpSuccessRate) {
          score(bases.third, 3);
        } else {
          next.third = bases.third;
        }
      }
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
  readonly outcome: AtBatOutcome | null; // null = at-bat aborted by 3rd-out steal/pickoff
  readonly runsScored: number;
  readonly outsAdded: number;
  readonly newBases: BasesState;
  /** True when batter completed a PA — caller advances the batting order. */
  readonly batterFaced: boolean;
}

let pitchSeq = 0;

const simulateAtBat = (
  state: GameState,
  rng: PRNG,
  playerIndex: ReadonlyMap<PlayerId, Player>,
  stadiumQuirk: StadiumQuirk | undefined,
  stadiumDimensions: StadiumDimensions | undefined,
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

  // Build the active fielder map once for the at-bat — used by the
  // baserunning resolver to look up OF backup positions on errant
  // pickoffs. Pitcher slot reflects the active arm even after a sub.
  const activeFielders = new Map<Position, Player>();
  for (const [pos, id] of Object.entries(fielding.input.defenseByPosition)) {
    if (!id) continue;
    const p = playerIndex.get(id);
    if (p) activeFielders.set(pos as Position, p);
  }
  activeFielders.set('P', pitcher);
  const catcherForSteal = activeFielders.get('C');

  // Mods scoped to this at-bat. Coaching modifiers don't change mid-PA.
  const fieldingMods = modsForCoaching(fielding.input.coachingStaff);
  const battingMods = modsForCoaching(batting.input.coachingStaff);

  // Defensive geometry — also stable across the PA. Used both at contact
  // time (to stamp `fielderId` on the contact event) and afterward for the
  // error roll. The shift is signed by the batter's pull side; per-fielder
  // range nudges each zone boundary individually.
  const shiftDeg = shiftDegForBats(batter.bats, fieldingMods);
  const infielderRangeOf = (pos: Position): number => {
    const id = pos === 'P' ? pitcherId : fielding.input.defenseByPosition[pos];
    if (!id) return 50;
    return playerIndex.get(id)?.ratings.range ?? 50;
  };

  let balls = 0;
  let strikes = 0;
  let outcome: AtBatOutcome | null = null;
  let inPlayResult: InPlayResult | null = null;
  let responsibleFielderId: PlayerId | undefined;
  // Track which (runnerId, base) lead events we've already fired this PA so
  // a runner only "establishes a lead" once per arrival on a base.
  const leadsEmitted = state.leadsEmitted;
  let abortedRunsScored = 0;

  while (outcome === null) {
    // Between-pitch baserunning: lead emission, pickoff, errant throw +
    // OF backup tag, and steal attempts. May add outs and runs and may
    // end the half-inning before the pitch fires.
    const br = resolveBetweenPitches(
      {
        bases: state.bases,
        pitcher,
        catcher: catcherForSteal,
        fielders: activeFielders,
        fieldingMods,
        battingMods,
        outs: state.outs,
        t: state.t,
        leadsEmitted,
      },
      rng,
      (id) => playerIndex.get(id),
    );
    for (const ev of br.events) state.events.push(ev);
    state.bases = br.bases;
    state.outs += br.outsAdded;
    state.t = br.t;
    if (br.runsScored > 0) {
      if (battingSide_ === 'home') state.runs.home += br.runsScored;
      else state.runs.away += br.runsScored;
      abortedRunsScored += br.runsScored;
    }
    if (br.endsHalfInning) {
      // 3rd out came on a steal or pickoff — abort the at-bat without
      // emitting an atBatEnd. Caller keeps the batting index so the same
      // batter leads off the next half-inning.
      return {
        outcome: null,
        runsScored: abortedRunsScored,
        outsAdded: br.outsAdded,
        newBases: state.bases,
        batterFaced: false,
      };
    }

    const ptype = pitchTypeFor(pitcher, rng);
    // Snapshot the pitch count for this pitch so simulatePitch and any
    // downstream simulateInPlay see the same fatigue value.
    const pitchCountForThisPitch = fielding.pitcherPitches;
    const po = simulatePitch(pitcher, batter, { balls, strikes }, ptype, pitchCountForThisPitch, rng);
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
          pitchCountForThisPitch,
          state.outs,
          state.bases,
          rng,
          stadiumQuirk,
          stadiumDimensions,
          highLeverage,
          po.locationZone,
        );
        outcome = inPlayResult.outcome;
        // Stamp the responsible fielder onto the contact event so the
        // renderer animates the correct sprite. Without this, the renderer
        // falls back to a Cartesian-closest heuristic that hands the
        // pitcher (mound at y≈60ft) almost every grounder up the middle.
        const fieldPos = fielderPositionFor(
          outcome,
          inPlayResult.ballPath,
          shiftDeg,
          infielderRangeOf,
        );
        responsibleFielderId =
          fieldPos === null
            ? undefined
            : fieldPos === 'P'
              ? pitcherId
              : (fielding.input.defenseByPosition[fieldPos] ?? undefined);
        state.events.push({
          t: state.t,
          kind: 'contact',
          batterId,
          ballPath: inPlayResult.ballPath,
          ...(responsibleFielderId !== undefined ? { fielderId: responsibleFielderId } : {}),
        });
        break;
      }
    }
  }

  // Fielder-error roll: would-be outs convert to reached-on-error based on
  // the responsible fielder's glove rating. The responsible fielder was
  // picked at contact time and stamped onto the contact event.
  if (inPlayResult && responsibleFielderId !== undefined) {
    const fielder = playerIndex.get(responsibleFielderId);
    if (
      fielder &&
      rng.next() < errorProbForGlove(fielder.ratings.glove, inPlayResult.ballPath.exitVeloMph)
    ) {
      outcome = 'reached-on-error';
    }
  }

  // Apply baserunning.
  const advance = advanceForOutcome(outcome, batterId, state.bases, rng, battingMods);

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

  // Clear lead bookkeeping for any base that ended empty so the next
  // arriving runner re-establishes a fresh lead. We rebuild the keys
  // for occupied bases, then drop everything else.
  const stillOnBase = new Set<string>();
  if (state.bases.first) stillOnBase.add(`${state.bases.first}@1`);
  if (state.bases.second) stillOnBase.add(`${state.bases.second}@2`);
  if (state.bases.third) stillOnBase.add(`${state.bases.third}@3`);
  for (const key of Array.from(state.leadsEmitted)) {
    if (!stillOnBase.has(key)) state.leadsEmitted.delete(key);
  }

  return {
    outcome,
    runsScored: advance.runsScored + abortedRunsScored,
    outsAdded: advance.outsAdded,
    newBases: advance.newBases,
    batterFaced: true,
  };
};

// ---- inning / game loop -----------------------------------------------

const playHalfInning = (
  state: GameState,
  rng: PRNG,
  playerIndex: ReadonlyMap<PlayerId, Player>,
  stadiumQuirk: StadiumQuirk | undefined,
  stadiumDimensions: StadiumDimensions | undefined,
): void => {
  state.outs = 0;
  state.bases = { first: null, second: null, third: null };
  state.leadsEmitted.clear();
  while (state.outs < 3) {
    const result = simulateAtBat(state, rng, playerIndex, stadiumQuirk, stadiumDimensions);
    // Aborted at-bats already updated state.outs and state.bases via the
    // baserunning resolver; the return value's outsAdded matches the delta.
    if (result.batterFaced) {
      state.outs += result.outsAdded;
      state.bases = result.newBases;
    }
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
    leadsEmitted: new Set<string>(),
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
    playHalfInning(state, rng, input.playerIndex, input.stadiumQuirk, input.stadiumDimensions);

    // Skip bottom of 9th+ if home is winning.
    if (state.inning >= 9 && state.runs.home > state.runs.away) break;
    state.half = 'bottom';
    playHalfInning(state, rng, input.playerIndex, input.stadiumQuirk, input.stadiumDimensions);

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
