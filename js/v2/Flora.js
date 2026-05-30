/**
 * Sacred Adventures v2 — Flora: `Assets/tree.glb` planted with legacy
 * `js/EnvironmentBuilder.js` rings, scaling, foliage tint swatch, accumulated
 * `uTime` wind on canopy leaves plus softer branch/trunk sway on non-foliage
 * meshes, and terrain-hugging dirt discs.
 *
 * v2 differs from legacy only where required for this shell:
 * trees stay on the default scene layer so the main camera (which does not enable legacy layer 3) still draws them.
 */

import * as THREE from "three";
import { GLTFLoaderWithDraco } from "./gltfLoaderSetup.js";
import {
  ANU_INTERACTION_VERB,
  ANU_SIMULATION_DOMAIN,
} from "./anu/SimulationController.js";
import { getRuntimeService } from "./RuntimeServices.js";
import { installMeshMaterialPipRingDiskClip } from "./anu/PipOrthoRingDiskClip.js";
import {
  SEASON_SURFACE_TINTS,
  V2_FLORA_MAX_TREE_INSTANCES,
  V2_FLORA_TREE_HORIZONTAL_SPREAD,
  V2_POND_ENCLAVE_CENTER_X_M,
  V2_POND_ENCLAVE_CENTER_Z_M,
  V2_POOL2_BASIN_RADIUS_M,
  V2_RABBIT_FAMILY_LAYOUT,
  V2_RABBIT_WARREN_CHASM_RADIUS_M,
  V2_RABBIT_WARREN_FLORA_CLEAR_M,
  V2_RABBIT_WARREN_HUB_X_M,
  V2_RABBIT_WARREN_HUB_Z_M,
  V2_TILE_WORLD,
} from "./constants.js";
import { ANU_EVENTS } from "./anu/anuEvents.js";
import { subscribeInteraction } from "./anu/InteractionBus.js";
import { buildLegacyEnvironmentBuilderTreeSlots } from "./FloraLegacyTreeLayout.js";
import { mergeGeometries as _mergeBufferGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { getActiveMap } from "./MapsConfig.js";

const TREE_URL = "./Assets/tree.glb";

/**
 * Cap the slot list. **Priority slots first** (slots with `priority > 0`,
 * e.g. the north-of-pond hill ring added by `FloraLegacyTreeLayout`) so
 * intentional placements survive even when they're far from origin.
 * The remaining capacity is filled by the legacy nearest-origin order
 * (keeps the village grove around the tipis intact). */
function capFloraSlotsByNearestOrigin(slots, maxN) {
  if (!maxN || maxN <= 0 || slots.length <= maxN) return slots;
  const scored = slots.map((s) => ({
    s,
    priority: s.priority ?? 0,
    d2: s.x * s.x + s.z * s.z,
  }));
  scored.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.d2 - b.d2;
  });
  return scored.slice(0, maxN).map((x) => x.s);
}

const FOLIAGE_HEXES = [
  0xffb7c5, 0x7cfc00, 0x98fb98, 0x87cefa, 0x32cd32, 0xff8c00, 0xdaa520, 0xff69b4,
];

function cloneTreeMaterial(mesh) {
  const m = mesh.material;
  return Array.isArray(m) ? m[0].clone() : m.clone();
}

function isLeafMaterial(material) {
  const matName = material.name ? material.name.toLowerCase() : "";
  return (
    matName.includes("leaf") ||
    matName.includes("leaves") ||
    matName.includes("foliage")
  );
}

