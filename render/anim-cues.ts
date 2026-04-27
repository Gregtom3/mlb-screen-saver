import type { AnimAudioCue } from '../audio/dispatcher.js';
import type { SimEvent } from '../sim/types.js';

// =========================================================================
// Animation-driven audio cues.
//
// The renderer choreographs flourishes that don't have a corresponding
// SimEvent — around-the-horn throws after a strikeout with empty bases, and
// 0–2 casual ball-flips during the inning-end walk-off window. Audio for
// these effects needs to fire at the moments the ball arrives in a glove
// or rolls off a fielder's hand, but the dispatcher only sees real
// SimEvents from the sim core.
//
// `computeAnimAudioCues` walks the event log once and produces a sorted
// list of (t, kind) cues using the same deterministic hashes the scene
// reducer uses for the visual choreography. The render loop tracks a
// cursor through this list and dispatches crossed cues each frame, exactly
// the way it does for SimEvents — but on a parallel stream.
//
// This file is the single source of truth for the cue schedule; scene.ts
// owns the matching ball-position logic. Both must agree on timing or the
// sound will desync from the visuals.
// =========================================================================

const PITCH_FLIGHT_TICKS = 12;
const HORN_CATCHER_HOLD = 5;
const HORN_THROW_TICKS = 7;
const HORN_LOB_TICKS = 9;
const HORN_BAG_HOLD = 3;

const TOSS_FLIGHT_TICKS = 8;
const TOSS_HOLD_TICKS = 4;
const INNING_WALK_OFF_TICKS = 18;

// Same FNV-1a-flavored hash used in scene.ts. Duplicated so this module can
// stay independent of the scene reducer (scene.ts is large and importing
// from it would create a cycle).
const hash01 = (s: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 0x1_0000_0000;
};

interface AtBatContext {
  // Most recent third-strike pitch's t, or null if the at-bat didn't end on
  // a strikeout.
  thirdStrikePitchT: number | null;
  // Bases occupancy at atBatEnd time.
  basesEmpty: boolean;
  // The half-inning the at-bat happened in — informs whether the next event
  // is the inningEnd (3rd out) or another pitch.
  isThirdOut: boolean;
  // The atBatEnd's t.
  atBatEndT: number;
}

const buildHornCues = (pitchT: number): AnimAudioCue[] => {
  const cues: AnimAudioCue[] = [];
  let cursor = pitchT + PITCH_FLIGHT_TICKS + HORN_CATCHER_HOLD;
  // Throw 1: catcher → 3B
  cues.push({ t: cursor, kind: 'toss-throw' });
  cursor += HORN_THROW_TICKS;
  cues.push({ t: cursor, kind: 'toss-glove' });
  cursor += HORN_BAG_HOLD;
  // Throw 2: 3B → SS
  cues.push({ t: cursor, kind: 'toss-throw' });
  cursor += HORN_THROW_TICKS;
  cues.push({ t: cursor, kind: 'toss-glove' });
  cursor += HORN_BAG_HOLD;
  // Throw 3: SS → 2B
  cues.push({ t: cursor, kind: 'toss-throw' });
  cursor += HORN_THROW_TICKS;
  cues.push({ t: cursor, kind: 'toss-glove' });
  cursor += HORN_BAG_HOLD;
  // Throw 4: 2B → P (lob, mitt-style soft pop)
  cues.push({ t: cursor, kind: 'toss-throw' });
  cursor += HORN_LOB_TICKS;
  cues.push({ t: cursor, kind: 'toss-mitt' });
  return cues;
};

const buildInningEndTossCues = (
  thirdOutT: number,
  inningEndT: number,
): AnimAudioCue[] => {
  const r = hash01(`tossN|${thirdOutT}`);
  const numTosses = r < 0.3 ? 0 : r < 0.75 ? 1 : 2;
  const cues: AnimAudioCue[] = [];
  if (numTosses === 0) return cues;
  // Schedule starts at the start of the walk-off window.
  let cursor = inningEndT - INNING_WALK_OFF_TICKS;
  const totalNeeded = numTosses * (TOSS_FLIGHT_TICKS + TOSS_HOLD_TICKS) + 4;
  if (cursor + totalNeeded > inningEndT) return cues;
  for (let i = 0; i < numTosses; i++) {
    cursor += TOSS_HOLD_TICKS;
    cues.push({ t: cursor, kind: 'toss-throw' });
    cursor += TOSS_FLIGHT_TICKS;
    cues.push({ t: cursor, kind: 'toss-glove' });
  }
  return cues;
};

export const computeAnimAudioCues = (
  events: readonly SimEvent[],
): readonly AnimAudioCue[] => {
  const cues: AnimAudioCue[] = [];
  // Walk events building up state, generating cues at each atBatEnd /
  // inningEnd that warrants animation.
  let bases = { first: false, second: false, third: false };
  let outsThisHalf = 0;
  let lastThirdStrikePitchT: number | null = null;
  // Most recent atBatEnd t when it was a 3rd-out strikeout, retained until
  // the corresponding inningEnd so we can decide between around-the-horn
  // and inning-end tossing in one place.
  let lastThirdOutT: number | null = null;
  let strikes = 0;

  for (const ev of events) {
    switch (ev.kind) {
      case 'pitch': {
        const r = ev.pitch.result;
        if (r === 'called-strike' || r === 'swinging-strike') strikes += 1;
        else if (r === 'foul' && strikes < 2) strikes += 1;
        // ball / in-play / HBP / foul-tip-caught: strike count unchanged.
        if (
          (r === 'called-strike' || r === 'swinging-strike') &&
          strikes === 3
        ) {
          lastThirdStrikePitchT = ev.t;
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
        }
        break;
      }
      case 'atBatEnd': {
        const isStrikeout =
          ev.outcome === 'strikeout-swinging' ||
          ev.outcome === 'strikeout-looking';
        const empty = !bases.first && !bases.second && !bases.third;
        const outsAdded = outsAddedFor(ev.outcome);
        outsThisHalf += outsAdded;
        // Around-the-horn: K + empty bases + 50% chance.
        if (
          isStrikeout &&
          empty &&
          lastThirdStrikePitchT !== null &&
          hash01(`horn|${ev.t}`) < 0.5
        ) {
          cues.push(...buildHornCues(lastThirdStrikePitchT));
        }
        if (outsThisHalf >= 3) {
          lastThirdOutT = ev.t;
        }
        // Reset strike count for the next batter.
        strikes = 0;
        break;
      }
      case 'inningEnd': {
        if (lastThirdOutT !== null) {
          cues.push(...buildInningEndTossCues(lastThirdOutT, ev.t));
        }
        bases = { first: false, second: false, third: false };
        outsThisHalf = 0;
        lastThirdStrikePitchT = null;
        lastThirdOutT = null;
        strikes = 0;
        break;
      }
    }
  }
  // Sort by t so the loop can walk the list with a single cursor.
  cues.sort((a, b) => a.t - b.t);
  return cues;
};

// Mirror of scene.ts's outsAddedFor — duplicated so this module stays
// independent. If they ever drift the cue stream will misalign with the
// inning-end toss schedule.
const outsAddedFor = (outcome: import('../sim/types.js').AtBatOutcome): number => {
  switch (outcome) {
    case 'strikeout-looking':
    case 'strikeout-swinging':
    case 'groundout':
    case 'flyout':
    case 'lineout':
    case 'popout':
    case 'sac-fly':
    case 'sac-bunt':
      return 1;
    case 'double-play':
      return 2;
    case 'triple-play':
      return 3;
    case 'fielders-choice':
      return 1;
    default:
      return 0;
  }
};
