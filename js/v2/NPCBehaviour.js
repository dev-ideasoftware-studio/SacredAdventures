/**
 * Sacred Adventures v2 — tipi-owner proximity behaviour controller.
 *
 * Each tipi has an "owner" NPC. Today only NPC.YB (tipi 1) is wired, but the
 * controller is designed so future tipi owners can drop in without changing
 * World.js (one update-call per frame is already there for each tipi).
 *
 * Behaviour spec (matches the user request verbatim):
 *
 *   when player is within 1 tile of tipi  →
 *      NPC plays wave clip, then walks 1 foot in front of the tipi
 *      (a point on the radial from tipi-centre toward the player, at
 *      `platformRadius + 1 foot`); on arrival, swap to idle clip.
 *
 *   while player is closer than (tile + 1)  →
 *      remain standing/idle, smoothly tracking the player with the
 *      seated `ybFacingGroup` aim pivot.
 *
 *   when player passes (tile + 1)         →
 *      NPC plays walk clip, walks back to her original seat position,
 *      turns around, plays the sit clip and is seated again.
 *
 * Animation clip mapping (NPC.YB.glb): every clip in the asset is named
 * `NlaTrack[.NNN]` so name-search returns nothing. The legacy
 * `js/EnvironmentBuilder.js` semantic mapping is used as a deterministic
 * fallback. If the asset is ever re-baked with named clips, the controller
 * still finds them by name first.
 */

import * as THREE from "three";
import { dispatchInteraction } from "./anu/InteractionBus.js";
import { ANU_EVENTS } from "./anu/anuEvents.js";
import { V2_TILE_WORLD } from "./constants.js";

/** Player distance thresholds (m), keyed to the canonical hex tile. */
const APPROACH_DIST_M = V2_TILE_WORLD;
const DEPART_DIST_M = V2_TILE_WORLD * 2;

const WALK_SPEED_MPS = 1.2;
const TURN_RATE_RAD_PER_S = Math.PI * 1.6;

/** Behaviour state names — also published in ANU_EVENTS.PLAYER_NPC_GREETING. */
export const NPC_BEHAVIOUR_STATES = Object.freeze({
  SEATED: "seated",
  EXITING_WAVE: "exiting_wave",
  EXITING_WALK: "exiting_walk",
  STANDING_IDLE: "standing_idle",
  RETURNING: "returning",
  TURNAROUND_SIT: "turnaround_sit",
});

/**
 * Legacy-derived clip-by-kind preference order:
 *   1) name search (case-insensitive contains)
 *   2) index fallback from `js/EnvironmentBuilder.js`
 *
 * NPC.YB.glb currently has 5 NlaTrack-named clips; only the index fallback
 * fires. clip 0 (3.50 s) is treated as a walk loop, clip 4 (2.38 s) as a wave,
 * with `idle = 2` and `sit = 3` from the legacy code.
 */
const CLIP_PREFS = Object.freeze({
  walk: { names: ["walk"], fallbackIndex: 0 },
  idle: { names: ["idle", "stand"], fallbackIndex: 2 },
  sit: { names: ["sit", "wait", "003"], fallbackIndex: 3 },
  wave: { names: ["wave", "greet", "hello"], fallbackIndex: 4 },
});

function _pickClip(clips, kind) {
  const pref = CLIP_PREFS[kind];
  if (!pref) return null;
  for (const c of clips) {
    const nm = String(c?.name ?? "").toLowerCase();
    if (pref.names.some((needle) => nm.includes(needle))) return c;
  }
  return clips[pref.fallbackIndex] ?? null;
}

/**
 * Build a behaviour controller bound to one NPC root.
 *
 * @param {{
 *   npcId: string,
 *   tipi: THREE.Object3D,
 *   root: THREE.Object3D,
 *   facingGroup: THREE.Object3D,
 *   model: THREE.Object3D,
 *   mixer: THREE.AnimationMixer,
 *   clips: THREE.AnimationClip[],
 *   tipiCenter: { x: number, z: number },
 *   /** local-space (relative to tipiCenter) entrance point on the doorway side of
 *    *  the tipi model. The NPC walks here from her seat — she does NOT exit on a
 *    *  radial toward the player. Real tipis have one entrance. *\/
 *   entranceLocalXZ?: { x: number, z: number },
 *   getGroundY: (x: number, z: number) => number,
 * }} args
 */
