/**
 * Wall-clock frame duration sampling for Anu / adaptive policy (main thread).
 */

import { V2_FRAME_MS_BUDGET } from "../constants.js";

/**
 * Rolling sample size: ≈ 0.67 s of frames at the V2_TARGET_FPS budget.
 * 40 samples gives the HUD equalizer a clean 32-bar render window with
 * 8 samples of "lookback" headroom that the rolling avg can use without
 * being dominated by the most recent spike.
 */
const _ROLL_LEN = 40;
const _samples = [];

let _lastMs = 0;

export function recordFrameDuration(ms) {
  _lastMs = ms;
  _samples.push(ms);
  if (_samples.length > _ROLL_LEN) _samples.shift();
}

export function getLastFrameMs() {
  return _lastMs;
}

export function getRollingAvgFrameMs() {
  if (_samples.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < _samples.length; i++) s += _samples[i];
  return s / _samples.length;
}

/**
 * Snapshot of the rolling sample ring buffer (oldest → newest). Read-only
 * copy so HUD/audit consumers cannot mutate FrameBudget state.
 */
export function getFrameSamples() {
  return _samples.slice();
}

/** Maximum number of samples kept in the rolling ring buffer. */
export function getFrameSamplesCapacity() {
  return _ROLL_LEN;
}

export function getFrameBudgetSnapshot() {
  const avgMs = getRollingAvgFrameMs();
  const loadPct =
    V2_FRAME_MS_BUDGET > 0
      ? ((avgMs > 0 ? avgMs : _lastMs) / V2_FRAME_MS_BUDGET) * 100
      : 0;
  return Object.freeze({
    lastMs: _lastMs,
    avgMs,
    loadPct,
    budgetMs: V2_FRAME_MS_BUDGET,
    samples: _samples.length,
  });
}
