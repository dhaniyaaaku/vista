/**
 * Renderer, camera, night lighting, and the frame loop.
 *
 * Two things carry the look. The camera is long-lensed and high, because that near-orthographic
 * compression is most of what makes a scene read as a miniature rather than a game level. And
 * almost nothing is actually lit — the city is emissive surfaces against near-black, with bloom
 * doing the rest, which is both closer to how a city looks from the air at night and far cheaper
 * than lighting two thousand buildings.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CityScene } from './city';
import type { CityLayout } from '../layout/polar';

const SKY = 0x05060c;

export class Viewer {
  readonly scene = new THREE.Scene();
  readonly city = new CityScene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private canvas: HTMLCanvasElement;
  private frame = 0;
  private onFrame: ((dt: number, elapsed: number) => void)[] = [];
  private timer = new THREE.Timer();
  private stars: THREE.Points | null = null;

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
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    // No shadow map: at night the key light is too dim to cast anything worth the cost, and
    // shadows on two thousand instances are the single most expensive thing we could buy.
    this.renderer.shadowMap.enabled = false;

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 120, 340);
    this.scene.add(this.city.group);

    this.camera = new THREE.PerspectiveCamera(28, 1, 0.5, 2000);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.28;
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.enablePan = false;

    this.addNightLights();
    this.addStars();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      0.7, // strength — enough to halo the lights, not enough to smear the city into a cloud
      0.55, // radius
      0.32, // threshold — milestones and the brightest windows bloom, the bulk of the city does not
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setLayout(layout: CityLayout): void {
    this.city.setLayout(layout);
  }

  /** Point the camera at the whole city. Called once, not on every scrub, so the view stays put. */
  frameCity(layout: CityLayout): void {
    // Frame the inner city rather than the whole disc. Fitting everything puts each building at
    // about two pixels, which no amount of lighting can rescue — the outer rings are better left
    // to fall away into fog, the way a real skyline does.
    const radius = Math.max(layout.radius, 24) * 0.82;
    const elevation = 0.55; // radians above the horizon, ~32 degrees — a low aerial

    // Distance is derived from the lens rather than guessed, against both screen axes. The city
    // is a disc, so its horizontal extent is the full diameter while its vertical extent is
    // foreshortened by the viewing angle — fitting to only one axis over- or under-shoots badly.
    const halfFovV = (this.camera.fov * Math.PI) / 360;
    const halfFovH = Math.atan(Math.tan(halfFovV) * this.camera.aspect);
    const distance =
      Math.max(
        radius / Math.tan(halfFovH),
        (radius * Math.sin(elevation)) / Math.tan(halfFovV),
      ) * 1.05;

    this.camera.position.set(
      Math.cos(elevation) * Math.cos(Math.PI * 0.25) * distance,
      Math.sin(elevation) * distance,
      Math.cos(elevation) * Math.sin(Math.PI * 0.25) * distance,
    );

    this.controls.target.set(0, 6, 0);
    this.controls.minDistance = radius * 0.35;
    this.controls.maxDistance = distance * 1.7;
    this.controls.update();

    // Fog has to follow the framing, or the whole city sits inside it and greys out.
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = distance * 0.7;
      this.scene.fog.far = distance * 2.4;
    }
  }

  onTick(fn: (dt: number, elapsed: number) => void): void {
    this.onFrame.push(fn);
  }

  start(): void {
    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      this.timer.update();
      const dt = this.timer.getDelta();
      const elapsed = this.timer.getElapsed();
      for (const fn of this.onFrame) fn(dt, elapsed);
      this.controls.update();
      this.composer.render();
    };
    loop();
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
  }

  private addNightLights(): void {
    // Just enough to keep unlit faces from going pure black. The city lights itself.
    this.scene.add(new THREE.HemisphereLight(0x2a3550, 0x05060a, 0.55));

    const moon = new THREE.DirectionalLight(0x9fb8e8, 0.35);
    moon.position.set(-80, 120, -60);
    this.scene.add(moon);
  }

  private addStars(): void {
    const count = 1400;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      // Upper hemisphere only, on a shell well outside the city.
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.95);
      const r = 900 + Math.random() * 250;
      positions[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      positions[i * 3 + 1] = Math.cos(phi) * r;
      positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.stars = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xdfe6ff,
        size: 2.4,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.75,
        fog: false,
      }),
    );
    this.scene.add(this.stars);
  }

  private resize(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
