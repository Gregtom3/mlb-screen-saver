import type {
  Player,
  PlayerRatings,
  PersonalityFlag,
  Position,
  Bats,
  Throws,
  Team,
  TeamId,
} from '../world/types.js';
import type { PRNG } from '../sim/prng.js';
import { FIRST_NAMES, LAST_NAMES, HOMETOWNS } from './names.js';

const FOUNDING_YEAR = 2026;

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

// Position-specific rating biases, in raw points before clamp.
// Pitchers split between starter (high stamina) and reliever (lower) downstream.
const POSITION_BIAS: Record<Position, RatingBias> = {
  P: { stamina: +20, arm: +12, composure: +6, contact: -25, power: -25, speed: -10, eye: -10, fielding: -5 },
  C: { arm: +14, fielding: +12, composure: +6, speed: -18, power: +2 },
  '1B': { power: +14, fielding: +4, speed: -10 },
  '2B': { speed: +12, fielding: +12, eye: +4, power: -8 },
  '3B': { arm: +12, power: +6, fielding: +4 },
  SS: { speed: +14, fielding: +14, arm: +10, power: -10 },
  LF: { power: +8, contact: +4, fielding: -2 },
  CF: { speed: +14, fielding: +12, arm: +4 },
  RF: { power: +8, arm: +10 },
  DH: { power: +14, contact: +8, fielding: -25, arm: -25, speed: -10 },
};

const PERSONALITY_FLAGS: readonly PersonalityFlag[] = [
  'clutch',
  'streaky',
  'injury-prone',
  'durable',
  'hot-headed',
  'glove-first',
];

const clampRating = (n: number): number => Math.max(1, Math.min(99, Math.round(n)));

// Bell-curve via average of 3 uniform draws, then biased and scaled.
const bellRating = (rng: PRNG, mean = 50, spread = 28): number => {
  const avg = (rng.next() + rng.next() + rng.next()) / 3; // central limit-ish, range 0..1
  const centered = avg - 0.5; // ~ -0.5..0.5
  return clampRating(mean + centered * 2 * spread);
};

const generateRatings = (rng: PRNG, position: Position, isStarter: boolean): PlayerRatings => {
  const base: PlayerRatings = {
    contact: bellRating(rng),
    power: bellRating(rng),
    eye: bellRating(rng),
    speed: bellRating(rng),
    fielding: bellRating(rng),
    arm: bellRating(rng),
    stamina: bellRating(rng),
    composure: bellRating(rng),
  };
  const biases = POSITION_BIAS[position];
  const biased: PlayerRatings = {
    contact: clampRating(base.contact + (biases.contact ?? 0)),
    power: clampRating(base.power + (biases.power ?? 0)),
    eye: clampRating(base.eye + (biases.eye ?? 0)),
    speed: clampRating(base.speed + (biases.speed ?? 0)),
    fielding: clampRating(base.fielding + (biases.fielding ?? 0)),
    arm: clampRating(base.arm + (biases.arm ?? 0)),
    stamina: clampRating(
      base.stamina + (biases.stamina ?? 0) + (position === 'P' ? (isStarter ? +12 : -10) : 0),
    ),
    composure: clampRating(base.composure + (biases.composure ?? 0)),
  };
  return biased;
};

const generatePersonality = (rng: PRNG): readonly PersonalityFlag[] => {
  const flags: PersonalityFlag[] = [];
  if (rng.next() < 0.32) flags.push(rng.pick(PERSONALITY_FLAGS));
  // a second flag is rarer; dedupe.
  if (rng.next() < 0.1) {
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
    };
    players.push(player);
  });
  return { players };
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
