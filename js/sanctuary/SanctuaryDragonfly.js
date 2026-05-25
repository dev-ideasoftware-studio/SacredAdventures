/**
 * Sacred Adventures — sanctuary: Dragonfly.
 *
 * One small photo-real dragonfly that zips across the pond at random
 * intervals. Per user spec (May-25 2026):
 *   "small dragon fly zips by in photo realistic style"
 *
 * Implementation:
 *   • Single THREE.Sprite using a procedural CanvasTexture so we don't
 *     fetch any asset. Body + wings + jewel-tone iridescence drawn
 *     once into a 256×256 canvas; sprite always faces the camera.
 *   • Flight path = a Bezier-ish arc across the pond at random start /
 *     end points, height 0.6-1.6 m above water. Each "zip" lasts 2-4 s.
 *   • Idle gap between zips: 12-30 s (this is ambient flavor, not a
 *     constant distraction).
 *   • Sprite scale wobbles gently in flight to suggest wingbeat parallax.
 *
 * Cost: 1 sprite, 1 texture, 0 lights. ~2 tris per frame. Negligible.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";
import {
  SANCTUARY_POOL_CENTER_X,
  SANCTUARY_POOL_CENTER_Z,
  SANCTUARY_POOL_RADIUS_M,
} from "./SanctuaryGround.js";

const ZIP_DURATION_MIN_S = 2.2;
const ZIP_DURATION_MAX_S = 4.0;
const IDLE_GAP_MIN_S     = 12;
const IDLE_GAP_MAX_S     = 30;
const FLIGHT_Y_MIN_M     = 0.6;
const FLIGHT_Y_MAX_M     = 1.6;

/** Procedural dragonfly texture — 256×256 canvas with body + 4 wings. */
function _makeDragonflyTexture() {
  const SZ = 256;
  const cv = document.createElement("canvas");
  cv.width = SZ; cv.height = SZ;
  const ctx = cv.getContext("2d");

  const cx = SZ / 2;
  const cy = SZ / 2;

  // ── Wings (4 — front + rear pair) ────────────────────────────────
  // Photoreal dragonfly wings = translucent membranes with venation.
  // Draw with low alpha + crisp dark vein lines.
  ctx.save();
  ctx.translate(cx, cy);

  const drawWing = (x, y, w, h, rot, alpha) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    // Membrane fill — slight teal tint
    const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, Math.max(w, h));
    grad.addColorStop(0,   `rgba(220, 240, 255, ${alpha + 0.10})`);
    grad.addColorStop(0.6, `rgba(180, 220, 230, ${alpha})`);
    grad.addColorStop(1,   `rgba(140, 200, 220, ${alpha * 0.4})`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
    ctx.fill();
    // Vein lines (4 longitudinal + 6 cross)
    ctx.strokeStyle = `rgba(50, 70, 80, ${alpha + 0.20})`;
    ctx.lineWidth = 0.7;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(-w + 4, i * (h / 3));
      ctx.quadraticCurveTo(0, i * (h / 3) * 0.4, w - 4, i * (h / 3));
      ctx.stroke();
    }
    // Subtle iridescence highlight
    ctx.fillStyle = `rgba(200, 255, 240, ${alpha * 0.35})`;
    ctx.beginPath();
    ctx.ellipse(-w * 0.3, -h * 0.2, w * 0.35, h * 0.25, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  // Rear wings (slightly larger, more swept-back, drawn first so front wings sit on top)
  drawWing(-32,  6, 50, 18, -0.25, 0.55);  // rear-left
  drawWing( 32,  6, 50, 18,  0.25, 0.55);  // rear-right
  // Front wings
  drawWing(-30, -8, 56, 17, -0.10, 0.60);  // front-left
  drawWing( 30, -8, 56, 17,  0.10, 0.60);  // front-right

  // ── Thorax + head ────────────────────────────────────────────────
  const thoraxGrad = ctx.createLinearGradient(-12, 0, 12, 0);
  thoraxGrad.addColorStop(0,   "#1a3a4c");
  thoraxGrad.addColorStop(0.5, "#3a7088");
  thoraxGrad.addColorStop(1,   "#1a3a4c");
  ctx.fillStyle = thoraxGrad;
  ctx.beginPath();
  ctx.ellipse(0, 0, 14, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Abdomen (the long jewel-tone tail) ─────────────────────────
  // Segmented gradient — emerald → cyan → sapphire (iridescent koi-pond palette).
  const abdoGrad = ctx.createLinearGradient(0, 10, 0, 90);
  abdoGrad.addColorStop(0.0, "#2a8f7c");   // emerald close to thorax
  abdoGrad.addColorStop(0.4, "#22afa2");   // teal
  abdoGrad.addColorStop(0.7, "#1f6e94");   // ocean blue
  abdoGrad.addColorStop(1.0, "#162e4c");   // sapphire tip
  ctx.fillStyle = abdoGrad;
  ctx.beginPath();
  // Slight taper from thorax to tail
  ctx.moveTo(-4, 10);
  ctx.quadraticCurveTo(-2, 60, 0, 92);
  ctx.quadraticCurveTo( 2, 60,  4, 10);
  ctx.closePath();
  ctx.fill();

  // Segment ticks (8 fine lines across the abdomen)
  ctx.strokeStyle = "rgba(8, 18, 28, 0.55)";
  ctx.lineWidth = 0.7;
  for (let i = 1; i <= 8; i++) {
    const ty = 14 + i * 9;
    ctx.beginPath();
    ctx.moveTo(-3, ty);
    ctx.lineTo( 3, ty);
    ctx.stroke();
  }

  // ── Head + compound eyes ───────────────────────────────────────
  ctx.fillStyle = "#0d2330";
  ctx.beginPath();
  ctx.ellipse(0, -12, 10, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  // Eyes — two big metallic dome highlights
  ctx.fillStyle = "#4cc8d8";
  ctx.beginPath();
  ctx.ellipse(-5, -13, 4, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse( 5, -13, 4, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  // Eye catchlights
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.beginPath();
  ctx.ellipse(-6, -14, 1.2, 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse( 4, -14, 1.2, 0.8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export const SanctuaryDragonflyModule = {
  name: "SanctuaryDragonfly",

  _root: null,
  _sprite: null,
  _texture: null,
  _scene: null,

  // Flight state
  _state: "idle",         // "idle" | "flying"
  _stateT: 0,
  _idleGap: 8,            // first dragonfly appears ~8 s after boot
  _flightDur: 3,
  _from: new THREE.Vector3(),
  _to: new THREE.Vector3(),
  _arcHeight: 0.5,

  async load(scene) {
    if (typeof document === "undefined") return;
    this._scene = scene;
    this._texture = _makeDragonflyTexture();
    const mat = new THREE.SpriteMaterial({
      map: this._texture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      sizeAttenuation: true,
    });
    this._sprite = new THREE.Sprite(mat);
    this._sprite.scale.set(0.45, 0.45, 1);  // ~45 cm at unit distance
    this._sprite.position.set(0, -100, 0);   // start parked below scene
    this._sprite.visible = false;
    this._sprite.renderOrder = 6;
    this._sprite.name = "sanctuary_dragonfly";
    this._sprite.userData.anuKind = "sanctuary_dragonfly";
    this._sprite.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FAUNA;
    scene.add(this._sprite);
    this._root = this._sprite;

    console.log(
      "%c[Sanctuary] 🪰 Dragonfly online — random zips every 12-30 s.",
      "color:#22afa2;font-weight:bold;",
    );
  },

  _pickNewFlight() {
    // Pick start + end on opposite sides of the pond.
    const angA = Math.random() * Math.PI * 2;
    const angB = angA + Math.PI + (Math.random() - 0.5) * 1.2;
    const startR = SANCTUARY_POOL_RADIUS_M * (1.05 + Math.random() * 0.25);
    const endR   = SANCTUARY_POOL_RADIUS_M * (1.05 + Math.random() * 0.25);
    const y      = FLIGHT_Y_MIN_M + Math.random() * (FLIGHT_Y_MAX_M - FLIGHT_Y_MIN_M);
    this._from.set(
      SANCTUARY_POOL_CENTER_X + Math.cos(angA) * startR,
      y,
      SANCTUARY_POOL_CENTER_Z + Math.sin(angA) * startR,
    );
    this._to.set(
      SANCTUARY_POOL_CENTER_X + Math.cos(angB) * endR,
      y + (Math.random() - 0.5) * 0.5,
      SANCTUARY_POOL_CENTER_Z + Math.sin(angB) * endR,
    );
    this._arcHeight = 0.25 + Math.random() * 0.6;
    this._flightDur = ZIP_DURATION_MIN_S + Math.random() * (ZIP_DURATION_MAX_S - ZIP_DURATION_MIN_S);
  },

  update(delta) {
    if (!this._sprite) return;
    this._stateT += delta;

    if (this._state === "idle") {
      if (this._stateT >= this._idleGap) {
        this._stateT = 0;
        this._state = "flying";
        this._pickNewFlight();
        this._sprite.visible = true;
      }
      return;
    }

    // Flying — interpolate from→to with parabolic Y arc
    const t = Math.min(1, this._stateT / this._flightDur);
    this._sprite.position.lerpVectors(this._from, this._to, t);
    // Parabolic arc on Y (peak at middle of flight)
    const arc = -4 * (t - 0.5) * (t - 0.5) + 1;
    this._sprite.position.y += this._arcHeight * arc;

    // Tiny scale wobble = wingbeat parallax (40 Hz)
    const wob = 0.45 + Math.sin(this._stateT * 40) * 0.015;
    this._sprite.scale.set(wob, wob, 1);

    if (t >= 1) {
      this._sprite.visible = false;
      this._sprite.position.set(0, -100, 0);
      this._state = "idle";
      this._stateT = 0;
      this._idleGap = IDLE_GAP_MIN_S + Math.random() * (IDLE_GAP_MAX_S - IDLE_GAP_MIN_S);
    }
  },

  unload(scene) {
    if (this._sprite) {
      scene.remove(this._sprite);
      this._sprite.material?.dispose?.();
      this._texture?.dispose?.();
      this._sprite = null;
      this._texture = null;
    }
    this._root = null;
    this._scene = null;
  },
};
