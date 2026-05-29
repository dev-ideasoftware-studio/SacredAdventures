/**
 * Sacred Adventures v2 — Maps registry.
 *
 * Each entry is a snapshot of the dialled terrain + colour + flora
 * parameters that produce a distinct sanctuary look. The active map id
 * is persisted to `localStorage` under `v2.maps.activeId` so it
 * survives page reloads; `window._v2SetMap(id)` swaps and reloads.
 *
 * Module responsibilities reading from the active map:
 *   • `WorldTerrain.terrainY` — bowl + hill + mountain heights.
 *   • `World.js` per-vertex colour pass — meadow / hill / mountain /
 *     snow tinting bands.
 *   • Future: build-mode placement bounds, allowed building counts,
 *     seed-growth tree-mix overrides.
 *
 * Pond centre + tipi anchors stay world-constant for now so the
 * existing structure / fishing / fauna modules don't need re-wiring
 * per map. Subsequent passes can lift those into MapsConfig once
 * build-mode owns placement.
 *
 * **Adding a new map**: copy a preset block, change `id` + `name`,
 * retune the numbers, append to `MAPS`. The picker UI walks the
 * registry so it picks up new entries automatically.
 */

/**
 * @typedef {Object} MapDef
 * @property {string} id           Stable key (used in localStorage).
 * @property {string} name         Display name for the picker.
 * @property {string} blurb        One-line summary shown on hover.
 * @property {Object} terrain
 * @property {number} terrain.CLEARING_R     Flat valley floor radius (m).
 * @property {number} terrain.HILL_INNER     Hill band inner radius (m).
 * @property {number} terrain.HILL_OUTER     Hill band outer radius (m).
 * @property {number} terrain.HILL_HEIGHT    Hill peak height (m).
 * @property {number} terrain.MOUNTAIN_INNER Outer mountain band inner (m).
 * @property {number} terrain.MOUNTAIN_OUTER Outer mountain band outer (m).
 * @property {number} terrain.MOUNTAIN_HEIGHT Mountain peak height (m).
 * @property {number} terrain.WORLD_EDGE_M   Past this, the cliff drop begins.
 * @property {Object} palette
 * @property {[number,number,number]} palette.hill         Olive blend RGB.
 * @property {[number,number,number]} palette.mountain     Pine blend RGB.
 * @property {[number,number,number]} palette.cliff        Cliff slate RGB.
 * @property {{ snowLineM: number, snow: [number,number,number] } | null} palette.snowCap
 * @property {number} palette.fogNear
 * @property {number} palette.fogFar
 * @property {number} palette.fogColor       0xRRGGBB
 * @property {Object} flora
 * @property {number} flora.maxTreeInstances Tree count cap (overrides constants if present).
 * @property {number} flora.treeHeightM      Tree target height.
 * @property {boolean} flora.snowyTrees      Tint trees toward frosted-pine when true.
 */

/** @type {Record<string, MapDef>} */
const MAPS = Object.freeze({
  scene0: Object.freeze({
    id: "scene0",
    name: "Hidden Valley Sanctuary",
    blurb:
      "Wide valley, gentle hill ring, mountain ridge horizon. The map you've been playing.",
    terrain: Object.freeze({
      CLEARING_R: 55,
      HILL_INNER: 55,
      HILL_OUTER: 90,
      HILL_HEIGHT: 9.0,
      MOUNTAIN_INNER: 90,
      MOUNTAIN_OUTER: 118,
      MOUNTAIN_HEIGHT: 24.0,
      WORLD_EDGE_M: 118,
    }),
    palette: Object.freeze({
      hill: Object.freeze([0.74, 0.78, 0.55]),
      mountain: Object.freeze([0.42, 0.52, 0.38]),
      cliff: Object.freeze([0.22, 0.30, 0.26]),
      snowCap: null,
      fogNear: 90,
      fogFar: 160,
      fogColor: 0xb4cfe2,
    }),
    flora: Object.freeze({
      maxTreeInstances: 260,
      treeHeightM: 5.5,
      snowyTrees: false,
    }),
  }),

  scene1: Object.freeze({
    id: "scene1",
    name: "Sacred Grove",
    blurb:
      "Tight wooded valley. Pond off-centre. Steep walls, no mountains visible — you're inside the grove.",
    terrain: Object.freeze({
      // Tighter clearing, steeper rise. The valley walls press inward
      // so the grove reads as enclosed.
      CLEARING_R: 42,
      HILL_INNER: 42,
      HILL_OUTER: 72,
      HILL_HEIGHT: 13.0,
      // Outer band kicks in earlier and rises higher to make the
      // walls feel "uncrossable". No snow at this elevation.
      MOUNTAIN_INNER: 72,
      MOUNTAIN_OUTER: 108,
      MOUNTAIN_HEIGHT: 22.0,
      WORLD_EDGE_M: 108,
    }),
    palette: Object.freeze({
      // Deeper grove-green olive (less yellow than scene0).
      hill: Object.freeze([0.46, 0.62, 0.40]),
      // Darker pine wall — sells "ancient forest closing in".
      mountain: Object.freeze([0.30, 0.42, 0.30]),
      cliff: Object.freeze([0.16, 0.24, 0.20]),
      snowCap: null,
      // Heavier near-horizon mist so the grove walls feel mysterious.
      fogNear: 60,
      fogFar: 120,
      fogColor: 0x9bb3a8,
    }),
    flora: Object.freeze({
      maxTreeInstances: 320,
      treeHeightM: 7.5,
      snowyTrees: false,
    }),
  }),

  scene2: Object.freeze({
    id: "scene2",
    name: "Sacred Peaks",
    blurb:
      "Same valley floor as Scene 0, but ringed by tall snow-capped mountains — the high country.",
    terrain: Object.freeze({
      CLEARING_R: 55,
      HILL_INNER: 55,
      HILL_OUTER: 82,
      HILL_HEIGHT: 11.0,
      // Tall outer peaks — heights well above the snow line set in
      // palette.snowCap. The mesh ends at 120 m so peaks stay inside.
      MOUNTAIN_INNER: 82,
      MOUNTAIN_OUTER: 118,
      MOUNTAIN_HEIGHT: 38.0,
      WORLD_EDGE_M: 118,
    }),
    palette: Object.freeze({
      hill: Object.freeze([0.68, 0.74, 0.52]),
      mountain: Object.freeze([0.48, 0.54, 0.50]),
      cliff: Object.freeze([0.28, 0.32, 0.34]),
      // Snow line at +14 m above the local hill floor (≈ height 25 m
      // above world Y=0). Above that the per-vertex colour blends to
      // a near-white snow tint over a 4 m softening band.
      snowCap: Object.freeze({
        snowLineM: 25.0,
        snow: Object.freeze([0.95, 0.96, 0.99]),
      }),
      fogNear: 100,
      fogFar: 170,
      fogColor: 0xc9d8e6,
    }),
    flora: Object.freeze({
      maxTreeInstances: 220,
      treeHeightM: 5.0,
      snowyTrees: true,
    }),
  }),
});

