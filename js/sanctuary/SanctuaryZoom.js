/**
 * Sacred Adventures — sanctuary part 20 of N: SCROLL-WHEEL ZOOM.
 *
 * Anu domain: PLAYER (input + intent).
 *
 * Mouse wheel scales the camera distance in both view modes:
 *
 *   • FPV / chase view  — wheel adjusts a `_zoomFactor` ∈ [0.45, 2.4]
 *                          that the keyboard-look chase camera reads as
 *                          a multiplier for CAMERA_BACK and CAMERA_UP.
 *                          Wheel up = zoom IN toward avatar; wheel down
 *                          = pull back.
 *   • Top-down view     — wheel scales the orbital camera Y (height
 *                          above the world). Range 14 .. 70 m. The
 *                          tool palette stays usable since the X/Z
 *                          centre doesn't move.
 *
 * The keyboard-look module reads `window.__sanctuaryZoomFactor`
 * each frame; the Controls top-down toggle reads
 * `window.__sanctuaryTopDownHeight` when re-poising the camera.
 */

const FPV_ZOOM_MIN = 0.45;
const FPV_ZOOM_MAX = 2.4;
const FPV_ZOOM_STEP = 0.08;
const TOP_ZOOM_MIN_Y = 14;
const TOP_ZOOM_MAX_Y = 70;
const TOP_ZOOM_STEP = 4.0;

export const SanctuaryZoomModule = {
  name: "SanctuaryZoom",

  _canvas: null,
  _camera: null,
  _onWheel: null,
  _fpvZoom: 1.0,
  _topDownY: 40,

  async load(_scene, camera, renderer) {
    this._camera = camera;
    this._canvas = renderer?.domElement ?? null;
    if (typeof window !== "undefined") {
      window.__sanctuaryZoomFactor = this._fpvZoom;
      window.__sanctuaryTopDownHeight = this._topDownY;
    }

    this._onWheel = (ev) => {
      // Only handle wheel events that target the game canvas, not the
      // tool palette / controls bar / page chrome. The canvas listener
      // (registered below) already scopes this; we just guard against
      // browsers that bubble the event back up here.
      ev.preventDefault();
      const inTopDown =
        typeof document !== "undefined" &&
        document.body.classList.contains("v4-top-down-view");
      const dir = ev.deltaY > 0 ? 1 : -1; // +ve = zoom OUT
      if (inTopDown) {
        this._topDownY = Math.max(
          TOP_ZOOM_MIN_Y,
          Math.min(TOP_ZOOM_MAX_Y, this._topDownY + dir * TOP_ZOOM_STEP),
        );
        if (typeof window !== "undefined") {
          window.__sanctuaryTopDownHeight = this._topDownY;
        }
        // Apply immediately so the user sees the change without waiting
        // for a re-toggle. Camera looks straight down so only Y changes.
        if (this._camera) {
          this._camera.position.y = this._topDownY;
          this._camera.lookAt(this._camera.position.x, 0, this._camera.position.z);
        }
      } else {
        this._fpvZoom = Math.max(
          FPV_ZOOM_MIN,
          Math.min(FPV_ZOOM_MAX, this._fpvZoom + dir * FPV_ZOOM_STEP),
        );
        if (typeof window !== "undefined") {
          window.__sanctuaryZoomFactor = this._fpvZoom;
        }
      }
    };

    // `passive: false` so we can preventDefault to stop the page
    // scrolling while the cursor is over the game canvas.
    if (this._canvas) {
      this._canvas.addEventListener("wheel", this._onWheel, { passive: false });
    }

    console.log(
      "%c[Sanctuary] 🔍 Scroll-wheel zoom online — FPV chase + top-down height.",
      "color:#80deea;font-weight:bold;",
    );
  },

  update() { /* state lives on window; readers do the work */ },

  unload() {
    if (this._onWheel && this._canvas) {
      this._canvas.removeEventListener("wheel", this._onWheel);
    }
    this._onWheel = null;
    this._canvas = null;
    this._camera = null;
    if (typeof window !== "undefined") {
      delete window.__sanctuaryZoomFactor;
      delete window.__sanctuaryTopDownHeight;
    }
  },
};
