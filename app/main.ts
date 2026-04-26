import { generateInitialLeague } from '../content/index.js';
import { buildSchedule, buildLineup } from '../season/index.js';
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
import { mountMenu } from '../ui/index.js';
import { buildSeasonAggregates, type FinishedGame, type SeasonAggregates } from '../stats/index.js';

// Phase 3 browser entry. Pre-simulates a few days of games so we have
// standings, then puts day N+1 on screen as 8 simultaneous "channels".
// Left/right arrows cycle channels. Number keys 1–8 jump directly.

const QS = new URLSearchParams(globalThis.location?.search ?? '');
const SEED = QS.get('seed') ? parseSeed(QS.get('seed')!) : 0xba_5e_ba_11;
const HISTORY_DAYS = QS.get('history') ? parseInt(QS.get('history')!, 10) : 4;
const LIVE_DAY = QS.get('day') ? parseInt(QS.get('day')!, 10) : HISTORY_DAYS + 1;
const INITIAL_GAME = QS.get('game') ? parseInt(QS.get('game')!, 10) - 1 : 0;

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
  readonly entry: { homeTeamId: TeamId; awayTeamId: TeamId };
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
  };
  const awaySide: SideInput = {
    teamId: away.id,
    battingOrder: awayLineup.battingOrder,
    startingPitcherId: awayLineup.startingPitcher,
    bullpen: awayLineup.bullpen,
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
  return {
    input,
    teamColors,
    teamAbbr,
    stadiumName: stadium.name,
    grassShade: stadium.atmosphere.grassShade,
    skyColor: blendColors(homeTeam.colors.primary, '#0b0d10', 0.78),
  };
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

  // ---- Pre-simulate history days. Keep events around so /stats can build
  // full season aggregates (the standings map is now derived from these).
  const historyGames: FinishedGame[] = [];
  for (let day = 1; day < LIVE_DAY; day++) {
    for (const entry of schedule.entries.filter((e) => e.day === day)) {
      const { input } = buildGameInput(league, entry, SEED);
      const events = runGame(input);
      historyGames.push({ events, input });
    }
  }
  const aggregates: SeasonAggregates = buildSeasonAggregates(
    historyGames,
    league.teams,
    league.season.year,
  );
  // Convert TeamLine → TeamStanding for the existing HUD strip.
  const standings = new Map<TeamId, TeamStanding>();
  for (const team of league.teams) {
    const line = aggregates.teams.get(team.id);
    standings.set(team.id, line ? { wins: line.W, losses: line.L } : { wins: 0, losses: 0 });
  }

  // ---- Pre-simulate live-day games and keep their event logs.
  const liveDayEntries = schedule.entries.filter((e) => e.day === LIVE_DAY);
  if (liveDayEntries.length === 0) {
    console.error(`No games on day ${LIVE_DAY}`);
    return;
  }
  const liveGames: LiveGame[] = liveDayEntries.map((entry) => {
    const { input, home, stadium } = buildGameInput(league, entry, SEED);
    const events = runGame(input);
    const sceneCtx = buildSceneCtxFor(league, input, home, stadium);
    return {
      events,
      sceneCtx,
      entry: { homeTeamId: entry.homeTeamId, awayTeamId: entry.awayTeamId },
    } satisfies LiveGame;
  });

  let selectedIdx = Math.max(0, Math.min(liveGames.length - 1, INITIAL_GAME));

  const channelLabel = document.getElementById('channel-label');
  const getChannelText = () => {
    const g = liveGames[selectedIdx]!;
    const home = league.teams.find((t) => t.id === g.entry.homeTeamId);
    const away = league.teams.find((t) => t.id === g.entry.awayTeamId);
    return `ch ${selectedIdx + 1}/${liveGames.length}  ·  ${away?.abbr} @ ${home?.abbr}`;
  };

  const handle = createRenderLoop(canvas, liveGames[selectedIdx]!, {
    autoStart: true,
    getStandings: () => standings,
    getChannelInfo: () => ({ currentIdx: selectedIdx, total: liveGames.length }),
  });

  const switchChannel = (delta: number) => {
    const next = (selectedIdx + delta + liveGames.length) % liveGames.length;
    if (next === selectedIdx) return;
    selectedIdx = next;
    handle.setActiveGame(liveGames[selectedIdx]!);
    if (channelLabel) channelLabel.textContent = getChannelText();
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

  // ---- Stats menu (phase 5.5).
  const playerIndex = new Map(league.players.map((p) => [p.id, p]));
  const teamGamesPlayed = LIVE_DAY - 1; // each team has played one game per history day
  const menu = mountMenu(document.body, {
    getAggregates: () => aggregates,
    getTeamGamesPlayed: () => teamGamesPlayed,
    teams: league.teams,
    playerIndex,
  });

  globalThis.addEventListener('keydown', (ev) => {
    // Tab and M open/close the menu.
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
};

main();
