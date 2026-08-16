/**
 * Structure silhouettes.
 *
 * Every geometry here is normalised to a unit cube centred on the origin — one wide, one deep, and
 * one tall from -0.5 to +0.5 — so the city can scale each one freely by footprint and height
 * without the shapes drifting off their plots.
 *
 * The point of this file is legibility. A win that was a nap should not look like a win that was a
 * deadline, so the shapes have to be distinguishable at a glance from an aerial camera: pitched
 * roofs read as houses, cones as trees, a spanning deck as a bridge.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error('failed to merge geometry');
  return geometry;
}

/**
 * A commitment tower.
 *
 * These are the landmarks of the city, so they get a real silhouette rather than a box: a broad
 * podium, two setbacks up the shaft, a crown, and a spire. The stepped profile is what makes a
 * tower legible against a skyline of ordinary blocks from any distance.
 */
export function towerGeometry(): THREE.BufferGeometry {
  const podium = new THREE.BoxGeometry(1.28, 0.1, 1.28);
  podium.translate(0, -0.45, 0);

  const lower = new THREE.BoxGeometry(1, 0.42, 1);
  lower.translate(0, -0.19, 0);

  const mid = new THREE.BoxGeometry(0.82, 0.3, 0.82);
  mid.translate(0, 0.17, 0);

  const upper = new THREE.BoxGeometry(0.62, 0.16, 0.62);
  upper.translate(0, 0.4, 0);

  // Crown and spire, rotated 45 degrees so the top catches light on a different plane.
  const crown = new THREE.BoxGeometry(0.36, 0.05, 0.36);
  crown.rotateY(Math.PI / 4);
  crown.translate(0, 0.5, 0);

  const spire = new THREE.ConeGeometry(0.1, 0.22, 6);
  spire.translate(0, 0.61, 0);

  return merged([podium, lower, mid, upper, crown, spire]);
}

/** A house: low body under a pitched roof. The roof is the whole recognisability budget. */
export function houseGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(1, 0.6, 1);
  body.translate(0, -0.2, 0);
  const roof = new THREE.ConeGeometry(0.76, 0.42, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 0.29, 0);
  return merged([body, roof]);
}

/** A conifer: visible trunk under a tall conical canopy. */
export function treeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.06, 0.08, 0.34, 6);
  trunk.translate(0, -0.33, 0);
  const canopy = new THREE.ConeGeometry(0.36, 0.74, 8);
  canopy.translate(0, 0.13, 0);
  return merged([trunk, canopy]);
}

/** A broadleaf: a rounded crown on a slimmer trunk. */
export function treeRoundGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.05, 0.07, 0.46, 6);
  trunk.translate(0, -0.27, 0);
  const crown = new THREE.SphereGeometry(0.34, 10, 8);
  crown.scale(1, 0.86, 1);
  crown.translate(0, 0.18, 0);
  return merged([trunk, crown]);
}

/** A palm: a bare trunk with a spray of fronds. */
export function treePalmGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.045, 0.075, 0.78, 6);
  trunk.translate(0, -0.11, 0);
  parts.push(trunk);
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2;
    const frond = new THREE.ConeGeometry(0.1, 0.42, 4);
    frond.rotateZ(Math.PI / 2.6);
    frond.rotateY(a);
    frond.translate(Math.cos(a) * 0.19, 0.32, Math.sin(a) * 0.19);
    parts.push(frond);
  }
  return merged(parts);
}

/**
 * A connection: two towers joined by a skybridge.
 *
 * Replaces a plain bridge deck. A bridge dropped on an ordinary plot spans nothing and reads as a
 * slab lying in the street — this carries the same meaning while being self-contained, so it makes
 * sense anywhere in the city.
 */
