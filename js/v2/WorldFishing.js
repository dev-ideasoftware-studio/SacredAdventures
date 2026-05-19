/**
 * Sacred Adventures v2 — fishing module (the first "fun spot").
 *
 * Player spec May-16 2026:
 *   "create our first fun spot — the fishing dock circle, when player gets
 *    there, put a simple fishing pool — wood pole with a simple line and
 *    a walnut bob and a rock for a sinker and a metal hook, the fish in
 *    the pond will come to investigate. 50 % chance per 10 seconds it
 *    will bite the hook and player now will have a tension meter graph
 *    show up in a semi radial, with red at the very right if the fish
 *    model is pulling too far, the fish always pull towards the tipi 1
 *    side, so players can see the fish wriggling. if player holds down
 *    space bar properly they can release pressure on the line so fish
 *    tires after 30 seconds and the pull the wiggling fish out of water.
 *    You got a fish, and attach the fish to side of player model as they
 *    walk around with every fish they catch — could be alot so keep
 *    gluing for fun."
 *
 * Lifecycle:
 *   IDLE         — player outside the dock fishing circle. Pole hidden.
 *   EQUIPPED     — player inside the circle. Pole/line/hook visible
 *                  attached to avatar. Hook sits in water under the
 *                  pier tip. Bite roll runs every BITE_ROLL_INTERVAL_S.
 *                  Pool fish drift toward the hook to investigate.
 *   FIGHTING     — a fish is on the hook. Tension HUD appears. Fish is
 *                  pulled toward tipi-1 direction (`pullDirX/Z` on
 *                  `window._v2FishingPoint`). Spacebar held = release
 *                  tension. Tension fills passively; if it tops red
 *                  the line snaps and the fish escapes. Fish stamina
 *                  drains at a constant rate — after FISH_STAMINA_S
 *                  of fight, transition to LANDING.
 *   LANDING      — the fish is pulled out of the water up to the rod
 *                  tip over LANDING_DURATION_S, then a trophy clone is
 *                  glued to the player's belt and the FSM returns to
 *                  EQUIPPED to fish again. The borrowed pond fish is
 *                  hidden permanently so each catch removes one from
 *                  the visible pond population.
 *
 * Globals consumed (set by `WorldPool2.js`):
 *   - `window._v2FishingPoint = { x, z, deckTopY, waterY, pullDirX, pullDirZ }`
 *   - `window._v2PoolFish` — array of fish meshes orbiting the pond.
 *   - `window._v2PoolFishTemplate = { geometry, fishLen, targetLengthM }`
 *      used to build trophy clones attached to the player.
 *
 * Globals exposed:
 *   - `window._v2FishingActive` — true during FIGHTING. `World.js`
 *      checks this to suppress its jump-on-space handler so the player
 *      doesn't pogo while playing the line.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN } from "./anu/SimulationController.js";
import { V2_AVATAR_TRAVEL_CIRCLE_RADIUS_M } from "./constants.js";
import { getRuntimeService } from "./RuntimeServices.js";
import { terrainY } from "./WorldTerrain.js";

/** Radius (m) around the dock fishing decal that flips us into EQUIPPED. */
const FISHING_CIRCLE_R_M = 1.6;
/** How often we roll for a bite while EQUIPPED, and the per-roll P(bite).
 *  May-16 2026 user spec ("chance of catching fish increase, so kids can
 *  have fun") — bumped from 0.5 / 10 s to 0.78 / 8 s, so expected wait
 *  ≈ 8 s × (1/0.78) ≈ 10 s of dock-time per bite, and any kid sitting at
 *  the dock will see a fish hit within ~30 s with > 99 % probability. */
const BITE_ROLL_INTERVAL_S = 8.0;
const BITE_PROBABILITY = 0.78;
/** Window (s) at the end of the bite countdown during which the bobber
 *  visibly dunks down as a kid-readable "fish nibbling" tell — but ONLY
 *  if the predetermined next roll is going to hit. */
const BOBBER_DUNK_WINDOW_S = 0.7;
/** Max vertical dip of the bobber during the dunk (m). */
const BOBBER_DUNK_MAX_M = 0.07;
/** Fishing-camera framing.
 *
 *  May-2026 user spec (iteration D — reverts the top-down attempt):
 *  "have the rod out above, and the pond. don't have directly above
 *  player — have the scene in the shot too". So the camera sits BEHIND
 *  and ABOVE the player on a gentle tilt, looking past the rod tip into
 *  the pond. The dock + player + rod read in the foreground; the pool
 *  fish + far bank + surrounding trees fill the upper frame.
 *
 *  Geometry (May-17 2026 user spec: "default view to being 10 feet
 *  above player and looking down 45 degree between seeing more over the
 *  dock"):
 *      height = 10 ft               = 3.048 m  (above player feet)
 *      back   = 1.0 m               (slight pull-back so the player rig
 *                                    + dock edge stay framed; without
 *                                    it the camera would sit directly
 *                                    above the player and read as a
 *                                    pure top-down)
 *      look-forward = 2.0 m past the bob along the player→hook axis.
 *      look-y  = waterY + 0.02 m    (still water-surface) — combined
 *                                    with the ~3 m vertical drop and
 *                                    ~3 m horizontal forward run this
 *                                    yields a ~45° downward pitch that
 *                                    sees the player, the dock, and a
 *                                    generous fan of pond beyond it.
 */
const FISHING_CAM_BACK_M = 1.0;
const FISHING_CAM_HEIGHT_M = 3.048;
const FISHING_CAM_LOOK_FORWARD_M = 2.0;
/** When the camera engages, the avatar is rotated to face the hook so we
 *  see the back of the player. This is the only yaw forcing we do — once
 *  fishing ends, the player keeps the new yaw and can walk away normally. */
const FORCE_PLAYER_FACING_HOOK = true;
/** Seconds of managed-tension fight before the fish auto-tires & lands. */
const FISH_STAMINA_S = 30.0;
/** Animation duration when the fish is lifted out of water at the end. */
const LANDING_DURATION_S = 1.6;
/** Tension dynamics — May-2026 user spec ("capture the space bar to begin
 *  tapping to keep the fish on the line"). Tension fills passively at
 *  `TENSION_FILL_PER_S`; each spacebar TAP drops it by
 *  `TENSION_RELEASE_PER_TAP`. Roughly four taps per second matches the old
 *  hold-to-release feel. We rely on rising-edge detection in update(), not
 *  on the polled `isKeyDown`, so a held key does NOT slowly bleed tension —
 *  the player has to actually tap. */
const TENSION_FILL_PER_S = 0.18;
const TENSION_RELEASE_PER_TAP = 0.10;

/**
 * Tackle loadout — placeholder data so the rest of the codebase can plug
 * in inventory / shop UI later. Each category lists a few preset entries
 * with `attract` (multiplier on per-roll bite probability + per-fish
 * curiosity activation chance) and `catch` (multiplier on fish stamina
 * drain, i.e. shortens the fight when ≥ 1). Multipliers compose across
 * categories: `effectiveAttract = ∏ attract`, `effectiveCatch = ∏ catch`.
 *
 * The first entry of every category is the "starter" loadout — all 1.0
 * so a fresh world's fishing feel matches the pre-tackle baseline.
 *
 * Cycle keys while EQUIPPED: 1 → next worm, 2 → next hook,
 *                            3 → next lure, 4 → next pole.
 */
const TACKLE_CATALOG = Object.freeze({
  worms: Object.freeze([
    Object.freeze({ id: "red_wriggler",  name: "Red Wriggler",  attract: 1.00, catch: 1.00 }),
    Object.freeze({ id: "nightcrawler",  name: "Nightcrawler",  attract: 1.18, catch: 1.05 }),
    Object.freeze({ id: "mealworm",      name: "Mealworm",      attract: 0.95, catch: 1.10 }),
    Object.freeze({ id: "glow_grub",     name: "Glow Grub",     attract: 1.32, catch: 0.95 }),
  ]),
  hooks: Object.freeze([
    Object.freeze({ id: "basic_j",       name: "J-Hook",        attract: 1.00, catch: 1.00 }),
    Object.freeze({ id: "circle",        name: "Circle Hook",   attract: 1.00, catch: 1.18 }),
    Object.freeze({ id: "treble",        name: "Treble Hook",   attract: 0.94, catch: 1.32 }),
    Object.freeze({ id: "barbless",      name: "Barbless",      attract: 1.04, catch: 0.92 }),
  ]),
  lures: Object.freeze([
    Object.freeze({ id: "none",          name: "No Lure",       attract: 1.00, catch: 1.00 }),
    Object.freeze({ id: "silver_spoon",  name: "Silver Spoon",  attract: 1.22, catch: 0.98 }),
    Object.freeze({ id: "brass_spinner", name: "Brass Spinner", attract: 1.34, catch: 1.00 }),
    Object.freeze({ id: "rainbow_fly",   name: "Rainbow Fly",   attract: 1.45, catch: 0.96 }),
  ]),
  poles: Object.freeze([
    Object.freeze({ id: "walnut_simple", name: "Walnut Simple", attract: 1.00, catch: 1.00 }),
    Object.freeze({ id: "cedar_flex",    name: "Cedar Flex",    attract: 1.00, catch: 1.10 }),
    Object.freeze({ id: "graphite_pro",  name: "Graphite Pro",  attract: 1.05, catch: 1.22 }),
  ]),
});
/** Per-category cycle keys (single-character, matched against `isKeyDown`). */
const TACKLE_CYCLE_KEYS = Object.freeze({
  "1": "worms",
  "2": "hooks",
  "3": "lures",
  "4": "poles",
});
/** Cutoff: tension >= 1 snaps the line and we lose the fish. */
const TENSION_SNAP = 1.0;
/** Where the red-zone starts on the meter (visual cue only). */
const TENSION_RED_ZONE = 0.78;
/** How far the hooked fish drifts toward tipi-1 at full tension (m). */
const FISH_PULL_MAX_M = 1.6;
/** Hook depth below water surface. */
const HOOK_BELOW_WATER_M = 0.55;
/** Pole + tackle dimensions (m). */
const POLE_LENGTH = 1.45;
const POLE_RADIUS = 0.022;
const BOB_RADIUS = 0.052;
const SINKER_RADIUS = 0.034;
const HOOK_LENGTH = 0.08;
/** Where the pole hangs from the avatar root (player's right side, forward + chest). */
const POLE_GRIP_OFFSET = new THREE.Vector3(0.32, 1.05, 0.18);
/** Pole forward tilt (rad) so the tip overhangs the water in front of the player. */
const POLE_PITCH = -0.95;
const POLE_YAW = 0.12;

/** Trophy stringer geometry. Caught fish hang from a small rope on
 *  the player's right hip — first catch closest to the body, each
 *  subsequent catch dangles slightly further out and slightly lower.
 *  Reads like a real fisherman's stringer. */
const STRINGER_ANCHOR_LOCAL = new THREE.Vector3(0.32, 0.92, 0.04); // right hip
const STRINGER_PITCH = 0.14;    // horizontal offset added per fish
const STRINGER_DROP  = 0.10;    // vertical drop added per fish
const STRINGER_MAX_DROP = 0.28; // clamp drop so the chain doesn't run off the player
const TROPHY_LENGTH_SCALE = 0.82; // shrink each fish a touch — feels more "child-size"

/* ─────────────────────── procedural tackle ─────────────────────── */

