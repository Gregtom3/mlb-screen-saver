import { generateInitialLeague } from '../content/index.js';
import { buildSchedule, buildLineup } from '../season/index.js';
import { buildLeagueHistory, type LeagueHistory } from '../season/history.js';
import { runGame } from '../sim/index.js';
import type { GameInput, SideInput, SimEvent } from '../sim/types.js';
import type { Player, PlayerId, Stadium, Team, TeamId } from '../world/types.js';
import {
  createRenderLoop,
  DEFAULT_TICKS_PER_SECOND,
  type ActiveGame,
  type RenderLoopHandle,
  type TeamStanding,
  type SceneContext,
} from '../render/index.js';
import { mountMenu, type GameMetadata, type LiveGameSummary } from '../ui/index.js';
import { buildSeasonAggregates, type FinishedGame, type SeasonAggregates } from '../stats/index.js';
import { buildProjections } from '../projections/index.js';
import type { ProjectionSet } from '../projections/types.js';
import {
  createSfxDispatcher,
  ensureAudio,
  setMuted,
  isMuted,
} from '../audio/index.js';

// Phase 3+ browser entry. Pre-simulates a few days of games for standings,
// then puts day N+1 on screen as 8 simultaneous "channels". Phase 5.5 adds
// the Tab/M stats menu over the canvas.

const QS = new URLSearchParams(globalThis.location?.search ?? '');
const SEED = QS.get('seed') ? parseSeed(QS.get('seed')!) : 0xba_5e_ba_11;
const HISTORY_DAYS = QS.get('history') ? parseInt(QS.get('history')!, 10) : 4;
const LIVE_DAY = QS.get('day') ? parseInt(QS.get('day')!, 10) : HISTORY_DAYS + 1;
const INITIAL_GAME = QS.get('game') ? parseInt(QS.get('game')!, 10) - 1 : 0;
// Phase 6: pre-simulate N prior seasons in their entirety. Each one is ~1200
// games / a few seconds in JS, so default low; opt in for richer history.
const PRIOR_SEASONS = QS.get('priorSeasons') ? parseInt(QS.get('priorSeasons')!, 10) : 1;
const PRIOR_SEASON_DAYS = QS.get('priorSeasonDays')
  ? parseInt(QS.get('priorSeasonDays')!, 10)
  : 0; // 0 = full schedule

const SPEED_PRESETS = [
  { label: '0.5×', tps: DEFAULT_TICKS_PER_SECOND * 0.5 },
  { label: '1×', tps: DEFAULT_TICKS_PER_SECOND },
  { label: '2×', tps: DEFAULT_TICKS_PER_SECOND * 2 },
  { label: '4×', tps: DEFAULT_TICKS_PER_SECOND * 4 },
];

function parseSeed(s: string): number {
  return s.startsWith('0x') ? parseInt(s, 16) : parseInt(s, 10);
}

const fnv = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

// Hash a string to a uniform [0, 1) so day/night picks are deterministic.
const hashFloat01 = (s: string): number => (fnv(s) % 0x10000) / 0x10000;

// Decide whether a game is played in daylight given the stadium's day-game
// bias. Bias 0 = always night, 1 = always day. Stable per gameId.
const isDayGameForGameId = (gameId: string, dayGameBias: number): boolean => {
  return hashFloat01(`${gameId}|day`) < dayGameBias;
};

// Day vs night sky palettes — picked from a small fixed set so the screensaver
// reads as time-of-day variation without hand-painting per stadium.
const SKY_DAY = '#5a8fb8';
const SKY_DUSK = '#3e4a72';
const SKY_NIGHT_FALLBACK = '#0e1a26';

