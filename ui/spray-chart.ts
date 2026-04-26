import type { HitLocation } from '../stats/types.js';

// Birds-eye field for the player view's spray chart. Lightweight — doesn't
// pull the full /render scene, just draws fair-territory + a dot per
// batted ball. Field coordinates: home plate at (0,0), +Y toward CF.

const COLORS: Record<HitLocation['outcome'], string> = {
  'home-run': '#f1c40f',
  'triple': '#f39c12',
  'double': '#e67e22',
  'single': '#3498db',
  'out': '#7f8c8d',
};

export const drawSprayChart = (
  ctx: CanvasRenderingContext2D,
  hits: readonly HitLocation[],
  width: number,
  height: number,
): void => {
  const padding = 12;
  const usableW = width - padding * 2;
  const usableH = height - padding * 2;
  // Field coordinates: x ∈ [-330, 330], y ∈ [0, 420].
  const xRange = 660;
  const yRange = 420;
  const sx = usableW / xRange;
  const sy = usableH / yRange;
  const scale = Math.min(sx, sy);
  const homeX = width / 2;
  const homeY = height - padding - 8;

  const toScreen = (fx: number, fy: number): { x: number; y: number } => ({
    x: homeX + fx * scale,
    y: homeY - fy * scale,
  });

  // Background.
  ctx.fillStyle = '#0e1a26';
  ctx.fillRect(0, 0, width, height);

  // Fair territory.
  ctx.fillStyle = '#3b6e3a';
  ctx.beginPath();
  const home = toScreen(0, 0);
  const lf = toScreen(-Math.SQRT1_2 * 335, Math.SQRT1_2 * 335);
  const cf = toScreen(0, 410);
  const rf = toScreen(Math.SQRT1_2 * 335, Math.SQRT1_2 * 335);
  ctx.moveTo(home.x, home.y);
  ctx.lineTo(lf.x, lf.y);
  ctx.quadraticCurveTo((lf.x + cf.x) / 2, (lf.y + cf.y) / 2 - 8, cf.x, cf.y);
  ctx.quadraticCurveTo((cf.x + rf.x) / 2, (cf.y + rf.y) / 2 - 8, rf.x, rf.y);
  ctx.closePath();
  ctx.fill();

  // Infield dirt — small fan.
  ctx.fillStyle = '#9a6a3d';
  ctx.beginPath();
  const if1 = toScreen(-95, 60);
  const if2 = toScreen(0, 155);
  const if3 = toScreen(95, 60);
  ctx.moveTo(home.x, home.y);
  ctx.lineTo(if1.x, if1.y);
  ctx.quadraticCurveTo((if1.x + if2.x) / 2, if2.y - 6, if2.x, if2.y);
  ctx.quadraticCurveTo((if2.x + if3.x) / 2, if2.y - 6, if3.x, if3.y);
  ctx.closePath();
  ctx.fill();

  // Foul lines.
  ctx.strokeStyle = '#f3eedb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(home.x, home.y);
  ctx.lineTo(lf.x, lf.y);
  ctx.moveTo(home.x, home.y);
  ctx.lineTo(rf.x, rf.y);
  ctx.stroke();

  // Wall outline.
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(lf.x, lf.y);
  ctx.quadraticCurveTo((lf.x + cf.x) / 2, (lf.y + cf.y) / 2 - 8, cf.x, cf.y);
  ctx.quadraticCurveTo((cf.x + rf.x) / 2, (cf.y + rf.y) / 2 - 8, rf.x, rf.y);
  ctx.stroke();

  // Hit dots — outs first so hits sit on top.
  const ordered = [...hits].sort((a, b) => {
    const rank = (o: HitLocation['outcome']) =>
      o === 'out' ? 0 : o === 'single' ? 1 : o === 'double' ? 2 : o === 'triple' ? 3 : 4;
    return rank(a.outcome) - rank(b.outcome);
  });

  for (const h of ordered) {
    const p = toScreen(h.x, h.y);
    if (p.x < 0 || p.x > width || p.y < 0 || p.y > height) continue;
    ctx.fillStyle = COLORS[h.outcome];
    ctx.beginPath();
    ctx.arc(p.x, p.y, h.outcome === 'home-run' ? 3 : 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Legend.
  ctx.font = '10px ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'middle';
  let lx = padding;
  const ly = padding + 4;
  for (const o of ['home-run', 'triple', 'double', 'single', 'out'] as const) {
    ctx.fillStyle = COLORS[o];
    ctx.beginPath();
    ctx.arc(lx + 4, ly, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9aa0a6';
    const label = o === 'home-run' ? 'HR' : o === 'triple' ? '3B' : o === 'double' ? '2B' : o === 'single' ? '1B' : 'OUT';
    ctx.fillText(label, lx + 10, ly);
    lx += 38;
  }
};
