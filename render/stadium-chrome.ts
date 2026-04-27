import { worldToScreen, type FieldTransform } from './transform.js';
import {
  HOME_PLATE,
  BATTER_BOX_LEFT,
  BATTER_BOX_RIGHT,
  BATTER_BOX_WIDTH_FT,
  BATTER_BOX_DEPTH_FT,
  ON_DECK_LEFT,
  ON_DECK_RIGHT,
  ON_DECK_RADIUS_FT,
  DUGOUT_LEFT_RECT,
  DUGOUT_RIGHT_RECT,
  BACKSTOP,
} from './field-geometry.js';
import type { WallPath } from './wall.js';

// Park chrome that the previous renderer left out: warning track, foul
// poles, dugouts, batter's boxes, on-deck circles, backstop fence. All
// purely visual and stateless.

const CHALK = '#f3eedb';
const CHALK_DIM = '#bdb89c';
const WARNING_TRACK = '#a17048';
const WARNING_TRACK_EDGE = '#7a4f30';
const DUGOUT_FILL = '#171a1f';
const DUGOUT_ROOF = '#2d3138';
const DUGOUT_BENCH = '#3a3025';
const BACKSTOP_LINE = '#4a4f57';
const FOUL_POLE = '#f1c40f';
const FLAG_RED = '#c0392b';

// Warning track — tan band ~10 ft inside the wall. Drawn as a thick stroke
// along the wall path. Color is per-stadium-aware via the optional override.
export interface WarningTrackOptions {
  readonly trackWidthFt?: number;
  readonly fill?: string;
}
export const drawWarningTrack = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  wall: WallPath,
  opts: WarningTrackOptions = {},
): void => {
  const widthFt = opts.trackWidthFt ?? 10;
  const widthPx = Math.max(3, widthFt * t.pixelsPerFoot);
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = opts.fill ?? WARNING_TRACK;
  ctx.lineWidth = widthPx;
  ctx.beginPath();
  for (let i = 0; i < wall.samples.length; i++) {
    const p = worldToScreen(wall.samples[i]!.point, t);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  // Inner edge — a 1px darker line gives the track a hard 8-bit boundary
  // against the outfield grass.
  ctx.strokeStyle = WARNING_TRACK_EDGE;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
};

// Foul poles — thin yellow vertical pixel-lines at the ±45° wall corners,
// extending well above the wall so they overlay the sky. A small pennant
// flutters at the top, deterministically driven by simTime so frames are
// reproducible. Wind quirks can pump the amplitude via `flagAmplitude`.
export interface FoulPoleOptions {
  readonly heightFt?: number;
  readonly flagAmplitude?: number; // 0..1
  readonly simTime?: number;
}
export const drawFoulPoles = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  wall: WallPath,
  opts: FoulPoleOptions = {},
): void => {
  const heightFt = opts.heightFt ?? 80;
  const heightPx = heightFt * t.pixelsPerFoot;
  const amp = opts.flagAmplitude ?? 0.4;
  const time = opts.simTime ?? 0;

  const drawPole = (basePoint: { x: number; y: number }, sign: -1 | 1): void => {
    const base = worldToScreen(basePoint, t);
    const top = { x: base.x, y: base.y - heightPx };
    // Pole.
    ctx.strokeStyle = FOUL_POLE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    // Crossbar / screen — a small arrow pointing into fair territory so the
    // ump can read fair vs. foul.
    ctx.beginPath();
    ctx.moveTo(top.x, top.y + 4);
    ctx.lineTo(top.x + sign * -8, top.y + 14);
    ctx.lineTo(top.x, top.y + 24);
    ctx.stroke();
    // Pennant flag — a 6×3 px triangle that ripples horizontally based on
    // simTime + amp. The pole identity (sign) shifts the phase so left and
    // right poles never beat in unison.
    const phase = time * 0.18 + (sign === -1 ? 0 : Math.PI / 2);
    const ripple = Math.sin(phase) * amp * 4;
    const flagX = top.x + sign * 3;
    const flagY = top.y - 1;
    ctx.fillStyle = FLAG_RED;
    ctx.beginPath();
    ctx.moveTo(flagX, flagY);
    ctx.lineTo(flagX + sign * 7 + ripple, flagY + 1);
    ctx.lineTo(flagX + sign * 6 + ripple, flagY + 4);
    ctx.lineTo(flagX, flagY + 4);
    ctx.closePath();
    ctx.fill();
  };

  drawPole(wall.leftFoul, -1);
  drawPole(wall.rightFoul, +1);
};

