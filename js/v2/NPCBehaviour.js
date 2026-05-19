/**
 * Sacred Adventures v2 — tipi-owner proximity behaviour controller.
 *
 * Each tipi has an "owner" NPC. Today only NPC.YB (tipi 1) is wired, but the
 * controller is designed so future tipi owners can drop in without changing
 * World.js (one update-call per frame is already there for each tipi).
 *
 * Behaviour spec (May-2026 user request — wave moved from approach to depart;
 * May-12 follow-up widened the approach trigger from 1.0 → 1.5 tiles):
 *
 *   when player is within 1.5 tiles of tipi →
 *      NPC stands up and walks to a fixed entrance point in front of
 *      the tipi (no wave on approach). On arrival, swap to idle clip
 *      and watch the player.
 *
 *   while player is closer than 2 tiles      →
 *      remain standing/idle in front of the tipi, body yaw tracking
 *      the player so she's always watching.
 *
 *   when player passes 2 tiles               →
 *      NPC turns to face the player and plays the wave clip once
 *      (farewell gesture). When the wave finishes she walks back to
 *      her original seat position, turns around, plays the sit clip
 *      and is seated again.
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

/**
 * Player distance thresholds (m), keyed to the canonical hex tile.
 *
 * APPROACH_DIST_M was widened from 1.0 → 1.5 tiles per user request
 * (May-12 follow-up to the tipi-1 proximity tuning). The same constant
 * also gates the SPIRIT_WATCH → PLAYER_GREETING_WAVE transition
 * (sit → wave → idle when the player interrupts a spirit visit), so
 * both player-driven NPC triggers move together.
 *
 * DEPART_DIST_M stays at 2 tiles — hysteresis is now 0.5 tiles, which
 * still safely prevents flicker at the boundary.
 */
const APPROACH_DIST_M = V2_TILE_WORLD * 1.5;
const DEPART_DIST_M = V2_TILE_WORLD * 2;

const WALK_SPEED_MPS = 1.2;
const TURN_RATE_RAD_PER_S = Math.PI * 1.6;

/** Behaviour state names — also published in ANU_EVENTS.PLAYER_NPC_GREETING. */
export const NPC_BEHAVIOUR_STATES = Object.freeze({
  SEATED: "seated",
  /** Standing up + walking out to entrance (no wave — silent approach greet). */
  EXITING_WALK: "exiting_walk",
  /** Standing in front of tipi, body tracking player. */
  STANDING_IDLE: "standing_idle",
  /** Face player + play wave clip once as farewell, before walking back. */
  FAREWELL_WAVE: "farewell_wave",
  /** Walking back to original seat XZ + Y. */
  RETURNING: "returning",
  /** Turning back to neutral seat yaw, crossfading to sit clip. */
  TURNAROUND_SIT: "turnaround_sit",
  /**
   * Externally-triggered: the nature-spirit stag has arrived in front of
   * YB. She stays seated, faces the spirit's current XZ, and plays the wave
   * clip for a fixed 3 seconds (per user spec — overrides the wave-clip's
   * shorter native duration so the "greeting" reads clearly). Transitions
   * to SPIRIT_WATCH afterward; entered only from SEATED via
   * `playSpiritGreeting()`.
   */
  SPIRIT_WAVE: "spirit_wave",
  /**
   * Quiet watching pose: NPC stays seated, plays the idle clip, body yaw
   * tracks the spirit as it walks away. Ends naturally when the spirit is
   * more than 1 tile from YB (signalled via repeated `updateSpiritPos`
   * calls from the spirit controller), at which point she drops back to
   * SEATED. Can be interrupted by `notifyPlayerInterrupt()` if the player
   * crosses into YB's approach zone mid-visit.
   */
  SPIRIT_WATCH: "spirit_watch",
  /**
   * Player approached YB while she was mid spirit-visit. Body pivots to
   * face the player and plays the wave clip once. On clip end she drops
   * into STANDING_IDLE so the existing player-FSM (depart wave + return
   * to seat) takes over cleanly. Entered only from SPIRIT_WAVE / SPIRIT_WATCH
   * via `notifyPlayerInterrupt()`.
   */
  PLAYER_GREETING_WAVE: "player_greeting_wave",
  /**
   * Tutorial intro: seated wave toward the halted player (`World.beginJournalStartGameIntro`).
   * Blocks the normal seated→EXITING_WALK proximity path while `_skipProximityApproach`.
   */
  INTRO_TUTORIAL_GREET: "intro_tutorial_greet",
});

