/**
 * Sacred Adventures — sanctuary: Welcome Guide.
 *
 * 5-page tutorial overlay shown on first visit (persisted via
 * localStorage). Visual language: 1:1 with the user's preserved screenshot
 * — warm-tone transparent dark background, gold "WELCOME GUIDE" pill,
 * gold title, cream body, page-dots / Skip / Next controls.
 *
 * Palette borrowed from the OrchestratorHud so the guide reads as part of
 * the same visual world:
 *   bg    : linear-gradient warm browns + 80 % opacity (translucent)
 *   gold  : #fbc02d / #c6a035
 *   cream : #fff7d0 / #ffe9a8
 *   border: rgba(251,192,45,0.42)
 *
 * Behaviour:
 *   • Auto-shows ~1.8 s after orchestrator boot (gives the player a
 *     moment to see the world before the modal lands).
 *   • Skip / Next / Prev buttons + page dots.
 *   • Esc closes (and persists as "seen").
 *   • Once seen, won't reappear unless `sanctuaryWelcome.reset()` is
 *     called from DevTools.
 *
 * No external deps — pure DOM + CSS. ~500 tris equivalent in cost terms:
 * zero scene draw calls.
 */

const STORAGE_KEY = "sanctuary.welcomeGuide.seenV2";

const STEPS = [
  {
    title: "Welcome, friend.",
    body:
      "You've arrived at the Sacred Sanctuary — a small grove around a quiet pool. Take a breath. There's nothing to rush.",
  },
  {
    title: "Steer &amp; Move",
    body:
      "Press <b>W / S</b> or <b>↑ / ↓</b> to walk forward or backward. Press <b>A / D</b> to strafe left or right. Use <b>Q / E</b> or <b>← / →</b> to turn left or right.",
  },
  {
    title: "Click to Walk",
    body:
      "You can also tap or click directly anywhere on the green grass or the shoreline of the pond to walk there directly!",
  },
  {
    title: "The Gold Ring",
    body:
      "Walk onto the <b>gold ring</b> by the dock to fish the pool. Keep the needle in the yellow segment to catch the fish!",
  },
  {
    title: "Open the Journal",
    body:
      "Press <b>J</b> any time to open your Sacred Journal. Press <b>P</b> to toggle the side panel, and right-click to harvest flora/fauna.",
  },
];

