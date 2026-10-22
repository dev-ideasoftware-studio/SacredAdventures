/**
 * AnuAdaptiveDpr — Anu's resolution actuator and display sensor.
 *
 * Mark 2026-10-22 (Compassionate UI): "do not throttle" / "a - culling only -
 * but if severe 20FPS - go ahead and lets start dropping resolution every 10
 * seconds to find what resolution can get them to 60fps ... but start high,
 * we use ANU sensors". So this module no longer steps the pixel ratio on its
 * own (it used to, from CPU-only frame time, and also raised the minimap stride
 * and lowered the device cap under load). It now:
 *   • senses: the monitor refresh rate (rAF probe -> targetMs, read by
 *     FrameBudget) and the renderer's real pixel ratio;
 *   • acts only when asked: SanctuaryCompassion (the one controller, culling
 *     guide E1.3) calls setIndex() during its severe-only resolution search;
 *     fishing pins a floor with setMinDpr()/clearMinDpr().
 *
 * Every change is published as ANU_EVENTS.RENDERING_DPR_CHANGE and in
 * `AnuUniverse.adaptiveDpr.snapshot()`.
 */

import { getFrameBudgetSnapshot } from "../v2/anu/FrameBudget.js";
import { deviceProfile } from "../v2/deviceProfile.js";
import { dispatchInteraction } from "../v2/anu/InteractionBus.js";
import { ANU_EVENTS } from "../v2/anu/anuEvents.js";
import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";
import { V2_TARGET_FPS, V2_FRAME_MS_BUDGET } from "../v2/constants.js";

/** Discrete DPR ladder (highest → lowest). Rungs above the device cap render at the cap. */
const DPR_LADDER = [2.0, 1.75, 1.5, 1.25, 1.0, 0.85, 0.75];

/** The FPS target: 60 (constants.js V2_TARGET_FPS; owner 2026-10-22: "we are at
 *  60fps targets"). Used as a *cap* on the refresh-rate-detected target, so a
 *  120 Hz panel is still judged against 60 FPS, never 120. */
const TARGET_FPS = V2_TARGET_FPS;

/** Target wall: min(TARGET_FPS, probed refresh), set at load() time once the
 *  rAF probe finishes; seeded at the 60 FPS budget (16.67 ms) until then.
 *  **Why this matters:** on a 60 Hz display vsync makes frames < 16.67 ms
 *  impossible regardless of GPU. A target above the refresh rate means Anu
 *  sees stress on every single frame, chasing a wall she can't pass. */
let TARGET_MS = V2_FRAME_MS_BUDGET;

let _renderer = null;
let _deviceDprCap = 2;
let _currentIndex = 0; // ladder index of the current DPR
let _capIndex = 0;     // highest rung the device cap allows (the "start high" rung)
let _stepCount = 0;
let _lastReason = "boot";
let _lastChangeAt = 0;
let _detectedHz = 60;
/** Max ladder index the actuator may descend to. Default = last rung
 *  (no floor). Modules can raise this floor for scenes that need to stay
 *  visually crisp (e.g. fishing close-up) by calling `setMinDpr(value)`. */
let _floorIndex = 6; // DPR_LADDER.length - 1

/** Convert a desired minimum DPR to the corresponding max-index in the ladder.
 *  Returns the largest index `i` such that `DPR_LADDER[i] >= minDpr`. */
function _minDprToFloorIndex(minDpr) {
  let idx = 0;
  for (let i = 0; i < DPR_LADDER.length; i++) {
    if (DPR_LADDER[i] >= minDpr) idx = i;
  }
  return idx;
}

/** Probe monitor refresh by timing two consecutive requestAnimationFrame
 *  ticks. Rounds to the nearest common refresh rate (60/72/75/90/120/144/165/240). */
function _probeRefreshRate() {
  return new Promise((resolve) => {
    requestAnimationFrame((t0) => {
      requestAnimationFrame((t1) => {
        const dt = Math.max(1, t1 - t0);
        const measured = 1000 / dt;
        const known = [60, 72, 75, 90, 120, 144, 165, 240];
        const nearest = known.reduce(
          (a, b) => (Math.abs(b - measured) < Math.abs(a - measured) ? b : a),
        );
        resolve(nearest);
      });
    });
  });
}

/** Public snapshot exposed via `AnuUniverse.adaptiveDpr.snapshot()`. */
function snapshot() {
  const budget = getFrameBudgetSnapshot();
  return Object.freeze({
    enabled: !!_renderer,
    mode: "actuator",            // steps only when SanctuaryCompassion (or a manual call) asks
    currentDpr: DPR_LADDER[_currentIndex],
    actualDpr: _renderer ? _renderer.getPixelRatio() : null,
    index: _currentIndex,
    capIndex: _capIndex,
    floorIndex: _floorIndex,
    deviceDprCap: _deviceDprCap,
    ladder: DPR_LADDER.slice(),
    targetMs: TARGET_MS,
    avgMs: budget?.avgMs ?? null,
    lastMs: budget?.lastMs ?? null,
    stepCount: _stepCount,
    lastReason: _lastReason,
    lastChangeAt: _lastChangeAt,
    detectedHz: _detectedHz,
  });
}

