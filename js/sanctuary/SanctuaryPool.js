/**
 * Sacred Adventures — sanctuary part 2 of 5: THE POOL.
 *
 * The centrepiece. A sacred dark-water pool with organic edges. Anu
 * domain: ENVIRONMENT (water itself isn't a structure; it's part of
 * the ground-and-atmosphere that bodies must obey).
 *
 * Pieces:
 *   • Water surface  — CircleGeometry, 48 segments, animated 3-wave
 *                       ripple shader. Sits at `groundY(center) +
 *                       WATER_DROP_M`. Transparent at 0.62 so the fish
 *                       and bowl floor read through cleanly.
 *   • Basin floor    — second darker disc just under the water, gives
 *                       the pool a sense of depth (the carved terrain
 *                       under it is mostly hidden).
 *   • Lily pads      — 14 instanced low-poly discs scattered across the
 *                       surface, with small gold lily flowers on some.
 *   • Mossy rim      — narrow ring around the water edge in dark moss
 *                       green, hides the seam between water and bank.
 *
 * Triangle target: ≤ 4 k. Achieved: water 96 tris + basin 96 +
 * 14 lily-pad instances × ~16 = 224 + rim 96 ≈ ~510 tris. Plenty of
 * headroom.
 */

import * as THREE from "three";
import { STRESS_LEVELS, getSystemStressLevel } from "../v2/anu/FrameBudget.js";
import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";
import { SanctuarySceneConstructor } from "./SanctuarySceneConstructor.js";
import {
  SANCTUARY_POOL_CENTER_X,
  SANCTUARY_POOL_CENTER_Z,
  SANCTUARY_POOL_RADIUS_M,
  SANCTUARY_POOL_DEPTH_M,
  SANCTUARY_WATER_DROP_M,
  sanctuaryGroundY,
} from "./SanctuaryGround.js";

/** Cached uniforms — one shared `uTime` so all wave-driven surfaces tick together. */
const _poolTimeUniform = { value: 0 };

function organicRimRadius(angle) {
  return (
    SANCTUARY_POOL_RADIUS_M *
    (0.97 + 0.03 * Math.sin(angle * 2.2 + 0.7) + 0.02 * Math.cos(angle * 5.1 - 1.4))
  );
}

async function loadPoolTextures() {
  const loader = new THREE.TextureLoader();
  const [normal, caustics] = await Promise.all([
    SanctuarySceneConstructor.loadTexture(loader, 'textures/water_normal.png', 'water_normal'),
    SanctuarySceneConstructor.loadTexture(loader, 'textures/water_caustics.png', 'water_caustics')
  ]);

  normal.wrapS = THREE.RepeatWrapping;
  normal.wrapT = THREE.RepeatWrapping;
  caustics.wrapS = THREE.RepeatWrapping;
  caustics.wrapT = THREE.RepeatWrapping;

  return { normal, caustics };
}

