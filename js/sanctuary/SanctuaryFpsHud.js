/**
 * Sacred Adventures — sanctuary part 33 of N: tree-toggle CTA.
 *
 * Originally hosted the standalone #v4-fps-hud pill alongside the
 * tree-toggle button. The pill read from `getFrameBudgetSnapshot()`
 * (render-call cost) while OrchestratorHud's #v2-fps read from
 * `orc.smoothFPS` (actual frame rate) — same word "FPS", different
 * sensors, divergent readings (e.g. headless: 333 vs 30). To stop
 * the confusion, the pill was retired and OrchestratorHud is now
 * the single source of truth for on-screen FPS.
 *
 * What remains here: the top-middle glassmorphic "🌲 TREES …" toggle
 * button. The module name (SanctuaryFpsHud) is preserved so the
 * orchestrator's module list and any saved layouts don't break.
 */

export const SanctuaryFpsHudModule = {
  name: "SanctuaryFpsHud",

  _toggleBtn: null,

  async load(scene, camera, renderer) {
    if (typeof document === "undefined") return;

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
      "%c[Sanctuary] 🌲 Tree Toggle CTA online (top-middle). FPS now shown in OrchestratorHud only.",
      "color:#a5d6a7;font-weight:bold;",
    );
  },

  unload() {
    if (this._toggleBtn?.parentElement) this._toggleBtn.parentElement.removeChild(this._toggleBtn);
    this._toggleBtn = null;
  },
};
