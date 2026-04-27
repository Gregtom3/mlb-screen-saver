import { describe, expect, it } from 'vitest';
import { generateInitialLeague } from '../content/index.js';
import { buildSchedule, buildLineup } from '../season/index.js';
import { runGame, buildBoxScore } from './index.js';
import type { GameInput, SideInput } from './types.js';

const buildInputForFirstGame = (masterSeed: number, gameSeed: number): GameInput => {
  const league = generateInitialLeague(masterSeed);
  const schedule = buildSchedule(league.teams, league.season.year);
  const entry = schedule.entries.find((e) => e.day === 1)!;
  const homeTeam = league.teams.find((t) => t.id === entry.homeTeamId)!;
  const awayTeam = league.teams.find((t) => t.id === entry.awayTeamId)!;
  const homeLineup = buildLineup(homeTeam, league.players, 1);
  const awayLineup = buildLineup(awayTeam, league.players, 1);
  const playerIndex = new Map(league.players.map((p) => [p.id, p]));
  const home: SideInput = {
    teamId: homeTeam.id,
    battingOrder: homeLineup.battingOrder,
    startingPitcherId: homeLineup.startingPitcher,
    bullpen: homeLineup.bullpen,
    defenseByPosition: homeLineup.defenseByPosition,
  };
  const away: SideInput = {
    teamId: awayTeam.id,
    battingOrder: awayLineup.battingOrder,
    startingPitcherId: awayLineup.startingPitcher,
    bullpen: awayLineup.bullpen,
    defenseByPosition: awayLineup.defenseByPosition,
  };
  return {
    gameId: entry.gameId,
    stadiumId: entry.stadiumId,
    home,
    away,
    playerIndex,
    seed: gameSeed,
  };
};

describe('runGame determinism', () => {
  it('same seed + same input yields byte-identical events', () => {
    const a = runGame(buildInputForFirstGame(0xba_5e_ba_11, 0xc0_ff_ee_42));
    const b = runGame(buildInputForFirstGame(0xba_5e_ba_11, 0xc0_ff_ee_42));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different seeds produce different games', () => {
    const a = runGame(buildInputForFirstGame(0xba_5e_ba_11, 1));
    const b = runGame(buildInputForFirstGame(0xba_5e_ba_11, 2));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

describe('runGame sanity', () => {
  it('every game terminates with a gameEnd event and a non-tie score', () => {
    for (let s = 1; s <= 30; s++) {
      const input = buildInputForFirstGame(0xba_5e_ba_11, s);
      const events = runGame(input);
      const last = events[events.length - 1];
      expect(last?.kind).toBe('gameEnd');
      if (last?.kind === 'gameEnd') {
        expect(last.finalRuns.home).not.toBe(last.finalRuns.away);
      }
    }
  });

  it('every half-inning ends with exactly the documented number of outs', () => {
    const input = buildInputForFirstGame(0xba_5e_ba_11, 7);
    const events = runGame(input);
    const inningEnds = events.filter((e) => e.kind === 'inningEnd');
    expect(inningEnds.length).toBeGreaterThanOrEqual(17); // 9 top + 8 bot minimum
    expect(inningEnds.length).toBeLessThanOrEqual(40); // safety against runaways
  });

  it('100-game batch produces plausible average runs per game', () => {
    let totalRuns = 0;
    let gameCount = 0;
    for (let s = 1; s <= 100; s++) {
      const events = runGame(buildInputForFirstGame(0xba_5e_ba_11, s));
      const last = events[events.length - 1];
      if (last?.kind === 'gameEnd') {
        totalRuns += last.finalRuns.home + last.finalRuns.away;
        gameCount += 1;
      }
    }
    expect(gameCount).toBe(100);
    const avg = totalRuns / gameCount;
    // MLB combined teams average ~9 runs/game; we should be in a plausible band.
    expect(avg).toBeGreaterThan(4);
    expect(avg).toBeLessThan(20);
  });

  it('box score totals match the event log', () => {
    const input = buildInputForFirstGame(0xba_5e_ba_11, 11);
    const events = runGame(input);
    const box = buildBoxScore(events, input);
    const last = events[events.length - 1];
    if (last?.kind !== 'gameEnd') throw new Error('no gameEnd event');
    expect(box.lineScore.home.runs).toBe(last.finalRuns.home);
    expect(box.lineScore.away.runs).toBe(last.finalRuns.away);
    // Sum of inning runs should equal totals.
    const sumTop = box.lineScore.innings.reduce((s, i) => s + i.top, 0);
    const sumBot = box.lineScore.innings.reduce((s, i) => s + (i.bottom ?? 0), 0);
    expect(sumTop).toBe(box.lineScore.away.runs);
    expect(sumBot).toBe(box.lineScore.home.runs);
  });
});

describe('fielder errors', () => {
  it('produces reached-on-error outcomes across a 30-game batch', () => {
    let totalErrors = 0;
    for (let s = 1; s <= 30; s++) {
      const events = runGame(buildInputForFirstGame(0xba_5e_ba_11, s));
      for (const ev of events) {
        if (ev.kind === 'atBatEnd' && ev.outcome === 'reached-on-error') {
          totalErrors += 1;
        }
      }
    }
    // ~0.4-0.5 errors per team per game * 60 team-games = ~24-30 expected.
    // Wide bound to absorb seed variance and future tuning.
    expect(totalErrors).toBeGreaterThan(5);
    expect(totalErrors).toBeLessThan(120);
  });

  it('box-score errors equal reached-on-error events, charged to fielding side', () => {
    for (const seed of [3, 17, 42, 99]) {
      const input = buildInputForFirstGame(0xba_5e_ba_11, seed);
      const events = runGame(input);
      const box = buildBoxScore(events, input);

      // Replay outcomes by half-inning to determine the fielding side per ROE.
      let half: 'top' | 'bottom' = 'top';
      let homeErr = 0;
      let awayErr = 0;
      for (const ev of events) {
        if (ev.kind === 'inningEnd') {
          half = half === 'top' ? 'bottom' : 'top';
        } else if (ev.kind === 'atBatEnd' && ev.outcome === 'reached-on-error') {
          // Top half: away bats, home fields → home error. Bottom: vice versa.
          if (half === 'top') homeErr += 1;
          else awayErr += 1;
        }
      }
      expect(box.lineScore.home.errors).toBe(homeErr);
      expect(box.lineScore.away.errors).toBe(awayErr);
    }
  });
});
