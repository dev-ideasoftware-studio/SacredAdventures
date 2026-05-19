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
  V2_TIPI_2_CENTER_X_M,
  V2_TIPI_2_CENTER_Z_M,
  V2_TIPI_2_YAW_RAD,
  V2_TIPI_SACRED_PLATFORM_HEIGHT,
  V2_TIPI_SACRED_PLATFORM_RADIUS,
  V2_TIPI_YELLOW_BUTTERFLY_TARGET_HEIGHT_M,
} from "../v2/constants.js";
import { sanctuaryGroundY } from "./SanctuaryGround.js";

const TIPI_GLB_URL = "./WORDPRESS/Assets/Tipi.yellowbutterfly/tipi.yellowbutterfly.glb";
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

function _applyBhgTipi2Materials(tipi) {
  tipi.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) return;
    const sourceMats = Array.isArray(child.material) ? child.material : [child.material];
    const patchedMats = sourceMats.map((srcMat) => {
      if (!srcMat) return srcMat;
      const m = srcMat.clone();
      m.name = (srcMat.name ?? "tipi2_mat") + "_bhg";
      applyBhgStripeAndSuppressionShader(m);
      return m;
    });
    child.material = Array.isArray(child.material) ? patchedMats : patchedMats[0];
  });
  const placedBbox = new THREE.Box3().setFromObject(tipi);
  const placedMidY = (placedBbox.min.y + placedBbox.max.y) * 0.5;
  tipi.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      const u = m?.userData?.bhgUniforms;
      if (u?.uBhgMidY) u.uBhgMidY.value = placedMidY;
    }
  });
}

async function _plantTipi(scene, root, gltfScene, hexPos, { key, isTipi2 }) {
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
  tipi.rotation.y = isTipi2 ? V2_TIPI_2_YAW_RAD : TIPI_1_YAW_RAD;
  tipi.updateMatrixWorld(true);

  box.setFromObject(tipi);
  const center = box.getCenter(new THREE.Vector3());
  tipi.position.set(
    hexPos.x - center.x + tipi.position.x,
    platBuild.deckTopY - box.min.y - 0.02,
    hexPos.z - center.z + tipi.position.z,
  );

  if (isTipi2) {
    _applyBhgTipi2Materials(tipi);
    _tagTipiMeshes(tipi, "sanctuary_tipi_2", "structures.sanctuary.tipi_2");
  } else {
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
  _plat1: null,
  _plat2: null,
  _raycaster: null,
  _ndc: null,
  _selectedKey: null,    // "tipi_1" | "tipi_2" | null
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

    const tipi1Hex = { ...TIPI_1_DEFAULT };
    const tipi2Hex = { x: V2_TIPI_2_CENTER_X_M, z: V2_TIPI_2_CENTER_Z_M };

    try {
      const gltf = await new GLTFLoaderWithDraco().loadAsync(TIPI_GLB_URL);
      const t1 = await _plantTipi(scene, root, gltf.scene, tipi1Hex, {
        key: "tipi_1",
        isTipi2: false,
      });
      this._tipi1 = t1.tipi;
      this._plat1 = t1.platMesh;

      const t2 = await _plantTipi(scene, root, gltf.scene, tipi2Hex, {
        key: "tipi_2",
        isTipi2: true,
      });
      this._tipi2 = t2.tipi;
      this._plat2 = t2.platMesh;

      if (typeof window !== "undefined") {
        window.__sanctuaryTipi1Anchor = { ...tipi1Hex };
        window.__sanctuaryTipi2Anchor = { ...tipi2Hex };
        window.__sanctuaryTipi1PlatMesh = this._plat1;
        window.__sanctuaryTipi2PlatMesh = this._plat2;
        window.__sanctuaryTipi1DeckTopY = t1.deckTopY;
        window.__sanctuaryTipi2DeckTopY = t2.deckTopY;

        // Programmatic API — `sanctuaryMoveTipi(1, x, z)` lets kids
        // (and DevTools) reposition a tipi from anywhere.
        window.sanctuaryMoveTipi = (n, x, z) => this._moveTipi(n === 2 ? "tipi_2" : "tipi_1", x, z);
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
    const tipi = key === "tipi_2" ? this._tipi2 : this._tipi1;
    const plat = key === "tipi_2" ? this._plat2 : this._plat1;
    if (!tipi || !plat) return false;

    const newGroundY = sanctuaryGroundY(x, z);

    // Platform shifts to (x, groundY + half-height, z) — preserve its
    // existing Y delta so the deck top still floats above the ground.
    const platDeltaY = plat.position.y - sanctuaryGroundY(plat.position.x, plat.position.z);
    plat.position.set(x, newGroundY + platDeltaY, z);

    // Tipi shifts so its base sits on top of the platform at the new
    // ground sample — keep its existing Y offset from the deck.
    const deckTopYOrig = key === "tipi_2"
      ? (typeof window !== "undefined" ? window.__sanctuaryTipi2DeckTopY : 0)
      : (typeof window !== "undefined" ? window.__sanctuaryTipi1DeckTopY : 0);
    const tipiDeltaY = tipi.position.y - deckTopYOrig;
    const newDeckTopY = plat.position.y + (deckTopYOrig - (deckTopYOrig - plat.position.y));
    tipi.position.set(x, newDeckTopY + tipiDeltaY, z);

    // Update published anchors so NPCs / braziers / butterflies that
    // read them on next tick land in the right place.
    if (typeof window !== "undefined") {
      if (key === "tipi_2") window.__sanctuaryTipi2Anchor = { x, z };
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
    const tipi = key === "tipi_2" ? this._tipi2 : this._tipi1;
    if (tipi) tipi.scale.multiplyScalar(1.06); // visible "lift"
  },

  _clearSelection() {
    if (!this._selectedKey) return;
    const tipi = this._selectedKey === "tipi_2" ? this._tipi2 : this._tipi1;
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
    const hits = this._raycaster.intersectObjects([this._tipi1, this._tipi2].filter(Boolean), true);
    if (hits.length > 0) {
      let n = hits[0].object;
      while (n && n !== this._tipi1 && n !== this._tipi2) n = n.parent;
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
    if (this._canvas && this._onCanvasDown) {
      this._canvas.removeEventListener("mousedown", this._onCanvasDown, true);
    }
    this._onCanvasDown = null;
    this._canvas = null;
    this._camera = null;
    this._selectedKey = null;
    scene.remove(this._root);
    this._root.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
      else m?.dispose?.();
    });
    this._root = null;
    this._plat1 = null;
    this._plat2 = null;
    this._scene = null;
    if (typeof window !== "undefined") {
      delete window.__sanctuaryTipi1Anchor;
      delete window.__sanctuaryTipi2Anchor;
      delete window.__sanctuaryTipi1PlatMesh;
      delete window.__sanctuaryTipi2PlatMesh;
      delete window.__sanctuaryTipi1DeckTopY;
      delete window.__sanctuaryTipi2DeckTopY;
    }
  },
};
