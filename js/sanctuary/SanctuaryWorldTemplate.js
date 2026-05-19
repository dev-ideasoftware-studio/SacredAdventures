/**
 * Sacred Adventures — KID WORLD TEMPLATE.
 *
 * Copy this file, rename the export + the `name` field, and you have a
 * brand-new world module that plugs into the same Anu / PIP / Panel /
 * Journal pipeline every other sanctuary module uses. The orchestrator
 * picks it up the moment you `register()` + `activate()` it.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  THE FIVE THINGS EVERY KID WORLD KNOWS                          │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  1. WHERE IT LIVES — Anu domain it owns (one of the 8 below).   │
 * │  2. WHAT IT BUILDS  — meshes/groups it adds to the scene at load.│
 * │  3. WHAT IT DOES    — per-frame work in update(delta).          │
 * │  4. HOW IT TALKS    — Anu InteractionBus events it dispatches.  │
 * │  5. HOW IT CLEANS UP — meshes + globals removed on unload.      │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * The 8 Anu domains your world can claim (pick ONE per module):
 *   PLAYER       — the witness body: camera, input, intent.
 *   ENVIRONMENT  — the ground / sky / atmosphere all bodies obey.
 *   FLORA        — rooted life: trees, plants, harvestable groves.
 *   FAUNA        — moving non-player life: wildlife, herds, threats.
 *   STRUCTURES   — built world: homes, doors, village objects.
 *   POPULATION   — people + spirits: NPC bodies, dialogue, memory.
 *   ITEMS        — held / found things: tools, loot, journals.
 *   UNSPECIFIED  — Anu's "unclaimed matter" bucket (DO NOT use).
 *
 * Anu's 6 interaction verbs your world can mark meshes with:
 *   inspect · harvest · talk · enter · pick_up · use
 *
 * ── HOW THIS HOOKS INTO PIP / PANEL / JOURNAL ──────────────────────
 *
 *   PIP minimap   — anything you add to the scene with proper Anu
 *                    tags appears in the top-down minimap automatically.
 *                    No extra plumbing — it's the same `scene` instance.
 *
 *   Panel         — the SacredGame.Panel iframe listens for postMessage
 *                    events of shape `{ type, ...payload }`. To surface
 *                    state from your world to the panel, dispatch via
 *                    `window.postMessage({ type: 'YOUR_EVENT', … }, '*')`
 *                    or subscribe to the panel's messages and respond.
 *
 *   Journal       — same iframe pattern. Send `{ type: 'INSERT_LOG_PAGE',
 *                    payload: { title, body } }` to drop a page into the
 *                    journal log tab when your kid does something
 *                    noteworthy in your world.
 *
 *   Anu bus       — `dispatchInteraction(ANU_EVENTS.SOMETHING, detail)`
 *                    publishes a typed event Anu records. Add new event
 *                    types in `js/v2/anu/anuEvents.js` if you need them.
 *
 *   Mutations     — to make your world MOLDABLE (kids click in
 *                    top-down to spawn things), register a tool handler
 *                    against `window.SanctuaryMutations`:
 *
 *                       window.SanctuaryMutations.registerToolHandler(
 *                         "my_tool_id",
 *                         (mutation, sceneRef) => {
 *                           const mesh = buildMyThing(mutation, sceneRef);
 *                           mutation.mesh = mesh;  // so RESET can dispose
 *                         },
 *                       );
 *
 *                    Then add a tile to SanctuaryToolPalette.TOOLS for
 *                    the kid-facing icon + label.
 *
 * ── HOW TO USE THIS FILE ───────────────────────────────────────────
 *
 *   1. Copy this file to `js/sanctuary/<YourWorld>.js`.
 *   2. Rename `MyKidWorldModule` to `YourWorldModule` and update `.name`.
 *   3. Implement `load()` — add your meshes to the scene.
 *   4. Implement `update(delta)` — anything that moves each frame.
 *   5. Implement `unload(scene)` — remove your meshes when deactivated.
 *   6. In `index.v4.html`:
 *        import { YourWorldModule } from './js/sanctuary/YourWorld.js';
 *        orc.register(YourWorldModule);
 *        await orc.activate('YourWorldName');
 *
 * That's it. Your world is now Anu-governed, PIP-visible, journal-ready,
 * panel-talkative, and saved/restored alongside every other mutation.
 */

import * as THREE from "three";
import {
  ANU_SIMULATION_DOMAIN,
  ANU_INTERACTION_VERB,
} from "../v2/anu/SimulationController.js";
import { dispatchInteraction } from "../v2/anu/InteractionBus.js";
import { ANU_EVENTS } from "../v2/anu/anuEvents.js";
import { sanctuaryGroundY } from "./SanctuaryGround.js";

/**
 * One example custom event so you can see how Anu's interaction bus
 * picks up your world's state changes. Add new event names in
 * `js/v2/anu/anuEvents.js` if you need typed channels for telemetry.
 */
const YOUR_WORLD_EVENT = ANU_EVENTS.SANCTUARY_WORLD_STATE; // reuse or add your own

