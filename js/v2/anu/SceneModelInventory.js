/**
 * Full scene-graph inventory for Anu — every drawable Three.js object under the engine scene.
 * Sampled on an interval (not every frame) to avoid traversal cost on large forests.
 */

import { dispatchInteraction } from "./InteractionBus.js";
import { ANU_EVENTS } from "./anuEvents.js";

/** How often SacredOrchestrator refreshes the inventory (frames). */
export const SCENE_INVENTORY_INTERVAL_FRAMES = 90;

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
  if (n.includes("sacredflora") || n.includes("tree")) return "flora";
  if (n.includes("terrain") || n.includes("haze") || n.includes("hex")) {
    return "environment";
  }
  if (n.includes("avatar") || n.includes("player")) return "player";
  if (n.includes("npc") || n.includes("villager")) return "population";
  if (n.includes("fauna") || n.includes("wildlife") || n.includes("creature")) {
    return "fauna";
  }
  if (n.includes("building") || n.includes("house") || n.includes("village")) {
    return "structures";
  }
  return "unspecified";
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
  };

  /** @type {Record<string, { drawables: number; trianglesEstimate: number }>} */
  const bySimulationDomain = {};

  const rows = [];

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
      };
    }
    bySimulationDomain[simulationDomain].drawables++;
    bySimulationDomain[simulationDomain].trianglesEstimate += tri;

    rows.push({
      uuid: obj.uuid,
      type: cls.kind,
      name: obj.name || "",
      visible: obj.visible,
      triEstimate: Math.round(tri),
      instances: cls.instances,
      simulationDomain,
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
