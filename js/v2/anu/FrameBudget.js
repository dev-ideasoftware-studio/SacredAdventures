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

const _budgetSnapshot = {
  lastMs: 0,
  avgMs: 0,
  loadPct: 0,
  budgetMs: 0,
  samples: 0
};

export function getFrameBudgetSnapshot() {
  const avgMs = getRollingAvgFrameMs();
  const loadPct =
    V2_FRAME_MS_BUDGET > 0
      ? ((avgMs > 0 ? avgMs : _lastMs) / V2_FRAME_MS_BUDGET) * 100
      : 0;
  _budgetSnapshot.lastMs = _lastMs;
  _budgetSnapshot.avgMs = avgMs;
  _budgetSnapshot.loadPct = loadPct;
  _budgetSnapshot.budgetMs = V2_FRAME_MS_BUDGET;
  _budgetSnapshot.samples = _samples.length;
  return _budgetSnapshot;
}

export const STRESS_LEVELS = {
  OPTIMAL: 1,  // Stride 1
  STRESS: 2,   // Stride 2
  CRITICAL: 3, // Bypass entirely
};

export function getSystemStressLevel() {
  const avg = getRollingAvgFrameMs();
  if (avg <= 0) return STRESS_LEVELS.OPTIMAL; // seed frame

  // Dynamically obtain targetMs from the adaptive DPR monitor (probed screen Hz)
  let targetMs = 1000 / 60; // 16.67ms baseline default (60 Hz target)
  if (typeof window !== "undefined" && window.AnuUniverse?.adaptiveDpr) {
    try {
      const snap = window.AnuUniverse.adaptiveDpr.snapshot();
      if (snap && snap.targetMs > 0) {
        targetMs = snap.targetMs;
      }
    } catch (_) {
      /* defensive */
    }
  }

  // Calculate thresholds relative to the actual target MS (dynamic vsync headroom)
  const stressThreshold = targetMs;
  const criticalThreshold = targetMs * 1.5;

  if (avg <= stressThreshold) return STRESS_LEVELS.OPTIMAL;
  if (avg <= criticalThreshold) return STRESS_LEVELS.STRESS;
  return STRESS_LEVELS.CRITICAL;
}

if (typeof window !== "undefined") {
  if (!window.AnuUniverse) window.AnuUniverse = {};
  window.AnuUniverse.STRESS_LEVELS = STRESS_LEVELS;
  window.AnuUniverse.getSystemStressLevel = getSystemStressLevel;
}

