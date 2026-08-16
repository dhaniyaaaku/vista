/**
 * Renderer, camera, night lighting, and the frame loop.
 *
 * Two things carry the look. The camera is long-lensed and high, because that near-orthographic
 * compression is most of what makes a scene read as a miniature rather than a game level. And
 * almost nothing is actually lit â€” the city is emissive surfaces against near-black, with bloom
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
import type { IslandLayout } from '../layout/islands';

/** Horizon colour. Fog matches it so the outer city dissolves into the sky rather than a wall. */
/**
 * Horizon colour.
 *
 * Fog is set to exactly this in both modes, which is what makes the horizon work: the ground runs
 * far past the city and fades into precisely the colour the sky starts at, so the two meet with no
 * visible seam and the far ground reads as sky rather than as a dark rim.
 */
const HORIZON = 0x2a1550;

/** Night, a sunset, and a clear blue day. */
export type TimeOfDay = 'night' | 'sunset' | 'day';

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
  private timeOfDay: TimeOfDay = 'night';
  /** Centre of the scene, so sky bodies stay far away rather than landing inside the islands. */
  private skyOrigin = new THREE.Vector3();
  private flight: {
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    elapsed: number;
    duration: number;
  } | null = null;

  /**
   * Fog range, which has to differ sharply by mode.
   *
   * At night fog sits close, so the outer city dissolves into the sky. In daylight the same range
   * buries the whole city in white haze â€” daylight fog has to start well beyond the city and only
   * touch the far edge.
   */
  private applyFogRange(): void {
    if (!(this.scene.fog instanceof THREE.Fog)) return;
    // Clear day has no fog at all — it is meant to be a bright, sharp, cloudless afternoon, and
    // any haze at all reads as dirt on the lens. Night and sunset keep it for atmosphere: it
    // starts beyond the city so the city stays crisp, and fades the far water to exactly the
    // horizon colour so the two meet without a visible rim.
    if (this.timeOfDay === 'day') {
      this.scene.fog.near = this.fitDistance * 40;
      this.scene.fog.far = this.fitDistance * 80;
      return;
    }
    // Sunset keeps only a trace, far enough out that the islands stay crisp. Any nearer and the
    // whole scene silts up with haze, which is what it was doing.
    const sunset = this.timeOfDay === 'sunset';
    this.scene.fog.near = this.fitDistance * (sunset ? 6 : 1.4);
    this.scene.fog.far = this.fitDistance * (sunset ? 18 : 4.5);
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      // Only for scripts/shot.mjs, which reads the framebuffer directly â€” Playwright's own
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
    this.controls.dampingFactor = 0.08;
    // No auto-rotate. A map that drifts under the cursor makes precise navigation impossible, and
    // this is a place to explore rather than a screensaver.
    this.controls.autoRotate = false;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    // Panning is how you actually move around an archipelago.
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = false;

    this.addSky();
    this.addNightLights();
    this.addStars();
    this.addMoon();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      0.7, // strength â€” enough to halo the lights, not enough to smear the city into a cloud
      0.55, // radius
      0.32, // threshold â€” milestones and the brightest windows bloom, the bulk of the city does not
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setLayout(layout: IslandLayout): void {
    this.city.setLayout(layout);
  }

  /** Point the camera at the whole city. Called once, not on every scrub, so the view stays put. */
  frameCity(layout: IslandLayout): void {
    // Frame the inner city rather than the whole disc. Fitting everything puts each building at
    // about two pixels, which no amount of lighting can rescue â€” the outer rings are better left
    // to fall away into fog, the way a real skyline does.
    // Fit the whole archipelago. Cropping made sense for a single disc where the outer rings could
    // fall away into fog, but here the islands are the subject and losing one off the frame edge
    // hides an entire year.
    const radius = Math.max(layout.radius, 24) * 1.08;
    // The city is the subject, so the default view stays high enough to read it properly. That
    // means little sky is in frame by default â€” which is fine. The horizon fix below is what
    // makes the sunset correct *when you orbit down to it*, rather than forcing every frame to
    // be a landscape shot at the city's expense.
    const elevation = 0.52; // radians above the horizon, ~30 degrees

    // Distance is derived from the lens rather than guessed, against both screen axes. The city
    // is a disc, so its horizontal extent is the full diameter while its vertical extent is
    // foreshortened by the viewing angle â€” fitting to only one axis over- or under-shoots badly.
    const halfFovV = (this.camera.fov * Math.PI) / 360;
    const halfFovH = Math.atan(Math.tan(halfFovV) * this.camera.aspect);
    const distance =
      Math.max(
        radius / Math.tan(halfFovH),
        (radius * Math.sin(elevation)) / Math.tan(halfFovV),
      ) * 1.05;

    // The archipelago is not centred on the origin once there is more than one island, so the
    // camera has to orbit its actual middle rather than world zero.
    this.camera.position.set(
      layout.centerX + Math.cos(elevation) * Math.cos(Math.PI * 0.25) * distance,
      Math.sin(elevation) * distance,
      layout.centerZ + Math.cos(elevation) * Math.sin(Math.PI * 0.25) * distance,
    );

    this.controls.target.set(layout.centerX, 6, layout.centerZ);
    this.controls.minDistance = radius * 0.35;
    this.controls.maxDistance = distance * 1.7;
    this.controls.update();

    // Fog has to follow the framing, or the whole city sits inside it and greys out.
    this.fitDistance = distance;
    this.applyFogRange();
    // The sun and moon are placed relative to the scene's centre. Left at fixed world coordinates
    // they end up sitting inside the archipelago once it stops being centred on the origin.
    this.skyOrigin.set(layout.centerX, 0, layout.centerZ);
    this.setTimeOfDay(this.timeOfDay);
  }

  /**
   * Cinematic framing for the landing page.
   *
   * Deliberately different from `frameCity`. The app view sits high because the city is the
   * subject; at that angle the horizon is off-screen and there is nowhere for a sky to be. This
   * one drops to a low aerial and pitches up, so the skyline sits in the lower third against a
   * full sunset. Same scene, different lens.
   */
  cinematicView(layout: IslandLayout): void {
    const radius = Math.max(layout.radius, 24);
    const elevation = 0.21; // ~12 degrees â€” low enough that most of the frame is sky

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
  restoreAppView(layout: IslandLayout): void {
    this.controls.autoRotateSpeed = 0.28;
    this.frameCity(layout);
  }

  /**
   * Fly to one island so it fills the frame.
   *
   * Animated rather than snapped, because a cut loses all sense of where you went — the flight is
   * what tells you this island is the one next door. Once it lands, navigation is completely
   * normal again; this only moves the camera.
   */
  focusIsland(island: { x: number; z: number; radius: number }): void {
    const halfFovV = (this.camera.fov * Math.PI) / 360;
    const halfFovH = Math.atan(Math.tan(halfFovV) * this.camera.aspect);
    const elevation = 0.62;
    const r = island.radius * 1.12;
    const distance = Math.max(
      r / Math.tan(halfFovH),
      (r * Math.sin(elevation)) / Math.tan(halfFovV),
    );

    // Approach from wherever the camera already is, so the flight reads as moving closer rather
    // than teleporting to a fixed viewpoint.
    const from = this.camera.position.clone();
    const bearing = Math.atan2(from.z - island.z, from.x - island.x);

    this.flyTo(
      new THREE.Vector3(
        island.x + Math.cos(elevation) * Math.cos(bearing) * distance,
        Math.sin(elevation) * distance,
        island.z + Math.cos(elevation) * Math.sin(bearing) * distance,
      ),
      new THREE.Vector3(island.x, 4, island.z),
    );

    this.controls.minDistance = island.radius * 0.16;
    this.controls.maxDistance = distance * 3.4;
    this.fitDistance = distance;
    this.applyFogRange();
  }

  /** Ease the camera and its target to a new pose over `seconds`. */
  private flyTo(position: THREE.Vector3, target: THREE.Vector3, seconds = 0.9): void {
    this.flight = {
      fromPos: this.camera.position.clone(),
      toPos: position,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      elapsed: 0,
      duration: seconds,
    };
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
      if (this.moon) this.city.tick(elapsed, this.moon.position.clone().normalize());
      for (const fn of this.onFrame) fn(dt, elapsed);

      if (this.flight) {
        this.flight.elapsed += dt;
        const t = Math.min(1, this.flight.elapsed / this.flight.duration);
        // Ease in and out, so the flight starts and settles gently rather than lurching.
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        this.camera.position.lerpVectors(this.flight.fromPos, this.flight.toPos, e);
        this.controls.target.lerpVectors(this.flight.fromTarget, this.flight.toTarget, e);
        if (t >= 1) this.flight = null;
      }

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
   * three-stop vertical gradient â€” violet at the horizon through indigo to near-black overhead â€”
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
        /** Strength of the rainbow. Day only. */
        rainbow: { value: 0 },
        /** Direction toward the sun, so the rainbow can be placed opposite it. */
        sunDirection: { value: new THREE.Vector3(-0.6, 0.4, -0.5).normalize() },
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
        uniform float rainbow;
        uniform vec3 sunDirection;
        uniform float time;
        varying vec3 vWorldPosition;

        /* Red through violet across t in [0,1]. */
        vec3 spectrum(float t) {
          return clamp(vec3(
            1.6 - abs(4.0 * t - 3.0),
            1.6 - abs(4.0 * t - 2.0),
            1.6 - abs(4.0 * t - 1.0)
          ), 0.0, 1.0);
        }

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
            // Broken cloud, not overcast â€” the blue has to stay the dominant colour.
            float cover = smoothstep(0.56, 0.84, fbm(uv * 1.4));
            // Fade out near the horizon, where the deck would be edge-on and far away.
            float fade = smoothstep(0.0, 0.20, h);
            c = mix(c, cloudColor, cover * fade * cloudAmount * 0.8);
          }

          if (rainbow > 0.001 && h > -0.02) {
            // A real rainbow is a ring 42 degrees from the antisolar point, so that is where this
            // one goes. Placing it by eye instead would sit wrong against the sun every time.
            // A real rainbow sits 42 degrees from the antisolar point, which at this field of view
            // fills most of the sky and reads as a vague wash. Pulled in to 26 degrees it is a
            // clear arc you actually notice.
            float ang = degrees(acos(clamp(dot(dir, -sunDirection), -1.0, 1.0)));
            float t = (ang - 25.0) / 1.7;
            if (t > 0.0 && t < 1.0) {
              // Red outermost, violet innermost, and soft at both edges.
              // Pushed well past the pastel the raw ramp gives, so the bands actually read as red,
              // green and violet rather than as a pale smear.
              vec3 bow = spectrum(1.0 - t);
              bow = pow(bow, vec3(0.55)) * 1.25;
              float strength = sin(t * 3.14159);
              // Fade it out as it reaches the ground, where a rainbow would end.
              float ground = smoothstep(-0.02, 0.06, h);
              c = mix(c, bow, strength * ground * rainbow * 0.62);
            }
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

  /** Swap the whole scene between night, sunset and clear day. */
  setTimeOfDay(mode: TimeOfDay): void {
    const night = mode === 'night';
    const sunset = mode === 'sunset';
    const clear = mode === 'day';
    // Everything that only distinguishes "lit" from "dark" still works off this.
    const day = !night;
    this.timeOfDay = mode;
    this.city.setTimeOfDay(mode);

    // Natural daylight: pale haze at the horizon deepening to blue overhead, with a drifting
    // cloud deck. Anything warmer than this tips the whole city yellow.
    const uniforms = this.skyMaterial?.uniforms;
    if (uniforms) {
      if (clear) {
        // Bright blue, and saturated early: the visible band of sky sits low, so pale stops here
        // wash the whole thing out to white.
        uniforms.horizonColor.value.setHex(0x9fd4ff);
        uniforms.lowColor.value.setHex(0x4aa2ee);
        uniforms.midColor.value.setHex(0x1f76dd);
        uniforms.topColor.value.setHex(0x0a4bb5);
        uniforms.cloudColor.value.setHex(0xffffff);
      } else if (sunset) {
        uniforms.horizonColor.value.setHex(0xffd9a0);
        uniforms.lowColor.value.setHex(0xff8b4d);
        uniforms.midColor.value.setHex(0xc2508a);
        uniforms.topColor.value.setHex(0x1a2a6e);
        uniforms.cloudColor.value.setHex(0xffd2c0);
      } else {
        uniforms.horizonColor.value.setHex(HORIZON);
        uniforms.lowColor.value.setHex(HORIZON);
        uniforms.midColor.value.setHex(0x0d0722);
        uniforms.topColor.value.setHex(0x03030a);
        uniforms.cloudColor.value.setHex(0xffffff);
      }
      uniforms.cloudAmount.value = night ? 0 : clear ? 0.55 : 1;
      uniforms.rainbow.value = clear ? 1 : 0;
      if (this.moon) uniforms.sunDirection.value.copy(this.moon.position).normalize();
    }

    for (const layer of this.starLayers) layer.visible = !day;

    // The lighting is kept close to neutral even at sunset. Warm light on warm facades tips the
    // whole city yellow and every building loses its own colour.
    if (this.hemi) {
      this.hemi.color.setHex(clear ? 0xd9ecff : sunset ? 0xd8dcea : 0x2a3550);
      this.hemi.groundColor.setHex(night ? 0x05060a : 0x585460);
      this.hemi.intensity = night ? 0.55 : 1;
    }
    if (this.key) {
      this.key.color.setHex(clear ? 0xfffaf0 : sunset ? 0xffe2c4 : 0x9fb8e8);
      this.key.intensity = night ? 0.35 : clear ? 2 : 1.7;
      // High on a clear day, low at sunset so buildings catch a raking light.
      if (clear) this.key.position.set(-320, 460, -240);
      else if (sunset) this.key.position.set(-430, 150, -110);
      else this.key.position.set(-260, 340, -190);
    }
    if (this.moon && this.moonMaterial) {
      this.moonMaterial.color.setHex(clear ? 0xfffdf0 : sunset ? 0xfff0cf : 0xf4f0ff);
      // Offset from the scene centre, and scaled with how far back the camera sits, so the sun
      // stays in the sky rather than parked among the islands.
      const far = Math.max(this.fitDistance, 220);
      const o = this.skyOrigin;
      // Day sun kept low on purpose. A rainbow is a ring 42 degrees from the *antisolar* point, so
      // a high sun puts that ring entirely below the horizon and no rainbow can be visible at all.
      // At roughly 22 degrees the arc clears the horizon and stands in the sky where you want it.
      if (clear) this.moon.position.set(o.x - far * 2.0, far * 0.82, o.z - far * 1.2);
      else if (sunset) this.moon.position.set(o.x - far * 2.3, far * 0.5, o.z - far * 1.0);
      else this.moon.position.set(o.x - far * 1.3, far * 1.7, o.z - far * 0.95);
      this.moon.scale.setScalar(sunset ? 1.9 : 1.1);
    }
    if (this.glow && this.glowMaterial && this.moon) {
      this.glowMaterial.color.setHex(clear ? 0xfff2c8 : sunset ? 0xffa25e : 0xbcc6ff);
      this.glowMaterial.opacity = night ? 0.45 : 1;
      this.glow.scale.setScalar(sunset ? 420 : night ? 150 : 300);
      this.glow.position.copy(this.moon.position);
    }

    this.bloom.strength = night ? 0.45 : clear ? 0.22 : 0.3;

    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.setHex(clear ? 0xdcefff : sunset ? 0xff8a5c : HORIZON);
    }
    this.applyFogRange();
    this.renderer.toneMappingExposure = night ? 1.1 : 1;
  }

  /**
   * Layered star field.
   *
   * Three passes at different sizes and opacities rather than one uniform sprinkle â€” a real sky
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
