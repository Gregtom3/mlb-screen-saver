import type { GrassPattern } from '../world/types.js';
import { worldToScreen, type FieldTransform } from './transform.js';
import { HOME_PLATE } from './field-geometry.js';
import type { WallPath } from './wall.js';

// Grass-pattern registry. The plain pattern (radial mow stripes from home
// plate) lives in field.ts since it shipped first; the four variants here
// override or augment that base. Each takes the active fair-territory
// clip as a precondition — the caller has already clipped the canvas to
// the wall polygon, so these can fill freely.

// Lighten/darken an #rrggbb hex by a delta (-1..1). Mirrors field.ts so
// patterns blend with the per-stadium grassShade.
const shiftHex = (hex: string, delta: number): string => {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const adj = (c: number) =>
    Math.max(0, Math.min(255, Math.round(c + delta * 255)));
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(adj(r))}${toHex(adj(g))}${toHex(adj(b))}`;
};

interface PatternArgs {
  readonly ctx: CanvasRenderingContext2D;
  readonly transform: FieldTransform;
  readonly grassShade: string;
  readonly wall: WallPath;
}

// Radial mow stripes from home plate — the same shape as the original
// "plain" pattern, just exported here so the dispatcher can pick it.
const drawRadialPattern = ({ ctx, transform, grassShade }: PatternArgs): void => {
  const home = worldToScreen(HOME_PLATE, transform);
  const dark = shiftHex(grassShade, -0.04);
  const light = shiftHex(grassShade, +0.04);
  const N = 14;
  const start = (-135 * Math.PI) / 180;
  const end = (-45 * Math.PI) / 180;
  const span = (end - start) / N;
  const r = Math.hypot(transform.canvasWidth, transform.canvasHeight);
  for (let i = 0; i < N; i++) {
    const a1 = start + i * span;
    const a2 = a1 + span;
    ctx.fillStyle = i % 2 === 0 ? dark : light;
    ctx.beginPath();
    ctx.moveTo(home.x, home.y);
    ctx.arc(home.x, home.y, r, a1, a2);
    ctx.closePath();
    ctx.fill();
  }
};

// Horizontal mowing — east-to-west stripes that read as a riding-mower
// path. Width tuned so each band is ~2 sprite-heights tall on screen.
const drawStripedPattern = ({ ctx, transform, grassShade }: PatternArgs): void => {
  const dark = shiftHex(grassShade, -0.05);
  const light = shiftHex(grassShade, +0.04);
  const stripeFt = 18;
  const stripePx = Math.max(6, stripeFt * transform.pixelsPerFoot);
  const home = worldToScreen(HOME_PLATE, transform);
  const top = 0;
  const bottom = home.y;
  let y = bottom;
  let i = 0;
  while (y > top) {
    ctx.fillStyle = i % 2 === 0 ? dark : light;
    ctx.fillRect(0, y - stripePx, transform.canvasWidth, stripePx);
    y -= stripePx;
    i += 1;
  }
};

// Checkerboard — both vertical and horizontal mowing produce a grid. Cell
// size matches stripedFt so the squares read clearly at screensaver scale.
const drawCheckerboardPattern = ({
  ctx,
  transform,
  grassShade,
}: PatternArgs): void => {
  const a = shiftHex(grassShade, -0.05);
  const b = shiftHex(grassShade, +0.04);
  const cellFt = 24;
  const cellPx = Math.max(8, cellFt * transform.pixelsPerFoot);
  const home = worldToScreen(HOME_PLATE, transform);
  const cols = Math.ceil(transform.canvasWidth / cellPx) + 1;
  const rows = Math.ceil(home.y / cellPx) + 1;
  const xOffset = (home.x - cols * cellPx) / 1; // anchor the grid at home plate
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols * 2; col++) {
      const x = xOffset + col * cellPx;
      const y = home.y - (row + 1) * cellPx;
      ctx.fillStyle = (row + col) % 2 === 0 ? a : b;
      ctx.fillRect(x, y, cellPx, cellPx);
    }
  }
};

// Concentric rings centered on home plate. The grounds crew runs the mower
// in arcs — each band alternates light/dark.
const drawRingedPattern = ({
  ctx,
  transform,
  grassShade,
  wall,
}: PatternArgs): void => {
  const dark = shiftHex(grassShade, -0.05);
  const light = shiftHex(grassShade, +0.04);
  const home = worldToScreen(HOME_PLATE, transform);
  const ringFt = 22;
  const maxR = (wall.maxDistanceFt + 30) * transform.pixelsPerFoot;
  const ringPx = ringFt * transform.pixelsPerFoot;
  let r = maxR;
  let i = 0;
  while (r > 0) {
    ctx.fillStyle = i % 2 === 0 ? dark : light;
    ctx.beginPath();
    ctx.arc(home.x, home.y, r, 0, Math.PI * 2);
    ctx.fill();
    r -= ringPx;
    i += 1;
  }
};

const PATTERN_REGISTRY: Record<GrassPattern, (args: PatternArgs) => void> = {
  plain: drawRadialPattern,
  radial: drawRadialPattern,
  striped: drawStripedPattern,
  checkerboard: drawCheckerboardPattern,
  ringed: drawRingedPattern,
};

export const drawGrassPattern = (
  pattern: GrassPattern,
  args: PatternArgs,
): void => {
  const draw = PATTERN_REGISTRY[pattern] ?? drawRadialPattern;
  draw(args);
};
