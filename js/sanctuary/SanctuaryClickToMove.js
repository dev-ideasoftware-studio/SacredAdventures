/**
 * Sacred Adventures — sanctuary part 6 of N: CLICK-TO-MOVE + KID FOOTPRINTS.
 *
 * Anu domain: PLAYER (the witness point — input + intent + body).
 *
 * What it does:
 *   • Listens for left-click on the main canvas, raycasts against the
 *     sanctuary terrain to find a (x, z) goal, and sets it as the
 *     smart-path target.
 *   • Walks the player smoothly toward the target each frame, snapping
 *     yaw so the avatar faces forward along the path.
 *   • Lays down a trail of cute kid footprints — wide chubby toes, soft
 *     short heels, slightly bigger than scale would normally suggest so
 *     they read as charming, not technical — starting a few feet in
 *     front of the player and pointing along the path.
 *   • At the goal, drops a small gold "X" that pulses until arrival.
 *
 * Triangle target: < 800 tris total (50 footprints × 8 tris + 4-arm X).
 *
 * Inputs:
 *   • orchestrator.scene, .camera, .renderer.domElement
 *   • SanctuaryGround.sanctuaryGroundY(x, z) for terrain sampling
 *   • An avatar to move. We attach to whatever object is at
 *     `window.__sanctuaryAvatar` (set by a future avatar module). For
 *     now we drive `orchestrator.camera` directly so the user can fly
 *     the camera around the pool with clicks even before an avatar
 *     mesh exists.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN, ANU_INTERACTION_VERB } from "../v2/anu/SimulationController.js";
import { sanctuaryGroundY } from "./SanctuaryGround.js";

const MAX_FOOTPRINTS = 50;
const PRINT_LEN_M = 0.28;
const PRINT_WIDTH_M = 0.20;
const STRIDE_M = 0.65;
const FOOT_LATERAL_OFFSET_M = 0.13;
const GROUND_LIFT_M = 0.08;
/** Start the trail this far AHEAD of the player so the prints feel like
 *  they're guiding the player forward (kid-treasure-map vibe). */
const TRAIL_LEAD_M = 1.2;
const WALK_SPEED_MPS = 4.5;
const ARRIVE_TOLERANCE_M = 0.45;

const GOLD = 0xfbc02d;

/**
 * Build a chubby kid-foot silhouette using a `ShapeGeometry`. The
 * outline is a teardrop traced counter-clockwise: round heel, narrow
 * arch, wide ball with bubble toes. Wider/shorter than the adult
 * version in `ClickToMoveMarker.js` — reads playful from above.
 */
function _buildKidFootGeometry() {
  const L = PRINT_LEN_M;
  const W = PRINT_WIDTH_M;
  const hW = W * 0.5;
  const shape = new THREE.Shape();

  // Outline (counter-clockwise) — heel at x=0, toes at x=L.
  //
  //  ⬑  upper side (positive Y)
  //  heel ─── instep ─── ball ─── toes
  //  ⬐  lower side (negative Y)
  //
  shape.moveTo(0.0, 0.0);
  shape.quadraticCurveTo(0.00, hW * 1.05,  0.18 * L, hW * 0.95);   // heel round
  shape.quadraticCurveTo(0.34 * L, hW * 0.70, 0.55 * L, hW * 0.92); // instep → ball
  shape.quadraticCurveTo(0.80 * L, hW * 1.05, 0.92 * L, hW * 0.55); // ball flare
  // Three bubble toes on the upper side.
  shape.quadraticCurveTo(0.99 * L, hW * 0.85, 1.00 * L, 0.0);       // tip
  shape.quadraticCurveTo(0.99 * L, -hW * 0.85, 0.92 * L, -hW * 0.55);
  shape.quadraticCurveTo(0.80 * L, -hW * 1.05, 0.55 * L, -hW * 0.92);
  shape.quadraticCurveTo(0.34 * L, -hW * 0.70, 0.18 * L, -hW * 0.95);
  shape.quadraticCurveTo(0.00, -hW * 1.05, 0.0, 0.0);

  const geo = new THREE.ShapeGeometry(shape, 12);
  // Centre the geometry around the heel so positioning by heel-on-stride
  // reads correct. Shift -0.42 along long axis pulls the heel to local x≈0.
  geo.translate(-L * 0.42, 0, 0);
  return geo;
}

