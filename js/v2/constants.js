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
 * 1.2 = baseline. 0.96 ≈ +25% zoom-in (tighter ortho span) vs 1.2.
 */
export const V2_PIP_ORTHO_ZOOM = 0.96;

/**
 * Minimap (#pipCanvas): Orchestrator runs a **second** `WebGLRenderer` that draws
 * the **same** Scene (terrain + haze + ring + instanced trees) with an orthographic
 * camera — same triangle workload as the main pass (resolution differs; vertex cost does not).
 *
 * - `0` = skip PiP 3D entirely (minimap stays stale/blank — use for FPS isolation).
 * - `1` = every frame (highest quality / highest GPU cost).
 * - `2` = half rate.
 * - `3` = lighter PiP (recommended when Flora multipart forest + dual WebGL passes stress GPU).
 */
export const V2_PIP_RENDER_EVERY_N_FRAMES = 3;

/** Target frame rate for budgeting / UX copy (physics step is still rAF-driven). */
export const V2_TARGET_FPS = 120;

/** Nominal ms budget at V2_TARGET_FPS — used by FrameBudget / Anu reporting. */
export const V2_FRAME_MS_BUDGET = 1000 / V2_TARGET_FPS;

/** Adaptive PiP: upper bound on “every N frames” stride under stress (≥ baseline). */
export const V2_ADAPTIVE_PIP_MAX_STRIDE = 8;

/**
 * Moondial `#pipOverlay` yellow dashed **focus cue** only: radius = `factor * min(canvasW, canvasH)`
 * (`UIModule._pipOverlayRing`). Independent of foliage PiP discard (see glass disk factor below).
 */
export const V2_PIP_OVERLAY_BRANCH_CLIP_RADIUS_FACTOR = 0.32;

/**
 * PiP ortho fragment discard for **forest + smoke/particles**: disk radius =
 * `factor * min(canvasW, canvasH)` (same scale as overlay factor; max practical ≈ 0.5).
 * Matches the circular **glass** minimap aperture — larger than the yellow dashed cue disk.
 */
export const V2_PIP_GLASS_DISK_CLIP_RADIUS_FACTOR = 0.46;

/**
 * PiP ortho: **smoke** point-sprites use a **larger** screen-space discard disk than
 * `V2_PIP_GLASS_DISK_CLIP_RADIUS_FACTOR` so billowing tipi smoke stays off the minimap
 * even when particles drift past the foliage clip radius.
 */
export const V2_PIP_SMOKE_DISK_CLIP_RADIUS_FACTOR = 0.58;

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

/**
 * Brazier hearth — metres from hex origin on XZ; Y = sacred deck top + bowl-rim height.
 * Bowl + tripod are baked into `tipi.yellowbutterfly.glb` near hex center; XZ here just nudges
 * the flame to sit *centered in the bowl* (tunable per asset). Y must clear the bowl rim so the
 * flame reads as coming **from inside** the bowl, not as a glow on the platform deck.
 */
export const V2_TIPI_BRAZIER_WORLD_X_M = 0.04;
export const V2_TIPI_BRAZIER_WORLD_Z_M = -0.06;
/**
 * Flame/light origin above the green sacred deck (m).
 * Brazier bowl rim ≈ 0.45 m above deck (tripod legs); flame Y must reach into the bowl interior.
 */
export const V2_TIPI_BRAZIER_ABOVE_DECK_M = 0.46;
/** Local Y inside flame group (bowl cradle — small lift inside the cup). */
export const V2_TIPI_BRAZIER_FIRE_LOCAL_Y_M = 0.02;
/** Smoke emitter: metres above tipi mesh apex (hole / crown). */
export const V2_TIPI_SMOKE_ABOVE_APEX_M = 0.18;

/**
 * Small ceremonial fire in front of the seated YB host (separate from
 * the brazier hearth). Positioned 1 ft south of hex centre, 1 ft above
 * the analytic terrain, with a 6-inch nominal flame height (achieved
 * by uniformly scaling the shared campfire helper to ~30%).
 */
export const V2_TIPI_NPC_CEREMONIAL_FIRE_LOCAL_X_M = 0;
export const V2_TIPI_NPC_CEREMONIAL_FIRE_LOCAL_Z_M = 0.3048; // 1 ft south
export const V2_TIPI_NPC_CEREMONIAL_FIRE_ABOVE_GROUND_M = 0.3048; // 1 ft above terrain
/** Uniform scale on the campfire group → ~6" flame from the ~52cm baseline. */
export const V2_TIPI_NPC_CEREMONIAL_FIRE_SCALE = 0.3;

/** `Assets/NPC.YB.glb` — seated beside / inside tipi 1 (world metres, relative to hex center). */
export const V2_NPC_YB_TIPI1_LOCAL_X_M = 0.28;
/**
 * Z position of the seated host inside tipi 1. The world coordinate
 * convention used by the rest of the engine is **+Z = north** (the
 * player spawns at z = -3 * V2_TILE_WORLD, i.e. south of the village,
 * and faces +Z toward the tipis). The seat is at z ≈ -0.7 — slightly
 * south of the tipi centre, just *inside* the doorway (which now points
 * world -Z / south after the May-2026 tipi reorientation). The small
 * ceremonial fire (V2_TIPI_NPC_CEREMONIAL_FIRE_*) sits in front of her,
 * even further south. Was -0.4 prior.
 */
