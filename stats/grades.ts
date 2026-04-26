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

// What each rating actually does — meaning + implication. Shown inline on the
// attribute row so the player card reads as a scouting report instead of a
// wall of stars.
export const RATING_EFFECTS: Record<keyof PlayerRatings, string> = {
  contact: 'Bat-to-ball skill. A higher rating means fewer swing-and-misses and slightly better pitches to drive.',
  power: 'Raw strength behind contact. Lifts exit velocity, which feeds extra-base hits and home runs.',
  discipline: 'Plate awareness on the swing decision. Cuts chase rate and pads the walk total.',
  pitchRecognition: 'Reads spin and shape early. Specifically improves judgment on breaking balls and off-speed.',
  bunting: 'Bat control on a sacrifice or drag attempt. Improves the chance the bunt actually advances the runner.',
  platoonBias: 'How exposed this hitter is when matched up with a same-handed pitcher.',
  clutch: 'Late-and-close performance gear (7th inning or later, score within 2 runs).',
  velocity: 'Pure arm speed. Raises fastball MPH and forces hitters into weaker contact.',
  control: 'Strike-throwing. Higher control means more pitches in the zone and fewer free passes.',
  command: 'Where in the zone the pitch ends up. Keeps the ball off the heart of the plate, suppressing barrels.',
  stamina: 'Stuff-holding ability deep into outings. Late innings still play with bite instead of meatballs.',
  breakingBall: 'Sharpness on sliders and curves. Pitchers with a strong breaker also throw it more often.',
  changeup: 'Deception on off-speed. Pitchers with a strong changeup also lean on it more often.',
  holdRunners: 'Pickoffs, slide-step, and a quick-to-the-plate delivery that discourages stolen-base attempts.',
  groundballTendency: 'Pitcher worm-killer rating. Tilts batted balls toward grounders and away from the seats.',
  range: 'Defensive zone coverage. Determines how many balls hit nearby get reached in the first place.',
  glove: 'Cleanliness once the ball is in reach. Lowers error rate on plays the fielder gets to.',
  armStrength: 'Throw velocity. Stretches the range of plays that can be made at distant bases.',
  armAccuracy: 'Throw precision. Cuts down throwing errors and runners taking an extra base on a wild relay.',
  transferSpeed: 'Glove-to-throw quickness on the pivot. Mainly matters for double-play turns.',
  framing: 'Catcher receiving art. Steals borderline calls into strikes for the pitcher.',
  blocking: 'Catcher body control on pitches in the dirt. Prevents passed balls and wild pitches.',
  popTime: 'Catcher pop on a steal attempt — glove to second base. Higher = more runners thrown out.',
  speed: 'Foot speed on the basepaths. Beats out infield hits and stretches singles into doubles.',
  stealing: 'Stolen-base technique — jump, lead, slide. Independent of raw speed.',
  baserunningIQ: 'Reading hits and outs in real time. Takes the extra base when it is there, holds when it is not.',
  composure: 'Pitcher counter to clutch hitters. Resists the batter\'s late-game lift in close games.',
  consistency: 'Game-to-game variance. High consistency = boring but reliable; low = streaky.',
  durability: 'Injury resistance and recovery speed. Affects how much of the season is actually available.',
  workEthic: 'Aging curve modifier. Higher means a later peak and a gentler decline phase.',
  coachability: 'In-season drift toward the team\'s development archetype. Slowly reshapes a young player\'s profile.',
};

// Quantified impact — what one rating point (or +10) actually moves in the sim.
// Numbers come from the live formulas in `/sim/game.ts`. Stats whose effect is
// scaffolded but not yet wired into Phase 1 sim are labeled as such so the
// scouting report stays honest.
export const RATING_QUANTIFIED: Record<keyof PlayerRatings, string> = {
  contact: '+10 above 50 ≈ +3% contact rate on swings, with a small drop in foul rate and a touch of extra lift.',
  power: '+10 above 50 ≈ +1.2 mph exit velocity, +1.8% HR rate, +0.9% double rate.',
  discipline: '+10 above 50 ≈ −6% chase rate on out-of-zone pitches and −4% swing rate in the zone (waits for the pitch).',
  pitchRecognition: '+10 above 50 ≈ −5% chase rate, applied only on breaking balls and off-speed.',
  bunting: 'Bunt-success curve not wired into Phase 1 sim yet — flavor only for now.',
  platoonBias: '+10 above 50 ≈ −0.5 effective contact points vs. a same-handed pitcher (≈ −0.05% single rate).',
  clutch: 'Active in 7th+ inning, score within 2. +10 over the pitcher\'s composure ≈ +0.6% HR, +0.3% single, +0.3% double.',
  velocity: '+10 above 50 ≈ +0.8 mph on the fastball, −0.8% contact allowed, and a small HR-rate suppression.',
  control: '+10 above 50 ≈ +4% of pitches inside the strike zone.',
  command: '+10 above 50 ≈ −0.8% HR rate allowed.',
  stamina: '+10 above 50 ≈ −0.8 mph off opposing exit velocity. Pitch-count limits stay fixed (95 normal, 70 if shaky).',
  breakingBall: '+10 above 50 ≈ −1% contact rate on breaking pitches. Above 65, the pitcher\'s breaking-ball usage rises.',
  changeup: '+10 above 50 ≈ −1% contact rate on off-speed pitches. Above 65, the pitcher\'s off-speed usage rises.',
  holdRunners: 'SB suppression not wired into Phase 1 sim yet — steals land in a later phase.',
  groundballTendency: '+10 above 50 ≈ +2% groundball share among outs and −0.6% HR rate allowed.',
  range: 'Defensive plus-minus not wired into Phase 1 sim yet — every fielder reaches the same set of balls today.',
  glove: 'Error model not wired into Phase 1 sim yet — fielders never boot the ball today.',
  armStrength: 'Outfield throw model not wired into Phase 1 sim yet — runners always take what the outcome allows.',
  armAccuracy: 'Throwing-error model not wired into Phase 1 sim yet.',
  transferSpeed: 'Double-play turn timing not wired into Phase 1 sim yet — DP rate is hardcoded.',
  framing: 'Catcher framing not wired into Phase 1 sim yet — strike-zone calls are pitcher-only.',
  blocking: 'Wild-pitch / passed-ball model not wired into Phase 1 sim yet.',
  popTime: 'Caught-stealing model not wired into Phase 1 sim yet.',
  speed: '+10 above 50 ≈ +0.3% triple rate. Infield-hit and extra-base modeling lands in a later phase.',
  stealing: 'Stolen-base model not wired into Phase 1 sim yet.',
  baserunningIQ: 'Extra-base decisioning not wired into Phase 1 sim yet — runners follow fixed advance rules.',
  composure: 'Active in 7th+ inning, score within 2. +10 over the batter\'s clutch ≈ −0.6% HR, −0.3% single, −0.3% double allowed.',
  consistency: 'Game-to-game variance dial not wired into Phase 1 sim yet — every game uses the same rating.',
  durability: 'Injury model lands in a later phase — every player is fully available in Phase 1.',
  workEthic: 'Aging curve and offseason development land in Phase 6 — no in-game effect today.',
  coachability: 'In-season development drift lands in Phase 6 — no in-game effect today.',
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
