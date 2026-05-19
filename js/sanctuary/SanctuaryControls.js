/**
 * Sacred Adventures — sanctuary part 8 of N: PLAYER CONTROLS UI.
 *
 * Bottom-of-viewport control bar for the kids who'll mold this world:
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │              [ 🌍 TOP-DOWN ]                          │
 *   │              [ RESET ]   [ SAVE ]                     │
 *   └──────────────────────────────────────────────────────┘
 *                       (centred, bottom of viewport)
 *
 *   • TOP-DOWN button     — toggles top-down map view via the PIP swap
 *                            (same plumbing the v2 moondial uses; when
 *                            swapped the main canvas shows top-down,
 *                            PIP shows the chase view).
 *   • RESET button         — opens a "Are you sure?" modal that, on
 *                            confirm, wipes localStorage mold state +
 *                            tells the World mutation registry to
 *                            re-apply the baseline.
 *   • SAVE button          — serialises the world-mutation registry to
 *                            `localStorage[v4.sanctuary.save]` and
 *                            flashes a small "saved" toast.
 *
 * Anu domain: PLAYER (input + intent). The mold actions themselves are
 * ENVIRONMENT-domain when applied; this module is the UI surface.
 *
 * Visual style: warm wood-deck buttons that match the dock palette;
 * gold border-bottom accents (same gold the fishing-spot ring uses);
 * pure DOM + CSS, no canvas overhead.
 */

import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";
import { dispatchInteraction } from "../v2/anu/InteractionBus.js";
import { ANU_EVENTS } from "../v2/anu/anuEvents.js";

const SAVE_KEY = "v4.sanctuary.save";

const STYLE = `
  #v4-controls {
    position: fixed;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 9px;
    z-index: 9000;
    pointer-events: none;
    user-select: none;
    font-family: ui-monospace, Menlo, Consolas, monospace;
  }
  #v4-controls .row {
    display: flex; gap: 10px;
    pointer-events: auto;
  }
  #v4-controls button {
    pointer-events: auto;
    background: linear-gradient(180deg, rgba(40, 26, 20, 0.94), rgba(15, 10, 8, 0.97));
    border: 1px solid rgba(255, 217, 122, 0.30);
    border-bottom: 3px solid rgba(251, 192, 45, 0.65);
    border-radius: 4px;
    color: #ffe9a8;
    padding: 9px 18px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 2.4px;
    cursor: pointer;
    transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
    text-shadow: 0 1px 2px rgba(0,0,0,0.7);
    box-shadow: 0 3px 12px rgba(0,0,0,0.55);
  }
  #v4-controls button:hover {
    transform: translateY(-1px);
    border-color: rgba(255, 217, 122, 0.65);
    background: linear-gradient(180deg, rgba(60, 38, 24, 0.95), rgba(28, 18, 12, 0.99));
  }
  #v4-controls button:active { transform: translateY(0); }
  #v4-controls .btn-danger { border-bottom-color: #cc4b3a; color: #ffd0c4; }
  #v4-controls .btn-save  { border-bottom-color: #6fdf8a; color: #d6f3c8; }
  #v4-controls .btn-top   { border-bottom-color: #80deea; color: #c4eef3; }

  /* "Are you sure?" modal */
  #v4-confirm {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(4px);
    z-index: 10000;
    display: none;
    align-items: center;
    justify-content: center;
    font-family: ui-monospace, Menlo, Consolas, monospace;
  }
  #v4-confirm.open { display: flex; }
  #v4-confirm .panel {
    background: linear-gradient(180deg, rgba(40, 26, 20, 0.97), rgba(15, 10, 8, 0.99));
    border: 2px solid rgba(255, 217, 122, 0.5);
    border-radius: 8px;
    padding: 28px 36px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.75);
    max-width: 460px;
    text-align: center;
  }
  #v4-confirm h2 {
    font-size: 14px; letter-spacing: 3.6px;
    color: #ffd0c4; margin: 0 0 12px;
  }
  #v4-confirm p {
    font-size: 12px; letter-spacing: 1.5px;
    color: #d4cbb8; line-height: 1.6; margin: 0 0 22px;
  }
  #v4-confirm .actions { display: flex; gap: 14px; justify-content: center; }
  #v4-confirm button {
    background: rgba(20, 14, 10, 0.9);
    color: #ffe9a8;
    border: 1px solid rgba(255, 217, 122, 0.35);
    border-bottom: 3px solid rgba(251, 192, 45, 0.65);
    padding: 10px 22px;
    font-size: 11px; letter-spacing: 2.4px; font-weight: 800;
    border-radius: 4px;
    cursor: pointer;
    font-family: ui-monospace, Menlo, Consolas, monospace;
  }
  #v4-confirm button.confirm-yes {
    border-bottom-color: #cc4b3a;
    color: #ffd0c4;
  }

  #v4-toast {
    position: fixed;
    left: 50%; bottom: 110px;
    transform: translateX(-50%) translateY(8px);
    background: rgba(15, 28, 18, 0.94);
    border-left: 3px solid #6fdf8a;
    color: #d6f3c8;
    padding: 8px 18px;
    font-size: 11px; letter-spacing: 1.8px;
    border-radius: 4px;
    z-index: 9500;
    opacity: 0;
    transition: opacity 0.3s ease, transform 0.3s ease;
    pointer-events: none;
    font-family: ui-monospace, Menlo, Consolas, monospace;
  }
  #v4-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
`;

