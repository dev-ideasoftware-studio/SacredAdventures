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

// Refresh-AWARE thresholds. The old fixed 13.2 ms ("~76 FPS") wall meant a
// 60 Hz panel at 57-60 fps was PERPETUALLY "stressed" and kept shedding the
// PiP — that was the throttling feel. Now the thresholds scale to the ACTUAL
// display refresh probed by AnuAdaptiveDpr: stress ~40% over the frame budget
// (≈43 fps on 60 Hz), relax ~10% over (≈55 fps). High-refresh panels stay
// responsive; 60 Hz panels get full headroom at their vsync ceiling.
const STRESS_FRAMES_NEED = 40;
const RELAX_FRAMES_NEED = 90;
const _FALLBACK_TARGET_MS = 1000 / 60;

let _stressStreak = 0;
let _relaxStreak = 0;
let _lastStressMs = _FALLBACK_TARGET_MS * 1.4;
let _lastRelaxMs = _FALLBACK_TARGET_MS * 1.1;

function _refreshTargetMs() {
  let targetMs = _FALLBACK_TARGET_MS;
  if (typeof window !== "undefined" && window.AnuUniverse?.adaptiveDpr) {
    try {
      const snap = window.AnuUniverse.adaptiveDpr.snapshot();
      if (snap && snap.targetMs > 0) targetMs = snap.targetMs;
    } catch (_) { /* defensive */ }
  }
  return targetMs;
}

export function tickAdaptiveRenderPolicy(frameMs) {
  const base = V2_PIP_RENDER_EVERY_N_FRAMES;
  if (base <= 0) return;

  const targetMs = _refreshTargetMs();
  _lastStressMs = targetMs * 1.4;
  _lastRelaxMs = targetMs * 1.1;

  const cur = getEffectivePipStride();

  if (frameMs > _lastStressMs) {
    _stressStreak++;
    _relaxStreak = 0;
    if (_stressStreak >= STRESS_FRAMES_NEED) {
      _stressStreak = 0;
      if (cur < V2_ADAPTIVE_PIP_MAX_STRIDE) {
        setAdaptivePipStrideTarget(cur + 1);
      }
    }
  } else if (frameMs < _lastRelaxMs) {
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
    stressThresholdMs: _lastStressMs,
    relaxThresholdMs: _lastRelaxMs,
  });
}
