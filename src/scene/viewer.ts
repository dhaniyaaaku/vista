/**
 * Renderer, camera, and the frame loop.
 *
 * Camera is deliberately long-lensed and high — that near-orthographic compression is most of
 * what makes a scene read as a miniature diorama rather than a game level. Lighting here is
 * placeholder; the night palette lands in a later pass.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CityScene } from './city';
import type { CityLayout } from '../layout/polar';

export class Viewer {
  readonly scene = new THREE.Scene();
  readonly city = new CityScene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private renderer: THREE.WebGLRenderer;
  private canvas: HTMLCanvasElement;
  private frame = 0;
  private onFrame: ((dt: number) => void)[] = [];
  private timer = new THREE.Timer();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      // Only for scripts/shot.mjs, which reads the framebuffer directly — Playwright's own
      // capture deadlocks against a continuous rAF loop on a software GL surface. Costs real
      // performance on some GPUs, so it stays off unless explicitly asked for.
      preserveDrawingBuffer: new URLSearchParams(location.search).has('capture'),
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = new THREE.Color(0x0b0d14);
    this.scene.fog = new THREE.Fog(0x0b0d14, 120, 340);
    this.scene.add(this.city.group);

    // Long focal length flattens perspective, which is the diorama trick.
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.5, 1200);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.06;
    this.controls.enablePan = false;

    this.addPlaceholderLights();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setLayout(layout: CityLayout): void {
    this.city.setLayout(layout);
  }

  /** Point the camera at the whole city. Called once, not on every scrub, so the view stays put. */
  frameCity(layout: CityLayout): void {
    const radius = Math.max(layout.radius, 24);

    const elevation = 0.72; // radians above the horizon, ~41 degrees

    // Distance is derived from the lens rather than guessed, against both screen axes. The city
    // is a disc, so its horizontal extent is the full diameter while its vertical extent is
    // foreshortened by the viewing angle — fitting to only one axis over- or under-shoots badly.
    const halfFovV = (this.camera.fov * Math.PI) / 360;
    const halfFovH = Math.atan(Math.tan(halfFovV) * this.camera.aspect);
    const distance =
      Math.max(
        radius / Math.tan(halfFovH),
        (radius * Math.sin(elevation)) / Math.tan(halfFovV),
      ) * 1.1;

    const azimuth = Math.PI * 0.25;
    this.camera.position.set(
      Math.cos(elevation) * Math.cos(azimuth) * distance,
      Math.sin(elevation) * distance,
      Math.cos(elevation) * Math.sin(azimuth) * distance,
    );

    this.controls.target.set(0, 4, 0);
    this.controls.minDistance = radius * 0.4;
    this.controls.maxDistance = distance * 1.6;
    this.controls.update();

    // Fog has to follow the framing, or the whole city sits inside it and greys out.
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = distance * 0.65;
      this.scene.fog.far = distance * 2.1;
    }
  }

  onTick(fn: (dt: number) => void): void {
    this.onFrame.push(fn);
  }

  start(): void {
    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      this.timer.update();
      const dt = this.timer.getDelta();
      for (const fn of this.onFrame) fn(dt);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
  }

  private addPlaceholderLights(): void {
    const hemi = new THREE.HemisphereLight(0x9fb4d8, 0x1a1c26, 0.75);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffe3c0, 1.15);
    key.position.set(60, 90, 40);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 10;
    key.shadow.camera.far = 320;
    const extent = 110;
    key.shadow.camera.left = -extent;
    key.shadow.camera.right = extent;
    key.shadow.camera.top = extent;
    key.shadow.camera.bottom = -extent;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x6f8ba8, 0.35);
    fill.position.set(-70, 40, -50);
    this.scene.add(fill);
  }

  private resize(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
