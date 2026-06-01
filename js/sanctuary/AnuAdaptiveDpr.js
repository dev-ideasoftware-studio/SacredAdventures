/**
 * AnuAdaptiveDpr — Anu's omnipresent FPS guardian.
 *
 * Per the user's spec: "ANU/World/Animals = controlled by an omnipresent
 * AI that monitors everything, including current FPS. This game must
 * have threshold for 120fps at super high resolutions."
 *
 * What this does:
 *   • Watches `FrameBudget.avgMs` every N frames (Anu's own sensor).
 *   • If the rolling average drops below a target wall (default 120 FPS
 *     → 8.33 ms), Anu scales the renderer's pixel ratio DOWN one step.
 *   • If the rolling average comfortably exceeds the target with
 *     hysteresis, Anu scales DPR UP one step (capped at the user's
 *     device DPR).
 *
 * Why DPR instead of LOD-of-meshes:
 *   • The sanctuary scene is < 25 k tris — vertex throughput isn't the
 *     cost, fragment shading is. At DPR=2 on a 4K monitor that's 33 M
 *     fragments/frame; at DPR=1 it's 8 M. The slider has a huge effect.
 *   • DPR change is instant + reversible — Anu can ride it up and down
 *     in real time without disturbing the scene graph.
 *
 * Anu publishes the current state under `AnuUniverse.adaptiveDpr.snapshot()`
 * so the HUD / dev console can show what she's doing. The module also
 * records dispatches via `dispatchInteraction(ANU_EVENTS.RENDERING_DPR_CHANGE)`
 * so the InteractionBus reflects every step.
 */

import { recordFrameDuration, getFrameBudgetSnapshot } from "../v2/anu/FrameBudget.js";
import { dispatchInteraction } from "../v2/anu/InteractionBus.js";
import { ANU_EVENTS } from "../v2/anu/anuEvents.js";
import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";
import { getEffectivePipStride, setAdaptivePipStrideTarget } from "../v2/anu/RenderingGovernor.js";

/** Discrete DPR ladder Anu can step through. Order: highest → lowest. */
const DPR_LADDER = [2.0, 1.75, 1.5, 1.25, 1.0, 0.85, 0.75];

/** Aspirational FPS — the spec target. Used as a *cap* on the
 *  refresh-rate-detected target so we never chase higher than the
 *  monitor can show. */
const ASPIRATIONAL_FPS = 65;

/** Target wall — set at load() time once Anu samples the monitor's
 *  actual refresh rate. Default seed assumes 60 Hz until the rAF probe
 *  finishes. **Why this matters:** on a 60 Hz display vsync makes
 *  frames < 16.67 ms impossible regardless of GPU. Targeting 120 FPS
 *  on a 60 Hz monitor means Anu sees stress on every single frame and
 *  step-downs DPR forever — chasing a wall she can't pass. */
let TARGET_MS = 1000 / 60;
/** Headroom before stepping UP — avg ms must beat target by this margin
 *  for the relax window before Anu lifts DPR back up. */
const RELAX_HEADROOM_MS = 1.5;
/** Streak counters before Anu acts — hysteresis to prevent oscillation.
 *  Tuned for 60 FPS; gets re-scaled if the detected refresh is higher. */
let STRESS_STREAK = 45;  // ~0.75 s @ 60 FPS
let RELAX_STREAK  = 120; // ~2.0 s @ 60 FPS

