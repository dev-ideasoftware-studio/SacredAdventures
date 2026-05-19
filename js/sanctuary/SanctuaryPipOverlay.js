/**
 * Sacred Adventures — sanctuary part 21 of N: PIP OVERLAY · COMPASS + MOON.
 *
 * Anu domain: PLAYER (UI surface). Stacks an animated 2D canvas on top
 * of the existing `SanctuaryPip` minimap. The 3D top-down stays as-is;
 * this layer paints the wayfinder furniture over it:
 *
 *   • Outer compass bezel  — gold rim with subtle tick marks.
 *   • Cardinal labels      — N / E / S / W rotating with the player's
 *                            yaw (the rose rotates so the player's
 *                            FORWARD always reads at the top edge).
 *   • Compass needle        — fixed pointing up, indicating "where the
 *                            player is facing" (matches the FPV camera).
 *   • Moon-phase dial       — small inset bottom-right: synodic phase
 *                            from `lunarPhase.lunarPhaseSynodicIndex`,
 *                            rendered as a crescent / full / waning
 *                            disc against a deep-blue background.
 *
 * Cheap to draw — the overlay canvas is 220×220 (matches the PIP) and
 * we only re-paint when `_dirty` is set (yaw change ≥ 0.5° or phase
 * bucket change). Anu wants the second pass strided too.
 */

import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";
import { lunarPhaseSynodicIndex } from "../v2/lunarPhase.js";

const SIZE_PX = 220;
const REPAINT_STRIDE = 4;        // re-draw at most every 4 frames

const STYLE = `
  #v4-pip-overlay {
    position: fixed;
    top: 18px; left: 18px;
    width: ${SIZE_PX}px;
    height: ${SIZE_PX}px;
    z-index: 9060;
    pointer-events: none;
    user-select: none;
    border-radius: 50%;
    overflow: hidden;
  }
  #v4-pip-overlay canvas {
    width: 100%; height: 100%;
    display: block;
  }
`;

function ensureStyle() {
  if (document.getElementById("v4-pip-overlay-style")) return;
  const s = document.createElement("style");
  s.id = "v4-pip-overlay-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

const MOON_EMOJI = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];
const PHASE_LABELS = ["NEW", "WAX  CR", "FIRST", "WAX  GIB", "FULL", "WAN  GIB", "LAST", "WAN  CR"];

