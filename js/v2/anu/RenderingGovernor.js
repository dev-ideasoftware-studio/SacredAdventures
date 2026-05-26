/**
 * Anu — rendering policy (single source of truth for multi-pass WebGL).
 * Imported by Orchestrator before AnuModule loads so PiP decisions never drift.
 */

import {
  V2_PIP_RENDER_EVERY_N_FRAMES,
  V2_ADAPTIVE_PIP_MAX_STRIDE,
} from "../constants.js";

let _pipPhase = 0;
/** When non-null, PiP runs every N frames (N ≥ baseline); used by adaptive policy under load. */
let _pipStrideAdaptive = null;

/** Reset throttle counter (e.g. after resize / module reload). */
export function resetPipRenderPhase() {
  _pipPhase = 0;
}

/**
 * Baseline from constants, optionally uplifted by adaptive policy (capped).
 */
export function getEffectivePipStride() {
  const base = V2_PIP_RENDER_EVERY_N_FRAMES;
  if (base <= 0) return 0;
  const eff = _pipStrideAdaptive !== null ? _pipStrideAdaptive : base;
  return Math.min(Math.max(eff, base), V2_ADAPTIVE_PIP_MAX_STRIDE);
}

/**
 * @param {number} n Absolute stride (will be clamped to [baseline, MAX]).
 */
export function setAdaptivePipStrideTarget(n) {
  const base = V2_PIP_RENDER_EVERY_N_FRAMES;
  if (base <= 0) return;
  const clamped = Math.max(
    base,
    Math.min(Math.floor(Number(n)) || base, V2_ADAPTIVE_PIP_MAX_STRIDE),
  );
  const prev = getEffectivePipStride();
  if (clamped !== prev) resetPipRenderPhase();
  _pipStrideAdaptive = clamped <= base ? null : clamped;
}

export function getAdaptivePipStrideRaw() {
  return _pipStrideAdaptive;
}

/**
 * Whether the orthographic PiP pass should run **this** frame.
 */
export function shouldRenderPipSceneThisFrame() {
  const n = getEffectivePipStride();
  if (n <= 0) return false;
  _pipPhase++;
  return _pipPhase % n === 0;
}

/**
 * Immutable blueprint — Orchestrator construction matches these values
 * field-for-field at js/v2/Orchestrator.js:81-106. May-17 2026 sync
 * after the forensic surfaced a drift (blueprint claimed AA off / DPR
 * cap 1 / no shadows; live renderer ran AA on / DPR cap 2 / soft
 * shadows). Update BOTH sides together if the orchestrator's renderer
 * args change — Anu reads from here as the canonical source of truth.
 */
export const MAIN_RENDERER_BLUEPRINT = Object.freeze({
  antialias: false,          // MSAA off — DPR upscaling handles edge smoothing
  powerPreference: "high-performance",
  pixelRatioCap: 1.5,        // cap at 1.5; AnuAdaptiveDpr steps down from here
  shadowMapEnabled: true,
  shadowMapType: "PCFShadowMap", // PCF (not Soft) — half the shadow shader cost
  toneMapping: "ACESFilmicToneMapping",
  toneMappingExposure: 1.1,
});

export function getRenderingSnapshot() {
  return Object.freeze({
    pipBaseline: V2_PIP_RENDER_EVERY_N_FRAMES,
    pipEffectiveStride: getEffectivePipStride(),
    pipAdaptiveRaw: _pipStrideAdaptive,
    pipPhase: _pipPhase,
    mainRenderer: { ...MAIN_RENDERER_BLUEPRINT },
  });
}
