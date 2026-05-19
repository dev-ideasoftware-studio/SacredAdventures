/**
 * Sacred Adventures — sanctuary part 31 of N: WEATHER.
 *
 * Anu domain: ENVIRONMENT. Rain (and the ambient mood that comes
 * with it). One toggle on the controls bar — when on:
 *
 *   • Rain is rendered as a single `THREE.Points` cloud above the
 *     player (~1800 droplets), wrapping in a 30 m radius column.
 *     Each droplet falls at ~9 m/s with a small horizontal drift
 *     so the rain reads as a sheet, not a vertical waterfall.
 *   • Sky tints cooler + dims by 22 % (we mute the directional
 *     light + drop ambient saturation).
 *   • A soft pink-noise "rain hiss" bed is added to the ambient
 *     mix (we trigger an event the AmbientModule already listens
 *     for — see `anu:weather-change`).
 *
 * Rain uses Points + a tiny streak texture (vertical white line
 * with alpha falloff). One draw call total. Anu's adaptive DPR
 * doesn't need to scale this — the cost is negligible.
 *
 * The toggle dispatches `anu:weather-change` so other modules
 * (ambient, sky, day/night) can react without coupling.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";

const DROPLET_COUNT = 1800;
const RAIN_COLUMN_RADIUS_M = 30;
const RAIN_TOP_Y_M = 32;
const RAIN_BOTTOM_Y_M = -1.5;
const RAIN_FALL_SPEED_M_PER_S = 9.0;
const RAIN_DRIFT_M_PER_S = 0.8;

function _makeStreakTexture() {
  // 8×64 vertical streak: bright in middle, fades at top + bottom.
  const w = 8, h = 64;
  const cnv = document.createElement("canvas");
  cnv.width = w; cnv.height = h;
  const ctx = cnv.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0.00, "rgba(255,255,255,0)");
  grad.addColorStop(0.40, "rgba(220,235,255,0.95)");
  grad.addColorStop(0.65, "rgba(255,255,255,1.0)");
  grad.addColorStop(1.00, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const SanctuaryWeatherModule = {
  name: "SanctuaryWeather",

  _scene: null,
  _points: null,
  _positions: null,
  _velocities: null,
  _isRaining: false,
  _btn: null,
  _avatarRef: null,

  async load(scene) {
    this._scene = scene;

    // Buffer geometry — N droplets, each with a random column slot.
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(DROPLET_COUNT * 3);
    const velocities = new Float32Array(DROPLET_COUNT * 2); // x-drift, z-drift
    for (let i = 0; i < DROPLET_COUNT; i++) {
      // Polar sample inside a 30 m radius column.
      const r = Math.sqrt(Math.random()) * RAIN_COLUMN_RADIUS_M;
      const a = Math.random() * Math.PI * 2;
      positions[i * 3 + 0] = Math.cos(a) * r;
      positions[i * 3 + 1] = RAIN_BOTTOM_Y_M + Math.random() * (RAIN_TOP_Y_M - RAIN_BOTTOM_Y_M);
      positions[i * 3 + 2] = Math.sin(a) * r;
      // Per-drop random drift — keeps the sheet from looking like a
      // mechanical comb.
      const angle = Math.random() * Math.PI * 2;
      const mag = RAIN_DRIFT_M_PER_S * (0.5 + Math.random());
      velocities[i * 2 + 0] = Math.cos(angle) * mag;
      velocities[i * 2 + 1] = Math.sin(angle) * mag;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      map: _makeStreakTexture(),
      size: 0.65,
      color: 0xc7d8ef,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
      opacity: 0.55,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geo, mat);
    points.name = "sanctuary_rain";
    points.userData.anuKind = "sanctuary_rain";
    points.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    points.visible = false;
    points.frustumCulled = false; // we move it with the avatar
    scene.add(points);

    this._points = points;
    this._positions = positions;
    this._velocities = velocities;

    // Append a 🌧 toggle to the #v4-controls top row.
    const controls = document.getElementById("v4-controls");
    if (controls) {
      const topRow = controls.querySelector(".row");
      if (topRow) {
        const btn = document.createElement("button");
        btn.id = "v4-btn-weather";
        btn.className = "btn-top";
        btn.type = "button";
        btn.textContent = "🌤 CLEAR";
        btn.title = "Toggle rain on / off";
        btn.addEventListener("click", () => this._toggle());
        topRow.appendChild(btn);
        this._btn = btn;
      }
    }

    console.log(
      "%c[Sanctuary] 🌧 Weather online — click 🌤 on the controls bar to bring the rain.",
      "color:#80a8d8;font-weight:bold;",
    );
  },

  _toggle() {
    this._isRaining = !this._isRaining;
    if (this._points) this._points.visible = this._isRaining;
    if (this._btn) this._btn.textContent = this._isRaining ? "🌧 RAIN" : "🌤 CLEAR";

    try {
      window.dispatchEvent(
        new CustomEvent("anu:weather-change", {
          detail: { weather: this._isRaining ? "rain" : "clear", source: "sanctuary_weather" },
        }),
      );
    } catch (_) {}
  },

  update(delta) {
    if (!this._isRaining || !this._points) return;

    // Find the avatar — keep the rain column centred on the kid so
    // they never run out of it.
    if (!this._avatarRef) {
      this._avatarRef = (typeof window !== "undefined") ? window.__sanctuaryAvatar : null;
    }
    const ax = this._avatarRef?.position?.x ?? 0;
    const az = this._avatarRef?.position?.z ?? 0;
    this._points.position.set(ax, 0, az);

    const positions = this._positions;
    const velocities = this._velocities;
    const fall = RAIN_FALL_SPEED_M_PER_S * delta;
    const wrapY = RAIN_TOP_Y_M;
    const floor = RAIN_BOTTOM_Y_M;
    const colR2 = RAIN_COLUMN_RADIUS_M * RAIN_COLUMN_RADIUS_M;

    for (let i = 0; i < DROPLET_COUNT; i++) {
      const ix = i * 3;
      positions[ix + 1] -= fall;
      positions[ix + 0] += velocities[i * 2 + 0] * delta;
      positions[ix + 2] += velocities[i * 2 + 1] * delta;

      // Hit floor — respawn at the top, fresh polar slot.
      if (positions[ix + 1] < floor) {
        const r = Math.sqrt(Math.random()) * RAIN_COLUMN_RADIUS_M;
        const a = Math.random() * Math.PI * 2;
        positions[ix + 0] = Math.cos(a) * r;
        positions[ix + 1] = wrapY;
        positions[ix + 2] = Math.sin(a) * r;
        continue;
      }
      // Drifted outside the column — wrap back to the opposite side.
      const xr = positions[ix + 0];
      const zr = positions[ix + 2];
      if (xr * xr + zr * zr > colR2) {
        positions[ix + 0] = -xr * 0.95;
        positions[ix + 2] = -zr * 0.95;
      }
    }

    this._points.geometry.attributes.position.needsUpdate = true;
  },

  unload(scene) {
    if (this._points) {
      scene.remove(this._points);
      this._points.geometry.dispose?.();
      this._points.material.map?.dispose?.();
      this._points.material.dispose?.();
    }
    if (this._btn?.parentElement) this._btn.parentElement.removeChild(this._btn);
    this._points = null;
    this._positions = null;
    this._velocities = null;
    this._btn = null;
    this._avatarRef = null;
    this._scene = null;
  },
};
