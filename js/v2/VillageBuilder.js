/**
 * Sacred Adventures v2 — Top-down Village Builder UI.
 *
 * Activates when the player toggles into top-down map view
 * (`WorldPlayer.toggleMainCanvasMapView` / `TOGGLE_VIEW_MODE` postMessage).
 * A merged panel + map-gen strip appear; in forward view these are hidden.
 *
 *   • **Village map view (`body.v2-village-view`):** pinned to the same
 *     **top-right rail** as the FPS HUD (#v2-orchestrator-hud). PiP /
 *     moondial stay **top-left** (same as forward view); vertical stacking
 *     uses measured `:root` CSS vars updated by
 *     `OrchestratorHud.syncVillageViewRightStackCssVars()`.
 *
 *   • **BUILDINGS** mode lists tipis in play and exposes a (+) tile to spawn
 *     a PLAYER'S TIPI — Tipi 2 GLB with NO stripe/butterfly shader patch.
 *
 *   • **SCENERY** mode: PLANT TREES vs SCENERY subtabs (tree row stays one wide).
 *
 * Coupling contract: this module reads the live `WorldPlayer` runtime
 * service to learn current `mainCanvasMapView` state + to call back
 * into `WorldModule` for tipi instance lookups. It does not own world
 * state — it only emits intents (currently visualised as UI activation
 * and a console hook; full placement gameplay is a follow-up pass).
 */

import * as THREE from "three";
import { GLTFLoaderWithDraco } from "./gltfLoaderSetup.js";
import { getRuntimeService } from "./RuntimeServices.js";
import { ANU_SIMULATION_DOMAIN } from "./anu/SimulationController.js";
import {
  V2_TIPI_2_CENTER_X_M,
  V2_TIPI_2_CENTER_Z_M,
  V2_TIPI_SACRED_PLATFORM_CENTER_Y,
  V2_TIPI_SACRED_PLATFORM_HEIGHT,
  V2_TIPI_SACRED_PLATFORM_RADIUS,
  V2_TIPI_YELLOW_BUTTERFLY_TARGET_HEIGHT_M,
  V2_TILE_WORLD,
} from "./constants.js";
import { terrainY } from "./WorldTerrain.js";

const TIPI_GLB_URL =
  "./Assets/Tipi.yellowbutterfly/tipi.yellowbutterfly.glb";

const TREE_ROW = [
  { id: "oak",     emoji: "🌳", label: "Oak"     },
  { id: "pine",    emoji: "🌲", label: "Pine"    },
  { id: "fruit",   emoji: "🍎", label: "Fruit"   },
  { id: "blossom", emoji: "🌸", label: "Blossom" },
  { id: "maple",   emoji: "🍁", label: "Maple"   },
  { id: "palm",    emoji: "🌴", label: "Palm"    },
];

const SCENERY_SUB_ROW = [
  { id: "trees",     emoji: "🌳", label: "Trees"     },
  { id: "rocks",     emoji: "🪨", label: "Rocks"     },
  { id: "flowers",   emoji: "🌼", label: "Flowers"   },
  { id: "mushrooms", emoji: "🍄", label: "Mushrooms" },
  { id: "logs",      emoji: "🪵", label: "Logs"      },
];

