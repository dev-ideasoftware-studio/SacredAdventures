import * as THREE from "three";
import { GLTFLoaderWithDraco } from "./gltfLoaderSetup.js";
import {
  ANU_INTERACTION_VERB,
  ANU_SIMULATION_DOMAIN,
} from "./anu/SimulationController.js";
import {
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
  V2_TIPI_BRAZIER_ABOVE_DECK_M,
  V2_TIPI_BRAZIER_WORLD_X_M,
  V2_TIPI_BRAZIER_WORLD_Z_M,
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

/** Legacy primary yellow butterfly tipi path — WORDPRESS bundle mirrors original Assets layout. */
const TIPI_1_URL = "./WORDPRESS/Assets/Tipi.yellowbutterfly/tipi.yellowbutterfly.glb";
/** Yellow Butterfly character — seated host at tipi 1 only (fresh minimal path; no proximity FSM). */
const NPC_YB_URL = "./Assets/NPC.YB.glb";

/** Platform deck world Y (top of sacred cylinder under tipi 1). */
export function tipi1SacredDeckTopY(platMesh) {
  return platMesh.position.y + V2_TIPI_SACRED_PLATFORM_HEIGHT * 0.5;
}

/**
 * Gold deck decal only (disc + ring) — stays on `root` while rig + arrow rotate in `ybFacingGroup`.
 */
function addGoldTravelFloorDecalAtFeet(group, radius, liftY) {
  const R = radius;
  const lift = liftY;
  const innerR = R * 0.92;

  const discMat = createPhotorealTravelDiscMaterial("npc", R);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 72), discMat);
  disc.name = "population_npc_yb_gold_travel_disc";
  disc.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
  disc.userData.anuKind = "npc_yb_travel_disc";
  disc.userData.anuId = "population.npc.yellow_butterfly.gold_disc";
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = lift;
  disc.renderOrder = 1;
  group.add(disc);

  const ringMat = createPhotorealTravelRingMaterial("npc", innerR, R);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(innerR, R, 96),
    ringMat,
  );
  ring.name = "population_npc_yb_gold_travel_ring";
  ring.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
  ring.userData.anuKind = "npc_yb_travel_ring";
  ring.userData.anuId = "population.npc.yellow_butterfly.gold_ring";
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = lift + 0.008;
  ring.renderOrder = 2;
  group.add(ring);

  return [discMat, ringMat];
}

/** Facing arrow mesh (+Z in pivot space after `rotation.x = −π/2`). Parent: `ybFacingGroup`. */
function createGoldTravelFacingArrowMesh(radius, localY) {
  const R = radius;
  const arrowShape = new THREE.Shape()
    .moveTo(0, R * 0.92)
    .lineTo(R * 0.22, R * 0.52)
    .lineTo(-R * 0.22, R * 0.52)
    .lineTo(0, R * 0.92);
  const arrow = new THREE.Mesh(
    new THREE.ShapeGeometry(arrowShape),
    new THREE.MeshBasicMaterial({
      color: 0xfff4b3,
      transparent: true,
      opacity: 0.96,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    }),
  );
  arrow.name = "population_npc_yb_gold_travel_arrow";
  arrow.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
  arrow.userData.anuKind = "npc_yb_travel_arrow";
  arrow.userData.anuId = "population.npc.yellow_butterfly.gold_arrow";
  arrow.rotation.x = -Math.PI / 2;
  arrow.position.y = localY;
  arrow.renderOrder = 3;
  return arrow;
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

    tipi.rotation.y = -Math.PI / 2;
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
      smokeCtl.update(dt);
    };

    /* PiP ortho inner-circle discard: foliage / airborne VFX only — keep tipi/YB/platform visible under compass. */
    applyPipOrthoRingDiskClipToSubtree(fireCtl.group);
    applyPipOrthoRingDiskClipToSubtree(smokeCtl.group);

    tipi.userData.anuSubsystemIds = Object.freeze([
      platMesh.userData.anuId,
      tipi.userData.anuId,
      ybSeat?.root?.userData?.anuId ?? null,
      fireCtl.group.userData.anuId,
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
