/**
 * Sacred Adventures — sanctuary part 27 of N: AMBIENT SOUND.
 *
 * Anu domain: ENVIRONMENT (the atmosphere bodies obey, audible side).
 *
 * Procedural ambient — entirely Web Audio, no .mp3 files. Three layers
 * crossfade in once the AudioContext unlocks (browsers gate WebAudio
 * behind user interaction; we wait for first click/keypress + then
 * resume the context):
 *
 *   1. WIND          — filtered pink noise modulated by a slow LFO.
 *                       The "valley breeze" undercurrent.
 *   2. WATER LAPPING — band-pass filtered white noise + low LFO,
 *                       pulses the lapping rhythm. Volume scales with
 *                       proximity to the pool (within 18 m = full).
 *   3. BIRDSONG      — small chirp packets fired every 4-9 s on
 *                       random pitches in a pentatonic-friendly band.
 *                       Reads as forest-edge birds.
 *
 * Volume cap: each layer peaks around -28 dB so the soundscape stays
 * background, not foreground. A small 🔊/🔇 button is added to the
 * controls bar so kids (or grumpy parents) can mute.
 */

import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";

let _ctx = null;
let _master = null;
let _wind = null;
let _water = null;
let _birdsGain = null;
let _muted = false;

function _buildNoiseBuffer(ctx, kind) {
  const SECONDS = 2.0;
  const buf = ctx.createBuffer(1, ctx.sampleRate * SECONDS, ctx.sampleRate);
  const data = buf.getChannelData(0);
  if (kind === "pink") {
    // Approximate pink noise via Paul Kellet's filter.
    let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      data[i] = pink * 0.11;
    }
  } else {
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.35;
  }
  return buf;
}

function _startWind(ctx, master) {
  const src = ctx.createBufferSource();
  src.buffer = _buildNoiseBuffer(ctx, "pink");
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 350;
  bp.Q.value = 0.6;
  const g = ctx.createGain();
  g.gain.value = 0; // fade in over 3 s
  // Slow LFO on filter frequency for "breeze" feel.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.08;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 160;
  lfo.connect(lfoGain).connect(bp.frequency);
  lfo.start();
  src.connect(bp).connect(g).connect(master);
  src.start();
  g.gain.linearRampToValueAtTime(0.045, ctx.currentTime + 3.0);
  return { src, g };
}

function _startWater(ctx, master) {
  const src = ctx.createBufferSource();
  src.buffer = _buildNoiseBuffer(ctx, "white");
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 900;
  bp.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.value = 0;
  // Slow LFO on gain — the lap rhythm.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.5;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.025;
  lfo.connect(lfoGain).connect(g.gain);
  lfo.start();
  src.connect(bp).connect(g).connect(master);
  src.start();
  // Static base — LFO adds the ripple. Don't ramp; LFO is around 0.
  return { src, g, baseGain: 0.030 };
}

function _scheduleBird(ctx, master, birdsGain) {
  if (_muted) return;
  // One chirp packet: a quick sine sweep up + glottal stop.
  const t = ctx.currentTime + 0.05;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  // Pentatonic-friendly random pitch in 1.1 .. 3.6 kHz.
  const PENTATONIC_HZ = [1175, 1320, 1568, 1760, 2093, 2349, 2637, 2960, 3322];
  const f = PENTATONIC_HZ[Math.floor(Math.random() * PENTATONIC_HZ.length)];
  osc.frequency.setValueAtTime(f * 0.93, t);
  osc.frequency.exponentialRampToValueAtTime(f * 1.08, t + 0.08);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.06, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  // Slight pan so different birds feel positioned.
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (pan) pan.pan.value = (Math.random() - 0.5) * 1.6;
  if (pan) osc.connect(g).connect(pan).connect(birdsGain);
  else osc.connect(g).connect(birdsGain);
  osc.start(t);
  osc.stop(t + 0.22);
  // Next chirp in 3-8 seconds.
  const nextS = 3 + Math.random() * 5;
  setTimeout(() => _scheduleBird(ctx, master, birdsGain), nextS * 1000);
}

