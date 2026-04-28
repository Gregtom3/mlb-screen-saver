// Between-pitch baserunning subsystem: leads, pickoffs, errant throws with
// outfielder-backup tag plays, and stolen bases. Wired from /sim/game.ts via
// `resolveBetweenPitches` once before each pitch fires.
//
// Determinism is the contract: every probabilistic branch flows through the
// passed-in PRNG. Same seed + same world + same coaching staff yields a
// byte-identical sequence of events.

import type { PRNG } from './prng.js';
import type { Player, PlayerId, Position } from '../world/types.js';
import type { CoachingMods } from './coaching-effects.js';
import type { RunnerBase, SimEvent } from './types.js';

export interface BasesState {
  first: PlayerId | null;
  second: PlayerId | null;
  third: PlayerId | null;
}

export interface BaserunningInput {
  readonly bases: BasesState;
  readonly pitcher: Player;
  readonly catcher: Player | undefined;
  /**
   * Active fielders by position. Used to look up the OF backup on an
   * errant pickoff (1B → RF, 2B → CF, 3B → LF) and to credit the throw
   * back from the OF.
   */
  readonly fielders: ReadonlyMap<Position, Player>;
  readonly fieldingMods: CoachingMods;
  readonly battingMods: CoachingMods;
  readonly outs: number;
  readonly t: number;
  /**
   * Which (runnerId, base) pairs have already had a `lead` event emitted.
   * Mutated by the resolver so a runner only "establishes a lead" once
   * per arrival on a base.
   */
  readonly leadsEmitted: Set<string>;
}

export interface BaserunningResult {
  readonly events: readonly SimEvent[];
  readonly bases: BasesState;
  readonly outsAdded: number;
  readonly runsScored: number;
  readonly t: number;
  /** True if a 3rd out fired between pitches → the half-inning is over. */
  readonly endsHalfInning: boolean;
}

const TIME_LEAD = 4;
const TIME_PICKOFF_STEP = 6;
const TIME_PICKOFF_THROW = 6;
const TIME_ERRANT_DEFLECT = 8;
const TIME_BACKUP_THROW = 14;
const TIME_TAG = 4;
const TIME_STEAL_BREAK = 6;
const TIME_STEAL_RACE = 14;

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, n));

// Lead distance and aggression scalar per (runner, pitcher, batting mods).
// Numbers are tuned so that league-average inputs sit near the middle of
// the band: ~10 ft lead, ~0.4 aggression.
export const computeLead = (
  runner: Player,
  pitcher: Player,
  battingMods: CoachingMods,
): { leadFt: number; aggression: number } => {
  const stealRtg = runner.ratings.stealing;
  const speedRtg = runner.ratings.speed;
  const iqRtg = runner.ratings.baserunningIQ;
  const holdRtg = pitcher.ratings.holdRunners;
  const leadFt = clamp(
    9 + (stealRtg - 50) * 0.04 + (50 - holdRtg) * 0.03,
    6,
    15,
  );
  const aggression = clamp(
    0.35 +
      (stealRtg - 50) * 0.004 +
      (speedRtg - 50) * 0.002 +
      (iqRtg - 50) * 0.001 +
      (50 - holdRtg) * 0.003 +
      (battingMods.stealAdvantage - 1) * 0.4,
    0.05,
    0.95,
  );
  return { leadFt, aggression };
};

// OF backup mapping. Real defensive alignment: RF backs first-base
// pickoffs, CF backs second-base, LF backs third-base.
const backupPositionFor = (base: RunnerBase): Position => {
  if (base === 1) return 'RF';
  if (base === 2) return 'CF';
  return 'LF';
};

// Backup landing point in field coordinates (feet from home plate, +x = RF,
// +y = CF). The deflection lands shallow behind the bag at the OF's home
// position, with mild jitter so successive errant throws read differently.
const backupLandingFor = (base: RunnerBase, rng: PRNG): { x: number; y: number } => {
  const jitterX = (rng.next() - 0.5) * 12;
  const jitterY = (rng.next() - 0.5) * 12;
  if (base === 1) return { x: 90 + jitterX, y: 110 + jitterY };
  if (base === 2) return { x: 0 + jitterX, y: 200 + jitterY };
  return { x: -90 + jitterX, y: 110 + jitterY };
};

