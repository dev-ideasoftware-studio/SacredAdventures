/**
 * Sacred Adventures — sanctuary part 7 of N: AVATAR.
 *
 * Loads `Assets/Avatar3.glb` (Draco-compressed + decimated to ~205 k
 * tris in the May-17 simplify pass) and plants it on the sanctuary
 * ground. Anu domain: PLAYER (the witness body).
 *
 * Anti-transparency treatment per user spec ("try best not to allow it
 * to have any transparencies across its entire mesh and fill in any
 * gaps in it with skin color filler"):
 *
 *   1. Every material on the rig is forced opaque:
 *        transparent = false
 *        opacity     = 1.0
 *        alphaTest   = 0
 *        depthWrite  = true
 *      This kills the most common Tripo-GLB face-transparency artifact
 *      where alpha-test fragments on the head left visible "holes".
 *
 *   2. A SKIN-FILL shell sits just inside the visible mesh — a slightly
 *      shrunk clone of the avatar rendered FIRST with a solid skin-tone
 *      `MeshBasicMaterial`. Any sliver of background that would have
 *      shown through a sub-mesh seam paints as skin colour instead of
 *      grass. The shell uses `renderOrder = AVATAR_FIGURINE_RENDER_ORDER
 *      - 1` so it always paints behind the main rig.
 *
 *   3. `frustumCulled = false` on the skinned meshes — skinned-mesh
 *      vanish bug workaround (bind-pose bbox excludes the animated
 *      extent; without this disable, the head/hair pops out at low
 *      camera angles).
 *
 * SanctuaryClickToMove auto-detects `window.__sanctuaryAvatar` and will
 * drive it instead of the bare camera once this module is active.
 */

import * as THREE from "three";
import { GLTFLoaderWithDraco } from "../v2/gltfLoaderSetup.js";
import { ANU_SIMULATION_DOMAIN, ANU_INTERACTION_VERB } from "../v2/anu/SimulationController.js";
import { sanctuaryBodyY, sanctuaryGroundY, SANCTUARY_POOL_CENTER_X, SANCTUARY_POOL_CENTER_Z } from "./SanctuaryGround.js";
import {
  buildPlayerV2TravelDecal,
  touchSanctuaryTravelCircleTime,
} from "./SanctuaryTravelDisc.js";
import {
  V2_INTRO_TIPI1_APPROACH_X_M,
  V2_INTRO_TIPI1_APPROACH_Z_M,
} from "../v2/constants.js";

let AVATAR_URL = "./Assets/npc/Avatar-New.glb";
if (typeof window !== "undefined" && window.location.href.includes("avatar=old")) {
  AVATAR_URL = "./Assets/Avatar3.glb";
}

/** Target world-space height of the rendered avatar (m). 5 ft kid =
 *  exactly half the 10 ft (3.05 m) tipi target so the 2:1 ratio holds. */
const AVATAR_TARGET_HEIGHT_M = 1.524;
/** South of v2 Tipi 1 (0,0) — same approach slot as the main game. */
const AVATAR_SPAWN_X = V2_INTRO_TIPI1_APPROACH_X_M;
const AVATAR_SPAWN_Z = V2_INTRO_TIPI1_APPROACH_Z_M;
/** Initial yaw: facing Tipi 1 (north / -Z). The keyboard's movement
 *  convention is fwd = (-sin yaw, 0, -cos yaw) — yaw=0 gives fwd = -Z. */
const AVATAR_INITIAL_YAW_RAD = 0;
/** Render order — must beat the skin-fill shell (renderOrder - 1) AND
 *  the always-visible travel decal which renders at 9990-9992. 10000
 *  guarantees the kid is never occluded by the ground disc beneath
 *  her feet. (May-19 2026 user fix.) */
const AVATAR_FIGURINE_RENDER_ORDER = 10000;

/**
 * Skin tone for the fill shell. Tuned to the warm-brown read of the
 * existing Avatar3 face material — a kid-sympathetic neutral.
 */
const SKIN_FILL_HEX = 0xb98765;

function _stampAnuTags(model, root) {
  root.userData.anuId = "player.sanctuary.avatar";
  root.userData.anuKind = "sanctuary_avatar";
  root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;
  root.userData.anuInteractable = true;
  root.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.INSPECT];
  model.traverse((ch) => {
    if (ch.isMesh || ch.isSkinnedMesh) {
      ch.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;
      ch.userData.anuKind = "sanctuary_avatar_mesh";
      const nm = (ch.name || "mesh").replace(/\s+/g, "_").slice(0, 48);
      ch.userData.anuId = `player.sanctuary.avatar.mesh.${nm}`;
    }
  });
}

