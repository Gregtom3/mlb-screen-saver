import type { Player, PlayerId, Team, TeamId } from '../world/types.js';
import type {
  BattingLine,
  PitchingLine,
  SeasonAggregates,
  TeamLine,
} from '../stats/types.js';
import {
  battingAvg,
  era,
  ops,
  runDiff,
  whip,
} from '../stats/derived.js';
import {
  cyYoungRanking,
  mvpRanking,
  rookieRanking,
} from '../stats/awards.js';

// Phase 6 — multi-season history.
//
// One LeagueHistory carries every completed season's summary, plus career
// aggregates rolled up across them, plus a Hall of Fame list and
// single-season record book. The current (in-progress) season lives in
// /stats SeasonAggregates as before — history only records FINISHED seasons.

export type BattingLeaderKey = 'AVG' | 'OPS' | 'HR' | 'RBI' | 'H' | 'WPA';
export type PitchingLeaderKey = 'W' | 'ERA' | 'WHIP' | 'SO' | 'IP' | 'WPA';

export const BATTING_LEADER_KEYS: readonly BattingLeaderKey[] = [
  'AVG', 'OPS', 'HR', 'RBI', 'H', 'WPA',
];
export const PITCHING_LEADER_KEYS: readonly PitchingLeaderKey[] = [
  'W', 'ERA', 'WHIP', 'SO', 'IP', 'WPA',
];

export interface LeaderEntry {
  readonly playerId: PlayerId;
  readonly value: number;
}

export interface SeasonLeaders {
  readonly batting: Record<BattingLeaderKey, LeaderEntry>;
  readonly pitching: Record<PitchingLeaderKey, LeaderEntry>;
}

export interface SeasonRecord {
  readonly seasonYear: number;
  readonly champion: TeamId;
  readonly runnerUp: TeamId;
  readonly mvp: PlayerId | null;
  readonly cyYoung: PlayerId | null;
  readonly rookie: PlayerId | null;
  /** Final standings, league-wide, sorted by W desc → run diff desc. */
  readonly standings: readonly TeamLine[];
  readonly leaders: SeasonLeaders;
  /** Top batting lines by OPS for the year. */
  readonly battingTop: readonly BattingLine[];
  /** Top pitching lines by ERA for the year. */
  readonly pitchingTop: readonly PitchingLine[];
  /** Total team-games each team played that year (used by qualifier math). */
  readonly teamGamesPlayed: number;
}

export interface CareerBattingLine {
  readonly playerId: PlayerId;
  seasons: number;
  G: number; PA: number; AB: number; H: number; R: number;
  doubles: number; triples: number; HR: number; RBI: number;
  BB: number; HBP: number; SO: number; SF: number; SH: number; GIDP: number;
  WPA: number;
  /** Per-year batting lines so the player view can render a year-by-year table. */
  byYear: Record<number, BattingLine>;
}

export interface CareerPitchingLine {
  readonly playerId: PlayerId;
  seasons: number;
  G: number; GS: number; W: number; L: number; SV: number;
  IPouts: number; H: number; R: number; ER: number; HR: number;
  BB: number; HBP: number; SO: number; BF: number;
  WPA: number;
  byYear: Record<number, PitchingLine>;
}

export interface HallOfFamer {
  readonly playerId: PlayerId;
  readonly inductedYear: number;
  readonly score: number;
  readonly tag: 'batter' | 'pitcher';
  readonly summary: string;
}

export interface RecordBookEntry<K extends string> {
  readonly key: K;
  readonly playerId: PlayerId;
  readonly year: number;
  readonly value: number;
}

export interface SingleSeasonRecords {
  readonly batting: Record<BattingLeaderKey, RecordBookEntry<BattingLeaderKey>[]>;
  readonly pitching: Record<PitchingLeaderKey, RecordBookEntry<PitchingLeaderKey>[]>;
}

export interface LeagueHistory {
  readonly seasons: readonly SeasonRecord[];
  readonly careerBatting: ReadonlyMap<PlayerId, CareerBattingLine>;
  readonly careerPitching: ReadonlyMap<PlayerId, CareerPitchingLine>;
  readonly retiredPlayers: ReadonlySet<PlayerId>;
  readonly hallOfFame: readonly HallOfFamer[];
  readonly singleSeasonRecords: SingleSeasonRecords;
}

// ---- builders ----

