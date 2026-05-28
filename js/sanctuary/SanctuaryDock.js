/**
 * Sacred Adventures — sanctuary part 3 of 5: THE FISH DOCK.
 *
 * Anu domain: STRUCTURES. Per her sentience note: "Built world — homes,
 * doors, sockets, village objects." The dock is the player's threshold
 * into the pool — they walk out onto the planks, the camera follows,
 * the fishing spot is at the dock's far end.
 *
 * Geometry (all procedural, ~500 tris):
 *
 *      shore_anchor                                  pool_centre
 *  ─────────────┬─────────[planks]──────────────┬──● fishing spot
 *               │                               │
 *               · 2 stair steps to walk up      · raised platform tip
 *
 *   • 8 planks running pool-ward (BoxGeometry, butted side-by-side).
 *   • 4 support posts (CylinderGeometry, dipped into the basin floor).
 *   • Side rails on both planks runs (BoxGeometry, eye-level for the
 *     avatar).
 *   • A short 2-step entry on the shore end so the dock walks UP from
 *     terrain to plank surface naturally.
 *   • A small bench post at the very tip — visual cue for "this is
 *     where you stop and fish from".
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN, ANU_INTERACTION_VERB } from "../v2/anu/SimulationController.js";
import {
  SANCTUARY_POOL_CENTER_X,
  SANCTUARY_POOL_CENTER_Z,
  SANCTUARY_POOL_RADIUS_M,
  sanctuaryGroundY,
} from "./SanctuaryGround.js";

// Geometry constants — all metres.
const DOCK_AZIMUTH_RAD = Math.PI; // pier points to world -Z (south); player faces +Z toward it
// 1.6 → 2.4 m (50 % wider, per user) so the player can comfortably walk
// the planks. PLANK_COUNT stays at 8 so each plank just gets wider.
const DOCK_WIDTH_M = 2.4;
const DOCK_LENGTH_M = 7.0;
const DOCK_DECK_THICKNESS_M = 0.10;
const PLANK_COUNT = 8;
const PLANK_GAP_M = 0.02;
const POST_RADIUS_M = 0.10;
const POST_SEGMENTS = 8;
const RAIL_TOP_Y = 0.85;
const RAIL_THICKNESS = 0.06;

// Dock surface placement — set in load(), read by getDockSurfaceY().
let _placement = null; // { midX, midZ, yaw, surfaceY, halfLen, halfWid }

/**
 * Returns the dock deck surface Y for world point (wx, wz) if that point
 * is above the dock footprint, otherwise null. Used by SanctuaryClickToMove
 * so the avatar walks ON the deck instead of through it.
 */
export function getDockSurfaceY(wx, wz) {
  if (!_placement) return null;
  const { midX, midZ, yaw, surfaceY, halfLen, halfWid } = _placement;
  const dx = wx - midX;
  const dz = wz - midZ;
  // Rotate world delta into dock-local space (inverse of rotation.y = yaw).
  const lx = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
  const lz = Math.sin(yaw) * dx + Math.cos(yaw) * dz;
  if (Math.abs(lx) <= halfLen && Math.abs(lz) <= halfWid) return surfaceY;
  return null;
}

// Wood materials (cached so multiple instances share the same memory).
let _cachedDeckMat = null;
let _cachedDarkMat = null;
let _cachedRailMat = null;

function deckMaterial() {
  if (_cachedDeckMat) return _cachedDeckMat;
  _cachedDeckMat = new THREE.MeshStandardMaterial({
    color: 0x7a4d2c, // deeper natural wood
    roughness: 0.75,
    metalness: 0.05,
    flatShading: false,
  });
  return _cachedDeckMat;
}
function darkWoodMaterial() {
  if (_cachedDarkMat) return _cachedDarkMat;
  _cachedDarkMat = new THREE.MeshStandardMaterial({
    color: 0x3d2715, // darker aged wood
    roughness: 0.85,
    metalness: 0.02,
    flatShading: false,
  });
  return _cachedDarkMat;
}
function railMaterial() {
  if (_cachedRailMat) return _cachedRailMat;
  _cachedRailMat = new THREE.MeshStandardMaterial({
    color: 0x5c3a21, // mid-tone natural wood
    roughness: 0.80,
    metalness: 0.02,
    flatShading: false,
  });
  return _cachedRailMat;
}