export const VillageBuilderModule = {
  name: "VillageBuilder",

  _root: null,
  _leftPanel: null,
  _rightPanel: null,
  _mergedPanel: null,
  _mapgenPanel: null,
  _mapgenSize: "L",
  _wasMapView: false,
  _intervalId: 0,
  _playerTipiCount: 0,

  load() {
    this._injectStyles();
    this._root = document.createElement("div");
    this._root.id = "v2-village-builder";
    this._root.setAttribute("aria-hidden", "true");
    this._root.style.cssText = "pointer-events:none;";
    this._root.innerHTML = this._html();
    document.body.appendChild(this._root);

    this._leftPanel = this._root.querySelector("#vb-left-panel");
    this._rightPanel = this._root.querySelector("#vb-right-panel");
    this._mergedPanel = this._root.querySelector("#vb-merged-panel");
    this._mapgenPanel = this._root.querySelector("#vb-mapgen-panel");

    this._wireLeftPanel();
    this._wireRightPanel();
    this._wireModeTabs();
    this._wireMapgenPanel();
    this._setVisible(false);

    /**
     * Poll the WorldPlayer runtime service for `mainCanvasMapView` changes.
     * We could subscribe to a custom event, but `WorldPlayer` is rebuilt
     * each frame in `World.update` and the toggle bool is a stable field
     * on the snapshot — a 4 Hz poll is cheaper than tapping into the
     * frame-budget chain and avoids a new event surface.
     */
    this._intervalId = window.setInterval(() => {
      const wp = getRuntimeService("WorldPlayer");
      const mapView = wp?.mainCanvasMapView === true;
      if (mapView !== this._wasMapView) {
        this._wasMapView = mapView;
        this._setVisible(mapView);
        if (mapView) this._refreshBuildingsList();
      }
    }, 250);

    console.log(
      "%c[VillageBuilder] ✅ panels mounted — toggle top-down view to open the builder",
      "color:#a5d6a7;font-weight:bold;",
    );
  },

  unload() {
    if (this._intervalId) {
      window.clearInterval(this._intervalId);
      this._intervalId = 0;
    }
    if (this._root && this._root.parentNode) {
      this._root.parentNode.removeChild(this._root);
    }
    this._root = null;
    this._leftPanel = null;
    this._rightPanel = null;
    this._mergedPanel = null;
    this._mapgenPanel = null;
  },

  _setVisible(show) {
    if (this._mergedPanel) {
      this._mergedPanel.style.display = show ? "flex" : "none";
    }
    if (this._mapgenPanel) {
      this._mapgenPanel.style.display = show ? "flex" : "none";
    }
    this._root.setAttribute("aria-hidden", show ? "false" : "true");
  },

  /**
   * Map-generation panel: L / M / S tree-size tiles. Active state is
   * exclusive (one selection at a time); clicks dispatch a custom
   * `v2-village-mapgen-size` window event so consumers (the future
   * top-down tree-placement tool) can read the selected size without
   * coupling to this module.
   */
  _wireMapgenPanel() {
    if (!this._mapgenPanel) return;
    const tiles = this._mapgenPanel.querySelectorAll(".vb-mapgen-tile");
    tiles.forEach((tile) => {
      tile.addEventListener("click", () => {
        tiles.forEach((t) => t.classList.remove("active"));
        tile.classList.add("active");
        const size = tile.getAttribute("data-mapgen-size") || "L";
        this._mapgenSize = size;
        try {
          window.dispatchEvent(
            new CustomEvent("v2-village-mapgen-size", { detail: { size } }),
          );
        } catch (_e) { /* ignore */ }
      });
    });
  },

  /**
   * BUILDINGS ⇄ SCENERY mode switch inside the merged panel. The two
   * sections share the same scroll viewport, so we toggle `hidden` on the
   * inactive one (CSS rule `.vb-mode-section[hidden] { display: none }`).
   */
  _wireModeTabs() {
    if (!this._root) return;
    const tabs = this._root.querySelectorAll(".vb-mode-tab");
    const sections = this._root.querySelectorAll(".vb-mode-section");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const mode = tab.getAttribute("data-mode");
        tabs.forEach((t) => {
          const active = t === tab;
          t.classList.toggle("active", active);
          t.setAttribute("aria-selected", active ? "true" : "false");
        });
        sections.forEach((s) => {
          const isActive = s.getAttribute("data-mode-panel") === mode;
          if (isActive) s.removeAttribute("hidden");
          else s.setAttribute("hidden", "");
        });
      });
    });
  },

  /**
   * Walk the orchestrator-known scene-graph for tipi roots. We can't import
   * `WorldModule` here without a circular dep, so we use the live
   * `WorldPlayer` snapshot's `.avatar` scene parent as the entry point and
   * filter children whose `userData.anuKind` looks like a tipi.
   */
  _enumerateBuildings() {
    const wp = getRuntimeService("WorldPlayer");
    const scene = wp?.avatar?.parent ?? null;
    if (!scene) return [];
    /** @type {{ id: string, label: string, mesh: THREE.Object3D }[]} */
    const out = [];
    scene.traverse((obj) => {
      const kind = obj.userData?.anuKind;
      if (!kind) return;
      if (kind === "tipi_2_non_colliding") {
        if (obj.name?.includes("structure_tipi_2_bhg")) {
          out.push({ id: "tipi-2-bhg", label: "Brings Happiness Tipi", mesh: obj });
        }
      } else if (kind === "tipi_yellow_butterfly_non_colliding") {
        out.push({ id: "tipi-1-yb", label: "Yellow Butterfly Tipi", mesh: obj });
      } else if (kind === "tipi_player_owned") {
        out.push({ id: obj.userData.anuId ?? "tipi-player", label: "Player's Tipi", mesh: obj });
      }
    });
    return out;
  },

  _refreshBuildingsList() {
    if (!this._leftPanel) return;
    const list = this._leftPanel.querySelector(".vb-building-grid");
    if (!list) return;
    list.innerHTML = "";

    const buildings = this._enumerateBuildings();
    for (const b of buildings) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "vb-building-tile";
      tile.title = b.label;
      tile.setAttribute("data-building-id", b.id);
      tile.innerHTML =
        '<div class="vb-tile-icon">⛺</div>' +
        '<div class="vb-tile-label">' + b.label + "</div>";
      tile.addEventListener("click", () => {
        try { window.dispatchEvent(new CustomEvent("v2-village-focus-building", { detail: b })); } catch (_e) { /* ignore */ }
      });
      list.appendChild(tile);
    }

    /** Always-last (+) tile: spawn a new PLAYER'S TIPI. */
    const addTile = document.createElement("button");
    addTile.type = "button";
    addTile.className = "vb-building-tile vb-add-tile";
    addTile.title = "Add Player's Tipi";
    addTile.setAttribute("aria-label", "Add Player's Tipi");
    addTile.innerHTML =
      '<div class="vb-tile-icon vb-tile-plus">+</div>' +
      '<div class="vb-tile-label">New Tipi</div>';
    addTile.addEventListener("click", () => this._spawnPlayerTipi());
    list.appendChild(addTile);
  },

  /**
   * Spawn a "Player's Tipi" — same GLB as tipis 1 and 2 but loaded with
   * NO stripe shader patch + NO seated NPC, so the canvas reads as a
   * plain owned tipi. Drops it east of tipi 2 on a fresh sacred-circle
   * platform tile so back-to-back additions stack along the +X axis.
   */
  async _spawnPlayerTipi() {
    const wp = getRuntimeService("WorldPlayer");
    const scene = wp?.avatar?.parent ?? null;
    if (!scene) {
      console.warn("[VillageBuilder] cannot spawn — no live scene yet.");
      return;
    }

    // Stack new tipis east of tipi 2: tipi 2 sits at V2_TIPI_2_CENTER_X_M,
    // each new player tipi adds one tile east of the previous.
    this._playerTipiCount += 1;
    const stepX = 2.6 * V2_TILE_WORLD * this._playerTipiCount;
    const x = V2_TIPI_2_CENTER_X_M + stepX;
    const z = V2_TIPI_2_CENTER_Z_M;

    try {
      const gltf = await new GLTFLoaderWithDraco().loadAsync(TIPI_GLB_URL);
      const tipi = gltf.scene;
      tipi.name = "structure_tipi_player_" + this._playerTipiCount;
      tipi.userData.anuId = "structure.tipi_player." + this._playerTipiCount;
      tipi.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
      tipi.userData.anuKind = "tipi_player_owned";

      // Scale to canonical tipi height.
      const sourceBox = new THREE.Box3().setFromObject(tipi);
      const sourceSize = new THREE.Vector3();
      sourceBox.getSize(sourceSize);
      const fitScale =
        V2_TIPI_YELLOW_BUTTERFLY_TARGET_HEIGHT_M / Math.max(sourceSize.y, 0.1);
      tipi.scale.setScalar(fitScale);
      tipi.updateMatrixWorld(true);

      const fitBox = new THREE.Box3().setFromObject(tipi);
      const fitCenter = fitBox.getCenter(new THREE.Vector3());
      const platformY = terrainY(x, z);
      const deckTopY =
        platformY +
        V2_TIPI_SACRED_PLATFORM_HEIGHT +
        V2_TIPI_SACRED_PLATFORM_CENTER_Y;
      tipi.position.set(
        x - fitCenter.x + tipi.position.x,
        deckTopY - fitBox.min.y - 0.02,
        z - fitCenter.z + tipi.position.z,
      );

      // PLAIN canvas — clone every material and strip stripe / butterfly
      // overlays. tipi 1's GLB carries baked yellow-butterfly motifs that
      // BHG's patch shader normally tints over; here we just drop the
      // diffuse map saturation so the canvas reads as plain natural hide.
      tipi.traverse((child) => {
        if (!(child.isMesh || child.isSkinnedMesh)) return;
        child.castShadow = false;
        child.receiveShadow = false;
        child.userData.anuCollision = "passable";
        child.userData.anuKind = "tipi_player_mesh";
        const sourceMats = Array.isArray(child.material)
          ? child.material
          : [child.material];
        const clonedMats = sourceMats.map((m) => {
          if (!m) return m;
          const c = m.clone();
          // Plain canvas: warm bone tone, no per-vertex butterfly emissive.
          if (c.color) c.color.setHex(0xe8dec3);
          if ("emissive" in c) c.emissive?.setHex?.(0x000000);
          if ("emissiveIntensity" in c) c.emissiveIntensity = 0;
          return c;
        });
        child.material = Array.isArray(child.material) ? clonedMats : clonedMats[0];
      });

      // Light platform deck so the new tipi reads on a tile rather than
      // floating on grass. Mirrors the canonical platform from tipi 1/2
      // without the gold trim (kept minimal for the Player tier).
      const platRadius = V2_TIPI_SACRED_PLATFORM_RADIUS;
      const platGeo = new THREE.CylinderGeometry(
        platRadius,
        platRadius + 0.15,
        V2_TIPI_SACRED_PLATFORM_HEIGHT,
        72,
      );
      const platMat = new THREE.MeshStandardMaterial({
        color: 0x5d4037,
        roughness: 0.95,
        metalness: 0.0,
      });
      const platMesh = new THREE.Mesh(platGeo, platMat);
      platMesh.name = "structure_tipi_player_" + this._playerTipiCount + "_platform";
      platMesh.position.set(
        x,
        platformY +
          V2_TIPI_SACRED_PLATFORM_HEIGHT / 2 +
          V2_TIPI_SACRED_PLATFORM_CENTER_Y,
        z,
      );
      platMesh.userData.anuId =
        "structure.tipi_player." + this._playerTipiCount + ".platform";
      platMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
      platMesh.userData.anuKind = "tipi_player_platform";

      scene.add(platMesh);
      scene.add(tipi);
      console.log(
        "%c[VillageBuilder] + spawned Player's Tipi at (" +
          x.toFixed(2) + ", " + z.toFixed(2) + ")",
        "color:#a5d6a7;font-weight:bold;",
      );
      this._refreshBuildingsList();
    } catch (err) {
      console.warn("[VillageBuilder] Player tipi spawn failed:", err);
      this._playerTipiCount = Math.max(0, this._playerTipiCount - 1);
    }
  },

  _wireLeftPanel() {
    if (!this._leftPanel) return;
    const tabs = this._leftPanel.querySelectorAll(".vb-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
      });
    });
  },

  _wireRightPanel() {
    if (!this._rightPanel) return;
    const tabs = this._rightPanel.querySelectorAll(".vb-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
      });
    });
    const slider = this._rightPanel.querySelector("#vb-brush-size");
    const sliderOut = this._rightPanel.querySelector("#vb-brush-size-value");
    if (slider && sliderOut) {
      slider.addEventListener("input", () => {
        sliderOut.textContent = slider.value;
      });
    }
    const applyBtn = this._rightPanel.querySelector("#vb-apply-changes");
    if (applyBtn) {
      applyBtn.addEventListener("click", () => {
        try {
          window.dispatchEvent(new CustomEvent("v2-village-apply", { detail: {} }));
        } catch (_e) { /* ignore */ }
        console.log("[VillageBuilder] APPLY CHANGES clicked (placement pass: stub).");
      });
    }
  },

  _html() {
    const treeTiles = TREE_ROW
      .map((t) =>
        '<button type="button" class="vb-tree-tile" data-tree="' + t.id +
        '" title="' + t.label + '"><span class="vb-tree-emoji">' +
        t.emoji + '</span></button>')
      .join("");
    const sceneryTiles = SCENERY_SUB_ROW
      .map((s, i) =>
        '<button type="button" class="vb-scenery-sub-tile' +
        (i === 0 ? " active" : "") + '" data-scenery="' + s.id +
        '" title="' + s.label + '"><span class="vb-tree-emoji">' +
        s.emoji + '</span></button>')
      .join("");

    /**
     * Merged BUILDINGS + SCENERY panel (May-14 2026 user spec: "merge BUILDINGS
     * with SCENERY PANEL, move to right side and make them one panel beautiful").
     * The two former panels become MODE tabs inside one right-side column. Each
     * mode keeps its own sub-tabs (HOUSES/FACILITIES, PLANT TREES/SCENERY).
     * `_leftPanel` / `_rightPanel` are kept as section refs so existing
     * `_refreshBuildingsList()` and wiring don't need to change shape.
     */
    return `
      <aside id="vb-merged-panel" class="vb-panel vb-merged">
        <header class="vb-merged-head">
          <span class="vb-merged-crest" aria-hidden="true">🌿</span>
          <div class="vb-merged-titleblock">
            <div class="vb-merged-title">VILLAGE BUILDER</div>
            <div class="vb-merged-sub">Shape your village &amp; its scenery</div>
          </div>
        </header>

        <nav class="vb-mode-tabs" role="tablist">
          <button type="button" class="vb-mode-tab active" data-mode="buildings" role="tab" aria-selected="true">
            <span class="vb-mode-icon">⛺</span><span>BUILDINGS</span>
          </button>
          <button type="button" class="vb-mode-tab" data-mode="scenery" role="tab" aria-selected="false">
            <span class="vb-mode-icon">🌿</span><span>SCENERY</span>
          </button>
        </nav>

        <section id="vb-left-panel" class="vb-mode-section vb-mode-buildings" data-mode-panel="buildings">
          <nav class="vb-tab-row">
            <button type="button" class="vb-tab active" data-tab="houses">HOUSES</button>
            <button type="button" class="vb-tab" data-tab="facilities">FACILITIES</button>
          </nav>
          <div class="vb-building-grid"></div>
        </section>

        <section id="vb-right-panel" class="vb-mode-section vb-mode-scenery" data-mode-panel="scenery" hidden>
          <nav class="vb-tab-row">
            <button type="button" class="vb-tab active" data-tab="plant-trees">
              <span class="vb-tab-icon">🌳</span>PLANT TREES
            </button>
            <button type="button" class="vb-tab" data-tab="scenery">
              <span class="vb-tab-icon">🪨</span>SCENERY
            </button>
          </nav>
          <p class="vb-help-line">Place or move trees and scenery.</p>
          <div class="vb-tree-row">
            ${treeTiles}
          </div>
          <div class="vb-scenery-sub-row">
            ${sceneryTiles}
          </div>
          <div class="vb-brush-block">
            <div class="vb-brush-label">BRUSH SIZE</div>
            <div class="vb-brush-row">
              <input type="range" id="vb-brush-size" min="1" max="8" value="3" />
              <span id="vb-brush-size-value">3</span>
            </div>
          </div>
          <div class="vb-preview-block">
            <div class="vb-brush-label">PREVIEW MAP</div>
            <div class="vb-preview-map" aria-hidden="true"></div>
          </div>
          <button type="button" id="vb-apply-changes" class="vb-apply-btn">
            <span class="vb-apply-leaf">🌿</span> APPLY CHANGES
          </button>
          <p class="vb-apply-note">Changes will be applied to your village.</p>
        </section>
      </aside>

      <aside id="vb-mapgen-panel" class="vb-panel vb-mapgen">
        <header class="vb-mapgen-head">
          <span class="vb-mapgen-crest" aria-hidden="true">🌳</span>
          <div class="vb-mapgen-titleblock">
            <div class="vb-mapgen-title">MAP GENERATION</div>
            <div class="vb-mapgen-sub">Tree size: pick L · M · S</div>
          </div>
        </header>
        <div class="vb-mapgen-size-row" role="tablist">
          <button type="button" class="vb-mapgen-tile active" data-mapgen-size="L" title="Large tree">
            <span class="vb-mapgen-icon vb-mapgen-icon-l">🌳</span>
            <span class="vb-mapgen-label">L</span>
          </button>
          <button type="button" class="vb-mapgen-tile" data-mapgen-size="M" title="Medium tree">
            <span class="vb-mapgen-icon vb-mapgen-icon-m">🌳</span>
            <span class="vb-mapgen-label">M</span>
          </button>
          <button type="button" class="vb-mapgen-tile" data-mapgen-size="S" title="Small tree">
            <span class="vb-mapgen-icon vb-mapgen-icon-s">🌳</span>
            <span class="vb-mapgen-label">S</span>
          </button>
        </div>
      </aside>
    `;
  },

  _injectStyles() {
    if (document.getElementById("v2-village-builder-style")) return;
    const style = document.createElement("style");
    style.id = "v2-village-builder-style";
    style.textContent = `
      #v2-village-builder { pointer-events: none; }
      .vb-panel {
        position: fixed;
        font-family: 'Fredoka', 'Segoe UI', system-ui, sans-serif;
        color: #f4e7d2;
        background:
          radial-gradient(120% 80% at 50% 0%, rgba(120, 200, 130, 0.06) 0%, transparent 55%),
          linear-gradient(180deg, rgba(48, 36, 22, 0.97), rgba(24, 16, 9, 0.98));
        border: 1px solid rgba(255, 220, 160, 0.12);
        border-radius: 18px;
        box-shadow:
          0 16px 36px rgba(0, 0, 0, 0.62),
          0 2px 8px rgba(0, 0, 0, 0.45),
          inset 0 1px 0 rgba(255, 235, 200, 0.10),
          inset 0 -1px 0 rgba(0, 0, 0, 0.5);
        pointer-events: auto;
        z-index: 9000;
        box-sizing: border-box;
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
      }
      /**
       * Merged BUILDINGS + SCENERY column. May-14 2026 user follow-up:
       * "move scene building to left side middle" — was previously pinned
       * to the right rail under the FPS HUD; now lives on the LEFT rail
       * vertically centred so the FPS HUD reclaims the top-right corner.
       */
      .vb-merged {
        top: 50%;
        left: 16px;
        transform: translateY(-50%);
        width: min(300px, calc(100vw - 32px));
        max-height: 86vh;
        display: flex;
        flex-direction: column;
        padding: 16px 14px 14px 14px;
        overflow: hidden;
      }
      /**
       * Map-generation panel — new in May-14 2026 user spec ("add another
       * for map generation (tree model now, but in various sizes L M S)").
       * Pinned to the right rail BELOW the FPS HUD so the two right-rail
       * boxes read as one column. Wide enough for three labelled tiles.
       */
      .vb-mapgen {
        top: 510px;
        right: 16px;
        width: min(240px, calc(100vw - 32px));
        max-height: calc(100vh - 526px);
        overflow-y: auto;
        padding: 14px;
        display: flex;
        flex-direction: column;
      }
      .vb-mapgen-head {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 2px 2px 10px;
        margin-bottom: 10px;
        border-bottom: 1px solid rgba(253, 224, 71, 0.14);
      }
      .vb-mapgen-crest {
        width: 32px;
        height: 32px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        line-height: 1;
        border-radius: 50%;
        background:
          radial-gradient(circle at 35% 30%, rgba(140, 220, 120, 0.30), rgba(35, 50, 22, 0.95) 70%);
        border: 1px solid rgba(168, 220, 120, 0.42);
        box-shadow: inset 0 1px 0 rgba(255, 235, 180, 0.18);
        flex-shrink: 0;
      }
      .vb-mapgen-titleblock { flex: 1; min-width: 0; }
      .vb-mapgen-title {
        font-weight: 700;
        font-size: 12px;
        letter-spacing: 2.0px;
        color: #f8e9c4;
        line-height: 1.1;
      }
      .vb-mapgen-sub {
        font-size: 10px;
        letter-spacing: 0.4px;
        color: rgba(244, 231, 210, 0.55);
        margin-top: 3px;
        line-height: 1.2;
      }
      .vb-mapgen-size-row {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 8px;
      }
      .vb-mapgen-tile {
        aspect-ratio: 0.85;
        background: rgba(35, 23, 17, 0.7);
        border: 1px solid rgba(205, 164, 52, 0.16);
        border-radius: 10px;
        color: #f4e7d2;
        font-family: inherit;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        padding: 6px 4px;
        transition: transform 0.12s, border-color 0.15s, background 0.15s;
      }
      .vb-mapgen-tile:hover {
        transform: translateY(-1px);
        border-color: rgba(168, 220, 120, 0.55);
        background: rgba(58, 70, 36, 0.92);
      }
      .vb-mapgen-tile.active {
        border-color: rgba(168, 220, 120, 0.78);
        background: rgba(58, 70, 36, 0.92);
        box-shadow: inset 0 0 0 1px rgba(168, 220, 120, 0.32);
      }
      .vb-mapgen-icon { line-height: 1; }
      .vb-mapgen-icon-l { font-size: 30px; }
      .vb-mapgen-icon-m { font-size: 22px; }
      .vb-mapgen-icon-s { font-size: 15px; }
      .vb-mapgen-label {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 1.2px;
        color: rgba(244, 231, 210, 0.78);
      }
      .vb-mapgen-tile.active .vb-mapgen-label {
        color: #fff4c2;
      }
      .vb-merged-head {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 2px 2px 12px;
        margin-bottom: 10px;
        border-bottom: 1px solid rgba(253, 224, 71, 0.14);
      }
      .vb-merged-crest {
        width: 36px;
        height: 36px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        line-height: 1;
        border-radius: 50%;
        background:
          radial-gradient(circle at 35% 30%, rgba(253, 224, 71, 0.25), rgba(58, 38, 27, 0.95) 70%);
        border: 1px solid rgba(253, 224, 71, 0.35);
        box-shadow: inset 0 1px 0 rgba(255, 235, 180, 0.18);
        flex-shrink: 0;
      }
      .vb-merged-titleblock { flex: 1; min-width: 0; }
      .vb-merged-title {
        font-weight: 700;
        font-size: 14px;
        letter-spacing: 2.4px;
        color: #f8e9c4;
        line-height: 1.1;
      }
      .vb-merged-sub {
        font-size: 10px;
        letter-spacing: 0.4px;
        color: rgba(244, 231, 210, 0.55);
        margin-top: 3px;
        line-height: 1.2;
      }
      .vb-mode-tabs {
        display: flex;
        gap: 6px;
        margin-bottom: 12px;
        padding: 4px;
        border-radius: 11px;
        background: rgba(20, 13, 7, 0.72);
        border: 1px solid rgba(0, 0, 0, 0.45);
        box-shadow: inset 0 1px 0 rgba(0, 0, 0, 0.45);
      }
      .vb-mode-tab {
        flex: 1;
        background: transparent;
        border: 1px solid transparent;
        color: rgba(244, 231, 210, 0.72);
        font-family: inherit;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 1.4px;
        padding: 9px 6px;
        border-radius: 8px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: color 0.15s, background 0.18s, border-color 0.18s, box-shadow 0.18s;
      }
      .vb-mode-tab:hover { color: #fff7d2; }
      .vb-mode-tab.active {
        color: #fff4c2;
        background: linear-gradient(180deg, rgba(82, 56, 22, 0.95), rgba(46, 30, 12, 0.95));
        border-color: rgba(253, 224, 71, 0.45);
        box-shadow:
          inset 0 1px 0 rgba(253, 224, 71, 0.22),
          0 2px 6px rgba(0, 0, 0, 0.45);
      }
      .vb-mode-icon { font-size: 14px; line-height: 1; }
      .vb-mode-section {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        overflow-x: hidden;
        padding-right: 2px;
      }
      .vb-mode-section[hidden] { display: none; }
      .vb-tab-row {
        display: flex;
        gap: 8px;
        margin-bottom: 10px;
      }
      .vb-tab {
        flex: 1;
        background: rgba(35, 23, 17, 0.6);
        border: 1px solid rgba(205, 164, 52, 0.18);
        color: rgba(244, 231, 210, 0.78);
        font-family: inherit;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 1.2px;
        padding: 8px 6px;
        border-radius: 8px;
        cursor: pointer;
        transition: color 0.15s, background 0.15s, border-color 0.15s;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }
      .vb-tab:hover { color: #fff; background: rgba(58, 38, 27, 0.85); }
      .vb-tab.active {
        color: #fde047;
        border-color: rgba(253, 224, 71, 0.55);
        background: rgba(58, 38, 27, 0.95);
        box-shadow: inset 0 0 0 1px rgba(253, 224, 71, 0.18);
      }
      .vb-tab-icon { font-size: 13px; }

      /* ── Left panel: building grid ─────────────────────────────── */
      .vb-building-grid {
        flex: 1;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        overflow-y: auto;
        padding-right: 2px;
      }
      .vb-building-tile {
        aspect-ratio: 1;
        background: rgba(35, 23, 17, 0.7);
        border: 1px solid rgba(205, 164, 52, 0.16);
        border-radius: 10px;
        color: #f4e7d2;
        font-family: inherit;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 8px 6px;
        transition: transform 0.12s, border-color 0.15s, background 0.15s;
      }
      .vb-building-tile:hover {
        transform: translateY(-1px);
        border-color: rgba(253, 224, 71, 0.55);
        background: rgba(58, 38, 27, 0.92);
      }
      .vb-tile-icon { font-size: 26px; line-height: 1; }
      .vb-tile-label {
        font-size: 9.5px;
        letter-spacing: 0.4px;
        color: rgba(244, 231, 210, 0.78);
        text-align: center;
        line-height: 1.15;
      }
      .vb-add-tile {
        border-style: dashed;
        border-color: rgba(253, 224, 71, 0.55);
        background: rgba(58, 38, 27, 0.6);
      }
      .vb-tile-plus {
        font-size: 30px;
        color: #fde047;
        line-height: 1;
        font-weight: 300;
      }
      .vb-panel-foot-chev {
        margin-top: 8px;
        align-self: center;
        background: transparent;
        border: none;
        color: rgba(244, 231, 210, 0.5);
        font-size: 18px;
        cursor: pointer;
      }

      /* ── Right panel: scenery ──────────────────────────────────── */
      .vb-help-line {
        font-size: 11px;
        color: rgba(244, 231, 210, 0.7);
        margin: 0 0 10px 2px;
      }
      /** ONE row of tree tiles (May-14 2026 user spec: "only one row wide, not 3"). */
      .vb-tree-row {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 6px;
        margin-bottom: 10px;
      }
      .vb-tree-tile {
        aspect-ratio: 1;
        background: rgba(35, 23, 17, 0.7);
        border: 1px solid rgba(205, 164, 52, 0.16);
        border-radius: 8px;
        color: #f4e7d2;
        font-family: inherit;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        transition: transform 0.12s, border-color 0.15s;
      }
      .vb-tree-tile:hover {
        transform: translateY(-1px);
        border-color: rgba(253, 224, 71, 0.55);
      }
      .vb-tree-emoji { font-size: 22px; line-height: 1; }

      .vb-scenery-sub-row {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 6px;
        margin-bottom: 14px;
      }
      .vb-scenery-sub-tile {
        aspect-ratio: 1;
        background: rgba(35, 23, 17, 0.6);
        border: 1px solid rgba(205, 164, 52, 0.16);
        border-radius: 8px;
        color: #f4e7d2;
        font-family: inherit;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        transition: transform 0.12s, border-color 0.15s, background 0.15s;
      }
      .vb-scenery-sub-tile:hover {
        border-color: rgba(253, 224, 71, 0.55);
      }
      .vb-scenery-sub-tile.active {
        border-color: rgba(253, 224, 71, 0.75);
        background: rgba(58, 38, 27, 0.95);
        box-shadow: inset 0 0 0 1px rgba(253, 224, 71, 0.18);
      }
      .vb-brush-block { margin-bottom: 14px; }
      .vb-brush-label {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 1.6px;
        color: rgba(244, 231, 210, 0.78);
        margin-bottom: 6px;
      }
      .vb-brush-row { display: flex; align-items: center; gap: 10px; }
      .vb-brush-row input[type="range"] {
        flex: 1;
        accent-color: #88c47a;
      }
      .vb-brush-row span {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: rgba(35, 23, 17, 0.8);
        border: 1px solid rgba(205, 164, 52, 0.25);
        color: #f4e7d2;
        font-size: 12px;
        font-weight: 700;
      }
      .vb-preview-block { margin-bottom: 14px; }
      .vb-preview-map {
        aspect-ratio: 16 / 9;
        border-radius: 8px;
        border: 1px solid rgba(205, 164, 52, 0.25);
        background:
          radial-gradient(ellipse at 25% 35%, rgba(125, 168, 96, 0.55), transparent 45%),
          radial-gradient(ellipse at 75% 60%, rgba(80, 121, 64, 0.55), transparent 50%),
          radial-gradient(ellipse at 50% 80%, rgba(70, 105, 60, 0.4), transparent 60%),
          linear-gradient(135deg, #2d3a26 0%, #1f2a1a 100%);
      }
      .vb-apply-btn {
        width: 100%;
        background: linear-gradient(180deg, #6abf4f, #4c9436);
        color: #082c0c;
        border: 1px solid #2f6a1f;
        border-radius: 10px;
        padding: 11px 14px;
        font-family: inherit;
        font-weight: 700;
        font-size: 13px;
        letter-spacing: 1.4px;
        cursor: pointer;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.32),
          0 4px 10px rgba(0, 0, 0, 0.4);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: transform 0.12s, filter 0.15s;
      }
      .vb-apply-btn:hover { filter: brightness(1.06); }
      .vb-apply-btn:active { transform: translateY(1px); }
      .vb-apply-leaf { font-size: 16px; line-height: 1; }
      .vb-apply-note {
        font-size: 10px;
        color: rgba(244, 231, 210, 0.6);
        text-align: center;
        margin-top: 8px;
      }
    `;
    document.head.appendChild(style);
  },
};
