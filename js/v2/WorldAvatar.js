import * as THREE from "three";
import { GLTFLoaderWithDraco } from "./gltfLoaderSetup.js";
import {
  ANU_INTERACTION_VERB,
  ANU_SIMULATION_DOMAIN,
} from "./anu/SimulationController.js";
import { dispatchInteraction } from "./anu/InteractionBus.js";
import { ANU_EVENTS } from "./anu/anuEvents.js";
import {
  V2_AVATAR_MODEL_YAW_RAD,
  V2_AVATAR_SOLES_GROUND_TRIM_M,
  V2_AVATAR_TARGET_HEIGHT_M,
  V2_AVATAR_TRAVEL_CIRCLE_RADIUS_M,
  V2_AVATAR_WALK_ANIM_REF_SPEED_MPS,
  V2_AVATAR_WALK_ANIM_TIME_SCALE_MAX,
  V2_AVATAR_WALK_ANIM_TIME_SCALE_MIN,
} from "./constants.js";
import {
  createPhotorealTravelDiscMaterial,
  createPhotorealTravelRingMaterial,
  touchTravelCircleTime,
} from "./anu/TravelFloorCircleMaterials.js";

const AVATAR_TARGET_HEIGHT = V2_AVATAR_TARGET_HEIGHT_M;
const AVATAR_CIRCLE_RADIUS = V2_AVATAR_TRAVEL_CIRCLE_RADIUS_M;
/** After `syncDecalsToTerrainSlope`: rim-height rise + this — kept small so decal stays under soles, above terrain/z-fights. */
const TRAVEL_DECAL_CLEAR_ABOVE_RIM_M = 0.015;
let AVATAR_URL = "./Assets/npc/Avatar-New.glb";
if (typeof window !== "undefined" && window.location.href.includes("avatar=old")) {
  AVATAR_URL = "./Assets/Avatar3.glb";
}
/** Travel disc / ring / arrow use renderOrder 8–10; figurine draws after (opaque pass). */
const AVATAR_FIGURINE_RENDER_ORDER = 18;
/**
 * vs Flora: trees use a small **positive** `polygonOffsetUnits` on wood/leaves so
 * swaying bark/alpha foliage loses coincident depth fights; the avatar uses a
 * stronger **negative** units pull so her shell wins when geometry interleaves.
 */
const AVATAR_POLYGON_OFFSET_UNITS = -24;
/** Inflate the Tripo shell slightly along skinned normals to split overlapping chin/cheek triangles. */
const AVATAR_INTERNAL_SHELL_MODEL_UNITS = 0.00055;

/**
 * Returns a CLONE of `clip` with every `.position` keyframe track stripped.
 * Used to convert a forward-locomotion clip (root-motion baked on the hips)
 * into an in-place cycle — joints animate exactly as authored, but every
 * bone with a position track stops translating relative to the model root.
 *
 * Why this exists (user report May-12 2026: "walking animation has the
 * AVATAR moving forward back and forth"):
 *   Avatar3.glb's walk clip (NlaTrack.003 / clips[3]) has root-motion
 *   tracks on the hips. `PlayerController` drives world position from
 *   velocity each frame, so the clip's translation stacks on top of the
 *   engine's translation — visible as the avatar drifting forward over
 *   the cycle and snapping back at the loop boundary. Stripping the
 *   `.position` tracks from the locomotion clips ONLY (walk + look) lets
 *   the engine own translation and the clip own pose; idle / wave /
 *   goodbye keep their tracks intact in case they were authored with
 *   intentional micro-translation (breathing, weight-shift, etc.).
 *
 * The clone is non-negotiable: `clip.clone()` produces fresh `KeyframeTrack`
 * instances, so reassigning `out.tracks = keep` only affects the new clip.
 * Mutating `clip.tracks` directly would propagate to any other consumer
 * holding the same gltf.animations[i] reference (e.g. Anu inventory
 * snapshots, future re-bindings).
 *
 * @param {THREE.AnimationClip} clip
 * @returns {THREE.AnimationClip}
 */
