/**
 * Top-down 2D view of the layout.
 *
 * This exists so that placement can be verified before any Three.js is written. It is a
 * development tool, not a product surface — but it stays in the repo, because when the 3D city
 * looks wrong this is the fastest way to find out whether the cause is the layout or the render.
 */

import { CATEGORIES, CATEGORY_BY_ID } from '../data/types';
import type { CityLayout } from './polar';
import { validateLayout, type Check } from './validate';
import { formatMonthKey } from '../data/dates';

const TAU = Math.PI * 2;

export interface DebugOptions {
  showChecks?: boolean;
  label?: string;
}

export function drawLayout(
  canvas: HTMLCanvasElement,
  layout: CityLayout,
  options: DebugOptions = {},
): Check[] {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = '#0d0f17';
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const panelWidth = options.showChecks === false ? 0 : 340;
  const viewWidth = cssWidth - panelWidth;
  const cx = viewWidth / 2;
  const cy = cssHeight / 2;
  const scale = (Math.min(viewWidth, cssHeight) * 0.46) / Math.max(layout.radius, 1);

  const sx = (x: number) => cx + x * scale;
  const sy = (z: number) => cy + z * scale;

  // --- month bands ------------------------------------------------------

  for (const band of layout.bands) {
    ctx.beginPath();
    ctx.arc(cx, cy, band.outerRadius * scale, 0, TAU);
    ctx.strokeStyle = band.isEmpty ? 'rgba(127,155,118,0.55)' : 'rgba(255,255,255,0.10)';
    ctx.lineWidth = band.isEmpty ? 2 : 1;
    ctx.stroke();

    if (band.isEmpty) {
      // Quiet months are parkland, not gaps. Fill them so that reads at a glance.
      ctx.beginPath();
      ctx.arc(cx, cy, band.outerRadius * scale, 0, TAU);
      ctx.arc(cx, cy, band.innerRadius * scale, 0, TAU, true);
      ctx.fillStyle = 'rgba(127,155,118,0.12)';
      ctx.fill();
    }
  }

  // --- category wedge dividers -----------------------------------------

  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  for (let i = 0; i < CATEGORIES.length; i += 1) {
    const angle = (TAU / CATEGORIES.length) * i;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(sx(Math.cos(angle) * layout.radius), sy(Math.sin(angle) * layout.radius));
    ctx.stroke();
  }

  // Wedge labels, placed mid-arc at the city edge.
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const meta of CATEGORIES) {
    const angle = (TAU / CATEGORIES.length) * (meta.wedge + 0.5);
    const r = layout.radius * 1.06;
    ctx.fillStyle = meta.color;
    ctx.fillText(meta.label, sx(Math.cos(angle) * r), sy(Math.sin(angle) * r));
  }

  // --- downtown ---------------------------------------------------------

  ctx.beginPath();
  ctx.arc(cx, cy, layout.downtownRadius * scale, 0, TAU);
  ctx.strokeStyle = 'rgba(232,180,200,0.35)';
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // --- one-off wins -----------------------------------------------------

  for (const p of layout.placements) {
    const meta = CATEGORY_BY_ID[p.category];
    const size = p.category === 'milestone' ? 4.5 : 2.6;
    ctx.beginPath();
    ctx.arc(sx(p.x), sy(p.z), size, 0, TAU);
    ctx.fillStyle = meta.color;
    ctx.fill();
    if (p.category === 'milestone') {
      ctx.beginPath();
      ctx.arc(sx(p.x), sy(p.z), 9, 0, TAU);
      ctx.strokeStyle = 'rgba(232,180,200,0.5)';
      ctx.stroke();
    }
  }

  // --- commitment towers ------------------------------------------------

  for (const tower of layout.towers) {
    const size = 6 + Math.min(tower.floors, 120) * 0.12;
    ctx.fillStyle = tower.lit ? '#ffd9a0' : '#3f4759';
    ctx.fillRect(sx(tower.x) - size / 2, sy(tower.z) - size / 2, size, size);
    ctx.strokeStyle = tower.lit ? 'rgba(255,217,160,0.4)' : 'rgba(120,132,158,0.4)';
    ctx.strokeRect(sx(tower.x) - size / 2, sy(tower.z) - size / 2, size, size);
  }

  // --- checks panel -----------------------------------------------------

  const checks = validateLayout(layout);
  if (options.showChecks === false) return checks;

  const px = viewWidth + 20;
  let py = 28;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = '#e9ecf5';
  ctx.font = '600 14px ui-monospace, monospace';
  ctx.fillText(options.label ?? 'Layout check', px, py);
  py += 22;

  ctx.font = '11px ui-monospace, monospace';
  ctx.fillStyle = '#8b93a8';
  ctx.fillText(
    `${layout.placements.length} wins · ${layout.towers.length} towers · ${layout.bands.length} bands`,
    px,
    py,
  );
  py += 14;
  if (layout.bands.length > 0) {
    ctx.fillText(
      `${formatMonthKey(layout.bands[0].monthKey)} → ${formatMonthKey(
        layout.bands[layout.bands.length - 1].monthKey,
      )}`,
      px,
      py,
    );
  }
  py += 26;

  for (const check of checks) {
    ctx.fillStyle = check.passed ? '#7fd6a2' : '#ff8f8f';
    ctx.font = '600 11px ui-monospace, monospace';
    ctx.fillText(`${check.passed ? 'PASS' : 'FAIL'}  ${check.name}`, px, py);
    py += 14;
    ctx.fillStyle = '#6f7689';
    ctx.font = '10px ui-monospace, monospace';
    for (const line of wrap(check.detail, 44)) {
      ctx.fillText(`      ${line}`, px, py);
      py += 12;
    }
    py += 8;
  }

  return checks;
}

function wrap(text: string, max: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line + word).length > max && line.length > 0) {
      lines.push(line.trim());
      line = '';
    }
    line += `${word} `;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}
