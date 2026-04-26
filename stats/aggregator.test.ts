import { describe, expect, it } from 'vitest';
import { generateInitialLeague } from '../content/index.js';
import { buildSchedule, buildLineup } from '../season/index.js';
import { runGame } from '../sim/index.js';
import type { GameInput, SideInput } from '../sim/types.js';
import { buildSeasonAggregates, type FinishedGame } from './aggregator.js';
import { battingAvg, era, ops, pythagoreanExpectation, winPct } from './derived.js';
import { isQualifiedBatter, isQualifiedPitcher } from './qualifiers.js';
import { homeWinProb } from './wp.js';

const playFirstNDays = (seed: number, days: number): { league: ReturnType<typeof generateInitialLeague>; games: FinishedGame[] } => {
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
      };
      const awaySide: SideInput = {
        teamId: away.id,
        battingOrder: awayLineup.battingOrder,
        startingPitcherId: awayLineup.startingPitcher,
        bullpen: awayLineup.bullpen,
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
      games.push({ events, input });
    }
  }
  return { league, games };
};

describe('buildSeasonAggregates', () => {
  it('produces team rows for every team after one day', () => {
    const { league, games } = playFirstNDays(0xb5e_d1, 1);
    const agg = buildSeasonAggregates(games, league.teams);
    expect(agg.teams.size).toBe(league.teams.length);
    let totalW = 0;
    let totalL = 0;
    for (const team of agg.teams.values()) {
      totalW += team.W;
      totalL += team.L;
      expect(team.W + team.L).toBe(1); // one game on day 1 per team
    }
    expect(totalW).toBe(totalL); // every win pairs with a loss
  });

  it('every PA shows up in either AB, walks/HBP, or SF/SH', () => {
    const { league, games } = playFirstNDays(0xb5e_d2, 1);
    const agg = buildSeasonAggregates(games, league.teams);
    for (const line of agg.batting.values()) {
      const accounted = line.AB + line.BB + line.HBP + line.SF + line.SH;
      expect(accounted).toBe(line.PA);
    }
  });

  it('hits split as singles + doubles + triples + HR', () => {
    const { league, games } = playFirstNDays(0xb5e_d3, 1);
    const agg = buildSeasonAggregates(games, league.teams);
    for (const line of agg.batting.values()) {
      expect(line.doubles + line.triples + line.HR).toBeLessThanOrEqual(line.H);
    }
  });

  it('pitcher BF equals batter PA on the matched game side', () => {
    const { league, games } = playFirstNDays(0xb5e_d4, 1);
    const agg = buildSeasonAggregates(games, league.teams);
    let totalBatterPA = 0;
    let totalPitcherBF = 0;
    for (const line of agg.batting.values()) totalBatterPA += line.PA;
    for (const line of agg.pitching.values()) totalPitcherBF += line.BF;
    expect(totalPitcherBF).toBe(totalBatterPA);
  });

  it('runs allowed by pitchers equals runs scored by batters across the league', () => {
    const { league, games } = playFirstNDays(0xb5e_d5, 1);
    const agg = buildSeasonAggregates(games, league.teams);
    let runsScored = 0;
    let runsAllowed = 0;
    for (const line of agg.batting.values()) runsScored += line.R;
    for (const line of agg.pitching.values()) runsAllowed += line.R;
    expect(runsAllowed).toBe(runsScored);
  });

  it('rate stats stay in sane ranges over a 4-day batch', () => {
    const { league, games } = playFirstNDays(0xb5e_d6, 4);
    const agg = buildSeasonAggregates(games, league.teams);
    for (const line of agg.batting.values()) {
      const avg = battingAvg(line);
      const opsVal = ops(line);
      expect(avg).toBeGreaterThanOrEqual(0);
      expect(avg).toBeLessThanOrEqual(1);
      expect(opsVal).toBeGreaterThanOrEqual(0);
      expect(opsVal).toBeLessThan(4);
    }
    for (const line of agg.pitching.values()) {
      if (line.IPouts === 0) continue;
      const eraVal = era(line);
      expect(eraVal).toBeGreaterThanOrEqual(0);
      expect(eraVal).toBeLessThan(40);
    }
    for (const team of agg.teams.values()) {
      expect(winPct(team)).toBeGreaterThanOrEqual(0);
      expect(winPct(team)).toBeLessThanOrEqual(1);
      expect(pythagoreanExpectation(team)).toBeGreaterThanOrEqual(0);
      expect(pythagoreanExpectation(team)).toBeLessThanOrEqual(1);
    }
  });
});

describe('qualifiers', () => {
  it('scales hitter qualifier with team games played', () => {
    const line = { PA: 10, AB: 8, R: 0, H: 0, doubles: 0, triples: 0, HR: 0, RBI: 0, BB: 0, HBP: 0, SO: 0, SF: 0, SH: 0, GIDP: 0, WPA: 0, G: 4, playerId: 'x', teamId: 'y' };
    expect(isQualifiedBatter(line, 3)).toBe(true);  // need ≥ 9.3 PA
    expect(isQualifiedBatter(line, 5)).toBe(false); // need ≥ 15.5 PA
  });
  it('scales pitcher qualifier with team games played', () => {
    const line = { IPouts: 9, H: 0, R: 0, ER: 0, HR: 0, BB: 0, HBP: 0, SO: 0, BF: 0, WPA: 0, G: 1, GS: 1, W: 0, L: 0, SV: 0, playerId: 'x', teamId: 'y' };
    expect(isQualifiedPitcher(line, 3)).toBe(true); // need ≥ 9 outs
    expect(isQualifiedPitcher(line, 4)).toBe(false); // need ≥ 12 outs
  });
});

describe('homeWinProb', () => {
  it('returns ~0.5 in the 1st inning, tied, no one on', () => {
    const wp = homeWinProb({
      inning: 1, half: 'top', outs: 0,
      scoreHome: 0, scoreAway: 0,
      bases: { first: false, second: false, third: false },
    });
    expect(wp).toBeGreaterThan(0.45);
    expect(wp).toBeLessThan(0.6);
  });

  it('rises sharply when home leads big late', () => {
    const wp = homeWinProb({
      inning: 9, half: 'top', outs: 2,
      scoreHome: 5, scoreAway: 1,
      bases: { first: false, second: false, third: false },
    });
    expect(wp).toBeGreaterThan(0.95);
  });

  it('drops sharply when away leads big late', () => {
    const wp = homeWinProb({
      inning: 9, half: 'bottom', outs: 2,
      scoreHome: 1, scoreAway: 5,
      bases: { first: false, second: false, third: false },
    });
    expect(wp).toBeLessThan(0.05);
  });

  it('respects bases-loaded leverage in close late games', () => {
    const lo = homeWinProb({
      inning: 8, half: 'bottom', outs: 1,
      scoreHome: 2, scoreAway: 3,
      bases: { first: false, second: false, third: false },
    });
    const hi = homeWinProb({
      inning: 8, half: 'bottom', outs: 1,
      scoreHome: 2, scoreAway: 3,
      bases: { first: true, second: true, third: true },
    });
    expect(hi).toBeGreaterThan(lo);
  });
});
