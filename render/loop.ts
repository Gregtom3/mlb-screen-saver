import type { SimEvent } from '../sim/types.js';
import type { AnimAudioCue } from '../audio/dispatcher.js';
import { drawField } from './field.js';
import { drawHud } from './hud.js';
import { buildScene, type SceneContext } from './scene.js';
import { drawScene, findPlayerAtScreen } from './sprites.js';
import { drawDebugOverlay, isDebugEnabled } from './debug.js';
import { computeTransform } from './transform.js';
import { computeAnimAudioCues } from './anim-cues.js';
import type { PlayerId, TeamId } from '../world/types.js';
import type { CrowdState } from '../ambience/state.js';

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
  /**
   * Hit-test screen coordinates against on-field player sprites.
   * Returns the topmost player under the cursor or null. Coordinates are
   * in canvas pixel space (post-DPR), matching what `clientX` minus
   * `getBoundingClientRect().left` gives after multiplying by DPR.
   */
  playerAtScreen(screenX: number, screenY: number): PlayerId | null;
  /** Set which player is currently hovered (null = none). Triggers a redraw. */
  setHoveredPlayer(playerId: PlayerId | null): void;
  hoveredPlayer(): PlayerId | null;
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
  /**
   * Called each frame with any animation-driven audio cues (around-the-
   * horn throws, inning-end ball tosses) that crossed the cursor since
   * the last frame. Cues are derived from the event log up front, so the
   * loop just walks them with a parallel cursor and dispatches in order.
   */
  readonly onAnimCues?: (cues: readonly AnimAudioCue[]) => void;
  /**
   * Called every frame, even when there are no new events. Receives the
   * elapsed wall-clock seconds and the (possibly empty) batch of events
   * that just crossed the cursor. Used by /ambience to advance time-based
   * state (energy/arousal decay, wave envelopes) regardless of event flow.
   */
  readonly onTick?: (dtSeconds: number, events: readonly SimEvent[]) => void;
  /**
   * Read-once-per-frame supply of the live crowd state. Drives the bowl
   * density bump, flicker rate, front-row lean, and tower-glow brightness.
   * Optional — absent = the renderer falls back to neutral defaults.
   */
  readonly getCrowdState?: () => CrowdState | null;
  /**
   * Read-once-per-frame supply of the active wave envelope. Drives
   * `drawStadiumBowlFront`'s wave lift and (back) the upper deck. Returned
   * `strength` is in [0, 1]; 0 disables the wave entirely.
   */
  readonly getWaveEnvelope?: () => { centerAngleDeg?: number; strength?: number };
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
  // Parallel cursor through the precomputed animation-cue list (derived
  // from the event log). Recomputed whenever the active game changes.
  let animCues: readonly AnimAudioCue[] = computeAnimAudioCues(
    initialGame.events,
    initialGame.sceneCtx.isStarBatter
      ? { isStarBatter: initialGame.sceneCtx.isStarBatter }
      : {},
  );
  let animCueIdx = 0;
  let hoveredPlayerId: PlayerId | null = null;
  // Last drawn scene + transform, retained so the app can hit-test the
  // canvas in mouse handlers without re-running the scene reducer.
  let lastScene: ReturnType<typeof buildScene> | null = null;
  let lastTransform: ReturnType<typeof computeTransform> | null = null;

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
  const findAnimIdxAfter = (cues: readonly AnimAudioCue[], t: number): number => {
    let lo = 0;
    let hi = cues.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cues[mid]!.t > t) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };

  // Returns the events that just crossed the cursor and advances the index
  // even when no callback is registered (so a later subscription doesn't
  // replay the whole game from t=0).
  const collectDueEvents = (): SimEvent[] => {
    const batch: SimEvent[] = [];
    while (eventIdx < game.events.length && game.events[eventIdx]!.t <= simTime) {
      batch.push(game.events[eventIdx]!);
      eventIdx++;
    }
    return batch;
  };
  // Animation-cue parallel cursor — same fire-once-when-crossed semantics
  // as SimEvents, but on a precomputed list derived from the event log.
  const collectDueAnimCues = (): AnimAudioCue[] => {
    const batch: AnimAudioCue[] = [];
    while (animCueIdx < animCues.length && animCues[animCueIdx]!.t <= simTime) {
      batch.push(animCues[animCueIdx]!);
      animCueIdx++;
    }
    return batch;
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
    // Build the scene first so the static park art can react to game state
    // (current inning drives crowd density, simTime drives subtle ambient
    // animation). Drawing order is unchanged: field is painted, then sprites,
    // then HUD on top.
    const scene = buildScene(game.events, simTime, game.sceneCtx);
    const crowdState = options.getCrowdState?.() ?? null;
    const wave = options.getWaveEnvelope?.() ?? null;
    drawField(ctx, transform, {
      grassShade: game.sceneCtx.grassShade,
      skyColor: game.sceneCtx.skyColor,
      simTime: scene.simTime,
      inning: scene.inning,
      ...(game.sceneCtx.stadium ? { stadium: game.sceneCtx.stadium } : {}),
      ...(game.sceneCtx.homeTeamPrimary
        ? { homeTeamPrimary: game.sceneCtx.homeTeamPrimary }
        : {}),
      ...(game.sceneCtx.awayTeamPrimary
        ? { awayTeamPrimary: game.sceneCtx.awayTeamPrimary }
        : {}),
      ...(crowdState ? { crowdState } : {}),
      ...(wave?.centerAngleDeg !== undefined
        ? { waveCenterAngleDeg: wave.centerAngleDeg }
        : {}),
      ...(wave?.strength !== undefined ? { waveStrength: wave.strength } : {}),
    });
    lastScene = scene;
    lastTransform = transform;
    drawScene(ctx, transform, scene, {
      playerIndex: game.sceneCtx.input.playerIndex,
      hoveredPlayerId,
    });
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
    const dueEvents = collectDueEvents();
    if (dueEvents.length > 0 && options.onEvents) options.onEvents(dueEvents);
    if (options.onTick) options.onTick(dt, dueEvents);
    const dueAnimCues = collectDueAnimCues();
    if (dueAnimCues.length > 0 && options.onAnimCues) options.onAnimCues(dueAnimCues);
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
      animCueIdx = findAnimIdxAfter(animCues, simTime);
      draw();
    },
    currentSimTime() { return simTime; },
    isFinished() { return simTime >= finalT(game); },
    setActiveGame(newGame: ActiveGame) {
      game = newGame;
      // Re-anchor the cursor so we don't fire SFX for events that happened
      // before we tuned in to this channel.
      eventIdx = findIdxAfter(game, simTime);
      animCues = computeAnimAudioCues(
        newGame.events,
        newGame.sceneCtx.isStarBatter
          ? { isStarBatter: newGame.sceneCtx.isStarBatter }
          : {},
      );
      animCueIdx = findAnimIdxAfter(animCues, simTime);
      // Channel changes invalidate the prior scene's player ids.
      hoveredPlayerId = null;
      draw();
    },
    redraw() { draw(); },
    playerAtScreen(x: number, y: number) {
      if (!lastScene || !lastTransform) return null;
      const hit = findPlayerAtScreen(lastScene, lastTransform, x, y);
      return hit ? hit.id : null;
    },
    setHoveredPlayer(id: PlayerId | null) {
      if (hoveredPlayerId === id) return;
      hoveredPlayerId = id;
      draw();
    },
    hoveredPlayer() { return hoveredPlayerId; },
  };

  draw();
  if (options.autoStart) handle.start();
  return handle;
};
