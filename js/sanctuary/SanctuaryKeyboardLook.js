/**
 * Sacred Adventures — sanctuary part 18 of N: KEYBOARD MOVE + LOOK.
 *
 * Anu domain: PLAYER (input + intent). The click-to-move module already
 * walks the body to a goal point; this module adds WASD direct steering
 * + arrow-key look-around so the player can do what they want every
 * frame instead of one click at a time.
 *
 * Binding (Mark, 2026-10-22; Decision Engine DEC-20):
 *
 *   W / ↑          walk forward (toward where the camera looks); after 2 s it becomes a run
 *   S / ↓          walk backward
 *   A / D, ← / →   turn left / right       (Q / E turn too)
 *   Shift + A / D  strafe left / right     (Shift + ← / → as well)
 *   space          jump (a small hop; the height is kept here and added after the avatar's
 *                  own ground snap, so it really leaves the ground)
 *   PageUp / PageDown / Home  look up / down / level (drag-look)
 *
 * What we drive:
 *   • If `window.__sanctuaryAvatar` exists, we move the AVATAR root.
 *     SanctuaryClickToMove yaw output stays compatible because we write
 *     to the same `window.__sanctuaryPlayerYaw`.
 *   • Otherwise we fall back to driving the orchestrator's camera so
 *     this still works pre-avatar.
 *
 * Camera follow: we re-position the camera each frame to a chase pose
 * 5 m behind + 2.6 m above the body (matching the SanctuaryAvatar
 * height target). When `__sanctuaryTopDown === true` (set by the
 * Controls TOP-DOWN toggle), camera follow is suspended.
 * While she walks, the camera follows close behind her, 1 ft above the
 * top of her head (WALK_CAMERA, Mark 2026-10-22).
 */

import * as THREE from "three";
import { sanctuaryBodyY, sanctuaryGroundY } from "./SanctuaryGround.js";
import { SanctuaryClickToMoveModule } from "./SanctuaryClickToMove.js";

const MOVE_SPEED_MPS = 5.0;
const STRAFE_SPEED_MPS = 4.0;
const TURN_RATE_RAD_PER_S = 2.4;
const JUMP_VEL_MPS = 4.5;
const GRAVITY_MPS2 = 14;
const RUN_AFTER_S = 2.0;      // walking forward this long starts a run (Mark, 2026-10-22)
const RUN_RAMP_S = 0.5;       // walk → run speed-up time, so it never jerks
const RUN_SPEED_MULT = 1.6;   // run = 8 m/s from the 5 m/s walk
const CAMERA_BACK = 5.0;
const CAMERA_UP = 2.6;
const CAMERA_LOOK_FWD = 4.0;
// Walking camera (Mark, 2026-10-22: "when walking move cam 1 foot above avatar head when walkbehind").
// "behind": while she walks (keys, D-pad, joystick or click-to-move) the camera follows close behind
// her, 1 ft above the top of her head (feathers included), looking ahead over her head.
// "front": the May-19 view instead (W / up arrow puts the camera 3 ft in front at eye height).
const WALK_CAMERA = "behind";
const WALK_CAM_ABOVE_HEAD_M = 0.3048;  // 1 ft
const WALK_CAM_BACK_M = 1.2;           // behind her, along the way she faces
const WALK_CAM_START_MPS = 0.5;        // ground speed that counts as walking
const WALK_CAM_HOLD_S = 0.35;          // keep the walking camera this long after she stops
const HEAD_TOP_FALLBACK_M = 1.65;      // Avatar-New: top of the feathers above her feet
// Drag-look + pitch (2026-10-22). Pitch is a look TILT: the camera stays where it is and only the
// point it looks at moves up or down, so the camera can never dip into the ground.
const PITCH_MIN_RAD = -40 * Math.PI / 180;  // look-down limit
const PITCH_MAX_RAD = 35 * Math.PI / 180;   // look-up limit
const PITCH_RATE_RAD_PER_S = 1.2;           // PageUp / PageDown and the panel ▲ ▼ buttons
const DRAG_RAD_PER_VIEW_WIDTH = Math.PI;    // one full-width drag = half a turn (× sensitivity)
const DRAG_CAMERA_LERP_BASE = 0.001;        // same fast follow as walking forward (L252)
const PITCH_TAP_STEP_RAD = 5 * Math.PI / 180; // a tap on ▲ / ▼ (or PageUp / PageDown) still moves the view

