/**
 * Sacred Adventures — Village Build Panel
 *
 * A "FLORA & BUILD" panel that attaches FLUSH BELOW the OrchestratorHud
 * (the brown "60 FPS" panel, top-right). Visible ONLY in Village View
 * (body.v4-top-down-view). Looks like a single unified unit with the HUD above it.
 *
 * Layout: 2-column grid of mold-tool tiles + GENERATE / CLEAR scene buttons.
 * Positioning: ResizeObserver on #v2-orchestrator-hud so the panel tracks the
 * HUD's height as accordions expand/collapse.
 *
 * Tool set matches SanctuaryMutations.TOOLS vocabulary:
 *   SELECT · HILL · TREE · FLOWER · BUSH · LILY · ROCK · TIPI
 */

import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";

const TOOLS = [
  { id: "select",       icon: "👆", label: "SELECT",   accent: "#aaaaaa" },
  { id: "grow_hill",    icon: "⛰",  label: "HILL",     accent: "#7c9a5e" },
  { id: "plant_tree",   icon: "🌲", label: "TREE",     accent: "#3d6b32" },
  { id: "plant_flower", icon: "🌼", label: "FLOWER",   accent: "#ffb6c1" },
  { id: "plant_bush",   icon: "🌿", label: "BUSH",     accent: "#4f7038" },
  { id: "plant_lily",   icon: "🪷", label: "LILY",     accent: "#aaeacf" },
  { id: "plant_rock",   icon: "🪨", label: "ROCK",     accent: "#888a86" },
  { id: "place_tipi",   icon: "🏕", label: "TIPI",     accent: "#d4a574" },
];

const STYLE = `
  /* ── Village Build Panel ─────────────────────────────────────── */
  #v4-village-build {
    position: fixed;
    right: 0;
    top: 120px; /* updated dynamically via ResizeObserver */
    display: none;
    flex-direction: column;
    gap: 0;
    z-index: 9998;
    pointer-events: none;
    user-select: none;
    box-sizing: border-box;

    width: min(280px, calc(100vw - 0px));

    background:
      radial-gradient(120% 80% at 50% 0%, rgba(255,210,120,0.06) 0%, rgba(0,0,0,0) 60%),
      linear-gradient(165deg, #1e1408 0%, #2c1d09 55%, #1a1106 100%);
    border: 1px solid rgba(251,192,45,0.42);
    border-top: 1px solid rgba(251,192,45,0.15); /* softer join line */
    border-radius: 0 0 16px 16px;
    padding: 10px 14px 14px;
    font-family: 'Fredoka', 'Segoe UI', sans-serif;
    font-size: 13px;
    color: #fbc02d;

    box-shadow:
      0 10px 28px rgba(0,0,0,0.55),
      inset 0 -1px 0 rgba(0,0,0,0.45);
  }

  body.v4-top-down-view #v4-village-build { display: flex; }

  /* Square OrchestratorHud bottom corners in village view so panels fuse */
  body.v4-top-down-view #v2-orchestrator-hud {
    border-bottom-left-radius: 0 !important;
    border-bottom-right-radius: 0 !important;
    border-bottom-color: rgba(251,192,45,0.15) !important;
  }

  /* ── Section header ───────────────────────────────────────────── */
  #v4-village-build .vb-header {
    font-size: 9px;
    letter-spacing: 2.5px;
    color: rgba(251,192,45,0.45);
    font-weight: 600;
    margin-bottom: 8px;
    text-transform: uppercase;
  }

  /* ── 2-column grid ────────────────────────────────────────────── */
  #v4-village-build .vb-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5px;
    margin-bottom: 10px;
  }

  #v4-village-build .vb-tool {
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 7px 6px 6px;
    background: linear-gradient(180deg, rgba(28,22,16,0.93), rgba(12,8,5,0.97));
    border: 1px solid rgba(255,217,122,0.20);
    border-left: 3px solid rgba(120,120,120,0.5);
    border-radius: 5px;
    cursor: pointer;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1.8px;
    color: #c4b8a4;
    text-align: center;
    transition: transform 80ms ease, border-left-color 100ms ease, background 100ms ease;
    box-shadow: 0 2px 8px rgba(0,0,0,0.45);
  }

  #v4-village-build .vb-tool:hover {
    transform: translateY(-1px);
    background: linear-gradient(180deg, rgba(46,32,22,0.95), rgba(22,14,9,0.99));
  }

  #v4-village-build .vb-tool .vb-icon {
    font-size: 18px;
    line-height: 1;
    filter: drop-shadow(0 1px 2px rgba(0,0,0,0.8));
  }

  #v4-village-build .vb-tool.active {
    border-left-color: #fbc02d !important;
    background: linear-gradient(180deg, rgba(60,42,22,0.97), rgba(24,16,8,0.99));
    box-shadow: 0 2px 12px rgba(0,0,0,0.55), inset 0 0 10px rgba(251,192,45,0.08);
    color: #ffd97a;
  }

  /* ── Divider ──────────────────────────────────────────────────── */
  #v4-village-build .vb-divider {
    height: 1px;
    background: rgba(251,192,45,0.12);
    margin-bottom: 10px;
  }

  /* ── Action buttons (Generate / Clear) ───────────────────────── */
  #v4-village-build .vb-actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  #v4-village-build .vb-btn {
    pointer-events: auto;
    background: linear-gradient(180deg, rgba(40,26,20,0.94), rgba(15,10,8,0.97));
    border: 1px solid rgba(255,217,122,0.28);
    border-bottom: 3px solid rgba(251,192,45,0.60);
    border-radius: 5px;
    color: #ffe9a8;
    padding: 8px 12px;
    font-family: 'Fredoka', 'Segoe UI', sans-serif;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.2px;
    cursor: pointer;
    width: 100%;
    text-align: center;
    transition: transform 100ms ease, background 100ms ease;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  }

  #v4-village-build .vb-btn:hover {
    transform: translateY(-1px);
    background: linear-gradient(180deg, rgba(60,38,24,0.95), rgba(28,18,12,0.99));
  }

  #v4-village-build .vb-btn:active { transform: translateY(0); }
`;

