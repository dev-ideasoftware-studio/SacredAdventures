/**
 * Sacred Adventures — SanctuaryCompassion: the Compassionate UI controller.
 *
 * Mark 2026-10-22 (the culling guide: fix prompt Part E, "Compassionate UI"):
 *   "check the user's fps, and if lower than 60 fps we try to cull the landscape
 *    the most: make billboards of the trees and forest and background scenery in
 *    the distance." The floor is 60 fps, always.
 * Mark's ladder (2026-10-22, replaces guide E1.7): "when FPS is bad - remove
 * grass, start removing # of trees at distance - use more billboards for distant
 * objects until 60fps is achieved. do not throttle." No resolution drop.
 * Village View (top-down), Mark 2026-10-22: stop all animation for trees, leaves
 * and grass; don't render the fish in the pond; the minimap may update more
 * slowly (Orchestrator TOPDOWN_PIP_EVERY_N_FRAMES).
 *
 * This is the ONE controller (guide E1.3): the view-mode policy and the FPS
 * ladder live here; the world modules only expose small switches
 * (SanctuaryPondTrees.setWindPaused, SanctuaryGrass.setWindPaused/setDetail, ...).
 *
 * How the ladder reacts (guide E1.2: in time, not frames):
 *   - Sensor: the real frame interval (update's dt, which includes GPU time and
 *     vsync waits). It uses the MEDIAN frame of the last 250 ms, so a single
 *     load/compile hitch can't trigger culling (guide E1.8: stutters are separate).
 *   - Down: median below DOWN_FPS over a full 250 ms window -> shed one rung,
 *     then let the frame time settle for SETTLE_MS before judging again.
 *   - Up: UP_HOLD_MS of frames at UP_FPS or better -> restore one rung. If that
 *     drops the fps again within BOUNCE_MS, the next wait doubles (up to
 *     UP_HOLD_MAX_MS), so detail never flickers on and off.
 *   - The first WARMUP_MS of frames after load only watch (compiles and uploads
 *     are not a rendering-capacity signal).
 *   - Rungs only cull content. Nothing here throttles frame rate or resolution.
 *
 * Kill switch: ?compassion=0 (or window.__sanctuaryCompassionOff = true before boot).
 * Runtime:     window.__sanctuaryCompassion.state() · .log() · .setLevel(n) · .hold(bool)
 */

import { SanctuaryPondTreesModule } from "./SanctuaryPondTrees.js";
import { SanctuaryGrassModule } from "./SanctuaryGrass.js";

/** Objects that are "the fish in the pond" (hidden in Village View). */
const FISH_OBJECTS = ["sanctuary_fish_school", "sanctuary_fish_jumps", "sanctuary_fishing_spot_fish"];

/** The ladder, lightest cut first (Mark's order: grass, then distant trees). */
const RUNGS = [
  { name: "full detail", grass: 2 },
  { name: "grass: far ring off", grass: 1 },
  { name: "grass: off", grass: 0 },
];

