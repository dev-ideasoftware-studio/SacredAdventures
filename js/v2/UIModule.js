import { getRuntimeService } from "./RuntimeServices.js";
import { getFrameBudgetSnapshot } from "./anu/FrameBudget.js";

export const UIModule = {
  name: "PanelsPIP",

  _root: null,
  _panelFrame: null,

  load(scene, camera, _renderer, orchestrator) {
    this._orc = orchestrator;
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
        #v2-distance-pill {
          position: absolute;
          left: 170px; /* Positioned near top-left, matching the old minimap clearance */
          top: 250px;
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
            top: 230px;
          }
        }
      </style>
      <div id="v2-side-panel"><iframe id="panel-frame" title="Sacred Adventures Panel"></iframe></div>
      <div id="v2-distance-pill">POS: 0.0, 0.0, 0.0 | YAW: 0.00</div>
    `;
    document.body.appendChild(this._root);
    this._panelFrame = this._root.querySelector("#panel-frame");

    const hint = document.getElementById("v2-hint");
    if (hint) hint.style.display = "none";
    this._panelFrame.src = "about:blank";

    console.log(
      "%c[PanelsPIP] UI Module stripped of MoonDial — Side panel + pill active.",
      "color:#81d4fa;font-weight:bold;",
    );
  },

  update(_delta, frameCount) {
    const player = getRuntimeService("WorldPlayer") ?? window.WorldPlayer;
    if (!player) return;

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
  },

  unload() {
    if (this._root) this._root.remove();
    this._root = null;
    this._panelFrame = null;
    
    const hint = document.getElementById("v2-hint");
    if (hint) hint.style.display = "";
    console.log("[PanelsPIP] ⏹ Unloaded.");
  }
};
