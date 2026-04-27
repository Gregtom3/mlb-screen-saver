import type { StadiumDimensions } from '../world/types.js';
import type { FieldPoint } from './types.js';

// Builds the polyline of outfield wall points in field coordinates, sampled
// from each stadium's actual fence distances. Replaces the hardcoded
// OUTFIELD_DEPTHS that lived in field.ts. Sim integrity is unaffected:
// outcomes are still rolled probabilistically; this is a cosmetic change.

// θ = 0 is straight to CF (+Y); -45° hugs the LF foul line, +45° the RF.
// Anchor angles for the 5 named distances.
const ANGLES_DEG = [-45, -22.5, 0, 22.5, 45] as const;

const polar = (angleDeg: number, distFt: number): FieldPoint => {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: Math.sin(rad) * distFt, y: Math.cos(rad) * distFt };
};

// Cosine-eased lerp between adjacent samples. Smoother than linear, cheaper
// than Catmull-Rom, and the rounding matches the 8-bit silhouette better.
const cosineLerp = (a: number, b: number, t: number): number => {
  const u = (1 - Math.cos(t * Math.PI)) / 2;
  return a + (b - a) * u;
};

export interface WallSample {
  readonly angleDeg: number;
  readonly distanceFt: number;
  readonly point: FieldPoint;
}

export interface WallPath {
  readonly samples: readonly WallSample[];
  readonly leftFoul: FieldPoint;
  readonly rightFoul: FieldPoint;
  readonly center: FieldPoint;
  readonly maxDistanceFt: number;
  readonly heightFt: number;
}

const WALL_SUBDIVISIONS = 36; // smooth enough for screensaver scale

export const buildWallPath = (dims: StadiumDimensions): WallPath => {
  const distances = [
    dims.leftFt,
    dims.leftCenterFt,
    dims.centerFt,
    dims.rightCenterFt,
    dims.rightFt,
  ];

  const samples: WallSample[] = [];
  for (let i = 0; i <= WALL_SUBDIVISIONS; i++) {
    const u = i / WALL_SUBDIVISIONS;
    const segIdx = Math.min(3, Math.floor(u * 4));
    const segLocal = u * 4 - segIdx;
    const a0 = ANGLES_DEG[segIdx]!;
    const a1 = ANGLES_DEG[segIdx + 1]!;
    const d0 = distances[segIdx]!;
    const d1 = distances[segIdx + 1]!;
    const angleDeg = a0 + (a1 - a0) * segLocal;
    const distanceFt = cosineLerp(d0, d1, segLocal);
    samples.push({ angleDeg, distanceFt, point: polar(angleDeg, distanceFt) });
  }

  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const center = polar(0, dims.centerFt);
  const maxDistanceFt = Math.max(...distances);

  return {
    samples,
    leftFoul: first.point,
    rightFoul: last.point,
    center,
    maxDistanceFt,
    heightFt: dims.wallHeightFt,
  };
};

// Returns wall point at a given spray angle in [-45, +45]. Used by quirk
// renderers that want to anchor a decoration at a specific spot (e.g. a
// scoreboard above CF, an ivy patch on a wall segment).
export const wallPointAt = (path: WallPath, angleDeg: number): FieldPoint => {
  const clamped = Math.max(-45, Math.min(45, angleDeg));
  // Linear-search the samples; cheap at <40 entries and called rarely.
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

// Default fallback dimensions for the placeholder ballpark — used when the
// renderer is invoked without a Stadium in context (e.g. unit tests that
// don't construct one). Matches the legacy hardcoded depths from field.ts.
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
