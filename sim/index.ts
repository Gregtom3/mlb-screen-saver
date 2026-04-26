// /sim — pure simulation engine.
// No DOM, no rendering, no audio, no I/O. The renderer consumes the event log;
// it never reaches into here. See CLAUDE.md "Hard architectural rules".
export * from './types.js';
export { createPRNG } from './prng.js';
