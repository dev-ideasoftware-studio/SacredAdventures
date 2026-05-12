import * as THREE from "three";
import { GLTFLoaderWithDraco } from "./gltfLoaderSetup.js";
import {
  ANU_INTERACTION_VERB,
  ANU_SIMULATION_DOMAIN,
} from "./anu/SimulationController.js";
import {
  V2_NPC_BHG_TIPI2_GOLD_CIRCLE_LIFT_M,
  V2_NPC_BHG_TIPI2_GOLD_CIRCLE_RADIUS_M,
  V2_NPC_BHG_TIPI2_LOCAL_X_M,
  V2_NPC_BHG_TIPI2_LOCAL_Z_M,
  V2_NPC_BHG_TIPI2_MODEL_YAW_RAD,
  V2_NPC_BHG_TIPI2_PLAYER_AIM_YAW_BIAS_RAD,
  V2_NPC_BHG_TIPI2_SEAT_LOWER_M,
  V2_NPC_BHG_TIPI2_SIZE_MULTIPLIER,
  V2_NPC_BHG_TIPI2_TARGET_HEIGHT_M,
  V2_NPC_BHG_TIPI2_VERTICAL_TRIM_M,
  V2_NPC_YB_TIPI1_GOLD_CIRCLE_LIFT_M,
  V2_NPC_YB_TIPI1_GOLD_CIRCLE_RADIUS_M,
  V2_NPC_YB_TIPI1_LOCAL_X_M,
  V2_NPC_YB_TIPI1_LOCAL_Z_M,
  V2_NPC_YB_TIPI1_MODEL_YAW_RAD,
  V2_NPC_YB_TIPI1_PLAYER_AIM_YAW_BIAS_RAD,
  V2_NPC_YB_TIPI1_SEAT_LOWER_M,
  V2_NPC_YB_TIPI1_SIZE_MULTIPLIER,
  V2_NPC_YB_TIPI1_TARGET_HEIGHT_M,
  V2_NPC_YB_TIPI1_VERTICAL_TRIM_M,
  V2_TIPI_2_CENTER_X_M,
  V2_TIPI_2_CENTER_Z_M,
  V2_TIPI_2_YAW_RAD,
  V2_TIPI_BRAZIER_ABOVE_DECK_M,
  V2_TIPI_BRAZIER_WORLD_X_M,
  V2_TIPI_BRAZIER_WORLD_Z_M,
  V2_TIPI_NPC_CEREMONIAL_FIRE_ABOVE_GROUND_M,
  V2_TIPI_NPC_CEREMONIAL_FIRE_LOCAL_X_M,
  V2_TIPI_NPC_CEREMONIAL_FIRE_LOCAL_Z_M,
  V2_TIPI_NPC_CEREMONIAL_FIRE_SCALE,
  V2_TIPI_SACRED_PLATFORM_CENTER_Y,
  V2_TIPI_SACRED_PLATFORM_HEIGHT,
  V2_TIPI_SACRED_PLATFORM_RADIUS,
  V2_TIPI_SMOKE_ABOVE_APEX_M,
  V2_TIPI_YELLOW_BUTTERFLY_TARGET_HEIGHT_M,
} from "./constants.js";
import { applyPipOrthoRingDiskClipToSubtree } from "./anu/PipOrthoRingDiskClip.js";
import {
  createPhotorealTravelDiscMaterial,
  createPhotorealTravelRingMaterial,
  touchTravelCircleTime,
} from "./anu/TravelFloorCircleMaterials.js";
import { createTipiCampfire, createTipiSmokePlume } from "./TipiCampfire.js";
import { terrainY } from "./WorldTerrain.js";
import { getRuntimeService } from "./RuntimeServices.js";
import { createTipiOwnerBehaviour } from "./NPCBehaviour.js";

/** Legacy primary yellow butterfly tipi path — WORDPRESS bundle mirrors original Assets layout. */
const TIPI_1_URL = "./WORDPRESS/Assets/Tipi.yellowbutterfly/tipi.yellowbutterfly.glb";
/** Yellow Butterfly character — seated host at tipi 1 only (fresh minimal path; no proximity FSM). */
const NPC_YB_URL = "./Assets/NPC.YB.glb";
/**
 * Tipi 2 reuses tipi 1's visual asset (same village vocabulary). When a
 * unique BHG tipi GLB is sourced, change just this constant.
 */
const TIPI_2_URL = TIPI_1_URL;
/**
 * Brings Happiness Girl — seated host at tipi 2. Note: this GLB is ~105 MB
 * uncompressed vs NPC.YB.glb's 8 MB Draco-compressed. First-load will be
 * slow until the asset is re-baked with Draco compression. Tracked in the
 * ANU memory card `tipi-owner-proximity-behaviour`.
 */
const NPC_BHG_URL = "./Assets/NPC.BHG.glb";

/** Platform deck world Y (top of sacred cylinder under tipi 1). */
export function tipi1SacredDeckTopY(platMesh) {
  return platMesh.position.y + V2_TIPI_SACRED_PLATFORM_HEIGHT * 0.5;
}

/**
 * Gold deck decal only (disc + ring) — stays on `root` while rig + arrow rotate in `ybFacingGroup`.
 *
 * `opts.npcKey` / `opts.npcSlug` parameterise the mesh names and ANU ids so
 * the same helper can be reused per NPC without collisions in ANU's id
 * namespace. Defaults preserve YB tipi 1 behaviour exactly.
 */
