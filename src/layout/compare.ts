/**
 * Side-by-side comparison of the candidate layouts, drawn in 2D against real data.
 *
 * Exists so a layout decision is made by looking rather than by argument. 2D canvas renders in
 * milliseconds where the 3D city takes minutes, which makes it the right place to judge spatial
 * questions like whether a plan stays dense as a city grows.
 *
 *   http://localhost:5173/?compare
 */

import type { CityData } from '../data/types';
import { CATEGORY_BY_ID } from '../data/types';
import { layoutCity } from './polar';
import { layoutSunflower, layoutYearRings } from './alternatives';
import type { CityLayout } from './polar';

const TAU = Math.PI * 2;

interface Candidate {
  title: string;
  note: string;
  layout: CityLayout;
}

/**
 * Buildings per unit of ground, inner half of the city versus outer half.
 *
 * Measured by area, not by nearest neighbour. Neighbour spacing is a plot width in every plan,
 * because buildings sit next to each other wherever they sit — the sparsity shows up as how much
 * of the available ground actually gets used, which is exactly what this measures.
 */
function densityReport(layout: CityLayout): string {
  const points = layout.placements.map((p) => Math.hypot(p.x, p.z));
  if (points.length < 40) return 'not enough buildings to measure';

  const inner = layout.downtownRadius;
  const outer = layout.radius;
  if (outer <= inner) return 'city too small to measure';
  const mid = Math.sqrt((inner * inner + outer * outer) / 2); // splits the area in half

  const innerCount = points.filter((r) => r <= mid).length;
  const outerCount = points.filter((r) => r > mid).length;
  const innerArea = Math.PI * (mid * mid - inner * inner);
  const outerArea = Math.PI * (outer * outer - mid * mid);

  const innerDensity = innerCount / innerArea;
  const outerDensity = outerCount / outerArea;
  const ratio = innerDensity > 0 ? outerDensity / innerDensity : 0;

  return `density outer/inner ${ratio.toFixed(2)}x  (${innerCount} in / ${outerCount} out)`;
}

function drawOne(
  ctx: CanvasRenderingContext2D,
  candidate: Candidate,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const { layout } = candidate;
  const cx = x + w / 2;
  const cy = y + h * 0.5;
  const scale = (Math.min(w, h * 1.35) * 0.42) / Math.max(layout.radius, 1);

  // Band boundaries.
  for (const band of layout.bands) {
    ctx.beginPath();
    ctx.arc(cx, cy, band.outerRadius * scale, 0, TAU);
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, layout.downtownRadius * scale, 0, TAU);
  ctx.strokeStyle = 'rgba(232,180,200,0.4)';
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const p of layout.placements) {
    ctx.beginPath();
    ctx.arc(cx + p.x * scale, cy + p.z * scale, 1.5, 0, TAU);
    ctx.fillStyle = CATEGORY_BY_ID[p.category].color;
    ctx.fill();
  }

  for (const tower of layout.towers) {
    const size = 5;
    ctx.fillStyle = tower.lit ? '#ffd9a0' : '#3f4759';
    ctx.fillRect(cx + tower.x * scale - size / 2, cy + tower.z * scale - size / 2, size, size);
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#f2f4fa';
  ctx.font = '600 15px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(candidate.title, cx, y + 26);

  ctx.fillStyle = '#8b93a8';
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillText(candidate.note, cx, y + 45);
  ctx.fillText(
    `radius ${layout.radius.toFixed(0)} · ${layout.placements.length} buildings`,
    cx,
    y + h - 62,
  );
  ctx.fillStyle = '#e9ecf5';
  ctx.font = '600 12px ui-monospace, monospace';
  ctx.fillText(densityReport(layout), cx, y + h - 44);
}

export function drawComparison(canvas: HTMLCanvasElement, city: CityData, asOf: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = '#0d0f17';
  ctx.fillRect(0, 0, width, height);

  const candidates: Candidate[] = [
    {
      title: 'Now: one ring per month',
      note: 'outer rings thin out forever',
      layout: layoutCity(city, asOf),
    },
    {
      title: 'Sunflower packing',
      note: 'same density at every radius',
      layout: layoutSunflower(city, asOf),
    },
    {
      title: 'Year rings, month wedges',
      note: 'a year of content per ring',
      layout: layoutYearRings(city, asOf),
    },
  ];

  const w = width / candidates.length;
  candidates.forEach((candidate, i) => drawOne(ctx, candidate, i * w, 0, w, height));

  // The number that decides it: outer spacing divided by inner spacing. 1.00 is perfectly even.
  ctx.textAlign = 'center';
  ctx.fillStyle = '#6f7689';
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillText(
    'density outer/inner: 1.00 = evenly built everywhere. Below 1.00 = the edge is emptier than the middle, and gets worse as the city grows.',
    width / 2,
    height - 14,
  );
}
