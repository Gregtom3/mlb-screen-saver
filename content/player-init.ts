import type {
  BatterZonePrefs,
  Player,
  PlayerRatings,
  PersonalityFlag,
  PitcherTendencies,
  Position,
  Bats,
  Throws,
  Team,
  TeamId,
  ZoneTuple,
} from '../world/types.js';
import type { PRNG } from '../sim/prng.js';
import { FIRST_NAMES, LAST_NAMES, HOMETOWNS } from './names.js';

// Calendar year of season 1. Exported so age math stays consistent
// everywhere (player birthYears are calendar years).
export const FOUNDING_YEAR = 2026;

interface Slot {
  readonly position: Position;
  readonly inMinors: boolean;
}

// Active 25 + minors 15 = 40 per team.
const ROSTER_SLOTS: readonly Slot[] = [
  // Active 25 — Pitching: 5 SP + 7 RP (we encode style via stamina, not via subtype)
  ...Array.from({ length: 5 }, () => ({ position: 'P' as Position, inMinors: false })), // SP
  ...Array.from({ length: 7 }, () => ({ position: 'P' as Position, inMinors: false })), // RP
  // Active 25 — Position players
  { position: 'C', inMinors: false },
  { position: 'C', inMinors: false }, // backup C
  { position: '1B', inMinors: false },
  { position: '2B', inMinors: false },
  { position: '3B', inMinors: false },
  { position: 'SS', inMinors: false },
  { position: 'LF', inMinors: false },
  { position: 'CF', inMinors: false },
  { position: 'RF', inMinors: false },
  { position: 'DH', inMinors: false },
  // 3 bench utility
  { position: '2B', inMinors: false }, // INF utility
  { position: 'CF', inMinors: false }, // OF utility
  { position: '3B', inMinors: false }, // super-utility
  // Minors 15
  ...Array.from({ length: 7 }, () => ({ position: 'P' as Position, inMinors: true })),
  { position: 'C', inMinors: true },
  { position: '1B', inMinors: true },
  { position: '2B', inMinors: true },
  { position: '3B', inMinors: true },
  { position: 'SS', inMinors: true },
  { position: 'LF', inMinors: true },
  { position: 'CF', inMinors: true },
  { position: 'RF', inMinors: true },
];

type RatingKey = keyof PlayerRatings;
type RatingBias = Partial<Record<RatingKey, number>>;

