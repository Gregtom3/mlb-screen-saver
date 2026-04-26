import type { Player, Position, Team } from '../world/types.js';
import type { FieldingPosition, Lineup } from './types.js';

const FIELDING_POSITIONS: readonly FieldingPosition[] = [
  'P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF',
];

const hittingScore = (p: Player): number =>
  p.ratings.contact * 1.0 + p.ratings.power * 1.0 + p.ratings.discipline * 0.5;

const onBaseScore = (p: Player): number => p.ratings.discipline + p.ratings.speed * 0.6;

const fieldingScore = (p: Player): number =>
  p.ratings.glove * 1.0 + p.ratings.range * 0.6 + p.ratings.armStrength * 0.4;

// Pick the best player for a defensive position out of the active roster.
// Prefers primary position; otherwise considers secondaryPositions; otherwise any non-DH.
const pickFielder = (
  players: readonly Player[],
  pos: FieldingPosition,
  excludeIds: ReadonlySet<string>,
): Player => {
  const eligible = players.filter((p) => !p.inMinors && !excludeIds.has(p.id));
  const primaries = eligible.filter((p) => p.primaryPosition === pos);
  if (primaries.length > 0) {
    return primaries.sort((a, b) => fieldingScore(b) + hittingScore(b) - (fieldingScore(a) + hittingScore(a)))[0]!;
  }
  const secondaries = eligible.filter((p) => p.secondaryPositions.includes(pos));
  if (secondaries.length > 0) {
    return secondaries.sort((a, b) => fieldingScore(b) - fieldingScore(a))[0]!;
  }
  // Fallback: anyone non-pitcher, non-DH.
  const fallback = eligible.filter((p) => p.primaryPosition !== 'P' && p.primaryPosition !== 'DH');
  if (fallback.length === 0) throw new Error(`No fielder available for ${pos}`);
  return fallback.sort((a, b) => fieldingScore(b) - fieldingScore(a))[0]!;
};

export const buildLineup = (
  team: Team,
  rosterPlayers: readonly Player[],
  gameDay: number,
): Lineup => {
  const teamRoster = rosterPlayers.filter((p) => p.teamId === team.id && !p.inMinors);
  const pitchers = teamRoster.filter((p) => p.primaryPosition === 'P');
  if (pitchers.length < 12) {
    throw new Error(`Team ${team.id} has fewer than 12 active pitchers`);
  }
  // Top 5 by stamina = starting rotation; remainder = bullpen ordered by composure.
  const sortedPitchers = [...pitchers].sort((a, b) => b.ratings.stamina - a.ratings.stamina);
  const rotation = sortedPitchers.slice(0, 5);
  const bullpen = sortedPitchers
    .slice(5)
    .sort((a, b) => b.ratings.composure - a.ratings.composure);

  const startingPitcher = rotation[(gameDay - 1) % rotation.length];
  if (!startingPitcher) throw new Error('No starting pitcher available');

  // Defense: pick best at each position, pitcher slot is the SP.
  const defenseByPosition: Partial<Record<FieldingPosition, string>> = {};
  const used = new Set<string>([startingPitcher.id]);
  defenseByPosition.P = startingPitcher.id;
  for (const pos of FIELDING_POSITIONS) {
    if (pos === 'P') continue;
    const fielder = pickFielder(teamRoster, pos, used);
    defenseByPosition[pos] = fielder.id;
    used.add(fielder.id);
  }

  // DH: best remaining hitter not already in the field, prefer primary DH, else best hitter.
  const remaining = teamRoster.filter((p) => !used.has(p.id) && p.primaryPosition !== 'P');
  const dhCandidates = remaining.filter((p) => p.primaryPosition === 'DH');
  const dh =
    dhCandidates.sort((a, b) => hittingScore(b) - hittingScore(a))[0] ??
    remaining.sort((a, b) => hittingScore(b) - hittingScore(a))[0];
  if (!dh) throw new Error(`No DH for team ${team.id}`);
  used.add(dh.id);

  // 9 batters: the 8 fielders (sans pitcher) + DH.
  const fielderIds = (FIELDING_POSITIONS.filter((p) => p !== 'P') as FieldingPosition[]).map(
    (pos) => defenseByPosition[pos]!,
  );
  const batterIds = [...fielderIds, dh.id];
  const idToPlayer = new Map(teamRoster.map((p) => [p.id, p]));
  const batters = batterIds.map((id) => idToPlayer.get(id)!);

  // Order: leadoff = best on-base score, cleanup = best power, rest by hitting score.
  const leadoff = [...batters].sort((a, b) => onBaseScore(b) - onBaseScore(a))[0]!;
  const cleanup = [...batters]
    .filter((p) => p.id !== leadoff.id)
    .sort((a, b) => b.ratings.power - a.ratings.power)[0]!;
  const rest = batters
    .filter((p) => p.id !== leadoff.id && p.id !== cleanup.id)
    .sort((a, b) => hittingScore(b) - hittingScore(a));
  // Standard 9-slot order: 1, 2, 3, cleanup(4), 5, 6, 7, 8, 9.
  const battingOrder = [leadoff, rest[0]!, rest[1]!, cleanup, rest[2]!, rest[3]!, rest[4]!, rest[5]!, rest[6]!];

  return {
    teamId: team.id,
    battingOrder: battingOrder.map((p) => p.id),
    startingPitcher: startingPitcher.id,
    bullpen: bullpen.map((p) => p.id),
    defenseByPosition: defenseByPosition as Record<FieldingPosition, string>,
  };
};