function _injectStylesOnce() {
  if (document.getElementById("sanctuary-welcome-guide-css")) return;
  const st = document.createElement("style");
  st.id = "sanctuary-welcome-guide-css";
  st.textContent = `
    /* ── Welcome Guide overlay ──────────────────────────────────────
     * Centered horizontally on screen, anchored in the TOP THIRD of the
     * viewport so it floats above the player model without ever covering
     * the avatar. Highest practical z-index — must sit on top of every
     * other HUD layer (PIP / OrchestratorHud / Panels / banner / etc.).
     * ──────────────────────────────────────────────────────────────── */
    #sanctuary-welcome-guide {
      position: fixed;
      top: 350px;                               /* directly under PIP */
      left: 50%;                                /* center anchor */
      transform: translateX(-50%);
      width: min(560px, calc(100vw - 60px));
      z-index: 2147483600;                      /* near MAX_INT32 */
      padding: 28px 32px 24px;
      border-radius: 22px;
      pointer-events: auto;
      user-select: none;
      font-family: 'Fredoka', 'Segoe UI', sans-serif;
      background: linear-gradient(165deg, rgba(30, 20, 8, 0.72) 0%, rgba(44, 29, 9, 0.72) 55%, rgba(26, 17, 6, 0.72) 100%);
      border: 1px solid rgba(251, 192, 45, 0.42);
      box-shadow:
        0 16px 48px rgba(0,0,0,0.55),
        0 2px 8px rgba(0,0,0,0.45),
        inset 0 1px 0 rgba(255, 220, 140, 0.25),
        inset 0 0 28px rgba(255, 200, 110, 0.06);
      backdrop-filter: blur(22px) saturate(160%);
      -webkit-backdrop-filter: blur(22px) saturate(160%);
      transition: opacity 0.35s ease, transform 0.35s ease;
      text-align: center;
    }
    #sanctuary-welcome-guide.is-hidden {
      opacity: 0;
      transform: translateX(-50%) translateY(-12px);
      pointer-events: none;
    }

    /* Title pill: WELCOME GUIDE */
    #sanctuary-welcome-guide .swg-pill {
      display: inline-block;
      margin: -34px auto 8px;
      padding: 7px 18px;
      background: linear-gradient(180deg, #fbc02d 0%, #c6a035 100%);
      color: #1a1108;
      font-weight: 800;
      font-size: 12.5px;
      letter-spacing: 2.5px;
      border-radius: 999px;
      box-shadow:
        0 4px 12px rgba(0,0,0,0.55),
        inset 0 1px 0 rgba(255,255,255,0.4),
        inset 0 -1px 0 rgba(0,0,0,0.3);
    }

    /* Step title */
    #sanctuary-welcome-guide .swg-title {
      color: #fbc02d;
      font-weight: 700;
      font-size: 28px;
      line-height: 1.15;
      margin: 4px 0 12px;
      text-shadow: 0 2px 6px rgba(0,0,0,0.5);
    }

    /* Body text */
    #sanctuary-welcome-guide .swg-body {
      color: rgba(255, 248, 220, 0.92);
      font-size: 16px;
      line-height: 1.55;
      margin: 0 auto 18px;
      max-width: 540px;
      font-weight: 500;
    }
    #sanctuary-welcome-guide .swg-body b {
      color: #fbc02d;
      font-weight: 700;
      letter-spacing: 0.5px;
    }

    /* Footer row: dots · skip · next */
    #sanctuary-welcome-guide .swg-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 8px;
    }

    /* Page dots */
    #sanctuary-welcome-guide .swg-dots {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    /* "[ ] don't show" opt-out — bottom-left corner of the panel */
    #sanctuary-welcome-guide .swg-dontshow {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-top: 10px;
      color: rgba(255, 248, 220, 0.62);
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.3px;
      cursor: pointer;
      user-select: none;
      width: max-content;
    }
    #sanctuary-welcome-guide .swg-dontshow:hover {
      color: rgba(255, 248, 220, 0.92);
    }
    #sanctuary-welcome-guide .swg-dontshow input[type="checkbox"] {
      appearance: none;
      -webkit-appearance: none;
      width: 14px;
      height: 14px;
      border-radius: 3px;
      border: 1.5px solid rgba(251, 192, 45, 0.55);
      background: rgba(14, 10, 6, 0.6);
      cursor: pointer;
      display: inline-grid;
      place-content: center;
      margin: 0;
    }
    #sanctuary-welcome-guide .swg-dontshow input[type="checkbox"]:checked::before {
      content: "✓";
      color: #fbc02d;
      font-size: 12px;
      font-weight: 800;
      line-height: 1;
    }
    #sanctuary-welcome-guide .swg-dontshow input[type="checkbox"]:focus-visible {
      outline: 2px solid rgba(251, 192, 45, 0.7);
      outline-offset: 2px;
    }
    #sanctuary-welcome-guide .swg-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: rgba(255, 248, 220, 0.28);
      transition: background 0.2s ease, box-shadow 0.2s ease;
    }
    #sanctuary-welcome-guide .swg-dot.is-active {
      background: #fbc02d;
      box-shadow: 0 0 8px rgba(251, 192, 45, 0.6);
    }

    /* Prev button — same transparent + border look as Skip, slightly
     * softer so it reads as the secondary/back action. Hidden when on
     * step 0 (toggled via the [data-swg-disabled] attribute). */
    #sanctuary-welcome-guide .swg-prev {
      appearance: none;
      background: transparent;
      color: rgba(255, 248, 220, 0.62);
      border: 1.5px solid rgba(255, 248, 220, 0.28);
      border-radius: 999px;
      padding: 9px 18px;
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.6px;
      cursor: pointer;
      transition: background 0.18s, color 0.18s, border-color 0.18s, opacity 0.18s;
    }
    #sanctuary-welcome-guide .swg-prev:hover,
    #sanctuary-welcome-guide .swg-prev:focus {
      background: rgba(255, 248, 220, 0.06);
      color: #fff7d0;
      border-color: rgba(255, 248, 220, 0.55);
      outline: none;
    }
    #sanctuary-welcome-guide .swg-prev[data-swg-disabled="1"] {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    }

    /* Skip button (transparent + border) */
    #sanctuary-welcome-guide .swg-skip {
      appearance: none;
      background: transparent;
      color: rgba(255, 248, 220, 0.78);
      border: 1.5px solid rgba(255, 248, 220, 0.45);
      border-radius: 999px;
      padding: 9px 22px;
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.8px;
      cursor: pointer;
      transition: background 0.18s, color 0.18s, border-color 0.18s;
    }
    #sanctuary-welcome-guide .swg-skip:hover,
    #sanctuary-welcome-guide .swg-skip:focus {
      background: rgba(255, 248, 220, 0.08);
      color: #fff7d0;
      border-color: rgba(255, 248, 220, 0.7);
      outline: none;
    }

    /* Next button (filled gold) */
    #sanctuary-welcome-guide .swg-next {
      appearance: none;
      background: linear-gradient(180deg, #fbc02d 0%, #c6a035 100%);
      color: #1a1108;
      border: 1px solid rgba(0,0,0,0.25);
      border-radius: 999px;
      padding: 10px 24px;
      font-family: inherit;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.5px;
      cursor: pointer;
      box-shadow:
        0 3px 10px rgba(0,0,0,0.45),
        inset 0 1px 0 rgba(255,255,255,0.4),
        inset 0 -1px 0 rgba(0,0,0,0.3);
      transition: box-shadow 0.15s ease, filter 0.15s ease;
    }
    #sanctuary-welcome-guide .swg-next:hover,
    #sanctuary-welcome-guide .swg-next:focus {
      filter: brightness(1.08);
      outline: none;
    }

    /* Mobile (≤ 768 px): top 1/3 viewport centered with calc width */
    @media (max-width: 768px) {
      #sanctuary-welcome-guide {
        top: 8vh;
        bottom: auto;
        left: 50%;
        transform: translateX(-50%);
        width: calc(100vw - 60px);
        padding: 14px 18px 16px;
        border-radius: 16px;
      }
      #sanctuary-welcome-guide.is-hidden {
        transform: translateX(-50%) translateY(-12px);
        opacity: 0;
        pointer-events: none;
      }
      #sanctuary-welcome-guide .swg-pill {
        margin-top: -26px;
        padding: 5px 14px;
        font-size: 10.5px;
        letter-spacing: 2px;
      }
      #sanctuary-welcome-guide .swg-title { font-size: 21px; margin-bottom: 8px; }
      #sanctuary-welcome-guide .swg-body  { font-size: 13px; line-height: 1.5; margin-bottom: 12px; }
      #sanctuary-welcome-guide .swg-skip  { padding: 7px 16px; font-size: 12px; }
      #sanctuary-welcome-guide .swg-next  { padding: 8px 18px; font-size: 13px; }
      #sanctuary-welcome-guide .swg-dot   { width: 6px; height: 6px; }
    }
  `;
  document.head.appendChild(st);
}