/**
 * Resolve the dock's world placement. The shore-side anchor sits on
 * the natural ground at `pool_centre + radius * dock_dir` (south of
 * the pool). The pool-side tip extends `DOCK_LENGTH_M` into the water.
 */
function dockAnchors() {
  const dx = Math.cos(DOCK_AZIMUTH_RAD);
  const dz = Math.sin(DOCK_AZIMUTH_RAD);
  // Shore anchor: just outside the pool's bank-blend (radius × 1.05).
  const shoreX = SANCTUARY_POOL_CENTER_X + dx * SANCTUARY_POOL_RADIUS_M * 1.05;
  const shoreZ = SANCTUARY_POOL_CENTER_Z + dz * SANCTUARY_POOL_RADIUS_M * 1.05;
  // Pool tip: extends INTO the pool.
  const tipX = SANCTUARY_POOL_CENTER_X + dx * (SANCTUARY_POOL_RADIUS_M * 0.55);
  const tipZ = SANCTUARY_POOL_CENTER_Z + dz * (SANCTUARY_POOL_RADIUS_M * 0.55);
  return { dx, dz, shoreX, shoreZ, tipX, tipZ };
}

function buildPlanks(group, dockY) {
  // Each plank: a long thin box running along the dock's length axis.
  // The dock is centred on its midpoint and rotated so its +X locally
  // is the pool-ward direction. We orient the group at the end; for
  // the geometry pass we lay planks along local +X.
  const plankWidth = (DOCK_WIDTH_M - PLANK_GAP_M * (PLANK_COUNT - 1)) / PLANK_COUNT;
  for (let i = 0; i < PLANK_COUNT; i++) {
    const localZ = -DOCK_WIDTH_M / 2 + plankWidth / 2 + i * (plankWidth + PLANK_GAP_M);
    const geo = new THREE.BoxGeometry(DOCK_LENGTH_M, DOCK_DECK_THICKNESS_M, plankWidth);
    const plank = new THREE.Mesh(geo, deckMaterial());
    plank.position.set(0, dockY, localZ);
    plank.castShadow = true;
    plank.receiveShadow = true;
    // renderOrder = 15 so the plank surface (the "stool") draws AFTER
    // the player travel circle (disc=4, ring=9, arrow=10) in the
    // opaque pass — the circle uses depthTest:false so only renderOrder
    // can sort it. User-requested 2026-05-28: "outer circles of player
    // circle ... and facing arrow ... covering the stool". With plank
    // at renderOrder 15 the stool surface paints over the disc parts
    // that hang past the plank footprint.
    plank.renderOrder = 15;
    plank.name = `sanctuary_dock_plank_${i}`;
    plank.userData.anuKind = "sanctuary_dock_plank";
    plank.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
    group.add(plank);
  }
}

