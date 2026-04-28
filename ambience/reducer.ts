// Ambience reducer. Reads the SimEvent stream (in chronological batches),
// mirrors enough game state to know who's batting and the current count /
// score, and produces:
//
//   1. A continuous CrowdState (energy / arousal / mood / attention).
//   2. A list of discrete ReactionPulses to fire this tick.
//
// Both /audio and /render subscribe to the same output, so audio reactions
// and visual reactions never drift.
//
// Determinism contract: state is a pure function of (prior state, events,
// dtSeconds). No wall-clock, no Math.random.

import type { AtBatOutcome, SimEvent } from '../sim/types.js';
import type { PlayerId, TeamId } from '../world/types.js';
import { computeLeverage } from './leverage.js';
import { initialCrowdState, type CrowdState, type ReactionPulse } from './state.js';
import type { StarSet } from './star.js';

export interface AmbienceFrame {
  readonly state: CrowdState;
  readonly pulses: readonly ReactionPulse[];
}

export interface AmbienceReducerInit {
  readonly homeTeamId: TeamId;
  readonly awayTeamId: TeamId;
  readonly stars: StarSet;
}

interface InternalGameMirror {
  inning: number;
  half: 'top' | 'bottom';
  outs: number;
  balls: number;
  strikes: number;
  scoreHome: number;
  scoreAway: number;
  basesFirst: boolean;
  basesSecond: boolean;
  basesThird: boolean;
  currentBatterId: PlayerId | null;
  // Last batter we emitted a walkup-start for, so we don't re-fire on every
  // pitch that re-asserts the same currentBatterId.
  lastWalkupBatterId: PlayerId | null;
  // True after the last pitch was a 2-strike count — used to fire a
  // two-strike-clap exactly once per pitch entrance, not on every frame.
  twoStrikeArmed: boolean;
  // Decoded once per inningEnd to size applause-tail intensity.
  lastInningRuns: number;
  // Game-end captured side, used to drive a sustained roar.
  finalEmitted: boolean;
}

export interface AmbienceReducer {
  /** Push a chronologically-ordered batch of events that just crossed the
   *  playback cursor. Returns this tick's CrowdState and the pulses that
   *  fired during the batch. The reducer also internally decays arousal /
   *  re-evaluates baseline energy based on the elapsed wall-time. */
  step(events: readonly SimEvent[], dtSeconds: number): AmbienceFrame;
  /** Reset to a fresh game (e.g. on channel switch). */
  reset(): void;
  /** Read-only snapshot of the current CrowdState (no decay applied). */
  snapshot(): CrowdState;
}

// Arousal half-life ~0.9s gives the crowd's spike a perceptible tail without
// turning every play into a sustained roar.
const AROUSAL_HALF_LIFE_S = 0.9;
// Energy moves slowly — it's the season-long mood of the building.
const ENERGY_HALF_LIFE_S = 8.0;

const halfLifeDecay = (lifeSec: number, dt: number): number =>
  Math.pow(0.5, dt / lifeSec);

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const clamp11 = (v: number): number => Math.max(-1, Math.min(1, v));

const battingSide = (mirror: InternalGameMirror): 'home' | 'away' =>
  mirror.half === 'top' ? 'away' : 'home';

const fieldingSide = (mirror: InternalGameMirror): 'home' | 'away' =>
  mirror.half === 'top' ? 'home' : 'away';

