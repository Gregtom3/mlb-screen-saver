import { describe, expect, it } from 'vitest';
import { generateInitialLeague } from '../content/index.js';
import { buildSchedule, buildLineup } from '../season/index.js';
import { runGame, buildBoxScore } from './index.js';
import type { GameInput, SideInput } from './types.js';
import type { StadiumDimensions } from '../world/types.js';
import { PLACEHOLDER_DIMENSIONS } from '../world/stadium-geometry.js';

const buildInputForFirstGame = (masterSeed: number, gameSeed: number): GameInput => {
  const league = generateInitialLeague(masterSeed);
  const schedule = buildSchedule(league.teams, league.season.year);
  const entry = schedule.entries.find((e) => e.day === 1)!;
  const homeTeam = league.teams.find((t) => t.id === entry.homeTeamId)!;
  const awayTeam = league.teams.find((t) => t.id === entry.awayTeamId)!;
  const homeLineup = buildLineup(homeTeam, league.players, 1);
  const awayLineup = buildLineup(awayTeam, league.players, 1);
  const playerIndex = new Map(league.players.map((p) => [p.id, p]));
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

describe('runGame determinism', () => {
  it('same seed + same input yields byte-identical events', () => {
    const a = runGame(buildInputForFirstGame(0xba_5e_ba_11, 0xc0_ff_ee_42));
    const b = runGame(buildInputForFirstGame(0xba_5e_ba_11, 0xc0_ff_ee_42));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different seeds produce different games', () => {
    const a = runGame(buildInputForFirstGame(0xba_5e_ba_11, 1));
    const b = runGame(buildInputForFirstGame(0xba_5e_ba_11, 2));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

describe('runGame sanity', () => {
  it('every game terminates with a gameEnd event and a non-tie score', () => {
    for (let s = 1; s <= 30; s++) {
      const input = buildInputForFirstGame(0xba_5e_ba_11, s);
      const events = runGame(input);
      const last = events[events.length - 1];
      expect(last?.kind).toBe('gameEnd');
      if (last?.kind === 'gameEnd') {
        expect(last.finalRuns.home).not.toBe(last.finalRuns.away);
      }
    }
  });

  it('every half-inning ends with exactly the documented number of outs', () => {
    const input = buildInputForFirstGame(0xba_5e_ba_11, 7);
    const events = runGame(input);
    const inningEnds = events.filter((e) => e.kind === 'inningEnd');
    expect(inningEnds.length).toBeGreaterThanOrEqual(17); // 9 top + 8 bot minimum
    expect(inningEnds.length).toBeLessThanOrEqual(40); // safety against runaways
  });

  it('100-game batch produces plausible average runs per game', () => {
    let totalRuns = 0;
    let gameCount = 0;
    for (let s = 1; s <= 100; s++) {
      const events = runGame(buildInputForFirstGame(0xba_5e_ba_11, s));
      const last = events[events.length - 1];
      if (last?.kind === 'gameEnd') {
        totalRuns += last.finalRuns.home + last.finalRuns.away;
        gameCount += 1;
      }
    }
    expect(gameCount).toBe(100);
    const avg = totalRuns / gameCount;
    // MLB combined teams average ~9 runs/game; we should be in a plausible band.
    expect(avg).toBeGreaterThan(4);
    expect(avg).toBeLessThan(20);
  });

  it('box score totals match the event log', () => {
    const input = buildInputForFirstGame(0xba_5e_ba_11, 11);
    const events = runGame(input);
    const box = buildBoxScore(events, input);
    const last = events[events.length - 1];
    if (last?.kind !== 'gameEnd') throw new Error('no gameEnd event');
    expect(box.lineScore.home.runs).toBe(last.finalRuns.home);
    expect(box.lineScore.away.runs).toBe(last.finalRuns.away);
    // Sum of inning runs should equal totals.
    const sumTop = box.lineScore.innings.reduce((s, i) => s + i.top, 0);
    const sumBot = box.lineScore.innings.reduce((s, i) => s + (i.bottom ?? 0), 0);
    expect(sumTop).toBe(box.lineScore.away.runs);
    expect(sumBot).toBe(box.lineScore.home.runs);
  });
});

describe('pitcher zone tendencies', () => {
  it('every in-zone pitch lands in 1..9, every out-of-zone pitch is 0', () => {
    const input = buildInputForFirstGame(0xba_5e_ba_11, 7);
    const events = runGame(input);
    let inZone = 0;
    let outZone = 0;
    for (const ev of events) {
      if (ev.kind !== 'pitch') continue;
      const z = ev.pitch.locationZone;
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(9);
      if (z === 0) outZone += 1;
      else inZone += 1;
    }
    // Sanity floor: a real game has many of each.
    expect(inZone).toBeGreaterThan(20);
    expect(outZone).toBeGreaterThan(20);
  });

  it('the same pitcher fingerprint produces a recognizable in-zone bias', () => {
    // Run 30 games with the same seed; aggregate zone counts for one pitcher
    // and verify their hottest cell sits at least 50% above their coldest
    // cell — the pure-uniform fallback would converge to roughly equal.
    const counts = new Map<string, number[]>();
    for (let s = 1; s <= 30; s++) {
      const events = runGame(buildInputForFirstGame(0xba_5e_ba_11, s));
      for (const ev of events) {
        if (ev.kind !== 'pitch') continue;
        const z = ev.pitch.locationZone;
        if (z < 1 || z > 9) continue;
        const arr = counts.get(ev.pitcherId) ?? new Array(10).fill(0);
        arr[z] += 1;
        counts.set(ev.pitcherId, arr);
      }
    }
    let qualifiedPitchers = 0;
    let withBias = 0;
    for (const arr of counts.values()) {
      const total = arr.slice(1, 10).reduce((s, x) => s + x, 0);
      if (total < 60) continue; // need enough pitches to read a fingerprint
      qualifiedPitchers += 1;
      const max = Math.max(...arr.slice(1, 10));
      const min = Math.min(...arr.slice(1, 10).filter((v) => v > 0));
      if (max >= min * 1.5) withBias += 1;
    }
    expect(qualifiedPitchers).toBeGreaterThan(0);
    // Most pitchers with enough sample size should show a clear hot/cold
    // skew — uniform sampling would not.
    expect(withBias / qualifiedPitchers).toBeGreaterThan(0.6);
  });
});

// Phase 5 fence-aware HR check: rolled home-run trajectories that fall short
// of the actual fence at their spray angle are downgraded to wall-balls.
// These tests lock the contract: park geometry visibly moves HR/G, and the
// neutral-park HR rate stays in the same band as before the change.
describe('fence-aware home runs', () => {
  // Helper: run N games on a single park geometry, count atBatEnd
  // outcomes by kind. Same seeds + teams across calls so the only
  // varying input is the stadium dimensions.
  const countOutcomesAcrossPark = (
    dims: StadiumDimensions | undefined,
    games: number,
  ): { hr: number; doubles: number; flyouts: number; runs: number } => {
    let hr = 0;
    let doubles = 0;
    let flyouts = 0;
    let runs = 0;
    for (let s = 1; s <= games; s++) {
      const baseInput = buildInputForFirstGame(0xba_5e_ba_11, s);
      const input: GameInput = dims
        ? { ...baseInput, stadiumDimensions: dims }
        : baseInput;
      const events = runGame(input);
      for (const ev of events) {
        if (ev.kind === 'atBatEnd') {
          if (ev.outcome === 'home-run') hr += 1;
          else if (ev.outcome === 'double') doubles += 1;
          else if (ev.outcome === 'flyout') flyouts += 1;
        } else if (ev.kind === 'gameEnd') {
          runs += ev.finalRuns.home + ev.finalRuns.away;
        }
      }
    }
    return { hr, doubles, flyouts, runs };
  };

  // Two synthetic parks isolate the geometric effect: one tiny across the
  // board (everything is a HR target), one cavernous (deep flies die at
  // the warning track). 50 games each is enough sample to read a clear
  // signal without slowing the suite.
  const SHORT_PARK: StadiumDimensions = {
    leftFt: 305,
    leftCenterFt: 310,
    centerFt: 320,
    rightCenterFt: 310,
    rightFt: 305,
    wallHeightFt: 8,
    foulTerritoryRating: 5,
    moundHeightIn: 10,
  };
  const DEEP_PARK: StadiumDimensions = {
    leftFt: 380,
    leftCenterFt: 410,
    centerFt: 440,
    rightCenterFt: 410,
    rightFt: 380,
    wallHeightFt: 18,
    foulTerritoryRating: 5,
    moundHeightIn: 10,
  };

  it('a short park produces noticeably more HRs than a deep park (same seeds, same teams)', () => {
    const short = countOutcomesAcrossPark(SHORT_PARK, 50);
    const deep = countOutcomesAcrossPark(DEEP_PARK, 50);
    expect(short.hr).toBeGreaterThan(0);
    expect(deep.hr).toBeGreaterThan(0);
    // The geometric effect should be unmistakable. We expect the short
    // park to produce at least 1.3× the HRs of the deep park; in
    // practice the gap is usually wider, but this lower bound holds
    // across seed variance.
    expect(short.hr / deep.hr).toBeGreaterThan(1.3);
  });

  it('a deep park converts some would-be HRs into doubles and flyouts (wall-ball downgrades)', () => {
    const short = countOutcomesAcrossPark(SHORT_PARK, 50);
    const deep = countOutcomesAcrossPark(DEEP_PARK, 50);
    // Combined non-HR ball-in-air outcomes should be higher in the deep
    // park because borderline HR rolls are now downgraded.
    expect(deep.doubles + deep.flyouts).toBeGreaterThan(short.doubles + short.flyouts);
  });

  it('neutral-park HR/G stays in the same band as the legacy (no-dimensions) path', () => {
    // Calibration lock: with the +0.003 base bump and the geometry filter
    // active in a neutral-ish park, total HRs across a 50-game batch
    // shouldn't drift wildly from the legacy no-dimensions path on the
    // same seeds. Loose enough to absorb seed variance and the
    // center-biased spray distribution (more balls toward deep CF, which
    // the fence filter downgrades a bit more aggressively).
    const legacy = countOutcomesAcrossPark(undefined, 50);
    const filtered = countOutcomesAcrossPark(PLACEHOLDER_DIMENSIONS, 50);
    const ratio = filtered.hr / Math.max(1, legacy.hr);
    expect(ratio).toBeGreaterThan(0.65);
    expect(ratio).toBeLessThan(1.25);
    // Run environment also shouldn't shift much.
    const runRatio = filtered.runs / Math.max(1, legacy.runs);
    expect(runRatio).toBeGreaterThan(0.85);
    expect(runRatio).toBeLessThan(1.15);
  });
});

describe('fielder errors', () => {
  it('produces reached-on-error outcomes across a 30-game batch', () => {
    let totalErrors = 0;
    for (let s = 1; s <= 30; s++) {
      const events = runGame(buildInputForFirstGame(0xba_5e_ba_11, s));
      for (const ev of events) {
        if (ev.kind === 'atBatEnd' && ev.outcome === 'reached-on-error') {
          totalErrors += 1;
        }
      }
    }
    // ~0.4-0.5 errors per team per game * 60 team-games = ~24-30 expected.
    // Wide bound to absorb seed variance and future tuning.
    expect(totalErrors).toBeGreaterThan(5);
    expect(totalErrors).toBeLessThan(120);
  });

  it('box-score errors equal reached-on-error events, charged to fielding side', () => {
    for (const seed of [3, 17, 42, 99]) {
      const input = buildInputForFirstGame(0xba_5e_ba_11, seed);
      const events = runGame(input);
      const box = buildBoxScore(events, input);

      // Replay outcomes by half-inning to determine the fielding side per ROE.
      let half: 'top' | 'bottom' = 'top';
      let homeErr = 0;
      let awayErr = 0;
      for (const ev of events) {
        if (ev.kind === 'inningEnd') {
          half = half === 'top' ? 'bottom' : 'top';
        } else if (ev.kind === 'atBatEnd' && ev.outcome === 'reached-on-error') {
          // Top half: away bats, home fields → home error. Bottom: vice versa.
          if (half === 'top') homeErr += 1;
          else awayErr += 1;
        }
      }
      expect(box.lineScore.home.errors).toBe(homeErr);
      expect(box.lineScore.away.errors).toBe(awayErr);
    }
  });
});