export function linkGeometry(): THREE.BufferGeometry {
  const left = new THREE.BoxGeometry(0.3, 1, 0.42);
  left.translate(-0.34, 0, 0);
  const right = new THREE.BoxGeometry(0.3, 0.82, 0.42);
  right.translate(0.34, -0.09, 0);
  // The span sits high on both towers, which is what makes the pair read as joined.
  const span = new THREE.BoxGeometry(0.42, 0.13, 0.26);
  span.translate(0, 0.24, 0);
  return merged([left, right, span]);
}

/** A studio: a narrow mid-rise with an offset upper storey. */
export function studioGeometry(): THREE.BufferGeometry {
  const base = new THREE.BoxGeometry(1, 0.68, 1);
  base.translate(0, -0.16, 0);
  const upper = new THREE.BoxGeometry(0.66, 0.34, 0.66);
  upper.translate(0.1, 0.33, -0.08);
  return merged([base, upper]);
}

/** A library: a broad civic block with a stepped roofline. */
export function civicGeometry(): THREE.BufferGeometry {
  const base = new THREE.BoxGeometry(1, 0.74, 1);
  base.translate(0, -0.13, 0);
  const cap = new THREE.BoxGeometry(0.78, 0.14, 0.78);
  cap.translate(0, 0.31, 0);
  const lantern = new THREE.BoxGeometry(0.34, 0.16, 0.34);
  lantern.translate(0, 0.46, 0);
  return merged([base, cap, lantern]);
}

/** A milestone installation: a faceted gem, floating and glowing above the city. */
export function installationGeometry(): THREE.BufferGeometry {
  return new THREE.OctahedronGeometry(0.5, 0);
}

/** A billboard for a month not yet built: a panel on two posts. */
export function billboardGeometry(): THREE.BufferGeometry {
  const panel = new THREE.BoxGeometry(1.5, 0.62, 0.07);
  panel.translate(0, 0.16, 0);
  const left = new THREE.BoxGeometry(0.09, 0.6, 0.09);
  left.translate(-0.5, -0.2, 0);
  const right = new THREE.BoxGeometry(0.09, 0.6, 0.09);
  right.translate(0.5, -0.2, 0);
  return merged([panel, left, right]);
}

/** A flower bed: a low plinth under a scatter of blooms. */
export function flowersGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const bed = new THREE.CylinderGeometry(0.5, 0.54, 0.14, 12);
  bed.translate(0, -0.43, 0);
  parts.push(bed);
  for (let i = 0; i < 9; i += 1) {
    const a = (i / 9) * Math.PI * 2;
    const r = 0.16 + (i % 3) * 0.13;
    const bloom = new THREE.SphereGeometry(0.09, 6, 5);
    bloom.translate(Math.cos(a) * r, -0.24 + (i % 2) * 0.1, Math.sin(a) * r);
    parts.push(bloom);
  }
  return merged(parts);
}

/** A fountain: a round basin with a central jet. */
export function fountainGeometry(): THREE.BufferGeometry {
  const basin = new THREE.CylinderGeometry(0.54, 0.58, 0.18, 16);
  basin.translate(0, -0.41, 0);
  const water = new THREE.CylinderGeometry(0.44, 0.44, 0.05, 16);
  water.translate(0, -0.3, 0);
  const column = new THREE.CylinderGeometry(0.08, 0.12, 0.5, 8);
  column.translate(0, -0.02, 0);
  const top = new THREE.SphereGeometry(0.16, 10, 8);
  top.translate(0, 0.3, 0);
  return merged([basin, water, column, top]);
}

/** A grove: several trees on a shared mound. */
export function groveGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const mound = new THREE.CylinderGeometry(0.56, 0.6, 0.12, 12);
  mound.translate(0, -0.44, 0);
  parts.push(mound);
  const spots: [number, number, number][] = [
    [0, 0, 1],
    [0.3, 0.24, 0.78],
    [-0.28, -0.2, 0.86],
    [0.18, -0.3, 0.7],
  ];
  for (const [dx, dz, s] of spots) {
    const trunk = new THREE.CylinderGeometry(0.05, 0.06, 0.24 * s, 6);
    trunk.translate(dx, -0.26, dz);
    const canopy = new THREE.ConeGeometry(0.24 * s, 0.56 * s, 8);
    canopy.translate(dx, -0.26 + 0.12 * s + 0.2 * s, dz);
    parts.push(trunk, canopy);
  }
  return merged(parts);
}