function buildWaterSurface(centerY, textures) {
  const segs = 48;
  const phiSegs = 8;
  const geo = new THREE.CircleGeometry(SANCTUARY_POOL_RADIUS_M * 0.97, segs, phiSegs);
  
  // Jitter the rim verts to an organic perimeter so the waterline reads
  // natural instead of perfectly circular, scaling proportionally for concentric rings.
  const pos = geo.attributes.position;
  const baseR = SANCTUARY_POOL_RADIUS_M * 0.97;
  for (let i = 1; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const dist = Math.hypot(x, y);
    const frac = dist / baseR;
    const a = Math.atan2(y, x);
    const r = organicRimRadius(a) * 0.97 * frac;
    pos.setXY(i, Math.cos(a) * r, Math.sin(a) * r);
  }
  geo.computeVertexNormals();

  // Water tint — May-25 2026 user spec: "darken the water 10% more
  // greenish-blue water with soft waves as a pond would have".
  // Base hex 0x0c3a36 (deep teal) → 0x0a3438 (10 % darker, slight blue
  // shift), emissive 0x051d1c → 0x042022 (matches the darker base).
  // Specular reflection is refined with softer roughness/metalness so the
  // deep green watercolor and active morphing caustics read beautifully.
  // May-27 2026 user fix: opacity 0.45 → 0.28 + emissive 0.18 → 0.10 so
  // the sandy basin texture + 745 instanced rocks/pebbles actually read
  // through from above. With 45% opacity over a saturated green tint the
  // surface was painting solid grass-green from top-down view and hiding
  // every underwater detail. Caustics + Gerstner waves untouched.
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x0a3438),
    emissive: new THREE.Color(0x042022),
    emissiveIntensity: 0.10,
    roughness: 0.22,            // softer, more natural water reflections instead of a hard glass panel
    metalness: 0.15,            // lower metalness so the deep green water and morphing caustics read beautifully
    normalMap: textures.normal,
    transparent: true,
    opacity: 0.28,              // reduced so sandy basin + rocks/pebbles read through clearly from above
    depthWrite: false,
    side: THREE.DoubleSide,
    defines: { USE_UV: "" },
  });

  mat.userData.uCausticsMapRef = textures.caustics;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = _poolTimeUniform;
    shader.uniforms.uNormalMap = { value: textures.normal };
    shader.uniforms.uCausticsMap = { value: textures.caustics };
    mat.userData.uTimeRef = _poolTimeUniform;

    // Declare uTime in both vertex and fragment shaders
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
      uniform float uTime;
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
      uniform float uTime;
      uniform sampler2D uNormalMap;
      uniform sampler2D uCausticsMap;
      `
    );

    // Concentric ripples expanding outward from the pool centre — replaces
    // the previous two directional Gerstner waves (NE + NW) that read as
    // diagonal "sideways" stripes from the rim. Per user 2026-05-28:
    // "remove sideways ripples in pool, add more of the same surface
    // ripples like the fishing gauge has around it". Two summed radial
    // sin waves at different frequencies give a richer interference
    // pattern than a single ring while still reading as concentric.
    // No horizontal displacement — radial Gerstner crowding would distort
    // the rim, and the pond is too small for the look to pay off.
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `
      #include <begin_vertex>

      float time = uTime;
      float vDist = length(uv - vec2(0.5));
      float shoreFade = smoothstep(0.48, 0.35, vDist);

      // Two concentric ripples expanding from pool centre (vUv 0.5,0.5)
      float phase1 = vDist * 22.0 - time * 0.32;
      float z1 = sin(phase1) * 0.005;

      float phase2 = vDist * 36.0 - time * 0.45;
      float z2 = sin(phase2) * 0.003;

      transformed.z += (z1 + z2) * shoreFade;
      `
    );

    // Replace the standard normal map texture lookup with our dual-scrolling blend!
    // Scrolling speeds tuned for a realistic pond feel, with stretched mapping so it's not swirly
    shader.fragmentShader = shader.fragmentShader.replace(
      "texture2D( normalMap, vNormalMapUv ).xyz",
      `normalize(
        (texture2D( uNormalMap, vUv * 2.5 + vec2(uTime * 0.005, uTime * 0.004) ).xyz * 2.0 - 1.0) +
        (texture2D( uNormalMap, vUv * 2.5 - vec2(uTime * 0.004, -uTime * 0.005) ).xyz * 2.0 - 1.0)
      ) * 0.5 + 0.5`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `
      #include <map_fragment>
      
      float time = uTime;
      float distToCenter = length(vUv - vec2(0.5));
      float shorelineFade = smoothstep(0.48, 0.35, distToCenter); // 1 inside, 0 at edge
      
      // Sample two scrolling normal maps at different frequencies (stretched mapping)
      vec2 flow1 = vec2(time * 0.008, time * 0.0066);
      vec2 flow2 = vec2(-time * 0.0066, time * 0.008);
      
      vec3 norm1 = texture2D(uNormalMap, vUv * 2.0 + flow1).xyz * 2.0 - 1.0;
      vec3 norm2 = texture2D(uNormalMap, vUv * 2.5 + flow2).xyz * 2.0 - 1.0;
      vec2 nOffset = (norm1.xy + norm2.xy) * 0.010; // Extremely gentle refraction to prevent swirly artifacts
      
      // Dynamic morphing caustics: Layer 1 (scrolls North-East, heavily warped)
      vec2 uv1 = vUv * 1.5 + nOffset + vec2(time * 0.004, time * 0.003);
      uv1.x += sin(uv1.y * 5.5 + time * 0.15) * 0.15;
      uv1.y += cos(uv1.x * 4.8 - time * 0.12) * 0.12;
      float c1 = texture2D(uCausticsMap, uv1).r;
      
      // Dynamic morphing caustics: Layer 2 (scrolls South-West)
      vec2 uv2 = vUv * 1.8 - nOffset - vec2(time * 0.0032, -time * 0.004);
      uv2.x += cos(uv2.y * 6.2 - time * 0.12) * 0.13;
      uv2.y += sin(uv2.x * 5.5 + time * 0.15) * 0.14;
      float c2 = texture2D(uCausticsMap, uv2).r;
      
      // Blend using minimum and scale up to form rich, dynamic, morphing bioluminescent webs
      float causticsVal = min(c1, c2) * 2.2;
      
      // Add a shimmering pulse to caustics brightness over time
      float shimmer = 0.88 + 0.12 * sin(time * 0.2);
      causticsVal *= shimmer;
      
      // Concentric color ripples — same radial pattern as the vertex
      // displacement so the surface shimmer reads as expanding rings
      // from the pool centre instead of diagonal stripes.
      float dist = length(vUv - vec2(0.5));
      float ring1 = sin(dist * 36.0 - time * 0.45);
      float ring2 = sin(dist * 22.0 - time * 0.30);
      float ripple = (ring1 + ring2) * 0.5;

      // Color tuning: greenish-blue pond water, but desaturated ~25% from
      // the previous mossy-emerald palette so the underwater sandy basin
      // and gravel/rock detail can read through the 0.28-opacity surface.
      // Blue channel slightly elevated to push toward "natural pond water"
      // rather than "algae-green pool".
      vec3 deepColor = mix(vec3(0.012, 0.10, 0.11), vec3(0.022, 0.14, 0.16), 0.5 + ripple * 0.10);
      vec3 shallowColor = mix(vec3(0.04, 0.18, 0.20), vec3(0.09, 0.28, 0.30), 0.5 + ripple * 0.10);
      vec3 baseWaterColor = mix(deepColor, shallowColor, smoothstep(0.1, 0.5, distToCenter));
      
      // Caustic highlight blending — vibrant, soft bioluminescent teal glow
      vec3 causticHighlight = vec3(0.35, 0.98, 0.90) * causticsVal * 0.65 * shorelineFade;
      
      diffuseColor.rgb = baseWaterColor + causticHighlight;
      `
    );
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(SANCTUARY_POOL_CENTER_X, centerY, SANCTUARY_POOL_CENTER_Z);
  mesh.renderOrder = 4;
  mesh.layers.enable(1); // Show in PiP minimap
  mesh.layers.enable(2); // Show in fishing PIP fish-finder lens (gauge removed from layer 2 — backdrop for fish view)
  mesh.name = "sanctuary_pool_water";
  mesh.userData.anuId = "environment.sanctuary.pool.water";
  mesh.userData.anuKind = "sanctuary_pool_water";
  mesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  return mesh;
}

/**
 * Procedural sandy/dirty pond-floor texture (canvas-baked).
 * Returns map + bumpMap + roughnessMap — three textures sharing the same
 * canvas so light catches micro-relief and the basin reads as silt + sand
 * with darker dirt streaks, not a flat painted disc.
 */
function _makeBasinFloorTexture() {
  const SZ = 1024;
  const cv = document.createElement("canvas");
  cv.width = SZ; cv.height = SZ;
  const ctx = cv.getContext("2d");

  // Darker greenish-brown silt base
  ctx.fillStyle = "#1e2216";
  ctx.fillRect(0, 0, SZ, SZ);

  const cx = SZ / 2, cy = SZ / 2;

  // DARK SILT CENTER — soft radial patch of settled deeper sediment.
  // Real ponds darken toward the deep middle, not the shallow rim.
  // Reaches ~60% of the disc with a smooth falloff.
  const darkCenter = ctx.createRadialGradient(cx, cy, 0, cx, cy, SZ * 0.42);
  darkCenter.addColorStop(0.00, "rgba(10, 12, 8, 0.90)");
  darkCenter.addColorStop(0.45, "rgba(18, 20, 14, 0.65)");
  darkCenter.addColorStop(1.00, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = darkCenter;
  ctx.beginPath(); ctx.arc(cx, cy, SZ * 0.42, 0, Math.PI * 2); ctx.fill();

  // Low-frequency silt blobs — lighter alpha so they read as variance not patches.
  // Dark organic mud/moss tones.
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * SZ;
    const y = Math.random() * SZ;
    const r = 60 + Math.random() * 180;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = Math.random() < 0.5;
    grad.addColorStop(0, dark ? "rgba(12, 14, 10, 0.35)" : "rgba(45, 48, 35, 0.30)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  // Sandy noise grains (high-freq, all sand/tan/brown — zero green hue)
  for (let i = 0; i < 16000; i++) {
    const x = Math.random() * SZ;
    const y = Math.random() * SZ;
    const sz = 1 + Math.random() * 2;
    const tan = Math.random();
    ctx.fillStyle = tan < 0.45 ? "rgba(190, 158, 108, 0.22)"
                  : tan < 0.78 ? "rgba(132, 100, 65, 0.20)"
                  : tan < 0.92 ? "rgba(90, 68, 42, 0.24)"
                  :              "rgba(50, 36, 22, 0.28)";
    ctx.fillRect(x, y, sz, sz);
  }

  // Dirt streaks (sediment currents) — softer alpha so they don't read as scratches
  ctx.strokeStyle = "rgba(20, 14, 8, 0.12)";
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 22; i++) {
    const y0 = Math.random() * SZ;
    const amp = 8 + Math.random() * 18;
    const freq = 0.005 + Math.random() * 0.01;
    const phase = Math.random() * Math.PI * 2;
    ctx.beginPath();
    for (let x = 0; x < SZ; x += 4) {
      const y = y0 + Math.sin(x * freq + phase) * amp;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Dense gravel speckling (2000 specks, varied sizes + shades — sells "natural gravel")
  for (let i = 0; i < 2000; i++) {
    const x = Math.random() * SZ;
    const y = Math.random() * SZ;
    const r = 1 + Math.random() * 3.5;
    const tier = Math.random();
    // Mixed grays/browns/mossy greens
    let fill;
    if (tier < 0.35) {
      const s = 25 + Math.floor(Math.random() * 35);
      fill = `rgba(${s - 10}, ${s - 4}, ${s - 20}, 0.55)`;     // mossy dark gravel
    } else if (tier < 0.70) {
      const s = 70 + Math.floor(Math.random() * 30);
      fill = `rgba(${s - 15}, ${s - 10}, ${s - 30}, 0.50)`;    // greenish brown pebble
    } else {
      const s = 120 + Math.floor(Math.random() * 40);
      fill = `rgba(${s - 25}, ${s - 20}, ${s - 45}, 0.45)`;    // light mossy pebble
    }
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  // VERY subtle outer dim — barely there, just so the rim doesn't read as
  // brighter than the dark center. NOT a black ring like before.
  const edge = ctx.createRadialGradient(cx, cy, SZ * 0.40, cx, cy, SZ * 0.50);
  edge.addColorStop(0, "rgba(0,0,0,0)");
  edge.addColorStop(1.0, "rgba(15, 10, 6, 0.18)");
  ctx.fillStyle = edge;
  ctx.beginPath(); ctx.arc(cx, cy, SZ / 2, 0, Math.PI * 2); ctx.fill();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * Single datum for the basin-floor bowl, shared by the floor mesh, the
 * drain, and swimming frogs so they never drift apart (scaffold O1).
 *
 * The sand drapes the quartic terrain bowl underwater, but is CLAMPED to
 * just under the waterline so it never pokes ABOVE the water (the old
 * "sand at the rim" bug). Above the waterline the shore BANK (terrain)
 * shows — that is correct pond behaviour.
 */
export function basinFloorYAt(r, waterY) {
  const wY = (typeof waterY === "number")
    ? waterY
    : (typeof window !== "undefined" && Number.isFinite(window.__sanctuaryWaterY) ? window.__sanctuaryWaterY : -0.6);
  const inner = Math.min(1, r / SANCTUARY_POOL_RADIUS_M);
  const bowl = 1 - inner * inner;
  const draped = -SANCTUARY_POOL_DEPTH_M * bowl + 0.02; // sand draped on the bowl
  return Math.min(draped, wY - 0.03);                   // never above the waterline
}

function buildBasinFloor(centerY) {
  // BOWL-SHAPED basin floor — 2026-05-28: was a flat disc at -1.0 m which
  // sat well below the bowl-shaped terrain carve, exposing the grass-
  // textured terrain mesh as the visible "pool wall". The user reported
  // the grass texture showing underwater at the rim. Fix: sculpt the
  // disc to follow the same quartic bowl curve as the terrain so the
  // sand texture drapes over the entire bowl slope, hiding the grass.
  const RADIUS = SANCTUARY_POOL_RADIUS_M * 0.96;
  const SEGS = 96;
  const RINGS = 24;
  const geo = new THREE.CircleGeometry(RADIUS, SEGS, 0, Math.PI * 2);
  // CircleGeometry has 1 center vertex + (segs+1) rim vertices. To get a
  // properly tessellated bowl we need more rings, so build a ring-based
  // disc manually instead.
  const positions = [];
  const indices = [];
  const uvs = [];
  // Sand drapes the bowl but is CLAMPED to just under the waterline
  // (centerY = waterY) so it never pokes ABOVE the water — the recurring
  // "sand at the rim" bug. Above the waterline the shore bank (terrain)
  // shows, which is correct. mesh.position.y is now 0 (offset baked here).
  const SAND_CLAMP_Z = centerY - 0.03;
  positions.push(0, 0, Math.min(-SANCTUARY_POOL_DEPTH_M + 0.02, SAND_CLAMP_Z));  // centre vertex
  uvs.push(0.5, 0.5);
  for (let ring = 1; ring <= RINGS; ring++) {
    const ringR = (ring / RINGS) * RADIUS;
    const inner = ringR / SANCTUARY_POOL_RADIUS_M;
    const bowl = 1 - inner * inner;     // quadratic — matches terrain
    const localZ = Math.min(-SANCTUARY_POOL_DEPTH_M * bowl + 0.02, SAND_CLAMP_Z); // draped, clamped under water
    for (let i = 0; i <= SEGS; i++) {
      const theta = (i / SEGS) * Math.PI * 2;
      const x = Math.cos(theta) * ringR;
      const y = Math.sin(theta) * ringR;
      positions.push(x, y, localZ);
      uvs.push(0.5 + x / (RADIUS * 2), 0.5 + y / (RADIUS * 2));
    }
  }
  // Triangulate: centre → ring 1 fan, then ring-to-ring strips.
  for (let i = 0; i < SEGS; i++) {
    indices.push(0, 1 + i, 1 + i + 1);
  }
  for (let ring = 1; ring < RINGS; ring++) {
    const rowA = 1 + (ring - 1) * (SEGS + 1);
    const rowB = 1 + ring * (SEGS + 1);
    for (let i = 0; i < SEGS; i++) {
      indices.push(rowA + i, rowB + i, rowB + i + 1);
      indices.push(rowA + i, rowB + i + 1, rowA + i + 1);
    }
  }
  const sculpted = new THREE.BufferGeometry();
  sculpted.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  sculpted.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  sculpted.setIndex(indices);
  sculpted.computeVertexNormals();
  geo.dispose();

  const floorTex = _makeBasinFloorTexture();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: floorTex,
    bumpMap: floorTex,
    bumpScale: 0.06,
    roughnessMap: floorTex,
    roughness: 0.95,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(sculpted, mat);
  mesh.rotation.x = -Math.PI / 2;
  // After the X-rotation, local z maps to world Y. The per-vertex clamp
  // (SAND_CLAMP_Z) already encodes the absolute world Y of every sand
  // vertex, so the mesh origin sits at 0 (no extra offset).
  mesh.position.set(
    SANCTUARY_POOL_CENTER_X,
    0,
    SANCTUARY_POOL_CENTER_Z,
  );
  mesh.receiveShadow = true;
  mesh.layers.enable(1); // Show in PiP minimap
  mesh.layers.enable(2); // Show in fishing PIP fish-finder lens — backdrop for the fish view (gauge removed from layer 2)
  mesh.name = "sanctuary_pool_basin_floor";
  mesh.userData.anuId = "environment.sanctuary.pool.basin_floor";
  mesh.userData.anuKind = "sanctuary_pool_basin_floor";
  mesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  return mesh;
}

function buildDrainHole(centerY) {
  const group = new THREE.Group();
  group.name = "sanctuary_pool_drain_hole";
  group.userData.anuKind = "sanctuary_pool_drain_hole";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;

  // Sits at the bottom center of the carved pool basin
  const y = centerY - SANCTUARY_POOL_DEPTH_M + 0.005; // Elevated a tiny bit to prevent z-fighting with basin floor

  // Outer bronze rustic ring
  const ringGeo = new THREE.RingGeometry(0.35, 0.45, 32);
  const ringMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x4a3a2a), // dark rustic bronze/stone
    roughness: 0.85,
    metalness: 0.7,
    flatShading: true,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.position.set(SANCTUARY_POOL_CENTER_X, y, SANCTUARY_POOL_CENTER_Z);
  ringMesh.receiveShadow = true;
  ringMesh.userData.anuKind = "sanctuary_pool_drain_ring";
  ringMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  group.add(ringMesh);

  // Inner deep obsidian black disc
  const holeGeo = new THREE.CircleGeometry(0.35, 32);
  const holeMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x010305), // deep black hole
    roughness: 1.0,
    metalness: 0.05,
  });
  const holeMesh = new THREE.Mesh(holeGeo, holeMat);
  holeMesh.rotation.x = -Math.PI / 2;
  holeMesh.position.set(SANCTUARY_POOL_CENTER_X, y + 0.001, SANCTUARY_POOL_CENTER_Z);
  holeMesh.receiveShadow = true;
  holeMesh.userData.anuKind = "sanctuary_pool_drain_depth";
  holeMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  group.add(holeMesh);

  return group;
}

/**
 * UNUSED — kept only because removing it would conflict with another
 * pending diff from the parallel editor. Not called from anywhere.
 * @deprecated turtle shellMat now uses a plain color in buildTurtle().
 */
function _makeTurtleShellTexture() {
  const SZ = 512;
  const cv = document.createElement("canvas");
  cv.width = SZ; cv.height = SZ;
  const ctx = cv.getContext("2d");
  const cx = SZ / 2, cy = SZ / 2;

  // Base shell color — deep muddy green-brown blend
  ctx.fillStyle = "#1e2b14";
  ctx.fillRect(0, 0, SZ, SZ);

  // Add earthy, sandy noise background
  for (let i = 0; i < 4000; i++) {
    const rx = Math.random() * SZ;
    const ry = Math.random() * SZ;
    const size = 1 + Math.random() * 2;
    ctx.fillStyle = Math.random() < 0.5 ? "rgba(35, 25, 15, 0.15)" : "rgba(42, 60, 28, 0.15)";
    ctx.fillRect(rx, ry, size, size);
  }

  // Draw hexagonal scutes (plates)
  ctx.strokeStyle = "#140e0a"; // dark, muddy brown/black seams
  ctx.lineWidth = 4.0;

  const drawHex = (x, y, r) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();

    // Fill with slightly varied shades of moss, slate, mud
    const rVal = 18 + Math.floor(Math.random() * 12);
    const gVal = 28 + Math.floor(Math.random() * 16);
    const bVal = 14 + Math.floor(Math.random() * 10);
    ctx.fillStyle = `rgba(${rVal}, ${gVal}, ${bVal}, 0.85)`;
    ctx.fill();

    // Growth rings inside each scute
    ctx.lineWidth = 1.2;
    for (let r2 = r - 10; r2 > 8; r2 -= 10) {
      const alpha = 0.15 + (1 - r2 / r) * 0.25;
      ctx.strokeStyle = `rgba(10, 8, 5, ${alpha})`;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const px = x + Math.cos(angle) * r2;
        const py = y + Math.sin(angle) * r2;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();

      // Slightly lighter highlight ring to catch light
      ctx.strokeStyle = `rgba(45, 60, 30, ${alpha * 0.6})`;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const px = x + Math.cos(angle) * (r2 - 2);
        const py = y + Math.sin(angle) * (r2 - 2);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.strokeStyle = "#140e0a";
    ctx.lineWidth = 4.0;
  };

  // Central column of scutes
  drawHex(cx, cy, 64);
  drawHex(cx, cy - 108, 60);
  drawHex(cx, cy + 108, 60);
  drawHex(cx, cy - 200, 48);
  drawHex(cx, cy + 200, 48);

  // Left column of scutes
  drawHex(cx - 96, cy - 54, 56);
  drawHex(cx - 96, cy + 54, 56);
  drawHex(cx - 90, cy - 162, 48);
  drawHex(cx - 90, cy + 162, 48);

  // Right column of scutes
  drawHex(cx + 96, cy - 54, 56);
  drawHex(cx + 96, cy + 54, 56);
  drawHex(cx + 90, cy - 162, 48);
  drawHex(cx + 90, cy + 162, 48);

  // Scatter bright/dark moss overlay spots across the texture
  for (let i = 0; i < 25; i++) {
    const rx = Math.random() * SZ;
    const ry = Math.random() * SZ;
    const rSize = 10 + Math.random() * 25;
    const mossGrad = ctx.createRadialGradient(rx, ry, 0, rx, ry, rSize);
    mossGrad.addColorStop(0, Math.random() < 0.6 ? "rgba(42, 68, 30, 0.4)" : "rgba(22, 16, 10, 0.5)");
    mossGrad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = mossGrad;
    ctx.beginPath(); ctx.arc(rx, ry, rSize, 0, Math.PI * 2); ctx.fill();
  }

  // Edge shading radial gradient (vignette)
  const edgeGrad = ctx.createRadialGradient(cx, cy, SZ * 0.32, cx, cy, SZ * 0.5);
  edgeGrad.addColorStop(0, "rgba(0,0,0,0)");
  edgeGrad.addColorStop(0.7, "rgba(10, 15, 6, 0.5)");
  edgeGrad.addColorStop(1.0, "rgba(5, 7, 3, 0.85)");
  ctx.fillStyle = edgeGrad;
  ctx.beginPath(); ctx.arc(cx, cy, SZ / 2, 0, Math.PI * 2); ctx.fill();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Builds a beautifully detailed, majestic, photorealistic green sea/pond turtle.
 * The turtle is larger than the drain, swimming underwater with fully animated limbs.
 */
function buildTurtle(centerY, textures) {
  const group = new THREE.Group();
  group.name = "sanctuary_pool_turtle";
  group.userData.anuKind = "sanctuary_pool_turtle";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FAUNA;

  const y = centerY - SANCTUARY_POOL_DEPTH_M + 0.08; // slightly above floor

  // High-fidelity photorealistic canvas texture for the carapace
  const shellTex = _makeTurtleShellTexture();

  const shellMat = new THREE.MeshStandardMaterial({
    map: shellTex,
    bumpMap: shellTex,
    bumpScale: 0.035, // physical scute crevices and growth rings
    roughnessMap: shellTex,
    roughness: 0.5,
    metalness: 0.08,
  });

  const skinMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x232d1d), // slate mossy dark green
    roughness: 0.88,
    metalness: 0.02,
    bumpMap: textures?.normal,
    bumpScale: 0.02, // skin folds/scales
  });

  const plastronMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x1f1912), // dark muddy plastron
    roughness: 0.85,
    metalness: 0.02,
  });

  const eyeMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x0a0c0a),
    roughness: 0.08,
    metalness: 0.95,
  });

  const clawMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xa59074), // dark tan horn claws
    roughness: 0.65,
    metalness: 0.15,
  });

  // 1. Carapace (Detailed Shell Dome)
  const shellGeo = new THREE.SphereGeometry(0.65, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  const shellMesh = new THREE.Mesh(shellGeo, shellMat);
  shellMesh.scale.set(1.15, 0.55, 1.45); // majestic large shell
  shellMesh.position.y = 0.08;
  shellMesh.castShadow = true;
  shellMesh.receiveShadow = true;
  group.add(shellMesh);

  // Carapace Rim / Flared Skirt (marginal scutes)
  const rimGeo = new THREE.TorusGeometry(0.65, 0.035, 6, 32);
  const rimMesh = new THREE.Mesh(rimGeo, shellMat);
  rimMesh.scale.set(1.17, 1.47, 0.4);
  rimMesh.rotation.x = Math.PI / 2;
  rimMesh.position.y = 0.07;
  rimMesh.castShadow = true;
  rimMesh.receiveShadow = true;
  group.add(rimMesh);

  // 2. Plastron (Belly Plate)
  const plastronGeo = new THREE.BoxGeometry(0.9, 0.04, 1.25);
  const plastron = new THREE.Mesh(plastronGeo, plastronMat);
  plastron.position.y = 0.05;
  plastron.castShadow = true;
  plastron.receiveShadow = true;
  group.add(plastron);

  // Helper for clawed, organic legs
  function buildClawedLeg(isFront, isLeft) {
    const leg = new THREE.Group();
    const side = isLeft ? 1 : -1;

    // Thigh / upper joint pointing outwards
    const thighGeo = new THREE.CylinderGeometry(isFront ? 0.09 : 0.07, isFront ? 0.11 : 0.09, 0.35, 8);
    const thigh = new THREE.Mesh(thighGeo, skinMat);
    thigh.rotation.z = side * Math.PI / 3; // angled outwards
    thigh.rotation.y = side * Math.PI / 6;
    thigh.position.set(side * 0.15, -0.05, 0);
    thigh.castShadow = true;
    leg.add(thigh);

    // Foot pointing forward-outwards
    const footGeo = new THREE.BoxGeometry(isFront ? 0.16 : 0.12, 0.03, isFront ? 0.20 : 0.14);
    const foot = new THREE.Mesh(footGeo, skinMat);
    foot.position.set(side * 0.30, -0.12, isFront ? 0.10 : -0.06);
    foot.rotation.y = -side * 0.15;
    foot.castShadow = true;
    leg.add(foot);

    // Claws on the tip of foot (horn-colored cones)
    const clawGeo = new THREE.ConeGeometry(0.012, 0.045, 4);
    const clawCount = isFront ? 4 : 3;
    for (let c = 0; c < clawCount; c++) {
      const claw = new THREE.Mesh(clawGeo, clawMat);
      const offset = (c - (clawCount - 1) / 2) * 0.032;
      claw.position.set(
        side * 0.30 + offset * Math.cos(-side * 0.15),
        -0.125,
        (isFront ? 0.10 : -0.06) + (isFront ? 0.11 : 0.08)
      );
      claw.rotation.x = Math.PI / 2.2; // angled forward/down
      claw.rotation.y = -side * 0.15 + offset * 0.35; // fan out
      claw.castShadow = true;
      leg.add(claw);
    }

    return leg;
  }

  // 3. Head & Neck (Snout profile & Sleepy eyelids)
  const neckGeo = new THREE.CylinderGeometry(0.09, 0.12, 0.38, 16);
  const neck = new THREE.Mesh(neckGeo, skinMat);
  neck.position.set(0, 0.1, 0.7);
  neck.rotation.x = Math.PI / 3;
  neck.castShadow = true;
  group.add(neck);

  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.22, 0.9);
  headGroup.name = "turtle_head_group";
  group.add(headGroup);
  group.userData.headRef = headGroup;

  // Skull
  const skullGeo = new THREE.SphereGeometry(0.15, 24, 24);
  const skull = new THREE.Mesh(skullGeo, skinMat);
  skull.scale.set(1.0, 0.85, 1.1);
  skull.castShadow = true;
  headGroup.add(skull);

  // Tapered Snout
  const snoutGeo = new THREE.CylinderGeometry(0.07, 0.11, 0.16, 12);
  const snout = new THREE.Mesh(snoutGeo, skinMat);
  snout.rotation.x = Math.PI / 2;
  snout.position.set(0, -0.02, 0.15);
  snout.castShadow = true;
  headGroup.add(snout);

  // Lower Jaw
  const jawGeo = new THREE.CylinderGeometry(0.10, 0.11, 0.06, 12);
  const jaw = new THREE.Mesh(jawGeo, skinMat);
  jaw.rotation.x = Math.PI / 2;
  jaw.position.set(0, -0.07, 0.10);
  jaw.castShadow = true;
  headGroup.add(jaw);

  // Eyes & Eyelids (80% closed / sleepy)
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.020, 12, 12), eyeMat);
  eyeL.position.set(0.11, 0.02, 0.08);
  headGroup.add(eyeL);

  const eyelidL = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 12, 12, 0, Math.PI * 2, 0, Math.PI * 0.65),
    skinMat
  );
  eyelidL.position.copy(eyeL.position);
  eyelidL.rotation.y = 0.2;
  headGroup.add(eyelidL);

  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.020, 12, 12), eyeMat);
  eyeR.position.set(-0.11, 0.02, 0.08);
  headGroup.add(eyeR);

  const eyelidR = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 12, 12, 0, Math.PI * 2, 0, Math.PI * 0.65),
    skinMat
  );
  eyelidR.position.copy(eyeR.position);
  eyelidR.rotation.y = -0.2;
  headGroup.add(eyelidR);

  // 4. Clawed organic legs
  const flipperL = buildClawedLeg(true, true);
  flipperL.position.set(0.48, 0.05, 0.42);
  flipperL.rotation.y = -0.3;
  group.add(flipperL);
  group.userData.flipperLRef = flipperL;

  const flipperR = buildClawedLeg(true, false);
  flipperR.position.set(-0.48, 0.05, 0.42);
  flipperR.rotation.y = 0.3;
  group.add(flipperR);
  group.userData.flipperRRef = flipperR;

  const flipperBL = buildClawedLeg(false, true);
  flipperBL.position.set(0.38, 0.05, -0.45);
  flipperBL.rotation.y = 0.35;
  group.add(flipperBL);
  group.userData.flipperBLRef = flipperBL;

  const flipperBR = buildClawedLeg(false, false);
  flipperBR.position.set(-0.38, 0.05, -0.45);
  flipperBR.rotation.y = -0.35;
  group.add(flipperBR);
  group.userData.flipperBRRef = flipperBR;

  // 5. Tail
  const tailGeo = new THREE.ConeGeometry(0.05, 0.25, 8);
  const tail = new THREE.Mesh(tailGeo, skinMat);
  tail.position.set(0, 0.02, -0.72);
  tail.rotation.x = -Math.PI / 3;
  tail.castShadow = true;
  group.add(tail);

  // Position turtle near bottom center of the pond
  group.position.set(SANCTUARY_POOL_CENTER_X, y, SANCTUARY_POOL_CENTER_Z);
  group.scale.set(0.9, 0.9, 0.9);

  return group;
}

/**
 * Pond-floor rocks + pebbles, batched via InstancedMesh so the whole stone
 * field is 3 draw calls (dodec rocks · icos rocks · pebbles) instead of
 * one draw per stone. ~700 total stones for "carpet of river-floor" feel.
 *
 * Deterministic via mulberry32(0xbeadca1a) so the layout is reproducible
 * across boots and screenshot diffs.
 */
function buildPoolRocks(centerY) {
  const group = new THREE.Group();
  group.name = "sanctuary_pool_rocks";
  group.userData.anuKind = "sanctuary_pool_rocks";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;

  const rng = mulberry32(0xbeadca1a);
  const bottomY = centerY - SANCTUARY_POOL_DEPTH_M * 0.62;

  // Earthy palette — sampled per-instance into instanceColor.
  // No moss-green or algae-gray; underwater they read as "grass" against
  // a sandy floor. All entries are sand/mud/stone tones now.
  // 2026-05-30 rock refactor (user: "smaller + more realistic, not chocolate
  // blobs"). Old palette was all RGB <= 56 — uniformly near-black, which read
  // as dark mud lumps. New palette is a realistic river-stone mix: greys, tan-
  // greys, weathered sandstone, slate — lighter and varied so the stones catch
  // light and read as rock, not chocolate.
  const rockPalette = [
    new THREE.Color(0x6b6f6a), // medium grey stone
    new THREE.Color(0x827b6c), // warm tan-grey
    new THREE.Color(0x9a9384), // light weathered sandstone
    new THREE.Color(0x55585a), // cool slate
    new THREE.Color(0x746b58), // olive-tan stone
    new THREE.Color(0x8a8275), // pale river stone
  ];
  const pebblePalette = [
    new THREE.Color(0x8c8270), // sandy tan
    new THREE.Color(0x9d9079), // cream stone
    new THREE.Color(0x6b6356), // dirty brown
    new THREE.Color(0x7a766b), // medium silt grey
    new THREE.Color(0x877a64), // ochre pebble
  ];

  // 2026-05-28: user-requested "more boulders" — bumped each rock tier by
  // ~50 %, scaled by the new 25 %-larger pool. Pebble count up too so the
  // bigger basin doesn't read sparse around the new rim.
  const ROCKS_DODEC_COUNT = 520; // Doubled from 260
  const ROCKS_ICOS_COUNT  = 450; // Doubled from 225
  const PEBBLE_COUNT      = 1240; // Doubled from 620

  const dodecGeo  = new THREE.DodecahedronGeometry(1.0, 0);
  const icosGeo   = new THREE.IcosahedronGeometry(1.0, 0);
  const pebbleGeo = new THREE.OctahedronGeometry(1.0, 0);

  const rockMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, // per-instance color carries tint
    roughness: 0.82,   // 0.92 -> 0.82: a touch of sheen so wet stone reads
    metalness: 0.10,   // 0.04 -> 0.10: subtle water-worn glint (not chocolate-matte)
    flatShading: true, // keep facets so light catches edges = "rocky"
  });
  const pebbleMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0.03,
    flatShading: true,
  });

  const _m = new THREE.Matrix4();
  const _pos = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _euler = new THREE.Euler();
  const _scl = new THREE.Vector3();

  // Track rock centers so pebbles can cluster near them (realistic settling).
  /** @type {{x:number, z:number, r:number}[]} */
  const rockAnchors = [];

  /** Populate an InstancedMesh of rocks (flat, elongated river-stone shape). */
  const populateRocks = (mesh, count, palette) => {
    for (let i = 0; i < count; i++) {
      // 2026-05-30: smaller stones. Was 0.12–0.60m (0.84m outliers) — too big,
      // read as bulbous mounds. Now 0.08–0.30m with rare modest 1.25x outliers.
      let r = 0.08 + rng() * 0.22; // 0.08–0.30m
      if (rng() < 0.10) r *= 1.25; // 10% slightly larger → ~0.375m max

      const scaleX = r * (0.90 + rng() * 0.30);
      const scaleY = r * (0.28 + rng() * 0.16); // flatter river-stone profile
      const scaleZ = r * (0.90 + rng() * 0.30);

      const theta = rng() * Math.PI * 2;
      const minD = 0.65 + scaleX;
      const maxD = SANCTUARY_POOL_RADIUS_M * 0.88 - scaleX;
      const actualMaxD = Math.max(minD + 0.1, maxD);
      const d = minD + Math.pow(rng(), 1.5) * (actualMaxD - minD); // Biased toward the center of the pool

      const x = SANCTUARY_POOL_CENTER_X + Math.cos(theta) * d;
      const z = SANCTUARY_POOL_CENTER_Z + Math.sin(theta) * d;
      // quadratic bowl Y at this rock's distance from centre:
      const rInner = Math.min(1, d / SANCTUARY_POOL_RADIUS_M);
      const bowlY = -SANCTUARY_POOL_DEPTH_M * (1 - rInner * rInner);
      const y = bowlY + 0.02 + rng() * 0.04 + scaleY * 0.3;

      _euler.set(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2);
      _quat.setFromEuler(_euler);
      _pos.set(x, y, z);
      _scl.set(scaleX, scaleY, scaleZ);
      _m.compose(_pos, _quat, _scl);
      mesh.setMatrixAt(i, _m);

      const tint = palette[Math.floor(rng() * palette.length)];
      mesh.setColorAt(i, tint);

      rockAnchors.push({ x, z, r: Math.max(scaleX, scaleZ) });
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  const dodecMesh = new THREE.InstancedMesh(dodecGeo, rockMat, ROCKS_DODEC_COUNT);
  dodecMesh.castShadow = true;
  dodecMesh.receiveShadow = true;
  // dodecMesh.layers.enable(1); // Bypassed in PiP ortho to optimize pool area draw calls
  dodecMesh.name = "sanctuary_pool_rocks_dodec";
  dodecMesh.userData.anuKind = "sanctuary_pool_rock";
  dodecMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  populateRocks(dodecMesh, ROCKS_DODEC_COUNT, rockPalette);
  group.add(dodecMesh);

  const icosMesh = new THREE.InstancedMesh(icosGeo, rockMat, ROCKS_ICOS_COUNT);
  icosMesh.castShadow = true;
  icosMesh.receiveShadow = true;
  // icosMesh.layers.enable(1); // Bypassed in PiP ortho to optimize pool area draw calls
  icosMesh.name = "sanctuary_pool_rocks_icos";
  icosMesh.userData.anuKind = "sanctuary_pool_rock";
  icosMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  populateRocks(icosMesh, ROCKS_ICOS_COUNT, rockPalette);
  group.add(icosMesh);

  // Pebbles — small octahedrons clustered near rock anchors so they read
  // as gravel settled around bigger stones, not a uniform field.
  const pebbleMesh = new THREE.InstancedMesh(pebbleGeo, pebbleMat, PEBBLE_COUNT);
  pebbleMesh.castShadow = false; // pebbles are tiny — shadow noise not worth it
  pebbleMesh.receiveShadow = true;
  // pebbleMesh.layers.enable(1); // Bypassed in PiP ortho to optimize pool area draw calls
  pebbleMesh.name = "sanctuary_pool_pebbles";
  pebbleMesh.userData.anuKind = "sanctuary_pool_pebble";
  pebbleMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;

  for (let i = 0; i < PEBBLE_COUNT; i++) {
    let x, z;
    if (rockAnchors.length && rng() < 0.7) {
      // 70%: cluster near a random rock anchor (offset ≤ 0.6m)
      const anchor = rockAnchors[Math.floor(rng() * rockAnchors.length)];
      const clusterR = anchor.r * 0.4 + rng() * 0.6;
      const clusterTheta = rng() * Math.PI * 2;
      x = anchor.x + Math.cos(clusterTheta) * clusterR;
      z = anchor.z + Math.sin(clusterTheta) * clusterR;
    } else {
      // 30%: free scatter across the basin
      const theta = rng() * Math.PI * 2;
      const minD = 0.55;
      const maxD = SANCTUARY_POOL_RADIUS_M * 0.88;
      const d = minD + Math.pow(rng(), 1.5) * (maxD - minD); // Biased toward the center of the pool
      x = SANCTUARY_POOL_CENTER_X + Math.cos(theta) * d;
      z = SANCTUARY_POOL_CENTER_Z + Math.sin(theta) * d;
    }

    // Clamp inside basin so cluster offsets don't poke through the rim
    const dxFromCenter = x - SANCTUARY_POOL_CENTER_X;
    const dzFromCenter = z - SANCTUARY_POOL_CENTER_Z;
    const distFromCenter = Math.sqrt(dxFromCenter * dxFromCenter + dzFromCenter * dzFromCenter);
    const maxBasinR = SANCTUARY_POOL_RADIUS_M * 0.88;
    if (distFromCenter > maxBasinR) {
      const scale = maxBasinR / distFromCenter;
      x = SANCTUARY_POOL_CENTER_X + dxFromCenter * scale;
      z = SANCTUARY_POOL_CENTER_Z + dzFromCenter * scale;
    }
    // Also keep clear of the drain
    if (distFromCenter < 0.55) {
      const scale = 0.55 / Math.max(0.01, distFromCenter);
      x = SANCTUARY_POOL_CENTER_X + dxFromCenter * scale;
      z = SANCTUARY_POOL_CENTER_Z + dzFromCenter * scale;
    }

    const r = 0.04 + rng() * 0.08; // 0.04–0.12m
    const scaleX = r * (0.85 + rng() * 0.35);
    const scaleY = r * (0.50 + rng() * 0.25);
    const scaleZ = r * (0.85 + rng() * 0.35);
    // Sit pebble on local bowl floor (same quadratic as basin floor mesh).
    const pInner = Math.min(1, distFromCenter / SANCTUARY_POOL_RADIUS_M);
    const pBowlY = -SANCTUARY_POOL_DEPTH_M * (1 - pInner * pInner);
    const y = pBowlY + 0.015 + rng() * 0.02 + scaleY * 0.3;

    _euler.set(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2);
    _quat.setFromEuler(_euler);
    _pos.set(x, y, z);
    _scl.set(scaleX, scaleY, scaleZ);
    _m.compose(_pos, _quat, _scl);
    pebbleMesh.setMatrixAt(i, _m);

    const tint = pebblePalette[Math.floor(rng() * pebblePalette.length)];
    pebbleMesh.setColorAt(i, tint);
  }
  pebbleMesh.instanceMatrix.needsUpdate = true;
  if (pebbleMesh.instanceColor) pebbleMesh.instanceColor.needsUpdate = true;
  group.add(pebbleMesh);

  // ── MICRO-PEBBLES — thousands of tiny stones carpeting the basin ──
  // Single InstancedMesh, 3000 instances of a 4-tri tetrahedron at
  // 0.015–0.05 m. Spread across the WHOLE basin (no anchor clustering)
  // so the pond floor reads as a continuous gravel bed under the bigger
  // rocks and pebbles. User-requested 2026-05-28: "cover the entire pool
  // with thousands of small tiny rock draws". 4 tris × 3000 = 12k tris
  // for the whole carpet, in 1 instanced draw.
  const MICRO_PEBBLE_COUNT = 3000;
  const microGeo = new THREE.TetrahedronGeometry(1.0, 0);
  const microMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.94,
    metalness: 0.02,
    flatShading: true,
  });
  const microMesh = new THREE.InstancedMesh(microGeo, microMat, MICRO_PEBBLE_COUNT);
  microMesh.castShadow = false;
  microMesh.receiveShadow = true;
  // microMesh.layers.enable(1); // Bypassed in PiP ortho to optimize pool area draw calls
  microMesh.name = "sanctuary_pool_micro_pebbles";
  microMesh.userData.anuKind = "sanctuary_pool_micro_pebble";
  microMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  // User-requested 2026-05-28 (12x): "where is the sand at bottom of
  // pond, only see grass textures". The green tints below were drowning
  // the sandy basin texture from above. Dropped all three moss-green
  // colors and added more sand/tan variants so the gravel bed reads as
  // SAND-COLOURED gravel, not a green carpet. The actual moss tufts
  // (1500 → 250 below) provide the few green accents we still want.
  const microPalette = [
    new THREE.Color(0x554838), // ochre stone
    new THREE.Color(0x3a3025), // dirty brown
    new THREE.Color(0x4a4035), // medium silt
    new THREE.Color(0x665540), // pale sand
    new THREE.Color(0x806a48), // light dry sand
    new THREE.Color(0x6b5638), // warm sand
    new THREE.Color(0x4a3a25), // dark wet sand
    new THREE.Color(0x5b4a35), // wet sand
  ];
  for (let i = 0; i < MICRO_PEBBLE_COUNT; i++) {
    const theta = rng() * Math.PI * 2;
    const dNorm = Math.sqrt(rng()); // sqrt → uniform area distribution (not biased to centre)
    const d = 0.55 + dNorm * (SANCTUARY_POOL_RADIUS_M * 0.88 - 0.55);
    const x = SANCTUARY_POOL_CENTER_X + Math.cos(theta) * d;
    const z = SANCTUARY_POOL_CENTER_Z + Math.sin(theta) * d;
    const sBase = 0.015 + rng() * 0.035; // 0.015 to 0.050 m
    _euler.set(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2);
    _quat.setFromEuler(_euler);
    // Sit on the bowl-shaped basin floor: compute local Y from the same
    // quadratic the basin mesh uses, plus a tiny lift.
    const mInner = Math.min(1, d / SANCTUARY_POOL_RADIUS_M);
    const mBowlY = -SANCTUARY_POOL_DEPTH_M * (1 - mInner * mInner);
    _pos.set(x, mBowlY + 0.015 + rng() * 0.015 + sBase * 0.3, z);
    _scl.set(sBase * (0.85 + rng() * 0.35), sBase * (0.55 + rng() * 0.25), sBase * (0.85 + rng() * 0.35));
    _m.compose(_pos, _quat, _scl);
    microMesh.setMatrixAt(i, _m);
    microMesh.setColorAt(i, microPalette[Math.floor(rng() * microPalette.length)]);
  }
  microMesh.instanceMatrix.needsUpdate = true;
  if (microMesh.instanceColor) microMesh.instanceColor.needsUpdate = true;
  group.add(microMesh);

  // ── MOSS TUFTS — sparse green blades scattered across the rocks ───
  // 250 instanced crossed-quad tufts (4 tris each), 0.03–0.06 m tall.
  // User-requested 2026-05-28 (12x): "where is the sand at bottom of
  // pond, only see grass". Dropped from 1500 → 250 so the sandy basin
  // and gravel are dominant — moss is now occasional accents around the
  // rocks, not a green carpet covering the floor. Each tuft is two thin
  // planes crossed at 90° so silhouette reads from any angle. Bias is
  // now 80% rock-anchored / 20% free-scatter so the few remaining tufts
  // cluster around rocks where moss naturally grows in real ponds.
  const MOSS_COUNT = 250;
  const mossGeo = _buildMossTuftGeometry();
  const mossMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0.0,
    flatShading: false,
    side: THREE.DoubleSide, // crossed quads visible from both sides
    transparent: false,
  });
  const mossMesh = new THREE.InstancedMesh(mossGeo, mossMat, MOSS_COUNT);
  mossMesh.castShadow = false;
  mossMesh.receiveShadow = true;
  // mossMesh.layers.enable(1); // Bypassed in PiP ortho to optimize pool area draw calls
  mossMesh.name = "sanctuary_pool_moss_tufts";
  mossMesh.userData.anuKind = "sanctuary_pool_moss_tuft";
  mossMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  const mossPalette = [
    new THREE.Color(0x4a6b2a), // bright moss
    new THREE.Color(0x384e1f), // wet moss (dark, saturated)
    new THREE.Color(0x6b5a35), // dead grass tan
    new THREE.Color(0x5c6a3a), // olive
    new THREE.Color(0x39522d), // fern
    new THREE.Color(0x6b4a2c), // copper-rust (autumn debris)
  ];
  for (let i = 0; i < MOSS_COUNT; i++) {
    let x, z;
    if (rockAnchors.length && rng() < 0.80) {
      // 80%: grow near an existing rock anchor — interweaves with stones
      const anchor = rockAnchors[Math.floor(rng() * rockAnchors.length)];
      const clusterR = anchor.r * 0.6 + rng() * 0.35;
      const clusterTheta = rng() * Math.PI * 2;
      x = anchor.x + Math.cos(clusterTheta) * clusterR;
      z = anchor.z + Math.sin(clusterTheta) * clusterR;
    } else {
      // 20%: free scatter across the floor
      const theta = rng() * Math.PI * 2;
      const dNorm = Math.sqrt(rng());
      const d = 0.65 + dNorm * (SANCTUARY_POOL_RADIUS_M * 0.86 - 0.65);
      x = SANCTUARY_POOL_CENTER_X + Math.cos(theta) * d;
      z = SANCTUARY_POOL_CENTER_Z + Math.sin(theta) * d;
    }
    // Clamp inside basin + clear of drain
    const dx = x - SANCTUARY_POOL_CENTER_X;
    const dz = z - SANCTUARY_POOL_CENTER_Z;
    const dC = Math.hypot(dx, dz);
    const maxR = SANCTUARY_POOL_RADIUS_M * 0.86;
    if (dC > maxR) { const s = maxR / dC; x = SANCTUARY_POOL_CENTER_X + dx * s; z = SANCTUARY_POOL_CENTER_Z + dz * s; }
    if (dC < 0.55) { const s = 0.55 / Math.max(0.01, dC); x = SANCTUARY_POOL_CENTER_X + dx * s; z = SANCTUARY_POOL_CENTER_Z + dz * s; }

    // Sit moss flush on the local bowl floor (same quadratic as basin floor mesh).
    const mInner = Math.min(1, dC / SANCTUARY_POOL_RADIUS_M);
    const mBowlY = -SANCTUARY_POOL_DEPTH_M * (1 - mInner * mInner);
    const y = mBowlY + 0.01 + rng() * 0.01;
    const tuftH = 0.03 + rng() * 0.05;          // 0.03–0.08 m tall
    const tuftW = tuftH * (0.6 + rng() * 0.6);  // slight width variance
    _euler.set(0, rng() * Math.PI * 2, 0);       // random Y rotation only — tufts stand upright
    _quat.setFromEuler(_euler);
    _pos.set(x, y, z);
    _scl.set(tuftW, tuftH, tuftW);
    _m.compose(_pos, _quat, _scl);
    mossMesh.setMatrixAt(i, _m);
    mossMesh.setColorAt(i, mossPalette[Math.floor(rng() * mossPalette.length)]);
  }
  mossMesh.instanceMatrix.needsUpdate = true;
  if (mossMesh.instanceColor) mossMesh.instanceColor.needsUpdate = true;
  group.add(mossMesh);

  return group;
}

/**
 * Crossed-quad "tuft" geometry — two narrow vertical planes meeting at
 * 90° so the tuft silhouette is visible from every horizontal viewing
 * angle. Origin at the base (Y=0), tuft grows up to Y=1 in local space;
 * caller scales by the desired height. 4 triangles per tuft.
 */
function _buildMossTuftGeometry() {
  const positions = new Float32Array([
    // Plane A: along X axis
    -0.5, 0.0, 0.0,
     0.5, 0.0, 0.0,
     0.5, 1.0, 0.0,
    -0.5, 1.0, 0.0,
    // Plane B: along Z axis (rotated 90° around Y)
     0.0, 0.0, -0.5,
     0.0, 0.0,  0.5,
     0.0, 1.0,  0.5,
     0.0, 1.0, -0.5,
  ]);
  const indices = new Uint16Array([
    0, 1, 2,  0, 2, 3, // plane A front
    4, 5, 6,  4, 6, 7, // plane B front
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  g.computeVertexNormals();
  return g;
}

function buildRim(centerY) {
  // Thin moss collar at the waterline — RingGeometry between water
  // radius and slightly beyond, dark green, lifted a hair above water.
  const geo = new THREE.RingGeometry(
    SANCTUARY_POOL_RADIUS_M * 0.96,
    SANCTUARY_POOL_RADIUS_M * 1.06,
    48,
  );
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x2c4123),
    roughness: 0.95,
    metalness: 0.0,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(
    SANCTUARY_POOL_CENTER_X,
    centerY + 0.04,
    SANCTUARY_POOL_CENTER_Z,
  );
  mesh.layers.enable(1); // Show in PiP map
  mesh.name = "sanctuary_pool_moss_rim";
  mesh.userData.anuId = "environment.sanctuary.pool.moss_rim";
  mesh.userData.anuKind = "sanctuary_pool_moss_rim";
  mesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  return mesh;
}

function buildShorelineRocks(centerY) {
  const group = new THREE.Group();
  group.name = "sanctuary_pool_shoreline_rocks";
  group.userData.anuKind = "sanctuary_pool_shoreline_rocks";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;

  const rng = mulberry32(0xd0c410c5);

  const shorePalette = [
    new THREE.Color(0x282c22), // mossy dark green-gray
    new THREE.Color(0x322d26), // warm slate grey
    new THREE.Color(0x242721), // deep forest moss
    new THREE.Color(0x3e382f), // charcoal granite
    new THREE.Color(0x1a1c18), // wet charcoal
    new THREE.Color(0x443a2e), // dry lichen brown
  ];

  const ROCKS_COUNT = 72;

  for (let i = 0; i < ROCKS_COUNT; i++) {
    const theta = (i / ROCKS_COUNT) * Math.PI * 2;
    
    // Avoid dock entrance (south dock direction is Math.PI)
    // Dock entrance covers theta around Math.PI, check +/- 0.38 rad
    const angleDiff = Math.abs(theta - Math.PI);
    if (angleDiff < 0.38) {
      continue;
    }

    const rngVal = rng();
    let geo;
    if (rngVal < 0.5) {
      geo = new THREE.DodecahedronGeometry(1.0, 2); // rounded dodecahedron
    } else {
      geo = new THREE.IcosahedronGeometry(1.0, 2); // rounded icosahedron
    }

    // Scale - highly diverse realistic sizes (0.8m to 3.0m)
    const scaleX = 0.8 + rng() * 2.2;
    const scaleY = 0.6 + rng() * 1.8;
    const scaleZ = 0.8 + rng() * 2.2;

    // Radius matching organic rim curve
    const r = organicRimRadius(theta) + (rng() * 0.4 - 0.1);
    const x = SANCTUARY_POOL_CENTER_X + Math.cos(theta) * r;
    const z = SANCTUARY_POOL_CENTER_Z + Math.sin(theta) * r;

    // Ground elevation
    const groundY = sanctuaryGroundY(x, z);
    const y = groundY - scaleY * 0.35; // slightly embedded so it doesn't float

    // Material
    const color = shorePalette[Math.floor(rng() * shorePalette.length)];
    const mat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.15, // wet, glistening look for stone parts
      metalness: 0.08,
      flatShading: false, // beautifully rounded/smooth organic look!
    });

    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        `void main() {`,
        `varying vec3 vWorldNormal;\nvarying vec3 vWorldPosition;\nvoid main() {`
      );
      shader.vertexShader = shader.vertexShader.replace(
        `#include <worldpos_vertex>`,
        `#include <worldpos_vertex>\n
        vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);\n
        vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

      // (2026-05-30 fix) Declare moss outputs as GLOBALS before main() so
      // they exist when roughnessmap_fragment / metalnessmap_fragment run —
      // those chunks come EARLIER in the template than opaque_fragment, so
      // declaring inside opaque_fragment caused "undeclared identifier" link
      // failures (76+ WebGL useProgram errors/frame).
      shader.fragmentShader = shader.fragmentShader.replace(
        `void main() {`,
        `varying vec3 vWorldNormal;\nvarying vec3 vWorldPosition;\nfloat finalRoughness = 0.5;\nfloat finalMetalness = 0.0;\nvoid main() {`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <opaque_fragment>`,
        `
        // Calculate organic moss blending based on world-space up normal + positional noise
        float noise = sin(vWorldPosition.x * 3.5) * cos(vWorldPosition.z * 3.5) * 0.18 + sin(vWorldPosition.y * 6.0) * 0.08;
        float mossStrength = smoothstep(0.35, 0.60, vWorldNormal.y + noise);

        // Beautiful velvet-moss green blend
        vec3 mossColor1 = vec3(0.20, 0.35, 0.12); // deep forest moss
        vec3 mossColor2 = vec3(0.32, 0.48, 0.18); // bright velvet moss
        vec3 finalMossColor = mix(mossColor1, mossColor2, 0.5 + 0.5 * sin(vWorldPosition.x * 1.5 + vWorldPosition.z * 1.5));

        // Blend final diffuse color
        diffuseColor.rgb = mix(diffuseColor.rgb, finalMossColor, mossStrength);
        ` + `\n#include <opaque_fragment>`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <roughnessmap_fragment>`,
        `#include <roughnessmap_fragment>
        {
          float _n = sin(vWorldPosition.x * 3.5) * cos(vWorldPosition.z * 3.5) * 0.18 + sin(vWorldPosition.y * 6.0) * 0.08;
          float _ms = smoothstep(0.35, 0.60, vWorldNormal.y + _n);
          finalRoughness = mix(0.15, 0.95, _ms);
          finalMetalness = mix(0.08, 0.0, _ms);
          roughnessFactor = finalRoughness;
        }`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <metalnessmap_fragment>`,
        `#include <metalnessmap_fragment>\nmetalnessFactor = finalMetalness;`
      );
    };

    const rockMesh = new THREE.Mesh(geo, mat);
    rockMesh.position.set(x, y, z);
    rockMesh.scale.set(scaleX, scaleY, scaleZ);
    rockMesh.rotation.set(
      rng() * Math.PI * 2,
      rng() * Math.PI * 2,
      rng() * Math.PI * 2
    );
    rockMesh.castShadow = true;
    rockMesh.receiveShadow = true;
    rockMesh.layers.enable(1); // Enable map layer

    rockMesh.name = `sanctuary_shoreline_rock_${i}`;
    rockMesh.userData.anuKind = "sanctuary_shoreline_rock";
    rockMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;

    group.add(rockMesh);
  }

  // Additional: Add outer boulders specifically on the left side of the shore (x < 0) to break up transition lines
  const OUTER_ROCKS_COUNT = 24;
  for (let j = 0; j < OUTER_ROCKS_COUNT; j++) {
    // Left side covers angles roughly from 90 degrees (Math.PI/2) to 270 degrees (3*Math.PI/2)
    // Left is centered on Math.PI (180 degrees)
    const theta = Math.PI * 0.65 + (j / OUTER_ROCKS_COUNT) * Math.PI * 0.70;

    const rngVal = rng();
    let geo;
    if (rngVal < 0.5) {
      geo = new THREE.DodecahedronGeometry(1.0, 2);
    } else {
      geo = new THREE.IcosahedronGeometry(1.0, 2);
    }

    // Diverse sizes for outer boulders (0.6m to 2.2m)
    const scaleX = 0.6 + rng() * 1.6;
    const scaleY = 0.5 + rng() * 1.3;
    const scaleZ = 0.6 + rng() * 1.6;

    // Radius places them outer (grassy meadow transition zone)
    const r = organicRimRadius(theta) + 1.2 + rng() * 2.2;
    const x = SANCTUARY_POOL_CENTER_X + Math.cos(theta) * r;
    const z = SANCTUARY_POOL_CENTER_Z + Math.sin(theta) * r;

    const groundY = sanctuaryGroundY(x, z);
    const y = groundY - scaleY * 0.35; // slightly embedded

    const color = shorePalette[Math.floor(rng() * shorePalette.length)];
    const mat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.18,
      metalness: 0.05,
      flatShading: false,
    });

    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        `void main() {`,
        `varying vec3 vWorldNormal;\nvarying vec3 vWorldPosition;\nvoid main() {`
      );
      shader.vertexShader = shader.vertexShader.replace(
        `#include <worldpos_vertex>`,
        `#include <worldpos_vertex>\n
        vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);\n
        vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

      // (2026-05-30 fix) globals before main() — same scope fix as block 1.
      shader.fragmentShader = shader.fragmentShader.replace(
        `void main() {`,
        `varying vec3 vWorldNormal;\nvarying vec3 vWorldPosition;\nfloat finalRoughness = 0.5;\nfloat finalMetalness = 0.0;\nvoid main() {`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <opaque_fragment>`,
        `
        float noise = sin(vWorldPosition.x * 3.5) * cos(vWorldPosition.z * 3.5) * 0.18 + sin(vWorldPosition.y * 6.0) * 0.08;
        float mossStrength = smoothstep(0.35, 0.60, vWorldNormal.y + noise);

        vec3 mossColor1 = vec3(0.20, 0.35, 0.12);
        vec3 mossColor2 = vec3(0.32, 0.48, 0.18);
        vec3 finalMossColor = mix(mossColor1, mossColor2, 0.5 + 0.5 * sin(vWorldPosition.x * 1.5 + vWorldPosition.z * 1.5));

        diffuseColor.rgb = mix(diffuseColor.rgb, finalMossColor, mossStrength);
        ` + `\n#include <opaque_fragment>`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <roughnessmap_fragment>`,
        `#include <roughnessmap_fragment>
        {
          float _n = sin(vWorldPosition.x * 3.5) * cos(vWorldPosition.z * 3.5) * 0.18 + sin(vWorldPosition.y * 6.0) * 0.08;
          float _ms = smoothstep(0.35, 0.60, vWorldNormal.y + _n);
          finalRoughness = mix(0.18, 0.95, _ms);
          finalMetalness = mix(0.05, 0.0, _ms);
          roughnessFactor = finalRoughness;
        }`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <metalnessmap_fragment>`,
        `#include <metalnessmap_fragment>\nmetalnessFactor = finalMetalness;`
      );
    };

    const rockMesh = new THREE.Mesh(geo, mat);
    rockMesh.position.set(x, y, z);
    rockMesh.scale.set(scaleX, scaleY, scaleZ);
    rockMesh.rotation.set(
      rng() * Math.PI * 2,
      rng() * Math.PI * 2,
      rng() * Math.PI * 2
    );
    rockMesh.castShadow = true;
    rockMesh.receiveShadow = true;
    rockMesh.layers.enable(1);

    rockMesh.name = `sanctuary_outer_shoreline_rock_${j}`;
    rockMesh.userData.anuKind = "sanctuary_shoreline_rock";
    rockMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;

    group.add(rockMesh);
  }

  return group;
}

