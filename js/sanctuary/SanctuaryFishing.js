/**
 * Sacred Adventures — sanctuary part 34: FISHING MINI-GAME (v2).
 *
 * Changes from v1:
 *   • Lure always casts to pool centre.
 *   • Rod rotates to aim at pool centre, pitch scales with distance.
 *   • Camera: 10 ft (3.048 m) above water, 4 ft (1.219 m) behind avatar,
 *     locked onto pool centre the whole time.
 *   • Real J-hook (shank + half-torus curve + barb point) under bobber.
 *   • Water ripple rings expand from lure position every 0.6–2.2 s.
 *   • Turn-based bite system: 6-second turns, 1–3 % per turn,
 *     +5 % surge every 1–3 turns (chosen randomly at cast time).
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";
import {
  SANCTUARY_POOL_CENTER_X,
  SANCTUARY_POOL_CENTER_Z,
} from "./SanctuaryGround.js";
import { V2_AVATAR_TRAVEL_CIRCLE_RADIUS_M } from "../v2/constants.js";

// ── Web Audio Procedural Synthesizer ──────────────────────────────────
const _audioCtx = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext)
  ? new (window.AudioContext || window.webkitAudioContext)()
  : null;

function playFishingTone(type) {
  if (!_audioCtx) return;
  if (_audioCtx.state === 'suspended') {
    _audioCtx.resume();
  }
  const t = _audioCtx.currentTime;
  
  if (type === 'cast') {
    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.connect(gain);
    gain.connect(_audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.85);
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
    osc.start(t);
    osc.stop(t + 0.9);
  } 
  else if (type === 'splash') {
    const bufferSize = _audioCtx.sampleRate * 0.45;
    const buffer = _audioCtx.createBuffer(1, bufferSize, _audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = _audioCtx.createBufferSource();
    noise.buffer = buffer;
    const filter = _audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(550, t);
    filter.frequency.exponentialRampToValueAtTime(70, t + 0.4);
    const gain = _audioCtx.createGain();
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(_audioCtx.destination);
    noise.start(t);
    noise.stop(t + 0.45);
  }
  else if (type === 'bite') {
    const playChime = (freq, startOffset, dur) => {
      const osc = _audioCtx.createOscillator();
      const gain = _audioCtx.createGain();
      osc.connect(gain);
      gain.connect(_audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + startOffset);
      gain.gain.setValueAtTime(0.08, t + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.001, t + startOffset + dur);
      osc.start(t + startOffset);
      osc.stop(t + startOffset + dur + 0.05);
    };
    playChime(523.25, 0, 0.22); // C5
    playChime(659.25, 0.1, 0.32); // E5
  }
  else if (type === 'success') {
    const playNote = (freq, start, duration, vol = 0.08) => {
      const osc = _audioCtx.createOscillator();
      const gain = _audioCtx.createGain();
      osc.connect(gain);
      gain.connect(_audioCtx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t + start);
      gain.gain.setValueAtTime(vol, t + start);
      gain.gain.exponentialRampToValueAtTime(0.001, t + start + duration);
      osc.start(t + start);
      osc.stop(t + start + duration + 0.05);
    };
    playNote(261.63, 0.0, 0.7);    // C4
    playNote(329.63, 0.12, 0.7);   // E4
    playNote(392.00, 0.24, 0.7);   // G4
    playNote(523.25, 0.36, 1.1, 0.12);  // C5 (level-up victory arpeggio!)
  }
  else if (type === 'fail') {
    const playNote = (freq, start, duration) => {
      const osc = _audioCtx.createOscillator();
      const gain = _audioCtx.createGain();
      osc.connect(gain);
      gain.connect(_audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + start);
      gain.gain.setValueAtTime(0.08, t + start);
      gain.gain.exponentialRampToValueAtTime(0.001, t + start + duration);
      osc.start(t + start);
      osc.stop(t + start + duration + 0.05);
    };
    playNote(293.66, 0.0, 0.35); // D4
    playNote(220.00, 0.18, 0.55); // A3
  }
  else if (type === 'struggle') {
    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.connect(gain);
    gain.connect(_audioCtx.destination);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.linearRampToValueAtTime(180, t + 0.07);
    gain.gain.setValueAtTime(0.04, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.start(t);
    osc.stop(t + 0.08);
  }
}

// ── World of Warcraft Floating Combat Text ──────────────────────────
function showWoWCombatText(text, isSuccess) {
  const el = document.createElement("div");
  el.textContent = text.toUpperCase();
  Object.assign(el.style, {
    position: "fixed",
    left: "50%",
    top: "42%",
    transform: "translate(-50%, -50%) scale(0.6)",
    zIndex: "100000",
    pointerEvents: "none",
    userSelect: "none",
    font: "900 36px 'Fredoka One', 'Outfit', sans-serif",
    color: isSuccess ? "#fbc02d" : "#ef4444", // Gold for success, Red for escape
    textShadow: "0 0 8px rgba(0,0,0,0.9), 0 3px 10px rgba(0,0,0,0.95)",
    letterSpacing: "0.06em",
    opacity: "0",
    transition: "all 1.3s cubic-bezier(0.18, 0.89, 0.32, 1.28)",
  });
  document.body.appendChild(el);
  
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translate(-50%, -160%) scale(1.3)";
  });
  
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 1300);
  }, 1400);
}

// ── Physical ──────────────────────────────────────────────────────────
const STAND_RADIUS_M     = V2_AVATAR_TRAVEL_CIRCLE_RADIUS_M + 0.3048; // same compact size + 1 foot extra safety zone to trigger earlier and prevent falling off
const SPOT_DISC_RADIUS_M = V2_AVATAR_TRAVEL_CIRCLE_RADIUS_M; // exactly the same size as player circle!
const WATER_Y_M          = -0.05;
const ROD_LENGTH_M       = 2.8;
const BOBBER_RADIUS_M    = 0.05;

// ── Timing ────────────────────────────────────────────────────────────
const CAST_FLIGHT_S  = 0.9;
const REEL_FLIGHT_S  = 0.6;
const BITE_WINDOW_S  = 3.5;
const REWARD_HOLD_S  = 0.8;

// ── Bite turn system ──────────────────────────────────────────────────
// 1.5-second turns. Each turn: 35–75 % base bite chance. Every surgeEvery
// turns (1–3, random at cast): +15 % bonus is applied to that turn.
const TURN_S         = 1.5;
const BITE_MIN_PCT   = 0.35;   // 35 %
const BITE_RANGE_PCT = 0.40;   // adds 0–40 % → max 75 %
const SURGE_BONUS    = 0.15;   // +15 % on surge turns

// ── Camera ────────────────────────────────────────────────────────────
// Initial fishing cam: 15 ft above water, 4 ft behind avatar.
// After 10 s idle: pulls back to 1 tile (≈10.85 m) behind avatar and
// 22 ft above water for a cinematic panorama of the dock + pond.
const CAM_LIFT_M      = 4.572;   // 15 ft (initial)
const CAM_BACK_M      = 1.219;   // 4 ft behind avatar (initial)
const PANORAMA_LIFT_M = 6.706;   // 22 ft (panorama)
const PANORAMA_BACK_M = 10.853;  // 1 × V2_HEX_FLAT_WIDTH ≈ 10.85 m (panorama pullback)
const PANORAMA_ENTER_S = 10.0;   // seconds before panorama kicks in
const CAM_LERP_RATE   = 6.0;
const CAM_LOOK_BIAS   = 0.22;    // fraction toward avatar from pool centre

// ── Ripples ───────────────────────────────────────────────────────────
const RIPPLE_MAX         = 5;
const RIPPLE_LIFE_S      = 2.2;
const RIPPLE_SPAWN_MIN_S = 0.6;
const RIPPLE_SPAWN_MAX_S = 2.2;

const PHASE = Object.freeze({
  IDLE:    "idle",
  CASTING: "casting",
  WAITING: "waiting",
  BITE:    "bite",
  REELING: "reeling",
  LANDING: "landing",
  REWARD:  "reward",
});

function _makeButton() {
  const btn = document.createElement("button");
  btn.id   = "v4-btn-fishing";
  btn.type = "button";
  btn.textContent = "🎣 CAST";
  Object.assign(btn.style, {
    position: "fixed", left: "50%", bottom: "120px",
    transform: "translateX(-50%) scale(1.0)", zIndex: "5100",
    padding: "12px 24px", borderRadius: "999px",
    background: "linear-gradient(180deg, #7c3aed, #5b21b6)",
    color: "#ffffff", font: "700 15px/1 ui-sans-serif,system-ui,sans-serif",
    letterSpacing: "0.08em", border: "1.5px solid #c084fc",
    boxShadow: "0 0 15px rgba(124, 58, 237, 0.6), 0 4px 20px rgba(0, 0, 0, 0.4)",
    cursor: "pointer", pointerEvents: "auto", userSelect: "none", display: "none",
    transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
  });

  btn.addEventListener("mouseenter", () => {
    btn.style.transform = "translateX(-50%) scale(1.05)";
    btn.style.boxShadow = "0 0 25px rgba(139, 92, 246, 0.85), 0 6px 24px rgba(0, 0, 0, 0.5)";
    btn.style.filter = "brightness(1.1)";
  });

  btn.addEventListener("mouseleave", () => {
    btn.style.transform = "translateX(-50%) scale(1.0)";
    btn.style.boxShadow = "0 0 15px rgba(124, 58, 237, 0.6), 0 4px 20px rgba(0, 0, 0, 0.4)";
    btn.style.filter = "none";
  });

  btn.addEventListener("mousedown", () => {
    btn.style.transform = "translateX(-50%) scale(0.95)";
  });

  btn.addEventListener("mouseup", () => {
    btn.style.transform = "translateX(-50%) scale(1.05)";
  });

  document.body.appendChild(btn);
  return btn;
}

function _makeStatusPill() {
  const pill = document.createElement("div");
  pill.id = "v4-fishing-status";
  Object.assign(pill.style, {
    position: "fixed", left: "50%", bottom: "175px",
    transform: "translateX(-50%)", zIndex: "5101",
    padding: "6px 16px", borderRadius: "999px",
    background: "rgba(46, 16, 101, 0.95)", color: "#ede9fe",
    font: "700 12px/1 ui-monospace,monospace", letterSpacing: "0.1em",
    border: "1.5px solid rgba(139, 92, 246, 0.45)",
    boxShadow: "0 4px 15px rgba(0, 0, 0, 0.35)",
    pointerEvents: "none", userSelect: "none", display: "none",
  });
  pill.textContent = "WAITING";
  document.body.appendChild(pill);
  return pill;
}

// ── 3-D Floating Interest Gauge ───────────────────────────────────────
// Spec: AI 3D prompt (user 2026-05-26). Semicircle r=2.0, 5 segments,
// clear plastic (MeshPhysicalMaterial), dark-grey needle, lies flat on
// water, scale=0.22 → ~0.44 m radius, 3 cm submerged.

const GAUGE_3D_SCALE = 0.242; // +10% vs original 0.22
const GAUGE_SEGS = [
  { color: 0xd32f2f, label: "FAIL"    },
  { color: 0xf57c00, label: "CURIOUS" },
  { color: 0xfbc02d, label: "INSPECT" },
  { color: 0x7cb342, label: "NIBBLE"  },
  { color: 0x388e3c, label: "CAUGHT!" },
];

// Ring-slice Shape: outer arc forward, inner arc backward.
function _arcShape(startAngle, endAngle, innerR, outerR, steps = 48) {
  const shape = new THREE.Shape();
  const step  = (endAngle - startAngle) / steps;
  for (let i = 0; i <= steps; i++) {
    const a = startAngle + i * step;
    if (i === 0) shape.moveTo(Math.cos(a) * outerR, Math.sin(a) * outerR);
    else         shape.lineTo(Math.cos(a) * outerR, Math.sin(a) * outerR);
  }
  for (let i = steps; i >= 0; i--) {
    shape.lineTo(Math.cos(startAngle + i * step) * innerR,
                 Math.sin(startAngle + i * step) * innerR);
  }
  shape.closePath();
  return shape;
}

// Small canvas sprite for segment labels.
function _segLabelSprite(text) {
  const c = document.createElement("canvas");
  c.width = 160; c.height = 56;
  const ctx = c.getContext("2d");
  ctx.font = "bold 17px ui-monospace,Menlo,monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.88)"; ctx.shadowBlur = 5;
  ctx.fillStyle = "#111";
  ctx.fillText(text, 80, 28);
  return new THREE.CanvasTexture(c);
}

function _build3DGauge(scene) {
  const g = new THREE.Group();
  g.name = "v4_gauge_3d";

  // Clear plastic — user-requested 2026-05-28 (9× asked):
  // "just remove the white opacity ... in pip just make it crystal
  // clear ... we can see fish through it". The gauge STAYS visible in
  // both FPV and PIP — only the white plastic body opacity drops so
  // the colored dial floats above the pond/fish view. Single shared
  // material across both cameras (same low opacity in FPV and PIP).
  // depthTest true + depthWrite false + renderOrder 9990 keeps the
  // gauge well-behaved against dock rails/posts.
  // 2026-05-28 follow-up: opacity 0.15 → 0.04 because the user said the
  // PIP fish-view "looks weird, its white washed". Dropping the cover
  // alpha further lets the live scene fish (layer 2) read clearly
  // through the dial without the pale-blue plastic tint dominating.
  const clearMat = new THREE.MeshPhysicalMaterial({
    color: 0xddeeff, transmission: 0.98, opacity: 0.04,
    ior: 1.5, roughness: 0.05,
    transparent: true, side: THREE.DoubleSide,
    depthWrite: false, depthTest: true,
  });
  // Matte dark grey (spec: #333333, roughness 0.4)
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x333333, roughness: 0.4, metalness: 0.05,
  });

  // Base plate — semicircle r=2.0, depth=0.10, bevel=0.02
  const baseShape = new THREE.Shape();
  baseShape.absarc(0, 0, 2.0, 0, Math.PI, false);
  baseShape.lineTo(-2.0, 0);
  g.add(new THREE.Mesh(
    new THREE.ExtrudeGeometry(baseShape, {
      depth: 0.10, bevelEnabled: true,
      bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3,
    }),
    clearMat
  ));

  // Bottom plastic cover — semicircle r=2.0, depth=0.10, bevel=0.02 (May-27 2026 user request)
  const coverShape = new THREE.Shape();
  coverShape.absarc(0, 0, 2.0, Math.PI, Math.PI * 2, false);
  coverShape.lineTo(2.0, 0);
  g.add(new THREE.Mesh(
    new THREE.ExtrudeGeometry(coverShape, {
      depth: 0.10, bevelEnabled: true,
      bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3,
    }),
    clearMat
  ));

  // Outer rim — REMOVED 2026-05-28 per user: "borders should be same
  // as player circles, so remove the borders from the fish circle".
  // The chunky extruded clear-plastic rim was the "border" that didn't
  // match the player travel disc style. Without it the gauge reads as
  // a flat coloured semicircle dial on the water — closer to the
  // simple disc+arrow look the player circle has.

  // 5 colored arc segments (r 0.85→1.82, 0.03 radian gaps)
  const SEG_ARC = Math.PI / 5;
  const GAP     = 0.015;   // half of 0.03 radian spec gap
  const IN_R = 0.85, OUT_R = 1.82;

  GAUGE_SEGS.forEach((seg, i) => {
    const sa = Math.PI - i * SEG_ARC + GAP;
    const ea = Math.PI - (i + 1) * SEG_ARC - GAP;

    const segMesh = new THREE.Mesh(
      new THREE.ShapeGeometry(_arcShape(sa, ea, IN_R, OUT_R), 48),
      new THREE.MeshStandardMaterial({ color: seg.color, roughness: 0.18, metalness: 0.04 })
    );
    segMesh.position.z = 0.11;
    g.add(segMesh);

    // Label sprite at arc midpoint (always faces camera)
    const mid = Math.PI - (i + 0.5) * SEG_ARC;
    const lr  = (IN_R + OUT_R) / 2;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: _segLabelSprite(seg.label), transparent: true, depthWrite: false,
    }));
    spr.position.set(Math.cos(mid) * lr, Math.sin(mid) * lr, 0.24);
    spr.scale.set(0.72, 0.25, 1);
    g.add(spr);
  });

  // Inner koi-fish plane (CanvasTexture redrawn each frame). Restored
  // 2026-05-28 after user said "keep the fish" — the dial koi is the
  // fish they want shown. Static-looking concern is resolved by the
  // animation pass in drawGaugeFish which gets called every frame from
  // _update3DGauge; the white-washed concern is resolved by dropping
  // the clearMat opacity below.
  const fishCanvas = document.createElement("canvas");
  fishCanvas.width = fishCanvas.height = 256;
  const fishTex = new THREE.CanvasTexture(fishCanvas);
  const fishPlane = new THREE.Mesh(
    new THREE.CircleGeometry(0.80, 48),
    new THREE.MeshBasicMaterial({
      map: fishTex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  fishPlane.position.z = 0.12;
  g.add(fishPlane);
  g.userData.fishCanvas = fishCanvas;
  g.userData.fishTex    = fishTex;

  // State-label sprite (WAITING... / CURIOUS / etc.)
  const lblCanvas = document.createElement("canvas");
  lblCanvas.width = 320; lblCanvas.height = 72;
  const lblTex = new THREE.CanvasTexture(lblCanvas);
  const lblSpr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: lblTex, transparent: true, depthWrite: false,
  }));
  lblSpr.position.set(0, -0.06, 0.28);
  lblSpr.scale.set(1.5, 0.34, 1);
  g.add(lblSpr);
  g.userData.lblCanvas = lblCanvas;
  g.userData.lblTex    = lblTex;

  // Center pivot cap (r=0.22, cylinder along Z after group rotation)
  const pivotMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.25, 32),
    darkMat
  );
  pivotMesh.rotation.x = Math.PI / 2;
  pivotMesh.position.z = 0.18;
  g.add(pivotMesh);

  // Needle — tapered shape in child group, rotates around local Z
  const needleGroup = new THREE.Group();
  const nShape = new THREE.Shape();
  nShape.moveTo(0,    0.06);
  nShape.lineTo(1.35, 0.02);
  nShape.lineTo(1.35, -0.02);
  nShape.lineTo(0,   -0.06);
  nShape.closePath();
  const needleMesh = new THREE.Mesh(
    new THREE.ShapeGeometry(nShape, 1),
    darkMat
  );
  needleMesh.position.z = 0.22;
  needleGroup.add(needleMesh);
  g.add(needleGroup);
  g.userData.needleGroup = needleGroup;

  // Lie flat on water (XZ plane, Y-up world).
  // YXZ Euler order: rotation.y (billboard) applied BEFORE rotation.x (flatten),
  // so the yaw rotates around true world-Y regardless of the X tilt.
  g.rotation.order = "YXZ";
  g.rotation.x = -Math.PI / 2;
  // rotation.z is now driven PER-FRAME in _update3DGauge to compensate
  // for the billboard rotation.y so the colored arc ALWAYS lands at the
  // TOP of the PIP top-down camera view. See the in-frame comment there
  // for the math. Static initial value is 0; will be overwritten on the
  // first update tick.
  g.rotation.z = 0;
  g.scale.setScalar(GAUGE_3D_SCALE);
  // Sit atop the water surface: group origin = WATER_Y_M so base plate
  // rests on the surface; dial face (local z≈0.12) floats ~29mm above water.
  g.position.y = WATER_Y_M;
  g.visible = false;
  g.userData.isGauge3D = true;
  g.name = "fishingGauge3D";

  // renderOrder = 9990 so the gauge sorts ABOVE other transparents in
  // both camera passes. depthTest stays true on every gauge material
  // (clearMat above; inner segment/needle/label materials normalised
  // below) so rails + posts naturally occlude the gauge where they
  // cross (user-reported 2026-05-28: "still z-index clipping").
  //
  // Layer 2 = the fishing PIP camera's "isolation lens" layer. KEEP
  // ENABLED so the gauge still shows in PIP — the user just wanted
  // the white plastic opacity dropped (clearMat above at 0.15) so
  // fish are visible THROUGH the gauge plastic in the PIP view, NOT
  // the gauge fully removed. SanctuaryPool's basin floor + water
  // and SanctuaryFish's trout also enable layer 2 to provide the
  // visible backdrop behind the now-transparent gauge.
  g.renderOrder = 9990;
  g.traverse((child) => {
    if (child.isMesh || child.isSprite || child.isGroup) {
      child.layers.enable(2);
      if (child.renderOrder === 0) child.renderOrder = 9990;
    }
    // Normalise every material under the gauge to depth-respect rails
    // while NOT writing depth (so inner segments are still visible
    // through the clear plastic shell — shell has depthWrite:false
    // which preserves underlying scene depth).
    const mats = child.material
      ? (Array.isArray(child.material) ? child.material : [child.material])
      : [];
    for (const m of mats) {
      if (!m) continue;
      if (m.depthTest === false) m.depthTest = true;
      m.depthWrite = false;
    }
  });

  scene.add(g);
  return g;
}

function _update3DGauge(g, frac, labelText, isReeling, time, camera) {
  if (!g) return;

  // Billboard: rotate around world-Y so the arc always faces the player.
  // YXZ Euler order means rotation.y acts in world space before the X-tilt.
  if (camera) {
    const dx = camera.position.x - g.position.x;
    const dz = camera.position.z - g.position.z;
    // atan2(dx, dz): angle from +Z toward camera; arc opens toward camera.
    g.rotation.y = Math.atan2(dx, dz);
  }
  // User-requested 2026-05-28 (22x): "put gauge in top, half and half —
  // top and bottom". The fishing PIP is an ORTHO TOP-DOWN camera with
  // up=(0,0,-1), so the PIP frame's TOP edge corresponds to world -Z.
  // After YXZ rotation, the colored arc (local +Y in 2D plane) lands at
  // world direction (-sin(θy+θz), 0, -cos(θy+θz)). To make that always
  // equal (0, 0, -1) (= world -Z = TOP of PIP frame), we need
  // θy + θz = 0, i.e. θz = -θy. Setting rotation.z each frame cancels
  // the billboard's effect on the arc's PIP position so the colored
  // semicircle is the TOP HALF of the PIP gauge regardless of which
  // direction the player camera is approaching from. Cover/clear half
  // sits at the bottom, dial face is split horizontally — exactly the
  // "half and half top and bottom" the user has been requesting.
  // Companion to the PIP-camera up=(1,0,0) spin in Orchestrator.js (2026-05-28).
  // The PIP camera's new up vector means PIP TOP = world +X (was -Z).
  // To land the arc at world +X we need θy + θz = -π/2, so θz = -θy - π/2.
  g.rotation.z = -g.rotation.y - Math.PI / 2;

  // Needle: FAIL(π) → CAUGHT!(0)
  const ng = g.userData.needleGroup;
  if (ng) ng.rotation.z = Math.PI - frac * Math.PI;

  // Koi fish canvas
  const fc = g.userData.fishCanvas, ft = g.userData.fishTex;
  if (fc && ft) {
    const ctx = fc.getContext("2d");
    ctx.clearRect(0, 0, 256, 256);
    drawGaugeFish(ctx, 128, 164, time, frac, isReeling);
    ft.needsUpdate = true;
  }

  // State label
  const lc = g.userData.lblCanvas, lt = g.userData.lblTex;
  if (lc && lt) {
    const ctx = lc.getContext("2d");
    ctx.clearRect(0, 0, 320, 72);
    ctx.font = "800 20px ui-monospace,Menlo,monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 5;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(labelText.toUpperCase(), 160, 36);
    lt.needsUpdate = true;
  }
}

// ── Old 2D canvas gauge — REPLACED by 3D above ───────────────────────
function _buildGauge() {
  const wrap = document.createElement("div");
  wrap.id = "v4-stress-gauge";
  Object.assign(wrap.style, {
    position: "fixed", left: "50%", top: "38%",
    transform: "translate(-50%, -50%)",
    zIndex: "9600", display: "none", pointerEvents: "none", userSelect: "none",
    background: "rgba(255, 255, 255, 0.16)", // clear frosted plastic
    borderRadius: "125px 125px 32px 32px",
    border: "4px solid rgba(255, 255, 255, 0.45)", // clear plastic border
    backdropFilter: "blur(14px)", // translucent glass/acrylic effect
    boxShadow: "0 22px 50px rgba(0, 0, 0, 0.5), inset 0 2px 4px rgba(255,255,255,0.6), inset 0 -2px 4px rgba(0,0,0,0.15)", // glossy 3D plastic finish
    padding: "10px",
  });
  
  // Specular glossy plastic overlay highlight
  const gloss = document.createElement("div");
  Object.assign(gloss.style, {
    position: "absolute",
    inset: "0",
    borderRadius: "inherit",
    background: "linear-gradient(135deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 40%)",
    pointerEvents: "none",
    zIndex: "10",
  });
  wrap.appendChild(gloss);

  const canvas = document.createElement("canvas");
  canvas.width  = 240;
  canvas.height = 150;
  wrap.appendChild(canvas);
  document.body.appendChild(wrap);
  return { wrap, ctx: canvas.getContext("2d"), canvas };
}

/**
 * Calm koi-style gauge fish (May-25 2026 rewrite per user spec):
 *   "use the fish in the fish symbol, and dont jerk it around. its calm,
 *    it only wiggles when the fish on the line is caught"
 *
 * Rules:
 *   • DEFAULT (isReeling=false) → fish is COMPLETELY still. Zero wiggle,
 *     zero pectoral flap, zero scale pulse, zero pupil dilation.
 *   • REELING (isReeling=true)  → gentle slow wiggle (12 Hz × 0.18 rad)
 *     to convey "the fish on the line is alive" without being jerky.
 *   • Body is the fat-koi oval (was a skinny bezier shape — replaced).
 */
