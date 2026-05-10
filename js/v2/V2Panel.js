/**
 * Sacred Adventures v2 — touch/control panels (legacy 1:1 styling + Three.js guide icons).
 *
 * Layout/CSS ported from `SacredOnes.1/public/SacredGame.Panel.html` + `Component.Panel.Sides.html`:
 *  - Left: neumorphic movement keypad + center jump
 *  - Center-bottom: guide cards (Quest / Gather / Fish / Observe / Log) + `Component.ThreeIcons.js`
 *  - Right: avatar + radial actions + resource ring
 */

import * as THREE_MODULE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { GLTFLoaderWithDraco } from "./gltfLoaderSetup.js";

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
  if (document.getElementById("v2-fa")) return;
  const l = document.createElement("link");
  l.id = "v2-fa";
  l.rel = "stylesheet";
  l.href = FA_URL;
  document.head.appendChild(l);
}

/** Legacy panel cards use Lato for descriptions / titles */
function ensureLato() {
  if (document.getElementById("v2-font-lato")) return;
  const l = document.createElement("link");
  l.id = "v2-font-lato";
  l.rel = "stylesheet";
  l.href =
    "https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,400;0,700;0,900;1,400&display=swap";
  document.head.appendChild(l);
}

function ensureNunito() {
  if (document.getElementById("v2-font-nunito")) return;
  const l = document.createElement("link");
  l.id = "v2-font-nunito";
  l.rel = "stylesheet";
  l.href =
    "https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800&display=swap";
  document.head.appendChild(l);
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
  const url = new URL("../../Component.ThreeIcons.js", import.meta.url).href;
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

export const V2PanelModule = {
  name: "V2Panel",

  _root: null,
  _onGuideMouseMove: null,
  _iconsStarted: false,

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
    window.icons = new window.ThreeIconManager();

    const register = (id, type) => {
      window.icons.createIcon(id, type);
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
    const map = {
      "card-quest-btn": "quest",
      "card-gather-btn": "gather",
      "card-fish-btn": "fish",
      "card-search-btn": "observe",
      "card-log-btn": "log",
    };

    Object.entries(map).forEach(([id, card]) => {
      const el = this._root.querySelector(`#${id}`);
      if (!el) return;
      const fire = () => {
        window.dispatchEvent(
          new CustomEvent("v2-guide-card", { detail: { card } }),
        );
        window.dispatchEvent(
          new CustomEvent("v2-guide", { detail: { id: card } }),
        );
      };
      el.addEventListener("click", (e) => {
        e.preventDefault();
        fire();
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fire();
        }
      });
    });
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

  update() {},

  unload() {
    if (this._onGuideMouseMove) {
      document.removeEventListener("mousemove", this._onGuideMouseMove);
      this._onGuideMouseMove = null;
    }
    try {
      if (window.icons && window.icons.renderer?.domElement?.parentNode) {
        window.icons.renderer.domElement.remove();
      }
    } catch (_e) {}
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
  --panel-size: 220px;
  --btn-size: 55px;
  --panel-offset: 20px;
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

/* LEFT — neumorphic clay keypad */
#v2-left-panel {
  position: absolute;
  bottom: var(--panel-offset);
  left: var(--panel-offset);
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

/* ── CENTER STACK — 1:1 SacredGame.Panel guide strip ── */
#v2-center-stack {
  position: absolute;
  bottom: 1%;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 20px;
  z-index: 2;
  pointer-events: none;
  width: 100%;
  max-width: min(520px, max(260px, calc(100vw - 32px)));
}

#guides-container {
  display: flex;
  justify-content: center;
  gap: 15px;
  pointer-events: auto;
  width: 100%;
}

.guide-card {
  width: clamp(50px, 10vh, 90px);
  height: clamp(50px, 10vh, 90px);
  border-radius: clamp(8px, 1.5vh, 14px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: relative;
  text-align: center;
  color: white;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
  transition: transform 0.2s, box-shadow 0.2s;
  border: 2px solid rgba(255, 255, 255, 0.2);
  padding: clamp(4px, 1vw, 8px);
  overflow: visible;
  background: rgba(0, 0, 0, 0.4);
  gap: 4px;
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
  width: clamp(24px, 4vh, 42px);
  height: clamp(24px, 4vh, 42px);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  box-shadow:
    inset 0 4px 8px rgba(0, 0, 0, 0.6),
    inset 0 0 12px rgba(0, 0, 0, 0.35),
    0 2px 6px rgba(0, 0, 0, 0.4);
  border: 0.5px solid rgba(255, 255, 255, 0.1);
  position: relative;
  z-index: 10;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 5px auto;
}

.card-desc,
.card-title {
  z-index: 12;
  pointer-events: none;
  font-family: Lato, sans-serif;
}

.card-desc {
  font-style: italic;
  font-size: clamp(6px, 1vw, 9px);
  opacity: 0.9;
  margin-bottom: 4px;
  line-height: 1.1;
}

.card-title {
  font-weight: 900;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
  position: relative;
  margin-top: 2px;
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

/* RIGHT — neumorphic earth radial tray */
#v2-right-panel {
  position: absolute;
  bottom: var(--panel-offset);
  right: var(--panel-offset);
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
  overflow: hidden;
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
.v2-avatar-circle .v2-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
  display: block;
}
.v2-level-badge {
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  background: #3e2723;
  color: var(--color-gold);
  border: 1px solid var(--color-gold);
  width: 26px;
  height: 26px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 55;
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

@media (max-width: 1100px) {
  #v2-center-stack {
    max-width: min(380px, calc(100vw - 24px));
    bottom: 12px;
  }
  #guides-container {
    gap: 8px;
    flex-wrap: wrap;
  }
  .guide-card {
    width: 54px;
    height: 56px;
    padding: 2px;
    gap: 0;
  }
  .card-desc { display: none; }
  .card-icon-3d {
    width: 34px;
    height: 34px;
    margin: 0 auto;
  }
  .card-title {
    font-size: 8px;
    position: absolute;
    bottom: 3px;
    width: 100%;
    left: 0;
    margin: 0;
    line-height: 1;
  }
}

@media (max-width: 900px) {
  #v2-panel-root {
    --panel-size: 160px;
    --btn-size: 44px;
    --panel-offset: 14px;
  }
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

<div class="v2-surface" id="v2-left-panel">
  <div id="v2-keypad-container">
    <div class="v2-u-btn v2-btn-move pos-n v2-ctrl" data-key="w" role="button" tabindex="0" aria-label="Forward">
      <i class="fa-solid fa-caret-up"></i>
    </div>
    <div class="v2-u-btn v2-btn-move pos-w v2-ctrl" data-key="a" role="button" tabindex="0" aria-label="Strafe left">
      <i class="fa-solid fa-caret-left"></i>
    </div>
    <div class="v2-kp-center-btn v2-ctrl" data-key=" " role="button" tabindex="0" aria-label="Jump">
      <i class="fa-solid fa-up-long"></i>
    </div>
    <div class="v2-u-btn v2-btn-move pos-e v2-ctrl" data-key="d" role="button" tabindex="0" aria-label="Strafe right">
      <i class="fa-solid fa-caret-right"></i>
    </div>
    <div class="v2-u-btn v2-btn-move pos-s v2-ctrl" data-key="s" role="button" tabindex="0" aria-label="Back">
      <i class="fa-solid fa-caret-down"></i>
    </div>
  </div>
</div>

<div id="v2-center-stack" class="v2-surface">
  <div id="guides-container">
    <div class="guide-card card-quest quest-highlight" id="card-quest-btn" role="button" tabindex="0"
      aria-label="Quests: Follow path">
      <div id="icon-quest" class="card-icon-3d"></div>
      <div class="card-desc" id="desc-quest">Follow path</div>
      <div class="card-title">Quests</div>
    </div>
    <div class="guide-card card-gather" id="card-gather-btn" role="button" tabindex="0" aria-label="Gather resources">
      <div id="icon-gather" class="card-icon-3d"></div>
      <div class="card-desc">Collect resources</div>
      <div class="card-title">Gather</div>
    </div>
    <div class="guide-card card-fish" id="card-fish-btn" role="button" tabindex="0" aria-label="Fish">
      <div id="icon-fish" class="card-icon-3d"></div>
      <div class="card-desc">Catch fish</div>
      <div class="card-title">Fish</div>
    </div>
    <div class="guide-card card-search" id="card-search-btn" role="button" tabindex="0" aria-label="Observe">
      <div id="icon-search" class="card-icon-3d"></div>
      <div class="card-desc">Look closely</div>
      <div class="card-title">Observe</div>
    </div>
    <div class="guide-card card-log" id="card-log-btn" role="button" tabindex="0" aria-label="Journal">
      <div id="icon-log" class="card-icon-3d"></div>
      <div class="card-desc">Your story</div>
      <div class="card-title">Journal</div>
    </div>
  </div>
</div>

<div class="v2-surface" id="v2-right-panel">
  <div id="v2-action-zone" class="v2-circle-panel">
    <div class="v2-orbit-track"></div>
    <div class="v2-outer-ring"></div>

    <div class="v2-avatar-circle" id="v2-avatar-hit" title="Hero">
      <span class="v2-level-badge">1</span>
      <div class="v2-avatar-img" style="background: linear-gradient(160deg,#5d4037,#1b120e);"></div>
    </div>

    <div class="v2-u-btn v2-btn-action act-n" id="v2-btn-items" role="button" tabindex="0" title="Inventory">
      <span class="v2-ac-icon"><i class="fa-solid fa-suitcase" style="color:#F5DEB3;"></i></span>
      <span class="v2-ac-text">Items</span>
    </div>
    <div class="v2-u-btn v2-btn-action act-ne" data-v2-action="log" role="button" tabindex="0" title="Log">
      <span class="v2-ac-icon"><i class="fa-solid fa-book-open" style="color:#B0BEC5;"></i></span>
      <span class="v2-ac-text">Log</span>
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
`;
}