export const SanctuaryWelcomeGuideModule = {
  name: "SanctuaryWelcomeGuide",

  _root: null,
  _step: 0,
  _showTimer: 0,

  async load() {
    if (typeof document === "undefined") return;
    _injectStylesOnce();

    const root = document.createElement("div");
    root.id = "sanctuary-welcome-guide";
    root.className = "is-hidden"; // start hidden; show after boot delay
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "false");
    root.setAttribute("aria-label", "Welcome Guide");
    root.innerHTML = `
      <div class="swg-pill">WELCOME GUIDE</div>
      <div class="swg-title"   data-swg-title>—</div>
      <div class="swg-body"    data-swg-body>—</div>
      <div class="swg-footer">
        <div class="swg-dots" data-swg-dots></div>
        <button type="button" class="swg-prev" data-swg-prev aria-label="Previous step"><span style="margin-right:4px">←</span> Prev</button>
        <button type="button" class="swg-skip" data-swg-skip>Skip</button>
        <button type="button" class="swg-next" data-swg-next>Next <span style="margin-left:4px">→</span></button>
      </div>
      <label class="swg-dontshow" data-swg-dontshow-label>
        <input type="checkbox" data-swg-dontshow aria-label="Don't show this welcome guide again">
        <span>don't show</span>
      </label>
    `;
    document.body.appendChild(root);
    this._root = root;

    // Build the page-dots
    const dotsEl = root.querySelector("[data-swg-dots]");
    for (let i = 0; i < STEPS.length; i++) {
      const d = document.createElement("div");
      d.className = "swg-dot";
      d.setAttribute("aria-hidden", "true");
      dotsEl.appendChild(d);
    }

    // Wire buttons
    root.querySelector("[data-swg-skip]")
      .addEventListener("click", () => this._close());
    root.querySelector("[data-swg-next]")
      .addEventListener("click", () => this._next());
    root.querySelector("[data-swg-prev]")
      .addEventListener("click", () => this._prev());

    // "don't show" checkbox — initial state from localStorage, persist on change
    const cb = root.querySelector("[data-swg-dontshow]");
    let dontShow = false;
    try { dontShow = localStorage.getItem(STORAGE_KEY) === "1"; } catch (_e) {}
    cb.checked = dontShow;
    cb.addEventListener("change", () => {
      try { localStorage.setItem(STORAGE_KEY, cb.checked ? "1" : "0"); } catch (_e) {}
    });

    // Keyboard
    window.addEventListener("keydown", (e) => {
      if (this._root?.classList.contains("is-hidden")) return;
      if (e.key === "Escape") { e.preventDefault(); this._close(); }
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); this._next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); this._prev(); }
    });

    this._render();

    // Expose DevTools-friendly API to reset / reopen
    window.sanctuaryWelcome = {
      show: () => this._show(),
      close: () => this._close(),
      reset: () => { try { localStorage.removeItem(STORAGE_KEY); } catch (_e) {} this._step = 0; this._show(); },
      currentStep: () => this._step,
    };

    // Show ~1.8 s after boot. ALWAYS shows unless the player has ticked
    // the "don't show" checkbox on a prior visit (which persists the flag).
    let suppress = false;
    try { suppress = localStorage.getItem(STORAGE_KEY) === "1"; } catch (_e) {}
    if (!suppress) {
      this._showTimer = window.setTimeout(() => this._show(), 1800);
    }

    console.log(
      "%c[Sanctuary] 📖 Welcome Guide ready — call sanctuaryWelcome.show() to reopen.",
      "color:#fbc02d;font-weight:bold;",
    );
  },

  _render() {
    if (!this._root) return;
    const step = STEPS[this._step];
    this._root.querySelector("[data-swg-title]").textContent = step.title.replace(/&amp;/g, "&");
    this._root.querySelector("[data-swg-body]").innerHTML = step.body;

    const dots = this._root.querySelectorAll(".swg-dot");
    dots.forEach((d, i) => d.classList.toggle("is-active", i === this._step));

    const nextBtn = this._root.querySelector("[data-swg-next]");
    const isLast = this._step === STEPS.length - 1;
    nextBtn.innerHTML = isLast
      ? `Begin <span style="margin-left:4px">✨</span>`
      : `Next <span style="margin-left:4px">→</span>`;

    // Prev disabled on step 0 (hidden via [data-swg-disabled="1"] CSS).
    const prevBtn = this._root.querySelector("[data-swg-prev]");
    if (prevBtn) prevBtn.setAttribute("data-swg-disabled", this._step === 0 ? "1" : "0");
  },

  _next() {
    if (this._step < STEPS.length - 1) {
      this._step++;
      this._render();
    } else {
      this._close();
    }
  },

  _prev() {
    if (this._step > 0) {
      this._step--;
      this._render();
    }
  },

  _show() {
    if (!this._root) return;
    if (this._showTimer) { clearTimeout(this._showTimer); this._showTimer = 0; }
    this._root.classList.remove("is-hidden");
  },

  _close() {
    if (!this._root) return;
    this._root.classList.add("is-hidden");
    // Note: closing alone does NOT persist a suppression flag — only the
    // "don't show" checkbox controls whether the guide reappears next boot.
  },
};
