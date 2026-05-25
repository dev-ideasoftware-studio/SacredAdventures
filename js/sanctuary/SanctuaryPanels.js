/**
 * Sacred Adventures — sanctuary: SanctuaryPanels.
 *
 * Native DOM port of the three core panels that have lived inside the
 * SacredGame.Panel.html iframe since v2:
 *
 *   1. LEFT  — movement keypad   (W/S/A/D + interact)
 *   2. RIGHT — action ring       (8 actions: items · journal · setup ·
 *                                 camp · eat · heal · track · map)
 *   3. GUIDE — horizontal scroll  (quest / gather / fish / build / log)
 *
 * Mounting them as a sanctuary module instead of an iframe means:
 *   • No iframe boot cost, no postMessage marshalling, no contentWindow
 *     null-checks; the orchestrator and panels share one runtime.
 *   • The same `ACTION` / `OPEN_SETTINGS` / `TOGGLE_VIEW_MODE` events
 *     that index.v4.html already listens for are dispatched as window
 *     postMessages, so all existing routing keeps working unchanged.
 *
 * Visual language: pulled 1:1 from SacredGame.Panel.html (warm leather +
 * brass palette, neumorphic buttons, sacred-pool glow). Emoji icons keep
 * the module dependency-free (no FontAwesome fetch).
 *
 * Mobile-aware: at ≤ 768 px the panels shrink + hug the bottom corners.
 */

const PANEL_ROOT_ID = "sanctuary-panels-root";

// ── Visual constants (warm leather + sacred gold) ──────────────────────
const C = {
  GOLD:        "#fbc02d",
  GOLD_DARK:   "#c6a035",
  CREAM:       "#fff7d0",
  LEATHER_HI:  "rgba(70, 48, 41, 0.78)",
  LEATHER_LO:  "rgba(46, 29, 26, 0.78)",
  BRASS_RIM:   "#8d6e63",
  DARK_ETCH:   "rgba(0, 0, 0, 0.55)",
  GLOW_GOLD:   "rgba(251, 192, 45, 0.55)",
};

// ── Layout: each action button gets an (angle, distance) on its ring ───
const ACTION_RING = [
  { id: "items",   label: "ITEMS",   emoji: "🎒", angle: -90,  verb: "ACTION",            payload: "items"   },
  { id: "journal", label: "JOURNAL", emoji: "📖", angle: -45,  verb: "REQ_OPEN_JOURNAL" },
  { id: "setup",   label: "SETUP",   emoji: "⚙️", angle:   0,  verb: "OPEN_SETTINGS" },
  { id: "camp",    label: "CAMP",    emoji: "⛺", angle:  45,  verb: "ACTION",            payload: "rest"    },
  { id: "eat",     label: "EAT",     emoji: "🍴", angle:  90,  verb: "ACTION",            payload: "eat"     },
  { id: "heal",    label: "HEAL",    emoji: "❤️", angle: 135,  verb: "ACTION",            payload: "heal"    },
  { id: "track",   label: "TRACK",   emoji: "🐾", angle: 180,  verb: "ACTION",            payload: "track"   },
  { id: "map",     label: "MAP",     emoji: "🗺️", angle: -135, verb: "TOGGLE_VIEW_MODE" },
];

const MOVE_KEYPAD = [
  { id: "up",    key: "w",          symbol: "▲", angle: -90, label: "Move Forward"  },
  { id: "left",  key: "arrowleft",  symbol: "◀", angle: 180, label: "Turn Left"     },
  { id: "right", key: "arrowright", symbol: "▶", angle:   0, label: "Turn Right"    },
  { id: "down",  key: "s",          symbol: "▼", angle:  90, label: "Move Backward" },
];

const GUIDE_CARDS = [
  { id: "quest",  emoji: "🎯", title: "Quests",  desc: "Follow path"  },
  { id: "gather", emoji: "🪶", title: "Gather",  desc: "Plants nearby"},
  { id: "fish",   emoji: "🐟", title: "Fish",    desc: "Cast & catch" },
  { id: "build",  emoji: "🛖", title: "Build",   desc: "Place a tipi" },
  { id: "log",    emoji: "📜", title: "Logbook", desc: "Your journey" },
];

