/**
 * Sacred Adventures v2 — touch/control panels (legacy 1:1 styling + Three.js guide icons).
 *
 * Layout/CSS ported from `SacredOnes.1/public/SacredGame.Panel.html` + `Component.Panel.Sides.html`:
 *  - Left: neumorphic movement keypad + center jump
 *  - Center-bottom: guide cards (Quest / Gather / Fish / Observe / Journal) + `Component.ThreeIcons.js`
 *  - Right: avatar + radial actions + resource ring
 */

import * as THREE_MODULE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { clone as cloneHudAvatar } from "three/addons/utils/SkeletonUtils.js";
import { GLTFLoaderWithDraco } from "./gltfLoaderSetup.js";
import { createV2IconRendererLite } from "./V2IconRenderer.js";
import { getRuntimeService } from "./RuntimeServices.js";
import {
  V2_POND_ENCLAVE_CENTER_X_M,
  V2_POND_ENCLAVE_CENTER_Z_M,
  V2_POOL2_BASIN_RADIUS_M,
} from "./constants.js";

/**
 * ES module namespace objects are non-extensible — assigning THREE.GLTFLoader throws,
 * and strict-mode writes through a Proxy forward to the namespace unless `set` is trapped.
 * Legacy ThreeIcons expects window.THREE.GLTFLoader / OBJLoader (global script era).
 */
function createThreeGlobalForLegacyIcons() {
  return new Proxy(THREE_MODULE, {
    get(target, prop, receiver) {
      if (prop === "GLTFLoader") return GLTFLoaderWithDraco;
      if (prop === "OBJLoader") return OBJLoader;
      return Reflect.get(target, prop, receiver);
    },
    set(_target, prop, _value, _receiver) {
      if (prop === "GLTFLoader" || prop === "OBJLoader") return true;
      return false;
    },
    defineProperty(_target, prop, _desc) {
      if (prop === "GLTFLoader" || prop === "OBJLoader") return true;
      return false;
    },
  });
}

const FA_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css";

function ensureFontAwesome() {
  const fontService = getRuntimeService("WebFontsService");
  if (fontService) {
    fontService.loadFont("v2-fa", FA_URL);
  } else {
    if (document.getElementById("v2-fa")) return;
    const l = document.createElement("link");
    l.id = "v2-fa";
    l.rel = "stylesheet";
    l.href = FA_URL;
    document.head.appendChild(l);
  }
}

/** Legacy panel cards use Lato for descriptions / titles */
function ensureLato() {
  const fontService = getRuntimeService("WebFontsService");
  if (fontService) {
    fontService.loadFont("v2-font-lato", "https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,400;0,700;0,900;1,400&display=swap");
  } else {
    if (document.getElementById("v2-font-lato")) return;
    const l = document.createElement("link");
    l.id = "v2-font-lato";
    l.rel = "stylesheet";
    l.href =
      "https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,400;0,700;0,900;1,400&display=swap";
    document.head.appendChild(l);
  }
}

function ensureNunito() {
  const fontService = getRuntimeService("WebFontsService");
  if (fontService) {
    fontService.loadFont("v2-font-nunito", "https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800&display=swap");
  } else {
    if (document.getElementById("v2-font-nunito")) return;
    const l = document.createElement("link");
    l.id = "v2-font-nunito";
    l.rel = "stylesheet";
    l.href =
      "https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800&display=swap";
    document.head.appendChild(l);
  }
}