export const SanctuaryKeyboardLookModule = {
  name: "SanctuaryKeyboardLook",

  _scene: null,
  _camera: null,
  _yaw: Math.PI,         // facing -Z by default; player looks INTO the pool
  _pitch: 0,             // look tilt, + = up; clamped to [PITCH_MIN_RAD, PITCH_MAX_RAD]
  _bodyVy: 0,
  _jumpY: 0,             // height above the ground during a jump
  _walkFwdTime: 0,       // seconds of continuous forward walking (for the run)
  _grounded: true,
  _keys: {},
  _onKeyDown: null,
  _onKeyUp: null,
  _cameraSmooth: null,
  _lookSmooth: null,
  _walkCamHold: 0,        // seconds the walking camera stays on (refilled while she moves)
  _walkCamPrevX: NaN,     // her position last frame, for the ground speed
  _walkCamPrevZ: NaN,
  _headTop: NaN,          // top of her head above her feet (measured once per avatar)
  _headTopFor: null,

  async load(scene, camera) {
    this._scene = scene;
    this._camera = camera;
    this._cameraSmooth = new THREE.Vector3().copy(camera.position);
    this._lookSmooth = new THREE.Vector3(0, 0, 0);

    // Seed yaw from any prior published value so click-to-move + keyboard
    // agree on facing direction.
    if (typeof window !== "undefined" && Number.isFinite(window.__sanctuaryPlayerYaw)) {
      this._yaw = window.__sanctuaryPlayerYaw;
    }

    this._onKeyDown = (e) => {
      // Ignore if typing in an input.
      const ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
      const k = (e.key || "").toLowerCase();
      if (k === "pageup" || k === "pagedown" || k === "home") e.preventDefault();
      // A quick tap (a panel ▲ ● ▼ button) can send key-down and key-up inside one frame, so
      // update() would never see the key held. Act on the key-down itself as well.
      if (!e.repeat && window._v4InputSuppressed !== true) {
        if (k === "home") this._pitch = 0;
        else if (k === "pageup") this._pitch = Math.min(PITCH_MAX_RAD, this._pitch + PITCH_TAP_STEP_RAD);
        else if (k === "pagedown") this._pitch = Math.max(PITCH_MIN_RAD, this._pitch - PITCH_TAP_STEP_RAD);
      }
      // Any key cancels an in-flight click-to-move path so the kid
      // takes manual control immediately. (May-19 2026 user spec.)
      if (typeof window !== "undefined" && typeof window._v4CancelClickToMove === "function") {
        window._v4CancelClickToMove();
      }
      this._keys[k] = true;
    };
    this._onKeyUp = (e) => {
      const k = (e.key || "").toLowerCase();
      this._keys[k] = false;
    };
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);

    // Inject the walk-hide CSS for the journal overlay (used by the
    // forward-zoom camera pose so the chrome doesn't cover the kid).
    if (typeof document !== "undefined" && !document.getElementById("v4-walk-hide-style")) {
      const s = document.createElement("style");
      s.id = "v4-walk-hide-style";
      s.textContent = `
        #v4-journal-overlay.v4-hide-on-walk {
          opacity: 0 !important;
          pointer-events: none !important;
          transition: opacity 140ms ease-out;
        }
        #v4-journal-overlay { transition: opacity 220ms ease-in; }
      `;
      document.head.appendChild(s);
    }

    console.log(
      "%c[Sanctuary] ⌨  Keyboard online — W/S walk (run after 2 s), A/D or arrows turn, Shift+A/D strafe, Space jumps.",
      "color:#a5d6a7;font-weight:bold;",
    );
  },

  update(delta) {
    if (!this._camera) return;

    // Locate the body we drive (avatar root, or fall back to camera).
    const avatar = (typeof window !== "undefined") ? window.__sanctuaryAvatar : null;
    const body = avatar ?? this._camera;

    // Journal / overlay suppression — when the journal is open the
    // game canvas shouldn't take keyboard input.
    if (typeof window !== "undefined" && window._v4InputSuppressed === true) {
      this._keys = {}; // flush any in-flight keys
      return;
    }
    const k = this._keys;

    // Turn and strafe (Mark, 2026-10-22): A / D, ← / → and Q / E turn. Hold Shift and
    // A / D (or ← / →) to strafe instead; Q / E always turn.
    const strafing = !!k["shift"];
    const leftKey = !!(k["a"] || k["arrowleft"]);
    const rightKey = !!(k["d"] || k["arrowright"]);
    if (k["q"] || (leftKey && !strafing))  this._yaw += TURN_RATE_RAD_PER_S * delta;
    if (k["e"] || (rightKey && !strafing)) this._yaw -= TURN_RATE_RAD_PER_S * delta;

    // Mobile Virtual Joystick Yaw Deflection (turn left/right)
    if (typeof window !== "undefined" && window.__sanctuaryJoystickInput) {
      const j = window.__sanctuaryJoystickInput;
      if (Math.abs(j.x) > 0.05) {
        if (typeof window._v4CancelClickToMove === "function") window._v4CancelClickToMove();
        this._yaw -= j.x * TURN_RATE_RAD_PER_S * delta;
      }
    }

    // Drag-look (SanctuaryDragLook fills this from the panel; dx/dy are in viewport widths).
    // Drag right → look right (same sign as E); drag up → look up.
    const look = (typeof window !== "undefined") ? window.__sanctuaryLookDrag : null;
    if (look && (look.dx !== 0 || look.dy !== 0)) {
      const rad = DRAG_RAD_PER_VIEW_WIDTH * (Number(look.sens) || 1);
      this._yaw -= look.dx * rad;
      this._pitch -= look.dy * rad * (look.invertY ? -1 : 1);
      look.dx = 0;
      look.dy = 0;
    }
    // Keyboard pitch (the panel ▲ ● ▼ buttons send the same keys through KEY_FORWARD).
    if (k["pageup"])   this._pitch += PITCH_RATE_RAD_PER_S * delta;
    if (k["pagedown"]) this._pitch -= PITCH_RATE_RAD_PER_S * delta;
    if (k["home"])     this._pitch = 0;
    if (this._pitch > PITCH_MAX_RAD) this._pitch = PITCH_MAX_RAD;
    else if (this._pitch < PITCH_MIN_RAD) this._pitch = PITCH_MIN_RAD;

    // Sync yaw from click-to-move when active so the camera follows
    // behind the path direction instead of staying at a stale angle.
    if (typeof window !== "undefined" && Number.isFinite(window.__sanctuaryPlayerYaw)) {
      const clickActive = !!(SanctuaryClickToMoveModule && SanctuaryClickToMoveModule._goal);
      if (clickActive) {
        this._yaw = window.__sanctuaryPlayerYaw;
      }
    }

    // Movement vectors. Convention: forward = (-sin yaw, 0, -cos yaw),
    // matches three.js's right-hand Y-up + the engine's existing yaw
    // dispatch (see v2 World.js comment block on `_fwd = (-sin yaw, ...)`).
    const fwdX = -Math.sin(this._yaw);
    const fwdZ = -Math.cos(this._yaw);
    const rightX = Math.cos(this._yaw);
    const rightZ = -Math.sin(this._yaw);

    let mvX = 0, mvZ = 0;
    if (k["w"] || k["arrowup"])   { mvX += fwdX; mvZ += fwdZ; }
    if (k["s"] || k["arrowdown"]) { mvX -= fwdX; mvZ -= fwdZ; }
    if (strafing && leftKey)      { mvX -= rightX * (STRAFE_SPEED_MPS / MOVE_SPEED_MPS);
                                    mvZ -= rightZ * (STRAFE_SPEED_MPS / MOVE_SPEED_MPS); }
    if (strafing && rightKey)     { mvX += rightX * (STRAFE_SPEED_MPS / MOVE_SPEED_MPS);
                                    mvZ += rightZ * (STRAFE_SPEED_MPS / MOVE_SPEED_MPS); }

    // Mobile Virtual Joystick Vertical Deflection (walk forward/backward)
    if (typeof window !== "undefined" && window.__sanctuaryJoystickInput) {
      const j = window.__sanctuaryJoystickInput;
      if (Math.abs(j.y) > 0.05) {
        if (typeof window._v4CancelClickToMove === "function") window._v4CancelClickToMove();
        mvX -= j.y * fwdX;
        mvZ -= j.y * fwdZ;
      }
    }

    // Walking forward (keys or joystick) for RUN_AFTER_S starts a run; stopping resets it.
    const joy = (typeof window !== "undefined") ? window.__sanctuaryJoystickInput : null;
    const forwardHeld = !!(k["w"] || k["arrowup"]) || !!(joy && joy.y < -0.05);
    const backHeld = !!(k["s"] || k["arrowdown"]);
    if (forwardHeld && !backHeld) this._walkFwdTime += delta;
    else this._walkFwdTime = 0;
    const runK = Math.max(0, Math.min(1, (this._walkFwdTime - RUN_AFTER_S) / RUN_RAMP_S));
    const speed = MOVE_SPEED_MPS * (1 + (RUN_SPEED_MULT - 1) * runK);

    const mvLen = Math.hypot(mvX, mvZ);
    if (mvLen > 0) {
      const nx = mvX / mvLen;
      const nz = mvZ / mvLen;
      body.position.x += nx * speed * delta;
      body.position.z += nz * speed * delta;
    }

    // Vertical — jump + gravity on the avatar; camera fall-through gets
    // the same to keep its feet on the heightfield.
    // sanctuaryBodyY is the single source of truth for body anchor Y —
    // it knows about the dock (walkable surface), the pool waterline
    // (half-submerged when swimming), and the analytic terrain. No
    // lift parameter passed → avatar floats at waterY − height/2 with
    // body half submerged. User-corrected 2026-05-28: "half her model
    // needs to always be submerged" — the earlier +1 ft lift was too
    // high; the kid needs to read as actually swimming.
    const groundY = sanctuaryBodyY(body.position.x, body.position.z);
    if (k[" "] && this._grounded) {
      this._bodyVy = JUMP_VEL_MPS;
      this._grounded = false;
    }
    if (!this._grounded) {
      this._bodyVy -= GRAVITY_MPS2 * delta;
      this._jumpY += this._bodyVy * delta;
      if (this._jumpY <= 0) {
        this._jumpY = 0;
        this._bodyVy = 0;
        this._grounded = true;
      }
    }
    // Absolute, not relative: SanctuaryAvatar re-snaps the body to the ground earlier in every
    // frame (its update(), `cur.y = sanctuaryBodyY(...)`), so the jump height is kept here and
    // added last. Before 2026-10-22 the jump restarted from the ground each frame (a ~7 cm twitch).
    body.position.y = groundY + this._jumpY;

    // Publish yaw so SanctuaryAvatar's update() (which reads
    // `window.__sanctuaryPlayerYaw`) keeps the rig facing the right way.
    if (typeof window !== "undefined") {
      window.__sanctuaryPlayerYaw = this._yaw;
    }

    // Camera follow — suspended when the player is in top-down mode
    // (Controls toggles `v4-top-down-view` on body + manages its own
    // camera pose; we yield to it).
    const inTopDown =
      typeof document !== "undefined" &&
      document.body.classList.contains("v4-top-down-view");
    if (!inTopDown && body !== this._camera) {
      // Scroll-wheel zoom — SanctuaryZoom publishes a multiplier.
      const zoom =
        typeof window !== "undefined" && Number.isFinite(window.__sanctuaryZoomFactor)
          ? window.__sanctuaryZoomFactor
          : 1.0;

      // ── Forward-motion vs idle/turn pose (May-19 2026 user spec) ───
      // When the player presses W / ArrowUp the camera zooms IN to ~2 ft
      // in front of their eyes (first-person-ish over-the-shoulder).
      // When standing still or only turning (Q/E/A/D/arrows-L-R) the
      // camera hangs back at the normal chase distance and lerps SLOWLY
      // so it feels like the world drags behind the player's head turn
      // instead of snapping to follow. Forward motion uses a fast lerp
      // so the zoom-in feels responsive.
      const movingFwd = !!(k["w"] || k["arrowup"]);
      // 3 ft in front (bumped from 2 ft) — at 2 ft the avatar's head/hair
      // still pokes into the camera's view. 3 ft clears the head and
      // gives a clean over-the-top view of where she's heading.
      const FWD_ZOOM_M = 0.9144;
      const EYE_HEIGHT_M = 1.45;
      // Walking = she really moves over the ground, whatever moves her, so a tap or a turn on the
      // spot doesn't swing the camera. The hold keeps it steady through click-to-move turns.
      const groundSpeed = Number.isFinite(this._walkCamPrevX) && delta > 0
        ? Math.hypot(body.position.x - this._walkCamPrevX, body.position.z - this._walkCamPrevZ) / delta
        : 0;
      this._walkCamPrevX = body.position.x;
      this._walkCamPrevZ = body.position.z;
      if (groundSpeed > WALK_CAM_START_MPS) this._walkCamHold = WALK_CAM_HOLD_S;
      else this._walkCamHold = Math.max(0, this._walkCamHold - delta);
      const headTop = this._headTopAbove(body); // measured while she stands, so the first step doesn't hitch
      let camX, camY, camZ, lookX, lookY, lookZ, cLerp;
      if (WALK_CAMERA === "behind" && this._walkCamHold > 0) {
        // Walk-behind: close behind her, 1 ft above the top of her head, looking ahead over it.
        // The drag-look tilt still applies; same snappy follow as the old forward view.
        camX = body.position.x - fwdX * WALK_CAM_BACK_M;
        camZ = body.position.z - fwdZ * WALK_CAM_BACK_M;
        camY = body.position.y + headTop + WALK_CAM_ABOVE_HEAD_M;
        lookX = body.position.x + fwdX * CAMERA_LOOK_FWD;
        lookZ = body.position.z + fwdZ * CAMERA_LOOK_FWD;
        lookY = body.position.y + 1.4 + Math.tan(this._pitch) * (WALK_CAM_BACK_M + CAMERA_LOOK_FWD);
        cLerp = 1 - Math.pow(0.001, delta);
      } else if (WALK_CAMERA === "front" && movingFwd) {
        camX = body.position.x + fwdX * FWD_ZOOM_M;
        camZ = body.position.z + fwdZ * FWD_ZOOM_M;
        camY = body.position.y + EYE_HEIGHT_M;
        lookX = body.position.x + fwdX * (FWD_ZOOM_M + CAMERA_LOOK_FWD);
        lookZ = body.position.z + fwdZ * (FWD_ZOOM_M + CAMERA_LOOK_FWD);
        lookY = body.position.y + EYE_HEIGHT_M - 0.10 + Math.tan(this._pitch) * CAMERA_LOOK_FWD;
        // Snappy forward lerp.
        cLerp = 1 - Math.pow(0.001, delta);
      } else {
        // Idle / turning: chase pose with a slow "hang back" lerp.
        const back = CAMERA_BACK * zoom;
        const up = CAMERA_UP * zoom;
        camX = body.position.x - fwdX * back;
        camZ = body.position.z - fwdZ * back;
        camY = body.position.y + up;
        lookX = body.position.x + fwdX * CAMERA_LOOK_FWD;
        lookZ = body.position.z + fwdZ * CAMERA_LOOK_FWD;
        lookY = body.position.y + 1.4 + Math.tan(this._pitch) * (back + CAMERA_LOOK_FWD);
        // Slower lerp so the camera lazily catches up to yaw changes —
        // the player's head turns first, the camera drifts to match.
        // While a drag is in progress the camera follows as fast as when walking forward, so the
        // view stays under the finger instead of drifting ~0.6 s behind it.
        cLerp = 1 - Math.pow(look && look.dragging ? DRAG_CAMERA_LERP_BASE : 0.18, delta);
      }
      this._cameraSmooth.lerp(new THREE.Vector3(camX, camY, camZ), cLerp);
      this._lookSmooth.lerp(new THREE.Vector3(lookX, lookY, lookZ), cLerp);
      this._camera.position.copy(this._cameraSmooth);
      this._camera.lookAt(this._lookSmooth);

      // Hide the guidebook overlay while moving forward so the camera
      // zoom-in isn't covered by chrome. The journal is one element;
      // it stays VISIBLE on hold-still / turn so the kid can read.
      if (typeof document !== "undefined") {
        const journal = document.getElementById("v4-journal-overlay");
        if (journal) {
          if (movingFwd) journal.classList.add("v4-hide-on-walk");
          else journal.classList.remove("v4-hide-on-walk");
        }
      }
    }
  },

  /**
   * Height of the top of her head (feathers included) above her feet, from the skinned mesh in
   * its current pose (every 4th vertex). Measured once per avatar; until the model is in, the
   * fallback is returned and nothing is cached.
   */
  _headTopAbove(body) {
    if (this._headTopFor === body && Number.isFinite(this._headTop)) return this._headTop;
    let top = -Infinity;
    const v = new THREE.Vector3();
    body.updateMatrixWorld(true);
    body.traverse((m) => {
      if (!m.isSkinnedMesh || !m.visible || !m.geometry?.attributes?.position) return;
      const n = m.geometry.attributes.position.count;
      for (let i = 0; i < n; i += 4) {
        m.getVertexPosition(i, v);
        v.applyMatrix4(m.matrixWorld);
        if (v.y > top) top = v.y;
      }
    });
    const h = top - body.position.y;
    if (!(h > 0.5 && h < 4)) return HEAD_TOP_FALLBACK_M;
    this._headTop = h;
    this._headTopFor = body;
    return h;
  },

  unload() {
    if (this._onKeyDown) window.removeEventListener("keydown", this._onKeyDown);
    if (this._onKeyUp) window.removeEventListener("keyup", this._onKeyUp);
    this._onKeyDown = null;
    this._onKeyUp = null;
    this._scene = null;
    this._camera = null;
  },
};
