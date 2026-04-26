import type { Player, PlayerRatings, Position } from '../world/types.js';

// Phase 5.5 part 2 — scout-grade conversion + role-gated attribute panel.
//
// Internal ratings are 1..99 (50 = neutral). We display them as 1..5 stars
// with half-star precision, plus a tooltip naming the sim hook. The scale:
//
//   1.0 ★    rating ≤ 24    "well below"
//   1.5 ★    rating 25-34   "below average"
//   2.0 ★    rating 35-44   "fringe"
//   2.5 ★    rating 45-54   "average"
//   3.0 ★    rating 55-64   "solid"
//   3.5 ★    rating 65-74   "above average"
//   4.0 ★    rating 75-84   "plus"
//   4.5 ★    rating 85-94   "plus-plus"
//   5.0 ★    rating 95-99   "elite"
//
// Half-star steps keep the grade legible without forcing the back-end into a
// lossy 1..5 storage.

export interface StarGrade {
  readonly stars: number; // 0.5..5.0 in 0.5 increments
  readonly label: string;
  readonly bucket: 'red' | 'yellow' | 'green' | 'gold';
}

export const starRating = (rating: number): StarGrade => {
  const r = Math.max(1, Math.min(99, Math.round(rating)));
  let stars = 1.0;
  let label = 'well below';
  if (r >= 95) { stars = 5.0; label = 'elite'; }
  else if (r >= 85) { stars = 4.5; label = 'plus-plus'; }
  else if (r >= 75) { stars = 4.0; label = 'plus'; }
  else if (r >= 65) { stars = 3.5; label = 'above avg'; }
  else if (r >= 55) { stars = 3.0; label = 'solid'; }
  else if (r >= 45) { stars = 2.5; label = 'average'; }
  else if (r >= 35) { stars = 2.0; label = 'fringe'; }
  else if (r >= 25) { stars = 1.5; label = 'below avg'; }
  else { stars = 1.0; label = 'well below'; }
  const bucket: StarGrade['bucket'] =
    r >= 75 ? 'gold' : r >= 60 ? 'green' : r >= 40 ? 'yellow' : 'red';
  return { stars, label, bucket };
};

// Render the star fraction as a unicode string. ★ = full, ⯪ = half, ☆ = empty.
// (We use ⯪ U+2BEA "STAR WITH LEFT HALF BLACK"; renders consistently in
// monospace fonts with the surrounding ★/☆.)
export const starsToGlyphs = (stars: number): string => {
  const full = Math.floor(stars);
  const half = stars - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return '★'.repeat(full) + '⯪'.repeat(half) + '☆'.repeat(empty);
};

// What each rating actually does, surfaced as a tooltip in the attribute panel.
export const RATING_EFFECTS: Record<keyof PlayerRatings, string> = {
  contact: 'Lowers swing-and-miss rate.',
  power: 'Raises exit velocity → home run + extra-base rate.',
  discipline: 'Reduces chase rate → more walks.',
  pitchRecognition: 'Smarter swing decisions on breaking balls and off-speed.',
  bunting: 'Sacrifice and drag-bunt success rate.',
  platoonBias: 'How much performance drops vs. same-handed pitching.',
  clutch: 'Performance lift in high-leverage states (7th+ inning, score within 2).',
  velocity: 'Fastball MPH; raises foul + whiff rate.',
  control: 'In-zone strike rate; lowers BB%.',
  command: 'Within-zone targeting; lowers HR allowed.',
  stamina: 'Endurance; pushes pitch-count limit before fatigue.',
  breakingBall: 'Slider/curve sharpness; raises whiff% on those pitches.',
  changeup: 'Off-speed deception; reduces opposite-hand penalty.',
  holdRunners: 'Suppresses opposing SB attempts and success rate.',
  groundballTendency: 'Tilts the GB/FB mix; lowers HR allowed.',
  range: 'Probability of reaching balls hit to your zone.',
  glove: 'Lowers error rate on plays you reach.',
  armStrength: 'Throw velocity; helps assists at distant bases.',
  armAccuracy: 'Throw precision; lowers throwing-error rate.',
  transferSpeed: 'Double-play turn time (infield only).',
  framing: 'Catcher-only: extra called strikes per game on borderline pitches.',
  blocking: 'Catcher-only: lowers passed-ball / wild-pitch rate.',
  popTime: 'Catcher-only: raises caught-stealing rate.',
  speed: 'Foot speed; legs out infield hits, takes extra base.',
  stealing: 'SB technique (jump + slide), independent of raw speed.',
  baserunningIQ: 'Taking the extra base; avoids running into outs.',
  composure: 'Performance under pressure; resists batter clutch.',
  consistency: 'Game-to-game variance — high = boring but reliable.',
  durability: 'Injury resistance + recovery speed.',
  workEthic: 'Aging curve modifier — later peak, slower decline.',
  coachability: 'In-season development drift toward team archetype.',
};