// Pickoff outcome on a clean (non-errant) throw. Generally safe — only
// runners caught with a huge lead and a precise pitcher throw get nailed.
const cleanPickoffOutProb = (
  runner: Player,
  pitcher: Player,
  leadFt: number,
  fieldingMods: CoachingMods,
): number => {
  const acc = pitcher.ratings.armAccuracy;
  const hold = pitcher.ratings.holdRunners;
  const iq = runner.ratings.baserunningIQ;
  const speed = runner.ratings.speed;
  // Base ~3% per attempted pickoff, modulated by accuracy/hold and the
  // 1B coach's pickoffPrevention (defensive multiplier on opponent runners).
  const base = 0.03 + (acc - 50) * 0.0008 + (hold - 50) * 0.0006;
  const runnerEscape = (iq - 50) * 0.0006 + (speed - 50) * 0.0004;
  const lead = (leadFt - 9) * 0.005;
  return clamp((base + lead - runnerEscape) * fieldingMods.pickoffPrevention, 0.005, 0.18);
};

// Probability a pickoff throw sails. Bad-accuracy pitchers err meaningfully
// more often, but the absolute rate stays small so errant throws are
// genuinely rare events that only fire once every few games.
const errantThrowProb = (pitcher: Player): number => {
  const acc = pitcher.ratings.armAccuracy;
  return clamp(0.02 + (50 - acc) * 0.0006, 0.005, 0.06);
};

// Backup OF tag-out probability at the advancing base. The runner is
// already running by the time the OF retrieves and throws — only a
// strong-armed, accurate OF throws them out, and only against slower
// runners.
const backupTagOutProb = (backup: Player, runner: Player): number => {
  const arm = backup.ratings.armStrength;
  const acc = backup.ratings.armAccuracy;
  const speed = runner.ratings.speed;
  const iq = runner.ratings.baserunningIQ;
  const base = 0.18 + (arm - 50) * 0.0025 + (acc - 50) * 0.0018;
  const runnerScore = (speed - 50) * 0.002 + (iq - 50) * 0.0008;
  return clamp(base - runnerScore, 0.02, 0.5);
};

// Per-pitch attempt rate for a pickoff throw. Pitchers throw to first
// more when there's a stealing threat or a long lead; rates are kept
// low so casual viewing isn't dominated by pickoff sequences.
const pickoffAttemptRate = (
  runner: Player,
  pitcher: Player,
  aggression: number,
): number => {
  const hold = pitcher.ratings.holdRunners;
  const stealRtg = runner.ratings.stealing;
  const base = 0.025 + aggression * 0.04 + (hold - 50) * 0.0006 + (stealRtg - 50) * 0.0004;
  return clamp(base, 0.005, 0.12);
};

// Per-pitch steal attempt rate. Aggressive runners go ~2-4% of pitches
// (~one attempt every 30-50 pitches they're on base for); cautious ones
// almost never go.
const stealAttemptRate = (
  runner: Player,
  pitcher: Player,
  battingMods: CoachingMods,
  aggression: number,
): number => {
  const hold = pitcher.ratings.holdRunners;
  const speed = runner.ratings.speed;
  const stealRtg = runner.ratings.stealing;
  const base =
    0.015 +
    aggression * 0.04 +
    (speed - 50) * 0.0006 +
    (stealRtg - 50) * 0.0006 -
    (hold - 50) * 0.0006;
  return clamp(base * battingMods.stealAdvantage, 0.002, 0.10);
};

// Steal success: runner's foot speed + technique vs. catcher's pop time
// and arm + 1B coach's stealAdvantage. League-average matchup ≈ ~70%
// success — matches MLB's modern SB%.
const stealSafeProb = (
  runner: Player,
  catcher: Player | undefined,
  battingMods: CoachingMods,
  fieldingMods: CoachingMods,
): number => {
  const runnerScore =
    (runner.ratings.speed - 50) * 0.004 + (runner.ratings.stealing - 50) * 0.004;
  const cArm = catcher?.ratings.armStrength ?? 50;
  const cPop = catcher?.ratings.popTime ?? 50;
  const cAcc = catcher?.ratings.armAccuracy ?? 50;
  const battery =
    (cPop - 50) * 0.004 + (cArm - 50) * 0.0035 + (cAcc - 50) * 0.002;
  // 1B coach's pickoffPrevention is "harder for the opponent to pick
  // me off" — reuse it lightly as a steal-jump bonus too, since the same
  // skill (timing the pitcher's first move) helps both.
  const jumpBonus = (1 - fieldingMods.pickoffPrevention) * 0.08;
  return clamp(
    0.66 + runnerScore - battery + (battingMods.stealAdvantage - 1) * 0.25 + jumpBonus,
    0.15,
    0.92,
  );
};

interface BuildContext {
  readonly events: SimEvent[];
  readonly bases: BasesState;
  outs: number;
  runs: number;
  t: number;
}

const emit = (ctx: BuildContext, ev: SimEvent): void => {
  ctx.events.push(ev);
};

