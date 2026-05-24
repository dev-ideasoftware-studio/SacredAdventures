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

const STORAGE_KEY = "sanctuary.welcomeGuide.seenV1";

const STEPS = [
  {
    title: "Welcome, friend.",
    body:
      "You've arrived at the Sacred Sanctuary — a small grove around a quiet pool. Take a breath. There's nothing to rush.",
  },
  {
    title: "Move with WASD or arrows.",
    body:
      "Press <b>W</b> or <b>↑</b> to walk forward. <b>S</b> turns left, <b>D</b> turns right. <b>Space</b> is for the occasional jump.",
  },
  {
    title: "Open the journal with J.",
    body:
      "Press <b>J</b> any time to open your Sacred Journal. The <b>P</b> key toggles the side panel with all the action chips.",
  },
  {
    title: "Fish &amp; harvest.",
    body:
      "Walk onto the gold ring by the dock to fish the pool. Right-click flowers, bushes, mushrooms and fish to gather them into your bag.",
  },
  {
    title: "Click to Explore!",
    body:
      "You can also tap or click directly anywhere on the green grass or the shoreline of the pond to walk there directly! Let's explore the sanctuary!",
  },
];

function _injectStylesOnce() {
  if (document.getElementById("sanctuary-welcome-guide-css")) return;
  const st = document.createElement("style");
  st.id = "sanctuary-welcome-guide-css";
  st.textContent = `
    /* ── Welcome Guide overlay ──────────────────────────────────── */
    #sanctuary-welcome-guide {
      position: fixed;
      top: 18px;
      left: 50%;
      transform: translateX(-50%);
      width: min(640px, calc(100vw - 32px));
      z-index: 9000;
      padding: 18px 28px 22px;
      border-radius: 22px;
      pointer-events: auto;
      user-select: none;
      font-family: 'Fredoka', 'Segoe UI', sans-serif;
      background: rgba(22, 16, 10, 0.32);
      border: 1px solid rgba(251, 192, 45, 0.35);
      box-shadow:
        0 12px 40px rgba(0,0,0,0.45),
        inset 0 1px 0 rgba(255, 220, 140, 0.22),
        inset 0 0 22px rgba(255, 200, 110, 0.06);
      backdrop-filter: blur(18px) saturate(140%);
      -webkit-backdrop-filter: blur(18px) saturate(140%);
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
    #sanctuary-welcome-guide .swg-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: rgba(255, 248, 220, 0.28);
      transition: background 0.25s, transform 0.25s;
    }
    #sanctuary-welcome-guide .swg-dot.is-active {
      background: #fbc02d;
      transform: scale(1.25);
      box-shadow: 0 0 8px rgba(251, 192, 45, 0.6);
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
      transition: transform 0.12s, box-shadow 0.18s, filter 0.18s;
    }
    #sanctuary-welcome-guide .swg-next:hover,
    #sanctuary-welcome-guide .swg-next:focus {
      filter: brightness(1.06);
      transform: translateY(-1px);
      outline: none;
    }
    #sanctuary-welcome-guide .swg-next:active {
      transform: translateY(0);
    }

    /* Mobile (≤ 768 px): shrink type + spacing so the guide fits on phones */
    @media (max-width: 768px) {
      #sanctuary-welcome-guide {
        top: 12px;
        padding: 14px 18px 16px;
        border-radius: 16px;
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
        <button type="button" class="swg-skip" data-swg-skip>Skip</button>
        <button type="button" class="swg-next" data-swg-next>Next <span style="margin-left:4px">→</span></button>
      </div>
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

    // Show ~1.8 s after boot if the player hasn't dismissed it before
    let alreadySeen = false;
    try { alreadySeen = localStorage.getItem(STORAGE_KEY) === "1"; } catch (_e) {}
    if (!alreadySeen) {
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
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch (_e) {}
  },
};
