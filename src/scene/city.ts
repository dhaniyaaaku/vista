/**
 * The 3D city.
 *
 * Everything here is driven from `CityLayout`, which is already verified in 2D â€” if something
 * looks wrong on screen, check `?debug2d` first to find out whether it is a layout problem or a
 * render problem.
 *
 * Buildings are drawn with InstancedMesh, one per structure kind. Instance index is mapped back to
 * the originating entry so the butterfly can raycast a building and recover the memory attached
 * to it.
 */

import * as THREE from 'three';
import type { Category, StructureKind } from '../data/types';
import type { Placement, TowerPlacement } from '../layout/polar';
import {
  dayTintFor,
  makeBuildingMaterial,
  makeInstallationMaterial,
  makeLampMaterial,
  makeNatureMaterial,
  makeBillboardMaterial,
  makeBridgeMaterial,
  makeGardenMaterial,
  makeIslandMaterial,
  makeMonumentMaterial,
  makeQuietMaterial,
  makeTowerMaterial,
  makeTowerTexture,
  makeWaterMaterial,
  makeWindowTexture,
  tintFor,
} from './materials';
import {
  billboardGeometry,
  civicGeometry,
  flowersGeometry,
  houseGeometry,
  installationGeometry,
  lampGeometry,
  linkGeometry,
  monumentArchGeometry,
  monumentDomeGeometry,
  monumentSpireGeometry,
  studioGeometry,
  towerGeometry,
  treeGeometry,
  treePalmGeometry,
  treeRoundGeometry,
} from './geometry';
import { ISLAND_CORE, type IslandLayout } from '../layout/islands';
import type { TimeOfDay } from './viewer';

/**
 * World height of one skyscraper floor.
 *
 * Stays linear â€” one completion is one floor, exactly as promised â€” but small, because eighteen
 * months of a daily habit is ~450 floors and anything taller turns the tower into a needle that
 * pierces the frame and flattens everything else.
 */
export const FLOOR_HEIGHT = 0.11;
export const TOWER_FOOTPRINT = 3.4;


/** Which shared material a structure kind draws with. */
type MaterialKey =
  | 'building'
  | 'tower'
  | 'quiet'
  | 'nature'
  | 'installation'
  | 'lamp'
  | 'garden'
  | 'billboard'
  | 'monument';

export interface PickTarget {
  kind: 'entry' | 'tower' | 'reward' | 'billboard' | 'monument';
  entryId?: string;
  commitmentId?: string;
  category?: Category;
  text: string;
  /** For an entry this is its ISO date; for a tower, its floors and cadence. */
  subtitle: string;
  position: THREE.Vector3;
  /** Top of the structure â€” where the butterfly lands. */
  top: number;
}

interface KindSpec {
  geometry: () => THREE.BufferGeometry;
  material: MaterialKey;
  /** Base footprint, before per-building variation. */
  footprint: number;
  height: (variation: number) => number;
  /** Height above ground the structure floats at. Only installations leave the ground. */
  float?: (variation: number) => number;
  /** Elongates the footprint along X. A bridge that spans nothing is just a slab. */
  stretchX?: number;
}

/**
 * Size classes are as load-bearing as the silhouettes.
 *
 * An earlier pass made everything tall to chase a dense-skyline look, which flattened the whole
 * vocabulary â€” a nap and a deadline rendered as the same tower. Heights now form a deliberate
 * hierarchy: commitment towers dominate downtown, studios and libraries are mid-rise, and houses,
 * trees and bridges stay genuinely low so they read as what they are.
 */