// Emit lead events for any runner who hasn't established a lead at their
// current base yet. Idempotent across calls within the same arrival.
const emitLeads = (
  ctx: BuildContext,
  input: BaserunningInput,
  playerOf: (id: PlayerId) => Player | undefined,
): void => {
  const order: { base: RunnerBase; id: PlayerId | null }[] = [
    { base: 1, id: ctx.bases.first },
    { base: 2, id: ctx.bases.second },
    { base: 3, id: ctx.bases.third },
  ];
  for (const { base, id } of order) {
    if (!id) continue;
    const key = `${id}@${base}`;
    if (input.leadsEmitted.has(key)) continue;
    const runner = playerOf(id);
    if (!runner) continue;
    const lead = computeLead(runner, input.pitcher, input.battingMods);
    ctx.t += TIME_LEAD;
    emit(ctx, {
      t: ctx.t,
      kind: 'lead',
      runnerId: id,
      base,
      leadFt: Math.round(lead.leadFt * 10) / 10,
      aggression: Math.round(lead.aggression * 100) / 100,
    });
    input.leadsEmitted.add(key);
  }
};

// Pick the most advanced base with a runner — that's the priority pickoff
// target (a runner on 3B is the most dangerous threat to score). Returns
// null if no runners are on.
const primaryRunner = (bases: BasesState): { base: RunnerBase; id: PlayerId } | null => {
  if (bases.third) return { base: 3, id: bases.third };
  if (bases.second) return { base: 2, id: bases.second };
  if (bases.first) return { base: 1, id: bases.first };
  return null;
};

// Pick a steal candidate. Only forward-stealing is modeled (1B→2B, 2B→3B);
// stealing home is rare and structurally different (suicide squeeze, etc.).
// Skip a steal when the next base is occupied — no point.
const stealCandidate = (
  bases: BasesState,
): { from: RunnerBase; to: 2 | 3; id: PlayerId } | null => {
  if (bases.first && !bases.second) return { from: 1, to: 2, id: bases.first };
  if (bases.second && !bases.third) return { from: 2, to: 3, id: bases.second };
  return null;
};

const clearBase = (bases: BasesState, base: RunnerBase): void => {
  if (base === 1) bases.first = null;
  else if (base === 2) bases.second = null;
  else bases.third = null;
};

const setBase = (bases: BasesState, base: RunnerBase, id: PlayerId): void => {
  if (base === 1) bases.first = id;
  else if (base === 2) bases.second = id;
  else bases.third = id;
};

