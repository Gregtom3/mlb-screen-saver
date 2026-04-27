import { worldToScreen, type FieldTransform } from './transform.js';
import { HOME_PLATE } from './field-geometry.js';
import type { WallPath } from './wall.js';
import type { LightTowerAnchor } from './sky.js';

// ----------------------------------------------------------------------------
// stadium-bowl.ts — single source of truth for the geometry of the seating
// bowl that wraps the field. Replaces the two disconnected polylines that
// previously lived in crowd.ts (one along the outfield wall, one as a small
// arc behind home plate). With this module the bowl is ONE closed shape:
//
//          LF foul pole ──── outfield wall arc ──── RF foul pole
//                ╱                                       ╲
//          (foul-territory wrap)                  (foul-territory wrap)
//                ╲                                       ╱
//                 ╲           home backstop arc         ╱
//
// The renderer asks for `buildStadiumBowl(transform, wall)` once per frame
// and draws each tier in order (back wall, upper deck, roof, lower bowl).
// All numbers are tuned for screensaver scale — not realistic — so the
// stadium reads as a stadium at small canvas sizes.
// ----------------------------------------------------------------------------

export interface BowlPoint {
  readonly screen: { x: number; y: number }; // canvas-space sample on the bowl front edge
  readonly outward: { nx: number; ny: number }; // unit normal pointing away from field
  readonly along: { tx: number; ty: number }; // unit tangent along the polyline
  readonly anglePct: number; // 0..1 along the polyline, useful for crowd density / palette
}

export interface BowlTierSpec {
  readonly innerOffsetPx: number; // distance from the bowl front edge inward (negative is outward)
  readonly depthPx: number; // tier depth in screen px
  readonly riseLiftPx: number; // additional vertical lift to fake elevation
  readonly seatRows: number; // number of stair-stepped rows of fans
  readonly backWallColor: string;
  readonly seatPalette: readonly string[];
}

export interface StadiumBowl {
  // Front edge of the lower bowl — the polyline fans see the field from.
  readonly front: readonly BowlPoint[];
  // Per-tier extruded offsets, computed once so crowd.ts can iterate.
  readonly tiers: {
    readonly lower: BowlTierSpec;
    readonly upper: BowlTierSpec;
    readonly roof: BowlTierSpec;
  };
  // Light-tower anchors — base points (canvas-space) for the four masts that
  // sit just behind the upper deck, at 1B-corner / 3B-corner / LCF / RCF.
  readonly lightTowers: readonly LightTowerAnchor[];
  // Total outward thickness of the bowl (lower + upper + roof) in screen px.
  // Useful for the back-wall polygon and for sizing the roof line.
  readonly totalDepthPx: number;
  // Position (canvas-space) of the foul-pole base on each side, after the
  // bowl polyline pushes them slightly outward from the wall corner. The
  // foul-pole renderer uses these so poles read as anchored to the bowl
  // seam, not floating past the wall.
  readonly foulPoleBase: { left: { x: number; y: number }; right: { x: number; y: number } };
}

export interface BuildBowlOptions {
  // Per-stadium seat colors — drives the lower-bowl section blocks.
  readonly seatPalette?: readonly string[];
  // How tall the lower bowl is in screen px relative to the canvas. Larger
  // canvases get proportionally taller stands so the bowl never looks like a
  // thin sliver on a giant screen.
  readonly bowlScale?: number; // 1.0 = default
}

const DEFAULT_PALETTE = ['#3a4048', '#2e3440', '#46505c'];

// --- Foul-territory wrap + home-back ellipse, in field coordinates ---------
// The waist where the foul-territory wrap meets the home-plate ellipse.
// Tuned so the bowl runs OUTSIDE the dugouts (which sit near (±55, +5))
// and OUTSIDE the foul lines (which run from home to (±237, 237)).
const WAIST_X_FT = 96;
const WAIST_Y_FT = -8;
// Home-plate ellipse — semi-axes around (0, WAIST_Y_FT). x-axis matches the
// waist offset; y-axis controls how deep behind home the bowl dips. Choosing
// WAIST_X for the x-axis makes θ=0 land exactly on the waist, killing the
// previous discontinuity at the seam.
const HOME_ELLIPSE_A_FT = WAIST_X_FT;
const HOME_ELLIPSE_B_FT = 78; // depth behind WAIST_Y line — deepest at y = WAIST_Y - B
const HOME_ARC_SAMPLES = 24;
const FOUL_WRAP_SAMPLES = 14;