const KIND_SPECS: Record<StructureKind, KindSpec> = {
  skyscraper: {
    geometry: towerGeometry,
    material: 'tower',
    footprint: TOWER_FOOTPRINT,
    height: () => 1,
  },
  house: {
    geometry: houseGeometry,
    material: 'building',
    footprint: 1.95,
    height: (v) => 1.7 + v * 1.2,
  },
  park: {
    geometry: treeGeometry,
    material: 'nature',
    footprint: 1.85,
    height: (v) => 2.4 + v * 2.2,
  },
  bridge: {
    geometry: linkGeometry,
    material: 'building',
    footprint: 2.1,
    height: (v) => 3 + v * 2.4,
    stretchX: 1.35,
  },
  studio: {
    geometry: studioGeometry,
    material: 'building',
    footprint: 1.6,
    height: (v) => 3.6 + v * v * 6.5,
  },
  library: {
    geometry: civicGeometry,
    material: 'building',
    footprint: 2.0,
    height: (v) => 2.5 + v * 2.2,
  },
  installation: {
    geometry: installationGeometry,
    material: 'installation',
    footprint: 2.2,
    height: (v) => 2 + v * 1.2,
    float: (v) => 9 + v * 7,
  },
  treeRound: {
    geometry: treeRoundGeometry,
    material: 'nature',
    footprint: 2.1,
    height: (v) => 2.6 + v * 2.4,
  },
  treePalm: {
    geometry: treePalmGeometry,
    material: 'nature',
    footprint: 1.7,
    height: (v) => 3.2 + v * 2.6,
  },
  garden: {
    geometry: flowersGeometry,
    material: 'garden',
    footprint: 3.4,
    height: () => 3.4,
  },
  billboard: {
    geometry: billboardGeometry,
    material: 'billboard',
    footprint: 1,
    height: () => 1,
  },
  monumentSpire: {
    geometry: monumentSpireGeometry,
    material: 'monument',
    footprint: 1,
    height: () => 1,
  },
  monumentDome: {
    geometry: monumentDomeGeometry,
    material: 'monument',
    footprint: 1,
    height: () => 1,
  },
  monumentArch: {
    geometry: monumentArchGeometry,
    material: 'monument',
    footprint: 1,
    height: () => 1,
  },
};

/** Milestone gems take their colour from the sky they hang in. */
const MILESTONE_TINTS: Record<string, number> = {
  night: 0xff5fa8,
  sunset: 0xff2d1f,
  day: 0x7a20d8,
};

/** Each garden kind gets its own green, so a month's reward is distinguishable. */
const GARDEN_TINTS: Record<string, number> = {
  flowers: 0xff9ec2,
  fountain: 0x7fc8ff,
  grove: 0x5fd08a,
  pavilion: 0xffd9a0,
};

export class CityScene {
  readonly group = new THREE.Group();
  /** Installations bob and turn; the frame loop needs them. */
  readonly installations: THREE.InstancedMesh[] = [];

  private meshes: THREE.InstancedMesh[] = [];
  private ground: THREE.Mesh | null = null;
  private decor: THREE.Object3D[] = [];
  /** Materials are keyed by kind-and-tint and reused across rebuilds. */
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private windowTexture: THREE.Texture;
  private towerTexture: THREE.Texture;
  private dummy = new THREE.Object3D();
  private timeOfDay: TimeOfDay = 'night';

  constructor() {
    this.windowTexture = makeWindowTexture();
    this.towerTexture = makeTowerTexture();
  }

  private materialFor(key: MaterialKey, tint: number): THREE.MeshStandardMaterial {
    const id = `${key}|${tint}`;
    let material = this.materials.get(id);
    if (!material) {
      material =
        key === 'building'
          ? makeBuildingMaterial(this.windowTexture, tint)
          : key === 'tower'
            ? makeTowerMaterial(this.towerTexture, tint)
            : key === 'installation'
              ? makeInstallationMaterial(tint)
              : key === 'nature'
                ? makeNatureMaterial()
                : key === 'lamp'
                  ? makeLampMaterial()
                  : key === 'garden'
                    ? makeGardenMaterial(tint)
                    : key === 'billboard'
                      ? makeBillboardMaterial()
                      : key === 'monument'
                        ? makeMonumentMaterial()
                        : makeQuietMaterial();
      material.userData.materialKey = key;
      // Remember what night looks like, so day mode can be a reversible adjustment rather than a
      // second set of materials to keep in sync.
      material.userData.nightColor = material.color.getHex();
      material.userData.nightEmissive = material.emissiveIntensity;
      material.userData.dayColor = dayTintFor(tint);
      this.materials.set(id, material);
    }
    return material;
  }

  /** Day or night. Buildings stop glowing and take on daylight surfaces; lamps switch off. */
  setTimeOfDay(mode: TimeOfDay): void {
    this.timeOfDay = mode;
    this.applyTimeOfDay();
  }