export const V2_NPC_YB_TIPI1_LOCAL_Z_M = -0.4 - 0.3048;
/** Nominal seated rig height **before** `V2_NPC_YB_TIPI1_SIZE_MULTIPLIER`. */
export const V2_NPC_YB_TIPI1_TARGET_HEIGHT_M = 1.52;
/** Additional uniform scale vs target (e.g. `0.5` → half previous on-screen height). */
export const V2_NPC_YB_TIPI1_SIZE_MULTIPLIER = 0.5;
/**
 * `NPC.YB.glb` rig forward in model-local space is **-X**. The
 * `ybFacingGroup` aim helper writes `rotation.y = atan2(dx, dz)` so it
 * aligns the facingGroup's local **+Z** with the vector to the player.
 * For this to make the *model* face the player, the model's effective
 * forward inside the facingGroup must also be +Z — so we rotate the
 * model by **+π/2** (90° Y) which maps -X → +Z. The earlier `+ π` "spin
 * on top" left her facing 180° away from the player and was the source
 * of the May-2026 "alignments are backwards" report.
 *
 * NOTE: at the very first frame (before update() runs) `facingGroup`
 * defaults to rotation 0, so she briefly reads as facing world +Z
 * (north). After the first update tick (16 ms) the aim helper snaps
 * her to face the player. This flicker is imperceptible in practice.
 */
export const V2_NPC_YB_TIPI1_MODEL_YAW_RAD = Math.PI / 2;

/**
 * Optional yaw bias on the live player-aim pivot (`ybFacingGroup`).
 * Facing uses `atan2(dx, dz)` so local +Z tracks the player; tune if the rig’s chest vs glTF forward is offset.
 */
export const V2_NPC_YB_TIPI1_PLAYER_AIM_YAW_BIAS_RAD = 0;

/** Avatar3 inner Y rotation (`WorldAvatar.js`) — aligns imported model forward with v2 player-forward. */
export const V2_AVATAR_MODEL_YAW_RAD = Math.PI / 2;

/** Fine vertical nudge after sole alignment (negative = sink slightly into seat cushion). */
export const V2_NPC_YB_TIPI1_VERTICAL_TRIM_M = -0.035;
/** Extra downward seating shift — ~6 imperial inches toward cushions/circle (m). */
export const V2_NPC_YB_TIPI1_SEAT_LOWER_M = 6 * 0.0254;

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

/**
 * Ground travel circle + arrow radius — scales with avatar vs legacy 1.72 m ring.
 * **×1.5** for clearer map / PiP read (NPC gold uses half of this via `V2_NPC_YB_*`).
 */
export const V2_AVATAR_TRAVEL_CIRCLE_RADIUS_M =
  1.72 * 0.7 * V2_AVATAR_GAMEPLAY_SCALE * 1.5;

/** YB gold travel ring radius (half-scale NPC vs player footprint). */
export const V2_NPC_YB_TIPI1_GOLD_CIRCLE_RADIUS_M =
  V2_AVATAR_TRAVEL_CIRCLE_RADIUS_M * 0.5;
/**
 * Gold travel disc / ring / arrow: **local Y** from seated `root` origin.
 * Root is at `deckTop + vertical_trim − seat_lower`, i.e. below the sacred deck cap; this delta
 * reaches the deck surface plus `V2_AVATAR_TRAVEL_CIRCLE_LIFT_M` so the decal sits on the platform,
 * not inside the green cylinder (was previously ~only the avatar lift and read “under” the deck).
 */
export const V2_NPC_YB_TIPI1_GOLD_CIRCLE_LIFT_M =
  V2_NPC_YB_TIPI1_SEAT_LOWER_M -
  V2_NPC_YB_TIPI1_VERTICAL_TRIM_M +
  V2_AVATAR_TRAVEL_CIRCLE_LIFT_M;

// ── Tipi 2 — Brings Happiness Girl (NPC.BHG) ──────────────────────────────
//
// Placement: "to the right of tipi 1, skip 1 tile" — i.e. with one full empty
// tile of grass between the two tipi centres. World +X is the natural read
// of "right" for a player who spawns looking north. Centre = +2 × tile width
// so the gap is exactly 1 tile.
//
// Tipi 2 reuses tipi 1's visual asset (Tipi.yellowbutterfly.glb) and platform
// dimensions on purpose — same tipi shape, same yaw, same scale — so the
// scene reads as two members of the same village rather than two unrelated
// structures. If/when a unique tipi GLB is sourced for BHG (e.g. a re-baked
// `tipi.bringshappiness.glb`), only `TIPI_2_URL` in WorldStructures.js
// changes.
//
// NPC.BHG seated tuning constants mirror YB — both rigs share author scale
// and humanoid proportions so the YB-tuned offsets sit her correctly on the
// same platform model. Keeping them as DISTINCT exported constants (rather
// than aliases) leaves room to detune later without touching YB.

