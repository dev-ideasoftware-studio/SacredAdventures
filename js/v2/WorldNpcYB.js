import * as THREE from "three";
import { GLTFLoaderWithDraco } from "./gltfLoaderSetup.js";
import {
  ANU_INTERACTION_VERB,
  ANU_SIMULATION_DOMAIN,
} from "./anu/SimulationController.js";
import { ANU_EVENTS } from "./anu/anuEvents.js";
import { dispatchInteraction } from "./anu/InteractionBus.js";
import {
  V2_NPC_YB_MEET_OFFSET_M,
  V2_NPC_YB_TARGET_HEIGHT_M,
  V2_TIPI_FAREWELL_RADIUS_M,
  V2_TIPI_GREET_INNER_RADIUS_M,
  V2_TIPI_GREET_RADIUS_M,
} from "./constants.js";

const NPC_URL = "./Assets/NPC.YB.glb";

/** GLB forward `+world Z` after this offset is applied — yaw from `faceToward` matches gameplay south. */
const MODEL_YAW_FIX = -Math.PI / 2;
/** Extra downward offset after bbox align (pivot vs seat contact). */
const MODEL_SEAT_SINK_M = 0.085;

const ARRIVE_EPS = 0.14;

// ─── FSM states ──────────────────────────────────────────────────────────────
const STATE = Object.freeze({
  SITTING: "SITTING",
  GREETING_WAVE: "GREETING_WAVE",
  GREETING_WALK: "GREETING_WALK",
  MEETING: "MEETING",
  WATCHING: "WATCHING",
  RETURNING: "RETURNING",
});

/** Hold the wave loop standing at home for this long before walking south. */
const WAVE_HOLD_MS = 1700;
/** Walk from tipi center to the south meet spot after the wave. */
const WALK_OUT_SPEED_MPS = 0.95;
/** Walk-back-home speed once player has left the encounter band entirely. */
const WALK_HOME_SPEED_MPS = 0.95;
const ROTATION_LERP_RATE = 3.0;
const Y_LERP_RATE = 5.0;
/** Slight lift so the seat does not Z-fight the platform. */
const GROUND_LIFT_M = 0.02;

// ─── Clip resolution helpers ─────────────────────────────────────────────────
function clipLower(c) {
  return String(c?.name ?? "").toLowerCase();
}

function pickClipName(clips, keywords, fallbackIndex, excludeSubstrings = []) {
  if (!clips?.length) return null;
  const excluded = (name) =>
    excludeSubstrings.some((s) => clipLower({ name }).includes(s));
  for (const kw of keywords) {
    const hit = clips.find(
      (cl) => !excluded(cl.name) && clipLower(cl).includes(kw),
    );
    if (hit?.name) return hit.name;
  }
  return clips[fallbackIndex]?.name ?? clips[0]?.name ?? null;
}

/** True when every clip name is generic (e.g. Blender NLA export "NlaTrack.00n") — keywords never match. */
function clipsAreAnonymouslyNamed(clips) {
  if (!clips?.length) return false;
  return clips.every((c) => /^nlatrack(\.|$)/i.test(String(c.name ?? "")));
}

/**
 * NPC.YB.glb ships as NlaTrack.* only — map by duration:
 *   shortest    → wave (gesture)
 *   longest     → sit
 *   2nd shortest → idleStand
 *   2nd longest  → walk (full cycle)
 *   middle      → watch (when ≥ 5 tracks; else fall back to idleStand)
 */
function semanticFromAnonymousNlaTracks(clips) {
  const sorted = [...clips].sort((a, b) => a.duration - b.duration);
  const n = sorted.length;
  const wave = sorted[0]?.name ?? null;
  const sit = sorted[n - 1]?.name ?? null;
  const rest = sorted.slice(1, -1);
  if (rest.length === 0)
    return { wave, sit, idleStand: wave, walk: wave, watch: wave };
  if (rest.length === 1)
    return {
      wave,
      sit,
      idleStand: rest[0].name,
      walk: rest[0].name,
      watch: rest[0].name,
    };
  const idleStand = rest[0].name;
  const walk = rest[rest.length - 1].name;
  const watch = rest.length >= 3 ? rest[Math.floor(rest.length / 2)].name : idleStand;
  return { wave, sit, idleStand, walk, watch };
}

