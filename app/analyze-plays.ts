// Diagnostic: simulate ~N at-bats with randomly generated players and tabulate
// every batted-ball outcome by fielder position. Used to sanity-check whether
// the infield is seeing the expected share of plays (3B, SS, 2B in particular).
//
// Usage: npm run play:analyze -- [--abs 50000] [--seed 0xba5eba11]
//
// The script walks the canonical event log and pairs each `atBatEnd` with the
// preceding `contact` event in the same at-bat, then re-derives the fielder
// position from the ball path with the same rule the sim uses internally.
// (We re-derive rather than reach into /sim because Position assignment isn't
// emitted on the event stream — only the responsible fielder *id* is, and only
// when an error occurs.)

import { generateInitialLeague } from '../content/index.js';
import { buildSchedule, buildLineup } from '../season/index.js';
import { runGame } from '../sim/index.js';
import type { GameInput, SideInput, SimEvent, BallPath, AtBatOutcome } from '../sim/types.js';
import type { Position } from '../world/types.js';

interface CliArgs {
  seed: number;
  targetAbs: number;
}

const parseArgs = (argv: readonly string[]): CliArgs => {
  const out: CliArgs = { seed: 0xba_5e_ba_11, targetAbs: 50_000 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--seed' && next) {
      out.seed = next.startsWith('0x') ? parseInt(next, 16) : parseInt(next, 10);
      i++;
    } else if (arg === '--abs' && next) {
      out.targetAbs = parseInt(next, 10);
      i++;
    }
  }
  return out;
};

const hashString = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

// Mirror of /sim's internal fielder-assignment rule. Kept in lockstep with
// sim/game.ts:pickInfieldPosition / pickOutfieldPosition / fielderPositionFor.
const sprayDegOf = (bp: BallPath): number =>
  (Math.atan2(bp.landingX, Math.max(1, bp.landingY)) * 180) / Math.PI;

const pickInfieldPosition = (spray: number): Position => {
  if (spray < -18) return '3B';
  if (spray < -6) return 'SS';
  if (spray < 6) return 'P';
  if (spray < 18) return '2B';
  return '1B';
};

const pickOutfieldPosition = (spray: number): Position => {
  if (spray < -15) return 'LF';
  if (spray < 15) return 'CF';
  return 'RF';
};

const fielderPositionFor = (outcome: AtBatOutcome, bp: BallPath): Position | null => {
  const spray = sprayDegOf(bp);
  switch (outcome) {
    case 'groundout':
    case 'double-play':
    case 'fielders-choice':
    case 'popout':
      return pickInfieldPosition(spray);
    case 'flyout':
    case 'sac-fly':
      return pickOutfieldPosition(spray);
    case 'lineout':
      return bp.launchAngleDeg < 14 ? pickInfieldPosition(spray) : pickOutfieldPosition(spray);
    default:
      return null;
  }
};

interface Tally {
  total: number;
  byOutcome: Map<AtBatOutcome, number>;
  byPosition: Map<Position, number>;
  // outcome → position → count, for fielded plays only.
  matrix: Map<AtBatOutcome, Map<Position, number>>;
  // Spray angle histogram for *every* batted ball, regardless of outcome.
  // Bin width = 4°, range [-44°, +44°].
  sprayHist: number[];
}

const newTally = (): Tally => ({
  total: 0,
  byOutcome: new Map(),
  byPosition: new Map(),
  matrix: new Map(),
  sprayHist: new Array(22).fill(0),
});

const SPRAY_MIN = -44;
const SPRAY_BIN_WIDTH = 4;

const bumpMap = <K>(m: Map<K, number>, key: K): void => {
  m.set(key, (m.get(key) ?? 0) + 1);
};