// A tiny outward push so the bowl never visually overlaps the foul line.
const FOUL_LINE_CLEARANCE_FT = 6;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// Quadratic Bezier through (a, b, c) with b as the control point — used
// for the foul-territory wrap segments.
const qbez = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  t: number,
): { x: number; y: number } => {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * b.x + t * t * c.x,
    y: u * u * a.y + 2 * u * t * b.y + t * t * c.y,
  };
};

// Build the world-space polyline of the bowl front edge, walking around the
// field in the direction of the wall samples (LF foul → CF → RF foul → wrap
// → home → wrap → close).
const buildBowlPolylineWorld = (
  wall: WallPath,
): { points: { x: number; y: number }[] } => {
  const points: { x: number; y: number }[] = [];

  // (1) Outfield wall — push samples slightly outward so the wall outline
  // reads as a separate element from the bowl front. The push is radial
  // from home plate.
  for (const s of wall.samples) {
    const len = Math.hypot(s.point.x, s.point.y) || 1;
    const factor = 1 + FOUL_LINE_CLEARANCE_FT / len;
    points.push({ x: s.point.x * factor, y: s.point.y * factor });
  }

  // (2) RF foul → RF waist (foul-territory wrap, right side). Quadratic
  // Bezier with a control point pulled outward so the curve bellies into
  // foul territory rather than slicing straight inward.
  {
    const start = points[points.length - 1]!;
    const end = { x: WAIST_X_FT, y: WAIST_Y_FT };
    const ctrl = {
      x: lerp(start.x, end.x, 0.5) + FOUL_LINE_CLEARANCE_FT * 3,
      y: lerp(start.y, end.y, 0.5),
    };
    for (let i = 1; i <= FOUL_WRAP_SAMPLES; i++) {
      const t = i / FOUL_WRAP_SAMPLES;
      points.push(qbez(start, ctrl, end, t));
    }
  }

  // (3) Half-ellipse from RF waist (θ=0) through deep-behind-home (θ=-π/2)
  // to LF waist (θ=-π). Center at (0, WAIST_Y_FT). Sweeping clockwise (in
  // field coords with +Y up) so we trace BEHIND home plate rather than
  // through fair territory.
  {
    for (let i = 1; i <= HOME_ARC_SAMPLES; i++) {
      const t = i / HOME_ARC_SAMPLES;
      const theta = lerp(0, -Math.PI, t);
      points.push({
        x: HOME_ELLIPSE_A_FT * Math.cos(theta),
        y: WAIST_Y_FT + HOME_ELLIPSE_B_FT * Math.sin(theta),
      });
    }
  }

  // (4) LF waist → LF foul (mirror of step 2).
  {
    const start = points[points.length - 1]!;
    const end = points[0]!;
    const ctrl = {
      x: lerp(start.x, end.x, 0.5) - FOUL_LINE_CLEARANCE_FT * 3,
      y: lerp(start.y, end.y, 0.5),
    };
    for (let i = 1; i < FOUL_WRAP_SAMPLES; i++) {
      const t = i / FOUL_WRAP_SAMPLES;
      points.push(qbez(start, ctrl, end, t));
    }
  }

  return { points };
};

// Project a world-space polyline to screen, computing tangent + outward
// normal at each sample. Outward = perpendicular to the tangent, pointing
// away from home plate.
const projectToScreen = (
  worldPts: readonly { x: number; y: number }[],
  t: FieldTransform,
): BowlPoint[] => {
  const home = worldToScreen(HOME_PLATE, t);
  const screenPts: { x: number; y: number }[] = worldPts.map((p) =>
    worldToScreen(p, t),
  );
  const N = screenPts.length;
  const out: BowlPoint[] = [];
  for (let i = 0; i < N; i++) {
    const cur = screenPts[i]!;
    const prev = screenPts[(i - 1 + N) % N]!;
    const next = screenPts[(i + 1) % N]!;
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const tlen = Math.hypot(tx, ty) || 1;
    tx /= tlen;
    ty /= tlen;
    // Two candidate outward normals (perpendicular to tangent). Pick the
    // one pointing away from home plate.
    const n1x = -ty;
    const n1y = tx;
    const dxFromHome = cur.x - home.x;
    const dyFromHome = cur.y - home.y;
    const dot = n1x * dxFromHome + n1y * dyFromHome;
    const nx = dot >= 0 ? n1x : -n1x;
    const ny = dot >= 0 ? n1y : -n1y;
    out.push({
      screen: cur,
      outward: { nx, ny },
      along: { tx, ty },
      anglePct: i / Math.max(1, N - 1),
    });
  }
  return out;
};