const STORAGE_KEY = "v2.maps.activeId";
const DEFAULT_MAP_ID = "scene1";

/**
 * Read the active map id. Order of precedence:
 *   1. `?map=<id>` query-string override (one-shot session override).
 *   2. `localStorage["v2.maps.activeId"]` if a known id.
 *   3. `DEFAULT_MAP_ID`.
 */
export function getActiveMapId() {
  if (typeof window === "undefined") return DEFAULT_MAP_ID;
  try {
    const resetDone = window.localStorage?.getItem("v2.maps.reset_done_v4");
    if (!resetDone) {
      window.localStorage?.setItem(STORAGE_KEY, DEFAULT_MAP_ID);
      window.localStorage?.setItem("v2.maps.reset_done_v4", "true");
      console.log(`[MapsConfig] Auto-resetting active map in localStorage to "${DEFAULT_MAP_ID}"...`);
      setTimeout(() => {
        window.location.reload();
      }, 50);
      return DEFAULT_MAP_ID;
    }
  } catch (_e) {
    // Ignore private storage exceptions
  }
  try {
    const qs = new URLSearchParams(window.location.search).get("map");
    if (qs && MAPS[qs]) return qs;
  } catch (_e) {
    // Some sandboxed contexts throw on URLSearchParams — fall through.
  }
  try {
    const stored = window.localStorage?.getItem(STORAGE_KEY);
    if (stored && MAPS[stored]) return stored;
  } catch (_e) {
    // localStorage disabled (private mode etc.) — fall through.
  }
  return DEFAULT_MAP_ID;
}

/** Resolved active map definition (object). */
export function getActiveMap() {
  return MAPS[getActiveMapId()] ?? MAPS[DEFAULT_MAP_ID];
}

/**
 * Persist a new active map id and reload the page so every module
 * picks up the new terrain / palette / flora targets. Throws if the
 * id isn't in the registry — better to fail loudly than silently fall
 * back.
 */
export function setActiveMapId(id, opts = {}) {
  if (!MAPS[id]) {
    throw new Error(
      `[MapsConfig] Unknown map id "${id}". Known: ${Object.keys(MAPS).join(", ")}`,
    );
  }
  try {
    window.localStorage?.setItem(STORAGE_KEY, id);
  } catch (_e) {
    /* non-fatal */
  }
  if (opts.reload !== false) {
    window.location.reload();
  }
}

/** Iterable list of map metadata (for the picker UI). */
export function listMaps() {
  return Object.values(MAPS).map((m) => ({
    id: m.id,
    name: m.name,
    blurb: m.blurb,
  }));
}

// Expose a console helper so devs can swap maps without finding the
// picker. `window._v2SetMap("scene1")` reloads into Sacred Grove.
if (typeof window !== "undefined") {
  window._v2SetMap = (id) => setActiveMapId(id);
  window._v2ListMaps = listMaps;
  window._v2ActiveMap = getActiveMap;
}

export { MAPS };
