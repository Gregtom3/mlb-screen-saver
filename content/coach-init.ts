import type {
  Coach,
  CoachRatings,
  CoachRole,
  CoachingStaff,
  TeamId,
} from '../world/types.js';
import type { PRNG } from '../sim/prng.js';
import { FIRST_NAMES, LAST_NAMES } from './names.js';

// Ratings live on a 1-99 scale, 50 = neutral. Coaches are generated with a
// modest bell curve and a per-role bias on the rating that role uses most.
// Unused-by-role ratings still draw from the same pool so a team-wide stats
// view shows a recognizable individual (one coach happens to be a great
// motivator even if their role doesn't currently consume that field).

const clampRating = (n: number): number => Math.max(1, Math.min(99, Math.round(n)));

const bellRating = (rng: PRNG, mean = 50, spread = 22): number => {
  const avg = (rng.next() + rng.next() + rng.next()) / 3;
  return clampRating(mean + (avg - 0.5) * 2 * spread);
};

type RoleBias = Partial<Record<keyof CoachRatings, number>>;

const ROLE_BIAS: Record<CoachRole, RoleBias> = {
  head: { tactics: +10, morale: +8 },
  'first-base': { baserunningCoaching: +10, pickoffAwareness: +8 },
  'third-base': { aggression: +8, judgment: +8 },
};

const generateCoachRatings = (rng: PRNG, role: CoachRole): CoachRatings => {
  const bias = ROLE_BIAS[role];
  return {
    tactics: clampRating(bellRating(rng) + (bias.tactics ?? 0)),
    morale: clampRating(bellRating(rng) + (bias.morale ?? 0)),
    baserunningCoaching: clampRating(
      bellRating(rng) + (bias.baserunningCoaching ?? 0),
    ),
    pickoffAwareness: clampRating(
      bellRating(rng) + (bias.pickoffAwareness ?? 0),
    ),
    aggression: clampRating(bellRating(rng) + (bias.aggression ?? 0)),
    judgment: clampRating(bellRating(rng) + (bias.judgment ?? 0)),
  };
};

const generateCoach = (rng: PRNG, teamId: TeamId, role: CoachRole): Coach => ({
  id: `${teamId}-coach-${role}`,
  firstName: rng.pick(FIRST_NAMES),
  lastName: rng.pick(LAST_NAMES),
  role,
  ratings: generateCoachRatings(rng, role),
});

export const generateCoachingStaff = (
  rng: PRNG,
  teamId: TeamId,
): CoachingStaff => ({
  head: generateCoach(rng, teamId, 'head'),
  firstBase: generateCoach(rng, teamId, 'first-base'),
  thirdBase: generateCoach(rng, teamId, 'third-base'),
});
