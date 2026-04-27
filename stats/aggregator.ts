import type { AtBatOutcome, GameInput, SimEvent } from '../sim/types.js';
import type { GameId, PlayerId, Player, Team, TeamId } from '../world/types.js';
import {
  emptyBattingLine,
  emptyBvpLine,
  emptyPitchingLine,
  emptySeasonAggregates,
  emptyTeamLine,
  type BattingGameLogEntry,
  type BattingLine,
  type BattingSplitKey,
  type BvpLine,
  type GameWPTimeline,
  type HitLocation,
  type PitchingGameLogEntry,
  type PitchingLine,
  type PitchingSplitKey,
  type SeasonAggregates,
  type TeamLine,
} from './types.js';
import { homeWinProb, type WPState } from './wp.js';

// Phase 5.5 part 2 aggregator. Walks one finished game's SimEvent log once
// and folds every batter PA, pitcher PA, runner movement, hit ball, split,
// game-log entry, and WP sample into the season aggregates.
//
// Ground rules:
// - Pure: reads only (events, GameInput, world). Mutates only the supplied
//   `agg`. Web-Worker safe.
// - Splits are plate-appearance-level; the aggregator captures the split
//   keys from the *state at AB start* (vs L/R, home/away, RISP, late&close).
// - Incremental == full rebuild: calling aggregateGame N times in a loop
//   produces the same numbers as buildSeasonAggregates([g1..gN]). Tested.

export interface FinishedGame {
  readonly events: readonly SimEvent[];
  readonly input: GameInput;
  /** Calendar day this game was played, used by gameLog and byMonth splits. */
  readonly day: number;
}

