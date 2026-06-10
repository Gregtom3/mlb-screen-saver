import { describe, expect, it } from 'vitest';
import { generateInitialLeague } from '../content/index.js';
import { createPRNG } from '../sim/prng.js';
import { playerAgeInSeason, retirementProbability, runOffseason } from './offseason.js';

const league = generateInitialLeague(0xd2af7);
const YEAR = league.season.year;

describe('runOffseason', () => {
  it('is deterministic: same inputs produce identical pools', () => {
    const a = runOffseason(league.players, league.teams, YEAR, createPRNG(7));
    const b = runOffseason(league.players, league.teams, YEAR, createPRNG(7));
    expect(a.retired).toEqual(b.retired);
    expect(JSON.stringify(a.players)).toBe(JSON.stringify(b.players));
  });

  it('keeps every rating in [1, 99] and preserves roster sizes per team', () => {
    const { players, retired, rookies } = runOffseason(
      league.players,
      league.teams,
      YEAR,
      createPRNG(11),
    );
    expect(players.length).toBe(league.players.length);
    expect(rookies.length).toBe(retired.length);
    for (const p of players) {
      for (const v of Object.values(p.ratings)) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(99);
      }
    }
    // Per-team counts unchanged.
    for (const team of league.teams) {
      const before = league.players.filter((p) => p.teamId === team.id).length;
      const after = players.filter((p) => p.teamId === team.id).length;
      expect(after).toBe(before);
    }
  });

  it('rookies replace retirees at the same position and arrive young', () => {
    // The initial league skews young, so a single winter can retire nobody.
    // Run consecutive winters until somebody hangs it up (a few years at
    // most), then check the replacement invariants for that winter.
    let pool = league.players;
    let year = YEAR;
    const master = createPRNG(13);
    let result = runOffseason(pool, league.teams, year, master.fork(`w:${year}`));
    while (result.retired.length === 0 && year < YEAR + 15) {
      pool = result.players;
      year += 1;
      result = runOffseason(pool, league.teams, year, master.fork(`w:${year}`));
    }
    const { players, retired, rookies } = result;
    const byId = new Map(pool.map((p) => [p.id, p]));
    expect(retired.length).toBeGreaterThan(0);
    const retiredPositions = retired
      .map((id) => byId.get(id)!)
      .map((p) => `${p.teamId}:${p.primaryPosition}`)
      .sort();
    const rookiePositions = rookies.map((p) => `${p.teamId}:${p.primaryPosition}`).sort();
    expect(rookiePositions).toEqual(retiredPositions);
    for (const r of rookies) {
      const age = playerAgeInSeason(r, year + 1);
      expect(age).toBeGreaterThanOrEqual(21);
      expect(age).toBeLessThanOrEqual(24);
      expect(players.some((p) => p.id === r.id)).toBe(true);
    }
    // No retiree survives into the new pool.
    for (const id of retired) expect(players.some((p) => p.id === id)).toBe(false);
  });

  it('nobody plays past 41: repeated winters cap the age curve', () => {
    let pool = league.players;
    let year = YEAR;
    const master = createPRNG(0xa9e);
    for (let i = 0; i < 12; i++) {
      pool = runOffseason(pool, league.teams, year, master.fork(`winter:${year}`)).players;
      year += 1;
    }
    for (const p of pool) {
      expect(playerAgeInSeason(p, year)).toBeLessThanOrEqual(41);
    }
  });

  it('retirement probability rises with age and is 0 for the young', () => {
    const someone = league.players[0]!;
    expect(retirementProbability(someone, 28)).toBe(0);
    expect(retirementProbability(someone, 41)).toBe(1);
    expect(retirementProbability(someone, 36)).toBeGreaterThan(
      retirementProbability(someone, 33),
    );
  });
});
