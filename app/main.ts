// Browser entry point. Phase 0: nothing renders.
// The screensaver lifecycle, idle/wake, and renderer wiring all land in later phases.
const root = document.getElementById('app');
if (root) {
  root.textContent = 'Phase 0 — league data only. Run `npm run league:print` for output.';
}