const blendColors = (foreground: string, background: string, towardBg: number): string => {
  const parse = (hex: string) => {
    const c = hex.replace('#', '');
    return [
      parseInt(c.slice(0, 2), 16),
      parseInt(c.slice(2, 4), 16),
      parseInt(c.slice(4, 6), 16),
    ] as const;
  };
  const [fr, fg, fb] = parse(foreground);
  const [br, bg, bb] = parse(background);
  const r = Math.round(fr * (1 - towardBg) + br * towardBg);
  const g = Math.round(fg * (1 - towardBg) + bg * towardBg);
  const b = Math.round(fb * (1 - towardBg) + bb * towardBg);
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const sizeCanvas = (canvas: HTMLCanvasElement) => {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const width = Math.max(640, Math.floor(rect.width * dpr));
  const height = Math.max(480, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
};

interface LiveGame extends ActiveGame {
  readonly entry: { gameId: string; homeTeamId: TeamId; awayTeamId: TeamId };
}

const buildGameInput = (
  league: ReturnType<typeof generateInitialLeague>,
  entry: { gameId: string; homeTeamId: TeamId; awayTeamId: TeamId; stadiumId: string; day: number },
  seed: number,
): { input: GameInput; home: Team; away: Team; stadium: Stadium } => {
  const home = league.teams.find((t) => t.id === entry.homeTeamId)!;
  const away = league.teams.find((t) => t.id === entry.awayTeamId)!;
  const stadium = league.stadiums.find((s) => s.id === entry.stadiumId)!;
  const homeLineup = buildLineup(home, league.players, entry.day);
  const awayLineup = buildLineup(away, league.players, entry.day);
  const playerIndex = new Map(league.players.map((p) => [p.id, p]));
  const homeSide: SideInput = {
    teamId: home.id,
    battingOrder: homeLineup.battingOrder,
    startingPitcherId: homeLineup.startingPitcher,
    bullpen: homeLineup.bullpen,
    defenseByPosition: homeLineup.defenseByPosition,
  };
  const awaySide: SideInput = {
    teamId: away.id,
    battingOrder: awayLineup.battingOrder,
    startingPitcherId: awayLineup.startingPitcher,
    bullpen: awayLineup.bullpen,
    defenseByPosition: awayLineup.defenseByPosition,
  };
  const input: GameInput = {
    gameId: entry.gameId,
    stadiumId: entry.stadiumId,
    home: homeSide,
    away: awaySide,
    playerIndex,
    seed: seed ^ fnv(entry.gameId),
    stadiumQuirk: stadium.quirk,
  };
  return { input, home, away, stadium };
};

const buildSceneCtxFor = (
  league: ReturnType<typeof generateInitialLeague>,
  input: GameInput,
  homeTeam: Team,
  stadium: Stadium,
): SceneContext => {
  const teamColors = new Map(
    league.teams.map((t) => [t.id, { primary: t.colors.primary, secondary: t.colors.secondary, accent: t.colors.accent }]),
  );
  const teamAbbr = new Map(league.teams.map((t) => [t.id, t.abbr]));
  // Day/night per game: stable per gameId, weighted by the stadium's
  // dayGameBias. Day games get a brighter sky; night games keep the dark
  // home-color blend so the field reads warm under "the lights".
  const isDay = isDayGameForGameId(input.gameId, stadium.atmosphere.dayGameBias);
  const nightSky = blendColors(homeTeam.colors.primary, SKY_NIGHT_FALLBACK, 0.78);
  const skyColor = isDay
    ? blendColors(SKY_DAY, homeTeam.colors.primary, 0.18)
    : hashFloat01(`${input.gameId}|dusk`) < 0.18
      ? blendColors(SKY_DUSK, homeTeam.colors.primary, 0.25)
      : nightSky;

  return {
    input,
    teamColors,
    teamAbbr,
    stadiumName: stadium.name,
    grassShade: stadium.atmosphere.grassShade,
    skyColor,
    stadium,
    homeTeamPrimary: homeTeam.colors.primary,
  };
};

const setupAudioToggle = (sfx: { setEnabled(b: boolean): void; isEnabled(): boolean }) => {
  // Audio is off by default. The AudioContext stays uncreated and the
  // dispatcher stays disabled until the user explicitly clicks the audio
  // button. First click unlocks (creates the context + enables the
  // dispatcher + unmutes); subsequent clicks toggle mute on the bus.
  const btn = document.getElementById('audio-toggle') as HTMLButtonElement | null;
  const refreshLabel = () => {
    if (!btn) return;
    // Audible only when both unlocked and unmuted; everything else reads
    // as "off" (the muted glyph) since no sound emerges.
    const audible = sfx.isEnabled() && !isMuted();
    btn.textContent = audible ? '🔊 audio' : '🔇 audio';
  };
  refreshLabel();

  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!sfx.isEnabled()) {
      ensureAudio();
      sfx.setEnabled(true);
      setMuted(false);
    } else {
      setMuted(!isMuted());
    }
    refreshLabel();
  });
};

