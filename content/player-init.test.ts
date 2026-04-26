import { describe, expect, it } from 'vitest';
import { generateInitialLeague } from './league-init.js';
import { summarizeRoster } from './player-init.js';

describe('player generation', () => {
  it('creates 640 players (40 per team × 16 teams) deterministically', () => {
    const a = generateInitialLeague(42);
    const b = generateInitialLeague(42);
    expect(a.players.length).toBe(640);
    expect(b.players.length).toBe(640);
    // Determinism: identifiers + ratings byte-equal across two runs.
    expect(JSON.stringify(a.players)).toBe(JSON.stringify(b.players));
  });

  it('every team has 25 active and 15 minors, 12 of whom are pitchers', () => {
    const league = generateInitialLeague(7);
    for (const team of league.teams) {
      const summary = summarizeRoster(league.players, team.id);
      expect(summary.total).toBe(40);
      expect(summary.active).toBe(25);
      expect(summary.minors).toBe(15);
      expect(summary.pitchers).toBe(19); // 12 active + 7 minors
    }
  });

  it('every rating is in [1, 99]', () => {
    const league = generateInitialLeague(99);
    for (const p of league.players) {
      for (const v of Object.values(p.ratings)) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(99);
      }
    }
  });

  it('different seeds produce different player names', () => {
    const a = generateInitialLeague(1);
    const b = generateInitialLeague(2);
    const aFirst = a.players[0]!;
    const bFirst = b.players[0]!;
    // Same id (positional), different attributes.
    expect(aFirst.id).toBe(bFirst.id);
    expect(`${aFirst.firstName}${aFirst.lastName}`).not.toBe(`${bFirst.firstName}${bFirst.lastName}`);
  });
});
