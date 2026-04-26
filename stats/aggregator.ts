import type { AtBatOutcome, GameInput, SimEvent } from '../sim/types.js';
import type { PlayerId, Team, TeamId } from '../world/types.js';
import {
  emptyBattingLine,
  emptyPitchingLine,
  emptySeasonAggregates,
  emptyTeamLine,
  type BattingLine,
  type PitchingLine,
  type SeasonAggregates,
  type TeamLine,
} from './types.js';
import { homeWinProb, type WPState } from './wp.js';

// Phase 5.5 step 5.5.1 — aggregator. Walks one game's SimEvent log once and
// folds its results into season-level BattingLine, PitchingLine, and
// TeamLine rows. Reads only the canonical event log and the GameInput;
// never mutates the sim.

export interface FinishedGame {
  readonly events: readonly SimEvent[];
  readonly input: GameInput;
}

interface AggregatorContext {
  readonly teamsById: ReadonlyMap<TeamId, Team>;
}

const getOrCreateBatting = (
  agg: SeasonAggregates,
  playerId: PlayerId,
  teamId: TeamId,
): BattingLine => {
  let line = agg.batting.get(playerId);
  if (!line) {
    line = emptyBattingLine(playerId, teamId);
    agg.batting.set(playerId, line);
  }
  return line;
};

const getOrCreatePitching = (
  agg: SeasonAggregates,
  playerId: PlayerId,
  teamId: TeamId,
): PitchingLine => {
  let line = agg.pitching.get(playerId);
  if (!line) {
    line = emptyPitchingLine(playerId, teamId);
    agg.pitching.set(playerId, line);
  }
  return line;
};

const getOrCreateTeam = (agg: SeasonAggregates, teamId: TeamId): TeamLine => {
  let line = agg.teams.get(teamId);
  if (!line) {
    line = emptyTeamLine(teamId);
    agg.teams.set(teamId, line);
  }
  return line;
};

const outsAddedFor = (outcome: AtBatOutcome): number => {
  switch (outcome) {
    case 'strikeout-looking':
    case 'strikeout-swinging':
    case 'groundout':
    case 'flyout':
    case 'lineout':
    case 'popout':
    case 'sac-fly':
    case 'sac-bunt':
    case 'fielders-choice':
      return 1;
    case 'double-play':
      return 2;
    case 'triple-play':
      return 3;
    default:
      return 0;
  }
};

interface OutcomeEffects {
  readonly atBatCounts: boolean;
  readonly hits: number; // 0 or 1
  readonly doubles: number;
  readonly triples: number;
  readonly homeRuns: number;
  readonly walks: number;
  readonly hbp: number;
  readonly strikeouts: number;
  readonly sacFlies: number;
  readonly sacBunts: number;
  readonly gidp: number;
}

const NO_EFFECT: OutcomeEffects = {
  atBatCounts: false, hits: 0, doubles: 0, triples: 0, homeRuns: 0,
  walks: 0, hbp: 0, strikeouts: 0, sacFlies: 0, sacBunts: 0, gidp: 0,
};

const effectsFor = (outcome: AtBatOutcome): OutcomeEffects => {
  switch (outcome) {
    case 'home-run': return { ...NO_EFFECT, atBatCounts: true, hits: 1, homeRuns: 1 };
    case 'triple': return { ...NO_EFFECT, atBatCounts: true, hits: 1, triples: 1 };
    case 'double': return { ...NO_EFFECT, atBatCounts: true, hits: 1, doubles: 1 };
    case 'single': return { ...NO_EFFECT, atBatCounts: true, hits: 1 };
    case 'walk': return { ...NO_EFFECT, atBatCounts: false, walks: 1 };
    case 'hit-by-pitch': return { ...NO_EFFECT, atBatCounts: false, hbp: 1 };
    case 'strikeout-looking':
    case 'strikeout-swinging':
      return { ...NO_EFFECT, atBatCounts: true, strikeouts: 1 };
    case 'sac-fly': return { ...NO_EFFECT, atBatCounts: false, sacFlies: 1 };
    case 'sac-bunt': return { ...NO_EFFECT, atBatCounts: false, sacBunts: 1 };
    case 'double-play': return { ...NO_EFFECT, atBatCounts: true, gidp: 1 };
    case 'groundout':
    case 'flyout':
    case 'lineout':
    case 'popout':
    case 'fielders-choice':
    case 'reached-on-error':
    case 'triple-play':
      return { ...NO_EFFECT, atBatCounts: true };
  }
};