function _stripPositionTracks(clip) {
  if (!clip || !clip.tracks) return clip;
  const keep = clip.tracks.filter(
    (track) => !track.name.endsWith(".position"),
  );
  if (keep.length === clip.tracks.length) return clip;
  const out = clip.clone();
  out.tracks = keep;
  return out;
}

export function createWorldAvatarController() {
  return {
    root: null,
    model: null,
    circle: null,
    arrow: null,
    _travelRingMesh: null,
    mixer: null,
    actions: null,
    clips: [],
    semanticClips: null,
    currentAction: null,
    /** Last looping body state applied (`idle` | `walk` | `look`) — skips redundant cross-fades. */
    _locomotionKind: null,
    gestureUntil: 0,
    _onMixerFinished: null,
    /** @type {null | { mesh: THREE.Mesh; mats: { m: THREE.Material; depthTest: boolean; depthWrite: boolean }[] }[]} */
    _cineFigurineBackup: null,
    /**
     * Current uniform scale applied to the travel disc / ring / arrow.
     * 1.0 in FPV, `MAP_VIEW_TRAVEL_MARKER_SCALE` in top-down map view. Read by
     * `syncDecalsToTerrainSlope` so the slope probe radius matches the
     * rendered ring footprint — otherwise the larger scaled-up ring can
     * intersect terrain inside its actual extent and visibly clip
     * (May-14 2026 user spec: "make sure it doesn't clip the ground").
     */
    _mapViewScale: 1.0,

    /**
     * While the orbit camera can tuck behind trees, match the travel-floor
     * decal read (TravelFloorCircleMaterials — `depthTest: false`) on the
     * Avatar3 mesh only so the figurine stays visible through foliage.
     * This can reopen brief decal-vs-body shimmer where the HUD clears
     * depth writes; restores on cinematic exit.
     */
    setCinematicIdleFigurineDrawThrough(enabled) {
      if (!this.model) return;
      if (enabled) {
        if (this._cineFigurineBackup) return;
        const entries = [];
        this.model.traverse((ch) => {
          if (!ch.isMesh) return;
          const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
          const matsBackup = [];
          for (const m of mats) {
            if (!m) continue;
            matsBackup.push({
              m,
              depthTest: m.depthTest,
              depthWrite: m.depthWrite,
            });
            m.depthTest = false;
            m.depthWrite = false;
          }
          if (matsBackup.length === 0) return;
          entries.push({
            mesh: ch,
            mats: matsBackup,
          });
        });
        this._cineFigurineBackup = entries.length ? entries : null;
        return;
      }
      const b = this._cineFigurineBackup;
      if (!b) return;
      for (const row of b) {
        for (const { m, depthTest, depthWrite } of row.mats) {
          m.depthTest = depthTest;
          m.depthWrite = depthWrite;
        }
      }
      this._cineFigurineBackup = null;
    },

    async load(scene, objects) {
      try {
        const gltf = await new GLTFLoaderWithDraco().loadAsync(AVATAR_URL);
        const model = gltf.scene;
        model.rotation.y = V2_AVATAR_MODEL_YAW_RAD;
        /**
         * May-15 2026 forensic table ("face has all this weird transparency
         * and growths coming from front 45% of the avatar"). Probe every
         * mesh + material BEFORE we mutate anything so the console row
         * reflects the GLB-as-shipped, not our patched version. If the
         * "growths" are extra Tripo sub-meshes (decorative feathers,
         * beadwork, headdress cards) they show up here with telltale
         * `alphaTest > 0` / small triangle counts. If they're a single
         * mesh artefact, all rows collapse to one row.
         */
        const _avatarForensic = [];
        model.traverse((c) => {
          if (!c.isMesh && !c.isSkinnedMesh) return;
          const mats = Array.isArray(c.material) ? c.material : [c.material];
          for (const m of mats) {
            if (!m) continue;
            const geo = c.geometry;
            const triCount = geo?.index
              ? geo.index.count / 3
              : geo?.attributes?.position
                ? geo.attributes.position.count / 3
                : 0;
            _avatarForensic.push({
              mesh: c.name || "(unnamed)",
              skinned: !!c.isSkinnedMesh,
              tris: Math.round(triCount),
              material: m.name || "(unnamed)",
              transparent: !!m.transparent,
              opacity: typeof m.opacity === "number" ? +m.opacity.toFixed(2) : m.opacity,
              alphaTest: typeof m.alphaTest === "number" ? +m.alphaTest.toFixed(2) : m.alphaTest,
              hasAlphaMap: !!m.alphaMap,
              hasMap: !!m.map,
              side: m.side === THREE.DoubleSide ? "Double" : m.side === THREE.BackSide ? "Back" : "Front",
              depthWrite: m.depthWrite,
              depthTest: m.depthTest,
              vertexAlpha: !!geo?.attributes?.color,
            });
          }
        });
        console.groupCollapsed(
          `%c[Avatar] Avatar3.glb mesh forensic (${_avatarForensic.length} mesh/material rows)`,
          "color:#ce93d8;font-weight:bold;",
        );
        console.table(_avatarForensic);
        console.groupEnd();
        model.traverse((child) => {
          if (child.isMesh) {
            /**
             * Skinned-mesh footgun: `frustumCulled = true` uses each sub-
             * mesh's BIND-POSE bounding box, not the live skinned bounds,
             * so head / hair / eye sub-meshes whose bind bbox doesn't
             * envelope the animated extents can vanish when only part of
             * the body is on screen. May-14 2026 user fix #4 ("mesh errors
             * still happening, only on her face, doesn't happen anywhere
             * else"). Three.js best practice for skinned avatars is to
             * disable frustum culling on the mesh itself and let the
             * parent group's culling handle visibility.
             */
            child.frustumCulled = false;
            // Avatar casts a contact shadow onto the terrain + tipi
            // platforms — sells "she stands here" much harder than the
            // flat decal disc. Cheap because the figurine is a single
            // SkinnedMesh, not an instanced forest.
            child.castShadow = true;
            child.receiveShadow = true;
            /** After travel disc (8) / ring (9) / arrow (10) so decals never cover the body. */
            child.renderOrder = AVATAR_FIGURINE_RENDER_ORDER;
            /**
             * Foliage bleed-through fix (May-14 2026, re-applied after a
             * misdiagnosed removal): leaf alpha-test fragments from
             * surrounding palms / bushes were landing at the same depth
             * as the avatar's skin and winning the z-fight, painting
             * dark leaf silhouettes onto her face / chin / arms.
             *
             * Probed Avatar3.glb: one rigged Tripo mesh (~1M vtx), one
             * opaque PBR material — but the sculpt still has overlapping
             * triangles on chin / cheeks. A **negative `polygonOffsetFactor`**
             * applies a slope-dependent depth tweak that differs per polygon;
             * on dense curved flesh that reads as a dark noisy "beard".
             *
             * Use **`polygonOffsetFactor = 0`** so only uniform
             * `polygonOffsetUnits` nudges the surface toward the camera —
             * works with `Flora.js` mild **positive** offsets on trees so bark
             * does not paint onto the face as a “branch mask” (May-13 2026).
             */
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            const shellInset = String(AVATAR_INTERNAL_SHELL_MODEL_UNITS);
            for (const m of mats) {
              if (!m) continue;
              m.polygonOffset = true;
              m.polygonOffsetFactor = 0;
              m.polygonOffsetUnits = AVATAR_POLYGON_OFFSET_UNITS;
              /**
               * May-14 2026 user fix #5 ("elephant man face / black nose /
               * half-side neck"): Avatar3.glb ships with `transparent: true`
               * on its body material (Tripo export default), which forces
               * `depthWrite: false`. The face/neck region has overlapping
               * sub-surface geometry (eyelid loops, ear backs, hair-strand
               * cards) that, without depth writes, all paint into the same
               * screen pixels with back-faces showing through — reading to
               * the viewer as patches of "transparent skin" / a dark nose
               * silhouette / half a neck.
               *
               * Force-opaque the entire avatar shell: alpha=1, no alphaTest,
               * depthWrite ON. Side benefit: this also fixes the "player
               * avatar is under the circle" report — with depth writes
               * restored, the travel disc/ring decals (depthTest:true,
               * depthWrite:false) get properly occluded behind every body
               * pixel, so the figurine paints OVER the circles at every
               * overlapping fragment instead of being washed out by the
               * transparent ring.
               */
              /**
               * May-15 2026 user forensic ("face has weird transparency and
               * growths coming from front 45 % of the avatar"). Revisit of
               * the May-14 force-opaque pass. Old code set
               *   `m.transparent = false; m.alphaTest = 0;`
               * on EVERY material — but Tripo encodes feather / beadwork /
               * eyelash decorations as alpha-tested cutouts (the texture is
               * a rectangular sheet with a feather alpha mask). Slamming
               * `alphaTest` to zero renders the whole rectangular sheet as
               * solid colour — that's the "growth" the user saw protruding
               * off the side of the face.
               *
               * Updated policy:
               *   • Always force `transparent = false` + `depthWrite = true`
               *     (kills the no-depth-write face/neck patches).
               *   • PRESERVE non-zero `alphaTest` (or any `alphaMap`) — these
               *     are silhouette cutouts and must keep their mask.
               *   • Tighten the default cutoff to 0.5 if alphaMap is present
               *     but no explicit `alphaTest`, so feather edges still
               *     `discard` rather than print solid quads.
               */
              const hasCutout = (m.alphaTest && m.alphaTest > 0) || !!m.alphaMap;
              m.transparent = false;
              m.opacity = 1;
              if (hasCutout) {
                if (!m.alphaTest || m.alphaTest <= 0) m.alphaTest = 0.5;
              } else {
                m.alphaTest = 0;
              }
              m.depthWrite = true;
              m.depthTest = true;
              m.side = THREE.FrontSide;
              /**
               * Tripo often double-folds flesh in the jaw; a sub-millimetre
               * shell along `objectNormal` (after skinning) separates those
               * hits without visible “fattening”.
               */
              m.onBeforeCompile = (shader) => {
                shader.vertexShader = shader.vertexShader.replace(
                  "#include <skinning_vertex>",
                  `#include <skinning_vertex>
#ifdef USE_SKINNING
	transformed += normalize( objectNormal ) * float(${shellInset});
#endif
`,
                );
              };
              m.needsUpdate = true;
            }
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

        const discMat = createPhotorealTravelDiscMaterial(
          "player",
          AVATAR_CIRCLE_RADIUS,
        );
        const disc = new THREE.Mesh(
          new THREE.CircleGeometry(AVATAR_CIRCLE_RADIUS, 72),
          discMat,
        );
        disc.name = "player_avatar_travel_circle";
        disc.rotation.x = -Math.PI / 2;
        /* First frame matches `syncDecalsToTerrainSlope` flat-floor minimum (rim rise 0). */
        disc.position.y = TRAVEL_DECAL_CLEAR_ABOVE_RIM_M;
        disc.userData.anuId = "player.avatar.travel_circle";
        disc.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;
        disc.userData.anuKind = "avatar_travel_circle";
        disc.renderOrder = 8;
        root.add(disc);

        const innerR = AVATAR_CIRCLE_RADIUS * 0.92;
        const ringMat = createPhotorealTravelRingMaterial(
          "player",
          innerR,
          AVATAR_CIRCLE_RADIUS,
        );
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(innerR, AVATAR_CIRCLE_RADIUS, 96),
          ringMat,
        );
        ring.name = "player_avatar_circle_outline";
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = TRAVEL_DECAL_CLEAR_ABOVE_RIM_M + 0.008;
        ring.userData.anuId = "player.avatar.travel_circle_outline";
        ring.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;
        ring.userData.anuKind = "avatar_travel_circle_outline";
        ring.renderOrder = 9;
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
            transparent: false,
            opacity: 1,
            side: THREE.DoubleSide,
            depthTest: true,
            depthWrite: false,
          }),
        );
        arrow.name = "player_avatar_facing_arrow";
        arrow.rotation.x = -Math.PI / 2;
        arrow.position.y = TRAVEL_DECAL_CLEAR_ABOVE_RIM_M + 0.015;
        arrow.userData.anuId = "player.avatar.facing_arrow";
        arrow.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;
        arrow.userData.anuKind = "avatar_facing_arrow";
        arrow.renderOrder = 10;
        root.add(arrow);

        /**
         * Decals render in the transparent pass with `depthTest:true`.
         * The avatar must sit *above* the horizontal disc plane geometry-
         * wise (see `syncDecalsToTerrainSlope`: lift = rim rise + skinny
         * clearance — **not** a fixed +6 cm shim) plus `polygonOffset`
         * only on the body so torso pixels win cleanly over decal/terrain.
         */
        discMat.depthTest = true;
        discMat.depthWrite = false;
        discMat.polygonOffset = false;
        ringMat.depthTest = true;
        ringMat.depthWrite = false;
        ringMat.polygonOffset = false;
        arrow.material.depthTest = true;
        arrow.material.depthWrite = false;
        arrow.material.polygonOffset = false;

        root.add(model);
        scene.add(root);
        objects.push(root);

        this.root = root;
        this.model = model;
        this.circle = disc;
        this.arrow = arrow;
        this._travelRingMesh = ring;
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

      const isNew = AVATAR_URL.includes("Avatar-New");

      // Resolve walk + look + swim clip names UP FRONT (with name-aware regex matching and index fallback)
      const walkClipName = clips.find(c => /walk|run/i.test(c.name))?.name ?? (isNew ? clips[1]?.name : clips[3]?.name) ?? clips[1]?.name ?? null;
      const lookClipName = clips.find(c => /look|turn/i.test(c.name))?.name ?? (isNew ? clips[7]?.name : walkClipName) ?? clips[2]?.name ?? null;
      const swimClipName = clips.find(c => /swim|float/i.test(c.name))?.name ?? (isNew ? clips[3]?.name : null) ?? null;
      // sitFish: seated fishing dock pose — NlaTrack.005 (15.792 s)
      const sitFishClipName = clips.find(c => /sitfish|sit.?fish|fish.?sit/i.test(c.name))?.name ?? (isNew ? clips[5]?.name : null) ?? null;
      const inPlaceClipNames = new Set(
        [walkClipName, lookClipName, swimClipName, sitFishClipName].filter(Boolean),
      );

      clips.forEach((clip, index) => {
        const key = clip.name || `Avatar3Clip_${index}`;
        // Locomotion clips ship root-motion translation; engine drives world
        // position from velocity, so we must strip the clip's `.position`
        // tracks or the two stack into a visible "forward-and-back" drift.
        // Idle / wave / goodbye keep their tracks (no reported regression).
        const sourceClip = inPlaceClipNames.has(clip.name)
          ? _stripPositionTracks(clip)
          : clip;
        this.actions[key] = this.mixer.clipAction(sourceClip);
      });

      this.semanticClips = {
        // idle uses /idle/ — separate from look so the two resolve to
        // different clips. Previously both used /look|turn/ which made
        // them resolve to the same NlaTrack.007 (2.38s short cycle),
        // and the avatar appeared to "walk in place" when standing.
        idle: clips.find(c => /idle/i.test(c.name))?.name ?? (isNew ? clips[4]?.name : clips[4]?.name) ?? clips[0]?.name ?? null,
        /** Matches `look` — same NLA strip works for forward + pivot. */
        walk: walkClipName,
        look: lookClipName,
        swim: swimClipName,
        wave: clips.find(c => /wave|greet/i.test(c.name))?.name ?? (isNew ? clips[8]?.name : clips[6]?.name) ?? clips[0]?.name ?? null,
        goodbye: clips.find(c => /goodbye|bye/i.test(c.name))?.name ?? (isNew ? clips[8]?.name : clips[6]?.name) ?? clips[0]?.name ?? null,
        sit: clips.find(c => /sit/i.test(c.name))?.name ?? (isNew ? clips[6]?.name : clips[2]?.name) ?? null,
        /** sitFish: seated dock fishing pose (Avatar-New NlaTrack.005, 15.792 s). */
        sitFish: sitFishClipName,
        /** heart: hand-heart gesture (Avatar-New NlaTrack.000, 3.500 s). */
        heart: clips.find(c => /heart/i.test(c.name))?.name ?? (isNew ? clips[0]?.name : null) ?? null,
      };
      this.root.userData.anuAnimationMap = { ...this.semanticClips };
      this.root.userData.anuAnimationScan = {
        scannedClipCount: clips.length,
        findings: [
          "NlaTrack.000 (3.500 s): heart — player makes a heart with hands (gesture).",
          "NlaTrack.001 (5.375 s): walk. `.position` stripped at bind time.",
          "NlaTrack.002 (5.875 s): UNASSIGNED — unknown emote, ~6 s medium loop.",
          "NlaTrack.003 (7.167 s): swim. `.position` stripped at bind time.",
          "NlaTrack.004 (5.708 s): idle — quiet standing loop.",
          "NlaTrack.005 (15.792 s): sitFish — seated dock pose with fishing rod. `.position` stripped.",
          "NlaTrack.006 (15.583 s): sit — cinematic idle on platform.",
          "NlaTrack.007 (2.375 s): look — turn-in-place / look-around idle. `.position` stripped.",
          "NlaTrack.008 (6.625 s): wave/goodbye gesture.",
        ],
      };
    },

    play(kind, reason = "state", fade = 0.18, once = false) {
      if (!this.actions || !this.semanticClips) return;
      const clipName = this.semanticClips[kind] ?? kind;
      const next = this.actions[clipName];
      if (!next) return;
      if (next === this.currentAction && !once) {
        if (kind === "idle" || kind === "walk" || kind === "look" || kind === "sit") {
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
      if (!once && (kind === "idle" || kind === "walk" || kind === "look" || kind === "sit")) {
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

    /**
     * Slope-aware decal lift: nudge the travel disc / ring / arrow up so the
     * disc plane is never clipped by the ground at the disc's edge on a
     * slope. Caller passes the terrain sampler; we probe 4 cardinal points
     * at `AVATAR_CIRCLE_RADIUS`, find the maximum delta above the feet
     * position, and lift the decals by that delta plus a 1 cm bias.
     * Cheap: 4 analytic samples per frame.
     *
     * @param {(x: number, z: number) => number} terrainAt
     * @param {number} feetWorldY
     */
    syncDecalsToTerrainSlope(terrainAt, feetWorldY) {
      if (!this.circle || typeof terrainAt !== "function") return;
      const x = this.root.position.x;
      const z = this.root.position.z;
      // Probe at the *rendered* radius: in map view the decals are scaled up,
      // so a probe at the base radius misses the slope between r and r·scale
      // and the disc reads as clipped at the rim.
      const r = AVATAR_CIRCLE_RADIUS * this._mapViewScale;
      const yE = terrainAt(x + r, z);
      const yW = terrainAt(x - r, z);
      const yN = terrainAt(x, z - r);
      const yS = terrainAt(x, z + r);
      const maxRim = Math.max(yE, yW, yN, yS);
      const slopeRise = Math.max(0, maxRim - feetWorldY);
      const lift = slopeRise + TRAVEL_DECAL_CLEAR_ABOVE_RIM_M;
      this.circle.position.y = lift;
      if (this._travelRingMesh) this._travelRingMesh.position.y = lift + 0.008;
      if (this.arrow) this.arrow.position.y = lift + 0.015;
    },

    /**
     * Scale the player travel disc + ring + facing arrow up when the
     * top-down village view is active. The FPV circle is the canonical
     * one and stays in the scene; we just scale it so it reads from a
     * 78-m altitude camera instead of vanishing into a tiny dot at the
     * centre of the map.
     *
     * May-14 2026 user spec follow-up: original map-view scale was 3.4 —
     * the ring read as too wide and clipped the ground tiles around it.
     * Cut by 50% to 1.7; `_mapViewScale` is mirrored so `syncDecalsToTerrainSlope`
     * widens its terrain probe to match the rendered footprint.
     *
     * Idempotent.
     *
     * @param {boolean} mapView
     */
    setTravelMarkerScaleForMapView(mapView) {
      const s = mapView ? 1.7 : 1.0;
      this._mapViewScale = s;
      if (this.circle && this.circle.scale.x !== s) {
        this.circle.scale.setScalar(s);
      }
      if (this._travelRingMesh && this._travelRingMesh.scale.x !== s) {
        this._travelRingMesh.scale.setScalar(s);
      }
      if (this.arrow && this.arrow.scale.x !== s) {
        this.arrow.scale.setScalar(s);
      }
    },

    advanceMixer(delta) {
      this.mixer?.update(delta);
    },

    /**
     * Copy every bound `AnimationAction` from this figurine onto a parallel
     * mixer driving a `SkeletonUtils.clone(this.model)` HUD duplicate, then
     * `extMixer.update(0)` so poses stay 1:1 without advancing time twice.
     *
     * @param {THREE.AnimationMixer} extMixer
     * @param {Record<string, THREE.AnimationAction>} extActions
     */
    syncHudMirrorMixer(extMixer, extActions) {
      if (!this.mixer || !this.actions || !extMixer || !extActions) return;
      for (const key of Object.keys(extActions)) {
        const src = this.actions[key];
        const dst = extActions[key];
        if (!src || !dst) continue;
        dst.paused = src.paused;
        dst.enabled = src.enabled;
        dst.setEffectiveWeight(src.getEffectiveWeight());
        dst.time = src.time;
        dst.setEffectiveTimeScale(src.getEffectiveTimeScale());
        dst.loop = src.loop;
        dst.repetitions = src.repetitions;
        dst.clampWhenFinished = src.clampWhenFinished;
      }
      extMixer.update(0);
    },

    update(delta, x, y, z, yaw) {
      this.setPose(x, y, z, yaw);
      this.advanceMixer(delta);
      const t = (typeof performance !== "undefined" ? performance.now() : 0) * 0.001;
      touchTravelCircleTime(this.circle?.material, t);
      touchTravelCircleTime(this._travelRingMesh?.material, t);
    },

    dispose() {
      this.setCinematicIdleFigurineDrawThrough(false);
      if (this.mixer && this._onMixerFinished) {
        this.mixer.removeEventListener("finished", this._onMixerFinished);
        this._onMixerFinished = null;
      }
      this.mixer?.stopAllAction?.();
      this.root = null;
      this.model = null;
      this.circle = null;
      this.arrow = null;
      this._travelRingMesh = null;
      this.mixer = null;
      this.actions = null;
      this.clips = [];
      this.semanticClips = null;
      this.currentAction = null;
      this._locomotionKind = null;
      this.gestureUntil = 0;
      this._cineFigurineBackup = null;
    },
  };
}
