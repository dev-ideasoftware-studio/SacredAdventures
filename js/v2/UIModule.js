export const UIModule = {
  name: "PanelsPIP",

  _root: null,
  _panelFrame: null,
  _pipCanvas: null,
  _pipCtx: null,
  _lastPipDraw: 0,

  load() {
    this._root = document.createElement("div");
    this._root.id = "v2-panels-pip";
    this._root.innerHTML = `
      <style>
        #v2-panels-pip { position: fixed; inset: 0; pointer-events: none; z-index: 9000; font-family: Nunito, system-ui, sans-serif; }
        #v2-side-panel {
          position: absolute; right: 18px; top: 96px; width: 270px; height: min(70vh, 620px);
          border: 1px solid rgba(251,192,45,0.28); border-radius: 22px;
          background: linear-gradient(145deg, rgba(38,28,17,0.84), rgba(13,12,10,0.9));
          box-shadow: 0 18px 55px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08);
          overflow: hidden; pointer-events: auto; backdrop-filter: blur(12px);
        }
        #panel-frame { width: 100%; height: 100%; border: 0; background: transparent; }
        #v2-pip-wrap {
          position: absolute; left: 24px; bottom: 24px; width: 178px; height: 178px;
          border-radius: 50%; padding: 10px;
          background: radial-gradient(circle at 35% 25%, rgba(255,245,190,0.28), rgba(38,28,17,0.94) 58%, rgba(7,7,6,0.98));
          border: 2px solid rgba(251,192,45,0.42);
          box-shadow: 0 14px 38px rgba(0,0,0,0.6), inset 0 0 18px rgba(251,192,45,0.18);
          pointer-events: auto;
        }
        #pipCanvas { width: 100%; height: 100%; display: block; border-radius: 50%; background: #16230f; }
        #v2-distance-pill {
          position: absolute; left: 26px; bottom: 216px; padding: 8px 12px; border-radius: 999px;
          color: #f7d774; background: rgba(15,12,9,0.72); border: 1px solid rgba(251,192,45,0.24);
          font-size: 12px; letter-spacing: 0.4px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        }
      </style>
      <div id="v2-side-panel"><iframe id="panel-frame" src="./SacredGame.Panel.html" title="Sacred Adventures Panel"></iframe></div>
      <div id="v2-distance-pill">0 ft travelled</div>
      <div id="v2-pip-wrap"><canvas id="pipCanvas" width="256" height="256"></canvas></div>
    `;
    document.body.appendChild(this._root);
    this._panelFrame = this._root.querySelector("#panel-frame");
    this._pipCanvas = this._root.querySelector("#pipCanvas");
    this._pipCtx = this._pipCanvas.getContext("2d", { alpha: true });
    window.pipCanvas2D = this._pipCanvas;
    window.pipCtx = this._pipCtx;
    console.log("%c[PanelsPIP] ✅ Panel iframe + lightweight PIP loaded", "color:#81d4fa;font-weight:bold;");
  },

  update(_delta, frameCount) {
    const player = window.WorldPlayer;
    if (!player) return;
    const pill = this._root && this._root.querySelector("#v2-distance-pill");
    if (pill && frameCount % 10 === 0) pill.textContent = `${Math.round(player.distanceFeet)} ft travelled`;
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
    if (window.pipCanvas2D) window.pipCanvas2D = null;
    if (window.pipCtx) window.pipCtx = null;
    console.log("[PanelsPIP] ⏹ Unloaded.");
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
    grad.addColorStop(0.65, "#355b28");
    grad.addColorStop(1, "#14220f");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255,236,160,0.12)";
    ctx.lineWidth = 1;
    for (let i = -4; i <= 4; i++) {
      const off = ((player.position.x + player.position.z) * 2 + i * 30) % 30;
      ctx.beginPath();
      ctx.moveTo(off, 0);
      ctx.lineTo(off + w, h);
      ctx.stroke();
    }

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