const sameDivision = (a: TeamId, b: TeamId, ctx: AggregatorContext): boolean => {
  const ta = ctx.teamsById.get(a);
  const tb = ctx.teamsById.get(b);
  return !!ta && !!tb && ta.division === tb.division;
};

// Apply one finished game's events into the aggregates. Mutates `agg`.
export const aggregateGame = (
  game: FinishedGame,
  agg: SeasonAggregates,
  ctx: AggregatorContext,
): void => {
  const { events, input } = game;
  let inning = 1;
  let half: 'top' | 'bottom' = 'top';
  let outs = 0;
  const bases = { first: false as boolean, second: false as boolean, third: false as boolean };
  let scoreHome = 0;
  let scoreAway = 0;

  let homePitcherId = input.home.startingPitcherId;
  let awayPitcherId = input.away.startingPitcherId;
  let currentBatterId: PlayerId | null = null;

  // Track who appeared in this game for G++.
  const battersSeen = new Set<PlayerId>();
  const pitchersSeen = new Set<PlayerId>();

  // Per-AB scratch state for WPA.
  let abStartState: WPState | null = null;
  let abPitcherId: PlayerId | null = null;
  let abRunsScored = 0; // runs that crossed during this AB

  const captureStateForWP = (): WPState => ({
    inning,
    half,
    outs: Math.min(2, outs),
    scoreHome,
    scoreAway,
    bases: { first: bases.first, second: bases.second, third: bases.third },
  });

  for (const ev of events) {
    switch (ev.kind) {
      case 'gameStart':
        break;
      case 'pitch': {
        const battingTeam = half === 'top' ? input.away.teamId : input.home.teamId;
        const fieldingPitcher = half === 'top' ? homePitcherId : awayPitcherId;
        currentBatterId = ev.batterId;
        battersSeen.add(currentBatterId);
        pitchersSeen.add(fieldingPitcher);
        // Lazily ensure rows exist so first-pitch state is consistent.
        getOrCreateBatting(agg, currentBatterId, battingTeam);
        getOrCreatePitching(
          agg,
          fieldingPitcher,
          half === 'top' ? input.home.teamId : input.away.teamId,
        );
        if (abStartState === null) {
          abStartState = captureStateForWP();
          abPitcherId = fieldingPitcher;
          abRunsScored = 0;
        }
        break;
      }
      case 'baserunner': {
        // Vacate `from`, occupy `to` (unless out or scoring).
        if (ev.from === 1) bases.first = false;
        else if (ev.from === 2) bases.second = false;
        else if (ev.from === 3) bases.third = false;
        if (!ev.out) {
          if (ev.to === 1) bases.first = true;
          else if (ev.to === 2) bases.second = true;
          else if (ev.to === 3) bases.third = true;
          else if (ev.to === 0) {
            abRunsScored += 1;
            // Score column update — runs go to whichever side is batting.
            if (half === 'top') scoreAway += 1;
            else scoreHome += 1;
            // Credit the runner with R++.
            const battingTeam = half === 'top' ? input.away.teamId : input.home.teamId;
            const runnerLine = getOrCreateBatting(agg, ev.runnerId, battingTeam);
            runnerLine.R += 1;
          }
        }
        break;
      }
      case 'contact':
        break;
      case 'sub': {
        // Pitching change. The fielding side's pitcher swaps.
        if (half === 'top') homePitcherId = ev.inPlayerId;
        else awayPitcherId = ev.inPlayerId;
        const fieldingTeam = half === 'top' ? input.home.teamId : input.away.teamId;
        pitchersSeen.add(ev.inPlayerId);
        getOrCreatePitching(agg, ev.inPlayerId, fieldingTeam);
        break;
      }
      case 'atBatEnd': {
        if (!currentBatterId) break;
        const battingTeam = half === 'top' ? input.away.teamId : input.home.teamId;
        const fieldingTeam = half === 'top' ? input.home.teamId : input.away.teamId;
        const fieldingPitcher = abPitcherId ?? (half === 'top' ? homePitcherId : awayPitcherId);

        const eff = effectsFor(ev.outcome);
        const bLine = getOrCreateBatting(agg, currentBatterId, battingTeam);
        bLine.PA += 1;
        if (eff.atBatCounts) bLine.AB += 1;
        bLine.H += eff.hits;
        bLine.doubles += eff.doubles;
        bLine.triples += eff.triples;
        bLine.HR += eff.homeRuns;
        bLine.BB += eff.walks;
        bLine.HBP += eff.hbp;
        bLine.SO += eff.strikeouts;
        bLine.SF += eff.sacFlies;
        bLine.SH += eff.sacBunts;
        bLine.GIDP += eff.gidp;
        bLine.RBI += ev.rbis;

        const pLine = getOrCreatePitching(agg, fieldingPitcher, fieldingTeam);
        pLine.BF += 1;
        pLine.H += eff.hits;
        pLine.HR += eff.homeRuns;
        pLine.BB += eff.walks;
        pLine.HBP += eff.hbp;
        pLine.SO += eff.strikeouts;
        // ER currently == R since the sim doesn't model errors. Refine when
        // ROE / fielding errors enter the model.
        pLine.R += abRunsScored;
        pLine.ER += abRunsScored;
        pLine.IPouts += outsAddedFor(ev.outcome);

        // Update outs *after* logging — the next AB starts at this state.
        outs += outsAddedFor(ev.outcome);

        // WPA: WP after the play minus WP before, batter-team-relative.
        if (abStartState) {
          const stateAfter = captureStateForWP();
          const wpBefore = homeWinProb(abStartState);
          const wpAfter = homeWinProb(stateAfter);
          const battingTeamIsHome = half === 'bottom';
          const wpaForBattingTeam = battingTeamIsHome
            ? wpAfter - wpBefore
            : wpBefore - wpAfter;
          bLine.WPA += wpaForBattingTeam;
          // Pitcher's WPA mirrors — positive means the pitcher's TEAM gained WP.
          pLine.WPA -= wpaForBattingTeam;
        }
        abStartState = null;
        abPitcherId = null;
        abRunsScored = 0;
        currentBatterId = null;
        break;
      }
      case 'inningEnd': {
        bases.first = false;
        bases.second = false;
        bases.third = false;
        outs = 0;
        if (ev.halfInning === 'top') half = 'bottom';
        else { inning += 1; half = 'top'; }
        break;
      }
      case 'gameEnd': {
        const homeWon = ev.finalRuns.home > ev.finalRuns.away;
        const homeTeam = getOrCreateTeam(agg, input.home.teamId);
        const awayTeam = getOrCreateTeam(agg, input.away.teamId);
        if (homeWon) {
          homeTeam.W += 1;
          awayTeam.L += 1;
          homeTeam.homeW += 1;
          awayTeam.awayL += 1;
          homeTeam.resultsTimeline.push('W');
          awayTeam.resultsTimeline.push('L');
        } else {
          homeTeam.L += 1;
          awayTeam.W += 1;
          homeTeam.homeL += 1;
          awayTeam.awayW += 1;
          homeTeam.resultsTimeline.push('L');
          awayTeam.resultsTimeline.push('W');
        }
        homeTeam.RS += ev.finalRuns.home;
        homeTeam.RA += ev.finalRuns.away;
        awayTeam.RS += ev.finalRuns.away;
        awayTeam.RA += ev.finalRuns.home;
        if (sameDivision(input.home.teamId, input.away.teamId, ctx)) {
          if (homeWon) {
            homeTeam.divW += 1;
            awayTeam.divL += 1;
          } else {
            homeTeam.divL += 1;
            awayTeam.divW += 1;
          }
        }
        // Increment G for everyone who appeared.
        for (const id of battersSeen) {
          const line = agg.batting.get(id);
          if (line) line.G += 1;
        }
        for (const id of pitchersSeen) {
          const line = agg.pitching.get(id);
          if (line) line.G += 1;
        }
        // GS for the two starting pitchers.
        const homeStarter = agg.pitching.get(input.home.startingPitcherId);
        const awayStarter = agg.pitching.get(input.away.startingPitcherId);
        if (homeStarter) homeStarter.GS += 1;
        if (awayStarter) awayStarter.GS += 1;
        break;
      }
    }
  }
};

export const buildSeasonAggregates = (
  games: readonly FinishedGame[],
  teams: readonly Team[],
  seasonYear = 1,
): SeasonAggregates => {
  const ctx: AggregatorContext = {
    teamsById: new Map(teams.map((t) => [t.id, t])),
  };
  const agg: SeasonAggregates = { ...emptySeasonAggregates(seasonYear) };
  // Pre-create rows for every team so the standings table covers everyone
  // even in single-game test fixtures.
  for (const t of teams) getOrCreateTeam(agg, t.id);
  for (const game of games) {
    aggregateGame(game, agg, ctx);
    (agg as { gamesProcessed: number }).gamesProcessed += 1;
  }
  return agg;
};