function mulberry32(seed) {
  return function rng() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Procedural lily-pad texture — 256×256 CanvasTexture.
 * Radial veins from center + edge darkening + subtle water droplets
 * give the pads a photo-real read without fetching any image asset.
 * Built ONCE, shared across all 14 pad meshes.
 */
function _makeLilyPadTexture() {
  const SZ = 256;
  const cv = document.createElement("canvas");
  cv.width = SZ; cv.height = SZ;
  const ctx = cv.getContext("2d");
  const cx = SZ / 2, cy = SZ / 2;

  // Base — radial gradient (lighter center, darker edge)
  const baseGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, SZ / 2);
  baseGrad.addColorStop(0.00, "#7ea15a");      // sunlit center
  baseGrad.addColorStop(0.55, "#4d6b34");      // mid green
  baseGrad.addColorStop(0.85, "#33491f");      // outer band
  baseGrad.addColorStop(1.00, "#1d2e10");      // dark edge
  ctx.fillStyle = baseGrad;
  ctx.beginPath(); ctx.arc(cx, cy, SZ / 2, 0, Math.PI * 2); ctx.fill();

  // Radial veins (12 visible)
  ctx.strokeStyle = "rgba(28, 42, 14, 0.55)";
  ctx.lineWidth = 1.5;
  const VEINS = 12;
  for (let i = 0; i < VEINS; i++) {
    const a = (i / VEINS) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8);
    ctx.lineTo(cx + Math.cos(a) * (SZ / 2 - 6), cy + Math.sin(a) * (SZ / 2 - 6));
    ctx.stroke();
  }

  // Sub-veins (32 hairline)
  ctx.strokeStyle = "rgba(30, 50, 18, 0.25)";
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (SZ * 0.18), cy + Math.sin(a) * (SZ * 0.18));
    ctx.lineTo(cx + Math.cos(a) * (SZ / 2 - 8), cy + Math.sin(a) * (SZ / 2 - 8));
    ctx.stroke();
  }

  // Central spot (vein convergence)
  const spotGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 14);
  spotGrad.addColorStop(0, "rgba(255, 240, 180, 0.6)");
  spotGrad.addColorStop(1, "rgba(40, 60, 22, 0)");
  ctx.fillStyle = spotGrad;
  ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2); ctx.fill();

  // Scattered water-droplet highlights
  ctx.fillStyle = "rgba(255, 255, 255, 0.42)";
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 20 + Math.random() * (SZ / 2 - 40);
    const r = 2 + Math.random() * 3;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Build a beautiful lotus flower from stacked layered petals.
 * Three concentric rings, pink-to-white gradient. Casts shadow.
 */
