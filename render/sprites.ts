import type { ScenePlayer, SceneState } from './types.js';
import { worldToScreen, type FieldTransform } from './transform.js';

// Phase 2 sprites: simple two-color blocks. Phase 4 brings real pixel art
// (8x8 or 16x16 sheets per role) but the call shape stays the same.

const SPRITE_RADIUS_FT = 6.0;

const drawPlayer = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  p: ScenePlayer,
): void => {
  const s = worldToScreen(p.position, t);
  const r = Math.max(3, t.pixelsPerFoot * SPRITE_RADIUS_FT);

  // Body (primary color).
  ctx.fillStyle = p.primaryColor;
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fill();
  // Cap / accent dot (secondary color).
  ctx.fillStyle = p.secondaryColor;
  ctx.beginPath();
  ctx.arc(s.x, s.y - r * 0.5, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
  // Outline for readability against grass.
  ctx.strokeStyle = '#0c0d10';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.stroke();

  // Role-specific accent.
  if (p.role === 'batter') {
    // Bat: short line off the trailing shoulder.
    ctx.strokeStyle = '#d6b78a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const dir = p.position.x < 0 ? -1 : 1;
    ctx.moveTo(s.x + dir * r, s.y - r * 0.3);
    ctx.lineTo(s.x + dir * (r + 10), s.y - r * 1.6);
    ctx.stroke();
  } else if (p.role === 'pitcher') {
    // Pitcher gets a tiny rubber line behind them.
    ctx.fillStyle = '#f3eedb';
    ctx.fillRect(s.x - r * 0.6, s.y + r * 0.7, r * 1.2, 1.5);
  }
};

// 2.5D ball: shadow stays anchored to the field at the ground projection
// while the ball itself lifts off and grows slightly with altitude. Gives
// pop-ups a vertical "feel" without leaving the birds-eye perspective.
const VERTICAL_SCALE = 0.8; // canvas-px-of-lift per foot-of-altitude, before pixelsPerFoot
const SHADOW_FALLOFF_FT = 80; // shadow fades and shrinks as ball climbs

const drawBall = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  scene: SceneState,
): void => {
  if (!scene.ball.visible) return;
  const ground = worldToScreen(scene.ball.position, t);
  const heightPx = scene.ball.heightFt * t.pixelsPerFoot * VERTICAL_SCALE;
  const baseRadius = 3;
  const ballRadius = baseRadius + scene.ball.heightFt * 0.04;

  // Shadow on the field — only while in flight (otherwise it overlaps the ball).
  if (scene.ball.inFlight && scene.ball.heightFt > 0.1) {
    const heightFactor = Math.min(1, scene.ball.heightFt / SHADOW_FALLOFF_FT);
    const shadowAlpha = 0.55 * (1 - heightFactor * 0.55);
    const shadowR = baseRadius * (1.1 - heightFactor * 0.4);
    ctx.fillStyle = `rgba(8, 12, 16, ${shadowAlpha})`;
    ctx.beginPath();
    ctx.ellipse(ground.x, ground.y, shadowR + 1, shadowR * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ball — raised by altitude.
  const bx = ground.x;
  const by = ground.y - heightPx;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(bx, by, ballRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Faint stitch dot for visual interest at higher altitudes.
  if (scene.ball.heightFt > 12) {
    ctx.fillStyle = '#c4262e';
    ctx.beginPath();
    ctx.arc(bx + ballRadius * 0.2, by - ballRadius * 0.2, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
};

export const drawScene = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  scene: SceneState,
): void => {
  // Order: catcher (back), fielders, pitcher, runners (above bases), batter, ball (top).
  if (scene.catcher) drawPlayer(ctx, t, scene.catcher);
  for (const f of scene.fielders) drawPlayer(ctx, t, f);
  if (scene.pitcher) drawPlayer(ctx, t, scene.pitcher);
  for (const r of scene.runners) drawPlayer(ctx, t, r);
  if (scene.batter) drawPlayer(ctx, t, scene.batter);
  drawBall(ctx, t, scene);
};