function buildPosts(group, dockY) {
  // 4 corners + 2 midpoints. Posts plunge down through the water/basin
  // to fake the "anchored to the lake bed" read. They terminate
  // BELOW the basin floor so the cut never reads.
  const half = DOCK_WIDTH_M / 2 + 0.05;
  const xs = [-DOCK_LENGTH_M * 0.45, -DOCK_LENGTH_M * 0.15, DOCK_LENGTH_M * 0.15, DOCK_LENGTH_M * 0.45];
  const postHeight = 3.0;
  const postCentreOffsetY = dockY - postHeight / 2 + 0.2;
  for (const lx of xs) {
    for (const lz of [-half, half]) {
      const geo = new THREE.CylinderGeometry(POST_RADIUS_M, POST_RADIUS_M * 1.1, postHeight, POST_SEGMENTS);
      const post = new THREE.Mesh(geo, darkWoodMaterial());
      post.position.set(lx, postCentreOffsetY, lz);
      // Shadow cost cut — posts are thin and mostly underwater; their
      // shadow contribution at chase-cam is invisible.
      post.castShadow = false;
      post.receiveShadow = false;
      // renderOrder = 15 so the post draws AFTER the player travel
      // circle (disc=4, ring=9, arrow=10). The circle's materials have
      // depthTest:false so opaque planks can't naturally occlude them
      // — the only sort handle is renderOrder. User-requested
      // 2026-05-28 (9× asked, "very annoyed stage"): circle is too
      // high z-index for the rails — fix dock-side. Posts now visually
      // pass IN FRONT of the disc where they overlap.
      post.renderOrder = 15;
      post.name = `sanctuary_dock_post`;
      post.userData.anuKind = "sanctuary_dock_post";
      post.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
      group.add(post);
    }
  }
}

function buildRails(group, dockY) {
  // Full railing now (May-17 2026 user fix: "fix the guardrails of dock,
  // they are floating they need their counter logs to create the
  // complete guard rail so kids wont be falling into the water").
  //
  // Structure on each side of the dock:
  //   • Top rail (eye-level) — long horizontal box.
  //   • Middle rail          — shin-level horizontal box (the prior
  //                              missing piece that left kids able to
  //                              roll under the top rail).
  //   • Vertical balusters   — short posts every ~0.7 m connecting
  //                              the deck to the top rail. These are
  //                              the "counter logs" the user asked for.
  //
  // The pool-end of the dock OMITS the perpendicular cross-rail so the
  // player can walk to the very tip and lean forward — `SanctuaryCircles`
  // paints a gold safety ring there, and the new lean-look camera pose
  // (added in `SanctuaryClickToMove`) makes that the spot where the
  // fish are visible from above.
  const half = DOCK_WIDTH_M / 2 + 0.04;
  const topY = dockY + RAIL_TOP_Y;
  const midY = dockY + RAIL_TOP_Y * 0.45; // ~38 cm — kid-shin height
  const balusterRadius = 0.04;
  const balusterCount = 7;

  // Long horizontals on both sides — top + middle.
  for (const lz of [-half, half]) {
    for (const railY of [topY, midY]) {
      const geo = new THREE.BoxGeometry(DOCK_LENGTH_M, RAIL_THICKNESS, RAIL_THICKNESS);
      const rail = new THREE.Mesh(geo, railMaterial());
      rail.position.set(0, railY, lz);
      // Shadow cost cut — rails are thin boxes that contribute almost
      // nothing visible to the shadow map.
      rail.castShadow = false;
      rail.receiveShadow = false;
      // renderOrder = 15 so the rail draws AFTER the player travel
      // circle (max renderOrder 10). Same reason as the posts above —
      // circle uses depthTest:false so only renderOrder can sort it.
      rail.renderOrder = 15;
      rail.name = railY === topY ? "sanctuary_dock_rail_top" : "sanctuary_dock_rail_mid";
      rail.userData.anuKind = "sanctuary_dock_rail";
      rail.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
      group.add(rail);
    }

    // Balusters — vertical posts from deck up to top rail. Skip the
    // pool-end so the player can walk forward to the lean spot.
    for (let i = 0; i < balusterCount; i++) {
      const t = i / (balusterCount - 1);
      // Range -45 % .. +35 % of length — leaves the pool tip clear.
      const lx = -DOCK_LENGTH_M * 0.45 + t * DOCK_LENGTH_M * 0.80;
      const geo = new THREE.CylinderGeometry(
        balusterRadius,
        balusterRadius,
        RAIL_TOP_Y,
        6,
        1,
      );
      const baluster = new THREE.Mesh(geo, railMaterial());
      baluster.position.set(lx, dockY + RAIL_TOP_Y / 2, lz);
      // Shadow cost cut — 14 thin balusters were eating the shadow pass
      // for ~zero visible contribution.
      baluster.castShadow = false;
      baluster.receiveShadow = false;
      // renderOrder = 15 so balusters draw AFTER the player travel
      // circle (max renderOrder 10) — same fix as the posts + rails
      // above. User-requested 2026-05-28 (9× asked).
      baluster.renderOrder = 15;
      baluster.name = "sanctuary_dock_baluster";
      baluster.userData.anuKind = "sanctuary_dock_baluster";
      baluster.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
      group.add(baluster);
    }
  }

  // Shore-end cross-rail intentionally omitted — leaving the step
  // entry open is the natural walk-on. The two side rails + balusters
  // already prevent off-side falls; the pool-end stays open for the
  // lean-look pose.
}