// Place four light-tower anchors across the OUTFIELD portion of the bowl
// (not behind home — towers there would mask the action). The tower sits
// past the upper deck so the bowl + roof partly occlude its base.
const buildLightTowers = (
  front: readonly BowlPoint[],
  totalDepthPx: number,
  pixelsPerFoot: number,
  wallSampleCount: number,
): LightTowerAnchor[] => {
  // The first `wallSampleCount` entries of `front` are the outfield wall
  // samples. Spread four towers across that span.
  const span = wallSampleCount;
  if (span < 4) return [];
  const targetIndices = [
    Math.round(span * 0.06),
    Math.round(span * 0.34),
    Math.round(span * 0.66),
    Math.round(span * 0.94),
  ];
  const towers: LightTowerAnchor[] = [];
  for (const idx of targetIndices) {
    const p = front[Math.max(0, Math.min(front.length - 1, idx))]!;
    const baseX = p.screen.x + p.outward.nx * (totalDepthPx + 6);
    const baseY = p.screen.y + p.outward.ny * (totalDepthPx + 6);
    towers.push({
      screen: { x: Math.round(baseX), y: Math.round(baseY) },
      heightPx: Math.max(34, pixelsPerFoot * 75),
    });
  }
  return towers;
};

const bowlTiers = (
  pixelsPerFoot: number,
  scale: number,
  palette: readonly string[],
): StadiumBowl['tiers'] => {
  const k = pixelsPerFoot * scale;
  return {
    lower: {
      innerOffsetPx: 0,
      depthPx: Math.max(10, k * 18),
      riseLiftPx: 0,
      seatRows: 4,
      backWallColor: '#2a2f37',
      seatPalette: palette,
    },
    upper: {
      // 4ft concourse gap between the lower bowl and the upper deck.
      innerOffsetPx: Math.max(12, k * 22),
      depthPx: Math.max(8, k * 14),
      riseLiftPx: Math.max(6, k * 6),
      seatRows: 3,
      backWallColor: '#1f242c',
      seatPalette: palette.map(darken),
    },
    roof: {
      innerOffsetPx: Math.max(20, k * 36),
      depthPx: Math.max(4, k * 6),
      riseLiftPx: Math.max(10, k * 10),
      seatRows: 0, // facade only — no fans on the roof
      backWallColor: '#15191f',
      seatPalette: ['#0f1318'],
    },
  };
};

const darken = (hex: string): string => {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const adj = (c: number) => Math.max(0, Math.round(c * 0.78));
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(adj(r))}${toHex(adj(g))}${toHex(adj(b))}`;
};

// Public entry point — called once per frame from field.ts.
export const buildStadiumBowl = (
  t: FieldTransform,
  wall: WallPath,
  options: BuildBowlOptions = {},
): StadiumBowl => {
  const { points } = buildBowlPolylineWorld(wall);
  const front = projectToScreen(points, t);
  const palette =
    options.seatPalette && options.seatPalette.length > 0
      ? options.seatPalette
      : DEFAULT_PALETTE;
  const tiers = bowlTiers(t.pixelsPerFoot, options.bowlScale ?? 1, palette);
  const totalDepthPx = tiers.roof.innerOffsetPx + tiers.roof.depthPx;
  const lightTowers = buildLightTowers(
    front,
    totalDepthPx,
    t.pixelsPerFoot,
    wall.samples.length,
  );
  // Foul poles sit at index 0 (LF) and index `wall.samples.length - 1` (RF)
  // of the bowl front polyline — the outermost wall samples after the
  // outward push. The chrome layer reads these so the poles anchor to the
  // bowl rather than the bare wall corner.
  const leftIdx = 0;
  const rightIdx = wall.samples.length - 1;
  const leftP = front[leftIdx]!;
  const rightP = front[rightIdx]!;
  return {
    front,
    tiers,
    lightTowers,
    totalDepthPx,
    foulPoleBase: {
      left: { x: leftP.screen.x, y: leftP.screen.y },
      right: { x: rightP.screen.x, y: rightP.screen.y },
    },
  };
};
