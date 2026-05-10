export const PipRenderStrategy = Object.freeze({
  FULL_SCENE_ORTHO: "full-scene-ortho",
  SURROGATE_2D: "surrogate-2d",
});

export function createSurrogatePipRenderStrategy() {
  let _ctx = null;
  let _canvas = null;
  let _w = 0;
  let _h = 0;

  function ensure(canvas) {
    if (_canvas !== canvas) {
      _canvas = canvas;
      _ctx = canvas.getContext("2d", { alpha: true });
    }
    const pr = Math.min(window.devicePixelRatio || 1, 1.25);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(160, Math.floor(rect.width * pr));
    const h = Math.max(160, Math.floor(rect.height * pr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    _w = w;
    _h = h;
    return _ctx;
  }

  function drawCompass(ctx, yaw) {
    const cx = _w / 2;
    const cy = _h / 2;
    const r = Math.min(_w, _h) * 0.45;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-yaw);
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = Math.max(1, _w * 0.004);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78);
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.stroke();
    }
    ctx.restore();
  }

  return {
    id: PipRenderStrategy.SURROGATE_2D,
    label: "PiP=2D surrogate",

    render({ canvas, worldPlayer, scene }) {
      const ctx = ensure(canvas);
      if (!ctx || !worldPlayer?.feet) return false;
      const cx = _w / 2;
      const cy = _h / 2;
      const r = Math.min(_w, _h) / 2;
      ctx.clearRect(0, 0, _w, _h);

      const gradient = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
      gradient.addColorStop(0, "rgba(123, 167, 91, 0.92)");
      gradient.addColorStop(0.7, "rgba(56, 103, 58, 0.88)");
      gradient.addColorStop(1, "rgba(24, 42, 31, 0.94)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      drawCompass(ctx, worldPlayer.yaw || 0);

      ctx.fillStyle = "rgba(33, 74, 36, 0.34)";
      for (let i = 0; i < 34; i++) {
        const a = i * 2.399963;
        const d = ((i * 17) % 43) / 43;
        const x = cx + Math.cos(a) * d * r * 0.86;
        const y = cy + Math.sin(a) * d * r * 0.86;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.8, _w * 0.006), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.strokeStyle = "rgba(251,192,45,0.30)";
      ctx.lineWidth = Math.max(1, _w * 0.006);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2);
      ctx.stroke();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-(worldPlayer.yaw || 0));
      ctx.fillStyle = "rgba(255,255,255,0.94)";
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.15);
      ctx.lineTo(r * 0.065, r * 0.08);
      ctx.lineTo(0, r * 0.035);
      ctx.lineTo(-r * 0.065, r * 0.08);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = "rgba(251,192,45,0.88)";
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(3, _w * 0.018), 0, Math.PI * 2);
      ctx.fill();
      void scene;
      return true;
    },

    getSnapshot() {
      return Object.freeze({
        id: this.id,
        label: this.label,
        canvasWidth: _w,
        canvasHeight: _h,
        secondWebGlPass: false,
      });
    },

    dispose() {
      _ctx = null;
      _canvas = null;
      _w = 0;
      _h = 0;
    },
  };
}