const recordEvents = (events: readonly SimEvent[], tally: Tally, remaining: number): number => {
  let lastContact: BallPath | null = null;
  let added = 0;
  for (const ev of events) {
    if (added >= remaining) break;
    if (ev.kind === 'contact') {
      lastContact = ev.ballPath;
      const spray = sprayDegOf(ev.ballPath);
      const bin = Math.min(
        tally.sprayHist.length - 1,
        Math.max(0, Math.floor((spray - SPRAY_MIN) / SPRAY_BIN_WIDTH)),
      );
      tally.sprayHist[bin]! += 1;
    } else if (ev.kind === 'atBatEnd') {
      tally.total += 1;
      added += 1;
      bumpMap(tally.byOutcome, ev.outcome);
      if (lastContact) {
        const pos = fielderPositionFor(ev.outcome, lastContact);
        if (pos) {
          bumpMap(tally.byPosition, pos);
          let row = tally.matrix.get(ev.outcome);
          if (!row) {
            row = new Map();
            tally.matrix.set(ev.outcome, row);
          }
          bumpMap(row, pos);
        }
      }
      lastContact = null; // contact belongs to one at-bat
    }
  }
  return added;
};

const pad = (s: string | number, n: number): string => String(s).padStart(n, ' ');
const padR = (s: string | number, n: number): string => String(s).padEnd(n, ' ');

const pct = (n: number, d: number): string =>
  d === 0 ? '  0.00%' : `${((n / d) * 100).toFixed(2).padStart(6, ' ')}%`;

const POSITIONS_ORDERED: Position[] = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

const FIELDED_OUTCOMES: AtBatOutcome[] = [
  'groundout',
  'double-play',
  'fielders-choice',
  'popout',
  'lineout',
  'flyout',
  'sac-fly',
];

const printReport = (tally: Tally): void => {
  console.log('');
  console.log(`At-bats analyzed: ${tally.total.toLocaleString()}`);
  console.log('');

  console.log('=== At-bat outcome distribution ===');
  const sortedOutcomes = Array.from(tally.byOutcome.entries()).sort((a, b) => b[1] - a[1]);
  for (const [oc, c] of sortedOutcomes) {
    console.log(`  ${padR(oc, 22)} ${pad(c.toLocaleString(), 8)}  ${pct(c, tally.total)}`);
  }
  console.log('');

  const fieldedTotal = Array.from(tally.byPosition.values()).reduce((s, n) => s + n, 0);
  console.log(`=== Fielder position distribution (${fieldedTotal.toLocaleString()} fielded plays) ===`);
  for (const pos of POSITIONS_ORDERED) {
    const c = tally.byPosition.get(pos) ?? 0;
    console.log(`  ${padR(pos, 4)} ${pad(c.toLocaleString(), 8)}  ${pct(c, fieldedTotal)}`);
  }
  console.log('');

  console.log('=== Outcome × Position matrix (counts) ===');
  const header = `  ${padR('outcome', 18)}` + POSITIONS_ORDERED.map((p) => pad(p, 7)).join('') + pad('TOTAL', 8);
  console.log(header);
  for (const oc of FIELDED_OUTCOMES) {
    const row = tally.matrix.get(oc);
    if (!row) continue;
    const cells = POSITIONS_ORDERED.map((p) => pad(row.get(p) ?? 0, 7)).join('');
    const rowTotal = Array.from(row.values()).reduce((s, n) => s + n, 0);
    console.log(`  ${padR(oc, 18)}${cells}${pad(rowTotal, 8)}`);
  }
  // Column totals
  const colTotals = POSITIONS_ORDERED.map((p) => {
    let sum = 0;
    for (const oc of FIELDED_OUTCOMES) sum += tally.matrix.get(oc)?.get(p) ?? 0;
    return sum;
  });
  console.log(
    `  ${padR('TOTAL', 18)}` +
      colTotals.map((n) => pad(n, 7)).join('') +
      pad(colTotals.reduce((s, n) => s + n, 0), 8),
  );
  console.log('');

  console.log('=== Outcome × Position matrix (% of that outcome) ===');
  console.log(header);
  for (const oc of FIELDED_OUTCOMES) {
    const row = tally.matrix.get(oc);
    if (!row) continue;
    const rowTotal = Array.from(row.values()).reduce((s, n) => s + n, 0);
    const cells = POSITIONS_ORDERED.map((p) => {
      const c = row.get(p) ?? 0;
      return pad(rowTotal === 0 ? '-' : `${((c / rowTotal) * 100).toFixed(1)}%`, 7);
    }).join('');
    console.log(`  ${padR(oc, 18)}${cells}${pad(rowTotal, 8)}`);
  }
  console.log('');

  console.log('=== Spray-angle histogram (all batted balls, 4° bins) ===');
  const maxBin = Math.max(...tally.sprayHist, 1);
  const histTotal = tally.sprayHist.reduce((s, n) => s + n, 0);
  for (let i = 0; i < tally.sprayHist.length; i++) {
    const lo = SPRAY_MIN + i * SPRAY_BIN_WIDTH;
    const hi = lo + SPRAY_BIN_WIDTH;
    const c = tally.sprayHist[i]!;
    const bar = '#'.repeat(Math.round((c / maxBin) * 50));
    console.log(`  ${pad(lo, 4)}°..${pad(hi, 3)}°  ${pad(c, 6)}  ${pct(c, histTotal)}  ${bar}`);
  }
};