function buildPoleGroup() {
  const group = new THREE.Group();
  group.name = "fishing_pole_rig";
  group.userData.anuId = "player.fishing.pole_rig";
  group.userData.anuKind = "player_fishing_pole";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;

  // ── Pole shaft ────────────────────────────────────────────────────
  // Three stacked segments give a believable taper from grip-end to tip
  // without paying for a high-poly lathe. We keep the segments inside
  // `_poleSegments` on the module so they can be bent toward the hook
  // during FIGHTING (`_updateRodFlex`) — a real-fishing-game touch.
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x5a3a1f,            // walnut shaft
    roughness: 0.62,
    metalness: 0.08,
  });
  const segLens = [POLE_LENGTH * 0.42, POLE_LENGTH * 0.34, POLE_LENGTH * 0.24];
  const segRads = [
    [POLE_RADIUS * 1.00, POLE_RADIUS * 0.82], // grip-side: thicker
    [POLE_RADIUS * 0.82, POLE_RADIUS * 0.58], // mid
    [POLE_RADIUS * 0.58, POLE_RADIUS * 0.22], // tip: very thin
  ];
  /**
   * Pivot chain — each pivot is a child of the previous segment, positioned
   * at the parent segment's tip Y. Rotating `pivot[i].rotation.x` bends
   * segments i…end around that joint in lockstep, so a small per-pivot
   * angle compounds into a smooth curving rod arc (think: "fishing rod
   * fighting the fish"). Used by `_updateRodFlex(tension)`.
   */
  const poleSegments = [];
  let parent = group; // root of rig
  for (let i = 0; i < 3; i++) {
    const pivot = new THREE.Object3D();
    // First pivot sits at the rig origin; subsequent pivots ride on the
    // previous segment's TIP Y (its geometry was translated to put base
    // at origin and tip at +len in its own local space).
    pivot.position.y = i === 0 ? 0 : segLens[i - 1];
    parent.add(pivot);
    const segGeom = new THREE.CylinderGeometry(segRads[i][1], segRads[i][0], segLens[i], 10);
    segGeom.translate(0, segLens[i] * 0.5, 0);
    const seg = new THREE.Mesh(segGeom, poleMat);
    seg.castShadow = true;
    seg.name = `fishing_pole_seg_${i}`;
    pivot.add(seg);
    poleSegments.push({ pivot, length: segLens[i] });
    parent = seg; // next pivot anchors at this segment's tip
  }

  // ── Cork foregrip ─────────────────────────────────────────────────
  const foregrip = new THREE.Mesh(
    new THREE.CylinderGeometry(POLE_RADIUS * 1.45, POLE_RADIUS * 1.40, 0.16, 14),
    new THREE.MeshStandardMaterial({
      color: 0xc8a268, roughness: 0.95, metalness: 0,
    }),
  );
  foregrip.position.y = 0.04;
  foregrip.castShadow = true;
  group.add(foregrip);

  // Butt cap — black rubber end-stop below the grip.
  const buttCap = new THREE.Mesh(
    new THREE.CylinderGeometry(POLE_RADIUS * 1.55, POLE_RADIUS * 1.55, 0.03, 14),
    new THREE.MeshStandardMaterial({ color: 0x14110d, roughness: 0.92 }),
  );
  buttCap.position.y = -0.012;
  group.add(buttCap);

  // ── Reel ──────────────────────────────────────────────────────────
  // Small cylindrical reel body protruding off the front of the rod
  // just above the foregrip, with a side disc (drag knob) for detail.
  const reelGroup = new THREE.Group();
  reelGroup.position.set(POLE_RADIUS * 1.4, 0.16, 0);
  const reelBody = new THREE.Mesh(
    new THREE.CylinderGeometry(POLE_RADIUS * 2.0, POLE_RADIUS * 2.0, POLE_RADIUS * 2.6, 18),
    new THREE.MeshStandardMaterial({
      color: 0x222428, roughness: 0.42, metalness: 0.78,
    }),
  );
  reelBody.rotation.z = Math.PI / 2; // axis runs out from the rod
  reelGroup.add(reelBody);
  const reelDisc = new THREE.Mesh(
    new THREE.CylinderGeometry(POLE_RADIUS * 2.4, POLE_RADIUS * 2.4, POLE_RADIUS * 0.5, 22),
    new THREE.MeshStandardMaterial({
      color: 0x3a3d42, roughness: 0.32, metalness: 0.88,
    }),
  );
  reelDisc.rotation.z = Math.PI / 2;
  reelDisc.position.x = POLE_RADIUS * 1.5;
  reelGroup.add(reelDisc);
  const reelKnob = new THREE.Mesh(
    new THREE.SphereGeometry(POLE_RADIUS * 0.55, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x8b7a3a, roughness: 0.4, metalness: 0.5 }),
  );
  reelKnob.position.set(POLE_RADIUS * 2.0, 0, POLE_RADIUS * 0.6);
  reelGroup.add(reelKnob);
  group.add(reelGroup);

  // Tip node — empty Object3D parented to the LAST segment at its tip Y.
  // Tracks the rod tip's world position even after the segment chain bends.
  const tipSeg = poleSegments[poleSegments.length - 1].pivot.children[0];
  const tipNode = new THREE.Object3D();
  tipNode.position.y = poleSegments[poleSegments.length - 1].length;
  tipSeg.add(tipNode);

  // Line guide — a tiny metallic ring at the rod tip (cosmetic). Lives
  // on the same parent as `tipNode` so it follows the bend.
  const guide = new THREE.Mesh(
    new THREE.TorusGeometry(POLE_RADIUS * 1.0, POLE_RADIUS * 0.18, 6, 14),
    new THREE.MeshStandardMaterial({ color: 0xb8c0c8, roughness: 0.28, metalness: 0.9 }),
  );
  guide.rotation.x = Math.PI / 2;
  guide.position.y = poleSegments[poleSegments.length - 1].length * 0.985;
  tipSeg.add(guide);

  return {
    group,
    tipNode,
    poleSegments,
  };
}

function buildTackle() {
  /**
   * Classic red-and-white bobber — a `Group` of two hemispheres (red
   * top, white bottom) joined at a thin black equator band, capped with
   * a tiny brass eyelet at the top so a kid reads it as a real bobber
   * at first glance. Cheaper than texturing and reads at any distance.
   */
  const bobGroup = new THREE.Group();
  bobGroup.name = "fishing_bobber";
  bobGroup.userData.anuKind = "player_fishing_bob";
  const topMat = new THREE.MeshStandardMaterial({
    color: 0xe43525,           // classic bobber red
    roughness: 0.45,
    metalness: 0.08,
    emissive: 0x2a0805,
    emissiveIntensity: 0.18,
  });
  const botMat = new THREE.MeshStandardMaterial({
    color: 0xf6f2e8,           // off-white
    roughness: 0.55,
    metalness: 0.04,
  });
  const topHemi = new THREE.Mesh(
    new THREE.SphereGeometry(BOB_RADIUS, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    topMat,
  );
  const botHemi = new THREE.Mesh(
    new THREE.SphereGeometry(BOB_RADIUS, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    botMat,
  );
  bobGroup.add(topHemi);
  bobGroup.add(botHemi);
  // Equator band — thin black ring at the seam.
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(BOB_RADIUS * 1.005, BOB_RADIUS * 0.045, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0x14110a, roughness: 0.85 }),
  );
  band.rotation.x = Math.PI / 2;
  bobGroup.add(band);
  // Brass eyelet on top for the line — a tiny ring.
  const eyelet = new THREE.Mesh(
    new THREE.TorusGeometry(BOB_RADIUS * 0.20, BOB_RADIUS * 0.05, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0xc69b3a, roughness: 0.32, metalness: 0.88 }),
  );
  eyelet.position.y = BOB_RADIUS * 1.04;
  eyelet.rotation.x = Math.PI / 2;
  bobGroup.add(eyelet);

  // Rock sinker — dark icosahedron just below the bob.
  const sinker = new THREE.Mesh(
    new THREE.IcosahedronGeometry(SINKER_RADIUS, 0),
    new THREE.MeshStandardMaterial({ color: 0x3b3a37, roughness: 0.95, metalness: 0.04 }),
  );
  sinker.name = "fishing_sinker";

  /**
   * J-shaped hook — bezier-curve sweep produces an honest J silhouette
   * (shank → bend → barb tip) rather than the prior 270° torus arc.
   * Built once via `TubeGeometry`; rotation aligns the shank with -Y
   * so the hook hangs down from the line attachment.
   */
  const hookCurve = new THREE.CubicBezierCurve3(
    new THREE.Vector3(0,  HOOK_LENGTH * 0.55, 0),     // top of shank (line tie)
    new THREE.Vector3(0, -HOOK_LENGTH * 0.05, 0),     // shank straight down
    new THREE.Vector3( HOOK_LENGTH * 0.42, -HOOK_LENGTH * 0.55, 0), // curl forward
    new THREE.Vector3( HOOK_LENGTH * 0.05, -HOOK_LENGTH * 0.18, 0), // barb tip pointing up + inward
  );
  const hookTubeGeom = new THREE.TubeGeometry(hookCurve, 24, 0.0075, 7, false);
  const hookMat = new THREE.MeshStandardMaterial({
    color: 0xd6dadf, roughness: 0.20, metalness: 0.92,
  });
  const hook = new THREE.Mesh(hookTubeGeom, hookMat);
  hook.name = "fishing_hook";

  return { bob: bobGroup, sinker, hook };
}

function buildLineMesh() {
  // Simple two-vertex line — we'll mutate the positions every frame to
  // chase the pole tip → bob/hook chain.
  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(2 * 3), 3),
  );
  const mat = new THREE.LineBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.85 });
  const line = new THREE.Line(geom, mat);
  line.name = "fishing_line";
  line.frustumCulled = false; // line endpoints move every frame
  return line;
}

/**
 * Fish-shaped player pointer (May-2026 user spec — "the circle will be a
 * fish and it will point to the fish who is interested in the hook").
 * Replaces the avatar's travel disc + arrow during EQUIPPED. Lies flat
 * on the dock, head at local +X; the module rotates the mesh around Y
 * each frame so the head aims at the closest pond fish (the same fish
 * being coaxed toward the hook).
 *
 * Top-down silhouette: teardrop body + forked caudal fin, plus a small
 * eye dot at the head so the player can read which way the fish is
 * pointing. Materials are unlit MeshBasic so the indicator never picks
 * up shadows from the dock above.
 */
function buildFishIndicator(lengthM) {
  const L = lengthM;
  const W = L * 0.38;
  const shape = new THREE.Shape();
  // Trace clockwise (head → upper flank → tail upper → tail notch →
  // tail lower → lower flank → head). Bezier curves produce a smoother
  // teardrop than straight lines.
  shape.moveTo(L * 0.50, 0);
  shape.bezierCurveTo(
    L * 0.46, W * 0.40,
    L * 0.18, W * 0.55,
    -L * 0.20, W * 0.45,
  );
  shape.lineTo(-L * 0.35, W * 0.30);
  shape.lineTo(-L * 0.50, W * 0.42);
  shape.lineTo(-L * 0.42, 0);
  shape.lineTo(-L * 0.50, -W * 0.42);
  shape.lineTo(-L * 0.35, -W * 0.30);
  shape.lineTo(-L * 0.20, -W * 0.45);
  shape.bezierCurveTo(
    L * 0.18, -W * 0.55,
    L * 0.46, -W * 0.40,
    L * 0.50, 0,
  );
  const geom = new THREE.ShapeGeometry(shape);
  // ShapeGeometry produces a flat XY surface; rotate to lie on the
  // ground plane (XZ).
  geom.rotateX(-Math.PI / 2);

  const bodyMat = new THREE.MeshBasicMaterial({
    color: 0x3fb6ff,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
  });
  const body = new THREE.Mesh(geom, bodyMat);
  body.name = "fishing_player_fish_indicator";
  body.userData.anuKind = "player_fishing_indicator";
  body.renderOrder = 8;

  // Outline for readability against light dock planks.
  const edgeGeom = new THREE.EdgesGeometry(geom, 1);
  const edgeMat = new THREE.LineBasicMaterial({
    color: 0xeaf6ff,
    transparent: true,
    opacity: 0.95,
  });
  const edges = new THREE.LineSegments(edgeGeom, edgeMat);
  edges.renderOrder = 9;
  body.add(edges);

  // Eye dot near the head so the heading reads at a glance.
  const eyeGeom = new THREE.CircleGeometry(W * 0.08, 16);
  eyeGeom.rotateX(-Math.PI / 2);
  const eyeMat = new THREE.MeshBasicMaterial({
    color: 0x10212a,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });
  const eye = new THREE.Mesh(eyeGeom, eyeMat);
  eye.position.set(L * 0.30, 0.002, -W * 0.18);
  eye.renderOrder = 10;
  body.add(eye);

  return body;
}