export interface AggregatorContext {
  readonly teamsById: ReadonlyMap<TeamId, Team>;
  readonly playerIndex: ReadonlyMap<PlayerId, Player>;
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

const getOrCreateBvpLine = (
  agg: SeasonAggregates,
  batterId: PlayerId,
  pitcherId: PlayerId,
): BvpLine => {
  let inner = agg.bvpMatchups.get(batterId);
  if (!inner) {
    inner = new Map();
    agg.bvpMatchups.set(batterId, inner);
  }
  let line = inner.get(pitcherId);
  if (!line) {
    line = emptyBvpLine(batterId, pitcherId);
    inner.set(pitcherId, line);
  }
  return line;
};

// Split rows live nested inside the parent line. Same shape, sans nested
// splits/hitChart/gameLog (those are top-level only).
const getOrCreateBattingSplit = (
  parent: BattingLine,
  key: BattingSplitKey,
): BattingLine => {
  let split = parent.splits[key];
  if (!split) {
    split = emptyBattingLine(parent.playerId, parent.teamId);
    parent.splits[key] = split;
  }
  return split;
};

const getOrCreatePitchingSplit = (
  parent: PitchingLine,
  key: PitchingSplitKey,
): PitchingLine => {
  let split = parent.splits[key];
  if (!split) {
    split = emptyPitchingLine(parent.playerId, parent.teamId);
    parent.splits[key] = split;
  }
  return split;
};

const getOrCreateMonthSplit = (parent: BattingLine, monthKey: string): BattingLine => {
  let m = parent.byMonth[monthKey];
  if (!m) {
    m = emptyBattingLine(parent.playerId, parent.teamId);
    parent.byMonth[monthKey] = m;
  }
  return m;
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
  readonly hits: number;
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

// 162-game season fits ~21 hours; 6 days = 1 month here.
const monthKeyFor = (day: number): string => `M${Math.ceil(day / 6)}`;

// Apply per-AB counters into a target line. Used both for the top-line and
// each active split, so PA/AB/H bookkeeping stays consistent.
const foldAtBat = (line: BattingLine, eff: OutcomeEffects, rbis: number, runs: number): void => {
  line.PA += 1;
  if (eff.atBatCounts) line.AB += 1;
  line.H += eff.hits;
  line.doubles += eff.doubles;
  line.triples += eff.triples;
  line.HR += eff.homeRuns;
  line.BB += eff.walks;
  line.HBP += eff.hbp;
  line.SO += eff.strikeouts;
  line.SF += eff.sacFlies;
  line.SH += eff.sacBunts;
  line.GIDP += eff.gidp;
  line.RBI += rbis;
  line.R += runs;
};

const foldPitcherAtBat = (
  line: PitchingLine,
  eff: OutcomeEffects,
  outcome: AtBatOutcome,
  runsAllowed: number,
): void => {
  line.BF += 1;
  line.H += eff.hits;
  line.HR += eff.homeRuns;
  line.BB += eff.walks;
  line.HBP += eff.hbp;
  line.SO += eff.strikeouts;
  line.R += runsAllowed;
  line.ER += runsAllowed;
  line.IPouts += outsAddedFor(outcome);
};

// Apply one finished game's events into the aggregates. Mutates `agg`.
export const aggregateGame = (
  game: FinishedGame,
  agg: SeasonAggregates,
  ctx: AggregatorContext,
): void => {
  const { events, input, day } = game;
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
  // Per-game scratch entries — folded into season game logs at gameEnd.
  const battingGameRows = new Map<PlayerId, BattingGameLogEntry>();
  const pitchingGameRows = new Map<PlayerId, PitchingGameLogEntry>();

  // Per-AB scratch state.
  let abStartState: WPState | null = null;
  let abPitcherId: PlayerId | null = null;
  let abRunsScored = 0;
  let abRunnerIds: PlayerId[] = []; // runners credited with R during this AB
  let abContact: { ballPath: { landingX: number; landingY: number; exitVeloMph: number; launchAngleDeg: number } } | null = null;
  // The last pitch's zone in the current AB. Used at atBatEnd to credit
  // the batter's zone-PA cell for xBA-by-zone aggregates.
  let abLastZone: number | null = null;

  // WP timeline: append a sample on every state-mutating event.
  const wpTimeline: GameWPTimeline = {
    gameId: input.gameId,
    homeTeamId: input.home.teamId,
    awayTeamId: input.away.teamId,
    samples: [],
  };

  let evIdx = -1;
  const captureStateForWP = (): WPState => ({
    inning,
    half,
    outs: Math.min(2, outs),
    scoreHome,
    scoreAway,
    bases: { first: bases.first, second: bases.second, third: bases.third },
  });

  const ensureBattingRow = (id: PlayerId, team: TeamId, oppTeam: TeamId, home: boolean) => {
    let row = battingGameRows.get(id);
    if (!row) {
      row = {
        gameId: input.gameId, day, opponentTeamId: oppTeam, home,
        PA: 0, AB: 0, H: 0, doubles: 0, triples: 0, HR: 0,
        RBI: 0, BB: 0, SO: 0, R: 0, WPA: 0,
      };
      battingGameRows.set(id, row);
    }
    void team;
    return row;
  };

  const ensurePitchingRow = (id: PlayerId, team: TeamId, oppTeam: TeamId, home: boolean) => {
    let row = pitchingGameRows.get(id);
    if (!row) {
      row = {
        gameId: input.gameId, day, opponentTeamId: oppTeam, home,
        IPouts: 0, BF: 0, H: 0, R: 0, ER: 0, BB: 0, SO: 0, HR: 0,
        WPA: 0, decision: 'ND',
      };
      pitchingGameRows.set(id, row);
    }
    void team;
    return row;
  };

  // Determine which split keys apply at AB start.
  const battingSplitKeys = (
    batter: Player,
    pitcher: Player,
    battingTeamIsHome: boolean,
  ): BattingSplitKey[] => {
    const keys: BattingSplitKey[] = [];
    keys.push(pitcher.throws === 'L' ? 'vsLHP' : 'vsRHP');
    keys.push(battingTeamIsHome ? 'home' : 'away');
    if (bases.second || bases.third) keys.push('RISP');
    if ((bases.second || bases.third) && outs === 2) keys.push('risp2Out');
    // Late-and-close: 7th+ inning, batting team within 2 runs (or tying run on/at-bat).
    const battingScore = battingTeamIsHome ? scoreHome : scoreAway;
    const fieldingScore = battingTeamIsHome ? scoreAway : scoreHome;
    if (inning >= 7 && Math.abs(battingScore - fieldingScore) <= 2) {
      keys.push('lateAndClose');
    }
    return keys;
  };

  const pitchingSplitKeys = (
    batter: Player,
    pitchingTeamIsHome: boolean,
  ): PitchingSplitKey[] => {
    const keys: PitchingSplitKey[] = [];
    keys.push(batter.bats === 'L' ? 'vsLHB' : 'vsRHB');
    keys.push(pitchingTeamIsHome ? 'home' : 'away');
    const pitchingScore = pitchingTeamIsHome ? scoreHome : scoreAway;
    const battingScore = pitchingTeamIsHome ? scoreAway : scoreHome;
    if (inning >= 7 && Math.abs(pitchingScore - battingScore) <= 2) {
      keys.push('lateAndClose');
    }
    return keys;
  };

  for (const ev of events) {
    evIdx += 1;
    switch (ev.kind) {
      case 'gameStart': {
        // Seed the WP timeline.
        wpTimeline.samples.push({
          eventIdx: evIdx,
          wpHome: homeWinProb(captureStateForWP()),
          inning,
          half,
          delta: 0,
        });
        break;
      }
      case 'pitch': {
        const battingTeam = half === 'top' ? input.away.teamId : input.home.teamId;
        const fieldingPitcher = half === 'top' ? homePitcherId : awayPitcherId;
        const fieldingTeam = half === 'top' ? input.home.teamId : input.away.teamId;
        currentBatterId = ev.batterId;
        battersSeen.add(currentBatterId);
        pitchersSeen.add(fieldingPitcher);
        const bLineNow = getOrCreateBatting(agg, currentBatterId, battingTeam);
        const pLineNow = getOrCreatePitching(agg, fieldingPitcher, fieldingTeam);
        ensureBattingRow(
          currentBatterId,
          battingTeam,
          fieldingTeam,
          half === 'bottom', // batting team is home in bottom of inning
        );
        ensurePitchingRow(
          fieldingPitcher,
          fieldingTeam,
          battingTeam,
          half === 'top', // pitching team is home in top of inning
        );
        // Per-zone counters: pitcher's heat map cell + batter's zone PA cell.
        // We attribute batter PA to the LAST pitch of the AB (decided at
        // atBatEnd via abLastZone) — but the pitch-level "pitches seen"
        // counter on the batter side captures every pitch, useful for
        // the menu when callers want raw exposure.
        const zone = ev.pitch.locationZone;
        if (zone >= 0 && zone <= 9) {
          pLineNow.pitchesByZone[zone] = (pLineNow.pitchesByZone[zone] ?? 0) + 1;
          const cell = bLineNow.zone[zone];
          if (cell) cell.pitches += 1;
        }
        abLastZone = zone;
        if (abStartState === null) {
          abStartState = captureStateForWP();
          abPitcherId = fieldingPitcher;
          abRunsScored = 0;
          abRunnerIds = [];
          abContact = null;
        }
        break;
      }
      case 'baserunner': {
        if (ev.from === 1) bases.first = false;
        else if (ev.from === 2) bases.second = false;
        else if (ev.from === 3) bases.third = false;
        if (!ev.out) {
          if (ev.to === 1) bases.first = true;
          else if (ev.to === 2) bases.second = true;
          else if (ev.to === 3) bases.third = true;
          else if (ev.to === 0) {
            abRunsScored += 1;
            abRunnerIds.push(ev.runnerId);
            if (half === 'top') scoreAway += 1;
            else scoreHome += 1;
            const battingTeam = half === 'top' ? input.away.teamId : input.home.teamId;
            const fieldingTeam = half === 'top' ? input.home.teamId : input.away.teamId;
            const runnerLine = getOrCreateBatting(agg, ev.runnerId, battingTeam);
            // The R++ happens at atBatEnd based on abRunnerIds, so don't
            // double-credit here. Just ensure the per-game row exists.
            void runnerLine;
            ensureBattingRow(
              ev.runnerId,
              battingTeam,
              fieldingTeam,
              half === 'bottom',
            );
          }
        }
        break;
      }
      case 'contact': {
        abContact = { ballPath: ev.ballPath };
        break;
      }
      case 'sub': {
        if (half === 'top') homePitcherId = ev.inPlayerId;
        else awayPitcherId = ev.inPlayerId;
        const fieldingTeam = half === 'top' ? input.home.teamId : input.away.teamId;
        const battingTeam = half === 'top' ? input.away.teamId : input.home.teamId;
        pitchersSeen.add(ev.inPlayerId);
        getOrCreatePitching(agg, ev.inPlayerId, fieldingTeam);
        ensurePitchingRow(ev.inPlayerId, fieldingTeam, battingTeam, half === 'top');
        break;
      }
      case 'atBatEnd': {
        if (!currentBatterId) break;
        const battingTeam = half === 'top' ? input.away.teamId : input.home.teamId;
        const fieldingTeam = half === 'top' ? input.home.teamId : input.away.teamId;
        const fieldingPitcher = abPitcherId ?? (half === 'top' ? homePitcherId : awayPitcherId);
        const battingTeamIsHome = half === 'bottom';

        const eff = effectsFor(ev.outcome);
        const bLine = getOrCreateBatting(agg, currentBatterId, battingTeam);
        const pLine = getOrCreatePitching(agg, fieldingPitcher, fieldingTeam);

        // Top-line + per-game.
        foldAtBat(bLine, eff, ev.rbis, 0);
        foldPitcherAtBat(pLine, eff, ev.outcome, abRunsScored);

        // Batter-vs-pitcher matchup row. Folds the same per-AB effects
        // into a slim counter line keyed by (batterId, pitcherId). The
        // live HUD reads this to show a "vs this pitcher" stat strip
        // whenever the sample size is meaningful.
        const bvp = getOrCreateBvpLine(agg, currentBatterId, fieldingPitcher);
        bvp.PA += 1;
        if (eff.atBatCounts) bvp.AB += 1;
        bvp.H += eff.hits;
        bvp.doubles += eff.doubles;
        bvp.triples += eff.triples;
        bvp.HR += eff.homeRuns;
        bvp.RBI += ev.rbis;
        bvp.BB += eff.walks;
        bvp.HBP += eff.hbp;
        bvp.SO += eff.strikeouts;
        bvp.SF += eff.sacFlies;
        bvp.SH += eff.sacBunts;

        // Per-game row.
        const bRow = ensureBattingRow(
          currentBatterId,
          battingTeam,
          fieldingTeam,
          battingTeamIsHome,
        );
        bRow.PA += 1;
        if (eff.atBatCounts) bRow.AB += 1;
        bRow.H += eff.hits;
        bRow.doubles += eff.doubles;
        bRow.triples += eff.triples;
        bRow.HR += eff.homeRuns;
        bRow.BB += eff.walks;
        bRow.SO += eff.strikeouts;
        bRow.RBI += ev.rbis;

        const pRow = ensurePitchingRow(
          fieldingPitcher,
          fieldingTeam,
          battingTeam,
          !battingTeamIsHome,
        );
        pRow.BF += 1;
        pRow.IPouts += outsAddedFor(ev.outcome);
        pRow.H += eff.hits;
        pRow.HR += eff.homeRuns;
        pRow.BB += eff.walks;
        pRow.SO += eff.strikeouts;
        pRow.R += abRunsScored;
        pRow.ER += abRunsScored;

        // Credit each run-scoring runner with R++ on top-line + per-game row.
        for (const runnerId of abRunnerIds) {
          const runnerLine = getOrCreateBatting(agg, runnerId, battingTeam);
          runnerLine.R += 1;
          const runnerRow = ensureBattingRow(
            runnerId,
            battingTeam,
            fieldingTeam,
            battingTeamIsHome,
          );
          runnerRow.R += 1;
        }

        // Splits.
        const batter = ctx.playerIndex.get(currentBatterId);
        const pitcher = ctx.playerIndex.get(fieldingPitcher);
        if (batter && pitcher) {
          for (const k of battingSplitKeys(batter, pitcher, battingTeamIsHome)) {
            const split = getOrCreateBattingSplit(bLine, k);
            foldAtBat(split, eff, ev.rbis, 0);
          }
          for (const k of pitchingSplitKeys(batter, !battingTeamIsHome)) {
            const split = getOrCreatePitchingSplit(pLine, k);
            foldPitcherAtBat(split, eff, ev.outcome, abRunsScored);
          }
        }

        // By-month split for batter.
        const monthLine = getOrCreateMonthSplit(bLine, monthKeyFor(day));
        foldAtBat(monthLine, eff, ev.rbis, 0);

        // Per-zone batting line — attribute the AB to the location of the
        // last pitch of the at-bat (the one that produced the outcome).
        // Walks/HBP have no zone-AB credit but still count toward PA in the
        // cell so menus can show "frequency this batter saw pitches here".
        if (abLastZone !== null) {
          const zoneCell = bLine.zone[abLastZone];
          if (zoneCell) {
            zoneCell.PA += 1;
            if (eff.atBatCounts) zoneCell.AB += 1;
            zoneCell.H += eff.hits;
            zoneCell.HR += eff.homeRuns;
          }
        }

        // Spray chart — only contact outcomes have a ballPath.
        if (abContact) {
          const isHit =
            ev.outcome === 'single' ||
            ev.outcome === 'double' ||
            ev.outcome === 'triple' ||
            ev.outcome === 'home-run';
          const sprayOutcome: HitLocation['outcome'] =
            ev.outcome === 'single' ? 'single' :
            ev.outcome === 'double' ? 'double' :
            ev.outcome === 'triple' ? 'triple' :
            ev.outcome === 'home-run' ? 'home-run' : 'out';
          bLine.hitChart.push({
            x: abContact.ballPath.landingX,
            y: abContact.ballPath.landingY,
            outcome: sprayOutcome,
            exitVeloMph: abContact.ballPath.exitVeloMph,
            launchAngleDeg: abContact.ballPath.launchAngleDeg,
          });
          void isHit;
        }

        // Update outs *after* logging.
        outs += outsAddedFor(ev.outcome);

        // WPA + WP timeline sample.
        if (abStartState) {
          const stateAfter = captureStateForWP();
          const wpBefore = homeWinProb(abStartState);
          const wpAfter = homeWinProb(stateAfter);
          const battingTeamIsHomeNow = battingTeamIsHome;
          const wpaForBattingTeam = battingTeamIsHomeNow
            ? wpAfter - wpBefore
            : wpBefore - wpAfter;
          bLine.WPA += wpaForBattingTeam;
          bRow.WPA += wpaForBattingTeam;
          pLine.WPA -= wpaForBattingTeam;
          pRow.WPA -= wpaForBattingTeam;

          // Splits also accumulate WPA.
          if (batter && pitcher) {
            for (const k of battingSplitKeys(batter, pitcher, battingTeamIsHome)) {
              const split = getOrCreateBattingSplit(bLine, k);
              split.WPA += wpaForBattingTeam;
            }
            for (const k of pitchingSplitKeys(batter, !battingTeamIsHome)) {
              const split = getOrCreatePitchingSplit(pLine, k);
              split.WPA -= wpaForBattingTeam;
            }
          }
          monthLine.WPA += wpaForBattingTeam;

          // Timeline sample with annotation for big swings.
          const note =
            Math.abs(wpAfter - wpBefore) > 0.10
              ? annotationFor(ev.outcome, ev.rbis, currentBatterId, ctx)
              : undefined;
          wpTimeline.samples.push({
            eventIdx: evIdx,
            wpHome: wpAfter,
            inning,
            half,
            delta: wpaForBattingTeam,
            ...(note ? { note } : {}),
          });
        }
        abStartState = null;
        abPitcherId = null;
        abRunsScored = 0;
        abRunnerIds = [];
        abContact = null;
        abLastZone = null;
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
        // Sample WP at half-inning boundaries too so the curve has texture.
        wpTimeline.samples.push({
          eventIdx: evIdx,
          wpHome: homeWinProb(captureStateForWP()),
          inning,
          half,
          delta: 0,
        });
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
          if (homeWon) { homeTeam.divW += 1; awayTeam.divL += 1; }
          else { homeTeam.divL += 1; awayTeam.divW += 1; }
        }

        // G for everyone who appeared.
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

        // Pitcher decisions: starter of the winning side gets W, losing
        // starter gets L. Bullpen decisions are deferred — accurate save /
        // hold / blown-save logic lands with the manager-knobs phase.
        const winningStarter = homeWon
          ? agg.pitching.get(input.home.startingPitcherId)
          : agg.pitching.get(input.away.startingPitcherId);
        const losingStarter = homeWon
          ? agg.pitching.get(input.away.startingPitcherId)
          : agg.pitching.get(input.home.startingPitcherId);
        if (winningStarter) winningStarter.W += 1;
        if (losingStarter) losingStarter.L += 1;
        const winningStarterRow = pitchingGameRows.get(
          homeWon ? input.home.startingPitcherId : input.away.startingPitcherId,
        );
        const losingStarterRow = pitchingGameRows.get(
          homeWon ? input.away.startingPitcherId : input.home.startingPitcherId,
        );
        if (winningStarterRow) winningStarterRow.decision = 'W';
        if (losingStarterRow) losingStarterRow.decision = 'L';

        // Append per-game rows to season game logs.
        for (const [id, row] of battingGameRows) {
          const line = agg.batting.get(id);
          if (line) line.gameLog.push(row);
        }
        for (const [id, row] of pitchingGameRows) {
          const line = agg.pitching.get(id);
          if (line) line.gameLog.push(row);
        }

        // Stash the WP timeline.
        agg.wpTimelines.set(input.gameId, wpTimeline);
        break;
      }
    }
  }
};

const annotationFor = (
  outcome: AtBatOutcome,
  rbis: number,
  batterId: PlayerId,
  ctx: AggregatorContext,
): string => {
  const player = ctx.playerIndex.get(batterId);
  const name = player ? player.lastName : batterId;
  switch (outcome) {
    case 'home-run':
      return rbis > 1 ? `${rbis}-run HR by ${name}` : `HR by ${name}`;
    case 'triple':
      return `Triple by ${name}`;
    case 'double':
      return rbis > 0 ? `RBI 2B by ${name}` : `Double by ${name}`;
    case 'single':
      return rbis > 0 ? `RBI single by ${name}` : `Single by ${name}`;
    case 'walk':
      return `BB to ${name}`;
    case 'strikeout-looking':
    case 'strikeout-swinging':
      return `K of ${name}`;
    case 'double-play':
      return `Double play`;
    default:
      return `${outcome} (${name})`;
  }
};

export const buildSeasonAggregates = (
  games: readonly FinishedGame[],
  teams: readonly Team[],
  players: readonly Player[],
  seasonYear = 1,
): SeasonAggregates => {
  const ctx: AggregatorContext = {
    teamsById: new Map(teams.map((t) => [t.id, t])),
    playerIndex: new Map(players.map((p) => [p.id, p])),
  };
  const agg: SeasonAggregates = { ...emptySeasonAggregates(seasonYear) };
  for (const t of teams) getOrCreateTeam(agg, t.id);
  for (const game of games) {
    aggregateGame(game, agg, ctx);
    (agg as { gamesProcessed: number }).gamesProcessed += 1;
  }
  return agg;
};
