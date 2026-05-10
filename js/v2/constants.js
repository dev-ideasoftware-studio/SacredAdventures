/**
 * Shared world tuning — matches terrain hex shader (World.js neu hex).
 * Flat-to-flat hex span ≈ sqrt(3) × circumradius.
 */
export const V2_HEX_CIRCUMRADIUS = 6.27;
export const V2_HEX_FLAT_WIDTH = V2_HEX_CIRCUMRADIUS * Math.sqrt(3);

/** One “tile” for chase-cam distance (matches design language). */
export const V2_TILE_WORLD = V2_HEX_FLAT_WIDTH;

/** Top-down PIP should frame this many hex widths across the view (horizontal span). */
export const V2_PIP_HEX_SPAN = 3;

/** Orthographic world span for PiP = 3 × flat hex width. */
export const V2_PIP_ORTHO_WIDTH =
  V2_PIP_HEX_SPAN * V2_HEX_FLAT_WIDTH;

/**
 * PiP “zoom”: multiply ortho horizontal span by this factor.
 * 1.2 = zoom out 20% (20% wider view → more terrain visible).
 */
export const V2_PIP_ORTHO_ZOOM = 1.2;

/**
 * Minimap (#pipCanvas): Orchestrator runs a **second** `WebGLRenderer` that draws
 * the **same** Scene (terrain + haze + ring + instanced trees) with an orthographic
 * camera — same triangle workload as the main pass (resolution differs; vertex cost does not).
 *
 * - `0` = skip PiP 3D entirely (minimap stays stale/blank — use for FPS isolation).
 * - `1` = every frame (highest quality / highest GPU cost).
 * - `2` = half rate (typical sweet spot).
 */
export const V2_PIP_RENDER_EVERY_N_FRAMES = 2;

/** Target frame rate for budgeting / UX copy (physics step is still rAF-driven). */
export const V2_TARGET_FPS = 120;

/** Nominal ms budget at V2_TARGET_FPS — used by FrameBudget / Anu reporting. */
export const V2_FRAME_MS_BUDGET = 1000 / V2_TARGET_FPS;

/** Adaptive PiP: upper bound on “every N frames” stride under stress (≥ baseline). */
export const V2_ADAPTIVE_PIP_MAX_STRIDE = 8;
