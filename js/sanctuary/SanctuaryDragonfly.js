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
import { STRESS_LEVELS, getSystemStressLevel } from "../v2/anu/FrameBudget.js";
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

let _lastDragonflyFrameCount = 0;

export const SanctuaryDragonflyModule = {
  name: "SanctuaryDragonfly",

  _scene: null,
  _texture: null,
  _dragonflies: [],

  async load(scene) {
    if (typeof document === "undefined") return;
    this._scene = scene;
    this._texture = _makeDragonflyTexture();
    this._dragonflies = [];

    window.__sanctuaryDragonflies = this._dragonflies;

    const count = 3;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this._texture,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        sizeAttenuation: true,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(0.45, 0.45, 1);
      sprite.position.set(0, -100, 0);
      sprite.renderOrder = 6;
      sprite.name = `sanctuary_dragonfly_${i}`;
      sprite.userData.anuKind = "sanctuary_dragonfly";
      sprite.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FAUNA;
      scene.add(sprite);

      this._dragonflies.push({
        sprite,
        stateT: 0,
        flightDur: 3,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        arcHeight: 0.5,
        alive: true,
        respawnTimer: Math.random() * 2 // stagger initial spawns
      });
    }

    console.log(
      "%c[Sanctuary] 🪰 3 Dragonflies online — buzzing the frogs.",
      "color:#22afa2;font-weight:bold;",
    );
  },

  _pickNewFlight(df) {
    // Pick start + end on opposite sides of the pond.
    // They fly low over the lilies to tempt frogs.
    const startPos = df.sprite.position.clone();
    
    // If it was dead, start at edge
    if (startPos.y < 0) {
      const angA = Math.random() * Math.PI * 2;
      const startR = SANCTUARY_POOL_RADIUS_M * 1.05;
      startPos.set(
        SANCTUARY_POOL_CENTER_X + Math.cos(angA) * startR,
        FLIGHT_Y_MIN_M,
        SANCTUARY_POOL_CENTER_Z + Math.sin(angA) * startR,
      );
    }

    const angB = Math.random() * Math.PI * 2;
    const endR = SANCTUARY_POOL_RADIUS_M * (0.2 + Math.random() * 0.8);
    const endY = FLIGHT_Y_MIN_M + Math.random() * 0.6; // low flight

    df.from.copy(startPos);
    df.to.set(
      SANCTUARY_POOL_CENTER_X + Math.cos(angB) * endR,
      endY,
      SANCTUARY_POOL_CENTER_Z + Math.sin(angB) * endR,
    );
    df.arcHeight = 0.1 + Math.random() * 0.4;
    df.flightDur = ZIP_DURATION_MIN_S + Math.random() * 1.5;
    df.stateT = 0;
  },

  update(delta, frameCount) {
    if (!this._dragonflies.length) return;

    // LAYER 1: The Strict Performance Invariant Gate
    const stress = getSystemStressLevel();
    if (stress === STRESS_LEVELS.CRITICAL) {
      return; // Early Exit: Budget Skip Conditions Compose the Median Frame
    }

    // LAYER 2: Stride/Cadence Throttle
    const stride = stress === STRESS_LEVELS.STRESS ? 2 : 1;
    const ticks = frameCount !== undefined ? frameCount : ++_lastDragonflyFrameCount;
    if (ticks % stride !== 0) {
      return; // Zero-cost pass-through
    }

    const scaledDelta = delta * stride;

    for (let df of this._dragonflies) {
      if (!df.alive) {
        df.sprite.position.set(0, -100, 0);
        df.respawnTimer -= scaledDelta;
        if (df.respawnTimer <= 0) {
          df.alive = true;
          this._pickNewFlight(df);
        }
        continue;
      }

      df.stateT += scaledDelta;
      
      const t = Math.min(1, df.stateT / df.flightDur);
      df.sprite.position.lerpVectors(df.from, df.to, t);
      const arc = -4 * (t - 0.5) * (t - 0.5) + 1;
      df.sprite.position.y += df.arcHeight * arc;

      const wob = 0.45 + Math.sin(df.stateT * 40) * 0.015;
      df.sprite.scale.set(wob, wob, 1);

      // Instant re-flight, no idle gap
      if (t >= 1) {
        this._pickNewFlight(df);
      }
    }
  },

  unload(scene) {
    for (let df of this._dragonflies) {
      if (df.sprite) {
        scene.remove(df.sprite);
        df.sprite.material?.dispose?.();
      }
    }
    this._texture?.dispose?.();
    this._dragonflies = [];
    this._texture = null;
    this._scene = null;
    delete window.__sanctuaryDragonflies;
  },
};
