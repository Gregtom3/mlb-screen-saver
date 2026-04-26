import type { Schedule } from '../season/types.js';
import type { SeasonAggregates, TeamLine } from '../stats/types.js';
import { pythagoreanExpectation } from '../stats/derived.js';
import type { Team, TeamId } from '../world/types.js';
import { createPRNG } from '../sim/prng.js';
import type { ProjectionSet, TeamProjection } from './types.js';

// Phase 5.5 part 2 — playoff projections.
//
// Method: Pythagorean win expectation per team → log5 per-game probability →
// Monte Carlo over the remaining schedule. Defaults: 1000 sims, regressed
// 50/50 prior weighted in proportional to games remaining (so opening-week
// projections aren't dominated by random hot-starts).
//
// Post-season: 8-team bracket — top 4 per conference, best-of-5 division
// round, best-of-7 championship. Per-game win prob is the same log5 used in
// the regular season (no manager / starter-rotation modeling yet).

const DEFAULT_SIMS = 1000;
const HOME_FIELD_BUMP = 0.04; // additive bump to home win prob

const log5 = (pa: number, pb: number): number => {
  // log5: P(A beats B) = (pa - pa*pb) / (pa + pb - 2*pa*pb), Bill James 1981.
  const num = pa - pa * pb;
  const den = pa + pb - 2 * pa * pb;
  if (den <= 0) return 0.5;
  return Math.max(0.05, Math.min(0.95, num / den));
};

const teamStrength = (line: TeamLine | undefined, gamesPlayed: number, totalGames: number): number => {
  if (!line || gamesPlayed === 0) return 0.5;
  const pyth = pythagoreanExpectation(line);
  // Regress to .500 by remaining-games weight. Early in the season the
  // prior dominates; late, the team's actual record is the signal.
  const w = gamesPlayed / totalGames;
  return pyth * w + 0.5 * (1 - w);
};

interface SimulatedSeasonResult {
  readonly finalWins: Map<TeamId, number>;
  readonly playoffSeeds: Map<TeamId, number>; // 1..4 = qualified, 0 = miss
  readonly conferenceWinner: Map<'West' | 'East', TeamId>;
  readonly champion: TeamId;
}

interface RemainingGame {
  readonly day: number;
  readonly home: TeamId;
  readonly away: TeamId;
}

const simulateSeason = (
  teams: readonly Team[],
  startingWins: Map<TeamId, number>,
  remaining: readonly RemainingGame[],
  strengths: Map<TeamId, number>,
  rng: ReturnType<typeof createPRNG>,
): SimulatedSeasonResult => {
  const wins = new Map(startingWins);

  for (const g of remaining) {
    const sH = strengths.get(g.home) ?? 0.5;
    const sA = strengths.get(g.away) ?? 0.5;
    let pHome = log5(sH, sA) + HOME_FIELD_BUMP;
    pHome = Math.max(0.05, Math.min(0.95, pHome));
    if (rng.next() < pHome) wins.set(g.home, (wins.get(g.home) ?? 0) + 1);
    else wins.set(g.away, (wins.get(g.away) ?? 0) + 1);
  }

  // Playoff seeding — top 4 per conference by wins, ties broken by raw
  // strength (Pythagorean) which we already have on hand.
  const seeds = new Map<TeamId, number>();
  const byConf: Record<'West' | 'East', Team[]> = { West: [], East: [] };
  for (const t of teams) byConf[t.conference].push(t);
  const seededByConf: Record<'West' | 'East', Team[]> = { West: [], East: [] };
  for (const conf of ['West', 'East'] as const) {
    const sorted = byConf[conf]
      .slice()
      .sort((a, b) => {
        const wa = wins.get(a.id) ?? 0;
        const wb = wins.get(b.id) ?? 0;
        if (wb !== wa) return wb - wa;
        return (strengths.get(b.id) ?? 0) - (strengths.get(a.id) ?? 0);
      });
    sorted.slice(0, 4).forEach((t, idx) => seeds.set(t.id, idx + 1));
    seededByConf[conf] = sorted.slice(0, 4);
  }

  // Best-of-N series — collapse to the winner in O(1) with a deterministic
  // RNG: simulate up to N games, count wins, declare winner.
  const playSeries = (a: Team, b: Team, gamesNeededToWin: number): Team => {
    const sa = strengths.get(a.id) ?? 0.5;
    const sb = strengths.get(b.id) ?? 0.5;
    let aw = 0;
    let bw = 0;
    while (aw < gamesNeededToWin && bw < gamesNeededToWin) {
      // Higher seed gets HFA on odd games (1,2,5,7); lower seed gets it on
      // 3,4,6. Simplification of the actual MLB pattern.
      const aIsHome = (aw + bw) % 2 === 0;
      const sH = aIsHome ? sa : sb;
      const sA = aIsHome ? sb : sa;
      const pH = log5(sH, sA) + HOME_FIELD_BUMP;
      if (rng.next() < pH) {
        if (aIsHome) aw += 1; else bw += 1;
      } else {
        if (aIsHome) bw += 1; else aw += 1;
      }
    }
    return aw > bw ? a : b;
  };

  const conferenceWinner = new Map<'West' | 'East', TeamId>();
  for (const conf of ['West', 'East'] as const) {
    const [s1, s2, s3, s4] = seededByConf[conf];
    if (!s1 || !s2 || !s3 || !s4) continue;
    // Best-of-5: 1v4 and 2v3
    const div1 = playSeries(s1, s4, 3);
    const div2 = playSeries(s2, s3, 3);
    // Best-of-7 conference final
    const champ = playSeries(div1, div2, 4);
    conferenceWinner.set(conf, champ.id);
  }
  // Best-of-7 championship.
  const w = teams.find((t) => t.id === conferenceWinner.get('West'));
  const e = teams.find((t) => t.id === conferenceWinner.get('East'));
  const champion = w && e ? playSeries(w, e, 4).id : (w?.id ?? e?.id ?? teams[0]!.id);

  return { finalWins: wins, playoffSeeds: seeds, conferenceWinner, champion };
};

