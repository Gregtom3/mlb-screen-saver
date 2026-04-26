import type { GameId, PlayerId, TeamId } from '../world/types.js';
import type { SimEvent, AtBatOutcome, GameInput } from './types.js';

// View-friendly box score derived from the canonical SimEvent stream.
// Phase 1 keeps it terminal-printable. The formal BoxScore type with full
// AtBat[] per inning is reconstructable from the same log when a renderer
// or persistence layer needs it later.

export interface LineScore {
  readonly innings: readonly { top: number; bottom: number | null }[];
  readonly home: { runs: number; hits: number; errors: number };
  readonly away: { runs: number; hits: number; errors: number };
}

export interface BatterLine {
  readonly playerId: PlayerId;
  readonly atBats: number;
  readonly hits: number;
  readonly runs: number;
  readonly rbis: number;
  readonly walks: number;
  readonly strikeouts: number;
  readonly homeRuns: number;
}

export interface PitcherLine {
  readonly playerId: PlayerId;
  readonly outs: number; // record outs; print as IP = outs/3
  readonly hits: number;
  readonly runs: number;
  readonly walks: number;
  readonly strikeouts: number;
  readonly pitches: number;
  readonly homeRunsAllowed: number;
}

export interface BoxScoreView {
  readonly gameId: GameId;
  readonly homeTeamId: TeamId;
  readonly awayTeamId: TeamId;
  readonly lineScore: LineScore;
  readonly homeBatters: readonly BatterLine[];
  readonly awayBatters: readonly BatterLine[];
  readonly homePitchers: readonly PitcherLine[];
  readonly awayPitchers: readonly PitcherLine[];
  readonly winner: 'home' | 'away' | 'tie';
}

const isHit = (o: AtBatOutcome): boolean =>
  o === 'single' || o === 'double' || o === 'triple' || o === 'home-run';

const isStrikeout = (o: AtBatOutcome): boolean =>
  o === 'strikeout-looking' || o === 'strikeout-swinging';

const isWalk = (o: AtBatOutcome): boolean => o === 'walk' || o === 'hit-by-pitch';

// At-bats don't count walks, HBP, sac flies, sac bunts.
const countsAsAtBat = (o: AtBatOutcome): boolean =>
  o !== 'walk' && o !== 'hit-by-pitch' && o !== 'sac-fly' && o !== 'sac-bunt';

const ensureBatter = (m: Map<PlayerId, BatterLine>, id: PlayerId): BatterLine => {
  let row = m.get(id);
  if (!row) {
    row = { playerId: id, atBats: 0, hits: 0, runs: 0, rbis: 0, walks: 0, strikeouts: 0, homeRuns: 0 };
    m.set(id, row);
  }
  return row;
};

const ensurePitcher = (m: Map<PlayerId, PitcherLine>, id: PlayerId): PitcherLine => {
  let row = m.get(id);
  if (!row) {
    row = { playerId: id, outs: 0, hits: 0, runs: 0, walks: 0, strikeouts: 0, pitches: 0, homeRunsAllowed: 0 };
    m.set(id, row);
  }
  return row;
};

const updateBatter = (
  m: Map<PlayerId, BatterLine>,
  id: PlayerId,
  patch: Partial<BatterLine>,
): void => {
  const cur = ensureBatter(m, id);
  m.set(id, { ...cur, ...patch });
};

const updatePitcher = (
  m: Map<PlayerId, PitcherLine>,
  id: PlayerId,
  patch: Partial<PitcherLine>,
): void => {
  const cur = ensurePitcher(m, id);
  m.set(id, { ...cur, ...patch });
};

