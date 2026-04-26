import type { BattingLine, PitchingLine, TeamLine } from './types.js';

// Phase 5.5 step 5.5.2 — read-time derived rate stats.

// ---------- Batting ----------

export const battingAvg = (b: BattingLine): number => (b.AB > 0 ? b.H / b.AB : 0);

export const onBasePct = (b: BattingLine): number => {
  const denom = b.AB + b.BB + b.HBP + b.SF;
  return denom > 0 ? (b.H + b.BB + b.HBP) / denom : 0;
};

export const sluggingPct = (b: BattingLine): number => {
  if (b.AB === 0) return 0;
  const tb = (b.H - b.doubles - b.triples - b.HR) + 2 * b.doubles + 3 * b.triples + 4 * b.HR;
  return tb / b.AB;
};

export const ops = (b: BattingLine): number => onBasePct(b) + sluggingPct(b);

// ---------- Pitching ----------

export const inningsPitched = (p: PitchingLine): number => Math.floor(p.IPouts / 3) + (p.IPouts % 3) / 10;

export const era = (p: PitchingLine): number => {
  // Earned-run average: ER × 9 / IP. We keep IP in outs to avoid floats.
  if (p.IPouts === 0) return 0;
  return (p.ER * 27) / p.IPouts; // 27 outs in 9 innings → ER * 9 / (IPouts/3) = ER * 27 / IPouts
};

export const whip = (p: PitchingLine): number => {
  if (p.IPouts === 0) return 0;
  return ((p.BB + p.H) * 3) / p.IPouts; // (BB+H) / (IPouts/3)
};

export const strikeoutsPer9 = (p: PitchingLine): number => {
  if (p.IPouts === 0) return 0;
  return (p.SO * 27) / p.IPouts;
};

export const walksPer9 = (p: PitchingLine): number => {
  if (p.IPouts === 0) return 0;
  return (p.BB * 27) / p.IPouts;
};

// ---------- Team ----------

export const winPct = (t: TeamLine): number => {
  const total = t.W + t.L;
  return total > 0 ? t.W / total : 0;
};

export const runDiff = (t: TeamLine): number => t.RS - t.RA;

export const last10 = (t: TeamLine): { wins: number; losses: number } => {
  const tail = t.resultsTimeline.slice(-10);
  return {
    wins: tail.filter((r) => r === 'W').length,
    losses: tail.filter((r) => r === 'L').length,
  };
};

export const streak = (t: TeamLine): { kind: 'W' | 'L'; n: number } | null => {
  const r = t.resultsTimeline;
  if (r.length === 0) return null;
  const last = r[r.length - 1]!;
  let n = 0;
  for (let i = r.length - 1; i >= 0 && r[i] === last; i--) n += 1;
  return { kind: last, n };
};

// Pythagorean win expectation: RS² / (RS² + RA²). Used by /projections.
export const pythagoreanExpectation = (t: TeamLine): number => {
  const denom = t.RS * t.RS + t.RA * t.RA;
  return denom > 0 ? (t.RS * t.RS) / denom : 0.5;
};

// ---------- Formatting helpers ----------

// Three-decimal rate stat without leading zero ("AVG .274"). Convention:
// MLB-style — drops the leading zero; truncates rather than rounding to
// avoid the Trot Nixon ".0001" rounding quirks.
export const formatAvg = (n: number): string => {
  const truncated = Math.floor(n * 1000) / 1000;
  return truncated >= 1
    ? truncated.toFixed(3)
    : truncated.toFixed(3).replace(/^0/, '');
};

export const formatEra = (n: number): string => n.toFixed(2);
export const formatWhip = (n: number): string => n.toFixed(2);

export const formatIp = (p: PitchingLine): string => {
  const fullInnings = Math.floor(p.IPouts / 3);
  const remainder = p.IPouts % 3;
  return `${fullInnings}.${remainder}`;
};

export const formatRecord = (t: TeamLine): string => `${t.W}-${t.L}`;

export const formatSigned = (n: number, decimals = 0): string => {
  const fixed = n.toFixed(decimals);
  return n > 0 ? `+${fixed}` : fixed;
};
