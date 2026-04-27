import { worldToScreen, type FieldTransform } from './transform.js';
import { HOME_PLATE } from './field-geometry.js';
import type { WallPath } from './wall.js';
import type { StadiumAtmosphere } from '../world/types.js';

// Crowd renderer. Two stand bands — the deep arc behind home plate and
// the bleachers outside the outfield wall. Each row is a colored band in
// the team's seat palette; fan pixels are scattered above at a density
// driven by inning + crowdDensityCurve. All stochastic decisions go
// through a deterministic hash of (simTime, seatIndex) so successive
// frames at the same simTime produce byte-identical output — the
// determinism contract from CLAUDE.md applies here too.

const SKIN_TONES = ['#c79475', '#a36a45', '#8a4f30', '#e2b89c'];
const HAT_HIGHLIGHT = 0.18; // % of fan pixels that flash a brighter hat color

// Cheap integer hash — used to roll deterministic per-seat decisions
// (skin tone, fan-vs-empty, jump phase). Same input → same output.
const hash32 = (a: number, b: number): number => {
  let x = (a * 0x9e3779b1) ^ (b * 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
};

const rand01 = (a: number, b: number): number => hash32(a, b) / 0x1_00_00_00_00;

// Resolve a 0..1 density given the curve type and the current inning.
export const densityForInning = (
  curve: StadiumAtmosphere['crowdDensityCurve'],
  inning: number,
): number => {
  const i = Math.max(1, Math.min(9, inning));
  switch (curve) {
    case 'home-heavy':
      return 0.78 - (i - 1) * 0.012; // 0.78 → 0.69
    case 'flat':
      return 0.6;
    case 'late-arrivers':
      return Math.min(0.85, 0.3 + (i - 1) * 0.135); // 0.30 → 0.85 by i=5
  }
};

interface CrowdArgs {
  readonly ctx: CanvasRenderingContext2D;
  readonly transform: FieldTransform;
  readonly atmosphere: StadiumAtmosphere;
  readonly wall: WallPath;
  readonly inning: number;
  readonly simTime: number;
  // Optional wave-burst — angle band where fans are jumping right now.
  readonly waveCenterAngleDeg?: number;
  readonly waveStrength?: number; // 0..1
}

// Draw a band of stands using the per-stadium seat palette. Each row is
// 1 px tall and gets ~20-30% fan pixels at full density. Lower density
// just thins out the speckle.
const drawStandsBand = (
  args: CrowdArgs & {
    readonly path: readonly { x: number; y: number }[];
    readonly outwardNormal: readonly { nx: number; ny: number }[];
    readonly depthPx: number;
    readonly bandSeed: number;
  },
): void => {
  const { ctx, atmosphere, simTime, path, outwardNormal, depthPx, bandSeed } =
    args;
  const palette = atmosphere.seatPalette.length
    ? atmosphere.seatPalette
    : ['#3a4048'];
  const density = densityForInning(atmosphere.crowdDensityCurve, args.inning);

  // Fill the empty bowl first — vertical stripes of palette color so the
  // section blocks read like a real ballpark.
  for (let i = 0; i < path.length; i++) {
    const base = path[i]!;
    const norm = outwardNormal[i]!;
    const colorIdx = Math.floor((i / path.length) * palette.length * 1.7) %
      palette.length;
    const color = palette[colorIdx]!;
    ctx.fillStyle = color;
    // Outward sweep — a thin column reaching `depthPx` past the path.
    const tipX = base.x + norm.nx * depthPx;
    const tipY = base.y + norm.ny * depthPx;
    ctx.beginPath();
    const sx = norm.ny;
    const sy = -norm.nx;
    const half = 1.2; // 2-3 px column width
    ctx.moveTo(base.x - sx * half, base.y - sy * half);
    ctx.lineTo(tipX - sx * half, tipY - sy * half);
    ctx.lineTo(tipX + sx * half, tipY + sy * half);
    ctx.lineTo(base.x + sx * half, base.y + sy * half);
    ctx.closePath();
    ctx.fill();
  }

  // Fan speckle — walk along the path in 1-px steps, scatter fan-head
  // pixels at random depths. Determinism: the seat index `i*depthCells + d`
  // plus the band-seed produces the same output for the same simTime.
  const depthCells = Math.max(1, Math.floor(depthPx));
  // Slow flicker: each frame we pick a few seats per row that brighten.
  const flickerEpoch = Math.floor(simTime / 6);
  for (let i = 0; i < path.length; i++) {
    const base = path[i]!;
    const norm = outwardNormal[i]!;
    for (let d = 0; d < depthCells; d++) {
      const seatId = (i * 257 + d) ^ bandSeed;
      const r = rand01(seatId, 0);
      if (r > density) continue; // empty seat
      const fx = base.x + norm.nx * (d + 0.5);
      const fy = base.y + norm.ny * (d + 0.5);
      // Wave-burst: lift fans within ±15° of the wave center for a beat.
      let lift = 0;
      if (args.waveStrength && args.waveStrength > 0 && args.waveCenterAngleDeg !== undefined) {
        // Map seat index to a coarse angle estimate (only used here).
        const seatAngle = ((i / path.length) * 90) - 45;
        const delta = Math.abs(seatAngle - args.waveCenterAngleDeg);
        if (delta < 18) {
          const fall = 1 - delta / 18;
          lift = -1 * fall * args.waveStrength;
        }
      }
      // Pick a fan color: skin pixel (head) or a hat tinted from palette.
      const colorRoll = rand01(seatId, 1);
      let fanColor: string;
      if (colorRoll < HAT_HIGHLIGHT) {
        fanColor = palette[hash32(seatId, 2) % palette.length]!;
      } else {
        fanColor = SKIN_TONES[hash32(seatId, 3) % SKIN_TONES.length]!;
      }
      // Flicker: every ~6 sim-ticks a thin slice of seats lights up. The
      // condition is stable across frames within an epoch.
      if (rand01(seatId, flickerEpoch) > 0.985) {
        fanColor = '#ffffff';
      }
      ctx.fillStyle = fanColor;
      ctx.fillRect(Math.round(fx), Math.round(fy + lift), 1, 1);
    }
  }
};

// Build the polyline + outward-normal pair for the outfield bleachers.
const outfieldBowlGeometry = (
  t: FieldTransform,
  wall: WallPath,
): { path: { x: number; y: number }[]; outwardNormal: { nx: number; ny: number }[] } => {
  const home = worldToScreen(HOME_PLATE, t);
  const path: { x: number; y: number }[] = [];
  const outwardNormal: { nx: number; ny: number }[] = [];
  for (const s of wall.samples) {
    const w = worldToScreen(s.point, t);
    path.push(w);
    // Normal points away from home plate.
    const dx = w.x - home.x;
    const dy = w.y - home.y;
    const len = Math.hypot(dx, dy) || 1;
    outwardNormal.push({ nx: dx / len, ny: dy / len });
  }
  return { path, outwardNormal };
};

// Build the polyline for the home-plate bowl (stands behind home), spanning
// roughly 220° around the catcher area. Drawn behind the dugouts.
const homeBowlGeometry = (
  t: FieldTransform,
): { path: { x: number; y: number }[]; outwardNormal: { nx: number; ny: number }[] } => {
  const home = worldToScreen(HOME_PLATE, t);
  // Sweep from the 1B foul-territory side around behind the plate to the
  // 3B side. Radius chosen to clear the dugouts.
  const radiusPx = Math.max(120, t.pixelsPerFoot * 110);
  const path: { x: number; y: number }[] = [];
  const outwardNormal: { nx: number; ny: number }[] = [];
  const start = Math.PI * 0.18; // just past 1B foul line going clockwise
  const end = Math.PI - Math.PI * 0.18; // mirror on 3B side
  const steps = 60;
  for (let i = 0; i <= steps; i++) {
    const a = start + (end - start) * (i / steps);
    // Canvas Y grows downward — the home bowl sits below home plate.
    const x = home.x + Math.cos(a) * radiusPx;
    const y = home.y + Math.sin(a) * radiusPx;
    path.push({ x, y });
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    outwardNormal.push({ nx: dx, ny: dy });
  }
  return { path, outwardNormal };
};

// Public entrypoints — caller draws the empty-bowl band first, then the
// crowd speckle on top. Two passes simplify the layering when other chrome
// (foul poles, scoreboards) needs to slot between.

export const drawOutfieldStands = (args: CrowdArgs): void => {
  const geo = outfieldBowlGeometry(args.transform, args.wall);
  const depthPx = Math.max(8, args.transform.pixelsPerFoot * 24);
  drawStandsBand({
    ...args,
    path: geo.path,
    outwardNormal: geo.outwardNormal,
    depthPx,
    bandSeed: 0xfac3,
  });
};

export const drawHomeBowlStands = (args: CrowdArgs): void => {
  const geo = homeBowlGeometry(args.transform);
  const depthPx = Math.max(10, args.transform.pixelsPerFoot * 28);
  drawStandsBand({
    ...args,
    path: geo.path,
    outwardNormal: geo.outwardNormal,
    depthPx,
    bandSeed: 0x7eed,
  });
};
