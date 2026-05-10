import * as THREE from "three";
import { GLTFLoaderWithDraco } from "./gltfLoaderSetup.js";
import {
  ANU_INTERACTION_VERB,
  ANU_SIMULATION_DOMAIN,
} from "./anu/SimulationController.js";
import {
  V2_NPC_YB_TIPI1_LOCAL_X_M,
  V2_NPC_YB_TIPI1_LOCAL_Z_M,
  V2_NPC_YB_TIPI1_TARGET_HEIGHT_M,
  V2_NPC_YB_TIPI1_VERTICAL_TRIM_M,
  V2_TIPI_SACRED_PLATFORM_CENTER_Y,
  V2_TIPI_SACRED_PLATFORM_HEIGHT,
  V2_TIPI_SACRED_PLATFORM_RADIUS,
  V2_TIPI_YELLOW_BUTTERFLY_TARGET_HEIGHT_M,
} from "./constants.js";
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
 * Loads `NPC.YB.glb` seated on the tipi 1 cylinder deck (inside / centre area).
 * Animation: sit clip by name (`sit`, `003`, …) or legacy index **3** fallback (`EnvironmentBuilder.js`).
 */
async function attachYellowButterflySeatedTipi1(scene, objects, platMesh, tipi) {
  try {
    const gltf = await new GLTFLoaderWithDraco().loadAsync(NPC_YB_URL);
    const model = gltf.scene;
    /** Match v2 figurine NPC convention (+Z gameplay forward after fix). */
    model.rotation.y = -Math.PI / 2;

    model.traverse((ch) => {
      if (ch.isMesh) {
        ch.castShadow = false;
        ch.receiveShadow = false;
        ch.frustumCulled = true;
      }
    });

    const box0 = new THREE.Box3().setFromObject(model);
    const size0 = new THREE.Vector3();
    box0.getSize(size0);
    const sc =
      size0.y > 0.001 ? V2_NPC_YB_TIPI1_TARGET_HEIGHT_M / size0.y : 1;
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

    root.add(model);

    const deckTop = tipi1SacredDeckTopY(platMesh);
    root.position.set(
      V2_NPC_YB_TIPI1_LOCAL_X_M,
      deckTop + V2_NPC_YB_TIPI1_VERTICAL_TRIM_M,
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

    if (tipi) tipi.userData.ybNpcMixer = mixer;

    root.userData.anuPlayGesture = () => {};

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
      if (child.isMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        child.userData.anuCollision = "passable";
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

    await attachYellowButterflySeatedTipi1(scene, objects, platMesh, tipi);

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
