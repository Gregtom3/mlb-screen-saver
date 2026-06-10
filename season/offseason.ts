// /season/offseason.ts — the winter between seasons, as a pure function.
//
// runOffseason(players, teams, completedYear, rng) returns next season's
// player pool: everyone ages (ratings drift along age curves), some retire,
// and each team drafts a same-position rookie per retiree so roster shapes
// never change. Deterministic: every roll comes from a per-player fork of
// the passed PRNG, so the same league + seed always produces the same
// winter — which is what lets a reload replay roster evolution exactly.

import type { Player, PlayerId, PlayerRatings, Team } from '../world/types.js';
import type { PRNG } from '../sim/prng.js';
import { FOUNDING_YEAR, generateReplacementPlayer } from '../content/index.js';

/**
 * A player's age during a given season. Season years are a 1-based counter
 * (season 1 = FOUNDING_YEAR); birth years are calendar years.
 */
export const playerAgeInSeason = (p: Player, seasonYear: number): number =>
  FOUNDING_YEAR + (seasonYear - 1) - p.birthYear;

export interface OffseasonResult {
  /** The full player pool for the next season (rookies included). */
  readonly players: readonly Player[];
  readonly retired: readonly PlayerId[];
  readonly rookies: readonly Player[];
}

// Rating groups age differently. "Physical" tools fall off hardest;
// "skill" holds (and grows) longest; "talent" peaks in the late 20s.
// Tendencies/makeup (platoonBias, groundballTendency, workEthic,
// coachability) don't age at all.
const PHYSICAL: readonly (keyof PlayerRatings)[] = [
  'speed', 'stealing', 'range', 'velocity', 'stamina', 'armStrength',
  'transferSpeed', 'durability',
];
const SKILL: readonly (keyof PlayerRatings)[] = [
  'discipline', 'pitchRecognition', 'command', 'control', 'baserunningIQ',
  'composure', 'consistency', 'framing', 'blocking', 'bunting',
  'breakingBall', 'changeup', 'holdRunners',
];
const TALENT: readonly (keyof PlayerRatings)[] = [
  'contact', 'power', 'glove', 'armAccuracy', 'popTime', 'clutch',
];

const clampRating = (v: number): number => Math.max(1, Math.min(99, Math.round(v)));

// Per-group drift ranges [lo, hi] by age band. A draw inside the range is
// rolled per rating so teammates born the same year still age differently.
const driftRange = (
  group: 'physical' | 'skill' | 'talent',
  age: number,
): readonly [number, number] => {
  if (age <= 25) {
    return group === 'skill' ? [1, 3] : [0, 2];
  }
  if (age <= 29) {
    if (group === 'physical') return [-1, 1];
    if (group === 'skill') return [0, 2];
    return [-1, 1];
  }
  if (age <= 32) {
    if (group === 'physical') return [-3, -1];
    if (group === 'skill') return [-1, 1];
    return [-2, 0];
  }
  if (age <= 35) {
    if (group === 'physical') return [-5, -2];
    if (group === 'skill') return [-2, 0];
    return [-3, -1];
  }
  if (group === 'physical') return [-7, -3];
  if (group === 'skill') return [-3, -1];
  return [-5, -2];
};

export const agePlayerRatings = (
  player: Player,
  age: number,
  rng: PRNG,
): PlayerRatings => {
  // Work ethic softens or steepens the curve by a point at the extremes.
  const ethicBump = player.ratings.workEthic >= 70 ? 1 : player.ratings.workEthic <= 30 ? -1 : 0;
  const next: Record<string, number> = { ...player.ratings };
  const applyGroup = (keys: readonly (keyof PlayerRatings)[], group: 'physical' | 'skill' | 'talent') => {
    const [lo, hi] = driftRange(group, age);
    for (const k of keys) {
      const delta = Math.floor(rng.range(lo, hi + 1)) + (age >= 30 ? ethicBump : 0);
      next[k] = clampRating(player.ratings[k] + delta);
    }
  };
  applyGroup(PHYSICAL, 'physical');
  applyGroup(SKILL, 'skill');
  applyGroup(TALENT, 'talent');
  return next as unknown as PlayerRatings;
};

const isPitcher = (p: Player): boolean => p.primaryPosition === 'P';

// Core-tool composite used by the retirement check: a fading regular hangs
// it up sooner than a fading bench piece would suggest.
const coreScore = (p: Player): number => {
  const r = p.ratings;
  return isPitcher(p)
    ? (r.velocity + r.control + r.stamina) / 3
    : (r.contact + r.power + r.speed) / 3;
};

/** Retirement probability for a player of this age/skill. 0 below age 33. */
export const retirementProbability = (p: Player, age: number): number => {
  if (age >= 41) return 1;
  if (age < 33) return 0;
  const base = (age - 32) * 0.06;
  const fading = coreScore(p) < 40 ? 0.25 : 0;
  return Math.min(0.95, base + fading);
};

export const runOffseason = (
  players: readonly Player[],
  teams: readonly Team[],
  completedYear: number,
  rng: PRNG,
): OffseasonResult => {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const nextYear = completedYear + 1;
  // Calendar year the rookies debut in (next season).
  const nextCalendarYear = FOUNDING_YEAR + nextYear - 1;
  const kept: Player[] = [];
  const retired: PlayerId[] = [];
  const rookies: Player[] = [];
  // Per-team rookie sequence so ids stay unique and deterministic.
  const rookieSeq = new Map<string, number>();

  for (const p of players) {
    const prng = rng.fork(`offseason:${completedYear}:${p.id}`);
    const age = playerAgeInSeason(p, completedYear);
    if (prng.next() < retirementProbability(p, age)) {
      retired.push(p.id);
      const team = p.teamId ? teamById.get(p.teamId) : undefined;
      if (team) {
        const seq = (rookieSeq.get(team.id) ?? 0) + 1;
        rookieSeq.set(team.id, seq);
        const rookieRng = rng.fork(`draft:${nextYear}:${team.id}:${seq}`);
        const rookie = generateReplacementPlayer(rookieRng, team, {
          id: `${team.id}-r${nextYear}-${seq}`,
          position: p.primaryPosition,
          birthYear: nextCalendarYear - Math.floor(rookieRng.range(21, 25)),
          inMinors: p.inMinors,
          ...(isPitcher(p) && !p.inMinors && rookieRng.next() < 0.5
            ? { isStarterPitcher: true }
            : {}),
        });
        rookies.push(rookie);
      }
      continue;
    }
    kept.push({ ...p, ratings: agePlayerRatings(p, age, prng) });
  }

  return { players: [...kept, ...rookies], retired, rookies };
};
