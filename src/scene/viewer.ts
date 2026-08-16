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

/** Horizon colour. Fog matches it so the outer city dissolves into the sky rather than a wall. */
/**
 * Horizon colour.
 *
 * Fog is set to exactly this in both modes, which is what makes the horizon work: the ground runs
 * far past the city and fades into precisely the colour the sky starts at, so the two meet with no
 * visible seam and the far ground reads as sky rather than as a dark rim.
 */
const HORIZON = 0x2a1550;

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
  private starLayers: THREE.Points[] = [];
  private skyMaterial: THREE.ShaderMaterial | null = null;
  private hemi: THREE.HemisphereLight | null = null;
  private key: THREE.DirectionalLight | null = null;
  private moon: THREE.Mesh | null = null;
  private moonMaterial: THREE.MeshBasicMaterial | null = null;
  private glow: THREE.Sprite | null = null;
  private glowMaterial: THREE.SpriteMaterial | null = null;
  private fitDistance = 200;
  private timeOfDay: 'day' | 'night' = 'night';

  /**
   * Fog range, which has to differ sharply by mode.
   *
   * At night fog sits close, so the outer city dissolves into the sky. In daylight the same range
   * buries the whole city in white haze — daylight fog has to start well beyond the city and only
   * touch the far edge.
   */
  private applyFogRange(): void {
    if (!(this.scene.fog instanceof THREE.Fog)) return;
    const day = this.timeOfDay === 'day';
    // Fog now does atmospheric perspective rather than hiding anything: it starts beyond the city,
    // so the city itself stays crisp, and finishes well before the edge of the ground, so the far
    // ground has faded to exactly the horizon colour by the time it meets the sky. That is what
    // makes the horizon a seamless line instead of a visible rim.
    this.scene.fog.near = this.fitDistance * (day ? 1.8 : 0.9);
    this.scene.fog.far = this.fitDistance * (day ? 7 : 3);
  }

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

    this.scene.fog = new THREE.Fog(HORIZON, 120, 340);
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

    this.addSky();
    this.addNightLights();
    this.addStars();
    this.addMoon();

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
    // The city is the subject, so the default view stays high enough to read it properly. That
    // means little sky is in frame by default — which is fine. The horizon fix below is what
    // makes the sunset correct *when you orbit down to it*, rather than forcing every frame to
    // be a landscape shot at the city's expense.
    const elevation = 0.52; // radians above the horizon, ~30 degrees

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
    this.fitDistance = distance;
    this.applyFogRange();
  }

  /**
   * Cinematic framing for the landing page.
   *
   * Deliberately different from `frameCity`. The app view sits high because the city is the
   * subject; at that angle the horizon is off-screen and there is nowhere for a sky to be. This
   * one drops to a low aerial and pitches up, so the skyline sits in the lower third against a
   * full sunset. Same scene, different lens.
   */
  cinematicView(layout: CityLayout): void {
    const radius = Math.max(layout.radius, 24);
    const elevation = 0.21; // ~12 degrees — low enough that most of the frame is sky

    const halfFovV = (this.camera.fov * Math.PI) / 360;
    // Close enough that the skyline has presence. Fitting the whole disc from this low an angle
    // shrinks the city to a smudge on the horizon.
    const distance = (radius * 0.62) / Math.tan(halfFovV);

    this.camera.position.set(
      Math.cos(elevation) * Math.cos(Math.PI * 0.2) * distance,
      Math.max(18, Math.sin(elevation) * distance),
      Math.cos(elevation) * Math.sin(Math.PI * 0.2) * distance,
    );
    // Aim above the city so the horizon rises into frame and the skyline drops low.
    this.controls.target.set(0, radius * 0.26, 0);
    this.controls.minDistance = radius * 0.35;
    this.controls.maxDistance = distance * 1.6;
    this.controls.autoRotateSpeed = 0.16;
    this.controls.update();

    this.fitDistance = distance;
    this.applyFogRange();
  }

  /** Restore the ordinary app framing after the landing page is dismissed. */
  restoreAppView(layout: CityLayout): void {
    this.controls.autoRotateSpeed = 0.28;
    this.frameCity(layout);
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
      if (this.skyMaterial) this.skyMaterial.uniforms.time.value = elapsed;
      for (const fn of this.onFrame) fn(dt, elapsed);
      this.controls.update();
      this.composer.render();
    };
    loop();
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
  }

  /**
   * Gradient sky dome.
   *
   * A flat background colour makes the city look like it was cut out and pasted onto black. A
   * three-stop vertical gradient — violet at the horizon through indigo to near-black overhead —
   * gives the scene depth and somewhere for the skyline to sit against.
   *
   * Colours go through THREE.Color, so they are converted from sRGB into the linear working space
   * and OutputPass converts back at the end of the composer chain.
   */
  private addSky(): void {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        // Dark enough that the stars read and the skyline stays the brightest thing in frame.
        // A saturated sky at full brightness reads as a painted wall, not as night.
        horizonColor: { value: new THREE.Color(HORIZON) },
        lowColor: { value: new THREE.Color(HORIZON) },
        midColor: { value: new THREE.Color(0x0d0722) },
        topColor: { value: new THREE.Color(0x03030a) },
        cloudColor: { value: new THREE.Color(0xffffff) },
        /** 0 at night, 1 in daylight. Clouds are a day-only feature. */
        cloudAmount: { value: 0 },
        time: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPosition;
        void main() {
          vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 horizonColor;
        uniform vec3 lowColor;
        uniform vec3 midColor;
        uniform vec3 topColor;
        uniform vec3 cloudColor;
        uniform float cloudAmount;
        uniform float time;
        varying vec3 vWorldPosition;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 5; i++) {
            v += a * noise(p);
            p *= 2.02;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec3 dir = normalize(vWorldPosition);
          float h = dir.y;

          // Four stops across the lower half of the dome. The camera now looks at the horizon, so
          // the visible band is roughly h in [0, 0.5] and the stops can spread out properly.
          vec3 c = mix(horizonColor, lowColor, smoothstep(0.0, 0.06, h));
          c = mix(c, midColor, smoothstep(0.05, 0.22, h));
          c = mix(c, topColor, smoothstep(0.20, 0.60, h));

          if (cloudAmount > 0.001 && h > 0.0) {
            // Project the view direction onto a flat deck overhead, so clouds compress toward
            // the horizon the way a real cloud layer does.
            vec2 uv = dir.xz / (h + 0.22) * 0.85;
            uv += time * 0.004;
            // Broken cloud, not overcast — the blue has to stay the dominant colour.
            float cover = smoothstep(0.56, 0.84, fbm(uv * 1.4));
            // Fade out near the horizon, where the deck would be edge-on and far away.
            float fade = smoothstep(0.0, 0.20, h);
            c = mix(c, cloudColor, cover * fade * cloudAmount * 0.8);
          }

          gl_FragColor = vec4(c, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });

    this.skyMaterial = material;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1300, 48, 32), material);
    this.scene.add(sky);
  }

  private addNightLights(): void {
    // Just enough to keep unlit faces from going pure black. At night the city lights itself.
    this.hemi = new THREE.HemisphereLight(0x2a3550, 0x05060a, 0.55);
    this.scene.add(this.hemi);

    this.key = new THREE.DirectionalLight(0x9fb8e8, 0.35);
    this.key.position.set(-260, 340, -190);
    this.scene.add(this.key);
  }

  /**
   * The moon, which becomes the sun in day mode.
   *
   * Sits just inside the star shell and well outside the city, and is bright enough to clear the
   * bloom threshold so it carries a halo rather than reading as a flat disc.
   */
  private addMoon(): void {
    this.moonMaterial = new THREE.MeshBasicMaterial({ color: 0xf4f0ff, fog: false });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(26, 32, 24), this.moonMaterial);
    this.moon.position.set(-300, 390, -220);
    this.scene.add(this.moon);

    // Halo. A bare disc reads as a sticker pasted on the sky; the falloff is what makes it look
    // like a light source.
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(0.16, 'rgba(255,238,205,0.5)');
    gradient.addColorStop(0.42, 'rgba(255,190,140,0.16)');
    gradient.addColorStop(1, 'rgba(255,170,120,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.glowMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    // Sibling of the disc rather than a child: parenting it would multiply the sun's own scale
    // into the halo and the glow would end up smaller than the thing it is supposed to surround.
    this.glow = new THREE.Sprite(this.glowMaterial);
    this.glow.scale.setScalar(240);
    this.glow.position.copy(this.moon.position);
    this.scene.add(this.glow);
  }

  /** Swap the whole scene between night and day. */
  setTimeOfDay(mode: 'day' | 'night'): void {
    const day = mode === 'day';
    this.timeOfDay = mode;
    this.city.setTimeOfDay(mode);

    // Natural daylight: pale haze at the horizon deepening to blue overhead, with a drifting
    // cloud deck. Anything warmer than this tips the whole city yellow.
    const uniforms = this.skyMaterial?.uniforms;
    if (uniforms) {
      uniforms.horizonColor.value.setHex(day ? 0xffd9a0 : HORIZON);
      uniforms.lowColor.value.setHex(day ? 0xff8b4d : HORIZON);
      uniforms.midColor.value.setHex(day ? 0xc2508a : 0x0d0722);
      uniforms.topColor.value.setHex(day ? 0x1a2a6e : 0x03030a);
      uniforms.cloudColor.value.setHex(day ? 0xffd2c0 : 0xffffff);
      uniforms.cloudAmount.value = day ? 1 : 0;
    }

    for (const layer of this.starLayers) layer.visible = !day;

    // The lighting is kept close to neutral even at sunset. Warm light on warm facades tips the
    // whole city yellow and every building loses its own colour.
    if (this.hemi) {
      this.hemi.color.setHex(day ? 0xd8dcea : 0x2a3550);
      this.hemi.groundColor.setHex(day ? 0x585460 : 0x05060a);
      this.hemi.intensity = day ? 1 : 0.55;
    }
    if (this.key) {
      this.key.color.setHex(day ? 0xffe2c4 : 0x9fb8e8);
      this.key.intensity = day ? 1.7 : 0.35;
      // Low and to one side, so buildings catch a raking sunset light.
      this.key.position.set(day ? -430 : -260, day ? 150 : 340, day ? -110 : -190);
    }
    if (this.moon && this.moonMaterial) {
      this.moonMaterial.color.setHex(day ? 0xfff0cf : 0xf4f0ff);
      // The sun sits low near the horizon; the moon rides high.
      this.moon.position.set(day ? -540 : -300, day ? 120 : 390, day ? -240 : -220);
      this.moon.scale.setScalar(day ? 1.9 : 1);
    }
    if (this.glow && this.glowMaterial && this.moon) {
      this.glowMaterial.color.setHex(day ? 0xffa25e : 0xbcc6ff);
      this.glowMaterial.opacity = day ? 1 : 0.45;
      this.glow.scale.setScalar(day ? 420 : 150);
      this.glow.position.copy(this.moon.position);
    }

    this.bloom.strength = day ? 0.3 : 0.45;

    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.setHex(day ? 0xff8a5c : HORIZON);
    }
    this.applyFogRange();
    this.renderer.toneMappingExposure = day ? 1 : 1.1;
  }

  /**
   * Layered star field.
   *
   * Three passes at different sizes and opacities rather than one uniform sprinkle — a real sky
   * has a few bright stars over a haze of faint ones, and a single uniform layer reads as noise.
   * They sit low in the sky too, so they are visible above the skyline rather than only overhead.
   */
  private addStars(): void {
    const layers = [
      { count: 1600, size: 1.9, opacity: 0.6, color: 0xaab6e0 },
      { count: 500, size: 3, opacity: 0.85, color: 0xdfe6ff },
      { count: 120, size: 4.5, opacity: 1, color: 0xffffff },
    ];

    for (const layer of layers) {
      const positions = new Float32Array(layer.count * 3);
      for (let i = 0; i < layer.count; i += 1) {
        const theta = Math.random() * Math.PI * 2;
        // Bias toward the horizon so stars sit behind the skyline, not just at the zenith.
        const phi = Math.acos(Math.random() * 0.98);
        const r = 1000 + Math.random() * 200;
        positions[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
        positions[i * 3 + 1] = Math.abs(Math.cos(phi)) * r;
        positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const points = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: layer.color,
          size: layer.size,
          sizeAttenuation: false,
          transparent: true,
          opacity: layer.opacity,
          fog: false,
          depthWrite: false,
        }),
      );
      this.scene.add(points);
      this.starLayers.push(points);
    }
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
