import * as THREE from "three";
import { GLTFLoaderWithDraco } from "./gltfLoaderSetup.js";
import {
  ANU_INTERACTION_VERB,
  ANU_SIMULATION_DOMAIN,
} from "./anu/SimulationController.js";
import { dispatchInteraction } from "./anu/InteractionBus.js";
import { ANU_EVENTS } from "./anu/anuEvents.js";
import {
  V2_AVATAR_SOLES_GROUND_TRIM_M,
  V2_AVATAR_TARGET_HEIGHT_M,
  V2_AVATAR_TRAVEL_CIRCLE_LIFT_M,
  V2_AVATAR_TRAVEL_CIRCLE_RADIUS_M,
  V2_AVATAR_WALK_ANIM_REF_SPEED_MPS,
  V2_AVATAR_WALK_ANIM_TIME_SCALE_MAX,
  V2_AVATAR_WALK_ANIM_TIME_SCALE_MIN,
} from "./constants.js";

const AVATAR_TARGET_HEIGHT = V2_AVATAR_TARGET_HEIGHT_M;
const AVATAR_CIRCLE_RADIUS = V2_AVATAR_TRAVEL_CIRCLE_RADIUS_M;
const AVATAR_MODEL_YAW_OFFSET = Math.PI / 2;
const AVATAR_URL = "./Assets/Avatar3.glb";

