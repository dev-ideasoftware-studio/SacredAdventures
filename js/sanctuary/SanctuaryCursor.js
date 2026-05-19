/**
 * Sacred Adventures — sanctuary part 26 of N: TOOL CURSOR.
 *
 * Anu domain: PLAYER (input surface). While the player is in TOP-DOWN
 * mode AND a mold tool is armed, the OS cursor hides and a floating
 * emoji icon follows the mouse — the kid can see at a glance which
 * tool a click will fire (⛰ HILL / 🌲 TREE / 🌼 FLOWER / 🌿 BUSH / 🪷 LILY / 🪨 ROCK).
 *
 * In FPV / chase view the icon hides and the OS cursor returns. The
 * tool palette stays as the canonical tile selector — this is just
 * the moving feedback so the cursor isn't a confusing arrow over the
 * map.
 */

const TOOL_GLYPHS = {
  grow_hill:    "⛰",
  plant_tree:   "🌲",
  plant_flower: "🌼",
  plant_bush:   "🌿",
  plant_lily:   "🪷",
  plant_rock:   "🪨",
};

const STYLE = `
  #v4-tool-cursor {
    position: fixed;
    top: 0; left: 0;
    width: 44px; height: 44px;
    transform: translate(-22px, -22px);
    pointer-events: none;
    user-select: none;
    z-index: 9950;
    display: none;
    align-items: center; justify-content: center;
    font-size: 28px;
    line-height: 1;
    text-shadow: 0 2px 6px rgba(0,0,0,0.75), 0 0 12px rgba(255,217,122,0.45);
    filter: drop-shadow(0 0 6px rgba(255,217,122,0.65));
    transition: transform 60ms ease;
  }
  body.v4-top-down-view #v4-tool-cursor.armed {
    display: flex;
  }
  body.v4-top-down-view.v4-tool-active {
    cursor: none;
  }
  /* Soft pulse ring under the icon. */
  #v4-tool-cursor::before {
    content: "";
    position: absolute;
    inset: -8px;
    border-radius: 50%;
    border: 2px solid rgba(255,217,122,0.55);
    box-shadow:
      0 0 14px rgba(255,217,122,0.32),
      inset 0 0 10px rgba(255,217,122,0.18);
    animation: v4cursorPulse 1.4s ease-in-out infinite;
  }
  @keyframes v4cursorPulse {
    0%,100% { opacity: 0.6; transform: scale(0.92); }
    50%     { opacity: 1;   transform: scale(1.08); }
  }
`;

function ensureStyle() {
  if (document.getElementById("v4-tool-cursor-style")) return;
  const s = document.createElement("style");
  s.id = "v4-tool-cursor-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

export const SanctuaryCursorModule = {
  name: "SanctuaryCursor",

  _el: null,
  _onMove: null,
  _currentTool: null,
  _frame: 0,

  async load() {
    ensureStyle();
    const el = document.createElement("div");
    el.id = "v4-tool-cursor";
    el.textContent = TOOL_GLYPHS.grow_hill;
    document.body.appendChild(el);
    this._el = el;

    this._onMove = (e) => {
      // Cheap: just update transform. Even at 240 Hz mouse this is < 0.1 ms.
      this._el.style.transform = `translate(${e.clientX - 22}px, ${e.clientY - 22}px)`;
    };
    window.addEventListener("mousemove", this._onMove);

    console.log(
      "%c[Sanctuary] 🖐 Tool cursor online — follows the mouse in top-down view.",
      "color:#ffd97a;font-weight:bold;",
    );
  },

  update() {
    if (!this._el) return;
    // Cheap state sync — run every frame to mirror palette tool +
    // top-down body class onto the cursor element. No DOM thrashing
    // unless something changed.
    const tool = typeof window !== "undefined" ? window.__sanctuaryMoldTool : null;
    const inTopDown = document.body.classList.contains("v4-top-down-view");
    if (tool !== this._currentTool) {
      this._currentTool = tool;
      this._el.textContent = tool && TOOL_GLYPHS[tool] ? TOOL_GLYPHS[tool] : "";
    }
    const wantArmed = !!(tool && inTopDown);
    this._el.classList.toggle("armed", wantArmed);
    document.body.classList.toggle("v4-tool-active", wantArmed);
  },

  unload() {
    if (this._onMove) window.removeEventListener("mousemove", this._onMove);
    if (this._el?.parentNode) this._el.parentNode.removeChild(this._el);
    const s = document.getElementById("v4-tool-cursor-style");
    if (s?.parentNode) s.parentNode.removeChild(s);
    document.body.classList.remove("v4-tool-active");
    this._el = null;
    this._onMove = null;
  },
};