const DOWN_FPS = 57;          // median below this, sustained -> shed a rung
const UP_FPS = 59;            // median at/above this, sustained -> restore a rung
const WINDOW_MS = 250;        // guide E1.2: react within a quarter second
const SETTLE_MS = 500;        // after any step, let the new frame time show up
const UP_HOLD_MS = 3000;      // guide E1.2: 3 s of good frames before stepping up
const UP_HOLD_MAX_MS = 30000;
const BOUNCE_MS = 2000;       // a step-down this soon after a step-up = a bounce
const IGNORE_DT_MS = 250;     // tab switch / long hitch: not a rendering signal
const WARMUP_MS = 5000;       // after load, shaders compile and textures upload: watch, don't act
const VIEW_SETTLE_MS = 1500;  // a Village View switch re-frames the whole scene: judge the new view only
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
  // ladder state
  _level: 0,
  _frames: [],          // recent frame intervals, ms
  _sinceStepMs: 0,
  _goodMs: 0,
  _upHoldMs: UP_HOLD_MS,
  _lastUpAt: -1e9,
  _clockMs: 0,
  _quietUntilMs: 0,     // after a view switch: watch, don't act
  _held: false,         // tests: freeze the ladder at its current rung

  load(scene) {
    this._scene = scene;
    this._enabled = !disabledByUser();
    this._topDown = null;
    this._savedVisibility = new Map();
    this._log = [];
    this._level = 0;
    this._frames = [];
    this._sinceStepMs = 0;
    this._goodMs = 0;
    this._upHoldMs = UP_HOLD_MS;
    this._lastUpAt = -1e9;
    this._clockMs = 0;
    this._quietUntilMs = 0;
    this._held = false;
    const self = this;
    window.__sanctuaryCompassion = {
      state: () => self._state(),
      log: () => self._log.slice(),
      setLevel: (n) => self._setLevel(n, "manual"),
      hold: (on) => { self._held = !!on; return self._held; },
    };
    console.log(
      `%c[SanctuaryCompassion] ${this._enabled ? "on" : "off (?compassion=0)"}: ladder ${RUNGS.map((r) => r.name).join(" → ")}; Village View pauses wind and hides pond fish.`,
      "color:#ce93d8;font-weight:bold;",
    );
  },

  update(dt) {
    if (!this._enabled) return;
    const td = isTopDown();
    if (td !== this._topDown) {
      const boot = this._topDown === null;
      this._topDown = td;
      if (!boot || td) this._applyViewMode(td);
      if (!boot) {
        // The other view has a different frame cost; judge it on its own frames.
        this._frames.length = 0;
        this._goodMs = 0;
        this._quietUntilMs = this._clockMs + VIEW_SETTLE_MS;
      }
    }
    this._tickLadder((dt || 0) * 1000);
  },

  // ── FPS ladder ──────────────────────────────────────────────────────────
  _tickLadder(dtMs) {
    if (!(dtMs > 0) || dtMs >= IGNORE_DT_MS || (typeof document !== "undefined" && document.hidden)) return;
    this._clockMs += dtMs;
    this._sinceStepMs += dtMs;
    const f = this._frames;
    f.push(dtMs);
    let sum = 0;
    for (let i = f.length - 1; i >= 0; i--) {
      sum += f[i];
      if (sum >= WINDOW_MS) { if (i > 0) f.splice(0, i); break; }
    }
    if (sum < WINDOW_MS || this._held || this._clockMs < WARMUP_MS || this._clockMs < this._quietUntilMs) return;
    const sorted = f.slice().sort((a, b) => a - b);
    const medianFps = 1000 / sorted[sorted.length >> 1];
    this._medianFps = medianFps;
    if (this._sinceStepMs < SETTLE_MS) return;

    if (medianFps < DOWN_FPS) {
      this._goodMs = 0;
      if (this._level < RUNGS.length - 1) {
        if (this._clockMs - this._lastUpAt < BOUNCE_MS) {
          this._upHoldMs = Math.min(UP_HOLD_MAX_MS, this._upHoldMs * 2);
        }
        this._setLevel(this._level + 1, `${medianFps.toFixed(1)} fps`);
      }
    } else if (medianFps >= UP_FPS) {
      this._goodMs += dtMs;
      if (this._level > 0 && this._goodMs >= this._upHoldMs) {
        this._lastUpAt = this._clockMs;
        this._setLevel(this._level - 1, `${(this._goodMs / 1000).toFixed(1)} s at ${medianFps.toFixed(1)} fps`);
      } else if (this._level === 0 && this._goodMs >= 10000) {
        this._upHoldMs = UP_HOLD_MS;     // steady at full detail: forget old bounces
      }
    } else {
      this._goodMs = 0;
    }
  },

  _setLevel(level, why) {
    const n = Math.max(0, Math.min(RUNGS.length - 1, level | 0));
    const prev = this._level;
    this._level = n;
    this._sinceStepMs = 0;
    this._goodMs = 0;
    const r = RUNGS[n];
    try { SanctuaryGrassModule.setDetail?.(r.grass); } catch (_) { /* module absent */ }
    if (n !== prev) this._note(`${n > prev ? "▼" : "▲"} rung ${n} "${r.name}" (${why})${n < prev ? "" : `; next step-up waits ${(this._upHoldMs / 1000).toFixed(0)} s`}`);
    return n;
  },

  // ── Village View ────────────────────────────────────────────────────────
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
      level: this._level,
      rung: RUNGS[this._level].name,
      rungs: RUNGS.map((r) => r.name),
      medianFps: this._medianFps ? +this._medianFps.toFixed(1) : null,
      nextStepUpWaitsS: +(this._upHoldMs / 1000).toFixed(1),
      held: this._held,
      villageView: this._topDown === true,
      windPaused: SanctuaryPondTreesModule._windPaused === true,
      grassWindPaused: SanctuaryGrassModule._windPaused === true,
      grassDetail: SanctuaryGrassModule._detail ?? 2,
      fishHidden: [...this._savedVisibility.keys()],
    };
  },

  unload() {
    if (this._topDown) this._applyViewMode(false);
    if (this._level !== 0) this._setLevel(0, "unload");
    this._scene = null;
    this._topDown = null;
    if (window.__sanctuaryCompassion) delete window.__sanctuaryCompassion;
  },
};
