import { getRuntimeService, registerRuntimeService } from "./RuntimeServices.js";
import { getFrameBudgetSnapshot } from "./anu/FrameBudget.js";
import { pipCompassRingRotationDegFromYawRad } from "./pipCompassMath.js";

export const WebFontsService = {
  _loaded: new Set(),
  loadFont(id, href) {
    if (this._loaded.has(id) || document.getElementById(id)) {
      this._loaded.add(id);
      return;
    }
    const l = document.createElement("link");
    l.id = id;
    l.rel = "stylesheet";
    l.href = href;
    document.head.appendChild(l);
    this._loaded.add(id);
    console.log(`[WebFontsService] 🔤 Loading font: ${id}`);
  },
  isLoaded(id) {
    return this._loaded.has(id) || !!document.getElementById(id);
  }
};

/*
 * Compass dial — May-10-2026 design restored 2026-10-22 (user: "the design was far superior then";
 * "use the moon phase rings - just align them center in each radial").
 *
 * Two concentric tracks that no longer overlap (on May 10 the moon ring covered half the compass
 * band, so N/S/E/W were half hidden):
 *
 *   wrapper radius R = --pip-size / 2
 *   compass track  R+8  … R+28   (20 px)  N/S/E/W centred on radius R+18, rotate with heading
 *   moon track     R-18 … R+8    (26 px)  8 moon phases centred on radius R-5, fixed
 *   map visible    0    … R-18            (same visible map radius as before this change)
 *
 * Every letter and moon is placed from the dial centre with translate(-50%,-50%), so it sits
 * exactly on its track's midline at any size (--pip-size is clamp()ed with the viewport).
 */
const LUNAR_PHASE_EMOJI = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];
const LUNAR_PHASE_TITLE = [
  "New moon",
  "Waxing crescent",
  "First quarter",
  "Waxing gibbous",
  "Full moon",
  "Waning gibbous",
  "Last quarter",
  "Waning crescent",
];

/** Phase 0–7 for a date (or the child's pinned choice). Same maths as the May-10 dial. */
function lunarPhaseIndexFromDate(date, manualIndex) {
  if (manualIndex != null) return manualIndex & 7;
  const LUNAR_MONTH = 29.53058867;
  const newMoonEpoch = new Date("2000-01-06T18:14:00Z").getTime();
  const days = (date.getTime() - newMoonEpoch) / (1000 * 60 * 60 * 24);
  const fraction = (((days % LUNAR_MONTH) + LUNAR_MONTH) % LUNAR_MONTH) / LUNAR_MONTH;
  return Math.floor(fraction * 8) % 8;
}

