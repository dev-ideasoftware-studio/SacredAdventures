/**
 * Shared mossy landscape rock — `rock.mossy.glb` cloned to multiple sites.
 * One cached `loadAsync` promise so Pool2 + tipi boots do not double-fetch.
 */

import * as THREE from "three";
import { GLTFLoaderWithDraco } from "./gltfLoaderSetup.js";
import { ANU_SIMULATION_DOMAIN } from "./anu/SimulationController.js";
import { terrainY } from "./WorldTerrain.js";

export const MOSSY_ROCK_GLB_URL =
  "./Assets/landscape-scenes/terrain/rock.mossy.glb";

let _mossyRockGltfPromise = null;

export function loadMossyRockGltfShared() {
  if (!_mossyRockGltfPromise) {
    _mossyRockGltfPromise = new GLTFLoaderWithDraco().loadAsync(
      MOSSY_ROCK_GLB_URL,
    );
  }
  return _mossyRockGltfPromise;
}

/**
 * @param {object} opts
 * @param {THREE.Object3D} opts.templateScene — `gltf.scene` (deep-cloned).
 * @param {THREE.Scene} opts.scene
 * @param {unknown[]|null} [opts.objects] — when provided (e.g. World `_objects`), pushed for unload sweep.
 * @param {number} opts.x
 * @param {number} opts.z
 * @param {number} [opts.yaw=0]
 * @param {number} [opts.targetHeightM=1.3]
 * @param {string} [opts.nameSuffix="a"]
 * @returns {THREE.Object3D}
 */
export function plantMossyRockClone(opts) {
  const {
    templateScene,
    scene,
    objects = null,
    x,
    z,
    yaw = 0,
    targetHeightM = 1.3,
    nameSuffix = "a",
  } = opts;
  const rock = templateScene.clone(true);
  rock.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(rock);
  const h = Math.max(box.max.y - box.min.y, 0.001);
  const s = targetHeightM / h;
  rock.scale.setScalar(s);
  // The Tripo-authored `rock.mossy.glb` ships with its mossy crust on
  // the -Y side of the geometry, so the default placement read as an
  // upside-down rock (moss visible on its underbelly — user screenshot
  // May-16 2026 "the rock is upside down mossy"). Flip 180° around X to
  // bring the moss up, then recompute the AABB so the sole still lands
  // on terrain. Apply yaw after the X flip — three.js's default XYZ
  // Euler order keeps the flip stable when Y is rotated.
  rock.rotation.x = Math.PI;
  rock.rotation.y = yaw;
  rock.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(rock);
  const sole = -box2.min.y;
  const ty = terrainY(x, z);
  rock.position.set(x, ty + sole, z);
  rock.name = `landscape_rock_mossy_${nameSuffix}`;
  rock.userData.anuId = `environment.landscape.rock_mossy.${nameSuffix}`;
  rock.userData.anuKind = "landscape_prop_rock";
  rock.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  rock.traverse((ch) => {
    if (ch.isMesh) {
      ch.castShadow = true;
      ch.receiveShadow = true;
    }
  });
  scene.add(rock);
  if (Array.isArray(objects)) objects.push(rock);
  return rock;
}