// Position-specific rating biases, in raw points before clamp. Tuned so each
// archetype reads correctly: pitchers can't hit, catchers have arms, SS is
// rangy, DH is a slugger. Catcher-only fields (framing, blocking, popTime)
// are biased way down for non-catchers and up for catchers.
const POSITION_BIAS: Record<Position, RatingBias> = {
  P: {
    stamina: +20, armStrength: +10, command: +10, control: +10,
    velocity: +12, breakingBall: +8, changeup: +6, groundballTendency: +6,
    holdRunners: +4, composure: +6,
    contact: -25, power: -25, speed: -10, discipline: -10, glove: -5,
    range: -8, armAccuracy: -2, transferSpeed: -10, bunting: -10,
    pitchRecognition: -6, baserunningIQ: -4, stealing: -10,
    framing: -40, blocking: -40, popTime: -40,
  },
  C: {
    armStrength: +12, armAccuracy: +14, glove: +12, framing: +28,
    blocking: +26, popTime: +26, composure: +6, command: +4,
    speed: -18, range: -10, power: +2, stealing: -10, baserunningIQ: -4,
    velocity: -30, control: -30, breakingBall: -30, changeup: -30,
    groundballTendency: -30, holdRunners: -30, stamina: -10,
  },
  '1B': {
    power: +14, glove: +4, range: -6, speed: -10, transferSpeed: -2,
    armStrength: -4, framing: -30, blocking: -30, popTime: -30,
    velocity: -30, control: -30, breakingBall: -30, changeup: -30,
    groundballTendency: -30, holdRunners: -30, stamina: -10,
  },
  '2B': {
    speed: +12, glove: +12, range: +10, transferSpeed: +14,
    discipline: +4, power: -8, armStrength: -2,
    framing: -30, blocking: -30, popTime: -30,
    velocity: -30, control: -30, breakingBall: -30, changeup: -30,
    groundballTendency: -30, holdRunners: -30, stamina: -10,
  },
  '3B': {
    armStrength: +12, armAccuracy: +6, power: +6, glove: +4, range: +2,
    framing: -30, blocking: -30, popTime: -30,
    velocity: -30, control: -30, breakingBall: -30, changeup: -30,
    groundballTendency: -30, holdRunners: -30, stamina: -10,
  },
  SS: {
    speed: +14, glove: +14, range: +14, armStrength: +10, armAccuracy: +8,
    transferSpeed: +14, power: -10,
    framing: -30, blocking: -30, popTime: -30,
    velocity: -30, control: -30, breakingBall: -30, changeup: -30,
    groundballTendency: -30, holdRunners: -30, stamina: -10,
  },
  LF: {
    power: +8, contact: +4, glove: -2, range: -2, armStrength: -4,
    framing: -30, blocking: -30, popTime: -30,
    velocity: -30, control: -30, breakingBall: -30, changeup: -30,
    groundballTendency: -30, holdRunners: -30, stamina: -10,
  },
  CF: {
    speed: +14, glove: +12, range: +12, armStrength: +2, baserunningIQ: +6,
    framing: -30, blocking: -30, popTime: -30,
    velocity: -30, control: -30, breakingBall: -30, changeup: -30,
    groundballTendency: -30, holdRunners: -30, stamina: -10,
  },
  RF: {
    power: +8, armStrength: +12, armAccuracy: +6, range: -2,
    framing: -30, blocking: -30, popTime: -30,
    velocity: -30, control: -30, breakingBall: -30, changeup: -30,
    groundballTendency: -30, holdRunners: -30, stamina: -10,
  },
  DH: {
    power: +14, contact: +8, discipline: +4,
    glove: -25, armStrength: -25, range: -25, armAccuracy: -25,
    transferSpeed: -25, speed: -10, bunting: -8,
    framing: -40, blocking: -40, popTime: -40,
    velocity: -30, control: -30, breakingBall: -30, changeup: -30,
    groundballTendency: -30, holdRunners: -30, stamina: -10,
  },
};

const PERSONALITY_FLAGS: readonly PersonalityFlag[] = ['hot-headed', 'glove-first'];

const RATING_KEYS: readonly RatingKey[] = [
  'contact', 'power', 'discipline', 'pitchRecognition', 'bunting',
  'platoonBias', 'clutch',
  'velocity', 'control', 'command', 'stamina', 'breakingBall', 'changeup',
  'holdRunners', 'groundballTendency',
  'range', 'glove', 'armStrength', 'armAccuracy', 'transferSpeed',
  'framing', 'blocking', 'popTime',
  'speed', 'stealing', 'baserunningIQ',
  'composure', 'consistency', 'durability', 'workEthic', 'coachability',
];

const clampRating = (n: number): number => Math.max(1, Math.min(99, Math.round(n)));

// Bell-curve via average of 3 uniform draws, then biased and scaled.
const bellRating = (rng: PRNG, mean = 50, spread = 28): number => {
  const avg = (rng.next() + rng.next() + rng.next()) / 3; // central limit-ish
  const centered = avg - 0.5; // ~ -0.5..0.5
  return clampRating(mean + centered * 2 * spread);
};

const generateRatings = (rng: PRNG, position: Position, isStarter: boolean): PlayerRatings => {
  const biases = POSITION_BIAS[position];
  // Generate every rating from a bell curve, then layer position bias.
  const out = {} as Record<RatingKey, number>;
  for (const key of RATING_KEYS) {
    const base = bellRating(rng);
    const bias = biases[key] ?? 0;
    // Pitcher stamina also shifts by SP/RP.
    const extra = key === 'stamina' && position === 'P' ? (isStarter ? +12 : -10) : 0;
    out[key] = clampRating(base + bias + extra);
  }
  return out as PlayerRatings;
};

