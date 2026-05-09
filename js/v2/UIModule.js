export const UIModule = {
  name: "PanelsPIP",

  _root: null,
  _panelFrame: null,
  _pipCanvas: null,
  _pipCtx: null,
  _compassRing: null,
  _compassTextLayer: null,
  _compassMarkers: [],
  _seasonRing: null,
  _phaseSlots: [],
  _gameTime: 8,
  _season: "day",
  _onMessage: null,
  _lastPipDraw: 0,
  _lastMoonUpdate: 0,

  load() {
    this._root = document.createElement("div");
    this._root.id = "v2-panels-pip";
    this._root.innerHTML = `
      <style>
        #v2-panels-pip { position: fixed; inset: 0; pointer-events: none; z-index: 1000; font-family: Nunito, system-ui, sans-serif; }
        #v2-side-panel {
          position: fixed; inset: 0; width: 100%; height: 100%;
          border: none; background: transparent; overflow: hidden;
          pointer-events: none; z-index: 1000;
        }
        #panel-frame { width: 100%; height: 100%; border: 0; background: transparent; pointer-events: none; }
        #moondial-wrapper {
          position: absolute; top: 54px; left: 30px; width: clamp(190px,22vw,280px); height: clamp(190px,22vw,280px);
          z-index: 1200; border-radius: 50%; pointer-events: auto; cursor: pointer; overflow: visible;
          background: transparent; border: 6px solid rgba(210,180,140,0.72); box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }
        .compass-outer-ring {
          position: absolute; inset: -16px; border-radius: 50%;
          background: linear-gradient(145deg, rgba(71,47,25,0.94), rgba(22,18,14,0.94));
          border: 2px solid rgba(210,180,140,0.78);
          box-shadow: 0 0 22px rgba(251,192,45,0.22), inset 0 0 18px rgba(0,0,0,0.45);
          pointer-events: none; z-index: 1; will-change: transform; transform-origin: center;
          -webkit-mask-image: radial-gradient(circle closest-side, transparent calc(100% - 18px), black calc(100% - 17px));
          mask-image: radial-gradient(circle closest-side, transparent calc(100% - 18px), black calc(100% - 17px));
        }
        .compass-outer-ring::before {
          content: ''; position: absolute; inset: 2px; border-radius: 50%;
          background: repeating-conic-gradient(from 0deg, rgba(25,15,5,0.92) 0deg, rgba(25,15,5,0.92) 1.5deg, transparent 1.5deg, transparent 15deg);
          -webkit-mask-image: radial-gradient(circle closest-side, transparent calc(100% - 6px), black calc(100% - 5px));
          mask-image: radial-gradient(circle closest-side, transparent calc(100% - 6px), black calc(100% - 5px));
        }
        .compass-text-layer { position: absolute; inset: -16px; border-radius: 50%; pointer-events: none; z-index: 3; }
        .compass-marker {
          position: absolute; color: #d7ccc8; font-family: Georgia, serif; font-size: 14px; font-weight: 700;
          text-shadow: 0 1px 3px rgba(0,0,0,0.8); line-height: 1;
        }
        .compass-marker.n { top: 2px; left: 50%; transform: translateX(-50%); }
        .compass-marker.s { bottom: 2px; left: 50%; transform: translateX(-50%); }
        .compass-marker.e { right: 4px; top: 50%; transform: translateY(-50%); }
        .compass-marker.w { left: 4px; top: 50%; transform: translateY(-50%); }
        .season-bracket {
          position: absolute; top: -30px; left: 50%; transform: translateX(-50%); width: 32px; height: 40px;
          background: linear-gradient(145deg, rgba(79,53,31,0.98), rgba(23,18,13,0.98)); border-radius: 12px 12px 0 0;
          box-shadow: 0 -2px 10px rgba(0,0,0,0.1), inset 0 2px 4px rgba(255,255,255,0.2);
          pointer-events: none; z-index: 10;
        }
        .season-outer-ring { position: absolute; inset: -24px; border-radius: 50%; pointer-events: none; z-index: -1; transition: transform 0.5s cubic-bezier(0.34,1.56,0.64,1); }
        .season-outer-bg {
          position: absolute; inset: 0; border-radius: 50%; background: linear-gradient(145deg, rgba(71,47,25,0.94), rgba(22,18,14,0.94));
          box-shadow: inset 0 2px 10px rgba(0,0,0,0.25), 0 5px 15px rgba(0,0,0,0.18);
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
        #pipCanvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; border-radius: 50%; background: #16230f; z-index: -1; pointer-events: none; }
        .pip-vignette {
          position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 50%; z-index: -1; pointer-events: none;
          box-shadow: inset 0 0 30px rgba(0,0,0,0.2), inset 0 0 60px rgba(255,255,255,0.5);
        }
        .moon-phase-layer {
          position: absolute; inset: -2px; border-radius: 50%; pointer-events: none; z-index: 4;
        }
        .moon-phase-dot {
          position: absolute; width: 11%; height: 11%; border-radius: 50%;
          transform: translate(-50%, -50%);
          background: radial-gradient(circle at 35% 32%, #f4f4ef 0 38%, #10192f 40% 100%);
          border: 2px solid rgba(93,64,55,0.95);
          box-shadow: 0 2px 8px rgba(0,0,0,0.62), inset 0 0 6px rgba(255,255,255,0.28);
        }
        .moon-phase-dot.active {
          border-color: #fbc02d;
          box-shadow: 0 0 0 3px rgba(251,192,45,0.85), 0 0 14px rgba(251,192,45,0.7), inset 0 0 6px rgba(255,255,255,0.35);
        }
        #pip-click-overlay {
          position: absolute; top: 10%; left: 10%; width: 80%; height: 80%; border-radius: 50%;
          z-index: 50; cursor: pointer; background: transparent; pointer-events: auto;
        }
        #v2-distance-pill {
          position: absolute; left: 38px; top: calc(54px + clamp(190px,22vw,280px) + 34px); padding: 8px 12px; border-radius: 999px;
          color: #f7d774; background: rgba(15,12,9,0.72); border: 1px solid rgba(251,192,45,0.24);
          font-size: 12px; letter-spacing: 0.4px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        }
      </style>
      <div id="v2-side-panel"><iframe id="panel-frame" src="./SacredGame.Panel.html" title="Sacred Adventures Panel"></iframe></div>
      <div id="v2-distance-pill">0 ft travelled</div>
      <div id="moondial-wrapper" title="Click to toggle Village Map / FPV">
        <div class="compass-outer-ring"></div>
        <div class="compass-text-layer">
          <span class="compass-marker n">N</span>
          <span class="compass-marker s">S</span>
          <span class="compass-marker e">E</span>
          <span class="compass-marker w">W</span>
        </div>
        <div class="season-bracket"></div>
        <canvas id="pipCanvas" width="512" height="512"></canvas>
        <div class="pip-vignette"></div>
        <div class="moon-phase-layer">
          <div class="moon-phase-dot" data-phase="0" style="top:9%;left:50%;"></div>
          <div class="moon-phase-dot" data-phase="1" style="top:20%;left:80%;"></div>
          <div class="moon-phase-dot" data-phase="2" style="top:50%;left:91%;"></div>
          <div class="moon-phase-dot" data-phase="3" style="top:80%;left:80%;"></div>
          <div class="moon-phase-dot" data-phase="4" style="top:91%;left:50%;"></div>
          <div class="moon-phase-dot" data-phase="5" style="top:80%;left:20%;"></div>
          <div class="moon-phase-dot" data-phase="6" style="top:50%;left:9%;"></div>
          <div class="moon-phase-dot" data-phase="7" style="top:20%;left:20%;"></div>
        </div>
        <div class="season-outer-ring" id="season-ring">
          <div class="season-outer-bg"></div>
          <div class="season-anchor" style="transform: rotate(0deg);"><div class="season-btn-wrap" style="transform: rotate(0deg);"><span class="season-btn" data-season="night" title="Starlight Night">🌙</span></div></div>
          <div class="season-anchor" style="transform: rotate(72deg);"><div class="season-btn-wrap" style="transform: rotate(-72deg);"><span class="season-btn" data-season="dawn" title="Cool Dawn">🌤</span></div></div>
          <div class="season-anchor" style="transform: rotate(144deg);"><div class="season-btn-wrap" style="transform: rotate(-144deg);"><span class="season-btn" data-season="day" title="Golden Spirit Day">☀️</span></div></div>
          <div class="season-anchor" style="transform: rotate(216deg);"><div class="season-btn-wrap" style="transform: rotate(-216deg);"><span class="season-btn" data-season="dusk" title="Amber Dusk">🔅</span></div></div>
          <div class="season-anchor" style="transform: rotate(288deg);"><div class="season-btn-wrap" style="transform: rotate(-288deg);"><span class="season-btn" data-season="gray" title="Overcast Gray">☁️</span></div></div>
        </div>
        <div id="pip-click-overlay"></div>
      </div>
    `;
    document.body.appendChild(this._root);
    this._panelFrame = this._root.querySelector("#panel-frame");
    this._pipCanvas = this._root.querySelector("#pipCanvas");
    this._pipCtx = this._pipCanvas.getContext("2d", { alpha: true });
    this._compassRing = this._root.querySelector(".compass-outer-ring");
    this._compassTextLayer = this._root.querySelector(".compass-text-layer");
    this._compassMarkers = [...this._root.querySelectorAll(".compass-marker")];
    this._seasonRing = this._root.querySelector("#season-ring");
    this._phaseSlots = [...this._root.querySelectorAll(".moon-phase-dot")];
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
    this._panelFrame.addEventListener("load", () =>
      this._hideEmbeddedPanelPIP(),
    );
    window.pipCanvas2D = this._pipCanvas;
    window.pipCtx = this._pipCtx;
    console.log(
      "%c[PanelsPIP] ✅ Panel iframe + lightweight PIP loaded",
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
    if (frameCount % 3 === 0) this._syncCompass(player.yaw);
    if (frameCount - this._lastMoonUpdate >= 30) {
      this._lastMoonUpdate = frameCount;
      this._syncMoonDial();
    }
    if (frameCount - this._lastPipDraw < 4) return;
    this._lastPipDraw = frameCount;
    this._drawPIP(player);
  },

  unload() {
    if (this._root) this._root.remove();
    this._root = null;
    this._panelFrame = null;
    this._pipCanvas = null;
    this._pipCtx = null;
    this._compassRing = null;
    this._compassTextLayer = null;
    this._compassMarkers = [];
    this._seasonRing = null;
    this._phaseSlots = [];
    if (this._onMessage) window.removeEventListener("message", this._onMessage);
    this._onMessage = null;
    if (window.pipCanvas2D) window.pipCanvas2D = null;
    if (window.pipCtx) window.pipCtx = null;
    const hint = document.getElementById("v2-hint");
    if (hint) hint.style.display = "";
    console.log("[PanelsPIP] ⏹ Unloaded.");
  },

  _syncCompass(yaw) {
    const deg = (yaw * 180) / Math.PI;
    if (this._compassRing)
      this._compassRing.style.transform = `rotate(${deg}deg)`;
    if (this._compassTextLayer)
      this._compassTextLayer.style.transform = `rotate(${deg}deg)`;
    for (const marker of this._compassMarkers) {
      if (marker.classList.contains("e") || marker.classList.contains("w")) {
        marker.style.transform = `translateY(-50%) rotate(${-deg}deg)`;
      } else {
        marker.style.transform = `translateX(-50%) rotate(${-deg}deg)`;
      }
    }
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
    window.dispatchEvent(
      new CustomEvent("v2-season-change", {
        detail: { season, time: this._gameTime },
      }),
    );
    this._syncMoonDial();
  },

  _syncMoonDial() {
    const phase = Math.floor((this._gameTime / 24) * 8) % 8;
    for (const dot of this._phaseSlots) {
      dot.classList.toggle("active", Number(dot.dataset.phase) === phase);
    }
    if (this._seasonRing && this._season === "day") {
      const dialAngle = ((this._gameTime - 12) / 24) * 360;
      this._seasonRing.style.transform = `rotate(${dialAngle}deg)`;
    }
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

  _drawPIP(player) {
    const ctx = this._pipCtx;
    if (!ctx) return;
    const w = this._pipCanvas.width;
    const h = this._pipCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    ctx.clearRect(0, 0, w, h);
    const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, cx);
    grad.addColorStop(0, "#7dad58");
    grad.addColorStop(0.58, "#3d6f31");
    grad.addColorStop(1, "#14220f");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(player.yaw);
    ctx.translate(-cx, -cy);

    ctx.strokeStyle = "rgba(255,236,160,0.09)";
    ctx.lineWidth = 1;
    for (let i = -10; i <= 10; i++) {
      const offX = cx + ((player.position.x * 8 + i * 28) % 28) - 14;
      const offZ = cy + ((player.position.z * 8 + i * 28) % 28) - 14;
      ctx.beginPath();
      ctx.moveTo(offX, 0);
      ctx.lineTo(offX, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, offZ);
      ctx.lineTo(w, offZ);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(20,55,16,0.32)";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(cx - 110, cy + 44);
    ctx.bezierCurveTo(cx - 52, cy + 20, cx + 18, cy - 15, cx + 108, cy - 38);
    ctx.stroke();
    ctx.strokeStyle = "rgba(126,181,92,0.38)";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-player.yaw);
    ctx.fillStyle = "#fbc02d";
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(11, 12);
    ctx.lineTo(0, 7);
    ctx.lineTo(-11, 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(cx, cy, cx - 8, 0, Math.PI * 2);
    ctx.stroke();
  },
};