function synthKey(key, type) {
  const ev = new KeyboardEvent(type, {
    key,
    code: keyToCode(key),
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(ev);
}

function keyToCode(key) {
  const k = key.length === 1 ? key.toLowerCase() : key.toLowerCase();
  const map = {
    w: "KeyW",
    a: "KeyA",
    s: "KeyS",
    d: "KeyD",
    " ": "Space",
    arrowup: "ArrowUp",
    arrowdown: "ArrowDown",
    arrowleft: "ArrowLeft",
    arrowright: "ArrowRight",
  };
  return map[k] || "Unidentified";
}

/** ThreeIcons expects `window.AXE_GLB_BASE64`; GLTFLoader accepts a blob/object URL. */
let _axeGuideBlobUrl = null;

async function ensureAxeGuideAsset() {
  if (window.AXE_GLB_BASE64) return;
  const axeUrl = new URL("../../Assets/axe.glb", import.meta.url).href;
  try {
    const res = await fetch(axeUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (_axeGuideBlobUrl) URL.revokeObjectURL(_axeGuideBlobUrl);
    _axeGuideBlobUrl = URL.createObjectURL(blob);
    window.AXE_GLB_BASE64 = _axeGuideBlobUrl;
  } catch (e) {
    console.warn("[V2Panel] Assets/axe.glb unavailable — Gather axe icon skipped:", e);
  }
}

async function loadThreeIconsScript() {
  if (window.ThreeIconManager) return;
  const url = new URL("../components/Component.ThreeIcons.js", import.meta.url).href;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () =>
      reject(new Error(`[V2Panel] Failed to load ThreeIcons: ${url}`));
    document.head.appendChild(s);
  });
}

const HUD_AVATAR_PRESENTATION_YAW_RAD = 0;
/** ~86px dock circle: bbox-centered rig reads low (feet clip bottom, empty arc
 * above head). Nudge pivot +Y and aim camera at upper torso so head+shoulders
 * sit optical center without chin/feet clipping (May-14 2026).
 *
 * Geometry recap (May-14 2026 user fix: "feet 20px above the bottom"):
 *   Camera at (0, POS_Y, -1.55), FOV 32°, lookAt (0, LOOK_Y, 0).
 *   Visible vertical band at z=0 ≈ 2 · 1.55 · tan(16°) ≈ 0.888 m, centered
 *   on LOOK_Y. 20 CSS px on the 86 px circle ≈ 0.207 m above the band's
 *   bottom (LOOK_Y − 0.444). With a bbox-centered model at scale 0.265,
 *   scaled height ≈ 0.45 m so feet sit at `PIVOT_Y − 0.225` in world
 *   space. PIVOT_Y ≈ 0.61 plus LOOK_Y ≈ 0.83 keeps the rig centered in
 *   the visible band with feet ~20 px above the circle's bottom edge.
 */
const HUD_AVATAR_PRESENTATION_SCALE = 0.265;
/** World-space Y lift for the entire cloned rig after bbox centering (+ = higher in the HUD frame). */
const HUD_AVATAR_PIVOT_OFFSET_Y_M = 0.61;
const HUD_AVATAR_CAMERA_POS_Y = 0.7;
const HUD_AVATAR_CAMERA_LOOK_Y = 0.83;

function buildAvatarPosePairs(sourceRoot, targetRoot) {
  const sourceNodes = [];
  const targetNodes = [];
  sourceRoot.traverse((node) => sourceNodes.push(node));
  targetRoot.traverse((node) => targetNodes.push(node));
  const count = Math.min(sourceNodes.length, targetNodes.length);
  const pairs = [];
  for (let i = 0; i < count; i++) {
    pairs.push([sourceNodes[i], targetNodes[i]]);
  }
  return pairs;
}

function copyAvatarPoseToHud(pairs) {
  for (const [source, target] of pairs) {
    target.position.copy(source.position);
    target.quaternion.copy(source.quaternion);
    target.scale.copy(source.scale);
    if (
      source.morphTargetInfluences &&
      target.morphTargetInfluences &&
      source.morphTargetInfluences.length === target.morphTargetInfluences.length
    ) {
      for (let i = 0; i < source.morphTargetInfluences.length; i++) {
        target.morphTargetInfluences[i] = source.morphTargetInfluences[i];
      }
    }
  }
}

export const V2PanelModule = {
  name: "V2Panel",

  _root: null,
  _onGuideMouseMove: null,
  _iconsStarted: false,
  _hudAvatar: null,
  _onHudResize: null,
  _hudAvatarRenderPhase: 0,
  _lastWalkingUiState: null,

  load() {
    ensureNunito();
    ensureLato();
    ensureFontAwesome();

    window.THREE = createThreeGlobalForLegacyIcons();

    this._root = document.createElement("div");
    this._root.id = "v2-panel-root";
    this._root.setAttribute("aria-label", "Game controls");
    this._root.innerHTML = _panelHtml();

    document.body.appendChild(this._root);

    this._wireKeyboardCtrls();
    this._wireGuideCards();
    this._wireGuideIconInput();
    this._wireActionZone();

    this._bootThreeIcons().catch((err) => {
      console.warn("[V2Panel] Three guide icons unavailable:", err);
    });

    console.log(
      "%c[V2Panel] ✅ Legacy-style panels + guide cards (ThreeIcons optional)",
      "color:#ffb74d;font-weight:bold;",
    );
  },

  async _bootThreeIcons() {
    if (this._iconsStarted) return;
    await ensureAxeGuideAsset();
    await loadThreeIconsScript();
    if (typeof window.ThreeIconManager !== "function") {
      throw new Error("ThreeIconManager not defined after script load");
    }

    /**
     * Tier-B renderer: same scene/model/animation code as the legacy
     * `ThreeIconManager` (we subclass it) but with a ~15 fps cap (stride 4
     * on 60 Hz) + scissored per-icon clear instead of the legacy 60 Hz
     * clear. See `js/v2/V2IconRenderer.js` for the rationale and the
     * `ANU_PIPELINE_MEMORY` entry `v2-hud-icon-tier-b` for the
     * regression-prevention contract.
     */
    const lite = createV2IconRendererLite({
      frameStride: 4,
      maxPixelRatio: 2,
      verboseBoot: false,
    });
    if (!lite) {
      throw new Error("[V2Panel] createV2IconRendererLite returned null");
    }
    window.icons = lite;

    const register = (id, type) => {
      lite.createIcon(id, type);
    };

    register("icon-quest", "QUEST");
    register("icon-search", "SEARCH");
    register("icon-log", "LOG");
    register("icon-gather", "GATHER");
    register("icon-fish", "FISH");

    this._iconsStarted = true;
  },

  _wireGuideIconInput() {
    const guides = this._root.querySelector("#guides-container");
    if (!guides) return;

    this._onGuideMouseMove = (e) => {
      if (!window.icons) return;
      const rect = guides.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      window.icons.updateInput(
        Math.max(-1, Math.min(1, nx)),
        Math.max(-1, Math.min(1, ny)),
      );
    };
    document.addEventListener("mousemove", this._onGuideMouseMove);
  },

  _wireGuideCards() {
    /**
     * May-15 2026 user spec: clicking the FISH card auto-paths the player
     * to the fish-bowl "FISHING POINT" at the dock's cantilever tip. The
     * other three (Quest / Gather / Search) stay blocked until they get
     * their own behaviours wired.
     */
    const blockedIds = new Set([
      "card-quest-btn",
      "card-gather-btn",
      "card-search-btn",
    ]);

    const blockGuide = (el) => {
      el.setAttribute("aria-disabled", "true");
      el.setAttribute("tabindex", "-1");
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
        }
      });
    };

    /**
     * Smart-nav handler for the FISH card.
     *
     * `WorldPool2` stashes the fishing-point XZ on `window._v2FishingPoint`
     * after dock load. Reads the live `WorldModule` instance through the
     * orchestrator's active-module map and calls `startSmartNavigateTo`,
     * which already side-steps trees/colliders (the obstacle-steering
     * polyline is in `WorldPhysics.steerAroundObstacles`). The footprint
     * trail + gold X marker drop in for free because they're driven by
     * `_smartNavGoal` in `World.update`.
     */
    const fishClickHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const fp = window._v2FishingPoint;
      const world =
        window.anuOrchestrator?._activeModuleInstances?.World ?? null;
      if (!fp || !world?.startSmartNavigateTo) {
        console.warn("[V2Panel] FISH card: fishing-point or World.startSmartNavigateTo unavailable", { fp, hasWorld: !!world });
        return;
      }
      /**
       * Pond-bypass routing — May-16 2026 user spec ("smart pathing autowalk
       * glitch when clicking FISH, it goes into the water when it should
       * walk around the pond"). The default `_buildSmartNavSegments` lays
       * a straight line of waypoints from start to goal, which cuts across
       * the water disc when the player is south of the pond. Instead we
       * compute a waypoint chain that hugs the east/west bank: bypass on
       * the side closer to the player's current X, swing north past the
       * dock-base shore, then drop south down the dock corridor to the
       * fishing tip. `startSmartNavigateViaWaypoints` follows the chain
       * directly so `steerAroundObstacles` only handles trees, not water.
       */
      const player = getRuntimeService("WorldPlayer");
      const sx = player?.feet?.x ?? 0;
      const sz = player?.feet?.z ?? 0;
      const cx = V2_POND_ENCLAVE_CENTER_X_M;
      const cz = V2_POND_ENCLAVE_CENTER_Z_M;
      const R = V2_POOL2_BASIN_RADIUS_M;
      // Dock geometry from WorldPool2.buildAdvancedFishingDock — `shoreZ`
      // is the deck back edge; it lives at `cz + R * 0.91` because
      // `pierDirZ = -1` (dock extends from north shore toward centre).
      const dockBaseZ = cz + R * 0.91;
      // Does the straight line from (sx, sz) to (fp.x, fp.z) come within
      // (R − 1) of the pond centre? If so, route around.
      const dx = fp.x - sx, dz = fp.z - sz;
      const segLen2 = dx * dx + dz * dz;
      let crossesWater = false;
      if (segLen2 > 1e-4) {
        const t = Math.max(0, Math.min(1, ((cx - sx) * dx + (cz - sz) * dz) / segLen2));
        const cpx = sx + t * dx;
        const cpz = sz + t * dz;
        const closestD2 = (cpx - cx) * (cpx - cx) + (cpz - cz) * (cpz - cz);
        crossesWater = closestD2 < (R - 1) * (R - 1);
      }
      if (!crossesWater || typeof world.startSmartNavigateViaWaypoints !== "function") {
        world.startSmartNavigateTo(fp.x, fp.z, 0.8, null);
        return;
      }
      const side = (sx >= cx) ? +1 : -1;
      const bypassX = cx + side * (R + 4.0);
      const bypassZ = sz; // skirt the pond at the player's current latitude
      const bypassNorthZ = dockBaseZ + 1.5; // safely past the north bank
      const dockApproachZ = dockBaseZ + 0.6; // mouth of the dock, on the deck
      const waypoints = [
        { x: bypassX, z: bypassZ },
        { x: bypassX, z: bypassNorthZ },
        { x: cx, z: dockApproachZ },
        { x: fp.x, z: fp.z },
      ];
      world.startSmartNavigateViaWaypoints(waypoints, 0.8, null);
    };

    this._root.querySelectorAll(".guide-card").forEach((el) => {
      if (blockedIds.has(el.id)) {
        blockGuide(el);
      }
    });

    const fishCard = this._root.querySelector("#card-fish-btn");
    if (fishCard) {
      fishCard.setAttribute("aria-disabled", "false");
      fishCard.setAttribute("tabindex", "0");
      fishCard.addEventListener("click", fishClickHandler);
      fishCard.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          fishClickHandler(e);
        }
      });
    }

    const journalCard = this._root.querySelector("#card-log-btn");
    if (journalCard) {
      journalCard.setAttribute("aria-disabled", "false");
      journalCard.setAttribute("tabindex", "0");
      journalCard.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window._v2ToggleJournal === "function") {
          window._v2ToggleJournal();
        }
      });
      journalCard.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          if (typeof window._v2ToggleJournal === "function") {
            window._v2ToggleJournal();
          }
        }
      });
    }
  },

  _wireKeyboardCtrls() {
    const bindHold = (el, key) => {
      const down = (e) => {
        e.preventDefault();
        el.classList.add("v2-active");
        synthKey(key, "keydown");
      };
      const up = (e) => {
        e.preventDefault();
        el.classList.remove("v2-active");
        synthKey(key, "keyup");
      };
      el.addEventListener("mousedown", down);
      el.addEventListener("mouseup", up);
      el.addEventListener("mouseleave", up);
      el.addEventListener("touchstart", down, { passive: false });
      el.addEventListener("touchend", up, { passive: false });
      el.addEventListener("touchcancel", up, { passive: false });
    };

    this._root.querySelectorAll(".v2-ctrl").forEach((el) => {
      const key = el.dataset.key;
      if (!key) return;
      bindHold(el, key);
    });
  },

  _wireActionZone() {
    const zone = this._root.querySelector("#v2-action-zone");
    const itemsBtn = this._root.querySelector("#v2-btn-items");

    itemsBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      zone?.classList.toggle("v2-outer-active");
    });

    this._root.querySelector("#v2-btn-map")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const wp = getRuntimeService("WorldPlayer");
      const next = wp?.toggleMainCanvasMapView?.();
      window.dispatchEvent(
        new CustomEvent("v2-map-toggle", {
          detail: { mainCanvasMapView: next ?? null, source: "hud-map-button" },
        }),
      );
    });

    this._root.querySelectorAll("[data-v2-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const action = btn.dataset.v2Action;
        window.dispatchEvent(
          new CustomEvent("v2-action", { detail: { action } }),
        );
      });
    });

    this._root.querySelector("#v2-avatar-hit")?.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("v2-avatar", { detail: {} }));
    });

    this._root.querySelectorAll(".v2-outer-btn[data-res]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const res = btn.dataset.res;
        window.dispatchEvent(
          new CustomEvent("v2-resource", { detail: { resource: res } }),
        );
      });
    });
  },

  _syncHudVisibilityForWalking() {
    const zone = this._root?.querySelector("#v2-action-zone");
    const dockGuides = this._root?.querySelector(".dock-guides");
    if (!zone && !dockGuides) return;
    const wp = getRuntimeService("WorldPlayer");
    const spd = typeof wp?.velocityXZMps === "number" ? wp.velocityXZMps : 0;
    const walking = spd > 0.12;
    const cinematicUi =
      typeof document !== "undefined" &&
      document.body?.classList?.contains("v2-cinematic-ui-hidden");
    const guidesDomOn =
      !!dockGuides &&
      !dockGuides.hidden &&
      window.getComputedStyle(dockGuides).display !== "none";
    const guidesActive = guidesDomOn && !cinematicUi;
    if (walking === this._lastWalkingUiState) {
      window.icons?.setGuideIconsActive?.(guidesActive);
      return;
    }
    this._lastWalkingUiState = walking;
    zone?.classList.toggle("v2-outer-active", false);
    if (dockGuides) {
      dockGuides.hidden = walking;
      dockGuides.classList.toggle("v2-guides-hidden", walking);
      dockGuides.setAttribute("aria-hidden", walking ? "true" : "false");
    }
    const guidesDomAfter =
      !!dockGuides &&
      !dockGuides.hidden &&
      window.getComputedStyle(dockGuides).display !== "none";
    window.icons?.setGuideIconsActive?.(guidesDomAfter && !cinematicUi);
  },

  _resizeHudAvatarCanvas() {
    const h = this._hudAvatar;
    if (!h?.ready || !h.canvas || !h.renderer || !h.camera) return;
    const parent = h.canvas.closest(".v2-avatar-circle");
    const pr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.max(72, parent?.clientWidth || 86);
    const cssH = Math.max(72, parent?.clientHeight || 86);
    const bufW = Math.max(64, Math.round(cssW * pr));
    const bufH = Math.max(64, Math.round(cssH * pr));
    if (h.canvas.width !== bufW || h.canvas.height !== bufH) {
      h.canvas.width = bufW;
      h.canvas.height = bufH;
      h.renderer.setPixelRatio(1);
      h.renderer.setSize(bufW, bufH, false);
    }
    h.camera.aspect = bufW / bufH;
    h.camera.updateProjectionMatrix();
  },

  _tryInitHudAvatarMirror() {
    if (this._hudAvatar?.ready || this._hudAvatar?.failed) return;
    const ac = getRuntimeService("WorldPlayer")?.avatarController;
    if (!ac?.model) return;
    const canvas = this._root?.querySelector("#v2-avatar-hud-canvas");
    if (!canvas) return;
    try {
      const THREE = THREE_MODULE;
      const hudModel = cloneHudAvatar(ac.model);
      const avatarPivot = new THREE.Group();
      /** One-time bind-pose bbox centering (before pivot scale so offset stays in rig space). */
      const rigOffset = new THREE.Group();
      avatarPivot.add(rigOffset);
      rigOffset.add(hudModel);
      hudModel.updateMatrixWorld(true);
      const bindBox = new THREE.Box3().setFromObject(hudModel);
      const bindCenter = new THREE.Vector3();
      bindBox.getCenter(bindCenter);
      rigOffset.position.set(-bindCenter.x, -bindCenter.y, -bindCenter.z);
      avatarPivot.rotation.y = HUD_AVATAR_PRESENTATION_YAW_RAD;
      avatarPivot.position.set(0, HUD_AVATAR_PIVOT_OFFSET_Y_M, 0);
      avatarPivot.scale.setScalar(HUD_AVATAR_PRESENTATION_SCALE);
      hudModel.traverse((ch) => {
        if (ch.isMesh) {
          ch.castShadow = false;
          ch.receiveShadow = false;
          ch.frustumCulled = true;
        }
      });
      const scene = new THREE.Scene();
      // +40% mesh luminosity (May-13 2026 user pass): amb 0.58 → 0.81,
      // dir 0.95 → 1.33, plus a soft front-fill rim so the face reads
      // brightly in the dark HUD circle, and toneMappingExposure 1.0 → 1.4.
      const amb = new THREE.AmbientLight(0xffffff, 0.81);
      const dir = new THREE.DirectionalLight(0xfff5e6, 1.33);
      dir.position.set(2.2, 4.5, 2.8);
      const fill = new THREE.DirectionalLight(0xfff0d8, 0.55);
      fill.position.set(0, 1.2, -2.0);
      scene.add(amb, dir, fill, avatarPivot);

      const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 12);
      // Frame the head + shoulders, not the legs. (May-13 2026 user pass.)
      camera.position.set(0, HUD_AVATAR_CAMERA_POS_Y, -1.55);
      camera.lookAt(0, HUD_AVATAR_CAMERA_LOOK_Y, 0);

      const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: false,
        powerPreference: "low-power",
      });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.4;

      this._hudAvatar = {
        ready: true,
        failed: false,
        renderer,
        scene,
        camera,
        pivot: avatarPivot,
        sourceModel: ac.model,
        model: hudModel,
        posePairs: buildAvatarPosePairs(ac.model, hudModel),
        canvas,
      };
      this._resizeHudAvatarCanvas();
      this._onHudResize = () => this._resizeHudAvatarCanvas();
      window.addEventListener("resize", this._onHudResize);
      console.log(
        "%c[V2Panel] HUD Avatar3 mirror — pose-copy sync from live world figurine",
        "color:#a5d6a7;font-weight:bold;",
      );
    } catch (err) {
      console.warn("[V2Panel] HUD avatar mirror init failed:", err);
      this._hudAvatar = { failed: true };
    }
  },

  _tickHudAvatarMirror() {
    this._tryInitHudAvatarMirror();
    const h = this._hudAvatar;
    if (!h?.ready) return;
    const source = getRuntimeService("WorldPlayer")?.avatarController?.model;
    if (!source || source !== h.sourceModel) {
      h.renderer?.dispose?.();
      this._hudAvatar = null;
      return;
    }
    this._resizeHudAvatarCanvas();
    copyAvatarPoseToHud(h.posePairs);
    h.pivot.rotation.y = HUD_AVATAR_PRESENTATION_YAW_RAD;
    h.pivot.rotation.z = 0;
    h.pivot.position.set(0, HUD_AVATAR_PIVOT_OFFSET_Y_M, 0);
    h.pivot.scale.setScalar(HUD_AVATAR_PRESENTATION_SCALE);
    h.model.updateMatrixWorld(true);
    this._hudAvatarRenderPhase = (this._hudAvatarRenderPhase + 1) % 2;
    if (this._hudAvatarRenderPhase === 0) {
      h.renderer.render(h.scene, h.camera);
    }
  },

  update() {
    this._syncHudVisibilityForWalking();
    this._tickHudAvatarMirror();
  },

  unload() {
    if (this._onGuideMouseMove) {
      document.removeEventListener("mousemove", this._onGuideMouseMove);
      this._onGuideMouseMove = null;
    }
    if (this._onHudResize) {
      window.removeEventListener("resize", this._onHudResize);
      this._onHudResize = null;
    }
    try {
      this._hudAvatar?.renderer?.dispose?.();
    } catch (_e) {
      /* ignore */
    }
    this._hudAvatar = null;
    try {
      window.icons?.disposeLite?.();
    } catch (_e) {
      /* ignore */
    }
    window.icons = null;
    this._iconsStarted = false;

    if (this._root) this._root.remove();
    this._root = null;
    console.log("[V2Panel] ⏹ Unloaded.");
  },
};

