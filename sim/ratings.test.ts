import { describe, expect, it } from 'vitest';
import { generateInitialLeague } from '../content/index.js';
import { buildSchedule, buildLineup } from '../season/index.js';
import { runGame } from './index.js';
import type { GameInput, SideInput, SimEvent } from './types.js';
import type { Player, PlayerId, PlayerRatings } from '../world/types.js';

// Tests for the four "easy tune" ratings that got bumped: speed,
// platoonBias, stamina, glove. Strategy: take the canonical first-day
// matchup, clone it with one team's ratings overridden to extreme values
// (99 vs 1), and verify direction-of-effect across many seeds. Asymmetric
// thresholds keep the assertions robust to small simulator drifts.

const FIRST_DAY_SEED = 0xba_5e_ba_11;

const withRatings = (p: Player, overrides: Partial<PlayerRatings>): Player => ({
  ...p,
  ratings: { ...p.ratings, ...overrides },
});

interface BuildOpts {
  // Override every player on the home team's roster.
  homeBatterOverrides?: Partial<PlayerRatings>;
  homePitcherOverrides?: Partial<PlayerRatings>;
  homeFielderOverrides?: Partial<PlayerRatings>;
  awayBatterOverrides?: Partial<PlayerRatings>;
  awayPitcherOverrides?: Partial<PlayerRatings>;
}

const buildInput = (gameSeed: number, opts: BuildOpts = {}): GameInput => {
  const league = generateInitialLeague(FIRST_DAY_SEED);
  const schedule = buildSchedule(league.teams, league.season.year);
  const entry = schedule.entries.find((e) => e.day === 1)!;
  const homeTeam = league.teams.find((t) => t.id === entry.homeTeamId)!;
  const awayTeam = league.teams.find((t) => t.id === entry.awayTeamId)!;
  const homeLineup = buildLineup(homeTeam, league.players, 1);
  const awayLineup = buildLineup(awayTeam, league.players, 1);

  const playerIndex = new Map<PlayerId, Player>(league.players.map((p) => [p.id, p]));
  const apply = (id: PlayerId, overrides: Partial<PlayerRatings>) => {
    const p = playerIndex.get(id);
    if (p) playerIndex.set(id, withRatings(p, overrides));
  };
  if (opts.homeBatterOverrides) {
    for (const id of homeLineup.battingOrder) apply(id, opts.homeBatterOverrides);
  }
  if (opts.homePitcherOverrides) apply(homeLineup.startingPitcher, opts.homePitcherOverrides);
  if (opts.homeFielderOverrides) {
    for (const id of Object.values(homeLineup.defenseByPosition)) {
      if (id) apply(id, opts.homeFielderOverrides);
    }
  }
  if (opts.awayBatterOverrides) {
    for (const id of awayLineup.battingOrder) apply(id, opts.awayBatterOverrides);
  }
  if (opts.awayPitcherOverrides) apply(awayLineup.startingPitcher, opts.awayPitcherOverrides);

  const home: SideInput = {
    teamId: homeTeam.id,
    battingOrder: homeLineup.battingOrder,
    startingPitcherId: homeLineup.startingPitcher,
    bullpen: homeLineup.bullpen,
    defenseByPosition: homeLineup.defenseByPosition,
  };
  const away: SideInput = {
    teamId: awayTeam.id,
    battingOrder: awayLineup.battingOrder,
    startingPitcherId: awayLineup.startingPitcher,
    bullpen: awayLineup.bullpen,
    defenseByPosition: awayLineup.defenseByPosition,
  };
  return {
    gameId: entry.gameId,
    stadiumId: entry.stadiumId,
    home,
    away,
    playerIndex,
    seed: gameSeed,
  };
};

const homeBattingIds = (input: GameInput) => new Set(input.home.battingOrder);

interface BattingTotals {
  hits: number;
  singles: number;
  doubles: number;
  triples: number;
  homers: number;
  strikeouts: number;
  reachedOnError: number;
  groundouts: number;
  pa: number;
}

