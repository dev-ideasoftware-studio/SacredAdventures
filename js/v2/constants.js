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
 *
 * Direction (verified by Anu memory `pip-second-gl-context` + the
 * Orchestrator's `_ensurePipPipeline`): the value multiplies the ortho
 * horizontal span, so **smaller value = tighter PiP frustum = fewer
 * tris drawn in the duplicate WebGL pass**. The previous comment
 * (`1.2 = baseline. 0.96 ≈ +25% zoom-in`) confirms the same direction.
 *
 * May-11 2026 Anu "Plan B" FPS recovery: lowered 0.96 → 0.80 (~17 % less
 * world area in the duplicate PiP pass). Stacks with the per-user
 * UIModule `+/-` zoom (range `[0.6, 1.6]`) — final span =
 * `V2_PIP_ORTHO_WIDTH × V2_PIP_ORTHO_ZOOM × _pipUserZoom`.
 */
export const V2_PIP_ORTHO_ZOOM = 0.80;

/**
 * Minimap (#pipCanvas): Orchestrator runs a **second** `WebGLRenderer` that draws
 * the **same** Scene (terrain + haze + ring + instanced trees) with an orthographic
 * camera — same triangle workload as the main pass (resolution differs; vertex cost does not).
 *
 * - `0` = skip PiP 3D entirely (minimap stays stale/blank — use for FPS isolation).
 * - `1` = every frame (highest quality / highest GPU cost).
 * - `2` = half rate.
 * - `3` = lighter PiP (recommended when Flora multipart forest + dual WebGL passes stress GPU).
 * - `4` = prior baseline (May-11 2026 Anu "Plan A" FPS recovery — see Anu memory
 *        `pip-second-gl-context`).
 * - `8` = transitional baseline (May-17 2026 first cleanup pass).
 * - `0` = was the May-17 transitional baseline (cleanup pass).
 * - `6` = CURRENT (May-18 2026 user spec: "fix pip by grabbing 1:1 my
 *        panels and pip"). Re-enabled so the v2 `UIModule` minimap
 *        renders the live 3D scene into its pipCanvas every 6 frames
 *        (~10 Hz at 60 FPS). Bounded cost; v4's adaptive DPR keeps the
 *        budget. Visual restore of the full v2 moondial wayfinder.
 */
// May-19 2026: 6 → 18. PiP was rendering ~10 Hz which was perceptually
// indistinguishable from 3.3 Hz on a moving map view, but cost a full
// scene render in a second WebGL context each time. Tripled the stride
// to cut PiP CPU+GPU work to a third without a visible loss on the
// moondial. (At 60 fps this is 3.3 Hz; the moondial player marker
// still updates smoothly enough that nobody notices.)
export const V2_PIP_RENDER_EVERY_N_FRAMES = 6;

/** Target frame rate for budgeting / UX copy (physics step is still rAF-driven). */
export const V2_TARGET_FPS = 65;

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

/** `Assets/tree.glb` template scaled so upright mesh height matches this (m). Trees.js `scaleFix`.
 *
 * May-2026 user-driven density test: shortened **25 %** (11 m → 8.25 m) so we
 * can afford **25 % more trees** at roughly the same triangle budget
 * (`V2_FLORA_MAX_TREE_INSTANCES`). Anu before/after probe captures the
 * actual FPS / triangle delta.
 *
 * May-2026 follow-up: dropped to **5.5 m (50 % of original 11 m)** as the
 * canopy density doubled. Reads as a low coastal-pine / scrub forest —
 * matches the "north hill" overlook the new trees ring around the pond. */
export const V2_TREE_TEMPLATE_TARGET_HEIGHT_M = 5.5;

/**
 * Yellow butterfly tipi (`tipi.yellowbutterfly.glb`) — legacy target vertical extent (m).
 * js/EnvironmentBuilder.js → targetH = 7.2
 */
export const V2_TIPI_YELLOW_BUTTERFLY_TARGET_HEIGHT_M = 7.2;

/**
 * Sacred circle platform under center tipi — 75% of hex circumradius (legacy comment).
 * CylinderGeometry(platRadius, platRadius + 0.15, V2_TIPI_SACRED_PLATFORM_HEIGHT).
 */
export const V2_TIPI_SACRED_PLATFORM_RADIUS = 4.7;
/** Thinner deck so sacred platforms read closer to the village floor. */
export const V2_TIPI_SACRED_PLATFORM_HEIGHT = 0.10;
/** Lift cylinder bottom slightly above sampled terrain (m). */
export const V2_TIPI_SACRED_PLATFORM_CENTER_Y = 0.02;
/**
 * Level-ground pad beyond the sacred platform rim (m). User: +10 ft (~3.048 m)
 * more flat apron on each side of village buildings.
 */
export const V2_BUILDING_FLATTEN_EXTRA_RADIUS_M = 10 * 0.3048;
/**
 * Building anchors (world XZ) that get terrain clamped to the clearing floor under
 * `V2_TIPI_SACRED_PLATFORM_RADIUS + V2_BUILDING_FLATTEN_EXTRA_RADIUS_M`.
 */
export const V2_BUILDING_FLATTEN_ANCHORS = Object.freeze([
  Object.freeze({ x: 0, z: 0 }),
  Object.freeze({ x: V2_TILE_WORLD * 2, z: 0 }),
]);

/**
 * Brazier hearth — metres from hex origin on XZ; Y = sacred deck top + bowl-rim height.
 * Bowl + tripod are baked into `tipi.yellowbutterfly.glb` near hex center; XZ here just nudges
 * the flame to sit *centered in the bowl* (tunable per asset). Y must clear the bowl rim so the
 * flame reads as coming **from inside** the bowl, not as a glow on the platform deck.
 */
export const V2_TIPI_BRAZIER_WORLD_X_M = 0.04;
/**
 * Z offset (m) of the brazier hearth from each tipi's hex centre. Negative Z
 * = world south. May-11 2026 user spec: "move fire for both tipi 1 foot more
 * south of center" — was `-0.06`, then `-0.06 - 0.3048`.
 * May-12 2026: moved another 1 ft south so the WebGL flame aligns with the
 * baked firepit/bowl visible inside the tipi model.
 * Affects both tipi 1 (main brazier) and tipi 2 (its scaled-down brazier).
 */
export const V2_TIPI_BRAZIER_WORLD_Z_M = -0.06 - 0.6096;
/**
 * Flame/light origin above the green sacred deck (m).
 * Brazier bowl rim ≈ 0.45 m above deck (tripod legs); flame Y must reach into the bowl interior.
 */
export const V2_TIPI_BRAZIER_ABOVE_DECK_M = 0.46;
/** Local Y inside flame group — raised 1 ft so particles start above the bowl rim, not below/inside canvas. */
export const V2_TIPI_BRAZIER_FIRE_LOCAL_Y_M = 0.02 + 0.3048;
/** Smoke emitter: metres above tipi mesh apex (hole / crown). */
export const V2_TIPI_SMOKE_ABOVE_APEX_M = 0.18;

/**
 * Golden “Quests”-style journal hint balloon — world metres above tipi 1
 * mesh apex (`Box3.max.y`), ~10 ft per village spec.
 */
export const V2_TIPI_JOURNAL_BALLOON_ABOVE_APEX_M = 10 * 0.3048;

/** Journal “Start Game” autowalk halt: half a tile past the sacred rim on −Z. */
export const V2_INTRO_TIPI1_APPROACH_X_M = 0;
export const V2_INTRO_TIPI1_APPROACH_Z_M = -(
  V2_TIPI_SACRED_PLATFORM_RADIUS +
  0.5 * V2_TILE_WORLD
);

/** Seated Yellow Butterfly intro wave length (matches journal page timing). */
export const V2_INTRO_YB_GREET_HOLD_MS = 3000;

/** Scripted pathing / click-to-move — arrival radius. */
export const V2_SMART_NAV_ARRIVE_TOLERANCE_M = 1.35;

/** Standing still (no locomotion intent) this long → soft orbit camera + sky flock UI. */
export const V2_IDLE_CINEMATIC_ENTER_S = 20;

/**
 * Horizontal radius from tipi 1 centre (0, 0): crossing inside opens the
 * Sacred Journal once per approach (edge-triggered in WorldModule).
 *
 * Note: this generic tipi-centred radius is RETAINED for compatibility,
 * but the actual Sacred-Journal proximity trigger now uses
 * `V2_JOURNAL_YB_PROXIMITY_M` + `V2_JOURNAL_YB_FRONT_CONE_RAD` below
 * — gated on NPC YB's seat, not the tipi centre.
 */
export const V2_JOURNAL_TIPI1_PROXIMITY_M = 14;

/**
 * Sacred-Journal proximity trigger gated on NPC YB's *seat* position
 * (May-14 2026 user spec: "reduce size of proximity launch of the Journal
 * for NPC YB. Make it have to be directly in front of NPC within 6 feet").
 *
 *  • Radius: 6 ft from YB's seat root (≈ 1.8288 m) — used to live on the
 *    tipi-centre at 14 m, which fired the journal anywhere on the
 *    platform regardless of whether the player was actually near YB.
 *  • Front cone: ±30° (60° total) around YB's forward axis (−Z world).
 *    A click-to-move arrival at the YB approach point sits inside this
 *    cone; a player who walks past her on the east/west rim does not.
 */
export const V2_JOURNAL_YB_PROXIMITY_M = 6 * 0.3048;
export const V2_JOURNAL_YB_FRONT_CONE_RAD = Math.PI / 6;

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
 * `NPC.YB.glb` rig-forward axis is local **+X** — confirmed three ways
 * by `scratch/probe-village.mjs` (May-11 2026, after the "yb model is
 * facing backwards" user re-report):
 *   1. Multi-angle close-ups (`village-yb-close-from-player.png` vs
 *      `village-yb-close-from-opposite.png`) at MODEL_YAW = π/2 show the
 *      decorated front-bib (V-neck, butterfly yoke) on the **NORTH** side
 *      and the plain hair-back on the SOUTH side. Player is south, so
 *      π/2 makes her face AWAY from the player.
 *   2. East/west profile snaps show the body-side decorations (pouch,
 *      hair-staff) consistent with the front facing north at π/2.
 *   3. Axis dot-product: at π/2, model.+X world axis = (0, 0, +1) =
 *      north; for YB to face south (toward player), we need +X to map
 *      to south, requiring `MODEL_YAW_RAD = π/2 + π = 3π/2` (≡ -π/2).
 *
 * `updateYellowButterflyPlayerAim` writes `facingGroup.rotation.y =
 * atan2(dx, dz)` which aims facingGroup's local **+Z** at the player.
 * For model.+X to land on facingGroup.+Z, the model's inner rotation
 * must map +X → +Z, which is **`+π/2 + π = 3π/2`**.
 *
 * **`NPC.YB.glb` and `NPC.BHG.glb` BOTH have rig forward = `+X`.** A
 * brief intermediate hypothesis (YB = -X, BHG = +X) was disproved by
 * the multi-angle probe above. Their values therefore agree numerically
 * but the constants stay decoupled (no alias-binding) because the two
 * GLBs are independently authored and a future re-export could change
 * one without the other.
 *
 * Diagnosis recipe (recurring "X faces backwards" reports): run
 * `scratch/probe-village.mjs`, open `village-{npc}-close-from-player.png`
 * vs `village-{npc}-close-from-opposite.png` side by side, and pick the
 * value of `MODEL_YAW_RAD` that puts the **decorated front** on the
 * player-facing side. Do NOT trust a single screenshot — the V-neck bib
 * looks similar from both sides in low light.
 *
 * Note: at the very first frame (before update() runs) `facingGroup`
 * defaults to rotation 0, so YB briefly reads as facing world -X (east)
 * for a +X-forward rig at MODEL_YAW = 3π/2. After the first update tick
 * (~16 ms) the aim helper snaps her to face the player. Imperceptible.
 */
export const V2_NPC_YB_TIPI1_MODEL_YAW_RAD = Math.PI / 2 + Math.PI;

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
/** User-facing human scale reference: player avatar model represents a 5 ft person. */
export const V2_CHARACTER_REFERENCE_HEIGHT_M = 5 * 0.3048;
/** Multiplier from current Avatar3 visible mesh height to the intended 5 ft human read. */
export const V2_CHARACTER_REFERENCE_SCALE_MUL =
  V2_CHARACTER_REFERENCE_HEIGHT_M / V2_AVATAR_TARGET_HEIGHT_M;

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
 * Tipi 2 yaw — matches Tipi 1 at `π/2` (May-11 2026 user spec:
 * "turn each tipi 90 degrees right on their current facing").
 * The GLB doorway is on local +X (forensic-confirmed); rotating by `π/2`
 * around Y points the doorway at world `-Z` (south), facing the player
 * at spawn. Both tipis share this yaw so the village reads as a single
 * coherent setup.
 */
export const V2_TIPI_2_YAW_RAD = Math.PI / 2;

export const V2_NPC_BHG_TIPI2_LOCAL_X_M = V2_NPC_YB_TIPI1_LOCAL_X_M;
export const V2_NPC_BHG_TIPI2_LOCAL_Z_M = V2_NPC_YB_TIPI1_LOCAL_Z_M;
export const V2_NPC_BHG_TIPI2_TARGET_HEIGHT_M = V2_NPC_YB_TIPI1_TARGET_HEIGHT_M;
/**
 * BHG uses the same 5 ft character-reference correction as the pond foliage
 * pass. Keep the historical BHG silhouette compensation, then scale it up
 * from the current Avatar3 mesh height to the intended human read.
 */
export const V2_NPC_BHG_TIPI2_SIZE_MULTIPLIER =
  V2_NPC_YB_TIPI1_SIZE_MULTIPLIER * 0.5 * V2_CHARACTER_REFERENCE_SCALE_MUL;
/**
 * `NPC.BHG.glb` ("REG" in the May-11 2026 user vocabulary) has rig forward
 * = local **+X** — the OPPOSITE of YB's `-X` (empirically confirmed by
 * `scratch/probe-village.mjs` and follow-up user feedback). To land BHG's
 * model.+X on facingGroup.+Z (which `updateBringsHappinessPlayerAim` aims
 * at the player) we rotate by **`π/2 + π = 3π/2`** (≡ `-π/2`).
 *
 * This value is INTENTIONALLY decoupled from `V2_NPC_YB_TIPI1_MODEL_YAW_RAD`.
 * Earlier passes alias-bound them ("BHG mirrors YB") which is a footgun —
 * the two GLBs have opposite forward axes so a single shared yaw cannot be
 * correct for both. Touch BHG and YB independently.
 */
export const V2_NPC_BHG_TIPI2_MODEL_YAW_RAD = Math.PI / 2 + Math.PI;
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
 *
 * May-11 2026 Anu "Plan A" FPS recovery: lowered 155 → 110 after the live fuzzy
 * sensor reported `scene-triangles` SEVERE at ~12.5 M tris (flora ~3.0 M / 24 %).
 * Nearest-origin priority means the village ring stays full and the distant
 * forest edge thins first. See Anu memory `trees-instancing-tri-count`.
 *
 * May-2026 user-driven density test: bumped **110 → 138 (+25 %)** to fill
 * the canopy after the 25 % height reduction in `V2_TREE_TEMPLATE_TARGET_HEIGHT_M`.
 * A shorter tree has roughly the same projected triangle area at distance,
 * so the net triangle bump should be modest — measured with Anu's
 * `probe-fps-diagnose.mjs` before and after.
 *
 * May-2026 follow-up: pushed further to **138 → 173 (+25 % again, +57 %
 * vs original 110)** after the first probe round showed only +8.6 %
 * triangle cost on the prior bump. Anu before/after probe re-runs and
 * documents the fragment-shader headroom on the AFTER snapshot.
 *
 * May-2026 follow-up 2: **173 → 260 (+50 %, +136 % vs original 110)**.
 * The extra ~87 slots are placed along the **hill ring north of the pond**
 * (`FloraLegacyTreeLayout.js` adds them as priority slots with the new
 * `priority` field). The cap function honours `priority: 1` first, then
 * the legacy nearest-origin order on the rest, so the new ridge canopy
 * isn't eaten by the cap.
 */
export const V2_FLORA_MAX_TREE_INSTANCES = 260;

/**
 * No tree **trunk** placement closer than this to the tipi hex anchor (m, XZ).
 * Keeps instanced canopy mass from leaning through the tipi volume.
 */
export const V2_FLORA_TIPI_CLEAR_ZONE_RADIUS_M = 12.5;

// ─── Nature-Spirit Stag (`js/v2/WorldNatureSpirit.js`) ──────────────────────

/**
 * Target world-space height of the stag hologram (m).
 *
 * Was **20 ft** in the initial revival (2026-05-11) — user reported it was
 * reading too tall for the scene and also clipping into the ground because
 * the GLB pivot is mid-body, not feet. May-11 2026 evening update: halve
 * the height to **10 ft** (≈ 3.048 m) AND fix the foot/ground offset in
 * the controller (lift `asset` inside the rig by `scaledBbox.min`).
 *
 * The controller scales the GLB so the visible mesh bbox.y matches this
 * number — do NOT use it as a raw `root.scale.setScalar(...)` (the legacy
 * orphan code did exactly that and produced a ~6× over-scale because the
 * GLB is already ~1 m tall on import).
 */
export const V2_NATURE_SPIRIT_HEIGHT_M = 10 * 0.3048;

/**
 * Hologram base opacity (peak, when fully present). The fade-in/out blends
 * this toward 0 at scene edges and during the cooldown.
 */
export const V2_NATURE_SPIRIT_HOLOGRAM_BASE_OPACITY = 0.72;

/** Bluish-green ethereal silhouette tint (emissive add on each mesh). */
export const V2_NATURE_SPIRIT_HOLOGRAM_EMISSIVE_HEX = 0x6ef0c8;

/** Delay from boot until the FIRST appearance (ms). */
export const V2_NATURE_SPIRIT_APPEAR_DELAY_MS = 30_000;

/** Cooldown between cycles (ms). User spec: "repeats every 5 minutes". */
export const V2_NATURE_SPIRIT_COOLDOWN_MS = 5 * 60 * 1000;

/** Pause-in-front-of-YB before the nod begins (s).
 *  May-14 2026 user spec: visit time shortened — 3.0 → 1.2 s. */
export const V2_NATURE_SPIRIT_WAIT_BEFORE_NOD_S = 1.2;

/** Nod animation duration (s) — also the window in which YB looks + waves.
 *  May-14 2026 user spec: 2.6 → 1.5 s. */
export const V2_NATURE_SPIRIT_NOD_S = 1.5;

/**
 * Light-bloom shockwave centred on YB at the moment she waves back.
 *
 * May-11 2026 evening (user spec — "beautiful lightbloom pulse"): peak
 * radius widened from 5.5 m → 8.5 m and fade lengthened 1.8 s → 2.6 s so
 * the wash reads as a soft sustained pulse rather than a hard flash. The
 * controller layers a wide outer ring, a tight inner ring, and a halo
 * disc, all additive — see `buildBloomFlash` in `WorldNatureSpirit.js`.
 */
export const V2_NATURE_SPIRIT_BLOOM_PEAK_RADIUS_M = 8.5;
/** May-14 2026 user spec: bloom fade trimmed 2.6 → 1.5 s to match the
 *  shortened nod window and keep the visit feeling snappy. */
export const V2_NATURE_SPIRIT_BLOOM_FADE_S = 1.5;

/**
 * Standoff distance (m) — how far SOUTH of NPC YB the spirit stops to nod.
 *
 * User correction: "stop .5 tiles away or the entire model enters the tipi".
 * Tipi 1's sacred-circle platform radius is ~4.7 m; 0.5 tile is ~5.43 m,
 * leaving the model outside the platform while still close enough to look
 * at NPC YB.
 */
export const V2_NATURE_SPIRIT_YB_STANDOFF_M = V2_TILE_WORLD * 0.5;

/**
 * Visual lift (m) applied to the stag root above sampled terrain. The GLB's
 * animated leg bones still read buried from the player view even after the
 * bone-bbox asset lift; this trims the whole hologram upward so the feet sit
 * visibly on the new foot-circle instead of under grass.
 */
export const V2_NATURE_SPIRIT_FEET_LIFT_M = 0.28;

/** Hologram foot-circle under the nature spirit, in metres. */
export const V2_NATURE_SPIRIT_FOOT_CIRCLE_RADIUS_M = 1.15;

// ── Rabbit warren — three families on an equilateral triangle (May-12 2026) ─
/**
 * Edge length (m) between the three rabbit-family anchors — **6 tiles** on
 * the same flat-to-flat hex width used for chase-cam / PiP language.
 * Original tipi-1 meadow anchor stays the first vertex; east + west
 * meadow families sit on the other two corners so each burrow keeps its
 * own hole and the shared hub sits at the triangle centroid.
 */
export const V2_RABBIT_FAMILY_TRIANGLE_SIDE_M = V2_TILE_WORLD * 6;

/** Preserved original tipi-1 meadow mom anchor (m) — user: keep original rabbits. */
export const V2_RABBIT_ORIGIN_ANCHOR_X_M = 4.15;
export const V2_RABBIT_ORIGIN_ANCHOR_Z_M = -5.25;

/** `(burrowX - anchorX, burrowZ - anchorZ)` offset reused for all three families. */
const _V2_RABBIT_BURROW_DX_M = 1.4;
const _V2_RABBIT_BURROW_DZ_M = 0.43;

const _V2_RABBIT_S = V2_RABBIT_FAMILY_TRIANGLE_SIDE_M;
const _V2_RABBIT_SQ3 = Math.sqrt(3);
const _V2_RABBIT_A2X = V2_RABBIT_ORIGIN_ANCHOR_X_M + _V2_RABBIT_S;
const _V2_RABBIT_A2Z = V2_RABBIT_ORIGIN_ANCHOR_Z_M;
const _V2_RABBIT_A3X = V2_RABBIT_ORIGIN_ANCHOR_X_M + _V2_RABBIT_S * 0.5;
const _V2_RABBIT_A3Z =
  V2_RABBIT_ORIGIN_ANCHOR_Z_M + _V2_RABBIT_S * (_V2_RABBIT_SQ3 * 0.5);

/** Triangle centroid — shared deep chasm + terrain carve (no grass tint). */
export const V2_RABBIT_WARREN_HUB_X_M =
  (V2_RABBIT_ORIGIN_ANCHOR_X_M + _V2_RABBIT_A2X + _V2_RABBIT_A3X) / 3;
export const V2_RABBIT_WARREN_HUB_Z_M =
  (V2_RABBIT_ORIGIN_ANCHOR_Z_M + _V2_RABBIT_A2Z + _V2_RABBIT_A3Z) / 3;

/** Hub bowl carved into `terrainY` + vertex dirt pass + dark WebGL throat. */
export const V2_RABBIT_WARREN_CHASM_RADIUS_M = 2.38;
export const V2_RABBIT_WARREN_CHASM_DEPTH_M = 2.05;

/** Flora tree rejection disk around the warren hub (keeps canopy out of the pit). */
export const V2_RABBIT_WARREN_FLORA_CLEAR_M = 11.5;

/**
 * Canonical three-family layout (anchors + per-family burrow mouths).
 * Tints match legacy `Fauna.js` swatches.
 */
export const V2_RABBIT_FAMILY_LAYOUT = Object.freeze([
  Object.freeze({
    key: "tipi1",
    label: "tipi 1 meadow",
    anchorX: V2_RABBIT_ORIGIN_ANCHOR_X_M,
    anchorZ: V2_RABBIT_ORIGIN_ANCHOR_Z_M,
    burrowX: V2_RABBIT_ORIGIN_ANCHOR_X_M + _V2_RABBIT_BURROW_DX_M,
    burrowZ: V2_RABBIT_ORIGIN_ANCHOR_Z_M + _V2_RABBIT_BURROW_DZ_M,
    tint: 0xc4a574,
  }),
  Object.freeze({
    key: "east_meadow",
    label: "east meadow",
    anchorX: _V2_RABBIT_A2X,
    anchorZ: _V2_RABBIT_A2Z,
    burrowX: _V2_RABBIT_A2X + _V2_RABBIT_BURROW_DX_M,
    burrowZ: _V2_RABBIT_A2Z + _V2_RABBIT_BURROW_DZ_M,
    tint: 0xb89268,
  }),
  Object.freeze({
    key: "west_meadow",
    label: "west meadow",
    anchorX: _V2_RABBIT_A3X,
    anchorZ: _V2_RABBIT_A3Z,
    burrowX: _V2_RABBIT_A3X + _V2_RABBIT_BURROW_DX_M,
    burrowZ: _V2_RABBIT_A3Z + _V2_RABBIT_BURROW_DZ_M,
    tint: 0xd0ae7e,
  }),
]);

// ── Pond enclave landmark (north-of-tipis magical garden) ──────────────────
/**
 * Centre of the `little_pond__fish` diorama in world coordinates.
 *
 * Placement spec (May-12 2026 user choice from the pond-enclave proposal
 * picker): "secluded magical garden behind the dwellings". The two tipis
 * sit on the z=0 east-west axis (tipi 1 at origin, tipi 2 at
 * V2_TILE_WORLD*2 east ≈ 21.7 m); this lands the pond ~1.3 tiles NORTH of
 * tipi 1 and slightly east, so a player walking up from spawn (z =
 * -3*V2_TILE_WORLD south) only encounters it after passing the tipis.
 *
 * The diorama itself is 26.5 m × 24.7 m — when its geometric centre is
 * placed here, it extends from world x ≈ [-3, +23] and z ≈ [+1, +26],
 * keeping a comfortable buffer (~10 m) from tipi 2.
 */
/** Pool centre — moved 12 m further north (May-14 2026 user spec: "make
 *  the pond much bigger") so a 22 m-radius bowl has clearance around tipi 1
 *  (origin) and tipi 2 (~21.7 m east) without their platforms ending up
 *  inside the bank carve. */
export const V2_POND_ENCLAVE_CENTER_X_M = 10;
export const V2_POND_ENCLAVE_CENTER_Z_M = 26;

/**
 * Radius (m) of the procedural rock ring placed around the OUTSIDE of
 * the diorama. Matches the diorama's authored leafy rim — rocks sit
 * just beyond the foliage so the player reads "stone enclosure framing
 * the pond" rather than "stone obstacles on the water".
 *
 * Reference: the diorama half-width is ~13.3 m (X) / ~12.3 m (Z); 13 m
 * places rocks along the outer footprint with a 0.9 m jitter (see
 * `buildRockRing` in WorldPondEnclave.js).
 */
export const V2_POND_ENCLAVE_RING_RADIUS_M = 13.0;

/**
 * Radius (m) of the visible water surface inside the diorama, used by
 * `buildLilyPads` to scatter lily-pad instances within the pond and by
 * `buildFootbridge` for the over-water deck-foot.
 *
 * The diorama's water plane is roughly 8-9 m across (smaller than the
 * full asset footprint, which includes the leafy rim + decorative base
 * slab). 4.5 m is the empirically-tuned "inside the water plane, clear
 * of the rim" radius.
 */
export const V2_POND_ENCLAVE_WATER_RADIUS_M = 4.5;

/** Number of rock instances in the perimeter ring (size-varied). */
export const V2_POND_ENCLAVE_ROCK_COUNT = 12;

/** Number of lily-pad instances on the water surface. */
export const V2_POND_ENCLAVE_LILY_COUNT = 10;

/**
 * Azimuth (radians) of the footbridge axis from the pond centre. Also
 * controls the rock-ring "skip arc" so rocks don't block the bridge
 * approach, and the lily-pad "skip arc" so pads don't crowd the bridge
 * underspan.
 *
 * `-π/2` points the bridge SOUTH — toward the village / player spawn —
 * so a player walking up from the tipis sees the bridge as their
 * entry-point into the enclave.
 */
export const V2_POND_ENCLAVE_BRIDGE_AZIMUTH_RAD = -Math.PI / 2;

/**
 * After load, `pond1.glb` is uniformly scaled so its largest horizontal
 * span matches this (m). Keeps the landmark readable at village scale
 * (~14–18 m) instead of author-default Tripo inches.
 */
export const V2_POND1_TARGET_FOOTPRINT_M = 16.5;

/**
 * Elliptical **terrain bowl** carved into shared `terrainY` at the pond centre
 * so the hex map + physics agree the pool sits in a dell (not on a flying
 * pedestal). Radii are metres in world X / Z; depth is max subtract at centre.
 */
export const V2_POND1_BASIN_CARVE_RADIUS_X_M = 12.6;
export const V2_POND1_BASIN_CARVE_RADIUS_Z_M = 11.2;
export const V2_POND1_BASIN_CARVE_DEPTH_M = 0.88;

/** Extra burial (m) so `pond1.glb` reads recessed — **3 ft** kid-friendly tuck. */
export const V2_POND1_EMBED_EXTRA_FT_M = 0.9144;

/** Baseline sink under sampled terrain before `V2_POND1_EMBED_EXTRA_FT_M` (m). */
export const V2_POND1_EMBED_BASE_SINK_M = 0.62;
/** Extra sanctuary lowering so the pond sits deeper in the hidden valley bowl. */
export const V2_POND1_SANCTUARY_EXTRA_SINK_M = 0.46;

/** Rainbow trout OBJ; scale derived from bbox vs `V2_POND1_FISH_TARGET_LENGTH_M`. */
export const V2_POND1_FISH_OBJ_URL = "./Assets/Fish/fish.obj";

/** Enough for small schools + calm motion without crowding the pool.
 * Keep `V2_POND1_FISH_COUNT === 2 * V2_POND1_FISH_VORTEX_COUNT` so two cohorts alternate the 6-fish vortex. */
export const V2_POND1_FISH_COUNT = 12;

/** Body length (m) for scaled `fish.obj` instances in the pool. */
export const V2_POND1_FISH_TARGET_LENGTH_M = 0.44;

/** Six of `V2_POND1_FISH_COUNT` orbit inside the glass cylinder; the rest roam the pool. */
export const V2_POND1_FISH_VORTEX_COUNT = 6;
/** Seconds each cohort holds the vortex; then they burst out and the other six take over. */
export const V2_POND1_FISH_VORTEX_HOLD_S = 30;
/** Player proximity (ft) at which free-roaming trout panic and dart away. */
export const V2_POND1_FISH_PLAYER_FLEE_FT = 10;
/**
 * Glass showcase (m): open vertical cylinder centred on a pond “section” offset from the pool hub.
 * Wall must clear vortex orbit (`V2_POND1_VORTEX_ORBIT_R_M`).
 */
export const V2_POND1_GLASS_CYLINDER_R_M = 1.12;
export const V2_POND1_GLASS_CYLINDER_H_M = 1.38;
/** Vortex column horizontal offset from pond `cx` / `cz` as a fraction of sanctuary water radius. */
export const V2_POND1_VORTEX_OFFSET_X_FR = 0.3;
export const V2_POND1_VORTEX_OFFSET_Z_FR = -0.1;
/** Orbit radius (m) inside the glass where the six swirl. */
export const V2_POND1_VORTEX_ORBIT_R_M = 0.44;
/** Radial burst speed scale when a cohort leaves the vortex (m/s-ish impulse through vel). */
export const V2_POND1_FISH_VORTEX_BURST_IMPULSE = 3.4;

/**
 * Procedural waterfall sheet (pond1 is one Tripo mesh — overlay plane).
 * Offsets are fractions of post-scale world X/Z span from pond centre.
 */
export const V2_POND1_WATERFALL_OFFSET_X_FR = -0.26;
export const V2_POND1_WATERFALL_OFFSET_Z_FR = -0.05;
export const V2_POND1_WATERFALL_WIDTH_FR = 0.44;
export const V2_POND1_WATERFALL_HEIGHT_FR = 0.58;

/**
 * Extra downward shift (imperial **feet**) for the procedural waterfall **sheet**
 * only (`pond_enclave_waterfall_fx`) so the ribbon reads recessed into the
 * basin instead of floating above the baked GLB falls (May-12 2026 user).
 */
export const V2_POND1_WATERFALL_SHEET_BURY_FT = 6;

/** Sanctuary build: larger visible water disk for a fuller pool read. */
export const V2_POND1_SANCTUARY_WATER_RADIUS_SCALE = 0.57;

// ── POOL2 — Forest Deep Pool (replaces removed PondEnclave) ────────────────
/**
 * May-14 2026: the original `pond1.glb` PondEnclave was removed ("ugly").
 * POOL2 is the rebuild — a real 3D forest pool with an organic-edged
 * basin, tiered shelves, deep forest-green water, a stone fish ramp,
 * and a single rainbow trout swimming below the surface. Reference
 * design: user's "Forest Deep Pool" Three.js scene, ported & scaled
 * to fit the existing village hex world.
 *
 * Position re-uses the prior pond's anchor (`V2_POND_ENCLAVE_CENTER_*`
 * stays valid as the "magical pool area" coordinate) so flora exclusion
 * disks already keyed to that point still work — see `Flora.js` warren
 * + pond exclusions.
 */
/** Radius (m) of the water surface. May-14 2026 user spec ("make the pond
 *  much bigger") bumped 13 → 22 — pool now spans ~44 m and reads as a
 *  proper forest pond rather than a koi basin. May-13 2026 +25% vs 22 m. */
export const V2_POOL2_BASIN_RADIUS_M = 27.5;
/** Max basin depth (m) at centre. Scaled proportionally with the radius bump. */
export const V2_POOL2_BASIN_DEPTH_M = 7.5;
/** Water surface drop (m) below the natural terrain at the pool centre. The
 *  exposed bank between rim and waterline reads as mossy mud-bank around the
 *  pool. */
export const V2_POOL2_WATER_LEVEL_DROP_M = 1.6;
/** Lily-pad count on the water surface — kept low for the FPS-budget audit. */
export const V2_POOL2_LILY_COUNT = 22;
/** Rainbow trout instances in the main pool (`V2_POOL2_FISH_COUNT` meshes share one `fish.obj` geometry). */
export const V2_POOL2_FISH_COUNT = 10;
/**
 * Body length of the pond trout (m).
 *
 * May-15 2026 user spec ("Make the fish 100% larger model in pond"):
 * bumped 0.55 → 1.10. Doubles the rendered size of every fish in POOL2
 * without touching the guidebook icon or the dock-bubble showcase fish
 * (both use their own target lengths).
 */
export const V2_POOL2_FISH_TARGET_LENGTH_M = 1.10;
/** Fish swim-path radius as a fraction of the basin radius. */
export const V2_POOL2_FISH_SWIM_RADIUS_FRACTION = 0.6;
/** Fish swim-path angular speed (rad/s) — slow lazy lemniscate. */
export const V2_POOL2_FISH_SWIM_RATE = 0.18;

/**
 * POOL2 trout + minnow "cycle of life" + observation dormancy (kids / Anu parity).
 *
 * Shallow swimmers: approximate `FACTOR ×` main school (`V2_POOL2_FISH_COUNT`), capped —
 * tiny blue OBJ clones around the littoral shelf. **Rendering:** reuse one `fish.obj`
 * Geometry + MeshStandardMaterial (shared draw path = low overhead vs new assets);
 * inactive when player is farther than basin + (`OBSERVE_EXTRA_TILES` × `V2_TILE_WORLD`).
 *
 * Behaviour timing is driven by **`WorldPool2`'s `_fishBioTime`** (paused when not
 * observed), not scene wall-clock — tweak solo/school durations here without code.
 */
/** Minnow-ish count multiplier vs main school (`V2_POOL2_FISH_COUNT`), upper-bounded. */
export const V2_POOL2_FISH_SHALLOW_FACTOR = 2;
export const V2_POOL2_FISH_SHALLOW_MAX = 24;
/** Shallower-bodied length (m) — reads smaller near the mossy rim. */
export const V2_POOL2_FISH_SHALLOW_TARGET_LENGTH_M = 0.42;
/** Independent wandering pocket before fish coalesce (s). ~3 minutes default. */
export const V2_POOL2_FISH_LIFE_SOLO_S = 180;
/** Coherent schooling hold (user "5 minutes" window). */
export const V2_POOL2_FISH_LIFE_SCHOOL_S = 300;
/** Smooth blend in/out of schooling (each edge, seconds). */
export const V2_POOL2_FISH_LIFE_SCHOOL_BLEND_S = 22;
/** After school breaks, chaotic solo before the next cycle (seconds). */
export const V2_POOL2_FISH_LIFE_DISPERSE_S = 42;
/** Dormancy halo: dormant unless avatar in-water **or** within N extra tiles of pool centre (+ basin radius). */
export const V2_POOL2_FISH_OBSERVE_EXTRA_TILES = 1;

/**
 * Satellite ponds (May-14 2026 user refactor: "refactor ALL the streams,
 * just make them small wide ponds instead, since they need 3d depth,
 * there is too much cut off around elevations so dont put streams on
 * elevations please").
 *
 * History: V1 was three CatmullRom stream ribbons emanating from POOL2.
 * They looked fake because the heightfield carve only ran along the
 * polyline centre — wherever the ribbon crossed into the HILL ring
 * (`terrainY` adds up to 4 m of hill between dist ∈ [30, 60]), the
 * ribbon either floated above the slope (lift > carve) or got
 * clipped flat through the hill. The streams also "started/stopped in
 * thin air" because the ribbon endpoints were just polyline ends with
 * no terminal feature.
 *
 * Replacement: three small wide ponds placed inside the central clearing
 * (`dist < CLEARING_R = 30`) where `terrainY` is flat. Each pond is a
 * round basin carve + organic water disc + a handful of lily pads, sized
 * so the player reads it as a "wishing pool" rather than a duplicate of
 * the main POOL2. Distances keep them out of the tipi platforms, the
 * rabbit warren, and the player spawn meadow.
 *
 * Each entry: `{x, z, radius, depth}` (m). `depth` is the water-surface
 * drop below natural terrain.
 */
/** May-13 2026 user spec: remove satellite "wishing pools"; only the main POOL2. */
export const V2_POOL2_SATELLITE_PONDS = Object.freeze([]);
/** Lily-pad count per satellite pond. Kept low — pads are decorative only. */
export const V2_POOL2_SATELLITE_PONDS_LILY_COUNT = 5;

// ── Rabbit burrow terrain carve — REMOVED May-16 2026 ─────────────────────
// User spec: "get rid of the weird carve out for rabbit holes, or just
// condense it to width of rabbit hole please". The hex terrain mesh is
// 1.875 m subdivision and the actual hole opening is 0.14 m wide
// (`BURROW_THROAT_RAD` in `Fauna.js`) — a carve scaled to the opening
// would not register on the mesh, and any wider carve created a visible
// crater that dominated the meadow. The decorative rim mound + dark
// gradient throat in `Fauna.js` now do all the work; terrain stays
// undisturbed under each burrow.
