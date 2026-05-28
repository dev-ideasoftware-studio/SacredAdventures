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

    // Physically displace vertices vertically in local Z space to create real undulating 3D waves!
    // We implement a dual-wave Gerstner Wave system (Trochoidal Wave physics) for true fluid dynamics,
    // displacing vertices both horizontally (crowding at peaks) and vertically, with all speeds reduced by 200% more (3x slower).
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `
      #include <begin_vertex>
      
      // Two interfering Gerstner Waves simulating physical fluid dynamics (steep peaks, flat troughs, ultra-meditative speed)
      float time = uTime;
      float vDist = length(uv - vec2(0.5));
      float shoreFade = smoothstep(0.48, 0.35, vDist);
      
      // Wave 1: Traveling North-East
      vec2 d1 = normalize(vec2(0.9, 0.5));
      float phase1 = dot(uv - vec2(0.5), d1) * 9.0 - time * 0.15;
      float z1 = sin(phase1) * 0.005; // Ultra-flat wave height for a pond
      float h1 = cos(phase1) * 0.003;
      
      // Wave 2: Traveling North-West (interference wave)
      vec2 d2 = normalize(vec2(-0.4, 0.9));
      float phase2 = dot(uv - vec2(0.5), d2) * 11.5 + time * 0.12;
      float z2 = sin(phase2) * 0.003;
      float h2 = cos(phase2) * 0.002;
      
      // Combine displacements and apply shoreline dampening
      transformed.x += (h1 * d1.x + h2 * d2.x) * shoreFade;
      transformed.y += (h1 * d1.y + h2 * d2.y) * shoreFade;
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
      
      // High-performance color ripples
      vec2 pUv = vUv * 2.0; // wider, softer ripples
      float w1 = sin(pUv.x * 0.85 + pUv.y * 0.40 + time * 0.05);
      float w2 = sin(pUv.x * -0.35 + pUv.y * 0.95 + time * 0.04);
      float ripple = (w1 + w2) * 0.5;

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
  mesh.layers.enable(1); // Show in PiP map
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

  // Warm sandy-mud base (desaturated — no greenish cast)
  ctx.fillStyle = "#3d2f20";
  ctx.fillRect(0, 0, SZ, SZ);

  const cx = SZ / 2, cy = SZ / 2;

  // DARK SAND CENTER — soft radial patch of settled deeper sediment.
  // Real ponds darken toward the deep middle, not the shallow rim.
  // Reaches ~60% of the disc with a smooth falloff.
  const darkCenter = ctx.createRadialGradient(cx, cy, 0, cx, cy, SZ * 0.42);
  darkCenter.addColorStop(0.00, "rgba(20, 14, 8, 0.85)");
  darkCenter.addColorStop(0.45, "rgba(28, 20, 12, 0.55)");
  darkCenter.addColorStop(1.00, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = darkCenter;
  ctx.beginPath(); ctx.arc(cx, cy, SZ * 0.42, 0, Math.PI * 2); ctx.fill();

  // Low-frequency silt blobs — lighter alpha so they read as variance not patches.
  // No greens — only brown/sand tones.
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * SZ;
    const y = Math.random() * SZ;
    const r = 60 + Math.random() * 180;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = Math.random() < 0.5;
    grad.addColorStop(0, dark ? "rgba(24, 18, 10, 0.32)" : "rgba(86, 70, 48, 0.28)");
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
    // Mixed grays/browns/tans — no greens
    let fill;
    if (tier < 0.35) {
      const s = 25 + Math.floor(Math.random() * 35);
      fill = `rgba(${s}, ${s - 4}, ${s - 10}, 0.55)`;     // dark gravel
    } else if (tier < 0.70) {
      const s = 70 + Math.floor(Math.random() * 30);
      fill = `rgba(${s}, ${s - 10}, ${s - 22}, 0.50)`;    // brown pebble
    } else {
      const s = 120 + Math.floor(Math.random() * 40);
      fill = `rgba(${s}, ${s - 18}, ${s - 38}, 0.45)`;    // light sandy pebble
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

function buildBasinFloor(centerY) {
  // Higher-res disc so the procedural texture has fragments to interpolate
  // across (32 segs was fine for a flat color; 64 gives the silt streaks
  // and edge vignette smoother curvature at the rim).
  const geo = new THREE.CircleGeometry(SANCTUARY_POOL_RADIUS_M * 0.92, 64);
  const floorTex = _makeBasinFloorTexture();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, // let the texture carry the color
    map: floorTex,
    bumpMap: floorTex,
    bumpScale: 0.06,
    roughnessMap: floorTex,
    roughness: 0.95,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(
    SANCTUARY_POOL_CENTER_X,
    centerY - SANCTUARY_POOL_DEPTH_M * 0.62,
    SANCTUARY_POOL_CENTER_Z,
  );
  mesh.receiveShadow = true;
  mesh.layers.enable(1); // Show in PiP map
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
  const y = centerY - SANCTUARY_POOL_DEPTH_M * 0.62 + 0.005; // Elevated a tiny bit to prevent z-fighting with basin floor

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

  const y = centerY - SANCTUARY_POOL_DEPTH_M * 0.62 + 0.08; // slightly above floor

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
  const rockPalette = [
    new THREE.Color(0x181a1c), // slate black
    new THREE.Color(0x2c241c), // warm muddy brown
    new THREE.Color(0x382a1c), // medium clay brown
    new THREE.Color(0x2a221a), // wet dirt
    new THREE.Color(0x1a1612), // dark silt
    new THREE.Color(0x4a3a26), // sandy tan stone
  ];
  const pebblePalette = [
    new THREE.Color(0x5a4a35), // sandy tan
    new THREE.Color(0x6b5a40), // cream stone
    new THREE.Color(0x3a3025), // dirty brown
    new THREE.Color(0x4a4035), // medium silt
    new THREE.Color(0x554838), // ochre pebble
  ];

  const ROCKS_DODEC_COUNT = 175;
  const ROCKS_ICOS_COUNT  = 150;
  const PEBBLE_COUNT      = 420;

  const dodecGeo  = new THREE.DodecahedronGeometry(1.0, 0);
  const icosGeo   = new THREE.IcosahedronGeometry(1.0, 0);
  const pebbleGeo = new THREE.OctahedronGeometry(1.0, 0);

  const rockMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, // per-instance color carries tint
    roughness: 0.92,
    metalness: 0.04,
    flatShading: true,
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
      let r = 0.12 + rng() * 0.48; // 0.12–0.60m
      if (rng() < 0.15) r *= 1.4;  // 15% larger boulders → 0.84m

      const scaleX = r * (0.85 + rng() * 0.35);
      const scaleY = r * (0.40 + rng() * 0.30); // flat vertical
      const scaleZ = r * (0.85 + rng() * 0.35);

      const theta = rng() * Math.PI * 2;
      const minD = 0.65 + scaleX;
      const maxD = SANCTUARY_POOL_RADIUS_M * 0.88 - scaleX;
      const actualMaxD = Math.max(minD + 0.1, maxD);
      const d = minD + rng() * (actualMaxD - minD);

      const x = SANCTUARY_POOL_CENTER_X + Math.cos(theta) * d;
      const z = SANCTUARY_POOL_CENTER_Z + Math.sin(theta) * d;
      const y = bottomY - 0.05 + rng() * 0.05 + scaleY * 0.3;

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
  dodecMesh.layers.enable(1);
  dodecMesh.name = "sanctuary_pool_rocks_dodec";
  dodecMesh.userData.anuKind = "sanctuary_pool_rock";
  dodecMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  populateRocks(dodecMesh, ROCKS_DODEC_COUNT, rockPalette);
  group.add(dodecMesh);

  const icosMesh = new THREE.InstancedMesh(icosGeo, rockMat, ROCKS_ICOS_COUNT);
  icosMesh.castShadow = true;
  icosMesh.receiveShadow = true;
  icosMesh.layers.enable(1);
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
  pebbleMesh.layers.enable(1);
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
      const d = minD + rng() * (maxD - minD);
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
    const y = bottomY - 0.02 + rng() * 0.03 + scaleY * 0.3;

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
  microMesh.layers.enable(1);
  microMesh.name = "sanctuary_pool_micro_pebbles";
  microMesh.userData.anuKind = "sanctuary_pool_micro_pebble";
  microMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  // Mix mossy greens into the micro-pebble palette so the gravel bed
  // reads as "alive / damp" instead of a uniform dry pile.
  const microPalette = [
    new THREE.Color(0x554838), // ochre stone (re-use)
    new THREE.Color(0x3a3025), // dirty brown
    new THREE.Color(0x4a4035), // medium silt
    new THREE.Color(0x665540), // pale sand
    new THREE.Color(0x3d4a2a), // mossy green (interweave)
    new THREE.Color(0x4a5a36), // brighter moss
    new THREE.Color(0x2f3a24), // dark moss
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
    _pos.set(x, bottomY - 0.005 + rng() * 0.015 + sBase * 0.3, z);
    _scl.set(sBase * (0.85 + rng() * 0.35), sBase * (0.55 + rng() * 0.25), sBase * (0.85 + rng() * 0.35));
    _m.compose(_pos, _quat, _scl);
    microMesh.setMatrixAt(i, _m);
    microMesh.setColorAt(i, microPalette[Math.floor(rng() * microPalette.length)]);
  }
  microMesh.instanceMatrix.needsUpdate = true;
  if (microMesh.instanceColor) microMesh.instanceColor.needsUpdate = true;
  group.add(microMesh);

  // ── MOSS TUFTS — green blades interwoven with the rocks ───────────
  // 1500 instanced crossed-quad tufts (4 tris each), 0.03–0.08 m tall.
  // Each tuft is two thin planes crossed at 90° so the silhouette
  // reads from any angle. Half the tufts are placed AT existing rock
  // anchor positions (offset slightly) so they grow *between* the
  // rocks like wet moss; the other half scatter free across the floor.
  const MOSS_COUNT = 1500;
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
  mossMesh.layers.enable(1);
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
    if (rockAnchors.length && rng() < 0.55) {
      // 55%: grow near an existing rock anchor — interweaves with stones
      const anchor = rockAnchors[Math.floor(rng() * rockAnchors.length)];
      const clusterR = anchor.r * 0.6 + rng() * 0.35;
      const clusterTheta = rng() * Math.PI * 2;
      x = anchor.x + Math.cos(clusterTheta) * clusterR;
      z = anchor.z + Math.sin(clusterTheta) * clusterR;
    } else {
      // 45%: free scatter across the floor
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

    const tuftH = 0.03 + rng() * 0.05;          // 0.03–0.08 m tall
    const tuftW = tuftH * (0.6 + rng() * 0.6);  // slight width variance
    _euler.set(0, rng() * Math.PI * 2, 0);       // random Y rotation only — tufts stand upright
    _quat.setFromEuler(_euler);
    _pos.set(x, bottomY, z);
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
function _buildLotusFlower(rng) {
  const flower = new THREE.Group();

  // Outer petal ring (8 petals, outer-most, deepest pink)
  const outerMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xf7c4d5),
    emissive: new THREE.Color(0x331a23),
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

  // Inner petal ring (6 petals, lighter)
  const innerMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xfde6ef),
    emissive: new THREE.Color(0x402028),
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

  // Central pistil (gold/yellow)
  const pistilMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xf2c94c),
    emissive: new THREE.Color(0x6b4a10),
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

// Physical wave height sampler — matches the vertex shader's dual-wave Gerstner Wave interference model
// to allow floating lily pads and flowers to follow the undulating surface in real time.
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
  
  // Wave 1: Traveling North-East
  const d1X = 0.9 / Math.hypot(0.9, 0.5);
  const d1Y = 0.5 / Math.hypot(0.9, 0.5);
  const phase1 = ((uvX - 0.5) * d1X + (uvY - 0.5) * d1Y) * 9.0 - time * 0.15;
  const z1 = Math.sin(phase1) * 0.005;
  
  // Wave 2: Traveling North-West (interference wave)
  const d2X = -0.4 / Math.hypot(-0.4, 0.9);
  const d2Y = 0.9 / Math.hypot(-0.4, 0.9);
  const phase2 = ((uvX - 0.5) * d2X + (uvY - 0.5) * d2Y) * 11.5 + time * 0.12;
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

    // ~45% of pads carry a beautiful lotus flower.
    if (rng() < 0.45) {
      const flower = _buildLotusFlower(rng);
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
  // centre. These are visually distinct from the regular 14 pads —
  // 1.6× scale, paired with a slightly larger orchid-style flower
  // (rotated lotus + warmer pink-purple tint), placed within a ~3 m
  // ring around the pool centre so they read as the "centrepiece".
  const ORCHID_PADS = 3;
  const ORCHID_RING_RADIUS_M = 2.8; // close to centre, but outside the drain
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
    pad.scale.setScalar(1.55 + rng() * 0.25); // 1.55–1.80 — clearly bigger than regular pads (0.55–1.0)
    pad.name = `sanctuary_orchid_pad_${i}`;
    pad.userData.anuKind = "sanctuary_lily_pad";
    pad.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    pad.receiveShadow = true;
    pad.userData.initialX = x;
    pad.userData.initialZ = z;
    pad.userData.initialY = padY;
    pad.userData.baseQuaternion = pad.quaternion.clone();
    group.add(pad);

    const flower = _buildLotusFlower(rng);
    // Tint every petal toward warm pink-purple so the orchid reads
    // distinct from the standard cream lotus
    flower.traverse((ch) => {
      if (ch.isMesh && ch.material && ch.material.color) {
        // Clone the material so the regular lotus pads stay unaffected
        ch.material = ch.material.clone();
        ch.material.color = new THREE.Color(0xe6a8c8).lerp(ch.material.color, 0.35);
      }
    });
    flower.scale.setScalar(1.45 + rng() * 0.20); // 1.45–1.65 bigger flower
    const flowerY = padY + FLOWER_LIFT_M;
    flower.position.set(x, flowerY, z);
    flower.name = `sanctuary_orchid_flower_${i}`;
    flower.userData.anuKind = "sanctuary_orchid_flower";
    flower.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    flower.userData.initialX = x;
    flower.userData.initialZ = z;
    flower.userData.initialY = flowerY;
    flower.userData.baseQuaternion = flower.quaternion.clone();
    group.add(flower);
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
      _turtleGroup.position.y = (this._waterY - SANCTUARY_POOL_DEPTH_M * 0.62 + 0.05) + Math.sin(time * 0.08) * 0.01;

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