function addGoldTravelFloorDecalAtFeet(group, radius, liftY, opts = {}) {
  const R = radius;
  const lift = liftY;
  const innerR = R * 0.92;
  const npcKey = opts.npcKey ?? "yb";
  const npcSlug = opts.npcSlug ?? "yellow_butterfly";

  const discMat = createPhotorealTravelDiscMaterial("npc", R);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 72), discMat);
  disc.name = `population_npc_${npcKey}_gold_travel_disc`;
  disc.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
  disc.userData.anuKind = `npc_${npcKey}_travel_disc`;
  disc.userData.anuId = `population.npc.${npcSlug}.gold_disc`;
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = lift;
  disc.renderOrder = 8;
  group.add(disc);

  const ringMat = createPhotorealTravelRingMaterial("npc", innerR, R);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(innerR, R, 96),
    ringMat,
  );
  ring.name = `population_npc_${npcKey}_gold_travel_ring`;
  ring.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
  ring.userData.anuKind = `npc_${npcKey}_travel_ring`;
  ring.userData.anuId = `population.npc.${npcSlug}.gold_ring`;
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = lift + 0.008;
  ring.renderOrder = 9;
  group.add(ring);

  return [discMat, ringMat];
}

/**
 * Facing arrow mesh (−Z in pivot space after `rotation.x = −π/2`). Parent:
 * `ybFacingGroup`. Tip is built at −Y in shape space so that after the
 * rotation the arrow points in the seated host's forward direction (the
 * opposite side of her disc to where it pointed prior — see ANU memory
 * card `npc-yb-tipi-scene-polish`).
 */
function createGoldTravelFacingArrowMesh(radius, localY, opts = {}) {
  const R = radius;
  const npcKey = opts.npcKey ?? "yb";
  const npcSlug = opts.npcSlug ?? "yellow_butterfly";
  const arrowShape = new THREE.Shape()
    .moveTo(0, -R * 0.92)
    .lineTo(R * 0.22, -R * 0.52)
    .lineTo(-R * 0.22, -R * 0.52)
    .lineTo(0, -R * 0.92);
  const arrow = new THREE.Mesh(
    new THREE.ShapeGeometry(arrowShape),
    new THREE.MeshBasicMaterial({
      color: 0xfff4b3,
      transparent: true,
      opacity: 0.96,
      side: THREE.DoubleSide,
      // Match the shared travel-floor-decal policy (ANU memory:
      // travel-floor-decal-depth). depthTest off + renderOrder 10 keeps
      // the arrow readable on the sacred deck and on tilted terrain
      // alike, with no polygonOffset artefacts.
      depthTest: false,
      depthWrite: false,
    }),
  );
  arrow.name = `population_npc_${npcKey}_gold_travel_arrow`;
  arrow.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
  arrow.userData.anuKind = `npc_${npcKey}_travel_arrow`;
  arrow.userData.anuId = `population.npc.${npcSlug}.gold_arrow`;
  arrow.rotation.x = -Math.PI / 2;
  arrow.position.y = localY;
  arrow.renderOrder = 10;
  return arrow;
}

/**
 * Soft additive halo behind the seated host's headdress — gives a subtle
 * "saintly" glow without adding a full PointLight. Generated from a tiny
 * canvas radial gradient so we never have to ship a halo PNG asset.
 *
 * Sprite always faces the camera; depthTest:false lets the additive light
 * read through the headdress silhouette as a gentle bloom rather than a
 * hard disc occluded by hair / feathers.
 */
function createNpcEtherealHaloSprite(diameterMetres, opts = {}) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2 - 4);
  grad.addColorStop(0.0, "rgba(255, 248, 210, 0.95)");
  grad.addColorStop(0.32, "rgba(255, 220, 130, 0.55)");
  grad.addColorStop(0.62, "rgba(255, 180, 80, 0.18)");
  grad.addColorStop(1.0, "rgba(255, 160, 60, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;

  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const halo = new THREE.Sprite(mat);
  halo.scale.set(diameterMetres, diameterMetres, 1);
  halo.renderOrder = 11;
  const npcKey = opts.npcKey ?? "yb";
  const npcSlug = opts.npcSlug ?? "yellow_butterfly";
  halo.name = `population_npc_${npcKey}_ethereal_halo`;
  halo.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
  halo.userData.anuKind = `npc_${npcKey}_ethereal_halo`;
  halo.userData.anuId = `population.npc.${npcSlug}.halo`;
  return halo;
}

/**
 * Aim seated YB rig + gold arrow toward the player on XZ (`World` passes physics/camera body XZ).
 * `ybFacingGroup.rotation.y = atan2(dx, dz)` aligns local +Z with (player − YB); matches Three.js Ry.
 */
export function updateYellowButterflyPlayerAim(tipi, playerX, playerZ) {
  const fg = tipi?.userData?.ybFacingGroup;
  const root = tipi?.userData?.ybSeatRoot;
  if (!fg || !root) return;
  const dx = playerX - root.position.x;
  const dz = playerZ - root.position.z;
  if (dx * dx + dz * dz < 1e-10) return;
  fg.rotation.y = Math.atan2(dx, dz) + V2_NPC_YB_TIPI1_PLAYER_AIM_YAW_BIAS_RAD;
  const mats = tipi?.userData?.ybTravelCircleMaterials;
  if (Array.isArray(mats)) {
    const t = (typeof performance !== "undefined" ? performance.now() : 0) * 0.001;
    for (let i = 0; i < mats.length; i++) touchTravelCircleTime(mats[i], t);
  }
}

/**
 * Loads `NPC.YB.glb` seated on the tipi 1 cylinder deck (inside / centre area).
 * Animation: sit clip by name (`sit`, `003`, …) or legacy index **3** fallback (`EnvironmentBuilder.js`).
 *
 * Bind pose: `V2_NPC_YB_TIPI1_MODEL_YAW_RAD` on the mesh inside `ybFacingGroup`, which is rotated each frame toward the player.
 */
