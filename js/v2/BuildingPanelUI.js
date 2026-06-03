/**
 * Sacred Adventures — BuildingPanelUI  (BLD-1: building-types panel, list-only)
 *
 * A self-initializing left-side panel shown ONLY in Village (top-down) view, listing the
 * village building TYPES — Tipi 1/2/3, Fish Dock, Sacred Pool. List-only this pass: the
 * (+) affordance is disabled ("coming soon") — no placement yet. Neumorphic dark-brown
 * HUD theme to match the rest of the chrome.
 *
 * Consumes window.SanctuaryBuildings (the registry) when present; otherwise degrades to a
 * static list so it always renders. Re-renders on `sanctuary:buildings:changed`.
 * (Built per scaffold_building_registry.md — user 2026-06-02.)
 */

const PANEL_ID = "v4-building-panel";
const STYLE_ID = "v4-building-panel-style";

const STATIC_BUILDINGS = [
  { type: "tipi", label: "Tipi 1", icon: "🛖", exists: true },
  { type: "tipi", label: "Tipi 2", icon: "🛖", exists: true },
  { type: "tipi", label: "Tipi 3", icon: "🛖", exists: true },
  { type: "dock", label: "Fish Dock", icon: "🎣", exists: true },
  { type: "pool", label: "Sacred Pool", icon: "🌊", exists: true },
];

const STYLE = `
  /* Village building-types panel — left side, village/top-down view only. */
  #${PANEL_ID} {
    position: absolute;
    top: 150px;            /* clears the compass PiP (top-left) */
    left: 16px;
    width: 196px;
    z-index: 95;
    display: none;        /* shown only in village/top-down view (rule below) */
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border-radius: 16px;
    background: linear-gradient(145deg, rgba(46, 29, 26, 0.82), rgba(30, 20, 16, 0.82));
    border: 1px solid #3e2723;
    box-shadow: 0 8px 22px rgba(0,0,0,0.55), inset 0 1px 0 rgba(141,110,99,0.25);
    backdrop-filter: blur(6px);
    color: #fff8e1;
    font-family: 'Nunito', 'Lato', sans-serif;
    pointer-events: auto;
    user-select: none;
  }
  body.v4-top-down-view #${PANEL_ID} { display: flex; }

  #${PANEL_ID} .bp-header {
    display: flex; align-items: center; gap: 6px;
    font-size: 12px; font-weight: 800; letter-spacing: 0.04em;
    color: #ffd9a0; text-transform: uppercase;
    padding-bottom: 4px; border-bottom: 1px solid rgba(141,110,99,0.3);
  }
  #${PANEL_ID} .bp-list { display: flex; flex-direction: column; gap: 6px; }
  #${PANEL_ID} .bp-row {
    display: flex; align-items: center; gap: 9px;
    padding: 8px 10px; border-radius: 11px;
    background: linear-gradient(145deg, rgba(70,48,41,0.55), rgba(46,29,26,0.55));
    border: 1px solid rgba(141,110,99,0.35);
    box-shadow: inset 0 2px 5px rgba(0,0,0,0.35), 0 1px 0 rgba(141,110,99,0.15);
    min-height: 40px;
  }
  #${PANEL_ID} .bp-icon { font-size: 19px; width: 24px; text-align: center; }
  #${PANEL_ID} .bp-label { flex: 1; font-size: 12.5px; font-weight: 700; }
  #${PANEL_ID} .bp-badge {
    font-size: 9px; font-weight: 800; letter-spacing: 0.04em;
    color: #a5d6a7; background: rgba(46,90,46,0.4);
    padding: 2px 6px; border-radius: 7px; text-transform: uppercase;
  }
  #${PANEL_ID} .bp-add {
    margin-top: 2px; padding: 7px; border-radius: 10px; text-align: center;
    font-size: 11px; font-weight: 800; color: #8d6e63;
    background: rgba(30,20,16,0.5); border: 1px dashed rgba(141,110,99,0.4);
    cursor: not-allowed; opacity: 0.7;
  }
  @media (pointer: coarse) { #${PANEL_ID} { top: 120px; width: 168px; } }
`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = STYLE;
  document.head.appendChild(s);
}

/** Read building list from the registry if present, else the static fallback. */
function readBuildings() {
  try {
    const reg = typeof window !== "undefined" ? window.SanctuaryBuildings : null;
    if (reg && typeof reg.list === "function") {
      const list = reg.list();
      if (Array.isArray(list) && list.length) {
        return list.map((b) => ({
          type: b.type,
          label: b.displayName || b.id,
          icon: b.type === "tipi" ? "🛖" : b.type === "dock" ? "🎣" : "🌊",
          exists: b.exists !== false,
        }));
      }
    }
  } catch (_e) { /* registry not ready — fall through */ }
  return STATIC_BUILDINGS;
}

function render(panel) {
  const buildings = readBuildings();
  panel.innerHTML =
    '<div class="bp-header">🏘 Village Buildings</div>' +
    '<div class="bp-list">' +
    buildings
      .map(
        (b) =>
          `<div class="bp-row" data-type="${b.type}">` +
          `<span class="bp-icon">${b.icon}</span>` +
          `<span class="bp-label">${b.label}</span>` +
          `<span class="bp-badge">${b.exists ? "Built" : "—"}</span>` +
          `</div>`,
      )
      .join("") +
    "</div>" +
    '<div class="bp-add" title="Placement coming soon">＋ Add building (soon)</div>';
}

function init() {
  if (document.getElementById(PANEL_ID)) return;
  injectStyle();
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  document.body.appendChild(panel);
  render(panel);
  // Re-render when the registry mutates (npc reassignment, accessory counts, etc.).
  window.addEventListener("sanctuary:buildings:changed", () => render(panel));
  console.log(
    "%c[Sanctuary] 🏘 Building panel online — village-view building list (BLD-1, list-only).",
    "color:#ffd9a0;font-weight:bold;",
  );
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}

export const BuildingPanelUI = { init };
