/**
 * Sacred Adventures — sanctuary part 35 of N: WORLDPLAYER SHIM.
 *
 * Bridges the v2 orchestrator's PIP pipeline (which expects a
 * `WorldPlayer` runtime service with `{ feet, yaw, mainCanvasMapView }`)
 * to v4's `SanctuaryAvatar` (which exposes `window.__sanctuaryAvatar`
 * + `window.__sanctuaryPlayerYaw`).
 *
 * **Why this is needed:** the orchestrator's `_renderPip()` bails out
 * if `getRuntimeService("WorldPlayer")` returns nothing — that was the
 * direct cause of "PIP is broken" in v4. v4 doesn't load WorldPlayer
 * (that's a v2-world-specific module with terrain colliders, autowalk,
 * etc.); we just need the three shape fields PIP reads.
 *
 * The shim registers itself BOTH on `RuntimeServices` (preferred) and
 * `window.WorldPlayer` (fallback in `_renderPip`). It updates `feet +
 * yaw` from the sanctuary avatar each frame; `mainCanvasMapView` is
 * always false (we never swap the main canvas to the map view in v4).
 */

import * as THREE from "three";
import { registerRuntimeService } from "../v2/RuntimeServices.js";

export const SanctuaryWorldPlayerShimModule = {
  name: "SanctuaryWorldPlayerShim",

  _shim: null,
  _feet: null,

  async load() {
    this._feet = new THREE.Vector3();
    const self = this;
    this._shim = {
      get feet() { return self._feet; },
      get yaw() {
        return (typeof window !== "undefined" && Number.isFinite(window.__sanctuaryPlayerYaw))
          ? window.__sanctuaryPlayerYaw
          : 0;
      },
      mainCanvasMapView: false,
    };

    try {
      registerRuntimeService("WorldPlayer", this._shim);
    } catch (_) {
      // RuntimeServices may already have a slot for it — fall back to
      // the window-global path the orchestrator also checks.
    }
    if (typeof window !== "undefined") {
      window.WorldPlayer = this._shim;
      window.WorldPhysics = {
        gravityEnabled: true,
        elevationPhysicsEnabled: true,
        getAnuPhysicsSnapshot() {
          return {
            gravityEnabled: true,
            elevationPhysicsEnabled: true,
            v4Shim: true
          };
        }
      };
    }

    console.log(
      "%c[Sanctuary] 🪞 WorldPlayer shim online — PIP can now find the avatar.",
      "color:#a5d6a7;font-weight:bold;",
    );
  },

  update() {
    const av = (typeof window !== "undefined") ? window.__sanctuaryAvatar : null;
    if (av?.position) {
      this._feet.set(av.position.x, av.position.y, av.position.z);
    }
  },

  unload() {
    if (typeof window !== "undefined") {
      if (window.WorldPlayer === this._shim) delete window.WorldPlayer;
      if (window.WorldPhysics) delete window.WorldPhysics;
    }
    this._shim = null;
    this._feet = null;
  },
};
