import { describe, expect, it } from 'vitest';
import { generateInitialLeague } from '../content/index.js';
import { buildSchedule, buildLineup } from '../season/index.js';
import { runGame } from '../sim/index.js';
import type { GameInput, SideInput } from '../sim/types.js';
import { buildSeasonAggregates, type FinishedGame } from './aggregator.js';

const playFirstNDays = (seed: number, days: number) => {
  const league = generateInitialLeague(seed);
  const schedule = buildSchedule(league.teams, league.season.year);
  const games: FinishedGame[] = [];
  const playerIndex = new Map(league.players.map((p) => [p.id, p]));
  for (let day = 1; day <= days; day++) {
    for (const entry of schedule.entries.filter((e) => e.day === day)) {
      const home = league.teams.find((t) => t.id === entry.homeTeamId)!;
      const away = league.teams.find((t) => t.id === entry.awayTeamId)!;
      const stadium = league.stadiums.find((s) => s.id === entry.stadiumId)!;
      const homeLineup = buildLineup(home, league.players, day);
      const awayLineup = buildLineup(away, league.players, day);
      const homeSide: SideInput = {
        teamId: home.id,
        battingOrder: homeLineup.battingOrder,
        startingPitcherId: homeLineup.startingPitcher,
        bullpen: homeLineup.bullpen,
        defenseByPosition: homeLineup.defenseByPosition,
      };
      const awaySide: SideInput = {
        teamId: away.id,
        battingOrder: awayLineup.battingOrder,
        startingPitcherId: awayLineup.startingPitcher,
        bullpen: awayLineup.bullpen,
        defenseByPosition: awayLineup.defenseByPosition,
      };
      const input: GameInput = {
        gameId: entry.gameId,
        stadiumId: entry.stadiumId,
        home: homeSide,
        away: awaySide,
        playerIndex,
        seed,
        stadiumQuirk: stadium.quirk,
      };
      const events = runGame(input);
      games.push({ events, input, day });
    }
  }
  return { league, games };
};

describe('split aggregation', () => {
  it('vsLHP + vsRHP add up to the season top line', () => {
    const { league, games } = playFirstNDays(0xc11, 3);
    const agg = buildSeasonAggregates(games, league.teams, league.players);
    let off = 0;
    for (const line of agg.batting.values()) {
      const l = line.splits.vsLHP;
      const r = line.splits.vsRHP;
      const lpa = l?.PA ?? 0;
      const rpa = r?.PA ?? 0;
      if (lpa + rpa !== line.PA) off += 1;
    }
    expect(off).toBe(0);
  });

  it('home + away splits add up to the season PA', () => {
    const { league, games } = playFirstNDays(0xc12, 3);
    const agg = buildSeasonAggregates(games, league.teams, league.players);
    for (const line of agg.batting.values()) {
      const home = line.splits.home?.PA ?? 0;
      const away = line.splits.away?.PA ?? 0;
      expect(home + away).toBe(line.PA);
    }
  });

  it('hit charts populate for batters with batted balls', () => {
    const { league, games } = playFirstNDays(0xc13, 2);
    const agg = buildSeasonAggregates(games, league.teams, league.players);
    let withChart = 0;
    for (const line of agg.batting.values()) {
      if (line.hitChart.length > 0) withChart += 1;
    }
    expect(withChart).toBeGreaterThan(50);
  });

  it('game logs accumulate one row per game played', () => {
    const { league, games } = playFirstNDays(0xc14, 3);
    const agg = buildSeasonAggregates(games, league.teams, league.players);
    let totalGameRows = 0;
    for (const line of agg.batting.values()) totalGameRows += line.gameLog.length;
    // 3 days × 8 games × ~9 batters per side × 2 sides = ~432 game rows
    expect(totalGameRows).toBeGreaterThan(200);
  });

  it('WP timelines are stored per game', () => {
    const { league, games } = playFirstNDays(0xc15, 2);
    const agg = buildSeasonAggregates(games, league.teams, league.players);
    expect(agg.wpTimelines.size).toBe(games.length);
    for (const tl of agg.wpTimelines.values()) {
      expect(tl.samples.length).toBeGreaterThan(20);
      // First sample is gameStart; last is final inning.
      expect(tl.samples[0]!.wpHome).toBeGreaterThanOrEqual(0);
      expect(tl.samples[tl.samples.length - 1]!.wpHome).toBeLessThanOrEqual(1);
    }
  });
});
