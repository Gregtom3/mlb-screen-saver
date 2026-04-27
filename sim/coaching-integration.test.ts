import { describe, expect, it } from 'vitest';
import { generateInitialLeague } from '../content/index.js';
import { buildSchedule, buildLineup } from '../season/index.js';
import { runGame } from './game.js';
import type { GameInput, SideInput } from './types.js';
import type { Coach, CoachRatings, CoachingStaff } from '../world/types.js';

const ratings = (overrides: Partial<CoachRatings>): CoachRatings => ({
  tactics: 50,
  morale: 50,
  baserunningCoaching: 50,
  pickoffAwareness: 50,
  aggression: 50,
  judgment: 50,
  ...overrides,
});

const coach = (id: string, role: Coach['role'], over: Partial<CoachRatings>): Coach => ({
  id,
  firstName: 'C',
  lastName: 'X',
  role,
  ratings: ratings(over),
});

const staff = (
  headOver: Partial<CoachRatings>,
  fbOver: Partial<CoachRatings>,
  tbOver: Partial<CoachRatings>,
): CoachingStaff => ({
  head: coach('h', 'head', headOver),
  firstBase: coach('1', 'first-base', fbOver),
  thirdBase: coach('3', 'third-base', tbOver),
});

const buildInput = (
  masterSeed: number,
  gameSeed: number,
  homeStaff: CoachingStaff,
  awayStaff: CoachingStaff,
): GameInput => {
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
    coachingStaff: homeStaff,
  };
  const away: SideInput = {
    teamId: awayTeam.id,
    battingOrder: awayLineup.battingOrder,
    startingPitcherId: awayLineup.startingPitcher,
    bullpen: awayLineup.bullpen,
    defenseByPosition: awayLineup.defenseByPosition,
    coachingStaff: awayStaff,
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

describe('coaching mods threaded through runGame', () => {
  it('league snapshot teams carry a coaching staff for every team', () => {
    const league = generateInitialLeague(0xc0_a5_71_aa);
    expect(league.teams.length).toBeGreaterThan(0);
    for (const t of league.teams) {
      expect(t.coachingStaff.head.role).toBe('head');
      expect(t.coachingStaff.firstBase.role).toBe('first-base');
      expect(t.coachingStaff.thirdBase.role).toBe('third-base');
    }
  });

  it('byte-identical events when both calls use the same staffs', () => {
    const home = staff({ tactics: 70 }, {}, { aggression: 70, judgment: 65 });
    const away = staff({ tactics: 30 }, {}, { aggression: 30, judgment: 35 });
    const a = runGame(buildInput(0xba_5e_ba_11, 0xc0_ff_ee_42, home, away));
    const b = runGame(buildInput(0xba_5e_ba_11, 0xc0_ff_ee_42, home, away));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('aggressive 3B coaches produce more runs over a batch than cautious ones', () => {
    const sumRuns = (
      homeStaff: CoachingStaff,
      awayStaff: CoachingStaff,
      games: number,
    ): number => {
      let total = 0;
      for (let s = 1; s <= games; s++) {
        const events = runGame(buildInput(0xba_5e_ba_11, s, homeStaff, awayStaff));
        const last = events[events.length - 1];
        if (last?.kind === 'gameEnd') {
          total += last.finalRuns.home + last.finalRuns.away;
        }
      }
      return total;
    };

    const aggressive = staff({}, {}, { aggression: 99, judgment: 99 });
    const cautious = staff({}, {}, { aggression: 1, judgment: 1 });

    // 30 games each — same seeds and same teams; the only difference is the
    // 3B coach's send/tag-up philosophy. Aggressive coaches should produce
    // more total runs because more runners actually score from 2B and tag
    // up successfully.
    const aggressiveRuns = sumRuns(aggressive, aggressive, 30);
    const cautiousRuns = sumRuns(cautious, cautious, 30);
    expect(aggressiveRuns).toBeGreaterThan(cautiousRuns);
  });
});
