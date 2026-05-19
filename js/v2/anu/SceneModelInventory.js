/**
 * Full scene-graph inventory for Anu — every drawable Three.js object under the engine scene.
 * Sampled on an interval (not every frame) to avoid traversal cost on large forests.
 */

import * as THREE from "three";
import { dispatchInteraction } from "./InteractionBus.js";
import { ANU_EVENTS } from "./anuEvents.js";

/** How often SacredOrchestrator refreshes the inventory (frames). Slightly relaxed vs every-90f to cut traverse cost on large forests. */
export const SCENE_INVENTORY_INTERVAL_FRAMES = 120;

/**
 * Post-load sweep that stamps `userData.anuSimulationDomain` +
 * `anuKind` + `anuId` on every drawable (mesh / skinned / instanced /
 * line / points) under `root` that doesn't already have a domain tag.
 * Required by the `MODEL_REGISTRATION` governance rule — Anu refuses to
 * count untagged objects under any domain except `unspecified` (her
 * negative bucket).
 *
 * Use from a module's `load()` after assembling its subtree:
 *
 *     ensureAnuTaggedSubtree(rootGroup, {
 *       domain: ANU_SIMULATION_DOMAIN.ENVIRONMENT,
 *       kindPrefix: "pool2_part",
 *       idPrefix: "environment.pool2",
 *     });
 *
 * @param {import("three").Object3D} root
 * @param {object} opts
 * @param {string} opts.domain      ANU_SIMULATION_DOMAIN.* value
 * @param {string} opts.kindPrefix  Used as `anuKind` when the object has
 *                                  no explicit one (each mesh gets the
 *                                  same prefix; tagger does NOT slug-
 *                                  per-mesh to keep `anuKind` low-card.).
 * @param {string} opts.idPrefix    `anuId` becomes `${idPrefix}.${slug}`
 *                                  derived from the mesh name (or uuid).
 * @returns {{ tagged: number, alreadyTagged: number }}
 */
export function ensureAnuTaggedSubtree(root, opts) {
  if (!root || typeof root.traverse !== "function") {
    return { tagged: 0, alreadyTagged: 0 };
  }
  const { domain, kindPrefix, idPrefix } = opts || {};
  let tagged = 0;
  let alreadyTagged = 0;
  root.traverse((obj) => {
    const drawable =
      obj.isMesh ||
      obj.isSkinnedMesh ||
      obj.isInstancedMesh ||
      obj.isLine ||
      obj.isLineSegments ||
      obj.isLineLoop ||
      obj.isPoints;
    if (!drawable) return;
    if (!obj.userData) obj.userData = {};
    if (
      typeof obj.userData.anuSimulationDomain === "string" &&
      obj.userData.anuSimulationDomain.length > 0
    ) {
      alreadyTagged++;
      return;
    }
    obj.userData.anuSimulationDomain = domain;
    if (!obj.userData.anuKind && kindPrefix) {
      obj.userData.anuKind = kindPrefix;
    }
    if (!obj.userData.anuId && idPrefix) {
      const slug = (obj.name || obj.uuid || "x")
        .toString()
        .replace(/\s+/g, "_")
        .slice(0, 48);
      obj.userData.anuId = `${idPrefix}.${slug}`;
    }
    tagged++;
  });
  return { tagged, alreadyTagged };
}

/** Max rows in `entries` per snapshot — summary counts remain exact. */
const MAX_ENTRY_ROWS = 5000;

let _lastSnapshot = null;

/**
 * @param {import("three").Object3D} obj
 * @returns {string}
 */