/**
 * Lotus variant colour atlas — outer (deepest saturated) + inner
 * (lighter blossom-edge) + pistil (warm/bright contrast). Each
 * entry's emissive tint is the colour roughly halved so the petals
 * read sun-lit, not flat. User-requested 2026-05-28: "gradients of
 * blues greens reds purples and golds".
 */
const LOTUS_VARIANTS = {
  pink: {
    outer: 0xf7c4d5, inner: 0xfde6ef, pistil: 0xf2c94c,
    outerEm: 0x331a23, innerEm: 0x402028, pistilEm: 0x6b4a10,
  },
  blue: {
    outer: 0x7ab8d6, inner: 0xc6e2f1, pistil: 0xf2e34c,
    outerEm: 0x10303f, innerEm: 0x1c3a4a, pistilEm: 0x6b5a10,
  },
  green: {
    outer: 0x9fc97a, inner: 0xdceec5, pistil: 0xf7d04c,
    outerEm: 0x20351c, innerEm: 0x2a3d22, pistilEm: 0x6b4f10,
  },
  red: {
    outer: 0xe07a7a, inner: 0xf4c1bf, pistil: 0xf2c94c,
    outerEm: 0x3a1414, innerEm: 0x402424, pistilEm: 0x6b4a10,
  },
  purple: {
    outer: 0x9b73c4, inner: 0xd6c2ea, pistil: 0xf7d34c,
    outerEm: 0x271a3a, innerEm: 0x342a44, pistilEm: 0x6b4f10,
  },
  gold: {
    outer: 0xe8be4e, inner: 0xfae89b, pistil: 0xf5b220,
    outerEm: 0x3a2c10, innerEm: 0x4a3a18, pistilEm: 0x6b3e08,
  },
};
const LOTUS_VARIANT_KEYS = Object.keys(LOTUS_VARIANTS);