/* ─────────────────────── ripple system ─────────────────────── */

/**
 * Procedural ripple at the bob — a flat ring that expands outward and
 * fades to nothing over its lifetime. Pre-built once per pool slot;
 * `spawnRipple()` resets one to its starting state. We keep the meshes
 * world-space children of the scene so we don't pay per-frame parent
 * traversal cost.
 */
const RIPPLE_POOL_SIZE = 6;
const RIPPLE_BASE_LIFE_S = 1.8;
const RIPPLE_BASE_START_R = 0.05;
const RIPPLE_BASE_END_R = 0.78;

function buildRipple() {
  // RingGeometry with thin band — opacity is animated for the fade.
  // Inner radius 0.94 × outer keeps the ring visibly thin at all scales.
  const geom = new THREE.RingGeometry(0.94, 1.0, 32);
  geom.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xcfeefb,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = "fishing_bob_ripple";
  mesh.userData.anuKind = "fishing_ripple";
  mesh.renderOrder = 7;
  mesh.visible = false;
  // Per-ripple animation state (mutated by spawnRipple / update).
  mesh.userData._rip = {
    active: false,
    age: 0,
    life: RIPPLE_BASE_LIFE_S,
    startR: RIPPLE_BASE_START_R,
    endR: RIPPLE_BASE_END_R,
  };
  return mesh;
}

function spawnRipple(mesh, x, y, z, strength = 1.0) {
  const r = mesh.userData._rip;
  r.active = true;
  r.age = 0;
  r.life = RIPPLE_BASE_LIFE_S * (0.85 + 0.3 * strength);
  r.startR = RIPPLE_BASE_START_R;
  r.endR = RIPPLE_BASE_END_R * (0.7 + 0.6 * strength);
  mesh.position.set(x, y, z);
  mesh.scale.setScalar(r.startR);
  mesh.material.opacity = 0;
  mesh.visible = true;
}

/* ─────────────────────── tension HUD ─────────────────────── */

/**
 * Game-UI panel for the fishing mini-game.
 *
 * Three discrete surfaces, all in one fixed-position DOM root:
 *
 *  (1) Status banner — a centered pill that names the current FSM state
 *      ("WAITING FOR A BITE…", "FISH ON!", "REELING IN…", "GOT AWAY!",
 *      "NICE CATCH!") with state-specific accent colours. Always shown
 *      while EQUIPPED / FIGHTING / LANDING; hidden in IDLE.
 *
 *  (2) Tension gauge — refined semi-radial SVG. Bevel-style outer
 *      bezel + glassy plate + segmented hash marks + 4-stop colour
 *      gradient (green → yellow → orange → red). Needle has a soft
 *      drop-shadow and a polished hub.
 *
 *  (3) Fish-stamina bar — horizontal bar below the gauge, blue→teal
 *      fill that drains from full→empty over `FISH_STAMINA_S` of fight
 *      so the player can see how close they are to landing the catch.
 *
 *  (4) Catch counter chip — top-right of the panel, persists across
 *      sessions while EQUIPPED+. Shows "🐟 × N".
 *
 *  Returns DOM handles so the module can mutate them per frame.
 */
function buildTensionHud() {
  // May-17 2026 user spec: "make the fishing indicator part of the FPV
  // UI, not like a cheap modal. make it more pro." The previous build
  // wrapped every element (status pill, gauge, stamina, hint) in a
  // single fixed-bottom-centred container that read as a popup modal.
  // The redesign splits the chrome into discrete FPV-style HUD corners:
  //
  //   • #v2-fishing-status   — small TOP-CENTRE state chip
  //   • #v2-fishing-catch    — TOP-RIGHT persistent kill-feed-style chip
  //   • #v2-fishing-loadout  — BOTTOM-LEFT tackle chips (cycle with 1/2/3/4)
  //   • #v2-fishing-panel    — BOTTOM-RIGHT vertical tension column +
  //                            horizontal stamina bar
  //   • #v2-fishing-hint     — BOTTOM-CENTRE ENTER key-cap prompt
  //
  // The outer `wrap` no longer paints anything itself — it's just an
  // off-screen DOM anchor so the visibility helpers (display:none on
  // the wrap) still hide every piece in one toggle.

  const wrap = document.createElement("div");
  wrap.id = "v2-fishing-hud";
  wrap.style.cssText = [
    "position:fixed",
    "inset:0",
    "pointer-events:none",
    // Above PiP overlays (9800), V2Panel (9850), OrchestratorHud (9999),
    // and the WebGL canvas — the fishing HUD must read on top during
    // the mini-game (May-2026 user).
    "z-index:100000",
    "display:none",
    "user-select:none",
    "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
    "color:#fff7d0",
  ].join(";");

  const red = Math.round(TENSION_RED_ZONE * 100);

  wrap.innerHTML = `
    <!-- TOP-CENTRE state chip — small, unobtrusive -->
    <div id="v2-fishing-status"
         style="position:absolute;left:50%;top:20px;transform:translateX(-50%);
                padding:5px 16px;border-radius:3px;
                background:linear-gradient(180deg,rgba(20,18,14,0.78) 0%,rgba(8,6,4,0.86) 100%);
                border:1px solid rgba(255,238,170,0.22);
                border-left:3px solid #ffd97a;
                box-shadow:0 2px 12px rgba(0,0,0,0.55);
                font-size:12px;font-weight:700;letter-spacing:2.2px;
                color:#ffe9a8;text-shadow:0 1px 2px rgba(0,0,0,0.7);
                white-space:nowrap;">WAITING FOR A BITE…</div>

    <!-- TOP-RIGHT catch counter — persistent kill-feed chip -->
    <div id="v2-fishing-catch"
         style="position:absolute;top:18px;right:18px;
                padding:6px 14px 6px 11px;border-radius:3px;
                background:linear-gradient(180deg,rgba(18,28,18,0.82) 0%,rgba(6,12,6,0.9) 100%);
                border:1px solid rgba(120,200,140,0.38);
                border-right:3px solid #6fdf8a;
                box-shadow:0 2px 12px rgba(0,0,0,0.55);
                font-size:14px;font-weight:800;letter-spacing:0.6px;
                color:#c8f1b6;
                display:flex;align-items:center;gap:6px;">
      <span style="font-size:15px;">🐟</span>
      <span id="v2-fishing-catch-count" style="font-family:ui-monospace,Menlo,Consolas,monospace;">0</span>
    </div>

    <!-- BOTTOM-LEFT tackle loadout — small chip strip (1/2/3/4 cycles) -->
    <div id="v2-fishing-loadout"
         style="position:absolute;left:18px;bottom:18px;
                display:flex;flex-direction:column;gap:5px;
                font-size:10px;font-weight:700;letter-spacing:0.7px;
                color:#dceeff;text-shadow:0 1px 2px rgba(0,0,0,0.7);
                font-family:ui-monospace,Menlo,Consolas,monospace;">
      <div style="display:flex;gap:5px;">
        <span id="v2-fishing-loadout-worm"
              style="padding:4px 10px;border-radius:2px;
                     background:linear-gradient(180deg,rgba(20,18,14,0.82),rgba(8,6,4,0.9));
                     border:1px solid rgba(255,238,170,0.22);
                     border-bottom:2px solid rgba(255,217,122,0.45);"></span>
        <span id="v2-fishing-loadout-hook"
              style="padding:4px 10px;border-radius:2px;
                     background:linear-gradient(180deg,rgba(20,18,14,0.82),rgba(8,6,4,0.9));
                     border:1px solid rgba(255,238,170,0.22);
                     border-bottom:2px solid rgba(255,217,122,0.45);"></span>
        <span id="v2-fishing-loadout-lure"
              style="padding:4px 10px;border-radius:2px;
                     background:linear-gradient(180deg,rgba(20,18,14,0.82),rgba(8,6,4,0.9));
                     border:1px solid rgba(255,238,170,0.22);
                     border-bottom:2px solid rgba(255,217,122,0.45);"></span>
        <span id="v2-fishing-loadout-pole"
              style="padding:4px 10px;border-radius:2px;
                     background:linear-gradient(180deg,rgba(20,18,14,0.82),rgba(8,6,4,0.9));
                     border:1px solid rgba(255,238,170,0.22);
                     border-bottom:2px solid rgba(255,217,122,0.45);"></span>
      </div>
      <div id="v2-fishing-loadout-mods"
           style="font-size:9.5px;letter-spacing:0.9px;color:#a0c8e8;"></div>
    </div>

    <!-- BOTTOM-RIGHT tension column + stamina bar -->
    <div id="v2-fishing-panel"
         style="position:absolute;right:18px;bottom:18px;
                display:none;flex-direction:column;align-items:flex-end;
                gap:10px;width:200px;">

      <!-- Vertical tension column -->
      <div style="position:relative;width:100%;
                  background:linear-gradient(180deg,rgba(20,18,14,0.84),rgba(8,6,4,0.92));
                  border:1px solid rgba(255,238,170,0.22);
                  border-right:3px solid #ff5a3a;
                  border-radius:2px;padding:8px 12px 9px;
                  box-shadow:0 4px 14px rgba(0,0,0,0.55);">
        <div style="display:flex;justify-content:space-between;align-items:baseline;
                    font-size:10px;font-weight:700;letter-spacing:2.0px;
                    color:#ffd97a;text-shadow:0 1px 2px rgba(0,0,0,0.7);
                    margin-bottom:6px;">
          <span>LINE TENSION</span>
          <span id="v2-fishing-stamina-pct-tension"
                style="color:#c8f1b6;font-family:ui-monospace,Menlo,Consolas,monospace;
                       letter-spacing:0.4px;"></span>
        </div>
        <!-- Tension bar (horizontal, gradient + needle indicator) -->
        <div style="position:relative;height:12px;border-radius:2px;
                    background:linear-gradient(90deg,#4dd07a 0%,#e5d65a 48%,
                                               #ee8a3a ${red}%,#e2402a 100%);
                    box-shadow:inset 0 1px 2px rgba(0,0,0,0.55);">
          <!-- Red-zone tick on bar -->
          <div style="position:absolute;left:${red}%;top:-2px;width:2px;height:16px;
                      background:#ff5a3a;
                      box-shadow:0 0 4px rgba(255,90,58,0.7);"></div>
          <!-- Needle: a thin vertical mark that slides 0% to 100% on the bar.
               Kept as id v2-fishing-needle for backwards compat with the
               JS-side update fn; the element is positioned via left % driven
               by _updateTensionHud. -->
          <div id="v2-fishing-needle"
               style="position:absolute;left:0%;top:-3px;width:3px;height:18px;
                      background:#fff7d0;border-radius:1px;
                      box-shadow:0 0 6px rgba(255,247,208,0.85),
                                 0 1px 3px rgba(0,0,0,0.6);
                      transform:translateX(-50%);
                      transition:left 60ms linear;"></div>
        </div>
      </div>

      <!-- Fish-stamina row -->
      <div style="width:100%;
                  background:linear-gradient(180deg,rgba(20,18,14,0.84),rgba(8,6,4,0.92));
                  border:1px solid rgba(110,180,230,0.32);
                  border-right:3px solid #43c0ff;
                  border-radius:2px;padding:8px 12px 9px;
                  box-shadow:0 4px 14px rgba(0,0,0,0.55);">
        <div style="display:flex;justify-content:space-between;align-items:baseline;
                    font-size:10px;font-weight:700;letter-spacing:2.0px;
                    color:#a8d6f5;text-shadow:0 1px 2px rgba(0,0,0,0.7);
                    margin-bottom:6px;">
          <span>FISH STAMINA</span>
          <span id="v2-fishing-stamina-pct"
                style="color:#82f3a8;font-family:ui-monospace,Menlo,Consolas,monospace;
                       letter-spacing:0.4px;">100%</span>
        </div>
        <div style="height:10px;border-radius:2px;
                    background:rgba(0,0,0,0.6);
                    overflow:hidden;
                    box-shadow:inset 0 1px 2px rgba(0,0,0,0.55);">
          <div id="v2-fishing-stamina-fill"
               style="height:100%;width:100%;
                      background:linear-gradient(90deg,#43c0ff 0%,#3fe5d6 60%,#82f3a8 100%);
                      box-shadow:inset 0 -1px 0 rgba(0,0,0,0.35),0 0 8px rgba(80,200,255,0.45);
                      transition:width 80ms linear;"></div>
        </div>
      </div>
    </div>

    <!-- BOTTOM-CENTRE key prompt — only visible during FIGHTING -->
    <div id="v2-fishing-hint"
         style="position:absolute;left:50%;bottom:22px;transform:translateX(-50%);
                display:none;
                font-size:11px;letter-spacing:2.0px;
                color:#ffd97a;font-weight:700;
                text-shadow:0 1px 2px rgba(0,0,0,0.85);
                white-space:nowrap;
                padding:6px 14px;border-radius:2px;
                background:rgba(0,0,0,0.42);
                border:1px solid rgba(255,217,122,0.28);
                border-top:2px solid rgba(255,217,122,0.5);">
      TAP <span style="display:inline-block;padding:2px 8px;margin:0 4px;
                       border:1px solid rgba(255,217,122,0.7);
                       border-radius:2px;background:rgba(0,0,0,0.55);
                       font-family:ui-monospace,Menlo,Consolas,monospace;
                       font-size:11px;font-weight:800;
                       box-shadow:0 2px 0 rgba(255,217,122,0.18);">ENTER</span>
      TO KEEP THE FISH ON THE LINE
    </div>
  `;

  document.body.appendChild(wrap);

  // Keep the bottom-centre ENTER prompt's visibility lock-step with the
  // tension/stamina panel — both should only show during FIGHTING. The
  // existing `_setHudPanelVisible(v)` helper toggles `#v2-fishing-panel`'s
  // display only; we mirror it onto `#v2-fishing-hint` via an attribute
  // observer so the JS side stays unchanged.
  const panel = wrap.querySelector("#v2-fishing-panel");
  const hint = wrap.querySelector("#v2-fishing-hint");
  if (panel && hint && typeof MutationObserver === "function") {
    const obs = new MutationObserver(() => {
      hint.style.display = panel.style.display === "flex" ? "block" : "none";
    });
    obs.observe(panel, { attributes: true, attributeFilter: ["style"] });
  }

  return {
    wrap,
    panel: wrap.querySelector("#v2-fishing-panel"),
    hint: wrap.querySelector("#v2-fishing-hint"),
    needle: wrap.querySelector("#v2-fishing-needle"),
    status: wrap.querySelector("#v2-fishing-status"),
    catchCount: wrap.querySelector("#v2-fishing-catch-count"),
    staminaFill: wrap.querySelector("#v2-fishing-stamina-fill"),
    staminaPct: wrap.querySelector("#v2-fishing-stamina-pct"),
    tensionPct: wrap.querySelector("#v2-fishing-stamina-pct-tension"),
    loadoutWorm: wrap.querySelector("#v2-fishing-loadout-worm"),
    loadoutHook: wrap.querySelector("#v2-fishing-loadout-hook"),
    loadoutLure: wrap.querySelector("#v2-fishing-loadout-lure"),
    loadoutPole: wrap.querySelector("#v2-fishing-loadout-pole"),
    loadoutMods: wrap.querySelector("#v2-fishing-loadout-mods"),
  };
}

