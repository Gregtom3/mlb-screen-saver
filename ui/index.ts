// /ui — DOM-based overlays. Subscribes to sim events / aggregates; never
// mutates them. Phase 5.5 brings the stats menu (League / Teams / Players /
// Live / History) plus the procedural portrait + WP + spray-chart helpers.
export { mountMenu } from './menu.js';
export type { MenuView, MenuContext, LiveGameSummary, GameMetadata } from './menu-shared.js';
export { drawPortrait, portraitDataUrl } from './portrait.js';
export { drawSprayChart } from './spray-chart.js';
export { drawWPChart, drawWPSparkline, type WPChartOptions } from './wp-chart.js';