/**
 * Build a lotus flower in one of the 6 colour variants. Variant can
 * be passed by name (`'pink' | 'blue' | 'green' | 'red' | 'purple' |
 * 'gold'`); omit to pick one at random via `rng()`. Each call uses
 * fresh materials so caller can apply per-instance tweaks (scale,
 * opacity) without mutating shared state.
 */
function _buildLotusFlower(rng, variant) {
  const variantKey = variant && LOTUS_VARIANTS[variant]
    ? variant
    : LOTUS_VARIANT_KEYS[Math.floor(rng() * LOTUS_VARIANT_KEYS.length)];
  const palette = LOTUS_VARIANTS[variantKey];

  const flower = new THREE.Group();
  flower.userData.lotusVariant = variantKey;

  // Outer petal ring (8 petals, outer-most, deepest saturated tint)
  const outerMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(palette.outer),
    emissive: new THREE.Color(palette.outerEm),
    emissiveIntensity: 0.05,
    roughness: 0.6,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const outerGeo = new THREE.ConeGeometry(0.05, 0.13, 4);
  for (let i = 0; i < 8; i++) {
    const petal = new THREE.Mesh(outerGeo, outerMat);
    const a = (i / 8) * Math.PI * 2;
    petal.position.set(Math.cos(a) * 0.06, 0.045, Math.sin(a) * 0.06);
    petal.rotation.z = Math.cos(a) * -0.6;
    petal.rotation.x = Math.sin(a) *  0.6;
    petal.castShadow = true;
    petal.receiveShadow = true;
    flower.add(petal);
  }

  // Inner petal ring (6 petals, lighter blossom-edge of the same hue)
  const innerMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(palette.inner),
    emissive: new THREE.Color(palette.innerEm),
    emissiveIntensity: 0.04,
    roughness: 0.55,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const innerGeo = new THREE.ConeGeometry(0.035, 0.10, 4);
  for (let i = 0; i < 6; i++) {
    const petal = new THREE.Mesh(innerGeo, innerMat);
    const a = (i / 6) * Math.PI * 2 + 0.3;
    petal.position.set(Math.cos(a) * 0.035, 0.075, Math.sin(a) * 0.035);
    petal.rotation.z = Math.cos(a) * -0.35;
    petal.rotation.x = Math.sin(a) *  0.35;
    petal.castShadow = true;
    flower.add(petal);
  }

  // Central pistil — warm contrast colour from the variant
  const pistilMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(palette.pistil),
    emissive: new THREE.Color(palette.pistilEm),
    emissiveIntensity: 0.4,
    roughness: 0.4,
    metalness: 0.1,
  });
  const pistil = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), pistilMat);
  pistil.position.y = 0.09;
  pistil.castShadow = true;
  flower.add(pistil);

  return flower;
}