export function createTipiOwnerBehaviour(args) {
  const {
    npcId,
    tipi,
    root,
    facingGroup,
    model,
    mixer,
    clips,
    tipiCenter,
    entranceLocalXZ = { x: 0, z: -2.4 },
    getGroundY,
  } = args;

  if (!root || !facingGroup || !mixer || !clips || !getGroundY) {
    console.warn("[NPCBehaviour] missing required args — aborting controller wire.");
    return null;
  }

  const seatPos = { x: root.position.x, y: root.position.y, z: root.position.z };
  const seatModelYaw = model ? model.rotation.y : 0;

  const actions = {};
  for (const kind of Object.keys(CLIP_PREFS)) {
    const c = _pickClip(clips, kind);
    if (!c) continue;
    const a = mixer.clipAction(c);
    a.setLoop(THREE.LoopRepeat, Infinity);
    actions[kind] = a;
  }
  // Wave should play once per approach, not loop indefinitely.
  if (actions.wave) actions.wave.setLoop(THREE.LoopOnce, 1);

  let activeAction = null;
  /**
   * @param {keyof CLIP_PREFS} kind
   * @param {number} fadeSec
   */
  function crossfadeTo(kind, fadeSec = 0.25) {
    const next = actions[kind];
    if (!next) return;
    if (activeAction === next) {
      if (kind === "wave") {
        // Reset wave to start so a fresh approach replays it.
        next.reset();
      }
      return;
    }
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (activeAction && activeAction !== next) {
      activeAction.crossFadeTo(next, fadeSec, false);
    }
    activeAction = next;
  }

  // Seed: NPC is currently seated; her sit clip is already playing via the
  // attachYellowButterflySeatedTipi1 boot path. Adopt that as activeAction so
  // crossfades work from the very first transition.
  if (actions.sit) {
    activeAction = actions.sit;
    actions.sit.play();
  }

  /**
   * Fixed entrance point in WORLD XZ — where she walks to when triggered.
   * Computed once at construction time; she always exits to the same spot
   * (the tipi doorway) regardless of which way the player approaches.
   */
  const entranceWorldX = tipiCenter.x + entranceLocalXZ.x;
  const entranceWorldZ = tipiCenter.z + entranceLocalXZ.z;

  /** Yaw the body should rotate toward (radians). */
  let desiredYaw = facingGroup.rotation.y;
  /** True while behaviour is overriding the live player-aim pivot. */
  let suppressPlayerAim = false;
  /** Re-entry guard for greeting events. */
  let lastDispatchedState = null;

  /**
   * Rising-edge gate on the SEATED → EXITING_WAVE transition. Initialized
   * to `false` so an in-progress player position at boot does NOT instantly
   * pull her out of her seat. She only exits when the player demonstrably
   * crosses from "outside the approach zone" into it.
   *
   * Set to `true` once the player is observed beyond DEPART_DIST_M;
   * cleared again the moment she begins a fresh greeting cycle. The
   * effect: she always starts sitting, only stands when the player
   * actively walks up, and sits back down when the player leaves.
   */
  let playerHasLeftZone = false;

  /** Always-active state machine. */
  let state = NPC_BEHAVIOUR_STATES.SEATED;
  let stateTimer = 0;

  function _emit(phase, distance) {
    if (lastDispatchedState === phase) return;
    lastDispatchedState = phase;
    dispatchInteraction(ANU_EVENTS.PLAYER_NPC_GREETING, {
      phase,
      playerId: "player_avatar",
      npcId,
      distance,
      tipi: { x: tipiCenter.x, z: tipiCenter.z },
    });
  }

  function _stepPositionToward(targetX, targetZ, delta) {
    const dx = targetX - root.position.x;
    const dz = targetZ - root.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return 0;
    const step = Math.min(WALK_SPEED_MPS * delta, dist);
    root.position.x += (dx / dist) * step;
    root.position.z += (dz / dist) * step;
    return dist - step; // remaining
  }

  function _stepYawToward(targetYaw, delta) {
    let cur = facingGroup.rotation.y;
    let diff = targetYaw - cur;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    const step = TURN_RATE_RAD_PER_S * delta;
    if (Math.abs(diff) <= step) {
      facingGroup.rotation.y = targetYaw;
      return 0;
    }
    facingGroup.rotation.y = cur + Math.sign(diff) * step;
    return Math.abs(diff) - step;
  }

  /**
   * @param {number} delta
   * @param {number} playerX
   * @param {number} playerZ
   */
  function update(delta, playerX, playerZ) {
    const ddx = playerX - tipiCenter.x;
    const ddz = playerZ - tipiCenter.z;
    const distToPlayer = Math.hypot(ddx, ddz);

    /**
     * Rising-edge bookkeeping. The moment the player is observed beyond
     * DEPART_DIST_M, mark the zone as "left". Only after that can a fresh
     * approach (player crossing back inside APPROACH_DIST_M) trigger the
     * SEATED → EXITING_WAVE transition. This guarantees she STARTS sitting
     * even if the player happens to spawn inside the trigger zone.
     */
    if (distToPlayer >= DEPART_DIST_M) playerHasLeftZone = true;

    // ── State transitions ──
    if (state === NPC_BEHAVIOUR_STATES.SEATED) {
      if (distToPlayer <= APPROACH_DIST_M && playerHasLeftZone) {
        state = NPC_BEHAVIOUR_STATES.EXITING_WAVE;
        stateTimer = actions.wave?.getClip()?.duration ?? 1.4;
        crossfadeTo("wave", 0.18);
        suppressPlayerAim = true;
        // Face the player while waving from the seat.
        desiredYaw = Math.atan2(ddx, ddz);
        playerHasLeftZone = false; // next cycle requires another rising edge
        _emit("approach", distToPlayer);
      }
    } else if (state === NPC_BEHAVIOUR_STATES.EXITING_WAVE) {
      stateTimer -= delta;
      desiredYaw = Math.atan2(playerX - root.position.x, playerZ - root.position.z);
      if (stateTimer <= 0) {
        state = NPC_BEHAVIOUR_STATES.EXITING_WALK;
        crossfadeTo("walk", 0.2);
        desiredYaw = Math.atan2(entranceWorldX - root.position.x, entranceWorldZ - root.position.z);
      }
    } else if (state === NPC_BEHAVIOUR_STATES.EXITING_WALK) {
      desiredYaw = Math.atan2(entranceWorldX - root.position.x, entranceWorldZ - root.position.z);
      const remaining = _stepPositionToward(entranceWorldX, entranceWorldZ, delta);
      // Step Y down to terrain as we walk off the deck.
      const groundY = getGroundY(root.position.x, root.position.z);
      root.position.y = THREE.MathUtils.lerp(root.position.y, groundY, Math.min(1, delta * 4));
      if (remaining <= 0.05) {
        state = NPC_BEHAVIOUR_STATES.STANDING_IDLE;
        crossfadeTo("idle", 0.3);
        _emit("arrived", distToPlayer);
        // From standing idle, the standard player-aim function may resume so
        // the NPC keeps tracking the player smoothly. Leaving suppression on
        // here means the behaviour overrides the aim each frame after, which
        // is fine — we just point the body at the player below.
      }
    } else if (state === NPC_BEHAVIOUR_STATES.STANDING_IDLE) {
      desiredYaw = Math.atan2(playerX - root.position.x, playerZ - root.position.z);
      if (distToPlayer >= DEPART_DIST_M) {
        state = NPC_BEHAVIOUR_STATES.RETURNING;
        crossfadeTo("walk", 0.2);
        _emit("depart", distToPlayer);
      }
    } else if (state === NPC_BEHAVIOUR_STATES.RETURNING) {
      desiredYaw = Math.atan2(seatPos.x - root.position.x, seatPos.z - root.position.z);
      const remaining = _stepPositionToward(seatPos.x, seatPos.z, delta);
      // Step Y back up onto the deck as we approach the seat. Lerp from
      // current Y toward the seat Y so she doesn't pop.
      root.position.y = THREE.MathUtils.lerp(root.position.y, seatPos.y, Math.min(1, delta * 4));
      if (remaining <= 0.05) {
        // Snap precisely back to seat XZ + Y so subsequent seated frames are
        // stable.
        root.position.x = seatPos.x;
        root.position.z = seatPos.z;
        root.position.y = seatPos.y;
        state = NPC_BEHAVIOUR_STATES.TURNAROUND_SIT;
        stateTimer = 0.6;
        // After turnaround, swap to sit clip. Begin turning toward the
        // original bind yaw (`seatModelYaw` lives on the inner mesh, but the
        // facing group is what `updateYellowButterflyPlayerAim` writes to —
        // so target yaw=0 on the facingGroup matches "default" bind).
        desiredYaw = 0;
      }
    } else if (state === NPC_BEHAVIOUR_STATES.TURNAROUND_SIT) {
      stateTimer -= delta;
      const remainingYaw = _stepYawToward(0, delta);
      if (remainingYaw <= 0.001 && stateTimer <= 0) {
        state = NPC_BEHAVIOUR_STATES.SEATED;
        crossfadeTo("sit", 0.4);
        // Hand the aim pivot back to `updateYellowButterflyPlayerAim`.
        suppressPlayerAim = false;
        _emit("returned", distToPlayer);
        lastDispatchedState = null; // ready for next approach cycle
      }
    }

    // ── Apply yaw (only when this controller owns the aim) ──
    if (suppressPlayerAim) {
      _stepYawToward(desiredYaw, delta);
    }
  }

  function getState() {
    return state;
  }

  function dispose() {
    for (const a of Object.values(actions)) {
      try { a.stop(); } catch {} // eslint-disable-line no-empty
    }
  }

  return Object.freeze({
    update,
    getState,
    dispose,
    /**
     * Read whether the behaviour wants `updateYellowButterflyPlayerAim` to
     * write to the facingGroup this frame. World.js gates the seated aim
     * call on this so the controller has uncontested ownership of the body
     * yaw while she's moving.
     */
    get suppressPlayerAim() { return suppressPlayerAim; },
    npcId,
  });
}
