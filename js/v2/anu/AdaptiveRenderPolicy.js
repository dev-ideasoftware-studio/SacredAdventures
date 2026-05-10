/**
 * Stress / relax hysteresis over PiP cadence — Phase 1 sentient-runtime loop.
 *
 * Raises stride (fewer PiP 3D draws per second) when frames run hot;
 * eases back toward constants.js baseline when stable.
 */

import {
  V2_PIP_RENDER_EVERY_N_FRAMES,
  V2_ADAPTIVE_PIP_MAX_STRIDE,
} from "../constants.js";
import {
  getEffectivePipStride,
  setAdaptivePipStrideTarget,
} from "./RenderingGovernor.js";

/** ~76 FPS wall — begin accumulating stress */
const STRESS_MS = 13.2;
/** ~105 FPS wall — begin accumulating relax */
const RELAX_MS = 9.5;
const STRESS_FRAMES_NEED = 40;
const RELAX_FRAMES_NEED = 90;

let _stressStreak = 0;
let _relaxStreak = 0;

export function tickAdaptiveRenderPolicy(frameMs) {
  const base = V2_PIP_RENDER_EVERY_N_FRAMES;
  if (base <= 0) return;

  const cur = getEffectivePipStride();

  if (frameMs > STRESS_MS) {
    _stressStreak++;
    _relaxStreak = 0;
    if (_stressStreak >= STRESS_FRAMES_NEED) {
      _stressStreak = 0;
      if (cur < V2_ADAPTIVE_PIP_MAX_STRIDE) {
        setAdaptivePipStrideTarget(cur + 1);
      }
    }
  } else if (frameMs < RELAX_MS) {
    _relaxStreak++;
    _stressStreak = 0;
    if (_relaxStreak >= RELAX_FRAMES_NEED) {
      _relaxStreak = 0;
      if (cur > base) {
        setAdaptivePipStrideTarget(cur - 1);
      }
    }
  } else {
    _stressStreak = Math.max(0, _stressStreak - 1);
    _relaxStreak = Math.max(0, _relaxStreak - 1);
  }
}

export function getAdaptivePolicyDebug() {
  return Object.freeze({
    stressStreak: _stressStreak,
    relaxStreak: _relaxStreak,
    effectiveStride: getEffectivePipStride(),
    baselineStride: V2_PIP_RENDER_EVERY_N_FRAMES,
    stressThresholdMs: STRESS_MS,
    relaxThresholdMs: RELAX_MS,
  });
}