function _emit(verb, payload) {
  try {
    window.postMessage({ type: verb, data: payload ?? null, source: "SanctuaryPanels" }, "*");
  } catch (_e) { /* never throw from panels */ }
  // Console breadcrumb for DevTools debugging.
  console.log(`%c[Panels] → ${verb}${payload != null ? ` (${payload})` : ""}`,
              "color:#fbc02d;font-weight:600;");
}

function _synthesizeKey(key, type = "keydown") {
  // Re-dispatch a real KeyboardEvent so SanctuaryKeyboardLook (and any
  // other key listeners) handle the keypad press identically to a real
  // key tap. The keypad becomes pure input syrup, no parallel state.
  const e = new KeyboardEvent(type, {
    key,
    code: key.startsWith("arrow") ? key[0].toUpperCase() + key.slice(1) : `Key${key.toUpperCase()}`,
    bubbles: true, cancelable: true,
  });
  window.dispatchEvent(e);
}

function _injectStyles() {
  if (document.getElementById("sanctuary-panels-css")) return;
  const st = document.createElement("style");
  st.id = "sanctuary-panels-css";
  st.textContent = `
    /* ── SanctuaryPanels root ─────────────────────────────────── */
    #${PANEL_ROOT_ID} {
      position: fixed; inset: 0;
      pointer-events: none;        /* clicks pass through; children opt in */
      z-index: 3500;
      font-family: 'Fredoka', 'Segoe UI', sans-serif;
      user-select: none;
    }

    /* Shared neumorphic button */
    #${PANEL_ROOT_ID} .sp-btn {
      pointer-events: auto;
      width: 60px; height: 60px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      flex-direction: column;
      background: linear-gradient(145deg, ${C.LEATHER_HI}, ${C.LEATHER_LO});
      border: 2px solid ${C.BRASS_RIM};
      color: ${C.CREAM};
      box-shadow:
        0 6px 12px rgba(0,0,0,0.6),
        0 0 0 1px rgba(0,0,0,0.4),
        inset 0 1px 0 rgba(255, 220, 140, 0.18);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      cursor: pointer;
      transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1),
                  box-shadow 0.18s, background 0.18s;
      font-size: 22px;
      line-height: 1;
    }
    #${PANEL_ROOT_ID} .sp-btn:hover {
      transform: scale(1.06);
      box-shadow: 0 8px 16px rgba(0,0,0,0.65), 0 0 0 1px rgba(251,192,45,0.5);
    }
    #${PANEL_ROOT_ID} .sp-btn:active { transform: scale(0.94); }
    #${PANEL_ROOT_ID} .sp-btn:focus-visible {
      outline: 2px solid ${C.GLOW_GOLD};
      outline-offset: 3px;
    }
    #${PANEL_ROOT_ID} .sp-btn-label {
      font-size: 8.5px;
      font-weight: 700;
      letter-spacing: 1px;
      margin-top: 2px;
      opacity: 0.78;
      text-transform: uppercase;
    }

    /* LEFT — movement keypad (bottom-left) */
    #sanctuary-left-panel {
      position: absolute;
      left: 24px; bottom: 24px;
      width: 200px; height: 200px;
    }
    #sanctuary-left-panel .sp-btn {
      position: absolute; top: 50%; left: 50%;
    }
    #sanctuary-left-panel .sp-keypad-center {
      width: 86px; height: 86px;
      transform: translate(-50%, -50%);
      font-size: 24px;
      background: radial-gradient(circle at 30% 30%, ${C.LEATHER_HI}, ${C.LEATHER_LO});
      border-color: ${C.GOLD_DARK};
    }
    #sanctuary-left-panel .sp-keypad-arm {
      transform: translate(-50%, -50%) translate(var(--tx), var(--ty));
    }

    /* RIGHT — action ring (bottom-right) */
    #sanctuary-right-panel {
      position: absolute;
      right: 24px; bottom: 24px;
      width: 240px; height: 240px;
    }
    #sanctuary-right-panel .sp-btn {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%) translate(var(--tx), var(--ty));
    }
    #sanctuary-right-panel .sp-avatar {
      width: 70px; height: 70px;
      border-radius: 50%;
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      background:
        radial-gradient(circle at 32% 28%, rgba(255, 240, 200, 0.18) 0%, transparent 55%),
        linear-gradient(145deg, #3d2a24, #1a1108);
      border: 2px solid ${C.GOLD};
      box-shadow:
        inset 0 2px 6px rgba(0,0,0,0.7),
        0 4px 10px rgba(0,0,0,0.5),
        0 0 16px rgba(251, 192, 45, 0.25);
      display: flex; align-items: center; justify-content: center;
      font-size: 32px;
      pointer-events: auto;
      cursor: pointer;
      z-index: 12;
    }

    /* CENTER — guide cards scroller (bottom-center) */
    #sanctuary-guides-container {
      position: absolute;
      left: 50%; bottom: 30px;
      transform: translateX(-50%);
      display: flex;
      gap: 12px;
      max-width: calc(100vw - 540px);  /* leave room for left + right panels */
      overflow-x: auto;
      padding: 6px 10px 10px;
      scrollbar-width: thin;
      pointer-events: auto;
    }
    #sanctuary-guides-container::-webkit-scrollbar { height: 6px; }
    #sanctuary-guides-container::-webkit-scrollbar-thumb {
      background: rgba(251, 192, 45, 0.35);
      border-radius: 3px;
    }
    #sanctuary-guides-container .sp-guide-card {
      pointer-events: auto;
      flex: 0 0 auto;
      width: 110px;
      padding: 10px 12px;
      border-radius: 14px;
      background: linear-gradient(165deg, rgba(28, 18, 8, 0.78) 0%, rgba(38, 24, 10, 0.72) 100%);
      border: 1px solid rgba(251, 192, 45, 0.35);
      color: ${C.CREAM};
      text-align: center;
      cursor: pointer;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      box-shadow: 0 6px 16px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255, 220, 140, 0.18);
      transition: transform 0.18s, box-shadow 0.2s, border-color 0.2s;
    }
    #sanctuary-guides-container .sp-guide-card:hover {
      transform: translateY(-3px);
      border-color: ${C.GOLD};
      box-shadow: 0 10px 22px rgba(0,0,0,0.55), 0 0 12px rgba(251, 192, 45, 0.25);
    }
    #sanctuary-guides-container .sp-guide-card .sp-guide-emoji {
      font-size: 30px; line-height: 1; margin-bottom: 4px;
    }
    #sanctuary-guides-container .sp-guide-card .sp-guide-title {
      color: ${C.GOLD}; font-weight: 700;
      font-size: 12px; letter-spacing: 0.6px;
      text-transform: uppercase;
    }
    #sanctuary-guides-container .sp-guide-card .sp-guide-desc {
      font-size: 10px; opacity: 0.7; margin-top: 2px;
    }

    /* MOBILE (≤ 768 px): shrink + tighten */
    @media (max-width: 768px) {
      #sanctuary-left-panel  { width: 150px; height: 150px; left: 14px; bottom: 14px; }
      #sanctuary-right-panel { width: 180px; height: 180px; right: 14px; bottom: 14px; }
      #${PANEL_ROOT_ID} .sp-btn { width: 46px; height: 46px; font-size: 17px; }
      #${PANEL_ROOT_ID} .sp-btn-label { font-size: 7px; }
      #sanctuary-left-panel .sp-keypad-center { width: 64px; height: 64px; font-size: 18px; }
      #sanctuary-right-panel .sp-avatar { width: 54px; height: 54px; font-size: 24px; }
      #sanctuary-guides-container {
        bottom: 14px;
        max-width: calc(100vw - 360px);
        gap: 8px;
      }
      #sanctuary-guides-container .sp-guide-card { width: 84px; padding: 7px 9px; }
      #sanctuary-guides-container .sp-guide-card .sp-guide-emoji { font-size: 22px; }
      #sanctuary-guides-container .sp-guide-card .sp-guide-title  { font-size: 10px; }
      #sanctuary-guides-container .sp-guide-card .sp-guide-desc   { font-size: 8.5px; }
    }
  `;
  document.head.appendChild(st);
}

