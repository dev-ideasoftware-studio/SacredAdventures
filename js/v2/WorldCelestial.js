/**
 * Main-view celestial: procedural sky shader that paints one of **five
 * seasons** (`night | dawn | day | dusk | gray`) via `uZenithColor`,
 * `uHorizonColor`, `uCloudColor`, `uCloudShadow`, and `uCloudIntensity`
 * uniforms — same fbm cloud field everywhere, just re-coloured. The
 * night season swaps in an additive starfield, a synodic moon disc
 * (phase angle matches the PiP dial), and a moonbeam group that glows
 * around the disc and gently rotates. Root follows camera, materials
 * fog:false so world fog stays on terrain only.
 *
 * May-12 2026: wired to `ANU_EVENTS.SEASON_CHANGE` (UIModule's 5
 * `data-season` PiP buttons), moon dir lowered so it sits a little
 * below the top of the viewport over the horizon, beam plane count
 * bumped 7→11 and beams enlarged. See Anu `seasons-atmosphere-may-12`.
 */

import * as THREE from "three";
import { subscribeInteraction } from "./anu/InteractionBus.js";
import { ANU_EVENTS } from "./anu/anuEvents.js";
import { lunarPhaseSynodicIndex } from "./lunarPhase.js";

const SKY_RADIUS = 520;
const STAR_RADIUS = 410;
const MOON_DIST = 420;
const STAR_COUNT = 3200;
/** World +Y is up; celestial root is axis-aligned (no rotation) — only upper hemisphere avoids “stars on terrain”. */
const STAR_MIN_ELEV_COS = 0.18;

/**
 * Moon direction in world space. Y was 0.5 (~30° above horizon, near
 * straight-up from the player's POV); user spec May-12 2026 wants the
 * moon "a little below the top of the viewport over the horizon" so it
 * stays in frame at all times. Lowered y → 0.32 (~18° above horizon).
 */
const MOON_WORLD_DIR = new THREE.Vector3(0.46, 0.32, -0.82).normalize();