// Physical wave height sampler — matches the vertex shader's concentric
// ripple pattern so floating lily pads and flowers track the same rings
// the surface displays.
function getWaveHeight(x, z, time) {
  const baseR = SANCTUARY_POOL_RADIUS_M * 0.97;
  const dx = x - SANCTUARY_POOL_CENTER_X;
  const dz = z - SANCTUARY_POOL_CENTER_Z;
  const uvX = dx / (baseR * 2.0) + 0.5;
  const uvY = dz / (baseR * 2.0) + 0.5;

  const vDist = Math.hypot(uvX - 0.5, uvY - 0.5);
  // smoothstep(0.48, 0.35, vDist)
  const t = Math.max(0.0, Math.min(1.0, (vDist - 0.48) / (0.35 - 0.48)));
  const shoreFade = t * t * (3.0 - 2.0 * t);

  // Two concentric ripples expanding from pool centre — must match the
  // vertex shader exactly or lily pads drift out of sync with the surface.
  const phase1 = vDist * 22.0 - time * 0.32;
  const z1 = Math.sin(phase1) * 0.005;

  const phase2 = vDist * 36.0 - time * 0.45;
  const z2 = Math.sin(phase2) * 0.003;

  return (z1 + z2) * shoreFade;
}

function buildLilyPads(centerY) {
  const group = new THREE.Group();
  group.name = "sanctuary_lily_pads";
  group.userData.anuId = "environment.sanctuary.pool.lilies";
  group.userData.anuKind = "sanctuary_lily_pads";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;

  const rng = mulberry32(0xa55a55a5);

  // Higher-res circle (24 segments vs 10) for round photo-real silhouette.
  const padGeo = new THREE.CircleGeometry(0.45, 24);
  const padTex = _makeLilyPadTexture();
  const padMat = new THREE.MeshStandardMaterial({
    map: padTex,
    color: new THREE.Color(0xffffff),       // texture supplies all color
    roughness: 0.75,                        // wet leaf — slightly glossy
    metalness: 0.05,
    side: THREE.DoubleSide,
  });

  const PADS = 14;
  // Vertical lift for flowers above their pad. The lotus petals are cones
  // centered ~0.045 above the flower group origin with half-height 0.065,
  // so their bottoms dip ~0.02 BELOW the group origin. Lifting the flower
  // 0.10 m above its pad keeps every petal cleanly above the pad surface
  // — and above the random Y of every neighboring pad (which all live
  // within centerY+0.02..+0.03), so flowers can no longer be clipped by
  // adjacent lily geometry.
  const FLOWER_LIFT_M = 0.10;
  for (let i = 0; i < PADS; i++) {
    const ang = rng() * Math.PI * 2;
    // Constrain the outer spawn limit so pads do not clip through the pool edge.
    const rNorm = 0.40 + rng() * 0.42; // max radius multiplier: 0.82
    const r = rNorm * SANCTUARY_POOL_RADIUS_M;
    const x = SANCTUARY_POOL_CENTER_X + Math.cos(ang) * r;
    const z = SANCTUARY_POOL_CENTER_Z + Math.sin(ang) * r;

    // Cache the pad's random Y so userData.initialY matches position.y
    // exactly. Previous code called rng() twice and drifted by up to 1 cm,
    // throwing off the wave-follow integrator.
    const padY = centerY + 0.02 + rng() * 0.01;

    const pad = new THREE.Mesh(padGeo, padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.rotation.z = rng() * Math.PI * 2;     // random vein orientation
    pad.position.set(x, padY, z);
    pad.scale.setScalar(0.55 + rng() * 0.45); // slightly smaller pads

    pad.name = `sanctuary_lily_pad_${i}`;
    pad.userData.anuKind = "sanctuary_lily_pad";
    pad.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    pad.receiveShadow = true;                 // flower casts onto pad

    pad.userData.initialX = x;
    pad.userData.initialZ = z;
    pad.userData.initialY = padY;
    pad.userData.baseQuaternion = pad.quaternion.clone();

    group.add(pad);

    // ~70% of pads carry a beautiful lotus flower with a random colour
    // variant from the 6-colour palette (pink/blue/green/red/purple/gold).
    // Per-flower random scale 0.7-1.6x gives "different flower sizes"
    // per the user's 2026-05-28 ask.
    if (rng() < 0.70) {
      const flower = _buildLotusFlower(rng);
      const flowerScale = 0.7 + rng() * 0.9; // 0.7 - 1.6x
      flower.scale.setScalar(flowerScale);
      const flowerY = padY + FLOWER_LIFT_M;
      flower.position.set(x, flowerY, z);
      flower.name = `sanctuary_lily_flower_${i}`;
      flower.userData.anuKind = "sanctuary_lily_flower";
      flower.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;

      flower.userData.initialX = x;
      flower.userData.initialZ = z;
      flower.userData.initialY = flowerY;
      flower.userData.baseQuaternion = flower.quaternion.clone();

      group.add(flower);
    }
  }

  // ── BIG ORCHID LILIES — 3 oversized centre-pool clusters ──────────
  // User-requested 2026-05-28: bigger lilies with orchids near the
  // centre + "showcase around the fishing gauge" with the colourful
  // variants. Each of the 3 centre pads carries one of the most
  // vibrant variants (gold / purple / blue) at 1.45-1.65x flower
  // scale. Placed in a ~3 m ring around the pool centre so they
  // frame the gauge area when fishing is active.
  const ORCHID_PADS = 3;
  const ORCHID_VARIANTS = ["gold", "purple", "blue"];
  const ORCHID_RING_RADIUS_M = 2.8;
  for (let i = 0; i < ORCHID_PADS; i++) {
    const ang = (i / ORCHID_PADS) * Math.PI * 2 + rng() * 0.5;
    const r = ORCHID_RING_RADIUS_M * (0.75 + rng() * 0.5);
    const x = SANCTUARY_POOL_CENTER_X + Math.cos(ang) * r;
    const z = SANCTUARY_POOL_CENTER_Z + Math.sin(ang) * r;
    const padY = centerY + 0.022 + rng() * 0.008;

    const pad = new THREE.Mesh(padGeo, padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.rotation.z = rng() * Math.PI * 2;
    pad.position.set(x, padY, z);
    pad.scale.setScalar(1.55 + rng() * 0.25); // 1.55-1.80 — clearly bigger than regular pads
    pad.name = `sanctuary_orchid_pad_${i}`;
    pad.userData.anuKind = "sanctuary_lily_pad";
    pad.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    pad.receiveShadow = true;
    pad.userData.initialX = x;
    pad.userData.initialZ = z;
    pad.userData.initialY = padY;
    pad.userData.baseQuaternion = pad.quaternion.clone();
    group.add(pad);

    // Pick the showcase variant for this orchid slot
    const variant = ORCHID_VARIANTS[i % ORCHID_VARIANTS.length];
    const flower = _buildLotusFlower(rng, variant);
    flower.scale.setScalar(1.45 + rng() * 0.20); // 1.45-1.65 bigger flower
    const flowerY = padY + FLOWER_LIFT_M;
    flower.position.set(x, flowerY, z);
    flower.name = `sanctuary_orchid_flower_${i}_${variant}`;
    flower.userData.anuKind = "sanctuary_orchid_flower";
    flower.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    flower.userData.initialX = x;
    flower.userData.initialZ = z;
    flower.userData.initialY = flowerY;
    flower.userData.baseQuaternion = flower.quaternion.clone();
    group.add(flower);
  }

  // Expose every lily-pad mesh (regular + orchid) so other modules
  // (notably SanctuaryFrogs) can re-use the same beautiful multicoloured
  // lilies as their landing pads instead of building their own low-poly
  // duplicates. User-requested 2026-05-28: "just use the beautiful
  // multicolored lilies get rid of the other ones. Make sure frogs use
  // the new ones."
  if (typeof window !== "undefined") {
    window.__sanctuaryLilyPads = group.children.filter(
      (c) => c.userData?.anuKind === "sanctuary_lily_pad",
    );
  }

  return group;
}

// Pre-allocated static variables at the module scope for Layer 3 Zero-Allocation
const _staticNormal = new THREE.Vector3();
const _staticQuat = new THREE.Quaternion();
const _staticUp = new THREE.Vector3(0, 1, 0);
let _lastFrameCount = 0;
let _turtleGroup = null;

export const SanctuaryPoolModule = {
  name: "SanctuaryPool",

  _scene: null,
  _root: null,
  _waterY: 0,
  _elapsed: 0,
  _lilyPadsGroup: null,

  async load(scene) {
    if (this._root) return;
    this._scene = scene;

    const groundCentre = sanctuaryGroundY(
      SANCTUARY_POOL_CENTER_X,
      SANCTUARY_POOL_CENTER_Z,
    );
    const waterY = groundCentre + SANCTUARY_POOL_DEPTH_M - SANCTUARY_WATER_DROP_M;
    this._waterY = waterY;
    // Park the water-Y where SanctuaryFish + SanctuaryDock can read it
    // without re-importing terrain logic.
    if (typeof window !== "undefined") window.__sanctuaryWaterY = waterY;

    const root = new THREE.Group();
    root.name = "sanctuary_pool_root";
    root.userData.anuId = "environment.sanctuary.pool";
    root.userData.anuKind = "sanctuary_pool";
    root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;

    const textures = await loadPoolTextures();

    root.add(SanctuarySceneConstructor.assertPerformance("SanctuaryPool.buildBasinFloor", () => buildBasinFloor(waterY)));
    root.add(SanctuarySceneConstructor.assertPerformance("SanctuaryPool.buildDrainHole", () => buildDrainHole(waterY)));
    root.add(SanctuarySceneConstructor.assertPerformance("SanctuaryPool.buildWaterSurface", () => buildWaterSurface(waterY, textures)));
    root.add(SanctuarySceneConstructor.assertPerformance("SanctuaryPool.buildRim", () => buildRim(waterY)));
    root.add(SanctuarySceneConstructor.assertPerformance("SanctuaryPool.buildPoolRocks", () => buildPoolRocks(waterY)));
    root.add(SanctuarySceneConstructor.assertPerformance("SanctuaryPool.buildShorelineRocks", () => buildShorelineRocks(waterY)));
    
    // Store reference to build pads so we can update them in update() loop
    const lilies = SanctuarySceneConstructor.assertPerformance("SanctuaryPool.buildLilyPads", () => buildLilyPads(waterY));
    root.add(lilies);
    this._lilyPadsGroup = lilies;

    // Build the majestic photorealistic green turtle
    const turtle = SanctuarySceneConstructor.assertPerformance("SanctuaryPool.buildTurtle", () => buildTurtle(waterY, textures));
    root.add(turtle);
    _turtleGroup = turtle;

    scene.add(root);
    this._root = root;
    console.log(
      `%c[Sanctuary] 💧 Sacred pool ready @ Y=${waterY.toFixed(2)} (radius ${SANCTUARY_POOL_RADIUS_M.toFixed(1)} m)`,
      "color:#80deea;font-weight:bold;",
    );
  },

  update(delta, frameCount) {
    if (!this._root) return;
    this._elapsed += delta;
    _poolTimeUniform.value = this._elapsed;

    // Prioritized Bypassing & Stride Governor: skips frames under stress but maintains a % sampling so as not to freeze entirely.
    const stress = getSystemStressLevel();
    let stride = 1;
    if (stress === STRESS_LEVELS.CRITICAL) {
      stride = 6; // 16.7% sampling to bypass bottleneck without freezing entirely
    } else if (stress === STRESS_LEVELS.STRESS) {
      stride = 2; // 50% sampling
    }
    const ticks = frameCount !== undefined ? frameCount : ++_lastFrameCount;
    if (ticks % stride !== 0) {
      return;
    }

    // Float and tilt the lily pads dynamically in sync with physical Gerstner Waves!
    if (this._lilyPadsGroup) {
      const time = this._elapsed;
      this._lilyPadsGroup.children.forEach((child) => {
        if (child.userData.initialX !== undefined) {
          const x = child.userData.initialX;
          const z = child.userData.initialZ;
          const y0 = child.userData.initialY;
          
          // Compute wave height at coordinate
          const waveHeight = getWaveHeight(x, z, time);
          
          // Sample gradient around the coordinate to evaluate normal slope vector
          const heightX = getWaveHeight(x + 0.1, z, time);
          const heightZ = getWaveHeight(x, z + 0.1, time);
          const slopeX = (heightX - waveHeight) / 0.1;
          const slopeZ = (heightZ - waveHeight) / 0.1;
          
          // Build wave normal slope vector
          // LAYER 3: Zero-Allocation Traversal using pre-allocated module-scoped variables
          _staticNormal.set(-slopeX, 1.0, -slopeZ).normalize();
          
          // Apply vertical height offset
          child.position.y = y0 + waveHeight;
          
          // Tilt matching unit vector rotation
          _staticQuat.setFromUnitVectors(_staticUp, _staticNormal);
          child.quaternion.copy(_staticQuat).multiply(child.userData.baseQuaternion);
        }
      });
    }

    // Update majestic photorealistic green turtle underwater animation
    if (_turtleGroup) {
      const time = this._elapsed;
      
      // Sleepy slow movement: Crawl/swim extremely slowly near the bottom center
      const cx = SANCTUARY_POOL_CENTER_X + Math.sin(time * 0.03) * 0.55;
      const cz = SANCTUARY_POOL_CENTER_Z + Math.cos(time * 0.03) * 0.35;
      _turtleGroup.position.x = cx;
      _turtleGroup.position.z = cz;
      
      // Face the direction of slow movement
      _turtleGroup.rotation.y = time * 0.03 + Math.PI / 2 + Math.sin(time * 0.06) * 0.05;
      
      // Highly subtle, slow breathing bob (Y position)
      _turtleGroup.position.y = (this._waterY - SANCTUARY_POOL_DEPTH_M + 0.05) + Math.sin(time * 0.08) * 0.01;

      // Animate flippers/legs swimming at an ultra-slow, lazy pace
      if (_turtleGroup.userData.flipperLRef) {
        _turtleGroup.userData.flipperLRef.rotation.z = Math.sin(time * 0.20) * 0.06;
        _turtleGroup.userData.flipperLRef.rotation.y = -0.3 + Math.cos(time * 0.20) * 0.03;
      }
      if (_turtleGroup.userData.flipperRRef) {
        _turtleGroup.userData.flipperRRef.rotation.z = -Math.sin(time * 0.20) * 0.06;
        _turtleGroup.userData.flipperRRef.rotation.y = 0.3 - Math.cos(time * 0.20) * 0.03;
      }
      
      // Rear flippers steer lazily
      if (_turtleGroup.userData.flipperBLRef) {
        _turtleGroup.userData.flipperBLRef.rotation.z = Math.cos(time * 0.20) * 0.03;
      }
      if (_turtleGroup.userData.flipperBRRef) {
        _turtleGroup.userData.flipperBRRef.rotation.z = -Math.cos(time * 0.20) * 0.03;
      }
      
      // Highly subtle head bobbing
      if (_turtleGroup.userData.headRef) {
        _turtleGroup.userData.headRef.rotation.x = Math.sin(time * 0.10) * 0.02;
        _turtleGroup.userData.headRef.rotation.y = Math.cos(time * 0.08) * 0.03;
      }
    }
  },


  unload(scene) {
    if (!this._root) return;
    scene.remove(this._root);
    this._root.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        const disposeMat = (m) => {
          m.map?.dispose?.();
          m.normalMap?.dispose?.();
          if (m.userData.uCausticsMapRef) {
            m.userData.uCausticsMapRef.dispose?.();
          }
          m.dispose?.();
        };
        if (Array.isArray(o.material)) o.material.forEach(disposeMat);
        else disposeMat(o.material);
      }
    });
    this._root = null;
    this._scene = null;
    this._lilyPadsGroup = null;
    _turtleGroup = null;
    if (typeof window !== "undefined") delete window.__sanctuaryWaterY;
  },
};