const tallyHomeBatting = (events: readonly SimEvent[], homeIds: ReadonlySet<PlayerId>): BattingTotals => {
  const t: BattingTotals = {
    hits: 0, singles: 0, doubles: 0, triples: 0, homers: 0,
    strikeouts: 0, reachedOnError: 0, groundouts: 0, pa: 0,
  };
  // Track which side is batting via inningEnd halfInning.
  let half: 'top' | 'bottom' = 'top';
  let lastBatterIdInPA: PlayerId | null = null;
  for (const ev of events) {
    if (ev.kind === 'inningEnd') {
      half = half === 'top' ? 'bottom' : 'top';
    } else if (ev.kind === 'pitch') {
      lastBatterIdInPA = ev.batterId;
    } else if (ev.kind === 'atBatEnd') {
      // Home bats in bottom half.
      const isHomeBatter = half === 'bottom' && lastBatterIdInPA !== null && homeIds.has(lastBatterIdInPA);
      if (isHomeBatter) {
        t.pa += 1;
        switch (ev.outcome) {
          case 'single': t.hits += 1; t.singles += 1; break;
          case 'double': t.hits += 1; t.doubles += 1; break;
          case 'triple': t.hits += 1; t.triples += 1; break;
          case 'home-run': t.hits += 1; t.homers += 1; break;
          case 'strikeout-looking':
          case 'strikeout-swinging': t.strikeouts += 1; break;
          case 'reached-on-error': t.reachedOnError += 1; break;
          case 'groundout': t.groundouts += 1; break;
        }
      }
      lastBatterIdInPA = null;
    }
  }
  return t;
};

// ---- speed -----------------------------------------------------------------

describe('speed rating', () => {
  it('fast batters out-hit slow batters across a 30-game batch', () => {
    let fastHits = 0;
    let slowHits = 0;
    let fastTriples = 0;
    let slowTriples = 0;
    for (let s = 1; s <= 30; s++) {
      const fastInput = buildInput(s, { homeBatterOverrides: { speed: 99 } });
      const slowInput = buildInput(s, { homeBatterOverrides: { speed: 1 } });
      const fastEvents = runGame(fastInput);
      const slowEvents = runGame(slowInput);
      const fastT = tallyHomeBatting(fastEvents, homeBattingIds(fastInput));
      const slowT = tallyHomeBatting(slowEvents, homeBattingIds(slowInput));
      fastHits += fastT.hits;
      slowHits += slowT.hits;
      fastTriples += fastT.triples;
      slowTriples += slowT.triples;
    }
    // Direction: speed-99 batters get more hits and more triples.
    expect(fastHits).toBeGreaterThan(slowHits);
    expect(fastTriples).toBeGreaterThanOrEqual(slowTriples);
  });
});

// ---- platoonBias -----------------------------------------------------------

describe('platoonBias rating', () => {
  it('high-bias batters perform worse vs same-hand pitcher than low-bias batters', () => {
    // Find a same-hand matchup by inspecting the original lineup, then rerun
    // with platoonBias toggled. We don't depend on a particular hand — only
    // that overriding platoonBias=99 vs platoonBias=1 changes the same-hand
    // hit rate in the expected direction.
    let highBiasHits = 0;
    let lowBiasHits = 0;
    let highBiasPA = 0;
    let lowBiasPA = 0;
    for (let s = 1; s <= 30; s++) {
      const highInput = buildInput(s, { homeBatterOverrides: { platoonBias: 99 } });
      const lowInput = buildInput(s, { homeBatterOverrides: { platoonBias: 1 } });
      const highT = tallyHomeBatting(runGame(highInput), homeBattingIds(highInput));
      const lowT = tallyHomeBatting(runGame(lowInput), homeBattingIds(lowInput));
      highBiasHits += highT.hits;
      lowBiasHits += lowT.hits;
      highBiasPA += highT.pa;
      lowBiasPA += lowT.pa;
    }
    // Across both lineups about half the home batters share handedness with
    // the away SP, so high-platoonBias should leave fewer total hits than
    // low-platoonBias (the latter is essentially "no penalty in same-hand
    // matchups, slight boost in opposite-hand").
    expect(highBiasHits).toBeLessThan(lowBiasHits);
    // Sanity: PA totals stay in the same neighborhood — we're not creating
    // or eating innings, only shifting hit rate.
    expect(Math.abs(highBiasPA - lowBiasPA)).toBeLessThan(highBiasPA * 0.15);
  });
});

