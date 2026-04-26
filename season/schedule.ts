import type { Team } from '../world/types.js';
import type { Schedule, ScheduleEntry } from './types.js';

// Phase 1 schedule generator.
// Algorithm: 10 rotations of a 15-day round-robin over 16 teams.
// - Every team plays one game every day.
// - Every team plays every other team 10 times across the season (5 home, 5 away).
// - Total: 150 games per team, 1200 games across the league.
//
// 162-game realism (with within/cross-division weighting) and bye days arrive
// in Phase 6 when the playoffs and offseason go in. Documented in PHASE_1.md.

const ROTATIONS = 10;
const TEAMS_PER_LEAGUE = 16;
const ROUNDS_PER_ROTATION = TEAMS_PER_LEAGUE - 1; // 15

interface Pair {
  readonly home: number; // index into teams[]
  readonly away: number;
}

// Berger / circle method: fix team 0, rotate the other 15, pair across the circle.
const buildRotationRounds = (): readonly (readonly Pair[])[] => {
  const n = TEAMS_PER_LEAGUE;
  const fixed = 0;
  const ring = Array.from({ length: n - 1 }, (_, i) => i + 1); // [1..15]
  const rounds: Pair[][] = [];
  for (let r = 0; r < ROUNDS_PER_ROTATION; r++) {
    const round: Pair[] = [];
    // pair the fixed team with whoever is currently first in the ring
    const opponentOfFixed = ring[r % ring.length];
    if (opponentOfFixed === undefined) throw new Error('schedule: ring empty');
    // home/away for the fixed-team match alternates by round so it isn't always at home
    const homeFixed = r % 2 === 0;
    round.push(homeFixed ? { home: fixed, away: opponentOfFixed } : { home: opponentOfFixed, away: fixed });
    // pair the rest across the ring (need n-1 pairs where 2n is total team count)
    const halfPairs = (ring.length - 1) / 2;
    for (let i = 1; i <= halfPairs; i++) {
      const a = ring[(r + i) % ring.length];
      const b = ring[(r + ring.length - i) % ring.length];
      if (a === undefined || b === undefined) throw new Error('schedule: pairing failed');
      // home/away alternates by index parity within the round so each team gets a balanced split
      if ((i + r) % 2 === 0) round.push({ home: a, away: b });
      else round.push({ home: b, away: a });
    }
    rounds.push(round);
  }
  return rounds;
};

export const buildSchedule = (teams: readonly Team[], seasonYear = 1): Schedule => {
  if (teams.length !== TEAMS_PER_LEAGUE) {
    throw new Error(`schedule expects ${TEAMS_PER_LEAGUE} teams, got ${teams.length}`);
  }
  const rounds = buildRotationRounds();
  const entries: ScheduleEntry[] = [];
  let gameCounter = 0;
  for (let rot = 0; rot < ROTATIONS; rot++) {
    rounds.forEach((round, roundIdx) => {
      const day = rot * ROUNDS_PER_ROTATION + roundIdx + 1;
      for (const pair of round) {
        // On odd rotations, swap home/away to balance the season-long split.
        const swap = rot % 2 === 1;
        const homeIdx = swap ? pair.away : pair.home;
        const awayIdx = swap ? pair.home : pair.away;
        const home = teams[homeIdx];
        const away = teams[awayIdx];
        if (!home || !away) throw new Error('schedule: bad index');
        gameCounter += 1;
        entries.push({
          gameId: `s${seasonYear}-g${String(gameCounter).padStart(5, '0')}`,
          day,
          homeTeamId: home.id,
          awayTeamId: away.id,
          stadiumId: home.stadiumId,
        });
      }
    });
  }
  return {
    seasonYear,
    totalDays: ROTATIONS * ROUNDS_PER_ROTATION,
    entries,
  };
};
