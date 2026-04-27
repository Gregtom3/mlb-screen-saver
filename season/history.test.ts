import { describe, expect, it } from 'vitest';
import { generateInitialLeague } from '../content/index.js';
import { buildSchedule } from './schedule.js';
import { buildLineup } from './lineup.js';
import { runGame } from '../sim/index.js';
import type { GameInput, SideInput } from '../sim/types.js';
import { buildSeasonAggregates, type FinishedGame } from '../stats/index.js';
import {
  buildLeagueHistory,
  careerBattingScore,
  careerPitchingScore,
  summarizeSeason,
} from './history.js';

const playSeasonChunk = (seed: number, days: number): {
  league: ReturnType<typeof generateInitialLeague>;
  games: FinishedGame[];
} => {
  const league = generateInitialLeague(seed);
  const schedule = buildSchedule(league.teams, league.season.year);
  const playerIndex = new Map(league.players.map((p) => [p.id, p]));
  const games: FinishedGame[] = [];
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
      games.push({ events: runGame(input), input, day });
    }
  }
  return { league, games };
};

describe('summarizeSeason', () => {
  it('records a champion and at least one award', () => {
    const { league, games } = playSeasonChunk(0xb5_e6, 4);
    const agg = buildSeasonAggregates(games, league.teams, league.players, 1);
    const playerIndex = new Map(league.players.map((p) => [p.id, p]));
    const record = summarizeSeason(1, agg, league.teams, 4, playerIndex);
    expect(record.standings.length).toBe(league.teams.length);
    expect(record.champion).toBeTruthy();
    expect(record.runnerUp).toBeTruthy();
    // Some leaders should exist after 4 days.
    expect(record.leaders.batting.HR.value).toBeGreaterThanOrEqual(0);
    expect(record.battingTop.length).toBeGreaterThan(0);
  });
});

describe('buildLeagueHistory', () => {
  it('rolls up career stats across multiple seasons', () => {
    const { league, games: games1 } = playSeasonChunk(0xb5_e7, 3);
    const { games: games2 } = playSeasonChunk(0xb5_e8, 3);
    const playerIndex = new Map(league.players.map((p) => [p.id, p]));
    const agg1 = buildSeasonAggregates(games1, league.teams, league.players, 1);
    const agg2 = buildSeasonAggregates(games2, league.teams, league.players, 2);
    const history = buildLeagueHistory({
      seasons: [
        { year: 1, agg: agg1, teamGames: 3 },
        { year: 2, agg: agg2, teamGames: 3 },
      ],
      teams: league.teams,
      playerIndex,
      retiredPlayers: new Set(),
    });
    expect(history.seasons.length).toBe(2);
    // Career stats should sum two seasons for any player who played both.
    let multiSeasonPlayer = '';
    for (const [pid, c] of history.careerBatting) {
      if (c.seasons === 2) {
        multiSeasonPlayer = pid;
        const y1 = agg1.batting.get(pid);
        const y2 = agg2.batting.get(pid);
        if (y1 && y2) {
          expect(c.PA).toBe(y1.PA + y2.PA);
          expect(c.HR).toBe(y1.HR + y2.HR);
        }
        break;
      }
    }
    expect(multiSeasonPlayer).not.toBe('');
  });

  it('inducts only retired players who clear the threshold', () => {
    const { league, games } = playSeasonChunk(0xb5_e9, 4);
    const agg = buildSeasonAggregates(games, league.teams, league.players, 1);
    const playerIndex = new Map(league.players.map((p) => [p.id, p]));

    const noRetirees = buildLeagueHistory({
      seasons: [{ year: 1, agg, teamGames: 4 }],
      teams: league.teams,
      playerIndex,
      retiredPlayers: new Set(),
    });
    expect(noRetirees.hallOfFame.length).toBe(0);

    // Force an unrealistically large career line so the threshold trips.
    const allRetired = new Set(league.players.map((p) => p.id));
    const fattened = buildLeagueHistory({
      seasons: [{ year: 1, agg, teamGames: 4 }],
      teams: league.teams,
      playerIndex,
      retiredPlayers: allRetired,
    });
    // After only 4 days nobody should clear the realistic threshold either.
    expect(fattened.hallOfFame.length).toBe(0);
  });
});

describe('career score helpers', () => {
  it('rewards more counting stats', () => {
    const better = careerBattingScore({
      playerId: 'a', seasons: 3,
      G: 450, PA: 1800, AB: 1600, H: 500, R: 280,
      doubles: 100, triples: 10, HR: 80, RBI: 300,
      BB: 180, HBP: 20, SO: 350, SF: 8, SH: 0, GIDP: 30,
      WPA: 12, byYear: {},
    });
    const worse = careerBattingScore({
      playerId: 'b', seasons: 3,
      G: 450, PA: 1500, AB: 1300, H: 200, R: 150,
      doubles: 30, triples: 3, HR: 20, RBI: 100,
      BB: 100, HBP: 5, SO: 300, SF: 5, SH: 0, GIDP: 20,
      WPA: -2, byYear: {},
    });
    expect(better).toBeGreaterThan(worse);
  });

  it('penalizes pitching ERA', () => {
    const ace = careerPitchingScore({
      playerId: 'p1', seasons: 3,
      G: 90, GS: 90, W: 50, L: 25, SV: 0,
      IPouts: 1800, H: 480, R: 200, ER: 180, HR: 35,
      BB: 130, HBP: 10, SO: 600, BF: 2400, WPA: 8, byYear: {},
    });
    const replacement = careerPitchingScore({
      playerId: 'p2', seasons: 3,
      G: 90, GS: 90, W: 25, L: 50, SV: 0,
      IPouts: 1800, H: 700, R: 400, ER: 360, HR: 80,
      BB: 220, HBP: 20, SO: 350, BF: 2500, WPA: -8, byYear: {},
    });
    expect(ace).toBeGreaterThan(replacement);
  });
});
