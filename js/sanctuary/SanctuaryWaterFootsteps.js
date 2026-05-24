/**
 * Sacred Adventures — sanctuary: FOOTSTEP SOUNDS.
 *
 * Two looping sounds driven by avatar position + speed:
 *
 *   • avatar-walking.mp3  — plays when moving on land.
 *   • water-walking.mp3   — plays (instead) when moving inside the pond.
 *
 * Both use plain <audio> elements — no AudioContext dependency. Volume is
 * lerped each frame for smooth fade in/out.
 *
 * Anu domain: PLAYER.
 */

import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";
import {
  SANCTUARY_POOL_CENTER_X,
  SANCTUARY_POOL_CENTER_Z,
  SANCTUARY_POOL_RADIUS_M,
} from "./SanctuaryGround.js";

const WALK_SOUND_URL  = "./Assets/sounds/avatar-walking.mp3";
const WATER_SOUND_URL = "./Assets/sounds/water-walking.mp3";

const WATER_TRIGGER_R  = SANCTUARY_POOL_RADIUS_M * 0.85;
const MOVE_THRESHOLD   = 0.08;   // m/s below this = idle
const VOL_WALK         = 0.65;
const VOL_WATER        = 0.72;
const FADE_IN_RATE     = 3.5;    // volume units/s
const FADE_OUT_RATE    = 7.0;

function _makeAudio(url) {
  const a = new Audio(url);
  a.loop   = true;
  a.volume = 0;
  return a;
}

export const SanctuaryWaterFootstepsModule = {
  name: "SanctuaryWaterFootsteps",

  _walk:    null,
  _water:   null,
  _prevPos: null,
  _speed:   0,

  async load() {
    this._walk  = _makeAudio(WALK_SOUND_URL);
    this._water = _makeAudio(WATER_SOUND_URL);
    this._prevPos = null;
    this._speed   = 0;
    console.log(
      "%c[Sanctuary] 👣 Footsteps ready (land + water).",
      "color:#64b5f6;font-weight:bold;",
    );
  },

  update(delta) {
    if (!this._walk || !this._water) return;

    const av = typeof window !== "undefined" ? window.__sanctuaryAvatar : null;
    let inPond   = false;
    let isMoving = false;

    if (av?.position) {
      const dx = av.position.x - SANCTUARY_POOL_CENTER_X;
      const dz = av.position.z - SANCTUARY_POOL_CENTER_Z;
      inPond = Math.hypot(dx, dz) < WATER_TRIGGER_R;

      if (!this._prevPos) this._prevPos = { x: av.position.x, z: av.position.z };
      const moved = Math.hypot(av.position.x - this._prevPos.x, av.position.z - this._prevPos.z);
      this._prevPos.x = av.position.x;
      this._prevPos.z = av.position.z;
      const rawSpeed = delta > 0 ? moved / delta : 0;
      this._speed = this._speed * 0.85 + rawSpeed * 0.15;
      isMoving = this._speed > MOVE_THRESHOLD;
    }

    const wantWater = inPond  && isMoving;
    const wantWalk  = !inPond && isMoving;

    this._fade(this._water, wantWater ? VOL_WATER : 0, delta);
    this._fade(this._walk,  wantWalk  ? VOL_WALK  : 0, delta);
  },

  _fade(audio, target, delta) {
    if (target > 0 && audio.paused) {
      const now = Date.now();
      if (!audio._lastPlayAttempt || now - audio._lastPlayAttempt > 2000) {
        audio._lastPlayAttempt = now;
        audio.play().catch(() => {});
      }
    }
    const rate   = target > audio.volume ? FADE_IN_RATE : FADE_OUT_RATE;
    const newVol = audio.volume + (target - audio.volume) * Math.min(1, delta * rate);
    audio.volume = Math.max(0, Math.min(1, newVol));
    if (target === 0 && !audio.paused && audio.volume < 0.005) {
      audio.pause();
      audio.volume = 0;
    }
  },

  unload() {
    for (const a of [this._walk, this._water]) {
      if (!a) continue;
      a.pause();
      a.src = "";
    }
    this._walk  = null;
    this._water = null;
    this._prevPos = null;
    this._speed = 0;
  },
};
