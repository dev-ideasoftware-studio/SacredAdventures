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
  // Opacity is reduced to 0.58 to allow clear visibility into the depths!
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x0a3438),
    emissive: new THREE.Color(0x042022),
    emissiveIntensity: 0.18,
    roughness: 0.22,            // softer, more natural water reflections instead of a hard glass panel
    metalness: 0.15,            // lower metalness so the deep green water and morphing caustics read beautifully
    normalMap: textures.normal,
    transparent: true,
    opacity: 0.45,              // reduced further to easily see the fish underneath
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

      // Color tuning: Shifting deep bottom colors to a gorgeous mossy emerald green
      vec3 deepColor = mix(vec3(0.005, 0.12, 0.08), vec3(0.015, 0.18, 0.12), 0.5 + ripple * 0.10);
      vec3 shallowColor = mix(vec3(0.03, 0.22, 0.19), vec3(0.08, 0.35, 0.28), 0.5 + ripple * 0.10);
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

function buildBasinFloor(centerY) {
  // Slightly smaller, slightly darker disc just below the water surface
  // — gives the pool depth without exposing the carved terrain.
  const geo = new THREE.CircleGeometry(SANCTUARY_POOL_RADIUS_M * 0.92, 32);
  // Color is blended to have a 40% dark brownish tint matching the earthy basin depth.
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x031d16).lerp(new THREE.Color(0x2a1c0d), 0.4), // deep mossy green with 40% dark brownish tint
    roughness: 1.0,
    metalness: 0.0,
    flatShading: false,
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
function _makeTurtleShellTexture_LEGACY_UNUSED() {
  const SZ = 256;
  const cv = document.createElement("canvas");
  cv.width = SZ; cv.height = SZ;
  const ctx = cv.getContext("2d");
  const cx = SZ / 2, cy = SZ / 2;

  // Base shell color — deep olive green
  ctx.fillStyle = "#273f1d";
  ctx.fillRect(0, 0, SZ, SZ);

  // Draw hexagonal scutes (plates)
  ctx.strokeStyle = "#ffe082"; // golden-yellow seams
  ctx.lineWidth = 2.0;

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

    // Fill with slightly varied shades of green/brown
    ctx.fillStyle = `rgba(${30 + Math.floor(Math.random() * 20)}, ${50 + Math.floor(Math.random() * 30)}, ${20 + Math.floor(Math.random() * 15)}, 0.85)`;
    ctx.fill();

    // Inner growth rings inside each scute for photo-real detail
    ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
    ctx.lineWidth = 1.0;
    for (let r2 = r - 6; r2 > 4; r2 -= 6) {
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
    }
    ctx.strokeStyle = "#ffe082";
    ctx.lineWidth = 2.0;
  };

  // Central column of scutes
  drawHex(cx, cy, 32);
  drawHex(cx, cy - 54, 30);
  drawHex(cx, cy + 54, 30);
  drawHex(cx, cy - 100, 24);
  drawHex(cx, cy + 100, 24);

  // Left column of scutes
  drawHex(cx - 48, cy - 27, 28);
  drawHex(cx - 48, cy + 27, 28);
  drawHex(cx - 45, cy - 81, 24);
  drawHex(cx - 45, cy + 81, 24);

  // Right column of scutes
  drawHex(cx + 48, cy - 27, 28);
  drawHex(cx + 48, cy + 27, 28);
  drawHex(cx + 45, cy - 81, 24);
  drawHex(cx + 45, cy + 81, 24);

  // Edge shading
  const edgeGrad = ctx.createRadialGradient(cx, cy, SZ * 0.35, cx, cy, SZ * 0.5);
  edgeGrad.addColorStop(0, "rgba(0,0,0,0)");
  edgeGrad.addColorStop(1, "rgba(10,20,5,0.85)");
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

  // materials — plain olive-green dome (no scute/vignette canvas texture)
  const shellMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x2f4a22),
    roughness: 0.55,
    metalness: 0.12,
  });

  const skinMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x354b27),
    roughness: 0.85,
    metalness: 0.02,
    bumpMap: textures?.normal,
    bumpScale: 0.015,
  });

  // plastronMat removed with the plastron disc (see "2. Plastron" below).

  const eyeMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x000000),
    roughness: 0.1,
    metalness: 0.9,
  });

  const eyeGlintMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xffffff),
  });

  // 1. Carapace (Shell)
  // Domed shell
  const shellGeo = new THREE.SphereGeometry(0.65, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const shellMesh = new THREE.Mesh(shellGeo, shellMat);
  shellMesh.scale.set(1.15, 0.55, 1.45); // majestic large turtle shell (~2.0m long, ~1.6m wide - bigger than drain!)
  shellMesh.position.y = 0.08;
  shellMesh.castShadow = true;
  shellMesh.receiveShadow = true;
  group.add(shellMesh);

  // 2. Plastron (REMOVED 2026-05-27) — the cylinder had rotation.x = -π/2
  // which tipped its flat circular faces forward/backward instead of
  // laying them flat. From side/oblique angles this read as a stray
  // "circle on the side of the turtle". Per user spec: remove it. The
  // turtle reads fine underwater with just the carapace; the missing
  // belly disc is hidden by the basin floor + water.

  // 3. Head & Neck
  const neckGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.35, 16);
  const neck = new THREE.Mesh(neckGeo, skinMat);
  neck.position.set(0, 0.1, 0.7);
  neck.rotation.x = Math.PI / 3; // angled forward/up
  neck.castShadow = true;
  group.add(neck);

  const headGeo = new THREE.SphereGeometry(0.18, 16, 16);
  const head = new THREE.Mesh(headGeo, skinMat);
  head.scale.set(1.0, 0.85, 1.35); // elongated reptilian head
  head.position.set(0, 0.22, 0.9);
  head.castShadow = true;
  group.add(head);
  group.userData.headRef = head; // save reference for gentle bobbing

  // Eyes
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 8), eyeMat);
  eyeL.position.set(0.14, 0.04, 0.08);
  head.add(eyeL);
  const glintL = new THREE.Mesh(new THREE.SphereGeometry(0.007, 4, 4), eyeGlintMat);
  glintL.position.set(0.015, 0.015, 0.015);
  eyeL.add(glintL);

  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 8), eyeMat);
  eyeR.position.set(-0.14, 0.04, 0.08);
  head.add(eyeR);
  const glintR = new THREE.Mesh(new THREE.SphereGeometry(0.007, 4, 4), eyeGlintMat);
  glintR.position.set(-0.015, 0.015, 0.015);
  eyeR.add(glintR);

  // 4. Flippers (4 legs)
  // Front Flippers (large paddling flippers)
  const frontFlipperGeo = new THREE.BoxGeometry(0.48, 0.03, 0.18);
  const flipperL = new THREE.Mesh(frontFlipperGeo, skinMat);
  flipperL.position.set(0.55, 0.05, 0.42);
  flipperL.rotation.y = -0.3;
  flipperL.castShadow = true;
  group.add(flipperL);
  group.userData.flipperLRef = flipperL;

  const flipperR = new THREE.Mesh(frontFlipperGeo, skinMat);
  flipperR.position.set(-0.55, 0.05, 0.42);
  flipperR.rotation.y = 0.3;
  flipperR.castShadow = true;
  group.add(flipperR);
  group.userData.flipperRRef = flipperR;

  // Rear Flippers (smaller steering flippers)
  const rearFlipperGeo = new THREE.BoxGeometry(0.32, 0.03, 0.15);
  const flipperBL = new THREE.Mesh(rearFlipperGeo, skinMat);
  flipperBL.position.set(0.45, 0.05, -0.45);
  flipperBL.rotation.y = 0.35;
  flipperBL.castShadow = true;
  group.add(flipperBL);
  group.userData.flipperBLRef = flipperBL;

  const flipperBR = new THREE.Mesh(rearFlipperGeo, skinMat);
  flipperBR.position.set(-0.45, 0.05, -0.45);
  flipperBR.rotation.y = -0.35;
  flipperBR.castShadow = true;
  group.add(flipperBR);
  group.userData.flipperBRRef = flipperBR;

  // 5. Tail
  const tailGeo = new THREE.ConeGeometry(0.06, 0.28, 8);
  const tail = new THREE.Mesh(tailGeo, skinMat);
  tail.position.set(0, 0.02, -0.72);
  tail.rotation.x = -Math.PI / 3; // pointing back and slightly down
  tail.castShadow = true;
  group.add(tail);

  // Position turtle near bottom center of the pond
  group.position.set(SANCTUARY_POOL_CENTER_X, y, SANCTUARY_POOL_CENTER_Z);
  group.scale.set(0.9, 0.9, 0.9); // slightly scale to fit perfectly over drain

  return group;
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
  // 0.05 m above its pad keeps every petal cleanly above the pad surface
  // — and above the random Y of every neighboring pad (which all live
  // within centerY+0.02..+0.03), so flowers can no longer be clipped by
  // adjacent lily geometry.
  const FLOWER_LIFT_M = 0.05;
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
      
      // Gently crawl/swim near the bottom center over the drain
      // slow oscillation around the center drain
      const cx = SANCTUARY_POOL_CENTER_X + Math.sin(time * 0.15) * 0.45;
      const cz = SANCTUARY_POOL_CENTER_Z + Math.cos(time * 0.15) * 0.2;
      _turtleGroup.position.x = cx;
      _turtleGroup.position.z = cz;
      
      // Face the direction of movement
      _turtleGroup.rotation.y = time * 0.15 + Math.PI / 2 + Math.sin(time * 0.3) * 0.15;
      
      // Gentle breathing bob (Y position)
      _turtleGroup.position.y = (this._waterY - SANCTUARY_POOL_DEPTH_M * 0.62 + 0.08) + Math.sin(time * 0.4) * 0.025;

      // Animate flippers paddling out-of-phase
      if (_turtleGroup.userData.flipperLRef) {
        _turtleGroup.userData.flipperLRef.rotation.z = Math.sin(time * 0.9) * 0.22;
        _turtleGroup.userData.flipperLRef.rotation.y = -0.3 + Math.cos(time * 0.9) * 0.1;
      }
      if (_turtleGroup.userData.flipperRRef) {
        _turtleGroup.userData.flipperRRef.rotation.z = -Math.sin(time * 0.9) * 0.22;
        _turtleGroup.userData.flipperRRef.rotation.y = 0.3 - Math.cos(time * 0.9) * 0.1;
      }
      
      // Rear flippers steer out-of-phase
      if (_turtleGroup.userData.flipperBLRef) {
        _turtleGroup.userData.flipperBLRef.rotation.z = Math.cos(time * 0.9) * 0.1;
      }
      if (_turtleGroup.userData.flipperBRRef) {
        _turtleGroup.userData.flipperBRRef.rotation.z = -Math.cos(time * 0.9) * 0.1;
      }
      
      // Gentle head bobbing
      if (_turtleGroup.userData.headRef) {
        _turtleGroup.userData.headRef.rotation.x = Math.sin(time * 0.4) * 0.06;
        _turtleGroup.userData.headRef.rotation.y = Math.cos(time * 0.35) * 0.08;
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