const generatePersonality = (rng: PRNG): readonly PersonalityFlag[] => {
  const flags: PersonalityFlag[] = [];
  if (rng.next() < 0.18) flags.push(rng.pick(PERSONALITY_FLAGS));
  // a second flag is rarer; dedupe.
  if (rng.next() < 0.04) {
    const second = rng.pick(PERSONALITY_FLAGS);
    if (!flags.includes(second)) flags.push(second);
  }
  return flags;
};

const generateBatsThrows = (
  rng: PRNG,
  position: Position,
): { bats: Bats; throws: Throws } => {
  // Catchers always throw R in our world (simplification).
  const throws: Throws = position === 'C' ? 'R' : rng.next() < 0.3 ? 'L' : 'R';
  const r = rng.next();
  const bats: Bats = r < 0.5 ? 'R' : r < 0.85 ? 'L' : 'S';
  return { bats, throws };
};

const generateBirthYear = (rng: PRNG, inMinors: boolean): number => {
  // Active mean age 27, minors mean age 21. Spread 3y.
  const mean = inMinors ? 21 : 27;
  const ageJitter = (rng.next() + rng.next() + rng.next()) / 3 - 0.5; // -0.5..0.5
  const age = Math.round(mean + ageJitter * 8);
  return FOUNDING_YEAR - Math.max(18, Math.min(40, age));
};

// Listed heights cluster around the MLB mean (~6'1") with a tighter spread.
// Pitchers and 1B/DH skew slightly taller; middle infielders and CF skew
// shorter — a small extra knob beyond the bell-curve so the on-field sprite
// mix has visible variety.
const HEIGHT_BIAS: Partial<Record<Position, number>> = {
  P: +0.15,
  '1B': +0.1,
  DH: +0.05,
  '2B': -0.1,
  SS: -0.1,
  CF: -0.05,
};

const generateHeightFt = (rng: PRNG, position: Position): number => {
  // Bell-curve mean 6.05 ft, total spread ~10 inches. Clamped to a credible
  // band so no one looks cartoonish.
  const avg = (rng.next() + rng.next() + rng.next()) / 3;
  const centered = avg - 0.5; // -0.5..0.5
  const raw = 6.05 + centered * 0.85 + (HEIGHT_BIAS[position] ?? 0);
  return Math.max(5.55, Math.min(6.6, Math.round(raw * 100) / 100));
};

// Procedural zone-fingerprint generators. Both produce a 10-tuple indexed
// by ZoneIndex (0..9). Index 0 = outside the zone; 1..9 = the 3×3 grid. The
// distributions are intentionally idiosyncratic — each pitcher should have a
// recognizable "outer-edge guy" or "high heat" signature, and each batter
// should have a clearly preferred quadrant once enough PAs have accumulated.

const zoneTuple = (vs: readonly number[]): ZoneTuple => {
  if (vs.length !== 10) throw new Error('zoneTuple needs 10 values');
  return [vs[0]!, vs[1]!, vs[2]!, vs[3]!, vs[4]!, vs[5]!, vs[6]!, vs[7]!, vs[8]!, vs[9]!] as ZoneTuple;
};