/**
 * Force every material on the rig to render solid. Returns the count
 * we changed so the boot log can show it.
 *
 * **May-18 2026 user fix:** instead of layering a separate skin-fill
 * SHELL mesh underneath (which caused "sparkle" artifacts at the
 * seams + alpha edges), we fill the gaps in-place. Each material:
 *   1. Forced opaque (no transparent / alpha-test / depthWrite=off)
 *   2. Emissive zeroed out
 *   3. `side = THREE.DoubleSide` so back-faces fill any pinhole gap
 *      in the cloth or hair seam instead of letting world show through
 *   4. Texture wrap clamped — if the Tripo map has a 1-pixel transparent
 *      border it can otherwise read as a sparkly halo. Edge clamp +
 *      forced opacity makes it disappear.
 */
function _killTransparency(model) {
  let touched = 0;
  model.traverse((ch) => {
    if (!ch.isMesh && !ch.isSkinnedMesh) return;
    ch.frustumCulled = false; // skinned-mesh vanish workaround
    ch.castShadow = true;
    ch.receiveShadow = true;
    ch.renderOrder = AVATAR_FIGURINE_RENDER_ORDER;
    const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.transparent === true) { m.transparent = false; touched++; }
      if (typeof m.opacity === "number" && m.opacity < 1) { m.opacity = 1; touched++; }
      if (typeof m.alphaTest === "number" && m.alphaTest > 0) { m.alphaTest = 0; touched++; }
      if (m.depthWrite === false) { m.depthWrite = true; touched++; }
      if (m.polygonOffsetFactor !== 0) m.polygonOffsetFactor = 0;
      if (m.emissive && (m.emissive.r > 0 || m.emissive.g > 0 || m.emissive.b > 0)) {
        m.emissive.setHex(0x000000);
        touched++;
      }
      if (typeof m.emissiveIntensity === "number" && m.emissiveIntensity > 0) {
        m.emissiveIntensity = 0;
        touched++;
      }
      // DoubleSide: every back-face fills the silhouette. Seams + alpha
      // edges that previously let the background read through now show
      // the material's own back face (same colour / texture) instead.
      if (m.side !== THREE.DoubleSide) {
        m.side = THREE.DoubleSide;
        touched++;
      }
      // Clamp texture edges so a 1-pixel transparent border in a Tripo
      // baked map can't read as a sparkly halo at the silhouette.
      if (m.map) {
        m.map.wrapS = THREE.ClampToEdgeWrapping;
        m.map.wrapT = THREE.ClampToEdgeWrapping;
        m.map.needsUpdate = true;
      }
    }
  });
  return touched;
}

/**
 * Build the SKIN-FILL shell. Deep-clones the avatar model, swaps every
 * mesh's material for a solid skin-tone `MeshBasicMaterial`, shrinks
 * the clone slightly, and sets render order one below the main rig.
 * The clone keeps the same skeleton/bind pose so it stays inside the
 * outer shell as the avatar animates.
 */
function _buildSkinFillShell(model) {
  const shell = model.clone(true);
  shell.name = "sanctuary_avatar_skin_fill";
  // May-18 2026 user fix ("not weird glowing sparkly"). The prior shell
  // used `MeshBasicMaterial` which is UNLIT — it always paints at full
  // canvas brightness regardless of scene lighting. With the outer
  // avatar mesh now fully opaque (forced by `_killTransparency`), the
  // only places the shell still shows through are tiny micro-seams +
  // alpha-test edges on hair / lashes. With an unlit material those
  // pixels SHINE — reading as a glowing sparkle outline around the
  // figure. Switching to a lit PBR material with NO emissive means
  // those leak pixels match the surrounding lit skin, becoming
  // invisible instead of glowing.
  const skinMat = new THREE.MeshStandardMaterial({
    color: SKIN_FILL_HEX,
    roughness: 0.85,
    metalness: 0.0,
    emissive: 0x000000,
    emissiveIntensity: 0.0,
    side: THREE.FrontSide,
    depthWrite: true,
    depthTest: true,
    flatShading: false,
  });
  shell.traverse((ch) => {
    if (!ch.isMesh && !ch.isSkinnedMesh) return;
    ch.material = skinMat;
    ch.castShadow = false;
    ch.receiveShadow = false;
    ch.frustumCulled = false;
    ch.renderOrder = AVATAR_FIGURINE_RENDER_ORDER - 1;
    ch.userData.anuKind = "sanctuary_avatar_skin_fill_mesh";
    ch.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;
  });
  // Tighter shrink (0.985 vs prior 0.99) so even with the PBR shell the
  // outer mesh covers it cleanly under all anim poses.
  shell.scale.multiplyScalar(0.985);
  return shell;
}

