import type { LeagueSnapshot, SeasonState } from '../world/types.js';
import { buildTeamsAndStadiums } from './teams.js';

// Phase 0: produce a minimal, valid LeagueSnapshot from a master seed.
// Player generation is Phase 1. Schedule generation is Phase 1.
export const generateInitialLeague = (masterSeed: number): LeagueSnapshot => {
  const { teams, stadiums } = buildTeamsAndStadiums();

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
    players: [], // Phase 1 fills this
    season,
  };
};
