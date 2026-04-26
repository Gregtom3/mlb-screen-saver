import type { GameWPTimeline } from '../stats/types.js';

// Per-game win-probability chart. Pixel-art styling: 1px line, dot markers
// on swings > 10% delta. Color-coded by which team gained probability.

export interface WPChartOptions {
  readonly width: number;
  readonly height: number;
  /** Hex strings — used for the line/segment color when a side gains WP. */
  readonly homeColor: string;
  readonly awayColor: string;
  /** Show inline annotations on big swings. Default true. */
  readonly annotations?: boolean;
}

export const drawWPChart = (
  ctx: CanvasRenderingContext2D,
  timeline: GameWPTimeline | undefined,
  opts: WPChartOptions,
): void => {
  const { width, height } = opts;
  ctx.fillStyle = '#0b0d10';
  ctx.fillRect(0, 0, width, height);

  // Frame + 50% line.
  const padX = 8;
  const padY = 12;
  ctx.strokeStyle = '#1d2128';
  ctx.lineWidth = 1;
  ctx.strokeRect(padX, padY, width - padX * 2, height - padY * 2);
  ctx.beginPath();
  const midY = padY + (height - padY * 2) * 0.5;
  ctx.moveTo(padX, midY);
  ctx.lineTo(width - padX, midY);
  ctx.strokeStyle = '#1d2128';
  ctx.setLineDash([2, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  if (!timeline || timeline.samples.length < 2) {
    ctx.fillStyle = '#6a7079';
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('No win-probability samples yet', width / 2, height / 2);
    ctx.textAlign = 'left';
    return;
  }

  const usableW = width - padX * 2;
  const usableH = height - padY * 2;
  const samples = timeline.samples;
  const xFor = (i: number) => padX + (i / (samples.length - 1)) * usableW;
  const yFor = (wp: number) => padY + (1 - wp) * usableH;

  // Line. Color each segment by which team gained.
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const homeUp = b.wpHome > a.wpHome;
    ctx.strokeStyle = homeUp ? opts.homeColor : opts.awayColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xFor(i - 1), yFor(a.wpHome));
    ctx.lineTo(xFor(i), yFor(b.wpHome));
    ctx.stroke();
  }

  // Dots on big swings (>10% delta).
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    if (Math.abs(s.delta) > 0.10) {
      ctx.fillStyle = s.delta > 0 ? '#f1c40f' : '#9aa0a6';
      ctx.beginPath();
      ctx.arc(xFor(i), yFor(s.wpHome), 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Inline annotations for the biggest swings.
  if (opts.annotations !== false) {
    const big = samples
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.note && Math.abs(s.delta) > 0.10)
      .sort((a, b) => Math.abs(b.s.delta) - Math.abs(a.s.delta))
      .slice(0, 4);
    ctx.font = '10px ui-monospace, Menlo, monospace';
    for (const { s, i } of big) {
      const x = xFor(i);
      const y = yFor(s.wpHome);
      const text = `${s.inning}${s.half === 'top' ? '▲' : '▼'} ${s.note}`;
      ctx.fillStyle = '#0b0d10';
      const metrics = ctx.measureText(text);
      const tw = metrics.width + 6;
      const ty = y < height / 2 ? y + 12 : y - 18;
      ctx.fillRect(Math.min(x - tw / 2, width - tw - 2), ty, tw, 14);
      ctx.fillStyle = '#f1c40f';
      ctx.textAlign = 'center';
      ctx.fillText(text, Math.min(x, width - tw / 2 - 2), ty + 10);
    }
    ctx.textAlign = 'left';
  }

  // Y-axis labels.
  ctx.fillStyle = '#6a7079';
  ctx.font = '10px ui-monospace, Menlo, monospace';
  ctx.fillText('100% home', padX + 2, padY + 10);
  ctx.fillText('100% away', padX + 2, height - padY - 2);
};

// Mini sparkline version for the live-grid tile. No padding, no annotations.
export const drawWPSparkline = (
  ctx: CanvasRenderingContext2D,
  timeline: GameWPTimeline | undefined,
  width: number,
  height: number,
  homeColor: string,
  awayColor: string,
): void => {
  ctx.fillStyle = '#0b0d10';
  ctx.fillRect(0, 0, width, height);
  if (!timeline || timeline.samples.length < 2) return;
  const samples = timeline.samples;
  const xFor = (i: number) => (i / (samples.length - 1)) * width;
  const yFor = (wp: number) => (1 - wp) * height;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    ctx.strokeStyle = b.wpHome > a.wpHome ? homeColor : awayColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xFor(i - 1), yFor(a.wpHome));
    ctx.lineTo(xFor(i), yFor(b.wpHome));
    ctx.stroke();
  }
};
