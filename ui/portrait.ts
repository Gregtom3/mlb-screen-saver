import type { Coach, Player, Team } from '../world/types.js';

// Procedural 64×64 pixel-art portrait — drawn into a returned <canvas> so
// the caller can drop it inline. Uses the subject's id as the seed so the
// same person always renders identically.

// Structural team-color hint. The portrait only needs the three team color
// hexes; callers in the canvas HUD don't always have a full Team handy
// (HudExtras carries colors-only records), so accept either a real Team or
// just the colors slot.
type PortraitTeamHint =
  | Team
  | { readonly colors: { readonly primary: string; readonly secondary: string; readonly accent: string } }
  | undefined;

const fnv = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

class Mulberry {
  constructor(private state: number) {}
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  pick<T>(a: readonly T[]): T { return a[Math.floor(this.next() * a.length)]!; }
}

const SKIN_TONES = ['#f1c08e', '#d99169', '#a86c45', '#7d4a2a', '#5a3320'];
const HAIR_COLORS = ['#1c1410', '#3a2515', '#6a4225', '#a67238', '#d6b06a', '#7e7676', '#444'];

// Core drawing routine shared by players and coaches. `id` seeds the PRNG;
// `smile` drives the mouth expression.
const drawPortraitCore = (
  ctx: CanvasRenderingContext2D,
  id: string,
  smile: boolean,
  team: PortraitTeamHint,
  size: number,
): void => {
  const rng = new Mulberry(fnv(id));
  const skin = rng.pick(SKIN_TONES);
  const hair = rng.pick(HAIR_COLORS);
  const cap = team?.colors.primary ?? '#345';
  const capBill = team?.colors.secondary ?? '#234';
  const eye = '#1a1410';
  const mouth = '#5b3220';
  const bg = team?.colors.accent ?? '#202830';

  // Sprite is a 16×16 design upscaled by `size/16`. The whole face is just
  // hand-laid rectangles — easier than fighting a paint pipeline.
  const px = Math.floor(size / 16);
  const fill = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x * px, y * px, w * px, h * px);
  };

  // Background.
  fill(0, 0, 16, 16, bg);
  // Shoulders / jersey.
  fill(2, 13, 12, 3, cap);
  // Neck.
  fill(7, 12, 2, 1, skin);
  // Head shape (rounded square).
  fill(4, 4, 8, 8, skin);
  fill(5, 3, 6, 1, skin);
  fill(5, 12, 6, 1, skin);
  fill(3, 5, 1, 6, skin);
  fill(12, 5, 1, 6, skin);

  // Hair: random style — bald (rare), short, mop, mohawk-ish.
  const style = rng.next();
  if (style < 0.08) {
    // bald — skip
  } else if (style < 0.5) {
    // short
    fill(4, 3, 8, 2, hair);
    fill(3, 4, 1, 2, hair);
    fill(12, 4, 1, 2, hair);
  } else if (style < 0.8) {
    // mop
    fill(3, 3, 10, 3, hair);
    fill(3, 6, 1, 1, hair);
    fill(12, 6, 1, 1, hair);
  } else {
    // mohawk-ish
    fill(7, 2, 2, 4, hair);
  }

  // Cap (overlays hair). 70% of time.
  if (rng.next() < 0.7) {
    fill(3, 2, 10, 2, cap);
    fill(3, 4, 8, 1, cap);
    fill(2, 4, 1, 2, capBill);
    fill(11, 4, 1, 1, capBill);
  }

  // Eyes — two pixels.
  fill(6, 7, 1, 1, eye);
  fill(9, 7, 1, 1, eye);
  // Mouth — tilted up when smiling.
  if (smile) {
    fill(7, 10, 2, 1, mouth);
    fill(6, 9, 1, 1, mouth);
    fill(9, 9, 1, 1, mouth);
  } else {
    fill(7, 10, 2, 1, mouth);
  }

  // Pixel-perfect look — disable smoothing for any later upscale.
  ctx.imageSmoothingEnabled = false;
};

export const drawPortrait = (
  ctx: CanvasRenderingContext2D,
  player: Player,
  team: PortraitTeamHint,
  size = 64,
): void => drawPortraitCore(ctx, player.id, player.ratings.clutch > 65, team, size);

export const portraitDataUrl = (player: Player, team: PortraitTeamHint, size = 64): string => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  drawPortrait(canvas.getContext('2d')!, player, team, size);
  return canvas.toDataURL();
};

// Coach portraits use the role's most meaningful rating for the smile:
// a manager who motivates well smiles, an aggressive 3B coach smiles, etc.
const coachSmile = (coach: Coach): boolean => {
  switch (coach.role) {
    case 'head':         return coach.ratings.morale > 65;
    case 'third-base':   return coach.ratings.aggression > 65;
    case 'first-base':   return coach.ratings.baserunningCoaching > 65;
  }
};

export const drawCoachPortrait = (
  ctx: CanvasRenderingContext2D,
  coach: Coach,
  team: PortraitTeamHint,
  size = 64,
): void => drawPortraitCore(ctx, coach.id, coachSmile(coach), team, size);

export const coachPortraitDataUrl = (coach: Coach, team: PortraitTeamHint, size = 64): string => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  drawCoachPortrait(canvas.getContext('2d')!, coach, team, size);
  return canvas.toDataURL();
};
