/**
 * Sacred Adventures v2 — TraderJosh3d NPC.
 *
 * Loads `Assets/TraderJosh3d.glb` and plants him standing in front of
 * Tipi 1, facing the lodge. Position is offset slightly east of the
 * sacred-deck centre so he doesn't block the doorway approach a player
 * walks up to from the southern spawn corridor.
 *
 * Tipi 1 anchor is world origin (0, 0); the deck radius is ~4.7 m, so
 * Josh stands at ~6 m south of origin, just past the deck rim. He's a
 * non-interactable static greeter for now (no animation mixer, no walk
 * controller) — the broader "walk to YB + wave at player" choreography
 * can hang off this module's `_root` later via update().
 */

import * as THREE from "three";
import { GLTFLoaderWithDraco } from "./gltfLoaderSetup.js";
import { ANU_SIMULATION_DOMAIN, ANU_INTERACTION_VERB } from "./anu/SimulationController.js";
import { terrainY } from "./WorldTerrain.js";

const TRADER_JOSH_URL = "./Assets/TraderJosh3d.glb";

/** Anchor in front of Tipi 1 — origin is the tipi centre. Negative Z =
 *  south, toward the player spawn at z ≈ -32.58. The X offset puts him
 *  to the player's right as they approach so he reads as a side-quest
 *  greeter, not a doorway-blocker. */
const TRADER_JOSH_X = 1.4;
const TRADER_JOSH_Z = -6.0;
/** Target height (m) after scaling — May-17 2026 user spec ("increase
 *  height by 40%, increase overall height of model 20%"). Base 1.55 m
 *  (5-ft reference) × 1.40 → 2.17 m, then `TRADER_JOSH_OVERALL_SCALE`
 *  bumps the final group another 20 % for ~2.60 m on-screen height. */
const TRADER_JOSH_TARGET_HEIGHT_M = 1.55 * 1.4;
/** Extra uniform scale applied to the placed group AFTER the bbox-based
 *  height fit. Stacks with `TRADER_JOSH_TARGET_HEIGHT_M`. */
const TRADER_JOSH_OVERALL_SCALE = 1.2;
/** Yaw so the model's forward axis points at the tipi (world +Z =
 *  north). Tipi-1 NPCs (YB/BHG) ship with rig forward = local +X, which
 *  yaw=π/2 maps to world +Z; using the same default here means if the
 *  Tripo GLB follows the same convention Josh will face the tipi out
 *  of the box. Adjust via the `_MODEL_YAW_RAD` constant if it reads
 *  backwards in-engine. */
const TRADER_JOSH_MODEL_YAW_RAD = Math.PI / 2;

