// /content — static data: cities, names, mascots, stadium quirks, team identities.
// No runtime logic — all behavior lives in /sim, /world, /season.
export * from './teams.js';
export { generateInitialLeague } from './league-init.js';