// Spray-angle in degrees (-45..+45 from CF) from sim ballPath landing coords.
// landingX is feet from home plate (+x toward right field), landingY is feet
// up the middle. atan2(x, y) gives angle from CF.
const sprayAngleFor = (landingX: number, landingY: number): number => {
  const radians = Math.atan2(landingX, Math.max(1, landingY));
  return (radians * 180) / Math.PI;
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

// Baseline energy as a function of leverage + score blowout. Blowouts pin
// the ceiling low; tied late games pin the floor high.
const baselineEnergy = (leverage: number, scoreDiff: number): number => {
  const blowoutPenalty = scoreDiff >= 6 ? 0.45 : scoreDiff >= 4 ? 0.2 : 0;
  return Math.max(0.18, Math.min(0.95, 0.32 + leverage * 0.55 - blowoutPenalty));
};

export const createAmbienceReducer = (
  init: AmbienceReducerInit,
): AmbienceReducer => {
  let state: CrowdState = initialCrowdState();
  let mirror: InternalGameMirror = freshMirror();
  // Stable references to init values so reset() doesn't lose them.
  const { homeTeamId: _homeTeamId, awayTeamId: _awayTeamId, stars } = init;
  void _homeTeamId; void _awayTeamId;

  function freshMirror(): InternalGameMirror {
    return {
      inning: 1,
      half: 'top',
      outs: 0,
      balls: 0,
      strikes: 0,
      scoreHome: 0,
      scoreAway: 0,
      basesFirst: false,
      basesSecond: false,
      basesThird: false,
      currentBatterId: null,
      lastWalkupBatterId: null,
      twoStrikeArmed: false,
      lastInningRuns: 0,
      finalEmitted: false,
    };
  }

  const reset = (): void => {
    state = initialCrowdState();
    mirror = freshMirror();
  };

  const step = (
    events: readonly SimEvent[],
    dtSeconds: number,
  ): AmbienceFrame => {
    const pulses: ReactionPulse[] = [];

    // Decay arousal toward 0 first, regardless of new events.
    let arousal = state.arousal * halfLifeDecay(AROUSAL_HALF_LIFE_S, dtSeconds);

    let mood = state.mood;
    let energy = state.energy;
    let attention = state.attention;
    let phase = state.phase;
    let homeBatting = state.homeBatting;
    let batterId = state.batterId;
    let batterIsStar = state.batterIsStar;

    const bumpArousal = (delta: number): void => {
      arousal = clamp01(arousal + delta);
    };
    const bumpEnergy = (delta: number): void => {
      energy = clamp01(energy + delta);
    };
    const bumpMood = (delta: number): void => {
      mood = clamp11(mood + delta);
    };

    for (const ev of events) {
      switch (ev.kind) {
        case 'gameStart': {
          phase = 'live';
          attention = 0.55;
          energy = 0.32;
          pulses.push({
            kind: 'applause-tail',
            intensity: 0.55,
            durationMs: 4500,
            side: 'home',
          });
          bumpArousal(0.25);
          break;
        }
        case 'pitch': {
          const r = ev.pitch.result;
          mirror.currentBatterId = ev.batterId;
          // Walk-up jingle is now scheduled by /render/anim-cues so it
          // can lead in *after* the prior play settles instead of stepping
          // on it. The reducer still tracks the batter change for arousal
          // bumps, but it no longer emits the audio pulse.
          if (mirror.lastWalkupBatterId !== ev.batterId) {
            mirror.lastWalkupBatterId = ev.batterId;
            const isStar = stars.has(ev.batterId);
            // Star at the plate gets a small arousal pop.
            if (isStar && battingSide(mirror) === 'home') {
              bumpArousal(0.18);
            }
            batterId = ev.batterId;
            batterIsStar = isStar;
            homeBatting = battingSide(mirror) === 'home';
          }
          // Update count.
          if (r === 'ball') {
            mirror.balls = Math.min(4, mirror.balls + 1);
            bumpArousal(0.02);
          } else if (r === 'called-strike' || r === 'swinging-strike') {
            mirror.strikes = Math.min(3, mirror.strikes + 1);
            bumpArousal(0.06);
          } else if (r === 'foul' && mirror.strikes < 2) {
            mirror.strikes += 1;
          } else if (r === 'foul' || r === 'foul-tip-caught') {
            // 2-strike foul keeps tension; small ripple.
            bumpArousal(0.04);
          }
          // Two-strike clap, home pitching: arm once per entrance.
          const isHomePitching = fieldingSide(mirror) === 'home';
          if (mirror.strikes >= 2 && isHomePitching && !mirror.twoStrikeArmed) {
            mirror.twoStrikeArmed = true;
            const lev = computeLeverage(mirrorAsLeverage(mirror));
            pulses.push({
              kind: 'two-strike-clap',
              intensity: clamp01(0.45 + lev * 0.5),
              durationMs: 2400,
              side: 'home',
            });
            bumpAttention(0.1);
          }
          if (mirror.strikes < 2) mirror.twoStrikeArmed = false;
          break;
        }
        case 'contact': {
          // Hard hit gasp/oo + spray-angle wave seed.
          const ev0 = ev;
          const angle = sprayAngleFor(ev0.ballPath.landingX, ev0.ballPath.landingY);
          const ev2 = ev0;
          if (ev2.ballPath.exitVeloMph >= 95) {
            const battingHome = battingSide(mirror) === 'home';
            pulses.push({
              kind: battingHome ? 'oo' : 'gasp',
              intensity: clamp01(0.55 + (ev2.ballPath.exitVeloMph - 95) * 0.012),
              durationMs: 900,
              side: battingHome ? 'home' : 'all',
              centerAngleDeg: angle,
            });
            bumpArousal(0.18);
          } else {
            bumpArousal(0.05);
          }
          break;
        }
        case 'baserunner': {
          // Update bases mirror.
          if (ev.from === 1) mirror.basesFirst = false;
          else if (ev.from === 2) mirror.basesSecond = false;
          else if (ev.from === 3) mirror.basesThird = false;
          if (!ev.out) {
            if (ev.to === 1) mirror.basesFirst = true;
            else if (ev.to === 2) mirror.basesSecond = true;
            else if (ev.to === 3) mirror.basesThird = true;
            else if (ev.to === 0) {
              // Score!
              if (mirror.half === 'top') mirror.scoreAway += 1;
              else mirror.scoreHome += 1;
              const homeScored = mirror.half === 'bottom';
              if (homeScored) {
                pulses.push({
                  kind: 'cheer',
                  intensity: 0.75,
                  durationMs: 1800,
                  side: 'home',
                });
                bumpArousal(0.3);
                bumpMood(0.18);
                bumpEnergy(0.06);
              } else {
                pulses.push({
                  kind: 'groan',
                  intensity: 0.55,
                  durationMs: 1500,
                  side: 'home',
                });
                bumpMood(-0.12);
              }
            }
          } else {
            // Out on the bases — close-play gasp shape.
            pulses.push({
              kind: 'gasp',
              intensity: 0.45,
              durationMs: 700,
              side: 'all',
            });
            bumpArousal(0.08);
          }
          break;
        }
        case 'atBatEnd': {
          mirror.outs += outsAddedFor(ev.outcome);
          mirror.balls = 0;
          mirror.strikes = 0;
          mirror.twoStrikeArmed = false;

          const battingHome = battingSide(mirror) === 'home';
          const lev = computeLeverage(mirrorAsLeverage(mirror));

          switch (ev.outcome) {
            case 'home-run': {
              if (battingHome) {
                pulses.push({
                  kind: 'roar',
                  intensity: 1.0,
                  durationMs: 6500,
                  side: 'home',
                });
                pulses.push({
                  kind: 'applause-tail',
                  intensity: 0.85,
                  durationMs: 5500,
                  side: 'home',
                });
                bumpArousal(0.95);
                bumpMood(0.35);
                bumpEnergy(0.15);
              } else {
                pulses.push({
                  kind: 'groan',
                  intensity: 0.7,
                  durationMs: 2400,
                  side: 'home',
                });
                bumpArousal(0.4);
                bumpMood(-0.22);
                bumpEnergy(-0.05);
              }
              break;
            }
            case 'triple':
            case 'double': {
              if (battingHome) {
                pulses.push({
                  kind: 'cheer',
                  intensity: ev.outcome === 'triple' ? 0.8 : 0.65,
                  durationMs: 1900,
                  side: 'home',
                });
                bumpArousal(0.4);
                bumpMood(0.1);
              } else {
                pulses.push({
                  kind: 'oo',
                  intensity: 0.5,
                  durationMs: 1100,
                  side: 'home',
                });
                bumpArousal(0.2);
              }
              break;
            }
            case 'single': {
              if (battingHome) {
                pulses.push({
                  kind: 'cheer',
                  intensity: 0.45 + lev * 0.3,
                  durationMs: 1300,
                  side: 'home',
                });
                bumpArousal(0.2);
                bumpMood(0.05);
              }
              break;
            }
            case 'walk':
            case 'hit-by-pitch': {
              // Bases-loaded RBI walk gets a rally clap; otherwise mild reaction.
              const basesLoaded =
                mirror.basesFirst && mirror.basesSecond && mirror.basesThird;
              if (battingHome && basesLoaded) {
                pulses.push({
                  kind: 'rally-clap',
                  intensity: 0.7,
                  durationMs: 2600,
                  side: 'home',
                });
                bumpArousal(0.25);
              } else if (battingHome) {
                bumpArousal(0.07);
              } else if (mirror.basesFirst || mirror.basesSecond || mirror.basesThird) {
                // Free runner the wrong way — small home groan.
                pulses.push({
                  kind: 'groan',
                  intensity: 0.32,
                  durationMs: 900,
                  side: 'home',
                });
              }
              break;
            }
            case 'strikeout-swinging':
            case 'strikeout-looking': {
              const homePitching = fieldingSide(mirror) === 'home';
              if (homePitching) {
                pulses.push({
                  kind: 'cheer',
                  intensity: 0.5 + lev * 0.45,
                  durationMs: 1500,
                  side: 'home',
                });
                bumpArousal(0.3 + lev * 0.3);
                bumpMood(0.04);
              } else {
                bumpArousal(0.04);
                bumpMood(-0.03);
              }
              break;
            }
            case 'double-play':
            case 'triple-play': {
              const homePitching = fieldingSide(mirror) === 'home';
              if (homePitching) {
                pulses.push({
                  kind: 'cheer',
                  intensity: ev.outcome === 'triple-play' ? 1.0 : 0.7,
                  durationMs: 2200,
                  side: 'home',
                });
                bumpArousal(0.5);
                bumpMood(0.15);
              } else {
                pulses.push({
                  kind: 'groan',
                  intensity: 0.7,
                  durationMs: 1700,
                  side: 'home',
                });
                bumpMood(-0.18);
                bumpEnergy(-0.04);
              }
              break;
            }
            case 'reached-on-error': {
              if (battingHome) {
                pulses.push({
                  kind: 'oo',
                  intensity: 0.4,
                  durationMs: 900,
                  side: 'home',
                });
              } else {
                pulses.push({
                  kind: 'groan',
                  intensity: 0.5,
                  durationMs: 1100,
                  side: 'home',
                });
                bumpMood(-0.05);
              }
              break;
            }
            default:
              // groundout / flyout / lineout / popout / sac-* / fielders-choice
              if (fieldingSide(mirror) === 'home') {
                bumpArousal(0.04);
              } else {
                bumpMood(-0.02);
              }
              break;
          }
          break;
        }
        case 'sub': {
          // Pitching change is a small lull — attention drops a bit.
          attention = Math.max(0.25, attention - 0.05);
          break;
        }
        case 'inningEnd': {
          mirror.lastInningRuns = ev.runs;
          mirror.basesFirst = false;
          mirror.basesSecond = false;
          mirror.basesThird = false;
          mirror.outs = 0;
          mirror.balls = 0;
          mirror.strikes = 0;
          mirror.twoStrikeArmed = false;

          // If runs scored this half, applause tail sized to the burst —
          // but ONLY when the home team scored. The home crowd doesn't
          // applaud visitors crossing the plate; if anything they sigh.
          if (ev.runs > 0) {
            const battingHomeThisHalf = ev.halfInning === 'bottom';
            if (battingHomeThisHalf) {
              pulses.push({
                kind: 'applause-tail',
                intensity: clamp01(0.45 + ev.runs * 0.12),
                durationMs: clamp01(0.45 + ev.runs * 0.12) * 5500 + 1500,
                side: 'home',
              });
            } else {
              pulses.push({
                kind: 'groan',
                intensity: clamp01(0.35 + ev.runs * 0.08),
                durationMs: 1500 + ev.runs * 250,
                side: 'home',
              });
            }
          }

          // Flip half / inning.
          if (ev.halfInning === 'top') {
            mirror.half = 'bottom';
          } else {
            mirror.inning += 1;
            mirror.half = 'top';
          }
          // Inning gap: attention dips, energy floats slightly downward.
          attention = Math.max(0.2, attention - 0.15);
          break;
        }
        case 'gameEnd': {
          phase = 'final';
          if (!mirror.finalEmitted) {
            mirror.finalEmitted = true;
            const homeWon = ev.finalRuns.home >= ev.finalRuns.away;
            if (homeWon) {
              pulses.push({
                kind: 'roar',
                intensity: 1.0,
                durationMs: 12000,
                side: 'home',
              });
              pulses.push({
                kind: 'applause-tail',
                intensity: 0.95,
                durationMs: 9000,
                side: 'home',
              });
              bumpArousal(1.0);
              bumpMood(0.5);
            } else {
              pulses.push({
                kind: 'groan',
                intensity: 0.7,
                durationMs: 4000,
                side: 'home',
              });
              bumpMood(-0.4);
            }
          }
          break;
        }
      }
    }

    // Re-evaluate baseline energy and attention from the post-events mirror.
    const lev = computeLeverage(mirrorAsLeverage(mirror));
    const scoreDiff = Math.abs(mirror.scoreHome - mirror.scoreAway);
    const baseE = baselineEnergy(lev, scoreDiff);
    const baseAttention = clamp01(0.35 + lev * 0.5 - (scoreDiff >= 6 ? 0.2 : 0));
    // Energy creeps toward its baseline at a slow half-life.
    const eDecay = halfLifeDecay(ENERGY_HALF_LIFE_S, dtSeconds);
    energy = clamp01(baseE + (energy - baseE) * eDecay);
    // Attention is faster moving than energy.
    const aDecay = halfLifeDecay(2.5, dtSeconds);
    attention = clamp01(baseAttention + (attention - baseAttention) * aDecay);

    // Mood drifts toward zero very slowly (forgive and forget).
    const moodTowardZero = mood * halfLifeDecay(45, dtSeconds);
    mood = clamp11(moodTowardZero);

    state = {
      energy,
      arousal,
      mood,
      attention,
      homeBatting,
      batterId,
      batterIsStar,
      phase,
    };

    return { state, pulses };

    function bumpAttention(d: number): void {
      attention = clamp01(attention + d);
    }
  };

  return {
    step,
    reset,
    snapshot: () => state,
  };
};

const mirrorAsLeverage = (m: InternalGameMirror) => ({
  inning: m.inning,
  half: m.half,
  outs: m.outs,
  scoreHome: m.scoreHome,
  scoreAway: m.scoreAway,
  bases: { first: m.basesFirst, second: m.basesSecond, third: m.basesThird },
});
