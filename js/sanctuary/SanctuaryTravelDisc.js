/**
 * v2 photoreal travel disc + ring + facing arrow (legacy
 * `TravelFloorCircleMaterials.js`). Replaces the May-18 canvas-baked
 * decals that read flat/cheap compared to the main game's gold-green
 * shader circles.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";
import {
  createPhotorealTravelDiscMaterial,
  createPhotorealTravelRingMaterial,
  touchTravelCircleTime,
} from "../v2/anu/TravelFloorCircleMaterials.js";
import {
  V2_AVATAR_TRAVEL_CIRCLE_RADIUS_M,
  V2_NPC_YB_TIPI1_GOLD_CIRCLE_RADIUS_M,
} from "../v2/constants.js";

const TRAVEL_DECAL_CLEAR_ABOVE_RIM_M = 0.015;

/**
 * Player avatar — 1:1 `WorldAvatar.js` travel decal stack.
 * @returns {THREE.Group & { userData: { _travelMats?: THREE.Material[] } }}
 */
export function buildPlayerV2TravelDecal(nameTag = "player_avatar") {
  const R = V2_AVATAR_TRAVEL_CIRCLE_RADIUS_M;
  const group = new THREE.Group();
  group.name = `${nameTag}_travel_decal_group`;
  group.userData.anuKind = `${nameTag}_travel_decal_group`;
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;

  // FINAL recipe (May-19 2026, 10th attempt — finally correct):
  //   transparent: false  → stays in the OPAQUE pass
  //   depthTest:   false  → ignores terrain/hill/foliage depth (always shows)
  //   depthWrite:  false  → doesn't poison the depth buffer for the avatar
  //   renderOrder: 8/9/10 → sorts BEFORE the avatar (renderOrder 10000)
  //                          within the opaque pass
  //
  // Why this works (and the prior 9 attempts didn't):
  //   – Three.js renders opaque first, then transparent. Once a mesh is
  //     transparent, NO renderOrder value can bring it ahead of the
  //     opaque avatar.
  //   – With everything in opaque, sort = renderOrder. Disc draws first
  //     (no depth test = visible everywhere), then avatar draws second
  //     with depthTest=true reading the ground's depth — avatar wins
  //     where she's in front of ground, disc shows everywhere else.
  //   – `depthWrite: false` on the disc keeps the depth buffer clean so
  //     the avatar's body depth test sees the ground, not the disc.
  //
  // Result: disc is always visible over terrain/hills/grass, AND the
  // avatar body always renders on top of the disc where they overlap.
  const discMat = createPhotorealTravelDiscMaterial("player", R);
  discMat.depthTest = false;     // ignore ground/foliage depth
  discMat.depthWrite = false;    // don't write depth
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 72), discMat);
  disc.name = `${nameTag}_travel_circle`;
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = TRAVEL_DECAL_CLEAR_ABOVE_RIM_M;
  disc.userData.anuKind = "avatar_travel_circle";
  disc.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;
  disc.renderOrder = 8;
  group.add(disc);

  const innerR = R * 0.92;
  const ringMat = createPhotorealTravelRingMaterial("player", innerR, R);
  ringMat.depthTest = false;
  ringMat.depthWrite = false;
  const ring = new THREE.Mesh(new THREE.RingGeometry(innerR, R, 96), ringMat);
  ring.name = `${nameTag}_travel_circle_outline`;
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = TRAVEL_DECAL_CLEAR_ABOVE_RIM_M + 0.008;
  ring.userData.anuKind = "avatar_travel_circle_outline";
  ring.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;
  ring.renderOrder = 9;
  group.add(ring);

  const arrowShape = new THREE.Shape()
    .moveTo(0, R * 0.92)
    .lineTo(R * 0.22, R * 0.52)
    .lineTo(-R * 0.22, R * 0.52)
    .lineTo(0, R * 0.92);
  const arrow = new THREE.Mesh(
    new THREE.ShapeGeometry(arrowShape),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: false,
      opacity: 1,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
  );
  arrow.name = `${nameTag}_facing_arrow`;
  arrow.rotation.x = -Math.PI / 2;
  arrow.position.y = TRAVEL_DECAL_CLEAR_ABOVE_RIM_M + 0.015;
  arrow.userData.anuKind = "avatar_facing_arrow";
  arrow.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;
  arrow.renderOrder = 10;
  group.add(arrow);

  group.userData._travelMats = [discMat, ringMat];
  return group;
}

/** Back-compat alias — sanctuary avatar + NPCs call `buildTravelDisc`. */
export function buildTravelDisc(opts = {}) {
  if (opts.kind === "npc") {
    return buildNpcV2TravelDecalGroup(opts);
  }
  return buildPlayerV2TravelDecal(opts.nameTag ?? "player_avatar");
}

/**
 * NPC facing pivot child — gold arrow only (disc/ring live on seat root in v2).
 */
export function buildNpcV2FacingArrow(radius, liftY, nameTag = "npc") {
  const R = radius ?? V2_NPC_YB_TIPI1_GOLD_CIRCLE_RADIUS_M;
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
      depthTest: false,
      depthWrite: false,
    }),
  );
  arrow.name = `${nameTag}_gold_travel_arrow`;
  arrow.rotation.x = -Math.PI / 2;
  arrow.position.y = liftY + 0.015;
  arrow.userData.anuKind = `${nameTag}_travel_arrow`;
  arrow.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
  arrow.renderOrder = 10;
  return arrow;
}

/** Empty group placeholder when callers expected a combined npc decal group. */
export function buildNpcV2TravelDecalGroup({ nameTag = "npc" } = {}) {
  const g = new THREE.Group();
  g.name = `${nameTag}_travel_decal_group`;
  g.userData.anuKind = `${nameTag}_travel_decal_group`;
  g.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
  return g;
}

export function touchSanctuaryTravelCircleTime(materials) {
  if (!Array.isArray(materials)) return;
  const t =
    (typeof performance !== "undefined" ? performance.now() : 0) * 0.001;
  for (let i = 0; i < materials.length; i++) {
    touchTravelCircleTime(materials[i], t);
  }
}