function inferSimulationDomain(obj) {
  const ud = obj.userData || {};
  if (typeof ud.anuSimulationDomain === "string" && ud.anuSimulationDomain.length) {
    return ud.anuSimulationDomain;
  }
  const n = (obj.name || "").toLowerCase();

  // Specific subsystems first — order matters (a Pool2 fish mesh is
  // FAUNA, not ENVIRONMENT, but the parent "pool2_..." would otherwise
  // catch it. Match the most specific patterns first).
  if (
    n.includes("fish") ||
    n.includes("rabbit") ||
    n.includes("bird") ||
    n.includes("fauna") ||
    n.includes("wildlife") ||
    n.includes("creature")
  ) {
    return "fauna";
  }
  if (
    n.includes("tipi") ||
    n.includes("dock") ||
    n.includes("pier") ||
    n.includes("building") ||
    n.includes("house") ||
    n.includes("village") ||
    n.includes("sacred_platform") ||
    n.includes("sacredplatform")
  ) {
    return "structures";
  }
  if (
    n.includes("avatar") ||
    n.includes("player") ||
    n.includes("figurine")
  ) {
    return "player";
  }
  if (
    n.includes("npc") ||
    n.includes("villager") ||
    n.includes("yb_") ||
    n.includes("yellow_butterfly") ||
    n.includes("bhg_") ||
    n.includes("brings_happiness") ||
    n.includes("trader")
  ) {
    return "population";
  }
  if (n.includes("sacredflora") || n.includes("tree")) return "flora";
  if (
    n.includes("item") ||
    n.includes("journal") ||
    n.includes("tool") ||
    n.includes("loot") ||
    n.includes("axe")
  ) {
    return "items";
  }
  // Environment: the broad bucket — terrain, atmosphere, pool water,
  // lily pads, waterfall, rocks, reeds, smoke/fire fx.
  if (
    n.includes("terrain") ||
    n.includes("haze") ||
    n.includes("hex") ||
    n.includes("pool") ||
    n.includes("water") ||
    n.includes("lily") ||
    n.includes("waterfall") ||
    n.includes("rock") ||
    n.includes("reed") ||
    n.includes("moss") ||
    n.includes("smoke") ||
    n.includes("flame") ||
    n.includes("fire") ||
    n.includes("ground") ||
    n.includes("sky") ||
    n.includes("celestial") ||
    n.includes("moon") ||
    n.includes("star") ||
    n.includes("cloud") ||
    n.includes("fog")
  ) {
    return "environment";
  }
  return "unspecified";
}

function inferInteractionVerbs(obj) {
  const verbs = obj.userData?.anuInteractionVerbs;
  if (!Array.isArray(verbs)) return [];
  return verbs.filter((v) => typeof v === "string" && v.length > 0);
}

/**
 * Walk up the parent chain looking for an `anuInteractable` flag on any
 * ancestor. Returns `{ flag, verbs }` so the per-drawable counter can
 * credit a child mesh's parent Group with the interactable status.
 *
 * Modules consistently tag their WRAPPER Group with `anuInteractable +
 * anuInteractionVerbs` (see `attachYellowButterflySeatedTipi1` /
 * `attachBhgSeatedTipi2` in WorldStructures), but `captureSceneRender
 * Inventory` only counts a row when `classifyDrawable(obj)` returns
 * non-null — and Groups never return a drawable kind. The result was
 * `population.interactables = 0` even with two clearly interactable
 * NPCs in the scene. This helper closes that gap.
 */
function inheritInteractableFromAncestors(obj) {
  let cur = obj.parent;
  let depth = 0;
  while (cur && depth < 12) {
    const ud = cur.userData;
    if (ud) {
      if (ud.anuInteractable === true) {
        const verbs = inferInteractionVerbs(cur);
        return { flag: true, verbs };
      }
      if (Array.isArray(ud.anuInteractionVerbs) && ud.anuInteractionVerbs.length > 0) {
        const verbs = inferInteractionVerbs(cur);
        return { flag: true, verbs };
      }
    }
    cur = cur.parent;
    depth++;
  }
  return { flag: false, verbs: [] };
}

function triangleEstimateFromGeometry(geometry) {
  if (!geometry) return 0;
  const idx = geometry.index;
  const pos = geometry.attributes?.position;
  if (!pos) return 0;
  if (idx) return Math.floor(idx.count / 3);
  return Math.floor(pos.count / 3);
}

function classifyDrawable(obj) {
  let tri = 0;
  let instances = undefined;

  if (obj.isInstancedMesh) {
    const base = triangleEstimateFromGeometry(obj.geometry);
    const n = typeof obj.count === "number" ? obj.count : 1;
    tri = base * n;
    instances = n;
    return { kind: "InstancedMesh", tri, instances };
  }
  if (obj.isSkinnedMesh) {
    tri = triangleEstimateFromGeometry(obj.geometry);
    return { kind: "SkinnedMesh", tri, instances };
  }
  if (obj.isMesh) {
    tri = triangleEstimateFromGeometry(obj.geometry);
    return { kind: "Mesh", tri, instances };
  }
  if (obj.isLine || obj.isLineSegments || obj.isLineLoop) {
    return { kind: obj.type || "Line", tri: 0, instances };
  }
  if (obj.isPoints) {
    return { kind: "Points", tri: 0, instances };
  }
  return null;
}

