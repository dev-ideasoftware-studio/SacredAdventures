/**
 * Sacred Adventures — sanctuary part 28 of N: HARVEST INVENTORY.
 *
 * Anu domain: ITEMS (Anu's `items` domain finally has something in it!).
 *
 * The `harvest` verb in Anu's vocabulary becomes real. When a kid
 * clicks (in FPV/chase view) on anything tagged with
 * `anuInteractionVerbs` including HARVEST — bushes, mushroom clusters,
 * planted flowers, planted trees, fish — the world spawns an inventory
 * item of a matching kind into a small floating bag UI in the corner.
 *
 * Five item kinds exposed:
 *   🌿 leaf       (from bushes)
 *   🍓 berry      (from bushes that rolled the berry payload)
 *   🍄 mushroom   (from mushroom clusters)
 *   🌼 petal      (from any flower cluster — baseline or planted)
 *   🌲 stick      (from trees)
 *   🐟 fish       (from a successful click on a pool fish)
 *
 * The inventory survives SAVE/RESET via the same SanctuaryMutations
 * registry (we publish a special `_inventory_grant` "mutation" so the
 * counter restores; the mesh field is `null` so RESET doesn't try to
 * remove a scene-graph object that doesn't exist).
 *
 * UI: small wood-rim panel pinned to the LEFT EDGE bottom — six tiles
 * with emoji + count.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN, ANU_INTERACTION_VERB } from "../v2/anu/SimulationController.js";
import { dispatchInteraction } from "../v2/anu/InteractionBus.js";
import { ANU_EVENTS } from "../v2/anu/anuEvents.js";

const ITEM_KINDS = [
  { id: "petal",    glyph: "🌼", from: ["sanctuary_wildflower_blossoms", "sanctuary_mold_flower", "sanctuary_mold_flower_blossom"] },
  { id: "berry",    glyph: "🍓", from: ["sanctuary_mold_bush_berry"] },
  { id: "leaf",     glyph: "🌿", from: ["sanctuary_mold_bush", "sanctuary_mold_bush_lump"] },
  { id: "mushroom", glyph: "🍄", from: ["sanctuary_mushroom_caps", "sanctuary_mushroom_cluster", "sanctuary_mushroom_cap"] },
  { id: "stick",    glyph: "🌲", from: ["sanctuary_tree", "sanctuary_tree_trunk", "sanctuary_tree_crown"] },
  { id: "fish",     glyph: "🐟", from: ["sanctuary_fish", "sanctuary_fish_body"] },
];

const ITEM_LOOKUP = {};
for (const k of ITEM_KINDS) {
  for (const a of k.from) ITEM_LOOKUP[a] = k.id;
}

const STYLE = `
  #v4-inventory {
    position: fixed;
    left: 18px; bottom: 18px;
    display: flex; gap: 8px;
    z-index: 9070;
    pointer-events: auto;
    user-select: none;
    font-family: ui-monospace, Menlo, Consolas, monospace;
  }
  #v4-inventory .slot {
    background: linear-gradient(180deg, rgba(28, 22, 16, 0.92), rgba(12, 8, 5, 0.97));
    border: 1px solid rgba(255, 217, 122, 0.22);
    border-bottom: 3px solid rgba(120, 90, 40, 0.6);
    border-radius: 4px;
    padding: 6px 8px 5px;
    display: flex; flex-direction: column;
    align-items: center; gap: 2px;
    min-width: 48px;
    box-shadow: 0 3px 12px rgba(0,0,0,0.55);
    transition: transform 80ms ease, border-bottom-color 120ms ease;
  }
  #v4-inventory .slot.has {
    border-bottom-color: #fbc02d;
  }
  #v4-inventory .glyph { font-size: 20px; line-height: 1; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.8)); }
  #v4-inventory .count { color: #ffe9a8; font-size: 11px; letter-spacing: 1.4px; font-weight: 800; }
  #v4-inventory .slot.has .count { color: #ffd97a; }
  #v4-inventory .slot:not(.has) .count { color: #6a5d44; }

  /* "+1 floater" — animated emoji that floats up from the harvested
     point + into the inventory slot. Pure CSS animation. */
  .v4-harvest-pop {
    position: fixed;
    pointer-events: none;
    z-index: 9980;
    font-size: 22px;
    text-shadow: 0 2px 6px rgba(0,0,0,0.85);
    animation: v4popUp 1.0s ease-out forwards;
  }
  @keyframes v4popUp {
    0%   { transform: translate(-50%, -50%) scale(0.6); opacity: 0; }
    20%  { transform: translate(-50%, -90%) scale(1.4); opacity: 1; }
    100% { transform: translate(-50%, -180%) scale(0.9); opacity: 0; }
  }