  private applyTimeOfDay(): void {
    const day = this.timeOfDay === 'day';
    for (const material of this.materials.values()) {
      const key = material.userData.materialKey as MaterialKey;
      const nightColor = material.userData.nightColor as number;
      const nightEmissive = material.userData.nightEmissive as number;

      if (key === 'building') {
        // Golden hour, not midday: the facade takes the light but the windows are already on,
        // so the city keeps its lights in both modes.
        material.color.setHex(day ? (material.userData.dayColor as number) : nightColor);
        material.emissiveIntensity = day ? nightEmissive * 0.55 : nightEmissive;
      } else if (key === 'lamp') {
        material.emissiveIntensity = day ? nightEmissive * 0.45 : nightEmissive;
        material.color.setHex(day ? 0x4a5162 : nightColor);
      } else if (key === 'nature') {
        material.color.setHex(day ? 0x4f8f57 : nightColor);
        material.emissiveIntensity = day ? 0 : nightEmissive;
      } else if (key === 'quiet') {
        material.color.setHex(day ? 0x8891a5 : nightColor);
      } else if (key === 'installation') {
        // Milestones keep glowing in daylight and change colour with the sky: rose at night,
        // burning red at sunset, deep violet by day. They are meant to be the first thing the eye
        // finds in any mode.
        material.emissive.setHex(MILESTONE_TINTS[this.timeOfDay]);
        material.emissiveIntensity = day ? nightEmissive * 1.25 : nightEmissive;
      } else {
        material.emissiveIntensity = day ? nightEmissive * 0.7 : nightEmissive;
      }
    }

    if (this.ground) {
      // The wash texture carries the shading, so this only tints it: warm earth by day, left
      // untinted at night so the pool of light under the city shows through.
      (this.ground.material as THREE.MeshStandardMaterial).color.setHex(day ? 0x9c8a76 : 0xffffff);
    }
  }

  /** Rebuild the whole city from a layout. Cheap enough to call on every scrubber tick. */
  setLayout(layout: IslandLayout): void {
    this.clear();
    this.buildGround(layout);
    this.buildLamps(layout);
    this.buildStructures(layout);
    this.applyTimeOfDay();
  }

  get pickables(): THREE.InstancedMesh[] {
    return this.meshes;
  }

  targetFor(mesh: THREE.InstancedMesh, instanceId: number): PickTarget | null {
    const targets = mesh.userData.targets as PickTarget[] | undefined;
    return targets?.[instanceId] ?? null;
  }

  // --- internals ---------------------------------------------------------

  private buildGround(layout: IslandLayout): void {
    // Water runs far enough to reach what reads as the true horizon.
    //
    // A surface only a little larger than the archipelago ends well short of the horizon line, and
    // the sky dome shows underneath its edge â€” that is sky at *negative* elevation, where any
    // vertical gradient is a single flat colour. Running it out to here, with fog fading it to
    // exactly the horizon colour, puts the visible seam at the real horizon instead.
    const radius = Math.max(layout.radius * 12, 2200);

    const water = new THREE.Mesh(new THREE.CircleGeometry(radius, 128), makeWaterMaterial());
    water.rotation.x = -Math.PI / 2;
    water.position.set(layout.centerX, -0.6, layout.centerZ);
    this.ground = water;
    this.group.add(water);

    for (const island of layout.islands) {
      // The island itself, sitting proud of the water.
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(island.radius, island.radius * 0.94, 1.4, 96),
        makeIslandMaterial(),
      );
      disc.position.set(island.x, -0.1, island.z);
      this.decor.push(disc);
      this.group.add(disc);

      // A shoreline ring, brighter on the year being lived in.
      const shore = new THREE.Mesh(
        new THREE.RingGeometry(island.radius - 0.5, island.radius + 0.4, 128),
        new THREE.MeshBasicMaterial({
          color: island.isCurrent ? 0xffd9a0 : 0x5c6b96,
          transparent: true,
          opacity: island.isCurrent ? 0.55 : 0.3,
          side: THREE.DoubleSide,
        }),
      );
      shore.rotation.x = -Math.PI / 2;
      shore.position.set(island.x, 0.62, island.z);
      this.decor.push(shore);
      this.group.add(shore);

      // Sector dividers, so months read as separate places without needing labels.
      for (const sector of island.sectors) {
        const mid = (sector.startAngle + sector.endAngle) / 2;
        const road = new THREE.Mesh(
          new THREE.PlaneGeometry(island.radius - ISLAND_CORE, 0.4),
          new THREE.MeshBasicMaterial({
            color: sector.isFuture ? 0x3d4258 : 0x2a3350,
            transparent: true,
            opacity: 0.4,
          }),
        );
        road.rotation.x = -Math.PI / 2;
        road.rotation.z = -sector.endAngle;
        const r = ISLAND_CORE + (island.radius - ISLAND_CORE) / 2;
        road.position.set(
          island.x + Math.cos(sector.endAngle) * r,
          0.61,
          island.z + Math.sin(sector.endAngle) * r,
        );
        this.decor.push(road);
        this.group.add(road);
        void mid;
      }
    }

