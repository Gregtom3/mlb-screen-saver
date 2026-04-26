// Phase 0 CLI: pretty-print the founding 16 teams and stadiums to the terminal.
// Run with `npm run league:print` (uses tsx).

import { generateInitialLeague } from '../content/league-init.js';
import type { Conference, Division, Stadium, Team, StadiumQuirk } from '../world/types.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';

// 24-bit foreground/background helpers.
const fg = (hex: string) => {
  const { r, g, b } = hexToRgb(hex);
  return `\x1b[38;2;${r};${g};${b}m`;
};
const bg = (hex: string) => {
  const { r, g, b } = hexToRgb(hex);
  return `\x1b[48;2;${r};${g};${b}m`;
};

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return { r, g, b };
};

const colorBar = (hex: string, width = 3) => `${bg(hex)}${' '.repeat(width)}${RESET}`;

const formatQuirk = (q: StadiumQuirk): string => {
  switch (q.kind) {
    case 'short-porch':
      return `short porch ${q.side} (${q.distanceFt} ft)`;
    case 'deep-center':
      return `deep center (${q.distanceFt} ft)`;
    case 'ivy-wall':
      return `ivy-covered ${q.side} wall`;
    case 'hill-cf':
      return 'hill in center field';
    case 'pond-beyond-rf':
      return 'pond beyond right field';
    case 'clock-tower-in-play':
      return 'clock tower in play';
    case 'mascot-statue':
      return `giant mascot statue (${q.side})`;
    case 'wind-tunnel':
      return `wind tunnel (${q.direction})`;
    case 'altitude-thin-air':
      return `thin air (${q.elevationFt} ft elevation)`;
  }
};

const formatTeam = (team: Team, stadium: Stadium): string => {
  const colors =
    colorBar(team.colors.primary) + colorBar(team.colors.secondary) + colorBar(team.colors.accent);
  const dims = stadium.dimensions;
  const dimLine = `${dims.leftFt}–${dims.leftCenterFt}–${dims.centerFt}–${dims.rightCenterFt}–${dims.rightFt} ft`;
  const wallLine = `wall ${dims.wallHeightFt} ft · foul ${dims.foulTerritoryRating}/10`;

  const namePart = `${BOLD}${fg(team.colors.primary)}${team.city} ${team.nickname}${RESET} ${DIM}(${team.abbr})${RESET}`;
  const mascotPart = `${ITALIC}${DIM}mascot:${RESET} ${team.mascot}`;
  const stadiumPart = `${BOLD}${stadium.name}${RESET} — ${dimLine} · ${wallLine}`;
  const quirkPart = `${DIM}quirk:${RESET} ${formatQuirk(stadium.quirk)}`;

  return [
    `  ${colors}  ${namePart}`,
    `         ${mascotPart}`,
    `         ${stadiumPart}`,
    `         ${quirkPart}`,
  ].join('\n');
};

const banner = (title: string, char = '─', width = 72) => {
  const pad = Math.max(0, width - title.length - 2);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return `${char.repeat(left)} ${BOLD}${title}${RESET} ${char.repeat(right)}`;
};

const main = () => {
  const league = generateInitialLeague(0xba_5e_ba_11);
  const stadiumByTeam = new Map(league.stadiums.map((s) => [s.teamId, s]));

  const conferences: Conference[] = ['West', 'East'];
  const divisionsByConference: Record<Conference, Division[]> = {
    West: ['Pacific', 'Mountain'],
    East: ['Heartland', 'Atlantic'],
  };

  console.log('');
  console.log(banner('8-Bit Baseball — Founding League', '═'));
  console.log(
    `  ${DIM}league id:${RESET} ${league.leagueId}   ${DIM}master seed:${RESET} 0x${league.createdAtSeed.toString(16)}`,
  );
  console.log(
    `  ${DIM}teams:${RESET} ${league.teams.length}   ${DIM}stadiums:${RESET} ${league.stadiums.length}   ${DIM}season:${RESET} year ${league.season.year} (${league.season.phase})`,
  );
  console.log('');

  for (const conf of conferences) {
    console.log(banner(`${conf}ern Conference`, '═'));
    for (const div of divisionsByConference[conf]) {
      console.log('');
      console.log(`  ${BOLD}${div} Division${RESET}`);
      console.log('');
      const teams = league.teams.filter((t) => t.conference === conf && t.division === div);
      for (const team of teams) {
        const stadium = stadiumByTeam.get(team.id);
        if (!stadium) throw new Error(`No stadium for team ${team.id}`);
        console.log(formatTeam(team, stadium));
        console.log('');
      }
    }
  }

  console.log(banner('end of Phase 0 placeholder league', '─'));
  console.log('');
};

main();
