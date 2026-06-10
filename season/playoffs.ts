// /season/playoffs.ts — postseason bracket as pure data + pure transitions.
//
// Format for the 16-team league: the top two teams in each conference (by
// W, then run diff, then teamId for determinism) meet in a best-of-5
// Conference Series; the two CS winners meet in a best-of-7 Final. One game
// per active series per playoff "day". Home field belongs to the higher
// seed on a 2-2-1 (Bo5) / 2-2-1-1-1 (Bo7) pattern.
//
// Everything here is deterministic and side-effect free: the same seeding
// input and the same game results always produce the same bracket states,
// which is what lets a reload replay the postseason exactly.

import type { Team, TeamId } from '../world/types.js';

export type PlayoffRound = 'cs' | 'final';

export interface PlayoffSeedEntry {
  readonly teamId: TeamId;
  readonly wins: number;
  readonly runDiff: number;
}

export interface PlayoffSeries {
  readonly id: string; // 'cs-east' | 'cs-west' | 'final'
  readonly round: PlayoffRound;
  readonly label: string; // e.g. 'East CS', 'Finals'
  readonly bestOf: 5 | 7;
  /** Higher seed — holds home-field advantage. */
  readonly highSeed: TeamId;
  readonly lowSeed: TeamId;
  readonly highWins: number;
  readonly lowWins: number;
}

export interface PlayoffState {
  readonly year: number;
  /** 1-based playoff day about to be (or being) played. */
  readonly day: number;
  /** The four qualifiers in overall seed order — decides Final home field. */
  readonly seedOrder: readonly TeamId[];
  readonly series: readonly PlayoffSeries[];
  readonly champion: TeamId | null;
  readonly runnerUp: TeamId | null;
}

export interface PlayoffGameEntry {
  readonly gameId: string;
  readonly day: number;
  readonly homeTeamId: TeamId;
  readonly awayTeamId: TeamId;
  readonly stadiumId: string;
  readonly seriesId: string;
  readonly seriesLabel: string;
  /** 1-based game number within the series. */
  readonly gameNumber: number;
}

const winsNeeded = (s: PlayoffSeries): number => (s.bestOf + 1) / 2;

export const seriesDecided = (s: PlayoffSeries): boolean =>
  s.highWins >= winsNeeded(s) || s.lowWins >= winsNeeded(s);

export const seriesWinner = (s: PlayoffSeries): TeamId | null =>
  s.highWins >= winsNeeded(s) ? s.highSeed : s.lowWins >= winsNeeded(s) ? s.lowSeed : null;

// Home team for game N of a series: the high seed hosts games 1, 2 and the
// odd late games (5 in a Bo5; 5 and 7 in a Bo7); the low seed hosts 3, 4
// (and 6). Classic 2-2-1 / 2-2-1-1-1.
export const homeTeamForGame = (s: PlayoffSeries, gameNumber: number): TeamId => {
  const lowHosts = gameNumber === 3 || gameNumber === 4 || gameNumber === 6;
  return lowHosts ? s.lowSeed : s.highSeed;
};

/**
 * Seed the bracket from final regular-season standings. `entries` may be in
 * any order; ties break by run diff then teamId so seeding is deterministic.
 */
export const seedPlayoffs = (
  year: number,
  teams: readonly Team[],
  entries: readonly PlayoffSeedEntry[],
): PlayoffState => {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const sorted = [...entries].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.runDiff !== a.runDiff) return b.runDiff - a.runDiff;
    return a.teamId < b.teamId ? -1 : 1;
  });
  const series: PlayoffSeries[] = [];
  for (const conference of ['East', 'West'] as const) {
    const confTeams = sorted.filter(
      (e) => teamById.get(e.teamId)?.conference === conference,
    );
    const one = confTeams[0];
    const two = confTeams[1];
    if (!one || !two) throw new Error(`playoffs: fewer than 2 ${conference} teams`);
    series.push({
      id: `cs-${conference.toLowerCase()}`,
      round: 'cs',
      label: `${conference} CS`,
      bestOf: 5,
      highSeed: one.teamId,
      lowSeed: two.teamId,
      highWins: 0,
      lowWins: 0,
    });
  }
  const qualifiers = new Set(series.flatMap((s) => [s.highSeed, s.lowSeed]));
  const seedOrder = sorted.map((e) => e.teamId).filter((id) => qualifiers.has(id));
  return { year, day: 1, seedOrder, series, champion: null, runnerUp: null };
};