async function attachYellowButterflySeatedTipi1(scene, objects, platMesh, tipi) {
  try {
    const gltf = await new GLTFLoaderWithDraco().loadAsync(NPC_YB_URL);
    const model = gltf.scene;
    model.name = "population_npc_yb_model";
    model.rotation.y = V2_NPC_YB_TIPI1_MODEL_YAW_RAD;

    model.traverse((ch) => {
      if (ch.isMesh || ch.isSkinnedMesh) {
        ch.castShadow = false;
        ch.receiveShadow = false;
        ch.frustumCulled = true;
        ch.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
        ch.userData.anuKind = "npc_yb_tipi1_rig_mesh";
        const nm = (ch.name || "mesh").replace(/\s+/g, "_").slice(0, 48);
        ch.userData.anuId = `population.npc.yellow_butterfly.mesh.${nm}`;
      }
    });

    const box0 = new THREE.Box3().setFromObject(model);
    const size0 = new THREE.Vector3();
    box0.getSize(size0);
    const baseSc =
      size0.y > 0.001 ? V2_NPC_YB_TIPI1_TARGET_HEIGHT_M / size0.y : 1;
    const sc = baseSc * V2_NPC_YB_TIPI1_SIZE_MULTIPLIER;
    model.scale.setScalar(sc);
    model.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(model);
    /** Soles on group origin plane. */
    model.position.y = -box.min.y;
    /**
     * Centre the model on its bbox X/Z so the seated host sits over the
     * disc centre (the GLB's internal pivot is offset to one side; without
     * this the figure read "off to the side" of the gold travel disc).
     * See ANU memory card `npc-yb-tipi-scene-polish`.
     */
    const boxCenter = box.getCenter(new THREE.Vector3());
    model.position.x = -boxCenter.x;
    model.position.z = -boxCenter.z;
    /** Re-derive scaled height for halo placement (post-centre). */
    const scaledHeight = box.max.y - box.min.y;

    const root = new THREE.Group();
    root.name = "population_npc_yellow_butterfly_tipi1_seated";
    root.userData.anuId = "population.npc.yellow_butterfly";
    root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
    root.userData.anuKind = "npc_yb_tipi1_seated";
    root.userData.anuInteractable = true;
    root.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.INSPECT];
    root.userData.anuCollision = "passable";
    root.userData.anuLegacyReference =
      "EnvironmentBuilder.js NPC.YB — seated only (fresh v2 attachment)";

    const ybTravelCircleMats = addGoldTravelFloorDecalAtFeet(
      root,
      V2_NPC_YB_TIPI1_GOLD_CIRCLE_RADIUS_M,
      V2_NPC_YB_TIPI1_GOLD_CIRCLE_LIFT_M,
    );

    const lift = V2_NPC_YB_TIPI1_GOLD_CIRCLE_LIFT_M;
    const facingGroup = new THREE.Group();
    facingGroup.name = "population_npc_yb_facing";
    facingGroup.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
    facingGroup.userData.anuKind = "npc_yb_facing_pivot";
    facingGroup.userData.anuId = "population.npc.yellow_butterfly.facing_pivot";

    const arrow = createGoldTravelFacingArrowMesh(
      V2_NPC_YB_TIPI1_GOLD_CIRCLE_RADIUS_M,
      lift + 0.015,
    );
    facingGroup.add(model);
    facingGroup.add(arrow);

    /**
     * Slight ethereal halo behind the headdress — sized to ~1.4× of the
     * "head crown" position above her soles (sprite is camera-aligned so
     * the diameter is in world metres). Sits at the head height in
     * facingGroup local space. Subtle by design.
     *
     * Note: PiP ortho ring clip currently handles Mesh/Points only — a
     * SpriteMaterial path is out of scope here. The halo's small
     * world-space diameter makes it a sub-pixel dot on the PiP minimap,
     * which reads as a faint location marker rather than an artefact.
     */
    const halo = createNpcEtherealHaloSprite(scaledHeight * 0.55);
    halo.position.set(0, scaledHeight * 0.92, 0);
    facingGroup.add(halo);

    root.add(facingGroup);

    const deckTop = tipi1SacredDeckTopY(platMesh);
    root.position.set(
      V2_NPC_YB_TIPI1_LOCAL_X_M,
      deckTop + V2_NPC_YB_TIPI1_VERTICAL_TRIM_M - V2_NPC_YB_TIPI1_SEAT_LOWER_M,
      V2_NPC_YB_TIPI1_LOCAL_Z_M,
    );

    scene.add(root);
    objects.push(root);

    const clips = gltf.animations ?? [];
    let sitClip = null;
    for (const c of clips) {
      const nm = String(c.name ?? "").toLowerCase();
      if (nm.includes("sit") || nm.includes("sitting") || nm.includes("003")) {
        sitClip = c;
        break;
      }
    }
    if (!sitClip && clips.length > 3) sitClip = clips[3];

    let mixer = null;
    if (sitClip) {
      mixer = new THREE.AnimationMixer(model);
      const act = mixer.clipAction(sitClip);
      act.setLoop(THREE.LoopRepeat, Infinity);
      act.clampWhenFinished = false;
      act.play();
      root.userData.anuActiveAnimation = { kind: "sit", clip: sitClip.name };
    }

    if (tipi) {
      tipi.userData.ybNpcMixer = mixer;
      tipi.userData.ybFacingGroup = facingGroup;
      tipi.userData.ybSeatRoot = root;
      tipi.userData.ybTravelCircleMaterials = ybTravelCircleMats;

      /**
       * Tipi-owner proximity behaviour controller — owns the NPC's pose
       * whenever the player crosses the 1-tile threshold (wave + walk out,
       * stand idle facing the player, walk back, turnaround, sit).
       * See `js/v2/NPCBehaviour.js`. World.js drives `update()` each frame
       * and honours `suppressPlayerAim` so the seated aim helper doesn't
       * fight the controller while she's in motion.
       */
      if (mixer && clips.length > 0) {
        try {
          const physics = getRuntimeService("WorldPhysics");
          const getGroundY =
            physics && typeof physics.getGroundY === "function"
              ? physics.getGroundY.bind(physics)
              : null;
          if (getGroundY) {
            tipi.userData.ybBehaviour = createTipiOwnerBehaviour({
              npcId: "npc_yb_tipi1",
              tipi,
              root,
              facingGroup,
              model,
              mixer,
              clips,
              tipiCenter: { x: 0, z: 0 },
              /**
               * Entrance position is provisional pending the May-11 2026
               * tipi-orientation forensic. The NPC walks from her seat to
               * `(0, ?, -2.6)` regardless of where the GLB's doorway flap
               * is actually sculpted — this lands her 2.6 m south of
               * centre, on the platform deck, between the tipi and the
               * approaching player.
               */
              entranceLocalXZ: { x: 0, z: -2.6 },
              getGroundY,
            });
          } else {
            console.warn(
              "[World] NPC.YB tipi1 owner behaviour skipped — WorldPhysics unavailable.",
            );
          }
        } catch (behaviourErr) {
          console.warn("[World] NPC.YB tipi1 owner behaviour wire failed:", behaviourErr);
        }
      }
    }

    console.log("%c[World] NPC.YB seated at tipi 1 (minimal load)", "color:#ce93d8;");
    return { root, mixer };
  } catch (e) {
    console.warn("[World] NPC.YB seated load failed:", e);
    return null;
  }
}