`;

function ensureStyle() {
  if (document.getElementById("v4-inventory-style")) return;
  const s = document.createElement("style");
  s.id = "v4-inventory-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

export const SanctuaryInventoryModule = {
  name: "SanctuaryInventory",

  _scene: null,
  _camera: null,
  _canvas: null,
  _wrap: null,
  _slots: {},      // id → { el, countEl }
  _counts: {},     // id → integer
  _raycaster: null,
  _ndc: null,
  _onClick: null,

  async load(scene, camera, renderer) {
    if (this._wrap) return;
    this._scene = scene;
    this._camera = camera;
    this._canvas = renderer?.domElement ?? null;
    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();

    ensureStyle();
    const wrap = document.createElement("div");
    wrap.id = "v4-inventory";
    // Hidden May-19 2026 — strip retired from the bottom-left per user
    // spec. Inventory counts + harvest logic still run (right-click on
    // bushes / fish etc. still grants resources via `sanctuaryGrant`);
    // we just don't render the row of chips.
    wrap.style.display = "none";
    wrap.userData = { anuSimulationDomain: ANU_SIMULATION_DOMAIN.ITEMS };
    for (const kind of ITEM_KINDS) {
      const slot = document.createElement("div");
      slot.className = "slot";
      slot.dataset.kind = kind.id;
      slot.innerHTML = `<div class="glyph">${kind.glyph}</div><div class="count">0</div>`;
      this._slots[kind.id] = { el: slot, countEl: slot.querySelector(".count") };
      this._counts[kind.id] = 0;
      wrap.appendChild(slot);
    }
    document.body.appendChild(wrap);
    this._wrap = wrap;

    // Right-click on the canvas tries to HARVEST whatever's there.
    // (Left-click is reserved for walk / mold.)
    this._onClick = (ev) => this._handleHarvestClick(ev);
    if (this._canvas) {
      this._canvas.addEventListener("contextmenu", this._onClick);
    }

    // Expose a programmatic grant for other modules (e.g. fish jumps
    // could grant a fish on splash if we wanted).
    if (typeof window !== "undefined") {
      window.sanctuaryGrant = (kindId, n = 1) => this._grant(kindId, n);
      window.sanctuaryInventory = () => ({ ...this._counts });
    }

    console.log(
      "%c[Sanctuary] 🎒 Inventory online — right-click bushes / flowers / mushrooms / fish to harvest.",
      "color:#ffd97a;font-weight:bold;",
    );
  },

  _handleHarvestClick(ev) {
    if (!this._canvas || !this._camera) return;
    ev.preventDefault?.();
    const rect = this._canvas.getBoundingClientRect();
    this._ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this._ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._ndc, this._camera);
    const hits = this._raycaster.intersectObjects(this._scene.children, true);
    if (!hits.length) return;
    // Walk hits front-to-back; first one whose anuKind we recognise wins.
    for (const hit of hits) {
      let cur = hit.object;
      while (cur) {
        const kind = cur.userData?.anuKind;
        const itemId = kind && ITEM_LOOKUP[kind];
        if (itemId) {
          this._grant(itemId, 1, ev.clientX, ev.clientY);
          // For mold-spawned objects that we want to disappear on
          // harvest (one-shot flowers etc.), publish a remove. For
          // instanced flora we DON'T remove — they're shared instances.
          return;
        }
        cur = cur.parent;
      }
    }
  },

  _grant(kindId, n, screenX, screenY) {
    const slot = this._slots[kindId];
    if (!slot) return;
    this._counts[kindId] = (this._counts[kindId] || 0) + n;
    slot.countEl.textContent = String(this._counts[kindId]);
    slot.el.classList.add("has");
    // +1 floater animation.
    if (typeof screenX === "number" && typeof screenY === "number") {
      const pop = document.createElement("div");
      pop.className = "v4-harvest-pop";
      pop.textContent = ITEM_KINDS.find((k) => k.id === kindId)?.glyph || "✦";
      pop.style.left = screenX + "px";
      pop.style.top = screenY + "px";
      document.body.appendChild(pop);
      setTimeout(() => pop.remove(), 1000);
    }
    try {
      dispatchInteraction(ANU_EVENTS.ITEM_EVENT, {
        kind: "harvest_grant",
        itemKind: kindId,
        count: this._counts[kindId],
      });
    } catch (_) {}
  },

  update() { /* DOM only */ },

  unload() {
    if (this._onClick && this._canvas) {
      this._canvas.removeEventListener("contextmenu", this._onClick);
    }
    if (this._wrap?.parentNode) this._wrap.parentNode.removeChild(this._wrap);
    const s = document.getElementById("v4-inventory-style");
    if (s?.parentNode) s.parentNode.removeChild(s);
    if (typeof window !== "undefined") {
      delete window.sanctuaryGrant;
      delete window.sanctuaryInventory;
    }
    this._scene = null;
    this._camera = null;
    this._canvas = null;
    this._wrap = null;
    this._slots = {};
    this._counts = {};
  },
};
