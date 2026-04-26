import { generateInitialLeague } from '../content/index.js';
import { buildSchedule, buildLineup } from '../season/index.js';
import { runGame } from '../sim/index.js';
import type { GameInput, SideInput } from '../sim/types.js';
import {
  createRenderLoop,
  DEFAULT_TICKS_PER_SECOND,
  type RenderLoopHandle,
  type SceneContext,
} from '../render/index.js';

// Phase 2 browser entry. Generates the league, picks one game from day 1,
// runs the sim once, and hands the event log to the render loop.

const QS = new URLSearchParams(globalThis.location?.search ?? '');
const SEED = QS.get('seed') ? parseSeed(QS.get('seed')!) : 0xba_5e_ba_11;
const DAY = QS.get('day') ? parseInt(QS.get('day')!, 10) : 1;
const GAME = QS.get('game') ? parseInt(QS.get('game')!, 10) : 1;

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
  // Match canvas backing-store size to its CSS pixel size for crisp rendering.
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const width = Math.max(640, Math.floor(rect.width * dpr));
  const height = Math.max(480, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
};

const setupControls = (handle: RenderLoopHandle) => {
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
  const dayEntries = schedule.entries.filter((e) => e.day === DAY);
  const entry = dayEntries[GAME - 1];
  if (!entry) {
    console.error(`No game at day ${DAY} index ${GAME}`);
    return;
  }
  const homeTeam = league.teams.find((t) => t.id === entry.homeTeamId)!;
  const awayTeam = league.teams.find((t) => t.id === entry.awayTeamId)!;
  const stadium = league.stadiums.find((s) => s.id === entry.stadiumId)!;

  const homeLineup = buildLineup(homeTeam, league.players, DAY);
  const awayLineup = buildLineup(awayTeam, league.players, DAY);
  const playerIndex = new Map(league.players.map((p) => [p.id, p]));

  const home: SideInput = {
    teamId: homeTeam.id,
    battingOrder: homeLineup.battingOrder,
    startingPitcherId: homeLineup.startingPitcher,
    bullpen: homeLineup.bullpen,
  };
  const away: SideInput = {
    teamId: awayTeam.id,
    battingOrder: awayLineup.battingOrder,
    startingPitcherId: awayLineup.startingPitcher,
    bullpen: awayLineup.bullpen,
  };

  const input: GameInput = {
    gameId: entry.gameId,
    stadiumId: entry.stadiumId,
    home,
    away,
    playerIndex,
    seed: SEED ^ fnv(entry.gameId),
  };

  const events = runGame(input);

  const teamColors = new Map(
    league.teams.map((t) => [t.id, { primary: t.colors.primary, secondary: t.colors.secondary, accent: t.colors.accent }]),
  );
  const teamAbbr = new Map(league.teams.map((t) => [t.id, t.abbr]));
  // Sky tint: the home team's primary color blended with a dark base so
  // each ballpark has a distinct ambient feel without going full daylight.
  const homeColor = homeTeam.colors.primary;
  const skyColor = blendColors(homeColor, '#0b0d10', 0.78);

  const sceneCtx: SceneContext = {
    input,
    teamColors,
    teamAbbr,
    stadiumName: stadium.name,
    grassShade: stadium.atmosphere.grassShade,
    skyColor,
  };

  const handle = createRenderLoop(canvas, events, sceneCtx, { autoStart: true });
  setupControls(handle);

  // Resize handling — debounce-light is fine for a screensaver.
  globalThis.addEventListener('resize', () => {
    sizeCanvas(canvas);
    handle.jumpTo(handle.currentSimTime()); // force a redraw at the new size
  });
};

main();
