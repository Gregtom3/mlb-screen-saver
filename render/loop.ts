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
  /**
   * Called each frame with the events whose `t` just crossed the playback
   * cursor (in chronological order). Lets downstream systems (audio, news
   * ticker, etc.) react to the live stream without driving their own loop.
   * On `setActiveGame` and `jumpTo` the cursor jumps with `simTime` — past
   * events from the new state are not replayed.
   */
  readonly onEvents?: (events: readonly SimEvent[]) => void;
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
  // Index of the next event in `game.events` to consider for dispatch. Events
  // before this index have already been emitted (or skipped because they sat
  // before the cursor when we joined the game).
  let eventIdx = 0;

  const finalT = (g: ActiveGame): number => {
    const last = g.events[g.events.length - 1];
    return last ? last.t + 60 : 0;
  };

  // Smallest index in `g.events` whose `.t` is strictly greater than `t`.
  // Used to re-anchor the cursor after a channel swap or jump so we don't
  // replay the past.
  const findIdxAfter = (g: ActiveGame, t: number): number => {
    let lo = 0;
    let hi = g.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (g.events[mid]!.t > t) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };

  const dispatchDueEvents = () => {
    if (!options.onEvents) {
      // Still advance the index so a later subscription picks up from "now"
      // rather than replaying the whole game.
      while (eventIdx < game.events.length && game.events[eventIdx]!.t <= simTime) {
        eventIdx++;
      }
      return;
    }
    const batch: SimEvent[] = [];
    while (eventIdx < game.events.length && game.events[eventIdx]!.t <= simTime) {
      batch.push(game.events[eventIdx]!);
      eventIdx++;
    }
    if (batch.length > 0) options.onEvents(batch);
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
    dispatchDueEvents();
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
      eventIdx = findIdxAfter(game, simTime);
      draw();
    },
    currentSimTime() { return simTime; },
    isFinished() { return simTime >= finalT(game); },
    setActiveGame(newGame: ActiveGame) {
      game = newGame;
      // Re-anchor the cursor so we don't fire SFX for events that happened
      // before we tuned in to this channel.
      eventIdx = findIdxAfter(game, simTime);
      draw();
    },
    redraw() { draw(); },
  };

  draw();
  if (options.autoStart) handle.start();
  return handle;
};