function _unlockAndStart() {
  if (_ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  _ctx = new AC();
  _master = _ctx.createGain();
  _master.gain.value = _muted ? 0 : 1;
  _master.connect(_ctx.destination);

  _wind = _startWind(_ctx, _master);
  _water = _startWater(_ctx, _master);

  _birdsGain = _ctx.createGain();
  _birdsGain.gain.value = 0;
  _birdsGain.gain.linearRampToValueAtTime(0.6, _ctx.currentTime + 4.0);
  _birdsGain.connect(_master);
  _scheduleBird(_ctx, _master, _birdsGain);

  console.log(
    "%c[Sanctuary] 🎵 Ambient sound online — wind + water + birds (procedural Web Audio).",
    "color:#a8d6e0;font-weight:bold;",
  );
}

const STYLE = `
  #v4-btn-mute {
    /* inherits the same .btn-top look from SanctuaryControls */
  }
`;

export const SanctuaryAmbientModule = {
  name: "SanctuaryAmbient",

  _onFirstInteraction: null,
  _btn: null,

  async load() {
    const s = document.createElement("style");
    s.id = "v4-ambient-style";
    s.textContent = STYLE;
    document.head.appendChild(s);

    // WebAudio MUST be created after a user gesture or browsers refuse.
    // First click/keypress kicks it off; we then never re-arm.
    this._onFirstInteraction = () => {
      _unlockAndStart();
      window.removeEventListener("click", this._onFirstInteraction);
      window.removeEventListener("keydown", this._onFirstInteraction);
    };
    window.addEventListener("click", this._onFirstInteraction, { once: true });
    window.addEventListener("keydown", this._onFirstInteraction, { once: true });

    // Append a 🔊 button to the controls bar TOP row alongside TOP-DOWN
    // + the day/night toggle.
    const controls = document.getElementById("v4-controls");
    if (controls) {
      const topRow = controls.querySelector(".row");
      if (topRow) {
        const btn = document.createElement("button");
        btn.id = "v4-btn-mute";
        btn.className = "btn-top";
        btn.type = "button";
        btn.textContent = "🔊 SOUND";
        btn.addEventListener("click", () => this._toggleMute());
        topRow.appendChild(btn);
        this._btn = btn;
      }
    }
    console.log(
      "%c[Sanctuary] (sound primed — first click/keypress unlocks Web Audio)",
      "color:#aaa;",
    );
  },

  _toggleMute() {
    _muted = !_muted;
    if (_master && _ctx) {
      _master.gain.setTargetAtTime(_muted ? 0 : 1, _ctx.currentTime, 0.15);
    }
    if (this._btn) {
      this._btn.textContent = _muted ? "🔇 MUTED" : "🔊 SOUND";
    }
  },

  update() {
    if (!_ctx || !_water) return;
    // Modulate water layer by distance to pool centre. Avatar at origin
    // is inside the pool; clamp to 0..18 m for the fade.
    const av = typeof window !== "undefined" ? window.__sanctuaryAvatar : null;
    if (!av) return;
    const dx = av.position.x;
    const dz = av.position.z;
    const d = Math.hypot(dx, dz);
    // Inside pool radius ≈ 12 m → full water. Falls to 30 % by 25 m.
    const fade = Math.max(0.3, 1 - Math.max(0, d - 12) / 13);
    _water.g.gain.setTargetAtTime(0.030 * fade, _ctx.currentTime, 0.4);
  },

  unload() {
    if (this._onFirstInteraction) {
      window.removeEventListener("click", this._onFirstInteraction);
      window.removeEventListener("keydown", this._onFirstInteraction);
    }
    if (this._btn?.parentNode) this._btn.parentNode.removeChild(this._btn);
    const s = document.getElementById("v4-ambient-style");
    if (s?.parentNode) s.parentNode.removeChild(s);
    if (_ctx) {
      _ctx.close?.();
      _ctx = null;
      _master = null;
      _wind = null;
      _water = null;
      _birdsGain = null;
    }
    this._btn = null;
    this._onFirstInteraction = null;
  },
};
