// /content — static data: cities, names, mascots, stadium quirks, team identities.
// No runtime logic — all behavior lives in /sim, /world, /season.
export * from './teams.js';
export * from './names.js';
export { generateInitialLeague } from './league-init.js';
export { generateAllPlayers, generateRoster, summarizeRoster } from './player-init.js';
export { generateCoachingStaff } from './coach-init.js';
