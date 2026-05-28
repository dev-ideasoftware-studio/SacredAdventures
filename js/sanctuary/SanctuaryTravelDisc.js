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

/**
 * Vertical gap between the avatar's travel disc/ring/arrow decals and
 * the surface beneath. Was 0.015 m (15 mm) which is fine on flat
 * terrain but caused visible z-fighting / flicker between the disc
 * and the dock plank surface at oblique camera angles — the dock at
 * Y=0.40 + disc at Y=0.415 is only ~15 mm of separation, well under
 * the per-pixel depth-precision threshold at typical view distances.
 *
 * Bumped 0.015 → 0.04 (40 mm, ~1.5 inches) so the disc clearly floats
 * above every walkable surface (dock planks, terrain bumps, sacred
 * platform tiles). User-requested 2026-05-28 (9× asked, "getting very
 * annoyed stage").
 */
const TRAVEL_DECAL_CLEAR_ABOVE_RIM_M = 0.04;

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
  // User-requested 2026-05-28: "raise the player circle itself above the
  // z-index of dock again". Bumped 4 → 18 so the disc body draws AFTER
  // dock parts (renderOrder 15). With depthTest:false the disc body
  // then paints on top of the dock plank/posts/rails wherever they
  // overlap — body always visible over the dock surface. Stays below
  // the ring border (renderOrder 20, depthTest:true) so the border is
  // still naturally occluded by dock geometry the way the user
  // confirmed "borders are good".
  // Trade-off: fish (renderOrder 5) now swim UNDER the disc body
  // visually. That's acceptable for the dock fix; revisit if the user
  // reports fish-under-disc looking off.
  disc.renderOrder = 18;
  group.add(disc);

  const innerR = R * 0.92;
  const ringMat = createPhotorealTravelRingMaterial("player", innerR, R);
  // User-requested 2026-05-28: "fix z-index of borders of circle still on
  // wrong z-index for outer white border and inner white border". The
  // ring shader paints from innerR to outerR — both the inner-edge and
  // outer-edge white borders the user sees are this single mesh.
  //
  // Old recipe (depthTest:false + renderOrder:9) drew BEFORE dock
  // (renderOrder 15) AND ignored depth, so dock geometry couldn't
  // occlude the ring at all. New recipe inverts that:
  //   depthTest:true  → respect dock + avatar depth
  //   depthWrite:false→ don't poison depth for other selection decals
  //   renderOrder:20  → draws AFTER dock (15), so the dock-plank depth
  //                     is already in the buffer when the ring tries
  //                     to draw → posts/rails/balusters/planks properly
  //                     hide the ring border where they cross it.
  // The disc body stays depthTest:false (always visible over terrain);
  // only the BORDER respects geometry, which is what the user wants.
  ringMat.depthTest = true;
  ringMat.depthWrite = false;
  const ring = new THREE.Mesh(new THREE.RingGeometry(innerR, R, 96), ringMat);
  ring.name = `${nameTag}_travel_circle_outline`;
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = TRAVEL_DECAL_CLEAR_ABOVE_RIM_M + 0.008;
  ring.userData.anuKind = "avatar_travel_circle_outline";
  ring.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;
  ring.renderOrder = 20;
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
  // Arrow rides one above the disc body so the facing direction is
  // visible on top of the disc surface even where the dock plank sits
  // between them in world Y. (renderOrder 19 = disc + 1, ring still
  // wins at 20 because we want the bright cream border on top of the
  // arrow tip when they overlap.)
  arrow.renderOrder = 19;
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
