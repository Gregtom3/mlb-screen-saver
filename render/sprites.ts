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

const drawBall = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  scene: SceneState,
): void => {
  if (!scene.ball.visible) return;
  const s = worldToScreen(scene.ball.position, t);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
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
