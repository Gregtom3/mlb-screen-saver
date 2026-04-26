import type { SceneState } from './types.js';
import type { FieldTransform } from './transform.js';

// On-field overlays: score strip across the top, count + outs in a corner,
// last-play caption at the bottom. Designed to be diegetic-light per the
// CLAUDE.md tone notes — thin, monospace, never shouty.

const HUD_BG = 'rgba(11, 13, 16, 0.78)';
const HUD_TEXT = '#e6e6e6';
const HUD_DIM = '#9aa0a6';
const HUD_ACCENT = '#f1c40f';

const FONT_STACK = '14px "JetBrains Mono", "SFMono-Regular", Menlo, monospace';
const FONT_BOLD = 'bold 16px "JetBrains Mono", "SFMono-Regular", Menlo, monospace';
const FONT_SMALL = '11px "JetBrains Mono", "SFMono-Regular", Menlo, monospace';

const halfArrow = (half: 'top' | 'bottom') => (half === 'top' ? '▲' : '▼');

export const drawHud = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  scene: SceneState,
): void => {
  drawScoreStrip(ctx, t, scene);
  drawCountAndOuts(ctx, t, scene);
  drawBaseDiagram(ctx, t, scene);
  if (scene.lastPlay) drawLastPlay(ctx, t, scene);
  if (scene.phase === 'final') drawFinalBanner(ctx, t, scene);
};

const drawScoreStrip = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  scene: SceneState,
): void => {
  const w = t.canvasWidth;
  const h = 36;
  ctx.fillStyle = HUD_BG;
  ctx.fillRect(0, 0, w, h);

  ctx.font = FONT_BOLD;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = HUD_TEXT;
  ctx.fillText(scene.awayAbbr, 16, h / 2);
  ctx.fillText(String(scene.scoreAway), 64, h / 2);
  ctx.fillStyle = HUD_DIM;
  ctx.fillText('@', 100, h / 2);
  ctx.fillStyle = HUD_TEXT;
  ctx.fillText(scene.homeAbbr, 124, h / 2);
  ctx.fillText(String(scene.scoreHome), 172, h / 2);

  // Inning indicator.
  ctx.textAlign = 'center';
  ctx.fillStyle = HUD_ACCENT;
  ctx.fillText(`${halfArrow(scene.half)} ${scene.inning}`, w / 2, h / 2);

  // Stadium label, right side.
  ctx.font = FONT_SMALL;
  ctx.textAlign = 'right';
  ctx.fillStyle = HUD_DIM;
  ctx.fillText(scene.stadiumName, w - 16, h / 2);
};

const drawCountAndOuts = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  scene: SceneState,
): void => {
  // Bottom-left panel.
  const padding = 12;
  const panelW = 132;
  const panelH = 56;
  const x = padding;
  const y = t.canvasHeight - panelH - padding;
  ctx.fillStyle = HUD_BG;
  ctx.fillRect(x, y, panelW, panelH);

  ctx.font = FONT_STACK;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = HUD_DIM;
  ctx.fillText('count', x + 10, y + 16);
  ctx.fillStyle = HUD_TEXT;
  ctx.font = FONT_BOLD;
  ctx.fillText(`${scene.balls}-${scene.strikes}`, x + 60, y + 16);

  ctx.font = FONT_STACK;
  ctx.fillStyle = HUD_DIM;
  ctx.fillText('outs', x + 10, y + 40);
  // Outs as filled/empty dots.
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < scene.outs ? HUD_ACCENT : '#3a3f47';
    ctx.beginPath();
    ctx.arc(x + 60 + i * 16, y + 40, 5, 0, Math.PI * 2);
    ctx.fill();
  }
};

const drawBaseDiagram = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  scene: SceneState,
): void => {
  // Bottom-right panel.
  const padding = 12;
  const panelW = 92;
  const panelH = 56;
  const x = t.canvasWidth - panelW - padding;
  const y = t.canvasHeight - panelH - padding;
  ctx.fillStyle = HUD_BG;
  ctx.fillRect(x, y, panelW, panelH);

  // Mini-diamond: 1B (right), 2B (top), 3B (left).
  const cx = x + panelW / 2;
  const cy = y + panelH / 2 + 4;
  const armLen = 16;
  drawMiniBase(ctx, cx + armLen, cy, scene.basesOccupied.first);
  drawMiniBase(ctx, cx, cy - armLen, scene.basesOccupied.second);
  drawMiniBase(ctx, cx - armLen, cy, scene.basesOccupied.third);

  ctx.font = FONT_SMALL;
  ctx.fillStyle = HUD_DIM;
  ctx.textAlign = 'left';
  ctx.fillText('bases', x + 10, y + 12);
};

const drawMiniBase = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  occupied: boolean,
): void => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = occupied ? HUD_ACCENT : '#5a6068';
  ctx.fillRect(-6, -6, 12, 12);
  ctx.strokeStyle = HUD_TEXT;
  ctx.lineWidth = 1;
  ctx.strokeRect(-6, -6, 12, 12);
  ctx.restore();
};

const drawLastPlay = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  scene: SceneState,
): void => {
  if (!scene.lastPlay) return;
  // Tucked under the score strip so it never sits over the field.
  const panelH = 24;
  const panelW = Math.min(420, t.canvasWidth - 200);
  const x = (t.canvasWidth - panelW) / 2;
  const y = 36 + 6;
  ctx.fillStyle = HUD_BG;
  ctx.fillRect(x, y, panelW, panelH);
  ctx.font = FONT_SMALL;
  ctx.fillStyle = HUD_TEXT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(scene.lastPlay, x + panelW / 2, y + panelH / 2);
};

const drawFinalBanner = (
  ctx: CanvasRenderingContext2D,
  t: FieldTransform,
  scene: SceneState,
): void => {
  const w = 240;
  const h = 64;
  const x = (t.canvasWidth - w) / 2;
  const y = (t.canvasHeight - h) / 2;
  ctx.fillStyle = HUD_BG;
  ctx.fillRect(x, y, w, h);
  ctx.font = FONT_BOLD;
  ctx.fillStyle = HUD_ACCENT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('FINAL', x + w / 2, y + 22);
  ctx.font = FONT_STACK;
  ctx.fillStyle = HUD_TEXT;
  ctx.fillText(
    `${scene.awayAbbr} ${scene.scoreAway}    ${scene.homeAbbr} ${scene.scoreHome}`,
    x + w / 2,
    y + 46,
  );
};
