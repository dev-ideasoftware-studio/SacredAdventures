/**
 * Sacred Adventures — sanctuary part 24 of N: DAY ↔ NIGHT TOGGLE.
 *
 * Anu domain: ENVIRONMENT (sky/light is part of the ground-and-
 * atmosphere kids' bodies must obey). Swaps the sanctuary between
 * two lighting presets when the player clicks the new 🌙 button on
 * the bottom controls bar:
 *
 *   DAY        — sky pale blue + warm horizon · key light golden 1.05 ·
 *                hemisphere 0.65 · fog soft daylight · clear bg
 *   NIGHT      — sky deep indigo + dusk horizon · key light cool 0.42 ·
 *                hemisphere 0.22 with cool ground · fog twilight · low bg
 *
 * Transitions over ~1.4 s so the change reads as a slow breath, not a
 * snap. While in the wash a kid can still walk, fish, mold, journal —
 * the toggle doesn't suspend anything.
 *
 * Dispatches `ANU_EVENTS.SEASON_CHANGE` on each toggle so the
 * InteractionBus carries the lighting state across to whatever else
 * wants to react (future tipi torches, NPC behaviour, etc.).
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";
import { dispatchInteraction } from "../v2/anu/InteractionBus.js";
import { ANU_EVENTS } from "../v2/anu/anuEvents.js";

const TRANSITION_S = 1.4;

const DAY = {
  skyTop: new THREE.Color(0xc9def0),
  skyHorizon: new THREE.Color(0xf5d8a0),
  bg: new THREE.Color(0xc9def0),
  fog: new THREE.Color(0xcfd9c6),
  keyColor: new THREE.Color(0xfff3c4),
  keyIntensity: 1.05,
  hemiSky: new THREE.Color(0xfff2d6),
  hemiGround: new THREE.Color(0x445533),
  hemiIntensity: 0.65,
  exposure: 1.05,
};
const NIGHT = {
  skyTop: new THREE.Color(0x101830),
  skyHorizon: new THREE.Color(0x3a3050),
  bg: new THREE.Color(0x101830),
  fog: new THREE.Color(0x1e2236),
  keyColor: new THREE.Color(0x8aa9ff),
  keyIntensity: 0.42,
  hemiSky: new THREE.Color(0x4a5070),
  hemiGround: new THREE.Color(0x0e1424),
  hemiIntensity: 0.22,
  exposure: 0.85,
};

const STYLE = `
  /* Drop a 🌙 / ☀ button into the existing #v4-controls bar via JS DOM
     append, so its style inherits the same wood-deck look. */
`;

export const SanctuaryDayNightModule = {
  name: "SanctuaryDayNight",

  _scene: null,
  _renderer: null,
  _key: null,
  _hemi: null,
  _skyMat: null,
  _btn: null,
  _isNight: false,
  _elapsed: 0,
  _transStart: 0,
  _transFrom: DAY,
  _transTo: DAY,
  _transActive: false,

  async load(scene, _camera, renderer) {
    this._scene = scene;
    this._renderer = renderer;

    // Locate the existing key + hemi lights placed by SanctuaryGround.
    scene.traverse((o) => {
      if (o.userData?.anuKind === "sanctuary_light_key") this._key = o;
      if (o.userData?.anuKind === "sanctuary_light_hemi") this._hemi = o;
      if (o.name === "sanctuary_sky") this._skyMat = o.material;
    });

    // Append a 🌙 toggle tile to the #v4-controls top row. The Controls
    // module owns the layout; we just add one element to its TOP row.
    const controls = document.getElementById("v4-controls");
    if (controls) {
      const topRow = controls.querySelector(".row");
      if (topRow) {
        const btn = document.createElement("button");
        btn.id = "v4-btn-day-night";
        btn.className = "btn-top";
        btn.type = "button";
        btn.textContent = "🌙 NIGHT";
        btn.addEventListener("click", () => this._toggle());
        topRow.appendChild(btn);
        this._btn = btn;
      }
    }

    // Apply DAY immediately (boot state — nothing to ease into).
    this._applyPreset(DAY, 1);

    console.log(
      "%c[Sanctuary] ☀ / 🌙 day-night toggle online — click the moon on the controls bar.",
      "color:#a8b5d6;font-weight:bold;",
    );
  },

  _toggle() {
    this._isNight = !this._isNight;
    this._transFrom = this._isNight ? DAY : NIGHT;
    this._transTo = this._isNight ? NIGHT : DAY;
    this._transStart = this._elapsed;
    this._transActive = true;
    if (this._btn) this._btn.textContent = this._isNight ? "☀ DAY" : "🌙 NIGHT";
    try {
      dispatchInteraction(ANU_EVENTS.SEASON_CHANGE, {
        season: this._isNight ? "night" : "day",
        source: "sanctuary_day_night",
        t: this._elapsed,
      });
    } catch (_) {}
  },

  /** Apply a lighting preset with optional `t` (0..1) lerp from current. */
  _applyPreset(target, t) {
    const tt = Math.max(0, Math.min(1, t));
    if (this._skyMat?.uniforms?.uTopColor) {
      this._skyMat.uniforms.uTopColor.value.lerp(target.skyTop, tt);
      this._skyMat.uniforms.uHorizonColor.value.lerp(target.skyHorizon, tt);
    }
    if (this._scene.fog?.color) {
      this._scene.fog.color.lerp(target.fog, tt);
    }
    if (this._scene.background?.lerp) {
      this._scene.background.lerp(target.bg, tt);
    } else if (this._scene.background?.isColor) {
      this._scene.background.lerp(target.bg, tt);
    }
    if (this._key) {
      this._key.color.lerp(target.keyColor, tt);
      this._key.intensity += (target.keyIntensity - this._key.intensity) * tt;
    }
    if (this._hemi) {
      this._hemi.color.lerp(target.hemiSky, tt);
      this._hemi.groundColor.lerp(target.hemiGround, tt);
      this._hemi.intensity += (target.hemiIntensity - this._hemi.intensity) * tt;
    }
    if (this._renderer) {
      this._renderer.toneMappingExposure += (target.exposure - this._renderer.toneMappingExposure) * tt;
    }
  },

  update(delta) {
    this._elapsed += delta;
    if (!this._transActive) return;
    const t = Math.min(1, (this._elapsed - this._transStart) / TRANSITION_S);
    // Frame-rate-independent lerp toward target. Use a small per-frame
    // ratio (delta / remaining) so the eased curve always converges
    // within TRANSITION_S regardless of FPS.
    const remaining = Math.max(0.001, TRANSITION_S - (this._elapsed - this._transStart));
    const stepK = Math.min(1, delta / remaining);
    this._applyPreset(this._transTo, stepK);
    if (t >= 1) this._transActive = false;
  },

  unload() {
    if (this._btn?.parentNode) this._btn.parentNode.removeChild(this._btn);
    this._btn = null;
    this._scene = null;
    this._renderer = null;
    this._key = null;
    this._hemi = null;
    this._skyMat = null;
  },
};
