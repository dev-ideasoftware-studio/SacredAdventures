import { dispatchInteraction } from "./anu/InteractionBus.js";
import { ANU_EVENTS } from "./anu/anuEvents.js";

export const UIModule = {
  name: "PanelsPIP",

  _root: null,
  _panelFrame: null,
  _pipCanvas: null,
  _compassRing: null,
  _seasonRing: null,
  _gameTime: 8,
  _season: "day",
  _onMessage: null,
  _overlayCanvas: null,
  _overlayCtx: null,
  _lastMoonUpdate: 0,

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
        /* Align with SacredGame.css moondial (#moondial-wrapper) */
        #v2-panels-pip { position: fixed; inset: 0; pointer-events: none; z-index: 9800; font-family: Nunito, system-ui, sans-serif; }
        #v2-side-panel {
          position: fixed; inset: 0; width: 100%; height: 100%;
          border: none; background: transparent; overflow: hidden;
          pointer-events: none; z-index: 9800;
        }
        #panel-frame { width: 100%; height: 100%; border: 0; background: transparent; pointer-events: none; display:none; }
        /* PiP dial — watch-case outer shell + isolated stacking for glass optics */
        #moondial-wrapper {
          position: absolute;
          top: 50px;
          left: 20px;
          width: clamp(200px, 25vw, 300px);
          height: clamp(200px, 25vw, 300px);
          z-index: 1200;
          border-radius: 50%;
          pointer-events: auto;
          cursor: pointer;
          overflow: visible;
          background: transparent;
          isolation: isolate;
          border: 6px solid #2a1a17;
          box-shadow:
            0 12px 36px rgba(0,0,0,0.55),
            0 4px 12px rgba(0,0,0,0.35),
            inset 0 1px 0 rgba(255,255,255,0.07),
            inset 0 -2px 8px rgba(0,0,0,0.35);
        }
        /* Compass rim — match SacredGame.css / legacy Panel (inset, mask band, no transform easing) */
        .compass-outer-ring {
          position: absolute;
          inset: -16px;
          border-radius: 50%;
          background: conic-gradient(from 0deg, #3e2723 0%, #6d4c41 25%, #3e2723 50%, #6d4c41 75%, #3e2723 100%);
          border: 2px solid #2a1a17;
          box-shadow: inset 0 1px 5px rgba(255,255,255,0.2), inset 0 -2px 8px rgba(0,0,0,0.8), 0 4px 15px rgba(0,0,0,0.8);
          pointer-events: none;
          z-index: 2;
          will-change: transform;
          transform-origin: center;
          transition: none;
          -webkit-mask-image: radial-gradient(circle closest-side, transparent calc(100% - 18px), black calc(100% - 17px));
          mask-image: radial-gradient(circle closest-side, transparent calc(100% - 18px), black calc(100% - 17px));
        }
        .compass-outer-ring::before {
          content: ''; position: absolute; inset: 2px; border-radius: 50%;
          background: repeating-conic-gradient(from 0deg, rgba(25,15,5,0.92) 0deg, rgba(25,15,5,0.92) 1.5deg, transparent 1.5deg, transparent 15deg);
          -webkit-mask-image: radial-gradient(circle closest-side, transparent calc(100% - 6px), black calc(100% - 5px));
          mask-image: radial-gradient(circle closest-side, transparent calc(100% - 6px), black calc(100% - 5px));
        }
        .compass-marker {
          position: absolute;
          color: #d7ccc8;
          font-family: 'Cinzel', Georgia, serif;
          font-size: 14px;
          font-weight: 700;
          text-shadow: 0 1px 3px rgba(0,0,0,0.8);
          line-height: 1;
        }
        .compass-marker.n { top: 2px; left: 50%; transform: translateX(-50%); z-index: 2; }
        .compass-marker.s { bottom: 2px; left: 50%; transform: translateX(-50%); z-index: 2; }
        .compass-marker.e { right: 4px; top: 50%; transform: translateY(-50%); z-index: 2; }
        .compass-marker.w { left: 4px; top: 50%; transform: translateY(-50%); z-index: 2; }
        /* Fixed lubber-line / heading glass tab — must stay translucent so rim letters (esp. N) read through */
        .season-bracket {
          position: absolute; top: -28px; left: 50%; transform: translateX(-50%); width: 36px; height: 36px;
          border-radius: 10px 10px 4px 4px;
          pointer-events: none;
          z-index: 6;
          background: linear-gradient(
            165deg,
            rgba(255, 252, 248, 0.14) 0%,
            rgba(180, 160, 140, 0.10) 40%,
            rgba(35, 28, 22, 0.12) 100%
          );
          border: 1px solid rgba(251, 192, 45, 0.38);
          border-bottom: 2px solid rgba(251, 192, 45, 0.55);
          box-shadow:
            inset 0 1px 1px rgba(255, 255, 255, 0.35),
            inset 0 -1px 8px rgba(0, 0, 0, 0.12),
            0 4px 14px rgba(0, 0, 0, 0.2);
          backdrop-filter: blur(10px) saturate(1.15);
          -webkit-backdrop-filter: blur(10px) saturate(1.15);
        }
        .season-outer-ring { position: absolute; inset: -24px; border-radius: 50%; pointer-events: none; z-index: -1; transition: transform 0.5s cubic-bezier(0.34,1.56,0.64,1); }
        .season-outer-bg {
          position: absolute; inset: 0; border-radius: 50%;
          background: conic-gradient(from 0deg, #3e2723 0%, #6d4c41 25%, #3e2723 50%, #6d4c41 75%, #3e2723 100%);
          box-shadow: inset 0 2px 10px rgba(0,0,0,0.1), 0 5px 15px rgba(0,0,0,0.1);
          -webkit-mask-image: radial-gradient(circle closest-side, transparent calc(100% - 24px), black calc(100% - 23px));
          mask-image: radial-gradient(circle closest-side, transparent calc(100% - 24px), black calc(100% - 23px));
        }
        .season-anchor { position: absolute; inset: 0; pointer-events: none; }
        .season-btn-wrap { position: absolute; top: 18px; left: 50%; width: 36px; height: 36px; margin: -18px 0 0 -18px; pointer-events: auto; }
        .season-btn {
          position: relative; left: 0; top: 0; margin: 0; width: 100%; height: 100%; background: transparent; border: none; box-shadow: none;
          color: #d2b48c; display: flex; align-items: center; justify-content: center; font-size: 18px; cursor: pointer; pointer-events: auto; transition: all 0.2s ease;
        }
        .season-btn:hover { transform: scale(1.4); filter: drop-shadow(0 0 10px rgba(255,215,0,0.8)); }
        /* Map render target — slight punch through “crystal” (cheap vs shader) */
        #pipCanvas {
          position: absolute; top: 0; left: 0; transform: none !important;
          width: 100%; height: 100%; display: block; border-radius: 50%;
          z-index: -1; pointer-events: none;
          filter: contrast(1.04) saturate(1.08) brightness(1.02);
        }
        /*
         * Watch-crystal / compass-glass optics (above map, below GPS overlay + moon iframe)
         * — curved-lens shading, fresnel rim, specular glaze (no backdrop-filter: keeps WebGL sharp)
         */
        .pip-optics-stack {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          pointer-events: none;
          z-index: 1;
          overflow: hidden;
        }
        .pip-optics-shade {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          /* Depth: bottom-heavy shadow (glass dome), edge vignette, cool bounce opposite spec */
          background:
            radial-gradient(ellipse 130% 95% at 50% 108%, rgba(8, 22, 38, 0.38) 0%, transparent 48%),
            radial-gradient(ellipse 90% 88% at 72% 72%, rgba(0, 25, 45, 0.12) 0%, transparent 48%),
            radial-gradient(circle at 50% 50%, transparent 38%, rgba(0, 0, 0, 0.22) 100%),
            radial-gradient(circle at 26% 18%, rgba(255, 255, 255, 0.07) 0%, transparent 38%);
          box-shadow:
            inset 0 3px 5px rgba(255, 255, 255, 0.42),
            inset 0 -14px 36px rgba(0, 0, 0, 0.42),
            inset 6px 10px 22px rgba(255, 255, 255, 0.06),
            inset -4px -6px 20px rgba(0, 0, 0, 0.28);
        }
        /* Thin inner bezel — polished compass groove */
        .pip-optics-shade::after {
          content: '';
          position: absolute;
          inset: 5%;
          border-radius: 50%;
          box-shadow:
            inset 0 0 0 1px rgba(255, 255, 255, 0.18),
            inset 0 2px 4px rgba(255, 255, 255, 0.12),
            inset 0 -3px 10px rgba(0, 0, 0, 0.35);
          pointer-events: none;
        }
        .pip-optics-glaze {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          /* Primary specular — like overhead light on convex crystal */
          background: radial-gradient(
            ellipse 95% 72% at 32% 24%,
            rgba(255, 252, 248, 0.5) 0%,
            rgba(255, 255, 255, 0.12) 28%,
            transparent 52%
          );
          mix-blend-mode: soft-light;
          opacity: 0.92;
        }
        /* Secondary razor highlight + lower rim catch */
        .pip-optics-glaze::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background:
            radial-gradient(ellipse 55% 35% at 68% 78%, rgba(255, 255, 255, 0.14) 0%, transparent 65%),
            linear-gradient(155deg, transparent 40%, rgba(255, 255, 255, 0.06) 55%, transparent 70%);
          mix-blend-mode: overlay;
          opacity: 0.85;
          pointer-events: none;
        }
        #pipOverlay {
          position: absolute; top: 0; left: 0;
          width: 100%; height: 100%; border-radius: 50%;
          z-index: 5; pointer-events: none; display: block;
        }
        #moondial-frame {
          position: absolute;
          inset: 6px;
          width: calc(100% - 12px);
          height: calc(100% - 12px);
          border: none;
          border-radius: 50%;
          pointer-events: none;
          z-index: 4;
        }
        #pip-click-overlay {
          position: absolute; top: 10%; left: 10%; width: 80%; height: 80%; border-radius: 50%;
          z-index: 50; cursor: pointer; background: transparent; pointer-events: auto;
        }
        #v2-distance-pill {
          position: absolute; left: 28px; top: calc(50px + clamp(200px, 25vw, 300px) + 34px); padding: 8px 12px; border-radius: 999px;
          color: #f7d774; background: rgba(15,12,9,0.72); border: 1px solid rgba(251,192,45,0.24);
          font-size: 12px; letter-spacing: 0.4px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        }
      </style>
      <div id="v2-side-panel"><iframe id="panel-frame" title="Sacred Adventures Panel"></iframe></div>
      <div id="v2-distance-pill">0 ft travelled</div>
      <div id="moondial-wrapper" title="Click to toggle Village Map / FPV">
        <div class="compass-outer-ring">
          <span class="compass-marker n">N</span>
          <span class="compass-marker s">S</span>
          <span class="compass-marker e">E</span>
          <span class="compass-marker w">W</span>
        </div>
        <div class="season-bracket"></div>
        <canvas id="pipCanvas" width="512" height="512"></canvas>
        <div class="pip-optics-stack" aria-hidden="true">
          <div class="pip-optics-shade"></div>
          <div class="pip-optics-glaze"></div>
        </div>
        <canvas id="pipOverlay" width="512" height="512"></canvas>
        <div class="season-outer-ring" id="season-ring">
          <div class="season-outer-bg"></div>
          <div class="season-anchor" style="transform: rotate(0deg);"><div class="season-btn-wrap" style="transform: rotate(0deg);"><span class="season-btn" data-season="night" title="Starlight Night">🌙</span></div></div>
          <div class="season-anchor" style="transform: rotate(72deg);"><div class="season-btn-wrap" style="transform: rotate(-72deg);"><span class="season-btn" data-season="dawn" title="Cool Dawn">🌤</span></div></div>
          <div class="season-anchor" style="transform: rotate(144deg);"><div class="season-btn-wrap" style="transform: rotate(-144deg);"><span class="season-btn" data-season="day" title="Golden Spirit Day">☀️</span></div></div>
          <div class="season-anchor" style="transform: rotate(216deg);"><div class="season-btn-wrap" style="transform: rotate(-216deg);"><span class="season-btn" data-season="dusk" title="Amber Dusk">🔅</span></div></div>
          <div class="season-anchor" style="transform: rotate(288deg);"><div class="season-btn-wrap" style="transform: rotate(-288deg);"><span class="season-btn" data-season="gray" title="Overcast Gray">☁️</span></div></div>
        </div>
        <iframe id="moondial-frame" src="./Component.MoonDial.html" title="Moon dial" allowtransparency="true" style="background:transparent;"></iframe>
        <div id="pip-click-overlay"></div>
      </div>
    `;
    document.body.appendChild(this._root);
    this._panelFrame = this._root.querySelector("#panel-frame");
    this._pipCanvas = this._root.querySelector("#pipCanvas");
    this._overlayCanvas = this._root.querySelector("#pipOverlay");
    this._overlayCtx = this._overlayCanvas.getContext("2d", { alpha: true });
    this._compassRing = this._root.querySelector(".compass-outer-ring");
    this._seasonRing = this._root.querySelector("#season-ring");
    this._pipOverlayRing();
    queueMicrotask(() => this._syncPipOverlaySize());
    this._root.querySelectorAll(".season-btn").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        this._setSeason(btn.dataset.season);
      });
    });
    this._root
      .querySelector("#pip-click-overlay")
      ?.addEventListener("click", () => {
        window.postMessage({ type: "TOGGLE_VIEW_MODE" }, "*");
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
    console.log(
      "%c[PanelsPIP] ✅ Legacy moondial layout (SacredGame.Panel) — compass · PiP · MoonDial iframe",
      "color:#81d4fa;font-weight:bold;",
    );
  },

  update(_delta, frameCount) {
    const player = window.WorldPlayer;
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
    }
  },

  unload() {
    if (this._root) this._root.remove();
    this._root = null;
    this._panelFrame = null;
    this._pipCanvas = null;
    this._compassRing = null;
    this._seasonRing = null;
    if (this._onMessage) window.removeEventListener("message", this._onMessage);
    this._onMessage = null;
    if (window.pipCanvas2D) window.pipCanvas2D = null;
    const hint = document.getElementById("v2-hint");
    if (hint) hint.style.display = "";
    console.log("[PanelsPIP] ⏹ Unloaded.");
  },

  _syncCompass(yaw) {
    const deg = (yaw * 180) / Math.PI;
    if (this._compassRing)
      this._compassRing.style.transform = `rotate(${deg}deg)`;
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
      this._seasonRing.style.transform = `rotate(${rotation}deg)`;
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
      this._seasonRing.style.transform = `rotate(${dialAngle}deg)`;
    }
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

  /** GPS-style player ring — drawn over WebGL PiP (center = avatar). */
  _pipOverlayRing() {
    const ov = this._overlayCanvas;
    const ctx = this._overlayCtx;
    if (!ov || !ctx) return;
    const w = ov.width;
    const h = ov.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.32;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.strokeStyle = "rgba(251,192,45,0.44)";
    ctx.lineWidth = Math.max(2, w * 0.009);
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = Math.max(1, w * 0.004);
    ctx.beginPath();
    ctx.arc(cx, cy, r + 2.5, 0, Math.PI * 2);
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
