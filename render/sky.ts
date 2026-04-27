import type { FieldTransform } from './transform.js';
import { worldToScreen } from './transform.js';
import type { WallPath } from './wall.js';
import { TOP_HUD_HEIGHT } from './hud.js';

// Background atmosphere. Replaces the flat black canvas fill that left a
// "void" above the stadium bowl. Three stacked layers that all sit BEHIND
// the bowl + field:
//
//   1) sky gradient        — vertical fade from deep night to a horizon glow
//   2) distant skyline     — pixel city silhouette across the canvas
//   3) light towers        — four steel masts + soft glow halos at the bowl
//
// All purely cosmetic; deterministic for a given (transform, simTime) so the
// renderer-is-a-pure-function-of-(events, tick) contract holds.

const SKY_TOP = '#05080f';
const SKY_MID = '#0f1a2c';
const SKY_HORIZON = '#1d2840';
// A faint sodium-lamp bloom that bleeds up from the stadium rim. Only used
// near the horizon band so the night sky still reads as night.
const SKY_GLOW = '#3a2a1f';

const SKYLINE_FILL = '#0a1018';
const SKYLINE_WINDOWS = '#d9b86a';

const TOWER_POLE = '#3a3f47';
const TOWER_LAMP = '#fff6c8';
const TOWER_GLOW = 'rgba(255, 246, 200, 0.10)';
const MOON_FILL = '#e8e6d8';
const MOON_DARK = '#aaa89a';

interface SkyArgs {
  readonly ctx: CanvasRenderingContext2D;
  readonly transform: FieldTransform;
  readonly wall: WallPath;
  readonly simTime: number;
  readonly skyTint?: string; // optional per-stadium horizon tint
}

// Draw the night-sky gradient above the bowl. Bottom of the gradient lands
// roughly where the deepest part of the wall sits, so the bowl can occlude
// the warmer horizon band without any seam.
const drawGradient = (args: SkyArgs): void => {
  const { ctx, transform } = args;
  const { canvasWidth, canvasHeight } = transform;
  // Gradient runs from the very top of the canvas (above the HUD bug) down
  // to the horizon line — the latter approximated as the deepest wall point
  // on screen. Below the horizon the bowl + field paint everything anyway,
  // but extending the gradient that far means the canvas never shows raw
  // black if the bowl ever falls short.
  const horizonY = horizonScreenY(args);
  const grad = ctx.createLinearGradient(0, 0, 0, horizonY);
  grad.addColorStop(0.0, SKY_TOP);
  grad.addColorStop(0.55, SKY_MID);
  grad.addColorStop(0.92, SKY_HORIZON);
  grad.addColorStop(1.0, args.skyTint ?? SKY_GLOW);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
};

// Where on screen the horizon ought to sit. Approximated as the average
// screen-Y of the deepest wall samples — i.e. just above where the outfield
// bowl crowns. Used by the sky gradient and the skyline anchor.
const horizonScreenY = (args: SkyArgs): number => {
  const { transform, wall } = args;
  // Sample the centerfield-ish portion of the wall path.
  const mid = wall.samples[Math.floor(wall.samples.length / 2)]!;
  const screen = worldToScreen(mid.point, transform);
  // Lift a touch so the gradient terminates above the wall rather than
  // exactly on it; the bowl rises into this band and obscures the seam.
  return Math.max(TOP_HUD_HEIGHT + 24, screen.y - transform.pixelsPerFoot * 18);
};

// Pixel-art skyline. A sequence of rectangular buildings of varying height
// drawn as a single dark band along the horizon, with a sparse window
// pattern. Deterministic — same canvas size + same transform = same skyline.
const drawSkyline = (args: SkyArgs): void => {
  const { ctx, transform } = args;
  const horizon = horizonScreenY(args);
  const baseY = horizon + Math.round(transform.pixelsPerFoot * 4);
  // Building widths and heights, tiled across the canvas. The pattern is
  // hand-tuned to look like a city skyline rather than random noise.
  const SHAPES: ReadonlyArray<readonly [number, number]> = [
    // [widthPx, heightPx]
    [22, 28],
    [14, 18],
    [10, 36],
    [18, 22],
    [12, 14],
    [26, 32],
    [10, 24],
    [16, 40],
    [12, 20],
    [20, 26],
    [8, 16],
    [14, 30],
    [22, 24],
  ];
  ctx.fillStyle = SKYLINE_FILL;
  let x = -8;
  let i = 0;
  while (x < transform.canvasWidth + 8) {
    const [w, h] = SHAPES[i % SHAPES.length]!;
    ctx.fillRect(x, baseY - h, w, h);
    // Sparse lit windows — every few buildings get a couple of yellow pixels.
    if ((i & 1) === 0) {
      ctx.fillStyle = SKYLINE_WINDOWS;
      const cols = Math.max(1, Math.floor(w / 6));
      const rows = Math.max(1, Math.floor(h / 6));
      for (let cx = 0; cx < cols; cx++) {
        for (let cy = 0; cy < rows; cy++) {
          // Hash the building index + cell index for deterministic windows.
          const lit = ((i * 73856093) ^ (cx * 19349663) ^ (cy * 83492791)) & 7;
          if (lit !== 0) continue;
          ctx.fillRect(x + 2 + cx * 6, baseY - h + 2 + cy * 6, 2, 2);
        }
      }
      ctx.fillStyle = SKYLINE_FILL;
    }
    x += w + 1;
    i++;
  }
};