// ---- stamina --------------------------------------------------------------

describe('stamina rating', () => {
  it('low-stamina pitchers fade as their pitch count climbs', () => {
    // Run many games and bucket pitches thrown by the home SP into early
    // (1..30) vs late (60+) pitch-count windows. A stamina=1 pitcher should
    // show more balls and more contact in the late bucket than in the early
    // bucket, while a stamina=99 pitcher shouldn't move much.
    const measure = (overrides: Partial<PlayerRatings>) => {
      let earlyBalls = 0, earlyPitches = 0;
      let lateBalls = 0, latePitches = 0;
      for (let s = 1; s <= 30; s++) {
        const input = buildInput(s, { homePitcherOverrides: overrides });
        const events = runGame(input);
        // Count consecutive pitches from the home SP. The home SP fields the
        // top half — bottom half innings interleave but only top half pitches
        // get counted here (we filter by pitcherId).
        const homeSP = input.home.startingPitcherId;
        let count = 0;
        for (const ev of events) {
          if (ev.kind !== 'pitch') continue;
          if (ev.pitcherId !== homeSP) continue;
          count += 1;
          const isBall = ev.pitch.result === 'ball';
          if (count <= 30) {
            earlyPitches += 1;
            if (isBall) earlyBalls += 1;
          } else if (count >= 60) {
            latePitches += 1;
            if (isBall) lateBalls += 1;
          }
        }
      }
      return {
        earlyBallRate: earlyPitches > 0 ? earlyBalls / earlyPitches : 0,
        lateBallRate: latePitches > 0 ? lateBalls / latePitches : 0,
        earlyPitches, latePitches,
      };
    };
    const tired = measure({ stamina: 1 });
    const ironMan = measure({ stamina: 99 });
    // Direction: a stamina=1 pitcher should be missing the zone more late
    // than early. With stamina=99 the gap is small or reversed (noise only).
    expect(tired.lateBallRate).toBeGreaterThan(tired.earlyBallRate);
    // And the fade should be stronger for the low-stamina pitcher than for
    // the iron-man (their late ball rate climbs more relative to early).
    const tiredFade = tired.lateBallRate - tired.earlyBallRate;
    const ironFade = ironMan.lateBallRate - ironMan.earlyBallRate;
    expect(tiredFade).toBeGreaterThan(ironFade);
  });
});

// ---- glove ----------------------------------------------------------------

describe('glove rating', () => {
  it('iron-glove fielders concede more reached-on-error than elite-glove fielders', () => {
    // Override every home defender (defenseByPosition map) with extreme
    // glove. Compare ROE against the home side (i.e. when away is batting).
    let butcherROE = 0;
    let goldenROE = 0;
    for (let s = 1; s <= 40; s++) {
      const butcherInput = buildInput(s, { homeFielderOverrides: { glove: 1 } });
      const goldenInput = buildInput(s, { homeFielderOverrides: { glove: 99 } });
      const butcherEvents = runGame(butcherInput);
      const goldenEvents = runGame(goldenInput);
      // Top half = away bats, home fields → home errors land here.
      const countHomeErrors = (events: readonly SimEvent[]): number => {
        let half: 'top' | 'bottom' = 'top';
        let n = 0;
        for (const ev of events) {
          if (ev.kind === 'inningEnd') half = half === 'top' ? 'bottom' : 'top';
          else if (ev.kind === 'atBatEnd' && ev.outcome === 'reached-on-error' && half === 'top') {
            n += 1;
          }
        }
        return n;
      };
      butcherROE += countHomeErrors(butcherEvents);
      goldenROE += countHomeErrors(goldenEvents);
    }
    // Direction with margin: butchers should commit substantially more
    // errors than gold-glove fielders across the batch.
    expect(butcherROE).toBeGreaterThan(goldenROE);
    expect(butcherROE).toBeGreaterThan(goldenROE + 5);
  });
});