function drawOverlay(ctx, yaw, phaseIdx) {
  const W = SIZE_PX;
  const C = W / 2;
  ctx.clearRect(0, 0, W, W);

  // ── Outer bezel ring (gold) ────────────────────────────────────────
  ctx.save();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(251, 192, 45, 0.85)";
  ctx.beginPath();
  ctx.arc(C, C, C - 4, 0, Math.PI * 2);
  ctx.stroke();
  // Inner bezel ring (gold-faint), gives the chunky compass-edge read.
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(251, 192, 45, 0.35)";
  ctx.beginPath();
  ctx.arc(C, C, C - 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // ── Tick marks every 15° around the outer rim ─────────────────────
  ctx.save();
  ctx.translate(C, C);
  for (let i = 0; i < 24; i++) {
    const a = i * (Math.PI * 2 / 24);
    const major = i % 6 === 0;
    ctx.strokeStyle = major ? "rgba(255,247,208,0.9)" : "rgba(255,247,208,0.35)";
    ctx.lineWidth = major ? 2.5 : 1;
    ctx.beginPath();
    const r0 = C - 6;
    const r1 = C - (major ? 18 : 12);
    ctx.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0);
    ctx.lineTo(Math.sin(a) * r1, -Math.cos(a) * r1);
    ctx.stroke();
  }
  ctx.restore();

  // ── Cardinal labels (rotating with player yaw) ────────────────────
  // World convention: yaw = π means facing +Z. We want the player's
  // forward to read at the TOP of the rose. Math: each cardinal's
  // angular offset from north depends on world axis convention; we
  // rotate the WHOLE rose by `-yaw` so the player-forward direction
  // lands at the top.
  ctx.save();
  ctx.translate(C, C);
  ctx.rotate(-yaw + Math.PI); // align +Z (world "north" in this scene) with top
  ctx.font = "bold 16px ui-monospace, Menlo, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labelR = C - 30;
  const cards = [
    { l: "N", a: 0,           color: "#ffd97a" },
    { l: "E", a: Math.PI * 0.5, color: "#ffe9a8" },
    { l: "S", a: Math.PI,       color: "#ffe9a8" },
    { l: "W", a: Math.PI * 1.5, color: "#ffe9a8" },
  ];
  for (const c of cards) {
    const x = Math.sin(c.a) * labelR;
    const y = -Math.cos(c.a) * labelR;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(yaw - Math.PI); // un-rotate label so it reads upright
    // Soft text shadow.
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.fillText(c.l, 1, 2);
    ctx.fillStyle = c.color;
    ctx.fillText(c.l, 0, 0);
    ctx.restore();
  }
  ctx.restore();

  // ── Compass needle (always pointing UP — toward player-forward) ───
  ctx.save();
  ctx.translate(C, C);
  // Forward half — bright gold triangle.
  ctx.fillStyle = "#fbc02d";
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.moveTo(0, -38);
  ctx.lineTo(7, -4);
  ctx.lineTo(-7, -4);
  ctx.closePath();
  ctx.fill();
  // Back half — muted brown triangle.
  ctx.fillStyle = "#6e482a";
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.moveTo(0, 38);
  ctx.lineTo(7, 4);
  ctx.lineTo(-7, 4);
  ctx.closePath();
  ctx.fill();
  // Centre pin.
  ctx.fillStyle = "#1a1108";
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(251,192,45,0.85)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // ── Moon-phase dial (bottom-right inset) ──────────────────────────
  const dialR = 22;
  const dialCx = W - 32;
  const dialCy = W - 32;
  ctx.save();
  // Dial backplate.
  ctx.fillStyle = "rgba(8, 14, 28, 0.92)";
  ctx.beginPath();
  ctx.arc(dialCx, dialCy, dialR + 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(180, 200, 240, 0.55)";
  ctx.lineWidth = 1.6;
  ctx.stroke();
  // Moon disc + crescent — phase 0=new, 4=full, others crescent shapes.
  const t = phaseIdx / 8; // 0..1
  ctx.save();
  ctx.beginPath();
  ctx.arc(dialCx, dialCy, dialR, 0, Math.PI * 2);
  ctx.clip();
  // Full disc as moonglow base.
  ctx.fillStyle = phaseIdx === 0 ? "#1c2440" : "#f0eccf";
  ctx.fillRect(dialCx - dialR - 1, dialCy - dialR - 1, (dialR + 1) * 2, (dialR + 1) * 2);
  // Shadow ellipse offset to carve the crescent based on phase.
  if (phaseIdx !== 4 && phaseIdx !== 0) {
    // For waxing phases 1-3: shadow on LEFT, shrinking as we approach full.
    // For waning phases 5-7: shadow on RIGHT, growing.
    const waxing = phaseIdx <= 3;
    const fraction = waxing ? phaseIdx / 4 : (8 - phaseIdx) / 4;
    const shadowOffset = dialR * (1 - fraction) * 0.9;
    const xOff = waxing ? -shadowOffset : shadowOffset;
    ctx.fillStyle = "#1c2440";
    ctx.beginPath();
    ctx.ellipse(dialCx + xOff, dialCy, dialR * 1.0, dialR * 1.0, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (phaseIdx === 0) {
    // New moon — just a faint outline.
    ctx.strokeStyle = "rgba(220, 230, 250, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(dialCx, dialCy, dialR * 0.95, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  // Tiny phase label below the dial.
  ctx.font = "bold 7.5px ui-monospace, Menlo, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(180,200,240,0.75)";
  ctx.fillText(PHASE_LABELS[phaseIdx], dialCx, dialCy + dialR + 13);
  ctx.restore();
}

export const SanctuaryPipOverlayModule = {
  name: "SanctuaryPipOverlay",

  _wrap: null,
  _canvas: null,
  _ctx: null,
  _frame: 0,
  _lastYaw: -999,
  _lastPhase: -1,

  async load() {
    ensureStyle();
    const wrap = document.createElement("div");
    wrap.id = "v4-pip-overlay";
    wrap.userData = { anuSimulationDomain: ANU_SIMULATION_DOMAIN.PLAYER };
    const canvas = document.createElement("canvas");
    canvas.width = SIZE_PX;
    canvas.height = SIZE_PX;
    wrap.appendChild(canvas);
    document.body.appendChild(wrap);
    this._wrap = wrap;
    this._canvas = canvas;
    this._ctx = canvas.getContext("2d");
    // Paint once at boot so the overlay isn't blank.
    drawOverlay(this._ctx, Math.PI, 0);
    console.log(
      "%c[Sanctuary] 🧭 PIP overlay — compass + moon-phase dial online.",
      "color:#fbc02d;font-weight:bold;",
    );
  },

  update() {
    if (!this._ctx) return;
    this._frame++;
    if (this._frame % REPAINT_STRIDE !== 0) return;

    const yaw = typeof window !== "undefined" && Number.isFinite(window.__sanctuaryPlayerYaw)
      ? window.__sanctuaryPlayerYaw
      : Math.PI;
    const phase = lunarPhaseSynodicIndex(new Date(), null);

    // Re-paint only when something visibly changed.
    if (Math.abs(yaw - this._lastYaw) < 0.0087 && phase === this._lastPhase) return;
    this._lastYaw = yaw;
    this._lastPhase = phase;
    drawOverlay(this._ctx, yaw, phase);
  },

  unload() {
    if (this._wrap?.parentNode) this._wrap.parentNode.removeChild(this._wrap);
    const s = document.getElementById("v4-pip-overlay-style");
    if (s?.parentNode) s.parentNode.removeChild(s);
    this._wrap = null;
    this._canvas = null;
    this._ctx = null;
  },
};