const TreesForestModule = {
  name: "Trees",

  _objects: [],
  /** @type {{ value: number } | null} */
  _windUniform: null,
  /** @type {THREE.InstancedMesh[]} */
  _leafMeshes: [],
  _treeTintScratch: new THREE.Color(),
  _foliageSeasonScratch: new THREE.Color(),
  /** @type {THREE.Color[]} */
  _foliageBaseColors: [],
  /** @type {(() => void) | null} */
  _unsubSeason: null,
  _colliders: [],
  /** Shared template geometries (dispose once on unload). */
  _sharedTreeGeometries: new Set(),
  matrix: new THREE.Matrix4(),
  position: new THREE.Vector3(),
  rotationEuler: new THREE.Euler(),
  quaternion: new THREE.Quaternion(),
  scaleVec: new THREE.Vector3(),
  tangentX: new THREE.Vector3(),
  tangentZ: new THREE.Vector3(),
  groundNormal: new THREE.Vector3(),

  async load(scene) {
    /**
     * **Clean-slate mode (May-2026 user request).** All auto-generated
     * flora the user disliked is short-circuited from `load()`:
     *   • The 260-instance canopy forest
     *   • Wildflowers (the "weird multicolour rocks")
     *   • Meadow motes + falling leaves (the "air particles")
     *   • Fairy mushrooms, berry bushes, magic crystal, wooden bridge,
     *     rope swing, sit stump, tipi welcome glows
     *
     * Everything else in the world (terrain, village tipis, pool, dock,
     * fauna, pond reeds) is owned by other modules and stays intact.
     * BuildMode (T / B / R / L keys) is the new way to populate the
     * scene — the user plants their own trees, places their own
     * tipis, drops their own rocks, plants their own reed clusters.
     *
     * If you ever want the auto-flora back, flip this flag to `false`
     * — the rest of `load()` is preserved below verbatim.
     */
    const FLORA_CLEAN_SLATE = true;
    if (FLORA_CLEAN_SLATE) {
      console.log(
        "%c[Trees] ⏸ Clean-slate mode — auto-flora disabled. Use BuildMode (T / B / R / L) to populate the scene.",
        "color:#ffd54f;font-weight:bold;",
      );
      return;
    }

    const worldPhysics = getRuntimeService("WorldPhysics") ?? window.WorldPhysics;
    const getY =
      worldPhysics && typeof worldPhysics.getGroundY === "function"
        ? worldPhysics.getGroundY.bind(worldPhysics)
        : null;

    if (!getY) {
      console.error(
        "[Trees] WorldPhysics.getGroundY missing — activate World before Trees.",
      );
      return;
    }

    /**
     * Pool2 + rabbit warren — keep instanced trees out of the full carved
     * pond/water footprint in shared `terrainY`, the warren hub chasm, and
     * each family's meadow pocket.
     */
    /**
     * Player spawn keep-outs (May-14 2026 user spec: "no trees grow in
     * front of user or within 1 tile of start pos"). The avatar spawns at
     * `(0, -3 * V2_TILE_WORLD)` facing +Z (north) toward tipi 1 at origin
     * — so we carve:
     *   • a 1-tile keep-out around the spawn point itself, and
     *   • a 1-tile-radius corridor of keep-outs every half-tile along
     *     the +Z forward axis from spawn to the tipi rim. Five stops
     *     covers the ~3-tile approach without leaving gaps the legacy
     *     tree distribution could fill in between rings.
     * Result: the first sightline from spawn to the village is clear,
     * with mature forest still framing the edges on either side.
     */
    const SPAWN_X = 0;
    const SPAWN_Z = -3 * V2_TILE_WORLD;
    const SPAWN_CLEAR_R = V2_TILE_WORLD; // ≥ 1 tile per spec
    const FORWARD_STOPS = 5;
    const FORWARD_STEP = (SPAWN_Z - 0) / FORWARD_STOPS; // negative; z grows toward origin
    const exclusionZones = [
      {
        x: V2_POND_ENCLAVE_CENTER_X_M,
        z: V2_POND_ENCLAVE_CENTER_Z_M,
        radius: V2_POOL2_BASIN_RADIUS_M + 5.5,
      },
      {
        x: V2_RABBIT_WARREN_HUB_X_M,
        z: V2_RABBIT_WARREN_HUB_Z_M,
        radius: V2_RABBIT_WARREN_FLORA_CLEAR_M,
      },
      ...V2_RABBIT_FAMILY_LAYOUT.map((s) => ({
        x: (s.anchorX + s.burrowX) * 0.5,
        z: (s.anchorZ + s.burrowZ) * 0.5,
        radius: 7.8,
      })),
      { x: SPAWN_X, z: SPAWN_Z, radius: SPAWN_CLEAR_R },
      // Forward corridor: 5 stops from spawn toward origin (north). Stop 0
      // is the spawn itself (covered above), stops 1..5 march half a tile
      // at a time toward tipi 1's sacred-platform rim.
      ...Array.from({ length: FORWARD_STOPS }, (_, i) => ({
        x: SPAWN_X,
        z: SPAWN_Z - FORWARD_STEP * (i + 1),
        radius: SPAWN_CLEAR_R,
      })),
    ];
    let treeSlots = buildLegacyEnvironmentBuilderTreeSlots({
      tipiX: 0,
      tipiZ: 0,
      exclusionZones,
    });

    // Resolve the active map's flora overrides. `maxTreeInstances` /
    // `treeHeightM` / `snowyTrees` come from `MapsConfig`; the
    // constants-file value is used only as a fallback when no map is
    // active (defensive — `getActiveMap` always returns Scene 0 if
    // localStorage / URL haven't set anything else).
    const _mapFlora = getActiveMap().flora;
    const _treeCap =
      typeof _mapFlora?.maxTreeInstances === "number"
        ? _mapFlora.maxTreeInstances
        : V2_FLORA_MAX_TREE_INSTANCES;
    /** Map's target tree height divided by the legacy mid-of-random
     *  height (12 m) gives a per-frame scale factor we can fold into
     *  the instance loop. 1.0 reproduces the legacy look. */
    const _treeHeightScale = (_mapFlora?.treeHeightM ?? 12) / 12;
    const _snowyTrees = !!_mapFlora?.snowyTrees;

    const beforeCap = treeSlots.length;
    treeSlots = capFloraSlotsByNearestOrigin(treeSlots, _treeCap);
    if (treeSlots.length < beforeCap) {
      console.log(
        "%c[Trees / ANU] Flora instance cap applied",
        "color:#fbc02d;font-weight:bold;",
        `— ${beforeCap} layouts → ${treeSlots.length} (nearest-origin priority; tweak constants.js V2_FLORA_MAX_TREE_INSTANCES).`,
      );
    }

    const N = treeSlots.length;
    if (N === 0) {
      console.warn("[Trees] Legacy layout produced zero tree slots.");
      return;
    }

    const foliageColors = FOLIAGE_HEXES.map((h) => new THREE.Color(h));

    const gltf = await new GLTFLoaderWithDraco().loadAsync(TREE_URL);
    const template = gltf.scene;

    const origBox = new THREE.Box3().setFromObject(template);
    const origSize = new THREE.Vector3();
    origBox.getSize(origSize);

    const treeCenter = origBox.getCenter(new THREE.Vector3());
    template.position.set(-treeCenter.x, 0, -treeCenter.z);
    template.updateMatrixWorld(true);

    /** @type {THREE.Mesh[]} */
    const meshesToInstance = [];
    template.traverse((child) => {
      if (child.isMesh) meshesToInstance.push(child);
    });

    if (meshesToInstance.length === 0) {
      console.error("[Trees] tree.glb had no mesh geometry.");
      return;
    }

    const windUniform = { value: 0 };
    this._windUniform = windUniform;
    this._leafMeshes = [];
    this._foliageBaseColors = new Array(N);
    this._sharedTreeGeometries = new Set();
    this._treeSpheres = [];
    for (const m of meshesToInstance) {
      if (m.geometry) this._sharedTreeGeometries.add(m.geometry);
    }

    /** @type {Array<{ instancedMesh: THREE.InstancedMesh; isLeaf: boolean }>} */
    const allInstanced = [];

    let partIndex = 0;
    for (const mesh of meshesToInstance) {
      const material = cloneTreeMaterial(mesh);
      material.roughness = 1.0;
      material.metalness = 0.0;
      if (material.shininess !== undefined) material.shininess = 0;

      const isLeaf = isLeafMaterial(material);

      if (isLeaf) {
        material.color.setHex(0xffffff);
        material.alphaTest = 0.5;
        material.transparent = false;
        material.depthWrite = true;
        /** Mild positive offset: loses “leaf stamp” depth ties vs the player figurine (`WorldAvatar`). */
        material.polygonOffset = true;
        material.polygonOffsetFactor = 0;
        material.polygonOffsetUnits = 2;
        material.onBeforeCompile = (shader) => {
          shader.uniforms.uTime = windUniform;
          shader.vertexShader = shader.vertexShader.replace(
            "#include <common>",
            "#include <common>\nuniform float uTime;\n",
          );
          /**
           * May-15 2026: canopy windStr bumped (`0.16 → 0.24`) and a small
           * leaf flutter (~3 cm) added on every leaf vertex so the canopy
           * shimmers in addition to swaying as a whole. The flutter uses
           * `position.y * 1.2 + position.x * 0.9` as its phase so each leaf
           * card has its own jitter rhythm — the canopy reads as "moving
           * with the wind" rather than "shifting as one mass".
           */
          const vertMods = `
#include <begin_vertex>
float heightFactor = smoothstep(2.0, 6.0, position.y);
float worldX = instanceMatrix[3][0];
float worldZ = instanceMatrix[3][2];
float phase = (worldX * 0.1) + (worldZ * 0.1);
float windStr = 0.24;
transformed.x += sin(uTime * 1.5 + phase) * windStr * heightFactor;
transformed.z += cos(uTime * 1.2 + phase) * windStr * heightFactor;
float leafFlutter = sin(uTime * 4.2 + position.y * 1.2 + position.x * 0.9 + phase) * 0.03;
transformed.x += leafFlutter * heightFactor;
transformed.z += leafFlutter * 0.6 * heightFactor;
`;
          shader.vertexShader = shader.vertexShader.replace(
            "#include <begin_vertex>",
            vertMods,
          );
        };
        installMeshMaterialPipRingDiskClip(material);
      } else {
        /**
         * Trunk / branch sway — subtler than canopy leaves (lower freq,
         * stronger only with height above the root). Leaves keep the sharper
         * rustle shader above; woody parts bend as one mass.
         *
         * Positive polygon offset pushes bark slightly **behind** in depth
         * vs geometry at the same nominal distance (player avatar uses a
         * stronger negative pull) so wind-swept wood is not read as a
         * “branch texture” on the face (May-13 2026).
         */
        material.polygonOffset = true;
        material.polygonOffsetFactor = 0;
        material.polygonOffsetUnits = 5;
        material.onBeforeCompile = (shader) => {
          shader.uniforms.uTime = windUniform;
          shader.vertexShader = shader.vertexShader.replace(
            "#include <common>",
            "#include <common>\nuniform float uTime;\n",
          );
          /**
           * May-15 2026 user spec ("add tree swaying to branches"). The
           * branch-sway amplitudes were quiet enough that camera-still
           * shots read the forest as frozen. Doubled the primary lateral
           * amplitudes (`0.068 → 0.13`, `0.072 → 0.14`) and added a slow
           * vertical bob (`y-wobble`) so branches dip + rebound as they
           * sway — much more "alive" without crossing into cartoon flop.
           * Branch-tip flex now smoothsteps from 0 → 1 across `wy ∈
           * [0.2, 6.6]` so trunks below knee height stay rigid.
           */
          const branchSwayMods = `
#include <begin_vertex>
float wy = abs(position.y);
float branchFlex = smoothstep(0.2, 6.6, wy);
float worldX = instanceMatrix[3][0];
float worldZ = instanceMatrix[3][2];
float phase = worldX * 0.074 + worldZ * 0.061;
float swayX = sin(uTime * 0.92 + phase) * branchFlex * 0.13;
float swayZ = cos(uTime * 1.05 + phase * 1.1) * branchFlex * 0.14;
float wobY = sin(uTime * 0.66 + phase * 1.4) * branchFlex * 0.04;
transformed.x += swayX + cos(uTime * 0.38 + phase * 2.4) * branchFlex * 0.045;
transformed.z +=
  swayZ +
  sin(uTime * 0.51 + wy * 0.11 + phase) * branchFlex * 0.052;
transformed.y += wobY;
`;
          shader.vertexShader = shader.vertexShader.replace(
            "#include <begin_vertex>",
            branchSwayMods,
          );
        };
        installMeshMaterialPipRingDiskClip(material);
      }

      const instancedMesh = new THREE.InstancedMesh(mesh.geometry, material, N);
      // Trunks cast shadows; leaf canopies don't (one draw pass into the
      // shadow map per InstancedMesh — leaves are big and would double
      // shadow-map fragment cost for marginal silhouette gain). Both
      // receive so dappled patterns from other trees + the avatar
      // settle on bark / under-canopy.
      instancedMesh.castShadow = !isLeaf;
      instancedMesh.receiveShadow = true;
      instancedMesh.frustumCulled = true;
      instancedMesh.name =
        isLeaf ? "SacredFlora_Trees_leaf" : `SacredFlora_Trees_part_${partIndex}`;

      instancedMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
      instancedMesh.userData.anuTargetInstances = N;
      instancedMesh.userData.anuPlacedInstances = N;
      instancedMesh.userData.anuLegacyLayout =
        "EnvironmentBuilder ANIME FOREST · v2 Flora pipeline (multipart + tints)";
      if (isLeaf) {
        instancedMesh.userData.anuKind = "tree_canopy_mass";
        instancedMesh.userData.anuId = "flora.tree_instances.leaves";
      } else {
        instancedMesh.userData.anuKind = `tree_mesh_part_${partIndex}`;
        instancedMesh.userData.anuId =
          partIndex === 0
            ? "flora.tree_instances.primary"
            : `flora.tree_instances.part_${partIndex}`;
      }
      if (partIndex === 0) {
        instancedMesh.userData.anuInteractable = true;
        instancedMesh.userData.anuInteractionVerbs = [
          ANU_INTERACTION_VERB.INSPECT,
          ANU_INTERACTION_VERB.HARVEST,
        ];
      }

      scene.add(instancedMesh);
      this._objects.push(instancedMesh);
      allInstanced.push({ instancedMesh, isLeaf });
      if (isLeaf) this._leafMeshes.push(instancedMesh);
      partIndex++;
    }

    if (this._leafMeshes.length === 0) {
      console.warn(
        "[Trees] No leaf/foliage materials detected by name — instance foliage tints skipped.",
      );
    }

    const matrix = this.matrix;
    const position = this.position;
    const rotationEuler = this.rotationEuler;
    const quaternion = this.quaternion;
    const scaleVec = this.scaleVec;
    const tangentX = this.tangentX;
    const tangentZ = this.tangentZ;
    const groundNormal = this.groundNormal;

    let minTargetH = Infinity;
    let maxTargetH = -Infinity;

    /**
     * Species-tier modifiers (May-2026 user spec: "wow kids… won't want
     * to leave"). The slot's `species` field, rolled in
     * `FloraLegacyTreeLayout.tryAddPosition`, picks between three
     * silhouettes from the same GLB:
     *
     *   0 pine — baseline proportions, default tint pool.
     *   1 squat deciduous — short and wide; biased toward warm/yellow
     *                       foliage tints so it reads as a different
     *                       species from the pines.
     *   2 spire — tall and narrow; biased toward darker / cooler
     *             tints, like a far cedar or fir.
     */
    const SPECIES_MOD = [
      { yMul: 1.00, xzMul: 1.00, tintBoost: null },
      { yMul: 0.72, xzMul: 1.28, tintBoost: new THREE.Color(0xfff0a8) },
      { yMul: 1.34, xzMul: 0.66, tintBoost: new THREE.Color(0x8eb878) },
    ];

    // Snowy-trees tint (Scene 2 / Sacred Peaks) — biases foliage toward
    // frosted blue-white. Only allocated when the active map opts in.
    const SNOWY_TINT = _snowyTrees ? new THREE.Color(0xe6ecef) : null;

    for (let idx = 0; idx < N; idx++) {
      const pos = treeSlots[idx];
      const baseScale = pos.scale;
      const species = pos.species ?? 0;
      const mods = SPECIES_MOD[species] ?? SPECIES_MOD[0];
      // Active-map height scale lets each map dial canopy stature.
      const targetH =
        (8 + Math.random() * 8) * baseScale * mods.yMul * _treeHeightScale;
      if (targetH < minTargetH) minTargetH = targetH;
      if (targetH > maxTargetH) maxTargetH = targetH;

      const sf = targetH / Math.max(origSize.y, 0.1);
      const widthMult =
        (pos.widthOverride ?? (0.88 + Math.random() * 0.58)) *
        V2_FLORA_TREE_HORIZONTAL_SPREAD *
        mods.xzMul;
      scaleVec.set(sf * widthMult, sf, sf * widthMult);

      const groundY = getY(pos.x, pos.z);
      position.set(pos.x, groundY, pos.z);
      rotationEuler.set(0, Math.random() * Math.PI * 2, 0);
      quaternion.setFromEuler(rotationEuler);
      matrix.compose(position, quaternion, scaleVec);

      // Cache bounding sphere for manual frustum culling
      const sphereCenter = new THREE.Vector3(pos.x, groundY + targetH * 0.5, pos.z);
      const sphereRadius = targetH * 0.7; // Cover height and horizontal spread
      this._treeSpheres.push(new THREE.Sphere(sphereCenter, sphereRadius));

      let tintColor =
        foliageColors[Math.floor(Math.random() * foliageColors.length)];
      // Species-bias the tint so the new silhouettes also read as
      // colourwise different. Lerp ~55 % toward the species reference
      // colour so we don't lose the seasonal palette entirely.
      if (mods.tintBoost) {
        tintColor = tintColor.clone().lerp(mods.tintBoost, 0.55);
      }
      // Snow frosting for Sacred Peaks — biases ~38 % toward the frost
      // tint per instance so canopies read as snow-dusted without
      // erasing the per-instance colour variety.
      if (SNOWY_TINT) {
        tintColor = (tintColor.clone ? tintColor.clone() : tintColor).lerp(SNOWY_TINT, 0.38);
      }
      this._foliageBaseColors[idx] = tintColor.clone();

      for (const { instancedMesh, isLeaf } of allInstanced) {
        instancedMesh.setMatrixAt(idx, matrix);
        if (isLeaf) instancedMesh.setColorAt(idx, tintColor);
      }

      const sd = 0.5;
      const hC = groundY;
      const hL = getY(pos.x - sd, pos.z);
      const hR = getY(pos.x + sd, pos.z);
      const hF = getY(pos.x, pos.z - sd);
      const hB = getY(pos.x, pos.z + sd);
      const avgY = (hC + hL + hR + hF + hB) / 5;

      const dirtGroup = new THREE.Group();
      dirtGroup.position.set(pos.x, avgY + 0.03, pos.z);

      tangentX.set(sd * 2, hR - hL, 0);
      tangentZ.set(0, hB - hF, sd * 2);
      groundNormal.crossVectors(tangentX, tangentZ).normalize();
      dirtGroup.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        groundNormal,
      );

      const dirtRadius = baseScale * 0.8;
      const dirtGeo = new THREE.CircleGeometry(dirtRadius, 16);
      dirtGeo.rotateX(-Math.PI / 2);
      const dirtMat = new THREE.MeshBasicMaterial({
        color: 0x180b02,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      installMeshMaterialPipRingDiskClip(dirtMat);
      const dirtMesh = new THREE.Mesh(dirtGeo, dirtMat);
      dirtMesh.renderOrder = 1;
      dirtMesh.name = "SacredFlora_TreeDirtPatch";
      dirtMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
      dirtMesh.userData.anuKind = "tree_base_dirt";
      dirtMesh.userData.anuId = `flora.tree_dirt.${idx}`;
      dirtGroup.add(dirtMesh);
      scene.add(dirtGroup);
      this._objects.push(dirtGroup);

      if (typeof worldPhysics.registerCollider === "function") {
        this._colliders.push(
          worldPhysics.registerCollider({
            id: `flora.tree.${idx}`,
            x: pos.x,
            z: pos.z,
            radius: Math.max(0.65, baseScale * 0.5),
            passable: false,
            kind: "tree",
          }),
        );
      }
    }

    // Cache original matrices and colors for manual per-instance frustum culling
    for (const { instancedMesh } of allInstanced) {
      instancedMesh.userData.originalMatrices = [];
      instancedMesh.userData.originalColors = [];
      for (let i = 0; i < N; i++) {
        const mat = new THREE.Matrix4();
        instancedMesh.getMatrixAt(i, mat);
        instancedMesh.userData.originalMatrices.push(mat);
        if (instancedMesh.instanceColor) {
          const col = new THREE.Color();
          instancedMesh.getColorAt(i, col);
          instancedMesh.userData.originalColors.push(col);
        }
      }
    }

    this._lastCullFrame = -1;
    this._lastCullCamera = null;
    this._visibleIndices = [];

    const cullingFrustum = new THREE.Frustum();
    const cullingProjScreenMtx = new THREE.Matrix4();

    for (const { instancedMesh } of allInstanced) {
      instancedMesh.instanceMatrix.needsUpdate = true;
      if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
      instancedMesh.computeBoundingSphere();

      instancedMesh.onBeforeRender = (renderer, scene, camera) => {
        const frameId = renderer.info.render.frame;
        const camId = camera.uuid;

        // Perform frustum culling once per frame per camera across all tree parts
        if (this._lastCullFrame !== frameId || this._lastCullCamera !== camId) {
          this._lastCullFrame = frameId;
          this._lastCullCamera = camId;

          cullingProjScreenMtx.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
          cullingFrustum.setFromProjectionMatrix(cullingProjScreenMtx);

          const isPip = camera.name && camera.name.startsWith("pip");
          // Main camera: cull flora past the opaque fog wall (was Infinity, so
          // every tree/reed/bush drew every frame even when fog-hidden). The
          // distSq test + _visibleIndices count rewrite below already run; only
          // this clamp was missing. Tie to live fog.far so the cut sits just
          // beyond visibility — zero visual change inside fog. (FPS O2.)
          const fogFar = (scene && scene.fog && scene.fog.far) || 105;
          const maxDistSq = isPip ? 30 * 30 : (fogFar * 1.05) * (fogFar * 1.05);
          const player = getRuntimeService("WorldPlayer") || window.WorldPlayer;
          const pFeet = player?.feet ?? { x: 0, y: 0, z: 0 };

          this._visibleIndices = [];
          for (let i = 0; i < N; i++) {
            const s = this._treeSpheres[i];
            const dx = s.center.x - pFeet.x;
            const dz = s.center.z - pFeet.z;
            const distSq = dx * dx + dz * dz;

            if (distSq <= maxDistSq && cullingFrustum.intersectsSphere(s)) {
              this._visibleIndices.push(i);
            }
          }
        }

        const visibleCount = this._visibleIndices.length;
        const origMtxs = instancedMesh.userData.originalMatrices;
        const origClrs = instancedMesh.userData.originalColors;

        for (let v = 0; v < visibleCount; v++) {
          const origIndex = this._visibleIndices[v];
          instancedMesh.setMatrixAt(v, origMtxs[origIndex]);
          if (instancedMesh.instanceColor && origClrs[origIndex]) {
            instancedMesh.setColorAt(v, origClrs[origIndex]);
          }
        }

        instancedMesh.count = visibleCount;
        instancedMesh.instanceMatrix.needsUpdate = true;
        if (instancedMesh.instanceColor) {
          instancedMesh.instanceColor.needsUpdate = true;
        }
      };
    }

    // ── Wildflowers — meadow scatter (May-2026 opening-scene pass) ───────
    // One InstancedMesh of ~120 small colour buds (Icosahedron 20-tri),
    // placed across the valley floor, rejected where they'd clip the
    // path, tipi platforms, pond rim, or warren hub. Per-instance
    // colours drawn from a kid-friendly palette so the meadow reads as
    // alive with pinks / butter-yellows / lavenders / sky-blues / whites.
    this._buildWildflowers(scene, getY);

    // ── Hill-ring boulders — REMOVED May-2026 user spec
    // "clear out and remove all the rocks on this scene, I dont like
    // any of them". The `_buildHillBoulders` method is left in place
    // (commented) so a future map preset can opt back in via
    // `MapsConfig` if needed.
    // this._buildHillBoulders(scene, getY);

    // ── Floating motes ────────────────────────────────────────────────────
    // Slow-drifting Points cloud above the meadow — pollen / dandelion
    // seed read. ~80 motes, one draw call. `_motes` exposes the
    // per-frame update path used by `update(delta)` below.
    this._buildMeadowMotes(scene);

    // ── Tipi welcome glows ────────────────────────────────────────────────
    // Warm emissive door-mat decal + a low-intensity non-shadow point
    // light at each tipi entrance. Tells kids "this is home — come
    // closer". Two draw calls (one mat × two tipis), two PointLights
    // (cheap because shadows are off on these).
    this._buildTipiWelcomeGlows(scene, getY);

    // ── Fairy mushroom rings ──────────────────────────────────────────────
    // 5 toadstool clusters near scattered tree bases (3–8 mushrooms per
    // ring). Kids read these instantly as "fairies live here". One
    // InstancedMesh, ~280 tris.
    this._buildFairyMushrooms(scene, getY, treeSlots);

    // ── Stone cairn waypoints — REMOVED May-2026 (see hill-boulder
    // comment above). User dislikes rocks across the whole scene.
    // this._buildStoneCairns(scene, getY);

    // ── Berry bushes ──────────────────────────────────────────────────────
    // 10 small foliage mounds with bright berry dots, placed at the
    // base of the hill ring so they read as "edible forage on the
    // walk". Two InstancedMeshes (foliage + berries).
    this._buildBerryBushes(scene, getY);

    // ── Magical crystal landmark ──────────────────────────────────────────
    // A single emissive crystal cluster on the north hill, visible
    // from the spawn approach. Sells "there's magic in this valley".
    // One small mesh, ~30 tris.
    this._buildMagicCrystal(scene, getY);

    // ── Wooden footbridge ─────────────────────────────────────────────────
    // Decorative kid-scale plank bridge along the pond approach. Merged
    // BufferGeometry across all planks + handrails = one draw call.
    this._buildWoodenBridge(scene, getY);

    // ── Rope swing ────────────────────────────────────────────────────────
    // Tree-hung swing near tipi 1 — two ropes + a plank seat. Small
    // Group; each piece is its own draw but the geometry is tiny.
    this._buildRopeSwing(scene, getY);

    // ── Falling leaves ────────────────────────────────────────────────────
    // Second Points cloud, warmer + larger + biased downward so it
    // reads as drifting autumn leaves layered over the meadow motes.
    this._buildFallingLeaves(scene);

    // ── Sit stump by the crystal ──────────────────────────────────────────
    // Single low cylinder near the crystal — invites kids to "sit and
    // watch".
    this._buildSitStump(scene, getY);

    this._unsubSeason?.();
    this._unsubSeason = subscribeInteraction(ANU_EVENTS.SEASON_CHANGE, (detail) => {
      this._applySeasonSurfaceTint(detail?.season);
    });

    console.log(
      `%c[Trees] ✅ ${N} × Assets/tree.glb — legacy-quality multipart forest; heights ${minTargetH.toFixed(2)}…${maxTargetH.toFixed(2)} m — ANU tracks ${N} instances per drawable`,
      "color:#81c784;font-weight:bold;",
    );
  },

  /**
   * Wildflower scatter — single InstancedMesh ground decoration for the
   * opening scene. Reads the world's path polyline off `WorldModule._distToPath`
   * (set during terrain build) to keep buds off the worn dirt trail.
   *
   * Constraints:
   *   • Meadow disc only: distance from origin ≤ 50 m so the scatter
   *     stays inside the valley floor (no flowers on the hill ring).
   *   • Path rejection: ≥ 1.8 m from the closest segment.
   *   • Tipi platforms: ≥ V2_FLORA_TIPI_CLEAR_ZONE_RADIUS_M from each
   *     anchor (re-uses the flora keep-out so flowers don't crash
   *     through the sacred-circle log border).
   *   • Pond: ≥ basin radius + 0.8 m from the pool centre.
   *   • Warren: ≥ warren chasm radius × 1.4 from the hub.
   *
   * Cost: one draw call, ~2400 triangles total (120 × 20). Free.
   */
  _buildWildflowers(scene, getY) {
    const PALETTE_HEX = [
      0xff8fab, // soft pink
      0xffd24c, // buttercup yellow
      0xfff5e0, // daisy white
      0xc794d9, // lavender
      0x8ed1ff, // sky blue
      0xff7a59, // coral
      0xfca4d1, // pastel pink-blush
      0xf6cf6b, // amber yellow
    ];
    const palette = PALETTE_HEX.map((h) => new THREE.Color(h));
    const TARGET = 120;
    const MEADOW_R = 50;
    const PATH_REJECT_M = 1.8;
    const POND_REJECT_M = V2_POOL2_BASIN_RADIUS_M + 0.8;
    const WARREN_REJECT_M = V2_RABBIT_WARREN_CHASM_RADIUS_M * 1.4;
    const TIPI_CLEAR = 4.7 + 0.6; // sacred platform radius + small buffer

    const distToPath =
      typeof window !== "undefined" &&
      window.anuOrchestrator?._activeModuleInstances?.World?._distToPath;

    const geom = new THREE.IcosahedronGeometry(0.18, 0);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: false,
      roughness: 0.55,
      metalness: 0.0,
      emissive: 0x1a1206,
      emissiveIntensity: 0.18,
    });
    const inst = new THREE.InstancedMesh(geom, mat, TARGET);
    inst.name = "flora_wildflower_meadow";
    inst.userData.anuId = "flora.wildflower_scatter.meadow";
    inst.userData.anuKind = "wildflower_meadow";
    inst.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
    inst.castShadow = false;
    inst.receiveShadow = true;
    inst.frustumCulled = true;

    // Tipi anchors — re-use the building-flatten array directly.
    const tipiAnchors = [
      { x: 0, z: 0 },
      { x: V2_TILE_WORLD * 2, z: 0 },
    ];

    let seed = 0x5acce501;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const dummy = new THREE.Object3D();
    let placed = 0;
    // Up to ~6× the target as candidates — every reject is cheap.
    const MAX_TRIES = TARGET * 6;
    for (let attempt = 0; attempt < MAX_TRIES && placed < TARGET; attempt++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * MEADOW_R; // uniform area
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;

      // Path keep-out.
      if (typeof distToPath === "function" && distToPath(x, z) < PATH_REJECT_M) {
        continue;
      }
      // Pond keep-out.
      {
        const px = x - V2_POND_ENCLAVE_CENTER_X_M;
        const pz = z - V2_POND_ENCLAVE_CENTER_Z_M;
        if (px * px + pz * pz < POND_REJECT_M * POND_REJECT_M) continue;
      }
      // Warren keep-out.
      {
        const wx = x - V2_RABBIT_WARREN_HUB_X_M;
        const wz = z - V2_RABBIT_WARREN_HUB_Z_M;
        if (wx * wx + wz * wz < WARREN_REJECT_M * WARREN_REJECT_M) continue;
      }
      // Tipi keep-out (loop is 2 anchors so cheap).
      let nearTipi = false;
      for (const t of tipiAnchors) {
        const dx = x - t.x;
        const dz = z - t.z;
        if (dx * dx + dz * dz < TIPI_CLEAR * TIPI_CLEAR) {
          nearTipi = true;
          break;
        }
      }
      if (nearTipi) continue;

      const groundY = getY(x, z);
      // Lift the bud just above terrain so it pokes through the grass
      // shader's edge-darkening band — reads as a flower on the lawn,
      // not embedded in dirt. Random tiny vertical jitter for variety.
      const yLift = 0.12 + rnd() * 0.06;
      dummy.position.set(x, groundY + yLift, z);
      // Per-instance bud scale — most are small, a handful larger.
      const sJitter = 0.75 + rnd() * (rnd() < 0.18 ? 1.6 : 0.55);
      dummy.scale.setScalar(sJitter);
      dummy.rotation.y = rnd() * Math.PI * 2;
      dummy.updateMatrix();
      inst.setMatrixAt(placed, dummy.matrix);
      inst.setColorAt(placed, palette[Math.floor(rnd() * palette.length)]);
      placed++;
    }
    // Truncate the count attribute so unused matrix slots are skipped.
    inst.count = placed;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    scene.add(inst);
    this._objects.push(inst);

    console.log(
      `%c[Trees] 🌼 ${placed} wildflowers scattered across the meadow.`,
      "color:#f48fb1;font-weight:bold;",
    );
  },

  /**
   * Hill-ring boulders. Lumpy icosahedrons scaled non-uniformly to read
   * as natural rocks, scattered across the inner hill band so the bowl
   * rim breaks into landmarks. Mossy green-grey palette so they blend
   * with the hill / mountain colour bands. Single InstancedMesh.
   */
  _buildHillBoulders(scene, getY) {
    const TARGET = 36;
    const RING_MIN = 56;
    const RING_MAX = 84;
    const geom = new THREE.IcosahedronGeometry(0.8, 1); // ~80 tris each
    const mat = new THREE.MeshStandardMaterial({
      color: 0x6c7860,
      roughness: 0.92,
      metalness: 0.04,
      vertexColors: false,
    });
    const inst = new THREE.InstancedMesh(geom, mat, TARGET);
    inst.name = "flora_hill_boulders";
    inst.userData.anuId = "flora.hill_boulders";
    inst.userData.anuKind = "landmark_hill_boulder";
    inst.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.frustumCulled = true;

    let seed = 0x80045309;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const dummy = new THREE.Object3D();
    const tintScratch = new THREE.Color();
    for (let i = 0; i < TARGET; i++) {
      const a = rnd() * Math.PI * 2;
      const r = RING_MIN + rnd() * (RING_MAX - RING_MIN);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const baseY = getY(x, z);
      // Non-uniform XZ scaling so each boulder reads as a flattened
      // hunk rather than a perfect sphere. Y stays close to 1× so it
      // sits cleanly on the hill slope.
      const sx = 1.4 + rnd() * 1.6;
      const sy = 0.9 + rnd() * 0.7;
      const sz = 1.2 + rnd() * 1.6;
      // Sink ~25% of the boulder so it reads as embedded, not glued.
      dummy.position.set(x, baseY - sy * 0.25, z);
      dummy.rotation.set(
        (rnd() - 0.5) * 0.4,
        rnd() * Math.PI * 2,
        (rnd() - 0.5) * 0.4,
      );
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      // Mossy tint variation — mostly grey-greens, occasional warm beige.
      const h = rnd();
      if (h < 0.7) tintScratch.setHSL(0.28, 0.18, 0.42 + rnd() * 0.12);
      else tintScratch.setHSL(0.10, 0.22, 0.50 + rnd() * 0.12);
      inst.setColorAt(i, tintScratch);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    scene.add(inst);
    this._objects.push(inst);
    console.log(
      `%c[Trees] 🪨 ${TARGET} hill-ring boulders scattered around the bowl rim.`,
      "color:#a1a89a;font-weight:bold;",
    );
  },

  /**
   * Meadow motes. Slow-drifting Points cloud — pollen / dandelion seed
   * silhouette. Each mote has its own home position; per-frame `update`
   * adds a gentle sine-driven wander so the field "breathes" instead of
   * sitting still. Stored on the module so `update(delta)` can drive it.
   */
  _buildMeadowMotes(scene) {
    const N = 80;
    const positions = new Float32Array(N * 3);
    const homes = new Float32Array(N * 3); // anchor XYZ per mote
    const phases = new Float32Array(N);     // animation phase offset
    const drifts = new Float32Array(N * 3); // per-mote drift vector amplitude

    let seed = 0x3acedaf1;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < N; i++) {
      // Bias spawn radius toward the centre of the valley so motes
      // float around the village rather than out near the hill ring.
      const r = Math.sqrt(rnd()) * 35;
      const a = rnd() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = 1.0 + rnd() * 2.5; // motes hover at 1–3.5 m
      homes[i * 3] = x;
      homes[i * 3 + 1] = y;
      homes[i * 3 + 2] = z;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      phases[i] = rnd() * Math.PI * 2;
      drifts[i * 3] = 0.55 + rnd() * 0.7;
      drifts[i * 3 + 1] = 0.20 + rnd() * 0.30;
      drifts[i * 3 + 2] = 0.55 + rnd() * 0.7;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xfffbe0,
      size: 0.16,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const motes = new THREE.Points(geom, mat);
    motes.name = "flora_meadow_motes";
    motes.userData.anuId = "flora.meadow_motes";
    motes.userData.anuKind = "atmosphere_motes";
    motes.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
    motes.frustumCulled = false; // motes drift past edges of bounding box
    scene.add(motes);
    this._objects.push(motes);
    this._motes = {
      points: motes,
      geom,
      positions,
      homes,
      phases,
      drifts,
      time: 0,
    };
    console.log(
      "%c[Trees] ✨ 80 meadow motes drifting overhead.",
      "color:#fff59d;font-weight:bold;",
    );
  },

  /**
   * Tipi welcome glows. At each tipi anchor we drop a soft emissive
   * door-mat decal on the deck + a low-intensity warm point light a few
   * inches above it. Reads as "lantern light spilling onto the
   * threshold". Point lights skip shadow casting so the cost stays in
   * the cheap-light category even with the renderer's shadow pass on.
   */
  _buildTipiWelcomeGlows(scene, getY) {
    /**
     * Build the welcome mat — radial-gradient canvas texture so the
     * glow falls off smoothly from a hot golden centre to transparent
     * edges. MeshBasicMaterial — emissive-only, no per-fragment
     * lighting math (we dropped the PointLight in the 120-FPS pass).
     */
    const buildMat = () => {
      const W = 128;
      const cv = document.createElement("canvas");
      cv.width = cv.height = W;
      const ctx = cv.getContext("2d");
      const grad = ctx.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
      grad.addColorStop(0.0, "rgba(255, 232, 168, 0.95)");
      grad.addColorStop(0.45, "rgba(255, 192, 110, 0.55)");
      grad.addColorStop(1.0, "rgba(255, 192, 110, 0.0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, W);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const matDiscGeom = new THREE.CircleGeometry(1.45, 32);
      matDiscGeom.rotateX(-Math.PI / 2);
      const matMat = new THREE.MeshBasicMaterial({
        map: tex,
        color: 0xffffff,
        transparent: true,
        opacity: 1.0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(matDiscGeom, matMat);
      m.renderOrder = 6;
      return m;
    };

    const anchors = [
      { x: 0, z: 0, key: "tipi1" },
      { x: V2_TILE_WORLD * 2, z: 0, key: "tipi2" },
    ];
    const ENTRANCE_OFFSET_Z = -(4.7 + 0.4);
    for (const a of anchors) {
      const ex = a.x;
      const ez = a.z + ENTRANCE_OFFSET_Z;
      const ground = getY(ex, ez);
      const mat = buildMat();
      mat.name = `flora_tipi_welcome_mat_${a.key}`;
      mat.userData.anuId = `flora.tipi_welcome_mat.${a.key}`;
      mat.userData.anuKind = "tipi_welcome_mat";
      mat.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
      mat.position.set(ex, ground + 0.015, ez);
      scene.add(mat);
      this._objects.push(mat);
    }
    console.log(
      "%c[Trees] 🪔 Welcome glow decals at both tipi entrances (emissive-only).",
      "color:#ffb74d;font-weight:bold;",
    );
  },

  /**
   * Fairy mushroom rings. Pick a handful of accepted tree slots in the
   * meadow / mid-ring and stamp a ring of 3–8 toadstools at each
   * trunk's base. One InstancedMesh shared across all rings; per-
   * instance colour picks from a red / brown / butter palette so the
   * cluster reads as a small mushroom community rather than identical
   * red caps.
   */
  _buildFairyMushrooms(scene, getY, treeSlots) {
    const PALETTE_HEX = [
      0xd03a2a, // classic red toadstool
      0xa55027, // chestnut
      0xe8c46a, // butter
      0xc25640, // muted red
      0x88472a, // dark brown
      0xf7d987, // pale yellow
    ];
    const palette = PALETTE_HEX.map((h) => new THREE.Color(h));
    const RING_TARGETS = 6; // number of fairy rings
    const RING_COUNT_MIN = 3;
    const RING_COUNT_MAX = 8;
    // Cap so the InstancedMesh is sized for the worst case.
    const MAX_MUSHROOMS = RING_TARGETS * RING_COUNT_MAX;

    // Mushroom = small cap (icosphere lower half) sitting on the
    // ground. We skip the stem to keep tri count low — at chase-cam
    // distance the dome reads as a stylised cap on its own. 32 tris.
    const geom = new THREE.IcosahedronGeometry(0.14, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.62,
      metalness: 0.0,
      emissive: 0x140804,
      emissiveIntensity: 0.10,
    });
    const inst = new THREE.InstancedMesh(geom, mat, MAX_MUSHROOMS);
    inst.name = "flora_fairy_mushrooms";
    inst.userData.anuId = "flora.fairy_mushrooms";
    inst.userData.anuKind = "fairy_mushroom_ring";
    inst.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
    inst.castShadow = true;
    inst.receiveShadow = true;

    let seed = 0xb007e711;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    // Filter tree slots to ones in the inner meadow band that are
    // worth ringing. Stride through them deterministically so the same
    // trees host the rings on each reload.
    const candidates = [];
    for (let i = 0; i < treeSlots.length; i++) {
      const t = treeSlots[i];
      const d2 = t.x * t.x + t.z * t.z;
      if (d2 < 30 * 30 && d2 > 12 * 12) candidates.push(t);
    }
    const dummy = new THREE.Object3D();
    const tintScratch = new THREE.Color();
    let placed = 0;
    for (
      let ringIdx = 0;
      ringIdx < RING_TARGETS && placed < MAX_MUSHROOMS;
      ringIdx++
    ) {
      if (candidates.length === 0) break;
      const host = candidates[Math.floor(rnd() * candidates.length)];
      const ringR = 0.95 + rnd() * 0.55;
      const count =
        RING_COUNT_MIN +
        Math.floor(rnd() * (RING_COUNT_MAX - RING_COUNT_MIN + 1));
      const angleBase = rnd() * Math.PI * 2;
      for (let i = 0; i < count && placed < MAX_MUSHROOMS; i++) {
        const a = angleBase + (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.3;
        const r = ringR + (rnd() - 0.5) * 0.18;
        const x = host.x + Math.cos(a) * r;
        const z = host.z + Math.sin(a) * r;
        const baseY = getY(x, z);
        const sJ = 0.7 + rnd() * 1.1;
        dummy.position.set(x, baseY + 0.04, z);
        dummy.rotation.set(0, rnd() * Math.PI * 2, 0);
        dummy.scale.set(sJ, sJ * 0.62, sJ); // squashed dome — cap-like
        dummy.updateMatrix();
        inst.setMatrixAt(placed, dummy.matrix);
        inst.setColorAt(placed, palette[Math.floor(rnd() * palette.length)]);
        placed++;
      }
    }
    inst.count = placed;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    scene.add(inst);
    this._objects.push(inst);
    console.log(
      `%c[Trees] 🍄 ${placed} mushrooms across ${RING_TARGETS} fairy rings.`,
      "color:#c43a2a;font-weight:bold;",
    );
  },

  /**
   * Stone cairns. A small set of stacked-rock waypoints placed along
   * the worn path — each cairn is a quick stack of 3–4 round rocks
   * that decrease in size as they pile up. Single InstancedMesh for
   * all the rocks across all cairns.
   */
  _buildStoneCairns(scene, getY) {
    const CAIRN_ANCHORS = [
      // Along spawn → tipi 1, near the bend where the path turns east.
      { x: -1.0, z: -16.0 },
      // Between the tipis, just south of the worn track.
      { x: V2_TILE_WORLD, z: 2.2 },
      // On the pond approach, near where the trail bends north.
      { x: 5.4, z: 9.6 },
    ];
    const STONES_PER_CAIRN = 4;
    const N = CAIRN_ANCHORS.length * STONES_PER_CAIRN;
    const geom = new THREE.IcosahedronGeometry(0.22, 1); // ~80 tris
    const mat = new THREE.MeshStandardMaterial({
      color: 0x9a958a,
      roughness: 0.88,
      metalness: 0.05,
      vertexColors: false,
    });
    const inst = new THREE.InstancedMesh(geom, mat, N);
    inst.name = "flora_stone_cairns";
    inst.userData.anuId = "flora.stone_cairns";
    inst.userData.anuKind = "landmark_stone_cairn";
    inst.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
    inst.castShadow = true;
    inst.receiveShadow = true;

    let seed = 0xcafeca12;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const dummy = new THREE.Object3D();
    const tintScratch = new THREE.Color();
    let idx = 0;
    for (const anchor of CAIRN_ANCHORS) {
      const baseY = getY(anchor.x, anchor.z);
      let yCursor = baseY - 0.05;
      // Stack stones from biggest at the bottom to smallest on top.
      const sizes = [1.0, 0.78, 0.58, 0.40];
      for (let s = 0; s < STONES_PER_CAIRN; s++) {
        const sJ = sizes[s] * (0.9 + rnd() * 0.2);
        const halfH = 0.22 * sJ * 0.85; // sJ × original geom radius × squash
        yCursor += halfH;
        const wobX = (rnd() - 0.5) * 0.08 * (s + 1);
        const wobZ = (rnd() - 0.5) * 0.08 * (s + 1);
        dummy.position.set(anchor.x + wobX, yCursor, anchor.z + wobZ);
        dummy.rotation.set(
          (rnd() - 0.5) * 0.5,
          rnd() * Math.PI * 2,
          (rnd() - 0.5) * 0.5,
        );
        // Squash slightly so the stones read as river-tumbled, not balls.
        dummy.scale.set(sJ, sJ * 0.78, sJ);
        dummy.updateMatrix();
        inst.setMatrixAt(idx, dummy.matrix);
        tintScratch.setHSL(0.08, 0.06, 0.48 + rnd() * 0.18);
        inst.setColorAt(idx, tintScratch);
        yCursor += halfH * 0.6; // next stone sits with slight overlap
        idx++;
      }
    }
    inst.count = idx;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    scene.add(inst);
    this._objects.push(inst);
    console.log(
      `%c[Trees] 🪨 ${CAIRN_ANCHORS.length} stone cairns marking the trail.`,
      "color:#a89c8a;font-weight:bold;",
    );
  },

  /**
   * Berry bushes. Two InstancedMeshes — a dark-green foliage mass and
   * a smaller bright-berry cluster scattered around each foliage
   * mound. Foliage placed where the meadow meets the hill (radii
   * 38–54) so the bushes read as "trailside forage", not lawn art.
   */
  _buildBerryBushes(scene, getY) {
    const BUSH_COUNT = 10;
    const PER_BUSH_BERRIES = 7;
    const BUSH_RADIUS_MIN = 38;
    const BUSH_RADIUS_MAX = 54;

    // Foliage geometry — squashed icosphere.
    const foliageGeom = new THREE.IcosahedronGeometry(0.7, 1);
    const foliageMat = new THREE.MeshStandardMaterial({
      color: 0x2f6638,
      roughness: 0.78,
      metalness: 0.0,
      emissive: 0x081205,
      emissiveIntensity: 0.10,
    });
    const foliageInst = new THREE.InstancedMesh(
      foliageGeom,
      foliageMat,
      BUSH_COUNT,
    );
    foliageInst.name = "flora_berry_bush_foliage";
    foliageInst.userData.anuId = "flora.berry_bushes.foliage";
    foliageInst.userData.anuKind = "berry_bush_foliage";
    foliageInst.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
    foliageInst.castShadow = true;
    foliageInst.receiveShadow = true;

    // Berries — small bright icospheres with per-instance color.
    const BERRY_TOTAL = BUSH_COUNT * PER_BUSH_BERRIES;
    const berryGeom = new THREE.IcosahedronGeometry(0.06, 0); // 20 tris
    const berryMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.42,
      metalness: 0.0,
      emissive: 0x140404,
      emissiveIntensity: 0.18,
    });
    const berryInst = new THREE.InstancedMesh(berryGeom, berryMat, BERRY_TOTAL);
    berryInst.name = "flora_berry_bush_fruit";
    berryInst.userData.anuId = "flora.berry_bushes.fruit";
    berryInst.userData.anuKind = "berry_bush_fruit";
    berryInst.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
    berryInst.castShadow = false;
    berryInst.receiveShadow = true;

    const BERRY_PALETTE = [
      new THREE.Color(0xc8133b), // raspberry
      new THREE.Color(0x6a1f8a), // blackberry
      new THREE.Color(0x2a4fa0), // blueberry
      new THREE.Color(0xd24d6c), // soft pink
    ];

    let seed = 0xbe771e55;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const dummy = new THREE.Object3D();
    let berryIdx = 0;
    for (let i = 0; i < BUSH_COUNT; i++) {
      const a = rnd() * Math.PI * 2;
      const r = BUSH_RADIUS_MIN + rnd() * (BUSH_RADIUS_MAX - BUSH_RADIUS_MIN);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const baseY = getY(x, z);
      const sJ = 0.85 + rnd() * 0.55;
      // Squat — bush is wider than tall.
      dummy.position.set(x, baseY + 0.4 * sJ, z);
      dummy.rotation.set(0, rnd() * Math.PI * 2, 0);
      dummy.scale.set(sJ, sJ * 0.62, sJ);
      dummy.updateMatrix();
      foliageInst.setMatrixAt(i, dummy.matrix);

      // Berry cluster — scatter near the top hemisphere of the foliage.
      const berryColor = BERRY_PALETTE[Math.floor(rnd() * BERRY_PALETTE.length)];
      for (let b = 0; b < PER_BUSH_BERRIES; b++) {
        const ba = rnd() * Math.PI * 2;
        const br = (0.30 + rnd() * 0.35) * sJ;
        const bh = (rnd() - 0.2) * 0.45 * sJ;
        dummy.position.set(
          x + Math.cos(ba) * br,
          baseY + 0.45 * sJ + bh,
          z + Math.sin(ba) * br,
        );
        dummy.rotation.set(0, rnd() * Math.PI * 2, 0);
        dummy.scale.setScalar(0.85 + rnd() * 0.55);
        dummy.updateMatrix();
        berryInst.setMatrixAt(berryIdx, dummy.matrix);
        berryInst.setColorAt(berryIdx, berryColor);
        berryIdx++;
      }
    }
    foliageInst.instanceMatrix.needsUpdate = true;
    berryInst.count = berryIdx;
    berryInst.instanceMatrix.needsUpdate = true;
    if (berryInst.instanceColor) berryInst.instanceColor.needsUpdate = true;
    scene.add(foliageInst);
    scene.add(berryInst);
    this._objects.push(foliageInst);
    this._objects.push(berryInst);
    console.log(
      `%c[Trees] 🫐 ${BUSH_COUNT} berry bushes ringing the meadow edge.`,
      "color:#7d4f9e;font-weight:bold;",
    );
  },

  /**
   * Magical crystal landmark. A single emissive octahedron cluster on
   * the north hill — visible from spawn so the very first thing the
   * player sees is a soft glowing landmark drawing them into the
   * valley. ~30 triangles total, one draw call.
   */
  _buildMagicCrystal(scene, getY) {
    /**
     * Position — on the north hill slope, in the direction from origin
     * toward the pond and beyond. Sits at the inner edge of the hill
     * ring so it reads from spawn (which is at z ≈ −32.6) as a far
     * landmark across the valley.
     */
    const pondLen = Math.hypot(
      V2_POND_ENCLAVE_CENTER_X_M,
      V2_POND_ENCLAVE_CENTER_Z_M,
    ) || 1;
    const dx = V2_POND_ENCLAVE_CENTER_X_M / pondLen;
    const dz = V2_POND_ENCLAVE_CENTER_Z_M / pondLen;
    const RADIUS = 70; // out on the hill, past the pond
    const cx = dx * RADIUS;
    const cz = dz * RADIUS;
    const baseY = getY(cx, cz);

    const group = new THREE.Group();
    group.name = "flora_magic_crystal";
    group.userData.anuId = "flora.magic_crystal";
    group.userData.anuKind = "landmark_magic_crystal";
    group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
    group.position.set(cx, baseY + 0.4, cz);
    group.rotation.y = Math.random() * Math.PI * 2;

    // Three octahedra of varying sizes pointing slightly different
    // directions — reads as a faceted crystal cluster rather than a
    // single floating gem.
    const SHARDS = [
      { y: 0, scale: 1.0, tilt: 0.0, color: 0x88dfff },
      { y: 0.3, scale: 0.72, tilt: 0.32, color: 0xb6ffe6 },
      { y: 0.55, scale: 0.55, tilt: -0.18, color: 0xfff0ff },
    ];
    for (const s of SHARDS) {
      const geom = new THREE.OctahedronGeometry(0.85 * s.scale, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: s.color,
        roughness: 0.08,
        metalness: 0.35,
        emissive: s.color,
        emissiveIntensity: 0.55,
        transparent: true,
        opacity: 0.92,
      });
      const m = new THREE.Mesh(geom, mat);
      m.position.set(
        (Math.random() - 0.5) * 0.25,
        s.y + 0.6,
        (Math.random() - 0.5) * 0.25,
      );
      m.rotation.set(s.tilt, Math.random() * Math.PI * 2, s.tilt * 0.7);
      m.castShadow = false; // crystal is its own emitter
      group.add(m);
    }

    // Soft halo point light so the crystal's glow spills onto the
    // ground around it.
    const halo = new THREE.PointLight(0xbfeaff, 0.9, 9.0, 2.0);
    halo.castShadow = false;
    halo.position.set(0, 1.2, 0);
    group.add(halo);

    scene.add(group);
    this._objects.push(group);
    console.log(
      `%c[Trees] 💎 Magic crystal landmark on the north hill at (${cx.toFixed(1)}, ${cz.toFixed(1)}).`,
      "color:#88dfff;font-weight:bold;",
    );
  },

  /**
   * Wooden footbridge — kid-scale plank deck with two simple log
   * handrails. Placed along the pond approach, perpendicular to the
   * worn trail. Decorative; the player walks across it as a play
   * feature rather than to cross any obstacle.
   *
   * Lives in a `Group` so the orchestrator can clean it up in one
   * shot. Materials shared across planks and rails to minimise draw
   * calls (planks merge → 1 draw, rails → 2 draws).
   */
  _buildWoodenBridge(scene, getY) {
    /**
     * Position: between cairn #2 (between tipis) and cairn #3 (path
     * bend toward pond). Oriented perpendicular to the trail at that
     * spot so kids walk across it. Path bend angle ≈ atan2(7.5-1.1,
     * 4.4-(TIPI2_X*0.5)) — but we'll just pick a fixed XZ that lies on
     * the curve.
     */
    const cx = 3.0;
    const cz = 4.4;
    const yawRad = -0.78; // roughly perpendicular to the pond-approach trail
    const group = new THREE.Group();
    group.name = "flora_wooden_bridge";
    group.userData.anuId = "flora.wooden_bridge";
    group.userData.anuKind = "landmark_wooden_bridge";
    group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
    const baseY = getY(cx, cz);
    group.position.set(cx, baseY + 0.18, cz);
    group.rotation.y = yawRad;

    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x7d5a36,
      roughness: 0.84,
      metalness: 0.04,
    });
    const darkWoodMat = new THREE.MeshStandardMaterial({
      color: 0x4f3a22,
      roughness: 0.88,
      metalness: 0.04,
    });

    // Deck planks — 7 horizontal planks merged into one geometry so
    // the whole bridge surface is a single draw call.
    const plankGeoms = [];
    const N_PLANKS = 7;
    const plankLen = 1.7;   // width across bridge (the foot path)
    const plankW = 0.30;    // along-bridge step depth
    const plankH = 0.06;
    const totalLen = N_PLANKS * (plankW + 0.025); // small gaps between planks
    const startZ = -totalLen / 2;
    for (let i = 0; i < N_PLANKS; i++) {
      const g = new THREE.BoxGeometry(plankLen, plankH, plankW);
      g.translate(0, 0, startZ + i * (plankW + 0.025) + plankW / 2);
      plankGeoms.push(g);
    }
    const merged = _mergeBufferGeometries(plankGeoms);
    plankGeoms.forEach((g) => g.dispose());
    const deck = new THREE.Mesh(merged, woodMat);
    deck.castShadow = true;
    deck.receiveShadow = true;
    deck.name = "wooden_bridge_deck";
    group.add(deck);

    // Two log handrails — slim cylinders running along the bridge.
    const railLen = totalLen + 0.1;
    for (const side of [-1, 1]) {
      const railGeom = new THREE.CylinderGeometry(0.04, 0.04, railLen, 8);
      railGeom.rotateX(Math.PI / 2);
      const rail = new THREE.Mesh(railGeom, darkWoodMat);
      rail.position.set(side * (plankLen / 2 - 0.05), 0.30, 0);
      rail.castShadow = true;
      rail.receiveShadow = true;
      rail.name = `wooden_bridge_rail_${side > 0 ? "r" : "l"}`;
      group.add(rail);

      // Two posts per rail.
      for (const sign of [-1, 1]) {
        const postGeom = new THREE.CylinderGeometry(0.045, 0.055, 0.42, 8);
        const post = new THREE.Mesh(postGeom, darkWoodMat);
        post.position.set(
          side * (plankLen / 2 - 0.05),
          0.18,
          sign * (totalLen / 2 - 0.06),
        );
        post.castShadow = true;
        post.receiveShadow = true;
        group.add(post);
      }
    }
    scene.add(group);
    this._objects.push(group);
    console.log(
      "%c[Trees] 🪵 Wooden footbridge built on the pond approach.",
      "color:#a08066;font-weight:bold;",
    );
  },

  /**
   * Rope swing — two ropes + a plank seat hanging from an imaginary
   * branch above. Placed in the meadow just east of tipi 1 where kids
   * pass on their way to tipi 2. Lightweight Group of 3 meshes.
   */
  _buildRopeSwing(scene, getY) {
    const cx = -3.6;
    const cz = -4.2;
    const branchY = 2.6;   // imaginary tree branch height
    const seatY = 0.55;    // seat bottom
    const baseY = getY(cx, cz);

    const group = new THREE.Group();
    group.name = "flora_rope_swing";
    group.userData.anuId = "flora.rope_swing";
    group.userData.anuKind = "landmark_rope_swing";
    group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
    group.position.set(cx, baseY, cz);
    // Tilt slightly so the swing reads as gently mid-arc, not dead-still.
    group.rotation.x = -0.06;

    const ropeMat = new THREE.MeshStandardMaterial({
      color: 0xb89570,
      roughness: 0.95,
      metalness: 0.02,
    });
    const seatMat = new THREE.MeshStandardMaterial({
      color: 0x6e4a2c,
      roughness: 0.78,
      metalness: 0.04,
    });

    const ropeLen = branchY - seatY;
    const ropeSeparation = 0.36;
    for (const side of [-1, 1]) {
      const g = new THREE.CylinderGeometry(0.015, 0.015, ropeLen, 6);
      g.translate(0, ropeLen / 2 + seatY, 0);
      const rope = new THREE.Mesh(g, ropeMat);
      rope.position.x = side * ropeSeparation;
      rope.castShadow = true;
      group.add(rope);
    }
    // Seat plank.
    const seatGeom = new THREE.BoxGeometry(ropeSeparation * 2.2, 0.06, 0.22);
    const seat = new THREE.Mesh(seatGeom, seatMat);
    seat.position.y = seatY;
    seat.castShadow = true;
    seat.receiveShadow = true;
    group.add(seat);

    scene.add(group);
    this._objects.push(group);
    console.log(
      "%c[Trees] 🪢 Rope swing hung in the east meadow.",
      "color:#cda878;font-weight:bold;",
    );
  },

  /**
   * Falling-leaves Points cloud — second drift layer over the meadow
   * motes. Bigger size, warmer per-vertex colour, biased downward in
   * the per-frame update so leaves "tumble" rather than just drift.
   * Stored on `_leaves` and animated alongside `_motes` in update().
   */
  _buildFallingLeaves(scene) {
    const N = 60;
    const positions = new Float32Array(N * 3);
    const homes = new Float32Array(N * 3);
    const phases = new Float32Array(N);
    const drifts = new Float32Array(N * 3);
    const colors = new Float32Array(N * 3);
    let seed = 0xeafd2cc1;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const palette = [
      new THREE.Color(0xff9148), // orange
      new THREE.Color(0xffce5e), // yellow
      new THREE.Color(0xd85a3a), // red-orange
      new THREE.Color(0x9b6a2a), // chestnut
    ];
    for (let i = 0; i < N; i++) {
      const r = Math.sqrt(rnd()) * 38;
      const a = rnd() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = 3.5 + rnd() * 5.5;
      homes[i * 3] = x;
      homes[i * 3 + 1] = y;
      homes[i * 3 + 2] = z;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      phases[i] = rnd() * Math.PI * 2;
      drifts[i * 3] = 0.8 + rnd() * 1.4;       // horizontal drift amp
      drifts[i * 3 + 1] = 1.4 + rnd() * 1.6;    // vertical fall amp
      drifts[i * 3 + 2] = 0.8 + rnd() * 1.4;
      const c = palette[Math.floor(rnd() * palette.length)];
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      vertexColors: true,
      size: 0.34,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.80,
      depthWrite: false,
    });
    const pts = new THREE.Points(geom, mat);
    pts.name = "flora_falling_leaves";
    pts.userData.anuId = "flora.falling_leaves";
    pts.userData.anuKind = "atmosphere_falling_leaves";
    pts.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
    pts.frustumCulled = false;
    scene.add(pts);
    this._objects.push(pts);
    this._leaves = {
      points: pts,
      geom,
      positions,
      homes,
      phases,
      drifts,
      time: 0,
    };
    console.log(
      "%c[Trees] 🍂 60 falling leaves drifting through the canopy.",
      "color:#e08a3a;font-weight:bold;",
    );
  },

  /**
   * Sit stump near the crystal. A short cylinder cut to look like a
   * felled tree section. One mesh, ~24 tris. Anchored on the same
   * hill ray as the crystal so the two read as a "sit and watch the
   * crystal" beat.
   */
  _buildSitStump(scene, getY) {
    const pondLen = Math.hypot(
      V2_POND_ENCLAVE_CENTER_X_M,
      V2_POND_ENCLAVE_CENTER_Z_M,
    ) || 1;
    const dx = V2_POND_ENCLAVE_CENTER_X_M / pondLen;
    const dz = V2_POND_ENCLAVE_CENTER_Z_M / pondLen;
    // Slightly south of the crystal (which sits at R=70 on this ray),
    // so it reads as "viewing seat".
    const R = 66.5;
    // Sidestep so the stump isn't directly on the ray either — feels
    // hand-placed rather than along a graph.
    const perpX = -dz;
    const perpZ = dx;
    const cx = dx * R + perpX * 1.4;
    const cz = dz * R + perpZ * 1.4;
    const baseY = getY(cx, cz);
    const stumpGeom = new THREE.CylinderGeometry(0.36, 0.42, 0.48, 16);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xb9905a,
      roughness: 0.82,
      metalness: 0.0,
    });
    const sideMat = new THREE.MeshStandardMaterial({
      color: 0x6e4a2b,
      roughness: 0.94,
      metalness: 0.0,
    });
    // CylinderGeometry assigns material indices: 0 = side, 1 = top,
    // 2 = bottom. Use a material array for visible growth rings on top.
    const stump = new THREE.Mesh(stumpGeom, [sideMat, ringMat, sideMat]);
    stump.position.set(cx, baseY + 0.24, cz);
    stump.rotation.y = Math.random() * Math.PI * 2;
    stump.castShadow = true;
    stump.receiveShadow = true;
    stump.name = "flora_crystal_stump";
    stump.userData.anuId = "flora.crystal_stump";
    stump.userData.anuKind = "landmark_sit_stump";
    stump.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
    scene.add(stump);
    this._objects.push(stump);
    console.log(
      "%c[Trees] 🪵 Sit stump placed by the crystal.",
      "color:#b9905a;font-weight:bold;",
    );
  },

  update(delta) {
    if (this._windUniform) this._windUniform.value += delta;
    // Drift the meadow motes — gentle sine wander around each mote's
    // home anchor. Vertical bob is slower than horizontal so they read
    // as drifting on a soft breeze, not flying.
    if (this._motes) {
      const m = this._motes;
      m.time += delta;
      const t = m.time;
      const pos = m.positions;
      const homes = m.homes;
      const phases = m.phases;
      const drifts = m.drifts;
      for (let i = 0; i < m.phases.length; i++) {
        const i3 = i * 3;
        const ph = phases[i];
        pos[i3] = homes[i3] + Math.sin(t * 0.38 + ph) * drifts[i3];
        pos[i3 + 1] =
          homes[i3 + 1] + Math.sin(t * 0.18 + ph * 1.7) * drifts[i3 + 1];
        pos[i3 + 2] =
          homes[i3 + 2] + Math.cos(t * 0.42 + ph * 0.9) * drifts[i3 + 2];
      }
      m.geom.attributes.position.needsUpdate = true;
    }
    // Falling leaves — same wander shape but with a downward bias so
    // each leaf "tumbles" past its home Y as it drifts, then wraps
    // back to the top of the drift envelope.
    if (this._leaves) {
      const l = this._leaves;
      l.time += delta;
      const t = l.time;
      const pos = l.positions;
      const homes = l.homes;
      const phases = l.phases;
      const drifts = l.drifts;
      for (let i = 0; i < l.phases.length; i++) {
        const i3 = i * 3;
        const ph = phases[i];
        pos[i3] = homes[i3] + Math.sin(t * 0.32 + ph) * drifts[i3];
        // Sawtooth-ish fall — leaf drops `drifts.y` m below home over
        // ~10s, then snaps back up to home and repeats. Modulo on the
        // accumulated `t` keeps the leaf in a sane Y range without an
        // explicit wrap.
        const fallCycle = ((t * 0.10 + ph) % 1.0);
        const fallY = -fallCycle * drifts[i3 + 1];
        pos[i3 + 1] =
          homes[i3 + 1] + fallY + Math.sin(t * 0.9 + ph * 1.7) * 0.18;
        pos[i3 + 2] =
          homes[i3 + 2] + Math.cos(t * 0.36 + ph * 0.9) * drifts[i3 + 2];
      }
      l.geom.attributes.position.needsUpdate = true;
    }
  },

  /**
   * Proximity-clip leaf InstancedMesh instances near the player and
   * buildings (May-14 2026 user spec, corrected: "if it is obstructing
   * player or a building" — the prior pass hid every leaf in the world
   * and turned the map into "crap").
   *
   * For each leaf instance, read its world XZ from the instance matrix,
   * test against each clip centre, and zero-scale instances whose XZ
   * sits within `radius` of any centre. Instances OUTSIDE every clip
   * radius keep their original scale, so 99 %+ of the canopy reads
   * normally on the overhead view.
   *
   * Clip targets are passed in so World.js can include the player,
   * tipi 1, tipi 2, and any Player's Tipi from the Village Builder.
   * Pass an empty / null `clipTargets` (or `mapView === false`) to
   * restore every instance.
   *
   * Idempotent + cheap: the per-instance scale check is O(N × M) where
   * N = leaf instance count and M = clip centre count (typically ≤ 6).
   * Throttle externally — see World.js — so this runs on view-enter
   * and at ~3 Hz while moving, not every frame.
   *
   * @param {boolean} mapView
   * @param {{x:number,z:number,radius:number}[]|null} clipTargets
   */
  setFoliageHiddenForMapView(mapView, clipTargets) {
    if (!this._leafMeshes?.length) return;
    if (!this._clipDummyMatrix) {
      this._clipDummyMatrix = new THREE.Matrix4();
    }
    const showAll = !mapView || !Array.isArray(clipTargets) || clipTargets.length === 0;
    for (const leafMesh of this._leafMeshes) {
      const count = leafMesh.count;
      /**
       * One-time per-mesh caches (May-14 2026 FPS audit):
       *   • `_clipCacheXZ`  Float32Array of (x,z) world positions, one
       *     pair per instance. Read once via `getMatrixAt` at first call;
       *     never re-read. Eliminates the per-frame `getMatrixAt` cost
       *     that was the dominant CPU expense of the map-view clip.
       *   • `_clipCacheScale`  baseline uniform scale per instance,
       *     captured at the same first-pass read.
       *   • `_clipHidden`  Uint8Array bitmap of current hidden state per
       *     instance, so we only call `setMatrixAt` on transitions (an
       *     idle map-view pass with no movement now writes zero matrices).
       *   • `_clipDirty`  flag — only flips `needsUpdate=true` when at
       *     least one instance actually changed state.
       */
      const ud = leafMesh.userData;
      // First pass: stash the FULL 16-float original matrix for every
      // instance (so trees keep their authored random Y rotation when
      // restored). Also record XZ separately so the hot loop is tight.
      if (!ud._clipCacheMtx || ud._clipCacheMtx.length !== count * 16) {
        const mtx = new Float32Array(count * 16);
        const xz = new Float32Array(count * 2);
        for (let i = 0; i < count; i++) {
          leafMesh.getMatrixAt(i, this._clipDummyMatrix);
          const e = this._clipDummyMatrix.elements;
          mtx.set(e, i * 16);
          xz[i * 2 + 0] = e[12];
          xz[i * 2 + 1] = e[14];
        }
        ud._clipCacheMtx = mtx;
        ud._clipCacheXZ = xz;
        ud._clipHidden = new Uint8Array(count);
      }
      const cacheMtx = ud._clipCacheMtx;
      const cacheXZ = ud._clipCacheXZ;
      const hidden = ud._clipHidden;
      let dirty = false;

      // Pre-extract clip targets into local floats so the inner loop
      // doesn't index into an array of objects on every iteration.
      const nTargets = showAll ? 0 : clipTargets.length;
      const tx = new Float32Array(nTargets);
      const tz = new Float32Array(nTargets);
      const tr2 = new Float32Array(nTargets);
      for (let c = 0; c < nTargets; c++) {
        tx[c] = clipTargets[c].x;
        tz[c] = clipTargets[c].z;
        tr2[c] = clipTargets[c].radius * clipTargets[c].radius;
      }

      for (let i = 0; i < count; i++) {
        const wx = cacheXZ[i * 2 + 0];
        const wz = cacheXZ[i * 2 + 1];
        let shouldHide = 0;
        for (let c = 0; c < nTargets; c++) {
          const dx = wx - tx[c];
          const dz = wz - tz[c];
          if (dx * dx + dz * dz <= tr2[c]) { shouldHide = 1; break; }
        }
        const wasHidden = hidden[i];
        if (shouldHide === wasHidden) continue; // ← no state change, skip
        hidden[i] = shouldHide;
        const e = this._clipDummyMatrix.elements;
        if (shouldHide) {
          // Zero the entire transform → invisible (faces collapse to a point).
          for (let k = 0; k < 16; k++) e[k] = 0;
          e[15] = 1;
        } else {
          // Restore the cached authored matrix verbatim (rotation + scale
          // + translation) so the tree returns to its baked random Y yaw.
          const base = i * 16;
          for (let k = 0; k < 16; k++) e[k] = cacheMtx[base + k];
        }
        leafMesh.setMatrixAt(i, this._clipDummyMatrix);
        dirty = true;
      }
      if (dirty) leafMesh.instanceMatrix.needsUpdate = true;
    }
  },

  /** @param {string | undefined} season */
  _applySeasonSurfaceTint(season) {
    if (
      typeof season !== "string" ||
      !this._leafMeshes.length ||
      !this._foliageBaseColors.length
    ) {
      return;
    }
    const land = SEASON_SURFACE_TINTS[season];
    if (!land) return;
    this._treeTintScratch.setHex(land.trees);
    const tinted = this._foliageSeasonScratch;
    const n = this._foliageBaseColors.length;
    for (const leafMesh of this._leafMeshes) {
      if (!leafMesh.instanceColor) continue;
      for (let i = 0; i < n; i++) {
        tinted.copy(this._foliageBaseColors[i]).multiply(this._treeTintScratch);
        leafMesh.setColorAt(i, tinted);
      }
      leafMesh.instanceColor.needsUpdate = true;
    }
  },

  unload(scene) {
    this._unsubSeason?.();
    this._unsubSeason = null;
    const worldPhysics = getRuntimeService("WorldPhysics") ?? window.WorldPhysics;
    if (worldPhysics && typeof worldPhysics.removeCollider === "function") {
      for (const collider of this._colliders) worldPhysics.removeCollider(collider);
    }
    this._colliders = [];

    const disposedGeoms = new Set();
    const disposeMeshLike = (obj) => {
      if (obj.geometry && !disposedGeoms.has(obj.geometry)) {
        disposedGeoms.add(obj.geometry);
        obj.geometry.dispose();
      }
      const m = obj.material;
      if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
      else if (m?.dispose) m.dispose();
    };
    for (const obj of this._objects) {
      scene.remove(obj);
      if (obj.isGroup) {
        obj.traverse((ch) => {
          if (ch.isMesh || ch.isLineSegments || ch.isPoints) disposeMeshLike(ch);
        });
      } else if (obj.isInstancedMesh || obj.isPoints || obj.isMesh) {
        // Includes the wildflower / boulder / cairn / mushroom / berry
        // InstancedMeshes plus Points clouds (motes / leaves) and plain
        // Meshes (welcome mats, sit stump, crystal halo, magic shards
        // when they aren't grouped). Each must be disposed
        // individually so reload doesn't leak GPU buffers.
        disposeMeshLike(obj);
      }
    }

    for (const g of this._sharedTreeGeometries) {
      if (g && !disposedGeoms.has(g)) {
        disposedGeoms.add(g);
        g.dispose();
      }
    }

    this._objects = [];
    this._leafMeshes = [];
    this._foliageBaseColors = [];
    this._windUniform = null;
    this._sharedTreeGeometries = new Set();
    // Drop the per-frame animation refs so the next `update(delta)` call
    // (which can fire one extra tick after unload from a queued frame)
    // sees null and skips cleanly.
    this._motes = null;
    this._leaves = null;
    console.log("[Trees] ⏹ Unloaded.");
  },
};

/** @deprecated Alias — orchestrator activates this module as `Trees`. */
export const FloraModule = TreesForestModule;

export { TreesForestModule as TreesModule };