function buildSteps(group, dockY, shoreGroundY) {
  // Two stair steps from shore terrain up to the dock surface. Each
  // step is a wide thin box.
  const STEP_COUNT = 2;
  const totalRise = dockY - shoreGroundY;
  if (totalRise <= 0.04) return; // already flush — skip
  const stepDepth = 0.5;
  const stepWidth = DOCK_WIDTH_M + 0.4;
  for (let i = 0; i < STEP_COUNT; i++) {
    const stepY = shoreGroundY + ((i + 1) / STEP_COUNT) * totalRise - DOCK_DECK_THICKNESS_M * 0.5;
    const stepX = -DOCK_LENGTH_M / 2 - stepDepth * (STEP_COUNT - i) + stepDepth * 0.5;
    const geo = new THREE.BoxGeometry(stepDepth, DOCK_DECK_THICKNESS_M, stepWidth);
    const step = new THREE.Mesh(geo, deckMaterial());
    step.position.set(stepX, stepY, 0);
    // Shadow cost cut — steps are flush to ground; their shadow merges
    // with the deck's already.
    step.castShadow = false;
    step.receiveShadow = true;
    // renderOrder = 15 (same as plank) so steps sort over the player
    // travel circle. Matches the plank fix above.
    step.renderOrder = 15;
    step.name = `sanctuary_dock_step_${i}`;
    step.userData.anuKind = "sanctuary_dock_step";
    step.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
    group.add(step);
  }
}

function buildEndCap(group, dockY) {
  // Small raised bench / platform marker at the pool-side tip — visual
  // anchor for "fish here". One short post head; SanctuaryCircles draws
  // the gold ring around it.
  const geo = new THREE.CylinderGeometry(0.20, 0.22, 0.55, 10);
  const cap = new THREE.Mesh(geo, darkWoodMaterial());
  cap.position.set(DOCK_LENGTH_M / 2 - 0.2, dockY + 0.27, 0);
  cap.castShadow = false;
  cap.receiveShadow = true;
  // renderOrder = 15 — same fix as planks/steps so the bench cap
  // sorts above the player travel circle.
  cap.renderOrder = 15;
  cap.name = "sanctuary_dock_endcap";
  cap.userData.anuKind = "sanctuary_dock_endcap";
  cap.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
  group.add(cap);
}