let _renderer = null;
let _deviceDprCap = 2;
let _currentIndex = 0; // ladder index of the current DPR
let _stressFrames = 0;
let _relaxFrames = 0;
let _stepCount = 0;
let _lastChangeAt = 0;
let _detectedHz = 60;
/** Max ladder index Anu is allowed to descend to. Default = last rung
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
    currentDpr: DPR_LADDER[_currentIndex],
    deviceDprCap: _deviceDprCap,
    ladder: DPR_LADDER.slice(),
    targetMs: TARGET_MS,
    avgMs: budget?.avgMs ?? null,
    lastMs: budget?.lastMs ?? null,
    stressFrames: _stressFrames,
    relaxFrames: _relaxFrames,
    stepCount: _stepCount,
    lastChangeAt: _lastChangeAt,
    detectedHz: _detectedHz,
  });
}

function applyDpr(idx, reason) {
  if (!_renderer) return;
  // Respect the floor — scenes can pin a minimum DPR (e.g. fishing close-up
  // needs to stay crisp; the adaptive stepper must not descend below that).
  const clamped = Math.max(0, Math.min(_floorIndex, idx));
  if (clamped === _currentIndex) return;
  _currentIndex = clamped;
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
}

export const AnuAdaptiveDprModule = {
  name: "AnuAdaptiveDpr",

  async load(scene, camera, renderer) {
    _renderer = renderer;
    // FPS cap (user-approved 2026-06-01): clamp the max device DPR to 1.5 so
    // hi-DPI (Retina) displays never render above 1.5× — ~44% fewer pixels than
    // 2.0 for a large FPS gain at a slight sharpness cost. The adaptive ladder
    // still scales DOWN from here under load; this only caps the ceiling.
    _deviceDprCap =
      typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
        ? Math.min(window.devicePixelRatio, 1.5)
        : 1.5;
    // Start at the highest ladder rung the device supports, but never
    // higher than the orchestrator's existing cap.
    const currentDpr = renderer.getPixelRatio();
    _currentIndex = Math.max(
      0,
      DPR_LADDER.findIndex((d) => Math.abs(d - currentDpr) < 0.02),
    );
    if (_currentIndex < 0) _currentIndex = 0;

    // Probe the monitor's actual refresh rate. Target the lesser of the
    // aspirational 120 FPS spec and the monitor's vsync wall — chasing
    // beyond vsync wastes frame budget on impossible steps.
    _probeRefreshRate().then((hz) => {
      _detectedHz = hz;
      const targetHz = Math.min(ASPIRATIONAL_FPS, hz);
      TARGET_MS = 1000 / targetHz;
      STRESS_STREAK = Math.round(0.75 * targetHz);
      RELAX_STREAK = Math.round(2.0 * targetHz);
      console.log(
        `%c[AnuAdaptiveDpr] refresh-rate probe: ${hz} Hz monitor → target ${targetHz} FPS (${TARGET_MS.toFixed(2)} ms). Streaks: stress ${STRESS_STREAK} / relax ${RELAX_STREAK}.`,
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
          setIndex: (i) => applyDpr(i, "manual"),
          stepUp: () => applyDpr(_currentIndex - 1, "manual_up"),
          stepDown: () => applyDpr(_currentIndex + 1, "manual_down"),
          /** Pin a minimum DPR — adaptive stepper won't descend below this.
           *  If the current DPR is already lower, bump up to the new floor
           *  immediately so the scene looks crisp on the very next frame. */
          setMinDpr: (minDpr) => {
            _floorIndex = _minDprToFloorIndex(minDpr);
            if (_currentIndex > _floorIndex) {
              applyDpr(_floorIndex, `floor_raised(min=${minDpr})`);
            }
          },
          /** Remove the DPR floor — adaptive stepper can again descend to the
           *  ladder's lowest rung if frame budget demands it. */
          clearMinDpr: () => {
            _floorIndex = DPR_LADDER.length - 1;
          },
        });
      }
    }

    console.log(
      `%c[AnuAdaptiveDpr] online — initial target ${TARGET_MS.toFixed(2)} ms (refresh probe pending), device cap ${_deviceDprCap.toFixed(2)}, start DPR ${DPR_LADDER[_currentIndex].toFixed(2)}`,
      "color:#80deea;font-weight:bold;",
    );
  },

  update(_delta) {
    if (!_renderer) return;
    const budget = getFrameBudgetSnapshot();
    if (!budget || !Number.isFinite(budget.avgMs) || budget.samples < 30) return;

    const avg = budget.avgMs;
    // Stressed: avg slower than target → consider stepping DOWN.
    if (avg > TARGET_MS) {
      _stressFrames++;
      _relaxFrames = 0;
      if (_stressFrames >= STRESS_STREAK && _currentIndex < _floorIndex) {
        applyDpr(_currentIndex + 1, "stressed_down");
        _stressFrames = 0;

        // Closed-Loop Regulatory Feedback: throttle the PiP cadence when stressed
        const curStride = getEffectivePipStride();
        if (curStride > 0) {
          setAdaptivePipStrideTarget(curStride + 1);
        }

        // Severe stress (true wall-clock display rate choke, avg > target * 1.3)
        if (avg > TARGET_MS * 1.3) {
          // Drop the device cap down to 1.25 to prevent dynamic resolution upscaling under high pressure
          _deviceDprCap = Math.max(1.0, Math.min(_deviceDprCap, 1.25));
          if (curStride > 0) {
            setAdaptivePipStrideTarget(curStride + 2); // throttle even faster
          }
        }
      }
      return;
    }
    // Relaxed: avg comfortably under target → consider stepping UP.
    if (avg < TARGET_MS - RELAX_HEADROOM_MS) {
      _relaxFrames++;
      _stressFrames = 0;
      if (_relaxFrames >= RELAX_STREAK && _currentIndex > 0) {
        applyDpr(_currentIndex - 1, "relaxed_up");
        _relaxFrames = 0;

        // Closed-Loop Regulatory Feedback: gradually ease the PiP cadence back when stable
        const curStride = getEffectivePipStride();
        if (curStride > 0) {
          setAdaptivePipStrideTarget(curStride - 1);
        }
      }
      return;
    }
    // Goldilocks band — bleed both counters back to zero.
    _stressFrames = Math.max(0, _stressFrames - 1);
    _relaxFrames = Math.max(0, _relaxFrames - 1);
  },

  unload() {
    _renderer = null;
    if (typeof window !== "undefined" && window.AnuUniverse?.adaptiveDpr) {
      try { delete window.AnuUniverse.adaptiveDpr; } catch (_) {}
    }
  },
};
