import type { StadiumQuirk } from '../world/types.js';
import { worldToScreen, type FieldTransform } from './transform.js';
import { wallPointAt, type WallPath } from './wall.js';

// Visual quirk registry — mirrors /sim/stadium-effects.ts:adjustmentsFor()
// in shape. Dispatches on quirk.kind; each entry returns a draw function
// that consumes (ctx, transform, wall, simTime). Sim impact stays handled
// by the sim-side registry; this file is pure cosmetics.

export type CosmeticPhase = 'beyond-wall' | 'on-wall' | 'in-field';

interface CosmeticArgs {
  readonly ctx: CanvasRenderingContext2D;
  readonly transform: FieldTransform;
  readonly wall: WallPath;
  readonly simTime: number;
  readonly phase: CosmeticPhase;
}

// --- Helpers ---------------------------------------------------------------

const sideToAngle = (side: 'left' | 'right' | 'center'): number =>
  side === 'left' ? -38 : side === 'right' ? 38 : 0;

const drawSign = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  text: string,
): void => {
  ctx.save();
  const w = text.length * 7 + 6;
  const h = 11;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
  ctx.fillStyle = '#f3eedb';
  ctx.font = 'bold 9px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + 1);
  ctx.restore();
};

// --- Per-quirk draw functions ---------------------------------------------

const drawIvy = (
  side: 'left' | 'right' | 'center',
  args: CosmeticArgs,
): void => {
  if (args.phase !== 'on-wall') return;
  const { ctx, transform, wall } = args;
  const angle = sideToAngle(side);
  const center = wallPointAt(wall, angle);
  const screen = worldToScreen(center, transform);
  // Ivy band — 1-px green-noise rectangle straddling ~30° of wall length.
  const widthPx = Math.max(40, transform.pixelsPerFoot * 80);
  const heightPx = Math.max(8, transform.pixelsPerFoot * 12);
  const x0 = screen.x - widthPx / 2;
  const y0 = screen.y - heightPx;
  const greens = ['#1f4f1f', '#2c662c', '#3f7f3a', '#173f17'];
  for (let dy = 0; dy < heightPx; dy++) {
    for (let dx = 0; dx < widthPx; dx += 1) {
      const seed = (dx * 73856093) ^ (dy * 19349663);
      const idx = (seed >>> 0) % greens.length;
      // Speckle the top edge a little so it doesn't read as a pure block.
      if (dy < 3 && (seed & 3) === 0) continue;
      ctx.fillStyle = greens[idx]!;
      ctx.fillRect(x0 + dx, y0 + dy, 1, 1);
    }
  }
};

const drawHillCf = (args: CosmeticArgs): void => {
  if (args.phase !== 'in-field') return;
  const { ctx, transform, wall } = args;
  const center = wallPointAt(wall, 0);
  const screen = worldToScreen(center, transform);
  // Pixel-terraced slope — three darker green bands stepping up to the wall.
  const stepPx = Math.max(2, Math.floor(transform.pixelsPerFoot * 4));
  const widthPx = Math.max(40, transform.pixelsPerFoot * 70);
  const greens = ['#3a5e2f', '#2c4f24', '#1f3e1c'];
  for (let i = 0; i < greens.length; i++) {
    const x0 = screen.x - widthPx / 2;
    const y0 = screen.y + stepPx * i;
    ctx.fillStyle = greens[i]!;
    ctx.fillRect(x0 + i * 2, y0, widthPx - i * 4, stepPx + 1);
  }
};