export const resolveBetweenPitches = (
  input: BaserunningInput,
  rng: PRNG,
  playerOf: (id: PlayerId) => Player | undefined,
): BaserunningResult => {
  const ctx: BuildContext = {
    events: [],
    bases: { ...input.bases },
    outs: input.outs,
    runs: 0,
    t: input.t,
  };

  emitLeads(ctx, input, playerOf);

  // Half-inning already ended (3 outs from prior pickoff/steal upstream).
  if (ctx.outs >= 3) {
    return {
      events: ctx.events,
      bases: ctx.bases,
      outsAdded: ctx.outs - input.outs,
      runsScored: ctx.runs,
      t: ctx.t,
      endsHalfInning: true,
    };
  }

  // ----- Pickoff phase -----
  const target = primaryRunner(ctx.bases);
  if (target) {
    const runner = playerOf(target.id);
    if (runner) {
      const { leadFt, aggression } = computeLead(
        runner,
        input.pitcher,
        input.battingMods,
      );
      if (rng.next() < pickoffAttemptRate(runner, input.pitcher, aggression)) {
        ctx.t += TIME_PICKOFF_STEP;
        emit(ctx, {
          t: ctx.t,
          kind: 'pickoffAttempt',
          pitcherId: input.pitcher.id,
          runnerId: target.id,
          targetBase: target.base,
        });
        const errant = rng.next() < errantThrowProb(input.pitcher);
        ctx.t += TIME_PICKOFF_THROW;
        emit(ctx, {
          t: ctx.t,
          kind: 'pickoffThrow',
          pitcherId: input.pitcher.id,
          targetBase: target.base,
          accurate: !errant,
        });
        if (errant) {
          const backup = input.fielders.get(backupPositionFor(target.base));
          // Defensive alignment guarantees a backup OF in normal play —
          // no fallback path needed here.
          if (backup) {
            const landing = backupLandingFor(target.base, rng);
            ctx.t += TIME_ERRANT_DEFLECT;
            emit(ctx, {
              t: ctx.t,
              kind: 'errantThrow',
              pitcherId: input.pitcher.id,
              targetBase: target.base,
              backupFielderId: backup.id,
              landingX: Math.round(landing.x),
              landingY: Math.round(landing.y),
            });
            // Runner attempts to advance one base. The backup OF retrieves
            // and throws to that base — a long, low-percentage tag.
            const advanceTo = (target.base + 1) as 1 | 2 | 3 | 4;
            ctx.t += TIME_BACKUP_THROW;
            const throwBase: RunnerBase =
              advanceTo === 4 ? 3 : (advanceTo as RunnerBase);
            emit(ctx, {
              t: ctx.t,
              kind: 'backupPlay',
              fielderId: backup.id,
              runnerId: target.id,
              throwToBase: throwBase,
            });
            const tagOut = rng.next() < backupTagOutProb(backup, runner);
            ctx.t += TIME_TAG;
            // Scoring on errant throw home: runner from 3B trots in.
            // Don't tag-attempt at home — the throw goes to 3B per
            // standard backup; a runner from 3B simply scores.
            if (advanceTo === 4) {
              emit(ctx, {
                t: ctx.t,
                kind: 'baserunner',
                runnerId: target.id,
                from: 3,
                to: 0,
                out: false,
              });
              clearBase(ctx.bases, 3);
              ctx.runs += 1;
            } else {
              emit(ctx, {
                t: ctx.t,
                kind: 'tagAttempt',
                runnerId: target.id,
                base: throwBase,
                out: tagOut,
              });
              emit(ctx, {
                t: ctx.t,
                kind: 'baserunner',
                runnerId: target.id,
                from: target.base,
                to: throwBase,
                out: tagOut,
              });
              clearBase(ctx.bases, target.base);
              if (tagOut) {
                ctx.outs += 1;
              } else {
                setBase(ctx.bases, throwBase, target.id);
              }
            }
          }
        } else {
          // Clean throw — possibly catches the runner napping.
          const out =
            rng.next() < cleanPickoffOutProb(runner, input.pitcher, leadFt, input.fieldingMods);
          if (out) {
            ctx.t += TIME_TAG;
            emit(ctx, {
              t: ctx.t,
              kind: 'tagAttempt',
              runnerId: target.id,
              base: target.base,
              out: true,
            });
            emit(ctx, {
              t: ctx.t,
              kind: 'baserunner',
              runnerId: target.id,
              from: target.base,
              to: target.base,
              out: true,
            });
            clearBase(ctx.bases, target.base);
            ctx.outs += 1;
          }
          // Clean throw + safe = runner back on the bag, no event needed
          // beyond the pickoffThrow above (the renderer animates the dive
          // back from the lead).
        }
      }
    }
  }

  if (ctx.outs >= 3) {
    return {
      events: ctx.events,
      bases: ctx.bases,
      outsAdded: ctx.outs - input.outs,
      runsScored: ctx.runs,
      t: ctx.t,
      endsHalfInning: true,
    };
  }

  // ----- Steal phase -----
  const cand = stealCandidate(ctx.bases);
  if (cand) {
    const runner = playerOf(cand.id);
    if (runner) {
      const { aggression } = computeLead(runner, input.pitcher, input.battingMods);
      if (
        rng.next() <
        stealAttemptRate(runner, input.pitcher, input.battingMods, aggression)
      ) {
        ctx.t += TIME_STEAL_BREAK;
        emit(ctx, {
          t: ctx.t,
          kind: 'stealAttempt',
          runnerId: cand.id,
          from: cand.from,
          to: cand.to,
        });
        const safe =
          rng.next() <
          stealSafeProb(runner, input.catcher, input.battingMods, input.fieldingMods);
        ctx.t += TIME_STEAL_RACE;
        emit(ctx, {
          t: ctx.t,
          kind: 'tagAttempt',
          runnerId: cand.id,
          base: cand.to,
          out: !safe,
        });
        emit(ctx, {
          t: ctx.t,
          kind: 'baserunner',
          runnerId: cand.id,
          from: cand.from,
          to: cand.to,
          out: !safe,
        });
        clearBase(ctx.bases, cand.from);
        if (safe) {
          setBase(ctx.bases, cand.to, cand.id);
          // Once a runner advances, fire a fresh lead at the new base
          // before the next pitch. Caller drives this via its own
          // emitLeads sweep, so just clear the prior lead key.
          input.leadsEmitted.delete(`${cand.id}@${cand.from}`);
        } else {
          ctx.outs += 1;
        }
      }
    }
  }

  return {
    events: ctx.events,
    bases: ctx.bases,
    outsAdded: ctx.outs - input.outs,
    runsScored: ctx.runs,
    t: ctx.t,
    endsHalfInning: ctx.outs >= 3,
  };
};