export const MyKidWorldModule = {
  /**
   * STABLE IDENTIFIER. Used by `orchestrator.activate(name)` and shows
   * up in `AnuUniverse.audit()` / HUD module list. Rename it.
   */
  name: "MyKidWorld",

  // ── private fields — keep these prefixed with `_` ─────────────────
  _scene: null,
  _root: null,        // single THREE.Group your world adds to the scene
  _elapsed: 0,        // frame-accumulated time, useful for animation

  /**
   * Called once when `orc.activate('MyKidWorld')` runs. Anu binds the
   * scene + camera + renderer + the live orchestrator shell so you can
   * read frame state if you need to.
   *
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} orchestrator   // window.anuOrchestrator
   */
  async load(scene, camera, renderer, orchestrator) {
    if (this._root) return; // idempotent — guard against double-activate
    this._scene = scene;

    // ── 1. Build a root Group with PROPER Anu tags. ─────────────────
    // The root carries the canonical domain + identity. Anu reads
    // `userData.anuSimulationDomain` first; if absent she falls back
    // to name-pattern inference — but it's nicer to be explicit.
    const root = new THREE.Group();
    root.name = "my_kid_world_root";
    root.userData.anuId = "environment.my_kid_world.root";
    root.userData.anuKind = "my_kid_world_root";
    root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT; // <- pick yours
    root.userData.anuInteractable = true;
    root.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.INSPECT];

    // ── 2. Add geometry / materials / whatever your world is. ───────
    // Procedural shapes are cheap + saved-state-friendly. Use
    // InstancedMesh for repeated decorations to keep draw calls low.
    const exampleMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.6, 1),
      new THREE.MeshStandardMaterial({
        color: 0xaaccff,
        roughness: 0.8,
        metalness: 0.0,
        flatShading: true,
      }),
    );
    exampleMesh.name = "my_kid_world_orb";
    exampleMesh.userData.anuKind = "my_kid_world_orb";
    exampleMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    // Park it on the shared sanctuary terrain so it sits at ground level.
    const x = 6, z = -10;
    exampleMesh.position.set(x, sanctuaryGroundY(x, z) + 0.7, z);
    root.add(exampleMesh);

    scene.add(root);
    this._root = root;

    // ── 3. (Optional) Register a mold-tool handler so kids can ──────
    // place instances of your world's signature object via clicks.
    if (typeof window !== "undefined" && window.SanctuaryMutations?.registerToolHandler) {
      window.SanctuaryMutations.registerToolHandler("my_kid_world_drop", (mut, sceneRef) => {
        // mut = { id, tool, x, z, payload, t } — Anu InteractionBus
        // already announced the action; here we materialise the mesh.
        const orb = exampleMesh.clone();
        orb.position.set(mut.x, sanctuaryGroundY(mut.x, mut.z) + 0.7, mut.z);
        sceneRef.add(orb);
        mut.mesh = orb; // important — RESET / unload uses this to clean up
      });
    }

    // ── 4. (Optional) Tell the panel / journal about you. ───────────
    // Both run in iframes and listen for postMessage of `{ type, ... }`.
    try {
      window.postMessage(
        { type: "MY_KID_WORLD_HELLO", from: "MyKidWorld", at: Date.now() },
        "*",
      );
    } catch (_) {}

    // ── 5. Announce on the Anu InteractionBus that you're online. ────
    try {
      dispatchInteraction(YOUR_WORLD_EVENT, {
        kind: "load",
        worldName: this.name,
      });
    } catch (_) {}

    console.log(
      `%c[${this.name}] world online — ${this._root.children.length} pieces added.`,
      "color:#a5d6a7;font-weight:bold;",
    );
  },

  /**
   * Called every frame with the seconds since the previous frame. Keep
   * this CHEAP. If your world has skeleton/animation work, gate it on
   * a stride (e.g. only every 6 frames) to keep Anu's adaptive DPR
   * governor happy.
   *
   * @param {number} delta  // seconds since last frame
   */
  update(delta) {
    if (!this._root) return;
    this._elapsed += delta;
    // Example: bob the example orb gently up/down.
    const orb = this._root.children[0];
    if (orb) {
      orb.position.y += Math.sin(this._elapsed * 1.4) * delta * 0.4;
    }
  },

  /**
   * Called when `orc.deactivate('MyKidWorld')` runs. Anu wants:
   *   • All meshes you added removed from the scene.
   *   • Geometries + materials disposed.
   *   • Any window globals you wrote deleted.
   *   • Any mold-tool handlers you registered torn down (optional —
   *     the registry will overwrite when a new handler claims the slot).
   */
  unload(scene) {
    if (!this._root) return;
    scene.remove(this._root);
    this._root.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
        else o.material.dispose?.();
      }
    });
    this._root = null;
    this._scene = null;
    try {
      dispatchInteraction(YOUR_WORLD_EVENT, {
        kind: "unload",
        worldName: this.name,
      });
    } catch (_) {}
  },
};