const generatePitcherTendencies = (
  rng: PRNG,
  ratings: PlayerRatings,
): PitcherTendencies => {
  // Pick an archetype hot zone — the corner / edge a pitcher lives at — and
  // build a soft Gaussian blob over the 3×3 grid centered there. Command +
  // groundballTendency tilt the blob low; high-velocity arms climb up in
  // the zone.
  const archetypeRoll = rng.next();
  // Each archetype is a (col, row) center, both in [0..2] grid coords.
  // 0,0 = top-left (zone 1); 2,2 = bottom-right (zone 9).
  let cx: number;
  let cy: number;
  if (archetypeRoll < 0.18) {
    // High-and-tight (RHP-style up-in)
    cx = 0.4 + rng.next() * 0.6;
    cy = 0.0 + rng.next() * 0.5;
  } else if (archetypeRoll < 0.36) {
    // Down-and-away
    cx = 1.6 + rng.next() * 0.4;
    cy = 1.6 + rng.next() * 0.4;
  } else if (archetypeRoll < 0.5) {
    // Low sinker-ball — stays at the knees
    cx = 0.6 + rng.next() * 0.8;
    cy = 1.7 + rng.next() * 0.3;
  } else if (archetypeRoll < 0.62) {
    // High four-seam, top of zone
    cx = 0.5 + rng.next() * 1.0;
    cy = 0.0 + rng.next() * 0.4;
  } else {
    // Generic "middle but a little off-center" — most pitchers
    cx = 0.6 + rng.next() * 0.8;
    cy = 0.6 + rng.next() * 0.8;
  }
  // Velocity nudges high; gb-tendency nudges low.
  cy += (ratings.groundballTendency - 50) * 0.008 - (ratings.velocity - 50) * 0.005;
  cy = Math.max(0, Math.min(2, cy));

  const sigma = 0.7 + rng.next() * 0.4; // larger = more spread, less peaky
  const weights: number[] = [];
  // Index 0 (outside) — set high enough to model raw out-of-zone rate. Pitchers
  // with low control miss the zone more often; the sim multiplies this against
  // the in-zone bucket for the actual ball/strike split, so the absolute
  // value here is just a starting bias.
  weights.push(0); // placeholder; we don't use [0] for in-zone targeting
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const dx = c - cx;
      const dy = r - cy;
      const w = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      // Add a small per-zone jitter so the heat map doesn't look perfectly
      // round.
      weights.push(w * (0.85 + rng.next() * 0.3));
    }
  }
  return { zoneWeights: zoneTuple(weights) };
};

const generateBatterZonePrefs = (
  rng: PRNG,
  ratings: PlayerRatings,
  bats: Bats,
): BatterZonePrefs => {
  // Pick a hot quadrant — the area where the hitter's bat path lives. Power
  // hitters love the inner half; contact hitters prefer middle-away. Lefty
  // and righty swings mirror each other (handle-side vs barrel-side), so
  // we flip the column for L bats. Switch hitters get a more balanced grid.
  const isContactGuy = ratings.contact > ratings.power;
  const sweetCx = isContactGuy
    ? 0.4 + rng.next() * 1.2 // anywhere middle/away for contact types
    : (rng.next() < 0.55 ? 0.0 + rng.next() * 0.9 : 1.2 + rng.next() * 0.8);
  const sweetCy = 0.6 + rng.next() * 0.9; // middle of the zone, slight low bias
  const cx = bats === 'L' ? 2 - sweetCx : sweetCx;
  const cy = sweetCy;

  // Switch hitters have a flatter prefs grid (they see fewer same-hand
  // matchups, and we approximate that as "no glaring weak zone").
  const sigma = bats === 'S' ? 1.4 : 0.95 + rng.next() * 0.4;

  // Average xBA scale. A great hitter (high contact + power) bumps the
  // baseline; a poor hitter dips it. The sim normalizes per-pitch effects
  // by dividing through the league-mean later, so this scale is mostly
  // about the *shape* across zones.
  const skill = (ratings.contact + ratings.power) / 2 - 50;
  const baseScale = 1.0 + skill * 0.0035;

  const xs: number[] = [];
  // Index 0 (outside the zone): chase rate context. Set near 1 so out-of-zone
  // contact has a "neutral" expected-BA effect — discipline-driven swings
  // tend to be defensive and average.
  xs.push(0.95);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const dx = c - cx;
      const dy = r - cy;
      const blob = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      // Map the blob to xBA in roughly [0.7, 1.3] around baseScale.
      const peak = 1.32;
      const trough = 0.72;
      const v = trough + blob * (peak - trough);
      xs.push(baseScale * v * (0.96 + rng.next() * 0.08));
    }
  }
  return { xBA: zoneTuple(xs) };
};

const SECONDARY_BY_PRIMARY: Record<Position, readonly Position[]> = {
  P: [],
  C: ['1B'],
  '1B': ['DH', '3B'],
  '2B': ['SS', '3B'],
  '3B': ['1B', 'SS'],
  SS: ['2B', '3B'],
  LF: ['CF', 'RF'],
  CF: ['LF', 'RF'],
  RF: ['LF', 'CF'],
  DH: ['1B'],
};

