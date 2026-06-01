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

  /* 🗺 Village Map Selector Styling */
  #v4-village-build .vb-select-container {
    margin-bottom: 10px;
    pointer-events: auto;
  }
  #v4-village-build .vb-select-container select {
    width: 100%;
    background: linear-gradient(180deg, rgba(40,26,20,0.94), rgba(15,10,8,0.97));
    border: 1px solid rgba(255,217,122,0.30);
    border-bottom: 2px solid rgba(251,192,45,0.65);
    border-radius: 4px;
    color: #ffe9a8;
    padding: 6px 10px;
    font-family: 'Fredoka', 'Segoe UI', sans-serif;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.0px;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    outline: none;
    transition: border-color 150ms ease, background 150ms ease;
  }
  #v4-village-build .vb-select-container select:hover {
    border-color: rgba(251,192,45,0.85);
    background: linear-gradient(180deg, rgba(60,38,24,0.95), rgba(28,18,12,0.99));
  }
  #v4-village-build .vb-select-container select option {
    background: #1e1408;
    color: #ffe9a8;
    font-family: 'Fredoka', 'Segoe UI', sans-serif;
  }

  /* Grab handle is desktop-hidden (desktop docks the panel under the HUD). */
  #v4-village-build .vb-handle { display: none; }

  /* ════════ MOBILE: dock as a neumorphic bottom sheet ════════
     Collapsed shows only the handle bar flush to the bottom edge; tap it to
     slide the full map + tools up. Overrides the desktop right/top docking
     (incl. the inline top the ResizeObserver writes) via !important. */
  @media (pointer: coarse) {
    #v4-village-build {
      top: auto !important;
      bottom: 0 !important;
      left: 0 !important;
      right: 0 !important;
      width: 100% !important;
      max-width: 100% !important;
      padding: 0 !important;
      border: none !important;
      border-radius: 22px 22px 0 0 !important;
      background: linear-gradient(180deg, #251a10 0%, #1a1207 100%) !important;
      box-shadow: 0 -12px 34px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,228,160,0.07) !important;
      max-height: 80vh;
      overflow: hidden;
      transform: translateY(calc(100% - 50px));
      transition: transform 0.30s cubic-bezier(0.22,0.61,0.36,1) !important;
    }
    #v4-village-build.vb-open { transform: translateY(0) !important; }

    #v4-village-build .vb-handle {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      height: 50px;
      flex: 0 0 50px;
      pointer-events: auto;
      cursor: pointer;
      color: #ffd97a;
      font: 700 12px/1 'Fredoka','Segoe UI',sans-serif;
      letter-spacing: 2px;
      border-radius: 22px 22px 0 0;
      background: linear-gradient(180deg, #2c2013 0%, #1e1409 100%);
      box-shadow: inset 0 2px 3px rgba(255,228,160,0.10), inset 0 -4px 7px rgba(0,0,0,0.5);
    }
    #v4-village-build .vb-handle-grip {
      position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
      width: 44px; height: 4px; border-radius: 3px;
      background: rgba(255,217,122,0.40);
      box-shadow: inset 0 1px 1px rgba(0,0,0,0.4);
    }
    #v4-village-build .vb-handle-chevron { font-size: 9px; opacity: 0.7; transition: transform 0.3s ease; }
    #v4-village-build.vb-open .vb-handle-chevron { transform: rotate(180deg); }

    #v4-village-build .vb-sheet-body {
      pointer-events: auto;
      max-height: calc(80vh - 50px);
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding: 6px 16px 20px;
    }

    /* Neumorphic soft tiles / buttons / select */
    #v4-village-build .vb-grid { gap: 9px; }
    #v4-village-build .vb-tool,
    #v4-village-build .vb-btn,
    #v4-village-build .vb-select-container select {
      border-radius: 13px !important;
      box-shadow: 4px 4px 10px rgba(0,0,0,0.55), -3px -3px 8px rgba(255,228,160,0.05) !important;
    }
    #v4-village-build .vb-tool { padding: 11px 6px 9px; font-size: 10px; }
    #v4-village-build .vb-tool .vb-icon { font-size: 21px; }
  }
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

  // Mobile bottom-sheet grab handle (hidden on desktop via CSS).
  const handle = document.createElement("div");
  handle.className = "vb-handle";
  handle.innerHTML =
    '<span class="vb-handle-grip"></span><span class="vb-handle-label">🏗 BUILD &amp; MAP</span><span class="vb-handle-chevron">▲</span>';
  wrap.appendChild(handle);

  // Scrollable content body — lets the mobile bottom sheet scroll; on desktop
  // it is a plain block and content flows exactly as before.
  const body = document.createElement("div");
  body.className = "vb-sheet-body";

  // 🗺 Map Selection Section
  const mapHdr = document.createElement("div");
  mapHdr.className = "vb-header";
  mapHdr.textContent = "🗺 VILLAGE MAP";
  body.appendChild(mapHdr);

  const mapSelContainer = document.createElement("div");
  mapSelContainer.className = "vb-select-container";

  const mapSelect = document.createElement("select");
  mapSelect.id = "v4-map-type-select";

  const activeMap = (typeof window !== "undefined" && window.__sanctuaryMapType) || "1";

  const optionsData = [
    { value: "1", text: "Map 1: Small Village Pond" },
    { value: "2", text: "Map 2: Large Basin & Streams" },
    { value: "3", text: "Map 3: Deep Mountain Valley" },
    { value: "4", text: "Map 4: Winding River Plain" },
    { value: "5", text: "Map 5: Sacred Forest Glade" }
  ];

  optionsData.forEach(opt => {
    const el = document.createElement("option");
    el.value = opt.value;
    el.textContent = opt.text;
    if (opt.value === activeMap) el.selected = true;
    mapSelect.appendChild(el);
  });

  mapSelContainer.appendChild(mapSelect);
  body.appendChild(mapSelContainer);

  const mapDiv = document.createElement("div");
  mapDiv.className = "vb-divider";
  body.appendChild(mapDiv);

  // Header
  const hdr = document.createElement("div");
  hdr.className = "vb-header";
  hdr.textContent = "🌱 FLORA & BUILD";
  body.appendChild(hdr);

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
  body.appendChild(grid);

  // Divider
  const div = document.createElement("div");
  div.className = "vb-divider";
  body.appendChild(div);

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
  body.appendChild(actions);

  wrap.appendChild(body);
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

    const activeMap = (typeof window !== "undefined" && window.__sanctuaryMapType) || "1";
    window.__sanctuaryMapType = activeMap;

    // ── Tool selection ─────────────────────────────────────────────
    this._wrap.querySelector(".vb-grid").addEventListener("click", (ev) => {
      const tile = ev.target.closest(".vb-tool");
      if (!tile) return;
      this._setActive(tile.dataset.tool);
    });
    this._setActive(this._activeId);

    // ── Mobile bottom-sheet toggle (handle tap expands/collapses) ──
    this._wrap.querySelector(".vb-handle")?.addEventListener("click", () => {
      this._wrap.classList.toggle("vb-open");
    });

    // ── Map Selection ──────────────────────────────────────────────
    this._wrap.querySelector("#v4-map-type-select")?.addEventListener("change", async (ev) => {
      const type = ev.target.value;
      window.__sanctuaryMapType = type;
      console.log("[VillageBuild] 🗺 Transitioning to Map Type: " + type);

      // 1) Update ground mapType and live ES6 bindings
      if (window.SanctuaryGround?.setMapType) {
        window.SanctuaryGround.setMapType(type);
      }

      // 2) Regenerate terrain mesh in place
      if (window.__regenerateTerrain) {
        await window.__regenerateTerrain();
      }

      // 3) Regenerate tipis
      if (window.__regenerateTipis) {
        await window.__regenerateTipis();
      }

      // 4) Regenerate NPCs
      if (window.__regenerateTipiNpcs) {
        await window.__regenerateTipiNpcs();
      }

      // 5) Regenerate Braziers
      if (window.__regenerateBraziers) {
        await window.__regenerateBraziers();
      }

      // 6) Regenerate pool assets
      if (window.__regeneratePoolObjects) {
        await window.__regeneratePoolObjects();
      }

      // 7) Regenerate dock
      if (window.__regenerateDock) {
        await window.__regenerateDock();
      }
    });

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