/**
 * Center Tipi + sacred green cylinder platform — 1:1 with legacy js/EnvironmentBuilder.js:
 * - tipi target height 7.2 m (trees scaled to V2_TREE_TEMPLATE_TARGET_HEIGHT_M in Trees.js)
 * - cylinder platRadius 4.7, height 0.22, colour 0x1a2e1a, center Y = terrain + 0.05
 */
export async function loadCenterTipi({ scene, objects, worldPhysics }) {
  const hexPos = { x: 0, z: 0 };
  const platformY = terrainY(hexPos.x, hexPos.z);
  if (typeof window !== "undefined") {
    window._tipiPlatformY = platformY;
  }

  const platRadius = V2_TIPI_SACRED_PLATFORM_RADIUS;
  const platH = V2_TIPI_SACRED_PLATFORM_HEIGHT;
  const platGeo = new THREE.CylinderGeometry(
    platRadius,
    platRadius + 0.15,
    platH,
    32,
  );
  const platMat = new THREE.MeshStandardMaterial({
    color: 0x1a2e1a,
    roughness: 0.9,
    metalness: 0.1,
  });
  const platMesh = new THREE.Mesh(platGeo, platMat);
  platMesh.name = "structure_tipi_1_sacred_platform";
  platMesh.position.set(hexPos.x, platformY + V2_TIPI_SACRED_PLATFORM_CENTER_Y, hexPos.z);
  platMesh.castShadow = false;
  platMesh.receiveShadow = true;
  platMesh.userData.anuId = "structure.tipi_1.sacred_platform";
  platMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
  platMesh.userData.anuKind = "tipi_sacred_circle_platform";
  platMesh.userData.anuInteractable = true;
  platMesh.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.INSPECT];
  platMesh.userData.anuLegacyReference = "EnvironmentBuilder.js Sacred Circle Platform";

  scene.add(platMesh);
  objects.push(platMesh);

  try {
    const gltf = await new GLTFLoaderWithDraco().loadAsync(TIPI_1_URL);
    const tipi = gltf.scene;
    tipi.name = "structure_tipi_1_center";

    const box = new THREE.Box3().setFromObject(tipi);
    const size = new THREE.Vector3();
    box.getSize(size);
    const targetH = V2_TIPI_YELLOW_BUTTERFLY_TARGET_HEIGHT_M;
    const sf = targetH / Math.max(size.y, 0.1);
    tipi.scale.set(sf, sf, sf);

    // NOTE: this yaw is currently UNDER FORENSIC REVIEW (May-11 2026).
    // The user reports the tipi visually faces east despite the math
    // implying south. Treat this value as provisional until the
    // ground-truth GLB orientation is empirically pinned down.
    tipi.rotation.y = Math.PI;
    tipi.updateMatrixWorld(true);

    box.setFromObject(tipi);
    const center = box.getCenter(new THREE.Vector3());

    tipi.position.set(
      hexPos.x - center.x + tipi.position.x,
      platformY - box.min.y - 0.05,
      hexPos.z - center.z + tipi.position.z,
    );

    tipi.userData.anuId = "structure.tipi_1.center";
    tipi.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
    tipi.userData.anuKind = "tipi_1_non_colliding";
    tipi.userData.anuInteractable = true;
    tipi.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.INSPECT];
    tipi.userData.anuCollision = "passable";
    tipi.userData.anuCollisionReason =
      "Tipi models are explicitly excluded from object collision.";
    tipi.userData.anuLegacyReference =
      "EnvironmentBuilder.js TIPI yellowbutterfly — targetH 7.2, rotation -π/2";

    platMesh.userData.buildingRoot = tipi;

    tipi.traverse((child) => {
      if (child.isMesh || child.isSkinnedMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        child.userData.anuCollision = "passable";
        child.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
        child.userData.anuKind = "tipi_yellow_butterfly_mesh";
        const msh = (child.name || "mesh").replace(/\s+/g, "_").slice(0, 48);
        child.userData.anuId = `structure.tipi_1.mesh.${msh}`;
        const mats = Array.isArray(child.material)
          ? child.material
          : [child.material];
        for (const m of mats) {
          if (!m) continue;
          if (m.roughness !== undefined) m.roughness = 0.9;
          if (m.metalness !== undefined) m.metalness = 0.0;
          if (m.emissive !== undefined) {
            m.emissive.setHex(0x000000);
            m.emissiveIntensity = 0.0;
          }
          m.transparent = false;
          m.depthWrite = true;
        }
      }
    });

    scene.add(tipi);
    objects.push(tipi);

    const ybSeat = await attachYellowButterflySeatedTipi1(scene, objects, platMesh, tipi);

    const deckFx = tipi1SacredDeckTopY(platMesh);
    const hearthY = deckFx + V2_TIPI_BRAZIER_ABOVE_DECK_M;
    /** Flame group sits at the brazier mesh XZ; Y is the bowl-rim cradle (V2_TIPI_BRAZIER_ABOVE_DECK_M). */
    const fireCtl = createTipiCampfire({
      scene,
      objects,
      x: hexPos.x + V2_TIPI_BRAZIER_WORLD_X_M,
      y: hearthY,
      z: hexPos.z + V2_TIPI_BRAZIER_WORLD_Z_M,
    });

    /**
     * Small ceremonial fire in front of the seated host: hex centre offset
     * by V2_TIPI_NPC_CEREMONIAL_FIRE_LOCAL_Z_M (1 ft south), Y at terrain
     * + V2_TIPI_NPC_CEREMONIAL_FIRE_ABOVE_GROUND_M (1 ft above ground).
     * Reuses the brazier shader, scaled to ~30% (≈ 6 in flame). Lower
     * lightIntensity / distance keeps the warm fill local.
     */
    const ceremonialFireCtl = createTipiCampfire({
      scene,
      objects,
      x: hexPos.x + V2_TIPI_NPC_CEREMONIAL_FIRE_LOCAL_X_M,
      y: platformY + V2_TIPI_NPC_CEREMONIAL_FIRE_ABOVE_GROUND_M,
      z: hexPos.z + V2_TIPI_NPC_CEREMONIAL_FIRE_LOCAL_Z_M,
      scale: V2_TIPI_NPC_CEREMONIAL_FIRE_SCALE,
      lightIntensity: 0.25,
      lightDistance: 1.0,
      anuIdOverride: "environment.tipi_1.ceremonial_fire",
      anuKindOverride: "tipi_ceremonial_fire",
      nameOverride: "effect_tipi_ceremonial_fire",
    });

    tipi.updateMatrixWorld(true);
    const apexBox = new THREE.Box3().setFromObject(tipi);
    const apexCenter = apexBox.getCenter(new THREE.Vector3());
    const smokeCtl = createTipiSmokePlume({
      scene,
      objects,
      x: apexCenter.x,
      y: apexBox.max.y + V2_TIPI_SMOKE_ABOVE_APEX_M,
      z: apexCenter.z,
    });

    tipi.userData.tipiAmbientEffectsUpdate = (dt) => {
      fireCtl.update(dt);
      ceremonialFireCtl.update(dt);
      smokeCtl.update(dt);
    };

    /* PiP ortho inner-circle discard: foliage / airborne VFX only — keep tipi/YB/platform visible under compass. */
    applyPipOrthoRingDiskClipToSubtree(fireCtl.group);
    applyPipOrthoRingDiskClipToSubtree(ceremonialFireCtl.group);
    applyPipOrthoRingDiskClipToSubtree(smokeCtl.group);

    tipi.userData.anuSubsystemIds = Object.freeze([
      platMesh.userData.anuId,
      tipi.userData.anuId,
      ybSeat?.root?.userData?.anuId ?? null,
      fireCtl.group.userData.anuId,
      ceremonialFireCtl.group.userData.anuId,
      smokeCtl.group.userData.anuId,
    ].filter(Boolean));

    worldPhysics.registerCollider({
      id: "structure.tipi_1.center.passable",
      x: hexPos.x,
      z: hexPos.z,
      radius: platRadius,
      object: tipi,
      passable: true,
      kind: "tipi_1",
    });

    /**
     * Asymmetric tipi collision (player-only block):
     *   • The tipi cone's scaled XZ footprint is ~5.5 m × 6.4 m, half-width
     *     ≈ 2.75 m. A 2.2 m solid collider radius blocks the player body
     *     from walking into the cone while leaving ~0.5 m of clearance to
     *     the visible cone wall (so the player can stand right at the
     *     doorway without clipping into geometry).
     *   • NPC.YB is NOT a physics body — `WorldPhysics.resolveBodyCollisions`
     *     only resolves bodies registered via `registerBody`, and the NPC
     *     controller writes `root.position` directly each frame. She passes
     *     through this collider freely, which is exactly the asymmetry the
     *     spec asks for: she can enter/exit her own tipi, the player can't.
     *   • Radius < platform radius (4.7 m) so the player can still walk on
     *     the deck around the tipi, near the ceremonial fire, etc.
     */
    worldPhysics.registerCollider({
      id: "structure.tipi_1.cone.player_block",
      x: hexPos.x,
      z: hexPos.z,
      radius: 2.2,
      object: null,
      passable: false,
      kind: "tipi_1_cone",
    });

    console.log(
      "%c[World] Tipi 1 + sacred platform — legacy 1:1 (7.2m tipi, 4.7m platform)",
      "color:#d7ccc8;",
    );
    return tipi;
  } catch (err) {
    console.warn("[World] Tipi 1 load failed:", err);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Tipi 2 — Brings Happiness Girl
// ──────────────────────────────────────────────────────────────────────────
//
// Parallel implementation of tipi 1 + NPC.YB, deliberately duplicated rather
// than refactored into a shared helper. The duplication is bounded (three
// functions: aim / attach / load) and trades a few hundred lines for zero
// risk to the existing tipi-1 path. When a third tipi owner lands and the
// duplication starts to bite, the right move is to fold all three through
// a single config-driven loader.

/**
 * Aim seated BHG rig + gold arrow toward the player on XZ. Mirror of
 * `updateYellowButterflyPlayerAim` but reads the `bhg*` userData keys so a
 * tipi 2 BHG and a tipi 1 YB can co-exist without their facing groups
 * colliding.
 */
export function updateBringsHappinessPlayerAim(tipi, playerX, playerZ) {
  const fg = tipi?.userData?.bhgFacingGroup;
  const root = tipi?.userData?.bhgSeatRoot;
  if (!fg || !root) return;
  const dx = playerX - root.position.x;
  const dz = playerZ - root.position.z;
  if (dx * dx + dz * dz < 1e-10) return;
  fg.rotation.y = Math.atan2(dx, dz) + V2_NPC_BHG_TIPI2_PLAYER_AIM_YAW_BIAS_RAD;
  const mats = tipi?.userData?.bhgTravelCircleMaterials;
  if (Array.isArray(mats)) {
    const t = (typeof performance !== "undefined" ? performance.now() : 0) * 0.001;
    for (let i = 0; i < mats.length; i++) touchTravelCircleTime(mats[i], t);
  }
}

/**
 * Loads `NPC.BHG.glb` seated on the tipi 2 cylinder deck. Mirror of
 * `attachYellowButterflySeatedTipi1` with `bhg*` userData keys and the
 * `V2_NPC_BHG_TIPI2_*` tuning constants.
 */
async function attachBhgSeatedTipi2(scene, objects, platMesh, tipi, hexPos) {
  try {
    const gltf = await new GLTFLoaderWithDraco().loadAsync(NPC_BHG_URL);
    const model = gltf.scene;
    model.name = "population_npc_bhg_model";
    model.rotation.y = V2_NPC_BHG_TIPI2_MODEL_YAW_RAD;

    model.traverse((ch) => {
      if (ch.isMesh || ch.isSkinnedMesh) {
        ch.castShadow = false;
        ch.receiveShadow = false;
        ch.frustumCulled = true;
        ch.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
        ch.userData.anuKind = "npc_bhg_tipi2_rig_mesh";
        const nm = (ch.name || "mesh").replace(/\s+/g, "_").slice(0, 48);
        ch.userData.anuId = `population.npc.brings_happiness_girl.mesh.${nm}`;
      }
    });

    const box0 = new THREE.Box3().setFromObject(model);
    const size0 = new THREE.Vector3();
    box0.getSize(size0);
    const baseSc =
      size0.y > 0.001 ? V2_NPC_BHG_TIPI2_TARGET_HEIGHT_M / size0.y : 1;
    const sc = baseSc * V2_NPC_BHG_TIPI2_SIZE_MULTIPLIER;
    model.scale.setScalar(sc);
    model.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(model);
    model.position.y = -box.min.y;
    const boxCenter = box.getCenter(new THREE.Vector3());
    model.position.x = -boxCenter.x;
    model.position.z = -boxCenter.z;
    const scaledHeight = box.max.y - box.min.y;

    const root = new THREE.Group();
    root.name = "population_npc_brings_happiness_girl_tipi2_seated";
    root.userData.anuId = "population.npc.brings_happiness_girl";
    root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
    root.userData.anuKind = "npc_bhg_tipi2_seated";
    root.userData.anuInteractable = true;
    root.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.INSPECT];
    root.userData.anuCollision = "passable";
    root.userData.anuLegacyReference =
      "EnvironmentBuilder.js NPC.BHG — seated host of tipi 2";

    const bhgTravelCircleMats = addGoldTravelFloorDecalAtFeet(
      root,
      V2_NPC_BHG_TIPI2_GOLD_CIRCLE_RADIUS_M,
      V2_NPC_BHG_TIPI2_GOLD_CIRCLE_LIFT_M,
      { npcKey: "bhg", npcSlug: "brings_happiness_girl" },
    );

    const lift = V2_NPC_BHG_TIPI2_GOLD_CIRCLE_LIFT_M;
    const facingGroup = new THREE.Group();
    facingGroup.name = "population_npc_bhg_facing";
    facingGroup.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
    facingGroup.userData.anuKind = "npc_bhg_facing_pivot";
    facingGroup.userData.anuId = "population.npc.brings_happiness_girl.facing_pivot";

    const arrow = createGoldTravelFacingArrowMesh(
      V2_NPC_BHG_TIPI2_GOLD_CIRCLE_RADIUS_M,
      lift + 0.015,
      { npcKey: "bhg", npcSlug: "brings_happiness_girl" },
    );
    facingGroup.add(model);
    facingGroup.add(arrow);

    const halo = createNpcEtherealHaloSprite(scaledHeight * 0.55, {
      npcKey: "bhg",
      npcSlug: "brings_happiness_girl",
    });
    halo.position.set(0, scaledHeight * 0.92, 0);
    facingGroup.add(halo);

    root.add(facingGroup);

    /** Same deck-top math used by tipi 1 — both platforms share the cylinder height. */
    const deckTop = platMesh.position.y + V2_TIPI_SACRED_PLATFORM_HEIGHT * 0.5;
    root.position.set(
      hexPos.x + V2_NPC_BHG_TIPI2_LOCAL_X_M,
      deckTop + V2_NPC_BHG_TIPI2_VERTICAL_TRIM_M - V2_NPC_BHG_TIPI2_SEAT_LOWER_M,
      hexPos.z + V2_NPC_BHG_TIPI2_LOCAL_Z_M,
    );

    scene.add(root);
    objects.push(root);

    /**
     * Clip discovery: BHG ships 5 NlaTrack-named clips in NPC.BHG.glb.
     * The legacy `js/EnvironmentBuilder.js` index mapping is the same as
     * YB (walk=0, idle=2, sit=3, wave=4) because BHG was rigged on the
     * same skeleton template. The NPCBehaviour controller does name-
     * search first then index fallback, so re-baked clip names will Just
     * Work without code changes.
     */
    const clips = gltf.animations ?? [];
    let sitClip = null;
    for (const c of clips) {
      const nm = String(c.name ?? "").toLowerCase();
      if (nm.includes("sit") || nm.includes("sitting") || nm.includes("003")) {
        sitClip = c;
        break;
      }
    }
    if (!sitClip && clips.length > 3) sitClip = clips[3];

    let mixer = null;
    if (sitClip) {
      mixer = new THREE.AnimationMixer(model);
      const act = mixer.clipAction(sitClip);
      act.setLoop(THREE.LoopRepeat, Infinity);
      act.clampWhenFinished = false;
      act.play();
      root.userData.anuActiveAnimation = { kind: "sit", clip: sitClip.name };
    }

    if (tipi) {
      tipi.userData.bhgNpcMixer = mixer;
      tipi.userData.bhgFacingGroup = facingGroup;
      tipi.userData.bhgSeatRoot = root;
      tipi.userData.bhgTravelCircleMaterials = bhgTravelCircleMats;

      if (mixer && clips.length > 0) {
        try {
          const physics = getRuntimeService("WorldPhysics");
          const getGroundY =
            physics && typeof physics.getGroundY === "function"
              ? physics.getGroundY.bind(physics)
              : null;
          if (getGroundY) {
            tipi.userData.bhgBehaviour = createTipiOwnerBehaviour({
              npcId: "npc_bhg_tipi2",
              tipi,
              root,
              facingGroup,
              model,
              mixer,
              clips,
              tipiCenter: { x: hexPos.x, z: hexPos.z },
              /** Same doorway-direction reasoning as tipi 1: south of centre. */
              entranceLocalXZ: { x: 0, z: -2.6 },
              getGroundY,
            });
          } else {
            console.warn(
              "[World] NPC.BHG tipi2 owner behaviour skipped — WorldPhysics unavailable.",
            );
          }
        } catch (behaviourErr) {
          console.warn("[World] NPC.BHG tipi2 owner behaviour wire failed:", behaviourErr);
        }
      }
    }

    console.log("%c[World] NPC.BHG seated at tipi 2", "color:#ce93d8;");
    return { root, mixer };
  } catch (e) {
    console.warn("[World] NPC.BHG seated load failed:", e);
    return null;
  }
}

