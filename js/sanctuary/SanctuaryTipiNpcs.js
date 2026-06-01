/**
 * Sacred Adventures — sanctuary seated NPCs (v2 1:1).
 *
 * Yellow Butterfly @ Tipi 1, BHG @ Tipi 2 — same scale, seat offsets,
 * photoreal gold/wood travel discs, and facing arrows as v2 World.
 */

import * as THREE from "three";
import { GLTFLoaderWithDraco } from "../v2/gltfLoaderSetup.js";
import { ANU_SIMULATION_DOMAIN, ANU_INTERACTION_VERB } from "../v2/anu/SimulationController.js";
import {
  addGoldTravelFloorDecalAtFeet,
  createGoldTravelFacingArrowMesh,
  tipi1SacredDeckTopY,
} from "../v2/WorldStructures.js";
import { touchTravelCircleTime } from "../v2/anu/TravelFloorCircleMaterials.js";
import {
  V2_TIPI_2_CENTER_X_M,
  V2_TIPI_2_CENTER_Z_M,
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
} from "../v2/constants.js";

const YB_URL = "./Assets/NPC.YB.glb";
const BHG_URL = "./Assets/NPC.BHG.glb";
const REG_URL = "./Assets/NPC.REG.glb";

function _fitSeatedNpc(model, targetH, sizeMul) {
  const box0 = new THREE.Box3().setFromObject(model);
  const size0 = new THREE.Vector3();
  box0.getSize(size0);
  const baseSc = size0.y > 0.001 ? targetH / size0.y : 1;
  const sc = baseSc * sizeMul;
  model.scale.setScalar(sc);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  model.position.y = -box.min.y;
  const c = box.getCenter(new THREE.Vector3());
  model.position.x = -c.x;
  model.position.z = -c.z;
  return box.max.y - box.min.y;
}

function _tagMeshes(model, anuKind, idPrefix) {
  model.traverse((ch) => {
    if (!ch.isMesh && !ch.isSkinnedMesh) return;
    ch.castShadow = false;
    ch.receiveShadow = false;
    ch.frustumCulled = true;
    ch.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
    ch.userData.anuKind = anuKind;
    const nm = (ch.name || "mesh").replace(/\s+/g, "_").slice(0, 48);
    ch.userData.anuId = `${idPrefix}.${nm}`;
  });
}

