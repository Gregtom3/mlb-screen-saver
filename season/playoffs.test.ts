import { describe, expect, it } from 'vitest';
import { generateInitialLeague } from '../content/index.js';
import {
  applyPlayoffResults,
  homeTeamForGame,
  playoffGamesForDay,
  seedPlayoffs,
  seriesWinner,
  type PlayoffSeedEntry,
  type PlayoffState,
} from './playoffs.js';

const league = generateInitialLeague(0xabc123);

const seedEntries = (): PlayoffSeedEntry[] =>
  league.teams.map((t, i) => ({
    teamId: t.id,
    // Deterministic spread of win totals; ties broken by runDiff below.
    wins: 100 - i * 3,
    runDiff: 50 - i,
  }));

describe('seedPlayoffs', () => {
  it('takes the top two teams per conference, in overall seed order', () => {
    const state = seedPlayoffs(5, league.teams, seedEntries());
    expect(state.series).toHaveLength(2);
    expect(state.seedOrder).toHaveLength(4);
    for (const s of state.series) {
      expect(s.round).toBe('cs');
      expect(s.bestOf).toBe(5);
      // High seed must have at least as many wins as the low seed.
      const entries = seedEntries();
      const w = (id: string) => entries.find((e) => e.teamId === id)!.wins;
      expect(w(s.highSeed)).toBeGreaterThanOrEqual(w(s.lowSeed));
    }
    // The two series cover 4 distinct teams.
    const ids = new Set(state.series.flatMap((s) => [s.highSeed, s.lowSeed]));
    expect(ids.size).toBe(4);
  });
});

describe('series progression', () => {
  const playDay = (state: PlayoffState, winnerOf: (seriesId: string) => 'high' | 'low') => {
    const games = playoffGamesForDay(state, league.teams);
    const results = games.map((g) => {
      const s = state.series.find((x) => x.id === g.seriesId)!;
      return { seriesId: g.seriesId, winner: winnerOf(g.seriesId) === 'high' ? s.highSeed : s.lowSeed };
    });
    return applyPlayoffResults(state, results);
  };

  it('high seed sweeping both CS in 3 reaches the Finals; champion after 4 more', () => {
    let state = seedPlayoffs(5, league.teams, seedEntries());
    for (let d = 0; d < 3; d++) state = playDay(state, () => 'high');
    const final = state.series.find((s) => s.round === 'final');
    expect(final).toBeDefined();
    expect(state.champion).toBeNull();
    // Final home field belongs to the best overall seed.
    expect(final!.highSeed).toBe(state.seedOrder[0]);
    for (let d = 0; d < 4; d++) state = playDay(state, () => 'high');
    expect(state.champion).toBe(final!.highSeed);
    expect(state.runnerUp).toBe(final!.lowSeed);
  });

  it('a Bo5 can go the distance and the low seed can advance', () => {
    let state = seedPlayoffs(5, league.teams, seedEntries());
    // Alternate winners: H L H L L → low seed wins 3-2 in five games.
    const pattern: ('high' | 'low')[] = ['high', 'low', 'high', 'low', 'low'];
    for (const w of pattern) state = playDay(state, () => w);
    for (const s of state.series.filter((x) => x.round === 'cs')) {
      expect(s.highWins).toBe(2);
      expect(s.lowWins).toBe(3);
      expect(seriesWinner(s)).toBe(s.lowSeed);
    }
  });

  it('uses the 2-2-1 home pattern', () => {
    const state = seedPlayoffs(5, league.teams, seedEntries());
    const s = state.series[0]!;
    expect(homeTeamForGame(s, 1)).toBe(s.highSeed);
    expect(homeTeamForGame(s, 2)).toBe(s.highSeed);
    expect(homeTeamForGame(s, 3)).toBe(s.lowSeed);
    expect(homeTeamForGame(s, 4)).toBe(s.lowSeed);
    expect(homeTeamForGame(s, 5)).toBe(s.highSeed);
    expect(homeTeamForGame(s, 7)).toBe(s.highSeed);
  });

  it('game entries carry unique ids and the home team stadium', () => {
    const state = seedPlayoffs(5, league.teams, seedEntries());
    const games = playoffGamesForDay(state, league.teams);
    expect(games).toHaveLength(2);
    const ids = new Set(games.map((g) => g.gameId));
    expect(ids.size).toBe(2);
    for (const g of games) {
      const home = league.teams.find((t) => t.id === g.homeTeamId)!;
      expect(g.stadiumId).toBe(home.stadiumId);
      expect(g.gameId).toContain('po');
    }
  });
});