function applyDpr(idx, reason) {
  if (!_renderer) return _currentIndex;
  // Never above the device cap ("start high" = the cap), never below the floor
  // a scene pinned (e.g. fishing close-up stays crisp).
  const clamped = Math.max(_capIndex, Math.min(_floorIndex, idx | 0));
  if (clamped === _currentIndex) return _currentIndex;
  _currentIndex = clamped;
  _lastReason = reason;
  const dpr = DPR_LADDER[clamped];
  _renderer.setPixelRatio(Math.min(dpr, _deviceDprCap));
  // Force a render-size refresh so the canvas backing store resizes.
  _renderer.setSize(window.innerWidth, window.innerHeight, false);
  _stepCount++;
  _lastChangeAt = typeof performance !== "undefined" ? performance.now() : 0;
  console.log(
    `%c[AnuAdaptiveDpr] ${reason}: DPR → ${dpr.toFixed(2)} (idx ${clamped}/${DPR_LADDER.length - 1})`,
    "color:#80deea;font-weight:bold;",
  );
  try {
    dispatchInteraction(ANU_EVENTS.RENDERING_DPR_CHANGE, {
      dpr,
      reason,
      stepCount: _stepCount,
      t: _lastChangeAt,
    });
  } catch (_) { /* event channel best-effort */ }
  return _currentIndex;
}

export const AnuAdaptiveDprModule = {
  name: "AnuAdaptiveDpr",

  async load(scene, camera, renderer) {
    _renderer = renderer;
    // FPS cap (user-approved 2026-06-01): clamp the max device DPR to 1.5 so
    // hi-DPI (Retina) displays never render above 1.5× — ~44% fewer pixels than
    // 2.0 for a large FPS gain at a slight sharpness cost. Only the Compassionate
    // UI's severe-only search (~20 fps) scales DOWN from here; this caps the ceiling.
    // Mobile gets a hard 1.0 ceiling: a fullscreen Retina buffer at 1.5–3× is
    // memory + fill-rate the mobile GPU process can't spare.
    // This must match the Orchestrator's mobile clamp.
    const _dprCeil = deviceProfile.dprCap; // 1.0 mobile / 1.5 desktop (js/v2/deviceProfile.js)
    _deviceDprCap =
      typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
        ? Math.min(window.devicePixelRatio, _dprCeil)
        : _dprCeil;
    // Start at the highest ladder rung the device supports, but never
    // higher than the orchestrator's existing cap.
    const currentDpr = renderer.getPixelRatio();
    _currentIndex = Math.max(
      0,
      DPR_LADDER.findIndex((d) => Math.abs(d - currentDpr) < 0.02),
    );
    if (_currentIndex < 0) _currentIndex = 0;
    // "Start high": the highest rung the device cap allows.
    _capIndex = Math.max(0, DPR_LADDER.findIndex((d) => d <= _deviceDprCap + 0.001));
    if (_currentIndex < _capIndex) _currentIndex = _capIndex;
    _floorIndex = DPR_LADDER.length - 1;
    _stepCount = 0;
    _lastReason = "boot";

    // Probe the monitor's actual refresh rate. Target the lesser of the
    // 60 FPS target and the monitor's vsync wall — chasing beyond vsync
    // wastes frame budget on impossible steps. (The probe snaps to 60 Hz or
    // above, so this is 60 FPS / 16.67 ms on every screen, 120 Hz included.)
    _probeRefreshRate().then((hz) => {
      _detectedHz = hz;
      const targetHz = Math.min(TARGET_FPS, hz);
      TARGET_MS = 1000 / targetHz;
      console.log(
        `%c[AnuAdaptiveDpr] refresh-rate probe: ${hz} Hz monitor → target ${targetHz} FPS (${TARGET_MS.toFixed(2)} ms).`,
        "color:#80deea;font-weight:bold;",
      );
    });

    // Surface ourselves on AnuUniverse so the HUD / dev console can read
    // status without importing this module.
    if (typeof window !== "undefined") {
      const Anu = window.AnuUniverse;
      if (Anu) {
        Anu.adaptiveDpr = Object.freeze({
          snapshot,
          /** Actuator: go to ladder index i (clamped to [capIndex, floorIndex]). Returns the index in force. */
          setIndex: (i, reason) => applyDpr(i, reason || "manual"),
          stepUp: () => applyDpr(_currentIndex - 1, "manual_up"),
          stepDown: () => applyDpr(_currentIndex + 1, "manual_down"),
          /** Pin a minimum DPR — the actuator won't descend below this.
           *  If the current DPR is already lower, bump up to the new floor
           *  immediately so the scene looks crisp on the very next frame. */
          setMinDpr: (minDpr) => {
            _floorIndex = _minDprToFloorIndex(minDpr);
            if (_currentIndex > _floorIndex) {
              applyDpr(_floorIndex, `floor_raised(min=${minDpr})`);
            }
          },
          /** Remove the DPR floor — the actuator can again descend to the
           *  ladder's lowest rung when the Compassionate UI asks. */
          clearMinDpr: () => {
            _floorIndex = DPR_LADDER.length - 1;
          },
        });
      }
    }

    console.log(
      `%c[AnuAdaptiveDpr] online (actuator: steps only for the Compassionate UI) — device cap ${_deviceDprCap.toFixed(2)}, start DPR ${renderer.getPixelRatio().toFixed(2)}`,
      "color:#80deea;font-weight:bold;",
    );
  },

  unload() {
    _renderer = null;
    if (typeof window !== "undefined" && window.AnuUniverse?.adaptiveDpr) {
      try { delete window.AnuUniverse.adaptiveDpr; } catch (_) {}
    }
  },
};