// Moon — a single small disc drifting slowly in the upper-left. Pure flavor
// for the screensaver vibe. Uses simTime for a very gentle horizontal drift
// so a long idle session doesn't render an identical frame for hours.
const drawMoon = (args: SkyArgs): void => {
  const { ctx, transform, simTime } = args;
  const driftPx = (simTime * 0.05) % (transform.canvasWidth + 80) - 40;
  const cx = Math.round((transform.canvasWidth * 0.18) + driftPx * 0.04);
  const cy = TOP_HUD_HEIGHT + 24;
  const r = 6;
  ctx.fillStyle = MOON_FILL;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // Crescent shadow — a slightly offset darker circle eats the right edge.
  ctx.fillStyle = MOON_DARK;
  ctx.beginPath();
  ctx.arc(cx + 3, cy - 1, r - 1, 0, Math.PI * 2);
  ctx.fill();
};

// Light towers — four masts anchored around the bowl rim. Each tower has a
// pole, a lamp head with a soft glow, and a gentle pulse driven by simTime.
// Towers are drawn here (in the back layer) so the bowl + roof occlude
// their bases; only the lamp heads and glow are visible above the rim.
export interface LightTowerAnchor {
  readonly screen: { x: number; y: number }; // base of the tower
  readonly heightPx: number;
}

const drawLightTowers = (
  args: SkyArgs,
  towers: readonly LightTowerAnchor[],
): void => {
  const { ctx, simTime } = args;
  for (let i = 0; i < towers.length; i++) {
    const t = towers[i]!;
    const top = { x: t.screen.x, y: t.screen.y - t.heightPx };
    // Glow halo — drawn first so the lamp head sits inside it. Stagger phase
    // per tower so they don't all pulse together.
    const phase = simTime * 0.04 + i * 0.7;
    const pulse = 0.75 + Math.sin(phase) * 0.15;
    ctx.save();
    ctx.fillStyle = TOWER_GLOW;
    ctx.beginPath();
    ctx.arc(top.x, top.y, 18 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(top.x, top.y, 12 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Pole — narrow, slight taper toward the top.
    ctx.fillStyle = TOWER_POLE;
    ctx.fillRect(top.x - 1, top.y, 2, t.heightPx);
    ctx.fillRect(top.x - 2, top.y + 6, 4, 1); // crossbeam #1
    ctx.fillRect(top.x - 2, top.y + Math.round(t.heightPx * 0.55), 4, 1); // crossbeam #2
    // Lamp rack — a small horizontal bar of bulbs at the top.
    ctx.fillStyle = '#1a1d22';
    ctx.fillRect(top.x - 5, top.y - 4, 10, 4);
    // Bulbs — glow-bright pixels.
    ctx.fillStyle = TOWER_LAMP;
    ctx.fillRect(top.x - 4, top.y - 3, 2, 2);
    ctx.fillRect(top.x - 1, top.y - 3, 2, 2);
    ctx.fillRect(top.x + 2, top.y - 3, 2, 2);
  }
};

// Public entrypoint. Draws sky → moon → skyline → towers in that order so
// the towers' glow can spill onto the city behind them. Towers are computed
// from the bowl-corner anchors passed by the caller (computed once in
// stadium-bowl.ts), keeping this module geometry-agnostic.
export const drawSky = (
  args: SkyArgs,
  towers: readonly LightTowerAnchor[] = [],
): void => {
  drawGradient(args);
  drawSkyline(args);
  drawMoon(args);
  drawLightTowers(args, towers);
};
