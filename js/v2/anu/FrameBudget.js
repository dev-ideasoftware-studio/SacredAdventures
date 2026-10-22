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

// CULL-02: real frame interval (time between requestAnimationFrame calls). frameMs above
// is JavaScript time only, so a GPU-bound frame (e.g. 30 fps with 6 ms of JS) never read
// as stressed. The interval includes GPU time and vsync waits, so it sees those drops.
const _intervals = [];

export function recordFrameInterval(ms) {
  if (!(ms > 0) || !Number.isFinite(ms)) return;
  _intervals.push(ms);
  if (_intervals.length > _ROLL_LEN) _intervals.shift();
}

export function getRollingAvgIntervalMs() {
  if (_intervals.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < _intervals.length; i++) s += _intervals[i];
  return s / _intervals.length;
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
  // Whole-sensor guard: any unexpected failure falls back to OPTIMAL — the
  // safe level (full quality, no render bypass). A stress sensor must never
  // be the reason a frame fails to render.
  try {
    const avg = getRollingAvgFrameMs();
    if (!(avg > 0)) return STRESS_LEVELS.OPTIMAL; // seed frame / NaN guard

    // Dynamically obtain targetMs from the adaptive DPR monitor (probed screen Hz)
    let targetMs = V2_FRAME_MS_BUDGET; // 16.67 ms: the 60 FPS target (constants.js V2_TARGET_FPS)
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

    // Thresholds relative to the actual refresh, WITH headroom so a panel
    // sitting just under its vsync ceiling (e.g. 57-60 fps on 60 Hz) reads
    // OPTIMAL — full shadows + PiP — instead of perpetually shedding. Stress
    // only below ~48 fps (60 Hz), critical (PiP bypass) only below ~37 fps.
    const stressThreshold = targetMs * 1.25;
    const criticalThreshold = targetMs * 1.6;

    let cpuLevel = STRESS_LEVELS.CRITICAL;
    if (avg <= stressThreshold) cpuLevel = STRESS_LEVELS.OPTIMAL;
    else if (avg <= criticalThreshold) cpuLevel = STRESS_LEVELS.STRESS;

    // CULL-02: the same thresholds applied to the real frame interval. Its reference
    // never asks for more than the 60 fps target (V2_FRAME_MS_BUDGET): the refresh probe
    // times a single rAF interval at boot and can report 120 Hz on a screen that actually
    // runs at 60 (iOS Safari caps rAF at 60 by default), which would otherwise read as
    // permanent stress.
    let gpuLevel = STRESS_LEVELS.OPTIMAL;
    const interval = getRollingAvgIntervalMs();
    if (interval > 0 && _intervals.length >= _ROLL_LEN) {
      const refMs = Math.max(targetMs, V2_FRAME_MS_BUDGET);
      if (interval > refMs * 1.6) gpuLevel = STRESS_LEVELS.CRITICAL;
      else if (interval > refMs * 1.25) gpuLevel = STRESS_LEVELS.STRESS;
    }
    return Math.max(cpuLevel, gpuLevel);
  } catch (_) {
    return STRESS_LEVELS.OPTIMAL; // safe fallback
  }
}

if (typeof window !== "undefined") {
  if (!window.AnuUniverse) window.AnuUniverse = {};
  window.AnuUniverse.STRESS_LEVELS = STRESS_LEVELS;
  window.AnuUniverse.getSystemStressLevel = getSystemStressLevel;
}