export const SanctuaryDockModule = {
  name: "SanctuaryDock",

  _scene: null,
  _root: null,
  _fishingSpot: null,

  async load(scene) {
    if (this._root) return;
    this._scene = scene;

    const { shoreX, shoreZ, tipX, tipZ } = dockAnchors();
    const shoreGroundY = sanctuaryGroundY(shoreX, shoreZ);
    const dockY = shoreGroundY + 0.42; // dock surface sits ~42 cm above shore

    // Build all geometry in LOCAL space (dock long axis = local +X),
    // then place the parent group at the midpoint between shore and tip
    // and rotate so local +X points at the pool tip.
    const local = new THREE.Group();
    buildPlanks(local, 0);
    buildPosts(local, 0);
    buildRails(local, 0);
    buildEndCap(local, 0);
    buildSteps(local, 0, shoreGroundY - dockY);

    const midX = (shoreX + tipX) / 2;
    const midZ = (shoreZ + tipZ) / 2;
    const dx = tipX - shoreX;
    const dz = tipZ - shoreZ;
    const yaw = Math.atan2(dz, dx);

    // Register deck surface for avatar elevation override.
    // Walkable footprint = the rectangle where the avatar's Y is forced
    // up onto the deck surface. Generous +0.45 m on each side of the
    // visible deck so the kid doesn't sink-and-bob when standing on the
    // very edge of a plank (the avatar's hip is ~0.25 m wide and the
    // raised rails make the edge feel walkable).
    _placement = {
      midX, midZ, yaw,
      surfaceY: dockY + DOCK_DECK_THICKNESS_M * 0.5,
      halfLen:  DOCK_LENGTH_M / 2 + 0.45,
      halfWid:  DOCK_WIDTH_M  / 2 + 0.45,
    };
    if (typeof window !== "undefined") {
      window.__sanctuaryDockSurface = { getY: getDockSurfaceY };
    }
    // Public extents — used by SanctuaryClickToMove to detect when a
    // ground-plane raycast actually lands on the dock footprint, so
    // clicks on the dock end up walking the player ON the dock instead
    // of past it into the water.
    if (typeof window !== "undefined") {
      // Click-tolerance footprint is INTENTIONALLY WIDER than the actual
      // dock geometry (+0.60 m beyond each edge instead of +0.25/+0.20).
      // Reason: kids tend to click ABOVE the visible dock — at the
      // perspective horizon edge — and we want those clicks to still
      // walk them onto the dock rather than skipping past into the pool.
      // The walkable-Y override (getDockSurfaceY) keeps its tighter
      // 0.25/0.20 footprint so the avatar only LIFTS when actually on
      // the planks.
      window.__sanctuaryDockExtents = {
        midX, midZ, yaw,
        halfLen: DOCK_LENGTH_M / 2 + 0.80,
        halfWid: DOCK_WIDTH_M / 2 + 0.60,
        surfaceY: dockY + DOCK_DECK_THICKNESS_M * 0.5,
      };
    }

    const root = new THREE.Group();
    root.add(local);
    root.position.set(midX, dockY, midZ);
    root.rotation.y = yaw;
    root.name = "sanctuary_dock";
    root.userData.anuId = "structures.sanctuary.dock";
    root.userData.anuKind = "sanctuary_dock";
    root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
    root.userData.anuInteractable = true;
    root.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.ENTER, ANU_INTERACTION_VERB.USE];

    scene.add(root);
    this._root = root;
    // Park the fishing-spot world coords for SanctuaryFish + Circles.
    // Fishing spot Y = DECK SURFACE, not dock base. dockY is the centre
    // of the plank thickness, so the visible deck top is +half-thickness.
    // (Bug fix May-25 2026: the white ring was being covered by the
    //  dock geometry because spotY was set to dockY (the base) instead
    //  of the surface, putting the ring INSIDE the plank.)
    const _deckSurfaceY = dockY + DOCK_DECK_THICKNESS_M * 0.5;
    this._fishingSpot = { x: tipX, y: _deckSurfaceY, z: tipZ };
    if (typeof window !== "undefined") {
      window.__sanctuaryFishingSpot = { ...this._fishingSpot };
    }

    console.log(
      `%c[Sanctuary] 🪵 Dock placed (${shoreX.toFixed(1)}, ${shoreZ.toFixed(1)}) → (${tipX.toFixed(1)}, ${tipZ.toFixed(1)})  surface Y=${dockY.toFixed(2)}`,
      "color:#a98455;font-weight:bold;",
    );
  },

  update() {
    // Static structure — no per-frame work.
  },

  unload(scene) {
    if (!this._root) return;
    scene.remove(this._root);
    this._root.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
    });
    this._root = null;
    this._scene = null;
    if (typeof window !== "undefined") {
      delete window.__sanctuaryFishingSpot;
      delete window.__sanctuaryDockSurface;
      delete window.__sanctuaryDockExtents;
    }
    _placement = null;
  },
};
