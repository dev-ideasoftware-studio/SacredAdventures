/**
 * Sacred Adventures — sanctuary: v2 tipis (1:1 structures).
 *
 * Loads the same yellow-butterfly GLB, sacred wooden platforms, 7.2 m
 * scale, and BHG stripe shader as `js/v2/WorldStructures.js` — placed at
 * v2 village coordinates so they sit beside the sanctuary pool at (0,0).
 */

import * as THREE from "three";
import { GLTFLoaderWithDraco } from "../v2/gltfLoaderSetup.js";
import { ANU_SIMULATION_DOMAIN, ANU_INTERACTION_VERB } from "../v2/anu/SimulationController.js";
import { createSacredCirclePlatform } from "../v2/WorldSacredPlatform.js";
import { applyBhgStripeAndSuppressionShader } from "../v2/WorldStructures.js";
import {
  V2_TILE_WORLD,
  V2_TIPI_2_CENTER_X_M,
  V2_TIPI_2_CENTER_Z_M,
  V2_TIPI_2_YAW_RAD,
  V2_TIPI_SACRED_PLATFORM_HEIGHT,
  V2_TIPI_SACRED_PLATFORM_RADIUS,
  V2_TIPI_YELLOW_BUTTERFLY_TARGET_HEIGHT_M,
} from "../v2/constants.js";
import { sanctuaryGroundY } from "./SanctuaryGround.js";

const TIPI_GLB_URL = "./Assets/Tipi.yellowbutterfly/tipi.yellowbutterfly.glb";
const TIPI_1_YAW_RAD = Math.PI / 2;

function _tagTipiMeshes(tipi, tipiKind, idPrefix) {
  tipi.userData.anuId = idPrefix;
  tipi.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
  tipi.userData.anuKind = tipiKind;
  tipi.userData.anuInteractable = true;
  tipi.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.INSPECT, ANU_INTERACTION_VERB.ENTER];
  tipi.userData.anuCollision = "passable";
  tipi.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) return;
    child.castShadow = false;
    child.receiveShadow = false;
    child.userData.anuCollision = "passable";
    child.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
    child.userData.anuKind = `${tipiKind}_mesh`;
    const msh = (child.name || "mesh").replace(/\s+/g, "_").slice(0, 48);
    child.userData.anuId = `${idPrefix}.mesh.${msh}`;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.roughness !== undefined) m.roughness = 0.9;
      if (m.metalness !== undefined) m.metalness = 0;
      if (m.emissive) {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 0;
      }
      m.transparent = false;
      m.depthWrite = true;
      m.side = THREE.DoubleSide;
    }
  });
}

function _applyTipiCustomLine(tipi, lineColor) {
  const placedBbox = new THREE.Box3().setFromObject(tipi);
  const placedMidY = (placedBbox.min.y + placedBbox.max.y) * 0.5;

  tipi.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) return;
    const sourceMats = Array.isArray(child.material) ? child.material : [child.material];
    const patchedMats = sourceMats.map((srcMat) => {
      if (!srcMat) return srcMat;
      
      // Only target cover fabrics that originally have texture maps!
      if (!srcMat.map) return srcMat;

      const m = srcMat.clone();
      m.name = (srcMat.name ?? "tipi_mat") + "_" + lineColor;
      m.map = null; // STRIP TEXTURE!
      m.color.setHex(0xfaf5e8); // premium solid off-white canvas color

      const uniforms = { uTipiMidY: { value: placedMidY } };
      m.userData.tipiUniforms = uniforms;

      m.onBeforeCompile = (shader) => {
        // Only target the main rendering pass (which contains map_fragment).
        // This ensures depth, distance, and shadow map programs are not corrupted,
        // avoiding WebGL INVALID_OPERATION warnings and rendering glitches in panoramic view!
        if (!shader.fragmentShader.includes("#include <map_fragment>")) return;

        shader.uniforms.uTipiMidY = uniforms.uTipiMidY;

        shader.vertexShader = shader.vertexShader
          .replace(
            "#include <common>",
            "#include <common>\nvarying float vTipiWorldY;",
          )
          .replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>\nvTipiWorldY = (modelMatrix * vec4(transformed, 1.0)).y;`,
          );

        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            `#include <common>\nvarying float vTipiWorldY;\nuniform float uTipiMidY;`,
          )
          .replace(
            "#include <map_fragment>",
            `#include <map_fragment>
            {
              float dy = vTipiWorldY - uTipiMidY;
              // Bold horizontal line: 12cm thick, positioned slightly below midpoint for visual balance
              float stripeHeight = 0.12;
              float offset = -0.15;
              if (dy > offset - stripeHeight * 0.5 && dy < offset + stripeHeight * 0.5) {
                diffuseColor.rgb = ${
                  lineColor === "red"
                    ? "vec3(0.85, 0.12, 0.08)"
                    : (lineColor === "blue" ? "vec3(0.08, 0.35, 0.85)" : "vec3(0.98, 0.96, 0.91)")
                };
              } else {
                diffuseColor.rgb = vec3(0.98, 0.96, 0.91); // clean off-white canvas solid
              }
            }`,
          );
      };

      m.needsUpdate = true;
      return m;
    });
    child.material = Array.isArray(child.material) ? patchedMats : patchedMats[0];
  });
}

