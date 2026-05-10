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

/**
 * Moondial `#pipOverlay` yellow dashed minimap cue: radius as a fraction of `min(canvasW,canvasH)`
 * (`UIModule._pipOverlayRing`). `Trees` PiP ortho shader discards non-foliage fragments inside the
 * same circle (screen-space `gl_FragCoord`).
 */
export const V2_PIP_OVERLAY_BRANCH_CLIP_RADIUS_FACTOR = 0.32;

// ── Canonical mesh heights / structures (legacy EnvironmentBuilder 1:1) ────────

/** `Assets/tree.glb` template scaled so upright mesh height matches this (m). Trees.js `scaleFix`. */
export const V2_TREE_TEMPLATE_TARGET_HEIGHT_M = 11;

/**
 * Yellow butterfly tipi (`tipi.yellowbutterfly.glb`) — legacy target vertical extent (m).
 * js/EnvironmentBuilder.js → targetH = 7.2
 */
export const V2_TIPI_YELLOW_BUTTERFLY_TARGET_HEIGHT_M = 7.2;

/**
 * Sacred circle platform under center tipi — 75% of hex circumradius (legacy comment).
 * CylinderGeometry(platRadius, platRadius + 0.15, 0.22).
 */
export const V2_TIPI_SACRED_PLATFORM_RADIUS = 4.7;
export const V2_TIPI_SACRED_PLATFORM_HEIGHT = 0.22;
/** Lift cylinder center above sampled terrain Y so platform reads “raised”. */
export const V2_TIPI_SACRED_PLATFORM_CENTER_Y = 0.05;

/** `Assets/NPC.YB.glb` — seated beside / inside tipi 1 (world metres, relative to hex center). */
export const V2_NPC_YB_TIPI1_LOCAL_X_M = 0.28;
export const V2_NPC_YB_TIPI1_LOCAL_Z_M = -0.4;
/** Visual height of the rig after uniform scale (seated read). */
export const V2_NPC_YB_TIPI1_TARGET_HEIGHT_M = 1.52;
/** Fine vertical nudge after sole alignment (negative = sink slightly into seat cushion). */
export const V2_NPC_YB_TIPI1_VERTICAL_TRIM_M = -0.035;

/** Avatar figurine: when grounded, soles sit this far above analytic terrain (avoids Z-fight / sinking disc). */
export const V2_AVATAR_GROUNDED_FEET_OFFSET_M = 0.012;
/**
 * Extra downward shift of scaled Avatar3 mesh in its group (after bbox bottom align) so soles meet the
 * travel disc — positive values pull the mesh down (fix “feet floating”).
 */
export const V2_AVATAR_SOLES_GROUND_TRIM_M = 0.038;
/** Travel disc / ring / arrow sit slightly above Y=0 in avatar space so they don’t clip into grass. */
export const V2_AVATAR_TRAVEL_CIRCLE_LIFT_M = 0.042;

/** Legacy Avatar3 baseline height (m) before gameplay scaling tweaks. */
const V2_AVATAR_BASELINE_HEIGHT_M = 1.78;

/** Extra gameplay shrink vs the post-baseline scale (see V2_AVATAR_TARGET_HEIGHT_M). */
const V2_AVATAR_GAMEPLAY_SCALE = 0.75;

/**
 * Avatar3 mesh height target (m). Baseline −30%, then −25% for figurine read.
 */
export const V2_AVATAR_TARGET_HEIGHT_M =
  V2_AVATAR_BASELINE_HEIGHT_M * 0.7 * V2_AVATAR_GAMEPLAY_SCALE;

/** Ground travel circle + arrow radius — scales with avatar vs legacy 1.72 m ring. */
export const V2_AVATAR_TRAVEL_CIRCLE_RADIUS_M = 1.72 * 0.7 * V2_AVATAR_GAMEPLAY_SCALE;

/** Max horizontal speed from World steering when movement keys / autowalk are active (m/s). */
export const V2_PLAYER_MOVE_SPEED_MPS = 7.0;

/**
 * Walk loop timeScale = clamp(|v.xz| / ref, min, max). Tune `ref` so cadence matches stride at cruise speed.
 */
export const V2_AVATAR_WALK_ANIM_REF_SPEED_MPS = 3.35;
export const V2_AVATAR_WALK_ANIM_TIME_SCALE_MIN = 0.42;
export const V2_AVATAR_WALK_ANIM_TIME_SCALE_MAX = 2.4;