const battingLeaderValue = (line: BattingLine, key: BattingLeaderKey): number => {
  switch (key) {
    case 'AVG': return battingAvg(line);
    case 'OPS': return ops(line);
    case 'HR': return line.HR;
    case 'RBI': return line.RBI;
    case 'H': return line.H;
    case 'WPA': return line.WPA;
  }
};

const pitchingLeaderValue = (line: PitchingLine, key: PitchingLeaderKey): number => {
  switch (key) {
    case 'W': return line.W;
    case 'ERA': return era(line);
    case 'WHIP': return whip(line);
    case 'SO': return line.SO;
    case 'IP': return line.IPouts / 3;
    case 'WPA': return line.WPA;
  }
};

const isBattingLeaderHigherBetter = (key: BattingLeaderKey): boolean => true;

const isPitchingLeaderHigherBetter = (key: PitchingLeaderKey): boolean => {
  return key !== 'ERA' && key !== 'WHIP';
};

const PA_QUALIFIER_PER_GAME = 3.1;
const IP_QUALIFIER_PER_GAME = 1.0;

const computeSeasonLeaders = (
  agg: SeasonAggregates,
  teamGames: number,
): SeasonLeaders => {
  const minPA = Math.floor(teamGames * PA_QUALIFIER_PER_GAME);
  const minIPouts = Math.floor(teamGames * IP_QUALIFIER_PER_GAME) * 3;
  const battingQual = [...agg.batting.values()].filter((b) => b.PA >= minPA);
  const pitchingQual = [...agg.pitching.values()].filter((p) => p.IPouts >= minIPouts);

  const pickBatting = (key: BattingLeaderKey): LeaderEntry => {
    const pool = battingQual.length > 0 ? battingQual : [...agg.batting.values()];
    if (pool.length === 0) return { playerId: '', value: 0 };
    const sorted = [...pool].sort((a, b) =>
      battingLeaderValue(b, key) - battingLeaderValue(a, key),
    );
    const top = sorted[0]!;
    return { playerId: top.playerId, value: battingLeaderValue(top, key) };
  };
  const pickPitching = (key: PitchingLeaderKey): LeaderEntry => {
    const pool = pitchingQual.length > 0 ? pitchingQual : [...agg.pitching.values()];
    if (pool.length === 0) return { playerId: '', value: 0 };
    const higher = isPitchingLeaderHigherBetter(key);
    const sorted = [...pool].sort((a, b) => {
      const va = pitchingLeaderValue(a, key);
      const vb = pitchingLeaderValue(b, key);
      return higher ? vb - va : va - vb;
    });
    const top = sorted[0]!;
    return { playerId: top.playerId, value: pitchingLeaderValue(top, key) };
  };

  const batting = {} as Record<BattingLeaderKey, LeaderEntry>;
  for (const k of BATTING_LEADER_KEYS) batting[k] = pickBatting(k);
  const pitching = {} as Record<PitchingLeaderKey, LeaderEntry>;
  for (const k of PITCHING_LEADER_KEYS) pitching[k] = pickPitching(k);
  return { batting, pitching };
};

export const summarizeSeason = (
  seasonYear: number,
  agg: SeasonAggregates,
  teams: readonly Team[],
  teamGames: number,
  playerIndex: ReadonlyMap<PlayerId, Player>,
): SeasonRecord => {
  void teams;
  // Final standings: sort by wins desc, run diff as tiebreaker. No playoffs
  // yet — champion is the regular-season win leader.
  const standings = [...agg.teams.values()].sort((a, b) => {
    if (b.W !== a.W) return b.W - a.W;
    return runDiff(b) - runDiff(a);
  });
  const champion = standings[0]?.teamId ?? '';
  const runnerUp = standings[1]?.teamId ?? champion;

  const mvp = mvpRanking(agg.batting, playerIndex, teamGames)[0]?.playerId ?? null;
  const cy = cyYoungRanking(agg.pitching, playerIndex, teamGames)[0]?.playerId ?? null;
  const rookie = rookieRanking(agg.batting, playerIndex, teamGames)[0]?.playerId ?? null;

  const leaders = computeSeasonLeaders(agg, teamGames);

  const battingTop = [...agg.batting.values()]
    .filter((b) => b.PA >= Math.floor(teamGames * PA_QUALIFIER_PER_GAME * 0.5))
    .sort((a, b) => ops(b) - ops(a))
    .slice(0, 10);
  const pitchingTop = [...agg.pitching.values()]
    .filter((p) => p.IPouts >= Math.floor(teamGames * IP_QUALIFIER_PER_GAME * 0.5) * 3)
    .sort((a, b) => era(a) - era(b))
    .slice(0, 10);

  return {
    seasonYear,
    champion,
    runnerUp,
    mvp,
    cyYoung: cy,
    rookie,
    standings,
    leaders,
    battingTop,
    pitchingTop,
    teamGamesPlayed: teamGames,
  };
};