async function _plantTipi(scene, root, gltfScene, hexPos, { key, isTipi2, yaw }) {
  const platformY = sanctuaryGroundY(hexPos.x, hexPos.z);
  const platBuild = createSacredCirclePlatform({
    scene,
    objects: [],
    centerX: hexPos.x,
    centerZ: hexPos.z,
    terrainAtCenter: platformY,
    radius: V2_TIPI_SACRED_PLATFORM_RADIUS,
    height: V2_TIPI_SACRED_PLATFORM_HEIGHT,
    key,
    stepFacingRad: Math.PI / 4,
  });
  const platMesh = platBuild.platMesh;

  const tipi = gltfScene.clone(true);
  tipi.name = isTipi2 ? "sanctuary_tipi_2_v2" : "sanctuary_tipi_1_v2";

  const box = new THREE.Box3().setFromObject(tipi);
  const size = new THREE.Vector3();
  box.getSize(size);
  const sf = V2_TIPI_YELLOW_BUTTERFLY_TARGET_HEIGHT_M / Math.max(size.y, 0.1);
  tipi.scale.set(sf, sf, sf);
  tipi.rotation.y = yaw;
  tipi.updateMatrixWorld(true);

  box.setFromObject(tipi);
  const center = box.getCenter(new THREE.Vector3());
  tipi.position.set(
    hexPos.x - center.x + tipi.position.x,
    platBuild.deckTopY - box.min.y - 0.02,
    hexPos.z - center.z + tipi.position.z,
  );

  if (key === "tipi_2") {
    _applyTipiCustomLine(tipi, "red");
    _tagTipiMeshes(tipi, "sanctuary_tipi_2", "structures.sanctuary.tipi_2");
  } else if (key === "tipi_3") {
    _applyTipiCustomLine(tipi, "blue");
    _tagTipiMeshes(tipi, "structures.sanctuary.tipi_3", "structures.sanctuary.tipi_3");
  } else if (key === "tipi_4") {
    _tagTipiMeshes(tipi, "structures.sanctuary.tipi_4", "structures.sanctuary.tipi_4");
  } else {
    _applyTipiCustomLine(tipi, "none");
    _tagTipiMeshes(tipi, "sanctuary_tipi_1", "structures.sanctuary.tipi_1");
  }

  platMesh.userData.buildingRoot = tipi;
  root.add(tipi);

  return { tipi, platMesh, deckTopY: platBuild.deckTopY };
}

/** Tipi 1 was being planted at world origin (0,0) — the dead centre of
 *  the sacred pool — so it sat IN THE WATER. Moved May-19 2026 to the
 *  flat village ring at (18, -2), the same spot the legacy village pad
 *  used. Tipi 2 stays at its hex offset; the two now form a small
 *  village beside the pool, not on top of it. */
const TIPI_1_DEFAULT = { x: 18, z: -2 };