const STATUS_PRESETS = {
  EQUIPPED: { text: "WAITING FOR A BITE…", color: "#ffe9a8", glow: "rgba(255,210,90,0.10)" },
  FIGHTING: { text: "FISH ON!",            color: "#ff8e6a", glow: "rgba(255,90,30,0.30)" },
  LANDING:  { text: "REELING IN…",         color: "#9be8a6", glow: "rgba(120,255,160,0.22)" },
  SNAPPED:  { text: "GOT AWAY!",           color: "#ff6e5a", glow: "rgba(255,90,30,0.32)" },
  CATCH:    { text: "NICE CATCH!",         color: "#a8f3c0", glow: "rgba(120,255,160,0.36)" },
};

/* ─────────────────────── module ─────────────────────── */

export const WorldFishingModule = {
  name: "Fishing",

  _scene: null,
  _disposed: false,
  /** "IDLE" | "EQUIPPED" | "FIGHTING" | "LANDING" */
  _state: "IDLE",
  _stateT: 0,
  _biteRollT: 0,

  // Rig.
  _rig: null,            // pole group + tackle, child of player avatar root
  _attachedToAvatar: null,
  _poleTipNode: null,    // Object3D parented to the last pole segment — tracks rod tip through bend
  _poleSegments: null,   // [{ pivot: Object3D, length: number }, …] — rod bend
  _bob: null,
  _sinker: null,
  _hook: null,
  _line: null,
  _hookWorldPos: new THREE.Vector3(),
  _statusFlashUntil: 0,

  // Fight.
  _hookedFish: null,
  _tension: 0,
  _fightingT: 0,
  /** Rising-edge tracker for the ENTER-key tap mini-game (May-17 2026 user
   *  spec, migrated from SPACE). Each false→true transition during
   *  FIGHTING applies one `TENSION_RELEASE_PER_TAP`. */
  _tapKeyWasDown: false,

  // Pre-decided outcome of the *next* bite roll. We resolve the
  // Math.random() at the start of each interval (and on EQUIPPED entry)
  // so the bobber can give a "fish nibbling" dunk tell in the final
  // `BOBBER_DUNK_WINDOW_S` of the countdown when a hit is incoming.
  _nextBiteWillHit: false,
  _bobberDunk: 0,

  // HUD.
  _hud: null,

  /** Fish-shaped pointer mesh — replaces the avatar disc + arrow while
   *  EQUIPPED. Lives in the scene root (world-space), positioned at the
   *  player's feet each frame and aimed at the closest pond fish. */
  _fishIndicator: null,
  _fishIndicatorFeetLift: 0.02,

  /** Selected index into each `TACKLE_CATALOG` category. Defaults to the
   *  starter (1.0×) entries so first-load behaves like the pre-tackle
   *  baseline. Persisted to `localStorage` under `v2.fishing.loadout`. */
  _loadout: { worms: 0, hooks: 0, lures: 0, poles: 0 },
  /** Edge-trackers for the cycle keys (1/2/3/4) so HOLD doesn't auto-cycle. */
  _cycleKeyWasDown: { "1": false, "2": false, "3": false, "4": false },

  /** Ripple system — pool of expanding ring meshes spawned around the bob
   *  to read as water-surface disturbance. Pre-allocated so we never alloc
   *  meshes mid-frame. */
  _ripples: [],
  _rippleSpawnT: 0,

  // Catches.
  _trophyMaterial: null,
  _trophyStringer: null,  // shared Group hung from the player's right hip
  _trophies: [],          // [{ root: Object3D }]

  // Scratch.
  _tmpV: new THREE.Vector3(),
  _tmpV2: new THREE.Vector3(),

  /** Currently-equipped catalog entries — read each frame to compute the
   *  bite probability + fish stamina drain. Lives on the module so the
   *  load() method can `try`-restore from localStorage. */
  _currentLoadout() {
    return {
      worm: TACKLE_CATALOG.worms[this._loadout.worms] ?? TACKLE_CATALOG.worms[0],
      hook: TACKLE_CATALOG.hooks[this._loadout.hooks] ?? TACKLE_CATALOG.hooks[0],
      lure: TACKLE_CATALOG.lures[this._loadout.lures] ?? TACKLE_CATALOG.lures[0],
      pole: TACKLE_CATALOG.poles[this._loadout.poles] ?? TACKLE_CATALOG.poles[0],
    };
  },
  /** Composite multipliers across all four equipped categories. */
  _loadoutModifiers() {
    const l = this._currentLoadout();
    return {
      attract: l.worm.attract * l.hook.attract * l.lure.attract * l.pole.attract,
      catch:   l.worm.catch   * l.hook.catch   * l.lure.catch   * l.pole.catch,
    };
  },
  _persistLoadout() {
    try {
      window.localStorage?.setItem(
        "v2.fishing.loadout",
        JSON.stringify(this._loadout),
      );
    } catch (_err) {
      // localStorage may be disabled (private mode etc.) — non-fatal.
    }
  },
  _restoreLoadout() {
    try {
      const raw = window.localStorage?.getItem("v2.fishing.loadout");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      for (const key of ["worms", "hooks", "lures", "poles"]) {
        const idx = parsed?.[key];
        const cat = TACKLE_CATALOG[key];
        if (typeof idx === "number" && cat && idx >= 0 && idx < cat.length) {
          this._loadout[key] = idx;
        }
      }
    } catch (_err) {
      // Corrupt JSON / blocked storage — fall back to defaults.
    }
  },
  /** Drive the loadout cycle keys (1/2/3/4) — rising-edge detection per
   *  key so a held key only advances the slot once. Only listens while
   *  EQUIPPED, otherwise the keys remain free for other systems. */
  _pollLoadoutCycleKeys(player) {
    if (this._state !== "EQUIPPED" || !player?.isKeyDown) return;
    let dirty = false;
    for (const key of Object.keys(TACKLE_CYCLE_KEYS)) {
      const down = player.isKeyDown(key) === true;
      if (down && !this._cycleKeyWasDown[key]) {
        const cat = TACKLE_CYCLE_KEYS[key];
        const list = TACKLE_CATALOG[cat];
        if (list?.length) {
          this._loadout[cat] = (this._loadout[cat] + 1) % list.length;
          dirty = true;
        }
      }
      this._cycleKeyWasDown[key] = down;
    }
    if (dirty) {
      this._persistLoadout();
      this._updateLoadoutChip();
    }
  },
  /** Rewrite the HUD loadout chips with the current loadout names + the
   *  composite modifier line. Safe to call repeatedly; cheap. */
  _updateLoadoutChip() {
    const hud = this._hud;
    if (!hud?.loadoutWorm) return;
    const l = this._currentLoadout();
    const m = this._loadoutModifiers();
    hud.loadoutWorm.textContent = `1·${l.worm.name}`;
    hud.loadoutHook.textContent = `2·${l.hook.name}`;
    hud.loadoutLure.textContent = `3·${l.lure.name}`;
    hud.loadoutPole.textContent = `4·${l.pole.name}`;
    hud.loadoutMods.textContent =
      `ATTRACT ×${m.attract.toFixed(2)}    CATCH ×${m.catch.toFixed(2)}`;
  },

  async load(scene /*, camera, renderer, orchestrator */) {
    if (this._disposed) return;
    this._scene = scene;
    this._state = "IDLE";
    this._stateT = 0;
    this._biteRollT = 0;
    this._tension = 0;
    this._fightingT = 0;
    this._trophies = [];
    this._restoreLoadout();

    // Build the pole/tackle rig once. It lives in the scene but is invisible
    // until EQUIPPED; we'll re-parent to the player avatar on first reveal.
    const { group, tipNode, poleSegments } = buildPoleGroup();
    const { bob, sinker, hook } = buildTackle();
    const line = buildLineMesh();

    this._rig = group;
    this._poleTipNode = tipNode;
    this._poleSegments = poleSegments;
    this._bob = bob;
    this._sinker = sinker;
    this._hook = hook;
    this._line = line;

    // The bob/sinker/hook hang in WORLD space (we set their positions
    // each frame), so add them to the scene at the root, not inside the
    // pole group (which carries the player's transform). The line is
    // similarly world-space.
    scene.add(group);
    scene.add(bob);
    scene.add(sinker);
    scene.add(hook);
    scene.add(line);

    group.visible = false;
    bob.visible = false;
    sinker.visible = false;
    hook.visible = false;
    line.visible = false;

    // No fish-shaped pointer, no water ripples — May-2026 user spec
    // ("remove the circles you got. I don't understand them. … instead
    // have realistic fish."). Reverted both decorative systems; the
    // real pond fish from `_v2PoolFish` carry the visual interest now.
    this._fishIndicator = null;
    this._ripples = [];

    this._hud = buildTensionHud();
    this._updateLoadoutChip();

    console.log("%c[Fishing] ✅ Fishing dock circle armed.", "color:#80d0a6;font-weight:bold;");
  },

  update(delta) {
    if (this._disposed || !this._scene) return;
    const dt = Math.min(0.05, delta);

    const player = getRuntimeService("WorldPlayer");
    const fishingPt = (typeof window !== "undefined") ? window._v2FishingPoint : null;
    if (!player?.feet || !fishingPt) return;

    // Re-parent the rig to the player avatar (once we have one) so the
    // pole tracks the body. We do this lazily because Avatar3 is async-
    // loaded after Fishing.load().
    if (player.avatar && this._attachedToAvatar !== player.avatar) {
      if (this._rig.parent) this._rig.parent.remove(this._rig);
      player.avatar.add(this._rig);
      this._attachedToAvatar = player.avatar;
      this._rig.position.copy(POLE_GRIP_OFFSET);
      this._rig.rotation.set(POLE_PITCH, POLE_YAW, 0);
    }

    // Compute distance from player feet to the fishing point.
    const dx = player.feet.x - fishingPt.x;
    const dz = player.feet.z - fishingPt.z;
    const distSq = dx * dx + dz * dz;
    const inCircle = distSq <= FISHING_CIRCLE_R_M * FISHING_CIRCLE_R_M;

    // Loadout cycle keys (1/2/3/4) — only listened to in EQUIPPED; the
    // poll is cheap and a no-op outside that state.
    this._pollLoadoutCycleKeys(player);

    this._stateT += dt;

    switch (this._state) {
      case "IDLE": {
        if (inCircle) {
          if (FORCE_PLAYER_FACING_HOOK && player.setYaw && player.feet) {
            // World yaw convention: `this._yaw = atan2(-amx, -amz)` where
            // (amx, amz) is the unit forward vector — see WorldPlayerController.
            const fdx = fishingPt.x - player.feet.x;
            const fdz = fishingPt.z - player.feet.z;
            const fL = Math.hypot(fdx, fdz) || 1;
            player.setYaw(Math.atan2(-fdx / fL, -fdz / fL));
          }
          this._enter("EQUIPPED");
        }
        break;
      }
      case "EQUIPPED": {
        if (!inCircle) { this._enter("IDLE"); break; }
        this._biteRollT += dt;
        // Bobber-dunk tell — show the bobber nibbled-down in the last
        // `BOBBER_DUNK_WINDOW_S` only when the predetermined next roll
        // will hit. Reads as "a fish is on the line, get ready!".
        const timeUntilRoll = BITE_ROLL_INTERVAL_S - this._biteRollT;
        if (this._nextBiteWillHit && timeUntilRoll < BOBBER_DUNK_WINDOW_S) {
          this._bobberDunk = Math.max(
            0,
            Math.min(1, 1 - timeUntilRoll / BOBBER_DUNK_WINDOW_S),
          );
        } else {
          this._bobberDunk = 0;
        }
        if (this._biteRollT >= BITE_ROLL_INTERVAL_S) {
          this._biteRollT = 0;
          this._bobberDunk = 0;
          if (this._nextBiteWillHit) {
            const fish = this._borrowFishForFight();
            if (fish) {
              this._hookedFish = fish;
              this._enter("FIGHTING");
              break;
            }
          }
          // Resolve the next outcome immediately so the next dunk can
          // foreshadow it. The base 0.78 probability is scaled by the
          // combined `attract` multiplier across the equipped loadout
          // (clamped to [0, 0.98] so a fully maxed kit never auto-bites).
          const mods = this._loadoutModifiers();
          const p = Math.max(0, Math.min(0.98, BITE_PROBABILITY * mods.attract));
          this._nextBiteWillHit = Math.random() < p;
        }
        this._coaxFishToHook(dt);
        break;
      }
      case "FIGHTING": {
        // Player walks away mid-fight → snap.
        if (!inCircle) { this._snapLine(); break; }
        // Tension dynamics — tension fills passively each frame; the
        // player TAPS ENTER to relieve it (rising-edge detection below).
        // A held key does NOT release tension — that's the whole point
        // of the tap mini-game. May-17 2026 user spec: input migrated
        // from SPACE → ENTER so the jump key (space) and the fishing
        // tap are no longer the same button.
        this._tension += dt * TENSION_FILL_PER_S;
        const tapDown =
          player.isKeyDown?.("enter") === true ||
          player.isKeyDown?.("\n") === true ||
          player.isKeyDown?.("\r") === true;
        if (tapDown && !this._tapKeyWasDown) {
          this._tension -= TENSION_RELEASE_PER_TAP;
        }
        this._tapKeyWasDown = tapDown;
        if (this._tension < 0) this._tension = 0;
        if (this._tension >= TENSION_SNAP) { this._snapLine(); break; }
        // Better catch gear drains the fish's stamina faster — equivalent
        // to a higher `catch` multiplier shortening the fight window.
        const catchMul = this._loadoutModifiers().catch;
        this._fightingT += dt * catchMul;
        this._animateHookedFish(dt);
        this._updateTensionHud(this._tension);
        this._updateRodFlex(this._tension);
        if (this._fightingT >= FISH_STAMINA_S) this._enter("LANDING");
        break;
      }
      case "LANDING": {
        const t = Math.min(1, this._stateT / LANDING_DURATION_S);
        this._animateLandingFish(t);
        if (t >= 1) {
          this._consumeHookedFish();
          this._gluedFishTrophyToPlayer(player);
          this._enter(inCircle ? "EQUIPPED" : "IDLE");
        }
        break;
      }
    }

    // Revert any transient status banner (SNAPPED / CATCH) once its
    // flash window has elapsed. The flash is parked on `_statusFlashUntil`
    // by `_snapLine` / `_enter("EQUIPPED")` after LANDING.
    if (this._statusFlashUntil) {
      const now = typeof performance !== "undefined" ? performance.now() : 0;
      if (now >= this._statusFlashUntil) {
        this._statusFlashUntil = 0;
        if (this._state === "EQUIPPED") this._applyStatusPreset("EQUIPPED");
      }
    }

    // Always update the line + tackle worldspace so the pole rig reads
    // correctly while EQUIPPED / FIGHTING / LANDING.
    if (this._state !== "IDLE") {
      this._updateLineAndTackle(player, fishingPt);
      this._updateFishingCamera(player, fishingPt);
    } else if (window._v2FishingCameraOverride) {
      window._v2FishingCameraOverride = null;
      // Restart chase camera's smoothing budget so it re-locks cleanly.
      // The flag below is read by `World.update` next frame and resets
      // the lerp so the camera doesn't slingshot from the fishing pose.
      window._v2FishingCameraReleased = true;
      // Reset the top-down up-vector smoother so the next time we engage
      // fishing it lerps from a clean Y-up basis rather than from the
      // horizontal axis we last left it at.
      const w = window.anuOrchestrator?._activeModuleInstances?.World;
      if (w?._cameraUpSmooth) w._cameraUpSmooth.set(0, 1, 0);
    }

    // Decorative pointer + ripples removed per user spec — see load().
  },

  /**
   * Park the fishing-camera target on `window._v2FishingCameraOverride`.
   * `World.js` picks it up each frame and applies a slow lerp.
   *
   * Iteration D — chase-style behind-the-shoulder pose so the rod, dock,
   * player, and pool surface all read together. Camera sits
   * `FISHING_CAM_BACK_M` behind the player along the player→hook axis,
   * raised by `FISHING_CAM_HEIGHT_M`; the look target is the bob plus a
   * `LOOK_FORWARD_M` push along that axis (gives the gentle downward
   * tilt that anchors the dock at the bottom of the frame). `up` is the
   * default Y-axis — no top-down trick, no FOV mangling.
   */
  _updateFishingCamera(player, fp) {
    if (!player?.feet) return;
    const px = player.feet.x;
    const pz = player.feet.z;
    const py = player.feet.y ?? 0;
    let dx = fp.x - px;
    let dz = fp.z - pz;
    let d = Math.hypot(dx, dz);
    if (d < 0.001) {
      dx = -fp.pullDirX;
      dz = -fp.pullDirZ;
      d = 1;
    }
    const fwdX = dx / d;
    const fwdZ = dz / d;
    const posX = px - fwdX * FISHING_CAM_BACK_M;
    const posZ = pz - fwdZ * FISHING_CAM_BACK_M;
    const posY = py + FISHING_CAM_HEIGHT_M;
    const lookX = fp.x + fwdX * FISHING_CAM_LOOK_FORWARD_M;
    const lookY = fp.waterY + 0.02;
    const lookZ = fp.z + fwdZ * FISHING_CAM_LOOK_FORWARD_M;
    if (!window._v2FishingCameraOverride) {
      window._v2FishingCameraOverride = {};
    }
    const ov = window._v2FishingCameraOverride;
    ov.posX = posX; ov.posY = posY; ov.posZ = posZ;
    ov.lookX = lookX; ov.lookY = lookY; ov.lookZ = lookZ;
    // Explicit defaults — clears any leftover top-down upX/upZ/fovDeg
    // from a previous override so the World.js consumer falls back to
    // Y-up + default FOV without a stale-state race.
    ov.upX = undefined;
    ov.upZ = undefined;
    ov.fovDeg = undefined;
  },

  /* ─── FSM helpers ─── */

  _enter(next) {
    const prev = this._state;
    this._state = next;
    this._stateT = 0;
    if (next === "IDLE") {
      this._setRigVisible(false);
      this._setHudVisible(false);
      this._setHudPanelVisible(false);
      this._resetRodFlex();
      this._setPlayerCircleVisible(true);
      this._setFishingTreesClip(false);
      window._v2FishingActive = false;
      // May-17 2026 user spec: "turn off ALL movement while fishing" —
      // this broader flag is read by World.js to block WASD/arrows for
      // the entire fishing session (EQUIPPED + FIGHTING + LANDING).
      // Reset to false on IDLE so the player can walk away normally.
      window._v2FishingEngaged = false;
      // Drop any in-progress curiosity states so Pool2's animator regains
      // sole control of the school. Resume points will randomise on the
      // next EQUIPPED entry.
      const pool = window._v2PoolFish;
      if (Array.isArray(pool)) {
        const now = performance.now() * 0.001;
        for (const f of pool) {
          if (!f?.userData) continue;
          const cu = f.userData._curiosity;
          if (cu) {
            cu.state = "WANDER";
            cu.cooldownUntil = now + Math.random() * 3.0;
          }
        }
      }
    } else if (next === "EQUIPPED") {
      this._setRigVisible(true);
      this._setHudVisible(true);          // banner+counter ON; panel OFF
      this._setHudPanelVisible(false);
      this._resetRodFlex();
      this._applyStatusPreset(prev === "LANDING" ? "CATCH" : "EQUIPPED");
      if (prev === "LANDING") {
        // Hold the celebratory "NICE CATCH!" banner ~1.5 s, then revert
        // to the waiting message via the per-frame timer in `update`.
        this._statusFlashUntil = (typeof performance !== "undefined" ? performance.now() : 0) + 1500;
      }
      window._v2FishingActive = false;
      // Engaged for the whole rod-in-hand session — see IDLE comment.
      window._v2FishingEngaged = true;
      this._tension = 0;
      this._fightingT = 0;
      this._bobberDunk = 0;
      // Seed the next-roll outcome so the very first interval after
      // EQUIPPED entry can still produce a bobber-dunk tell. Apply the
      // current loadout's `attract` multiplier so swapping tackle
      // immediately reflects in the very next pre-roll.
      {
        const mods = this._loadoutModifiers();
        const p = Math.max(0, Math.min(0.98, BITE_PROBABILITY * mods.attract));
        this._nextBiteWillHit = Math.random() < p;
      }
      // May-17 2026 user spec: "when fishing player circle changes to
      // the fish circle while fishing". Hide the player's travel disc
      // so the fish-shaped pointer (`_fishIndicator`, parked at the
      // player's feet and aimed at the closest pond fish) takes its
      // place visually.
      this._setPlayerCircleVisible(false);
      this._setFishingTreesClip(true);
    } else if (next === "FIGHTING") {
      this._setHudVisible(true);
      this._setHudPanelVisible(true);
      this._applyStatusPreset("FIGHTING");
      window._v2FishingActive = true;
      this._tension = 0.32; // starts moderate
      this._fightingT = 0;
      // Seed the tap edge-detector with the CURRENT key state, otherwise
      // a player still holding the prior bite-anticipation press would
      // get a "free" tap the first frame. Treat the press as already
      // counted; only the NEXT release-then-press cycle scores a tap.
      const player = getRuntimeService("WorldPlayer");
      this._tapKeyWasDown =
        player?.isKeyDown?.("enter") === true ||
        player?.isKeyDown?.("\n") === true ||
        player?.isKeyDown?.("\r") === true;
    } else if (next === "LANDING") {
      this._setHudVisible(true);
      this._setHudPanelVisible(false);
      this._applyStatusPreset("LANDING");
      window._v2FishingActive = false;
    }
    if (prev !== next) {
      console.log("%c[Fishing] " + prev + " → " + next, "color:#a5d6a7;");
    }
  },

  /** Banner text + accent colour for the current FSM beat. */
  _applyStatusPreset(key) {
    const p = STATUS_PRESETS[key];
    if (!p || !this._hud?.status) return;
    this._hud.status.textContent = p.text;
    this._hud.status.style.color = p.color;
    this._hud.status.style.boxShadow =
      `0 4px 14px rgba(0,0,0,0.55),0 0 18px ${p.glow}`;
  },

  _setHudPanelVisible(v) {
    // The redesigned HUD panel is a `flex` column (bottom-right corner
    // of the FPV layout); display must toggle between "flex" and "none"
    // — not "block" — for the column to lay out correctly. The hint
    // chip's visibility is mirrored from this same flag via the
    // MutationObserver wired in `buildTensionHud()`.
    if (this._hud?.panel) this._hud.panel.style.display = v ? "flex" : "none";
  },

  /**
   * Toggle the player's own travel-marker meshes (disc + ring + arrow,
   * built by `WorldAvatar.js`). When fishing engages we hide all three
   * so the dock fishing-spot decal (`pool2_dock_fishing_spot_decal` at
   * the pier tip) becomes the active "you-are-here" circle visually.
   */
  _setPlayerCircleVisible(visible) {
    const ac = getRuntimeService("WorldPlayer")?.avatarController;
    if (!ac) return;
    if (ac.circle) ac.circle.visible = visible;
    if (ac.arrow) ac.arrow.visible = visible;
    if (ac._travelRingMesh) ac._travelRingMesh.visible = visible;
  },

  /**
   * Foliage clipping for the fishing camera. Reuses the existing Flora
   * `setFoliageHiddenForMapView(active, clipTargets)` plumbing — its
   * `active` boolean is just an enable flag, the heavy lifting is the
   * clip-target list, which we tune for a corridor that covers the
   * camera position, the player, and the midpoint between them. Any
   * tree leaves inside those discs vanish until fishing ends.
   *
   * Limitation: this conflicts with the map-view foliage clipping if
   * the player toggles map view while fishing. Edge case — player
   * walks away from the dock circle to engage map view normally.
   */
  _setFishingTreesClip(active) {
    const trees = window.anuOrchestrator?._activeModuleInstances?.Trees;
    if (!trees?.setFoliageHiddenForMapView) return;
    if (!active) {
      trees.setFoliageHiddenForMapView(false, null);
      return;
    }
    const player = getRuntimeService("WorldPlayer");
    const fp = window._v2FishingPoint;
    if (!player?.feet || !fp) return;
    const px = player.feet.x;
    const pz = player.feet.z;
    let dx = fp.x - px, dz = fp.z - pz;
    let d = Math.hypot(dx, dz);
    if (d < 0.001) { dx = -fp.pullDirX; dz = -fp.pullDirZ; d = 1; }
    const fwdX = dx / d, fwdZ = dz / d;
    const camX = px - fwdX * FISHING_CAM_BACK_M;
    const camZ = pz - fwdZ * FISHING_CAM_BACK_M;
    const midX = (px + camX) * 0.5;
    const midZ = (pz + camZ) * 0.5;
    // Three overlapping discs span the camera → player corridor. Radii
    // chosen so adjacent discs overlap by ~1 m; total cleared corridor
    // is ~5 m wide and ~14 m long along the player→camera axis.
    trees.setFoliageHiddenForMapView(true, [
      { x: camX, z: camZ, radius: 4.5 },
      { x: midX, z: midZ, radius: 5.0 },
      { x: px,   z: pz,   radius: 3.5 },
    ]);
  },

  _snapLine() {
    if (this._hookedFish) {
      // Release the fish back to its orbit — clear the flag so Pool2's
      // own animator resumes governing it. Also reset its curiosity so
      // it can re-investigate the lure after a cooldown rather than
      // staying permanently dormant.
      this._hookedFish.userData._fishingHooked = false;
      const cu = this._hookedFish.userData._curiosity;
      if (cu) {
        cu.state = "WANDER";
        cu.cooldownUntil = performance.now() * 0.001 + 4.0;
      }
      this._hookedFish = null;
    }
    this._enter("EQUIPPED");
    // After _enter has reset the banner to the EQUIPPED waiting text,
    // overlay a brief "GOT AWAY!" flash so the player sees the loss.
    this._applyStatusPreset("SNAPPED");
    this._statusFlashUntil = (typeof performance !== "undefined" ? performance.now() : 0) + 1400;
    console.warn("[Fishing] line snapped — fish escaped.");
  },

  _setRigVisible(v) {
    if (this._rig) this._rig.visible = v;
    if (this._bob) this._bob.visible = v;
    if (this._sinker) this._sinker.visible = v;
    if (this._hook) this._hook.visible = v;
    if (this._line) this._line.visible = v;
  },

  _setHudVisible(v) {
    if (this._hud?.wrap) this._hud.wrap.style.display = v ? "block" : "none";
  },

  /* ─── per-frame visuals ─── */

  /**
   * Update the in-world tackle positions: bob hovers at the water surface
   * above the hook, hook hangs in the water under the dock tip (or at the
   * fish's mouth while FIGHTING / LANDING). Line is a 2-vertex segment
   * from pole tip → bob → hook (we draw it as one taut line tip→hook;
   * the bob sits on the line between them).
   */
  _updateLineAndTackle(player, fp) {
    // Pole tip world position. `_poleTipNode` is parented to the LAST
    // pole segment so its world transform correctly reflects the chain
    // of pivot rotations (rod bend during FIGHTING). `getWorldPosition`
    // walks parents up to the avatar root.
    if (!this._attachedToAvatar || !this._poleTipNode) return;
    this._poleTipNode.getWorldPosition(this._tmpV);
    const tipX = this._tmpV.x, tipY = this._tmpV.y, tipZ = this._tmpV.z;

    // Hook anchor — under the dock tip in water (EQUIPPED), or following
    // the hooked fish's head during FIGHTING / LANDING.
    let hookX = fp.x, hookZ = fp.z, hookY = fp.waterY - HOOK_BELOW_WATER_M;
    if ((this._state === "FIGHTING" || this._state === "LANDING") && this._hookedFish) {
      hookX = this._hookedFish.position.x;
      hookY = this._hookedFish.position.y + 0.04;
      hookZ = this._hookedFish.position.z;
    }
    this._hookWorldPos.set(hookX, hookY, hookZ);

    // Bob — at water surface above the hook XZ (or above fish during fight).
    // During EQUIPPED a tiny idle bob keeps it alive; in the last
    // `BOBBER_DUNK_WINDOW_S` before a hit, the bobber visibly dunks
    // down and shudders sideways — kid-readable "fish is nibbling" tell.
    const nowMs = performance.now();
    let bobY = fp.waterY + BOB_RADIUS * 0.32;
    let bobX = hookX;
    let bobZ = hookZ;
    if (this._state === "EQUIPPED") {
      bobY += Math.sin(nowMs * 0.003) * 0.012;
      const dunk = this._bobberDunk;
      if (dunk > 0) {
        // Sharp downward pull eased with a smoothstep so the dunk
        // accelerates into the catch.
        const eased = dunk * dunk * (3 - 2 * dunk);
        bobY -= eased * BOBBER_DUNK_MAX_M;
        // Lateral shudder along the player→hook axis (sideways
        // perpendicular to the line).
        const shudder = Math.sin(nowMs * 0.022) * 0.018 * eased;
        bobX += -fp.pullDirZ * shudder; // perpendicular X (= -dz)
        bobZ +=  fp.pullDirX * shudder; // perpendicular Z (= +dx)
      }
    }
    this._bob.position.set(bobX, bobY, bobZ);

    // Sinker — midway between bob and hook.
    this._sinker.position.set(
      hookX,
      (this._bob.position.y + hookY) * 0.5,
      hookZ,
    );

    // Hook — at hook anchor.
    this._hook.position.set(hookX, hookY, hookZ);

    // Line — taut from pole tip to bob, then bob to hook isn't drawn as a
    // second segment in the same THREE.Line; we cheat and draw tip→hook
    // since the bob is on the same Z column anyway.
    const pos = this._line.geometry.attributes.position;
    pos.setXYZ(0, tipX, tipY, tipZ);
    pos.setXYZ(1, hookX, hookY, hookZ);
    pos.needsUpdate = true;
  },

  /** Pick the closest visible (and not-currently-hooked) pond fish to
   *  the fishing point. Returned reference is the same fish that gets
   *  coaxed toward the bob — the indicator should aim at this one. */
  _closestPondFish() {
    const pool = window._v2PoolFish;
    if (!Array.isArray(pool) || pool.length === 0) return null;
    const fp = window._v2FishingPoint;
    if (!fp) return null;
    let best = null;
    let bestDSq = Infinity;
    for (const f of pool) {
      if (!f?.visible) continue;
      if (f.userData?._fishingHooked) continue;
      const dx = fp.x - f.position.x;
      const dz = fp.z - f.position.z;
      const d = dx * dx + dz * dz;
      if (d < bestDSq) { bestDSq = d; best = f; }
    }
    return best;
  },

  /** Find any unused ripple in the pool; return null if all are alive. */
  _acquireRipple() {
    if (!this._ripples) return null;
    for (let i = 0; i < this._ripples.length; i++) {
      const r = this._ripples[i];
      if (!r.userData._rip.active) return r;
    }
    return null;
  },

  /** Per-frame ripple housekeeping — animates active ripples and spawns
   *  new ones at the bob. Idle ripples emit at a fixed cadence; large
   *  ripples are emitted on demand by `_coaxFishToHook` whenever a fish
   *  enters the bob's near-zone (passed as `strength` to `spawnRipple`).
   */
  _updateRipples(dt, fp) {
    const ripples = this._ripples;
    if (!ripples?.length || !fp) return;
    // Advance active ripples — expand radius + fade opacity over `life`.
    for (let i = 0; i < ripples.length; i++) {
      const mesh = ripples[i];
      const r = mesh.userData._rip;
      if (!r.active) continue;
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        r.active = false;
        mesh.visible = false;
        mesh.material.opacity = 0;
        continue;
      }
      // Smooth easing — fast expand at start, gentle fade at the end.
      const eased = 1 - Math.pow(1 - t, 2.2);
      const rad = r.startR + (r.endR - r.startR) * eased;
      mesh.scale.setScalar(rad);
      mesh.material.opacity = 0.7 * (1 - t) * (1 - t);
    }
    // Idle spawn — keep the lure feeling alive while the player waits
    // for a bite. Only active in EQUIPPED so we don't run while fighting.
    if (this._state === "EQUIPPED") {
      this._rippleSpawnT += dt;
      if (this._rippleSpawnT >= 1.4) {
        this._rippleSpawnT = 0;
        const slot = this._acquireRipple();
        if (slot) {
          const y = fp.waterY + 0.012;
          spawnRipple(slot, fp.x, y, fp.z, 0.55);
        }
      }
    } else {
      this._rippleSpawnT = 0;
    }
  },

  /** Public-ish helper used by the per-fish curiosity FSM — spawn one
   *  "fish brushed the lure" ripple at the bob with extra strength. */
  _emitFishRipple(strength = 1.0) {
    const fp = window._v2FishingPoint;
    if (!fp) return;
    const slot = this._acquireRipple();
    if (!slot) return;
    spawnRipple(slot, fp.x, fp.waterY + 0.012, fp.z, strength);
  },

  /** Park the fish-shaped pointer at the player's feet and rotate its
   *  head toward the closest pond fish. The mesh is world-space (parented
   *  to the scene), so we set `position`+`rotation.y` in world coords —
   *  no need to compensate for the avatar's yaw. */
  _updateFishIndicator(player, fp) {
    const ind = this._fishIndicator;
    if (!ind) return;
    const showState = this._state === "EQUIPPED";
    if (!showState || !player?.feet || !fp) {
      if (ind.visible) ind.visible = false;
      return;
    }
    const px = player.feet.x;
    const py = player.feet.y ?? fp.deckTopY ?? 0;
    const pz = player.feet.z;
    ind.position.set(px, py + this._fishIndicatorFeetLift, pz);
    // Aim — closest pond fish if any, otherwise the hook itself so the
    // indicator still reads as "facing the water" before fish converge.
    const target = this._closestPondFish();
    const tx = target ? target.position.x : fp.x;
    const tz = target ? target.position.z : fp.z;
    const dx = tx - px;
    const dz = tz - pz;
    if (dx * dx + dz * dz > 1e-6) {
      // Mesh local +X points at the fish head; in world XZ with
      // `rotation.y = 0` the head points along world +X. atan2(-dz, dx)
      // converts the XZ direction (right-handed, Y-up) into a
      // rotation-Y angle: positive Y rotates +X toward +Z, so we negate
      // dz.
      ind.rotation.y = Math.atan2(-dz, dx);
    }
    if (!ind.visible) ind.visible = true;
  },

  /**
   * Per-fish curiosity FSM (May-2026 user spec: "the key is watching the
   * individual fish behave individually in their attempt to get the hook
   * but not get caught"). Replaces the old single-closest-fish nudge with
   * an independent state machine per pool fish:
   *
   *   WANDER  — Pool2's animator owns the fish. We don't touch it.
   *   DRAWN   — Fish is heading toward an `approachX/Z` point near the
   *             bob, pulled at `DRAWN_SPEED`. Once it gets within
   *             `INSPECT_RANGE`, it transitions to INSPECT.
   *   INSPECT — Fish circles the bob at `INSPECT_ORBIT_R`, brushes it
   *             on each pass (emits a ripple), and may upgrade to
   *             "ready-to-bite". Times out after `INSPECT_DURATION` and
   *             then BACKOFFs.
   *   BACKOFF — Fish swims `BACKOFF_DIST` away from the bob, then drops
   *             back to WANDER for `COOLDOWN` seconds (Pool2 resumes).
   *
   * Activation chance per second per fish:
   *   `BASE_ACTIVATION × loadout.attract × fish.curiosityBias`
   *
   * Each fish picks its own approach point with random radial jitter so
   * the school doesn't converge on a single line. Fish that are already
   * far from the pool surface, hidden, or hooked are skipped.
   */
  _updateAllFishCuriosity(dt, fp, mods) {
    const pool = window._v2PoolFish;
    if (!Array.isArray(pool) || pool.length === 0) return;
    const BASE_ACTIVATION_PER_S = 0.022;
    const MAX_RANGE_M = 14.0;                 // ignore fish further than this
    const DRAWN_SPEED = 1.45;                  // m/s while approaching
    const INSPECT_RANGE = 0.95;                // distance to flip to INSPECT
    const INSPECT_ORBIT_R = 0.72;              // circling radius around bob
    const INSPECT_ANG_SPEED = 1.9;             // rad/s while circling
    const INSPECT_DURATION = 2.4;              // base seconds before BACKOFF
    const BACKOFF_SPEED = 1.10;
    const BACKOFF_DIST = 4.5;
    const COOLDOWN_BASE = 6.0;
    const now = performance.now() * 0.001;

    for (let i = 0; i < pool.length; i++) {
      const fish = pool[i];
      if (!fish?.visible) continue;
      // Skip the hooked fish — `_animateHookedFish` owns its motion.
      if (fish.userData._fishingHooked) continue;

      let cu = fish.userData._curiosity;
      if (!cu) {
        cu = fish.userData._curiosity = {
          state: "WANDER",
          since: now,
          until: 0,
          cooldownUntil: now + Math.random() * 3.0,
          // Personality (0.55–1.45) — applied to activation chance so
          // some fish read as bolder, others as wary.
          bias: 0.55 + Math.random() * 0.9,
          approachX: 0,
          approachZ: 0,
          orbitPhase: Math.random() * Math.PI * 2,
          orbitDir: Math.random() < 0.5 ? -1 : 1,
        };
      }

      const fx = fish.position.x;
      const fz = fish.position.z;
      const ddx = fp.x - fx;
      const ddz = fp.z - fz;
      const dist = Math.hypot(ddx, ddz);

      switch (cu.state) {
        case "WANDER": {
          if (now < cu.cooldownUntil) break;
          if (dist > MAX_RANGE_M) break;
          // Roll for activation each frame at the configured rate.
          const p = BASE_ACTIVATION_PER_S * mods.attract * cu.bias * dt;
          if (Math.random() < p) {
            // Pick an approach point slightly off-centre from the bob so
            // multiple curious fish don't stack exactly on top of it.
            const ang = Math.random() * Math.PI * 2;
            const off = 0.18 + Math.random() * 0.22;
            cu.approachX = fp.x + Math.cos(ang) * off;
            cu.approachZ = fp.z + Math.sin(ang) * off;
            cu.state = "DRAWN";
            cu.since = now;
          }
          break;
        }
        case "DRAWN": {
          const dx2 = cu.approachX - fx;
          const dz2 = cu.approachZ - fz;
          const d2 = Math.hypot(dx2, dz2);
          if (d2 < INSPECT_RANGE || dist < INSPECT_RANGE) {
            cu.state = "INSPECT";
            cu.since = now;
            cu.until = now + INSPECT_DURATION * (0.7 + Math.random() * 0.7);
            // Brushing the lure on arrival makes a satisfying ripple.
            this._emitFishRipple(0.9 + Math.random() * 0.4);
          } else if (now - cu.since > 6.0) {
            // Approach taking too long (maybe blocked by Pool2 orbit
            // tug-of-war) — abandon and cool down.
            cu.state = "BACKOFF";
            cu.since = now;
          } else {
            // Step toward the approach point. Capped per-frame so a long
            // delta-time can't tunnel through the inspect range.
            const step = Math.min(d2, DRAWN_SPEED * dt);
            const inv = 1 / Math.max(d2, 1e-4);
            fish.position.x += dx2 * inv * step;
            fish.position.z += dz2 * inv * step;
            if (d2 > 1e-4) {
              fish.rotation.y = Math.atan2(-dz2, dx2) + Math.PI;
            }
          }
          break;
        }
        case "INSPECT": {
          // Circle the bob at INSPECT_ORBIT_R. Each pass emits a small
          // ripple as the fish bumps the lure. The orbit phase is
          // advanced in the fish's chosen direction.
          cu.orbitPhase += INSPECT_ANG_SPEED * cu.orbitDir * dt;
          const ox = Math.cos(cu.orbitPhase) * INSPECT_ORBIT_R;
          const oz = Math.sin(cu.orbitPhase) * INSPECT_ORBIT_R;
          const tx = fp.x + ox;
          const tz = fp.z + oz;
          // Lerp toward the orbit point (smooth swim, not snap).
          const k = Math.min(1, 6.5 * dt);
          fish.position.x += (tx - fx) * k;
          fish.position.z += (tz - fz) * k;
          // Tangent yaw — fish head points along its swim direction.
          const tanX = -Math.sin(cu.orbitPhase) * cu.orbitDir;
          const tanZ =  Math.cos(cu.orbitPhase) * cu.orbitDir;
          fish.rotation.y = Math.atan2(-tanZ, tanX) + Math.PI;
          // Periodic bump-ripple — once per ~half orbit.
          const bump = Math.floor(cu.orbitPhase * 2 / Math.PI);
          if (cu._lastBump !== bump) {
            cu._lastBump = bump;
            this._emitFishRipple(0.55 + Math.random() * 0.25);
          }
          if (now > cu.until) {
            cu.state = "BACKOFF";
            cu.since = now;
          }
          break;
        }
        case "BACKOFF": {
          // Swim straight outward from the bob until clear of the
          // immediate zone, then return to WANDER with a cooldown.
          const dirX = fx - fp.x;
          const dirZ = fz - fp.z;
          const d3 = Math.hypot(dirX, dirZ);
          if (d3 > BACKOFF_DIST || now - cu.since > 4.0) {
            cu.state = "WANDER";
            cu.cooldownUntil = now + COOLDOWN_BASE * (0.7 + Math.random() * 0.8);
            break;
          }
          const inv = 1 / Math.max(d3, 1e-4);
          fish.position.x += dirX * inv * BACKOFF_SPEED * dt;
          fish.position.z += dirZ * inv * BACKOFF_SPEED * dt;
          if (d3 > 1e-4) {
            fish.rotation.y = Math.atan2(-dirZ, dirX) + Math.PI;
          }
          break;
        }
      }
    }
  },

  /** Backwards-compatible wrapper — kept so older call sites still work.
   *  Drives the new per-fish curiosity FSM with the current loadout's
   *  attract multiplier. */
  _coaxFishToHook(dt) {
    const fp = window._v2FishingPoint;
    if (!fp) return;
    const mods = this._loadoutModifiers();
    this._updateAllFishCuriosity(dt, fp, mods);
  },

  _borrowFishForFight() {
    const pool = window._v2PoolFish;
    if (!Array.isArray(pool) || pool.length === 0) return null;
    const fp = window._v2FishingPoint;
    if (!fp) return null;
    // Prefer fish currently INSPECTING the lure — that's the satisfying
    // story-beat: a fish circling the bob is the one that bit. If none
    // are inspecting (rare), fall back to the closest visible fish.
    let inspecting = null;
    let inspectingDSq = Infinity;
    let nearest = null;
    let nearestDSq = Infinity;
    for (const f of pool) {
      if (!f?.visible) continue;
      if (f.userData._fishingHooked) continue;
      const dx = fp.x - f.position.x;
      const dz = fp.z - f.position.z;
      const d = dx * dx + dz * dz;
      if (d < nearestDSq) { nearestDSq = d; nearest = f; }
      if (f.userData._curiosity?.state === "INSPECT" && d < inspectingDSq) {
        inspectingDSq = d;
        inspecting = f;
      }
    }
    const chosen = inspecting ?? nearest;
    if (!chosen) return null;
    chosen.userData._fishingHooked = true;
    // Wipe curiosity so the fight animator owns the motion outright.
    if (chosen.userData._curiosity) {
      chosen.userData._curiosity.state = "WANDER";
      chosen.userData._curiosity.cooldownUntil = Infinity;
    }
    return chosen;
  },

  _animateHookedFish(dt) {
    const fish = this._hookedFish;
    const fp = window._v2FishingPoint;
    if (!fish || !fp) return;
    // Fish surfaces a bit (head near water) and is pulled toward tipi 1
    // by `tension * FISH_PULL_MAX_M` so the player can see it wriggle.
    const targetX = fp.x + fp.pullDirX * this._tension * FISH_PULL_MAX_M;
    const targetZ = fp.z + fp.pullDirZ * this._tension * FISH_PULL_MAX_M;
    const surfaceY = fp.waterY - 0.06;
    fish.position.x += (targetX - fish.position.x) * Math.min(1, 6 * dt);
    fish.position.z += (targetZ - fish.position.z) * Math.min(1, 6 * dt);
    fish.position.y += (surfaceY - fish.position.y) * Math.min(1, 3 * dt);
    // Wriggle: yaw oscillation + small roll.
    const t = performance.now() * 0.001;
    const baseYaw = Math.atan2(-fp.pullDirZ, fp.pullDirX);
    fish.rotation.y = baseYaw + Math.sin(t * 8 + this._fightingT) * 0.7;
    fish.rotation.z = Math.sin(t * 9.7) * 0.35;
  },

  _animateLandingFish(t) {
    const fish = this._hookedFish;
    if (!fish || !this._attachedToAvatar || !this._poleTipNode) return;
    // Lift the fish from the water up to the pole tip in world space.
    // Reads through the chained-segment hierarchy automatically.
    this._poleTipNode.getWorldPosition(this._tmpV);
    const tipX = this._tmpV.x, tipY = this._tmpV.y, tipZ = this._tmpV.z;
    fish.position.x += (tipX - fish.position.x) * t * 0.4;
    fish.position.y += (tipY - 0.15 - fish.position.y) * t * 0.7;
    fish.position.z += (tipZ - fish.position.z) * t * 0.4;
    const tm = performance.now() * 0.001;
    fish.rotation.y = tm * 4 + t * 6;
    fish.rotation.z = Math.sin(tm * 13) * (0.5 - t * 0.5);
  },

  _consumeHookedFish() {
    const fish = this._hookedFish;
    if (!fish) return;
    // Hide the pond fish permanently — every catch shrinks the visible
    // population a bit. Pool2's animator skips invisible entries.
    fish.visible = false;
    fish.userData._fishingHooked = false;
    this._hookedFish = null;
  },

  /** Build a fresh fish clone glued onto the player belt. Stacks at an
   *  increasing yaw around the hips so successive catches dangle around
   *  the player like a creel. */
  /**
   * Stringer-style trophy attachment. The first catch establishes a
   * `THREE.Group` (`_trophyStringer`) at the player's right hip with a
   * thin rope cylinder and a small brass keeper ring; each subsequent
   * fish dangles below the previous one, slightly further out so they
   * read as a chain on a real stringer. All catches share one material
   * to keep the draw-call budget flat.
   */
  _gluedFishTrophyToPlayer(player) {
    if (!player?.avatar) return;
    const tpl = window._v2PoolFishTemplate;
    if (!tpl?.geometry) return;

    // Build the stringer group on the very first catch.
    if (!this._trophyStringer) {
      const stringer = new THREE.Group();
      stringer.name = "fishing_trophy_stringer";
      stringer.position.copy(STRINGER_ANCHOR_LOCAL);
      // Keeper ring at the anchor — brass torus visible above the belt.
      const keeper = new THREE.Mesh(
        new THREE.TorusGeometry(0.025, 0.005, 6, 14),
        new THREE.MeshStandardMaterial({ color: 0xc69b3a, roughness: 0.32, metalness: 0.88 }),
      );
      keeper.rotation.x = Math.PI / 2;
      keeper.position.y = 0.012;
      stringer.add(keeper);
      player.avatar.add(stringer);
      this._trophyStringer = stringer;
    }

    if (!this._trophyMaterial) {
      this._trophyMaterial = new THREE.MeshStandardMaterial({
        color: 0x88b890,
        roughness: 0.45,
        metalness: 0.04,
        emissive: 0x0a2010,
        emissiveIntensity: 0.12,
      });
    }

    const idx = this._trophies.length;
    const drop = Math.min(STRINGER_MAX_DROP, idx * STRINGER_DROP);
    const out  = idx * STRINGER_PITCH;
    const scaleSrc = tpl.targetLengthM / Math.max(0.001, tpl.fishLen);

    // Thin rope segment from the previous attachment point to this fish.
    if (idx > 0 && this._trophyStringer) {
      const prevDrop = Math.min(STRINGER_MAX_DROP, (idx - 1) * STRINGER_DROP);
      const prevOut  = (idx - 1) * STRINGER_PITCH;
      const segLen = Math.hypot(out - prevOut, prevDrop - drop);
      const rope = new THREE.Mesh(
        new THREE.CylinderGeometry(0.004, 0.004, segLen, 6),
        new THREE.MeshStandardMaterial({ color: 0x6b4827, roughness: 0.95 }),
      );
      // Place between the two attachment points and orient along the gap.
      rope.position.set(
        (out + prevOut) * 0.5,
        -(drop + prevDrop) * 0.5 - 0.02,
        0,
      );
      const angle = Math.atan2(out - prevOut, drop - prevDrop);
      rope.rotation.z = -angle;
      this._trophyStringer.add(rope);
    }

    const fish = new THREE.Mesh(tpl.geometry, this._trophyMaterial);
    fish.scale.setScalar(scaleSrc * TROPHY_LENGTH_SCALE);
    fish.castShadow = false;
    fish.receiveShadow = false;
    fish.name = `fishing_trophy_${idx}`;
    fish.position.set(out, -drop - 0.04, 0);
    // Head up (tail dangling), nose pointing outward from the body so
    // the row of fish reads as a clean line of catches on the stringer.
    fish.rotation.y = -Math.PI / 2;
    fish.rotation.z = -0.95;
    this._trophyStringer.add(fish);
    this._trophies.push({ root: fish });
    if (this._hud?.catchCount) {
      this._hud.catchCount.textContent = String(this._trophies.length);
    }
    console.log("%c[Fishing] 🐟 Caught fish #" + this._trophies.length, "color:#90ee90;font-weight:bold;");
  },

  /**
   * Bend the rod under tension. Each pivot in `_poleSegments` is a child
   * of the previous segment, so a small per-pivot rotation compounds
   * into a curving arc. We bias the bend toward the tip (last pivot
   * rotates most) so the rod's "fighting" silhouette reads correctly —
   * the grip-end barely moves, the mid-section curves, the tip dives.
   *
   * Negative X rotation tips the segment forward (toward +Z in the
   * rig's local frame, which is the player's "forward" relative to
   * the dock since the rig is pitched forward by `POLE_PITCH`).
   */
  _updateRodFlex(tension) {
    const segs = this._poleSegments;
    if (!segs || segs.length === 0) return;
    // Bell-shape weighting: tip > mid > grip. Sum to ~1 so total tip
    // deflection at full tension is ~maxBend.
    const weights = [0.12, 0.32, 0.56];
    const maxBendRad = 0.85;
    const bend = tension * maxBendRad;
    for (let i = 0; i < segs.length; i++) {
      const w = weights[i] || 0;
      segs[i].pivot.rotation.x = -bend * w;
    }
  },

  /** Snap the rod back to straight (called on EQUIPPED / IDLE entry). */
  _resetRodFlex() {
    const segs = this._poleSegments;
    if (!segs) return;
    for (const s of segs) s.pivot.rotation.x = 0;
  },

  /**
   * Drive every per-frame piece of the FIGHTING HUD: needle rotation
   * for `tension`, stamina-bar fill for the remaining fight time, and
   * the live percentage label next to the stamina label.
   */
  _updateTensionHud(tension) {
    const hud = this._hud;
    if (!hud) return;
    // May-17 2026 HUD redesign: needle is now a vertical mark sliding
    // along a horizontal tension bar (was an SVG arc + rotated needle
    // in the previous modal-style HUD). Position via `style.left`.
    if (hud.needle) {
      const pct = Math.max(0, Math.min(1, tension)) * 100;
      hud.needle.style.left = pct.toFixed(1) + "%";
    }
    // Mirror the tension % onto the bar's own readout (separate element
    // from the stamina readout — keeps the two domains visually paired
    // but cognitively distinct).
    if (hud.tensionPct) {
      hud.tensionPct.textContent = Math.round(tension * 100) + "%";
    }
    if (hud.staminaFill && hud.staminaPct) {
      const remaining = Math.max(0, FISH_STAMINA_S - this._fightingT);
      const frac = remaining / FISH_STAMINA_S;
      hud.staminaFill.style.width = (frac * 100).toFixed(1) + "%";
      hud.staminaPct.textContent = Math.round(frac * 100) + "%";
    }
  },

  unload() {
    this._disposed = true;
    window._v2FishingActive = false;
    const sc = this._scene;
    const drop = (m) => {
      if (!m) return;
      if (m.parent) m.parent.remove(m);
      m.geometry?.dispose?.();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x?.dispose?.());
      else mat?.dispose?.();
    };
    if (this._rig) {
      if (this._rig.parent) this._rig.parent.remove(this._rig);
      this._rig.traverse?.((c) => {
        if (c.isMesh) {
          c.geometry?.dispose?.();
          const mat = c.material;
          if (Array.isArray(mat)) mat.forEach((x) => x?.dispose?.());
          else mat?.dispose?.();
        }
      });
    }
    drop(this._bob);
    drop(this._sinker);
    drop(this._hook);
    drop(this._line);
    if (this._fishIndicator) {
      this._fishIndicator.traverse?.((c) => {
        if (c.isMesh || c.isLineSegments) {
          c.geometry?.dispose?.();
          const mat = c.material;
          if (Array.isArray(mat)) mat.forEach((x) => x?.dispose?.());
          else mat?.dispose?.();
        }
      });
      if (this._fishIndicator.parent) {
        this._fishIndicator.parent.remove(this._fishIndicator);
      }
      this._fishIndicator = null;
    }
    if (Array.isArray(this._ripples)) {
      for (const r of this._ripples) {
        if (!r) continue;
        if (r.parent) r.parent.remove(r);
        r.geometry?.dispose?.();
        r.material?.dispose?.();
      }
      this._ripples = [];
    }
    // The stringer Group owns the fish meshes + rope segments + keeper
    // ring. Removing it from the parent + traversing children disposes
    // the per-segment ropes and keeper without touching the shared
    // trophy material (disposed once below).
    if (this._trophyStringer) {
      if (this._trophyStringer.parent) {
        this._trophyStringer.parent.remove(this._trophyStringer);
      }
      this._trophyStringer.traverse((c) => {
        if (c.isMesh) {
          c.geometry?.dispose?.();
          if (c.material && c.material !== this._trophyMaterial) {
            const m = c.material;
            if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
            else m?.dispose?.();
          }
        }
      });
    }
    this._trophyStringer = null;
    this._trophies = [];
    this._trophyMaterial?.dispose?.();
    this._trophyMaterial = null;
    if (this._hud?.wrap?.parentNode) this._hud.wrap.parentNode.removeChild(this._hud.wrap);
    this._hud = null;
    this._scene = null;
    this._rig = null;
    this._bob = null;
    this._sinker = null;
    this._hook = null;
    this._line = null;
    this._hookedFish = null;
    this._attachedToAvatar = null;
  },
};