const emptyCareerBatting = (playerId: PlayerId): CareerBattingLine => ({
  playerId,
  seasons: 0,
  G: 0, PA: 0, AB: 0, H: 0, R: 0,
  doubles: 0, triples: 0, HR: 0, RBI: 0,
  BB: 0, HBP: 0, SO: 0, SF: 0, SH: 0, GIDP: 0,
  WPA: 0,
  byYear: {},
});

const emptyCareerPitching = (playerId: PlayerId): CareerPitchingLine => ({
  playerId,
  seasons: 0,
  G: 0, GS: 0, W: 0, L: 0, SV: 0,
  IPouts: 0, H: 0, R: 0, ER: 0, HR: 0,
  BB: 0, HBP: 0, SO: 0, BF: 0,
  WPA: 0,
  byYear: {},
});

const accumulateCareerBatting = (
  career: Map<PlayerId, CareerBattingLine>,
  agg: SeasonAggregates,
  year: number,
): void => {
  for (const line of agg.batting.values()) {
    if (line.PA === 0) continue;
    let row = career.get(line.playerId);
    if (!row) {
      row = emptyCareerBatting(line.playerId);
      career.set(line.playerId, row);
    }
    row.seasons += 1;
    row.G += line.G; row.PA += line.PA; row.AB += line.AB;
    row.H += line.H; row.R += line.R;
    row.doubles += line.doubles; row.triples += line.triples;
    row.HR += line.HR; row.RBI += line.RBI;
    row.BB += line.BB; row.HBP += line.HBP;
    row.SO += line.SO; row.SF += line.SF;
    row.SH += line.SH; row.GIDP += line.GIDP;
    row.WPA += line.WPA;
    row.byYear[year] = line;
  }
};

const accumulateCareerPitching = (
  career: Map<PlayerId, CareerPitchingLine>,
  agg: SeasonAggregates,
  year: number,
): void => {
  for (const line of agg.pitching.values()) {
    if (line.BF === 0) continue;
    let row = career.get(line.playerId);
    if (!row) {
      row = emptyCareerPitching(line.playerId);
      career.set(line.playerId, row);
    }
    row.seasons += 1;
    row.G += line.G; row.GS += line.GS; row.W += line.W;
    row.L += line.L; row.SV += line.SV; row.IPouts += line.IPouts;
    row.H += line.H; row.R += line.R; row.ER += line.ER;
    row.HR += line.HR; row.BB += line.BB; row.HBP += line.HBP;
    row.SO += line.SO; row.BF += line.BF;
    row.WPA += line.WPA;
    row.byYear[year] = line;
  }
};

// Composite career score → drives Hall of Fame eligibility. Deliberately
// legible: ~1 point per single-equivalent + WPA + a pitcher curve.
export const careerBattingScore = (c: CareerBattingLine): number => {
  const tb = (c.H - c.doubles - c.triples - c.HR) + 2 * c.doubles + 3 * c.triples + 4 * c.HR;
  return tb + c.RBI * 0.4 + c.R * 0.4 + c.BB * 0.2 + c.WPA * 5;
};

export const careerPitchingScore = (c: CareerPitchingLine): number => {
  const ip = c.IPouts / 3;
  if (ip === 0) return 0;
  const eraC = (c.ER * 9) / ip;
  return c.W * 8 + c.SO * 0.4 + ip * 0.5 - eraC * 5 + c.WPA * 5;
};

const HOF_BATTING_THRESHOLD = 250;
const HOF_PITCHING_THRESHOLD = 220;