export function createWorldAvatarController() {
  return {
    root: null,
    model: null,
    circle: null,
    arrow: null,
    mixer: null,
    actions: null,
    clips: [],
    semanticClips: null,
    currentAction: null,
    /** Last looping body state applied (`idle` | `walk` | `look`) — skips redundant cross-fades. */
    _locomotionKind: null,
    gestureUntil: 0,
    _onMixerFinished: null,

    async load(scene, objects) {
      try {
        const gltf = await new GLTFLoaderWithDraco().loadAsync(AVATAR_URL);
        const model = gltf.scene;
        model.rotation.y = AVATAR_MODEL_YAW_OFFSET;
        model.traverse((child) => {
          if (child.isMesh) {
            child.frustumCulled = true;
            child.castShadow = false;
            child.receiveShadow = false;
          }
        });

        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        if (size.y > 0.001) {
          const scale = AVATAR_TARGET_HEIGHT / size.y;
          model.scale.setScalar(scale);
          /** Soles on horizontal plane inside `root`; extra trim sinks mesh to kill hover. */
          model.position.y -= box.min.y * scale + V2_AVATAR_SOLES_GROUND_TRIM_M;
        }

        const root = new THREE.Group();
        root.name = "player_avatar_figurine";
        root.userData.anuId = "player.avatar.primary";
        root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;
        root.userData.anuKind = "avatar3_figurine";
        root.userData.anuInteractable = true;
        root.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.INSPECT];

        const disc = new THREE.Mesh(
          new THREE.CircleGeometry(AVATAR_CIRCLE_RADIUS, 72),
          new THREE.MeshBasicMaterial({
            color: 0x228b22,
            transparent: true,
            opacity: 0.28,
            depthWrite: false,
          }),
        );
        disc.name = "player_avatar_travel_circle";
        disc.rotation.x = -Math.PI / 2;
        disc.position.y = V2_AVATAR_TRAVEL_CIRCLE_LIFT_M;
        disc.userData.anuId = "player.avatar.travel_circle";
        disc.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;
        disc.userData.anuKind = "avatar_travel_circle";
        root.add(disc);

        const ring = new THREE.Mesh(
          new THREE.RingGeometry(AVATAR_CIRCLE_RADIUS * 0.92, AVATAR_CIRCLE_RADIUS, 96),
          new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.95,
            side: THREE.DoubleSide,
          }),
        );
        ring.name = "player_avatar_circle_outline";
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = V2_AVATAR_TRAVEL_CIRCLE_LIFT_M + 0.008;
        ring.userData.anuId = "player.avatar.travel_circle_outline";
        ring.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;
        ring.userData.anuKind = "avatar_travel_circle_outline";
        root.add(ring);

        const arrowShape = new THREE.Shape()
          .moveTo(0, AVATAR_CIRCLE_RADIUS * 0.92)
          .lineTo(AVATAR_CIRCLE_RADIUS * 0.22, AVATAR_CIRCLE_RADIUS * 0.52)
          .lineTo(-AVATAR_CIRCLE_RADIUS * 0.22, AVATAR_CIRCLE_RADIUS * 0.52)
          .lineTo(0, AVATAR_CIRCLE_RADIUS * 0.92);
        const arrow = new THREE.Mesh(
          new THREE.ShapeGeometry(arrowShape),
          new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.96,
            side: THREE.DoubleSide,
          }),
        );
        arrow.name = "player_avatar_facing_arrow";
        arrow.rotation.x = -Math.PI / 2;
        arrow.position.y = V2_AVATAR_TRAVEL_CIRCLE_LIFT_M + 0.015;
        arrow.userData.anuId = "player.avatar.facing_arrow";
        arrow.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;
        arrow.userData.anuKind = "avatar_facing_arrow";
        root.add(arrow);

        root.add(model);
        scene.add(root);
        objects.push(root);

        this.root = root;
        this.model = model;
        this.circle = disc;
        this.arrow = arrow;
        this.clips = gltf.animations.map((clip, index) =>
          Object.freeze({
            index,
            name: clip.name || `Avatar3Clip_${index}`,
            duration: Math.round(clip.duration * 1000) / 1000,
          }),
        );
        root.userData.anuAnimationClips = this.clips;
        this.setupAnimations(gltf.animations);
        this.play("idle", "load", 0);

        console.log("%c[World] Avatar3.glb installed as governed player avatar", "color:#90caf9;");
        console.table(this.clips);
        return root;
      } catch (err) {
        console.warn("[World] Avatar3.glb load failed:", err);
        return null;
      }
    },

    setupAnimations(clips) {
      this.mixer = this.model ? new THREE.AnimationMixer(this.model) : null;
      this.actions = {};
      this.semanticClips = {};
      if (!this.mixer || clips.length === 0) return;

      this._onMixerFinished = (e) => {
        const action = e.action;
        if (action?.clampWhenFinished) {
          this.gestureUntil = 0;
          this._locomotionKind = null;
        }
      };
      this.mixer.addEventListener("finished", this._onMixerFinished);

      clips.forEach((clip, index) => {
        const key = clip.name || `Avatar3Clip_${index}`;
        this.actions[key] = this.mixer.clipAction(clip);
      });

      this.semanticClips = {
        idle: clips[4]?.name ?? clips[0]?.name ?? null,
        /** Matches `look` — same NLA strip works for forward + pivot. */
        walk: clips[3]?.name ?? clips[1]?.name ?? null,
        look: clips[3]?.name ?? clips[2]?.name ?? clips[7]?.name ?? clips[0]?.name ?? null,
        wave: clips[6]?.name ?? clips[8]?.name ?? clips[0]?.name ?? null,
        goodbye: clips[6]?.name ?? clips[8]?.name ?? clips[0]?.name ?? null,
      };
      this.root.userData.anuAnimationMap = { ...this.semanticClips };
      this.root.userData.anuAnimationScan = {
        scannedClipCount: clips.length,
        findings: [
          "NlaTrack.004: mapped idle; quiet standing loop.",
          "NlaTrack.003: forward walk + turn-in-place (look); NlaTrack.001 fallback if missing.",
          "NlaTrack.007 (~15s) is a look fallback only if shorter clips are missing.",
          "NlaTrack.006: mapped wave/goodbye; strongest greeting gesture candidate.",
          "NlaTrack.008: very short alternate gesture; kept as fallback candidate.",
        ],
      };
    },

    play(kind, reason = "state", fade = 0.18, once = false) {
      if (!this.actions || !this.semanticClips) return;
      const clipName = this.semanticClips[kind] ?? kind;
      const next = this.actions[clipName];
      if (!next) return;
      if (next === this.currentAction && !once) {
        if (kind === "idle" || kind === "walk" || kind === "look") {
          this._locomotionKind = kind;
        }
        return;
      }

      const prev = this.currentAction;

      next.enabled = true;
      next.paused = false;
      next.reset();
      next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
      next.clampWhenFinished = once;
      // Incoming clip must be .play()ing before crossFadeFrom schedules its fade-in.
      next.play();
      if (prev && prev !== next) {
        next.crossFadeFrom(prev, fade, false);
      }
      this.currentAction = next;
      if (!once && (kind === "idle" || kind === "walk" || kind === "look")) {
        this._locomotionKind = kind;
      }
      if (this.root) {
        this.root.userData.anuActiveAnimation = { kind, clipName, reason, once };
      }
      dispatchInteraction(ANU_EVENTS.PLAYER_AVATAR_ANIMATION, {
        animation: kind,
        clipName,
        reason,
        t: typeof performance !== "undefined" ? performance.now() : 0,
      });
    },

    /** Apply idle / walk / look only when the desired state changes (reduces mixer fighting). */
    syncLocomotionIfNeeded(desiredKind, reason) {
      if (!this.actions || !this.semanticClips) return;
      if (this._locomotionKind === desiredKind) return;
      this.play(desiredKind, reason, 0.2, false);
    },

    /**
     * Match walk-cycle cadence to horizontal speed via AnimationAction timeScale.
     * Pivot (`look`) uses scale 1; resets when not forward-walking.
     */
    syncWalkAnimToHorizontalSpeed(horizontalSpeedMps, forwardWalkActive, now) {
      if (!this.actions || !this.semanticClips) return;
      const clipName = this.semanticClips.walk;
      if (!clipName) return;
      const walkAction = this.actions[clipName];
      if (!walkAction) return;

      const gestureBlocking = now < this.gestureUntil;
      if (gestureBlocking || !forwardWalkActive) {
        walkAction.setEffectiveTimeScale(1);
        return;
      }

      const ref = V2_AVATAR_WALK_ANIM_REF_SPEED_MPS;
      const spd = horizontalSpeedMps > 1e-4 ? horizontalSpeedMps : 0;
      const ts = Math.min(
        V2_AVATAR_WALK_ANIM_TIME_SCALE_MAX,
        Math.max(V2_AVATAR_WALK_ANIM_TIME_SCALE_MIN, spd / ref),
      );
      walkAction.setEffectiveTimeScale(ts);
    },

    triggerGesture(kind, reason, now) {
      const clipName = this.semanticClips?.[kind] ?? null;
      const duration = this.clips.find((clip) => clip.name === clipName)?.duration ?? 1.8;
      this._locomotionKind = null;
      this.gestureUntil = now + Math.min(2600, Math.max(900, duration * 1000));
      this.play(kind, reason, 0.12, true);
    },

    setPose(x, y, z, yaw) {
      if (!this.root) return;
      this.root.position.set(x, y, z);
      this.root.rotation.y = yaw;
    },

    advanceMixer(delta) {
      this.mixer?.update(delta);
    },

    update(delta, x, y, z, yaw) {
      this.setPose(x, y, z, yaw);
      this.advanceMixer(delta);
    },

    dispose() {
      if (this.mixer && this._onMixerFinished) {
        this.mixer.removeEventListener("finished", this._onMixerFinished);
        this._onMixerFinished = null;
      }
      this.mixer?.stopAllAction?.();
      this.root = null;
      this.model = null;
      this.circle = null;
      this.arrow = null;
      this.mixer = null;
      this.actions = null;
      this.clips = [];
      this.semanticClips = null;
      this.currentAction = null;
      this._locomotionKind = null;
      this.gestureUntil = 0;
    },
  };
}
