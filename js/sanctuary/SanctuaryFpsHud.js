/**
 * Sacred Adventures — sanctuary part 33 of N: FPS HUD.
 *
 * Tiny top-right HUD pill that shows live FPS + current DPR so we
 * can answer the "are we at 120?" question without opening the dev
 * console.
 *
 * Reads from Anu's `getFrameBudgetSnapshot()` (the same sensor
 * AnuAdaptiveDpr uses, so the two stay coherent — if Adaptive sees
 * 95 FPS, the HUD will say 95). DPR is read from the renderer on
 * each refresh (Anu writes it through `renderer.setPixelRatio` so
 * the HUD reflects the actual current ratio after up/down ladders).
 *
 * Visual rules — colour-codes the FPS number:
 *   ≥ 115  → green     (at target)
 *   ≥ 90   → yellow    (acceptable)
 *   ≥ 60   → orange    (degraded)
 *   < 60   → red       (struggling)
 *
 * Refresh rate: every 250 ms so the digits don't flicker. The
 * underlying rolling average already smooths frame-to-frame jitter.
 */

import { getFrameBudgetSnapshot } from "../v2/anu/FrameBudget.js";

const REFRESH_MS = 250;

function _color(fps) {
  if (fps >= 115) return "#a5d6a7";
  if (fps >= 90) return "#fff59d";
  if (fps >= 60) return "#ffb74d";
  return "#ef9a9a";
}

export const SanctuaryFpsHudModule = {
  name: "SanctuaryFpsHud",

  _el: null,
  _fpsEl: null,
  _dprEl: null,
  _toggleBtn: null,
  _timer: 0,
  _renderer: null,

  async load(scene, camera, renderer) {
    this._renderer = renderer ?? null;

    if (typeof document === "undefined") return;
    const el = document.createElement("div");
    el.id = "v4-fps-hud";
    Object.assign(el.style, {
      position: "fixed",
      top: "12px",
      right: "12px",
      zIndex: "5200",
      padding: "6px 10px",
      borderRadius: "8px",
      background: "rgba(14, 22, 18, 0.78)",
      color: "#e6f0d8",
      font: "600 12px/1.1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      letterSpacing: "0.04em",
      border: "1px solid rgba(251, 192, 45, 0.32)",
      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.35)",
      pointerEvents: "none",
      userSelect: "none",
      backdropFilter: "blur(4px)",
    });
    el.innerHTML = `
      <span style="opacity:0.62">FPS</span>
      <span id="v4-fps-hud-fps" style="color:#a5d6a7;font-weight:700;font-size:13px;margin-left:4px">--</span>
      <span style="opacity:0.30;margin:0 6px">·</span>
      <span style="opacity:0.62">DPR</span>
      <span id="v4-fps-hud-dpr" style="opacity:0.88;margin-left:4px">--</span>
    `;
    document.body.appendChild(el);
    this._el = el;
    this._fpsEl = document.getElementById("v4-fps-hud-fps");
    this._dprEl = document.getElementById("v4-fps-hud-dpr");

    // Create the top-middle glassmorphic CTA toggle button
    const btn = document.createElement("button");
    btn.id = "v4-tree-toggle-cta";
    Object.assign(btn.style, {
      position: "fixed",
      top: "12px",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: "9500",
      padding: "8px 16px",
      borderRadius: "8px",
      font: "700 11px/1.1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      letterSpacing: "0.08em",
      cursor: "pointer",
      pointerEvents: "auto",
      userSelect: "none",
      backdropFilter: "blur(8px)",
      boxShadow: "0 4px 14px rgba(0, 0, 0, 0.45)",
      textShadow: "0 1px 2px rgba(0, 0, 0, 0.5)",
      outline: "none",
      transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
    });

    const updateToggleCtaUI = () => {
      const hidden = typeof window !== "undefined" && !!window.__sanctuaryTreesHidden;
      if (hidden) {
        btn.style.background = "linear-gradient(180deg, rgba(239, 83, 80, 0.22), rgba(198, 40, 40, 0.48))";
        btn.style.border = "1px solid rgba(239, 83, 80, 0.42)";
        btn.style.borderBottom = "3px solid rgba(229, 57, 53, 0.75)";
        btn.style.color = "#ffcdd2";
        btn.innerHTML = `🌲 TREES HIDDEN FOR FPS <span style="opacity:0.5;margin:0 4px">·</span> <span style="color:#fff2c4;text-decoration:underline">CLICK TO SHOW & TEST</span>`;
      } else {
        btn.style.background = "linear-gradient(180deg, rgba(102, 187, 106, 0.22), rgba(46, 125, 50, 0.48))";
        btn.style.border = "1px solid rgba(102, 187, 106, 0.42)";
        btn.style.borderBottom = "3px solid rgba(67, 160, 71, 0.75)";
        btn.style.color = "#e8f5e9";
        btn.innerHTML = `🌲 TREES RENDERED (HEAVY) <span style="opacity:0.5;margin:0 4px">·</span> <span style="color:#fff2c4;text-decoration:underline">CLICK TO HIDE & SPEED UP</span>`;
      }
    };

    // Hover and active micro-animations
    btn.addEventListener("mouseenter", () => {
      btn.style.transform = "translateX(-50%) scale(1.04)";
      btn.style.boxShadow = "0 6px 20px rgba(0, 0, 0, 0.6)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "translateX(-50%) scale(1.0)";
      btn.style.boxShadow = "0 4px 14px rgba(0, 0, 0, 0.45)";
    });
    btn.addEventListener("mousedown", () => {
      btn.style.transform = "translateX(-50%) scale(0.96)";
    });
    btn.addEventListener("mouseup", () => {
      btn.style.transform = "translateX(-50%) scale(1.04)";
    });

    btn.addEventListener("click", () => {
      if (typeof window !== "undefined") {
        window.__sanctuaryTreesHidden = !window.__sanctuaryTreesHidden;
        updateToggleCtaUI();
        console.log(`[Sanctuary] Tree visibility toggled. Hidden: ${window.__sanctuaryTreesHidden}`);
      }
    });

    updateToggleCtaUI();
    document.body.appendChild(btn);
    this._toggleBtn = btn;

    console.log(
      "%c[Sanctuary] 📊 FPS HUD online (top-right) & Tree Toggle CTA online (top-middle).",
      "color:#a5d6a7;font-weight:bold;",
    );
  },

  update(delta) {
    this._timer += delta;
    if (this._timer < REFRESH_MS / 1000) return;
    this._timer = 0;
    if (!this._fpsEl) return;

    const snap = getFrameBudgetSnapshot();
    const ms = snap.avgMs > 0 ? snap.avgMs : snap.lastMs;
    const fps = ms > 0 ? Math.min(999, Math.round(1000 / ms)) : 0;
    this._fpsEl.textContent = fps.toString();
    this._fpsEl.style.color = _color(fps);

    if (this._dprEl) {
      const dpr =
        this._renderer?.getPixelRatio?.() ??
        (typeof window !== "undefined" ? window.devicePixelRatio : 1);
      this._dprEl.textContent = (dpr ?? 1).toFixed(2) + "x";
    }
  },

  unload() {
    if (this._el?.parentElement) this._el.parentElement.removeChild(this._el);
    if (this._toggleBtn?.parentElement) this._toggleBtn.parentElement.removeChild(this._toggleBtn);
    this._el = null;
    this._fpsEl = null;
    this._dprEl = null;
    this._toggleBtn = null;
    this._renderer = null;
  },
};
