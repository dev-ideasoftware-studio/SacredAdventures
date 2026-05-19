/**
 * Sacred Adventures — sanctuary part 9 of N: WORLD-MUTATION REGISTRY.
 *
 * The foundation kids stand on when they shape this world. Each
 * recognised "tool" (grow_hill, plant_tree, plant_bush, plant_lily,
 * plant_rock) becomes a registered mutation type. When the player acts
 * in top-down mode, the active tool publishes one mutation through this
 * registry; the registry then:
 *
 *   1. Applies the visual effect (spawns mesh / lifts terrain / etc.).
 *   2. Records the mutation in a list so SAVE serialises it.
 *   3. Dispatches `ANU_EVENTS.SANCTUARY_MOLD` on the InteractionBus so
 *      Anu sees every kid edit.
 *
 * This module is the SHAPE of the mold pipeline; the actual mesh
 * spawners live alongside (`MoldGrowHill`, `MoldPlantTree`, etc.) and
 * will land in subsequent passes. For now we publish the registry
 * skeleton so SanctuaryControls SAVE/RESET can talk to a real surface.
 *
 * Anu domain: ENVIRONMENT (every mutation is environment-state change).
 */

import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";
import { dispatchInteraction } from "../v2/anu/InteractionBus.js";
import { ANU_EVENTS } from "../v2/anu/anuEvents.js";

/** Known tool ids — Anu's "mold verb" vocabulary. */
export const SANCTUARY_MOLD_TOOLS = Object.freeze({
  GROW_HILL: "grow_hill",
  PLANT_TREE: "plant_tree",
  PLANT_BUSH: "plant_bush",
  PLANT_LILY: "plant_lily",
  PLANT_ROCK: "plant_rock",
  PLACE_TIPI: "place_tipi",
});

let _scene = null;
let _mutations = []; // [{ id, tool, x, z, payload, mesh? }]
let _handlers = {};   // tool → (mutation) => void  — populated by future modules

function _nextId() {
  return "mut_" + Math.random().toString(36).slice(2, 10);
}

function applyMutation(mut) {
  const handler = _handlers[mut.tool];
  if (typeof handler === "function") {
    try { handler(mut, _scene); } catch (err) {
      console.warn(`[SanctuaryMutations] handler '${mut.tool}' failed:`, err);
    }
  } else {
    // No handler yet — log so the future module landing this tool can
    // confirm the registry surface is reaching it.
    console.log(
      `%c[SanctuaryMutations] '${mut.tool}' queued (no handler yet) at (${mut.x.toFixed(2)}, ${mut.z.toFixed(2)})`,
      "color:#aaa;",
    );
  }
}

/**
 * Register a handler for one tool. Future modules call this from their
 * `load()` so the registry knows how to materialise their mesh.
 */
function registerToolHandler(tool, handlerFn) {
  if (typeof handlerFn !== "function") return;
  _handlers[tool] = handlerFn;
}

/**
 * Apply a mutation at runtime — used by the (future) top-down mold UI
 * + by `_replayAll()` on load.
 */
function publish(tool, x, z, payload = {}) {
  const mut = { id: _nextId(), tool, x, z, payload, t: Date.now() };
  _mutations.push(mut);
  applyMutation(mut);
  try {
    dispatchInteraction(ANU_EVENTS.SANCTUARY_MOLD, {
      tool, x, z, payload, id: mut.id,
    });
  } catch (_) {}
  return mut;
}

function serialize() {
  return { mutations: _mutations.map(({ mesh, ...m }) => m) };
}

function loadFromStorage() {
  try {
    const raw = window.localStorage?.getItem("v4.sanctuary.save");
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.mutations)) return false;
    _mutations = [];
    for (const m of data.mutations) {
      if (!m?.tool || typeof m.x !== "number" || typeof m.z !== "number") continue;
      const restored = { ...m, id: m.id ?? _nextId() };
      _mutations.push(restored);
      applyMutation(restored);
    }
    console.log(
      `%c[SanctuaryMutations] restored ${_mutations.length} mutations from save.`,
      "color:#a5d6a7;",
    );
    return true;
  } catch (err) {
    console.warn("[SanctuaryMutations] restore failed:", err);
    return false;
  }
}

function applyReset() {
  // Strip every spawned mesh from the scene; clear the registry.
  for (const mut of _mutations) {
    if (mut.mesh && _scene) {
      try { _scene.remove(mut.mesh); } catch (_) {}
      mut.mesh.traverse?.((o) => {
        if (o.geometry) o.geometry.dispose?.();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((mm) => mm.dispose?.());
          else o.material.dispose?.();
        }
      });
    }
  }
  _mutations = [];
}

export const SanctuaryMutationsModule = {
  name: "SanctuaryMutations",

  async load(scene) {
    _scene = scene;
    // Expose the surface on `window` so SanctuaryControls + future
    // mold-tool modules can register handlers / publish without
    // import cycles.
    if (typeof window !== "undefined") {
      window.SanctuaryMutations = Object.freeze({
        publish,
        registerToolHandler,
        serialize,
        applyReset,
        list: () => _mutations.slice(),
        TOOLS: SANCTUARY_MOLD_TOOLS,
        domain: ANU_SIMULATION_DOMAIN.ENVIRONMENT,
      });
    }
    // Replay any saved mutations from a previous session.
    loadFromStorage();
    console.log(
      "%c[Sanctuary] 🌱 Mutation registry online — kids can shape this world.",
      "color:#a5d6a7;font-weight:bold;",
    );
  },

  update() { /* no per-frame work — handlers run on publish */ },

  unload() {
    if (typeof window !== "undefined") {
      try { delete window.SanctuaryMutations; } catch (_) {}
    }
    _scene = null;
    _mutations = [];
    _handlers = {};
  },
};
