/**
 * Sunflower packing, explained visually.
 *
 * Two things confuse people about it, and both are answered by drawing rather than describing:
 *
 *   1. Do the buildings get bigger further out?  No. Every square here is drawn at its true
 *      footprint, so you can see they are identical everywhere.
 *   2. Then how does it stay dense?  Because area grows with the square of the radius. The growth
 *      strip on the right holds the scale fixed while the count goes up 10x, and the disc only
 *      about triples.
 *
 *   http://localhost:5173/?sunflower
 */

import type { CityData } from '../data/types';
import { monthKey } from '../data/dates';
import { formatMonthKey } from '../data/dates';
import { PLOT } from './polar';

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const AREA_PER_ENTRY = 0.9 * PLOT * PLOT;
const R0 = 14;

const radiusFor = (i: number) => Math.sqrt(R0 * R0 + ((i + 0.5) * AREA_PER_ENTRY) / Math.PI);

function positions(count: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const r = radiusFor(i);
    const a = i * GOLDEN_ANGLE;
    out.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
  }
  return out;
}

export function drawSunflowerExplainer(canvas: HTMLCanvasElement, city: CityData): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');

  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0d0f17';
  ctx.fillRect(0, 0, W, H);

  const entries = [...city.entries].sort((a, b) => (a.date < b.date ? -1 : 1));

  // Month boundaries, as running totals.
  const monthCounts = new Map<string, number>();
  for (const e of entries) monthCounts.set(monthKey(e.date), (monthCounts.get(monthKey(e.date)) ?? 0) + 1);
  const months = [...monthCounts.entries()].sort(([a], [b]) => (a < b ? -1 : 1));

  // ---------------------------------------------------------------- main --

  const mainW = W * 0.60;
  const cx = mainW / 2;
  const cy = H / 2 + 6;
  const total = entries.length;
  const maxR = radiusFor(total);
  const scale = (Math.min(mainW, H) * 0.40) / maxR;

  // Alternating month bands, so the calendar is visible without wedges or segregation.
  let seen = 0;
  months.forEach(([, count], index) => {
    const inner = radiusFor(seen) * scale;
    seen += count;
    const outer = radiusFor(seen) * scale;

    ctx.beginPath();
    ctx.arc(cx, cy, outer, 0, TAU);
    ctx.arc(cx, cy, inner, 0, TAU, true);
    ctx.fillStyle = index % 2 === 0 ? 'rgba(232,180,200,0.09)' : 'rgba(140,180,255,0.07)';
    ctx.fill();

  });

  // Buildings, drawn at their true footprint. This is the point of the whole picture.
  const side = Math.max(1.6, PLOT * scale * 0.82);
  for (const p of positions(total)) {
    ctx.fillStyle = '#ffc27a';
    ctx.fillRect(cx + p.x * scale - side / 2, cy + p.z * scale - side / 2, side, side);
  }

  // Month boundaries drawn over the buildings, otherwise they are buried under them. Labels are
  // spread around the circle so they do not stack on top of each other.
  ctx.font = '10px ui-monospace, monospace';
  seen = 0;
  months.forEach(([key, count], index) => {
    seen += count;
    const r = radiusFor(seen) * scale;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (index % 3 !== 0 && index !== months.length - 1) return;
    // Walk the label angle around as we go outward.
    const a = -Math.PI / 2 + index * 0.55;
    const lx = cx + Math.cos(a) * r;
    const ly = cy + Math.sin(a) * r;
    const out = 15;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(lx + Math.cos(a) * out, ly + Math.sin(a) * out);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = Math.cos(a) < 0 ? 'right' : 'left';
    ctx.fillText(
      formatMonthKey(key),
      lx + Math.cos(a) * (out + 4),
      ly + Math.sin(a) * (out + 4) + 3,
    );
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = '#f2f4fa';
  ctx.font = '600 16px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('Sunflower packing, with month bands', cx, 30);
  ctx.fillStyle = '#8b93a8';
  ctx.font = '11.5px ui-monospace, monospace';
  ctx.fillText(
    `${total} buildings · every square is the same size · shaded bands are months`,
    cx,
    50,
  );
  ctx.fillText(
    'Months are still readable as rings. They are just not containers any more.',
    cx,
    H - 24,
  );

  // -------------------------------------------------------------- growth --

  const panelX = mainW;
  const panelW = W - mainW;
  const steps = [
    { n: Math.min(200, total), label: '200 wins' },
    { n: Math.min(800, total), label: '800 wins' },
    { n: total, label: `${total} wins` },
  ];

  ctx.textAlign = 'center';
  ctx.fillStyle = '#f2f4fa';
  ctx.font = '600 14px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('Same scale, 10x the wins', panelX + panelW / 2, 30);
  ctx.fillStyle = '#8b93a8';
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillText('the disc barely triples', panelX + panelW / 2, 48);

  // One shared scale across all three, which is what makes the comparison honest.
  const growthScale = (Math.min(panelW, H / 3) * 0.30) / radiusFor(total);
  const panelH = (H - 90) / steps.length;

  steps.forEach((step, i) => {
    const px = panelX + panelW / 2;
    const py = 80 + panelH * i + panelH / 2;

    ctx.beginPath();
    ctx.arc(px, py, radiusFor(step.n) * growthScale, 0, TAU);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.stroke();

    const s = Math.max(1, PLOT * growthScale * 0.82);
    for (const p of positions(step.n)) {
      ctx.fillStyle = '#ffc27a';
      ctx.fillRect(px + p.x * growthScale - s / 2, py + p.z * growthScale - s / 2, s, s);
    }

    ctx.fillStyle = '#c3c8d8';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(
      `${step.label} · radius ${radiusFor(step.n).toFixed(0)}`,
      px,
      py + panelH / 2 - 10,
    );
  });
}
