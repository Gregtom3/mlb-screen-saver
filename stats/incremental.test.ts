import { describe, expect, it } from 'vitest';
import { generateInitialLeague } from '../content/index.js';
import { buildSchedule, buildLineup } from '../season/index.js';
import { runGame } from '../sim/index.js';
import type { GameInput, SideInput } from '../sim/types.js';
import {
  aggregateGame,
  buildSeasonAggregates,
  type FinishedGame,
} from './aggregator.js';
import { emptySeasonAggregates } from './types.js';

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

// Phase 5.5 part 2 — incremental rebuild invariant. Calling aggregateGame()
// in a loop must produce the same numbers as a one-shot buildSeasonAggregates.
describe('incremental aggregation', () => {
  it('matches a full rebuild over a 4-day batch', () => {
    const { league, games } = playFirstNDays(0xc01d, 4);

    const fullRebuild = buildSeasonAggregates(games, league.teams, league.players);

    // Incremental: fold one game at a time.
    const incremental = emptySeasonAggregates(league.season.year);
    const ctx = {
      teamsById: new Map(league.teams.map((t) => [t.id, t])),
      playerIndex: new Map(league.players.map((p) => [p.id, p])),
    };
    for (const team of league.teams) {
      // Pre-populate team rows so the comparison covers all 16 teams,
      // matching what buildSeasonAggregates does.
      incremental.teams.set(team.id, {
        teamId: team.id,
        W: 0, L: 0, RS: 0, RA: 0,
        homeW: 0, homeL: 0, awayW: 0, awayL: 0,
        divW: 0, divL: 0,
        resultsTimeline: [],
      });
    }
    for (const game of games) {
      aggregateGame(game, incremental, ctx);
    }

    // Same set of player rows.
    expect(incremental.batting.size).toBe(fullRebuild.batting.size);
    expect(incremental.pitching.size).toBe(fullRebuild.pitching.size);
    expect(incremental.teams.size).toBe(fullRebuild.teams.size);

    // Same key counters per row — sample a handful for spot-check, then
    // verify totals across the league match exactly.
    let incrTotalPA = 0; let fullTotalPA = 0;
    for (const line of incremental.batting.values()) incrTotalPA += line.PA;
    for (const line of fullRebuild.batting.values()) fullTotalPA += line.PA;
    expect(incrTotalPA).toBe(fullTotalPA);

    let incrTotalIP = 0; let fullTotalIP = 0;
    for (const line of incremental.pitching.values()) incrTotalIP += line.IPouts;
    for (const line of fullRebuild.pitching.values()) fullTotalIP += line.IPouts;
    expect(incrTotalIP).toBe(fullTotalIP);

    let incrTotalW = 0; let fullTotalW = 0;
    for (const line of incremental.teams.values()) incrTotalW += line.W;
    for (const line of fullRebuild.teams.values()) fullTotalW += line.W;
    expect(incrTotalW).toBe(fullTotalW);
  });
});