// ── Builders ──────────────────────────────────────────────────────────
function _buildLeftPanel() {
  const wrap = document.createElement("div");
  wrap.id = "sanctuary-left-panel";

  // Center interact button
  const center = document.createElement("button");
  center.type = "button";
  center.className = "sp-btn sp-keypad-center";
  center.setAttribute("aria-label", "Interact");
  center.innerHTML = `<span>◉</span>`;
  center.addEventListener("click", () => _emit("ACTION", "interact"));
  wrap.appendChild(center);

  // Four directional arms
  for (const k of MOVE_KEYPAD) {
    const rad = (k.angle * Math.PI) / 180;
    const r = 70; // arm radius
    const tx = `${Math.cos(rad) * r}px`;
    const ty = `${Math.sin(rad) * r}px`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sp-btn sp-keypad-arm";
    btn.setAttribute("aria-label", k.label);
    btn.dataset.key = k.key;
    btn.style.setProperty("--tx", tx);
    btn.style.setProperty("--ty", ty);
    btn.innerHTML = `<span>${k.symbol}</span>`;

    // Press → keydown; release → keyup (so SanctuaryKeyboardLook integrates).
    const press   = (e) => { e?.preventDefault?.(); _synthesizeKey(k.key, "keydown"); };
    const release = (e) => { e?.preventDefault?.(); _synthesizeKey(k.key, "keyup");   };
    btn.addEventListener("pointerdown", press);
    btn.addEventListener("pointerup",   release);
    btn.addEventListener("pointercancel", release);
    btn.addEventListener("pointerleave",  release);
    wrap.appendChild(btn);
  }
  return wrap;
}

