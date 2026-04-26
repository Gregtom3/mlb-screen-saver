import type { SimEvent } from '../sim/types.js';
import { drawField } from './field.js';
import { drawHud } from './hud.js';
import { buildScene, type SceneContext } from './scene.js';
import { drawScene } from './sprites.js';
import { computeTransform } from './transform.js';
import type { TeamId } from '../world/types.js';

// Default playback: 20 sim-ticks per real second. With ~33k ticks per game
// that lands ~25–28 minutes per full game, in line with the screensaver
// target. Caller can tune via setSpeed.
export const DEFAULT_TICKS_PER_SECOND = 20;

export interface RenderLoopHandle {
  start(): void;
  stop(): void;
  isPlaying(): boolean;
  setSpeed(ticksPerSecond: number): void;
  speed(): number;
  jumpTo(simTime: number): void;
  currentSimTime(): number;
  isFinished(): boolean;
}

export interface RenderLoopOptions {
  readonly initialTicksPerSecond?: number;
  readonly autoStart?: boolean;
}

export const createRenderLoop = (
  canvas: HTMLCanvasElement,
  events: readonly SimEvent[],
  sceneCtx: SceneContext,
  options: RenderLoopOptions = {},
): RenderLoopHandle => {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context not available');

  let ticksPerSecond = options.initialTicksPerSecond ?? DEFAULT_TICKS_PER_SECOND;
  let simTime = 0;
  let lastFrameMs: number | null = null;
  let rafId: number | null = null;
  let playing = false;

  const finalEvent = events[events.length - 1];
  const totalSimTime = finalEvent ? finalEvent.t + 60 : 0; // a small tail past gameEnd

  const teamBugInfo = (id: TeamId, score: number) => {
    const colors = sceneCtx.teamColors.get(id);
    const abbr = sceneCtx.teamAbbr.get(id) ?? id;
    return {
      abbr,
      score,
      primary: colors?.primary ?? '#888888',
      secondary: colors?.secondary ?? '#cccccc',
    };
  };

  const draw = () => {
    const transform = computeTransform(canvas.width, canvas.height);
    drawField(ctx, transform, { grassShade: sceneCtx.grassShade });
    const scene = buildScene(events, simTime, sceneCtx);
    drawScene(ctx, transform, scene);
    drawHud(
      ctx,
      transform,
      scene,
      {
        away: teamBugInfo(sceneCtx.input.away.teamId, scene.scoreAway),
        home: teamBugInfo(sceneCtx.input.home.teamId, scene.scoreHome),
      },
      sceneCtx.input.playerIndex,
    );
  };

  const frame = (now: number) => {
    if (!playing) return;
    const dt = lastFrameMs === null ? 0 : (now - lastFrameMs) / 1000;
    lastFrameMs = now;
    simTime = Math.min(totalSimTime, simTime + dt * ticksPerSecond);
    draw();
    if (simTime >= totalSimTime) {
      playing = false;
      rafId = null;
      return;
    }
    rafId = requestAnimationFrame(frame);
  };

  const handle: RenderLoopHandle = {
    start() {
      if (playing) return;
      playing = true;
      lastFrameMs = null;
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      playing = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    },
    isPlaying() {
      return playing;
    },
    setSpeed(tps: number) {
      ticksPerSecond = Math.max(0, tps);
    },
    speed() {
      return ticksPerSecond;
    },
    jumpTo(t: number) {
      simTime = Math.max(0, Math.min(totalSimTime, t));
      draw();
    },
    currentSimTime() {
      return simTime;
    },
    isFinished() {
      return simTime >= totalSimTime;
    },
  };

  // Render once even before start so the canvas isn't blank.
  draw();

  if (options.autoStart) handle.start();

  return handle;
};
