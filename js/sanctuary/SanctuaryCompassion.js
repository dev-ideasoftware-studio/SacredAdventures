/**
 * Sacred Adventures — SanctuaryCompassion: the Compassionate UI controller.
 *
 * Mark 2026-10-22 (the culling guide: fix prompt Part E, "Compassionate UI"):
 *   "check the user's fps, and if lower than 60 fps we try to cull the landscape
 *    the most: make billboards of the trees and forest and background scenery in
 *    the distance." The floor is 60 fps, always.
 * Mark's ladder (2026-10-22, replaces guide E1.7): when FPS is bad, remove grass,
 * then fewer 3D trees at distance / more billboards, until 60 fps. Do NOT
 * throttle (no resolution drop).
 * Village View (top-down), Mark 2026-10-22: stop all animation for trees, leaves
 * and grass; don't render the fish in the pond; the minimap may update more
 * slowly (Orchestrator TOPDOWN_PIP_EVERY_N_FRAMES).
 *
 * This is the ONE controller (guide E1.3): view-mode policy and the FPS ladder
 * live here, and the world modules only expose small switches
 * (SanctuaryPondTrees.setWindPaused, SanctuaryGrass.setWindPaused, ...).
 *
 * Step 1 (this file's first commit): the Village View policy.
 *
 * Kill switch: ?compassion=0 (or window.__sanctuaryCompassionOff = true before boot).
 * Runtime:     window.__sanctuaryCompassion.state() · .log()
 */

import { SanctuaryPondTreesModule } from "./SanctuaryPondTrees.js";
import { SanctuaryGrassModule } from "./SanctuaryGrass.js";

/** Objects that are "the fish in the pond" (hidden in Village View). */
const FISH_OBJECTS = ["sanctuary_fish_school", "sanctuary_fish_jumps", "sanctuary_fishing_spot_fish"];
const LOG_MAX = 60;

function isTopDown() {
  return typeof document !== "undefined" && document.body.classList.contains("v4-top-down-view");
}

function disabledByUser() {
  try {
    if (window.__sanctuaryCompassionOff === true) return true;
    const q = new URLSearchParams(window.location.search);
    return q.get("compassion") === "0" || q.get("compassion") === "off";
  } catch (_) {
    return false;
  }
}

export const SanctuaryCompassionModule = {
  name: "SanctuaryCompassion",

  _scene: null,
  _enabled: true,
  _topDown: null,
  _savedVisibility: null,
  _log: [],

  load(scene) {
    this._scene = scene;
    this._enabled = !disabledByUser();
    this._topDown = null;
    this._savedVisibility = new Map();
    this._log = [];
    const self = this;
    window.__sanctuaryCompassion = {
      state: () => self._state(),
      log: () => self._log.slice(),
    };
    console.log(
      `%c[SanctuaryCompassion] ${this._enabled ? "on" : "off (?compassion=0)"}: Village View pauses wind and hides pond fish.`,
      "color:#ce93d8;font-weight:bold;",
    );
  },

  update() {
    if (!this._enabled) return;
    const td = isTopDown();
    if (td !== this._topDown) {
      this._topDown = td;
      this._applyViewMode(td);
    }
  },

  /** Village View on: freeze tree/leaf/grass animation and hide the pond fish.
   *  Off: restore exactly what was there before. */
  _applyViewMode(topDown) {
    try { SanctuaryPondTreesModule.setWindPaused?.(topDown); } catch (_) { /* module absent */ }
    try { SanctuaryGrassModule.setWindPaused?.(topDown); } catch (_) { /* module absent */ }
    const hidden = [];
    for (const name of FISH_OBJECTS) {
      const obj = this._scene?.getObjectByName(name);
      if (!obj) continue;
      if (topDown) {
        this._savedVisibility.set(name, obj.visible);
        obj.visible = false;
        hidden.push(name);
      } else if (this._savedVisibility.has(name)) {
        obj.visible = this._savedVisibility.get(name);
        this._savedVisibility.delete(name);
      }
    }
    this._note(topDown
      ? `village view: wind paused, fish hidden (${hidden.length})`
      : "chase view: wind on, fish restored");
  },

  _note(msg) {
    this._log.push({ t: Math.round(performance.now()), msg });
    if (this._log.length > LOG_MAX) this._log.shift();
    console.log(`%c[SanctuaryCompassion] ${msg}`, "color:#ce93d8;");
  },

  _state() {
    return {
      enabled: this._enabled,
      villageView: this._topDown === true,
      windPaused: SanctuaryPondTreesModule._windPaused === true,
      grassWindPaused: SanctuaryGrassModule._windPaused === true,
      fishHidden: [...this._savedVisibility.keys()],
    };
  },

  unload() {
    if (this._topDown) this._applyViewMode(false);
    this._scene = null;
    this._topDown = null;
    if (window.__sanctuaryCompassion) delete window.__sanctuaryCompassion;
  },
};
