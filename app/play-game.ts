// Phase 1 CLI entry: simulate one game from a seed and print PBP + box score.
//
// Usage: npm run game:play -- [--seed 42] [--day 1] [--game N]
//   --seed: master seed for the league (default 0xba5eba11)
//   --day:  schedule day to draw a game from (default 1)
//   --game: 1-based index of the game on that day (default 1)

import { generateInitialLeague } from '../content/index.js';
import { buildSchedule, buildLineup } from '../season/index.js';
import { runGame, buildBoxScore } from '../sim/index.js';
import type { GameInput, SideInput } from '../sim/types.js';
import { formatPlayByPlay, type PbpContext } from './pbp.js';
import { formatBoxScore } from './box-score-fmt.js';

interface CliArgs {
  seed: number;
  day: number;
  game: number;
}

const parseArgs = (argv: readonly string[]): CliArgs => {
  const out: CliArgs = { seed: 0xba_5e_ba_11, day: 1, game: 1 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--seed' && next) {
      out.seed = next.startsWith('0x') ? parseInt(next, 16) : parseInt(next, 10);
      i++;
    } else if (arg === '--day' && next) {
      out.day = parseInt(next, 10);
      i++;
    } else if (arg === '--game' && next) {
      out.game = parseInt(next, 10);
      i++;
    }
  }
  return out;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const league = generateInitialLeague(args.seed);
  const schedule = buildSchedule(league.teams, league.season.year);

  const dayEntries = schedule.entries.filter((e) => e.day === args.day);
  if (dayEntries.length === 0) {
    console.error(`No games on day ${args.day}`);
    process.exit(1);
  }
  if (args.game < 1 || args.game > dayEntries.length) {
    console.error(`Day ${args.day} has ${dayEntries.length} games; --game must be 1..${dayEntries.length}`);
    process.exit(1);
  }
  const entry = dayEntries[args.game - 1]!;

  const homeTeam = league.teams.find((t) => t.id === entry.homeTeamId);
  const awayTeam = league.teams.find((t) => t.id === entry.awayTeamId);
  const stadium = league.stadiums.find((s) => s.id === entry.stadiumId);
  if (!homeTeam || !awayTeam || !stadium) throw new Error('Team / stadium lookup failed');

  const homeLineup = buildLineup(homeTeam, league.players, args.day);
  const awayLineup = buildLineup(awayTeam, league.players, args.day);

  const playerIndex = new Map(league.players.map((p) => [p.id, p]));

  const homeSide: SideInput = {
    teamId: homeTeam.id,
    battingOrder: homeLineup.battingOrder,
    startingPitcherId: homeLineup.startingPitcher,
    bullpen: homeLineup.bullpen,
    defenseByPosition: homeLineup.defenseByPosition,
    coachingStaff: homeTeam.coachingStaff,
  };
  const awaySide: SideInput = {
    teamId: awayTeam.id,
    battingOrder: awayLineup.battingOrder,
    startingPitcherId: awayLineup.startingPitcher,
    bullpen: awayLineup.bullpen,
    defenseByPosition: awayLineup.defenseByPosition,
    coachingStaff: awayTeam.coachingStaff,
  };

  // Per-game seed: master seed XOR'd with the game id hash so games are independent
  // but a master seed alone fully reproduces the league + every game.
  const gameSeed = args.seed ^ hashString(entry.gameId);
  const input: GameInput = {
    gameId: entry.gameId,
    stadiumId: entry.stadiumId,
    home: homeSide,
    away: awaySide,
    playerIndex,
    seed: gameSeed,
    stadiumQuirk: stadium.quirk,
    stadiumDimensions: stadium.dimensions,
  };

  const events = runGame(input);
  const box = buildBoxScore(events, input);

  const teamById = new Map(
    league.teams.map((t) => [t.id, { city: t.city, nickname: t.nickname, abbr: t.abbr }]),
  );
  const stadiumById = new Map(league.stadiums.map((s) => [s.id, { name: s.name }]));
  const pbpCtx: PbpContext = {
    playerById: playerIndex,
    teamById,
    stadiumById,
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
  };

  console.log('');
  console.log(`\x1b[2mleague seed: 0x${args.seed.toString(16)} · day ${args.day} · game ${args.game}/${dayEntries.length}\x1b[0m`);
  console.log(formatPlayByPlay(events, pbpCtx));
  console.log('');
  console.log('');
  console.log(formatBoxScore(box, { playerById: playerIndex, teamById }));
  console.log('');
};

const hashString = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

main();