function ensureStylesInjected() {
  if (document.getElementById("v4-controls-style")) return;
  const s = document.createElement("style");
  s.id = "v4-controls-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

function buildDom() {
  const wrap = document.createElement("div");
  wrap.id = "v4-controls";
  // Legacy strip retired May-19 2026 — its functions now live on the
  // right-panel action ring (MAP / EAT / JOURNAL) and on a single-click
  // of the moondial PIP. The DOM nodes remain so SanctuaryControls'
  // internal wiring (toggleTopDown, save, reset) still works when
  // called via `window._v4ToggleTopDown()` etc., but the visible
  // strip is hidden so it no longer overlaps the right-panel guide
  // cards.
  wrap.style.display = "none";
  wrap.innerHTML = `
    <div class="row">
      <button id="v4-btn-top"   class="btn-top"   type="button">🌍 TOP-DOWN</button>
      <button id="v4-btn-panel" class="btn-top"   type="button">📋 PANEL</button>
      <button id="v4-btn-journal" class="btn-top" type="button">📓 JOURNAL</button>
    </div>
    <div class="row">
      <button id="v4-btn-reset" class="btn-danger" type="button">RESET</button>
      <button id="v4-btn-save"  class="btn-save"   type="button">SAVE</button>
    </div>
  `;
  document.body.appendChild(wrap);

  const confirmEl = document.createElement("div");
  confirmEl.id = "v4-confirm";
  confirmEl.innerHTML = `
    <div class="panel">
      <h2>ARE YOU SURE?</h2>
      <p>This will flatten the entire world — every hill you grew, every<br>tree you planted, every lily you placed will be reset.</p>
      <div class="actions">
        <button id="v4-confirm-cancel" type="button">CANCEL</button>
        <button id="v4-confirm-yes"    class="confirm-yes" type="button">YES, RESET</button>
      </div>
    </div>
  `;
  document.body.appendChild(confirmEl);

  const toast = document.createElement("div");
  toast.id = "v4-toast";
  toast.textContent = "saved";
  document.body.appendChild(toast);

  return { wrap, confirmEl, toast };
}

function flashToast(toast, msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toast._hideT);
  toast._hideT = setTimeout(() => toast.classList.remove("show"), 1800);
}

