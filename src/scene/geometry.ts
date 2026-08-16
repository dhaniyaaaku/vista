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

/** A commitment tower: a shaft with a slight setback crown, so the top reads at a distance. */
export function towerGeometry(): THREE.BufferGeometry {
  const shaft = new THREE.BoxGeometry(1, 0.94, 1);
  shaft.translate(0, -0.03, 0);
  const crown = new THREE.BoxGeometry(0.62, 0.06, 0.62);
  crown.translate(0, 0.47, 0);
  return merged([shaft, crown]);
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

/** A tree: visible trunk under a conical canopy. */
export function treeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.06, 0.08, 0.34, 6);
  trunk.translate(0, -0.33, 0);
  const canopy = new THREE.ConeGeometry(0.36, 0.74, 8);
  canopy.translate(0, 0.13, 0);
  return merged([trunk, canopy]);
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

/** A milestone installation: a faceted gem meant to be seen glowing from across the city. */
export function installationGeometry(): THREE.BufferGeometry {
  return new THREE.OctahedronGeometry(0.5, 0);
}

/** A street lamp: a thin pole with a lamp head, drawn at unit height. */
export function lampGeometry(): THREE.BufferGeometry {
  const pole = new THREE.CylinderGeometry(0.035, 0.05, 0.86, 5);
  pole.translate(0, -0.07, 0);
  const head = new THREE.SphereGeometry(0.13, 8, 6);
  head.translate(0, 0.42, 0);
  return merged([pole, head]);
}