/**
 * BHG-specific shader patch: paints two horizontal stripes on tipi 2 and
 * dims the baked yellow butterfly motifs everywhere else so the stripes
 * read as the dominant feature ("stripes_plus_suppression" per the user's
 * tipi 2 styling pick).
 *
 * Implementation uses **world Y** (via `modelMatrix * position` in the
 * vertex shader) compared against a per-material `uBhgMidY` uniform that
 * the caller seeds with the tipi's actual world-space vertical midpoint
 * (computed via `Box3.setFromObject` AFTER the tipi is placed in the
 * scene graph). World-space avoids any local-coordinate-system surprises
 * baked into the GLB (intermediate node transforms, non-zero pivot,
 * non-symmetric bbox).
 *
 * Geometry (all metres):
 *   • Band centred on `uBhgMidY`.
 *   • 6 inches = 0.1524 m → STRIPE_H constant.
 *   • 6 inches empty gap = 0.1524 m → GAP_FULL = 0.1524 m total → half = 0.0762 m.
 *   • Red below middle: world Y in [midY - 0.2286, midY - 0.0762]
 *   • Blue above middle: world Y in [midY + 0.0762, midY + 0.2286]
 *   • Outside bands: baseColor mixed 55% toward a flat canvas tan.
 *
 * Returns the uniforms object so the caller can update `uBhgMidY.value`
 * once the world-space midY is known.
 */
