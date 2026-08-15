/**
 * The 3D city.
 *
 * Grey-box phase: correct geometry in correct places, no materials or lighting worth the name.
 * Everything here is driven from `CityLayout`, which is already verified in 2D — if something
 * looks wrong on screen, check the 2D debug view first to find out whether it is a layout problem
 * or a render problem.
 *
 * Buildings are drawn with InstancedMesh, one per structure kind. Instance index is mapped back to
 * the originating entry so the butterfly can raycast a building and recover the memory attached
 * to it.
 */

import * as THREE from 'three';
import type { StructureKind } from '../data/types';
import type { CityLayout, Placement, TowerPlacement } from '../layout/polar';

/**
 * World height of one skyscraper floor.
 *
 * Stays linear — one completion is one floor, exactly as promised — but small, because six months
 * of a daily habit is ~150 floors and anything taller than this turns the tower into a needle that
 * pierces the frame and flattens everything else.
 */
export const FLOOR_HEIGHT = 0.18;
export const TOWER_FOOTPRINT = 3.6;

export interface PickTarget {
  kind: 'entry' | 'tower';
  entryId?: string;
  commitmentId?: string;
  text: string;
  subtitle: string;
  position: THREE.Vector3;
  /** Top of the structure — where the butterfly lands. */
  top: number;
}

interface KindSpec {
  geometry: () => THREE.BufferGeometry;
  /** Base footprint, before per-building variation. */
  footprint: number;
  height: (variation: number) => number;
  /** Height above ground the structure floats at. Only installations leave the ground. */
  float?: (variation: number) => number;
}

const KIND_SPECS: Record<StructureKind, KindSpec> = {
  skyscraper: {
    geometry: () => new THREE.BoxGeometry(1, 1, 1),
    footprint: TOWER_FOOTPRINT,
    height: () => 1,
  },
  house: {
    geometry: () => new THREE.BoxGeometry(1, 1, 1),
    footprint: 1.9,
    height: (v) => 1.3 + v * 1.1,
  },
  park: {
    geometry: () => new THREE.ConeGeometry(0.5, 1, 7),
    footprint: 2.0,
    height: (v) => 1.6 + v * 1.4,
  },
  bridge: {
    geometry: () => new THREE.BoxGeometry(1, 1, 1),
    footprint: 2.2,
    height: (v) => 0.45 + v * 0.3,
  },
  studio: {
    geometry: () => new THREE.BoxGeometry(1, 1, 1),
    footprint: 1.8,
    height: (v) => 2.0 + v * 1.6,
  },
  library: {
    geometry: () => new THREE.BoxGeometry(1, 1, 1),
    footprint: 2.1,
    height: (v) => 1.8 + v * 0.9,
  },
  installation: {
    geometry: () => new THREE.OctahedronGeometry(0.8, 0),
    footprint: 1.6,
    height: (v) => 1.4 + v * 0.7,
    float: (v) => 8 + v * 5,
  },
};

const KINDS = Object.keys(KIND_SPECS) as StructureKind[];

export class CityScene {
  readonly group = new THREE.Group();

  private instanced = new Map<StructureKind, THREE.InstancedMesh>();
  /** instanceId -> pick target, per kind. Rebuilt on every layout change. */
  private targets = new Map<StructureKind, PickTarget[]>();
  private ground: THREE.Mesh | null = null;
  private parkland: THREE.Mesh[] = [];
  private material: THREE.MeshStandardMaterial;
  private dummy = new THREE.Object3D();

  constructor() {
    this.material = new THREE.MeshStandardMaterial({
      color: 0x8d93a3,
      roughness: 0.85,
      metalness: 0.0,
    });
  }

  /** Rebuild the whole city from a layout. Cheap enough to call on every scrubber tick. */
  setLayout(layout: CityLayout): void {
    this.clear();
    this.buildGround(layout);
    this.buildStructures(layout);
  }

  /** All pickable structures, for raycasting. */
  get pickables(): THREE.InstancedMesh[] {
    return [...this.instanced.values()];
  }

  targetFor(mesh: THREE.InstancedMesh, instanceId: number): PickTarget | null {
    const kind = mesh.userData.kind as StructureKind | undefined;
    if (!kind) return null;
    return this.targets.get(kind)?.[instanceId] ?? null;
  }

  // --- internals ---------------------------------------------------------

