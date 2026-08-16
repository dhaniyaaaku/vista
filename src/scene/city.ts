/**
 * The 3D city.
 *
 * Everything here is driven from `CityLayout`, which is already verified in 2D — if something
 * looks wrong on screen, check `?debug2d` first to find out whether it is a layout problem or a
 * render problem.
 *
 * Buildings are drawn with InstancedMesh, one per structure kind. Instance index is mapped back to
 * the originating entry so the butterfly can raycast a building and recover the memory attached
 * to it.
 */

import * as THREE from 'three';
import type { Category, StructureKind } from '../data/types';
import type { CityLayout, Placement, TowerPlacement } from '../layout/polar';
import {
  dayTintFor,
  makeBuildingMaterial,
  makeInstallationMaterial,
  makeLampMaterial,
  makeNatureMaterial,
  makeQuietMaterial,
  makeWindowTexture,
  tintFor,
} from './materials';
import {
  civicGeometry,
  houseGeometry,
  installationGeometry,
  lampGeometry,
  linkGeometry,
  studioGeometry,
  towerGeometry,
  treeGeometry,
} from './geometry';

/**
 * World height of one skyscraper floor.
 *
 * Stays linear — one completion is one floor, exactly as promised — but small, because eighteen
 * months of a daily habit is ~450 floors and anything taller turns the tower into a needle that
 * pierces the frame and flattens everything else.
 */
export const FLOOR_HEIGHT = 0.11;
export const TOWER_FOOTPRINT = 3.4;


/** Which shared material a structure kind draws with. */
type MaterialKey = 'building' | 'quiet' | 'nature' | 'installation' | 'lamp';

export interface PickTarget {
  kind: 'entry' | 'tower';
  entryId?: string;
  commitmentId?: string;
  category?: Category;
  text: string;
  /** For an entry this is its ISO date; for a tower, its floors and cadence. */
  subtitle: string;
  position: THREE.Vector3;
  /** Top of the structure — where the butterfly lands. */
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
 * vocabulary — a nap and a deadline rendered as the same tower. Heights now form a deliberate
 * hierarchy: commitment towers dominate downtown, studios and libraries are mid-rise, and houses,
 * trees and bridges stay genuinely low so they read as what they are.
 */
const KIND_SPECS: Record<StructureKind, KindSpec> = {
  skyscraper: {
    geometry: towerGeometry,
    material: 'building',
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
  private dummy = new THREE.Object3D();
  private timeOfDay: 'day' | 'night' = 'night';

  constructor() {
    this.windowTexture = makeWindowTexture();
  }

  private materialFor(key: MaterialKey, tint: number): THREE.MeshStandardMaterial {
    const id = `${key}|${tint}`;
    let material = this.materials.get(id);
    if (!material) {
      material =
        key === 'building'
          ? makeBuildingMaterial(this.windowTexture, tint)
          : key === 'installation'
            ? makeInstallationMaterial(tint)
            : key === 'nature'
              ? makeNatureMaterial()
              : key === 'lamp'
                ? makeLampMaterial()
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
  setTimeOfDay(mode: 'day' | 'night'): void {
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
      } else {
        // Installations keep glowing in daylight — a milestone should still announce itself.
        material.emissiveIntensity = day ? nightEmissive * 0.7 : nightEmissive;
      }
    }

    if (this.ground) {
      // Warm dusk earth rather than a grey plate, so the ground belongs to the same sunset as
      // the sky instead of reading as a separate slab under it.
      (this.ground.material as THREE.MeshStandardMaterial).color.setHex(day ? 0x4c3b33 : 0x07080d);
    }
  }

  /** Rebuild the whole city from a layout. Cheap enough to call on every scrubber tick. */
  setLayout(layout: CityLayout): void {
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

  private buildGround(layout: CityLayout): void {
    // Far enough that the ground reaches what reads as the true horizon.
    //
    // A ground disc only a little larger than the city ends well short of the horizon line, and
    // the sky dome shows underneath its edge — that is sky at *negative* elevation, where any
    // vertical gradient is a single flat colour. It is why a sunset palette looked like a wash no
    // matter how it was tuned. Running the ground out to here, with fog fading it to exactly the
    // horizon colour, puts the visible seam at the real horizon instead.
    const radius = Math.max(layout.radius * 14, 1800);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 128),
      new THREE.MeshStandardMaterial({ color: 0x07080d, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.ground = ground;
    this.group.add(ground);

    // Ring roads between months. Faintly lit, so the tree rings stay legible from above without
    // needing labels.
    for (const band of layout.bands) {
      const road = new THREE.Mesh(
        new THREE.RingGeometry(band.outerRadius, band.outerRadius + 0.35, 160),
        new THREE.MeshBasicMaterial({
          color: band.isEmpty ? 0x4c7a52 : 0x2a3350,
          transparent: true,
          opacity: band.isEmpty ? 0.55 : 0.35,
          side: THREE.DoubleSide,
        }),
      );
      road.rotation.x = -Math.PI / 2;
      road.position.y = 0.03;
      this.decor.push(road);
      this.group.add(road);

      // Quiet months are parkland, never gaps — the 3D half of that rule.
      if (band.isEmpty) {
        const park = new THREE.Mesh(
          new THREE.RingGeometry(band.innerRadius, band.outerRadius, 160),
          new THREE.MeshStandardMaterial({ color: 0x16281a, roughness: 1 }),
        );
        park.rotation.x = -Math.PI / 2;
        park.position.y = 0.02;
        this.decor.push(park);
        this.group.add(park);
      }
    }
  }

  /**
   * Street lamps along every ring road.
   *
   * Cheap, and the single biggest thing that makes an aerial city read as inhabited rather than as
   * a field of boxes — it is the streets that tell you people live there.
   */
  private buildLamps(layout: CityLayout): void {
    const matrices: THREE.Matrix4[] = [];
    // Very sparse and short. Lamps taller or denser than this turn every ring road into a picket
    // fence of candles and pull attention away from the buildings.
    const spacing = 38;
    const height = 1.7;

    for (const band of layout.bands) {
      const radius = band.outerRadius + 0.2;
      const count = Math.max(6, Math.round((Math.PI * 2 * radius) / spacing));
      for (let i = 0; i < count; i += 1) {
        const angle = (Math.PI * 2 * i) / count;
        this.dummy.position.set(Math.cos(angle) * radius, height / 2, Math.sin(angle) * radius);
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

  private buildStructures(layout: CityLayout): void {
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
          subtitle: `${tower.floors} floors · ${tower.cadenceLabel}`,
          position: new THREE.Vector3(tower.x, 0, tower.z),
          top,
        },
        matrix,
        // Height is permanent record; light is current state. A quiet tower keeps every floor
        // and simply stops glowing.
        tower.lit ? 0xffd9a0 : 0x151a26,
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
      (this.ground.material as THREE.Material).dispose();
      this.ground = null;
    }
  }

  dispose(): void {
    this.clear();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.windowTexture.dispose();
  }
}
