import { dispatchInteraction } from "./anu/InteractionBus.js";
import { ANU_EVENTS } from "./anu/anuEvents.js";
import { getRuntimeService } from "./RuntimeServices.js";

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

function lunarPhaseIndexFromDate(date, manualIndex) {
  if (manualIndex != null) return manualIndex & 7;
  const LUNAR_MONTH = 29.53058867;
  const newMoonEpoch = new Date("2000-01-06T18:14:00Z").getTime();
  const diff = date.getTime() - newMoonEpoch;
  const days = diff / (1000 * 60 * 60 * 24);
  const fraction =
    (((days % LUNAR_MONTH) + LUNAR_MONTH) % LUNAR_MONTH) / LUNAR_MONTH;
  return Math.floor(fraction * 8) % 8;
}

export const UIModule = {
  name: "PanelsPIP",

  _root: null,
  _panelFrame: null,
  _pipCanvas: null,
  _lensEl: null,
  _compassRing: null,
  _seasonRing: null,
  _lunarRing: null,
  _gameTime: 8,
  _season: "day",
  _onMessage: null,
  _overlayCanvas: null,
  _overlayCtx: null,
  _lastMoonUpdate: 0,
  _pipZoom: 1,
  /** If set 0–7, radial lunar dial uses manual phase; else real-world synodic approximation. */
  _lunarManualIndex: null,

  load() {
    if (!document.getElementById("v2-font-cinzel")) {
      const l = document.createElement("link");
      l.id = "v2-font-cinzel";
      l.rel = "stylesheet";
      l.href =
        "https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&display=swap";
      document.head.appendChild(l);
    }
    this._root = document.createElement("div");
    this._root.id = "v2-panels-pip";
    this._root.innerHTML = `
      <style>
        #v2-panels-pip { position: fixed; inset: 0; pointer-events: none; z-index: 9800; font-family: Nunito, system-ui, sans-serif; }
        #v2-side-panel {
          position: fixed; inset: 0; width: 100%; height: 100%;
          border: none; background: transparent; overflow: hidden;
          pointer-events: none; z-index: 9800;
        }
        #panel-frame { width: 100%; height: 100%; border: 0; background: transparent; pointer-events: none; display:none; }
        /* Sacred instrument — bronze / aged gold, soft depth, calm highlights */
        #moondial-wrapper {
          --pip-void: #120b09;
          --pip-bezel-dark: #1e1210;
          --pip-bezel-mid: #2c1c18;
          --pip-bronze-hi: #6e5347;
          --pip-bronze-lo: #3d2a24;
          --pip-gold: #c6a035;
          --pip-gold-soft: rgba(232, 212, 148, 0.92);
          --pip-parchment: #f3ece3;
          --pip-moon-track: 22px;
          --pip-compass-track: 20px;
          --pip-outer-track: 16px;
          position: absolute;
          top: 50px;
          left: 20px;
          width: clamp(200px, 25vw, 300px);
          height: clamp(200px, 25vw, 300px);
          z-index: 1200;
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
            0 1px 0 rgba(255, 250, 240, 0.1),
            0 28px 56px rgba(0, 0, 0, 0.58),
            0 10px 22px rgba(0, 0, 0, 0.38),
            inset 0 2px 5px rgba(255, 255, 255, 0.05),
            inset 0 -14px 32px rgba(0, 0, 0, 0.42);
        }
        #moondial-wrapper::after {
          content: '';
          position: absolute;
          inset: -2px;
          border-radius: 50%;
          pointer-events: none;
          z-index: 9;
          box-shadow: 0 0 24px rgba(198, 160, 53, 0.08);
          opacity: 0.85;
        }
        .pip-ring-bronze {
          background: conic-gradient(
            from -18deg,
            var(--pip-bronze-lo) 0%,
            var(--pip-bronze-hi) 6%,
            var(--pip-bronze-lo) 14%,
            #574238 22%,
            var(--pip-bronze-lo) 32%,
            var(--pip-bronze-hi) 42%,
            var(--pip-bronze-lo) 52%,
            #4a362e 64%,
            var(--pip-bronze-hi) 75%,
            var(--pip-bronze-lo) 88%,
            #35241f 100%
          );
          border: 1px solid rgba(18, 10, 8, 0.9);
          box-shadow:
            inset 0 2px 6px rgba(255, 248, 235, 0.12),
            inset 0 -10px 22px rgba(0, 0, 0, 0.55),
            0 6px 18px rgba(0, 0, 0, 0.45);
        }
        .lunar-radial-ring {
          position: absolute;
          inset: -4px;
          border-radius: 50%;
          pointer-events: none;
          z-index: 7;
          background: radial-gradient(
            circle closest-side at 50% 50%,
            transparent 0,
            transparent calc(100% - var(--pip-moon-track)),
            var(--pip-bronze-lo) calc(100% - var(--pip-moon-track) + 1px),
            var(--pip-bronze-hi) calc(100% - 12px),
            #4a362e calc(100% - 5px),
            var(--pip-bronze-lo) 100%
          );
          box-shadow:
            inset 0 0 0 1px rgba(255, 248, 235, 0.1),
            inset 0 3px 8px rgba(255, 248, 235, 0.08),
            inset 0 -7px 12px rgba(0, 0, 0, 0.36),
            0 0 0 1px rgba(20, 12, 9, 0.72);
        }
        .lunar-radial-rim {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          pointer-events: none;
        }
        .lunar-radial-rim.pip-ring-bronze {
          -webkit-mask-image: radial-gradient(circle closest-side, transparent calc(100% - var(--pip-moon-track)), black calc(100% - var(--pip-moon-track) + 1px));
          mask-image: radial-gradient(circle closest-side, transparent calc(100% - var(--pip-moon-track)), black calc(100% - var(--pip-moon-track) + 1px));
        }
        .lunar-radial-rim.pip-ring-ticks::before {
          content: '';
          position: absolute;
          inset: 2px;
          border-radius: 50%;
          pointer-events: none;
          background: repeating-conic-gradient(
            from 0deg,
            rgba(22, 14, 11, 0.42) 0deg,
            rgba(22, 14, 11, 0.42) 0.75deg,
            transparent 0.75deg,
            transparent 17.25deg
          );
          -webkit-mask-image: radial-gradient(circle closest-side, transparent calc(100% - var(--pip-moon-track) + 4px), black calc(100% - var(--pip-moon-track) + 5px));
          mask-image: radial-gradient(circle closest-side, transparent calc(100% - var(--pip-moon-track) + 4px), black calc(100% - var(--pip-moon-track) + 5px));
        }
        /**
         * Lunar phase slots — kept crisp so they don't read as fuzzed
         * when the crystal-dome glass reaches the rim. Heavy drop-shadow
         * filter + 0.82 opacity were the source of the soft/blurry look:
         * dropped to full opacity with a thin text-shadow that only carries
         * legibility, not a blur halo. Active + hover states still glow.
         */
        .lunar-phase-slot {
          position: absolute;
          pointer-events: auto;
          width: clamp(20px, 7.5%, 24px);
          height: clamp(20px, 7.5%, 24px);
          border: none;
          background: transparent;
          border-radius: 50%;
          font-size: clamp(13px, 3.65vw, 19px);
          line-height: 1;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          text-shadow:
            0 1px 1px rgba(0, 0, 0, 0.8),
            0 0 2px rgba(0, 0, 0, 0.55);
          opacity: 1;
          transition:
            transform 0.32s cubic-bezier(0.22, 1, 0.36, 1),
            filter 0.28s ease,
            box-shadow 0.28s ease;
        }
        .lunar-phase-slot:hover {
          filter: drop-shadow(0 0 10px rgba(198, 160, 53, 0.45));
        }
        .lunar-phase-slot.active-phase {
          filter: drop-shadow(0 0 14px rgba(198, 160, 53, 0.65));
          box-shadow:
            0 0 0 2px rgba(198, 160, 53, 0.45),
            0 4px 14px rgba(0, 0, 0, 0.35);
        }
        .lunar-phase-slot.slot-0 { top: 3.5%; left: 50%; transform: translate(-50%, -50%); }
        .lunar-phase-slot.slot-1 { top: 16.8%; left: 83.2%; transform: translate(-50%, -50%); }
        .lunar-phase-slot.slot-2 { top: 50%; left: 96.5%; transform: translate(-50%, -50%); }
        .lunar-phase-slot.slot-3 { top: 83.2%; left: 83.2%; transform: translate(-50%, -50%); }
        .lunar-phase-slot.slot-4 { top: 96.5%; left: 50%; transform: translate(-50%, -50%); }
        .lunar-phase-slot.slot-5 { top: 83.2%; left: 16.8%; transform: translate(-50%, -50%); }
        .lunar-phase-slot.slot-6 { top: 50%; left: 3.5%; transform: translate(-50%, -50%); }
        .lunar-phase-slot.slot-7 { top: 16.8%; left: 16.8%; transform: translate(-50%, -50%); }
        .lunar-phase-slot:hover.slot-0,
        .lunar-phase-slot:hover.slot-1,
        .lunar-phase-slot:hover.slot-2,
        .lunar-phase-slot:hover.slot-3,
        .lunar-phase-slot:hover.slot-4,
        .lunar-phase-slot:hover.slot-5,
        .lunar-phase-slot:hover.slot-6,
        .lunar-phase-slot:hover.slot-7 { transform: translate(-50%, -50%) scale(1.08); }
        .lunar-phase-slot.active-phase.slot-0,
        .lunar-phase-slot.active-phase.slot-1,
        .lunar-phase-slot.active-phase.slot-2,
        .lunar-phase-slot.active-phase.slot-3,
        .lunar-phase-slot.active-phase.slot-4,
        .lunar-phase-slot.active-phase.slot-5,
        .lunar-phase-slot.active-phase.slot-6,
        .lunar-phase-slot.active-phase.slot-7 {
          transform: translate(-50%, -50%) scale(1.06);
        }
        .compass-outer-ring {
          position: absolute;
          inset: -24px;
          border-radius: 50%;
          pointer-events: none;
          z-index: 6;
          will-change: transform;
          transform-origin: center;
          transition: none;
          -webkit-mask-image: radial-gradient(circle closest-side, transparent calc(100% - var(--pip-compass-track)), black calc(100% - var(--pip-compass-track) + 1px));
          mask-image: radial-gradient(circle closest-side, transparent calc(100% - var(--pip-compass-track)), black calc(100% - var(--pip-compass-track) + 1px));
          box-shadow:
            inset 0 0 0 1px rgba(255, 248, 235, 0.08),
            inset 0 -8px 16px rgba(0, 0, 0, 0.42),
            0 0 0 1px rgba(18, 10, 8, 0.78);
        }
        .compass-outer-ring.pip-ring-bronze::before {
          content: '';
          position: absolute;
          inset: 2px;
          border-radius: 50%;
          pointer-events: none;
          background: repeating-conic-gradient(
            from 0deg,
            rgba(22, 14, 11, 0.4) 0deg,
            rgba(22, 14, 11, 0.4) 0.75deg,
            transparent 0.75deg,
            transparent 17.25deg
          );
          -webkit-mask-image: radial-gradient(circle closest-side, transparent calc(100% - 8px), black calc(100% - 7px));
          mask-image: radial-gradient(circle closest-side, transparent calc(100% - 8px), black calc(100% - 7px));
        }
        .compass-marker {
          position: absolute;
          color: #fffdf5;
          font-family: 'Cinzel', Georgia, serif;
          font-size: clamp(14px, 3.3vw, 17px);
          font-weight: 800;
          letter-spacing: 0.06em;
          text-shadow:
            0 1px 2px rgba(0, 0, 0, 0.9),
            0 0 12px rgba(198, 160, 53, 0.2);
          line-height: 1;
        }
        .compass-marker.n { top: 3px; left: 50%; transform: translateX(-50%); z-index: 2; color: #fffdf5; }
        .compass-marker.s { bottom: 3px; left: 50%; transform: translateX(-50%); z-index: 2; }
        .compass-marker.e { right: 5px; top: 50%; transform: translateY(-50%); z-index: 2; }
        .compass-marker.w { left: 5px; top: 50%; transform: translateY(-50%); z-index: 2; }
        .season-bracket {
          position: absolute;
          top: -34px;
          left: 50%;
          transform: translateX(-50%);
          width: 42px;
          height: 48px;
          border-radius: 22px 22px 13px 13px;
          pointer-events: none;
          z-index: 10;
          border: 1px solid rgba(255, 255, 255, 0.38);
          background: linear-gradient(
            168deg,
            rgba(255, 255, 255, 0.2) 0%,
            rgba(255, 255, 255, 0.05) 42%,
            rgba(200, 210, 220, 0.04) 100%
          );
          box-shadow:
            inset 0 1px 1px rgba(255, 255, 255, 0.65),
            inset 0 -1px 8px rgba(40, 50, 60, 0.12),
            0 4px 14px rgba(0, 0, 0, 0.28);
          backdrop-filter: blur(1px) saturate(1.25);
          -webkit-backdrop-filter: blur(1px) saturate(1.25);
        }
        .season-bracket::before {
          content: '';
          position: absolute;
          inset: 4px 5px 16px;
          border-radius: 50%;
          background: radial-gradient(circle at 38% 32%, rgba(255, 255, 255, 0.55) 0%, transparent 58%);
          opacity: 0.35;
          pointer-events: none;
        }
        .season-bracket::after {
          content: '';
          position: absolute;
          left: 50%;
          bottom: 5px;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: 8px solid transparent;
          border-right: 8px solid transparent;
          border-top: 12px solid #fffdf5;
          filter:
            drop-shadow(0 2px 3px rgba(0, 0, 0, 0.7))
            drop-shadow(0 0 6px rgba(198, 160, 53, 0.55));
          pointer-events: none;
        }
        .season-outer-ring {
          position: absolute;
          inset: 16%;
          border-radius: 50%;
          pointer-events: none;
          z-index: 8;
          opacity: 0;
          transform: rotate(var(--season-rotation, 0deg)) scale(0.94);
          transition:
            opacity 0.22s ease,
            transform 0.22s ease;
        }
        .season-outer-bg {
          position: absolute; inset: 0; border-radius: 50%;
          background: transparent;
          box-shadow: none;
          pointer-events: none;
          -webkit-mask-image: radial-gradient(circle closest-side, transparent calc(100% - 16px), black calc(100% - 15px));
          mask-image: radial-gradient(circle closest-side, transparent calc(100% - 16px), black calc(100% - 15px));
        }
        .season-outer-bg.pip-ring-bronze {
          border: none;
          background: transparent;
          box-shadow: none;
        }
        .season-anchor { position: absolute; inset: 0; pointer-events: none; }
        .season-btn-wrap { position: absolute; top: 8px; left: 50%; width: 24px; height: 24px; margin: -12px 0 0 -12px; pointer-events: auto; }
        .season-btn {
          position: relative; left: 0; top: 0; margin: 0; width: 100%; height: 100%;
          background: rgba(12, 8, 6, 0.42); border: 1px solid rgba(255, 248, 235, 0.14); border-radius: 50%;
          color: var(--pip-gold-soft); display: flex; align-items: center; justify-content: center;
          font-size: 14px; cursor: pointer; pointer-events: auto;
          box-shadow:
            inset 0 1px 2px rgba(255, 248, 235, 0.12),
            inset 0 -3px 6px rgba(0, 0, 0, 0.32),
            0 2px 6px rgba(0, 0, 0, 0.32);
          transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), filter 0.25s ease, background 0.25s ease;
        }
        .season-btn:hover {
          transform: scale(1.18);
          background: rgba(198, 160, 53, 0.12);
          filter: drop-shadow(0 0 14px rgba(198, 160, 53, 0.65));
        }
        #moondial-wrapper:hover .season-outer-ring,
        #moondial-wrapper:focus-within .season-outer-ring {
          opacity: 1;
          /* pointer-events stays none on the ring container so clicks fall
             through to .pip-lens-legacy. Individual .season-btn-wrap nodes
             re-enable pointer-events: auto so the season buttons still click. */
          transform: rotate(var(--season-rotation, 0deg)) scale(1);
        }
        #pipCanvas {
          position: absolute; top: 0; left: 0; transform: none !important;
          width: 100%; height: 100%; display: block; border-radius: 50%;
          z-index: 0;
          pointer-events: none;
          filter: contrast(1.025) saturate(1.06) brightness(1.015);
        }
        /**
         * PiP crystal dome — extends 1:1 with the legacy Component.MoonDial
         * #pip-lens::after formula (radial highlight at 34/26, dark seat
         * at 50/88, mix-blend soft-light). Mask was tightened so the glass
         * surface reaches out to the inner edge of the moonphase track
         * (var(--pip-moon-track)). Moon-phase slots sit on a higher z-layer
         * (lunar-radial-ring z:7) so the glass NEVER overlays them — only
         * lifts the dome over the WebGL map area.
         */
        .pip-optics-stack {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          pointer-events: none;
          z-index: 1;
          overflow: hidden;
          -webkit-mask-image: radial-gradient(circle closest-side, black 0%, black calc(100% - var(--pip-moon-track) - 1px), transparent calc(100% - var(--pip-moon-track)));
          mask-image: radial-gradient(circle closest-side, black 0%, black calc(100% - var(--pip-moon-track) - 1px), transparent calc(100% - var(--pip-moon-track)));
        }
        /**
         * .pip-optics-shade ports the legacy iframe's lens-bottom seat:
         * a soft dark wash at 50%/88% reading as the lower meniscus of the
         * crystal. Top-edge inset highlight is kept but the bottom inset
         * shadow is softened (was 40px / 0.20 → pulled to 28px / 0.14) so
         * the moonphase ring at the rim no longer reads as dimmed.
         */
        .pip-optics-shade {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background:
            radial-gradient(circle at 50% 88%, rgba(0, 15, 30, 0.18) 0%, transparent 42%),
            radial-gradient(circle at 50% 50%, transparent 60%, rgba(0, 0, 0, 0.09) 100%),
            radial-gradient(ellipse 70% 55% at 28% 22%, rgba(255, 255, 255, 0.06) 0%, transparent 48%);
          box-shadow:
            inset 0 2px 4px rgba(255, 255, 255, 0.22),
            inset 0 -10px 28px rgba(0, 0, 0, 0.14),
            inset 5px 8px 18px rgba(255, 255, 255, 0.04);
        }
        .pip-optics-shade::after {
          content: '';
          position: absolute;
          inset: 6%;
          border-radius: 50%;
          box-shadow:
            inset 0 0 0 1px rgba(255, 255, 255, 0.08),
            inset 0 1px 3px rgba(255, 255, 255, 0.05);
          pointer-events: none;
        }
        /**
         * .pip-optics-glaze is the legacy #pip-lens::after formula
         * verbatim: highlight ellipse 92% 74% at 34/26 → rgba(255,255,255,0.22)
         * + dark anchor at 50/88 → rgba(0,15,30,0.18), mix-blend-mode
         * soft-light, opacity 0.88. Reproduced 1:1 from the iframe.
         */
        .pip-optics-glaze {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background:
            radial-gradient(ellipse 92% 74% at 34% 26%, rgba(255, 255, 255, 0.22) 0%, transparent 52%),
            radial-gradient(circle at 50% 88%, rgba(0, 15, 30, 0.18) 0%, transparent 42%);
          mix-blend-mode: soft-light;
          opacity: 0.88;
        }
        .pip-optics-glaze::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background:
            radial-gradient(ellipse 52% 32% at 70% 76%, rgba(255, 255, 255, 0.10) 0%, transparent 62%),
            linear-gradient(158deg, transparent 38%, rgba(255, 255, 255, 0.03) 52%, transparent 68%);
          mix-blend-mode: overlay;
          opacity: 0.58;
          pointer-events: none;
        }
        .pip-lens-legacy {
          position: absolute;
          inset: 12%;
          border-radius: 50%;
          background: transparent;
          z-index: 4;
          border: none;
          overflow: hidden;
          cursor: pointer;
          pointer-events: auto;
          padding: 0;
          margin: 0;
          -webkit-tap-highlight-color: transparent;
          box-shadow:
            0 0 0 1px rgba(17, 10, 8, 0.9),
            0 0 0 3px rgba(109, 82, 68, 0.55),
            0 4px 10px rgba(0, 0, 0, 0.32),
            inset 0 0 0 1px rgba(255, 255, 255, 0.32),
            inset 4px 10px 22px rgba(255, 255, 255, 0.14),
            inset -8px -16px 28px rgba(0, 0, 0, 0.38),
            0 2px 0 rgba(255, 255, 255, 0.04);
        }
        .pip-lens-legacy:focus-visible {
          outline: 2px solid rgba(198, 160, 53, 0.85);
          outline-offset: 3px;
        }
        .pip-lens-legacy::before {
          content: '';
          position: absolute;
          inset: -1px;
          border-radius: 50%;
          pointer-events: none;
          box-shadow:
            0 0 0 1px rgba(24, 14, 12, 0.85),
            inset 0 1px 2px rgba(255, 255, 255, 0.22);
          opacity: 0.95;
        }
        .pip-lens-legacy::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 50%;
          pointer-events: none;
          background:
            radial-gradient(ellipse 88% 72% at 32% 24%, rgba(255, 255, 255, 0.28) 0%, transparent 50%),
            radial-gradient(circle at 50% 88%, rgba(15, 22, 32, 0.12) 0%, transparent 44%);
          mix-blend-mode: soft-light;
          opacity: 0.72;
        }
        .pip-glass-controls {
          position: absolute;
          left: 14%;
          top: 50%;
          transform: translate(-50%, -50%);
          display: flex;
          flex-direction: column;
          gap: 5px;
          z-index: 9;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.18s ease, transform 0.18s ease;
        }
        #moondial-wrapper:hover .pip-glass-controls,
        #moondial-wrapper:focus-within .pip-glass-controls {
          opacity: 1;
          pointer-events: auto;
          transform: translate(-50%, -50%) scale(1);
        }
        .pip-zoom-btn {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          border: 1px solid rgba(255, 248, 235, 0.22);
          padding: 0;
          color: #fffdf5;
          background: linear-gradient(145deg, rgba(108, 82, 68, 0.92), rgba(38, 25, 20, 0.96));
          font-size: 12px;
          font-weight: 800;
          line-height: 14px;
          cursor: pointer;
          box-shadow:
            inset 0 1px 1px rgba(255, 248, 235, 0.24),
            inset 0 -3px 5px rgba(0, 0, 0, 0.42),
            0 2px 5px rgba(0, 0, 0, 0.4);
        }
        .pip-zoom-btn:hover {
          filter: brightness(1.12) drop-shadow(0 0 7px rgba(198, 160, 53, 0.36));
        }
        #pipOverlay {
          position: absolute; top: 0; left: 0;
          width: 100%; height: 100%; border-radius: 50%;
          z-index: 3;
          pointer-events: none;
          display: block;
        }
        #v2-distance-pill {
          position: absolute;
          left: 28px;
          top: calc(50px + clamp(200px, 25vw, 300px) + 34px);
          padding: 9px 14px;
          border-radius: 999px;
          color: var(--pip-gold-soft);
          background: linear-gradient(165deg, rgba(28, 18, 14, 0.92) 0%, rgba(14, 10, 8, 0.88) 100%);
          border: 1px solid rgba(198, 160, 53, 0.28);
          font-size: 11.5px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          box-shadow:
            0 10px 28px rgba(0, 0, 0, 0.45),
            inset 0 1px 0 rgba(255, 255, 255, 0.07);
        }
      </style>
      <div id="v2-side-panel"><iframe id="panel-frame" title="Sacred Adventures Panel"></iframe></div>
      <div id="v2-distance-pill">0 ft travelled</div>
      <div id="moondial-wrapper" title="Sacred Adventures v2 — moondial">
        <div class="season-outer-ring" id="season-ring">
          <div class="season-outer-bg pip-ring-bronze"></div>
          <div class="season-anchor" style="transform: rotate(0deg);"><div class="season-btn-wrap" style="transform: rotate(0deg);"><span class="season-btn" data-season="night" title="Starlight Night">🌙</span></div></div>
          <div class="season-anchor" style="transform: rotate(72deg);"><div class="season-btn-wrap" style="transform: rotate(-72deg);"><span class="season-btn" data-season="dawn" title="Cool Dawn">🌤</span></div></div>
          <div class="season-anchor" style="transform: rotate(144deg);"><div class="season-btn-wrap" style="transform: rotate(-144deg);"><span class="season-btn" data-season="day" title="Golden Spirit Day">☀️</span></div></div>
          <div class="season-anchor" style="transform: rotate(216deg);"><div class="season-btn-wrap" style="transform: rotate(-216deg);"><span class="season-btn" data-season="dusk" title="Amber Dusk">🔅</span></div></div>
          <div class="season-anchor" style="transform: rotate(288deg);"><div class="season-btn-wrap" style="transform: rotate(-288deg);"><span class="season-btn" data-season="gray" title="Overcast Gray">☁️</span></div></div>
        </div>
        <canvas id="pipCanvas" width="512" height="512"></canvas>
        <div class="pip-optics-stack" aria-hidden="true">
          <div class="pip-optics-shade"></div>
          <div class="pip-optics-glaze"></div>
        </div>
        <button type="button" id="pip-lens-legacy" class="pip-lens-legacy" aria-label="Toggle map view and first-person view"></button>
        <div class="pip-glass-controls" aria-label="PiP zoom controls">
          <button type="button" class="pip-zoom-btn" data-pip-zoom="in" title="Zoom PiP in" aria-label="Zoom PiP in">+</button>
          <button type="button" class="pip-zoom-btn" data-pip-zoom="out" title="Zoom PiP out" aria-label="Zoom PiP out">−</button>
        </div>
        <canvas id="pipOverlay" width="512" height="512"></canvas>
        <div class="compass-outer-ring pip-ring-bronze">
          <span class="compass-marker n">N</span>
          <span class="compass-marker s">S</span>
          <span class="compass-marker e">E</span>
          <span class="compass-marker w">W</span>
        </div>
        <div class="lunar-radial-ring" aria-label="Lunar phases">
          <div class="lunar-radial-rim pip-ring-bronze pip-ring-ticks" aria-hidden="true"></div>
          ${LUNAR_PHASE_EMOJI.map(
            (emoji, i) =>
              `<button type="button" class="lunar-phase-slot slot-${i}" data-phase="${i}" title="${LUNAR_PHASE_TITLE[i]}" aria-label="${LUNAR_PHASE_TITLE[i]}">${emoji}</button>`,
          ).join("")}
        </div>
        <div class="season-bracket" aria-hidden="true"></div>
      </div>
    `;
    document.body.appendChild(this._root);
    this._panelFrame = this._root.querySelector("#panel-frame");
    this._pipCanvas = this._root.querySelector("#pipCanvas");
    this._lensEl = this._root.querySelector("#pip-lens-legacy");
    this._overlayCanvas = this._root.querySelector("#pipOverlay");
    this._overlayCtx = this._overlayCanvas.getContext("2d", { alpha: true });
    this._compassRing = this._root.querySelector(".compass-outer-ring");
    this._seasonRing = this._root.querySelector("#season-ring");
    this._lunarRing = this._root.querySelector(".lunar-radial-ring");
    this._pipZoom = this._readStoredPipZoom();
    this._bindLensAndPhases();
    this._pipOverlayRing();
    queueMicrotask(() => this._syncPipOverlaySize());
    this._root.querySelectorAll(".season-btn").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        this._setSeason(btn.dataset.season);
      });
    });
    this._onMessage = (event) => {
      const msg = event.data || {};
      if (msg.type === "SET_SEASON") this._setSeason(msg.season);
    };
    window.addEventListener("message", this._onMessage);
    const hint = document.getElementById("v2-hint");
    if (hint) hint.style.display = "none";
    this._panelFrame.src = "about:blank";
    window.pipCanvas2D = this._pipCanvas;
    this._syncLunarRadialPhase();
    console.log(
      "%c[PanelsPIP] Compass + radial lunar dial · legacy center glass · view swap on lens",
      "color:#81d4fa;font-weight:bold;",
    );
  },

  _bindLensAndPhases() {
    const toggle = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const player = getRuntimeService("WorldPlayer") ?? window.WorldPlayer;
      const next = player?.toggleMainCanvasMapView?.();
      dispatchInteraction(ANU_EVENTS.UI_PIP_VIEW_TOGGLE, {
        t: typeof performance !== "undefined" ? performance.now() : 0,
        mainCanvasMapView: next ?? null,
      });
      window.postMessage({ type: "TOGGLE_VIEW_MODE" }, "*");
    };
    this._lensEl?.addEventListener("click", toggle);
    this._lensEl?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") toggle(ev);
    });

    this._root?.querySelectorAll(".lunar-phase-slot").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const i = Number.parseInt(btn.getAttribute("data-phase"), 10);
        if (this._lunarManualIndex === i) this._lunarManualIndex = null;
        else this._lunarManualIndex = i;
        this._syncLunarRadialPhase();
      });
    });

    this._root?.querySelectorAll(".pip-zoom-btn").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const direction = btn.getAttribute("data-pip-zoom");
        this._setPipZoom(direction === "in" ? this._pipZoom + 0.1 : this._pipZoom - 0.1);
      });
    });
  },

  update(_delta, frameCount) {
    const player = getRuntimeService("WorldPlayer") ?? window.WorldPlayer;
    if (!player) return;
    this._gameTime = (this._gameTime + _delta * 0.035) % 24;
    const pill = this._root && this._root.querySelector("#v2-distance-pill");
    if (pill && frameCount % 10 === 0)
      pill.textContent = `${Math.round(player.distanceFeet)} ft travelled`;
    this._syncCompass(player.yaw);
    if (frameCount % 45 === 0) this._syncPipOverlaySize();
    if (frameCount - this._lastMoonUpdate >= 30) {
      this._lastMoonUpdate = frameCount;
      this._syncMoonDial();
      this._syncLunarRadialPhase();
    }
  },

  unload() {
    if (this._root) this._root.remove();
    this._root = null;
    this._panelFrame = null;
    this._pipCanvas = null;
    this._lensEl = null;
    this._compassRing = null;
    this._seasonRing = null;
    this._lunarRing = null;
    if (this._onMessage) window.removeEventListener("message", this._onMessage);
    this._onMessage = null;
    if (window.pipCanvas2D) window.pipCanvas2D = null;
    this._lunarManualIndex = null;
    const hint = document.getElementById("v2-hint");
    if (hint) hint.style.display = "";
    console.log("[PanelsPIP] ⏹ Unloaded.");
  },

  _syncCompass(yaw) {
    /**
     * Rotate the cardinal-marker ring so the letter for the player's heading
     * lands at the **top** of the bezel. CSS `rotate()` is CW positive; markers
     * sit at N=top (0°), E=right (90°), S=bottom (180°), W=left (270°). World
     * yaw convention: yaw=0 → facing -Z (south), yaw=π → facing +Z (north),
     * yaw=π/2 → -X (west), yaw=-π/2 → +X (east). Mapping verified:
     *   yaw=π  → rotate 0°   → N stays at top (player facing north). ✓
     *   yaw=0  → rotate 180° → S marker comes to top.                ✓
     *   yaw=π/2  → rotate 90° → W marker comes to top.                  ✓
     *   yaw=-π/2 → rotate 270° → E marker comes to top.                 ✓
     * Equivalent to `(180 - yawDeg) mod 360`. The previous formula
     * (`rotate(${yawDeg}deg)` directly) painted the dial 180° upside-down at
     * spawn because the new spawn yaw is π, not 0.
     */
    const deg = (yaw * 180) / Math.PI;
    if (this._compassRing)
      this._compassRing.style.transform = `rotate(${180 - deg}deg)`;
  },

  _syncLunarRadialPhase() {
    const idx = lunarPhaseIndexFromDate(new Date(), this._lunarManualIndex);
    this._root?.querySelectorAll(".lunar-phase-slot").forEach((el, i) => {
      el.classList.toggle("active-phase", i === idx);
    });
  },

  _setSeason(season) {
    const times = { night: 0, dawn: 6, day: 12, dusk: 18, gray: 15 };
    if (!Object.prototype.hasOwnProperty.call(times, season)) return;
    this._season = season;
    this._gameTime = times[season];
    const rotation = { night: 0, dawn: -72, day: -144, dusk: -216, gray: -288 }[
      season
    ];
    if (this._seasonRing)
      this._seasonRing.style.setProperty("--season-rotation", `${rotation}deg`);
    dispatchInteraction(ANU_EVENTS.SEASON_CHANGE, {
      season,
      time: this._gameTime,
    });
    window.dispatchEvent(
      new CustomEvent("v2-season-change", {
        detail: { season, time: this._gameTime },
      }),
    );
    this._syncMoonDial();
  },

  _syncMoonDial() {
    if (this._seasonRing && this._season === "day") {
      const dialAngle = ((this._gameTime - 12) / 24) * 360;
      this._seasonRing.style.setProperty("--season-rotation", `${dialAngle}deg`);
    }
  },

  _readStoredPipZoom() {
    try {
      const raw = window.localStorage?.getItem("sacred:v2:pipZoom");
      const parsed = Number.parseFloat(raw ?? "");
      if (Number.isFinite(parsed)) return Math.min(1.6, Math.max(0.6, parsed));
    } catch (_err) {}
    return 1;
  },

  _setPipZoom(value) {
    this._pipZoom = Math.round(Math.min(1.6, Math.max(0.6, value)) * 10) / 10;
    try {
      window.localStorage?.setItem("sacred:v2:pipZoom", String(this._pipZoom));
    } catch (_err) {}
    window.dispatchEvent(
      new CustomEvent("v2-pip-zoom-change", {
        detail: { zoom: this._pipZoom },
      }),
    );
  },

  _syncPipOverlaySize() {
    const dial = this._root && this._root.querySelector("#moondial-wrapper");
    if (!dial || !this._overlayCanvas) return;
    const pr = Math.min(window.devicePixelRatio || 1, 1.25);
    const rw = Math.max(64, Math.floor(dial.clientWidth * pr));
    const rh = Math.max(64, Math.floor(dial.clientHeight * pr));
    if (
      this._overlayCanvas.width === rw &&
      this._overlayCanvas.height === rh
    )
      return;
    this._overlayCanvas.width = rw;
    this._overlayCanvas.height = rh;
    this._pipOverlayRing();
  },

  _pipOverlayRing() {
    const ov = this._overlayCanvas;
    const ctx = this._overlayCtx;
    if (!ov || !ctx) return;
    const w = ov.width;
    const h = ov.height;
    const cx = w / 2;
    const cy = h / 2;
    const scale = Math.min(w, h);
    const r = scale * 0.32;
    const rInner = r * 0.82;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(200, 165, 70, 0.34)";
    ctx.lineWidth = Math.max(1.5, w * 0.0075);
    ctx.setLineDash([4, 7]);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(245, 236, 220, 0.06)";
    ctx.lineWidth = Math.max(1, w * 0.004);
    ctx.beginPath();
    ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },

  _hideEmbeddedPanelPIP() {
    try {
      const doc = this._panelFrame && this._panelFrame.contentDocument;
      if (!doc || doc.getElementById("v2-hide-embedded-pip")) return;
      const style = doc.createElement("style");
      style.id = "v2-hide-embedded-pip";
      style.textContent = "#moondial-wrapper{display:none!important;}";
      doc.head.appendChild(style);
    } catch (_err) {}
  },
};
