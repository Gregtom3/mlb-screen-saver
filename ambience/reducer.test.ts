import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../sim/types.js';
import { createAmbienceReducer } from './reducer.js';
import { EMPTY_STAR_SET } from './star.js';

const baseInit = {
  homeTeamId: 'HOME',
  awayTeamId: 'AWAY',
  stars: EMPTY_STAR_SET,
};

const pitch = (
  result: 'ball' | 'called-strike' | 'swinging-strike' | 'foul' | 'in-play',
  t = 0,
  batterId = 'b1',
): SimEvent => ({
  t,
  kind: 'pitch',
  pitcherId: 'p1',
  batterId,
  pitch: {
    id: `pitch-${t}`,
    pitcherId: 'p1',
    batterId,
    type: 'fastball',
    result,
    velocityMph: 92,
    locationZone: 5,
  },
});

describe('createAmbienceReducer', () => {
  it('starts at the initial pre-game state with no pulses', () => {
    const r = createAmbienceReducer(baseInit);
    const snap = r.snapshot();
    expect(snap.phase).toBe('pre-game');
    expect(snap.arousal).toBe(0);
    expect(snap.energy).toBeGreaterThan(0);
    expect(snap.energy).toBeLessThan(1);
  });

  it('gameStart applies an applause-tail and switches phase to live', () => {
    const r = createAmbienceReducer(baseInit);
    const { state, pulses } = r.step(
      [{ t: 0, kind: 'gameStart', gameId: 'g1', stadiumId: 's1' }],
      0,
    );
    expect(state.phase).toBe('live');
    expect(pulses.some((p) => p.kind === 'applause-tail')).toBe(true);
  });

  it('home-run by the home team produces a roar pulse and lifts mood', () => {
    const r = createAmbienceReducer(baseInit);
    // First half is "top" (away batting). Walk through a quick top of 1 to
    // flip to bottom of 1 where home is batting.
    r.step(
      [
        { t: 0, kind: 'gameStart', gameId: 'g1', stadiumId: 's1' },
        { t: 1, kind: 'inningEnd', halfInning: 'top', inning: 1, runs: 0 },
      ],
      1,
    );
    const moodBefore = r.snapshot().mood;
    const { state, pulses } = r.step(
      [
        pitch('called-strike', 100, 'home-batter-1'),
        {
          t: 101,
          kind: 'atBatEnd',
          atBatId: 'a1',
          outcome: 'home-run',
          rbis: 1,
        },
      ],
      0.05,
    );
    expect(pulses.some((p) => p.kind === 'roar' && p.side === 'home')).toBe(true);
    expect(state.mood).toBeGreaterThan(moodBefore);
    expect(state.arousal).toBeGreaterThan(0.5);
  });

  it('strikeout by home pitcher fires a cheer; by away pitcher does not', () => {
    const home = createAmbienceReducer(baseInit);
    // top of 1, away batting → home pitching. K should cheer.
    const { pulses: top } = home.step(
      [
        { t: 0, kind: 'gameStart', gameId: 'g1', stadiumId: 's1' },
        pitch('called-strike', 1, 'away-batter-1'),
        pitch('swinging-strike', 2, 'away-batter-1'),
        pitch('swinging-strike', 3, 'away-batter-1'),
        {
          t: 4,
          kind: 'atBatEnd',
          atBatId: 'a1',
          outcome: 'strikeout-swinging',
          rbis: 0,
        },
      ],
      0.2,
    );
    expect(top.some((p) => p.kind === 'cheer' && p.side === 'home')).toBe(true);

    // Now bottom of 1 (home batting → away pitching). K should NOT cheer.
    const away = createAmbienceReducer(baseInit);
    const { pulses: bot } = away.step(
      [
        { t: 0, kind: 'gameStart', gameId: 'g1', stadiumId: 's1' },
        { t: 1, kind: 'inningEnd', halfInning: 'top', inning: 1, runs: 0 },
        pitch('swinging-strike', 2, 'home-batter-1'),
        pitch('swinging-strike', 3, 'home-batter-1'),
        pitch('swinging-strike', 4, 'home-batter-1'),
        {
          t: 5,
          kind: 'atBatEnd',
          atBatId: 'a2',
          outcome: 'strikeout-swinging',
          rbis: 0,
        },
      ],
      0.2,
    );
    expect(bot.some((p) => p.kind === 'cheer')).toBe(false);
  });

  it('does not emit walkup-start pulses (handled by /render anim cues)', () => {
    // Walk-up jingle scheduling moved to /render/anim-cues so it can lead
    // in *after* the prior play settles (rather than at the first pitch,
    // which steps on runner motion + post-contact ball flight). The
    // reducer is free of walkup pulses now.
    const r = createAmbienceReducer(baseInit);
    const { pulses } = r.step(
      [
        { t: 0, kind: 'gameStart', gameId: 'g1', stadiumId: 's1' },
        pitch('ball', 1, 'b1'),
        pitch('ball', 2, 'b1'),
        pitch('ball', 3, 'b1'),
      ],
      0.1,
    );
    const walkups = pulses.filter((p) => p.kind === 'walkup-start');
    expect(walkups.length).toBe(0);
  });

  it('arms a two-strike-clap once when home is pitching, then disarms', () => {
    const r = createAmbienceReducer(baseInit);
    const { pulses } = r.step(
      [
        { t: 0, kind: 'gameStart', gameId: 'g1', stadiumId: 's1' },
        pitch('called-strike', 1, 'a1'),
        pitch('called-strike', 2, 'a1'),
        pitch('foul', 3, 'a1'),  // 2-strike foul; should not re-fire the clap
      ],
      0.1,
    );
    const claps = pulses.filter((p) => p.kind === 'two-strike-clap');
    expect(claps.length).toBe(1);
  });

  it('arousal decays over time toward 0', () => {
    const r = createAmbienceReducer(baseInit);
    r.step(
      [
        { t: 0, kind: 'gameStart', gameId: 'g1', stadiumId: 's1' },
        { t: 1, kind: 'inningEnd', halfInning: 'top', inning: 1, runs: 0 },
        {
          t: 2,
          kind: 'atBatEnd',
          atBatId: 'a1',
          outcome: 'home-run',
          rbis: 1,
        },
      ],
      0.1,
    );
    const peak = r.snapshot().arousal;
    expect(peak).toBeGreaterThan(0.5);
    // 5 seconds later, arousal should be much lower (half-life ~0.9s).
    r.step([], 5);
    const decayed = r.snapshot().arousal;
    expect(decayed).toBeLessThan(peak * 0.1);
  });

  it('blowout pins energy ceiling lower than a tied late-game', () => {
    const blowout = createAmbienceReducer(baseInit);
    // Sim a 7-0 blowout in the 6th — top of 6, bases empty, 7-run away lead.
    const events: SimEvent[] = [
      { t: 0, kind: 'gameStart', gameId: 'g1', stadiumId: 's1' },
    ];
    // 5 fully-played innings.
    for (let i = 1; i <= 5; i++) {
      events.push({ t: i * 100, kind: 'inningEnd', halfInning: 'top', inning: i, runs: 0 });
      events.push({ t: i * 100 + 50, kind: 'inningEnd', halfInning: 'bottom', inning: i, runs: 0 });
    }
    // Manually score 7 for away across the events. Easier: feed scoring runs.
    for (let i = 0; i < 7; i++) {
      events.push({
        t: 600 + i,
        kind: 'baserunner',
        runnerId: `r${i}`,
        from: 3,
        to: 0,
        out: false,
      });
    }
    blowout.step(events, 1);
    // Settle: a few seconds of no events to let decay happen.
    blowout.step([], 30);
    const blowoutEnergy = blowout.snapshot().energy;

    const lateClose = createAmbienceReducer(baseInit);
    // Tied 0-0 in the 9th, runner on 2nd, 1 out — peak leverage state.
    const events2: SimEvent[] = [
      { t: 0, kind: 'gameStart', gameId: 'g1', stadiumId: 's1' },
    ];
    for (let i = 1; i <= 8; i++) {
      events2.push({ t: i * 100, kind: 'inningEnd', halfInning: 'top', inning: i, runs: 0 });
      events2.push({ t: i * 100 + 50, kind: 'inningEnd', halfInning: 'bottom', inning: i, runs: 0 });
    }
    events2.push({
      t: 850,
      kind: 'baserunner',
      runnerId: 'r1',
      from: 1,
      to: 2,
      out: false,
    });
    events2.push({
      t: 855,
      kind: 'atBatEnd',
      atBatId: 'a1',
      outcome: 'flyout',
      rbis: 0,
    });
    lateClose.step(events2, 1);
    lateClose.step([], 30);
    const lateCloseEnergy = lateClose.snapshot().energy;
    expect(lateCloseEnergy).toBeGreaterThan(blowoutEnergy + 0.15);
  });

  it('produces deterministic state given the same inputs', () => {
    const a = createAmbienceReducer(baseInit);
    const b = createAmbienceReducer(baseInit);
    const events: SimEvent[] = [
      { t: 0, kind: 'gameStart', gameId: 'g1', stadiumId: 's1' },
      pitch('called-strike', 1),
      pitch('foul', 2),
      pitch('swinging-strike', 3),
      { t: 4, kind: 'atBatEnd', atBatId: 'a1', outcome: 'strikeout-swinging', rbis: 0 },
    ];
    const fa = a.step(events, 0.5);
    const fb = b.step(events, 0.5);
    expect(fa.state).toEqual(fb.state);
    expect(fa.pulses).toEqual(fb.pulses);
  });
});
