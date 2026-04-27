import { describe, expect, it } from 'vitest';
import { generateInitialLeague } from '../content/index.js';
import { buildSchedule, buildLineup } from '../season/index.js';
import { runGame } from '../sim/index.js';
import type { GameInput, SideInput } from '../sim/types.js';
import { buildSeasonAggregates, type FinishedGame } from '../stats/aggregator.js';
import { buildProjections, computeMagicNumber } from './montecarlo.js';

describe('buildProjections', () => {
  it('produces probabilities that sum to ≈ 1 across all teams for the title', () => {
    const league = generateInitialLeague(0xb01);
    const schedule = buildSchedule(league.teams, league.season.year);
    const playerIndex = new Map(league.players.map((p) => [p.id, p]));
    const games: FinishedGame[] = [];
    for (let day = 1; day <= 3; day++) {
      for (const entry of schedule.entries.filter((e) => e.day === day)) {
        const home = league.teams.find((t) => t.id === entry.homeTeamId)!;
        const away = league.teams.find((t) => t.id === entry.awayTeamId)!;
        const stadium = league.stadiums.find((s) => s.id === entry.stadiumId)!;
        const homeLineup = buildLineup(home, league.players, day);
        const awayLineup = buildLineup(away, league.players, day);
        const homeSide: SideInput = {
          teamId: home.id, battingOrder: homeLineup.battingOrder,
          startingPitcherId: homeLineup.startingPitcher, bullpen: homeLineup.bullpen,
          defenseByPosition: homeLineup.defenseByPosition,
        };
        const awaySide: SideInput = {
          teamId: away.id, battingOrder: awayLineup.battingOrder,
          startingPitcherId: awayLineup.startingPitcher, bullpen: awayLineup.bullpen,
          defenseByPosition: awayLineup.defenseByPosition,
        };
        const input: GameInput = {
          gameId: entry.gameId, stadiumId: entry.stadiumId,
          home: homeSide, away: awaySide, playerIndex,
          seed: 0xb01, stadiumQuirk: stadium.quirk,
        };
        const events = runGame(input);
        games.push({ events, input, day });
      }
    }
    const aggregates = buildSeasonAggregates(games, league.teams, league.players);

    const proj = buildProjections({
      seasonYear: league.season.year,
      teams: league.teams,
      schedule,
      aggregates,
      currentDay: 3,
      simulations: 200,
      seed: 0xb01,
    });

    expect(proj.teams.size).toBe(league.teams.length);
    // P(title) sums to 1 across all teams (every sim has exactly one champ).
    let titleSum = 0;
    for (const tp of proj.teams.values()) titleSum += tp.pTitle;
    expect(titleSum).toBeGreaterThan(0.95);
    expect(titleSum).toBeLessThanOrEqual(1.001);

    // P(playoffs) sums to 8 (8 teams in any sim).
    let playoffSum = 0;
    for (const tp of proj.teams.values()) playoffSum += tp.pPlayoffs;
    expect(playoffSum).toBeGreaterThan(7.5);
    expect(playoffSum).toBeLessThan(8.5);

    // Win percentile bounds make sense.
    for (const tp of proj.teams.values()) {
      expect(tp.winsP05).toBeLessThanOrEqual(tp.winsP50);
      expect(tp.winsP50).toBeLessThanOrEqual(tp.winsP95);
    }
  });
});

describe('computeMagicNumber', () => {
  it('returns 0 when team has clinched', () => {
    const team = { teamId: 't1', currentW: 95, currentL: 50, pythagoreanWinPct: 0.65, winsP05: 95, winsP50: 95, winsP95: 95, pPlayoffs: 1, pDivision: 1, pTopSeed: 1, pConference: 1, pTitle: 0.5, sosRemaining: 0.5, magicDivision: null, eliminationDivision: null };
    const rival = { ...team, teamId: 't2', currentW: 60, currentL: 85 };
    const { magic } = computeMagicNumber(team, [team, rival], 150);
    expect(magic).toBe(0);
  });
  it('returns null when no rivals', () => {
    const team = { teamId: 't1', currentW: 50, currentL: 50, pythagoreanWinPct: 0.5, winsP05: 50, winsP50: 50, winsP95: 50, pPlayoffs: 0.5, pDivision: 0.25, pTopSeed: 0.1, pConference: 0.1, pTitle: 0.05, sosRemaining: 0.5, magicDivision: null, eliminationDivision: null };
    const { magic } = computeMagicNumber(team, [team], 150);
    expect(magic).toBeNull();
  });
});
