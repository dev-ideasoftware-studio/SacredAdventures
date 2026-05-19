/**
 * Sacred Adventures — sanctuary tool palette (top-down mold picker).
 *
 * Only visible while the player has the TOP-DOWN camera active. Lets
 * kids pick which mold tool a click will fire — grow a hill, plant a
 * tree, plant a flower, plant a rock, plant a lily, plant a bush.
 *
 * Visual: a horizontal strip pinned to the LEFT edge of the viewport
 * mid-height, each tool is a chunky tile with an emoji icon + the
 * tool's name underneath. Active tile glows gold. CSS-only — no
 * canvas pull, just DOM.
 *
 * Architecture:
 *   • Watches `document.body.classList` for `v4-top-down-view` and
 *     shows / hides accordingly.
 *   • On tile click, writes `window.__sanctuaryMoldTool = toolId`. The
 *     click-to-move module reads this when in top-down to decide
 *     whether to dispatch a mutation vs walk.
 *
 * Tools listed match `SanctuaryMutations.TOOLS` so the palette never
 * drifts from the registry's vocabulary.
 */

import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";

const TOOLS = [
  { id: "grow_hill",    icon: "⛰",  label: "HILL",     accent: "#7c9a5e" },
  { id: "plant_tree",   icon: "🌲", label: "TREE",     accent: "#3d6b32" },
  { id: "plant_flower", icon: "🌼", label: "FLOWER",   accent: "#ffb6c1" },
  { id: "plant_bush",   icon: "🌿", label: "BUSH",     accent: "#4f7038" },
  { id: "plant_lily",   icon: "🪷", label: "LILY",     accent: "#aaeacf" },
  { id: "plant_rock",   icon: "🪨", label: "ROCK",     accent: "#888a86" },
  { id: "place_tipi",   icon: "🏕", label: "TIPI",     accent: "#d4a574" },
];

const STYLE = `
  #v4-tool-palette {
    position: fixed;
    left: 20px;
    top: 50%;
    transform: translateY(-50%);
    display: none;
    flex-direction: column;
    gap: 8px;
    z-index: 9100;
    user-select: none;
    pointer-events: none;
    font-family: ui-monospace, Menlo, Consolas, monospace;
  }
  body.v4-top-down-view #v4-tool-palette { display: flex; }
  #v4-tool-palette .tool {
    pointer-events: auto;
    background: linear-gradient(180deg, rgba(28, 22, 16, 0.93), rgba(12, 8, 5, 0.97));
    border: 1px solid rgba(255, 217, 122, 0.22);
    border-left: 4px solid rgba(120, 120, 120, 0.6);
    color: #ffe9a8;
    padding: 8px 14px 8px 12px;
    border-radius: 4px;
    cursor: pointer;
    min-width: 86px;
    display: flex; flex-direction: column;
    align-items: center; gap: 4px;
    text-align: center;
    font-size: 10px; letter-spacing: 2.2px;
    font-weight: 800;
    transition: transform 100ms ease, border-left-color 120ms ease, background 120ms ease;
    box-shadow: 0 3px 12px rgba(0,0,0,0.55);
  }
  #v4-tool-palette .tool:hover {
    transform: translateX(2px);
    background: linear-gradient(180deg, rgba(46, 32, 22, 0.95), rgba(22, 14, 9, 0.99));
  }
  #v4-tool-palette .tool .icon {
    font-size: 22px;
    line-height: 1.0;
    filter: drop-shadow(0 1px 2px rgba(0,0,0,0.8));
  }
  #v4-tool-palette .tool .label {
    color: #c4b8a4;
    font-size: 9px; letter-spacing: 2.6px;
  }
  #v4-tool-palette .tool.active {
    border-left-color: #fbc02d;
    background: linear-gradient(180deg, rgba(60, 42, 22, 0.97), rgba(24, 16, 8, 0.99));
    box-shadow: 0 3px 14px rgba(0,0,0,0.6), inset 0 0 12px rgba(251, 192, 45, 0.10);
  }
  #v4-tool-palette .tool.active .label { color: #ffd97a; }
`;

function ensureStyle() {
  if (document.getElementById("v4-tool-palette-style")) return;
  const s = document.createElement("style");
  s.id = "v4-tool-palette-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

function buildPalette() {
  const wrap = document.createElement("div");
  wrap.id = "v4-tool-palette";
  wrap.userData = { anuSimulationDomain: ANU_SIMULATION_DOMAIN.PLAYER };
  for (const t of TOOLS) {
    const btn = document.createElement("div");
    btn.className = "tool";
    btn.dataset.tool = t.id;
    btn.innerHTML = `<div class="icon">${t.icon}</div><div class="label">${t.label}</div>`;
    btn.style.borderLeftColor = t.accent;
    wrap.appendChild(btn);
  }
  document.body.appendChild(wrap);
  return wrap;
}

export const SanctuaryToolPaletteModule = {
  name: "SanctuaryToolPalette",

  _wrap: null,
  _activeId: "grow_hill",

  async load() {
    ensureStyle();
    this._wrap = buildPalette();
    this._wrap.addEventListener("click", (ev) => {
      const tile = ev.target.closest(".tool");
      if (!tile) return;
      this._setActive(tile.dataset.tool);
    });
    // Default to grow_hill highlighted.
    this._setActive(this._activeId);
    console.log(
      "%c[Sanctuary] 🎨 Tool palette ready — appears in top-down view.",
      "color:#ffd97a;font-weight:bold;",
    );
  },

  _setActive(id) {
    if (!this._wrap) return;
    this._activeId = id;
    this._wrap.querySelectorAll(".tool").forEach((el) => {
      el.classList.toggle("active", el.dataset.tool === id);
    });
    if (typeof window !== "undefined") window.__sanctuaryMoldTool = id;
  },

  update() {},
  unload() {
    if (this._wrap?.parentNode) this._wrap.parentNode.removeChild(this._wrap);
    const s = document.getElementById("v4-tool-palette-style");
    if (s?.parentNode) s.parentNode.removeChild(s);
    this._wrap = null;
  },
};
