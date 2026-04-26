import type { SceneState } from './types.js';
import { worldToScreen, type FieldTransform } from './transform.js';
import {
  HOME_PLATE,
  FIRST_BASE,
  SECOND_BASE,
  THIRD_BASE,
  PITCHERS_MOUND,
  FIELDER_HOME_POSITIONS,
} from './field-geometry.js';

// RENDER_DEBUG overlay — toggled by ?debug=1 in the URL or by setting
// globalThis.__RENDER_DEBUG__ = true in the console. Off by default. Saves
// hours when the next person needs to ask "where exactly is fielder X
// supposed to be" or "is the ball where the BallPath says it is."

export const isDebugEnabled = (): boolean => {
  const g = globalThis as { __RENDER_DEBUG__?: boolean; location?: { search?: string } };
  if (g.__RENDER_DEBUG__) return true;
  const search = g.location?.search ?? '';
  return /[?&]debug=1\b/.test(search);
};

export const drawDebugOverlay = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  scene: SceneState,
): void => {
  ctx.save();
  ctx.font = '10px ui-monospace, monospace';
  ctx.lineWidth = 1;

  // Field landmarks.
  drawCross(ctx, t, HOME_PLATE, 'home', '#ff5555');
  drawCross(ctx, t, FIRST_BASE, '1B', '#ffaa44');
  drawCross(ctx, t, SECOND_BASE, '2B', '#ffaa44');
  drawCross(ctx, t, THIRD_BASE, '3B', '#ffaa44');
  drawCross(ctx, t, PITCHERS_MOUND, 'P', '#88ddff');

  // Fielder home positions.
  for (const [pos, point] of Object.entries(FIELDER_HOME_POSITIONS)) {
    drawCross(ctx, t, point, pos, '#88ff88');
  }

  // Sprite bounding circles for everyone currently on screen.
  const drawBound = (px: number, py: number) => {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    ctx.arc(px, py, 9, 0, Math.PI * 2);
    ctx.stroke();
  };
  if (scene.pitcher) {
    const s = worldToScreen(scene.pitcher.position, t);
    drawBound(s.x, s.y);
  }
  if (scene.catcher) {
    const s = worldToScreen(scene.catcher.position, t);
    drawBound(s.x, s.y);
  }
  if (scene.batter) {
    const s = worldToScreen(scene.batter.position, t);
    drawBound(s.x, s.y);
  }
  for (const f of scene.fielders) {
    const s = worldToScreen(f.position, t);
    drawBound(s.x, s.y);
  }
  for (const r of scene.runners) {
    const s = worldToScreen(r.position, t);
    drawBound(s.x, s.y);
  }

  // Ball cross.
  if (scene.ball.visible) {
    const s = worldToScreen(scene.ball.position, t);
    ctx.strokeStyle = '#ffff00';
    ctx.beginPath();
    ctx.moveTo(s.x - 6, s.y);
    ctx.lineTo(s.x + 6, s.y);
    ctx.moveTo(s.x, s.y - 6);
    ctx.lineTo(s.x, s.y + 6);
    ctx.stroke();
  }

  // Bottom-left readout.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.fillRect(8, t.canvasHeight - 16, 240, 14);
  ctx.fillStyle = '#aaffaa';
  ctx.fillText(
    `simT=${scene.simTime.toFixed(1)}  inning=${scene.inning} ${scene.half}  ball@(${scene.ball.position.x.toFixed(0)}, ${scene.ball.position.y.toFixed(0)}) z=${scene.ball.heightFt.toFixed(1)}`,
    14,
    t.canvasHeight - 6,
  );

  ctx.restore();
};

const drawCross = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  point: { x: number; y: number },
  label: string,
  color: string,
): void => {
  const s = worldToScreen(point, t);
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(s.x - 4, s.y);
  ctx.lineTo(s.x + 4, s.y);
  ctx.moveTo(s.x, s.y - 4);
  ctx.lineTo(s.x, s.y + 4);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(label, s.x + 6, s.y - 2);
};