const setupControls = (handle: RenderLoopHandle, channelLabel: HTMLElement | null, getChannelText: () => string) => {
  const playPauseBtn = document.getElementById('play-pause') as HTMLButtonElement | null;
  const speedSelect = document.getElementById('speed') as HTMLSelectElement | null;

  if (playPauseBtn) {
    const updateLabel = () => {
      playPauseBtn.textContent = handle.isPlaying() ? '⏸ pause' : '▶ play';
    };
    updateLabel();
    playPauseBtn.addEventListener('click', () => {
      if (handle.isPlaying()) handle.stop();
      else handle.start();
      updateLabel();
    });
  }

  if (speedSelect) {
    for (const preset of SPEED_PRESETS) {
      const opt = document.createElement('option');
      opt.value = String(preset.tps);
      opt.textContent = preset.label;
      if (preset.tps === DEFAULT_TICKS_PER_SECOND) opt.selected = true;
      speedSelect.appendChild(opt);
    }
    speedSelect.addEventListener('change', () => {
      const tps = parseFloat(speedSelect.value);
      handle.setSpeed(tps);
    });
  }

  if (channelLabel) {
    const refresh = () => {
      channelLabel.textContent = getChannelText();
    };
    refresh();
    setInterval(refresh, 500);
  }
};