export const V2_TIPI_2_CENTER_X_M = V2_TILE_WORLD * 2;
export const V2_TIPI_2_CENTER_Z_M = 0;
/**
 * Tipi 2 yaw matches Tipi 1. Currently `π` while under forensic review
 * (May-11 2026). The user reports tipi visually faces east despite the
 * math implying south; treat as provisional until the ground-truth GLB
 * orientation is pinned down empirically.
 */
export const V2_TIPI_2_YAW_RAD = Math.PI;

export const V2_NPC_BHG_TIPI2_LOCAL_X_M = V2_NPC_YB_TIPI1_LOCAL_X_M;
export const V2_NPC_BHG_TIPI2_LOCAL_Z_M = V2_NPC_YB_TIPI1_LOCAL_Z_M;
export const V2_NPC_BHG_TIPI2_TARGET_HEIGHT_M = V2_NPC_YB_TIPI1_TARGET_HEIGHT_M;
/**
 * BHG renders significantly larger than YB on-screen despite identical
 * V2_NPC_*_TARGET_HEIGHT_M / SIZE_MULTIPLIER math, because NPC.BHG.glb has
 * different rig proportions / bind pose than NPC.YB.glb (~1.6× wider in X)
 * — `setFromObject` reads the static-geometry bbox before skinning, so the
 * computed scale factor doesn't account for her larger silhouette. Halving
 * the size multiplier brings her perceived volume close to YB's. Adjust
 * here if she still reads too large/small; do NOT touch YB's multiplier.
 */
export const V2_NPC_BHG_TIPI2_SIZE_MULTIPLIER =
  V2_NPC_YB_TIPI1_SIZE_MULTIPLIER * 0.5;
export const V2_NPC_BHG_TIPI2_MODEL_YAW_RAD = V2_NPC_YB_TIPI1_MODEL_YAW_RAD;
export const V2_NPC_BHG_TIPI2_PLAYER_AIM_YAW_BIAS_RAD = 0;
export const V2_NPC_BHG_TIPI2_VERTICAL_TRIM_M = V2_NPC_YB_TIPI1_VERTICAL_TRIM_M;
export const V2_NPC_BHG_TIPI2_SEAT_LOWER_M = V2_NPC_YB_TIPI1_SEAT_LOWER_M;
export const V2_NPC_BHG_TIPI2_GOLD_CIRCLE_RADIUS_M =
  V2_NPC_YB_TIPI1_GOLD_CIRCLE_RADIUS_M;
export const V2_NPC_BHG_TIPI2_GOLD_CIRCLE_LIFT_M =
  V2_NPC_YB_TIPI1_GOLD_CIRCLE_LIFT_M;

/** Max horizontal speed from World steering when movement keys / autowalk are active (m/s). */
export const V2_PLAYER_MOVE_SPEED_MPS = 7.0;

/**
 * Walk loop timeScale = clamp(|v.xz| / ref, min, max). Tune `ref` so cadence matches stride at cruise speed.
 */
export const V2_AVATAR_WALK_ANIM_REF_SPEED_MPS = 3.35;
export const V2_AVATAR_WALK_ANIM_TIME_SCALE_MIN = 0.42;
export const V2_AVATAR_WALK_ANIM_TIME_SCALE_MAX = 2.4;

// ── Flora — Moondial seasons (`ANU_EVENTS.SEASON_CHANGE`) tint leaf instances ──

/** Per-season multipliers on `THREE.Color.multiply` — keys match `UIModule._setSeason`. */
export const SEASON_SURFACE_TINTS = Object.freeze({
  day: Object.freeze({ trees: 0xffffff }),
  night: Object.freeze({ trees: 0x8899bb }),
  dawn: Object.freeze({ trees: 0xffefd5 }),
  dusk: Object.freeze({ trees: 0xffb87a }),
  gray: Object.freeze({ trees: 0xb8bcc8 }),
});

/**
 * Horizontal spread vs legacy width mult `(0.88 + rnd*0.58) * sf`; `1` matches EnvironmentBuilder feel.
 */
export const V2_FLORA_TREE_HORIZONTAL_SPREAD = 1.0;

/**
 * Hard cap on live `tree.glb` instances (multipart draws × slices still multiply GPU cost).
 * Slots are prioritized **nearest-origin first** — distant rings thin first under cap.
 * Tune alongside `exportFuzzyPipelineJson()` / stress brief when flora or PiP dominates.
 */
export const V2_FLORA_MAX_TREE_INSTANCES = 155;

/**
 * No tree **trunk** placement closer than this to the tipi hex anchor (m, XZ).
 * Keeps instanced canopy mass from leaning through the tipi volume.
 */
export const V2_FLORA_TIPI_CLEAR_ZONE_RADIUS_M = 12.5;