export const TraderJoshModule = {
  name: "TraderJosh",

  _scene: null,
  _root: null,
  _model: null,
  _mixer: null,
  _idleAction: null,
  _walkAction: null,
  _clipNames: [],
  /** Procedural idle bob — used when the GLB ships no animation clips.
   *  Drives a gentle vertical breathing motion + small yaw sway each
   *  frame when Josh is standing still. */
  _idleElapsed: 0,
  _idleBaseY: 0,
  _idleBaseYaw: 0,
  /** Per-frame velocity tracking for the walk/idle blend. */
  _prevX: undefined,
  _prevZ: undefined,
  _smoothSpeed: 0,

  async load(scene) {
    if (this._root) return;
    this._scene = scene;

    try {
      const gltf = await new GLTFLoaderWithDraco().loadAsync(TRADER_JOSH_URL);
      const model = gltf.scene;
      model.name = "population_trader_josh_model";

      // Bbox-measure then uniform-scale to the target height.
      const box0 = new THREE.Box3().setFromObject(model);
      const size0 = new THREE.Vector3();
      box0.getSize(size0);
      const sf =
        size0.y > 0.001 ? TRADER_JOSH_TARGET_HEIGHT_M / size0.y : 1;
      model.scale.setScalar(sf);
      model.rotation.y = TRADER_JOSH_MODEL_YAW_RAD;
      model.updateMatrixWorld(true);

      // Re-derive bbox at the new scale so we can drop his soles onto
      // the analytic terrain.
      const box = new THREE.Box3().setFromObject(model);

      const root = new THREE.Group();
      root.name = "population_trader_josh";
      root.userData.anuId = "population.npc.trader_josh";
      root.userData.anuKind = "npc_trader_josh";
      root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
      root.userData.anuInteractable = true;
      root.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.TALK];

      model.position.y = -box.min.y;
      root.add(model);

      // Apply the overall-scale on the OUTER root so the inner model's
      // bbox-derived sole-alignment stays correct.
      root.scale.setScalar(TRADER_JOSH_OVERALL_SCALE);

      const groundY = terrainY(TRADER_JOSH_X, TRADER_JOSH_Z);
      root.position.set(TRADER_JOSH_X, groundY, TRADER_JOSH_Z);
      this._idleBaseY = groundY;
      this._idleBaseYaw = root.rotation.y;
      this._model = model;

      // Tag every mesh for the Anu sensorium + suppress shadows (the
      // village has shadows off across all GLB NPCs per the YB/BHG
      // pattern in WorldStructures.js — soft contact shadows are
      // expensive at the per-character GLB scale).
      model.traverse((ch) => {
        if (ch.isMesh || ch.isSkinnedMesh) {
          ch.castShadow = false;
          ch.receiveShadow = false;
          ch.frustumCulled = true;
          ch.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
          ch.userData.anuKind = "npc_trader_josh_mesh";
          const nm = (ch.name || "mesh").replace(/\s+/g, "_").slice(0, 48);
          ch.userData.anuId = `population.npc.trader_josh.mesh.${nm}`;
        }
      });

      scene.add(root);
      this._root = root;

      // Wire up the mixer + locate the idle and walking clips. Tripo
      // GLBs typically ship a small clip list — we pick the first
      // matching idle/stand/wait and the first matching walk/move/run
      // by case-insensitive name, falling back to clips[0] if no idle
      // is present and `_walkAction = null` if no walk exists (in which
      // case `setMoving(true)` is a no-op and the procedural bob still
      // animates Josh).
      const clips = gltf.animations ?? [];
      this._clipNames = clips.map((c) => String(c.name ?? "")) ;
      if (clips.length > 0) {
        this._mixer = new THREE.AnimationMixer(model);
        const idleClip =
          clips.find((c) => /idle|stand|wait/i.test(String(c.name ?? ""))) ||
          clips[0];
        const walkClip =
          clips.find((c) => /walk|move|stride/i.test(String(c.name ?? ""))) ||
          clips.find((c) => /run|jog/i.test(String(c.name ?? ""))) ||
          null;
        this._idleAction = this._mixer.clipAction(idleClip);
        this._idleAction.setLoop(THREE.LoopRepeat, Infinity);
        this._idleAction.play();
        if (walkClip && walkClip !== idleClip) {
          this._walkAction = this._mixer.clipAction(walkClip);
          this._walkAction.setLoop(THREE.LoopRepeat, Infinity);
          this._walkAction.setEffectiveWeight(0);
          this._walkAction.play();
        }
      }

      console.log(
        `%c[TraderJosh] 🧳 Loaded at (${TRADER_JOSH_X.toFixed(1)}, ${groundY.toFixed(2)}, ${TRADER_JOSH_Z.toFixed(1)}) — scale ${sf.toFixed(3)} × overall ${TRADER_JOSH_OVERALL_SCALE} · clips: [${this._clipNames.join(", ")}]`,
        "color:#a5d6a7;font-weight:bold;",
      );
    } catch (err) {
      console.warn("[TraderJosh] Load failed:", err);
    }
  },

  /**
   * Blend between idle and walking clips based on horizontal velocity.
   * Falls back to a procedural breathing bob when no animation clips
   * are present so a still-static Josh never reads as a frozen
   * mannequin.
   */
  update(delta) {
    if (!this._root) return;
    this._idleElapsed += delta;

    // Per-frame XZ velocity of the root group — drives the walk/idle
    // blend. Cached `_prevX/Z` are set once on first update so the very
    // first frame doesn't register a phantom "walk".
    const x = this._root.position.x;
    const z = this._root.position.z;
    if (this._prevX === undefined) {
      this._prevX = x;
      this._prevZ = z;
    }
    const dx = x - this._prevX;
    const dz = z - this._prevZ;
    const speed = delta > 0 ? Math.hypot(dx, dz) / delta : 0;
    this._prevX = x;
    this._prevZ = z;

    // Smooth a small EMA so a momentary stop on autowalk arrival
    // doesn't snap the walk clip off. ~120 ms time constant.
    const k = Math.min(1, delta * 8);
    this._smoothSpeed = (this._smoothSpeed ?? 0) * (1 - k) + speed * k;

    // Walk-blend weight: 0 below 0.05 m/s, full at 0.6 m/s, linear in between.
    const moving = this._smoothSpeed > 0.05;
    const walkW = Math.max(0, Math.min(1, (this._smoothSpeed - 0.05) / 0.55));

    if (this._idleAction && this._walkAction) {
      this._walkAction.setEffectiveWeight(walkW);
      this._idleAction.setEffectiveWeight(1 - walkW);
      // Walk cadence tracks ground speed so a slow stroll doesn't
      // moonwalk and a fast jog doesn't stutter.
      this._walkAction.setEffectiveTimeScale(
        0.55 + Math.min(1.5, this._smoothSpeed / 1.4),
      );
    }
    if (this._mixer) this._mixer.update(delta);

    // Procedural fallback — used when the GLB ships no animation clips
    // (confirmed `clipNames: []` on TraderJosh3d.glb). Three oscillators
    // (Y bob + chest-lift Z tilt + yaw weight-shift) scale with
    // `_smoothSpeed` so the same code path covers both states:
    //
    //   • Standing still → 1.2 Hz · 5 cm Y bob · 3° Z lean · 4° yaw sway
    //   • Walking        → 5.5 Hz · 7 cm Y bob · 5° Z lean · 9° yaw sway
    //
    // May-17 2026 user feedback ("why isn't Josh animating idle?") — the
    // prior 1.5 cm bob was technically running (probe verified ±1.8 cm
    // over 1.25 s) but invisible on a 2.6 m figure from the ~10 m
    // camera distance. Amplitudes here are visible-from-distance; the
    // Z-tilt does most of the visual work because it reads as a chest
    // lift even when the Y bob is too small to perceive.
    //
    // Y baseline tracks `terrainY` at Josh's current XZ so a future
    // walk controller that moves him across uneven ground keeps him
    // on the surface instead of holding the original `_idleBaseY`.
    const wantsProcedural = !this._idleAction && !this._walkAction;
    if (wantsProcedural) {
      const t = this._idleElapsed;
      const sp = this._smoothSpeed;
      const moveK = Math.min(1.0, sp / 0.6);

      const freq = 1.2 + moveK * 4.3;
      const ampY = 0.05 + moveK * 0.02;
      const ampZTilt = 0.052 + moveK * 0.038; // ~3° → ~5°
      const ampYaw = 0.07 + moveK * 0.085;

      const groundY = terrainY(x, z);
      this._root.position.y = groundY + Math.sin(t * freq) * ampY;
      this._root.rotation.y =
        this._idleBaseYaw + Math.sin(t * freq * 0.5) * ampYaw;
      // Z-axis chest-lift — most legible idle cue when bones aren't
      // available. Offset by π/2 so the lean peaks half-way between
      // bob crests (reads as breathing in/out).
      this._root.rotation.z = Math.sin(t * freq + Math.PI / 2) * ampZTilt;
    }
  },

  unload(scene) {
    const root = this._root;
    if (!root) return;
    scene.remove(root);
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
        else o.material.dispose?.();
      }
    });
    this._root = null;
    this._mixer = null;
    this._scene = null;
  },
};
