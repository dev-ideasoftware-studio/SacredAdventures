/**
 * Main-view celestial: procedural bright day sky + distant volumetric-style clouds;
 * night = additive starfield, synodic moon disc (matches PiP phase), additive moon beams.
 * Root follows camera; materials fog:false so world fog stays on terrain only.
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

const MOON_WORLD_DIR = new THREE.Vector3(0.42, 0.5, -0.76).normalize();

function mulberry32(seed) {
  return function rng() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shader snippets are compiled by Three.js with a prelude (uniforms/attributes); not standalone GLSL. */
const DAY_VERTEX = `
varying vec3 vWorldPos;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorldPos = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const DAY_FRAGMENT = `
precision highp float;
varying vec3 vWorldPos;
uniform vec3 uCameraPos;
uniform float uTime;

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

  vec3 zenith = vec3(0.05, 0.38, 1.0);
  vec3 horizon = vec3(0.58, 0.78, 1.0);
  vec3 sky = mix(zenith, horizon, pow(1.0 - h, 1.55));

  vec2 cloudUv = rd.xz / max(0.09, rd.y) * 0.38;
  cloudUv += uTime * vec2(0.012, 0.006);
  float n1 = fbm(cloudUv);
  float n2 = fbm(cloudUv * 1.85 - uTime * vec2(0.008, 0.011));
  float layer = smoothstep(0.04, 0.65, rd.y);
  float wisp = clamp((n1 * 0.58 + n2 * 0.42 - 0.36) * 3.9 * layer, 0.0, 1.0);
  vec3 cloudWhite = vec3(0.99, 0.995, 1.0);
  vec3 cloudShadow = sky * vec3(0.88, 0.9, 0.98);
  vec3 cloudy = mix(cloudShadow, cloudWhite, wisp);
  float blend = wisp * smoothstep(0.0, 0.18, rd.y) * smoothstep(-0.04, 0.1, rd.y);
  sky = mix(sky, cloudy, clamp(blend * 0.94, 0.0, 1.0));

  gl_FragColor = vec4(sky, 1.0);
}
`;

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

  const dayGeo = new THREE.SphereGeometry(SKY_RADIUS, 40, 20);
  const daySkyMat = new THREE.ShaderMaterial({
    uniforms: {
      uCameraPos: { value: new THREE.Vector3() },
      uTime: { value: 0 },
    },
    vertexShader: DAY_VERTEX,
    fragmentShader: DAY_FRAGMENT,
    depthWrite: false,
    depthTest: false,
    fog: false,
    side: THREE.BackSide,
  });
  const daySky = new THREE.Mesh(dayGeo, daySkyMat);
  daySky.name = "SacredCelestial_DaySky";
  daySky.frustumCulled = false;

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
    for (let i = -3; i <= 3; i++) {
      const rm = new THREE.Mesh(
        new THREE.PlaneGeometry(102, 270),
        rayMatBase.clone(),
      );
      rm.rotation.z = i * 0.22;
      rm.position.z = -8;
      rm.renderOrder = 1;
      raysGroup.add(rm);
    }
  }

  nightRoot.add(stars);
  nightRoot.add(moonMesh);
  nightRoot.add(raysGroup);

  root.add(daySky);
  root.add(nightRoot);
  scene.add(root);

  const unsubLunar = subscribeInteraction(ANU_EVENTS.LUNAR_PHASE, (detail) => {
    if (detail && Object.prototype.hasOwnProperty.call(detail, "manualIndex")) {
      lunarManualIndex =
        detail.manualIndex == null ? null : Number(detail.manualIndex) & 7;
      if (currentSeason === "night") syncMoonPhaseUniform();
    }
  });

  function bucketForMoon() {
    return lunarPhaseSynodicIndex(new Date(), lunarManualIndex);
  }

  function syncMoonPhaseUniform() {
    const b = bucketForMoon();
    moonMat.uniforms.phaseAng.value = b / 8;
  }

  function setVisibility() {
    const dayOn = currentSeason === "day";
    daySky.visible = dayOn;
    nightRoot.visible = currentSeason === "night";
    if (currentSeason === "night") {
      syncMoonPhaseUniform();
    }
  }

  setVisibility();

  const api = {
    root,
    setSeason(season) {
      if (typeof season === "string") currentSeason = season;
      setVisibility();
    },
    setLunarManual(manual) {
      lunarManualIndex = manual == null ? null : Number(manual) & 7;
      if (currentSeason === "night") syncMoonPhaseUniform();
    },
    update(cameraRef, delta) {
      daySkyMat.uniforms.uCameraPos.value.copy(cameraRef.position);
      daySkyMat.uniforms.uTime.value += delta;

      root.position.copy(cameraRef.position);

      if (nightRoot.visible) {
        moonMesh.position.copy(MOON_WORLD_DIR).multiplyScalar(MOON_DIST);
        moonMesh.lookAt(cameraRef.position);

        raysGroup.position.copy(MOON_WORLD_DIR).multiplyScalar(MOON_DIST * 0.72);
        raysGroup.lookAt(cameraRef.position);
        const t = daySkyMat.uniforms.uTime.value;
        raysGroup.rotateZ(t * 0.018);
      }
    },
    dispose(fromScene) {
      unsubLunar();
      fromScene.remove(root);

      moonGeom.dispose();
      moonMat.dispose();
      starGeom.dispose();
      starMat.dispose();
      dayGeo.dispose();
      daySkyMat.dispose();
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