export const SanctuaryControlsModule = {
  name: "SanctuaryControls",

  _wrap: null,
  _confirm: null,
  _toast: null,
  _orc: null,
  _isTopDown: false,
  _camera: null,
  _savedCameraPose: null,

  async load(scene, camera, _renderer, orchestrator) {
    if (this._wrap) return;
    this._orc = orchestrator;
    this._camera = camera;

    ensureStylesInjected();
    const dom = buildDom();
    this._wrap = dom.wrap;
    this._confirm = dom.confirmEl;
    this._toast = dom.toast;
    this._wrap.userData = { anuSimulationDomain: ANU_SIMULATION_DOMAIN.PLAYER };

    // TOP-DOWN button.
    document.getElementById("v4-btn-top").addEventListener("click", () => {
      this._toggleTopDown();
    });

    // PANEL button — toggles the SacredGame.Panel.html iframe slider.
    // Also bound to the P key in index.v4.html, but kids need a visible
    // button so they can find it.
    document.getElementById("v4-btn-panel").addEventListener("click", () => {
      if (typeof window._v4TogglePanel === "function") window._v4TogglePanel();
    });

    // JOURNAL button — same idea, J-key alternative.
    document.getElementById("v4-btn-journal").addEventListener("click", () => {
      if (typeof window._v4ToggleJournal === "function") window._v4ToggleJournal();
    });

    // Panel is visible by default in v4 (left + right + guide sub-panels
    // show as part of the game UI). The PANEL button toggles it
    // off/on so kids can hide the chrome for screenshots.

    // RESET button — open confirm.
    document.getElementById("v4-btn-reset").addEventListener("click", () => {
      this._confirm.classList.add("open");
    });
    document.getElementById("v4-confirm-cancel").addEventListener("click", () => {
      this._confirm.classList.remove("open");
    });
    document.getElementById("v4-confirm-yes").addEventListener("click", () => {
      this._confirm.classList.remove("open");
      this._doReset();
    });
    // Backdrop click cancels.
    this._confirm.addEventListener("mousedown", (e) => {
      if (e.target === this._confirm) this._confirm.classList.remove("open");
    });

    // SAVE button.
    document.getElementById("v4-btn-save").addEventListener("click", () => {
      this._doSave();
    });

    // Expose toggleTopDown globally so the panel's MAP button and a
    // single-click on the moondial PIP can drive top-down view without
    // depending on the (now-hidden) legacy controls strip.
    if (typeof window !== "undefined") {
      window._v4ToggleTopDown = () => this._toggleTopDown();
    }

    console.log(
      "%c[Sanctuary] 🎛  Controls module ready (strip hidden, toggleTopDown exposed).",
      "color:#ffe9a8;font-weight:bold;",
    );
  },

  _toggleTopDown() {
    this._isTopDown = !this._isTopDown;
    if (this._isTopDown) {
      this._savedCameraPose = {
        pos: this._camera.position.clone(),
        rot: this._camera.rotation.clone(),
        fov: this._camera.fov,
      };
      // Pulled higher (default 40 m, override via SanctuaryZoom). Scroll
      // wheel publishes `window.__sanctuaryTopDownHeight`; honour that
      // if set so the toggle remembers the user's last zoom level.
      const y =
        typeof window !== "undefined" && Number.isFinite(window.__sanctuaryTopDownHeight)
          ? window.__sanctuaryTopDownHeight
          : 40;
      this._camera.position.set(0, y, 0.1);
      this._camera.lookAt(0, 0, 0);
      this._camera.fov = 60;
      this._camera.updateProjectionMatrix();
      document.body.classList.add("v4-top-down-view");
      // Arm the default mold tool — grow_hill, Anu's first verb. Future
      // tool-palette UI will swap this between grow_hill / plant_tree /
      // plant_bush / plant_lily / plant_rock.
      if (typeof window !== "undefined") {
        window.__sanctuaryMoldTool = window.SanctuaryMutations?.TOOLS?.GROW_HILL ?? "grow_hill";
      }
      flashToast(this._toast, "top-down · click to GROW A HILL · save to keep it");
    } else if (this._savedCameraPose) {
      this._camera.position.copy(this._savedCameraPose.pos);
      this._camera.rotation.copy(this._savedCameraPose.rot);
      this._camera.fov = this._savedCameraPose.fov;
      this._camera.updateProjectionMatrix();
      document.body.classList.remove("v4-top-down-view");
      // Disarm the mold tool — click reverts to walk-the-avatar.
      if (typeof window !== "undefined") window.__sanctuaryMoldTool = null;
      flashToast(this._toast, "back to chase view");
    }
  },

  _doReset() {
    try { window.localStorage.removeItem(SAVE_KEY); } catch (_) {}
    flashToast(this._toast, "world flattened — refresh to see baseline");
    try {
      dispatchInteraction(ANU_EVENTS.SANCTUARY_WORLD_STATE, { kind: "reset", size: 0 });
    } catch (_) {}
    // Pull together a future foundation hook: a WorldMutation registry
    // could call `.applyReset()` here to undo planted hills/trees/etc.
    if (typeof window !== "undefined" && window.SanctuaryMutations?.applyReset) {
      try { window.SanctuaryMutations.applyReset(); } catch (_) {}
    }
  },

  _doSave() {
    // For now, save is a stub — once mold-mode lands, the World Mutation
    // registry will publish a `.serialize()` shape that lives here.
    let payload = { v: 1, savedAt: Date.now(), mutations: [] };
    if (typeof window !== "undefined" && window.SanctuaryMutations?.serialize) {
      try { payload = { ...payload, ...window.SanctuaryMutations.serialize() }; } catch (_) {}
    }
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
      flashToast(this._toast, `saved (${payload.mutations.length} edits)`);
      dispatchInteraction(ANU_EVENTS.SANCTUARY_WORLD_STATE, {
        kind: "save",
        size: payload.mutations.length,
      });
    } catch (err) {
      flashToast(this._toast, "save failed — localStorage blocked?");
    }
  },

  update() { /* DOM-only; no per-frame work */ },

  unload() {
    if (this._wrap?.parentNode) this._wrap.parentNode.removeChild(this._wrap);
    if (this._confirm?.parentNode) this._confirm.parentNode.removeChild(this._confirm);
    if (this._toast?.parentNode) this._toast.parentNode.removeChild(this._toast);
    const styleEl = document.getElementById("v4-controls-style");
    if (styleEl?.parentNode) styleEl.parentNode.removeChild(styleEl);
    this._wrap = null;
    this._confirm = null;
    this._toast = null;
    this._orc = null;
    this._camera = null;
  },
};