/**
 * The slate for the current playoff day: one game per undecided series.
 * Empty array = the postseason is over (champion is set).
 */
export const playoffGamesForDay = (
  state: PlayoffState,
  teams: readonly Team[],
): PlayoffGameEntry[] => {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const games: PlayoffGameEntry[] = [];
  for (const s of state.series) {
    if (seriesDecided(s)) continue;
    const gameNumber = s.highWins + s.lowWins + 1;
    const homeTeamId = homeTeamForGame(s, gameNumber);
    const awayTeamId = homeTeamId === s.highSeed ? s.lowSeed : s.highSeed;
    const home = teamById.get(homeTeamId);
    if (!home) throw new Error(`playoffs: unknown team ${homeTeamId}`);
    games.push({
      gameId: `s${state.year}-po-${s.id}-g${gameNumber}`,
      day: state.day,
      homeTeamId,
      awayTeamId,
      stadiumId: home.stadiumId,
      seriesId: s.id,
      seriesLabel: s.label,
      gameNumber,
    });
  }
  return games;
};

export interface PlayoffGameResult {
  readonly seriesId: string;
  readonly winner: TeamId;
}

/**
 * Fold one day's results into the bracket. When both Conference Series are
 * decided, the Final is created; when the Final is decided, `champion` and
 * `runnerUp` are set. The returned state's `day` is advanced by 1.
 */
export const applyPlayoffResults = (
  state: PlayoffState,
  results: readonly PlayoffGameResult[],
): PlayoffState => {
  const byId = new Map(results.map((r) => [r.seriesId, r]));
  let series = state.series.map((s) => {
    const r = byId.get(s.id);
    if (!r || seriesDecided(s)) return s;
    if (r.winner !== s.highSeed && r.winner !== s.lowSeed) {
      throw new Error(`playoffs: ${r.winner} is not in series ${s.id}`);
    }
    return r.winner === s.highSeed
      ? { ...s, highWins: s.highWins + 1 }
      : { ...s, lowWins: s.lowWins + 1 };
  });

  // Both CS done and no Final yet → create it. Home field in the Final goes
  // to the CS winner with the better overall regular-season seed.
  const csSeries = series.filter((s) => s.round === 'cs');
  const finalExists = series.some((s) => s.round === 'final');
  if (!finalExists && csSeries.length === 2 && csSeries.every(seriesDecided)) {
    const winners = csSeries.map((s) => seriesWinner(s)!);
    winners.sort((a, b) => state.seedOrder.indexOf(a) - state.seedOrder.indexOf(b));
    series = [
      ...series,
      {
        id: 'final',
        round: 'final' as const,
        label: 'Finals',
        bestOf: 7 as const,
        highSeed: winners[0]!,
        lowSeed: winners[1]!,
        highWins: 0,
        lowWins: 0,
      },
    ];
  }

  const final = series.find((s) => s.round === 'final');
  let champion: TeamId | null = null;
  let runnerUp: TeamId | null = null;
  if (final && seriesDecided(final)) {
    champion = seriesWinner(final);
    runnerUp = champion === final.highSeed ? final.lowSeed : final.highSeed;
  }

  return {
    year: state.year,
    day: state.day + 1,
    seedOrder: state.seedOrder,
    series,
    champion,
    runnerUp,
  };
};