/**
 * Yellow Butterfly tipi NPC (`NPC.YB.glb`). Hosted at tipi 1, default `SITTING` at the centre.
 *
 * Proximity FSM (radii from the tipi anchor):
 *   SITTING        → d ≤ 2 tiles      → GREETING_WAVE  (wave from current sitting animation)
 *   GREETING_WAVE  → wave timer       → GREETING_WALK  (walk south 5 ft, no collider)
 *   GREETING_WALK  → arrived          → MEETING        (idle stand at meet spot, face player)
 *   MEETING        → d > 1 tile       → WATCHING       (look animation, still face player)
 *   WATCHING       → d ≤ 1 tile       → MEETING        (relax back to idle hold)
 *   WATCHING       → d > 3 tiles      → RETURNING      (walk back to tipi centre)
 *   MEETING        → d > 3 tiles      → RETURNING      (skip-WATCHING fast leave)
 *   RETURNING      → arrived home     → SITTING        (resume default seated)
 * NPC has **no physics collider** by design, so the requested “remove any collision” state is true
 * throughout this proximity sequence.
 */
export function createWorldNpcYBController() {
  return {
    root: null,
    model: null,
    mixer: null,
    actions: null,
    semantic: null,
    currentAction: null,
    _loco: null,
    state: STATE.SITTING,

    home: new THREE.Vector3(),
    meetSpot: new THREE.Vector3(),
    _tmpV: new THREE.Vector3(),

    _terrainY: null,
    _anchorX: 0,
    _anchorZ: 0,
    _platformRimM: 4,

    // Greet timing
    _greetingWaveUntilMs: 0,

    async load(scene, objects, { terrainY, anchorX, anchorZ, platformRimM }) {
      try {
        const gltf = await new GLTFLoaderWithDraco().loadAsync(NPC_URL);
        const model = gltf.scene;
        model.rotation.y = MODEL_YAW_FIX;

        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        if (size.y > 0.001) {
          const sc = V2_NPC_YB_TARGET_HEIGHT_M / size.y;
          model.scale.setScalar(sc);
          model.position.y -= box.min.y * sc + MODEL_SEAT_SINK_M;
        }

        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = false;
            child.receiveShadow = true;
            child.frustumCulled = true;
          }
        });

        const root = new THREE.Group();
        root.name = "population_npc_yellow_butterfly";
        root.userData.anuId = "population.npc.yellow_butterfly";
        root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
        root.userData.anuKind = "npc_yb_tipi_host";
        root.userData.anuInteractable = true;
        root.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.INSPECT];
        root.userData.anuCollision = "passable";
        root.userData.anuCollisionReason =
          "YB host has no physics collider during proximity sequence.";

        this._terrainY = terrainY;
        this._anchorX = anchorX;
        this._anchorZ = anchorZ;
        this._platformRimM = Math.max(0.35, platformRimM ?? 3.5);

        // Default home = centre of tipi. Meet spot = home + 5 ft south (+Z).
        const homeY = terrainY(anchorX, anchorZ);
        this.home.set(anchorX, homeY + GROUND_LIFT_M, anchorZ);
        const meetZ = anchorZ + V2_NPC_YB_MEET_OFFSET_M;
        const meetY = terrainY(anchorX, meetZ);
        this.meetSpot.set(anchorX, meetY + GROUND_LIFT_M, meetZ);

        root.position.copy(this.home);
        root.add(model);
        scene.add(root);
        objects.push(root);

        this.root = root;
        this.model = model;
        this._setupMixer(gltf.animations);

        // Inspect verb: replay the greet sequence from current player position guess.
        const self = this;
        root.userData.anuPlayGesture = (tag) => {
          if (tag === "wave_hello" || tag === "wave") {
            self._enterGreetingWave(performance.now());
          }
        };

        console.log(
          "%c[World] NPC.YB tipi host installed",
          "color:#ce93d8;",
        );
        return root;
      } catch (e) {
        console.warn("[World] NPC.YB load failed:", e);
        return null;
      }
    },

    _setupMixer(clips) {
      if (!clips?.length || !this.model) return;
      this.mixer = new THREE.AnimationMixer(this.model);
      this.actions = {};
      clips.forEach((clip, i) => {
        const k = clip.name || `NPC_YB_${i}`;
        this.actions[k] = this.mixer.clipAction(clip);
      });

      const fb = { sit: 3, idleStand: 2, walk: 1, wave: 4, watch: 2 };
      const anonymous = clipsAreAnonymouslyNamed(clips);
      this.semantic = anonymous
        ? semanticFromAnonymousNlaTracks(clips)
        : {
            sit: pickClipName(clips, ["sit", "seated", "ground"], fb.sit),
            idleStand: pickClipName(
              clips,
              ["idle", "stand", "neutral"],
              fb.idleStand,
              ["sit", "seated"],
            ),
            walk: pickClipName(
              clips,
              ["walk", "jog", "locom", "forward", "move"],
              fb.walk,
              ["in_place", "inplace", "idle", "strafe", "turn"],
            ),
            wave: pickClipName(clips, ["wave", "greet", "hello", "hand"], fb.wave),
            watch: pickClipName(
              clips,
              ["look", "watch", "observe", "search", "guard", "alert"],
              fb.watch,
              ["sit", "seated", "walk", "wave"],
            ),
          };

      if (!anonymous) {
        for (const key of Object.keys(this.semantic)) {
          if (!this.semantic[key])
            this.semantic[key] = clips[fb[key]]?.name ?? clips[0]?.name;
        }
      }
      for (const key of Object.keys(this.semantic)) {
        if (!this.semantic[key])
          this.semantic[key] = clips[0]?.name ?? null;
      }
      // If `watch` collapsed to `idleStand`, that's expected — face-toward differentiates the read.
      if (!this.semantic.watch) this.semantic.watch = this.semantic.idleStand;

      if (typeof console !== "undefined" && console.table) {
        const rows = Object.entries(this.semantic).map(([role, name]) => {
          const c = clips.find((x) => x.name === name);
          return { role, clip: name, duration: c?.duration?.toFixed?.(2) ?? "?" };
        });
        console.table(rows);
        if (anonymous) {
          console.log(
            "%c[NPC.YB] NlaTrack-only rig — semantics chosen by duration (wave=shortest, sit=longest, watch=middle).",
            "color:#80deea;",
          );
        }
      }

      this._playClip("sit", "spawn", 0);
      this.state = STATE.SITTING;
    },

    // ─── Animation playback ───────────────────────────────────────────────────
    _clipAction(kind) {
      const name = this.semantic?.[kind];
      return name ? this.actions?.[name] : null;
    },

    _playClip(kind, reason, fade) {
      if (!this.actions || !this.semantic) return;
      const next = this._clipAction(kind);
      if (!next) return;
      if (next === this.currentAction) {
        this._loco = kind;
        return;
      }
      const prev = this.currentAction;
      next.enabled = true;
      next.paused = false;
      next.reset();
      next.setEffectiveTimeScale(1);
      next.setLoop(THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = false;
      next.play();
      if (prev && prev !== next) {
        next.crossFadeFrom(prev, fade, false);
      }
      this.currentAction = next;
      this._loco = kind;
      dispatchInteraction(ANU_EVENTS.NPC_ENTITY, {
        phase: "animation",
        npcId: "population.npc.yellow_butterfly",
        kind,
        reason,
        state: this.state,
        t: typeof performance !== "undefined" ? performance.now() : 0,
      });
    },

    // ─── Facing & motion ──────────────────────────────────────────────────────
    /** Smooth rotation toward (`tx`,`tz`) at `ROTATION_LERP_RATE` rad/s. */
    _smoothFaceToward(tx, tz, delta) {
      if (!this.root) return;
      const dx = tx - this.root.position.x;
      const dz = tz - this.root.position.z;
      if (dx * dx + dz * dz < 1e-6) return;
      const target = Math.atan2(dx, dz);
      let diff = target - this.root.rotation.y;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      this.root.rotation.y += diff * ROTATION_LERP_RATE * delta;
    },

    _stepToward(target, delta, speedMps) {
      this._tmpV.set(target.x - this.root.position.x, 0, target.z - this.root.position.z);
      const len = this._tmpV.length();
      if (len < 1e-5) return;
      const step = Math.min(speedMps * delta, len);
      this._tmpV.multiplyScalar(step / len);
      this.root.position.x += this._tmpV.x;
      this.root.position.z += this._tmpV.z;
    },

    _distToMeet() {
      if (!this.root) return 0;
      const dx = this.meetSpot.x - this.root.position.x;
      const dz = this.meetSpot.z - this.root.position.z;
      return Math.sqrt(dx * dx + dz * dz);
    },

    _distToHome() {
      if (!this.root) return 0;
      const dx = this.home.x - this.root.position.x;
      const dz = this.home.z - this.root.position.z;
      return Math.sqrt(dx * dx + dz * dz);
    },

    // ─── State entry helpers ──────────────────────────────────────────────────
    _enterGreetingWave(nowMs) {
      if (this.state === STATE.GREETING_WAVE) return;
      this.state = STATE.GREETING_WAVE;
      this._greetingWaveUntilMs = nowMs + WAVE_HOLD_MS;
      this._playClip("wave", "greet-wave-enter", 0.18);
    },

    _enterGreetingWalk() {
      this.state = STATE.GREETING_WALK;
      this._playClip("walk", "greet-walk-south", 0.22);
    },

    _enterMeeting() {
      this.state = STATE.MEETING;
      this.root.position.x = this.meetSpot.x;
      this.root.position.z = this.meetSpot.z;
      this._playClip("idleStand", "meeting-idle", 0.16);
    },

    _enterWatching() {
      this.state = STATE.WATCHING;
      this._playClip("watch", "watching-look", 0.18);
    },

    _enterReturning() {
      this.state = STATE.RETURNING;
      this._playClip("walk", "returning-home", 0.18);
    },

    _enterSitting() {
      this.state = STATE.SITTING;
      this.root.position.x = this.home.x;
      this.root.position.z = this.home.z;
      this._playClip("sit", "home-sit", 0.18);
    },

    // ─── Public proximity hook (called from World every frame) ───────────────
    /**
     * @param {number} tipiDistance — player → tipi anchor distance (metres).
     * @param {boolean} _legacyFar — kept for API compat; ignored (use `tipiDistance`).
     * @param {{x:number,z:number}} _playerFeet — unused; we read from `update()`'s ctx.
     * @param {number} _nowMs
     */
    syncEncounterBand(tipiDistance, _legacyFar, _playerFeet, _nowMs = 0) {
      if (!this.root || !this.actions || !this.semantic) return;

      const farOut = tipiDistance > V2_TIPI_FAREWELL_RADIUS_M;
      const inGreet = tipiDistance <= V2_TIPI_GREET_RADIUS_M;
      const inInner = tipiDistance <= V2_TIPI_GREET_INNER_RADIUS_M;

      if (farOut) {
        if (
          this.state === STATE.GREETING_WAVE ||
          this.state === STATE.GREETING_WALK ||
          this.state === STATE.MEETING ||
          this.state === STATE.WATCHING
        ) {
          this._enterReturning();
        }
        return;
      }

      // Player still inside encounter envelope.
      if (this.state === STATE.SITTING && inGreet) {
        this._enterGreetingWave(
          typeof performance !== "undefined" ? performance.now() : 0,
        );
        return;
      }
      if (this.state === STATE.RETURNING && inGreet) {
        // Player came back during walk-home — restart the greet sequence.
        this._enterGreetingWave(
          typeof performance !== "undefined" ? performance.now() : 0,
        );
        return;
      }

      if (this.state === STATE.MEETING && !inInner) {
        this._enterWatching();
        return;
      }
      if (this.state === STATE.WATCHING && inInner) {
        this._enterMeeting();
        return;
      }
    },

    // ─── Per-frame integration ────────────────────────────────────────────────
    /**
     * @param {number} delta
     * @param {{ playerFeet: {x:number;y:number;z:number}; terrainY: (x:number,z:number)=>number; now:number; playerInGreetBand?: boolean }} ctx
     */
    update(delta, ctx) {
      if (!this.root || !this.mixer) return;
      const { playerFeet, terrainY, now } = ctx;

      // Smooth-lerp Y to ground (legacy `5 * delta` rate).
      const groundY = terrainY(this.root.position.x, this.root.position.z) + GROUND_LIFT_M;
      this.root.position.y += (groundY - this.root.position.y) * Y_LERP_RATE * delta;

      switch (this.state) {
        case STATE.GREETING_WAVE: {
          this._smoothFaceToward(playerFeet.x, playerFeet.z, delta);
          if (typeof now === "number" && now >= this._greetingWaveUntilMs) {
            this._enterGreetingWalk();
          }
          break;
        }
        case STATE.GREETING_WALK: {
          this._smoothFaceToward(this.meetSpot.x, this.meetSpot.z, delta);
          this._stepToward(this.meetSpot, delta, WALK_OUT_SPEED_MPS);
          if (this._distToMeet() < ARRIVE_EPS) {
            this._enterMeeting();
          }
          break;
        }
        case STATE.MEETING: {
          this._smoothFaceToward(playerFeet.x, playerFeet.z, delta);
          break;
        }
        case STATE.WATCHING: {
          this._smoothFaceToward(playerFeet.x, playerFeet.z, delta);
          break;
        }
        case STATE.RETURNING: {
          this._smoothFaceToward(this.home.x, this.home.z, delta);
          this._stepToward(this.home, delta, WALK_HOME_SPEED_MPS);
          if (this._distToHome() < ARRIVE_EPS) {
            this._enterSitting();
          }
          break;
        }
        case STATE.SITTING:
        default: {
          if (this._loco !== "sit") this._playClip("sit", "sit-idle", 0.14);
          break;
        }
      }

      this.mixer.update(delta);
    },

    // ─── Test / tooling read-only snapshot ───────────────────────────────────
    /** Stable shape for `peekNpcYbEncounterState()` consumers. */
    snapshot() {
      return {
        state: this.state,
        loco: this._loco,
        distToMeet: this._distToMeet(),
        distToHome: this._distToHome(),
        px: this.root?.position.x ?? null,
        pz: this.root?.position.z ?? null,
      };
    },

    dispose(scene, objects) {
      this.mixer?.stopAllAction?.();
      if (this.root) {
        scene.remove(this.root);
        const ix = objects.indexOf(this.root);
        if (ix >= 0) objects.splice(ix, 1);
      }
      this.root = null;
      this.model = null;
      this.mixer = null;
      this.actions = null;
      this.semantic = null;
      this.currentAction = null;
      this._loco = null;
      this.state = STATE.SITTING;
    },
  };
}

export const NPC_YB_STATE = STATE;