const drawPondBeyondRf = (args: CosmeticArgs): void => {
  if (args.phase !== 'beyond-wall') return;
  const { ctx, transform, wall, simTime } = args;
  const anchor = wallPointAt(wall, 38);
  const screen = worldToScreen(anchor, transform);
  // Pond — blue rounded rectangle beyond the RF wall, with a couple of
  // pixel ripples that drift sideways with simTime.
  const w = Math.max(28, transform.pixelsPerFoot * 50);
  const h = Math.max(14, transform.pixelsPerFoot * 22);
  const x0 = screen.x + 6;
  const y0 = screen.y - h - 4;
  ctx.fillStyle = '#1a4d7d';
  ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = '#2c6fa6';
  ctx.fillRect(x0 + 2, y0 + 2, w - 4, 1);
  ctx.fillStyle = '#88c2e6';
  const ripple = Math.floor(simTime * 0.5) % w;
  ctx.fillRect(x0 + ripple, y0 + Math.floor(h * 0.5), 4, 1);
  ctx.fillRect(x0 + ((ripple + 7) % w), y0 + Math.floor(h * 0.7), 3, 1);
  // Rowboat — a tiny brown sliver near the front edge.
  ctx.fillStyle = '#7a4f30';
  ctx.fillRect(x0 + Math.floor(w * 0.6), y0 + h - 3, 6, 2);
  ctx.fillStyle = '#3a2418';
  ctx.fillRect(x0 + Math.floor(w * 0.6) + 2, y0 + h - 4, 1, 2);
};

const drawClockTower = (args: CosmeticArgs): void => {
  if (args.phase !== 'beyond-wall') return;
  const { ctx, transform, wall, simTime } = args;
  const anchor = wallPointAt(wall, 0);
  const screen = worldToScreen(anchor, transform);
  const towerH = Math.max(34, transform.pixelsPerFoot * 70);
  const towerW = Math.max(8, transform.pixelsPerFoot * 14);
  const x0 = screen.x - towerW / 2;
  const y0 = screen.y - towerH;
  ctx.fillStyle = '#7a6b54';
  ctx.fillRect(x0, y0, towerW, towerH);
  ctx.fillStyle = '#5a4d3a';
  ctx.fillRect(x0, y0, towerW, 2);
  // Clock face.
  const faceR = Math.max(4, towerW * 0.45);
  const cx = screen.x;
  const cy = y0 + towerH * 0.25;
  ctx.fillStyle = '#f0e6c8';
  ctx.beginPath();
  ctx.arc(cx, cy, faceR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Hand — rotates slowly with simTime so the screensaver clock reads as alive.
  const angle = (simTime * 0.04) % (Math.PI * 2);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(angle) * (faceR - 1), cy + Math.sin(angle) * (faceR - 1));
  ctx.stroke();
  // Roof.
  ctx.fillStyle = '#a93226';
  ctx.beginPath();
  ctx.moveTo(x0 - 1, y0);
  ctx.lineTo(x0 + towerW + 1, y0);
  ctx.lineTo(x0 + towerW / 2, y0 - 6);
  ctx.closePath();
  ctx.fill();
};

const drawShortPorchSign = (
  side: 'left' | 'right',
  distanceFt: number,
  args: CosmeticArgs,
): void => {
  if (args.phase !== 'on-wall') return;
  const { ctx, transform, wall } = args;
  const angle = side === 'left' ? -42 : 42;
  const point = wallPointAt(wall, angle);
  const screen = worldToScreen(point, transform);
  drawSign(ctx, screen.x, screen.y - 6, String(Math.round(distanceFt)));
};

const drawDeepCenterSign = (
  distanceFt: number,
  args: CosmeticArgs,
): void => {
  if (args.phase !== 'on-wall') return;
  const { ctx, transform, wall } = args;
  const point = wallPointAt(wall, 0);
  const screen = worldToScreen(point, transform);
  drawSign(ctx, screen.x, screen.y - 6, String(Math.round(distanceFt)));
};

