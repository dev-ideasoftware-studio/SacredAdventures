import { getRuntimeService } from "./RuntimeServices.js";
import { getFrameBudgetSnapshot } from "./anu/FrameBudget.js";
import { pipCompassRingRotationDegFromYawRad } from "./pipCompassMath.js";

export const UIModule = {
  name: "PanelsPIP",

  _root: null,
  _panelFrame: null,
  _moonFrame: null,
  _compassRing: null,
  _pipCanvas: null,
  _gameTime: 8,

  load(scene, camera, _renderer, orchestrator) {
    this._orc = orchestrator;
    
    if (!document.getElementById("v2-font-cinzel")) {
      const l = document.createElement("link");
      l.id = "v2-font-cinzel";
      l.rel = "stylesheet";
      l.href = "https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&display=swap";
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
        
        #moondial-wrapper {
          position: absolute;
          top: 20px;
          left: 20px;
          width: clamp(200px, 25vw, 300px);
          height: clamp(200px, 25vw, 300px);
          z-index: 3500;
          border-radius: 50%;
          pointer-events: auto;
          cursor: default;
          overflow: visible;
          isolation: isolate;
          background: radial-gradient(circle, rgba(15, 10, 5, 0.4) 30%, rgba(5, 2, 0, 0.9) 100%);
          border: 3px solid rgba(255, 215, 0, 0.4);
          box-shadow: 
              inset 0 0 30px rgba(0, 0, 0, 0.9),
              0 0 0 8px #1a1512, /* Outer Iron Chassis */
              0 15px 40px rgba(0, 0, 0, 0.8), /* Volumetric shadow */
              0 0 20px rgba(255, 180, 50, 0.1);
          --pip-moon-track: 22px;
          --pip-compass-track: 20px;
          --pip-outer-track: 16px;
        }

        @media (max-width: 768px) {
          #moondial-wrapper {
            --pip-moon-track: 11px;
            --pip-compass-track: 10px;
            --pip-outer-track: 8px;
          }
        }
        
        #moondial-wrapper iframe {
            position: absolute;
            inset: 6px;
            width: calc(100% - 12px);
            height: calc(100% - 12px);
            border: none;
            border-radius: 50%;
            pointer-events: none;
            z-index: 2;
        }

        #pipCanvas {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 88%;
            height: 88%;
            border-radius: 50%;
            z-index: 1;
            pointer-events: none;
        }

        #pip-click-zone {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 10001;
            border-radius: 50%;
            cursor: pointer;
            pointer-events: auto;
        }

        /* Compass Animated Rotating Frame */
        .compass-outer-ring {
            position: absolute;
            inset: -16px; /* Exactly half width bounds */
            border-radius: 50%;
            background: conic-gradient(
                from 0deg,
                #3e2723 0%, #6d4c41 25%, #3e2723 50%, #6d4c41 75%, #3e2723 100%
            );
            border: 2px solid #2a1a17;
            box-shadow: 
                inset 0 1px 5px rgba(255, 255, 255, 0.2),
                inset 0 -2px 8px rgba(0, 0, 0, 0.8),
                0 4px 15px rgba(0,0,0,0.8);
            pointer-events: none;
            z-index: 3; /* Maps over canvas */
            will-change: transform;
            transform-origin: center;
            -webkit-mask-image: radial-gradient(circle closest-side, transparent calc(100% - 18px), black calc(100% - 17px));
            mask-image: radial-gradient(circle closest-side, transparent calc(100% - 18px), black calc(100% - 17px));
        }

        .compass-outer-ring::before {
            content: '';
            position: absolute;
            inset: 2px;
            border-radius: 50%;
            background: repeating-conic-gradient(
                from 0deg,
                rgba(25, 15, 5, 0.9) 0deg,
                rgba(25, 15, 5, 0.9) 1.5deg,
                transparent 1.5deg,
                transparent 15deg
            );
            /* Mask to only show the ticks exactly on the rim */
            -webkit-mask-image: radial-gradient(circle closest-side, transparent calc(100% - 6px), black calc(100% - 5px));
            mask-image: radial-gradient(circle closest-side, transparent calc(100% - 6px), black calc(100% - 5px));
        }

        /* Cardinal Direction Markers */
        .compass-marker {
            position: absolute;
            color: #d7ccc8; /* Softer, low-contrast parchment/silver instead of glowing gold */
            font-family: 'Cinzel', serif;
            font-size: 14px; /* Shrunk appropriately so they don't break out of the 50% smaller ring */
            font-weight: 700;
            text-shadow: 0 1px 3px rgba(0,0,0, 0.8);
            line-height: 1;
        }

        .compass-marker.n { top: 2px; left: 50%; transform: translateX(-50%); }
        .compass-marker.s { bottom: 2px; left: 50%; transform: translateX(-50%); }
        .compass-marker.e { right: 4px; top: 50%; transform: translateY(-50%); }
        .compass-marker.w { left: 4px; top: 50%; transform: translateY(-50%); }

        #v2-distance-pill {
          position: absolute;
          left: calc(20px + clamp(200px, 25vw, 300px) / 2);
          top: calc(20px + clamp(200px, 25vw, 300px) + 14px);
          transform: translateX(-50%);
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
            top: calc(20px + clamp(200px, 25vw, 300px) + 8px);
          }
        }
      </style>
      <div id="v2-side-panel"><iframe id="panel-frame" title="Sacred Adventures Panel"></iframe></div>
      <div id="v2-distance-pill">POS: 0.0, 0.0, 0.0 | YAW: 0.00</div>
      <div id="moondial-wrapper" title="Sacred Adventures v2 — moondial">
        <div class="compass-outer-ring">
          <span class="compass-marker n">N</span>
          <span class="compass-marker s">S</span>
          <span class="compass-marker e">E</span>
          <span class="compass-marker w">W</span>
        </div>
        <iframe id="moondial-frame" src="js/components/Component.MoonDial.html?v=v4"></iframe>
        <canvas id="pipCanvas" width="512" height="512"></canvas>
        <div id="pip-click-zone" title="Toggle minimap view"></div>
      </div>
    `;
    document.body.appendChild(this._root);
    this._panelFrame = this._root.querySelector("#panel-frame");
    this._moonFrame = this._root.querySelector("#moondial-frame");
    this._compassRing = this._root.querySelector(".compass-outer-ring");
    this._pipCanvas = this._root.querySelector("#pipCanvas");

    const toggle = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const player = getRuntimeService("WorldPlayer") ?? window.WorldPlayer;
      const next = player?.toggleMainCanvasMapView?.();
      window.postMessage({ type: "TOGGLE_VIEW_MODE" }, "*");
    };
    this._root.querySelector("#pip-click-zone")?.addEventListener("click", toggle);

    const hint = document.getElementById("v2-hint");
    if (hint) hint.style.display = "none";
    this._panelFrame.src = "about:blank";

    console.log(
      "%c[PanelsPIP] UI Module re-integrated with MoonDial.",
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

    if (this._moonFrame && this._moonFrame.contentWindow && frameCount % 15 === 0) {
      this._moonFrame.contentWindow.postMessage({ type: "UPDATE_MOON", time: this._gameTime }, "*");
    }
  },

  _syncCompass(yaw) {
    const deg = pipCompassRingRotationDegFromYawRad(yaw);
    if (this._compassRing) {
      this._compassRing.style.transform = `rotate(${deg}deg)`;
      const markers = this._compassRing.querySelectorAll(".compass-marker");
      markers.forEach((marker) => {
        let translate = "translate(-50%, -50%)";
        if (marker.classList.contains("s")) {
          translate = "translate(-50%, 50%)";
        } else if (marker.classList.contains("e")) {
          translate = "translate(50%, -50%)";
        }
        marker.style.transform = `${translate} rotate(${-deg}deg)`;
      });
    }
  },

  unload() {
    if (this._root) this._root.remove();
    this._root = null;
    this._panelFrame = null;
    this._moonFrame = null;
    this._compassRing = null;
    this._pipCanvas = null;
    
    const hint = document.getElementById("v2-hint");
    if (hint) hint.style.display = "";
    console.log("[PanelsPIP] ⏹ Unloaded.");
  }
};