export interface ProjectionInput {
  readonly seasonYear: number;
  readonly teams: readonly Team[];
  readonly schedule: Schedule;
  readonly aggregates: SeasonAggregates;
  readonly currentDay: number; // 1-indexed; games on days <= currentDay are "played"
  readonly simulations?: number;
  readonly seed?: number;
}

export const buildProjections = (input: ProjectionInput): ProjectionSet => {
  const sims = input.simulations ?? DEFAULT_SIMS;
  const seed = input.seed ?? 0xc0_de_d0_de;
  const rng = createPRNG(seed).fork(`projections:${input.seasonYear}:${input.currentDay}`);

  const totalGames = input.schedule.entries.length / input.teams.length; // 150 per team
  const startingWins = new Map<TeamId, number>();
  let totalGamesPlayed = 0;
  for (const team of input.teams) {
    const line = input.aggregates.teams.get(team.id);
    startingWins.set(team.id, line?.W ?? 0);
    totalGamesPlayed = Math.max(totalGamesPlayed, (line?.W ?? 0) + (line?.L ?? 0));
  }
  const strengths = new Map<TeamId, number>();
  for (const team of input.teams) {
    strengths.set(team.id, teamStrength(input.aggregates.teams.get(team.id), totalGamesPlayed, totalGames));
  }

  const remaining: RemainingGame[] = input.schedule.entries
    .filter((e) => e.day > input.currentDay)
    .map((e) => ({ day: e.day, home: e.homeTeamId, away: e.awayTeamId }));

  // Tally counters across sims.
  const winSamples = new Map<TeamId, number[]>();
  const playoffCt = new Map<TeamId, number>();
  const divisionCt = new Map<TeamId, number>();
  const topSeedCt = new Map<TeamId, number>();
  const confCt = new Map<TeamId, number>();
  const titleCt = new Map<TeamId, number>();
  for (const t of input.teams) {
    winSamples.set(t.id, []);
    playoffCt.set(t.id, 0);
    divisionCt.set(t.id, 0);
    topSeedCt.set(t.id, 0);
    confCt.set(t.id, 0);
    titleCt.set(t.id, 0);
  }

  for (let i = 0; i < sims; i++) {
    const result = simulateSeason(input.teams, startingWins, remaining, strengths, rng);
    for (const t of input.teams) {
      winSamples.get(t.id)!.push(result.finalWins.get(t.id) ?? 0);
      const seed_ = result.playoffSeeds.get(t.id);
      if (seed_) {
        playoffCt.set(t.id, (playoffCt.get(t.id) ?? 0) + 1);
        if (seed_ === 1) {
          divisionCt.set(t.id, (divisionCt.get(t.id) ?? 0) + 1);
          topSeedCt.set(t.id, (topSeedCt.get(t.id) ?? 0) + 1);
        }
      }
      if (result.conferenceWinner.get('West') === t.id || result.conferenceWinner.get('East') === t.id) {
        confCt.set(t.id, (confCt.get(t.id) ?? 0) + 1);
      }
      if (result.champion === t.id) {
        titleCt.set(t.id, (titleCt.get(t.id) ?? 0) + 1);
      }
    }
  }

  // Distill samples into projections.
  const teamProjections = new Map<TeamId, TeamProjection>();
  for (const team of input.teams) {
    const samples = winSamples.get(team.id)!.slice().sort((a, b) => a - b);
    const pick = (q: number) => samples[Math.min(samples.length - 1, Math.floor(samples.length * q))]!;
    const line = input.aggregates.teams.get(team.id);
    const remainingForTeam = input.schedule.entries
      .filter((e) => e.day > input.currentDay && (e.homeTeamId === team.id || e.awayTeamId === team.id));
    let sosSum = 0;
    for (const g of remainingForTeam) {
      const opp = g.homeTeamId === team.id ? g.awayTeamId : g.homeTeamId;
      sosSum += strengths.get(opp) ?? 0.5;
    }
    const sos = remainingForTeam.length > 0 ? sosSum / remainingForTeam.length : 0.5;
    teamProjections.set(team.id, {
      teamId: team.id,
      currentW: line?.W ?? 0,
      currentL: line?.L ?? 0,
      pythagoreanWinPct: pythagoreanExpectation(line ?? { teamId: team.id, W: 0, L: 0, RS: 0, RA: 0, homeW: 0, homeL: 0, awayW: 0, awayL: 0, divW: 0, divL: 0, resultsTimeline: [] }),
      winsP05: pick(0.05),
      winsP50: pick(0.5),
      winsP95: pick(0.95),
      pPlayoffs: (playoffCt.get(team.id) ?? 0) / sims,
      pDivision: (divisionCt.get(team.id) ?? 0) / sims,
      pTopSeed: (topSeedCt.get(team.id) ?? 0) / sims,
      pConference: (confCt.get(team.id) ?? 0) / sims,
      pTitle: (titleCt.get(team.id) ?? 0) / sims,
      sosRemaining: sos,
      magicDivision: null, // computed at view time once we have rivals
      eliminationDivision: null,
    });
  }

  return {
    seasonYear: input.seasonYear,
    simulations: sims,
    seed,
    teams: teamProjections,
  };
};

