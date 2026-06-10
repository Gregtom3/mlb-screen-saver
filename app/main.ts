import { generateInitialLeague } from '../content/index.js';
import { buildSchedule, buildLineup } from '../season/index.js';
import { buildLeagueHistory, type LeagueHistory } from '../season/history.js';
import { runGame } from '../sim/index.js';
import type { GameInput, SideInput, SimEvent } from '../sim/types.js';
import type { Player, PlayerId, Stadium, Team, TeamId } from '../world/types.js';
import type { BvpLine } from '../stats/types.js';
import {
  createRenderLoop,
  DEFAULT_TICKS_PER_SECOND,
  type ActiveGame,
  type RenderLoopHandle,
  type TeamStanding,
  type SceneContext,
} from '../render/index.js';
import { mountMenu, type GameMetadata, type LiveGameSummary } from '../ui/index.js';
import {
  aggregateGame,
  buildSeasonAggregates,
  type AggregatorContext,
  type FinishedGame,
  type SeasonAggregates,
} from '../stats/index.js';
import { buildProjections } from '../projections/index.js';
import type { ProjectionSet } from '../projections/types.js';
import {
  createSfxDispatcher,
  ensureAudio,
  setMuted,
  isMuted,
} from '../audio/index.js';
import {
  buildStarSet,
  createAmbienceReducer,
  createWaveTracker,
  initialCrowdState,
  type CrowdState,
} from '../ambience/index.js';

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

// ---- Saved progress. Determinism is the storage engine: persisting just
// (seed, seasonIdx, day) lets a reload re-simulate the exact same league back
// to where the viewer left off — completed seasons and all. Keyed by seed so
// different leagues keep independent saves.
interface SavedProgress {
  readonly v: 1;
  readonly seasonIdx: number;
  readonly day: number;
}

const SAVE_KEY = `8bb:progress:${SEED.toString(16)}`;

const loadProgress = (): SavedProgress | null => {
  try {
    const raw = globalThis.localStorage?.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedProgress>;
    if (parsed.v !== 1) return null;
    if (typeof parsed.seasonIdx !== 'number' || typeof parsed.day !== 'number') return null;
    if (parsed.seasonIdx < 0 || parsed.day < 1) return null;
    return { v: 1, seasonIdx: parsed.seasonIdx, day: parsed.day };
  } catch {
    return null;
  }
};

const saveProgress = (p: SavedProgress): void => {
  try {
    globalThis.localStorage?.setItem(SAVE_KEY, JSON.stringify(p));
  } catch {
    // Storage unavailable (private mode, quota) — the league still runs,
    // it just starts fresh next load.
  }
};

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

// Extract in-progress game state by replaying events up to a given sim tick.
// Returns the current inning, half, outs, and score at that moment.
const extractLiveState = (
  events: readonly SimEvent[],
  upToTick: number,
): { inning: number; half: 'top' | 'bottom'; outs: number; scoreHome: number; scoreAway: number } => {
  let inning = 1;
  let half: 'top' | 'bottom' = 'top';
  let outs = 0;
  let scoreHome = 0;
  let scoreAway = 0;
  for (const ev of events) {
    if (ev.t > upToTick) break;
    if (ev.kind === 'baserunner' && ev.to === 0 && !ev.out) {
      if (half === 'top') scoreAway += 1;
      else scoreHome += 1;
    } else if (ev.kind === 'inningEnd') {
      if (ev.halfInning === 'top') half = 'bottom';
      else { inning = ev.inning + 1; half = 'top'; }
      outs = 0;
    } else if (ev.kind === 'atBatEnd') {
      const o = ev.outcome;
      const delta = o === 'double-play' ? 2 : o === 'triple-play' ? 3
        : (o === 'walk' || o === 'hit-by-pitch' || o === 'single' || o === 'double'
           || o === 'triple' || o === 'home-run' || o === 'reached-on-error') ? 0 : 1;
      outs = Math.min(3, outs + delta);
    } else if (ev.kind === 'gameEnd') {
      scoreHome = ev.finalRuns.home;
      scoreAway = ev.finalRuns.away;
    }
  }
  return { inning, half, outs, scoreHome, scoreAway };
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
    coachingStaff: home.coachingStaff,
  };
  const awaySide: SideInput = {
    teamId: away.id,
    battingOrder: awayLineup.battingOrder,
    startingPitcherId: awayLineup.startingPitcher,
    bullpen: awayLineup.bullpen,
    defenseByPosition: awayLineup.defenseByPosition,
    coachingStaff: away.coachingStaff,
  };
  const input: GameInput = {
    gameId: entry.gameId,
    stadiumId: entry.stadiumId,
    home: homeSide,
    away: awaySide,
    playerIndex,
    seed: seed ^ fnv(entry.gameId),
    stadiumQuirk: stadium.quirk,
    stadiumDimensions: stadium.dimensions,
  };
  return { input, home, away, stadium };
};

