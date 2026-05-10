import * as THREE from "three";
import { V2_LAYER_TIPI_SMOKE_PIP_HIDDEN } from "./constants.js";
import { ANU_SIMULATION_DOMAIN } from "./anu/SimulationController.js";

/**
 * Small brazier fire — compact additive sparks + mild fill light (smoke vents only from tipi crown).
 * Uses depthTest (not read-through-foliage) so NPC/player occlude sparks.
 */
export function createTipiCampfire({ scene, objects, x, y, z }) {
  const group = new THREE.Group();
  group.name = "effect_tipi_campfire";
  group.position.set(x, y, z);
  group.userData.anuId = "environment.tipi_1.campfire";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  group.userData.anuKind = "tipi_campfire";

  const light = new THREE.PointLight(0xff6833, 0.32, 2.45, 2.2);
  light.position.set(0, 0.045, 0);
  group.add(light);

  const uTime = { value: 0 };

  const nFire = 90;
  const firePos = new Float32Array(nFire * 3);
  const fireSeed = new Float32Array(nFire);
  for (let i = 0; i < nFire; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = (0.004 + Math.random() * 0.026) * 1.05;
    firePos[i * 3] = Math.cos(a) * r;
    firePos[i * 3 + 1] = Math.random() * 0.1 + 0.02;
    firePos[i * 3 + 2] = Math.sin(a) * r;
    fireSeed[i] = Math.random();
  }
  const fireGeo = new THREE.BufferGeometry();
  fireGeo.setAttribute("position", new THREE.BufferAttribute(firePos, 3));
  fireGeo.setAttribute("seed", new THREE.BufferAttribute(fireSeed, 1));

  const fireMat = new THREE.ShaderMaterial({
    uniforms: { uTime },
    fog: false,
    vertexShader: `
      uniform float uTime;
      attribute float seed;
      varying float vAlpha;
      varying vec3 vCol;
      void main() {
        vec3 p = position;
        float curl = sin(seed * 38.0 + uTime * 6.2) * 0.012;
        float curl2 = cos(seed * 36.0 + uTime * 5.4) * 0.012;
        float life = mod(uTime * (1.35 + seed * 0.7) + seed * 18.9898, 1.0);
        p.y = life * 0.34 + p.y * 0.28;
        p.x += curl * (0.12 + life * 0.22);
        p.z += curl2 * (0.12 + life * 0.22);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float sz = mix(5.2, 1.4, life);
        gl_PointSize = clamp(sz * (95.0 / max(-mv.z, 0.35)), 1.2, 14.0);
        vAlpha = (1.0 - life * 0.98) * 0.48;
        vCol = mix(vec3(1.0, 0.38, 0.06), vec3(1.0, 0.62, 0.22), life);
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      varying vec3 vCol;
      void main() {
        vec2 q = gl_PointCoord - vec2(0.5);
        float d = length(q);
        if (d > 0.49) discard;
        float soft = smoothstep(0.49, 0.22, d);
        gl_FragColor = vec4(vCol, vAlpha * soft);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });

  const firePoints = new THREE.Points(fireGeo, fireMat);
  firePoints.frustumCulled = false;
  firePoints.renderOrder = 10;
  group.add(firePoints);

  scene.add(group);
  objects.push(group);

  return {
    group,
    update(delta) {
      uTime.value += delta;
    },
    dispose() {
      scene.remove(group);
      const idx = objects.indexOf(group);
      if (idx >= 0) objects.splice(idx, 1);
      fireGeo.dispose();
      fireMat.dispose();
    },
  };
}

/**
 * Crown smoke — darker gray-white; ignores scene fog so it stays readable.
 */
export function createTipiSmokePlume({ scene, objects, x, y, z }) {
  const group = new THREE.Group();
  group.name = "effect_tipi_smoke_plume";
  group.position.set(x, y, z);
  group.userData.anuId = "environment.tipi_1.smoke_plume";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  group.userData.anuKind = "tipi_smoke";

  const uTime = { value: 0 };

  const nSmoke = 320;
  const smokePos = new Float32Array(nSmoke * 3);
  const smokeSeed = new Float32Array(nSmoke * 3);
  for (let i = 0; i < nSmoke; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = (0.02 + Math.random() * 0.11) * (0.72 + Math.random() * 0.48);
    smokePos[i * 3] = Math.cos(a) * r;
    smokePos[i * 3 + 1] = Math.random() * 0.14;
    smokePos[i * 3 + 2] = Math.sin(a) * r;
    smokeSeed[i * 3] = Math.random();
    smokeSeed[i * 3 + 1] = Math.random();
    smokeSeed[i * 3 + 2] = Math.random();
  }
  const smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute("position", new THREE.BufferAttribute(smokePos, 3));
  smokeGeo.setAttribute("seed", new THREE.BufferAttribute(smokeSeed, 3));

  const smokeMat = new THREE.ShaderMaterial({
    uniforms: { uTime },
    fog: false,
    vertexShader: `
      uniform float uTime;
      attribute vec3 seed;
      varying float vAlpha;
      varying float vHeight;
      varying vec3 vSeed;
      void main() {
        vec3 p = position;
        float s0 = seed.x;
        float s1 = seed.y;
        float s2 = seed.z;
        float life = mod(uTime * (0.13 + s0 * 0.07) + s2 * 71.3, 1.0);
        float rise = life * (24.0 + s0 * 16.0);
        float widen = 0.26 + life * 3.05;
        float wobble =
          sin(uTime * 0.58 + s1 * 17.0 + rise * 0.07) * widen +
          sin(uTime * 0.31 + s2 * 11.0 + rise * 0.04) * widen * 0.55;
        float drift =
          cos(uTime * 0.47 + s0 * 13.0 + rise * 0.055) * widen * 0.92;
        p.y = rise + p.y * 0.08;
        p.x += wobble;
        p.z += drift;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float sz = mix(24.0, 78.0, life) * (0.88 + s1 * 0.24);
        gl_PointSize = clamp(sz * (155.0 / max(-mv.z, 0.35)), 8.0, 128.0);
        float fadeIn = smoothstep(0.0, 0.1, life);
        float fadeOut = 1.0 - smoothstep(0.68, 1.0, life);
        vAlpha = fadeIn * fadeOut * (0.58 + s2 * 0.32);
        vHeight = life;
        vSeed = seed;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      varying float vHeight;
      varying vec3 vSeed;
      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float d = length(c);
        if (d > 0.5) discard;
        float core = smoothstep(0.48, 0.0, d);
        float n1 = sin(dot(c * 5.5 + vSeed.xy, vec2(12.9898, 78.233)) + vSeed.z * 6.28);
        float n2 = cos(dot(c * 9.2 + vSeed.yz, vec2(39.346, 11.135)) + vHeight * 8.0);
        float billow = mix(0.78, 1.0, 0.5 + 0.5 * n1) * mix(0.88, 1.06, 0.5 + 0.5 * n2);
        vec3 lo = vec3(0.48, 0.49, 0.53);
        vec3 hi = vec3(0.68, 0.69, 0.73);
        vec3 col = mix(lo, hi, vHeight);
        float alpha = vAlpha * core * core * billow * (0.9 + 0.1 * core);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
  });

  const smokePoints = new THREE.Points(smokeGeo, smokeMat);
  smokePoints.frustumCulled = false;
  smokePoints.renderOrder = 4;
  smokePoints.layers.set(V2_LAYER_TIPI_SMOKE_PIP_HIDDEN);
  group.add(smokePoints);

  scene.add(group);
  objects.push(group);

  return {
    group,
    update(delta) {
      uTime.value += delta;
    },
    dispose() {
      scene.remove(group);
      const idx = objects.indexOf(group);
      if (idx >= 0) objects.splice(idx, 1);
      smokeGeo.dispose();
      smokeMat.dispose();
    },
  };
}