    // Bridges joining consecutive years.
    for (const bridge of layout.bridges) {
      const dx = bridge.toX - bridge.fromX;
      const dz = bridge.toZ - bridge.fromZ;
      const length = Math.hypot(dx, dz);
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(length, 0.5, 4.2),
        makeBridgeMaterial(),
      );
      deck.position.set(
        (bridge.fromX + bridge.toX) / 2,
        0.7,
        (bridge.fromZ + bridge.toZ) / 2,
      );
      deck.rotation.y = -Math.atan2(dz, dx);
      this.decor.push(deck);
      this.group.add(deck);
    }
  }

  /**
   * Street lamps along every ring road.
   *
   * Cheap, and the single biggest thing that makes an aerial city read as inhabited rather than as
   * a field of boxes â€” it is the streets that tell you people live there.
   */
  private buildLamps(layout: IslandLayout): void {
    const matrices: THREE.Matrix4[] = [];
    // Very sparse and short. Lamps taller or denser than this turn every shoreline into a picket
    // fence of candles and pull attention away from the buildings.
    const spacing = 26;
    const height = 1.7;

    for (const island of layout.islands) {
      const radius = island.radius - 1.6;
      const count = Math.max(8, Math.round((Math.PI * 2 * radius) / spacing));
      for (let i = 0; i < count; i += 1) {
        const angle = (Math.PI * 2 * i) / count;
        this.dummy.position.set(
          island.x + Math.cos(angle) * radius,
          0.6 + height / 2,
          island.z + Math.sin(angle) * radius,
        );
        this.dummy.rotation.set(0, angle, 0);
        this.dummy.scale.set(1, height, 1);
        this.dummy.updateMatrix();
        matrices.push(this.dummy.matrix.clone());
      }
    }

    if (matrices.length === 0) return;

    const mesh = new THREE.InstancedMesh(lampGeometry(), this.materialFor('lamp', 0), matrices.length);
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    // Not pickable: lamps are set dressing and carry no memory.
    this.decor.push(mesh);
    this.group.add(mesh);
  }

  private buildStructures(layout: IslandLayout): void {
    /** One bucket per kind-and-tint pair; each becomes a single InstancedMesh. */
    interface Bucket {
      kind: StructureKind;
      tint: number;
      matrices: THREE.Matrix4[];
      targets: PickTarget[];
    }
    const buckets = new Map<string, Bucket>();

    const push = (
      kind: StructureKind,
      target: PickTarget,
      matrix: THREE.Matrix4,
      tint: number,
    ) => {
      const id = `${kind}|${tint}`;
      let bucket = buckets.get(id);
      if (!bucket) {
        bucket = { kind, tint, matrices: [], targets: [] };
        buckets.set(id, bucket);
      }
      bucket.matrices.push(matrix);
      bucket.targets.push(target);
    };

    for (const tower of layout.towers) {
      const { matrix, top } = this.towerTransform(tower);
      push(
        'skyscraper',
        {
          kind: 'tower',
          commitmentId: tower.commitmentId,
          text: tower.name,
          subtitle: `${tower.floors} floors Â· ${tower.cadenceLabel}`,
          position: new THREE.Vector3(tower.x, 0, tower.z),
          top,
        },
        matrix,
        // Height is permanent record; light is current state. A quiet tower keeps every floor
        // and simply stops glowing. Cool white rather than the amber of the housing around it,
        // so a tower is distinguishable from a tall block at a glance.
        tower.lit ? 0xcfe4ff : 0x1b2130,
      );
    }

    for (const placement of layout.placements) {
      const { matrix, top } = this.placementTransform(placement);
      push(
        placement.kind,
        {
          kind: 'entry',
          entryId: placement.entryId,
          category: placement.category,
          text: placement.text,
          subtitle: placement.date,
          position: new THREE.Vector3(placement.x, 0, placement.z),
          top,
        },
        matrix,
        // Saturated rather than pale: a pale pink clips straight to white once it is the
        // brightest thing in frame and gets bloomed on top.
        placement.category === 'milestone' ? 0xff5fa8 : tintFor(placement.variation),
      );
    }

    // Consistency rewards: trees for a full week, a garden for a month kept up with.
    for (const reward of layout.rewards) {
      // Three tree shapes, chosen from the reward's own noise so a stretch of greenery is mixed
      // rather than a stand of identical cones.
      const treeKind: StructureKind =
        reward.variation < 0.42 ? 'park' : reward.variation < 0.78 ? 'treeRound' : 'treePalm';
      const kind: StructureKind = reward.kind === 'tree' ? treeKind : 'garden';
      const spec = KIND_SPECS[kind];
      const height = spec.height(reward.variation);
      const width = spec.footprint * (0.85 + reward.variation * 0.3);
      this.dummy.position.set(reward.x, 0.6 + height / 2, reward.z);
      this.dummy.rotation.set(0, reward.rotation, 0);
      this.dummy.scale.set(width, height, width);
      this.dummy.updateMatrix();
      push(
        kind,
        {
          kind: 'reward',
          text: reward.kind === 'tree' ? 'A week kept' : 'A month kept',
          subtitle:
            reward.kind === 'tree'
              ? 'Seven days in a row'
              : `${reward.gardenKind ?? 'garden'} Â· earned in ${reward.monthKey}`,
          position: new THREE.Vector3(reward.x, 0, reward.z),
          top: 0.6 + height,
        },
        this.dummy.matrix.clone(),
        reward.kind === 'tree' ? 0x5fd08a : GARDEN_TINTS[reward.gardenKind ?? 'flowers'],
      );
    }

    // Billboards on months not yet built.
    for (const board of layout.billboards) {
      this.dummy.position.set(board.x, 0.6 + 2.4, board.z);
      this.dummy.rotation.set(0, board.rotation, 0);
      this.dummy.scale.set(4.2, 4.2, 4.2);
      this.dummy.updateMatrix();
      push(
        'billboard',
        {
          kind: 'billboard',
          text: 'Up for construction',
          subtitle: board.monthKey,
          position: new THREE.Vector3(board.x, 0, board.z),
          top: 0.6 + 4.2,
        },
        this.dummy.matrix.clone(),
        0x9fb4d8,
      );
    }

    // A monument at the centre of each finished year that was kept well.
    for (const island of layout.islands) {
      if (!island.monument) continue;
      const kind: StructureKind =
        island.monument === 'dome'
          ? 'monumentDome'
          : island.monument === 'arch'
            ? 'monumentArch'
            : 'monumentSpire';
      const size = 16;
      this.dummy.position.set(island.x, 0.6 + size / 2, island.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(size, size, size);
      this.dummy.updateMatrix();
      push(
        kind,
        {
          kind: 'monument',
          text: `${island.year} stands`,
          subtitle: `${Math.round((1 - island.darkRatio) * 100)}% of what you set out to do`,
          position: new THREE.Vector3(island.x, 0, island.z),
          top: 0.6 + size,
        },
        this.dummy.matrix.clone(),
        0xffe6c0,
      );
    }

    for (const bucket of buckets.values()) {
      const spec = KIND_SPECS[bucket.kind];
      const mesh = new THREE.InstancedMesh(
        spec.geometry(),
        this.materialFor(spec.material, bucket.tint),
        bucket.matrices.length,
      );
      mesh.userData.kind = bucket.kind;
      mesh.userData.targets = bucket.targets;
      bucket.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.instanceMatrix.needsUpdate = true;

      this.meshes.push(mesh);
      this.group.add(mesh);
      if (bucket.kind === 'installation') this.installations.push(mesh);
    }
  }

  private towerTransform(tower: TowerPlacement): { matrix: THREE.Matrix4; top: number } {
    const height = Math.max(1, tower.floors) * FLOOR_HEIGHT + 3;
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
    const width = spec.footprint * (0.78 + p.variation * 0.34);
    const float = spec.float ? spec.float(p.variation) : 0;

    this.dummy.position.set(p.x, float + height / 2, p.z);
    this.dummy.rotation.set(0, p.rotation, 0);
    this.dummy.scale.set(width * (spec.stretchX ?? 1), height, width);
    this.dummy.updateMatrix();
    return { matrix: this.dummy.matrix.clone(), top: float + height };
  }

  private clear(): void {
    for (const mesh of this.meshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      mesh.dispose();
    }
    // Materials are cached and reused across rebuilds, so they are not disposed here.
    this.meshes = [];
    this.installations.length = 0;

    for (const item of this.decor) {
      this.group.remove(item);
      const mesh = item as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material)?.dispose();
    }
    this.decor = [];

    if (this.ground) {
      this.group.remove(this.ground);
      this.ground.geometry.dispose();
      // Material only. The ground texture is shared across rebuilds and disposed in dispose().
      (this.ground.material as THREE.Material).dispose();
      this.ground = null;
    }
  }

  dispose(): void {
    this.clear();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.windowTexture.dispose();
    this.towerTexture.dispose();
  }
}
