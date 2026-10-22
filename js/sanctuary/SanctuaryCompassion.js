/**
 * Sacred Adventures — SanctuaryCompassion: the Compassionate UI controller.
 *
 * Mark 2026-10-22 (the culling guide: fix prompt Part E, "Compassionate UI"):
 *   "check the user's fps, and if lower than 60 fps we try to cull the landscape
 *    the most: make billboards of the trees and forest and background scenery in
 *    the distance." The floor is 60 fps, always.
 * Mark's ladder (2026-10-22, replaces guide E1.7): "when FPS is bad - remove
 * grass, start removing # of trees at distance - use more billboards for distant
 * objects until 60fps is achieved. do not throttle." No resolution drop in
 * normal operation. The one exception, Mark 2026-10-22: "if severe 20FPS - go
 * ahead and lets start dropping resolution every 10 seconds to find what
 * resolution can get them to 60fps. that is fine. but start high".
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
 *   - Rungs only cull content. Nothing here throttles the frame rate.
 *
 * Severe-only resolution search (the exception above):
 *   - Starts only when every content rung is already shed AND the median of the
 *     last second stays at or below SEVERE_FPS for SEVERE_CONFIRM_MS.
 *   - Starts high (the device cap, AnuAdaptiveDpr), steps one rung down the
 *     Anu DPR ladder, then every RES_STEP_MS while the last second is below
 *     60 fps, until it holds 60 or reaches the floor (ladder end, or a scene
 *     pin such as the fishing close-up).
 *   - Holding: after RES_PROBE_MS steady at 60 it tries one rung sharper; if
 *     that can't hold 60 within RES_PROBE_JUDGE_MS it steps straight back and
 *     the next probe waits twice as long (max RES_PROBE_MAX_MS).
 *   - Resolution comes back before content: while it is lowered, the content
 *     rungs don't step up.
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
// Severe-only resolution search
const SEVERE_FPS = 21;            // Mark: "if severe 20FPS" (21: a vsync-quantised 50 ms frame with jitter still counts)
const SEVERE_CONFIRM_MS = 3000;   // severe this long, with every content rung shed -> first resolution step
const RES_STEP_MS = 10000;        // Mark: "dropping resolution every 10 seconds"
const RES_PROBE_MS = 20000;       // lowered + steady at 60 this long -> try one rung sharper
const RES_PROBE_MAX_MS = 300000;
const RES_PROBE_JUDGE_MS = 3000;  // a probe must hold 60 over the last second at this age, or it steps back
const LONG_WINDOW_MS = 1000;      // resolution decisions read the median of the last second
const LOG_MAX = 60;

/** Push a frame interval into a time window; returns the window's median fps
 *  once the window spans windowMs, else null. */