const pickSecondaryPositions = (rng: PRNG, primary: Position): readonly Position[] => {
  const candidates = SECONDARY_BY_PRIMARY[primary];
  if (candidates.length === 0) return [];
  if (rng.next() < 0.45) return [rng.pick(candidates)];
  return [];
};

export interface RosterGenerationResult {
  readonly players: readonly Player[];
}

export const generateRoster = (rng: PRNG, team: Team): RosterGenerationResult => {
  const players: Player[] = [];
  ROSTER_SLOTS.forEach((slot, index) => {
    const isStarter = slot.position === 'P' && !slot.inMinors && index < 5;
    const ratings = generateRatings(rng, slot.position, isStarter);
    const personality = generatePersonality(rng);
    const { bats, throws } = generateBatsThrows(rng, slot.position);
    const firstName = rng.pick(FIRST_NAMES);
    const lastName = rng.pick(LAST_NAMES);
    const hometown = rng.pick(HOMETOWNS);
    const birthYear = generateBirthYear(rng, slot.inMinors);
    const heightFt = generateHeightFt(rng, slot.position);
    const isPitcher = slot.position === 'P';
    const player: Player = {
      id: `${team.id}-${String(index).padStart(2, '0')}`,
      firstName,
      lastName,
      birthYear,
      hometown,
      bats,
      throws,
      primaryPosition: slot.position,
      secondaryPositions: pickSecondaryPositions(rng, slot.position),
      ratings,
      personality,
      teamId: team.id,
      inMinors: slot.inMinors,
      heightFt,
      ...(isPitcher
        ? { pitcherTendencies: generatePitcherTendencies(rng, ratings) }
        : {}),
      batterZonePrefs: generateBatterZonePrefs(rng, ratings, bats),
    };
    players.push(player);
  });
  return { players };
};

// A single replacement player for the offseason draft: same generation
// pipeline as initial rosters, but with caller-controlled id, position,
// roster tier, and birth year (rookies arrive young).
export interface ReplacementSpec {
  readonly id: string;
  readonly position: Position;
  readonly birthYear: number;
  readonly inMinors: boolean;
  readonly isStarterPitcher?: boolean;
}

export const generateReplacementPlayer = (
  rng: PRNG,
  team: Team,
  spec: ReplacementSpec,
): Player => {
  const ratings = generateRatings(rng, spec.position, spec.isStarterPitcher ?? false);
  const { bats, throws } = generateBatsThrows(rng, spec.position);
  const isPitcher = spec.position === 'P';
  return {
    id: spec.id,
    firstName: rng.pick(FIRST_NAMES),
    lastName: rng.pick(LAST_NAMES),
    birthYear: spec.birthYear,
    hometown: rng.pick(HOMETOWNS),
    bats,
    throws,
    primaryPosition: spec.position,
    secondaryPositions: pickSecondaryPositions(rng, spec.position),
    ratings,
    personality: generatePersonality(rng),
    teamId: team.id,
    inMinors: spec.inMinors,
    heightFt: generateHeightFt(rng, spec.position),
    ...(isPitcher ? { pitcherTendencies: generatePitcherTendencies(rng, ratings) } : {}),
    batterZonePrefs: generateBatterZonePrefs(rng, ratings, bats),
  };
};

export const generateAllPlayers = (rng: PRNG, teams: readonly Team[]): readonly Player[] => {
  const all: Player[] = [];
  for (const team of teams) {
    // Forked sub-stream per team — adding players to one team doesn't ripple to others.
    const teamRng = rng.fork(`roster:${team.id}`);
    const { players } = generateRoster(teamRng, team);
    all.push(...players);
  }
  return all;
};

// Helpful in tests: count active vs minors per team.
export const summarizeRoster = (players: readonly Player[], teamId: TeamId) => {
  const teamPlayers = players.filter((p) => p.teamId === teamId);
  return {
    total: teamPlayers.length,
    active: teamPlayers.filter((p) => !p.inMinors).length,
    minors: teamPlayers.filter((p) => p.inMinors).length,
    pitchers: teamPlayers.filter((p) => p.primaryPosition === 'P').length,
  };
};
