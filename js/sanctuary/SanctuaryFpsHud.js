/**
 * Sacred Adventures — SanctuaryFpsHud
 *
 * FPS display is now permanently part of the OrchestratorHud panel (top-right,
 * brown background, "SACRED ADV v2 · ORCHESTRATOR" header). That panel is the
 * single source of truth for frame rate, load bars, and universe status.
 *
 * This module is kept registered so existing index.v4.html boot code doesn't
 * break, but it creates no DOM of its own.
 */

export const SanctuaryFpsHudModule = {
  name: "SanctuaryFpsHud",

  async load() {
    // No-op: FPS is shown in OrchestratorHud.
    console.log(
      "%c[Sanctuary] 📊 SanctuaryFpsHud → OrchestratorHud is the permanent FPS panel.",
      "color:#a5d6a7;font-weight:bold;",
    );
  },

  update() {},
  unload() {},
};