function mulberry32(seed) {
  return function rng() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shader snippets are compiled by Three.js with a prelude (uniforms/attributes); not standalone GLSL. */
const SKY_VERTEX = `
varying vec3 vWorldPos;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorldPos = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

/**
 * Season-aware sky shader. The fbm cloud field is unchanged from the
 * legacy day sky — what changes per season is:
 *   • uZenithColor / uHorizonColor — top vs bottom hemisphere mix
 *   • uCloudColor / uCloudShadow   — lit and shadowed sides of the wisps
 *   • uCloudIntensity              — how strongly clouds punch through
 *   • uNightAmount                 — 0 day-tone, 1 night-tone (used only
 *                                    for a soft moonlight-glow on the
 *                                    cloud lit side; stars + moon disc
 *                                    are separate `nightRoot` children)
 */
const SKY_FRAGMENT = `
precision highp float;
varying vec3 vWorldPos;
uniform vec3 uCameraPos;
uniform float uTime;
uniform vec3 uZenithColor;
uniform vec3 uHorizonColor;
uniform vec3 uCloudColor;
uniform vec3 uCloudShadow;
uniform float uCloudIntensity;
uniform float uNightAmount;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * noise(p);
    p *= 2.07;
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 rd = normalize(vWorldPos - uCameraPos);
  float h = clamp(rd.y, 0.0, 1.0);

  vec3 sky = mix(uZenithColor, uHorizonColor, pow(1.0 - h, 1.55));

  vec2 cloudUv = rd.xz / max(0.09, rd.y) * 0.38;
  cloudUv += uTime * vec2(0.012, 0.006);
  float n1 = fbm(cloudUv);
  float n2 = fbm(cloudUv * 1.85 - uTime * vec2(0.008, 0.011));
  float layer = smoothstep(0.04, 0.65, rd.y);
  float wisp = clamp((n1 * 0.58 + n2 * 0.42 - 0.36) * 3.9 * layer, 0.0, 1.0);

  vec3 cloudShadow = mix(uCloudShadow, sky * vec3(0.92, 0.94, 0.98), 0.35);
  vec3 cloudy = mix(cloudShadow, uCloudColor, wisp);

  // At night, give the lit side of the clouds a faint cool moonlight
  // glow so they read as "softly lit from above" instead of black mush.
  cloudy += vec3(0.06, 0.09, 0.14) * uNightAmount * wisp;

  float blend = wisp * smoothstep(0.0, 0.18, rd.y) * smoothstep(-0.04, 0.1, rd.y);
  sky = mix(sky, cloudy, clamp(blend * uCloudIntensity * 0.94, 0.0, 1.0));

  gl_FragColor = vec4(sky, 1.0);
}
`;

/**
 * Per-season sky presets — keys MUST match `UIModule._setSeason`'s
 * `data-season` attribute (`night | dawn | day | dusk | gray`).
 *
 *   • day   — bright blue zenith, light-blue/green-grass-tinted horizon
 *   • dawn  — cool periwinkle zenith, warm peach horizon
 *   • dusk  — amber/orange (the "golden browns for autumn" look)
 *   • gray  — overcast: desaturated, low cloud contrast, no zenith blue
 *   • night — near-black blue, dark cool clouds, `nightAmount = 1`
 *             which adds the moonlight glow tint to cloud lit side and
 *             also gates star/moon/beam visibility (see setVisibility).
 */
const SEASON_SKY_PRESETS = Object.freeze({
  day: Object.freeze({
    zenith: [0.05, 0.38, 1.0],
    horizon: [0.62, 0.82, 0.92],
    cloud: [0.99, 0.995, 1.0],
    cloudShadow: [0.78, 0.84, 0.94],
    cloudIntensity: 1.0,
    nightAmount: 0.0,
  }),
  dawn: Object.freeze({
    zenith: [0.30, 0.36, 0.72],
    horizon: [1.0, 0.78, 0.62],
    cloud: [1.0, 0.92, 0.82],
    cloudShadow: [0.72, 0.62, 0.66],
    cloudIntensity: 0.95,
    nightAmount: 0.0,
  }),
  dusk: Object.freeze({
    // Golden-amber zenith fading to deep autumn-brown horizon. This is
    // the button the user described as "golden browns for autumn".
    zenith: [0.62, 0.36, 0.18],
    horizon: [0.92, 0.62, 0.30],
    cloud: [0.98, 0.78, 0.46],
    cloudShadow: [0.55, 0.30, 0.16],
    cloudIntensity: 0.85,
    nightAmount: 0.0,
  }),
  gray: Object.freeze({
    zenith: [0.62, 0.64, 0.66],
    horizon: [0.78, 0.78, 0.80],
    cloud: [0.85, 0.85, 0.86],
    cloudShadow: [0.55, 0.55, 0.58],
    cloudIntensity: 1.25,
    nightAmount: 0.0,
  }),
  night: Object.freeze({
    zenith: [0.012, 0.022, 0.060],
    horizon: [0.060, 0.055, 0.105],
    cloud: [0.18, 0.22, 0.30],
    cloudShadow: [0.04, 0.05, 0.08],
    cloudIntensity: 0.65,
    nightAmount: 1.0,
  }),
});

const MOON_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const MOON_FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform float phaseAng;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.001) discard;
  float zp = clamp(1.0 - r * r, 0.001, 1.0);
  vec3 N = normalize(vec3(p.xy, sqrt(zp)));

  float ang = phaseAng * 6.2831853;
  vec3 L = normalize(vec3(cos(ang), 0.05, sin(ang)));
  float lit = clamp(dot(N, L), 0.0, 1.0);

  vec3 lunar = vec3(0.95, 0.96, 0.92);
  lit = lit * lit * (3.0 - 2.0 * lit);

  vec3 rim = lunar * lit;
  float edge = smoothstep(0.86, 1.02, r);
  rim *= 1.0 - edge * 0.92;

  float alpha = smoothstep(1.06, 0.96, r) * (0.12 + lit * 0.88);

  float glow = smoothstep(0.95, 0.72, r) * (1.05 - lit) * 0.07;
  rim += glow * vec3(0.45, 0.55, 0.78);

  gl_FragColor = vec4(rim, alpha);
}
`;

function makeRayTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 112;
  canvas.height = 288;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createRadialGradient(56, 32, 1, 56, 158, 152);
  g.addColorStop(0, "rgba(235,242,255,0.78)");
  g.addColorStop(0.06, "rgba(210,228,255,0.45)");
  g.addColorStop(0.22, "rgba(185,210,255,0.2)");
  g.addColorStop(0.45, "rgba(160,195,255,0.08)");
  g.addColorStop(0.72, "rgba(120,170,255,0.03)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 112, 288);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * @param {THREE.Scene} scene
 * @param {THREE.PerspectiveCamera} camera
 */
export function attachWorldCelestial(scene) {
  let lunarManualIndex = null;
  let currentSeason = "day";

  const root = new THREE.Group();
  root.name = "SacredCelestial_Root";
  root.renderOrder = -8;

  const skyGeo = new THREE.SphereGeometry(SKY_RADIUS, 40, 20);
  const dayPreset = SEASON_SKY_PRESETS.day;
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uCameraPos: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uZenithColor: { value: new THREE.Color().fromArray(dayPreset.zenith) },
      uHorizonColor: { value: new THREE.Color().fromArray(dayPreset.horizon) },
      uCloudColor: { value: new THREE.Color().fromArray(dayPreset.cloud) },
      uCloudShadow: { value: new THREE.Color().fromArray(dayPreset.cloudShadow) },
      uCloudIntensity: { value: dayPreset.cloudIntensity },
      uNightAmount: { value: dayPreset.nightAmount },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    depthWrite: false,
    depthTest: false,
    fog: false,
    side: THREE.BackSide,
  });
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyDome.name = "SacredCelestial_SkyDome";
  skyDome.frustumCulled = false;

  const nightRoot = new THREE.Group();
  nightRoot.name = "SacredCelestial_Night";
  nightRoot.renderOrder = -7;

  const starPos = new Float32Array(STAR_COUNT * 3);
  const starRand = mulberry32(0xbeefcafe);
  let si = 0;
  let guard = 0;
  while (si < STAR_COUNT && guard < STAR_COUNT * 48) {
    guard++;
    const u = starRand();
    const v = starRand();
    const cosTheta = u;
    if (cosTheta < STAR_MIN_ELEV_COS) continue;
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const phi = Math.PI * 2 * v;
    const x = sinTheta * Math.cos(phi);
    const y = cosTheta;
    const z = sinTheta * Math.sin(phi);
    const b = si * 3;
    starPos[b] = STAR_RADIUS * x;
    starPos[b + 1] = STAR_RADIUS * y;
    starPos[b + 2] = STAR_RADIUS * z;
    si++;
  }
  while (si < STAR_COUNT) {
    const b = si * 3;
    starPos[b] = 0;
    starPos[b + 1] = STAR_RADIUS;
    starPos[b + 2] = 0;
    si++;
  }

  const starGeom = new THREE.BufferGeometry();
  starGeom.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xfff6e8,
    size: 0.2,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    depthTest: true,
    fog: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const stars = new THREE.Points(starGeom, starMat);
  stars.name = "SacredCelestial_Stars";
  stars.renderOrder = 0;
  stars.frustumCulled = false;

  const rayTex = makeRayTexture();
  const rayMatBase =
    rayTex &&
    new THREE.MeshBasicMaterial({
      map: rayTex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      side: THREE.DoubleSide,
    });

  const moonGeom = new THREE.CircleGeometry(26, 64);
  const moonMat = new THREE.ShaderMaterial({
    uniforms: { phaseAng: { value: 0.25 } },
    vertexShader: MOON_VERTEX,
    fragmentShader: MOON_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
    blending: THREE.NormalBlending,
  });
  const moonMesh = new THREE.Mesh(moonGeom, moonMat);
  moonMesh.name = "SacredCelestial_Moon";
  moonMesh.frustumCulled = false;
  moonMesh.renderOrder = 2;

  const raysGroup = new THREE.Group();
  raysGroup.name = "SacredCelestial_MoonRays";
  raysGroup.renderOrder = 1;
  if (rayMatBase) {
    // Beam plane count bumped 7 → 11 and beam geometry enlarged so the
    // moon casts the "slight moonbeams + clouds glowing a little from
    // the moon" feel the user spec'd. Beams are additive so doubling
    // count adds a soft halo without saturating.
    for (let i = -5; i <= 5; i++) {
      const rm = new THREE.Mesh(
        new THREE.PlaneGeometry(132, 340),
        rayMatBase.clone(),
      );
      rm.rotation.z = i * 0.18;
      rm.position.z = -8;
      rm.renderOrder = 1;
      raysGroup.add(rm);
    }
  }

  nightRoot.add(stars);
  nightRoot.add(moonMesh);
  nightRoot.add(raysGroup);

  root.add(skyDome);
  root.add(nightRoot);
  scene.add(root);

  const unsubLunar = subscribeInteraction(ANU_EVENTS.LUNAR_PHASE, (detail) => {
    if (detail && Object.prototype.hasOwnProperty.call(detail, "manualIndex")) {
      lunarManualIndex =
        detail.manualIndex == null ? null : Number(detail.manualIndex) & 7;
      if (currentSeason === "night") syncMoonPhaseUniform();
    }
  });

  /** Wire UIModule's 5 PiP season buttons (`data-season="..."`) directly
   *  into the sky shader — see `js/v2/UIModule.js#_setSeason`. */
  const unsubSeason = subscribeInteraction(ANU_EVENTS.SEASON_CHANGE, (detail) => {
    if (detail && typeof detail.season === "string") {
      applySeason(detail.season);
    }
  });

  function bucketForMoon() {
    return lunarPhaseSynodicIndex(new Date(), lunarManualIndex);
  }

  function syncMoonPhaseUniform() {
    const b = bucketForMoon();
    moonMat.uniforms.phaseAng.value = b / 8;
  }

  function applySeason(seasonKey) {
    const preset = SEASON_SKY_PRESETS[seasonKey];
    if (!preset) return;
    currentSeason = seasonKey;
    skyMat.uniforms.uZenithColor.value.fromArray(preset.zenith);
    skyMat.uniforms.uHorizonColor.value.fromArray(preset.horizon);
    skyMat.uniforms.uCloudColor.value.fromArray(preset.cloud);
    skyMat.uniforms.uCloudShadow.value.fromArray(preset.cloudShadow);
    skyMat.uniforms.uCloudIntensity.value = preset.cloudIntensity;
    skyMat.uniforms.uNightAmount.value = preset.nightAmount;
    /** Stars + moon disc + beams only at night (`nightAmount > 0`). The
     *  sky dome itself always renders — its uniforms now carry the
     *  dark-blue / starless gradient for every other season. */
    nightRoot.visible = preset.nightAmount > 0.5;
    if (nightRoot.visible) syncMoonPhaseUniform();
    /** Keep `scene.fog` (set up by World.js) tinted to match the horizon
     *  so distant terrain blends into the chosen atmosphere instead of
     *  fading into the previous season's cream-warm haze. World.js
     *  retains ownership of fog density; we only touch `.color`. */
    if (scene.fog && scene.fog.color) {
      scene.fog.color.fromArray(preset.horizon);
    }
  }

  applySeason(currentSeason);

  const api = {
    root,
    setSeason(season) {
      if (typeof season === "string") applySeason(season);
    },
    setLunarManual(manual) {
      lunarManualIndex = manual == null ? null : Number(manual) & 7;
      if (currentSeason === "night") syncMoonPhaseUniform();
    },
    update(cameraRef, delta) {
      skyMat.uniforms.uCameraPos.value.copy(cameraRef.position);
      skyMat.uniforms.uTime.value += delta;

      root.position.copy(cameraRef.position);

      if (nightRoot.visible) {
        moonMesh.position.copy(MOON_WORLD_DIR).multiplyScalar(MOON_DIST);
        moonMesh.lookAt(cameraRef.position);

        raysGroup.position.copy(MOON_WORLD_DIR).multiplyScalar(MOON_DIST * 0.72);
        raysGroup.lookAt(cameraRef.position);
        const t = skyMat.uniforms.uTime.value;
        raysGroup.rotateZ(t * 0.018);
      }
    },
    dispose(fromScene) {
      unsubLunar();
      unsubSeason();
      fromScene.remove(root);

      moonGeom.dispose();
      moonMat.dispose();
      starGeom.dispose();
      starMat.dispose();
      skyGeo.dispose();
      skyMat.dispose();
      raysGroup.children.forEach((ch) => {
        ch.geometry?.dispose();
        const m = ch.material;
        if (m) {
          m.map = null;
          m.dispose?.();
        }
      });
      if (rayMatBase) {
        rayMatBase.map = null;
        rayMatBase.dispose();
      }
      if (rayTex) rayTex.dispose();
    },
  };

  syncMoonPhaseUniform();

  return api;
}
