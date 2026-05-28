/**
 * Sacred Adventures — sanctuary part 18 of N: KEYBOARD MOVE + LOOK.
 *
 * Anu domain: PLAYER (input + intent). The click-to-move module already
 * walks the body to a goal point; this module adds WASD direct steering
 * + arrow-key look-around so the player can do what they want every
 * frame instead of one click at a time.
 *
 * Binding (kid-friendly, no caps required, no modifiers):
 *
 *   W / ↑    move forward      (toward where the camera is looking, on the XZ plane)
 *   S / ↓    move backward
 *   A        strafe left
 *   D        strafe right
 *   Q        turn yaw left      (also rebinds to bumper-thumb friendly)
 *   E        turn yaw right
 *   ←  →     turn yaw left / right (arrow alternative)
 *   space    jump (tiny vertical hop, kept low so terrain follows clean)
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
 */

import * as THREE from "three";
import { sanctuaryBodyY, sanctuaryGroundY } from "./SanctuaryGround.js";
import { SanctuaryClickToMoveModule } from "./SanctuaryClickToMove.js";

const MOVE_SPEED_MPS = 5.0;
const STRAFE_SPEED_MPS = 4.0;
const TURN_RATE_RAD_PER_S = 2.4;
const JUMP_VEL_MPS = 4.5;
const GRAVITY_MPS2 = 14;
const CAMERA_BACK = 5.0;
const CAMERA_UP = 2.6;
const CAMERA_LOOK_FWD = 4.0;

export const SanctuaryKeyboardLookModule = {
  name: "SanctuaryKeyboardLook",

  _scene: null,
  _camera: null,
  _yaw: Math.PI,         // facing -Z by default; player looks INTO the pool
  _bodyVy: 0,
  _grounded: true,
  _keys: {},
  _onKeyDown: null,
  _onKeyUp: null,
  _cameraSmooth: null,
  _lookSmooth: null,

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
      "%c[Sanctuary] ⌨  Keyboard look online — WASD + arrows. Q/E or arrows turn. Space jumps.",
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

    // Turn (yaw)
    if (k["q"] || k["arrowleft"])  this._yaw += TURN_RATE_RAD_PER_S * delta;
    if (k["e"] || k["arrowright"]) this._yaw -= TURN_RATE_RAD_PER_S * delta;

    // Mobile Virtual Joystick Yaw Deflection (turn left/right)
    if (typeof window !== "undefined" && window.__sanctuaryJoystickInput) {
      const j = window.__sanctuaryJoystickInput;
      if (Math.abs(j.x) > 0.05) {
        if (typeof window._v4CancelClickToMove === "function") window._v4CancelClickToMove();
        this._yaw -= j.x * TURN_RATE_RAD_PER_S * delta;
      }
    }

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
    if (k["a"])                   { mvX -= rightX * (STRAFE_SPEED_MPS / MOVE_SPEED_MPS);
                                    mvZ -= rightZ * (STRAFE_SPEED_MPS / MOVE_SPEED_MPS); }
    if (k["d"])                   { mvX += rightX * (STRAFE_SPEED_MPS / MOVE_SPEED_MPS);
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

    const mvLen = Math.hypot(mvX, mvZ);
    if (mvLen > 0) {
      const nx = mvX / mvLen;
      const nz = mvZ / mvLen;
      body.position.x += nx * MOVE_SPEED_MPS * delta;
      body.position.z += nz * MOVE_SPEED_MPS * delta;
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
      body.position.y += this._bodyVy * delta;
      if (body.position.y <= groundY) {
        body.position.y = groundY;
        this._bodyVy = 0;
        this._grounded = true;
      }
    } else {
      body.position.y = groundY;
    }

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
      let camX, camY, camZ, lookX, lookY, lookZ, cLerp;
      if (movingFwd) {
        camX = body.position.x + fwdX * FWD_ZOOM_M;
        camZ = body.position.z + fwdZ * FWD_ZOOM_M;
        camY = body.position.y + EYE_HEIGHT_M;
        lookX = body.position.x + fwdX * (FWD_ZOOM_M + CAMERA_LOOK_FWD);
        lookZ = body.position.z + fwdZ * (FWD_ZOOM_M + CAMERA_LOOK_FWD);
        lookY = body.position.y + EYE_HEIGHT_M - 0.10;
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
        lookY = body.position.y + 1.4;
        // Slower lerp so the camera lazily catches up to yaw changes —
        // the player's head turns first, the camera drifts to match.
        cLerp = 1 - Math.pow(0.18, delta);
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

  unload() {
    if (this._onKeyDown) window.removeEventListener("keydown", this._onKeyDown);
    if (this._onKeyUp) window.removeEventListener("keyup", this._onKeyUp);
    this._onKeyDown = null;
    this._onKeyUp = null;
    this._scene = null;
    this._camera = null;
  },
};