// Magic / elimination numbers vs. the team's division rivals. Computed at
// view time because it needs the full division standing.
export const computeMagicNumber = (
  team: TeamProjection,
  divisionRivals: readonly TeamProjection[],
  totalGames: number,
): { magic: number | null; elimination: number | null } => {
  const teamGamesRemaining = totalGames - team.currentW - team.currentL;
  if (divisionRivals.length === 0) return { magic: null, elimination: null };
  const closestRival = [...divisionRivals]
    .filter((r) => r.teamId !== team.teamId)
    .sort((a, b) => b.currentW - a.currentW)[0];
  if (!closestRival) return { magic: null, elimination: null };
  const rivalGamesRemaining = totalGames - closestRival.currentW - closestRival.currentL;

  // Magic: number of (team wins) + (rival losses) needed for division clinch.
  // Formula: (rival's max wins + 1) - (team's current wins). Negative = clinched.
  const rivalMaxWins = closestRival.currentW + rivalGamesRemaining;
  const rawMagic = rivalMaxWins + 1 - team.currentW;
  const magic = rawMagic <= 0 ? 0 : rawMagic;

  // Elimination: number of (team losses) + (rival wins) before team is out.
  const teamMaxWins = team.currentW + teamGamesRemaining;
  const rawElim = teamMaxWins + 1 - closestRival.currentW;
  const elimination = rawElim <= 0 ? 0 : rawElim;

  return { magic, elimination };
};
