import type { SimEvent } from '../sim/types.js';
import { drawField } from './field.js';
import { drawHud } from './hud.js';
import { buildScene, type SceneContext } from './scene.js';
import { drawScene } from './sprites.js';
import { drawDebugOverlay, isDebugEnabled } from './debug.js';
import { computeTransform } from './transform.js';
import type { TeamId } from '../world/types.js';

// Default playback rate. With ~33-38k sim ticks per game, 20 ticks/wall sec
// lands ~28-32 minutes per game, in line with the screensaver target.
export const DEFAULT_TICKS_PER_SECOND = 20;

export interface ActiveGame {
  readonly events: readonly SimEvent[];
  readonly sceneCtx: SceneContext;
}

export interface TeamStanding {
  readonly wins: number;
  readonly losses: number;
}

export interface ChannelInfo {
  readonly currentIdx: number; // 0-based
  readonly total: number;
}

export interface RenderLoopHandle {
  start(): void;
  stop(): void;
  isPlaying(): boolean;
  setSpeed(ticksPerSecond: number): void;
  speed(): number;
  jumpTo(simTime: number): void;
  currentSimTime(): number;
  isFinished(): boolean;
  /** Swap the rendered game without resetting the simTime clock. */
  setActiveGame(game: ActiveGame): void;
  /** Expose the current canvas, for resize handling. */
  redraw(): void;
}

export interface RenderLoopOptions {
  readonly initialTicksPerSecond?: number;
  readonly autoStart?: boolean;
  /** Optional standings provider — drawn as a strip across the top. */
  readonly getStandings?: () => ReadonlyMap<TeamId, TeamStanding>;
  /** Optional channel info provider — drawn next to the scoreboard. */
  readonly getChannelInfo?: () => ChannelInfo;
}

export const createRenderLoop = (
  canvas: HTMLCanvasElement,
  initialGame: ActiveGame,
  options: RenderLoopOptions = {},
): RenderLoopHandle => {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context not available');

  let game: ActiveGame = initialGame;
  let ticksPerSecond = options.initialTicksPerSecond ?? DEFAULT_TICKS_PER_SECOND;
  let simTime = 0;
  let lastFrameMs: number | null = null;
  let rafId: number | null = null;
  let playing = false;

  const finalT = (g: ActiveGame): number => {
    const last = g.events[g.events.length - 1];
    return last ? last.t + 60 : 0;
  };

  const teamBugInfo = (id: TeamId, score: number) => {
    const colors = game.sceneCtx.teamColors.get(id);
    const abbr = game.sceneCtx.teamAbbr.get(id) ?? id;
    return {
      abbr,
      score,
      primary: colors?.primary ?? '#888888',
      secondary: colors?.secondary ?? '#cccccc',
    };
  };

  const draw = () => {
    const transform = computeTransform(canvas.width, canvas.height);
    drawField(ctx, transform, {
      grassShade: game.sceneCtx.grassShade,
      skyColor: game.sceneCtx.skyColor,
    });
    const scene = buildScene(game.events, simTime, game.sceneCtx);
    drawScene(ctx, transform, scene);
    const standings = options.getStandings?.();
    const channel = options.getChannelInfo?.();
    drawHud(
      ctx,
      transform,
      scene,
      {
        away: teamBugInfo(game.sceneCtx.input.away.teamId, scene.scoreAway),
        home: teamBugInfo(game.sceneCtx.input.home.teamId, scene.scoreHome),
      },
      game.sceneCtx.input.playerIndex,
      {
        ...(standings ? { standings } : {}),
        ...(channel ? { channel } : {}),
        teamColors: game.sceneCtx.teamColors,
        teamAbbr: game.sceneCtx.teamAbbr,
      },
    );
    if (isDebugEnabled()) drawDebugOverlay(ctx, transform, scene);
  };

  const frame = (now: number) => {
    if (!playing) return;
    const dt = lastFrameMs === null ? 0 : (now - lastFrameMs) / 1000;
    lastFrameMs = now;
    simTime = Math.min(finalT(game), simTime + dt * ticksPerSecond);
    draw();
    if (simTime >= finalT(game)) {
      // Don't stop the loop — user might switch to a still-playing game.
      // Just wait for the next channel swap or speed change.
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
    isPlaying() { return playing; },
    setSpeed(tps: number) { ticksPerSecond = Math.max(0, tps); },
    speed() { return ticksPerSecond; },
    jumpTo(t: number) {
      simTime = Math.max(0, Math.min(finalT(game), t));
      draw();
    },
    currentSimTime() { return simTime; },
    isFinished() { return simTime >= finalT(game); },
    setActiveGame(newGame: ActiveGame) {
      game = newGame;
      draw();
    },
    redraw() { draw(); },
  };

  draw();
  if (options.autoStart) handle.start();
  return handle;
};
