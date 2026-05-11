import * as THREE from "three";
import { V2_TIPI_BRAZIER_FIRE_LOCAL_Y_M } from "./constants.js";
import { ANU_SIMULATION_DOMAIN } from "./anu/SimulationController.js";

/**
 * Brazier hearth — WebGL point-sprite flame (additive) + flickering warm fill light.
 * Tuned for a small bowl brazier: tight core, turbulent tongues, ember tip.
 *
 * @param {object} cfg
 * @param {THREE.Scene}   cfg.scene
 * @param {object[]}      cfg.objects
 * @param {number}        cfg.x
 * @param {number}        cfg.y
 * @param {number}        cfg.z
 * @param {number}        [cfg.scale=1]            Uniform group scale (e.g. 0.3 for a small ceremonial flame).
 * @param {number}        [cfg.lightIntensity=0.85] Base PointLight intensity.
 * @param {number}        [cfg.lightDistance=3.4]   PointLight range in metres.
 * @param {string}        [cfg.anuIdOverride]       Optional anuId (defaults to environment.tipi_1.campfire).
 * @param {string}        [cfg.anuKindOverride]     Optional anuKind (defaults to tipi_campfire).
 * @param {string}        [cfg.nameOverride]        Optional THREE name.
 */
export function createTipiCampfire({
  scene,
  objects,
  x,
  y,
  z,
  scale = 1,
  lightIntensity = 0.85,
  lightDistance = 3.4,
  anuIdOverride,
  anuKindOverride,
  nameOverride,
}) {
  const group = new THREE.Group();
  group.name = nameOverride || "effect_tipi_campfire";
  group.position.set(x, y, z);
  if (scale !== 1) group.scale.setScalar(scale);
  group.userData.anuId = anuIdOverride || "environment.tipi_1.campfire";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  group.userData.anuKind = anuKindOverride || "tipi_campfire";

  const fy = V2_TIPI_BRAZIER_FIRE_LOCAL_Y_M;
  /** Warm fill — small range so the halo dies before painting the platform deck below the bowl. */
  const light = new THREE.PointLight(0xff7a30, lightIntensity, lightDistance, 2.2);
  light.position.set(0, fy + 0.18, 0);
  group.add(light);

  const uTime = { value: 0 };
  const uBaseY = { value: fy };
  const uFlicker = { value: 1 };

  const nFire = 280;
  const firePos = new Float32Array(nFire * 3);
  const fireSeed = new Float32Array(nFire * 2);
  for (let i = 0; i < nFire; i++) {
    const a = Math.random() * Math.PI * 2;
    const tier = Math.random();
    const r =
      tier < 0.55
        ? (0.0012 + Math.random() * 0.009) ** 2 * 52
        : (0.004 + Math.random() * 0.016) ** 2 * 38;
    firePos[i * 3] = Math.cos(a) * r;
    firePos[i * 3 + 1] =
      fy + Math.random() * 0.032 + tier * tier * 0.062 * (tier < 0.36 ? 1.35 : 0.2);
    firePos[i * 3 + 2] = Math.sin(a) * r;
    fireSeed[i * 2] = Math.random();
    fireSeed[i * 2 + 1] = Math.random();
  }
  const fireGeo = new THREE.BufferGeometry();
  fireGeo.setAttribute("position", new THREE.BufferAttribute(firePos, 3));
  fireGeo.setAttribute("seed", new THREE.BufferAttribute(fireSeed, 2));

  const fireMat = new THREE.ShaderMaterial({
    uniforms: { uTime, uBaseY, uFlicker },
    fog: false,
    vertexShader: `
      uniform float uTime;
      uniform float uBaseY;
      uniform float uFlicker;
      attribute vec2 seed;
      varying float vAlpha;
      varying vec3 vCol;
      varying float vNormLife;
      void main() {
        vec3 p = position;
        float s = seed.x;
        float sp = seed.y;
        float life = mod(uTime * (0.92 + s * 0.82) + sp * 19.713, 1.0);
        vNormLife = life;
        float lift = pow(life, 0.68);
        float tongue =
          sin(s * 40.1 + uTime * 9.2 + life * 14.5) *
          cos(sp * 33.4 + uTime * 7.1 + life * 11.2);
        float curl =
          sin(s * 31.7 + uTime * 7.35 + life * 9.8) *
          (0.018 + life * 0.032);
        float curlZ =
          cos(sp * 28.9 + uTime * 6.1 + life * 8.7) *
          (0.016 + life * 0.028);
        curl += tongue * 0.012 * (1.0 - lift);
        float base = uBaseY;
        p.y = mix(
          position.y - 0.038,
          base + lift * 0.52 + sin(uTime * 4.1 + s * 10.7) * 0.024,
          clamp(life + 0.09, 0.0, 1.0)
        );
        p.y += base * (1.0 - lift * 1.04);
        p.x += curl * (0.55 + lift * 0.95) + sin(uTime * 4.5 + sp * 14.9) * 0.011;
        p.z += curlZ * (0.55 + lift * 0.95) + cos(uTime * 3.4 + s * 12.4) * 0.011;
        float rndR = length(vec2(p.x, p.z));
        float widen = lift * lift * (0.12 + rndR * 1.9);
        float wx = 1.0 + widen * (0.95 + 0.12 * tongue);
        p.x *= wx;
        p.z *= wx;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float sz = mix(8.2, 1.25, clamp(lift * lift * 1.08 + 0.05, 0.0, 1.0));
        gl_PointSize = clamp(sz * uFlicker * (115.0 / max(-mv.z, 0.28)), 2.0, 26.0);
        float lum = clamp(1.0 - lift * 1.02, 0.0, 1.0);
        vAlpha = lum * lum * mix(0.48, 0.9, sqrt(1.0 - clamp(lift * 1.05, 0.0, 1.0)));
        vec3 cCore = vec3(1.0, 0.98, 0.72);
        vec3 cMid = vec3(1.0, 0.55, 0.12);
        vec3 cTip = vec3(0.85, 0.14, 0.02);
        if (lift < 0.14) {
          vCol = mix(cCore * 1.08, cMid, lift / 0.14);
        } else if (lift < 0.58) {
          vCol = mix(cMid, cTip * 1.12, (lift - 0.14) / 0.44);
        } else {
          vCol = mix(cTip * 1.08, vec3(0.12, 0.03, 0.01), (lift - 0.58) / 0.42);
        }
        vCol *= mix(0.92, 1.12, uFlicker);
      }
    `,
    fragmentShader: `
      uniform float uFlicker;
      varying float vAlpha;
      varying vec3 vCol;
      varying float vNormLife;
      void main() {
        vec2 q = gl_PointCoord - vec2(0.5);
        float d = length(q);
        if (d > 0.5) discard;
        float feather = smoothstep(0.5, 0.14, d);
        float hotspot = smoothstep(0.28, 0.0, d) * mix(1.12, 0.55, clamp(vNormLife * 2.5, 0.0, 1.0));
        vec3 col = vCol * (1.0 + hotspot * 0.45 * uFlicker);
        float a = vAlpha * feather * feather * (1.08 - d * d * 0.85);
        gl_FragColor = vec4(col, a);
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
  firePoints.name = "effect_tipi_campfire_points";
  firePoints.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  firePoints.userData.anuKind = "tipi_campfire_particles";
  firePoints.userData.anuId = `${group.userData.anuId}.particles`;
  group.add(firePoints);

  scene.add(group);
  objects.push(group);

  return {
    group,
    update(delta) {
      uTime.value += delta;
      const t = uTime.value;
      const f =
        0.82 +
        0.18 *
          (0.5 + 0.5 * Math.sin(t * 12.4)) *
          (0.5 + 0.5 * Math.sin(t * 7.8 + 1.1));
      const f2 = 0.9 + 0.1 * Math.sin(t * 19.7);
      uFlicker.value = f * f2;
      // Maintain the original 0.82/0.85 baseline ratio so a smaller
      // ceremonial flame (lightIntensity=0.25) still flickers at the
      // same proportional amplitude as the brazier hearth.
      light.intensity = lightIntensity * 0.965 * uFlicker.value;
      const warm = 0.5 + 0.08 * uFlicker.value;
      light.color.setRGB(1, 0.42 + 0.1 * uFlicker.value, warm * 0.28);
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
 * Tipi crown smoke — gray / white WebGL particles billowing from apex (smoke flap).
 */
export function createTipiSmokePlume({ scene, objects, x, y, z }) {
  const group = new THREE.Group();
  group.name = "effect_tipi_smoke_plume";
  group.position.set(x, y, z);
  group.userData.anuId = "environment.tipi_1.smoke_plume";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  group.userData.anuKind = "tipi_smoke";

  const uTime = { value: 0 };

  const nSmoke = 720;
  const smokePos = new Float32Array(nSmoke * 3);
  const smokeSeed = new Float32Array(nSmoke * 3);
  for (let i = 0; i < nSmoke; i++) {
    const a = Math.random() * Math.PI * 2;
    const tight = Math.random();
    const r =
      (0.008 + tight * tight * 0.092) * (0.45 + Math.random() * 0.55);
    smokePos[i * 3] = Math.cos(a) * r;
    smokePos[i * 3 + 1] = Math.random() * 0.06 + tight * tight * 0.038;
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
      varying float vLife;
      varying vec3 vSeed;
      void main() {
        vec3 p = position;
        float s0 = seed.x;
        float s1 = seed.y;
        float s2 = seed.z;
        float life = mod(uTime * (0.068 + s0 * 0.04) + s2 * 63.791, 1.0);
        vLife = life;
        float rise = life * (58.0 + s0 * 48.0);
        float widen = 0.18 + life * life * 5.2;
        float wobble =
          sin(uTime * 0.68 + s1 * 24.1 + rise * 0.05) * widen * 1.15 +
          sin(uTime * 0.31 + s2 * 17.3 + rise * 0.035) * widen * 0.68;
        float gust =
          cos(uTime * 0.48 + s0 * 20.1 + rise * 0.042) * widen * 1.12;
        float sway =
          sin(uTime * 0.26 + uTime * uTime * 0.012 + rise * 0.027 + s2 * 42.3) *
          widen *
          0.85;
        // Mild drift with prevailing direction (+Z) for outdoor billow
        float wind = life * life * (1.85 + s1 * 2.1);
        p.y = rise + p.y * 0.055;
        p.x += wobble + gust * 0.34;
        p.z += gust + sway + wind;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float sz = mix(32.0, 138.0, life * life * 0.68 + life * 0.32)
          * (0.88 + s1 * 0.34);
        gl_PointSize = clamp(sz * (180.0 / max(-mv.z, 0.3)), 12.0, 185.0);
        float fadeIn = smoothstep(0.0, 0.14, life);
        float fadeOut = 1.0 - smoothstep(0.36, 0.99, life);
        vAlpha =
          fadeIn * fadeOut * (0.5 + s2 * 0.42) *
          mix(1.08, 0.72, life * life);
        vSeed = seed;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      varying float vLife;
      varying vec3 vSeed;
      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float d = length(c);
        if (d > 0.5) discard;
        float core = smoothstep(0.5, 0.0, d);
        float billow =
          sin(dot(c * (6.5 + vSeed.x * 4.1), vec2(12.9898, 78.233))
            + vLife * 13.6 + vSeed.y * 6.283);
        float billow2 =
          cos(dot(c * 9.5 + vSeed.yz * 1.8, vec2(43.982, 9.891))
            + vLife * 10.1);
        float fluff =
          mix(0.68, 1.12, billow * 0.28 + billow2 * 0.17 + 0.78 * core);
        vec3 ash = vec3(0.58, 0.6, 0.64);
        vec3 mid = vec3(0.76, 0.78, 0.82);
        vec3 mist = vec3(0.94, 0.95, 0.98);
        float lum = smoothstep(0.0, 0.22, vLife);
        float white = smoothstep(0.25, 0.92, vLife);
        vec3 col = mix(ash, mid, lum);
        col = mix(col, mist, white * 0.92);
        col *= mix(1.02, 0.9, fluff * 0.22);
        float alpha = vAlpha * core * core * fluff * 0.98;
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
  smokePoints.name = "effect_tipi_smoke_points";
  smokePoints.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  smokePoints.userData.anuKind = "tipi_smoke_particles";
  smokePoints.userData.anuId = `${group.userData.anuId}.particles`;
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