// Group attributes for the player panel, role-gated. Pitchers see the
// pitching panel; position players hide it; catchers get the catcher
// fielding extras; corner OF hide some IF-only attributes.
export interface AttributeGroup {
  readonly title: string;
  readonly keys: readonly (keyof PlayerRatings)[];
}

const HIT_KEYS: readonly (keyof PlayerRatings)[] = [
  'contact', 'power', 'discipline', 'pitchRecognition',
  'platoonBias', 'clutch', 'bunting',
];

const PITCH_KEYS: readonly (keyof PlayerRatings)[] = [
  'velocity', 'control', 'command', 'breakingBall', 'changeup',
  'stamina', 'groundballTendency', 'holdRunners',
];

const FIELD_KEYS_BASE: readonly (keyof PlayerRatings)[] = [
  'range', 'glove', 'armStrength', 'armAccuracy',
];

const FIELD_KEYS_IF: readonly (keyof PlayerRatings)[] = [
  ...FIELD_KEYS_BASE, 'transferSpeed',
];

const FIELD_KEYS_C: readonly (keyof PlayerRatings)[] = [
  ...FIELD_KEYS_BASE, 'framing', 'blocking', 'popTime',
];

const RUN_KEYS: readonly (keyof PlayerRatings)[] = [
  'speed', 'stealing', 'baserunningIQ',
];

const MENTAL_KEYS: readonly (keyof PlayerRatings)[] = [
  'composure', 'consistency', 'durability', 'workEthic', 'coachability',
];

const isInfield = (pos: Position): boolean =>
  pos === '1B' || pos === '2B' || pos === '3B' || pos === 'SS';

export const groupsForPlayer = (player: Player): AttributeGroup[] => {
  const pos = player.primaryPosition;
  const groups: AttributeGroup[] = [];
  if (pos === 'P') {
    groups.push({ title: 'Pitching', keys: PITCH_KEYS });
    groups.push({ title: 'Fielding', keys: FIELD_KEYS_BASE });
    groups.push({ title: 'Hitting (limited)', keys: HIT_KEYS });
  } else {
    groups.push({ title: 'Hitting', keys: HIT_KEYS });
    if (pos === 'C') {
      groups.push({ title: 'Catcher defense', keys: FIELD_KEYS_C });
    } else if (isInfield(pos)) {
      groups.push({ title: 'Infield defense', keys: FIELD_KEYS_IF });
    } else if (pos !== 'DH') {
      groups.push({ title: 'Outfield defense', keys: FIELD_KEYS_BASE });
    }
    groups.push({ title: 'Baserunning', keys: RUN_KEYS });
  }
  groups.push({ title: 'Mental', keys: MENTAL_KEYS });
  return groups;
};

// Aggregate "overall" grade — average of all relevant attributes for the
// player's role. Used in the leaderboards / roster sortable column.
export const overallGrade = (player: Player): number => {
  const groups = groupsForPlayer(player);
  const keys = new Set<keyof PlayerRatings>();
  for (const g of groups) for (const k of g.keys) keys.add(k);
  let sum = 0;
  let n = 0;
  for (const k of keys) { sum += player.ratings[k]; n += 1; }
  return n > 0 ? sum / n : 50;
};