/**
 * Walk the entire scene and record renderable objects + triangle estimates (main scene pass).
 * @param {import("three").Scene} scene
 */
export function captureSceneRenderInventory(scene) {
  if (!scene) return null;

  const summary = {
    object3DTotal: 0,
    mesh: 0,
    skinnedMesh: 0,
    instancedMesh: 0,
    lineLike: 0,
    points: 0,
    /** Sum of estimated triangles (instancing × base mesh). */
    trianglesEstimate: 0,
    /** Rows with triEstimate > 0 */
    drawableRows: 0,
    interactableRows: 0,
  };

  /** @type {Record<string, { drawables: number; trianglesEstimate: number; interactables: number }>} */
  const bySimulationDomain = {};

  const rows = [];
  const worldPos = new THREE.Vector3();

  scene.traverse((obj) => {
    summary.object3DTotal++;

    const cls = classifyDrawable(obj);
    if (!cls) return;

    if (cls.kind === "Mesh") summary.mesh++;
    else if (cls.kind === "SkinnedMesh") summary.skinnedMesh++;
    else if (cls.kind === "InstancedMesh") summary.instancedMesh++;
    else if (cls.kind === "Points") summary.points++;
    else summary.lineLike++;

    const tri = cls.tri;
    summary.trianglesEstimate += tri;
    if (tri > 0) summary.drawableRows++;

    const simulationDomain = inferSimulationDomain(obj);
    if (!bySimulationDomain[simulationDomain]) {
      bySimulationDomain[simulationDomain] = {
        drawables: 0,
        trianglesEstimate: 0,
        interactables: 0,
      };
    }
    bySimulationDomain[simulationDomain].drawables++;
    bySimulationDomain[simulationDomain].trianglesEstimate += tri;
    let interactionVerbs = inferInteractionVerbs(obj);
    let interactable =
      obj.userData?.anuInteractable === true || interactionVerbs.length > 0;
    // Inherit interactable status from ancestor wrapper Groups — see
    // `inheritInteractableFromAncestors` for why this matters (YB / BHG
    // tag their wrapper Group, not each child mesh).
    if (!interactable) {
      const inherited = inheritInteractableFromAncestors(obj);
      if (inherited.flag) {
        interactable = true;
        if (interactionVerbs.length === 0) interactionVerbs = inherited.verbs;
      }
    }
    if (interactable) {
      summary.interactableRows++;
      bySimulationDomain[simulationDomain].interactables++;
    }
    obj.getWorldPosition(worldPos);

    rows.push({
      anuId: obj.userData?.anuId ?? obj.uuid,
      uuid: obj.uuid,
      type: cls.kind,
      name: obj.name || "",
      visible: obj.visible,
      triEstimate: Math.round(tri),
      instances: cls.instances,
      simulationDomain,
      anuKind: obj.userData?.anuKind ?? null,
      interactable,
      interactionVerbs,
      worldPosition: {
        x: Math.round(worldPos.x * 1000) / 1000,
        y: Math.round(worldPos.y * 1000) / 1000,
        z: Math.round(worldPos.z * 1000) / 1000,
      },
    });
  });

  rows.sort((a, b) => b.triEstimate - a.triEstimate);

  const truncated = rows.length > MAX_ENTRY_ROWS;
  const entries = truncated ? rows.slice(0, MAX_ENTRY_ROWS) : rows;

  _lastSnapshot = Object.freeze({
    schemaVersion: "1.0",
    at: new Date().toISOString(),
    summary: Object.freeze({
      ...summary,
      bySimulationDomain: Object.freeze({ ...bySimulationDomain }),
    }),
    entries,
    truncated,
    totalEntries: rows.length,
  });

  dispatchInteraction(ANU_EVENTS.SCENE_INVENTORY_TICK, {
    at: _lastSnapshot.at,
    summary: _lastSnapshot.summary,
    truncated: _lastSnapshot.truncated,
    totalEntries: _lastSnapshot.totalEntries,
  });

  return _lastSnapshot;
}

export function getSceneInventorySnapshot() {
  return _lastSnapshot;
}

export function exportSceneInventoryJson() {
  return JSON.stringify(
    _lastSnapshot ?? { error: "no_snapshot_yet" },
    null,
    2,
  );
}