const buildSingleSeasonRecords = (
  seasons: readonly SeasonRecord[],
): SingleSeasonRecords => {
  const batting = {} as Record<BattingLeaderKey, RecordBookEntry<BattingLeaderKey>[]>;
  const pitching = {} as Record<PitchingLeaderKey, RecordBookEntry<PitchingLeaderKey>[]>;

  for (const key of BATTING_LEADER_KEYS) {
    const all: RecordBookEntry<BattingLeaderKey>[] = [];
    for (const s of seasons) {
      for (const line of s.battingTop) {
        const value = battingLeaderValue(line, key);
        all.push({ key, playerId: line.playerId, year: s.seasonYear, value });
      }
    }
    const higher = isBattingLeaderHigherBetter(key);
    all.sort((a, b) => (higher ? b.value - a.value : a.value - b.value));
    batting[key] = all.slice(0, 5);
  }

  for (const key of PITCHING_LEADER_KEYS) {
    const all: RecordBookEntry<PitchingLeaderKey>[] = [];
    for (const s of seasons) {
      for (const line of s.pitchingTop) {
        const value = pitchingLeaderValue(line, key);
        all.push({ key, playerId: line.playerId, year: s.seasonYear, value });
      }
    }
    const higher = isPitchingLeaderHigherBetter(key);
    all.sort((a, b) => (higher ? b.value - a.value : a.value - b.value));
    pitching[key] = all.slice(0, 5);
  }

  return { batting, pitching };
};

export interface BuildHistoryInput {
  readonly seasons: readonly { year: number; agg: SeasonAggregates; teamGames: number }[];
  readonly teams: readonly Team[];
  readonly playerIndex: ReadonlyMap<PlayerId, Player>;
  /**
   * Players considered retired after the simulated history finishes. Used
   * to gate Hall of Fame induction. If empty the HoF stays empty (you don't
   * induct active players).
   */
  readonly retiredPlayers: ReadonlySet<PlayerId>;
}

export const buildLeagueHistory = (input: BuildHistoryInput): LeagueHistory => {
  const seasons: SeasonRecord[] = [];
  const careerBatting = new Map<PlayerId, CareerBattingLine>();
  const careerPitching = new Map<PlayerId, CareerPitchingLine>();

  for (const s of input.seasons) {
    seasons.push(summarizeSeason(s.year, s.agg, input.teams, s.teamGames, input.playerIndex));
    accumulateCareerBatting(careerBatting, s.agg, s.year);
    accumulateCareerPitching(careerPitching, s.agg, s.year);
  }

  // Hall of fame: retired players whose composite career score crosses the
  // threshold for either side of the ball, sorted by score desc.
  const inductedYear = seasons.length > 0 ? seasons[seasons.length - 1]!.seasonYear : 0;
  const hallOfFame: HallOfFamer[] = [];
  for (const id of input.retiredPlayers) {
    const cb = careerBatting.get(id);
    const cp = careerPitching.get(id);
    const bScore = cb ? careerBattingScore(cb) : 0;
    const pScore = cp ? careerPitchingScore(cp) : 0;
    if (bScore >= HOF_BATTING_THRESHOLD && bScore >= pScore) {
      hallOfFame.push({
        playerId: id,
        inductedYear,
        score: bScore,
        tag: 'batter',
        summary: cb
          ? `${cb.seasons} seasons · ${cb.H} H · ${cb.HR} HR · ${cb.RBI} RBI`
          : '',
      });
    } else if (pScore >= HOF_PITCHING_THRESHOLD) {
      hallOfFame.push({
        playerId: id,
        inductedYear,
        score: pScore,
        tag: 'pitcher',
        summary: cp
          ? `${cp.seasons} seasons · ${cp.W}-${cp.L} · ${cp.SO} K · ${(cp.IPouts / 3).toFixed(0)} IP`
          : '',
      });
    }
  }
  hallOfFame.sort((a, b) => b.score - a.score);

  const singleSeasonRecords = buildSingleSeasonRecords(seasons);

  return {
    seasons,
    careerBatting,
    careerPitching,
    retiredPlayers: input.retiredPlayers,
    hallOfFame,
    singleSeasonRecords,
  };
};

export const formatLeaderValue = (
  key: BattingLeaderKey | PitchingLeaderKey,
  value: number,
): string => {
  switch (key) {
    case 'AVG':
    case 'OPS': {
      const v = Math.floor(value * 1000) / 1000;
      return v >= 1 ? v.toFixed(3) : v.toFixed(3).replace(/^0/, '');
    }
    case 'ERA':
    case 'WHIP':
      return value.toFixed(2);
    case 'IP':
      return value.toFixed(1);
    case 'WPA':
      return (value > 0 ? '+' : '') + value.toFixed(2);
    default:
      return String(Math.round(value));
  }
};