const drawMountainSilhouette = (args: CosmeticArgs): void => {
  if (args.phase !== 'beyond-wall') return;
  const { ctx, transform, wall } = args;
  const center = wallPointAt(wall, 0);
  const screenCenter = worldToScreen(center, transform);
  const baseY = screenCenter.y - 4;
  const peakHeights = [10, 22, 14, 30, 18, 24, 12];
  const span = Math.max(120, transform.pixelsPerFoot * 220);
  const startX = screenCenter.x - span / 2;
  const stepX = span / (peakHeights.length - 1);
  ctx.fillStyle = '#3a3548';
  ctx.beginPath();
  ctx.moveTo(startX, baseY);
  for (let i = 0; i < peakHeights.length; i++) {
    const x = startX + i * stepX;
    const y = baseY - peakHeights[i]! * (transform.pixelsPerFoot * 0.6);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(startX + span, baseY);
  ctx.closePath();
  ctx.fill();
  // Snowcaps — a couple of light pixels on the tallest peaks.
  ctx.fillStyle = '#dde3eb';
  for (let i = 0; i < peakHeights.length; i++) {
    if (peakHeights[i]! < 22) continue;
    const x = startX + i * stepX;
    const y = baseY - peakHeights[i]! * (transform.pixelsPerFoot * 0.6);
    ctx.fillRect(x - 1, y, 3, 1);
  }
};

const drawMascotStatue = (
  side: 'left' | 'right' | 'center',
  args: CosmeticArgs,
): void => {
  if (args.phase !== 'beyond-wall') return;
  const { ctx, transform, wall } = args;
  const angle = sideToAngle(side);
  const point = wallPointAt(wall, angle);
  const screen = worldToScreen(point, transform);
  const cx = screen.x;
  const cy = screen.y - 12;
  // Pedestal.
  ctx.fillStyle = '#5a626c';
  ctx.fillRect(cx - 4, cy + 4, 8, 4);
  // Statue body.
  ctx.fillStyle = '#a8a8a8';
  ctx.fillRect(cx - 3, cy - 4, 6, 8);
  // Head.
  ctx.fillRect(cx - 2, cy - 8, 4, 4);
  // Highlight.
  ctx.fillStyle = '#cdcab1';
  ctx.fillRect(cx - 3, cy - 4, 1, 8);
};

// Loose-paper drift for wind-tunnel — only when phase=in-field. Pure
// cosmetic; doesn't actually move anything sim-side.
const drawWindPapers = (
  direction: 'in' | 'out' | 'cross',
  args: CosmeticArgs,
): void => {
  if (args.phase !== 'in-field') return;
  if (direction === 'in') return; // a calm "in" wind reads as still
  const { ctx, transform, simTime } = args;
  // Three small cream pixels drifting with simTime. Speed scales with the
  // type — 'out' is steady; 'cross' is faster.
  const speed = direction === 'cross' ? 1.6 : 0.9;
  const driftPx = (simTime * speed * transform.pixelsPerFoot * 0.5) % transform.canvasWidth;
  const sweep = transform.canvasWidth + 60;
  const baseY = transform.homePlateScreen.y - transform.pixelsPerFoot * 70;
  ctx.fillStyle = '#f0e6c8';
  for (let i = 0; i < 3; i++) {
    const x = ((driftPx + i * 220) % sweep) - 30;
    const y = baseY + ((i * 19) % 24);
    ctx.fillRect(Math.round(x), Math.round(y), 2, 1);
  }
};

// --- Public dispatch ------------------------------------------------------

export const drawStadiumCosmetic = (
  quirk: StadiumQuirk | undefined,
  args: CosmeticArgs,
): void => {
  if (!quirk) return;
  switch (quirk.kind) {
    case 'short-porch':
      drawShortPorchSign(quirk.side, quirk.distanceFt, args);
      return;
    case 'deep-center':
      drawDeepCenterSign(quirk.distanceFt, args);
      return;
    case 'ivy-wall':
      drawIvy(quirk.side, args);
      return;
    case 'hill-cf':
      drawHillCf(args);
      return;
    case 'pond-beyond-rf':
      drawPondBeyondRf(args);
      return;
    case 'clock-tower-in-play':
      drawClockTower(args);
      return;
    case 'altitude-thin-air':
      drawMountainSilhouette(args);
      return;
    case 'mascot-statue':
      drawMascotStatue(quirk.side, args);
      return;
    case 'wind-tunnel':
      drawWindPapers(quirk.direction, args);
      return;
  }
};

// Foul-pole flag amplitude bump for wind-tunnel quirks. Used by field.ts to
// pump up the ripple when wind is in play.
export const flagAmplitudeFor = (quirk: StadiumQuirk | undefined): number => {
  if (!quirk) return 0.3;
  if (quirk.kind === 'wind-tunnel') {
    return quirk.direction === 'in' ? 0.2 : quirk.direction === 'out' ? 0.7 : 0.9;
  }
  return 0.4;
};