interface SceneCtxExtras {
  readonly seasonAggregates?: SeasonAggregates;
  readonly careerBvp?: ReadonlyMap<PlayerId, ReadonlyMap<PlayerId, BvpLine>>;
  readonly isStarBatter?: (playerId: PlayerId) => boolean;
}

const buildSceneCtxFor = (
  league: ReturnType<typeof generateInitialLeague>,
  input: GameInput,
  homeTeam: Team,
  awayTeam: Team,
  stadium: Stadium,
  extras: SceneCtxExtras = {},
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
    awayTeamPrimary: awayTeam.colors.primary,
    ...(extras.isStarBatter ? { isStarBatter: extras.isStarBatter } : {}),
    ...(extras.seasonAggregates ? { seasonAggregates: extras.seasonAggregates } : {}),
    ...(extras.careerBvp ? { careerBvp: extras.careerBvp } : {}),
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

  // ---- Endless-day season state. An explicit ?day= in the URL wins;
  // otherwise resume from the saved (seasonIdx, day) position. Same-season
  // days share one seed; later seasons re-seed so outcomes differ
  // year-over-year (offset clear of the prior-season seed family).
  const seasonSeedFor = (idx: number): number =>
    idx === 0 ? SEED : (SEED ^ Math.imul(PRIOR_SEASON_GOLDEN_RATIO, 7000 + idx)) >>> 0;
  const saved = QS.get('day') ? null : loadProgress();
  let seasonIdx = saved?.seasonIdx ?? 0;
  let seasonYear = league.season.year + seasonIdx;
  let activeSchedule = seasonIdx === 0 ? schedule : buildSchedule(league.teams, seasonYear);
  let currentDay = Math.max(1, Math.min(saved?.day ?? LIVE_DAY, activeSchedule.totalDays));

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

  // ---- Deterministically replay seasons completed in previous sessions so
  // the History view resumes where the viewer left off. Same schedules, same
  // seeds, same outcomes as when they originally played out on screen.
  for (let i = 0; i < seasonIdx; i++) {
    const y = league.season.year + i;
    const sched = i === 0 ? schedule : buildSchedule(league.teams, y);
    const seedI = seasonSeedFor(i);
    const games: FinishedGame[] = [];
    for (let day = 1; day <= sched.totalDays; day++) {
      for (const entry of sched.entries.filter((e) => e.day === day)) {
        const { input } = buildGameInput(league, entry, seedI);
        games.push({ events: runGame(input), input, day });
      }
    }
    priorSummaries.push({
      year: y,
      agg: buildSeasonAggregates(games, league.teams, league.players, y),
      teamGames: sched.totalDays,
    });
  }

  // ---- Pre-simulate current-season history days. Stash events for /stats so
  // the menu has full season context (PA/PA splits, hit charts, WP timelines).
  const historyGames: FinishedGame[] = [];
  for (let day = 1; day < currentDay; day++) {
    for (const entry of activeSchedule.entries.filter((e) => e.day === day)) {
      const { input } = buildGameInput(league, entry, seasonSeedFor(seasonIdx));
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
    seasonYear,
  );
  // Convert TeamLine → TeamStanding for the existing HUD strip.
  const standings = new Map<TeamId, TeamStanding>();
  for (const team of league.teams) {
    const line = aggregates.teams.get(team.id);
    standings.set(team.id, line ? { wins: line.W, losses: line.L } : { wins: 0, losses: 0 });
  }

  // ---- Endless-day machinery. The league runs forever: when every game on
  // the live day finishes, the next day is simulated and put on the air; when
  // the schedule runs out, the finished season is banked into history and a
  // fresh one begins. All of this is driven from the render loop's onTick.
  interface LiveGameSeed {
    readonly entry: { gameId: string; homeTeamId: TeamId; awayTeamId: TeamId };
    readonly input: GameInput;
    readonly home: Team;
    readonly away: Team;
    readonly stadium: Stadium;
    readonly events: readonly SimEvent[];
  }

  // Simulate one day's slate and register its metadata for the menus.
  const simulateDaySeeds = (day: number): LiveGameSeed[] =>
    activeSchedule.entries
      .filter((e) => e.day === day)
      .map((entry) => {
        const { input, home, away, stadium } = buildGameInput(
          league,
          entry,
          seasonSeedFor(seasonIdx),
        );
        const events = runGame(input);
        gameMetadata.set(entry.gameId, {
          gameId: entry.gameId,
          day: entry.day,
          homeTeamId: entry.homeTeamId,
          awayTeamId: entry.awayTeamId,
          homeStartingPitcher: input.home.startingPitcherId,
          awayStartingPitcher: input.away.startingPitcherId,
        });
        return {
          entry: {
            gameId: entry.gameId,
            homeTeamId: entry.homeTeamId,
            awayTeamId: entry.awayTeamId,
          },
          input,
          home,
          away,
          stadium,
          events,
        };
      });

  // Two-phase build: simulate every live game first (we need their finished
  // events to roll into aggregatesWithLive + careerBvp), then build per-game
  // SceneContexts once those aggregates exist. The render loop's batter card
  // reads season AVG/HR/RBI and BvP off SceneContext, so the context
  // wouldn't be useful built earlier.
  let liveGameSeeds: LiveGameSeed[] = simulateDaySeeds(currentDay);
  if (liveGameSeeds.length === 0) {
    console.error(`No games on day ${currentDay}`);
    return;
  }

  // Aggregate live-day finals too so the menu's leaderboards reflect them.
  // Live tiles use the timelines for sparklines. Later days fold into this
  // same object incrementally (aggregateGame mutates in place).
  const aggCtx: AggregatorContext = {
    teamsById: new Map(league.teams.map((t) => [t.id, t])),
    playerIndex: new Map(league.players.map((p) => [p.id, p])),
  };
  let aggregatesWithLive = buildSeasonAggregates(
    [
      ...historyGames,
      ...liveGameSeeds.map((g) => ({ events: g.events, input: g.input, day: currentDay })),
    ],
    league.teams,
    league.players,
    seasonYear,
  );
  // The aggregates carry everything the menus need — free the raw history
  // event logs so a long-running session's memory stays flat.
  historyGames.length = 0;

  // Build LeagueHistory now (was below) so each live game's SceneContext
  // can carry the careerBvp map for the HUD batter card. The retired-set
  // stays empty until aging/retirement ships; HoF trips automatically once
  // it's populated.
  const playerIndex = new Map<PlayerId, Player>(league.players.map((p) => [p.id, p]));
  const stadiumIndex = new Map(league.stadiums.map((s) => [s.id, s]));
  let history: LeagueHistory = buildLeagueHistory({
    seasons: priorSummaries,
    teams: league.teams,
    playerIndex,
    retiredPlayers: new Set(),
  });

  // Per-team player rosters — used by buildStarSet for the home/away player
  // pools. Built once before liveGames so the SceneContext for each channel
  // can carry an `isStarBatter` predicate (drives walk-up jingle intensity).
  const teamPlayersById = new Map<TeamId, Player[]>();
  for (const p of league.players) {
    if (p.teamId === null) continue;
    const list = teamPlayersById.get(p.teamId) ?? [];
    list.push(p);
    teamPlayersById.set(p.teamId, list);
  }

  // Phase 2 of the live-game build: now that aggregatesWithLive and history
  // exist, mint a SceneContext per game wired to both. The HUD batter card
  // pulls season AVG/HR/RBI from `aggregatesWithLive` and "vs PITCHER"
  // matchup totals from a combination of that map plus history.careerBvp.
  const mintLiveGames = (seeds: readonly LiveGameSeed[]): LiveGame[] =>
    seeds.map((seed) => {
      const stars = buildStarSet({
        homeTeamPlayers: teamPlayersById.get(seed.home.id) ?? [],
        awayTeamPlayers: teamPlayersById.get(seed.away.id) ?? [],
        aggregates: aggregatesWithLive,
      });
      const sceneCtx = buildSceneCtxFor(league, seed.input, seed.home, seed.away, seed.stadium, {
        seasonAggregates: aggregatesWithLive,
        careerBvp: history.careerBvp,
        isStarBatter: (id) => stars.has(id),
      });
      return {
        events: seed.events,
        sceneCtx,
        entry: seed.entry,
      } satisfies LiveGame;
    });
  let liveGames: LiveGame[] = mintLiveGames(liveGameSeeds);

  let selectedIdx = Math.max(0, Math.min(liveGames.length - 1, INITIAL_GAME));

  const channelLabel = document.getElementById('channel-label');
  const getChannelText = () => {
    const g = liveGames[selectedIdx]!;
    const home = league.teams.find((t) => t.id === g.entry.homeTeamId);
    const away = league.teams.find((t) => t.id === g.entry.awayTeamId);
    const yearTag = seasonIdx > 0 ? `  ·  year ${seasonYear}` : '';
    return `ch ${selectedIdx + 1}/${liveGames.length}  ·  ${away?.abbr} @ ${home?.abbr}  ·  day ${currentDay}${yearTag}`;
  };

  // Audio dispatcher: stays inert until the user clicks the audio toggle (a
  // user gesture is required to start the AudioContext). Once unlocked it
  // stays enabled; mute is toggled separately on the bus.
  const sfx = createSfxDispatcher();

  // Ambience runtime: one reducer + wave tracker per channel, swapped when
  // the user changes channels. The reducer ingests the same SimEvent stream
  // the SFX dispatcher does, but produces the continuous CrowdState that
  // both audio (bed, reactions, walk-up) and the renderer (bowl wave,
  // density, lighting) read each frame.
  const buildAmbienceFor = (g: LiveGame) => {
    const stars = buildStarSet({
      homeTeamPlayers: teamPlayersById.get(g.entry.homeTeamId) ?? [],
      awayTeamPlayers: teamPlayersById.get(g.entry.awayTeamId) ?? [],
      aggregates: aggregatesWithLive,
    });
    return {
      reducer: createAmbienceReducer({
        homeTeamId: g.entry.homeTeamId,
        awayTeamId: g.entry.awayTeamId,
        stars,
      }),
      wave: createWaveTracker(),
    };
  };
  let ambience = buildAmbienceFor(liveGames[selectedIdx]!);
  let crowdState: CrowdState = initialCrowdState();

  const handle = createRenderLoop(canvas, liveGames[selectedIdx]!, {
    autoStart: true,
    getStandings: () => standings,
    getChannelInfo: () => ({ currentIdx: selectedIdx, total: liveGames.length }),
    onEvents: (events) => sfx.dispatch(events),
    onAnimCues: (cues) => sfx.dispatchAnim(cues),
    onTick: (dt, events) => {
      const frame = ambience.reducer.step(events, dt);
      crowdState = frame.state;
      ambience.wave.spawnFromPulses(frame.pulses);
      ambience.wave.advance(dt);
      sfx.applyAmbience?.({ state: frame.state, pulses: frame.pulses });
      directorTick();
    },
    getCrowdState: () => crowdState,
    getWaveEnvelope: () => ambience.wave.current(),
  });

  setupAudioToggle(sfx);

  const onChannelChanged = () => {
    ambience = buildAmbienceFor(liveGames[selectedIdx]!);
    crowdState = initialCrowdState();
  };

  const refreshChannelLabel = () => {
    if (channelLabel) channelLabel.textContent = getChannelText();
  };

  // ---- Auto-director + endless days. When the channel we're watching goes
  // final, hop to the most interesting game still in progress; when the whole
  // slate is final, advance to the next day (and the next season after that).
  // A manual channel change holds the director off for a while so the user
  // can linger on a final scoreboard if they want to.
  let lastManualSwitchAt = -Infinity;
  const MANUAL_HOLD_MS = 30_000;

  const gameEndT = (g: LiveGame): number => {
    const last = g.events[g.events.length - 1];
    return last ? last.t + 60 : 0;
  };

  // Interest = late and close. Uses only state at the current tick, so the
  // director never peeks ahead at outcomes the viewer hasn't seen.
  const pickMostInteresting = (candidates: readonly number[], tick: number): number => {
    let best = candidates[0]!;
    let bestScore = -Infinity;
    for (const i of candidates) {
      const g = liveGames[i]!;
      const { inning, scoreHome, scoreAway } = extractLiveState(g.events, tick);
      const s = inning * 1.5 - Math.abs(scoreHome - scoreAway) * 2;
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    return best;
  };

  const refreshStandings = () => {
    for (const team of league.teams) {
      const line = aggregatesWithLive.teams.get(team.id);
      standings.set(team.id, line ? { wins: line.W, losses: line.L } : { wins: 0, losses: 0 });
    }
  };

  // Bank the finished season into the History view and start a fresh one.
  // Rosters carry over unchanged (aging/retirement is future work) but the
  // schedule, seed, aggregates, and standings all reset for the new year.
  const rolloverSeason = () => {
    priorSummaries.push({
      year: seasonYear,
      agg: aggregatesWithLive,
      teamGames: activeSchedule.totalDays,
    });
    history = buildLeagueHistory({
      seasons: priorSummaries,
      teams: league.teams,
      playerIndex,
      retiredPlayers: new Set(),
    });
    seasonIdx += 1;
    seasonYear += 1;
    activeSchedule = buildSchedule(league.teams, seasonYear);
    aggregatesWithLive = buildSeasonAggregates([], league.teams, league.players, seasonYear);
    for (const team of league.teams) standings.set(team.id, { wins: 0, losses: 0 });
    currentDay = 0; // advanceDay bumps to 1
  };

  const advanceDay = () => {
    // Standings count the day that just ended (the agg already includes it),
    // but never the new day's pre-simulated finals — no spoilers on the strip.
    refreshStandings();
    if (currentDay >= activeSchedule.totalDays) rolloverSeason();
    currentDay += 1;
    saveProgress({ v: 1, seasonIdx, day: currentDay });
    liveGameSeeds = simulateDaySeeds(currentDay);
    for (const seed of liveGameSeeds) {
      aggregateGame(
        { events: seed.events, input: seed.input, day: currentDay },
        aggregatesWithLive,
        aggCtx,
      );
      (aggregatesWithLive as unknown as { gamesProcessed: number }).gamesProcessed += 1;
    }
    liveGames = mintLiveGames(liveGameSeeds);
    selectedIdx = Math.min(selectedIdx, liveGames.length - 1);
    projectionsCache = null;
    handle.setActiveGame(liveGames[selectedIdx]!);
    handle.jumpTo(0);
    onChannelChanged();
    refreshChannelLabel();
  };

  const directorTick = () => {
    if (!handle.isFinished()) return;
    const tick = handle.currentSimTime();
    const stillLive = liveGames
      .map((_, i) => i)
      .filter((i) => i !== selectedIdx && gameEndT(liveGames[i]!) > tick);
    if (stillLive.length === 0) {
      advanceDay();
      return;
    }
    if (performance.now() - lastManualSwitchAt < MANUAL_HOLD_MS) return;
    selectedIdx = pickMostInteresting(stillLive, tick);
    handle.setActiveGame(liveGames[selectedIdx]!);
    onChannelChanged();
    refreshChannelLabel();
  };

  const switchChannel = (delta: number) => {
    const next = (selectedIdx + delta + liveGames.length) % liveGames.length;
    if (next === selectedIdx) return;
    lastManualSwitchAt = performance.now();
    selectedIdx = next;
    handle.setActiveGame(liveGames[selectedIdx]!);
    onChannelChanged();
    refreshChannelLabel();
  };

  const setChannelByGameId = (gameId: string) => {
    const idx = liveGames.findIndex((g) => g.entry.gameId === gameId);
    if (idx >= 0 && idx !== selectedIdx) {
      lastManualSwitchAt = performance.now();
      selectedIdx = idx;
      handle.setActiveGame(liveGames[selectedIdx]!);
      onChannelChanged();
      refreshChannelLabel();
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
      if (target < liveGames.length && target !== selectedIdx) {
        lastManualSwitchAt = performance.now();
        selectedIdx = target;
        handle.setActiveGame(liveGames[selectedIdx]!);
        onChannelChanged();
        refreshChannelLabel();
      }
    }
  });

  setupControls(handle, channelLabel, getChannelText);

  const prevChannelBtn = document.getElementById('prev-channel') as HTMLButtonElement | null;
  const nextChannelBtn = document.getElementById('next-channel') as HTMLButtonElement | null;
  prevChannelBtn?.addEventListener('click', () => switchChannel(-1));
  nextChannelBtn?.addEventListener('click', () => switchChannel(+1));

  // ---- Stats menu (phase 5.5). playerIndex / stadiumIndex / teamGamesPlayed
  // and the LeagueHistory itself were built above so each live game's
  // SceneContext could carry career BvP data into the HUD.

  // Lazy projections — cached per live day (advanceDay invalidates).
  let projectionsCache: ProjectionSet | null = null;
  const getProjections = (): ProjectionSet => {
    if (!projectionsCache) {
      projectionsCache = buildProjections({
        seasonYear,
        teams: league.teams,
        schedule: activeSchedule,
        aggregates: aggregatesWithLive,
        currentDay,
        simulations: 500, // dial down for browser snappiness; 1000 still cheap
        seed: SEED,
      });
    }
    return projectionsCache;
  };

  const buildLiveSummaries = (): LiveGameSummary[] => {
    const tick = handle.currentSimTime();
    return liveGames.map((g) => {
      const tl = aggregatesWithLive.wpTimelines.get(g.entry.gameId);
      const { inning, half, outs, scoreHome, scoreAway } = extractLiveState(g.events, tick);
      const isDay = isDayGameForGameId(
        g.entry.gameId,
        g.sceneCtx.stadium?.atmosphere.dayGameBias ?? 0.5,
      );
      // Filter the pre-built full-game timeline to only samples whose source event
      // has already occurred, so the live WP chart grows in real time.
      const liveTl = tl
        ? {
            ...tl,
            samples: tl.samples.filter((s) => {
              const ev = g.events[s.eventIdx];
              return ev !== undefined && ev.t <= tick;
            }),
          }
        : tl;
      return {
        gameId: g.entry.gameId,
        homeTeamId: g.entry.homeTeamId,
        awayTeamId: g.entry.awayTeamId,
        score: { home: scoreHome, away: scoreAway },
        inning,
        half,
        outs,
        isDay,
        wpTimeline: liveTl,
      };
    });
  };

  const menu = mountMenu(document.body, {
    getAggregates: () => aggregatesWithLive,
    getTeamGamesPlayed: () => currentDay,
    teams: league.teams,
    playerIndex,
    // Live getter: season rollover swaps in a fresh schedule and the menu
    // should follow it, not the year-1 snapshot.
    get schedule() {
      return activeSchedule;
    },
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
