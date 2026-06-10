// /render — Canvas2D renderer. Pure function of (event log, tick) → frame.
export * from './types.js';
export { buildScene, type SceneContext } from './scene.js';
export { drawField } from './field.js';
export { drawWeather, type WeatherKind } from './weather.js';
export { drawScene } from './sprites.js';
export { drawHud } from './hud.js';
export {
  createRenderLoop,
  DEFAULT_TICKS_PER_SECOND,
  type RenderLoopHandle,
  type RenderLoopOptions,
  type ActiveGame,
  type TeamStanding,
  type ChannelInfo,
} from './loop.js';
export { computeTransform, worldToScreen, type FieldTransform } from './transform.js';
export {
  HOME_PLATE,
  FIRST_BASE,
  SECOND_BASE,
  THIRD_BASE,
  PITCHERS_MOUND,
  FIELDER_HOME_POSITIONS,
  baseFor,
  lerpPoint,
} from './field-geometry.js';
