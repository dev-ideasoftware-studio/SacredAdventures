/**
 * Sacred Adventures — sanctuary part 19 of N: PIP (PICTURE-IN-PICTURE).
 *
 * A circular minimap parked in the top-LEFT corner that renders the
 * sanctuary scene from a top-down orthographic camera at a low stride
 * (every 6 frames). Reads like a moondial / wayfinder — the kid's
 * fast glance to "where am I" without leaving FPV.
 *
 * Anu domain: PLAYER (it's an input/UI surface, not a world body).
 *
 * Implementation:
 *   • One extra `WebGLRenderer` painting to a 220×220 canvas pinned
 *     to top-left. Same Three scene instance — no scene clones.
 *   • Orthographic camera looking straight down, follows the avatar
 *     position; frustum spans 38 m (so the whole hill ring fits).
 *   • Strides every 6 frames so the second pass only fires 10 Hz at
 *     60 FPS — measurable cost, but bounded. Anu's adaptive DPR
 *     applies to the MAIN renderer only; this one is fixed.
 *   • A circular CSS mask + gold ring border around the canvas so it
 *     reads as a magic compass, not a debug overlay.
 *
 * Triangle cost: same as the main scene, but only every 6th frame.
 * Anu's `pip-pass` fuzzy candidate will move from NOMINAL → WATCH
 * once this lights up — that's expected and acceptable.
 */

import * as THREE from "three";

const PIP_SIZE_PX = 220;
const PIP_RENDER_STRIDE = 6;       // render every Nth frame
const PIP_VIEW_RADIUS_M = 22;      // ortho frustum half-width

const STYLE = `
  #v4-pip {
    position: fixed;
    top: 18px;
    left: 18px;
    width: ${PIP_SIZE_PX}px;
    height: ${PIP_SIZE_PX}px;
    z-index: 9050;
    pointer-events: none;
    user-select: none;
    border-radius: 50%;
    overflow: hidden;
    border: 3px solid rgba(251, 192, 45, 0.65);
    box-shadow:
      0 6px 24px rgba(0,0,0,0.55),
      inset 0 0 22px rgba(0,0,0,0.45),
      0 0 14px rgba(251,192,45,0.25);
    background: #0e1418;
  }
  #v4-pip-canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  /* Centre-of-pip player dot — pure CSS, no canvas work each frame. */
  #v4-pip-marker {
    position: absolute;
    top: 50%; left: 50%;
    width: 10px; height: 10px;
    background: #fbc02d;
    border: 2px solid #1a120a;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    box-shadow: 0 0 8px rgba(251,192,45,0.85);
    pointer-events: none;
  }
  /* Small "N" reminder so kids know which way is "north" on the map. */
  #v4-pip-north {
    position: absolute;
    top: 6px; left: 50%;
    transform: translateX(-50%);
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 11px;
    font-weight: 800;
    color: #ffe9a8;
    letter-spacing: 2px;
    text-shadow: 0 1px 3px rgba(0,0,0,0.95);
    pointer-events: none;
  }
`;

function ensureStyle() {
  if (document.getElementById("v4-pip-style")) return;
  const s = document.createElement("style");
  s.id = "v4-pip-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

export const SanctuaryPipModule = {
  name: "SanctuaryPip",

  _scene: null,
  _wrap: null,
  _canvas: null,
  _renderer: null,
  _camera: null,
  _frame: 0,

  async load(scene) {
    if (this._wrap) return;
    this._scene = scene;
    ensureStyle();

    const wrap = document.createElement("div");
    wrap.id = "v4-pip";
    const canvas = document.createElement("canvas");
    canvas.id = "v4-pip-canvas";
    canvas.width = PIP_SIZE_PX;
    canvas.height = PIP_SIZE_PX;
    wrap.appendChild(canvas);
    const marker = document.createElement("div");
    marker.id = "v4-pip-marker";
    wrap.appendChild(marker);
    const north = document.createElement("div");
    north.id = "v4-pip-north";
    north.textContent = "N";
    wrap.appendChild(north);
    document.body.appendChild(wrap);

    this._wrap = wrap;
    this._canvas = canvas;

    this._renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: false,
      antialias: false,
      powerPreference: "low-power",
    });
    this._renderer.setPixelRatio(1);
    this._renderer.setSize(PIP_SIZE_PX, PIP_SIZE_PX, false);
    this._renderer.setClearColor(0x0e1418, 1);
    if (scene.fog) {
      // The main scene fog is too dense for top-down; we'll disable fog
      // on the pip pass instead of cloning the scene.
    }

    // Orthographic top-down camera. Frustum spans ±PIP_VIEW_RADIUS_M.
    this._camera = new THREE.OrthographicCamera(
      -PIP_VIEW_RADIUS_M,
      PIP_VIEW_RADIUS_M,
      PIP_VIEW_RADIUS_M,
      -PIP_VIEW_RADIUS_M,
      0.5,
      200,
    );
    this._camera.position.set(0, 80, 0);
    this._camera.lookAt(0, 0, 0);
    this._camera.up.set(0, 0, -1); // so "north" (-Z) reads UP on the minimap

    console.log(
      "%c[Sanctuary] 🧭 PIP minimap ready — top-left, top-down, 6-frame stride.",
      "color:#fbc02d;font-weight:bold;",
    );
  },

  update() {
    if (!this._renderer || !this._scene) return;
    this._frame++;
    if (this._frame % PIP_RENDER_STRIDE !== 0) return;

    // Track the avatar (or fall back to (0,0)) so the pip recentres.
    const avatar = typeof window !== "undefined" ? window.__sanctuaryAvatar : null;
    const cx = avatar?.position?.x ?? 0;
    const cz = avatar?.position?.z ?? 0;
    this._camera.position.set(cx, 80, cz);
    this._camera.lookAt(cx, 0, cz);

    // Stash + clear scene fog for this pass so the top-down isn't
    // washed white. Restore after render so the main pass is untouched.
    const fog = this._scene.fog;
    this._scene.fog = null;
    try {
      this._renderer.render(this._scene, this._camera);
    } finally {
      this._scene.fog = fog;
    }
  },

  unload() {
    if (this._renderer) {
      this._renderer.dispose();
      this._renderer = null;
    }
    if (this._wrap?.parentNode) this._wrap.parentNode.removeChild(this._wrap);
    const s = document.getElementById("v4-pip-style");
    if (s?.parentNode) s.parentNode.removeChild(s);
    this._wrap = null;
    this._canvas = null;
    this._camera = null;
    this._scene = null;
  },
};
