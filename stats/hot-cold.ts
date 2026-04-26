import type { BattingLine, PitchingLine } from './types.js';
import { era, ops } from './derived.js';

// Phase 5.5 part 2 — rolling-window performance vs. season baseline. Output
// is a single normalized number that the player view turns into an aura
// color (red = hot, blue = cold, none = within ±0.5σ).

export type HotColdLevel = 'hot' | 'warm' | 'neutral' | 'cool' | 'cold';

export interface HotColdReading {
  readonly level: HotColdLevel;
  readonly delta: number; // OPS or ERA delta vs. season
  readonly window: number; // games in the rolling window
}

const WINDOW_GAMES = 7;

const opsForRow = (rows: readonly { AB: number; BB: number; HBP: number; SF: number; H: number; doubles: number; triples: number; HR: number }[]): number => {
  let AB = 0; let BB = 0; let HBP = 0; let SF = 0; let H = 0; let TB = 0;
  for (const r of rows) {
    AB += r.AB; BB += r.BB; HBP += r.HBP ?? 0; SF += r.SF ?? 0; H += r.H;
    TB += (r.H - r.doubles - r.triples - r.HR) + 2 * r.doubles + 3 * r.triples + 4 * r.HR;
  }
  if (AB === 0) return 0;
  const obpDenom = AB + BB + HBP + SF;
  const obp = obpDenom > 0 ? (H + BB + HBP) / obpDenom : 0;
  const slg = AB > 0 ? TB / AB : 0;
  return obp + slg;
};

export const battingHotCold = (line: BattingLine): HotColdReading => {
  const rows = line.gameLog.slice(-WINDOW_GAMES);
  const window = rows.length;
  if (window < 3 || line.PA < 20) {
    return { level: 'neutral', delta: 0, window };
  }
  const recent = opsForRow(rows.map((r) => ({ AB: r.AB, BB: r.BB, HBP: 0, SF: 0, H: r.H, doubles: r.doubles, triples: r.triples, HR: r.HR })));
  const baseline = ops(line);
  const delta = recent - baseline;
  const level: HotColdLevel =
    delta >= 0.20 ? 'hot' :
    delta >= 0.07 ? 'warm' :
    delta <= -0.20 ? 'cold' :
    delta <= -0.07 ? 'cool' : 'neutral';
  return { level, delta, window };
};

export const pitchingHotCold = (line: PitchingLine): HotColdReading => {
  const rows = line.gameLog.slice(-3); // pitchers see fewer games — narrow window
  const window = rows.length;
  if (window < 2 || line.IPouts < 27) {
    return { level: 'neutral', delta: 0, window };
  }
  // Recent ERA over the last few starts.
  let outs = 0; let er = 0;
  for (const r of rows) { outs += r.IPouts; er += r.ER; }
  const recentEra = outs > 0 ? (er * 27) / outs : 0;
  const baselineEra = era(line);
  // For pitchers a *lower* recent ERA is hot; flip the sign.
  const delta = baselineEra - recentEra;
  const level: HotColdLevel =
    delta >= 1.5 ? 'hot' :
    delta >= 0.5 ? 'warm' :
    delta <= -1.5 ? 'cold' :
    delta <= -0.5 ? 'cool' : 'neutral';
  return { level, delta, window };
};
