// Wall-path geometry. The implementation lives in /world/stadium-geometry
// so /sim can use the same scalar `wallDistanceAtAngle` helper without
// reaching into /render. This file re-exports the renderer-facing pieces
// so the existing import paths in /render/* keep working.

export {
  buildWallPath,
  wallPointAt,
  wallDistanceAtAngle,
  PLACEHOLDER_DIMENSIONS,
  type WallSample,
  type WallPath,
  type Point2D,
} from '../world/stadium-geometry.js';
