import type { LeagueSnapshot, SeasonState } from '../world/types.js';
import { createPRNG } from '../sim/prng.js';
import { buildTeamsAndStadiums } from './teams.js';
import { generateAllPlayers } from './player-init.js';

// Produce a complete LeagueSnapshot from a master seed: identities, stadiums,
// all rosters. Schedule lives in /season and is built on top of this snapshot.
export const generateInitialLeague = (masterSeed: number): LeagueSnapshot => {
  const { teams, stadiums } = buildTeamsAndStadiums();
  const rng = createPRNG(masterSeed);
  const players = generateAllPlayers(rng.fork('players'), teams);

  const season: SeasonState = {
    year: 1,
    phase: 'regular',
    day: 1,
    standings: teams.map((t) => ({
      teamId: t.id,
      wins: 0,
      losses: 0,
      runsFor: 0,
      runsAgainst: 0,
    })),
  };

  return {
    leagueId: `league-${masterSeed}`,
    createdAtSeed: masterSeed,
    teams,
    stadiums,
    players,
    season,
  };
};
