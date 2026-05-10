/**
 * Sacred Adventures v2 — Fauna (wildlife) orchestrator stub.
 * Register in boot; activate when wildlife meshes / AI / physics are wired.
 */

export const FaunaModule = {
  name: "Fauna",

  load(_scene, _camera, _renderer, _orchestrator) {
    console.log(
      "%c[Fauna] Module registered — placeholder until wildlife system is restored (FAUNA_TICK, meshes, WorldPhysics).",
      "color:#ce93d8;font-weight:bold;",
    );
  },

  unload() {
    console.log("%c[Fauna] Unloaded.", "color:#999;");
  },

  update() {},
};