async function _buildSeatedNpcV2(cfg) {
  const gltf = await new GLTFLoaderWithDraco().loadAsync(cfg.url);
  const model = gltf.scene;
  model.rotation.y = cfg.modelYawRad;
  _tagMeshes(model, cfg.meshKind, cfg.anuId);

  _fitSeatedNpc(model, cfg.targetHeightM, cfg.sizeMultiplier);

  const root = new THREE.Group();
  root.name = cfg.rootName;
  root.userData.anuId = cfg.anuId;
  root.userData.anuKind = cfg.anuKind;
  root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
  root.userData.anuInteractable = true;
  root.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.TALK, ANU_INTERACTION_VERB.INSPECT];

  const travelMats = addGoldTravelFloorDecalAtFeet(
    root,
    cfg.circleRadiusM,
    cfg.circleLiftM,
    cfg.travelOpts,
  );

  const facingGroup = new THREE.Group();
  facingGroup.name = cfg.facingGroupName;
  facingGroup.userData.anuKind = cfg.facingKind;
  facingGroup.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;

  const arrow = createGoldTravelFacingArrowMesh(
    cfg.circleRadiusM,
    cfg.circleLiftM + 0.015,
    cfg.travelOpts,
  );
  facingGroup.add(model);
  facingGroup.add(arrow);
  root.add(facingGroup);

  const deckTop = tipi1SacredDeckTopY(cfg.platMesh);

  const isTipi2 = cfg.anuId.includes("brings_happiness_girl");
  const isTipi4 = cfg.anuId.includes("reg");
  const yaw = isTipi2
    ? (window.__sanctuaryTipi2Yaw ?? V2_TIPI_2_YAW_RAD)
    : (isTipi4
        ? (window.__sanctuaryTipi4Yaw ?? Math.PI / 2)
        : (window.__sanctuaryTipi1Yaw ?? Math.PI / 2));

  const wx = cfg.localZ * Math.cos(yaw) + cfg.localX * Math.sin(yaw);
  const wz = cfg.localZ * Math.sin(yaw) - cfg.localX * Math.cos(yaw);

  root.position.set(
    cfg.hexPos.x + wx,
    deckTop + cfg.verticalTrimM - cfg.seatLowerM,
    cfg.hexPos.z + wz,
  );

  cfg.scene.add(root);

  let mixer = null;
  const clips = gltf.animations ?? [];
  let sitClip = null;
  for (const c of clips) {
    const nm = String(c.name ?? "").toLowerCase();
    if (nm.includes("sit") || nm.includes("sitting") || nm.includes("seated") || nm.includes("003")) {
      sitClip = c;
      break;
    }
  }
  // Tripo NPC GLB convention: clips[2] is the seated idle. Falls back
  // through 3 → 5 → 0 the way v2 WorldAvatar's semanticClips.sit does.
  if (!sitClip) sitClip = clips[2] ?? clips[3] ?? clips[5] ?? clips[0] ?? null;
  console.log(
    `%c[SanctuaryTipiNpcs:${cfg.rootName}] GLB clips (${clips.length}): ${clips.map((c, i) => `[${i}]"${c.name}" (${c.duration.toFixed(2)}s)`).join(", ") || "<none>"}\n  → sit pick: ${sitClip ? `"${sitClip.name}"` : "<none — npc will be in bind pose>"}`,
    sitClip ? "color:#ffb6c1;" : "color:#ff8a3d;font-weight:bold;",
  );
  if (sitClip) {
    mixer = new THREE.AnimationMixer(model);
    const act = mixer.clipAction(sitClip);
    act.setLoop(THREE.LoopRepeat, Infinity);
    act.play();
  }

  return {
    root,
    facingGroup,
    mixer,
    travelMats,
    aimYawBiasRad: cfg.aimYawBiasRad,
  };
}