/** A pavilion: a roofed shelter on four columns. */
export function pavilionGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.CylinderGeometry(0.56, 0.6, 0.12, 8);
  base.translate(0, -0.44, 0);
  parts.push(base);
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const column = new THREE.CylinderGeometry(0.055, 0.055, 0.6, 6);
    column.translate(Math.cos(a) * 0.34, -0.08, Math.sin(a) * 0.34);
    parts.push(column);
  }
  const roof = new THREE.ConeGeometry(0.62, 0.34, 8);
  roof.translate(0, 0.38, 0);
  const finial = new THREE.SphereGeometry(0.08, 8, 6);
  finial.translate(0, 0.56, 0);
  parts.push(roof, finial);
  return merged(parts);
}

/** A monument for a year kept well: a tapering spire on a stepped plinth. */
export function monumentSpireGeometry(): THREE.BufferGeometry {
  const plinth = new THREE.BoxGeometry(1, 0.12, 1);
  plinth.translate(0, -0.44, 0);
  const step = new THREE.BoxGeometry(0.74, 0.1, 0.74);
  step.translate(0, -0.33, 0);
  const shaft = new THREE.CylinderGeometry(0.1, 0.3, 0.86, 4);
  shaft.rotateY(Math.PI / 4);
  shaft.translate(0, 0.15, 0);
  const tip = new THREE.ConeGeometry(0.1, 0.24, 4);
  tip.rotateY(Math.PI / 4);
  tip.translate(0, 0.7, 0);
  return merged([plinth, step, shaft, tip]);
}

/** A monument: a dome on a colonnade. */
export function monumentDomeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.CylinderGeometry(0.62, 0.66, 0.14, 16);
  base.translate(0, -0.43, 0);
  parts.push(base);
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    const column = new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6);
    column.translate(Math.cos(a) * 0.46, -0.11, Math.sin(a) * 0.46);
    parts.push(column);
  }
  const drum = new THREE.CylinderGeometry(0.52, 0.54, 0.14, 16);
  drum.translate(0, 0.21, 0);
  const dome = new THREE.SphereGeometry(0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.translate(0, 0.28, 0);
  const finial = new THREE.ConeGeometry(0.07, 0.22, 8);
  finial.translate(0, 0.87, 0);
  parts.push(drum, dome, finial);
  return merged(parts);
}

/** A monument: a triumphal arch. */
export function monumentArchGeometry(): THREE.BufferGeometry {
  const base = new THREE.BoxGeometry(1.1, 0.12, 0.5);
  base.translate(0, -0.44, 0);
  const left = new THREE.BoxGeometry(0.28, 0.78, 0.44);
  left.translate(-0.38, 0.01, 0);
  const right = new THREE.BoxGeometry(0.28, 0.78, 0.44);
  right.translate(0.38, 0.01, 0);
  const lintel = new THREE.BoxGeometry(1.06, 0.24, 0.48);
  lintel.translate(0, 0.52, 0);
  const cap = new THREE.BoxGeometry(0.72, 0.12, 0.36);
  cap.translate(0, 0.7, 0);
  return merged([base, left, right, lintel, cap]);
}

/** A street lamp: a thin pole with a lamp head, drawn at unit height. */
export function lampGeometry(): THREE.BufferGeometry {
  const pole = new THREE.CylinderGeometry(0.035, 0.05, 0.86, 5);
  pole.translate(0, -0.07, 0);
  const head = new THREE.SphereGeometry(0.13, 8, 6);
  head.translate(0, 0.42, 0);
  return merged([pole, head]);
}