function applyBhgStripeAndSuppressionShader(material) {
  material.userData.bhgStripeShader = true;
  const uniforms = { uBhgMidY: { value: 0 } };
  material.userData.bhgUniforms = uniforms;
  const prior = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (typeof prior === "function") prior(shader);

    // Share the same uniform object between JS and the compiled shader so
    // updates to uniforms.uBhgMidY.value flow through without recompile.
    shader.uniforms.uBhgMidY = uniforms.uBhgMidY;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vBhgWorldY;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vBhgWorldY = (modelMatrix * vec4(transformed, 1.0)).y;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying float vBhgWorldY;
        uniform float uBhgMidY;
        const float BHG_GAP_HALF = 0.0762;    // 3" in metres (6" gap centred on midY)
        const float BHG_STRIPE_H = 0.1524;    // 6" stripe height in metres
        const vec3  BHG_STRIPE_RED      = vec3(0.82, 0.13, 0.11);
        const vec3  BHG_STRIPE_BLUE     = vec3(0.11, 0.20, 0.72);
        const vec3  BHG_SUPPRESS_CANVAS = vec3(0.62, 0.50, 0.36);
        const float BHG_SUPPRESS_MIX    = 0.55;`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        {
          float bhgDy = vBhgWorldY - uBhgMidY;
          float bhgAbs = abs(bhgDy);
          bool bhgInBand =
            (bhgAbs > BHG_GAP_HALF) &&
            (bhgAbs < (BHG_GAP_HALF + BHG_STRIPE_H));
          if (bhgDy < 0.0 && bhgInBand) {
            diffuseColor.rgb = BHG_STRIPE_RED;
          } else if (bhgDy > 0.0 && bhgInBand) {
            diffuseColor.rgb = BHG_STRIPE_BLUE;
          } else {
            diffuseColor.rgb = mix(
              diffuseColor.rgb,
              BHG_SUPPRESS_CANVAS,
              BHG_SUPPRESS_MIX
            );
          }
        }`,
      );
  };
  material.needsUpdate = true;
  return uniforms;
}

