import type { StadiumDimensions } from './types.js';

// Pure geometry over StadiumDimensions. Both /sim (fence-aware HR check)
// and /render (wall polyline drawing) consume this. Lives in /world
// because it's a function of the canonical Stadium record and has no
// dependency on either the simulator or the renderer.
//
// Coordinate convention (matches /render):
//   - Origin (0, 0) at home plate
//   - +X toward right field, +Y toward center field
//   - Angles in degrees: -45 = LF foul line, 0 = dead-center, +45 = RF foul

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

// θ = 0 is straight to CF (+Y); -45° hugs the LF foul line, +45° the RF.
const ANCHOR_ANGLES_DEG = [-45, -22.5, 0, 22.5, 45] as const;

const polar = (angleDeg: number, distFt: number): Point2D => {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: Math.sin(rad) * distFt, y: Math.cos(rad) * distFt };
};

// Cosine-eased lerp between adjacent anchor samples. Smoother than linear,
// cheaper than Catmull-Rom, and the rounding matches the 8-bit silhouette
// in the renderer.
const cosineLerp = (a: number, b: number, t: number): number => {
  const u = (1 - Math.cos(t * Math.PI)) / 2;
  return a + (b - a) * u;
};

const dimsToDistanceArray = (dims: StadiumDimensions): readonly number[] => [
  dims.leftFt,
  dims.leftCenterFt,
  dims.centerFt,
  dims.rightCenterFt,
  dims.rightFt,
];

// Scalar form — returns the wall distance (in feet from home plate) at the
// given spray angle. Used by /sim to gate home-run outcomes against the
// actual fence; called once per HR roll, so cheap by construction.
//
// The spray angle is clamped to fair territory ([-45, +45]); foul-territory
// queries fall back to the foul-line distance, which is reasonable for the
// near-foul HR cases the sim cares about.
export const wallDistanceAtAngle = (
  dims: StadiumDimensions,
  angleDeg: number,
): number => {
  const distances = dimsToDistanceArray(dims);
  const clamped = Math.max(-45, Math.min(45, angleDeg));
  // Map clamped angle into a 0..4 segment index.
  const u = (clamped - ANCHOR_ANGLES_DEG[0]) / 90; // 0..1
  const segPos = u * 4; // 0..4
  const segIdx = Math.min(3, Math.floor(segPos));
  const segLocal = segPos - segIdx;
  const d0 = distances[segIdx]!;
  const d1 = distances[segIdx + 1]!;
  return cosineLerp(d0, d1, segLocal);
};

// Polyline form — used by the renderer to draw the wall, warning track,
// and bowl geometry. Subdivides finely enough to read smoothly at
// screensaver scale.
export interface WallSample {
  readonly angleDeg: number;
  readonly distanceFt: number;
  readonly point: Point2D;
}

export interface WallPath {
  readonly samples: readonly WallSample[];
  readonly leftFoul: Point2D;
  readonly rightFoul: Point2D;
  readonly center: Point2D;
  readonly maxDistanceFt: number;
  readonly heightFt: number;
}

const WALL_SUBDIVISIONS = 36;

export const buildWallPath = (dims: StadiumDimensions): WallPath => {
  const distances = dimsToDistanceArray(dims);
  const samples: WallSample[] = [];
  for (let i = 0; i <= WALL_SUBDIVISIONS; i++) {
    const u = i / WALL_SUBDIVISIONS;
    const segIdx = Math.min(3, Math.floor(u * 4));
    const segLocal = u * 4 - segIdx;
    const a0 = ANCHOR_ANGLES_DEG[segIdx]!;
    const a1 = ANCHOR_ANGLES_DEG[segIdx + 1]!;
    const d0 = distances[segIdx]!;
    const d1 = distances[segIdx + 1]!;
    const angleDeg = a0 + (a1 - a0) * segLocal;
    const distanceFt = cosineLerp(d0, d1, segLocal);
    samples.push({ angleDeg, distanceFt, point: polar(angleDeg, distanceFt) });
  }
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  return {
    samples,
    leftFoul: first.point,
    rightFoul: last.point,
    center: polar(0, dims.centerFt),
    maxDistanceFt: Math.max(...distances),
    heightFt: dims.wallHeightFt,
  };
};

// Returns the polyline-sample point closest to the given spray angle.
// Used by quirk renderers anchoring decorations on the wall.
export const wallPointAt = (path: WallPath, angleDeg: number): Point2D => {
  const clamped = Math.max(-45, Math.min(45, angleDeg));
  let best = path.samples[0]!;
  let bestDelta = Math.abs(best.angleDeg - clamped);
  for (const s of path.samples) {
    const d = Math.abs(s.angleDeg - clamped);
    if (d < bestDelta) {
      best = s;
      bestDelta = d;
    }
  }
  return best.point;
};

// Default fallback — used when a caller has no Stadium record (legacy
// tests, ad-hoc fixtures). Matches the legacy hardcoded depths that lived
// in /render/field.ts before per-stadium dimensions were wired through.
export const PLACEHOLDER_DIMENSIONS: StadiumDimensions = {
  leftFt: 335,
  leftCenterFt: 380,
  centerFt: 410,
  rightCenterFt: 380,
  rightFt: 335,
  wallHeightFt: 10,
  foulTerritoryRating: 5,
  moundHeightIn: 10,
};