export const SanctuaryAvatarModule = {
  name: "SanctuaryAvatar",

  _scene: null,
  _root: null,
  _mixer: null,
  _idleAction: null,
  _walkAction: null,
  _model: null,
  _shell: null,
  _travelMats: null,
  _elapsed: 0,
  _prevPos: null,
  _smoothSpeed: 0,

  async load(scene) {
    if (this._root) return;
    this._scene = scene;

    try {
      const gltf = await new GLTFLoaderWithDraco().loadAsync(AVATAR_URL);
      const model = gltf.scene;
      model.name = "sanctuary_avatar_model";

      // Tripo Avatar3.glb ships rig-forward on local +X. Legacy v2
      // applied `V2_AVATAR_MODEL_YAW_RAD = π/2` to rotate the model
      // so its visual forward becomes local -Z — matching the
      // keyboard's movement convention (fwd = -sin yaw, 0, -cos yaw,
      // which at yaw=0 is world -Z) AND the facing arrow direction.
      // Without this, the avatar visually faces 90° to the right of
      // where it actually walks.
      model.rotation.y = Math.PI / 2;

      // Scale to target height by measuring bbox + uniform-scaling.
      // **Robust bbox** — `Box3.setFromObject` on a skinned-mesh in
      // bind pose can return a degenerate or oversized box (the
      // geometry's precomputed boundingBox accounts for the full
      // skinned extent including animation reach, not the actual
      // rendered figurine). Walk the meshes by hand and accumulate
      // from each one's local geometry box transformed by its world
      // matrix — gives the true on-screen rendered extent.
      model.updateMatrixWorld(true);
      const measuredBox = new THREE.Box3();
      const localBox = new THREE.Box3();
      const tmpBox = new THREE.Box3();
      model.traverse((ch) => {
        if (!(ch.isMesh || ch.isSkinnedMesh)) return;
        if (!ch.geometry) return;
        // Ensure each geometry has a current local box.
        if (!ch.geometry.boundingBox) ch.geometry.computeBoundingBox();
        localBox.copy(ch.geometry.boundingBox);
        tmpBox.copy(localBox).applyMatrix4(ch.matrixWorld);
        if (measuredBox.isEmpty()) measuredBox.copy(tmpBox);
        else measuredBox.union(tmpBox);
      });
      const size0 = new THREE.Vector3();
      if (measuredBox.isEmpty()) {
        // Fallback to setFromObject.
        new THREE.Box3().setFromObject(model).getSize(size0);
      } else {
        measuredBox.getSize(size0);
      }
      const sf = size0.y > 0.001 ? AVATAR_TARGET_HEIGHT_M / size0.y : 1;
      console.log(
        `%c[SanctuaryAvatar] scale calc: raw height ${size0.y.toFixed(3)} m → scale factor ${sf.toFixed(4)} → target ${AVATAR_TARGET_HEIGHT_M} m`,
        "color:#fbc02d;",
      );
      model.scale.setScalar(sf);
      model.updateMatrixWorld(true);

      // Drop feet to local Y=0 then lift well above the sibling travel
      // disc (which lives at root-local y = 0.015). 0.10 m of lift
      // gives a margin big enough to clear ANY animation-pose dip in
      // the skinned skeleton (Avatar3's idle + walk clips both bob the
      // hips down ~5 cm per cycle). At 4 inches it reads as "kid
      // standing firmly on the disc" from chase-cam distance, not
      // floating. (May-19 2026, 3rd attempt at feet-on-circle.)
      const FEET_ABOVE_DISC_M = 0.10;
      const box1 = new THREE.Box3().setFromObject(model);
      model.position.y = -box1.min.y + FEET_ABOVE_DISC_M;

      const touched = _killTransparency(model);
      // SKIN-FILL SHELL DELETED (May-18 2026): the separate shrunk
      // clone caused "sparkly" artifacts at silhouette seams. Gaps are
      // now filled in-place via `_killTransparency` setting every
      // material to DoubleSide + clamping its texture edges. Same
      // visual goal (no background showing through), no second mesh.
      this._shell = null;

      const root = new THREE.Group();
      _stampAnuTags(model, root);
      root.name = "sanctuary_avatar";

      // v2 photoreal travel disc (shader green + gold ring + white arrow).
      const travelDecal = buildPlayerV2TravelDecal("player_avatar");
      this._travelMats = travelDecal.userData._travelMats ?? null;
      root.add(travelDecal);

      // ── PIP-only "you are here" marker (May-19 2026 user spec) ─────
      // The avatar reads as ~10 px on the 78 m-elevated PIP ortho cam,
      // so add a big bright ring + arrow that's visible ONLY from the
      // PIP camera (layer 1). The main chase/top-down camera renders
      // only layer 0, so this marker is invisible in normal gameplay.
      const PIP_LAYER = 1;
      const pipMarker = new THREE.Group();
      pipMarker.name = "sanctuary_avatar_pip_marker";
      pipMarker.layers.set(PIP_LAYER);
      const pipRing = new THREE.Mesh(
        new THREE.RingGeometry(1.6, 1.95, 40),
        new THREE.MeshBasicMaterial({
          color: 0xfbe28a,
          transparent: true,
          opacity: 0.95,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      pipRing.rotation.x = -Math.PI / 2;
      pipRing.position.y = 0.04;
      pipRing.renderOrder = 9995;
      pipRing.layers.set(PIP_LAYER);
      pipMarker.add(pipRing);
      const arrowShape = new THREE.Shape()
        .moveTo(0, 2.4).lineTo(0.85, 1.1).lineTo(-0.85, 1.1).lineTo(0, 2.4);
      const pipArrow = new THREE.Mesh(
        new THREE.ShapeGeometry(arrowShape),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 1,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      pipArrow.rotation.x = -Math.PI / 2;
      pipArrow.position.y = 0.05;
      pipArrow.renderOrder = 9996;
      pipArrow.layers.set(PIP_LAYER);
      pipMarker.add(pipArrow);
      root.add(pipMarker);

      root.add(model);

      const groundY = sanctuaryGroundY(AVATAR_SPAWN_X, AVATAR_SPAWN_Z);
      root.position.set(AVATAR_SPAWN_X, groundY, AVATAR_SPAWN_Z);
      root.rotation.y = AVATAR_INITIAL_YAW_RAD;

      scene.add(root);
      this._root = root;
      this._model = model;
      this._prevPos = new THREE.Vector3().copy(root.position);

      // Expose so SanctuaryClickToMove can drive this body instead of
      // the bare camera. The click-to-move module already reads
      // `window.__sanctuaryAvatar` if present.
      if (typeof window !== "undefined") {
        window.__sanctuaryAvatar = root;
        // Seed the global yaw so the keyboard module + arrow agree on
        // facing on the very first frame.
        window.__sanctuaryPlayerYaw = AVATAR_INITIAL_YAW_RAD;
      }

      // Wire up the animation mixer. Avatar3.glb ships 9 clips named
      // NlaTrack.000-008 — generic Blender export names, no "walk"/"idle"
      // tokens. The legacy v2 WorldAvatar (which has worked for months)
      // selects by INDEX, not regex: idle = clips[4], walk = clips[3].
      // Also CRITICAL: clips[3] has root-motion `.position` tracks that
      // animate the model's root forward/back as the walk cycle plays —
      // if we don't strip them, the clip's motion fights the engine's
      // velocity-driven motion and the legs visually "lock" in place.
      // Both behaviours ported from `js/v2/WorldAvatar.js:447-518`.
      const clips = gltf.animations ?? [];
      console.log(
        `%c[SanctuaryAvatar] GLB clips (${clips.length}): ${clips.map((c, i) => `[${i}]"${c.name}" (${c.duration.toFixed(2)}s, ${c.tracks.length}t)`).join(", ") || "<none>"}`,
        "color:#fbc02d;",
      );
      if (clips.length > 0) {
        this._mixer = new THREE.AnimationMixer(model);
        const isNew = AVATAR_URL.includes("Avatar-New");
        
        // Robust selection: look for name match first, fallback to standard Tripo indices
        const idleClip = clips.find(c => /idle/i.test(c.name)) ?? (isNew ? clips[4] : clips[4]) ?? clips[0];
        let walkClip = clips.find(c => /walk|run/i.test(c.name)) ?? (isNew ? clips[1] : clips[3]) ?? clips[1] ?? null;
        if (walkClip === idleClip) walkClip = null;

        // look = turn-in-place idle — NlaTrack.007 (2.375s)
        let lookClip = clips.find(c => /look|turn/i.test(c.name)) ?? (isNew ? clips[7] : null) ?? null;

        // swim = NlaTrack.003 for Avatar-New (7.167s)
        let swimClip = clips.find(c => /swim|float/i.test(c.name)) ?? (isNew ? clips[3] : null) ?? null;

        // sitFish = NlaTrack.005 (15.792s) — seated dock pose with rod
        let sitFishClip = clips.find(c => /sitfish|sit.?fish|fish.?sit/i.test(c.name)) ?? (isNew ? clips[5] : null) ?? null;

        // Strip root-motion `.position` tracks from locomotion clips so
        // the engine owns translation.
        const _strip = (clip) => {
          if (!clip) return clip;
          const keep = clip.tracks.filter((t) => !t.name.endsWith(".position"));
          if (keep.length === clip.tracks.length) return clip;
          const stripped = clip.clone();
          stripped.tracks = keep;
          return stripped;
        };
        walkClip    = _strip(walkClip);
        swimClip    = _strip(swimClip);
        sitFishClip = _strip(sitFishClip);

        this._idleAction = this._mixer.clipAction(idleClip);
        this._idleAction.setLoop(THREE.LoopRepeat, Infinity);
        this._idleAction.play();

        if (lookClip) {
          this._lookAction = this._mixer.clipAction(lookClip);
          this._lookAction.setLoop(THREE.LoopRepeat, Infinity);
          this._lookAction.setEffectiveWeight(0);
          this._lookAction.play();
        }
        
        if (walkClip) {
          this._walkAction = this._mixer.clipAction(walkClip);
          this._walkAction.setLoop(THREE.LoopRepeat, Infinity);
          this._walkAction.setEffectiveWeight(0);
          this._walkAction.play();
        }

        if (swimClip) {
          this._swimAction = this._mixer.clipAction(swimClip);
          this._swimAction.setLoop(THREE.LoopRepeat, Infinity);
          this._swimAction.setEffectiveWeight(0);
          this._swimAction.play();
        }

        if (sitFishClip) {
          this._sitFishAction = this._mixer.clipAction(sitFishClip);
          this._sitFishAction.setLoop(THREE.LoopRepeat, Infinity);
          this._sitFishAction.setEffectiveWeight(0);
          this._sitFishAction.play();
        }

        console.log(
          `%c[SanctuaryAvatar] anim picks: idle="${idleClip.name}" walk=${walkClip ? `"${walkClip.name}"` : "<none>"} look=${lookClip ? `"${lookClip.name}"` : "<none>"} swim=${swimClip ? `"${swimClip.name}"` : "<none>"} sitFish=${sitFishClip ? `"${sitFishClip.name}"` : "<none>"}`,
          "color:#a5d6a7;",
        );
      }

      console.log(
        `%c[Sanctuary] 🧒 Avatar ready @ (${AVATAR_SPAWN_X.toFixed(1)}, ${AVATAR_SPAWN_Z.toFixed(1)}), height ${AVATAR_TARGET_HEIGHT_M} m, ${touched} material fixes, skin-fill shell present.`,
        "color:#fbc02d;font-weight:bold;",
      );
    } catch (err) {
      console.warn("[SanctuaryAvatar] load failed:", err);
    }
  },

  update(delta) {
    if (!this._root) return;
    this._elapsed += delta;

    // Velocity sample — drives idle ↔ walk blend.
    const cur = this._root.position;
    const dx = cur.x - this._prevPos.x;
    const dz = cur.z - this._prevPos.z;
    const speedNow = delta > 0 ? Math.hypot(dx, dz) / delta : 0;
    this._prevPos.copy(cur);
    const k = Math.min(1, delta * 8);
    this._smoothSpeed = this._smoothSpeed * (1 - k) + speedNow * k;

    // Yaw — read from the click-to-move-published value when present,
    // else fall back to whatever the model's been set to.
    if (typeof window !== "undefined" && Number.isFinite(window.__sanctuaryPlayerYaw)) {
      this._root.rotation.y = window.__sanctuaryPlayerYaw;
    }

    // Re-snap Y to terrain so a moving avatar tracks the surface even
    // when the click-to-move drives only x/z. Root sits AT ground (no
    // lift) — the avatar model is lifted within the root at load time
    // (see `model.position.y += FEET_ABOVE_DISC_M` below) so its feet
    // sit above the travel disc, which is a sibling of the model
    // anchored at the root's plane.
    // Single source of truth for body Y — knows dock + pool waterline + terrain.
    cur.y = sanctuaryBodyY(cur.x, cur.z, AVATAR_TARGET_HEIGHT_M);

    // ── Animation state machine ──────────────────────────────────────
    // Priority (highest first):
    //   1. FISHING  → sitFish (NlaTrack.005, 15.792 s seated dock pose)
    //   2. IN POOL  → swim   (NlaTrack.003, 7.167 s)
    //   3. WALKING  → walk   (NlaTrack.001, 5.375 s)
    //   4. STANDING → look   (NlaTrack.007, 2.375 s turn-in-place idle)
    //
    // Sanctuary pool is centred at SANCTUARY_POOL_CENTER_X/Z = (0,0),
    // radius 12.0 m. Use 11.5 m as the blend threshold.

    const isFishing = typeof window !== "undefined" && window.__sanctuaryFishingActive === true;
    const dist = Math.hypot(cur.x - SANCTUARY_POOL_CENTER_X, cur.z - SANCTUARY_POOL_CENTER_Z);
    const inPool = !isFishing && dist < 11.5;

    // All actions (zero all first, then raise the winner to 1)
    const _zero = (a) => { if (a) a.setEffectiveWeight(0.0); };

    if (isFishing && this._sitFishAction) {
      // --- FISHING: frozen seated dock pose ---
      _zero(this._swimAction);
      _zero(this._walkAction);
      _zero(this._lookAction);
      _zero(this._idleAction);
      this._sitFishAction.setEffectiveWeight(1.0);
      this._sitFishAction.setEffectiveTimeScale(1.0);
    } else if (inPool && this._swimAction) {
      // --- IN POOL: swim always, speed-scaled ---
      _zero(this._sitFishAction);
      _zero(this._walkAction);
      _zero(this._lookAction);
      _zero(this._idleAction);
      this._swimAction.setEffectiveWeight(1.0);
      // Match swim cadence to speed: slow paddle at low speed, faster thrash when sprinting
      this._swimAction.setEffectiveTimeScale(0.65 + Math.min(1.35, this._smoothSpeed / 1.2));
    } else {
      // --- ON LAND ---
      _zero(this._sitFishAction);
      _zero(this._swimAction);
      const walkW = Math.max(0, Math.min(1, (this._smoothSpeed - 0.04) / 0.25));
      const lookW = 1 - walkW; // look-around when standing still
      if (this._walkAction) {
        this._walkAction.setEffectiveWeight(walkW);
        this._walkAction.setEffectiveTimeScale(0.85 + Math.min(1.6, this._smoothSpeed / 1.0));
      }
      // look-around replaces idle when standing still
      if (this._lookAction) {
        this._lookAction.setEffectiveWeight(lookW);
        // Always slow, contemplative look-around speed
        this._lookAction.setEffectiveTimeScale(0.45);
      } else if (this._idleAction) {
        // Fallback if look clip missing
        this._idleAction.setEffectiveWeight(lookW);
      }
      // idle action blended to 0 (look takes its slot)
      if (this._lookAction && this._idleAction) _zero(this._idleAction);
    }

    if (this._mixer) this._mixer.update(delta);

    touchSanctuaryTravelCircleTime(this._travelMats);
  },

  unload(scene) {
    if (!this._root) return;
    scene.remove(this._root);
    this._root = null;
    this._mixer = null;
    this._idleAction = null;
    this._lookAction = null;
    this._walkAction = null;
    this._swimAction = null;
    this._sitFishAction = null;
    this._model = null;
    this._shell = null;
    this._travelMats = null;
    this._scene = null;
    if (typeof window !== "undefined" && window.__sanctuaryAvatar) {
      delete window.__sanctuaryAvatar;
    }
  },
};
