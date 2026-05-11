/**
 * Sacred Adventures v2 — Flora: `Assets/tree.glb` planted with legacy
 * `js/EnvironmentBuilder.js` rings, scaling, foliage tint swatch, shader wind (leaves),
 * and terrain-hugging dirt discs.
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
  V2_FLORA_TREE_HORIZONTAL_SPREAD,
  V2_FLORA_MAX_TREE_INSTANCES,
} from "./constants.js";
import { ANU_EVENTS } from "./anu/anuEvents.js";
import { subscribeInteraction } from "./anu/InteractionBus.js";
import { buildLegacyEnvironmentBuilderTreeSlots } from "./FloraLegacyTreeLayout.js";

const TREE_URL = "./Assets/tree.glb";

/** Drop farthest rings first — keeps grove around origin when over ANU flora cap. */
function capFloraSlotsByNearestOrigin(slots, maxN) {
  if (!maxN || maxN <= 0 || slots.length <= maxN) return slots;
  const scored = slots.map((s) => ({ s, d2: s.x * s.x + s.z * s.z }));
  scored.sort((a, b) => a.d2 - b.d2);
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

    let treeSlots = buildLegacyEnvironmentBuilderTreeSlots({
      tipiX: 0,
      tipiZ: 0,
    });

    const beforeCap = treeSlots.length;
    treeSlots = capFloraSlotsByNearestOrigin(treeSlots, V2_FLORA_MAX_TREE_INSTANCES);
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
        material.onBeforeCompile = (shader) => {
          shader.uniforms.uTime = windUniform;
          shader.vertexShader = shader.vertexShader.replace(
            "#include <common>",
            "#include <common>\nuniform float uTime;\n",
          );
          const vertMods = `
#include <begin_vertex>
float heightFactor = smoothstep(2.0, 6.0, position.y);
float worldX = instanceMatrix[3][0];
float worldZ = instanceMatrix[3][2];
float phase = (worldX * 0.1) + (worldZ * 0.1);
float windStr = 0.16;
transformed.x += sin(uTime * 1.5 + phase) * windStr * heightFactor;
transformed.z += cos(uTime * 1.2 + phase) * windStr * heightFactor;
`;
          shader.vertexShader = shader.vertexShader.replace(
            "#include <begin_vertex>",
            vertMods,
          );
        };
        installMeshMaterialPipRingDiskClip(material);
      } else {
        installMeshMaterialPipRingDiskClip(material);
      }

      const instancedMesh = new THREE.InstancedMesh(mesh.geometry, material, N);
      instancedMesh.castShadow = false;
      instancedMesh.receiveShadow = false;
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

    for (let idx = 0; idx < N; idx++) {
      const pos = treeSlots[idx];
      const baseScale = pos.scale;
      const targetH = (8 + Math.random() * 8) * baseScale;
      if (targetH < minTargetH) minTargetH = targetH;
      if (targetH > maxTargetH) maxTargetH = targetH;

      const sf = targetH / Math.max(origSize.y, 0.1);
      const widthMult =
        (pos.widthOverride ?? (0.88 + Math.random() * 0.58)) *
        V2_FLORA_TREE_HORIZONTAL_SPREAD;
      scaleVec.set(sf * widthMult, sf, sf * widthMult);

      const groundY = getY(pos.x, pos.z);
      position.set(pos.x, groundY, pos.z);
      rotationEuler.set(0, Math.random() * Math.PI * 2, 0);
      quaternion.setFromEuler(rotationEuler);
      matrix.compose(position, quaternion, scaleVec);

      const tintColor =
        foliageColors[Math.floor(Math.random() * foliageColors.length)];
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

    for (const { instancedMesh, isLeaf } of allInstanced) {
      instancedMesh.instanceMatrix.needsUpdate = true;
      if (isLeaf && instancedMesh.instanceColor)
        instancedMesh.instanceColor.needsUpdate = true;
      instancedMesh.computeBoundingSphere();
    }

    this._unsubSeason?.();
    this._unsubSeason = subscribeInteraction(ANU_EVENTS.SEASON_CHANGE, (detail) => {
      this._applySeasonSurfaceTint(detail?.season);
    });

    console.log(
      `%c[Trees] ✅ ${N} × Assets/tree.glb — legacy-quality multipart forest; heights ${minTargetH.toFixed(2)}…${maxTargetH.toFixed(2)} m — ANU tracks ${N} instances per drawable`,
      "color:#81c784;font-weight:bold;",
    );
  },

  update(delta) {
    if (this._windUniform) this._windUniform.value += delta;
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
    for (const obj of this._objects) {
      scene.remove(obj);
      if (obj.isGroup) {
        obj.traverse((ch) => {
          if (ch.isMesh) {
            if (ch.geometry && !disposedGeoms.has(ch.geometry)) {
              disposedGeoms.add(ch.geometry);
              ch.geometry.dispose();
            }
            const m = ch.material;
            if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
            else if (m?.dispose) m.dispose();
          }
        });
      } else if (obj.isInstancedMesh) {
        const m = obj.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
        else if (m?.dispose) m.dispose();
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
    console.log("[Trees] ⏹ Unloaded.");
  },
};

/** @deprecated Alias — orchestrator activates this module as `Trees`. */
export const FloraModule = TreesForestModule;

export { TreesForestModule as TreesModule };