// Batter's box — chalk rectangles flanking home plate. Both boxes are
// always drawn regardless of which side is up, matching real ballparks.
export const drawBatterBoxes = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
): void => {
  const w = BATTER_BOX_WIDTH_FT * t.pixelsPerFoot;
  const h = BATTER_BOX_DEPTH_FT * t.pixelsPerFoot;
  ctx.save();
  ctx.strokeStyle = CHALK;
  ctx.lineWidth = 1;
  for (const center of [BATTER_BOX_LEFT, BATTER_BOX_RIGHT]) {
    const c = worldToScreen(center, t);
    ctx.strokeRect(c.x - w / 2, c.y - h / 2, w, h);
  }
  // Catcher's box behind home plate — half-rectangle that extends back
  // toward the umpire.
  const home = worldToScreen(HOME_PLATE, t);
  const catcherW = (BATTER_BOX_WIDTH_FT * 2 + 1.5) * t.pixelsPerFoot;
  const catcherH = 4 * t.pixelsPerFoot;
  ctx.strokeRect(home.x - catcherW / 2, home.y, catcherW, catcherH);
  ctx.restore();
};

// On-deck circles — chalked rings near the dugouts. Tiny but read clearly
// at screensaver scale because they sit alone in the foul-territory grass.
export const drawOnDeckCircles = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
): void => {
  const r = ON_DECK_RADIUS_FT * t.pixelsPerFoot;
  ctx.save();
  ctx.strokeStyle = CHALK_DIM;
  ctx.lineWidth = 1;
  for (const center of [ON_DECK_LEFT, ON_DECK_RIGHT]) {
    const c = worldToScreen(center, t);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
};

// Dugouts — recessed dark rectangles flush with the backstop, with a hint
// of bench inside and a roof lip for depth. The team color trim gives each
// park a faint per-team identity even when the rest of the chrome reads as
// generic.
export interface DugoutOptions {
  readonly trimColor?: string; // typically the home-team primary
}
export const drawDugouts = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  opts: DugoutOptions = {},
): void => {
  const trim = opts.trimColor ?? '#7d848d';
  for (const rect of [DUGOUT_LEFT_RECT, DUGOUT_RIGHT_RECT]) {
    const center = worldToScreen({ x: rect.cx, y: rect.cy }, t);
    const w = rect.widthFt * t.pixelsPerFoot;
    const h = rect.depthFt * t.pixelsPerFoot;
    const x = center.x - w / 2;
    const y = center.y - h / 2;
    // Recessed body.
    ctx.fillStyle = DUGOUT_FILL;
    ctx.fillRect(x, y, w, h);
    // Roof lip — 2px overhang that catches the eye.
    ctx.fillStyle = DUGOUT_ROOF;
    ctx.fillRect(x - 1, y - 2, w + 2, 2);
    // Bench — a 1-2px tan stripe along the back wall.
    const benchY = y + Math.round(h * 0.55);
    const benchH = Math.max(1, Math.round(h * 0.18));
    ctx.fillStyle = DUGOUT_BENCH;
    ctx.fillRect(x + 3, benchY, w - 6, benchH);
    // Trim — 1px team-colored line along the top of the roof.
    ctx.fillStyle = trim;
    ctx.fillRect(x - 1, y - 3, w + 2, 1);
  }
};

// Backstop fence behind home plate. A single thin arc — the ump's screen.
// Sits between the catcher and the dugout band so it reads clearly without
// hiding the chalk of the catcher's box.
export const drawBackstop = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
): void => {
  const center = worldToScreen({ x: 0, y: BACKSTOP.centerY }, t);
  const r = BACKSTOP.radiusFt * t.pixelsPerFoot;
  ctx.save();
  ctx.strokeStyle = BACKSTOP_LINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  // Arc opens upward toward the field — sweep from RF-side to LF-side.
  ctx.arc(center.x, center.y, r, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  ctx.restore();
};

// Wall — drawn from the precomputed path. Two strokes: a wider concrete
// band first, then the dark wall outline on top. This is the same trick
// the legacy field.ts used; keeping it preserves the silhouette.
export interface WallDrawOptions {
  readonly bandColor?: string;
  readonly outlineColor?: string;
  readonly bandWidthPx?: number;
  readonly outlineWidthPx?: number;
}
export const drawOutfieldWall = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  wall: WallPath,
  opts: WallDrawOptions = {},
): void => {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Concrete back-of-stands band.
  ctx.strokeStyle = opts.bandColor ?? '#5a626c';
  ctx.lineWidth = opts.bandWidthPx ?? 12;
  ctx.beginPath();
  for (let i = 0; i < wall.samples.length; i++) {
    const p = worldToScreen(wall.samples[i]!.point, t);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  // Wall outline.
  ctx.strokeStyle = opts.outlineColor ?? '#1a1a1a';
  ctx.lineWidth = opts.outlineWidthPx ?? 3;
  ctx.stroke();
  ctx.restore();
};