export const buildBoxScore = (events: readonly SimEvent[], input: GameInput): BoxScoreView => {
  const innings: { top: number; bottom: number | null }[] = [];
  let runsHome = 0;
  let runsAway = 0;
  let hitsHome = 0;
  let hitsAway = 0;
  const errorsHome = 0;
  const errorsAway = 0;

  const homeBatters = new Map<PlayerId, BatterLine>();
  const awayBatters = new Map<PlayerId, BatterLine>();
  const homePitchers = new Map<PlayerId, PitcherLine>();
  const awayPitchers = new Map<PlayerId, PitcherLine>();

  // Track current state while replaying the log.
  let currentBatterId: PlayerId | null = null;
  let currentPitcherId: PlayerId | null = null;
  let currentInning = 1;
  let currentHalf: 'top' | 'bottom' = 'top';
  let inningTopRuns = 0;
  let inningBottomRuns = 0;

  // Track active pitcher per side.
  let homePitcherId: PlayerId = input.home.startingPitcherId;
  let awayPitcherId: PlayerId = input.away.startingPitcherId;

  for (const ev of events) {
    switch (ev.kind) {
      case 'gameStart':
        break;

      case 'pitch': {
        const battingHome = currentHalf === 'bottom';
        currentBatterId = ev.batterId;
        currentPitcherId = ev.pitcherId;
        const pitcherMap = battingHome ? awayPitchers : homePitchers;
        const cur = ensurePitcher(pitcherMap, ev.pitcherId);
        pitcherMap.set(ev.pitcherId, { ...cur, pitches: cur.pitches + 1 });
        break;
      }

      case 'sub': {
        // Pitching change. We don't get an explicit side, so use the current half:
        // the fielding side is the opposite of the batting side.
        const fieldingHome = currentHalf === 'top';
        if (fieldingHome) homePitcherId = ev.inPlayerId;
        else awayPitcherId = ev.inPlayerId;
        break;
      }

      case 'baserunner': {
        // Runs scored show up here when out=false and to=0 (home plate).
        if (!ev.out && ev.to === 0) {
          if (currentHalf === 'top') {
            runsAway += 1;
            inningTopRuns += 1;
          } else {
            runsHome += 1;
            inningBottomRuns += 1;
          }
          // RBIs and credit are stamped at atBatEnd, but we credit a run to whoever scored.
          const battingMap = currentHalf === 'top' ? awayBatters : homeBatters;
          const cur = ensureBatter(battingMap, ev.runnerId);
          battingMap.set(ev.runnerId, { ...cur, runs: cur.runs + 1 });
        }
        break;
      }

      case 'contact':
        // No box score effect — outcome decides on atBatEnd.
        break;

      case 'atBatEnd': {
        if (!currentBatterId) throw new Error('atBatEnd without a current batter');
        const battingMap = currentHalf === 'top' ? awayBatters : homeBatters;
        const cur = ensureBatter(battingMap, currentBatterId);
        const isHr = ev.outcome === 'home-run';
        const isWalkLike = isWalk(ev.outcome);
        const isHitLike = isHit(ev.outcome);
        const isK = isStrikeout(ev.outcome);
        const ab = countsAsAtBat(ev.outcome) ? 1 : 0;

        battingMap.set(currentBatterId, {
          ...cur,
          atBats: cur.atBats + ab,
          hits: cur.hits + (isHitLike ? 1 : 0),
          rbis: cur.rbis + ev.rbis,
          walks: cur.walks + (isWalkLike ? 1 : 0),
          strikeouts: cur.strikeouts + (isK ? 1 : 0),
          homeRuns: cur.homeRuns + (isHr ? 1 : 0),
        });

        if (isHitLike) {
          if (currentHalf === 'top') hitsAway += 1;
          else hitsHome += 1;
        }

        // Pitcher stats: credit the pitcher who finished this PA.
        const pitcherSide = currentHalf === 'top' ? 'home' : 'away';
        const pitcherMap = pitcherSide === 'home' ? homePitchers : awayPitchers;
        const finishingPitcherId = pitcherSide === 'home' ? homePitcherId : awayPitcherId;
        const pcur = ensurePitcher(pitcherMap, finishingPitcherId);
        const isOutPa =
          ev.outcome === 'strikeout-looking' ||
          ev.outcome === 'strikeout-swinging' ||
          ev.outcome === 'groundout' ||
          ev.outcome === 'flyout' ||
          ev.outcome === 'lineout' ||
          ev.outcome === 'popout' ||
          ev.outcome === 'sac-fly' ||
          ev.outcome === 'sac-bunt';
        const outsThisPa = isOutPa ? 1 : ev.outcome === 'double-play' ? 2 : ev.outcome === 'triple-play' ? 3 : 0;
        pitcherMap.set(finishingPitcherId, {
          ...pcur,
          outs: pcur.outs + outsThisPa,
          hits: pcur.hits + (isHitLike ? 1 : 0),
          runs: pcur.runs + ev.rbis,
          walks: pcur.walks + (isWalkLike ? 1 : 0),
          strikeouts: pcur.strikeouts + (isK ? 1 : 0),
          homeRunsAllowed: pcur.homeRunsAllowed + (isHr ? 1 : 0),
        });

        currentBatterId = null;
        break;
      }

      case 'inningEnd': {
        if (currentHalf === 'top') {
          // Half-inning finished is the top — push a stub innings entry.
          if (innings.length < currentInning) innings.push({ top: inningTopRuns, bottom: null });
          else {
            const idx = currentInning - 1;
            const cur = innings[idx];
            if (cur) innings[idx] = { ...cur, top: inningTopRuns };
          }
          inningTopRuns = 0;
          currentHalf = 'bottom';
        } else {
          if (innings.length < currentInning) innings.push({ top: 0, bottom: inningBottomRuns });
          else {
            const idx = currentInning - 1;
            const cur = innings[idx];
            if (cur) innings[idx] = { ...cur, bottom: inningBottomRuns };
          }
          inningBottomRuns = 0;
          currentInning += 1;
          currentHalf = 'top';
        }
        break;
      }

      case 'gameEnd':
        break;
    }
  }

  // Trim trailing entries that didn't actually happen (shouldn't, but safe).
  // Determine winner.
  const winner: 'home' | 'away' | 'tie' =
    runsHome > runsAway ? 'home' : runsAway > runsHome ? 'away' : 'tie';

  // Order batter lines by lineup spot.
  const orderBatters = (m: Map<PlayerId, BatterLine>, order: readonly PlayerId[]): BatterLine[] => {
    const seen = new Set<PlayerId>();
    const out: BatterLine[] = [];
    for (const id of order) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(ensureBatter(m, id));
    }
    return out;
  };

  // Pitchers in order they appeared.
  const orderPitchers = (
    m: Map<PlayerId, PitcherLine>,
    starter: PlayerId,
    bullpen: readonly PlayerId[],
  ): PitcherLine[] => {
    const order = [starter, ...bullpen];
    const out: PitcherLine[] = [];
    for (const id of order) {
      const row = m.get(id);
      if (row) out.push(row);
    }
    return out;
  };

  return {
    gameId: input.gameId,
    homeTeamId: input.home.teamId,
    awayTeamId: input.away.teamId,
    lineScore: {
      innings,
      home: { runs: runsHome, hits: hitsHome, errors: errorsHome },
      away: { runs: runsAway, hits: hitsAway, errors: errorsAway },
    },
    homeBatters: orderBatters(homeBatters, input.home.battingOrder),
    awayBatters: orderBatters(awayBatters, input.away.battingOrder),
    homePitchers: orderPitchers(homePitchers, input.home.startingPitcherId, input.home.bullpen),
    awayPitchers: orderPitchers(awayPitchers, input.away.startingPitcherId, input.away.bullpen),
    winner,
  };
};