const main = (): void => {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `Analyzing plays: target=${args.targetAbs.toLocaleString()} ABs, master seed=0x${args.seed.toString(16)}`,
  );

  const tally = newTally();
  let leagueIdx = 0;
  let gamesPlayed = 0;

  // Each league seeds its own pool of randomly generated players. We rotate
  // master seeds every league to keep player diversity high — otherwise we'd
  // be sampling the same 640 hitters/pitchers for the whole run.
  while (tally.total < args.targetAbs) {
    const masterSeed = (args.seed + leagueIdx * 0x9e_37_79_b9) >>> 0;
    const league = generateInitialLeague(masterSeed);
    const schedule = buildSchedule(league.teams, league.season.year);
    const playerIndex = new Map(league.players.map((p) => [p.id, p]));
    const teamById = new Map(league.teams.map((t) => [t.id, t]));
    const stadiumById = new Map(league.stadiums.map((s) => [s.id, s]));

    for (const entry of schedule.entries) {
      if (tally.total >= args.targetAbs) break;
      const homeTeam = teamById.get(entry.homeTeamId);
      const awayTeam = teamById.get(entry.awayTeamId);
      const stadium = stadiumById.get(entry.stadiumId);
      if (!homeTeam || !awayTeam || !stadium) continue;

      const homeLineup = buildLineup(homeTeam, league.players, entry.day);
      const awayLineup = buildLineup(awayTeam, league.players, entry.day);

      const home: SideInput = {
        teamId: homeTeam.id,
        battingOrder: homeLineup.battingOrder,
        startingPitcherId: homeLineup.startingPitcher,
        bullpen: homeLineup.bullpen,
        defenseByPosition: homeLineup.defenseByPosition,
      };
      const away: SideInput = {
        teamId: awayTeam.id,
        battingOrder: awayLineup.battingOrder,
        startingPitcherId: awayLineup.startingPitcher,
        bullpen: awayLineup.bullpen,
        defenseByPosition: awayLineup.defenseByPosition,
      };

      const input: GameInput = {
        gameId: entry.gameId,
        stadiumId: entry.stadiumId,
        home,
        away,
        playerIndex,
        seed: (masterSeed ^ hashString(entry.gameId)) >>> 0,
        stadiumQuirk: stadium.quirk,
        stadiumDimensions: stadium.dimensions,
      };

      const events = runGame(input);
      const remaining = args.targetAbs - tally.total;
      recordEvents(events, tally, remaining);
      gamesPlayed += 1;

      if (gamesPlayed % 100 === 0) {
        process.stderr.write(
          `  progress: ${gamesPlayed} games, ${tally.total.toLocaleString()} ABs\n`,
        );
      }
    }
    leagueIdx += 1;
  }

  console.log(`\nDone. ${gamesPlayed} games across ${leagueIdx} league(s).`);
  printReport(tally);
};

main();