export const SanctuaryTipiNpcsModule = {
  name: "SanctuaryTipiNpcs",

  _scene: null,
  _yb: null,
  _bhg: null,
  _reg: null,

  async load(scene) {
    this._scene = scene;
    const tipi1Hex = window.__sanctuaryTipi1Anchor ?? { x: 0, z: 0 };
    const tipi2Hex = window.__sanctuaryTipi2Anchor ?? {
      x: V2_TIPI_2_CENTER_X_M,
      z: V2_TIPI_2_CENTER_Z_M,
    };
    const tipi4Hex = window.__sanctuaryTipi4Anchor ?? null;
    const plat1 = window.__sanctuaryTipi1PlatMesh ?? null;
    const plat2 = window.__sanctuaryTipi2PlatMesh ?? null;
    const plat4 = window.__sanctuaryTipi4PlatMesh ?? null;

    if (!plat1 || !plat2) {
      console.warn("[SanctuaryTipiNpcs] tipi platforms missing — activate SanctuaryTipis first");
      return;
    }

    try {
      this._yb = await _buildSeatedNpcV2({
        url: YB_URL,
        scene,
        hexPos: tipi1Hex,
        platMesh: plat1,
        anuId: "population.npc.yellow_butterfly",
        anuKind: "sanctuary_npc_yb",
        rootName: "population_npc_yellow_butterfly_tipi1_seated",
        meshKind: "npc_yb_tipi1_rig_mesh",
        facingGroupName: "population_npc_yb_facing",
        facingKind: "npc_yb_facing_pivot",
        modelYawRad: V2_NPC_YB_TIPI1_MODEL_YAW_RAD,
        targetHeightM: V2_NPC_YB_TIPI1_TARGET_HEIGHT_M,
        sizeMultiplier: V2_NPC_YB_TIPI1_SIZE_MULTIPLIER,
        localX: V2_NPC_YB_TIPI1_LOCAL_X_M,
        localZ: V2_NPC_YB_TIPI1_LOCAL_Z_M,
        verticalTrimM: V2_NPC_YB_TIPI1_VERTICAL_TRIM_M,
        seatLowerM: V2_NPC_YB_TIPI1_SEAT_LOWER_M,
        circleRadiusM: V2_NPC_YB_TIPI1_GOLD_CIRCLE_RADIUS_M,
        circleLiftM: V2_NPC_YB_TIPI1_GOLD_CIRCLE_LIFT_M,
        aimYawBiasRad: V2_NPC_YB_TIPI1_PLAYER_AIM_YAW_BIAS_RAD,
        travelOpts: { npcKey: "yb", npcSlug: "yellow_butterfly" },
      });
      console.log("%c[Sanctuary] 🧒 YB seated (v2 travel circles)", "color:#fbc02d;font-weight:bold;");
    } catch (err) {
      console.warn("[SanctuaryTipiNpcs] YB load failed:", err);
    }

    try {
      this._bhg = await _buildSeatedNpcV2({
        url: BHG_URL,
        scene,
        hexPos: tipi2Hex,
        platMesh: plat2,
        anuId: "population.npc.brings_happiness_girl",
        anuKind: "sanctuary_npc_bhg",
        rootName: "population_npc_brings_happiness_girl_tipi2_seated",
        meshKind: "npc_bhg_tipi2_rig_mesh",
        facingGroupName: "population_npc_bhg_facing",
        facingKind: "npc_bhg_facing_pivot",
        modelYawRad: V2_NPC_BHG_TIPI2_MODEL_YAW_RAD,
        targetHeightM: V2_NPC_BHG_TIPI2_TARGET_HEIGHT_M,
        sizeMultiplier: V2_NPC_BHG_TIPI2_SIZE_MULTIPLIER,
        localX: V2_NPC_BHG_TIPI2_LOCAL_X_M,
        // 2-foot north shift (May-19 2026 user spec). North = -Z in
        // sanctuary world-space; 2 ft = 0.6096 m. Applied only to BHG;
        // YB's local offset is untouched.
        localZ: V2_NPC_BHG_TIPI2_LOCAL_Z_M - 0.6096,
        verticalTrimM: V2_NPC_BHG_TIPI2_VERTICAL_TRIM_M,
        seatLowerM: V2_NPC_BHG_TIPI2_SEAT_LOWER_M,
        circleRadiusM: V2_NPC_BHG_TIPI2_GOLD_CIRCLE_RADIUS_M,
        circleLiftM: V2_NPC_BHG_TIPI2_GOLD_CIRCLE_LIFT_M,
        aimYawBiasRad: V2_NPC_BHG_TIPI2_PLAYER_AIM_YAW_BIAS_RAD,
        travelOpts: { npcKey: "bhg", npcSlug: "brings_happiness_girl" },
      });
      console.log("%c[Sanctuary] 🧒 BHG seated (v2 travel circles)", "color:#ffb6c1;font-weight:bold;");
    } catch (err) {
      console.warn("[SanctuaryTipiNpcs] BHG load failed:", err);
    }

    // MOBILE: skip the REG NPC entirely. NPC.REG.glb is ~1.9M triangles (26MB) —
    // the single biggest first-view geometry hog and a top OOM/GPU-crash cause on
    // phones ("PROCESS KILLED mid-run"). The other two seated NPCs (YB, BHG) stay.
    // Desktop loads REG at full detail.
    const _regUA = (typeof navigator !== "undefined" && navigator.userAgent) || "";
    const _skipRegMobile =
      /Mobi|Android|iPhone|iPod/i.test(_regUA) ||
      /iPad/i.test(_regUA) ||
      (/Macintosh/.test(_regUA) && (navigator.maxTouchPoints || 0) > 1);
    if (plat4 && tipi4Hex && !_skipRegMobile) {
      try {
        this._reg = await _buildSeatedNpcV2({
          url: REG_URL,
          scene,
          hexPos: tipi4Hex,
          platMesh: plat4,
          anuId: "population.npc.reg",
          anuKind: "sanctuary_npc_reg",
          rootName: "population_npc_reg_tipi4_seated",
          meshKind: "npc_reg_tipi4_mesh",
          facingGroupName: "population_npc_reg_facing",
          facingKind: "npc_reg_facing_pivot",
          modelYawRad: V2_NPC_YB_TIPI1_MODEL_YAW_RAD,
          targetHeightM: 0.93,
          sizeMultiplier: V2_NPC_YB_TIPI1_SIZE_MULTIPLIER,
          localX: V2_NPC_YB_TIPI1_LOCAL_X_M,
          localZ: 1.2,
          verticalTrimM: V2_NPC_YB_TIPI1_VERTICAL_TRIM_M,
          seatLowerM: 0.35,
          circleRadiusM: V2_NPC_YB_TIPI1_GOLD_CIRCLE_RADIUS_M,
          circleLiftM: V2_NPC_YB_TIPI1_GOLD_CIRCLE_LIFT_M,
          aimYawBiasRad: V2_NPC_YB_TIPI1_PLAYER_AIM_YAW_BIAS_RAD,
          travelOpts: { npcKey: "reg", npcSlug: "npc_reg" },
        });
        console.log("%c[Sanctuary] 🧒 REG seated (v2 travel circles)", "color:#81c784;font-weight:bold;");
      } catch (err) {
        console.warn("[SanctuaryTipiNpcs] REG load failed:", err);
      }
    }

    if (typeof window !== "undefined") {
      window.__regenerateTipiNpcs = async () => {
        if (!this._yb && !this._bhg && !this._reg) return;
        console.log("[SanctuaryTipiNpcs] Rebuilding npcs for map type: " + window.__sanctuaryMapType);

        const cachedScene = this._scene;
        this.unload(cachedScene);

        this._scene = cachedScene;
        await this.load(cachedScene);

        console.log("[SanctuaryTipiNpcs] Npcs successfully regenerated!");
      };
    }
  },

  update(delta) {
    // Per-frame perf cut (May-19 2026): only tick NPC animation mixers
    // when the player is within range. Each mixer.update does full
    // skeleton bone-transform math — for the seated YB + BHG + REG that's
    // ~400 ms of `applyBoneTransform` over a 5-second trace. Skipping
    // it when the kid is far keeps the seated NPCs frozen mid-pose,
    // which is fine because nobody can see the subtle breathing /
    // shoulder-roll from 30+ m away.
    const av = typeof window !== "undefined" ? window.__sanctuaryAvatar : null;
    const px = av?.position.x ?? 0;
    const pz = av?.position.z ?? 0;
    const NPC_ANIM_RADIUS_SQ = 30 * 30; // 30 m

    for (const npc of [this._yb, this._bhg, this._reg]) {
      if (!npc?.mixer || !npc.root) continue;
      const dx = px - npc.root.position.x;
      const dz = pz - npc.root.position.z;
      if (dx * dx + dz * dz <= NPC_ANIM_RADIUS_SQ) {
        npc.mixer.update(delta);
      }
    }

    if (!av) return;
    const t =
      (typeof performance !== "undefined" ? performance.now() : 0) * 0.001;

    for (const npc of [this._yb, this._bhg, this._reg]) {
      if (!npc?.facingGroup || !npc.root) continue;
      const dx = px - npc.root.position.x;
      const dz = pz - npc.root.position.z;
      if (dx * dx + dz * dz < 1e-10) continue;
      // Skip facing-update past the same range — the player can't tell
      // which way a 30 m-distant seated NPC is looking.
      if (dx * dx + dz * dz > NPC_ANIM_RADIUS_SQ) continue;
      npc.facingGroup.rotation.y =
        Math.atan2(dx, dz) + (npc.aimYawBiasRad ?? 0);
      if (Array.isArray(npc.travelMats)) {
        for (let i = 0; i < npc.travelMats.length; i++) {
          touchTravelCircleTime(npc.travelMats[i], t);
        }
      }
    }
  },

  unload(scene) {
    const sceneToUse = scene || this._scene;
    for (const npc of [this._yb, this._bhg, this._reg]) {
      if (!npc?.root) continue;
      if (sceneToUse) sceneToUse.remove(npc.root);
      npc.root.traverse((o) => {
        if (o.geometry) o.geometry.dispose?.();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
        else m?.dispose?.();
      });
    }
    this._yb = null;
    this._bhg = null;
    this._reg = null;
    this._scene = null;
  },
};
