// "Star batter" derivation. The crowd lifts an extra notch when a fan
// favorite steps in. We don't add a flag to /world — instead we derive a
// deterministic star-set from prior-season aggregates if available, falling
// back to in-roster ratings (power + contact + clutch composite) when there
// are no prior stats yet.

import type { PlayerId, Player } from '../world/types.js';
import type { SeasonAggregates } from '../stats/types.js';

export interface StarSet {
  has(playerId: PlayerId): boolean;
}

const EMPTY_STAR_SET: StarSet = { has: () => false };

// Build the star set for a given home team. Top ~6 players by HR over the
// season aggregates count as stars; if no aggregates are available, fall
// back to ratings. The returned set is keyed by playerId so the reducer
// reads it in O(1).
export const buildStarSet = (opts: {
  readonly homeTeamPlayers: readonly Player[];
  readonly awayTeamPlayers: readonly Player[];
  readonly aggregates?: SeasonAggregates;
}): StarSet => {
  const { homeTeamPlayers, awayTeamPlayers, aggregates } = opts;
  const stars = new Set<PlayerId>();

  const addTopByHR = (players: readonly Player[]): void => {
    if (aggregates && aggregates.batting.size > 0) {
      // Sort by HR desc (then RBI as a tiebreaker), take top 6.
      const lines = players
        .map((p) => ({ id: p.id, line: aggregates.batting.get(p.id) }))
        .filter((r): r is { id: PlayerId; line: NonNullable<typeof r.line> } => !!r.line)
        .sort((a, b) => (b.line.HR - a.line.HR) || (b.line.RBI - a.line.RBI));
      for (let i = 0; i < Math.min(6, lines.length); i++) {
        stars.add(lines[i]!.id);
      }
      return;
    }
    // Fallback: rate by composite (power + contact + clutch). Top 4 / team.
    const ranked = players
      .map((p) => ({
        id: p.id,
        score: p.ratings.power * 1.4 + p.ratings.contact + p.ratings.clutch * 0.6,
      }))
      .sort((a, b) => b.score - a.score);
    for (let i = 0; i < Math.min(4, ranked.length); i++) {
      stars.add(ranked[i]!.id);
    }
  };

  addTopByHR(homeTeamPlayers);
  addTopByHR(awayTeamPlayers);
  return { has: (id) => stars.has(id) };
};

export { EMPTY_STAR_SET };
