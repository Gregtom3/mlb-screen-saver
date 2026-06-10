// /render/weather.ts — cosmetic precipitation overlays. Pure function of
// (ctx, weather, simTime): no state, no sim knowledge, degrades to nothing
// when the weather is clear. Particle positions are derived from hashed
// indices + simTime so every frame is reproducible (same tick = same sky).

export type WeatherKind = 'clear' | 'rain' | 'snow' | 'fog';

// Cheap deterministic hash → [0, 1). Stable per particle index.
const h01 = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const RAIN_DROPS = 110;
const SNOW_FLAKES = 70;
const FOG_BANDS = 3;

export const drawWeather = (
  ctx: CanvasRenderingContext2D,
  weather: WeatherKind,
  simTime: number,
): void => {
  if (weather === 'clear') return;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.save();

  if (weather === 'rain') {
    // A faint storm veil, then slanted streaks falling fast.
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = '#1c2733';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.32;
    ctx.strokeStyle = '#9fb4c8';
    ctx.lineWidth = Math.max(1, W / 900);
    ctx.beginPath();
    for (let i = 0; i < RAIN_DROPS; i++) {
      const speed = 0.025 + h01(i) * 0.015; // screen-heights per tick
      const y = ((h01(i * 7 + 1) + simTime * speed) % 1) * H;
      const x = (h01(i) * W + y * 0.08) % W;
      const len = H * 0.018;
      ctx.moveTo(x, y);
      ctx.lineTo(x - len * 0.15, y + len);
    }
    ctx.stroke();
  } else if (weather === 'snow') {
    ctx.fillStyle = '#eef2f7';
    for (let i = 0; i < SNOW_FLAKES; i++) {
      const speed = 0.004 + h01(i) * 0.004;
      const y = ((h01(i * 3 + 2) + simTime * speed) % 1) * H;
      const sway = Math.sin(simTime * 0.05 + i * 1.7) * W * 0.006;
      const x = (h01(i) * W + sway + W) % W;
      const px = Math.max(2, Math.round(W / 640) * 2);
      ctx.globalAlpha = 0.55 + h01(i + 9) * 0.35;
      ctx.fillRect(Math.round(x), Math.round(y), px, px);
    }
  } else {
    // Fog: slow horizontal bands drifting across the lower park.
    ctx.fillStyle = '#aab4c0';
    for (let k = 0; k < FOG_BANDS; k++) {
      const bandH = H * 0.13;
      const y = H * (0.30 + 0.18 * k) + Math.sin(simTime * 0.008 + k * 2.1) * H * 0.01;
      ctx.globalAlpha = 0.07 + 0.03 * Math.sin(simTime * 0.01 + k * 1.3) + 0.04;
      ctx.fillRect(0, y, W, bandH);
    }
  }

  ctx.restore();
};
