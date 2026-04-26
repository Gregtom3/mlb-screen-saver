import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimEvent } from '../sim/types.js';

// Mock /sfx so we can assert which SFX functions a given event triggers without
// touching WebAudio (which has no jsdom backend).
vi.mock('./sfx.js', () => ({
  catcherMittPop: vi.fn(),
  fielderGlovePop: vi.fn(),
  batCrack: vi.fn(),
  hardHitWoosh: vi.fn(),
  foulTick: vi.fn(),
  organStinger: vi.fn(),
  strike3Call: vi.fn(),
  testTone: vi.fn(),
  slide: vi.fn(),
  batSnap: vi.fn(),
}));

import {
  catcherMittPop,
  fielderGlovePop,
  batCrack,
  hardHitWoosh,
  foulTick,
  organStinger,
  strike3Call,
} from './sfx.js';
import { createSfxDispatcher } from './dispatcher.js';

type PitchResult = Extract<SimEvent, { kind: 'pitch' }>['pitch']['result'];

const pitch = (result: PitchResult): SimEvent => ({
  t: 0,
  kind: 'pitch',
  pitcherId: 'p1',
  batterId: 'b1',
  pitch: {
    id: 'x',
    pitcherId: 'p1',
    batterId: 'b1',
    type: 'fastball',
    result,
    velocityMph: 92,
    locationZone: 5,
  },
});

const contact = (exitVeloMph: number): SimEvent => ({
  t: 0,
  kind: 'contact',
  batterId: 'b1',
  ballPath: { launchAngleDeg: 20, exitVeloMph, landingX: 100, landingY: 200, hangTimeSec: 4 },
});

beforeEach(() => {
  vi.mocked(catcherMittPop).mockClear();
  vi.mocked(fielderGlovePop).mockClear();
  vi.mocked(batCrack).mockClear();
  vi.mocked(hardHitWoosh).mockClear();
  vi.mocked(foulTick).mockClear();
  vi.mocked(organStinger).mockClear();
  vi.mocked(strike3Call).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createSfxDispatcher', () => {
  it('is inert until enabled (no calls before unlock)', () => {
    const d = createSfxDispatcher();
    d.dispatch([pitch('called-strike'), contact(100)]);
    expect(catcherMittPop).not.toHaveBeenCalled();
    expect(batCrack).not.toHaveBeenCalled();
    expect(hardHitWoosh).not.toHaveBeenCalled();
  });

  it('maps pitch results to the right SFX', () => {
    const d = createSfxDispatcher();
    d.setEnabled(true);
    d.dispatch([
      pitch('ball'),
      pitch('called-strike'),
      pitch('swinging-strike'),
      pitch('hit-by-pitch'),
      pitch('foul'),
      pitch('foul-tip-caught'),
      pitch('in-play'),
    ]);
    // 4 mitt-pop pitches: ball, called-strike, swinging-strike, hit-by-pitch.
    expect(catcherMittPop).toHaveBeenCalledTimes(4);
    // 2 foul-tick pitches.
    expect(foulTick).toHaveBeenCalledTimes(2);
    // 'in-play' is silent — the contact event handles the bat crack.
    expect(batCrack).not.toHaveBeenCalled();
  });

  it('layers the woosh on hard contact only', () => {
    const d = createSfxDispatcher();
    d.setEnabled(true);
    d.dispatch([contact(80), contact(95), contact(105)]);
    expect(batCrack).toHaveBeenCalledTimes(3);
    // 95 mph is the threshold (>=), so 95 and 105 should layer the woosh.
    expect(hardHitWoosh).toHaveBeenCalledTimes(2);
  });

  it('fires fielder glove pop on baserunner outs only', () => {
    const d = createSfxDispatcher();
    d.setEnabled(true);
    d.dispatch([
      { t: 0, kind: 'baserunner', runnerId: 'r1', from: 0, to: 1, out: false },
      { t: 0, kind: 'baserunner', runnerId: 'r2', from: 1, to: 2, out: true },
    ]);
    expect(fielderGlovePop).toHaveBeenCalledTimes(1);
  });

  it('strikeout outcomes trigger the strike3 fanfare; HR triggers the organ stinger', () => {
    const d = createSfxDispatcher();
    d.setEnabled(true);
    d.dispatch([
      { t: 0, kind: 'atBatEnd', atBatId: 'a1', outcome: 'strikeout-swinging', rbis: 0 },
      { t: 0, kind: 'atBatEnd', atBatId: 'a2', outcome: 'strikeout-looking', rbis: 0 },
      { t: 0, kind: 'atBatEnd', atBatId: 'a3', outcome: 'home-run', rbis: 1 },
      { t: 0, kind: 'atBatEnd', atBatId: 'a4', outcome: 'single', rbis: 0 },
    ]);
    expect(strike3Call).toHaveBeenCalledTimes(2);
    expect(organStinger).toHaveBeenCalledTimes(1);
  });

  it('gameEnd plays the organ stinger; gameStart / sub / inningEnd are silent', () => {
    const d = createSfxDispatcher();
    d.setEnabled(true);
    d.dispatch([
      { t: 0, kind: 'gameStart', gameId: 'g1', stadiumId: 's1' },
      { t: 0, kind: 'sub', outPlayerId: 'p1', inPlayerId: 'p2', reason: 'pinch-hit' },
      { t: 0, kind: 'inningEnd', halfInning: 'top', inning: 1, runs: 0 },
      { t: 0, kind: 'gameEnd', gameId: 'g1', finalRuns: { home: 5, away: 4 } },
    ]);
    expect(organStinger).toHaveBeenCalledTimes(1);
    expect(catcherMittPop).not.toHaveBeenCalled();
    expect(batCrack).not.toHaveBeenCalled();
  });

  it('setEnabled(false) silences subsequent dispatches', () => {
    const d = createSfxDispatcher();
    d.setEnabled(true);
    d.dispatch([pitch('ball')]);
    d.setEnabled(false);
    d.dispatch([pitch('ball')]);
    expect(catcherMittPop).toHaveBeenCalledTimes(1);
  });
});