function ensureStyle() {
  if (document.getElementById("v4-village-build-style")) return;
  const s = document.createElement("style");
  s.id = "v4-village-build-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

function buildPanel() {
  const wrap = document.createElement("div");
  wrap.id = "v4-village-build";
  wrap.userData = { anuSimulationDomain: ANU_SIMULATION_DOMAIN.PLAYER };

  // Header
  const hdr = document.createElement("div");
  hdr.className = "vb-header";
  hdr.textContent = "🌱 FLORA & BUILD";
  wrap.appendChild(hdr);

  // 2-col grid
  const grid = document.createElement("div");
  grid.className = "vb-grid";
  for (const t of TOOLS) {
    const btn = document.createElement("div");
    btn.className = "vb-tool";
    btn.dataset.tool = t.id;
    btn.style.borderLeftColor = t.accent + "99";
    btn.innerHTML = `<div class="vb-icon">${t.icon}</div><div>${t.label}</div>`;
    grid.appendChild(btn);
  }
  wrap.appendChild(grid);

  // Divider
  const div = document.createElement("div");
  div.className = "vb-divider";
  wrap.appendChild(div);

  // Action buttons
  const actions = document.createElement("div");
  actions.className = "vb-actions";

  const btnGen = document.createElement("button");
  btnGen.className = "vb-btn";
  btnGen.id = "v4-btn-gen-scene";
  btnGen.textContent = "✨ GENERATE SCENE";

  const btnClr = document.createElement("button");
  btnClr.className = "vb-btn";
  btnClr.id = "v4-btn-clear-scene";
  btnClr.textContent = "🗑 CLEAR SCENE";

  actions.appendChild(btnGen);
  actions.appendChild(btnClr);
  wrap.appendChild(actions);

  document.body.appendChild(wrap);
  return wrap;
}

export const SanctuaryToolPaletteModule = {
  name: "SanctuaryToolPalette",

  _wrap: null,
  _activeId: "select",
  _resizeObs: null,
  _mutObs: null,

  async load() {
    ensureStyle();
    this._wrap = buildPanel();

    // ── Tool selection ─────────────────────────────────────────────
    this._wrap.querySelector(".vb-grid").addEventListener("click", (ev) => {
      const tile = ev.target.closest(".vb-tool");
      if (!tile) return;
      this._setActive(tile.dataset.tool);
    });
    this._setActive(this._activeId);

    // ── Scene buttons ──────────────────────────────────────────────
    document.getElementById("v4-btn-gen-scene")?.addEventListener("click", () => {
      if (window.SanctuaryMutations?.generateScene) {
        window.SanctuaryMutations.generateScene();
      } else {
        console.log("[VillageBuild] ✨ GENERATE SCENE — coming soon!");
      }
    });
    document.getElementById("v4-btn-clear-scene")?.addEventListener("click", () => {
      if (window.SanctuaryMutations?.clearScene) {
        window.SanctuaryMutations.clearScene();
      } else {
        console.log("[VillageBuild] 🗑 CLEAR SCENE — coming soon!");
      }
    });

    // ── Attach flush below OrchestratorHud ────────────────────────
    this._hookPosition();

    console.log(
      "%c[Sanctuary] 🌱 Village Build panel ready — attaches below OrchestratorHud in Village View.",
      "color:#ffd97a;font-weight:bold;",
    );
  },

  _hookPosition() {
    const hudEl = document.getElementById("v2-orchestrator-hud");
    if (!hudEl) return;

    const reposition = () => {
      if (!this._wrap) return;
      const rect = hudEl.getBoundingClientRect();
      // Flush: panel top = hud bottom (no gap; border-top acts as the separator)
      this._wrap.style.top = `${rect.bottom}px`;
    };

    this._resizeObs = new ResizeObserver(reposition);
    this._resizeObs.observe(hudEl);

    // Also reposition when body class changes (entering/leaving village view)
    this._mutObs = new MutationObserver(reposition);
    this._mutObs.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    reposition(); // initial
  },

  _setActive(id) {
    if (!this._wrap) return;
    this._activeId = id;
    this._wrap.querySelectorAll(".vb-tool").forEach((el) => {
      el.classList.toggle("active", el.dataset.tool === id);
    });
    if (typeof window !== "undefined") window.__sanctuaryMoldTool = id;
  },

  update() {},

  unload() {
    this._resizeObs?.disconnect();
    this._mutObs?.disconnect();
    this._resizeObs = null;
    this._mutObs = null;

    if (this._wrap?.parentNode) this._wrap.parentNode.removeChild(this._wrap);
    const s = document.getElementById("v4-village-build-style");
    if (s?.parentNode) s.parentNode.removeChild(s);
    this._wrap = null;
  },
};