function pushFrameMedianFps(f, dtMs, windowMs) {
  f.push(dtMs);
  let sum = 0;
  for (let i = f.length - 1; i >= 0; i--) {
    sum += f[i];
    if (sum >= windowMs) { if (i > 0) f.splice(0, i); break; }
  }
  if (sum < windowMs) return null;
  const sorted = f.slice().sort((a, b) => a - b);
  return 1000 / sorted[sorted.length >> 1];
}

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
  _frames: [],          // recent frame intervals, ms (WINDOW_MS)
  _framesLong: [],      // the last second of frame intervals (resolution decisions)
  _res: null,           // severe-only resolution search state
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
    this._framesLong = [];
    this._res = { severeMs: 0, steadyMs: 0, lastStepAt: -1e9, probeAt: null, probeFrom: 0, probeWaitMs: RES_PROBE_MS, floorNoted: false };
    this._medianFps = null;
    this._medianLongFps = null;
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
      `%c[SanctuaryCompassion] ${this._enabled ? "on" : "off (?compassion=0)"}: ladder ${RUNGS.map((r) => r.name).join(" → ")}; resolution only if severe (≤${SEVERE_FPS} fps); Village View pauses wind and hides pond fish.`,
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
        this._framesLong.length = 0;
        this._goodMs = 0;
        this._quietUntilMs = this._clockMs + VIEW_SETTLE_MS;
        const r = this._res;
        r.severeMs = 0; r.steadyMs = 0; r.probeAt = null; r.probeWaitMs = RES_PROBE_MS; r.floorNoted = false;
      }
    }
    this._tickLadder((dt || 0) * 1000);
  },

  // ── FPS ladder ──────────────────────────────────────────────────────────
  _tickLadder(dtMs) {
    if (!(dtMs > 0) || dtMs >= IGNORE_DT_MS || (typeof document !== "undefined" && document.hidden)) return;
    this._clockMs += dtMs;
    this._sinceStepMs += dtMs;
    const medianFps = pushFrameMedianFps(this._frames, dtMs, WINDOW_MS);
    const medianLongFps = pushFrameMedianFps(this._framesLong, dtMs, LONG_WINDOW_MS);
    if (medianFps === null || this._held || this._clockMs < WARMUP_MS || this._clockMs < this._quietUntilMs) return;
    this._medianFps = medianFps;
    if (medianLongFps !== null) this._medianLongFps = medianLongFps;
    const lowered = this._resolutionLowered();
    this._tickResolution(dtMs, medianFps, medianLongFps, lowered);
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
      if (lowered) {
        // Resolution comes back first (the severe search's probes); content waits.
      } else if (this._level > 0 && this._goodMs >= this._upHoldMs) {
        this._lastUpAt = this._clockMs;
        this._setLevel(this._level - 1, `${(this._goodMs / 1000).toFixed(1)} s at ${medianFps.toFixed(1)} fps`);
      } else if (this._level === 0 && this._goodMs >= 10000) {
        this._upHoldMs = UP_HOLD_MS;     // steady at full detail: forget old bounces
      }
    } else {
      this._goodMs = 0;
    }
  },

  // ── Severe-only resolution search ───────────────────────────────────────
  _dpr() {
    const a = typeof window !== "undefined" ? window.AnuUniverse?.adaptiveDpr : null;
    return a && typeof a.setIndex === "function" && typeof a.snapshot === "function" ? a : null;
  },

  _resolutionLowered() {
    const s = this._dpr()?.snapshot();
    return !!s && s.index > s.capIndex;
  },

  _tickResolution(dtMs, medianFps, medianLongFps, lowered) {
    const A = this._dpr();
    if (!A) return;
    const s = A.snapshot();
    const r = this._res;
    if (r.probeAt !== null) {
      // A probe fails fast on the 250 ms median (guide E1.2), or on the last second at RES_PROBE_JUDGE_MS.
      const age = this._clockMs - r.probeAt;
      const longBad = medianLongFps !== null && age >= RES_PROBE_JUDGE_MS && medianLongFps < UP_FPS;
      if (medianFps < DOWN_FPS || longBad) {
        r.probeAt = null;
        r.steadyMs = 0;
        r.probeWaitMs = Math.min(RES_PROBE_MAX_MS, r.probeWaitMs * 2);
        const seen = longBad ? Math.min(medianFps, medianLongFps) : medianFps;
        this._setDpr(r.probeFrom, `probe can't hold 60 (${seen.toFixed(1)} fps); next probe in ${(r.probeWaitMs / 1000).toFixed(0)} s`);
        return;
      }
      if (age < RES_PROBE_JUDGE_MS || medianLongFps === null) return;
      r.probeAt = null;
      r.probeWaitMs = RES_PROBE_MS;     // it got lighter: keep climbing at the normal pace
      this._note(`resolution ${s.actualDpr} holds ${medianLongFps.toFixed(1)} fps (probe ok)`);
    }
    if (medianLongFps === null) return;
    if (!lowered) {
      const allShed = this._level >= RUNGS.length - 1;
      r.severeMs = allShed && medianLongFps <= SEVERE_FPS ? r.severeMs + dtMs : 0;
      if (r.severeMs >= SEVERE_CONFIRM_MS) {
        r.severeMs = 0;
        if (s.index < s.floorIndex) {
          r.probeWaitMs = RES_PROBE_MS;
          this._setDpr(s.index + 1, `severe: ${medianLongFps.toFixed(1)} fps for ${SEVERE_CONFIRM_MS / 1000} s with every rung shed`);
        } else if (!r.floorNoted) {
          r.floorNoted = true;
          this._note(`severe (${medianLongFps.toFixed(1)} fps) but resolution is at its floor (${s.actualDpr})`);
        }
      }
      return;
    }
    // Lowered: keep stepping down every RES_STEP_MS until the last second holds 60; then hold and probe.
    if (medianLongFps < UP_FPS) {
      r.steadyMs = 0;
      if (this._clockMs - r.lastStepAt >= RES_STEP_MS) {
        if (s.index < s.floorIndex) {
          this._setDpr(s.index + 1, `${medianLongFps.toFixed(1)} fps ${RES_STEP_MS / 1000} s after the last step`);
        } else if (!r.floorNoted) {
          r.floorNoted = true;
          this._note(`resolution floor ${s.actualDpr} reached at ${medianLongFps.toFixed(1)} fps`);
        }
      }
    } else {
      r.steadyMs += dtMs;
      if (r.steadyMs >= r.probeWaitMs) {
        r.steadyMs = 0;
        r.probeFrom = s.index;
        r.probeAt = this._clockMs;
        this._setDpr(s.index - 1, `probe sharper after ${(r.probeWaitMs / 1000).toFixed(0)} s at 60`);
      }
    }
  },

  _setDpr(index, why) {
    const A = this._dpr();
    if (!A) return;
    const before = A.snapshot();
    A.setIndex(index, `compassion: ${why}`);
    const after = A.snapshot();
    this._res.lastStepAt = this._clockMs;
    this._res.floorNoted = false;
    this._sinceStepMs = 0;            // content rungs settle too
    this._goodMs = 0;
    this._frames.length = 0;          // judge the new resolution on its own frames
    this._framesLong.length = 0;
    if (after.index !== before.index) {
      this._note(`${after.index > before.index ? "▼" : "▲"} resolution ${before.actualDpr} → ${after.actualDpr} (${why})`);
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
      medianFps1s: this._medianLongFps ? +this._medianLongFps.toFixed(1) : null,
      resolution: this._resolutionState(),
      nextStepUpWaitsS: +(this._upHoldMs / 1000).toFixed(1),
      held: this._held,
      villageView: this._topDown === true,
      windPaused: SanctuaryPondTreesModule._windPaused === true,
      grassWindPaused: SanctuaryGrassModule._windPaused === true,
      grassDetail: SanctuaryGrassModule._detail ?? 2,
      fishHidden: [...this._savedVisibility.keys()],
    };
  },

  _resolutionState() {
    const s = this._dpr()?.snapshot();
    if (!s) return null;
    const r = this._res;
    return {
      dpr: s.actualDpr,
      index: s.index,
      capIndex: s.capIndex,
      floorIndex: s.floorIndex,
      lowered: s.index > s.capIndex,
      probing: r.probeAt !== null,
      nextProbeWaitS: +(r.probeWaitMs / 1000).toFixed(0),
      severeForS: +(r.severeMs / 1000).toFixed(1),
    };
  },

  unload() {
    if (this._topDown) this._applyViewMode(false);
    if (this._level !== 0) this._setLevel(0, "unload");
    const A = this._dpr();
    if (A) { const s = A.snapshot(); if (s.index > s.capIndex) A.setIndex(s.capIndex, "compassion: unload"); }
    this._scene = null;
    this._topDown = null;
    if (window.__sanctuaryCompassion) delete window.__sanctuaryCompassion;
  },
};