export const UIModule = {
  name: "PanelsPIP",

  _root: null,
  _panelFrame: null,
  _moonFrame: null,
  _compassRing: null,
  _compassMarkers: null,
  _lunarSlots: null,
  _lunarManualIndex: null,
  _lunarShownIndex: -1,
  _lastCompassDeg: null,
  _pipCanvas: null,
  _gameTime: 8,

  load(scene, camera, _renderer, orchestrator) {
    this._orc = orchestrator;

    registerRuntimeService("WebFontsService", WebFontsService, { owner: "UIModule" });
    WebFontsService.loadFont("v2-font-cinzel", "https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&display=swap");
    this._root = document.createElement("div");
    this._root.id = "v2-panels-pip";
    this._root.innerHTML = `
      <style>
        #v2-panels-pip {
          position: fixed; inset: 0; pointer-events: none; z-index: 9800; font-family: Nunito, system-ui, sans-serif;
          /* Dial geometry — every ring, letter and moon below is derived from these. */
          --pip-size: clamp(200px, 25vw, 300px);
          --pip-top: 50px;
          --pip-left: 30px;
          --pip-compass-track: 20px;   /* outer band: N/S/E/W */
          --pip-moon-track: 26px;      /* inner band: moon phases */
          --pip-moon-overlap: 18px;    /* how far the moon band reaches in over the map edge */
          --pip-ring-out: calc(var(--pip-moon-track) - var(--pip-moon-overlap) + var(--pip-compass-track)); /* 28px */
          --pip-void: #120b09;
          --pip-bezel-dark: #1e1210;
          --pip-bronze-hi: #6e5347;
          --pip-bronze-lo: #3d2a24;
          --pip-gold: #c6a035;
          --pip-gold-soft: rgba(232, 212, 148, 0.92);
          --pip-parchment: #f3ece3;
        }
        #v2-side-panel {
          position: fixed; inset: 0; width: 100%; height: 100%;
          border: none; background: transparent; overflow: hidden;
          pointer-events: none; z-index: 9800;
        }
        #panel-frame { width: 100%; height: 100%; border: 0; background: transparent; pointer-events: none; display:none; }

        /* Sacred instrument — bronze / aged gold, soft depth, calm highlights (May-10 look) */
        #pip-compass-wrapper {
          box-sizing: border-box;      /* the game sets this globally; stated here so the maths below holds anywhere */
          position: absolute;
          top: var(--pip-top);
          left: var(--pip-left);
          width: var(--pip-size);
          height: var(--pip-size);
          z-index: 3500;
          border-radius: 50%;
          pointer-events: auto;
          cursor: default;
          overflow: visible;
          isolation: isolate;
          background:
            radial-gradient(circle at 32% 26%, rgba(110, 90, 72, 0.14) 0%, transparent 45%),
            radial-gradient(circle at 50% 112%, rgba(0, 0, 0, 0.35) 0%, transparent 42%),
            var(--pip-void);
          border: 1px solid rgba(230, 210, 175, 0.12);
          box-shadow:
            0 0 0 4px var(--pip-bezel-dark),
            0 0 0 5px rgba(0, 0, 0, 0.55),
            0 28px 56px rgba(0, 0, 0, 0.58),
            0 10px 22px rgba(0, 0, 0, 0.38),
            inset 0 -14px 32px rgba(0, 0, 0, 0.42);
        }
        #pip-compass-wrapper::after {
          content: '';
          position: absolute;
          inset: calc(-1 * var(--pip-ring-out));
          border-radius: 50%;
          pointer-events: none;
          z-index: 9;
          box-shadow: 0 0 24px rgba(198, 160, 53, 0.08);
          opacity: 0.85;
        }

        #v2-pip-canvas {
            position: absolute;
            inset: 6px;
            width: calc(100% - 12px);
            height: calc(100% - 12px);
            border: none;
            border-radius: 50%;
            pointer-events: none;
            z-index: 2;
            filter: contrast(1.025) saturate(1.06) brightness(1.015);
        }

        /* Glass over the map: shade, glaze and the raised inner lens (decoration only). */
        .pip-optics-stack {
          position: absolute; inset: 0; border-radius: 50%;
          pointer-events: none; z-index: 3; overflow: hidden;
          -webkit-mask-image: radial-gradient(circle closest-side, black calc(100% - var(--pip-moon-overlap) - 1px), transparent calc(100% - var(--pip-moon-overlap)));
          mask-image: radial-gradient(circle closest-side, black calc(100% - var(--pip-moon-overlap) - 1px), transparent calc(100% - var(--pip-moon-overlap)));
        }
        .pip-optics-shade {
          position: absolute; inset: 0; border-radius: 50%;
          background:
            radial-gradient(ellipse 125% 92% at 50% 108%, rgba(12, 24, 36, 0.18) 0%, transparent 50%),
            radial-gradient(circle at 50% 50%, transparent 55%, rgba(0, 0, 0, 0.11) 100%),
            radial-gradient(ellipse 70% 55% at 28% 22%, rgba(255, 255, 255, 0.07) 0%, transparent 45%);
          box-shadow:
            inset 0 2px 4px rgba(255, 255, 255, 0.2),
            inset 0 -18px 40px rgba(0, 0, 0, 0.2);
        }
        .pip-optics-glaze {
          position: absolute; inset: 0; border-radius: 50%;
          background: radial-gradient(ellipse 98% 74% at 30% 22%, rgba(255, 253, 248, 0.26) 0%, rgba(255, 255, 255, 0.04) 32%, transparent 54%);
          mix-blend-mode: soft-light;
          opacity: 0.62;
        }
        .pip-lens {
          position: absolute; inset: 12%; border-radius: 50%;
          pointer-events: none; z-index: 4;
          box-shadow:
            inset 0 0 0 1px rgba(255, 255, 255, 0.28),
            inset 4px 10px 22px rgba(255, 255, 255, 0.16),
            inset -8px -16px 28px rgba(0, 0, 0, 0.38);
        }
        .pip-lens::after {
          content: '';
          position: absolute; inset: 0; border-radius: 50%;
          background:
            radial-gradient(ellipse 88% 72% at 32% 24%, rgba(255, 255, 255, 0.28) 0%, transparent 50%),
            radial-gradient(circle at 50% 88%, rgba(15, 22, 32, 0.12) 0%, transparent 44%);
          mix-blend-mode: soft-light;
          opacity: 0.72;
        }

        /* Click/tap on the visible map toggles the view. Limited to the map circle so it
           never sits on top of the moon buttons. */
        #pip-click-zone {
            position: absolute;
            inset: var(--pip-moon-overlap);
            z-index: 5;
            border-radius: 50%;
            cursor: pointer;
            pointer-events: auto;
        }

        .pip-ring-bronze {
          background: conic-gradient(
            from -18deg,
            var(--pip-bronze-lo) 0%, var(--pip-bronze-hi) 6%, var(--pip-bronze-lo) 14%, #574238 22%,
            var(--pip-bronze-lo) 32%, var(--pip-bronze-hi) 42%, var(--pip-bronze-lo) 52%, #4a362e 64%,
            var(--pip-bronze-hi) 75%, var(--pip-bronze-lo) 88%, #35241f 100%
          );
          border: 1px solid rgba(18, 10, 8, 0.9);
          box-shadow:
            inset 0 2px 6px rgba(255, 248, 235, 0.12),
            inset 0 -10px 22px rgba(0, 0, 0, 0.55),
            0 6px 18px rgba(0, 0, 0, 0.45);
        }

        /* Outer track — rotates with the player's heading (UIModule._syncCompass). */
        .compass-outer-ring {
          position: absolute;
          inset: calc(-1 * var(--pip-ring-out));
          border-radius: 50%;
          pointer-events: none;
          z-index: 6;
          will-change: transform;
          transform-origin: center;
          -webkit-mask-image: radial-gradient(circle closest-side, transparent calc(100% - var(--pip-compass-track)), black calc(100% - var(--pip-compass-track) + 1px));
          mask-image: radial-gradient(circle closest-side, transparent calc(100% - var(--pip-compass-track)), black calc(100% - var(--pip-compass-track) + 1px));
        }
        .compass-outer-ring::before {
          content: '';
          position: absolute; inset: 2px; border-radius: 50%; pointer-events: none;
          background: repeating-conic-gradient(from 0deg,
            rgba(22, 14, 11, 0.4) 0deg, rgba(22, 14, 11, 0.4) 0.75deg,
            transparent 0.75deg, transparent 17.25deg);
          -webkit-mask-image: radial-gradient(circle closest-side, transparent calc(100% - 7px), black calc(100% - 6px));
          mask-image: radial-gradient(circle closest-side, transparent calc(100% - 7px), black calc(100% - 6px));
        }
        /* Each letter's centre sits on the compass track midline (half a track in from the edge).
           _syncCompass adds rotate(-heading) after translate(-50%,-50%) so letters stay upright
           and stay centred. */
        .compass-marker {
          position: absolute;
          color: var(--pip-parchment);
          font-family: 'Cinzel', Georgia, serif;
          font-size: clamp(12px, 2.9vw, 15px);
          font-weight: 700;
          letter-spacing: 0.06em;
          line-height: 1;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9), 0 0 12px rgba(198, 160, 53, 0.2);
          transform: translate(-50%, -50%);
          z-index: 2;
        }
        /* -1px / +1px: the ring's 1px border sits outside the box these offsets are measured from. */
        .compass-marker.n { left: 50%; top: calc(var(--pip-compass-track) / 2 - 1px); color: var(--pip-gold-soft); }
        .compass-marker.s { left: 50%; top: calc(100% - var(--pip-compass-track) / 2 + 1px); }
        .compass-marker.e { top: 50%; left: calc(100% - var(--pip-compass-track) / 2 + 1px); }
        .compass-marker.w { top: 50%; left: calc(var(--pip-compass-track) / 2 - 1px); }

        /* Inner track — the eight moon phases. Fixed (does not rotate). */
        .lunar-radial-ring {
          position: absolute; inset: 0; border-radius: 50%;
          pointer-events: none; z-index: 7;
          --pip-moon-r: calc(var(--pip-size) / 2 - 1px + var(--pip-moon-track) / 2 - var(--pip-moon-overlap)); /* R-5; -1px = wrapper border */
        }
        .lunar-radial-rim {
          position: absolute;
          inset: calc(var(--pip-moon-overlap) - var(--pip-moon-track)); /* -8px: outer edge R+8 */
          border-radius: 50%;
          pointer-events: none;
          -webkit-mask-image: radial-gradient(circle closest-side, transparent calc(100% - var(--pip-moon-track)), black calc(100% - var(--pip-moon-track) + 1px));
          mask-image: radial-gradient(circle closest-side, transparent calc(100% - var(--pip-moon-track)), black calc(100% - var(--pip-moon-track) + 1px));
        }
        .lunar-radial-rim::before {
          content: '';
          position: absolute; inset: 2px; border-radius: 50%; pointer-events: none;
          background: repeating-conic-gradient(from 22.5deg,
            rgba(22, 14, 11, 0.42) 0deg, rgba(22, 14, 11, 0.42) 0.75deg,
            transparent 0.75deg, transparent 45deg);
          -webkit-mask-image: radial-gradient(circle closest-side, transparent calc(100% - var(--pip-moon-track) + 2px), black calc(100% - var(--pip-moon-track) + 3px));
          mask-image: radial-gradient(circle closest-side, transparent calc(100% - var(--pip-moon-track) + 2px), black calc(100% - var(--pip-moon-track) + 3px));
        }
        /* Moons: placed from the dial centre at angle --a, then rotated back so they stay upright.
           Their centre is exactly on the moon track midline at every --pip-size. */
        .lunar-phase-slot {
          --a: 0deg;
          --s: 1;
          position: absolute;
          left: 50%;
          top: 50%;
          width: calc(var(--pip-moon-track) - 2px);
          height: calc(var(--pip-moon-track) - 2px);
          transform: translate(-50%, -50%) rotate(var(--a)) translateY(calc(-1 * var(--pip-moon-r))) rotate(calc(-1 * var(--a))) scale(var(--s));
          pointer-events: auto;
          border: none;
          background: transparent;
          border-radius: 50%;
          font-size: calc(var(--pip-moon-track) * 0.66);
          line-height: 1;
          padding: 0;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.65), 0 0 1px rgba(0, 0, 0, 0.4);
          filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.45));
          opacity: 0.82;
          transition: transform 0.32s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.28s ease, filter 0.28s ease, box-shadow 0.28s ease;
          -webkit-tap-highlight-color: transparent;
        }
        .lunar-phase-slot.slot-0 { --a: 0deg; }
        .lunar-phase-slot.slot-1 { --a: 45deg; }
        .lunar-phase-slot.slot-2 { --a: 90deg; }
        .lunar-phase-slot.slot-3 { --a: 135deg; }
        .lunar-phase-slot.slot-4 { --a: 180deg; }
        .lunar-phase-slot.slot-5 { --a: 225deg; }
        .lunar-phase-slot.slot-6 { --a: 270deg; }
        .lunar-phase-slot.slot-7 { --a: 315deg; }
        .lunar-phase-slot:hover { --s: 1.08; opacity: 1; filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.5)) drop-shadow(0 0 12px rgba(198, 160, 53, 0.35)); }
        .lunar-phase-slot.active-phase {
          --s: 1.06;
          opacity: 1;
          filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.5)) drop-shadow(0 0 16px rgba(198, 160, 53, 0.55));
          box-shadow: inset 0 0 0 2px rgba(198, 160, 53, 0.7); /* inside the moon, so it never spills off the track */
        }
        .lunar-phase-slot:focus-visible { outline: 2px solid var(--pip-gold); outline-offset: 2px; }

        /* Heading pointer — a small glass tab just outside the top of the dial. Its arrow tip
           stops at the ring's outer edge, so it never covers N or the top moon. */
        .pip-heading-bracket {
          position: absolute;
          left: 50%;
          top: calc(-1 * var(--pip-ring-out) - 16px);
          transform: translateX(-50%);
          width: 28px;
          height: 16px;
          border-radius: 9px 9px 5px 5px;
          pointer-events: none;
          z-index: 10;
          border: 1px solid rgba(255, 255, 255, 0.38);
          border-bottom: none;
          background: linear-gradient(168deg, rgba(255, 255, 255, 0.22) 0%, rgba(255, 255, 255, 0.06) 48%, rgba(200, 210, 220, 0.05) 100%);
          box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.65), 0 -2px 10px rgba(0, 0, 0, 0.25);
          /* static frost, no live blur over the game canvas (claude/finding-live-blur-fps.md) */
        }
        .pip-heading-bracket::after {
          content: '';
          position: absolute;
          left: 50%;
          bottom: 1px;
          transform: translateX(-50%);
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-top: 8px solid #fffdf5;
          filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.7)) drop-shadow(0 0 6px rgba(198, 160, 53, 0.55));
        }

        #v2-distance-pill {
          position: absolute;
          --pill-center: calc(var(--pip-left) + var(--pip-size) / 2);
          left: var(--pill-center);
          top: calc(var(--pip-top) + var(--pip-size) + var(--pip-ring-out) + 10px);
          /* Centred under the dial, but never past the screen's left edge (8px margin). */
          transform: translateX(max(-50%, calc(8px - var(--pill-center))));
          padding: 8px 16px;
          border-radius: 999px;
          color: rgba(232, 212, 148, 0.92);
          background: linear-gradient(165deg, rgba(28, 18, 14, 0.94) 0%, rgba(14, 10, 8, 0.90) 100%);
          border: 1px solid rgba(198, 160, 53, 0.42);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          white-space: nowrap;
          box-shadow:
            0 10px 28px rgba(0, 0, 0, 0.5),
            0 2px 6px rgba(0, 0, 0, 0.35),
            inset 0 1px 0 rgba(255, 220, 140, 0.18),
            inset 0 -1px 0 rgba(0, 0, 0, 0.45);
        }

        @media (max-width: 768px) {
          #v2-distance-pill {
            font-size: 9px;
            padding: 5px 12px;
            letter-spacing: 0.06em;
            top: calc(var(--pip-top) + var(--pip-size) + var(--pip-ring-out) + 6px);
          }
        }
        /* Touch devices: index.html scales the dial to 0.5 from its top-left corner, so the pill
           follows the scaled dial (centre and bottom) instead of the unscaled box. */
        @media (pointer: coarse) {
          #v2-distance-pill {
            --pill-center: calc(var(--pip-left) + var(--pip-size) / 4);
            top: calc(var(--pip-top) + var(--pip-size) / 2 + var(--pip-ring-out) / 2 + 6px);
          }
        }
      </style>
      <div id="v2-side-panel"><iframe id="panel-frame" title="Sacred Adventures Panel"></iframe></div>
      <div id="v2-distance-pill">POS: 0.0, 0.0, 0.0 | YAW: 0.00</div>
      <div id="pip-compass-wrapper" title="Sacred Adventures — compass minimap">
        <canvas id="v2-pip-canvas" width="512" height="512"></canvas>
        <div class="pip-optics-stack" aria-hidden="true">
          <div class="pip-optics-shade"></div>
          <div class="pip-optics-glaze"></div>
        </div>
        <div class="pip-lens" aria-hidden="true"></div>
        <div id="pip-click-zone" title="Toggle minimap view"></div>
        <div class="compass-outer-ring pip-ring-bronze">
          <span class="compass-marker n">N</span>
          <span class="compass-marker s">S</span>
          <span class="compass-marker e">E</span>
          <span class="compass-marker w">W</span>
        </div>
        <div class="lunar-radial-ring" role="group" aria-label="Moon phases">
          <div class="lunar-radial-rim pip-ring-bronze" aria-hidden="true"></div>
          ${LUNAR_PHASE_EMOJI.map(
            (emoji, i) =>
              `<button type="button" class="lunar-phase-slot slot-${i}" data-phase="${i}" title="${LUNAR_PHASE_TITLE[i]}" aria-label="${LUNAR_PHASE_TITLE[i]}" aria-pressed="false">${emoji}</button>`,
          ).join("")}
        </div>
        <div class="pip-heading-bracket" aria-hidden="true"></div>
      </div>
    `;
    document.body.appendChild(this._root);
    this._panelFrame = this._root.querySelector("#panel-frame");
    this._moonFrame = null;
    this._compassRing = this._root.querySelector(".compass-outer-ring");
    this._compassMarkers = Array.from(this._root.querySelectorAll(".compass-marker"));
    this._lunarSlots = Array.from(this._root.querySelectorAll(".lunar-phase-slot"));
    this._pipCanvas = this._root.querySelector("#v2-pip-canvas");

    const toggle = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const player = getRuntimeService("WorldPlayer") ?? window.WorldPlayer;
      const next = player?.toggleMainCanvasMapView?.();
      window.postMessage({ type: "TOGGLE_VIEW_MODE" }, "*");
    };
    this._root.querySelector("#pip-click-zone")?.addEventListener("click", toggle);

    // Moon phases: today's real phase lights up; tapping a moon pins it, tapping it again unpins.
    for (const btn of this._lunarSlots) {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const i = Number.parseInt(btn.getAttribute("data-phase"), 10);
        this._lunarManualIndex = this._lunarManualIndex === i ? null : i;
        this._syncLunarPhase();
      });
    }
    this._lunarShownIndex = -1;
    this._syncLunarPhase();

    const hint = document.getElementById("v2-hint");
    if (hint) hint.style.display = "none";
    this._panelFrame.src = "about:blank";

    console.log(
      "%c[PanelsPIP] Compass + moon-phase dial (May-10 design, centred tracks).",
      "color:#81d4fa;font-weight:bold;",
    );
  },

  update(_delta, frameCount) {
    const player = getRuntimeService("WorldPlayer") ?? window.WorldPlayer;
    if (!player) return;

    this._gameTime = (this._gameTime + _delta * 0.035) % 24;

    const pill = this._root && this._root.querySelector("#v2-distance-pill");
    if (pill && frameCount % 10 === 0) {
      const x = player.feet.x.toFixed(1);
      const y = player.feet.y.toFixed(1);
      const z = player.feet.z.toFixed(1);
      const yaw = player.yaw.toFixed(2);

      let fpsVal = 0;
      if (this._orc) {
        fpsVal = this._orc._fpsReady ? this._orc.smoothFPS : this._orc.rawFPS;
      }
      if (!(fpsVal > 0)) {
        const snap = getFrameBudgetSnapshot();
        const ms = snap.avgMs > 0 ? snap.avgMs : snap.lastMs;
        fpsVal = ms > 0 ? 1000 / ms : 0;
      }
      const fpsStr = fpsVal > 0 ? ` | FPS: ${Math.round(fpsVal)}` : "";

      pill.textContent = `POS: ${x}, ${y}, ${z} | YAW: ${yaw}${fpsStr}`;
    }

    this._syncCompass(player.yaw);
    // The moon phase only changes over days; checking every ~10 s is plenty.
    if (frameCount % 600 === 0) this._syncLunarPhase();
  },

  _syncCompass(yaw) {
    const deg = pipCompassRingRotationDegFromYawRad(yaw);
    if (!this._compassRing || deg === this._lastCompassDeg) return; // no style writes while not turning
    this._lastCompassDeg = deg;
    this._compassRing.style.transform = `rotate(${deg}deg)`;
    // Same translate as the CSS, so each letter stays centred on the track while it counter-rotates.
    const t = `translate(-50%, -50%) rotate(${-deg}deg)`;
    for (const marker of this._compassMarkers) marker.style.transform = t;
  },

  _syncLunarPhase() {
    if (!this._lunarSlots) return;
    const idx = lunarPhaseIndexFromDate(new Date(), this._lunarManualIndex);
    if (idx === this._lunarShownIndex) return;
    this._lunarShownIndex = idx;
    this._lunarSlots.forEach((el, i) => {
      const on = i === idx;
      el.classList.toggle("active-phase", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    });
  },

  unload() {
    if (this._root) this._root.remove();
    this._root = null;
    this._panelFrame = null;
    this._moonFrame = null;
    this._compassRing = null;
    this._compassMarkers = null;
    this._lunarSlots = null;
    this._lunarManualIndex = null;
    this._lunarShownIndex = -1;
    this._lastCompassDeg = null;
    this._pipCanvas = null;

    const hint = document.getElementById("v2-hint");
    if (hint) hint.style.display = "";
    console.log("[PanelsPIP] ⏹ Unloaded.");
  }
};