function _buildRightPanel() {
  const wrap = document.createElement("div");
  wrap.id = "sanctuary-right-panel";

  // Center avatar (clicking opens journal as the legacy did)
  const avatar = document.createElement("div");
  avatar.className = "sp-avatar";
  avatar.setAttribute("role", "button");
  avatar.setAttribute("tabindex", "0");
  avatar.setAttribute("aria-label", "Character — opens Journal");
  avatar.innerHTML = `🧒`;
  avatar.addEventListener("click", () => _emit("REQ_OPEN_JOURNAL"));
  wrap.appendChild(avatar);

  // Eight action buttons on a ring
  for (const a of ACTION_RING) {
    const rad = (a.angle * Math.PI) / 180;
    const r = 95;
    const tx = `${Math.cos(rad) * r}px`;
    const ty = `${Math.sin(rad) * r}px`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sp-btn sp-action";
    btn.dataset.action = a.id;
    btn.setAttribute("aria-label", a.label);
    btn.style.setProperty("--tx", tx);
    btn.style.setProperty("--ty", ty);
    btn.innerHTML = `<span>${a.emoji}</span><span class="sp-btn-label">${a.label}</span>`;
    btn.addEventListener("click", () => _emit(a.verb, a.payload));
    wrap.appendChild(btn);
  }
  return wrap;
}

function _buildGuidesContainer() {
  const wrap = document.createElement("div");
  wrap.id = "sanctuary-guides-container";
  wrap.setAttribute("role", "list");
  wrap.setAttribute("aria-label", "Guide cards");
  for (const g of GUIDE_CARDS) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "sp-guide-card";
    card.dataset.guide = g.id;
    card.setAttribute("role", "listitem");
    card.setAttribute("aria-label", `${g.title} — ${g.desc}`);
    card.innerHTML = `
      <div class="sp-guide-emoji">${g.emoji}</div>
      <div class="sp-guide-title">${g.title}</div>
      <div class="sp-guide-desc">${g.desc}</div>
    `;
    card.addEventListener("click", () => _emit("GUIDE_CARD", g.id));
    wrap.appendChild(card);
  }
  return wrap;
}

// ── Module ────────────────────────────────────────────────────────────
export const SanctuaryPanelsModule = {
  name: "SanctuaryPanels",

  _root: null,

  async load() {
    if (typeof document === "undefined") return;
    _injectStyles();

    const root = document.createElement("div");
    root.id = PANEL_ROOT_ID;
    root.appendChild(_buildLeftPanel());
    root.appendChild(_buildRightPanel());
    root.appendChild(_buildGuidesContainer());
    document.body.appendChild(root);
    this._root = root;

    // Expose a tiny API so DevTools / Anu can poke the panels.
    window.sanctuaryPanels = {
      el: () => root,
      hide: () => { root.style.display = "none"; },
      show: () => { root.style.display = ""; },
      toggle: () => { root.style.display = root.style.display === "none" ? "" : "none"; },
    };

    console.log(
      "%c[Sanctuary] 🎛  Panels ready — left keypad · right action ring · guide scroller.",
      "color:#fbc02d;font-weight:bold;",
    );
  },

  unload() {
    if (this._root && this._root.parentNode) {
      this._root.parentNode.removeChild(this._root);
    }
    this._root = null;
    delete window.sanctuaryPanels;
  },
};
