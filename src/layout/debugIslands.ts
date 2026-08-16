/**
 * Top-down 2D view of the island layout, with checks.
 *
 * Placement gets verified here before any Three.js exists, for the same reason as the old ring
 * debug view: finding an overlap as dots takes seconds, finding it in a 3D scene takes an hour.
 *
 *   http://localhost:5173/?islands
 */

import { CATEGORY_BY_ID } from '../data/types';
import { formatMonthKey } from '../data/dates';
import { ISLAND_CORE, type IslandLayout } from './islands';

const TAU = Math.PI * 2;

export interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

export function checkIslands(layout: IslandLayout): Check[] {
  const checks: Check[] = [];
  const { islands, placements } = layout;

  // 1. Islands must not touch.
  let collisions = 0;
  let closest = Infinity;
  for (let i = 0; i < islands.length; i += 1) {
    for (let j = i + 1; j < islands.length; j += 1) {
      const d = Math.hypot(islands[i].x - islands[j].x, islands[i].z - islands[j].z);
      const gap = d - islands[i].radius - islands[j].radius;
      if (gap < closest) closest = gap;
      if (gap < 0) collisions += 1;
    }
  }
  checks.push({
    name: 'Islands do not overlap',
    passed: collisions === 0,
    detail:
      islands.length < 2
        ? 'only one island'
        : `${collisions} collisions, closest gap ${closest.toFixed(1)}`,
  });

  // 2. Every building inside its island, outside the reserved core.
  let outside = 0;
  let inCore = 0;
  const byYear = new Map(islands.map((i) => [i.year, i]));
  for (const p of placements) {
    const island = byYear.get(p.monthKey.slice(0, 4));
    if (!island) {
      outside += 1;
      continue;
    }
    const d = Math.hypot(p.x - island.x, p.z - island.z);
    if (d > island.radius + 0.01) outside += 1;
    if (d < ISLAND_CORE - 0.01) inCore += 1;
  }
  checks.push({
    name: 'Buildings inside their island',
    passed: outside === 0,
    detail: `${placements.length - outside}/${placements.length} in bounds`,
  });
  checks.push({
    name: 'Island core kept clear',
    passed: inCore === 0,
    detail: inCore === 0 ? 'nothing in the centre' : `${inCore} buildings in the core`,
  });

  // 3. Every building inside its own month's sector.
  let wrongSector = 0;
  for (const p of placements) {
    const island = byYear.get(p.monthKey.slice(0, 4));
    const sector = island?.sectors.find((s) => s.monthKey === p.monthKey);
    if (!island || !sector) {
      wrongSector += 1;
      continue;
    }
    let a = Math.atan2(p.z - island.z, p.x - island.x);
    if (a < 0) a += TAU;
    if (a < sector.startAngle - 0.02 || a > sector.endAngle + 0.02) wrongSector += 1;
  }
  checks.push({
    name: 'Buildings inside their month sector',
    passed: wrongSector === 0,
    detail: `${placements.length - wrongSector}/${placements.length} in sector`,
  });

  // 4. No two buildings sharing a plot.
  let overlaps = 0;
  const grid = new Map<string, { x: number; z: number }[]>();
  for (const p of placements) {
    const cx = Math.floor(p.x / 3);
    const cz = Math.floor(p.z / 3);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (const other of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          if (Math.hypot(p.x - other.x, p.z - other.z) < 2) overlaps += 1;
        }
      }
    }
    const key = `${cx},${cz}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(p);
    else grid.set(key, [p]);
  }
  checks.push({
    name: 'No overlapping plots',
    passed: overlaps === 0,
    detail: `${overlaps} overlaps`,
  });

  // 5. Towers on the island of the year being lived in.
  const home = islands.find((i) => i.isCurrent);
  const towersHome = layout.towers.every(
    (t) => !home || Math.hypot(t.x - home.x, t.z - home.z) <= ISLAND_CORE + 1,
  );
  checks.push({
    name: 'Towers sit on the current island',
    passed: towersHome,
    detail: home ? `${layout.towers.length} towers on ${home.year}` : 'no current island',
  });

  // 6. Finished years may hold a monument; the current year never does.
  const currentHasMonument = islands.some((i) => i.isCurrent && i.monument !== null);
  const earned = islands.filter((i) => i.monument !== null);
  checks.push({
    name: 'Monuments only on finished years',
    passed: !currentHasMonument,
    detail:
      earned.length === 0
        ? 'none earned yet'
        : earned.map((i) => `${i.year} ${i.monument}`).join(', '),
  });

  // 7. Bridges join consecutive islands.
  checks.push({
    name: 'One bridge between each pair',
    passed: layout.bridges.length === Math.max(0, islands.length - 1),
    detail: `${layout.bridges.length} bridges for ${islands.length} islands`,
  });

  return checks;
}

export function drawIslands(canvas: HTMLCanvasElement, layout: IslandLayout): Check[] {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');

  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b1018';
  ctx.fillRect(0, 0, W, H);

  const panel = 330;
  const viewW = W - panel;
  const scale = Math.min(viewW / (layout.radius * 2.3), H / (layout.radius * 2.3));
  const sx = (x: number) => viewW / 2 + (x - layout.centerX) * scale;
  const sy = (z: number) => H / 2 + (z - layout.centerZ) * scale;

  // Bridges first, so islands sit over their ends.
  for (const bridge of layout.bridges) {
    ctx.beginPath();
    ctx.moveTo(sx(bridge.fromX), sy(bridge.fromZ));
    ctx.lineTo(sx(bridge.toX), sy(bridge.toZ));
    ctx.strokeStyle = 'rgba(255,210,150,0.75)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  for (const island of layout.islands) {
    ctx.beginPath();
    ctx.arc(sx(island.x), sy(island.z), island.radius * scale, 0, TAU);
    ctx.fillStyle = 'rgba(30,40,60,0.55)';
    ctx.fill();
    ctx.strokeStyle = island.isCurrent ? 'rgba(232,180,200,0.8)' : 'rgba(255,255,255,0.22)';
    ctx.lineWidth = island.isCurrent ? 2 : 1;
    ctx.stroke();

    // Sector dividers.
    for (const sector of island.sectors) {
      for (const angle of [sector.startAngle, sector.endAngle]) {
        ctx.beginPath();
        ctx.moveTo(
          sx(island.x + Math.cos(angle) * ISLAND_CORE),
          sy(island.z + Math.sin(angle) * ISLAND_CORE),
        );
        ctx.lineTo(
          sx(island.x + Math.cos(angle) * island.radius),
          sy(island.z + Math.sin(angle) * island.radius),
        );
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    ctx.beginPath();
    ctx.arc(sx(island.x), sy(island.z), ISLAND_CORE * scale, 0, TAU);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#e9ecf5';
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(island.year, sx(island.x), sy(island.z - island.radius) - 8);
    if (island.monument) {
      ctx.fillStyle = '#ffd9a0';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(`${island.monument} · ${(island.darkRatio * 100).toFixed(0)}% dark`, sx(island.x), sy(island.z) + 4);
    }
  }

  for (const p of layout.placements) {
    ctx.beginPath();
    ctx.arc(sx(p.x), sy(p.z), 1.4, 0, TAU);
    ctx.fillStyle = CATEGORY_BY_ID[p.category].color;
    ctx.fill();
  }

  for (const reward of layout.rewards) {
    ctx.beginPath();
    ctx.arc(sx(reward.x), sy(reward.z), reward.kind === 'garden' ? 3.4 : 2, 0, TAU);
    ctx.fillStyle = reward.kind === 'garden' ? '#7fe0a0' : '#3f9c5a';
    ctx.fill();
  }

  for (const board of layout.billboards) {
    ctx.fillStyle = 'rgba(200,200,220,0.6)';
    ctx.fillRect(sx(board.x) - 3, sy(board.z) - 2, 6, 4);
  }

  for (const tower of layout.towers) {
    const size = 5 + Math.min(tower.floors, 400) * 0.01;
    ctx.fillStyle = tower.lit ? '#cfe4ff' : '#3f4759';
    ctx.fillRect(sx(tower.x) - size / 2, sy(tower.z) - size / 2, size, size);
  }

  // --- checks panel -------------------------------------------------------

  const checks = checkIslands(layout);
  let py = 30;
  const px = viewW + 20;
  ctx.textAlign = 'left';

  ctx.fillStyle = '#e9ecf5';
  ctx.font = '600 14px ui-monospace, monospace';
  ctx.fillText('Island layout', px, py);
  py += 20;

  ctx.font = '11px ui-monospace, monospace';
  ctx.fillStyle = '#8b93a8';
  ctx.fillText(
    `${layout.islands.length} islands · ${layout.placements.length} wins · ${layout.rewards.length} rewards`,
    px,
    py,
  );
  py += 14;
  ctx.fillText(`${layout.billboards.length} billboards · extent ${layout.radius.toFixed(0)}`, px, py);
  py += 24;

  for (const check of checks) {
    ctx.fillStyle = check.passed ? '#7fd6a2' : '#ff8f8f';
    ctx.font = '600 11px ui-monospace, monospace';
    ctx.fillText(`${check.passed ? 'PASS' : 'FAIL'}  ${check.name}`, px, py);
    py += 13;
    ctx.fillStyle = '#6f7689';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText(`      ${check.detail}`, px, py);
    py += 18;
  }

  // Per-month reward summary for the current island.
  const home = layout.islands.find((i) => i.isCurrent);
  if (home) {
    py += 6;
    ctx.fillStyle = '#e9ecf5';
    ctx.font = '600 11px ui-monospace, monospace';
    ctx.fillText(`${home.year} months`, px, py);
    py += 15;
    ctx.font = '10px ui-monospace, monospace';
    for (const sector of home.sectors) {
      if (py > H - 14) break;
      const r = sector.reward;
      ctx.fillStyle = sector.isFuture ? '#5c6478' : r?.earnedGarden ? '#7fd6a2' : '#8b93a8';
      const note = sector.isFuture
        ? 'up for construction'
        : r
          ? `${r.loggedDays}d · ${r.missedDays} missed · ${r.trees} trees${r.earnedGarden ? ' · garden' : ''}`
          : 'nothing yet';
      ctx.fillText(`${formatMonthKey(sector.monthKey).slice(0, 3)}  ${note}`, px, py);
      py += 12;
    }
  }

  return checks;
}