/**
 * Per-user spec (May 12 2026): the wave the NPC plays when the spirit
 * arrives must read as a clear 3-second greeting, longer than the native
 * wave clip (~1.4 s). The state's timer is pinned to this constant, with
 * the wave action looping during that window.
 */
/** May-14 2026 user spec: shorten the nature-spirit visit — YB's seated
 *  wave clip during a spirit pass was holding 3.0 s; trimmed to 1.5 s so
 *  her wave ends in step with the spirit's new shorter nod window. */
const SPIRIT_WAVE_DURATION_S = 1.5;
/** Seated greeting for journal “Start Game” — pinned like the spirit wave. */
const INTRO_TUTORIAL_GREET_S = 3.0;

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
  /** When true, seated YB ignores the proximity ring that pulls her toward the doorway. */
  let skipProximityApproach = false;

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

  /**
   * Last-known XZ for the nature-spirit (set by `playSpiritGreeting()`,
   * refreshed each frame by `updateSpiritPos()` while she's in
   * SPIRIT_WATCH). Used as both the yaw target and the distance reference
   * for the SPIRIT_WATCH → SEATED transition.
   */
  let spiritX = 0;
  let spiritZ = 0;
  /** Last-known XZ for an interrupting player (filled by notifyPlayerInterrupt). */
  let playerInterruptX = 0;
  let playerInterruptZ = 0;

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
      if (
        distToPlayer <= APPROACH_DIST_M &&
        playerHasLeftZone &&
        !skipProximityApproach
      ) {
        // Approach: skip the wave (per the user spec), stand up and walk
        // straight out to the entrance. Crossfade from sit → walk; the
        // mixer blends the rigs (no dedicated "stand up" clip exists).
        state = NPC_BEHAVIOUR_STATES.EXITING_WALK;
        crossfadeTo("walk", 0.3);
        suppressPlayerAim = true;
        desiredYaw = Math.atan2(
          entranceWorldX - root.position.x,
          entranceWorldZ - root.position.z,
        );
        playerHasLeftZone = false; // next cycle requires another rising edge
        _emit("approach", distToPlayer);
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
        // Depart: face the player and play the wave clip once as a
        // farewell gesture, BEFORE walking back to the seat. The user
        // wording was "wave while walking back" — implemented as
        // sequential (wave → walk) for clean animation read.
        state = NPC_BEHAVIOUR_STATES.FAREWELL_WAVE;
        stateTimer = actions.wave?.getClip()?.duration ?? 1.4;
        crossfadeTo("wave", 0.2);
        desiredYaw = Math.atan2(
          playerX - root.position.x,
          playerZ - root.position.z,
        );
        _emit("depart", distToPlayer);
      }
    } else if (state === NPC_BEHAVIOUR_STATES.FAREWELL_WAVE) {
      // Stationary, facing player, wave clip running on a LoopOnce.
      stateTimer -= delta;
      desiredYaw = Math.atan2(
        playerX - root.position.x,
        playerZ - root.position.z,
      );
      if (stateTimer <= 0) {
        state = NPC_BEHAVIOUR_STATES.RETURNING;
        crossfadeTo("walk", 0.2);
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
    } else if (state === NPC_BEHAVIOUR_STATES.SPIRIT_WAVE) {
      /**
       * 3 seconds of wave clip while seated, body yaw tracking the spirit's
       * current XZ (updated by the spirit controller each frame via
       * `updateSpiritPos`). After 3 s, transition to SPIRIT_WATCH — drop the
       * wave clip back to idle, keep body tracking the spirit.
       */
      stateTimer -= delta;
      desiredYaw = Math.atan2(spiritX - root.position.x, spiritZ - root.position.z);
      if (stateTimer <= 0) {
        state = NPC_BEHAVIOUR_STATES.SPIRIT_WATCH;
        crossfadeTo("idle", 0.35);
        // Restore wave to LoopOnce so the next FAREWELL_WAVE / PLAYER_GREETING_WAVE
        // pickup plays a single wave (we temporarily set LoopRepeat in
        // playSpiritGreeting so the 3-s window survives the shorter native clip).
        if (actions.wave) actions.wave.setLoop(THREE.LoopOnce, 1);
        _emit("spirit-watch", distToPlayer);
      }
    } else if (state === NPC_BEHAVIOUR_STATES.SPIRIT_WATCH) {
      /**
       * Quiet seated watch: idle clip, body yaw tracks the spirit while it
       * walks back to the forest. Two exits:
       *   1. Spirit > 1 tile from YB ("return to seating after the
       *      naturespirit leaves one tile" per user spec) → SEATED.
       *   2. Player arrives within YB's approach zone → PLAYER_GREETING_WAVE
       *      (self-promote — the spirit's player-priority check only covers
       *      FACE_YB / NOD / POST_NOD_HOLD; by the time YB is in WATCH the
       *      spirit is already leaving and won't call notifyPlayerInterrupt
       *      again, so YB owns the player-detection here).
       */
      desiredYaw = Math.atan2(spiritX - root.position.x, spiritZ - root.position.z);
      if (distToPlayer <= APPROACH_DIST_M) {
        state = NPC_BEHAVIOUR_STATES.PLAYER_GREETING_WAVE;
        playerInterruptX = playerX;
        playerInterruptZ = playerZ;
        desiredYaw = Math.atan2(playerX - root.position.x, playerZ - root.position.z);
        if (actions.wave) {
          actions.wave.setLoop(THREE.LoopOnce, 1);
          actions.wave.reset();
        }
        stateTimer = actions.wave?.getClip()?.duration ?? 1.4;
        crossfadeTo("wave", 0.2);
        _emit("player-interrupt", distToPlayer);
      } else {
        const dxSpirit = spiritX - root.position.x;
        const dzSpirit = spiritZ - root.position.z;
        const distSpiritSq = dxSpirit * dxSpirit + dzSpirit * dzSpirit;
        if (distSpiritSq > V2_TILE_WORLD * V2_TILE_WORLD) {
          state = NPC_BEHAVIOUR_STATES.SEATED;
          crossfadeTo("sit", 0.4);
          suppressPlayerAim = false;
          lastDispatchedState = null;
          _emit("spirit-departed", distToPlayer);
        }
      }
    } else if (state === NPC_BEHAVIOUR_STATES.INTRO_TUTORIAL_GREET) {
      /**
       * Journal Start Game cue: seated wave toward the halted player — fixed duration.
       */
      stateTimer -= delta;
      desiredYaw = Math.atan2(playerX - root.position.x, playerZ - root.position.z);
      suppressPlayerAim = true;
      if (stateTimer <= 0) {
        state = NPC_BEHAVIOUR_STATES.SEATED;
        crossfadeTo("sit", 0.35);
        suppressPlayerAim = false;
        if (actions.wave) actions.wave.setLoop(THREE.LoopOnce, 1);
        lastDispatchedState = null;
      }
    } else if (state === NPC_BEHAVIOUR_STATES.PLAYER_GREETING_WAVE) {
      /**
       * Player arrived during a spirit visit. Spirit has already been told
       * to leave; YB faces the player and plays one wave. On clip end she
       * drops into STANDING_IDLE so the existing player-FSM (FAREWELL_WAVE
       * on depart → RETURNING → TURNAROUND_SIT) picks up cleanly. Note:
       * YB stays at her seat XZ throughout — she never walks out for this
       * path (per user spec: "face player and wave 1x animation and then
       * idle").
       */
      stateTimer -= delta;
      desiredYaw = Math.atan2(
        playerInterruptX - root.position.x,
        playerInterruptZ - root.position.z,
      );
      if (stateTimer <= 0) {
        state = NPC_BEHAVIOUR_STATES.STANDING_IDLE;
        crossfadeTo("idle", 0.25);
        playerHasLeftZone = false;
        _emit("player-greet", distToPlayer);
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

  /**
   * Externally driven greeting: the nature-spirit has arrived in front of
   * YB. She stays seated, pivots her facing group toward the spirit's
   * current XZ, and plays her wave clip for a fixed `SPIRIT_WAVE_DURATION_S`
   * (3 s — overrides the wave clip's native duration so the greeting reads
   * as a clear hello before she drops into SPIRIT_WATCH). The wave action
   * is forced to LoopRepeat for this state so the clip survives the 3-s
   * window even though it's shorter natively.
   *
   * Returns `true` if the trigger was accepted (NPC was SEATED), `false`
   * if she's currently in another state (player-greeting cycle, etc.)
   * — the spirit controller falls back to its non-greeting timing path.
   */
  function playSpiritGreeting(targetX, targetZ) {
    if (state !== NPC_BEHAVIOUR_STATES.SEATED) return false;
    state = NPC_BEHAVIOUR_STATES.SPIRIT_WAVE;
    stateTimer = SPIRIT_WAVE_DURATION_S;
    suppressPlayerAim = true;
    spiritX = targetX;
    spiritZ = targetZ;
    desiredYaw = Math.atan2(targetX - root.position.x, targetZ - root.position.z);
    // Wave clip is LoopOnce by default for the depart farewell; for the
    // longer 3-s spirit greeting we want it to loop, then we crossfade
    // back to idle on timer end.
    if (actions.wave) actions.wave.setLoop(THREE.LoopRepeat, Infinity);
    crossfadeTo("wave", 0.25);
    return true;
  }

  /**
   * Fed by the spirit controller each frame while the spirit is on stage —
   * the SPIRIT_WATCH state uses this to track its target yaw and to detect
   * when the spirit is more than 1 tile away (the natural end of the
   * watching state, after which YB returns to her sit clip). No-op outside
   * the spirit-visit states so the spirit can keep calling unconditionally.
   */
  function updateSpiritPos(x, z) {
    spiritX = x;
    spiritZ = z;
  }

  function notifyPlayerInterrupt(targetX, targetZ) {
    if (
      state !== NPC_BEHAVIOUR_STATES.SPIRIT_WAVE &&
      state !== NPC_BEHAVIOUR_STATES.SPIRIT_WATCH
    ) {
      return false;
    }
    state = NPC_BEHAVIOUR_STATES.PLAYER_GREETING_WAVE;
    playerInterruptX = targetX;
    playerInterruptZ = targetZ;
    desiredYaw = Math.atan2(targetX - root.position.x, targetZ - root.position.z);
    suppressPlayerAim = true;
    // For the 1× player greeting we want the original LoopOnce semantics
    // back — one full wave then transition. Restore default on the action
    // before crossfading in.
    if (actions.wave) {
      actions.wave.setLoop(THREE.LoopOnce, 1);
      actions.wave.reset();
    }
    const waveDur = actions.wave?.getClip()?.duration ?? 1.4;
    stateTimer = waveDur;
    crossfadeTo("wave", 0.2);
    _emit("player-interrupt", Math.hypot(targetX - tipiCenter.x, targetZ - tipiCenter.z));
    return true;
  }

  /** Suppress the seated proximity pull that sends YB to the doorway (journal intro lane). */
  function setIntroProximitySuppressed(flag) {
    skipProximityApproach = !!flag;
  }

  /**
   * Seated greeting for scripted journal Start Game — player halts south of rim.
   * @returns {boolean}
   */
  function triggerIntroTutorialGreet(_playerX, _playerZ) {
    if (state !== NPC_BEHAVIOUR_STATES.SEATED) return false;
    state = NPC_BEHAVIOUR_STATES.INTRO_TUTORIAL_GREET;
    stateTimer = INTRO_TUTORIAL_GREET_S;
    suppressPlayerAim = true;
    desiredYaw = Math.atan2(_playerX - root.position.x, _playerZ - root.position.z);
    if (actions.wave) actions.wave.setLoop(THREE.LoopRepeat, Infinity);
    crossfadeTo("wave", 0.2);
    return true;
  }

  return Object.freeze({
    update,
    getState,
    playSpiritGreeting,
    updateSpiritPos,
    notifyPlayerInterrupt,
    setIntroProximitySuppressed,
    triggerIntroTutorialGreet,
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