export const SanctuaryTipisModule = {
  name: "SanctuaryTipis",

  _scene: null,
  _camera: null,
  _canvas: null,
  _root: null,
  _tipi1: null,
  _tipi2: null,
  _tipi3: null,
  _tipi4: null,
  _plat1: null,
  _plat2: null,
  _plat3: null,
  _plat4: null,
  _raycaster: null,
  _ndc: null,
  _selectedKey: null,    // "tipi_1" | "tipi_2" | "tipi_3" | "tipi_4" | null
  _onCanvasDown: null,

  async load(scene, camera, renderer) {
    if (this._root) return;
    this._scene = scene;
    this._camera = camera;
    this._canvas = renderer?.domElement ?? null;
    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();

    const root = new THREE.Group();
    root.name = "sanctuary_tipis_v2";
    root.userData.anuId = "structures.sanctuary.tipis_v2";
    root.userData.anuKind = "sanctuary_tipis";
    root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
    scene.add(root);
    this._root = root;

    const activeMap = (typeof window !== "undefined" && window.__sanctuaryMapType) || "1";

    let tipi1Hex, tipi2Hex, tipi3Hex, tipi4Hex;
    let yaw1, yaw2, yaw3, yaw4;

    if (activeMap === "2") {
      tipi1Hex = { x: -28.0, z: 0.0 };      // West
      tipi2Hex = { x: 20.0, z: -20.0 };     // Southeast
      tipi3Hex = { x: -15.0, z: 24.0 };     // Northwest
      tipi4Hex = null;

      yaw1 = Math.atan2(tipi1Hex.z, -tipi1Hex.x); // 0.0
      yaw2 = Math.atan2(tipi2Hex.z, -tipi2Hex.x); // organically toward center
      yaw3 = Math.atan2(tipi3Hex.z, -tipi3Hex.x); // organically toward center
      yaw4 = 0.0;
    } else {
      tipi1Hex = { ...TIPI_1_DEFAULT };
      tipi2Hex = { x: TIPI_1_DEFAULT.x + V2_TILE_WORLD * 2, z: TIPI_1_DEFAULT.z };
      tipi3Hex = null;
      tipi4Hex = { x: 18, z: -14 }; // North of Tipi 1 on flat ground

      yaw1 = TIPI_1_YAW_RAD;
      yaw2 = V2_TIPI_2_YAW_RAD;
      yaw3 = 0.0;
      yaw4 = TIPI_1_YAW_RAD;
    }

    try {
      const gltf = await new GLTFLoaderWithDraco().loadAsync(TIPI_GLB_URL);
      const t1 = await _plantTipi(scene, root, gltf.scene, tipi1Hex, {
        key: "tipi_1",
        isTipi2: false,
        yaw: yaw1,
      });
      this._tipi1 = t1.tipi;
      this._plat1 = t1.platMesh;

      const t2 = await _plantTipi(scene, root, gltf.scene, tipi2Hex, {
        key: "tipi_2",
        isTipi2: true,
        yaw: yaw2,
      });
      this._tipi2 = t2.tipi;
      this._plat2 = t2.platMesh;

      let t3 = null;
      if (activeMap === "2" && tipi3Hex) {
        t3 = await _plantTipi(scene, root, gltf.scene, tipi3Hex, {
          key: "tipi_3",
          isTipi2: false,
          yaw: yaw3,
        });
        this._tipi3 = t3.tipi;
        this._plat3 = t3.platMesh;
      }

      let t4 = null;
      if (activeMap !== "2" && tipi4Hex) {
        t4 = await _plantTipi(scene, root, gltf.scene, tipi4Hex, {
          key: "tipi_4",
          isTipi2: false,
          yaw: yaw4,
        });
        this._tipi4 = t4.tipi;
        this._plat4 = t4.platMesh;
      }

      if (typeof window !== "undefined") {
        window.__sanctuaryTipi1Anchor = { ...tipi1Hex };
        window.__sanctuaryTipi2Anchor = { ...tipi2Hex };
        window.__sanctuaryTipi1Yaw = yaw1;
        window.__sanctuaryTipi2Yaw = yaw2;
        window.__sanctuaryTipi1PlatMesh = this._plat1;
        window.__sanctuaryTipi2PlatMesh = this._plat2;
        window.__sanctuaryTipi1DeckTopY = t1.deckTopY;
        window.__sanctuaryTipi2DeckTopY = t2.deckTopY;

        if (activeMap === "2" && t3) {
          window.__sanctuaryTipi3Anchor = { ...tipi3Hex };
          window.__sanctuaryTipi3Yaw = yaw3;
          window.__sanctuaryTipi3PlatMesh = this._plat3;
          window.__sanctuaryTipi3DeckTopY = t3.deckTopY;
        } else {
          delete window.__sanctuaryTipi3Anchor;
          delete window.__sanctuaryTipi3Yaw;
          delete window.__sanctuaryTipi3PlatMesh;
          delete window.__sanctuaryTipi3DeckTopY;
        }

        if (activeMap !== "2" && t4) {
          window.__sanctuaryTipi4Anchor = { ...tipi4Hex };
          window.__sanctuaryTipi4Yaw = yaw4;
          window.__sanctuaryTipi4PlatMesh = this._plat4;
          window.__sanctuaryTipi4DeckTopY = t4.deckTopY;
        } else {
          delete window.__sanctuaryTipi4Anchor;
          delete window.__sanctuaryTipi4Yaw;
          delete window.__sanctuaryTipi4PlatMesh;
          delete window.__sanctuaryTipi4DeckTopY;
        }

        // Programmatic API — `sanctuaryMoveTipi(1, x, z)` lets kids
        // (and DevTools) reposition a tipi from anywhere.
        window.sanctuaryMoveTipi = (n, x, z) => this._moveTipi(n === 4 ? "tipi_4" : (n === 3 ? "tipi_3" : (n === 2 ? "tipi_2" : "tipi_1")), x, z);

        window.__regenerateTipis = async () => {
          if (!this._root || !this._scene) return;
          console.log("[SanctuaryTipis] Rebuilding tipis for map type: " + window.__sanctuaryMapType);

          const cachedScene = this._scene;
          const cachedCamera = this._camera;
          const cachedCanvas = this._canvas;

          this.unload(cachedScene);

          this._scene = cachedScene;
          this._camera = cachedCamera;
          this._canvas = cachedCanvas;

          await this.load(cachedScene, cachedCamera, { domElement: cachedCanvas });

          console.log("[SanctuaryTipis] Tipis successfully regenerated!");
        };
      }

      // ── Top-down click-to-move-tipi ─────────────────────────────
      // Capture-phase listener so we see the click BEFORE the global
      // click-to-move walks the avatar to that spot.
      //   First click in top-down on a tipi  → select it
      //   Next click on the ground          → relocate selected tipi
      //   Click elsewhere or Esc            → deselect, fall through
      if (this._canvas) {
        this._onCanvasDown = (ev) => this._handleTopDownClick(ev);
        this._canvas.addEventListener("mousedown", this._onCanvasDown, true);
      }

      console.log(
        `%c[Sanctuary] ⛺ v2 tipis — Tipi 1 @ (${tipi1Hex.x}, ${tipi1Hex.z}), Tipi 2 @ (${tipi2Hex.x.toFixed(1)}, ${tipi2Hex.z.toFixed(1)}) · click-to-move enabled in top-down`,
        "color:#c9a374;font-weight:bold;",
      );
    } catch (err) {
      console.warn("[SanctuaryTipis] v2 tipi load failed:", err);
    }
  },

  _inTopDown() {
    return typeof document !== "undefined" &&
      document.body.classList.contains("v4-top-down-view");
  },

  /** Move a tipi + its sacred platform together. Y is recomputed from
   *  the terrain at the new XZ. Selection is cleared. */
  _moveTipi(key, x, z) {
    const tipi = key === "tipi_4" ? this._tipi4 : (key === "tipi_3" ? this._tipi3 : (key === "tipi_2" ? this._tipi2 : this._tipi1));
    const plat = key === "tipi_4" ? this._plat4 : (key === "tipi_3" ? this._plat3 : (key === "tipi_2" ? this._plat2 : this._plat1));
    if (!tipi || !plat) return false;

    const newGroundY = sanctuaryGroundY(x, z);

    // Platform shifts to (x, groundY + half-height, z) — preserve its
    // existing Y delta so the deck top still floats above the ground.
    const platDeltaY = plat.position.y - sanctuaryGroundY(plat.position.x, plat.position.z);
    plat.position.set(x, newGroundY + platDeltaY, z);

    // Tipi shifts so its base sits on top of the platform at the new
    // ground sample — keep its existing Y offset from the deck.
    const deckTopYOrig = key === "tipi_4"
      ? (typeof window !== "undefined" ? window.__sanctuaryTipi4DeckTopY : 0)
      : (key === "tipi_3"
        ? (typeof window !== "undefined" ? window.__sanctuaryTipi3DeckTopY : 0)
        : (key === "tipi_2"
          ? (typeof window !== "undefined" ? window.__sanctuaryTipi2DeckTopY : 0)
          : (typeof window !== "undefined" ? window.__sanctuaryTipi1DeckTopY : 0)));
    const tipiDeltaY = tipi.position.y - deckTopYOrig;
    const newDeckTopY = plat.position.y + (deckTopYOrig - (deckTopYOrig - plat.position.y));
    tipi.position.set(x, newDeckTopY + tipiDeltaY, z);

    // Update published anchors so NPCs / braziers / butterflies that
    // read them on next tick land in the right place.
    if (typeof window !== "undefined") {
      if (key === "tipi_4") window.__sanctuaryTipi4Anchor = { x, z };
      else if (key === "tipi_3") window.__sanctuaryTipi3Anchor = { x, z };
      else if (key === "tipi_2") window.__sanctuaryTipi2Anchor = { x, z };
      else window.__sanctuaryTipi1Anchor = { x, z };
    }
    if (this._selectedKey === key) this._clearSelection();
    console.log(
      `%c[SanctuaryTipis] moved ${key} → (${x.toFixed(2)}, ${z.toFixed(2)})`,
      "color:#c9a374;font-weight:bold;",
    );
    return true;
  },

  _setSelection(key) {
    this._clearSelection();
    this._selectedKey = key;
    const tipi = key === "tipi_4" ? this._tipi4 : (key === "tipi_3" ? this._tipi3 : (key === "tipi_2" ? this._tipi2 : this._tipi1));
    if (tipi) tipi.scale.multiplyScalar(1.06); // visible "lift"
  },

  _clearSelection() {
    if (!this._selectedKey) return;
    const tipi = this._selectedKey === "tipi_4" ? this._tipi4 : (this._selectedKey === "tipi_3" ? this._tipi3 : (this._selectedKey === "tipi_2" ? this._tipi2 : this._tipi1));
    if (tipi) tipi.scale.multiplyScalar(1 / 1.06);
    this._selectedKey = null;
  },

  _handleTopDownClick(ev) {
    if (!this._inTopDown() || !this._canvas || !this._camera) return;

    const rect = this._canvas.getBoundingClientRect();
    this._ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this._ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._ndc, this._camera);

    // First, see if a tipi was clicked. Walk hits front-to-back, take
    // the first whose ancestor is one of our tipis.
    const hits = this._raycaster.intersectObjects([this._tipi1, this._tipi2, this._tipi3, this._tipi4].filter(Boolean), true);
    if (hits.length > 0) {
      let n = hits[0].object;
      while (n && n !== this._tipi1 && n !== this._tipi2 && n !== this._tipi3 && n !== this._tipi4) n = n.parent;
      if (n === this._tipi1) {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        this._setSelection("tipi_1");
        return;
      }
      if (n === this._tipi2) {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        this._setSelection("tipi_2");
        return;
      }
      if (n === this._tipi3) {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        this._setSelection("tipi_3");
        return;
      }
      if (n === this._tipi4) {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        this._setSelection("tipi_4");
        return;
      }
    }

    // No tipi hit — if one is selected, treat this click as the new
    // destination on the ground plane (y=0 for simplicity, terrain Y
    // is recomputed inside _moveTipi).
    if (this._selectedKey) {
      const planeY = 0;
      const dir = this._raycaster.ray.direction;
      const orig = this._raycaster.ray.origin;
      if (Math.abs(dir.y) < 1e-6) return; // parallel to ground — bail
      const t = (planeY - orig.y) / dir.y;
      if (t < 0) return;
      const x = orig.x + dir.x * t;
      const z = orig.z + dir.z * t;
      ev.stopImmediatePropagation();
      ev.preventDefault();
      this._moveTipi(this._selectedKey, x, z);
    }
  },

  update() {},

  unload(scene) {
    if (!this._root) return;
    const sceneToUse = scene || this._scene;
    if (this._canvas && this._onCanvasDown) {
      this._canvas.removeEventListener("mousedown", this._onCanvasDown, true);
    }
    this._onCanvasDown = null;
    this._canvas = null;
    this._camera = null;
    this._selectedKey = null;
    if (sceneToUse) sceneToUse.remove(this._root);
    this._root.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
      else m?.dispose?.();
    });
    this._root = null;
    this._tipi1 = null;
    this._tipi2 = null;
    this._tipi3 = null;
    this._tipi4 = null;

    const platforms = [this._plat1, this._plat2, this._plat3, this._plat4];
    for (const plat of platforms) {
      if (plat) {
        if (sceneToUse) sceneToUse.remove(plat);
        plat.traverse((o) => {
          if (o.geometry) o.geometry.dispose?.();
          const m = o.material;
          if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
          else m?.dispose?.();
        });
      }
    }
    this._plat1 = null;
    this._plat2 = null;
    this._plat3 = null;
    this._plat4 = null;
    this._scene = null;
    if (typeof window !== "undefined") {
      delete window.__sanctuaryTipi1Anchor;
      delete window.__sanctuaryTipi2Anchor;
      delete window.__sanctuaryTipi3Anchor;
      delete window.__sanctuaryTipi4Anchor;
      delete window.__sanctuaryTipi1Yaw;
      delete window.__sanctuaryTipi2Yaw;
      delete window.__sanctuaryTipi3Yaw;
      delete window.__sanctuaryTipi4Yaw;
      delete window.__sanctuaryTipi1PlatMesh;
      delete window.__sanctuaryTipi2PlatMesh;
      delete window.__sanctuaryTipi3PlatMesh;
      delete window.__sanctuaryTipi4PlatMesh;
      delete window.__sanctuaryTipi1DeckTopY;
      delete window.__sanctuaryTipi2DeckTopY;
      delete window.__sanctuaryTipi3DeckTopY;
      delete window.__sanctuaryTipi4DeckTopY;
    }
  },
};