  private buildGround(layout: CityLayout): void {
    // Enough overshoot that the ground's edge never reads as a visible disc rim, but not so much
    // that the empty plane dominates the frame.
    const radius = Math.max(layout.radius * 1.6, 45);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 96),
      new THREE.MeshStandardMaterial({ color: 0x12141d, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.ground = ground;
    this.group.add(ground);

    // Quiet months are parkland, never gaps — this is the 3D half of principle 1.
    for (const band of layout.bands) {
      if (!band.isEmpty) continue;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(band.innerRadius, band.outerRadius, 96),
        new THREE.MeshStandardMaterial({
          color: 0x2c3a2a,
          roughness: 1,
          side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      this.parkland.push(ring);
      this.group.add(ring);
    }
  }

  private buildStructures(layout: CityLayout): void {
    const byKind = new Map<StructureKind, PickTarget[]>();
    const transforms = new Map<StructureKind, THREE.Matrix4[]>();

    const push = (kind: StructureKind, target: PickTarget, matrix: THREE.Matrix4) => {
      const targets = byKind.get(kind);
      if (targets) targets.push(target);
      else byKind.set(kind, [target]);
      const list = transforms.get(kind);
      if (list) list.push(matrix);
      else transforms.set(kind, [matrix]);
    };

    for (const tower of layout.towers) {
      const { matrix, top } = this.towerTransform(tower);
      push(
        'skyscraper',
        {
          kind: 'tower',
          commitmentId: tower.commitmentId,
          text: tower.name,
          subtitle: `${tower.floors} floors · ${tower.cadenceLabel}`,
          position: new THREE.Vector3(tower.x, 0, tower.z),
          top,
        },
        matrix,
      );
    }

    for (const placement of layout.placements) {
      const { matrix, top } = this.placementTransform(placement);
      push(
        placement.kind,
        {
          kind: 'entry',
          entryId: placement.entryId,
          text: placement.text,
          subtitle: placement.date,
          position: new THREE.Vector3(placement.x, 0, placement.z),
          top,
        },
        matrix,
      );
    }

    for (const kind of KINDS) {
      const matrices = transforms.get(kind);
      if (!matrices || matrices.length === 0) continue;

      const mesh = new THREE.InstancedMesh(
        KIND_SPECS[kind].geometry(),
        this.material,
        matrices.length,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.kind = kind;
      matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.instanceMatrix.needsUpdate = true;

      this.instanced.set(kind, mesh);
      this.targets.set(kind, byKind.get(kind) ?? []);
      this.group.add(mesh);
    }
  }

  private towerTransform(tower: TowerPlacement): { matrix: THREE.Matrix4; top: number } {
    // Height is cumulative completions and never shrinks. A minimum of one floor means a brand
    // new commitment still reads as a building rather than a smear on the ground.
    const height = Math.max(1, tower.floors) * FLOOR_HEIGHT + 1.2;
    const width = TOWER_FOOTPRINT * (0.85 + tower.variation * 0.3);
    this.dummy.position.set(tower.x, height / 2, tower.z);
    this.dummy.rotation.set(0, tower.rotation, 0);
    this.dummy.scale.set(width, height, width);
    this.dummy.updateMatrix();
    return { matrix: this.dummy.matrix.clone(), top: height };
  }

  private placementTransform(p: Placement): { matrix: THREE.Matrix4; top: number } {
    const spec = KIND_SPECS[p.kind];
    const height = spec.height(p.variation);
    const width = spec.footprint * (0.8 + p.variation * 0.35);
    const float = spec.float ? spec.float(p.variation) : 0;

    this.dummy.position.set(p.x, float + height / 2, p.z);
    this.dummy.rotation.set(0, p.rotation, 0);
    this.dummy.scale.set(width, height, width);
    this.dummy.updateMatrix();
    return { matrix: this.dummy.matrix.clone(), top: float + height };
  }

  private clear(): void {
    for (const mesh of this.instanced.values()) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.instanced.clear();
    this.targets.clear();

    for (const ring of this.parkland) {
      this.group.remove(ring);
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    }
    this.parkland = [];

    if (this.ground) {
      this.group.remove(this.ground);
      this.ground.geometry.dispose();
      (this.ground.material as THREE.Material).dispose();
      this.ground = null;
    }
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
  }
}