function _panelHtml() {
  return `
<style>
/* ── Tokens — earthy / forest / clay (legacy SacredGame.Panel harmony) ── */
#v2-panel-root {
  --color-gold: #fbc02d;
  --color-white: #f5f5f5;
  --color-center: #6d4c41;
  --shadow-btn: 0 5px 15px rgba(0, 0, 0, 0.12);
  --shadow-deep: 0 10px 28px rgba(22, 14, 10, 0.55);
  --panel-size: clamp(170px, 22vh, 220px);
  --btn-size: clamp(44px, 5.5vh, 55px);
  --panel-offset: clamp(8px, 1.6vh, 22px);
  --clay-light: #ebe4d8;
  --clay-mid: #d4c4b0;
  --clay-dark: #8d6e63;
  --forest-shadow: rgba(27, 43, 28, 0.45);
  position: fixed;
  inset: 0;
  pointer-events: none;
  /* Below ThreeIcons overlay (9999), above intro banner — guides stay clickable */
  z-index: 9850;
  font-family: Nunito, system-ui, sans-serif;
}

#v2-panel-root .v2-surface { pointer-events: auto; }

/* ── FLUID HUD DOCK ──────────────────────────────────────────────────
 * One row, three slots — left D-pad, centered guide cards, right
 * action ring — all aligned on a single horizontal baseline by flex,
 * not by absolute coordinates. The container is pointer-events:none
 * so empty space passes clicks through to the world; only the actual
 * surfaces (.v2-surface descendants) capture pointer input.
 *
 * Sizes derive from var(--panel-size) (clamp-driven), so the dock
 * compresses cleanly on small viewports without media-query stacking.
 * The single explicit breakpoint below is for *guide card visibility*
 * — at very narrow widths the guides hide and left+right remain.
 * ────────────────────────────────────────────────────────────────── */
#v2-hud-dock {
  position: fixed;
  left: 0;
  right: 0;
  bottom: var(--panel-offset);
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: flex-end;
  padding: 0 var(--panel-offset);
  gap: clamp(8px, 1vw, 16px);
  pointer-events: none;
  z-index: 1;
}

#v2-hud-dock .dock-left,
#v2-hud-dock .dock-right {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-end;
  pointer-events: none;
}

#v2-hud-dock .dock-guides {
  flex: 1 1 auto;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  pointer-events: none;
  min-width: 0;
  transform: translateY(clamp(-64px, -7vh, -34px));
  z-index: 4;
}

/* LEFT — neumorphic clay keypad (sits inside .dock-left) */
#v2-left-panel {
  position: relative;
  width: var(--panel-size);
  height: var(--panel-size);
  display: flex;
  align-items: center;
  justify-content: center;
}

#v2-keypad-container {
  position: relative;
  width: 100%;
  height: 100%;
}

.v2-u-btn {
  position: absolute;
  width: var(--btn-size);
  height: var(--btn-size);
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 10;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) translate(var(--tx), var(--ty));
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s;
  -webkit-tap-highlight-color: transparent;
  outline: none;
}

.v2-btn-move {
  background: linear-gradient(165deg, #faf6f0 0%, #ebe4d8 42%, #d9cfc3 100%);
  border: 2px solid rgba(93, 64, 55, 0.45);
  box-shadow:
    5px 7px 14px rgba(0, 0, 0, 0.22),
    inset 3px 4px 10px rgba(255, 255, 255, 0.75),
    inset -3px -5px 12px var(--forest-shadow);
}
.v2-btn-move i { color: #4e342e; font-size: 24px; }
.v2-btn-move:active,
.v2-btn-move.v2-active {
  transform: translate(-50%, -50%) translate(var(--tx), var(--ty)) scale(0.92);
  box-shadow:
    inset 0 4px 10px rgba(0, 0, 0, 0.22),
    inset 2px 2px 6px rgba(255, 255, 255, 0.35);
}

.v2-kp-center-btn {
  position: absolute;
  width: 64px;
  height: 64px;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle at 32% 28%, #7e5a4a 0%, #4e342e 55%, #3e2723 100%);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 15;
  cursor: pointer;
  border: 4px solid rgba(255, 255, 255, 0.12);
  box-shadow:
    4px 6px 14px rgba(0, 0, 0, 0.35),
    inset 3px 4px 10px rgba(255, 255, 255, 0.12),
    inset -4px -6px 14px rgba(0, 0, 0, 0.45);
  transition: transform 0.2s;
  -webkit-tap-highlight-color: transparent;
}
.v2-kp-center-btn i { color: #fff8e1; font-size: 22px; }
.v2-kp-center-btn:active,
.v2-kp-center-btn.v2-active {
  transform: translate(-50%, -50%) scale(0.95);
}

.pos-n { --tx: 0px; --ty: -65px; }
.pos-s { --tx: 0px; --ty: 65px; }
.pos-e { --tx: 65px; --ty: 0px; }
.pos-w { --tx: -65px; --ty: 0px; }

/* ── GUIDE STRIP — five colored cards on the dock's centre baseline ── */
#guides-container {
  display: flex;
  justify-content: center;
  gap: clamp(6px, 1vw, 15px);
  pointer-events: auto;
  width: auto;
  max-width: min(640px, calc(100vw - 2 * var(--panel-size) - 4 * var(--panel-offset)));
}

.guide-card {
  width: clamp(60px, 11vh, 104px);
  height: clamp(60px, 11vh, 104px);
  border-radius: clamp(8px, 1.5vh, 14px);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  cursor: pointer;
  position: relative;
  text-align: center;
  color: white;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
  transition: transform 0.2s, box-shadow 0.2s;
  border: 2px solid rgba(255, 255, 255, 0.2);
  padding: clamp(5px, 1vh, 9px) clamp(4px, 1vw, 8px) clamp(6px, 1.1vh, 10px);
  overflow: visible;
  background: rgba(0, 0, 0, 0.4);
  gap: 0;
}

.dock-guides {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.dock-guides.v2-guides-hidden {
  opacity: 0;
  transform: translateY(18px) scale(0.96);
  pointer-events: none;
}

.guide-card[aria-disabled="true"] {
  cursor: default;
}

.guide-card:hover {
  transform: translateY(-5px) scale(1.05);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.6);
  border-color: var(--color-gold);
}

.guide-card:active {
  transform: scale(0.95);
}

.card-icon-3d {
  width: clamp(34px, 5.6vh, 58px);
  height: clamp(34px, 5.6vh, 58px);
  aspect-ratio: 1 / 1;
  flex: 0 0 auto;
  align-self: center;
  border-radius: 50%;
  contain: strict;
  isolation: isolate;
  background: radial-gradient(circle at 32% 28%, rgba(255,255,255,0.14) 0%, rgba(0,0,0,0.22) 55%, rgba(0,0,0,0.38) 100%);
  box-shadow:
    inset 0 5px 10px rgba(0, 0, 0, 0.55),
    inset 0 -3px 8px rgba(255, 255, 255, 0.08),
    inset 2px 2px 6px rgba(255, 255, 255, 0.12),
    0 2px 6px rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.14);
  outline: 0.5px solid rgba(0, 0, 0, 0.35);
  position: relative;
  z-index: 10;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto clamp(4px, 0.65vh, 8px) auto;
}

/**
 * Fills space under the 3D well so subtitle + title stay vertically
 * centered as a pair (same gap to icon base across cards).
 */
.guide-card-label-stack {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 0;
  gap: clamp(2px, 0.4vh, 5px);
  padding: 0 clamp(1px, 0.4vw, 4px) 1px;
  box-sizing: border-box;
}

.card-desc,
.card-title {
  z-index: 12;
  pointer-events: none;
  font-family: Lato, sans-serif;
  width: 100%;
  max-width: 100%;
  text-align: center;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.card-desc {
  font-style: italic;
  font-size: clamp(6px, 1vw, 9px);
  opacity: 0.9;
  line-height: 1.28;
  text-wrap: balance;
}

.card-title {
  font-weight: 900;
  font-size: clamp(9px, 1.35vw, 12px);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  line-height: 1.12;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
  position: relative;
}

.card-quest {
  background: linear-gradient(180deg, #4a148cd9 0%, #311b92d9 100%);
  border: 1px solid rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(10px);
}

.card-log {
  background: linear-gradient(180deg, #3e2723d9 0%, #281815d9 100%);
  border: 1px solid rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(10px);
}

.card-gather {
  background: linear-gradient(180deg, #1b5e20d9 0%, #0d3b12d9 100%);
  border: 1px solid rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(10px);
}

.card-search {
  background: linear-gradient(180deg, #212121d9 0%, #000000d9 100%);
  border: 1px solid rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(8px);
}

.card-fish {
  background: linear-gradient(180deg, #0d47a1d9 0%, #013663d9 100%);
  border: 1px solid rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(8px);
}

@keyframes pulseQuestGlow {
  0% {
    box-shadow: 0 0 15px 5px rgba(251, 192, 45, 0.5), 0 0 30px 10px rgba(251, 192, 45, 0.2);
    border-color: #fbc02d;
    transform: translateY(-5px) scale(1.02);
  }
  100% {
    box-shadow: 0 0 25px 8px rgba(251, 192, 45, 0.8), 0 0 45px 15px rgba(251, 192, 45, 0.4);
    border-color: #fff9c4;
    transform: translateY(-5px) scale(1.06);
  }
}

.quest-highlight {
  animation: pulseQuestGlow 1.5s infinite alternate ease-in-out !important;
  border-color: #fbc02d !important;
  z-index: 50;
}

/* RIGHT — neumorphic earth radial tray (sits inside .dock-right) */
#v2-right-panel {
  position: relative;
  width: var(--panel-size);
  height: var(--panel-size);
  display: flex;
  align-items: center;
  justify-content: center;
}

.v2-circle-panel {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible !important;
  background:
    radial-gradient(ellipse 130% 110% at 45% 28%, rgba(245, 232, 210, 0.42) 0%, transparent 52%),
    radial-gradient(circle at center, rgba(165, 138, 108, 0.55) 0%, rgba(93, 72, 54, 0.82) 58%, rgba(41, 30, 22, 0.96) 100%);
  border: 1px solid rgba(141, 110, 99, 0.85);
  box-shadow:
    var(--shadow-deep),
    inset 5px 8px 18px rgba(255, 255, 255, 0.14),
    inset -8px -12px 26px rgba(0, 0, 0, 0.42);
}

.v2-orbit-track {
  position: absolute;
  width: 170px;
  height: 170px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 50%;
  pointer-events: none;
  box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.15);
}

.v2-btn-action {
  background: linear-gradient(155deg, #6d5246 0%, #4a372e 45%, #2d211b 100%);
  border: 2px solid rgba(141, 110, 99, 0.95);
  color: #fff8e1;
  box-shadow:
    4px 7px 14px rgba(0, 0, 0, 0.45),
    inset 2px 3px 8px rgba(255, 255, 255, 0.1),
    inset -3px -5px 12px rgba(0, 0, 0, 0.35);
  padding-top: 2px;
}
.v2-btn-action:hover {
  border-color: var(--color-gold);
  box-shadow: 0 0 15px var(--color-gold);
  z-index: 20;
  transform: translate(-50%, -50%) translate(var(--tx), var(--ty)) scale(1.12);
}
.v2-btn-action:active {
  transform: translate(-50%, -50%) translate(var(--tx), var(--ty)) scale(0.95);
}
.v2-ac-icon { font-size: 22px; }
.v2-ac-text {
  font-size: 7px;
  font-weight: 800;
  text-transform: uppercase;
  color: #d7ccc8;
  margin-top: -1px;
  line-height: 1;
}

.act-n { --tx: 0px; --ty: -85px; }
.act-s { --tx: 0px; --ty: 85px; }
.act-e { --tx: 85px; --ty: 0px; }
.act-w { --tx: -85px; --ty: 0px; }
.act-ne { --tx: 60px; --ty: -60px; }
.act-se { --tx: 60px; --ty: 60px; }
.act-sw { --tx: -60px; --ty: 60px; }
.act-nw { --tx: -60px; --ty: -60px; }

.v2-avatar-circle {
  width: 86px;
  height: 86px;
  border-radius: 50%;
  border: 3px solid var(--color-gold);
  background: radial-gradient(circle at 35% 30%, #5d4037 0%, #1b120e 100%);
  /* overflow: hidden removed May-13 2026 -- was clipping the upper half of
   * the .v2-level-badge which now sits on top of the gold border. The inner
   * canvas (.v2-avatar-hud) already carries its own border-radius: 50% and
   * object-fit: cover so the avatar mirror still reads as circular. */
  overflow: visible;
  box-shadow:
    0 0 26px rgba(0, 0, 0, 0.65),
    inset 3px 4px 12px rgba(255, 255, 255, 0.08),
    inset -4px -6px 14px rgba(0, 0, 0, 0.55);
  cursor: pointer;
  z-index: 50;
  position: relative;
  transition: transform 0.2s;
}
.v2-avatar-circle:hover { transform: scale(1.05); }
.v2-avatar-circle .v2-avatar-hud {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 50%;
  object-fit: cover;
  pointer-events: none;
}
.v2-level-badge {
  /* Standard gaming HUD convention: the level badge straddles the top border
   * of the avatar circle (half outside, half inside), so it reads as a
   * "crown" attached to the portrait rather than a sticker over the face.
   * (May-13 2026 user pass — was top:6px which placed it over the avatar's
   * face below the gold border.) */
  position: absolute;
  top: -13px;
  left: 50%;
  transform: translateX(-50%);
  background: #3e2723;
  color: var(--color-gold);
  border: 2px solid var(--color-gold);
  width: 26px;
  height: 26px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 56;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
}

.v2-outer-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 300px;
  height: 300px;
  background: rgba(210, 188, 155, 0.72);
  border: 2px solid rgba(255, 255, 255, 0.55);
  border-radius: 50%;
  pointer-events: none;
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.6);
  transition: all 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  z-index: 5;
  box-shadow: inset 0 0 20px rgba(62, 39, 35, 0.25);
}
#v2-action-zone.v2-outer-active .v2-outer-ring {
  opacity: 1;
  pointer-events: auto;
  transform: translate(-50%, -50%) scale(1);
}

.v2-outer-btn {
  position: absolute;
  background: linear-gradient(165deg, rgba(42, 30, 24, 0.96) 0%, rgba(22, 14, 10, 0.98) 100%);
  border: 2px solid #a1887f;
  width: 48px;
  height: 48px;
  font-size: 20px;
  border-radius: 50%;
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, -50%) scale(0.5);
  z-index: 15;
  top: 50%;
  left: 50%;
  transition: all 0.35s;
  cursor: pointer;
  box-shadow: 3px 5px 12px rgba(0, 0, 0, 0.35);
}
#v2-action-zone.v2-outer-active .v2-outer-btn {
  opacity: 1;
  pointer-events: auto;
  transform: translate(-50%, -50%) translate(var(--tx), var(--ty)) scale(1);
}

.res-1 { --tx: 63px; --ty: -121px; }
.res-2 { --tx: 10px; --ty: -133px; }
.res-3 { --tx: -44px; --ty: -127px; }
.res-4 { --tx: -88px; --ty: -104px; }
.res-5 { --tx: -118px; --ty: -68px; }
.res-6 { --tx: -133px; --ty: -22px; }
.res-7 { --tx: -133px; --ty: 24px; }
.res-8 { --tx: -114px; --ty: 72px; }

.v2-or-label { font-size: 7px; font-weight: 800; color: #ccc; text-transform: uppercase; margin-top: -2px; }
.v2-or-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  font-size: 8px;
  font-weight: 900;
  color: #000;
  background: var(--color-gold);
  padding: 1px 4px;
  border-radius: 6px;
  border: 1px solid #3e2723;
}

/* ── Responsive — guide cards compress; very narrow → guides hide ── */
@media (max-width: 1100px) {
  #guides-container {
    gap: 8px;
  }
  .guide-card {
    width: clamp(48px, 9vh, 64px);
    height: clamp(48px, 9vh, 64px);
    padding: 2px;
    gap: 0;
  }
  .guide-card-label-stack {
    flex: 1 1 auto;
    position: relative;
    min-height: 38%;
    justify-content: flex-end;
    padding-bottom: 0;
    gap: 0;
  }
  .card-desc { display: none; }
  .card-icon-3d {
    width: clamp(28px, 4.5vh, 38px);
    height: clamp(28px, 4.5vh, 38px);
    aspect-ratio: 1 / 1;
    margin: 0 auto clamp(2px, 0.4vh, 4px) auto;
  }
  .card-title {
    font-size: 8px;
    position: absolute;
    bottom: 3px;
    left: 0;
    right: 0;
    width: 100%;
    margin: 0;
    line-height: 1;
    letter-spacing: 0.04em;
  }
}

@media (max-width: 760px) {
  /* At this width the dock has no room for the guide row + both side
   * panels at usable sizes. Hide the guides; left + right take over
   * the bottom. The guide cards stay in the DOM (still keyboard-
   * focusable) but visually collapse. */
  #v2-hud-dock .dock-guides { display: none; }
}

@media (max-width: 520px) {
  /* Pull left/right closer to the screen edge on phones; the dock's
   * padding (0 var(--panel-offset)) already shrinks via the
   * clamp() on the panel-offset token, but we add the act-* / pos-* radial
   * tightening explicitly so the small avatar + arrows don't clip
   * inside their parent's box. */
  .pos-n { --tx: 0px; --ty: -50px; }
  .pos-s { --tx: 0px; --ty: 50px; }
  .pos-e { --tx: 50px; --ty: 0px; }
  .pos-w { --tx: -50px; --ty: 0px; }
  .act-n { --tx: 0px; --ty: -62px; }
  .act-s { --tx: 0px; --ty: 62px; }
  .act-e { --tx: 62px; --ty: 0px; }
  .act-w { --tx: -62px; --ty: 0px; }
  .act-ne { --tx: 44px; --ty: -44px; }
  .act-se { --tx: 44px; --ty: 44px; }
  .act-sw { --tx: -44px; --ty: 44px; }
  .act-nw { --tx: -44px; --ty: -44px; }
}
</style>

<div id="v2-hud-dock">
  <div class="dock-left">
    <div class="v2-surface" id="v2-left-panel">
      <div id="v2-keypad-container">
        <div class="v2-u-btn v2-btn-move pos-n v2-ctrl" data-key="w" role="button" tabindex="0" aria-label="Forward">
          <i class="fa-solid fa-caret-up"></i>
        </div>
        <div class="v2-u-btn v2-btn-move pos-w v2-ctrl" data-key="s" role="button" tabindex="0" aria-label="Turn left">
          <i class="fa-solid fa-caret-left"></i>
        </div>
        <div class="v2-kp-center-btn v2-ctrl" data-key=" " role="button" tabindex="0" aria-label="Jump">
          <i class="fa-solid fa-up-long"></i>
        </div>
        <div class="v2-u-btn v2-btn-move pos-e v2-ctrl" data-key="d" role="button" tabindex="0" aria-label="Turn right">
          <i class="fa-solid fa-caret-right"></i>
        </div>
        <div class="v2-u-btn v2-btn-move pos-s v2-ctrl" data-key="a" role="button" tabindex="0" aria-label="Back">
          <i class="fa-solid fa-caret-down"></i>
        </div>
      </div>
    </div>
  </div>

  <div class="dock-guides v2-surface">
    <div id="guides-container">
    <div class="guide-card card-quest quest-highlight" id="card-quest-btn" role="button" tabindex="0"
      aria-label="Quests: Follow path">
      <div id="icon-quest" class="card-icon-3d"></div>
      <div class="guide-card-label-stack">
        <div class="card-desc" id="desc-quest">Follow path</div>
        <div class="card-title">Quests</div>
      </div>
    </div>
    <div class="guide-card card-gather" id="card-gather-btn" role="button" tabindex="0" aria-label="Gather resources">
      <div id="icon-gather" class="card-icon-3d"></div>
      <div class="guide-card-label-stack">
        <div class="card-desc">Collect resources</div>
        <div class="card-title">Gather</div>
      </div>
    </div>
    <div class="guide-card card-fish" id="card-fish-btn" role="button" tabindex="0" aria-label="Fish">
      <div id="icon-fish" class="card-icon-3d"></div>
      <div class="guide-card-label-stack">
        <div class="card-desc">Catch fish</div>
        <div class="card-title">Fish</div>
      </div>
    </div>
    <div class="guide-card card-search" id="card-search-btn" role="button" tabindex="0" aria-label="Observe">
      <div id="icon-search" class="card-icon-3d"></div>
      <div class="guide-card-label-stack">
        <div class="card-desc">Look closely</div>
        <div class="card-title">Observe</div>
      </div>
    </div>
    <div class="guide-card card-log" id="card-log-btn" role="button" tabindex="0" aria-label="Journal">
      <div id="icon-log" class="card-icon-3d"></div>
      <div class="guide-card-label-stack">
        <div class="card-desc">Your story</div>
        <div class="card-title">Journal</div>
      </div>
    </div>
    </div>
  </div>

  <div class="dock-right">
    <div class="v2-surface" id="v2-right-panel">
      <div id="v2-action-zone" class="v2-circle-panel">
    <div class="v2-orbit-track"></div>
    <div class="v2-outer-ring"></div>

    <div class="v2-avatar-circle" id="v2-avatar-hit" title="Hero">
      <span class="v2-level-badge">1</span>
      <canvas class="v2-avatar-hud" id="v2-avatar-hud-canvas" width="172" height="172" aria-hidden="true"></canvas>
    </div>

    <div class="v2-u-btn v2-btn-action act-n" id="v2-btn-items" role="button" tabindex="0" title="Inventory">
      <span class="v2-ac-icon"><i class="fa-solid fa-suitcase" style="color:#F5DEB3;"></i></span>
      <span class="v2-ac-text">Items</span>
    </div>
    <div class="v2-u-btn v2-btn-action act-ne" data-v2-action="journal" role="button" tabindex="0" title="Journal">
      <span class="v2-ac-icon"><i class="fa-solid fa-book-open" style="color:#B0BEC5;"></i></span>
      <span class="v2-ac-text">Journal</span>
    </div>
    <div class="v2-u-btn v2-btn-action act-e" data-v2-action="settings" role="button" tabindex="0" title="Settings">
      <span class="v2-ac-icon"><i class="fa-solid fa-gear" style="color:#B0BEC5;"></i></span>
      <span class="v2-ac-text">Setup</span>
    </div>
    <div class="v2-u-btn v2-btn-action act-se" data-v2-action="camp" role="button" tabindex="0" title="Camp">
      <span class="v2-ac-icon"><i class="fa-solid fa-campground" style="color:#FF7043;"></i></span>
      <span class="v2-ac-text">Camp</span>
    </div>
    <div class="v2-u-btn v2-btn-action act-s" data-v2-action="eat" role="button" tabindex="0" title="Eat">
      <span class="v2-ac-icon"><i class="fa-solid fa-utensils" style="color:#E0E0E0;"></i></span>
      <span class="v2-ac-text">Eat</span>
    </div>
    <div class="v2-u-btn v2-btn-action act-sw" data-v2-action="heal" role="button" tabindex="0" title="Heal">
      <span class="v2-ac-icon"><i class="fa-solid fa-heart" style="color:#EF5350;"></i></span>
      <span class="v2-ac-text">Heal</span>
    </div>
    <div class="v2-u-btn v2-btn-action act-w" data-v2-action="track" role="button" tabindex="0" title="Track">
      <span class="v2-ac-icon"><i class="fa-solid fa-paw" style="color:#FFFFFF;"></i></span>
      <span class="v2-ac-text">Track</span>
    </div>
    <div class="v2-u-btn v2-btn-action act-nw" id="v2-btn-map" role="button" tabindex="0" title="Map">
      <span class="v2-ac-icon"><i class="fa-solid fa-map-location-dot" style="color:#90CAF9;"></i></span>
      <span class="v2-ac-text">Map</span>
    </div>

    <div class="v2-outer-btn res-1" data-res="stone" title="Stone">🪨<span class="v2-or-label">Stone</span><span class="v2-or-badge">0</span></div>
    <div class="v2-outer-btn res-2" data-res="wood" title="Wood">🪵<span class="v2-or-label">Wood</span><span class="v2-or-badge">0</span></div>
    <div class="v2-outer-btn res-3" data-res="berry" title="Berries">🫐<span class="v2-or-label">Berry</span><span class="v2-or-badge">0</span></div>
    <div class="v2-outer-btn res-4" data-res="arrow" title="Arrows">🏹<span class="v2-or-label">Arrow</span><span class="v2-or-badge">3</span></div>
    <div class="v2-outer-btn res-5" data-res="fish" title="Fish">🐟<span class="v2-or-label">Fish</span><span class="v2-or-badge">0</span></div>
    <div class="v2-outer-btn res-6" data-res="food" title="Food">🌽<span class="v2-or-label">Food</span><span class="v2-or-badge">0</span></div>
    <div class="v2-outer-btn res-7" data-res="hides" title="Hides">🛡️<span class="v2-or-label">Hides</span><span class="v2-or-badge">0</span></div>
    <div class="v2-outer-btn res-8" data-res="water" title="Water">💧<span class="v2-or-label">Water</span><span class="v2-or-badge">0</span></div>
      </div>
    </div>
  </div>
</div>
`;
}