const main = () => {
  const canvas = document.getElementById('field') as HTMLCanvasElement | null;
  if (!canvas) {
    console.error('No #field canvas in DOM');
    return;
  }
  sizeCanvas(canvas);

  const league = generateInitialLeague(SEED);
  const schedule = buildSchedule(league.teams, league.season.year);

  // ---- Phase 6: simulate prior seasons (full or truncated) to populate the
  // History view. Each prior season uses a distinct seed offset so outcomes
  // differ year-over-year. The league roster itself doesn't age across
  // seasons yet — that lands when retirement/draft logic does.
  const priorSummaries: { year: number; agg: SeasonAggregates; teamGames: number }[] = [];
  const gameMetadata = new Map<string, GameMetadata>();
  const PRIOR_SEASON_GOLDEN_RATIO = 0x9e_37_79_b9;
  for (let i = 0; i < PRIOR_SEASONS; i++) {
    const priorYear = league.season.year - PRIOR_SEASONS + i;
    const priorSeed = SEED ^ Math.imul(PRIOR_SEASON_GOLDEN_RATIO, i + 1);
    const totalDays = PRIOR_SEASON_DAYS > 0
      ? Math.min(PRIOR_SEASON_DAYS, schedule.totalDays)
      : schedule.totalDays;
    const games: FinishedGame[] = [];
    for (let day = 1; day <= totalDays; day++) {
      for (const entry of schedule.entries.filter((e) => e.day === day)) {
        const { input } = buildGameInput(league, entry, priorSeed);
        const events = runGame(input);
        games.push({ events, input, day });
      }
    }
    const agg = buildSeasonAggregates(games, league.teams, league.players, priorYear);
    priorSummaries.push({ year: priorYear, agg, teamGames: totalDays });
  }

  // ---- Pre-simulate current-season history days. Stash events for /stats so
  // the menu has full season context (PA/PA splits, hit charts, WP timelines).
  const historyGames: FinishedGame[] = [];
  for (let day = 1; day < LIVE_DAY; day++) {
    for (const entry of schedule.entries.filter((e) => e.day === day)) {
      const { input } = buildGameInput(league, entry, SEED);
      const events = runGame(input);
      historyGames.push({ events, input, day });
      gameMetadata.set(entry.gameId, {
        gameId: entry.gameId,
        day: entry.day,
        homeTeamId: entry.homeTeamId,
        awayTeamId: entry.awayTeamId,
        homeStartingPitcher: input.home.startingPitcherId,
        awayStartingPitcher: input.away.startingPitcherId,
      });
    }
  }
  const aggregates: SeasonAggregates = buildSeasonAggregates(
    historyGames,
    league.teams,
    league.players,
    league.season.year,
  );
  // Convert TeamLine → TeamStanding for the existing HUD strip.
  const standings = new Map<TeamId, TeamStanding>();
  for (const team of league.teams) {
    const line = aggregates.teams.get(team.id);
    standings.set(team.id, line ? { wins: line.W, losses: line.L } : { wins: 0, losses: 0 });
  }

  // ---- Pre-simulate live-day games and keep their event logs. The Live
  // view in the stats menu reads partial state out of these.
  const liveDayEntries = schedule.entries.filter((e) => e.day === LIVE_DAY);
  if (liveDayEntries.length === 0) {
    console.error(`No games on day ${LIVE_DAY}`);
    return;
  }
  const liveGames: LiveGame[] = liveDayEntries.map((entry) => {
    const { input, home, stadium } = buildGameInput(league, entry, SEED);
    const events = runGame(input);
    const sceneCtx = buildSceneCtxFor(league, input, home, stadium);
    gameMetadata.set(entry.gameId, {
      gameId: entry.gameId,
      day: entry.day,
      homeTeamId: entry.homeTeamId,
      awayTeamId: entry.awayTeamId,
      homeStartingPitcher: input.home.startingPitcherId,
      awayStartingPitcher: input.away.startingPitcherId,
    });
    return {
      events,
      sceneCtx,
      entry: {
        gameId: entry.gameId,
        homeTeamId: entry.homeTeamId,
        awayTeamId: entry.awayTeamId,
      },
    } satisfies LiveGame;
  });

  // Aggregate live-day finals too so the menu's leaderboards reflect them.
  // Live tiles use the timelines for sparklines.
  const liveFinishedGames: FinishedGame[] = liveGames.map((g) => ({
    events: g.events as readonly SimEvent[],
    input: g.sceneCtx.input,
    day: LIVE_DAY,
  }));
  // Re-build aggregates including live finals (cheap; <1ms for 8 games).
  const aggregatesWithLive = buildSeasonAggregates(
    [...historyGames, ...liveFinishedGames],
    league.teams,
    league.players,
    league.season.year,
  );

  let selectedIdx = Math.max(0, Math.min(liveGames.length - 1, INITIAL_GAME));

  const channelLabel = document.getElementById('channel-label');
  const getChannelText = () => {
    const g = liveGames[selectedIdx]!;
    const home = league.teams.find((t) => t.id === g.entry.homeTeamId);
    const away = league.teams.find((t) => t.id === g.entry.awayTeamId);
    return `ch ${selectedIdx + 1}/${liveGames.length}  ·  ${away?.abbr} @ ${home?.abbr}`;
  };

  // Audio dispatcher: stays inert until the user clicks the audio toggle (a
  // user gesture is required to start the AudioContext). Once unlocked it
  // stays enabled; mute is toggled separately on the bus.
  const sfx = createSfxDispatcher();

  const handle = createRenderLoop(canvas, liveGames[selectedIdx]!, {
    autoStart: true,
    getStandings: () => standings,
    getChannelInfo: () => ({ currentIdx: selectedIdx, total: liveGames.length }),
    onEvents: (events) => sfx.dispatch(events),
  });

  setupAudioToggle(sfx);

  const switchChannel = (delta: number) => {
    const next = (selectedIdx + delta + liveGames.length) % liveGames.length;
    if (next === selectedIdx) return;
    selectedIdx = next;
    handle.setActiveGame(liveGames[selectedIdx]!);
    if (channelLabel) channelLabel.textContent = getChannelText();
  };

  const setChannelByGameId = (gameId: string) => {
    const idx = liveGames.findIndex((g) => g.entry.gameId === gameId);
    if (idx >= 0 && idx !== selectedIdx) {
      selectedIdx = idx;
      handle.setActiveGame(liveGames[selectedIdx]!);
      if (channelLabel) channelLabel.textContent = getChannelText();
    }
  };

  globalThis.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowRight' || ev.key === 'Right') {
      switchChannel(+1);
      ev.preventDefault();
    } else if (ev.key === 'ArrowLeft' || ev.key === 'Left') {
      switchChannel(-1);
      ev.preventDefault();
    } else if (/^[1-9]$/.test(ev.key)) {
      const target = parseInt(ev.key, 10) - 1;
      if (target < liveGames.length) {
        selectedIdx = target;
        handle.setActiveGame(liveGames[selectedIdx]!);
        if (channelLabel) channelLabel.textContent = getChannelText();
      }
    }
  });

  setupControls(handle, channelLabel, getChannelText);

  const prevChannelBtn = document.getElementById('prev-channel') as HTMLButtonElement | null;
  const nextChannelBtn = document.getElementById('next-channel') as HTMLButtonElement | null;
  prevChannelBtn?.addEventListener('click', () => switchChannel(-1));
  nextChannelBtn?.addEventListener('click', () => switchChannel(+1));

  // ---- Stats menu (phase 5.5).
  const playerIndex = new Map<PlayerId, Player>(league.players.map((p) => [p.id, p]));
  const stadiumIndex = new Map(league.stadiums.map((s) => [s.id, s]));
  const teamGamesPlayed = LIVE_DAY; // history days + live day, all complete

  // Phase 6: build the LeagueHistory once. Retired set stays empty until we
  // ship aging/retirement; HoF then trips automatically when it's populated.
  const history: LeagueHistory = buildLeagueHistory({
    seasons: priorSummaries,
    teams: league.teams,
    playerIndex,
    retiredPlayers: new Set(),
  });

  // Lazy projections — single cached set per session.
  let projectionsCache: ProjectionSet | null = null;
  const getProjections = (): ProjectionSet => {
    if (!projectionsCache) {
      projectionsCache = buildProjections({
        seasonYear: league.season.year,
        teams: league.teams,
        schedule,
        aggregates: aggregatesWithLive,
        currentDay: LIVE_DAY,
        simulations: 500, // dial down for browser snappiness; 1000 still cheap
        seed: SEED,
      });
    }
    return projectionsCache;
  };

  const buildLiveSummaries = (): LiveGameSummary[] => {
    return liveGames.map((g) => {
      const tl = aggregatesWithLive.wpTimelines.get(g.entry.gameId);
      // Final state — all games are complete in this snapshot mode.
      const last = g.events[g.events.length - 1];
      const finalRuns = last && last.kind === 'gameEnd' ? last.finalRuns : { home: 0, away: 0 };
      return {
        gameId: g.entry.gameId,
        homeTeamId: g.entry.homeTeamId,
        awayTeamId: g.entry.awayTeamId,
        score: { home: finalRuns.home, away: finalRuns.away },
        inning: 9,
        half: 'bottom' as const,
        outs: 3,
        wpTimeline: tl,
      };
    });
  };

  const menu = mountMenu(document.body, {
    getAggregates: () => aggregatesWithLive,
    getTeamGamesPlayed: () => teamGamesPlayed,
    teams: league.teams,
    playerIndex,
    schedule,
    stadiums: stadiumIndex,
    getProjections,
    getLiveGames: buildLiveSummaries,
    setLiveChannel: (gameId) => {
      setChannelByGameId(gameId);
      menu.close();
    },
    getHistory: () => history,
    getGameMetadata: (gameId) => gameMetadata.get(gameId),
  });

  const openMenuBtn = document.getElementById('open-menu') as HTMLButtonElement | null;
  openMenuBtn?.addEventListener('click', () => menu.toggle());

  globalThis.addEventListener('keydown', (ev) => {
    if (ev.key === 'Tab' || ev.key === 'm' || ev.key === 'M') {
      menu.toggle();
      ev.preventDefault();
    } else if (ev.key === 'Escape' && menu.isOpen()) {
      menu.close();
      ev.preventDefault();
    } else if (menu.isOpen() && /^[1-5]$/.test(ev.key)) {
      const views: ('league' | 'teams' | 'players' | 'live' | 'history')[] =
        ['league', 'teams', 'players', 'live', 'history'];
      const idx = parseInt(ev.key, 10) - 1;
      const view = views[idx];
      if (view) menu.setView(view);
      ev.preventDefault();
    }
  });

  globalThis.addEventListener('resize', () => {
    sizeCanvas(canvas);
    handle.redraw();
  });

  // ---- Hover + click on field sprites. The render loop draws every player
  // with a faint name label; hovering crisps the label up, and clicking
  // opens that player's stats view in the menu.
  const screenCoordsForEvent = (ev: MouseEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    // The canvas backing store is sized in device pixels (see sizeCanvas);
    // CSS coordinates need to be scaled by the same ratio so hit-testing
    // against worldToScreen() (which produces backing-store px) lines up.
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (ev.clientX - rect.left) * scaleX,
      y: (ev.clientY - rect.top) * scaleY,
    };
  };

  canvas.addEventListener('mousemove', (ev) => {
    if (menu.isOpen()) return;
    const { x, y } = screenCoordsForEvent(ev);
    const id = handle.playerAtScreen(x, y);
    handle.setHoveredPlayer(id);
    canvas.style.cursor = id ? 'pointer' : '';
  });

  canvas.addEventListener('mouseleave', () => {
    handle.setHoveredPlayer(null);
    canvas.style.cursor = '';
  });

  canvas.addEventListener('click', (ev) => {
    if (menu.isOpen()) return;
    const { x, y } = screenCoordsForEvent(ev);
    const id = handle.playerAtScreen(x, y);
    if (id) {
      ev.preventDefault();
      menu.goToPlayer(id);
    }
  });
};

main();
