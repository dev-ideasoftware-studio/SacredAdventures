/**
 * Sacred Adventures — sanctuary mold tool: PLACE TIPI.
 *
 * The first **building** tool. Lets kids drop a small procedural tipi
 * on the ground in top-down mode. Each placed tipi is:
 *
 *   • A cone of canvas (taupe-white) covering 12 lashed poles
 *   • A small smoke-hole opening at the top (just a tiny dark disc)
 *   • A doorway "flap" on the south side (a darker tall rectangle)
 *   • Anu STRUCTURES domain, anuKind = `mold_placed_tipi`
 *   • Serialised through the registry → restored on reload
 *
 * Geometry per tipi (~280 tris): cone (24-seg) + 12 lashed poles
 * (lightweight cylinders) + doorway plane.
 *
 * Sizing: 3.2 m tall, 1.6 m base radius — kid-scale, fits the village
 * ring. Smaller than the canonical YB / BHG tipis so kids can dot
 * many of them without visually crowding the two anchor tipis.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN, ANU_INTERACTION_VERB } from "../v2/anu/SimulationController.js";
import { sanctuaryGroundY } from "./SanctuaryGround.js";

const TIPI_HEIGHT_M = 3.2;
const TIPI_RADIUS_M = 1.6;
const POLE_COUNT = 12;
const POLE_OVERHANG_M = 0.45;

let _cachedCanvasMat = null;
function canvasMaterial() {
  if (_cachedCanvasMat) return _cachedCanvasMat;
  _cachedCanvasMat = new THREE.MeshStandardMaterial({
    color: 0xe6d5b8,
    roughness: 0.92,
    metalness: 0.0,
    side: THREE.DoubleSide,
    flatShading: true,
  });
  return _cachedCanvasMat;
}

let _cachedPoleMat = null;
function poleMaterial() {
  if (_cachedPoleMat) return _cachedPoleMat;
  _cachedPoleMat = new THREE.MeshStandardMaterial({
    color: 0x5c3f24,
    roughness: 0.85,
    metalness: 0.0,
  });
  return _cachedPoleMat;
}

let _cachedDoorMat = null;
function doorMaterial() {
  if (_cachedDoorMat) return _cachedDoorMat;
  _cachedDoorMat = new THREE.MeshStandardMaterial({
    color: 0x3a2716,
    roughness: 0.95,
    metalness: 0.0,
  });
  return _cachedDoorMat;
}

function buildTipiMesh(mut, scene) {
  const group = new THREE.Group();
  group.name = "mold_placed_tipi";
  group.userData.anuKind = "mold_placed_tipi";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
  group.userData.anuInteractable = true;
  group.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.ENTER, ANU_INTERACTION_VERB.INSPECT];
  group.userData.anuId = `structures.sanctuary.mold_tipi.${mut.id}`;

  // Cone canvas.
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(TIPI_RADIUS_M, TIPI_HEIGHT_M, 24, 1, true),
    canvasMaterial(),
  );
  cone.position.y = TIPI_HEIGHT_M / 2;
  cone.userData.anuKind = "mold_placed_tipi_canvas";
  cone.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
  group.add(cone);

  // Lashed poles — peek through the smoke hole.
  for (let i = 0; i < POLE_COUNT; i++) {
    const ang = (i / POLE_COUNT) * Math.PI * 2;
    const poleLen = TIPI_HEIGHT_M + POLE_OVERHANG_M;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.045, poleLen, 6, 1),
      poleMaterial(),
    );
    // Tilt the pole so its base is at the canvas rim and the tip
    // crosses through the smoke hole.
    const tilt = Math.atan2(TIPI_RADIUS_M, TIPI_HEIGHT_M);
    pole.position.set(
      Math.cos(ang) * TIPI_RADIUS_M * 0.5,
      poleLen / 2 - 0.08,
      Math.sin(ang) * TIPI_RADIUS_M * 0.5,
    );
    pole.rotation.set(0, -ang, tilt);
    pole.userData.anuKind = "mold_placed_tipi_pole";
    pole.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
    group.add(pole);
  }

  // Doorway flap — facing south by default (+Z direction).
  const doorW = TIPI_RADIUS_M * 0.55;
  const doorH = TIPI_HEIGHT_M * 0.42;
  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(doorW, doorH),
    doorMaterial(),
  );
  // Place on the canvas surface; the cone slants inward so we
  // angle the plane to match the slope.
  const tilt = Math.atan2(TIPI_RADIUS_M, TIPI_HEIGHT_M);
  const baseR = TIPI_RADIUS_M * 0.96;
  door.position.set(0, doorH / 2 + 0.02, baseR);
  door.rotation.x = -tilt * 0.6;
  door.userData.anuKind = "mold_placed_tipi_door";
  door.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
  group.add(door);

  // Anchor on terrain. The kid clicks an XZ in top-down; we ride the
  // heightfield so the tipi sits flush.
  const yaw = (mut.payload?.yaw ?? Math.random() * Math.PI * 2);
  const groundY = sanctuaryGroundY(mut.x, mut.z);
  group.position.set(mut.x, groundY, mut.z);
  group.rotation.y = yaw;
  scene.add(group);
  return group;
}

export const MoldPlaceTipiModule = {
  name: "MoldPlaceTipi",

  _scene: null,

  async load(scene) {
    this._scene = scene;
    const reg = typeof window !== "undefined" ? window.SanctuaryMutations : null;
    if (!reg?.registerToolHandler) return;
    reg.registerToolHandler("place_tipi", (mut, sceneArg) => {
      const target = sceneArg ?? this._scene;
      if (!target) return;
      mut.mesh = buildTipiMesh(mut, target);
    });
    console.log(
      "%c[MoldPlaceTipi] 🏕 Handler registered — kids can place tipis.",
      "color:#d4a574;font-weight:bold;",
    );
  },

  update() {},
  unload() { this._scene = null; },
};