function drawGaugeFish(ctx, cx, cy, time, frac, isReeling) {
  ctx.save();
  ctx.translate(cx, cy - 36);

  // Static angle from gauge needle position (-π/4 to +π/4)
  const targetAngle = (frac - 0.5) * 1.5;
  // Wiggle ONLY when caught — calm otherwise.
  const wiggle = isReeling ? Math.sin(time * 12) * 0.18 : 0;
  ctx.rotate(targetAngle + wiggle);

  // ── Tail (fan-shaped — koi proportions) ──────────────────────────
  const tailGrd = ctx.createLinearGradient(-38, 0, -22, 0);
  tailGrd.addColorStop(0, "#fbbf24");   // gold tail tips
  tailGrd.addColorStop(1, "#1565c0");   // deep blue base
  ctx.fillStyle = tailGrd;
  ctx.beginPath();
  ctx.moveTo(-22, -4);
  // Tail only "breathes" when caught — static otherwise
  const tailFlex = isReeling ? Math.sin(time * 10) * 5 : 0;
  ctx.quadraticCurveTo(-30, -12 + tailFlex, -40, -22 + tailFlex);
  ctx.quadraticCurveTo(-34, 0, -40, 22 + tailFlex);
  ctx.quadraticCurveTo(-30, 12 + tailFlex, -22, 4);
  ctx.closePath();
  ctx.fill();

  // ── Body (FAT oval — koi-cute, not skinny bezier) ───────────────
  const bodyGrd = ctx.createRadialGradient(8, -6, 6, 0, 0, 32);
  bodyGrd.addColorStop(0, "#ffffff");   // top-back highlight
  bodyGrd.addColorStop(0.4, "#42a5f5"); // primary blue
  bodyGrd.addColorStop(0.85, "#1565c0");// shadow side
  bodyGrd.addColorStop(1.0, "#0d47a1"); // deep edge
  ctx.fillStyle = bodyGrd;
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, 0, 30, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // ── Belly highlight ─────────────────────────────────────────────
  ctx.fillStyle = "rgba(227, 242, 253, 0.85)";
  ctx.beginPath();
  ctx.ellipse(2, 7, 22, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Subtle gill arc ─────────────────────────────────────────────
  ctx.strokeStyle = "rgba(251, 191, 36, 0.5)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(10, 0, 7, -Math.PI / 3, Math.PI / 3, false);
  ctx.stroke();

  // ── Side fin (static — no flapping unless caught) ──────────────
  ctx.fillStyle = "#1976d2";
  ctx.save();
  ctx.translate(2, 8);
  if (isReeling) ctx.rotate(Math.sin(time * 8) * 0.25);
  ctx.beginPath();
  ctx.ellipse(0, 0, 9, 5, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ── Eye (calm, fixed pupil) ─────────────────────────────────────
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(19, -5, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0d47a1";
  ctx.beginPath();
  ctx.arc(20, -5, 2.6, 0, Math.PI * 2);   // pupil — fixed size
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(21, -6.2, 1.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function _drawGauge(ctx, frac, labelText = "WAITING...", isReeling = false, time = 0) {
  const W = 240, H = 150;
  const cx = W / 2, cy = H - 20;
  const OR = 100, IR = 68;
  const arcR = (OR + IR) / 2;
  const arcW = OR - IR;
  ctx.clearRect(0, 0, W, H);

  // Outer void bezel with premium translucent glassmorphic ring
  ctx.beginPath();
  ctx.arc(cx, cy, OR + 10, Math.PI, 0, false);
  ctx.lineTo(cx + OR + 10, cy); ctx.lineTo(cx - OR - 10, cy);
  ctx.closePath();
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)"; // see-through clear plastic void
  ctx.fill();

  // Premium glowing rim highlight (frosted clear acrylic edge)
  ctx.beginPath();
  ctx.arc(cx, cy, OR + 7, Math.PI, 0, false);
  const rimGrd = ctx.createLinearGradient(cx - OR, cy, cx + OR, cy);
  rimGrd.addColorStop(0,   "rgba(255, 255, 255, 0.15)");
  rimGrd.addColorStop(0.5, "rgba(255, 255, 255, 0.5)"); 
  rimGrd.addColorStop(1,   "rgba(255, 255, 255, 0.15)");
  ctx.strokeStyle = rimGrd;
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Inner bezel ring
  ctx.beginPath();
  ctx.arc(cx, cy, OR + 3, Math.PI, 0, false);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 6;
  ctx.stroke();

  // Track (semi-transparent arc background)
  ctx.beginPath();
  ctx.arc(cx, cy, arcR, Math.PI, 0, false);
  ctx.lineWidth = arcW - 2;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineCap = "butt";
  ctx.stroke();

  // ── Plastic-toy interest meter (May-25 2026 user spec) ──────────
  // 3 equal sections sweeping left → right:
  //   ORANGE  — no interest (fish ignoring lure)
  //   YELLOW  — some interest (fish noticing)
  //   GREEN   — fish IS interested (bite imminent)
  // Translucent fills + bright top edge → reads as injection-moulded
  // semi-transparent plastic, like a kids' toy gauge.
  const segments = [
    { start: Math.PI,           end: Math.PI - (Math.PI / 3),     color: "#ff8a3d", label: "orange" },
    { start: Math.PI - (Math.PI / 3), end: Math.PI - (2 * Math.PI / 3), color: "#ffd166", label: "yellow" },
    { start: Math.PI - (2 * Math.PI / 3), end: 0,                 color: "#5fd97a", label: "green"  },
  ];

  // Translucent body of each segment (the "plastic" infill)
  for (const seg of segments) {
    ctx.beginPath();
    ctx.arc(cx, cy, arcR, seg.start, seg.end, true);
    ctx.lineWidth = arcW - 4;
    // Convert hex to rgba @ 0.55 opacity for the plastic-clear read
    const r = parseInt(seg.color.slice(1, 3), 16);
    const g = parseInt(seg.color.slice(3, 5), 16);
    const b = parseInt(seg.color.slice(5, 7), 16);
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.78)`;
    ctx.lineCap = "butt";
    ctx.stroke();
  }
  // Bright glossy top edge on each segment (the "moulded plastic" sheen)
  for (const seg of segments) {
    ctx.beginPath();
    ctx.arc(cx, cy, arcR + (arcW / 2) - 3, seg.start, seg.end, true);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
    ctx.lineCap = "butt";
    ctx.stroke();
  }

  // Inner void glass background
  ctx.beginPath();
  ctx.arc(cx, cy, IR - 3, Math.PI, 0, false);
  ctx.lineTo(cx + IR - 3, cy); ctx.lineTo(cx - IR + 3, cy);
  ctx.closePath();
  ctx.fillStyle = "rgba(255, 255, 255, 0.04)"; // clear see-through inner void
  ctx.fill();

  // Draw wiggling struggling fish in the inner void!
  drawGaugeFish(ctx, cx, cy, time, frac, isReeling);

  // Specular glass glare overlay for 3D photorealism
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, OR + 2, Math.PI, 0, false);
  ctx.lineTo(cx + OR + 2, cy);
  ctx.closePath();
  ctx.clip();
  const glareGrd = ctx.createLinearGradient(cx - OR, cy - OR, cx + OR, cy);
  glareGrd.addColorStop(0,   "rgba(255, 255, 255, 0.3)"); // glistening glass reflection
  glareGrd.addColorStop(0.3, "rgba(255, 255, 255, 0.1)");
  glareGrd.addColorStop(0.5, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = glareGrd;
  ctx.fill();
  ctx.restore();

  // Needle: bright sky-white glowing rod
  const needleAngle = Math.PI - frac * Math.PI;
  const nLen = OR + 2;
  const nx = cx + Math.cos(needleAngle) * nLen;
  const ny = cy + Math.sin(needleAngle) * nLen;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(needleAngle + Math.PI) * 8, cy + Math.sin(needleAngle + Math.PI) * 8);
  ctx.lineTo(nx, ny);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Needle center cap (3D glossy gold bead)
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  const capGrd = ctx.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, 7);
  capGrd.addColorStop(0, "#ffffff");
  capGrd.addColorStop(0.4, "#ffd166");
  capGrd.addColorStop(1, "#f78c6c");
  ctx.fillStyle = capGrd;
  ctx.fill();

  // Label text (re-drawn in high-contrast glowing gold/white with drop shadow)
  ctx.font = "800 11px ui-monospace, Menlo, Monaco, Consolas, monospace";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
  ctx.shadowBlur = 4;
  ctx.textAlign = "center";
  ctx.fillText(labelText.toUpperCase(), cx, cy - 10);
  ctx.shadowBlur = 0; // reset
}

// J-hook: shank (vertical) + half-torus curve + barb point.
function _buildHook() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xcccccc, roughness: 0.12, metalness: 0.95,
  });
  const group = new THREE.Group();
  group.name = "fishing_hook";

  // Shank — straight down from bobber bottom
  const shank = new THREE.Mesh(
    new THREE.CylinderGeometry(0.003, 0.003, 0.09, 6),
    mat,
  );
  shank.position.y = -BOBBER_RADIUS_M - 0.045;

  // Curve — half-torus (π arc) forming the J bend
  const curve = new THREE.Mesh(
    new THREE.TorusGeometry(0.022, 0.003, 6, 12, Math.PI),
    mat,
  );
  curve.rotation.z = -Math.PI / 2;   // open end faces up
  curve.position.set(0.022, -BOBBER_RADIUS_M - 0.09, 0);

  // Barb point — slight inward angle, tip of the J
  const barb = new THREE.Mesh(
    new THREE.CylinderGeometry(0.001, 0.003, 0.028, 5),
    mat,
  );
  barb.rotation.z = Math.PI / 7;     // angled inward
  barb.position.set(0.044, -BOBBER_RADIUS_M - 0.076, 0);

  group.add(shank, curve, barb);
  return group;
}

/**
 * Calm koi-style gauge fish — replaces the old skinny "wiggling" sprite
 * the user disliked. Per spec (May-25 2026):
 *   • Use the proportions of the fish symbol (fat oval body, fan tail)
 *   • DO NOT jerk it around — calm by default
 *   • Wiggle ONLY when isCaught (the fish on the line is being reeled)
 *
 * Caller passes isCaught (was `isReeling` upstream) — when false, wiggle = 0.
 */
function drawWigglingFish(ctx, time, isCaught = false) {
  ctx.clearRect(0, 0, 128, 128);

  // CALM by default — only wiggle when reeling/caught. Much smaller
  // amplitude (0.18 vs 0.38) and lower frequency (12 Hz vs 22 Hz).
  const wiggle = isCaught ? Math.sin(time * 12) * 0.18 : 0;

  ctx.save();
  ctx.translate(64, 64);
  ctx.rotate(-Math.PI / 4); // base orientation to align with decal direction

  // ── Tail (fan-shaped — koi-cute, not skinny) ──────────────────────
  ctx.fillStyle = "#1565c0"; // deeper blue accent
  ctx.beginPath();
  ctx.moveTo(-22, -4);
  const tailSpread = 22;
  const tailX = -38 + Math.sin(wiggle) * -6;
  const tailY = Math.cos(wiggle) * 4;
  ctx.lineTo(tailX, tailY - tailSpread);
  ctx.quadraticCurveTo(tailX - 4, tailY, tailX, tailY + tailSpread);
  ctx.closePath();
  ctx.fill();

  // ── Body (fat oval — koi proportions: wider + rounder) ────────────
  ctx.fillStyle = "#42a5f5";  // primary blue body
  ctx.beginPath();
  ctx.ellipse(0, 0, 28, 17, 0, 0, Math.PI * 2);
  ctx.fill();

  // Soft top-shadow band (suggests rounded back, like a real koi)
  ctx.fillStyle = "rgba(13, 71, 161, 0.35)";
  ctx.beginPath();
  ctx.ellipse(-2, -8, 22, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Belly highlight ──────────────────────────────────────────────
  ctx.fillStyle = "#e3f2fd";
  ctx.beginPath();
  ctx.ellipse(2, 6, 20, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Side fin (subtle, gives volume) ──────────────────────────────
  ctx.fillStyle = "#1976d2";
  ctx.beginPath();
  ctx.ellipse(-6, 10, 7, 4, -0.4, 0, Math.PI * 2);
  ctx.fill();

  // ── Eye (slightly bigger for cute factor) ────────────────────────
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(15, -5, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0d47a1";
  ctx.beginPath();
  ctx.arc(16, -5, 2.5, 0, Math.PI * 2);
  ctx.fill();
  // Catchlight
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(17, -6, 1, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export const SanctuaryFishingModule = {
  name: "SanctuaryFishing",

  _scene:      null,
  _camera:     null,
  _rodGroup:   null,
  _rod:        null,
  _line:       null,
  _lineGeo:    null,
  _bobber:     null,
  _hookGroup:  null,
  _ripples:    [],
  _nextRippleT: 0,
  _spotDisc:   null,
  _spotFishSprite: null,
  _btn:        null,
  _statusPill: null,

  _phase:    PHASE.IDLE,
  _phaseT:   0,
  _castStart:  new THREE.Vector3(),
  _castTarget: new THREE.Vector3(),
  _bobberPos:  new THREE.Vector3(),
  _bobberBob:  0,
  _onClick:    null,
  _onKey:      null,
  _wasShowing: true,

  // Turn-based bite (reset each cast)
  _turnCount:   0,
  _turnElapsed: 0,
  _surgeEvery:  2,
  _waitingTimer: 0.0,

  // 3-D interest gauge
  _gauge3d:    null,

  // Wiggling flying fish animation state
  _flyingFish: null,
  _flyingFishStartPos: null,
  _flyingFishTime: 0.0,
  _flyingFishDuration: 1.2,

  // Caught-fish attachment
  _caughtFish:   null,
  _catchString:  null,
  _caughtFishT:  0,

  // Flat wiggling 2D fish inside player circle
  _playerFlatFish: null,
  _playerFlatFishTex: null,
  _playerFlatFishCtx: null,

  // Caching references for high-performance frame updates (eliminates recursive scene traversals)
  _travelCircleRef: null,
  _circleOutlineRef: null,
  _travelDecalGroupRef: null,
  _attachedFishRef: null,
  _gluedFishRef: null,
  _rodTipHelperRef: null,

  // Camera save/restore
  _savedCamPos: new THREE.Vector3(),
  _savedCamRot: null,
  _savedCamFov: 75,
  _camIsRepositioned: false,

  // Fishing zone culling — objects hidden while fishing
  _fishingCullStash: null,

  // Cached pool-centre vector (created once in load)
  _poolCentre: null,

  // Preallocated Color objects — reused via .set() to avoid GC jank from new THREE.Color() in update()
  _colFishInner:   null,
  _colFishMid:     null,
  _colFishRim:     null,
  _colRingInner:   null,
  _colRingOuter:   null,

  // Preallocated Vector3 scratch pads for hot update() paths
  _camTarget:  null,
  _lookTarget: null,
  _tipWorld:   null,

  // Gauge canvas throttle — only redraw at ~10 fps (100 ms) or on label change
  _gaugeDrawT:   0,
  _gaugePrevLabel: '',

  async load(scene, camera) {
    this._scene   = scene;
    this._camera  = camera;
    this._fishingCamTimer = 0;
    this._poolCentre = new THREE.Vector3(SANCTUARY_POOL_CENTER_X, WATER_Y_M, SANCTUARY_POOL_CENTER_Z);

    // Preallocate Color + Vector3 scratch pads to avoid per-frame GC pressure
    this._colFishInner = new THREE.Color();
    this._colFishMid   = new THREE.Color();
    this._colFishRim   = new THREE.Color();
    this._colRingInner = new THREE.Color();
    this._colRingOuter = new THREE.Color();
    this._camTarget    = new THREE.Vector3();
    this._lookTarget   = new THREE.Vector3();
    this._tipWorld     = new THREE.Vector3();

    if (typeof window !== "undefined") {
      window.__sanctuaryFishingSpawnRipple = (x, z) => this._spawnRipple(x, z);
    }

    // ── PIP frosted-plastic "fish-finder lens" CSS ────────────────────
    // User-requested 2026-05-28: "reduce the opacity of the PIP glass
    // in FISHING GAME VIEW". When body.v4-fishing-active is set (toggled
    // by the phase-change handler) the moondial-wrapper's dark frosted
    // backdrop lightens and the inset shadow softens so the gauge +
    // close-up gauge view read clearly through the glass.
    if (typeof document !== "undefined" && !document.getElementById("v4-fishing-pip-glass-style")) {
      const s = document.createElement("style");
      s.id = "v4-fishing-pip-glass-style";
      s.textContent = `
        body.v4-fishing-active #moondial-wrapper {
          background: radial-gradient(circle, rgba(15, 10, 5, 0.04) 30%, rgba(5, 2, 0, 0.16) 100%) !important;
          border-color: rgba(255, 215, 0, 0.55) !important;
          box-shadow:
            inset 0 0 8px rgba(0, 0, 0, 0.22),
            0 0 0 8px #1a1512,
            0 15px 40px rgba(0, 0, 0, 0.45),
            0 0 24px rgba(255, 200, 80, 0.22) !important;
          transition: background 0.4s ease, box-shadow 0.4s ease, border-color 0.4s ease;
        }
      `;
      document.head.appendChild(s);
    }

    // ── Spot disc + fish glyph ────────────────────────────────────
    const spot = (typeof window !== "undefined") ? window.__sanctuaryFishingSpot : null;
    if (spot) {
      const discMat = new THREE.MeshBasicMaterial({
        color: 0x68d4ff, transparent: true, opacity: 0.45,
        depthTest: true, depthWrite: false, side: THREE.DoubleSide,
      });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(SPOT_DISC_RADIUS_M * 0.70, 56), discMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(spot.x, (spot.y ?? 0) + 0.03, spot.z);
      disc.renderOrder = 15;
      disc.name = "sanctuary_fishing_spot_disc";
      disc.userData.anuKind = "sanctuary_fishing_spot_disc";
      disc.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;
      scene.add(disc);

      // REMOVED 2026-05-28 (proven via tests/v4-disc-zindex-probe.spec.js):
      // The gold RingGeometry(0.92, 1.0) at renderOrder 9971 was the
      // "fish circle inner border" the user kept asking to remove. It
      // sat above the player travel disc + SanctuaryCircles spot disc
      // and read as a hard cream-yellow outline around the bobber. With
      // the disc (above) + fish glyph (below) we still have the visual
      // target marker without the inner border edge.

      // Animated fish glyph
      const cnv = document.createElement("canvas");
      cnv.width = 96; cnv.height = 64;
      const ctx = cnv.getContext("2d");
      ctx.fillStyle = "#3a82c8";
      ctx.beginPath(); ctx.ellipse(48, 32, 32, 16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(82, 32); ctx.lineTo(94, 14); ctx.lineTo(94, 50); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#bfe6ff";
      ctx.beginPath(); ctx.ellipse(50, 38, 20, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";  ctx.beginPath(); ctx.arc(28, 28, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#111";  ctx.beginPath(); ctx.arc(27, 28, 2, 0, Math.PI * 2); ctx.fill();
      const fishTex = new THREE.CanvasTexture(cnv);
      fishTex.colorSpace = THREE.SRGBColorSpace;
      const fishSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: fishTex, transparent: true, depthTest: false, depthWrite: false,
      }));
      fishSprite.scale.set(0.72, 0.48, 1);
      fishSprite.position.set(spot.x, (spot.y ?? 0) + 0.55, spot.z);
      fishSprite.renderOrder = 9972;
      fishSprite.name = "sanctuary_fishing_spot_fish_glyph";
      fishSprite.userData.anuKind = "sanctuary_fishing_spot_fish_glyph";
      fishSprite.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;
      scene.add(fishSprite);
      this._spotDisc = disc;
      this._spotFishSprite = fishSprite;
    }

    // ── Rod ───────────────────────────────────────────────────────
    const rodGroup = new THREE.Group();
    rodGroup.name = "sanctuary_fishing_rod";
    rodGroup.userData.anuKind = "sanctuary_fishing_rod";
    rodGroup.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ITEMS;
    rodGroup.visible = false;
    scene.add(rodGroup);

    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.003, 0.013, ROD_LENGTH_M, 8, 1),
      new THREE.MeshStandardMaterial({ color: 0xd7ccc8, roughness: 0.4, metalness: 0.2 }),
    );
    rod.name = "fishing_rod_stick";
    rod.userData.anuKind = "fishing_rod_stick";
    rod.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ITEMS;
    rod.geometry.translate(0, ROD_LENGTH_M / 2, 0);
    rod.rotation.x = Math.PI / 3;   // initial pitch; updated each frame based on distance
    rodGroup.add(rod);

    // Beautiful foam/cork handle at base
    const handleLen = 0.42;
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, handleLen, 8),
      new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.95 }),
    );
    handle.position.y = handleLen / 2;
    rod.add(handle);

    // Small metallic reel just above the handle
    const reelGroup = new THREE.Group();
    reelGroup.position.set(0, handleLen + 0.05, 0.024);
    const reelBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.035, 10),
      new THREE.MeshStandardMaterial({ color: 0x90a4ae, metalness: 0.85, roughness: 0.2 }),
    );
    reelBody.rotation.x = Math.PI / 2;
    reelGroup.add(reelBody);

    const reelHandle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.005, 0.005, 0.024, 6),
      new THREE.MeshStandardMaterial({ color: 0x37474f, metalness: 0.9, roughness: 0.1 }),
    );
    reelHandle.position.set(0.022, 0, 0.025);
    reelGroup.add(reelHandle);
    rod.add(reelGroup);

    // Eyelets (line guides) along the rod
    const guideMat = new THREE.MeshStandardMaterial({ color: 0xc6a035, metalness: 0.95, roughness: 0.1 });
    const guideCount = 5;
    for (let i = 1; i <= guideCount; i++) {
      const t = i / (guideCount + 1);
      const h = t * ROD_LENGTH_M;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.015 - t * 0.008, 0.003, 5, 10),
        guideMat,
      );
      ring.position.set(0, h, 0.012);
      ring.rotation.y = Math.PI / 2;
      rod.add(ring);
    }

    // Add a tip helper at the very top of the rod to track world attachment point
    const tipHelper = new THREE.Object3D();
    tipHelper.name = "rod_tip_helper";
    tipHelper.position.set(0, ROD_LENGTH_M, 0);
    rod.add(tipHelper);

    // ── Fishing line ──────────────────────────────────────────────
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0,0,0, 0,0,0]), 3));
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({
      color: 0xe8e2c4, transparent: true, opacity: 0.85,
    }));
    line.name = "fishing_line";
    line.userData.anuKind = "fishing_line";
    line.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ITEMS;
    line.frustumCulled = false;
    scene.add(line);

    // ── Bobber + J-hook ───────────────────────────────────────────
    const bobber = new THREE.Mesh(
      new THREE.SphereGeometry(BOBBER_RADIUS_M, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xc1272d, roughness: 0.4 }),
    );
    bobber.name = "fishing_bobber";
    bobber.userData.anuKind = "fishing_bobber";
    bobber.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ITEMS;
    bobber.visible = false;
    const hookGroup = _buildHook();
    bobber.add(hookGroup);   // hook moves with bobber automatically
    scene.add(bobber);

    this._rodGroup  = rodGroup;
    this._rod       = rod;
    this._line      = line;
    this._lineGeo   = lineGeo;
    this._bobber    = bobber;
    this._hookGroup = hookGroup;

    // ── Ripple rings (pooled) ─────────────────────────────────────
    for (let i = 0; i < RIPPLE_MAX; i++) {
      const geo  = new THREE.RingGeometry(0.04, 0.10, 32);
      const mat  = new THREE.MeshBasicMaterial({
        color: 0x90caf9, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y  = WATER_Y_M + 0.012;
      mesh.renderOrder = 9980;
      mesh.frustumCulled = false;
      mesh.visible = false;
      scene.add(mesh);
      this._ripples.push({ mesh, age: -1 });
    }
    this._nextRippleT = RIPPLE_SPAWN_MIN_S + Math.random() * (RIPPLE_SPAWN_MAX_S - RIPPLE_SPAWN_MIN_S);

    // ── UI ────────────────────────────────────────────────────────
    this._btn = _makeButton();
    this._statusPill = _makeStatusPill();
    
    this._gauge3d = _build3DGauge(scene);

    this._onClick = () => {
      const inFishing = this._phase !== PHASE.IDLE;
      if (inFishing && this._phase === PHASE.WAITING) {
        const now = Date.now();
        const lastClick = this._lastClickTime || 0;
        this._lastClickTime = now;
        if (now - lastClick < 600) {
          this._triggerSecretDebugBite();
          return;
        }
      }
      this._tryAction();
    };
    this._btn.addEventListener("click", this._onClick);

    this._miniGameNeedle = 0.5;
    this._reelProgress = 0.0;
    this._fishStruggleTimer = 0.0;
    this._fishDriftDir = 1.0;
    this._fishDriftSpeed = 1.0;

    this._onWindowClick = (e) => {
      const inFishing = this._phase !== PHASE.IDLE;
      if (inFishing && (this._phase === PHASE.BITE || this._phase === PHASE.REELING)) {
        e.preventDefault();
        e.stopPropagation();
        this._handleCorrectionInput();
      }
    };
    window.addEventListener("mousedown", this._onWindowClick, true);
    window.addEventListener("touchstart", this._onWindowClick, { passive: false, capture: true });

    this._onKey = (e) => {
      const ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
      const inFishing = this._phase !== PHASE.IDLE;
      if (inFishing) {
        const key = e.key.toLowerCase();
        if (key === "s" || e.key === "ArrowDown" || e.key === "Escape") {
          e.preventDefault();
          this._endIdle(false);
        } else if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          this._handleCorrectionInput();
        } else if (key === "f") {
          e.preventDefault();
          if (this._phase === PHASE.WAITING) {
            const now = Date.now();
            const lastPress = this._lastFPress || 0;
            this._lastFPress = now;
            if (now - lastPress < 600) {
              this._triggerSecretDebugBite();
              return;
            }
          }
        } else {
          e.preventDefault();
        }
        return;
      }
      if ((e.key === "f" || e.key === "F") && this._isPlayerOnDock()) {
        e.preventDefault();
        this._tryAction();
      }
    };
    window.addEventListener("keydown", this._onKey, true);

    // Expose programmatic start so the FISH guide button (and any auto-walk
    // sequence) can begin fishing without waiting for the user to click the
    // in-game button or press F. Same dock-proximity gate as the user paths.
    if (typeof window !== "undefined") {
      window._v4StartFishing = () => {
        if (!this._isPlayerOnDock()) {
          console.warn("[SanctuaryFishing] _v4StartFishing: player not on dock — ignored.");
          return false;
        }
        if (this._phase !== PHASE.IDLE) return false;
        this._tryAction();
        return true;
      };
    }

    console.log(
      "%c[Sanctuary] 🎣 Fishing v2 — pool-centre cast · J-hook · ripples · turn-based bites.",
      "color:#80deea;font-weight:bold;",
    );
  },

  // ── Fishing zone isolation ────────────────────────────────────────────────
  // Hides all scene objects more than 16m from pool centre during fishing so
  // the renderer only processes the pond area — big FPS win on shadow maps,
  // draw calls and update traversals.
  _enterFishingZone() {
    if (this._fishingCullStash) return;
    const scene = this._scene;
    if (!scene) return;
    const cx = SANCTUARY_POOL_CENTER_X, cz = SANCTUARY_POOL_CENTER_Z;
    const CULL_R = 16.0;
    const stash = [];
    const tmp = new THREE.Vector3();
    // Names of anuKind values that must stay visible during fishing
    const KEEP = new Set([
      'sanctuary_fish', 'sanctuary_fish_school', 'sanctuary_jumping_fish',
      'sanctuary_baby_fish', 'sanctuary_frog', 'sanctuary_frogs',
      'sanctuary_avatar', 'sanctuary_avatar_mesh', 'sanctuary_avatar_skin_fill_mesh',
      'sanctuary_fish_jumps', 'sanctuary_pool', 'sanctuary_lily',
      'sanctuary_lily_pad', 'sanctuary_ripple', 'sanctuary_water',
    ]);
    scene.traverse((obj) => {
      if (!obj.visible) return;                     // already hidden — skip
      if (obj.isLight || obj.isCamera) return;      // never cull lights/cameras
      if (!obj.isMesh && !obj.isGroup) return;      // skip helpers, bones, etc.
      const kind = obj.userData?.anuKind;
      if (kind && KEEP.has(kind)) return;           // always keep pond objects
      obj.getWorldPosition(tmp);
      if (Math.hypot(tmp.x - cx, tmp.z - cz) > CULL_R) {
        obj.visible = false;
        stash.push(obj);
      }
    });
    this._fishingCullStash = stash;
    // Raise the DPR floor so the fishing close-up stays crisp — the
    // adaptive stepper can still descend if needed, but never below 1.5
    // (avoids the 0.75 blur seen during the FPS-pressured baseline).
    const Anu = (typeof window !== "undefined") ? window.AnuUniverse : null;
    Anu?.adaptiveDpr?.setMinDpr?.(1.5);
    console.log(
      `%c[SanctuaryFishing] 🎣 Fishing zone isolated — culled ${stash.length} distant objects.`,
      'color:#4fc3f7;font-weight:bold;',
    );
  },

  _exitFishingZone() {
    if (!this._fishingCullStash) return;
    for (const obj of this._fishingCullStash) obj.visible = true;
    this._fishingCullStash = null;
    // Release the DPR floor — adaptive stepper resumes full range so the
    // open world can ladder down again if it's under pressure.
    const Anu = (typeof window !== "undefined") ? window.AnuUniverse : null;
    Anu?.adaptiveDpr?.clearMinDpr?.();
    console.log('%c[SanctuaryFishing] 🎣 Fishing zone — world restored.', 'color:#4fc3f7;');
  },

  _setPhase(p) {
    this._phase  = p;
    this._phaseT = 0;
    
    if (p === PHASE.IDLE) {
      this._fishingCamTimer = 0;
    }

    if (p === PHASE.REELING) {
      this._reelProgress = 0.0;
      this._miniGameNeedle = 0.5;
      this._fishStruggleTimer = 0.0;
      this._struggleSoundTimer = 0.0;
      if (window.__interestedFish) {
        window.__interestedFish.userData.isStruggling = true;
      }
    }

    if (p === PHASE.LANDING) {
      this._landingProgress = 0.0;
      this._dropDanger = 0.0;
      this._struggleSoundTimer = 0.0;
      if (window.__interestedFish) {
        window.__interestedFish.userData.isStruggling = true;
      }
    }
    
    if (typeof window !== "undefined") {
      window._v2InputSuppressed = (p !== PHASE.IDLE);
      window._v4InputSuppressed = (p !== PHASE.IDLE);
      window.__sanctuaryFishingActive = (p !== PHASE.IDLE);
    }

    // (2026-05-28 reverted: previously hid the player border while
    // fishing. User pushed back — "use same circle as player has just
    // change its base color and keep the fish. stop making the player
    // border circles so damn hard." The existing per-frame colour
    // morph in the update loop already shifts the border white↔blue
    // when fishing flips on — no visibility toggle needed.)
    // Toggle body class so the PIP frosted-plastic ring lightens during
    // fishing — gives the kid a clearer "fish-finder" look-through to
    // the close-up gauge + pond beneath. CSS rule is injected once in
    // load() (search for "v4-fishing-active" below). User-requested
    // 2026-05-28: "reduce the opacity of the PIP glass in FISHING
    // GAME VIEW".
    if (typeof document !== "undefined") {
      document.body.classList.toggle("v4-fishing-active", p !== PHASE.IDLE);
    }

    // Isolate pond scene for better FPS while fishing
    if (p !== PHASE.IDLE && !this._fishingCullStash) this._enterFishingZone();
    else if (p === PHASE.IDLE && this._fishingCullStash) this._exitFishingZone();

    // Reset turn counters each time we enter WAITING.
    if (p === PHASE.WAITING) {
      this._turnCount   = 0;
      this._turnElapsed = 0;
      this._surgeEvery  = 1 + Math.floor(Math.random() * 3);  // 1, 2, or 3
      this._interestCheckTimer = 10.0; // Force immediate check on entry
      this._waitingTimer = 0.0;
    }
    if (this._statusPill) {
      const label = {
        [PHASE.IDLE]:    "",
        [PHASE.CASTING]: "CASTING…",
        [PHASE.WAITING]: "NO BITE…",
        [PHASE.BITE]:    "BITE! CLICK!",
        [PHASE.REELING]: "REELING…",
        [PHASE.LANDING]: "TAP TO LAND!",
        [PHASE.REWARD]:  "🐟 CAUGHT!",
      }[p] ?? "";
      this._statusPill.textContent = label;
      this._statusPill.style.display = label ? "block" : "none";
      if (p === PHASE.BITE || p === PHASE.LANDING) {
        this._statusPill.style.color = "#ffcd72";
        this._statusPill.style.borderColor = "rgba(255,205,114,.65)";
      } else {
        this._statusPill.style.color = "#fff6c2";
        this._statusPill.style.borderColor = "rgba(251,192,45,.32)";
      }
    }
    if (this._btn) {
      this._btn.textContent = (p === PHASE.BITE || p === PHASE.LANDING) ? "🐟 CATCH!" : "🎣 CAST";
    }

    // ── ANU POND SENSOR TELEMETRY WATCH ───────────────────────────────
    if (typeof window !== "undefined" && window.AnuUniverse) {
      try {
        const budgetSnap = window.AnuUniverse.budget?.snapshot?.();
        const fuzzSnap   = window.AnuUniverse.getFuzzyPipelineSnapshot?.();
        const activeFps  = window.anuOrchestrator ? Math.round(window.anuOrchestrator._fpsReady ? window.anuOrchestrator.smoothFPS : window.anuOrchestrator.rawFPS) : 0;
        const btlId      = fuzzSnap?.primaryBottleneck?.id ?? "none";
        const btlScore   = fuzzSnap?.primaryBottleneck?.score ?? 0;
        const loadPct    = budgetSnap ? Math.round(budgetSnap.loadPct) : 0;

        let statusColor = "#a5d6a7"; // green
        if (activeFps < 45 || loadPct > 120) statusColor = "#ef5350"; // red
        else if (activeFps < 60 || loadPct > 90) statusColor = "#ffd166"; // amber

        console.log(
          `%c[ANU POND SENSOR] 🎣 Phase: ${p.toUpperCase()} · %c${activeFps} FPS%c · Load: ${loadPct}% · Primary Bottleneck: %c${btlId}%c (score: ${btlScore.toFixed(2)})`,
          "color:#80deea;font-weight:bold;",
          `color:${statusColor};font-weight:bold;`,
          "color:#80deea;",
          "color:#ffab91;font-weight:bold;",
          "color:#80deea;"
        );
      } catch (_) {}
    }
  },

  _isPlayerOnDock() {
    const avatar = (typeof window !== "undefined") ? window.__sanctuaryAvatar : null;
    const spot   = (typeof window !== "undefined") ? window.__sanctuaryFishingSpot : null;
    if (!avatar || !spot) return false;
    const dx = avatar.position.x - spot.x;
    const dz = avatar.position.z - spot.z;
    return dx * dx + dz * dz < STAND_RADIUS_M * STAND_RADIUS_M;
  },

  _tryAction() {
    if (!this._isPlayerOnDock()) return;
    if (this._phase === PHASE.IDLE) {
      if (typeof window !== "undefined" && typeof window._v4CancelClickToMove === "function") {
        window._v4CancelClickToMove();
      }
      const cam = this._camera;
      if (cam && !this._camIsRepositioned) {
        this._savedCamPos.copy(cam.position);
        this._savedCamRot = cam.rotation.clone();
        this._savedCamFov = cam.fov;
        this._camIsRepositioned = true;
      }
      // Hide dock planks — from 15 ft up they clutter the fishing view.
      if (typeof window !== "undefined" && window.__sanctuaryDockRoot) {
        window.__sanctuaryDockRoot.visible = false;
      }
      const avatar = window.__sanctuaryAvatar;
      if (avatar) {
        // Orient avatar to face pool centre
        const dx = SANCTUARY_POOL_CENTER_X - avatar.position.x;
        const dz = SANCTUARY_POOL_CENTER_Z - avatar.position.z;
        const targetYaw = Math.atan2(dx, dz);
        window.__sanctuaryPlayerYaw = targetYaw;
        avatar.rotation.y = targetYaw;
        if (window.__sanctuaryKeyboardLook) {
          window.__sanctuaryKeyboardLook._yaw = targetYaw;
          window.__sanctuaryKeyboardLook._cameraYaw = targetYaw;
        }

        // Clear all caught leg-attached fish when starting a new session
        for (let i = 1; i <= 6; i++) {
          const existing = avatar.getObjectByName(`glued_fish_${i}`);
          if (existing) {
            avatar.remove(existing);
            existing.traverse((child) => {
              if (child.geometry) child.geometry.dispose();
              if (child.material) {
                if (Array.isArray(child.material)) child.material.forEach((m) => m?.dispose?.());
                else child.material?.dispose?.();
              }
            });
          }
        }
        this._caughtFishCount = 0;
      }
      if (this._caughtFish3D && this._hookGroup) {
        this._hookGroup.remove(this._caughtFish3D);
      }
      this._caughtFish3D = null;
      window.__sanctuaryHasFishCaught = false;

      this._castStart.set(avatar.position.x, avatar.position.y + 1.2, avatar.position.z);
      // Lure always lands exactly at pool centre.
      this._castTarget.set(SANCTUARY_POOL_CENTER_X, WATER_Y_M, SANCTUARY_POOL_CENTER_Z);
      this._bobber.visible = true;
      this._rodGroup.visible = true;
      playFishingTone('cast');
      this._setPhase(PHASE.CASTING);
    } else if (this._phase === PHASE.BITE) {
      this._setPhase(PHASE.REELING);
    }
  },

  _triggerSecretDebugBite() {
    let fishMesh = window.__interestedFish;
    if (!fishMesh) {
      const school = window.__sanctuaryFishSchool || [];
      if (school.length > 0) {
        fishMesh = school[Math.floor(Math.random() * school.length)];
        window.__interestedFish = fishMesh;
      }
    }
    if (fishMesh) {
      fishMesh.position.copy(this._bobber.position);
      fishMesh.userData.interestTimer = 10.0;
    }
    playFishingTone('bite');
    this._setPhase(PHASE.BITE);
    setTimeout(() => {
      if (this._phase === PHASE.BITE) {
        this._setPhase(PHASE.REELING);
      }
    }, 100);
    console.log("%c[SanctuaryFishing] Debug secret activated: Fish took bait, entering gauge!", "color:#ff8a65;font-weight:bold;");
  },

  _handleCorrectionInput() {
    if (this._phase === PHASE.BITE) {
      this._setPhase(PHASE.REELING);
    } else if (this._phase === PHASE.REELING) {
      // Correct needle back towards the 0.5 center by 0.22!
      const diff = 0.5 - this._miniGameNeedle;
      if (Math.abs(diff) > 0.01) {
        const step = Math.sign(diff) * 0.22;
        this._miniGameNeedle += step;
        this._miniGameNeedle = Math.max(0.02, Math.min(0.98, this._miniGameNeedle));
      }
      // Reactive struggle direction swap
      if (Math.random() < 0.65) {
        this._fishDriftDir *= -1;
      }
    } else if (this._phase === PHASE.LANDING) {
      // Tap landing progress increase!
      this._landingProgress += 0.08;
      this._landingProgress = Math.min(1.0, this._landingProgress);
      
      // Slight kickback on the needle for tension feel
      this._miniGameNeedle += (Math.random() - 0.5) * 0.15;
      this._miniGameNeedle = Math.max(0.02, Math.min(0.98, this._miniGameNeedle));
    }
  },

  _spawnRipple(x = SANCTUARY_POOL_CENTER_X, z = SANCTUARY_POOL_CENTER_Z) {
    const slot = this._ripples.find(r => r.age < 0);
    if (!slot) return;
    // Slight random scatter so multiple rings don't stack perfectly.
    slot.mesh.position.x = x + (Math.random() - 0.5) * 0.25;
    slot.mesh.position.z = z + (Math.random() - 0.5) * 0.25;
    slot.mesh.scale.setScalar(0.1);
    slot.mesh.material.opacity = 0.68;
    slot.mesh.visible = true;
    slot.age = 0;
  },

  update(delta) {
    if (!this._scene) return;
    this._phaseT += delta;

    const avatar = (typeof window !== "undefined") ? window.__sanctuaryAvatar : null;

    // Update wiggling flying fish animation
    if (this._flyingFish && avatar) {
      this._flyingFishTime += delta;
      const t = Math.min(1.0, this._flyingFishTime / this._flyingFishDuration);

      // Compute local slot offset just like _attachFishToAvatarSide()
      const nextIdx = (this._caughtFishCount || 0) + 1;
      const idx = nextIdx > 6 ? 1 : nextIdx;
      const isRight = (idx % 2 !== 0);
      const slotIdx = Math.floor((idx - 1) / 2);
      const sideSign = isRight ? 1 : -1;
      const slotX = 0.24 * sideSign;
      const slotY = 0.36 - slotIdx * 0.14;
      const slotZ = -0.05 + slotIdx * 0.03;

      // Project target slot world coordinate
      const targetWorld = new THREE.Vector3(slotX, slotY, slotZ);
      avatar.localToWorld(targetWorld);

      // Interpolate position along parabolic arc (beautiful jumping leap!)
      const x = this._flyingFishStartPos.x * (1 - t) + targetWorld.x * t;
      const z = this._flyingFishStartPos.z * (1 - t) + targetWorld.z * t;
      const y = this._flyingFishStartPos.y * (1 - t) + targetWorld.y * t + Math.sin(t * Math.PI) * 2.8;

      this._flyingFish.position.set(x, y, z);

      // Wiggle during flight!
      const timeSec = (typeof performance !== "undefined" ? performance.now() : 0) * 0.001;
      this._flyingFish.rotation.z = Math.sin(timeSec * 35) * 0.45;
      this._flyingFish.rotation.y = Math.cos(timeSec * 22) * 0.25;

      if (t >= 1.0) {
        // Complete the flight - remove it from temporary scene group
        this._scene.remove(this._flyingFish);
        this._flyingFish = null;
        this._attachFishToAvatarSide();
      }
    }

    if (this._bobber) {
      window.__sanctuaryBobberPos = this._bobber.position;
    } else {
      window.__sanctuaryBobberPos = null;
    }

    const onDock = this._isPlayerOnDock();
    const isFishingActive = this._phase !== PHASE.IDLE;

    // Fully automated relaxed fishing: auto-casts after 3 seconds of standing idle on the dock
    if (this._phase === PHASE.IDLE && onDock) {
      this._autoCastTimer = (this._autoCastTimer || 0) + delta;
      if (this._autoCastTimer >= 3.0) {
        this._autoCastTimer = 0;
        this._tryAction();
      }
    } else {
      this._autoCastTimer = 0;
    }

    // Wiggle all caught fish attached to legs (up to 3 per side) with organic offsets
    if (window.__sanctuaryHasFishCaught && avatar) {
      const t = (typeof performance !== "undefined" ? performance.now() : 0) * 0.001;
      for (let i = 1; i <= 6; i++) {
        const gluedGroup = avatar.getObjectByName(`glued_fish_${i}`);
        if (gluedGroup) {
          const fishMesh = gluedGroup.getObjectByName("wiggling_attached_fish");
          if (fishMesh) {
            const phaseOffset = i * 0.73;
            fishMesh.rotation.z = Math.sin(t * 18 + phaseOffset) * 0.32;
            fishMesh.rotation.y = Math.cos(t * 10 + phaseOffset) * 0.15;
          }
        }
      }
    }

    if (avatar && isFishingActive) {
      const spot = (typeof window !== "undefined") ? window.__sanctuaryFishingSpot : null;
      if (spot) {
        // Snap player perfectly and statically to the spot to prevent any frame-by-frame coordinate oscillation
        avatar.position.x = spot.x;
        avatar.position.y = spot.y;
        avatar.position.z = spot.z;

        const toPoolX = SANCTUARY_POOL_CENTER_X - avatar.position.x;
        const toPoolZ = SANCTUARY_POOL_CENTER_Z - avatar.position.z;
        // Correct yaw calculation so the avatar and its travel disc direction arrow face exactly towards the pool center
        const targetYaw = Math.atan2(-toPoolX, -toPoolZ);
        if (Number.isFinite(targetYaw)) {
          window.__sanctuaryPlayerYaw = targetYaw;
        }
      }
    }

    // ── Player flat-fish and color morphing ──
    if (avatar) {
      // 1. Color morphing of travel circle
      if (!this._travelCircleRef) {
        this._travelCircleRef = avatar.getObjectByName("player_avatar_travel_circle");
      }
      const discMesh = this._travelCircleRef;
      if (discMesh && discMesh.material && discMesh.material.uniforms) {
        const uni = discMesh.material.uniforms;
        
        // Target colors: blue when actively fishing, normal green otherwise.
        // Use preallocated Color objects — .set() is in-place, no GC allocation.
        const targetInner = isFishingActive
          ? this._colFishInner.set(0x06182c) : this._colFishInner.set(0x0d260d);
        const targetMid   = isFishingActive
          ? this._colFishMid.set(0x1565c0)   : this._colFishMid.set(0x2e7d32);
        const targetRim   = isFishingActive
          ? this._colFishRim.set(0x64b5f6)   : this._colFishRim.set(0x7cb342);

        // Smoothly lerp towards target colors
        const k = 1 - Math.exp(-8 * delta);
        uni.uInner.value.lerp(targetInner, k);
        uni.uMid.value.lerp(targetMid, k);
        uni.uRim.value.lerp(targetRim, k);
      }

      // Color morphing of travel circle outline (white border normally, blue border when fishing)
      if (!this._circleOutlineRef) {
        this._circleOutlineRef = avatar.getObjectByName("player_avatar_circle_outline");
      }
      const ringMesh = this._circleOutlineRef;
      if (ringMesh && ringMesh.material && ringMesh.material.uniforms) {
        // The cream border the user kept asking about turned out to be
        // the SanctuaryFishing.js spot ring (now removed above), NOT
        // this player_avatar_circle_outline ring. Keeping the white↔blue
        // colour morph here since that's the established fishing cue.
        const uni = ringMesh.material.uniforms;
        const targetInner = isFishingActive
          ? this._colRingInner.set(0xb3e5fc) : this._colRingInner.set(0xffffff);
        const targetOuter = isFishingActive
          ? this._colRingOuter.set(0x0288d1) : this._colRingOuter.set(0xffffff);

        const k = 1 - Math.exp(-8 * delta);
        uni.uInner.value.lerp(targetInner, k);
        uni.uOuter.value.lerp(targetOuter, k);
      }

      // 2. Dynamically attach the flat wiggling 2D fish if not done yet
      if (!this._playerFlatFish) {
        const R = V2_AVATAR_TRAVEL_CIRCLE_RADIUS_M;
        const cnv = document.createElement("canvas");
        cnv.width = 128; cnv.height = 128;
        const tex = new THREE.CanvasTexture(cnv);
        tex.colorSpace = THREE.SRGBColorSpace;
        
        const mat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        
        const mesh = new THREE.Mesh(new THREE.CircleGeometry(R * 0.55, 32), mat);
        mesh.name = "player_fishing_flat_fish";
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(0, 0.02, 0); // slightly above travel disc
        mesh.renderOrder = 9985; // between travel disc and player feet
        
        if (!this._travelDecalGroupRef) {
          this._travelDecalGroupRef = avatar.getObjectByName("player_avatar_travel_decal_group");
        }
        const decalGroup = this._travelDecalGroupRef;
        if (decalGroup) {
          decalGroup.add(mesh);
        } else {
          avatar.add(mesh);
        }
        
        this._playerFlatFish = mesh;
        this._playerFlatFishTex = tex;
        this._playerFlatFishCtx = cnv.getContext("2d");
        
        // Draw the flat fish sprite ONCE onto canvas to avoid texture uploads every frame!
        drawWigglingFish(this._playerFlatFishCtx, 0.0);
        this._playerFlatFishTex.needsUpdate = true;
        
        console.log("%c[Sanctuary] 🐟 Flat wiggling 2D fish attached and cached.", "color:#29b6f6;font-weight:bold;");
      }
    }

    // 3. Update the wiggling fish visibility and animation
    if (this._playerFlatFish) {
      this._playerFlatFish.visible = isFishingActive;
      if (isFishingActive) {
        const t = (typeof performance !== "undefined" ? performance.now() : 0) * 0.001;
        // Wiggle the 3D mesh directly using standard rotation and scale (highly performant!)
        this._playerFlatFish.rotation.z = Math.sin(t * 22) * 0.28;
        this._playerFlatFish.scale.setScalar(1.0 + Math.sin(t * 18) * 0.06);
      }
    }

    // Idle fish glyph bob
    if (this._spotFishSprite) {
      const spot = window.__sanctuaryFishingSpot;
      if (spot) {
        const t = (typeof performance !== "undefined" ? performance.now() : 0) * 0.001;
        this._spotFishSprite.position.y = (spot.y ?? 0) + 0.55 + Math.sin(t * 1.6) * 0.08;
        this._spotFishSprite.material.rotation = Math.sin(t * 1.1) * 0.20;
        this._spotFishSprite.visible = this._phase === PHASE.IDLE;
        if (this._spotDisc) this._spotDisc.visible = this._phase === PHASE.IDLE;
      }
    }

    // Auto-cast on step-on edge
    if (onDock !== this._wasShowing) {
      const justEntered = onDock && !this._wasShowing;
      this._wasShowing = onDock;
      if (this._btn) this._btn.style.display = "none";
      if (justEntered && this._phase === PHASE.IDLE) {
        this._tryAction();
      }
    }

    // ── Camera ──────────────────────────────────────────────────────────
    // Phase 1 (0–10 s): 15 ft above, 4 ft behind — tight on dock + pond.
    // Phase 2 (≥10 s): 3 s smooth blend to 22 ft / 1-tile panorama with
    // gentle orbit sway so the static fishing wait looks cinematic.
    if (this._camera && avatar) {
      const inFishing = this._phase !== PHASE.IDLE;
      if (inFishing) {
        this._fishingCamTimer = (this._fishingCamTimer ?? 0) + delta;

        // "Behind" = direction from pool centre to avatar (away from pool).
        const toAvX = avatar.position.x - SANCTUARY_POOL_CENTER_X;
        const toAvZ = avatar.position.z - SANCTUARY_POOL_CENTER_Z;
        const toAvLen = Math.hypot(toAvX, toAvZ) || 1;
        const bkX = toAvX / toAvLen;
        const bkZ = toAvZ / toAvLen;

        // Panorama blend: 0 at 10 s, 1 at 13 s
        const panoramaT = Math.max(0, Math.min(1, (this._fishingCamTimer - PANORAMA_ENTER_S) / 3.0));

        let rotBkX = bkX;
        let rotBkZ = bkZ;

        if (panoramaT > 0) {
          const t = this._fishingCamTimer - PANORAMA_ENTER_S;
          const angleOffset = Math.sin(t * 0.15) * 0.6; // gentle sway left & right
          const cosTh = Math.cos(angleOffset);
          const sinTh = Math.sin(angleOffset);
          rotBkX = bkX * cosTh - bkZ * sinTh;
          rotBkZ = bkX * sinTh + bkZ * cosTh;
        }

        // Lerp lift + back distance from close-up to panorama
        const finalCamLift = CAM_LIFT_M + (PANORAMA_LIFT_M - CAM_LIFT_M) * panoramaT;
        const finalCamBack = CAM_BACK_M + (PANORAMA_BACK_M - CAM_BACK_M) * panoramaT;

        // Look target: close = pool centre; panorama = midpoint avatar↔pool
        let lookTarget = this._poolCentre;
        if (panoramaT > 0) {
          const fishPos = (this._bobber?.visible && this._castTarget) ? this._castTarget : this._poolCentre;
          this._lookTarget.addVectors(avatar.position, fishPos).multiplyScalar(0.5);
          this._lookTarget.y += 0.6;
          this._lookTarget.lerp(this._poolCentre, 1 - panoramaT);
          lookTarget = this._lookTarget;
        }

        this._camTarget.set(
          avatar.position.x + rotBkX * finalCamBack,
          WATER_Y_M + finalCamLift,
          avatar.position.z + rotBkZ * finalCamBack,
        );
        const k = 1 - Math.exp(-CAM_LERP_RATE * delta);
        this._camera.position.lerp(this._camTarget, k);
        this._camera.lookAt(lookTarget);
      } else {
        this._fishingCamTimer = 0;
        this._camIsRepositioned = false;
      }
    }

    // ── Rod — face pool centre, pitch by distance ─────────────────
    if (avatar && this._rodGroup.visible) {
      const toPoolX = SANCTUARY_POOL_CENTER_X - avatar.position.x;
      const toPoolZ = SANCTUARY_POOL_CENTER_Z - avatar.position.z;
      const dist    = Math.hypot(toPoolX, toPoolZ) || 1;
      const rodYaw  = Math.atan2(toPoolX, toPoolZ);   // face pool
      // Pitch: ~45–65° forward lean, steeper when pool is close.
      const pitchAngle = Math.PI / 2 - Math.atan2(0.9, dist);
      this._rod.rotation.x = pitchAngle; // Positive leans forward towards the pool

      // Hand: 32 cm forward toward pool, 20 cm to the right.
      const fwdX = Math.sin(rodYaw);
      const fwdZ = Math.cos(rodYaw);
      const rgtX =  Math.cos(rodYaw);
      const rgtZ = -Math.sin(rodYaw);
      this._rodGroup.position.set(
        avatar.position.x + fwdX * 0.32 + rgtX * 0.20,
        avatar.position.y + 0.95,
        avatar.position.z + fwdZ * 0.32 + rgtZ * 0.20,
      );
      this._rodGroup.rotation.y = rodYaw;
    }

    // ── Phase tick ────────────────────────────────────────────────
    switch (this._phase) {

      case PHASE.IDLE:
        if (this._btn) this._btn.style.display = onDock ? "block" : "none";
        break;

      case PHASE.CASTING: {
        const t = Math.min(1, this._phaseT / CAST_FLIGHT_S);
        const x = this._castStart.x * (1 - t) + this._castTarget.x * t;
        const z = this._castStart.z * (1 - t) + this._castTarget.z * t;
        const baseY = this._castStart.y * (1 - t) + this._castTarget.y * t;
        this._bobberPos.set(x, baseY + 4.0 * t * (1 - t) * 1.8, z);
        this._bobber.position.copy(this._bobberPos);
        if (t >= 1) {
          playFishingTone('splash');
          this._setPhase(PHASE.WAITING);
        }
        break;
      }

      case PHASE.WAITING: {
        // Gentle surface bob at pool centre.
        this._bobberBob += delta;
        this._bobber.position.set(
          this._castTarget.x,
          WATER_Y_M + Math.sin(this._bobberBob * 3.0) * 0.012,
          this._castTarget.z,
        );

        this._waitingTimer = (this._waitingTimer || 0) + delta;

        // Turn-based bite / interested fish check
        this._interestCheckTimer = (this._interestCheckTimer || 0) + delta;
        if (this._interestCheckTimer >= 10.0) {
          this._interestCheckTimer = 0.0;
          
          if (typeof window !== "undefined" && !window.__interestedFish) {
            const school = window.__sanctuaryFishSchool || [];
            if (school.length > 0) {
              const index = Math.floor(Math.random() * school.length);
              window.__interestedFish = school[index];
              window.__interestedFish.userData.interestTimer = 0.0;
              window.__interestedFish.userData.isStruggling = false;
              console.log(`%c[SanctuaryFishing] Selected fish "${window.__interestedFish.name}" as interested!`, "color:#0288d1;font-weight:bold;");
            }
          }
        }

        // Check if interested fish bites
        if (typeof window !== "undefined" && window.__interestedFish) {
          const fishMesh = window.__interestedFish;
          fishMesh.userData.interestTimer = (fishMesh.userData.interestTimer || 0) + delta;

          const distToLure = fishMesh.position.distanceTo(this._bobber.position);

          // ── "Loses interest" decay (May-27 2026 user retune) ──────
          // Previous mechanic: 10%/sec chance after 3 s = fish bails in
          // ~10 s expected. Felt too random — the player felt punished
          // before the bite-ramp had a real chance to fire.
          //
          // New mechanic: fish are NEUTRAL by default (no loss-of-
          // interest tick) so the bite-chance ramp (line ~1842) can
          // play out without sabotage. Only AFTER 60 s of sustained
          // interest with no bite does a 50 %/min decay kick in — i.e.
          // ~0.83 %/sec — and that decay continues until either the
          // bite lands or the fish actually bails. That's 60× gentler
          // than before for the early window where most bites happen.
          const sustainedNoBiteS = 60.0;
          const loseIntPerSec = 0.5 / 60.0; // 50% per minute
          const farPastInterest = fishMesh.userData.interestTimer > sustainedNoBiteS;
          if (farPastInterest && Math.random() < loseIntPerSec * delta) {
            if (typeof window.__sanctuaryFishingSpawnRipple === 'function') {
              window.__sanctuaryFishingSpawnRipple(fishMesh.position.x, fishMesh.position.z);
            } else if (typeof window.sanctuaryPulse === 'function') {
              window.sanctuaryPulse(fishMesh.position.x, fishMesh.position.z);
            }
            showWoWCombatText("💨 lost interest", false);
            fishMesh.userData.interestTimer = 0;
            fishMesh.userData.isStruggling = false;
            window.__interestedFish = null;
            this._interestCheckTimer = 8.0; // re-pick soon (cooldown ~2s)
          } else {
            // Chance increases every second. Once close enough, takes the bait.
            // May-28 2026: increase fish chance by 2% per minute of waiting in WAITING phase
            const minutesWaiting = (this._waitingTimer || 0) / 60.0;
            const biteChancePerSec = 0.08 + (fishMesh.userData.interestTimer * 0.15) + (minutesWaiting * 0.02);
            if (distToLure < 0.35 && Math.random() < biteChancePerSec * delta) {
              playFishingTone('bite');
              this._setPhase(PHASE.BITE);
            }
          }
        }
        break;
      }

      case PHASE.BITE: {
        // Bobber dips and jitters — a fish is eating the hook.
        const dip = -0.12 - 0.06 * Math.abs(Math.sin(this._phaseT * 18));
        this._bobber.position.set(
          this._castTarget.x + (Math.random() - 0.5) * 0.04,
          WATER_Y_M + dip,
          this._castTarget.z + (Math.random() - 0.5) * 0.04,
        );
        
        // Automated relaxed fishing: auto-hook and transition to REELING after 1.2 seconds of wiggling!
        if (this._phaseT >= 1.2) {
          this._setPhase(PHASE.REELING);
          break;
        }

        if (this._phaseT >= BITE_WINDOW_S) {
          playFishingTone('fail');
          showWoWCombatText("It got away!", false);
          if (window.__interestedFish) {
            window.__interestedFish.userData.isStruggling = false;
            window.__interestedFish.userData.interestTimer = 0;
            window.__interestedFish = null;
          }
          this._endIdle(false);
        }
        break;
      }

      case PHASE.REELING: {
        this._fishStruggleTimer -= delta;
        if (this._fishStruggleTimer <= 0) {
          this._fishStruggleTimer = 1.0 + Math.random() * 0.8;
          this._fishDriftDir = Math.random() < 0.5 ? -1 : 1;
          this._fishDriftSpeed = 0.65 + Math.random() * 0.75;
        }

        this._struggleSoundTimer = (this._struggleSoundTimer || 0) + delta;
        if (this._struggleSoundTimer >= 0.25) {
          this._struggleSoundTimer = 0.0;
          playFishingTone('struggle');
        }
        
        // Needle drifts gently and naturally for visual fun
        this._miniGameNeedle = 0.5 + Math.sin(this._phaseT * 2.5) * 0.22;
        this._miniGameNeedle = Math.max(0.02, Math.min(0.98, this._miniGameNeedle));

        // Auto-reels smoothly over 5 seconds (struggle part 1)
        this._reelProgress += delta * 0.2;
        this._reelProgress = Math.max(0, Math.min(1, this._reelProgress));

        // Gentle jitter on bobber
        this._bobber.position.set(
          this._castTarget.x + (Math.random() - 0.5) * 0.04,
          WATER_Y_M - 0.08 + Math.sin(this._phaseT * 12) * 0.03,
          this._castTarget.z + (Math.random() - 0.5) * 0.04
        );

        if (this._reelProgress >= 1.0) {
          // Hooked! Attach a shiny 3D fish to the hook group
          if (this._caughtFish3D && this._hookGroup) {
            this._hookGroup.remove(this._caughtFish3D);
          }
          this._caughtFish3D = this._createFishMesh(0x29b6f6); // blue wiggling fish on hook
          this._caughtFish3D.scale.setScalar(0.72);
          this._caughtFish3D.position.set(0, -BOBBER_RADIUS_M - 0.09, 0);
          this._caughtFish3D.rotation.x = Math.PI / 2; // hang vertically
          this._hookGroup.add(this._caughtFish3D);

          this._setPhase(PHASE.LANDING);
        }
        break;
      }

      case PHASE.LANDING: {
        this._fishStruggleTimer -= delta;
        if (this._fishStruggleTimer <= 0) {
          this._fishStruggleTimer = 0.5 + Math.random() * 0.6;
          this._fishDriftDir = Math.random() < 0.5 ? -1 : 1;
          this._fishDriftSpeed = 1.0 + Math.random() * 1.5;
        }

        this._struggleSoundTimer = (this._struggleSoundTimer || 0) + delta;
        if (this._struggleSoundTimer >= 0.25) {
          this._struggleSoundTimer = 0.0;
          playFishingTone('struggle');
        }

        // Gentle needle drift
        this._miniGameNeedle = 0.5 + Math.sin(this._phaseT * 3.5) * 0.28;
        this._miniGameNeedle = Math.max(0.02, Math.min(0.98, this._miniGameNeedle));

        // Auto-lands smoothly over 5 seconds (struggle part 2)
        this._landingProgress += delta * 0.2;
        this._landingProgress = Math.max(0, Math.min(1.0, this._landingProgress));
        this._dropDanger = 0.0; // Locked at zero to prevent frustrating failures

        // Position the bobber: ascending out of the water towards the rod tip!
        if (!this._rodTipHelperRef && this._rod) {
          this._rodTipHelperRef = this._rod.getObjectByName("rod_tip_helper");
        }
        const tipObj = this._rodTipHelperRef;
        if (tipObj) {
          tipObj.getWorldPosition(this._tipWorld);
        } else {
          this._tipWorld.copy(this._rodGroup.position);
        }
        // Reuse _poolCentre as the start position (same coords — no allocation)
        this._bobber.position.lerpVectors(this._poolCentre, this._tipWorld, this._landingProgress);

        // Add struggling jitter to the bobber
        const amp = 0.04;
        this._bobber.position.x += (Math.random() - 0.5) * amp;
        this._bobber.position.y += (Math.random() - 0.5) * amp;
        this._bobber.position.z += (Math.random() - 0.5) * amp;

        // Wasp wiggle rotation on the 3D caught fish
        if (this._caughtFish3D) {
          this._caughtFish3D.rotation.z = Math.sin(this._phaseT * 32) * 0.35;
          this._caughtFish3D.rotation.y = Math.cos(this._phaseT * 18) * 0.2;
        }

        if (this._landingProgress >= 1.0) {
          // User-requested 2026-05-28: "auto land the fish for players".
          // Removed the 15% escape roll at landing — kid players were
          // losing fish after a 12-second auto-reel, which reads as
          // unfair punishment rather than skill. Landing is now
          // guaranteed once the auto-progress completes; the only
          // failure path remains BITE_WINDOW timeout (still in BITE).
          {
            // Success! Attach fish to avatar side and grant reward!
            playFishingTone('success');
            showWoWCombatText("You caught a fish!", true);
            
            // Trigger 3D flying wiggling fish animation from water to avatar's leg
            if (avatar && this._scene) {
              const startPos = this._bobber.position.clone();
              const flyFish = this._createFishMesh(0x29b6f6);
              flyFish.name = "flying_wiggle_fish";
              flyFish.position.copy(startPos);
              this._scene.add(flyFish);
              
              this._flyingFish = flyFish;
              this._flyingFishStartPos = startPos;
              this._flyingFishTime = 0.0;
              this._flyingFishDuration = 1.2;
            } else {
              this._attachFishToAvatarSide();
            }
            
            // Caught fish: remove from pool, spawn tiny baby replacement
            if (window.__interestedFish) {
              const caughtPoolFish = window.__interestedFish;
              // Remove from the school array (shared ref with SanctuaryFishModule._fishMeshes)
              if (Array.isArray(window.__sanctuaryFishSchool)) {
                const idx = window.__sanctuaryFishSchool.indexOf(caughtPoolFish);
                if (idx !== -1) window.__sanctuaryFishSchool.splice(idx, 1);
                window.__sanctuaryFishCount = window.__sanctuaryFishSchool.length;
              }
              // Hide mesh — leave in scene graph until next pool reset
              caughtPoolFish.visible = false;
              caughtPoolFish.userData.isStruggling = false;
              caughtPoolFish.userData.interestTimer = 0;
              caughtPoolFish.userData._interestPhase = null;
              window.__interestedFish = null;

              // Spawn a tiny baby fish near the pool centre
              if (typeof window.__sanctuarySpawnBabyFish === "function") {
                const offX = (Math.random() - 0.5) * 1.0;
                const offZ = (Math.random() - 0.5) * 1.0;
                window.__sanctuarySpawnBabyFish(
                  SANCTUARY_POOL_CENTER_X + offX,
                  SANCTUARY_POOL_CENTER_Z + offZ,
                );
              }
            }
            
            try { window.sanctuaryGrant?.("fish", 1); } catch (_) {}
            
            // Remove from hook as it's now glued to avatar
            if (this._caughtFish3D && this._hookGroup) {
              this._hookGroup.remove(this._caughtFish3D);
            }
            this._caughtFish3D = null;

            this._setPhase(PHASE.REWARD);
          }
        }
        break;
      }

      case PHASE.REWARD: {
        const t = Math.min(1.0, this._phaseT / 0.85); // 0.85s fast return flight!
        const x = this._castTarget.x * (1 - t) + this._castStart.x * t;
        const z = this._castTarget.z * (1 - t) + this._castStart.z * t;
        const baseY = WATER_Y_M * (1 - t) + (this._castStart.y - 0.4) * t;
        this._bobber.position.set(x, baseY + 3.2 * t * (1 - t) * 1.2, z);
        if (this._phaseT >= REWARD_HOLD_S) {
          this._endIdle(true);
        }
        break;
      }
    }

    // ── Ripples (WAITING + BITE only) ─────────────────────────────
    const isLureOnWater = this._phase === PHASE.WAITING || this._phase === PHASE.BITE;
    if (isLureOnWater) {
      this._nextRippleT -= delta;
      if (this._nextRippleT <= 0) {
        this._spawnRipple();
        this._nextRippleT = RIPPLE_SPAWN_MIN_S + Math.random() * (RIPPLE_SPAWN_MAX_S - RIPPLE_SPAWN_MIN_S);
      }
    }
    for (const r of this._ripples) {
      if (r.age < 0) continue;
      r.age += delta;
      const t = r.age / RIPPLE_LIFE_S;         // 0 → 1
      r.mesh.scale.setScalar(0.15 + t * 6.5);  // expand outward
      r.mesh.material.opacity = 0.65 * (1 - t * t);
      if (r.age >= RIPPLE_LIFE_S) {
        r.age = -1;
        r.mesh.visible = false;
      }
    }

    // ── Fishing line: rod tip → bobber ────────────────────────────
    if (this._rodGroup.visible) {
      // Reuse preallocated _tipWorld scratch — no allocation per frame
      if (!this._rodTipHelperRef && this._rod) {
        this._rodTipHelperRef = this._rod.getObjectByName("rod_tip_helper");
      }
      const tipObj = this._rodTipHelperRef;
      if (tipObj) {
        tipObj.getWorldPosition(this._tipWorld);
      } else {
        // Fallback
        this._tipWorld.copy(this._rodGroup.position);
      }
      const tipWorld = this._tipWorld;
      const bp   = this._bobber.position;
      const arr  = this._lineGeo.attributes.position.array;
      arr[0] = tipWorld.x; arr[1] = tipWorld.y; arr[2] = tipWorld.z;
      arr[3] = bp.x; arr[4] = bp.y; arr[5] = bp.z;
      this._lineGeo.attributes.position.needsUpdate = true;
      this._line.visible = this._phase !== PHASE.IDLE;
    } else {
      this._line.visible = false;
    }

    // ── Update 3-D Interest Gauge ─────────────────────────────────
    if (this._gauge3d) {
      if (this._phase !== PHASE.IDLE) {
        let frac = 0.0;
        let label = "WAITING...";

        if (this._phase === PHASE.CASTING) {
          frac = Math.min(1.0, this._phaseT / 1.0);
          label = "CASTING...";
        } else if (this._phase === PHASE.WAITING) {
          if (typeof window !== "undefined" && window.__interestedFish && this._bobber) {
            const d = window.__interestedFish.position.distanceTo(this._bobber.position);
            const tNorm = Math.max(0, Math.min(1, (4.0 - d) / 3.8));
            frac = tNorm;
            label = tNorm > 0.66 ? "INTERESTED!" : tNorm > 0.33 ? "CURIOUS..." : "no bite...";
          } else {
            frac = 0.05;
            label = "no bite...";
          }
        } else if (this._phase === PHASE.BITE) {
          frac = 0.4 + 0.3 * Math.abs(Math.sin(this._phaseT * 12)) + 0.1 * Math.random();
          label = "BITE! CLICK!";
        } else if (this._phase === PHASE.REELING) {
          frac = this._miniGameNeedle;
          label = `KEEP IN GREEN! (${Math.floor(this._reelProgress * 100)}%)`;
        } else if (this._phase === PHASE.LANDING) {
          frac = this._miniGameNeedle;
          label = `TAP TO LAND! (${Math.floor(this._landingProgress * 100)}%)`;
        } else if (this._phase === PHASE.REWARD) {
          frac = 1.0;
          label = "CAUGHT!";
        }

        const isReeling = (this._phase === PHASE.REELING || this._phase === PHASE.BITE || this._phase === PHASE.LANDING);
        const t = (typeof performance !== "undefined" ? performance.now() : 0) * 0.001;

        const bp = this._bobber?.visible ? this._bobber.position : this._castTarget;
        this._gauge3d.position.set(bp.x, WATER_Y_M, bp.z);
        this._gauge3d.visible = true;

        // Gauge canvas throttle — canvas redraws (gradients + GPU uploads) are
        // expensive. Only redraw at ~10 fps (100 ms) or when the label changes.
        // On skipped frames: rotate the needle + face camera (cheap math only).
        this._gaugeDrawT += delta;
        if (this._gaugeDrawT >= 0.10 || label !== this._gaugePrevLabel) {
          this._gaugeDrawT = 0;
          this._gaugePrevLabel = label;
          _update3DGauge(this._gauge3d, frac, label, isReeling, t, this._camera);
        } else {
          const ud = this._gauge3d.userData;
          if (ud.needleGroup) {
            ud.needleGroup.rotation.z = Math.PI - frac * Math.PI;
          }
          if (this._camera) {
            const dx = this._camera.position.x - this._gauge3d.position.x;
            const dz = this._camera.position.z - this._gauge3d.position.z;
            this._gauge3d.rotation.y = Math.atan2(dx, dz);
            // Compensate billboard so colored arc stays at TOP of PIP
            // (see _update3DGauge for the math). Without this, the
            // lite-update path leaves rotation.z stale and the arc
            // walks around the PIP as the player moves.
            // Matches the formula in _update3DGauge — arc lands at world +X
            // which is TOP of the spun PIP frame (up=(1,0,0)).
            this._gauge3d.rotation.z = -this._gauge3d.rotation.y - Math.PI / 2;
          }
        }
      } else {
        this._gauge3d.visible = false;
      }
    }
  },

  _endIdle(caught) {
    for (const r of this._ripples) { r.age = -1; r.mesh.visible = false; }
    this._bobber.visible   = false;
    this._rodGroup.visible = false;
    this._line.visible     = false;
    // Restore dock visibility now that fishing camera is gone.
    if (typeof window !== "undefined" && window.__sanctuaryDockRoot) {
      window.__sanctuaryDockRoot.visible = true;
    }
    if (typeof window !== "undefined") {
      window._v2InputSuppressed = false;
      window.__sanctuaryFishingActive = false;
      if (typeof document !== "undefined") {
        document.body.classList.remove("v4-fishing-active");
      }
      if (typeof window._v4CancelClickToMove === "function") {
        window._v4CancelClickToMove();
      }
      if (window.__sanctuaryKeyboardLook) {
        window.__sanctuaryKeyboardLook.snapToCamera(this._camera);
      }
    }
    this._setPhase(PHASE.IDLE);
    if (!caught && this._statusPill) {
      this._statusPill.textContent  = "got away…";
      this._statusPill.style.display = "block";
      setTimeout(() => {
        if (this._phase === PHASE.IDLE && this._statusPill) this._statusPill.style.display = "none";
      }, 900);
    }
  },

  _createFishMesh(color = 0x29b6f6) {
    const fish = new THREE.Group();
    fish.name = "caught_fish_3d_mesh";
    
    // Fish body: sleek cylinder/cone
    const bodyGeo = new THREE.ConeGeometry(0.06, 0.22, 8);
    bodyGeo.rotateX(Math.PI / 2);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.15,
      metalness: 0.85,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    fish.add(body);
    
    // Big cute eyes
    const eyeGeo = new THREE.SphereGeometry(0.018, 8, 8);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(0.035, 0.03, 0.06);
    const leftPupil = new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 6), pupilMat);
    leftPupil.position.set(0.007, 0, 0.01);
    leftEye.add(leftPupil);
    
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(-0.035, 0.03, 0.06);
    const rightPupil = new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 6), pupilMat);
    rightPupil.position.set(-0.007, 0, 0.01);
    rightEye.add(rightPupil);
    
    fish.add(leftEye, rightEye);
    
    // Cute tail fin
    const tailGeo = new THREE.BoxGeometry(0.008, 0.08, 0.05);
    const tail = new THREE.Mesh(tailGeo, bodyMat);
    tail.position.set(0, 0, -0.12);
    fish.add(tail);

    return fish;
  },

  _attachFishToAvatarSide() {
    const avatar = window.__sanctuaryAvatar;
    if (!avatar) return;

    this._caughtFishCount = (this._caughtFishCount || 0) + 1;
    if (this._caughtFishCount > 6) {
      // Reset and clear all existing fish to start fresh
      this._caughtFishCount = 1;
      for (let i = 1; i <= 6; i++) {
        const old = avatar.getObjectByName(`glued_fish_${i}`);
        if (old) {
          avatar.remove(old);
          old.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
              if (Array.isArray(child.material)) child.material.forEach((m) => m?.dispose?.());
              else child.material?.dispose?.();
            }
          });
        }
      }
    }

    const idx = this._caughtFishCount;
    const isRight = (idx % 2 !== 0);
    const slotIdx = Math.floor((idx - 1) / 2); // 0, 1, or 2

    const holderGroup = new THREE.Group();
    holderGroup.name = `glued_fish_${idx}`;

    // Short wooden pin mesh:
    const stickGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.20, 8);
    const stickMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 });
    const stick = new THREE.Mesh(stickGeo, stickMat);
    stick.position.set(0, 0.05, 0);
    holderGroup.add(stick);

    // The caught 3D fish (blue trout color matching the gauge theme)
    const fish = this._createFishMesh(0x29b6f6);
    fish.name = "wiggling_attached_fish";
    // Point fish vertically face-down (nose pointing to the ground)
    fish.rotation.set(Math.PI / 2, 0, 0);
    fish.position.set(0, -0.05, 0.0); // hang from the stick
    fish.scale.setScalar(0.95);
    holderGroup.add(fish);

    // Position on the legs vertically stacked (3 per side)
    const sideSign = isRight ? 1 : -1;
    const x = 0.24 * sideSign;
    const y = 0.36 - slotIdx * 0.14; // stack down by 14 cm per slot
    const z = -0.05 + slotIdx * 0.03; // stagger slightly back to front

    holderGroup.position.set(x, y, z);
    holderGroup.rotation.set(0, 0, 0); // strictly vertical!
    avatar.add(holderGroup);

    window.__sanctuaryHasFishCaught = true;
  },

  unload(scene) {
    // Restore any culled objects before tearing down
    this._exitFishingZone();

    if (typeof window !== "undefined") {
      delete window.__sanctuaryFishingSpawnRipple;
      delete window._v4StartFishing;
    }
    if (this._playerFlatFish) {
      const parent = this._playerFlatFish.parent;
      if (parent) parent.remove(this._playerFlatFish);
      this._playerFlatFish.geometry?.dispose();
      this._playerFlatFish.material?.dispose();
      this._playerFlatFishTex?.dispose();
      this._playerFlatFish = null;
      this._playerFlatFishTex = null;
      this._playerFlatFishCtx = null;
    }
    if (this._rodGroup) scene.remove(this._rodGroup);
    if (this._line)     scene.remove(this._line);
    if (this._bobber)   scene.remove(this._bobber);
    for (const r of this._ripples) {
      scene.remove(r.mesh);
      r.mesh.geometry?.dispose();
      r.mesh.material?.dispose();
    }
    this._ripples = [];
    if (this._btn?.parentElement) this._btn.parentElement.removeChild(this._btn);
    if (this._statusPill?.parentElement) this._statusPill.parentElement.removeChild(this._statusPill);
    if (this._gauge3d) {
      this._scene?.remove(this._gauge3d);
      this._gauge3d = null;
    }
    this._travelCircleRef = null;
    this._circleOutlineRef = null;
    this._travelDecalGroupRef = null;
    this._attachedFishRef = null;
    this._gluedFishRef = null;
    this._rodTipHelperRef = null;
    if (this._onKey) window.removeEventListener("keydown", this._onKey, true);
    if (this._onWindowClick) {
      window.removeEventListener("mousedown", this._onWindowClick, true);
      window.removeEventListener("touchstart", this._onWindowClick, { passive: false, capture: true });
    }
    this._onWindowClick = null;
    this._rodGroup = this._rod = this._line = this._lineGeo = this._bobber = this._hookGroup = null;
    this._btn = this._statusPill = null;
    this._onClick = this._onKey = null;
    this._poolCentre = null;
    this._scene = null;
  },
};