function _buildKidToeBubbleGeometry() {
  // Small circles for individual toe bubbles — overlaid on the foot
  // shape to read as "the toes are little dots", classic children's
  // book footprint style.
  return new THREE.CircleGeometry(0.045, 10);
}

export const SanctuaryClickToMoveModule = {
  name: "SanctuaryClickToMove",

  _scene: null,
  _camera: null,
  _canvas: null,
  _root: null,

  /** Goal state. */
  _goal: null,            // THREE.Vector3 (XZ used; Y from terrain at click)
  _xMarker: null,         // THREE.Group "X" mesh at the goal

  /** Footprint trail. */
  _dashes: null,          // THREE.InstancedMesh of MAX_FOOTPRINTS prints
  _dashGeo: null,
  _dashMat: null,

  /** Raycaster scratch. */
  _raycaster: null,
  _ndc: null,

  /** Body being moved. We default to camera + a stub `feet` so smart-
   *  path works before an avatar lands. */
  _body: null,
  _yaw: 0,

  /** DOM listener handle. */
  _onPointerDown: null,
  _elapsed: 0,

  async load(scene, camera, renderer) {
    if (this._root) return;
    this._scene = scene;
    this._camera = camera;
    this._canvas = renderer?.domElement ?? null;

    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();

    const root = new THREE.Group();
    root.name = "sanctuary_click_to_move_root";
    root.userData.anuId = "player.sanctuary.click_to_move";
    root.userData.anuKind = "sanctuary_click_to_move";
    root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;
    root.userData.anuInteractable = true;
    root.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.USE];

    // ── X mark at the goal ────────────────────────────────────────────
    const xMat = new THREE.MeshBasicMaterial({
      color: GOLD,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const armGeo = new THREE.PlaneGeometry(0.78, 0.16);
    const xGroup = new THREE.Group();
    xGroup.name = "sanctuary_click_to_move_x";
    const arm1 = new THREE.Mesh(armGeo, xMat);
    arm1.rotation.x = -Math.PI / 2;
    arm1.rotation.z = Math.PI / 4;
    arm1.userData.anuKind = "sanctuary_click_to_move_x_arm";
    arm1.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;
    const arm2 = new THREE.Mesh(armGeo, xMat);
    arm2.rotation.x = -Math.PI / 2;
    arm2.rotation.z = -Math.PI / 4;
    arm2.userData.anuKind = "sanctuary_click_to_move_x_arm";
    arm2.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;
    xGroup.add(arm1, arm2);
    xGroup.renderOrder = 11;
    xGroup.visible = false;
    this._xMarker = xGroup;
    root.add(xGroup);

    // ── Footprint instances ──────────────────────────────────────────
    const dashGeo = _buildKidFootGeometry();
    const dashMat = new THREE.MeshBasicMaterial({
      color: GOLD,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const dashes = new THREE.InstancedMesh(dashGeo, dashMat, MAX_FOOTPRINTS);
    dashes.frustumCulled = false;
    dashes.renderOrder = 10;
    dashes.name = "sanctuary_kid_footprints";
    dashes.userData.anuKind = "sanctuary_kid_footprints";
    dashes.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;
    // Park every print invisible at start.
    const dummy = new THREE.Object3D();
    dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();
    for (let i = 0; i < MAX_FOOTPRINTS; i++) dashes.setMatrixAt(i, dummy.matrix);
    dashes.instanceMatrix.needsUpdate = true;
    this._dashes = dashes;
    this._dashGeo = dashGeo;
    this._dashMat = dashMat;
    root.add(dashes);

    scene.add(root);
    this._root = root;

    // Pick the body the click drives — prefer an avatar if one's been
    // staged by a future module, otherwise drive the camera directly.
    this._body =
      (typeof window !== "undefined" && window.__sanctuaryAvatar) ||
      { position: camera.position };
    this._yaw = 0;

    // Wire the click handler. `mousedown` instead of `click` so the
    // path snaps on the press, not the release.
    this._onPointerDown = (e) => this._handleClick(e);
    this._canvas?.addEventListener("mousedown", this._onPointerDown);
    this._canvas?.addEventListener("touchstart", this._onPointerDown, { passive: true });

    // Expose a global cancel so any keydown listener (KeyboardLook,
    // panel buttons) can interrupt an auto-move path immediately.
    if (typeof window !== "undefined") {
      window._v4CancelClickToMove = () => {
        if (!this._goal) return false;
        this._goal = null;
        if (this._xMarker) this._xMarker.visible = false;
        this._clearAllPrints();
        return true;
      };
    }

    console.log(
      "%c[Sanctuary] 👣 Click-to-move ready. Click the ground to walk; kid footprints will guide.",
      "color:#fbc02d;font-weight:bold;",
    );
  },

  _handleClick(ev) {
    if (!this._canvas || !this._camera) return;
    const rect = this._canvas.getBoundingClientRect();
    const cx = ev.touches?.[0]?.clientX ?? ev.clientX;
    const cy = ev.touches?.[0]?.clientY ?? ev.clientY;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
    this._ndc.x = ((cx - rect.left) / rect.width) * 2 - 1;
    this._ndc.y = -((cy - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._ndc, this._camera);

    // Plane-cast against the sanctuary ground plane (y=0). Since the
    // terrain is curved we then refine by sampling `sanctuaryGroundY`
    // at the hit XZ — close enough for the click target.
    const ray = this._raycaster.ray;
    if (Math.abs(ray.direction.y) < 1e-4) return;
    const tHit = -ray.origin.y / ray.direction.y;
    if (tHit < 0 || tHit > 200) return;
    const hitX = ray.origin.x + ray.direction.x * tHit;
    const hitZ = ray.origin.z + ray.direction.z * tHit;

    // If we're in TOP-DOWN mode AND a mold tool is active, divert the
    // click into the SanctuaryMutations registry instead of walking the
    // player. The Controls module flips `document.body` class
    // `v4-top-down-view` on toggle; the mold tool is stored on
    // `window.__sanctuaryMoldTool` (default `null` = no mold, click
    // still walks in top-down).
    const inTopDown =
      typeof document !== "undefined" &&
      document.body.classList.contains("v4-top-down-view");
    const moldTool =
      typeof window !== "undefined" && window.__sanctuaryMoldTool
        ? window.__sanctuaryMoldTool
        : null;
    if (inTopDown && moldTool && window.SanctuaryMutations?.publish) {
      window.SanctuaryMutations.publish(moldTool, hitX, hitZ);
      return;
    }

    const groundY = sanctuaryGroundY(hitX, hitZ);
    this._goal = new THREE.Vector3(hitX, groundY + GROUND_LIFT_M, hitZ);
    this._xMarker.visible = true;
    this._xMarker.position.copy(this._goal);
  },

  update(delta) {
    if (!this._root) return;
    this._elapsed += delta;

    // Pulse the X mark while a goal is live.
    if (this._xMarker?.visible) {
      const pulse = 0.92 + Math.sin(this._elapsed * 6.0) * 0.08;
      this._xMarker.scale.setScalar(pulse);
    }

    // Step the body along the path.
    const body = this._body;
    if (!body?.position || !this._goal) {
      this._clearAllPrints();
      return;
    }
    const dx = this._goal.x - body.position.x;
    const dz = this._goal.z - body.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist <= ARRIVE_TOLERANCE_M) {
      this._goal = null;
      this._xMarker.visible = false;
      this._clearAllPrints();
      return;
    }

    // Normalised heading (path direction).
    const dirX = dx / dist;
    const dirZ = dz / dist;

    // Step the body by WALK_SPEED_MPS * delta toward the goal.
    const stepDist = Math.min(WALK_SPEED_MPS * delta, dist - ARRIVE_TOLERANCE_M * 0.5);
    body.position.x += dirX * stepDist;
    body.position.z += dirZ * stepDist;
    // Sample terrain so the body / camera tracks the ground rather than
    // floating. The +1.5 m eye-height lift only applies when click-to-
    // move is driving the bare camera (pre-avatar fallback). When the
    // body is the avatar root the lift would float the kid 1.5 m off
    // the ground every frame — feet hover, walk anim looks "locked"
    // because the soles never plant. (May-19 2026 fix.)
    const isAvatarBody =
      typeof window !== "undefined" && window.__sanctuaryAvatar === body;
    const yLift = isAvatarBody ? 0 : 1.5;
    const _dockSurf = typeof window !== "undefined" && window.__sanctuaryDockSurface;
    const _dockY = _dockSurf ? _dockSurf.getY(body.position.x, body.position.z) : null;
    body.position.y = (_dockY !== null ? _dockY : sanctuaryGroundY(body.position.x, body.position.z)) + yLift;

    // Yaw matches the path so a future avatar will face forward.
    this._yaw = Math.atan2(-dx, -dz);
    if (typeof window !== "undefined") window.__sanctuaryPlayerYaw = this._yaw;

    // Repaint the footprint trail. Prints start TRAIL_LEAD_M ahead of
    // the body and continue in stride increments up to (or just short
    // of) the goal.
    this._layFootprints(body.position.x, body.position.z, dirX, dirZ, dist);
  },

  _layFootprints(px, pz, dirX, dirZ, distToGoal) {
    const dashes = this._dashes;
    if (!dashes) return;
    const dummy = new THREE.Object3D();
    const perpX = dirZ;
    const perpZ = -dirX;
    const firstAlong = TRAIL_LEAD_M;
    const lastAlong = distToGoal - STRIDE_M * 0.4;
    const printCount = Math.max(
      0,
      Math.min(MAX_FOOTPRINTS, Math.floor((lastAlong - firstAlong) / STRIDE_M) + 1),
    );
    const yaw = Math.atan2(dirX, dirZ);

    for (let i = 0; i < MAX_FOOTPRINTS; i++) {
      if (i >= printCount) {
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        dashes.setMatrixAt(i, dummy.matrix);
        continue;
      }
      const along = firstAlong + i * STRIDE_M;
      // Alternate L / R prints.
      const side = i % 2 === 0 ? -1 : 1;
      const lateralX = perpX * FOOT_LATERAL_OFFSET_M * side;
      const lateralZ = perpZ * FOOT_LATERAL_OFFSET_M * side;
      const x = px + dirX * along + lateralX;
      const z = pz + dirZ * along + lateralZ;
      const _ds = typeof window !== "undefined" && window.__sanctuaryDockSurface;
      const _dy = _ds ? _ds.getY(x, z) : null;
      const y = (_dy !== null ? _dy : sanctuaryGroundY(x, z)) + GROUND_LIFT_M;
      dummy.position.set(x, y, z);
      // Lay flat then yaw, mirror Z for left foot.
      dummy.rotation.set(-Math.PI / 2, yaw, 0);
      dummy.scale.set(1, 1, side);
      dummy.updateMatrix();
      dashes.setMatrixAt(i, dummy.matrix);
    }
    dashes.instanceMatrix.needsUpdate = true;
  },

  _clearAllPrints() {
    if (!this._dashes) return;
    const dummy = new THREE.Object3D();
    dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();
    for (let i = 0; i < MAX_FOOTPRINTS; i++) {
      this._dashes.setMatrixAt(i, dummy.matrix);
    }
    this._dashes.instanceMatrix.needsUpdate = true;
  },

  unload(scene) {
    if (this._onPointerDown && this._canvas) {
      this._canvas.removeEventListener("mousedown", this._onPointerDown);
      this._canvas.removeEventListener("touchstart", this._onPointerDown);
    }
    if (!this._root) return;
    scene.remove(this._root);
    this._dashGeo?.dispose();
    this._dashMat?.dispose();
    this._root = null;
    this._xMarker = null;
    this._dashes = null;
    this._goal = null;
    this._body = null;
    this._scene = null;
    this._camera = null;
    this._canvas = null;
  },
};
