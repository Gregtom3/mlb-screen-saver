import type { FieldTransform } from './transform.js';
import type { StadiumAtmosphere } from '../world/types.js';
import type { BowlPoint, BowlTierSpec, StadiumBowl } from './stadium-bowl.js';
import type { CrowdState } from '../ambience/state.js';

// Crowd renderer. Now draws a continuous tiered bowl built from the polyline
// in stadium-bowl.ts — back-wall concrete, lower bowl, concourse gap, upper
// deck, and a roof facade. All stochastic decisions go through a
// deterministic hash of (seatId, simTime) so successive frames at the same
// simTime produce byte-identical output — the determinism contract from
// CLAUDE.md applies here.

const SKIN_TONES = ['#c79475', '#a36a45', '#8a4f30', '#e2b89c'];
const HAT_HIGHLIGHT = 0.18; // fraction of fan pixels that flash a brighter palette color
const RAILING_COLOR = '#1a1d22';

const hash32 = (a: number, b: number): number => {
  let x = (a * 0x9e3779b1) ^ (b * 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
};

const rand01 = (a: number, b: number): number => hash32(a, b) / 0x1_00_00_00_00;

// Resolve a 0..1 density given the curve type and the current inning.
export const densityForInning = (
  curve: StadiumAtmosphere['crowdDensityCurve'],
  inning: number,
): number => {
  const i = Math.max(1, Math.min(9, inning));
  switch (curve) {
    case 'home-heavy':
      return 0.78 - (i - 1) * 0.012; // 0.78 → 0.69
    case 'flat':
      return 0.6;
    case 'late-arrivers':
      return Math.min(0.85, 0.3 + (i - 1) * 0.135); // 0.30 → 0.85 by i=5
  }
};

interface CrowdArgs {
  readonly ctx: CanvasRenderingContext2D;
  readonly transform: FieldTransform;
  readonly atmosphere: StadiumAtmosphere;
  readonly bowl: StadiumBowl;
  readonly inning: number;
  readonly simTime: number;
  // Optional wave-burst — angle band where fans are jumping right now.
  readonly waveCenterAngleDeg?: number;
  readonly waveStrength?: number; // 0..1
  // Optional live crowd state. Drives an energy-modulated density bump
  // (more seats fill in when the building is loud), and an arousal-driven
  // flicker rate (more camera flashes during a roar). Absent = baseline.
  readonly crowdState?: CrowdState;
}

// Build a closed polygon from two parallel offsets of the bowl front edge.
// `inner` is at innerOffsetPx outward from the front; `outer` is at
// (innerOffsetPx + depthPx) outward. This is the back-wall + tier-fill
// geometry shared by every tier.
const tierPolygon = (
  front: readonly BowlPoint[],
  innerOffsetPx: number,
  depthPx: number,
  riseLiftPx: number,
): { inner: { x: number; y: number }[]; outer: { x: number; y: number }[] } => {
  const inner: { x: number; y: number }[] = [];
  const outer: { x: number; y: number }[] = [];
  for (const p of front) {
    inner.push({
      x: p.screen.x + p.outward.nx * innerOffsetPx,
      y: p.screen.y + p.outward.ny * innerOffsetPx - riseLiftPx,
    });
    outer.push({
      x: p.screen.x + p.outward.nx * (innerOffsetPx + depthPx),
      y: p.screen.y + p.outward.ny * (innerOffsetPx + depthPx) - riseLiftPx,
    });
  }
  return { inner, outer };
};

// Trace a ribbon polygon: walk inner forward, then outer backward, close.
const tracePolygon = (
  ctx: CanvasRenderingContext2D,
  inner: readonly { x: number; y: number }[],
  outer: readonly { x: number; y: number }[],
): void => {
  if (inner.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(inner[0]!.x, inner[0]!.y);
  for (let i = 1; i < inner.length; i++) ctx.lineTo(inner[i]!.x, inner[i]!.y);
  for (let i = outer.length - 1; i >= 0; i--) ctx.lineTo(outer[i]!.x, outer[i]!.y);
  ctx.closePath();
};

// Draw the structural fill (concrete back wall + section block colors) for
// a tier. This is the layer that turns the old "picket fence" into a real
// stadium silhouette: a solid polygon, then a per-section color sweep
// painted across it as vertical stripes following the outward normal.
const drawTierStructure = (
  ctx: CanvasRenderingContext2D,
  front: readonly BowlPoint[],
  tier: BowlTierSpec,
): void => {
  // Pad the structural fill a touch beyond the tier's nominal band so
  // adjacent tiers OVERLAP instead of abutting edge-to-edge. Abutting
  // float-coordinate polygons leave antialiased hairline seams (and the
  // offset polyline develops small notches at sharp curve joints), which
  // let the sky/grass behind the bowl peek through as "polygonal gaps".
  const SEAM_PAD_PX = 1.5;
  const { inner, outer } = tierPolygon(
    front,
    tier.innerOffsetPx - SEAM_PAD_PX,
    tier.depthPx + SEAM_PAD_PX * 2,
    tier.riseLiftPx,
  );
  // Back-wall concrete fill. This is what gives the bowl its silhouette.
  // Fill + same-color stroke: the stroke seals antialiasing cracks along
  // the ribbon edges and bridges any notch the offset geometry opened.
  ctx.save();
  ctx.fillStyle = tier.backWallColor;
  ctx.strokeStyle = tier.backWallColor;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  tracePolygon(ctx, inner, outer);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Section block colors — vertical stripes across the tier ribbon. We walk
  // each front sample and shoot a thin column outward in its palette color.
  // Section width = a few samples, so adjacent samples share a color.
  if (tier.seatPalette.length > 0 && tier.seatRows > 0) {
    const SECTION_LEN = 3; // samples per section
    for (let i = 0; i < front.length; i++) {
      const innerP = inner[i]!;
      const outerP = outer[i]!;
      const colorIdx = Math.floor(i / SECTION_LEN) % tier.seatPalette.length;
      // Slight palette shifting so adjacent sections don't repeat exactly.
      const tint = (Math.floor(i / SECTION_LEN) * 1.7) % tier.seatPalette.length;
      const color = tier.seatPalette[Math.floor(tint) % tier.seatPalette.length] ?? tier.seatPalette[colorIdx]!;
      ctx.fillStyle = color;
      // 1.5-px wide column from inner to outer.
      const dx = outerP.x - innerP.x;
      const dy = outerP.y - innerP.y;
      const len = Math.hypot(dx, dy) || 1;
      const sx = -dy / len; // perpendicular for column width
      const sy = dx / len;
      const half = 0.9;
      ctx.beginPath();
      ctx.moveTo(innerP.x - sx * half, innerP.y - sy * half);
      ctx.lineTo(outerP.x - sx * half, outerP.y - sy * half);
      ctx.lineTo(outerP.x + sx * half, outerP.y + sy * half);
      ctx.lineTo(innerP.x + sx * half, innerP.y + sy * half);
      ctx.closePath();
      ctx.fill();
    }
  }
};

// Stair-stepped fan rows for a tier. Each row is offset progressively
// further from the bowl front, with deterministic per-seat fan / empty /
// flicker decisions. Replaces the old single-line speckle.
//
// `flickerThreshold` controls how often a seat brightens to white (camera
// flash). Lower threshold = more flashes; ramped down with arousal. Default
// is 0.985 (~1 in 150 per epoch); a peak roar brings it to ~0.96 (~1 in 25).
//
// `arousalLift` is a small extra lift applied to the front row only, so the
// crowd reads as "leaning in" during peak moments. Sine-modulated by simTime.
const drawTierFans = (
  ctx: CanvasRenderingContext2D,
  front: readonly BowlPoint[],
  tier: BowlTierSpec,
  density: number,
  simTime: number,
  bandSeed: number,
  wave?: { centerDeg: number; strength: number },
  flickerThreshold: number = 0.985,
  arousalLift: number = 0,
): void => {
  if (tier.seatRows <= 0) return;
  const rowSpacing = tier.depthPx / tier.seatRows;
  const flickerEpoch = Math.floor(simTime / 6);
  // Faster flicker churn at high arousal — re-roll the camera-flash hash
  // every 2 simTicks instead of 6 so the flashes feel pulsing.
  const fastEpoch =
    flickerThreshold < 0.97 ? Math.floor(simTime / 2) : flickerEpoch;
  const palette = tier.seatPalette;
  // Slow LFO so the lean-in doesn't feel uniform across the bowl.
  const leanLfo = Math.sin(simTime * 0.18);
  for (let row = 0; row < tier.seatRows; row++) {
    // Each row sits midway through its slice of the tier.
    const rowOffset = tier.innerOffsetPx + (row + 0.5) * rowSpacing;
    for (let i = 0; i < front.length; i++) {
      const p = front[i]!;
      const fx = p.screen.x + p.outward.nx * rowOffset;
      const fy = p.screen.y + p.outward.ny * rowOffset - tier.riseLiftPx;
      const seatId = (i * 257 + row * 9001) ^ bandSeed;
      const r = rand01(seatId, 0);
      if (r > density) continue;
      // Wave-burst lift: for outfield-bowl seats only (anglePct between
      // ~0..0.5), lift fans within a window of the wave-center angle.
      let lift = 0;
      if (wave && wave.strength > 0) {
        const seatAngle = (p.anglePct - 0.25) * 360; // rough mapping
        const delta = Math.abs(seatAngle - wave.centerDeg);
        if (delta < 22) {
          const fall = 1 - delta / 22;
          lift = -1 * fall * wave.strength;
        }
      }
      // Front-row lean: only the inner-most row, modulated by simTime.
      if (row === 0 && arousalLift > 0 && leanLfo > 0) {
        lift -= leanLfo * arousalLift;
      }
      const colorRoll = rand01(seatId, 1);
      let fanColor: string;
      if (colorRoll < HAT_HIGHLIGHT && palette.length > 0) {
        fanColor = palette[hash32(seatId, 2) % palette.length]!;
      } else {
        fanColor = SKIN_TONES[hash32(seatId, 3) % SKIN_TONES.length]!;
      }
      // Camera flashes — threshold drops with arousal so a roar fills the
      // bowl with brief flickers.
      if (rand01(seatId, fastEpoch) > flickerThreshold) {
        fanColor = '#ffffff';
      }
      ctx.fillStyle = fanColor;
      ctx.fillRect(Math.round(fx), Math.round(fy + lift), 1, 1);
    }
  }
};

// Front railing — a thin dark line right at the inner edge of the lower
// bowl. Reads as the wall between the field and the front-row seats.
const drawFrontRailing = (
  ctx: CanvasRenderingContext2D,
  front: readonly BowlPoint[],
): void => {
  ctx.save();
  ctx.strokeStyle = RAILING_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < front.length; i++) {
    const p = front[i]!;
    if (i === 0) ctx.moveTo(p.screen.x, p.screen.y);
    else ctx.lineTo(p.screen.x, p.screen.y);
  }
  ctx.stroke();
  ctx.restore();
};

// Roof support struts — sparse vertical ticks visible against the sky. Drawn
// behind the upper-deck-facing edge of the roof so the roof reads as a
// shaded canopy rather than a flat band.
const drawRoofSupports = (
  ctx: CanvasRenderingContext2D,
  front: readonly BowlPoint[],
  tier: BowlTierSpec,
): void => {
  ctx.save();
  ctx.fillStyle = '#0a0c10';
  for (let i = 0; i < front.length; i += 4) {
    const p = front[i]!;
    const innerX = p.screen.x + p.outward.nx * tier.innerOffsetPx;
    const innerY = p.screen.y + p.outward.ny * tier.innerOffsetPx - tier.riseLiftPx;
    const outerX = p.screen.x + p.outward.nx * (tier.innerOffsetPx + tier.depthPx);
    const outerY = p.screen.y + p.outward.ny * (tier.innerOffsetPx + tier.depthPx) - tier.riseLiftPx;
    // 1-px diagonal strut from inner-bottom to outer-top.
    ctx.fillRect(Math.round(innerX), Math.round(innerY - 1), 1, 1);
    ctx.fillRect(Math.round(outerX), Math.round(outerY - 1), 1, 1);
  }
  ctx.restore();
};

// Multipliers from the live CrowdState → density bump, flicker rate,
// front-row lean. Quantized to keep frame-to-frame seat-id hashes stable.
interface CrowdMods {
  readonly densityMul: number;
  readonly flickerThreshold: number;
  readonly arousalLift: number;
}

const crowdModsFor = (state?: CrowdState): CrowdMods => {
  if (!state) {
    return { densityMul: 1, flickerThreshold: 0.985, arousalLift: 0 };
  }
  // Quantize energy to 0.1 buckets so density doesn't churn each frame.
  const eq = Math.round(state.energy * 10) / 10;
  // 0.85x at no energy, up to 1.10x at peak — keeps things readable.
  const densityMul = 0.85 + eq * 0.25;
  // Arousal in [0,1] → flicker threshold in [0.985, 0.96].
  const flickerThreshold = 0.985 - state.arousal * 0.025;
  // Front-row lean — up to 1px on a peak roar.
  const arousalLift = state.arousal * 1.0;
  return { densityMul, flickerThreshold, arousalLift };
};

// Public entrypoint — draws all back-of-bowl layers (concrete + upper deck +
// roof) before the field is drawn. The lower-bowl seats and front railing
// are deferred to drawStadiumBowlFront so the field/wall/dugouts can slot
// between them.
export const drawStadiumBowlBack = (args: CrowdArgs): void => {
  const { ctx, atmosphere, bowl, inning, simTime, crowdState } = args;
  const baseDensity = densityForInning(atmosphere.crowdDensityCurve, inning);
  const mods = crowdModsFor(crowdState);
  const density = Math.min(0.95, baseDensity * mods.densityMul);
  const wave =
    args.waveStrength && args.waveStrength > 0 && args.waveCenterAngleDeg !== undefined
      ? { centerDeg: args.waveCenterAngleDeg, strength: args.waveStrength }
      : undefined;

  // Upper deck + fans.
  drawTierStructure(ctx, bowl.front, bowl.tiers.upper);
  drawTierFans(
    ctx,
    bowl.front,
    bowl.tiers.upper,
    density * 0.85, // upper deck typically a bit emptier
    simTime,
    0xa1c3,
    wave,
    mods.flickerThreshold,
    0, // upper-deck doesn't lean
  );

  // Roof — facade band + a couple of supports peeking into the sky.
  drawTierStructure(ctx, bowl.front, bowl.tiers.roof);
  drawRoofSupports(ctx, bowl.front, bowl.tiers.roof);
};

// Lower-bowl seats + front railing. Drawn AFTER the field, dugouts, and
// foul poles so the front row reads as right next to the action.
export const drawStadiumBowlFront = (args: CrowdArgs): void => {
  const { ctx, atmosphere, bowl, inning, simTime, crowdState } = args;
  const baseDensity = densityForInning(atmosphere.crowdDensityCurve, inning);
  const mods = crowdModsFor(crowdState);
  const density = Math.min(0.95, baseDensity * mods.densityMul);
  const wave =
    args.waveStrength && args.waveStrength > 0 && args.waveCenterAngleDeg !== undefined
      ? { centerDeg: args.waveCenterAngleDeg, strength: args.waveStrength }
      : undefined;

  drawTierStructure(ctx, bowl.front, bowl.tiers.lower);
  drawTierFans(
    ctx,
    bowl.front,
    bowl.tiers.lower,
    density,
    simTime,
    0xfac3,
    wave,
    mods.flickerThreshold,
    mods.arousalLift,
  );
  drawFrontRailing(ctx, bowl.front);
};