/**
 * Tipi 2 — Brings Happiness Girl's tipi, +2 tile widths east of tipi 1
 * (one empty tile of grass between centres). Reuses tipi 1's GLB + platform
 * dimensions. No fire / smoke / ceremonial brazier on tipi 2 yet — those
 * are a follow-up if/when the village expands.
 */
export async function loadTipi2WithBhg({ scene, objects, worldPhysics }) {
  const hexPos = { x: V2_TIPI_2_CENTER_X_M, z: V2_TIPI_2_CENTER_Z_M };
  const platformY = terrainY(hexPos.x, hexPos.z);

  const platRadius = V2_TIPI_SACRED_PLATFORM_RADIUS;
  const platH = V2_TIPI_SACRED_PLATFORM_HEIGHT;
  const platGeo = new THREE.CylinderGeometry(
    platRadius,
    platRadius + 0.15,
    platH,
    32,
  );
  const platMat = new THREE.MeshStandardMaterial({
    color: 0x1a2e1a,
    roughness: 0.9,
    metalness: 0.1,
  });
  const platMesh = new THREE.Mesh(platGeo, platMat);
  platMesh.name = "structure_tipi_2_sacred_platform";
  platMesh.position.set(hexPos.x, platformY + V2_TIPI_SACRED_PLATFORM_CENTER_Y, hexPos.z);
  platMesh.castShadow = false;
  platMesh.receiveShadow = true;
  platMesh.userData.anuId = "structure.tipi_2.sacred_platform";
  platMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
  platMesh.userData.anuKind = "tipi_sacred_circle_platform";
  platMesh.userData.anuInteractable = true;
  platMesh.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.INSPECT];
  platMesh.userData.anuLegacyReference =
    "EnvironmentBuilder.js Sacred Circle Platform (BHG / tipi 2)";

  scene.add(platMesh);
  objects.push(platMesh);

  try {
    const gltf = await new GLTFLoaderWithDraco().loadAsync(TIPI_2_URL);
    const tipi = gltf.scene;
    tipi.name = "structure_tipi_2_bhg";

    const box = new THREE.Box3().setFromObject(tipi);
    const size = new THREE.Vector3();
    box.getSize(size);
    const targetH = V2_TIPI_YELLOW_BUTTERFLY_TARGET_HEIGHT_M;
    const sf = targetH / Math.max(size.y, 0.1);
    tipi.scale.set(sf, sf, sf);

    tipi.rotation.y = V2_TIPI_2_YAW_RAD;
    tipi.updateMatrixWorld(true);

    box.setFromObject(tipi);
    const center = box.getCenter(new THREE.Vector3());

    tipi.position.set(
      hexPos.x - center.x + tipi.position.x,
      platformY - box.min.y - 0.05,
      hexPos.z - center.z + tipi.position.z,
    );

    tipi.userData.anuId = "structure.tipi_2.center";
    tipi.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
    tipi.userData.anuKind = "tipi_2_non_colliding";
    tipi.userData.anuInteractable = true;
    tipi.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.INSPECT];
    tipi.userData.anuCollision = "passable";
    tipi.userData.anuCollisionReason =
      "Tipi 2 cone has its own player-block collider; the GLB itself is passable in the object-graph traversal.";
    tipi.userData.anuLegacyReference =
      "EnvironmentBuilder.js TIPI yellowbutterfly variant — assigned to BHG (tipi 2)";

    platMesh.userData.buildingRoot = tipi;

    tipi.traverse((child) => {
      if (child.isMesh || child.isSkinnedMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        child.userData.anuCollision = "passable";
        child.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
        child.userData.anuKind = "tipi_2_mesh";
        const msh = (child.name || "mesh").replace(/\s+/g, "_").slice(0, 48);
        child.userData.anuId = `structure.tipi_2.mesh.${msh}`;

        /**
         * Clone every material before mutating it so tipi 1 cannot be
         * affected — both tipis load the same GLB and although `loadAsync`
         * returns separate gltf trees, sharing a material instance across
         * the two loads would couple their appearance. Cloning makes the
         * isolation explicit and is also where the BHG stripe + butterfly-
         * suppression shader patch lives (the source GLB has baked yellow
         * butterfly motifs we want to dim around BHG's red/blue band).
         */
        const sourceMats = Array.isArray(child.material)
          ? child.material
          : [child.material];
        const patchedMats = sourceMats.map((srcMat) => {
          if (!srcMat) return srcMat;
          const m = srcMat.clone();
          m.name = (srcMat.name ?? "tipi2_mat") + "_bhg";
          if (m.roughness !== undefined) m.roughness = 0.9;
          if (m.metalness !== undefined) m.metalness = 0.0;
          if (m.emissive !== undefined) {
            m.emissive.setHex(0x000000);
            m.emissiveIntensity = 0.0;
          }
          m.transparent = false;
          m.depthWrite = true;
          applyBhgStripeAndSuppressionShader(m);
          return m;
        });
        child.material = Array.isArray(child.material) ? patchedMats : patchedMats[0];
      }
    });

    /**
     * Now that the tipi has its final scale + position, compute the actual
     * world-space vertical midpoint and push it into every patched material's
     * `uBhgMidY` uniform. We use the shared uniform-object pattern in
     * `applyBhgStripeAndSuppressionShader` so updates flow through to the
     * compiled shader without forcing a recompile.
     */
    {
      const placedBbox = new THREE.Box3().setFromObject(tipi);
      const placedMidY = (placedBbox.min.y + placedBbox.max.y) * 0.5;
      tipi.traverse((o) => {
        if (o.isMesh || o.isSkinnedMesh) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            const u = m?.userData?.bhgUniforms;
            if (u?.uBhgMidY) u.uBhgMidY.value = placedMidY;
          }
        }
      });
    }

    scene.add(tipi);
    objects.push(tipi);

    const bhgSeat = await attachBhgSeatedTipi2(scene, objects, platMesh, tipi, hexPos);

    tipi.userData.anuSubsystemIds = Object.freeze([
      platMesh.userData.anuId,
      tipi.userData.anuId,
      bhgSeat?.root?.userData?.anuId ?? null,
    ].filter(Boolean));

    worldPhysics.registerCollider({
      id: "structure.tipi_2.center.passable",
      x: hexPos.x,
      z: hexPos.z,
      radius: platRadius,
      object: tipi,
      passable: true,
      kind: "tipi_2",
    });

    /**
     * Same asymmetric-collision reasoning as tipi 1's cone collider:
     * blocks the player body but the NPC's `root.position.x/z` direct
     * writes are not gated by `WorldPhysics.resolveBodyCollisions`, so
     * BHG walks freely through her own doorway.
     */
    worldPhysics.registerCollider({
      id: "structure.tipi_2.cone.player_block",
      x: hexPos.x,
      z: hexPos.z,
      radius: 2.2,
      object: null,
      passable: false,
      kind: "tipi_2_cone",
    });

    console.log(
      `%c[World] Tipi 2 + BHG seated at (${hexPos.x.toFixed(2)}, ${hexPos.z.toFixed(2)}) — 1 tile gap east of tipi 1`,
      "color:#d7ccc8;",
    );
    return tipi;
  } catch (err) {
    console.warn("[World] Tipi 2 load failed:", err);
    return null;
  }
}
