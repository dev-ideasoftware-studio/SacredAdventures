/**
 * Sacred Adventures — sanctuary: DRAG-LOOK input adapter (2026-10-22).
 *
 * Anu domain: PLAYER (input + intent). The panel iframe covers the screen, so it tells taps from
 * drags itself (SacredGame.Panel.html, FND-49 relay block) and sends
 *   { type: 'LOOK_DRAG', phase: 'start' | 'move' | 'end', dx, dy }   (dx, dy in viewport widths)
 * at most once per animation frame. This module:
 *   • adds those deltas to window.__sanctuaryLookDrag, which SanctuaryKeyboardLook turns into yaw
 *     and pitch (same pattern as window.__sanctuaryJoystickInput);
 *   • cancels a click-to-move walk when a drag starts (keys and the joystick already do);
 *   • tells the panel when drag-look must be off (fishing, journal, Village View) so a press is a
 *     click again at once: { type: 'DRAG_LOOK_MODE', enabled }.
 * NOT in Orchestrator FISHING_SUSPEND_MODULES on purpose: it has to keep running to switch the
 * panel back to immediate clicks while fishing.
 * Cost: per frame a few flag reads; per message a few additions. No allocations, no layout reads.
 */

const SETTINGS_KEY = "v4.sanctuary.dragLook";
const DEFAULTS = Object.freeze({ enabled: true, sensitivity: 1, invertY: false });

export const SanctuaryDragLookModule = {
  name: "SanctuaryDragLook",

  _frame: null,
  _onMessage: null,
  _onFrameLoad: null,
  _settings: null,
  _sentEnabled: null, // last DRAG_LOOK_MODE value the panel got; null = send on the next frame
  _modeMsg: { type: "DRAG_LOOK_MODE", enabled: false }, // reused; postMessage copies it

  async load() {
    this._settings = { ...DEFAULTS };
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
      if (saved && typeof saved === "object") this._apply(saved, false);
    } catch (_) { /* private mode or blocked storage: keep the defaults */ }

    window.__sanctuaryLookDrag = {
      dx: 0, dy: 0, dragging: false,
      sens: this._settings.sensitivity, invertY: this._settings.invertY,
    };

    this._frame = document.getElementById("v4-panel-frame");
    this._onMessage = (event) => {
      if (!this._frame || event.source !== this._frame.contentWindow) return;
      const d = event.data;
      if (!d) return;
      if (d.type === "PANEL_INPUT_READY") { this._sentEnabled = null; return; } // panel (re)loaded
      if (d.type !== "LOOK_DRAG") return;
      const L = window.__sanctuaryLookDrag;
      if (!L || this._sentEnabled !== true) return; // late message after switching off: drop it
      if (d.phase === "move") {
        const dx = Number(d.dx), dy = Number(d.dy);
        if (Number.isFinite(dx)) L.dx += dx;
        if (Number.isFinite(dy)) L.dy += dy;
      } else if (d.phase === "start") {
        L.dragging = true;
        if (typeof window._v4CancelClickToMove === "function") window._v4CancelClickToMove();
      } else if (d.phase === "end") {
        L.dragging = false;
      }
    };
    window.addEventListener("message", this._onMessage);
    this._onFrameLoad = () => { this._sentEnabled = null; };
    this._frame?.addEventListener("load", this._onFrameLoad);

    // Test / future-settings hook. No kid-facing settings screen in v1 (owner decision §10.3).
    window._v4DragLook = {
      get: () => ({ ...this._settings }),
      set: (patch) => { this._apply(patch, true); return { ...this._settings }; },
    };

    console.log(
      "%c[Sanctuary] 🖐 Drag-look online — drag (or one finger) to look; tap still walks.",
      "color:#a5d6a7;font-weight:bold;",
    );
  },

  _apply(patch, save) {
    if (!patch || typeof patch !== "object") return;
    if (typeof patch.enabled === "boolean") this._settings.enabled = patch.enabled;
    if (Number.isFinite(patch.sensitivity)) this._settings.sensitivity = Math.min(3, Math.max(0.25, patch.sensitivity));
    if (typeof patch.invertY === "boolean") this._settings.invertY = patch.invertY;
    const L = window.__sanctuaryLookDrag;
    if (L) { L.sens = this._settings.sensitivity; L.invertY = this._settings.invertY; }
    this._sentEnabled = null;
    if (save) {
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this._settings)); } catch (_) { /* ignore */ }
    }
  },

  update() {
    const L = window.__sanctuaryLookDrag;
    if (!L) return;
    const enabled =
      this._settings.enabled === true &&
      window._v4InputSuppressed !== true &&   // journal open, or fishing
      window._v2InputSuppressed !== true &&   // fishing
      window.__sanctuaryFishingActive !== true &&
      !document.body.classList.contains("v4-top-down-view"); // Village View: mold tools own clicks
    if (!enabled && (L.dx !== 0 || L.dy !== 0 || L.dragging)) { L.dx = 0; L.dy = 0; L.dragging = false; }
    if (enabled !== this._sentEnabled) {
      const win = this._frame?.contentWindow;
      if (win) {
        this._modeMsg.enabled = enabled;
        win.postMessage(this._modeMsg, "*");
        this._sentEnabled = enabled;
      }
    }
  },

  unload() {
    if (this._onMessage) window.removeEventListener("message", this._onMessage);
    if (this._frame && this._onFrameLoad) this._frame.removeEventListener("load", this._onFrameLoad);
    try { this._frame?.contentWindow?.postMessage({ type: "DRAG_LOOK_MODE", enabled: false }, "*"); } catch (_) { /* ignore */ }
    delete window.__sanctuaryLookDrag;
    delete window._v4DragLook;
    this._onMessage = null;
    this._onFrameLoad = null;
    this._frame = null;
    this._sentEnabled = null;
  },
};
