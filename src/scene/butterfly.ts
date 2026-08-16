/**
 * The butterfly cursor.
 *
 * It replaces the OS pointer over the canvas, and it does real work beyond decoration: in a
 * miniature city there is nothing to establish scale, so a fixed-size creature is what tells the
 * eye how big everything else is.
 *
 * The motion is the whole trick. It follows the cursor with lag rather than locking to it, and
 * layers a bob and a drift on top, because butterflies never fly straight. Too much lag and it
 * feels sluggish; too little and it stops reading as alive.
 */

import * as THREE from 'three';

/**
 * How hard it chases the cursor.
 *
 * High enough to feel like direct control — below about 0.2 it reads as sluggish rather than
 * alive, and the aliveness is supposed to come from the bob and drift layered on top, not from
 * the butterfly being slow to arrive.
 */
const FOLLOW = 0.62;
/** Seconds for the landing ease. */
const LAND_TIME = 0.4;

function wingShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(0.75, 0.95, 1.15, 0.3);
  s.quadraticCurveTo(1.35, -0.25, 0.75, -0.62);
  s.quadraticCurveTo(0.3, -0.78, 0.12, -0.28);
  s.quadraticCurveTo(0.05, -0.1, 0, 0);
  return s;
}

export class Butterfly {
  readonly group = new THREE.Group();

  private leftPivot = new THREE.Object3D();
  private rightPivot = new THREE.Object3D();
  private position = new THREE.Vector3(0, 20, 0);
  private heading = new THREE.Vector3(0, 0, 1);
  private materials: THREE.Material[] = [];
  private baseScale: number;

  /** 0 = flying, 1 = fully landed. Drives both the ease and the wing speed. */
  private landAmount = 0;

  /**
   * @param scale World units across. Must be sized against the city, not against a real
   *              butterfly — at a camera distance of ~200 units a lifelike 1-unit insect is
   *              sub-pixel and simply never appears.
   */
  constructor(scale = 3.6) {
    this.baseScale = scale;
    const wingMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1430,
      emissive: 0xffd9ec,
      // Below the bloom threshold: bright enough to read against a dark city, dim enough that
      // the wing shape survives instead of blooming into an anonymous white blob.
      emissiveIntensity: 0.42,
      roughness: 0.5,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.94,
    });
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x16121f,
      emissive: 0xffc0dd,
      emissiveIntensity: 0.35,
      roughness: 0.6,
    });
    this.materials.push(wingMaterial, bodyMaterial);

    const geometry = new THREE.ShapeGeometry(wingShape(), 12);

    const left = new THREE.Mesh(geometry, wingMaterial);
    left.rotation.y = -Math.PI / 2;
    this.leftPivot.add(left);

    const right = new THREE.Mesh(geometry, wingMaterial);
    right.rotation.y = -Math.PI / 2;
    right.scale.z = -1; // mirrored, so the pair is symmetric
    this.rightPivot.add(right);

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.1, 0.55, 4, 8),
      bodyMaterial,
    );
    body.rotation.x = Math.PI / 2;

    this.group.add(this.leftPivot, this.rightPivot, body);
    this.group.scale.setScalar(scale);
    this.group.position.copy(this.position);
    // Never occluded by a building it is sitting on.
    this.group.renderOrder = 10;
  }

  /**
   * @param desired  where it wants to be this frame
   * @param landing  true when the cursor is over a building, so it should settle rather than hover
   */
  update(
    dt: number,
    elapsed: number,
    desired: THREE.Vector3,
    landing: boolean,
    camera?: THREE.Camera,
  ): void {
    const step = Math.min(1, dt * 60);

    // Ease the landing state rather than snapping, so wings slow down as it settles.
    const target = landing ? 1 : 0;
    this.landAmount += (target - this.landAmount) * Math.min(1, dt / LAND_TIME);

    // Chase with lag. Landing tightens the follow so it actually reaches the roof.
    const follow = FOLLOW + this.landAmount * 0.16;
    const previous = this.position.clone();
    this.position.lerp(desired, follow * step);

    // Butterflies never fly straight: a slow bob plus a wandering drift, both fading out on
    // landing so a settled butterfly sits still. Kept small — this is a cursor first, and drift
    // large enough to notice is drift large enough to make aiming annoying.
    const wander = 1 - this.landAmount;
    const bob = Math.sin(elapsed * 2.1) * 0.22 * wander;
    const driftX = Math.sin(elapsed * 0.77 + 1.3) * 0.24 * wander;
    const driftZ = Math.cos(elapsed * 0.61) * 0.24 * wander;

    this.group.position.set(
      this.position.x + driftX,
      this.position.y + bob,
      this.position.z + driftZ,
    );

    // Face the direction of travel, and bank into the turn.
    const velocity = this.group.position.clone().sub(previous);
    if (velocity.lengthSq() > 1e-5) {
      this.heading.lerp(velocity.normalize(), 0.12 * step);
      const yaw = Math.atan2(this.heading.x, this.heading.z);
      this.group.rotation.y = yaw;
      const turn = THREE.MathUtils.clamp(velocity.x * this.heading.z - velocity.z * this.heading.x, -1, 1);
      this.group.rotation.z = -turn * 0.5 * wander;
    }

    // Hold a constant size on screen by scaling with distance from the camera. With a fixed world
    // size it turns into a monster when you zoom in and vanishes when you zoom out, because it is
    // a cursor rather than a thing in the city.
    if (camera) {
      const distance = camera.position.distanceTo(this.group.position);
      const scale = THREE.MathUtils.clamp((distance / 200) * this.baseScale, 0.35, 14);
      this.group.scale.setScalar(scale);
    }

    // Fast flap in flight, a slow idle flutter once landed.
    const speed = 14 - this.landAmount * 11;
    const amplitude = 1.05 - this.landAmount * 0.5;
    const flap = Math.sin(elapsed * speed) * amplitude;
    this.leftPivot.rotation.z = flap;
    this.rightPivot.rotation.z = -flap;
  }

  dispose(): void {
    for (const material of this.materials) material.dispose();
  }
}
