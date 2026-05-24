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
// 15 ft above water, 4 ft behind avatar. Look target blends 22% toward
// avatar so the camera sees fish approaching the hook, not just the pool.
const CAM_LIFT_M    = 4.572;   // 15 ft (+5 ft from v1)
const CAM_BACK_M    = 1.219;   // 4 ft behind avatar
const CAM_LERP_RATE = 6.0;
const CAM_LOOK_BIAS = 0.22;    // fraction toward avatar from pool centre

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

// ── Stress gauge (chunky, colorful plastic toy dashboard casing) ───────
function _buildGauge() {
  const wrap = document.createElement("div");
  wrap.id = "v4-stress-gauge";
  Object.assign(wrap.style, {
    position: "fixed", left: "50%", top: "38%",
    transform: "translate(-50%, -50%)",
    zIndex: "9600", display: "none", pointerEvents: "none", userSelect: "none",
    background: "linear-gradient(135deg, #ffd166, #ff9f1c)", // vibrant retro toy yellow/orange plastic
    borderRadius: "125px 125px 32px 32px",
    border: "8px solid #ff4d6d", // thick red/pink chunky plastic toy border
    boxShadow: "0 22px 50px rgba(0, 0, 0, 0.7), inset 0 4px 0 rgba(255,255,255,0.45), inset 0 -4px 0 rgba(0,0,0,0.18)", // glossy 3D plastic finish
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

function drawGaugeFish(ctx, cx, cy, time, frac, isReeling) {
  ctx.save();
  // Place the fish in the center of the inner void
  ctx.translate(cx, cy - 36);
  
  // Twist/rotate the fish based on the needle position (frac) + active struggle wiggles!
  const targetAngle = (frac - 0.5) * 1.5; // up to ~45 degrees left or right
  const wiggle = Math.sin(time * 24) * (isReeling ? 0.35 : 0.12);
  const totalAngle = targetAngle + wiggle;
  ctx.rotate(totalAngle);
 
  // Dynamic scale pulse on struggle
  const scale = 1.0 + (isReeling ? Math.abs(Math.sin(time * 12)) * 0.08 : 0);
  ctx.scale(scale, scale);
 
  // Draw tail fin (matching blue/yellow trout)
  const tailGrd = ctx.createLinearGradient(-35, 0, -20, 0);
  tailGrd.addColorStop(0, "#fbbf24"); // bright gold tail tips
  tailGrd.addColorStop(1, "#1e88e5"); // royal blue base
  ctx.fillStyle = tailGrd;
  ctx.beginPath();
  ctx.moveTo(-15, 0);
  const tailWiggle = Math.sin(time * 30) * 16;
  ctx.quadraticCurveTo(-28, -6 + tailWiggle * 0.5, -42, -18 + tailWiggle);
  ctx.lineTo(-34, tailWiggle);
  ctx.lineTo(-42, 18 + tailWiggle);
  ctx.quadraticCurveTo(-28, 6 + tailWiggle * 0.5, -15, 0);
  ctx.closePath();
  ctx.fill();
 
  // Draw dorsal fin
  ctx.fillStyle = "#1565c0"; // deep royal blue
  ctx.beginPath();
  ctx.moveTo(-10, -8);
  ctx.quadraticCurveTo(-4, -22, 10, -6);
  ctx.closePath();
  ctx.fill();
 
  // Draw main fish body with gorgeous blue and gold plastic gradient
  const bodyGrd = ctx.createRadialGradient(8, -4, 4, 0, 0, 32);
  bodyGrd.addColorStop(0, "#ffffff"); // glistening white highlight
  bodyGrd.addColorStop(0.3, "#29b6f6"); // bright sky blue skin
  bodyGrd.addColorStop(0.7, "#1e88e5"); // royal blue scales
  bodyGrd.addColorStop(1.0, "#0d47a1"); // deep dark blue shadows
  ctx.fillStyle = bodyGrd;
 
  // Gold metallic border/accent
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 1.8;
 
  ctx.beginPath();
  // Head at (+26, 0), tail attachment at (-18, 0)
  ctx.moveTo(-18, 0);
  ctx.bezierCurveTo(-14, -14, 12, -18, 28, -2); // top half
  ctx.bezierCurveTo(34, 0, 34, 2, 28, 4); // mouth / snout
  ctx.bezierCurveTo(12, 18, -14, 14, -18, 0); // bottom half
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
 
  // Draw gills and pectoral fin
  ctx.strokeStyle = "rgba(251, 191, 36, 0.6)";
  ctx.beginPath();
  ctx.arc(8, 0, 8, -Math.PI / 3, Math.PI / 3, false);
  ctx.stroke();
 
  // Pectoral fin flapping
  ctx.fillStyle = "#fb923c"; // golden orange
  ctx.save();
  ctx.translate(2, 4);
  ctx.rotate(Math.sin(time * 35) * 0.6);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(12, 6, 8, 14);
  ctx.quadraticCurveTo(2, 12, 0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
 
  // Draw expressive eye (big and cute for kids to watch)
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(18, -5, 5, 0, Math.PI * 2);
  ctx.fill();
 
  // Dilated pupil reacting to struggle
  ctx.fillStyle = "#1e1b4b";
  ctx.beginPath();
  const pupilR = 2.5 + (isReeling ? Math.sin(time * 15) * 0.8 : 0);
  ctx.arc(19, -5, pupilR, 0, Math.PI * 2);
  ctx.fill();
 
  // Shiny spark in eye
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(20.5, -6.5, 1.2, 0, Math.PI * 2);
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

  // Outer void bezel (pip-bezel-dark) with premium gradient ring
  ctx.beginPath();
  ctx.arc(cx, cy, OR + 10, Math.PI, 0, false);
  ctx.lineTo(cx + OR + 10, cy); ctx.lineTo(cx - OR - 10, cy);
  ctx.closePath();
  ctx.fillStyle = "rgba(10, 22, 38, 0.75)";
  ctx.fill();

  // Premium PIP glowing blue glass rim highlight
  ctx.beginPath();
  ctx.arc(cx, cy, OR + 7, Math.PI, 0, false);
  const rimGrd = ctx.createLinearGradient(cx - OR, cy, cx + OR, cy);
  rimGrd.addColorStop(0,   "rgba(3, 105, 161, 0.45)"); // Deep Ocean Blue
  rimGrd.addColorStop(0.5, "rgba(14, 165, 233, 0.95)"); // Glowing Sky Blue
  rimGrd.addColorStop(1,   "rgba(3, 105, 161, 0.45)"); // Deep Ocean Blue
  ctx.strokeStyle = rimGrd;
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Inner bezel ring
  ctx.beginPath();
  ctx.arc(cx, cy, OR + 3, Math.PI, 0, false);
  ctx.strokeStyle = "rgba(14, 165, 233, 0.3)";
  ctx.lineWidth = 6;
  ctx.stroke();

  // Track (dark arc background)
  ctx.beginPath();
  ctx.arc(cx, cy, arcR, Math.PI, 0, false);
  ctx.lineWidth = arcW - 2;
  ctx.strokeStyle = "rgba(9, 18, 30, 0.85)";
  ctx.lineCap = "butt";
  ctx.stroke();

  // Draw arcade-style Red, Yellow, and Green zones on the track!
  const segments = [
    { start: Math.PI, end: Math.PI - 0.22 * Math.PI, color: "#ef4444" },
    { start: Math.PI - 0.22 * Math.PI, end: Math.PI - 0.4 * Math.PI, color: "#eab308" },
    { start: Math.PI - 0.4 * Math.PI, end: Math.PI - 0.6 * Math.PI, color: "#22c55e" },
    { start: Math.PI - 0.6 * Math.PI, end: Math.PI - 0.78 * Math.PI, color: "#eab308" },
    { start: Math.PI - 0.78 * Math.PI, end: 0, color: "#ef4444" }
  ];

  for (const seg of segments) {
    ctx.beginPath();
    ctx.arc(cx, cy, arcR, seg.start, seg.end, true); // draw clockwise (decreasing angle on top half)
    ctx.lineWidth = arcW - 4;
    ctx.strokeStyle = seg.color;
    ctx.lineCap = "butt";
    ctx.stroke();
  }

  // Inner void glass background
  ctx.beginPath();
  ctx.arc(cx, cy, IR - 3, Math.PI, 0, false);
  ctx.lineTo(cx + IR - 3, cy); ctx.lineTo(cx - IR + 3, cy);
  ctx.closePath();
  ctx.fillStyle = "rgba(8, 18, 32, 0.95)";
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
  glareGrd.addColorStop(0,   "rgba(255, 255, 255, 0.22)"); // glistening glass reflection
  glareGrd.addColorStop(0.3, "rgba(255, 255, 255, 0.06)");
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
  ctx.lineWidth = 3.0;
  ctx.strokeStyle = "#e0f2fe"; // bright sky-white
  ctx.lineCap = "round";
  ctx.stroke();

  // Blue glass pivot
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fillStyle = "#0ea5e9";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#0369a1";
  ctx.fill();

  // Label with Outfit typography
  ctx.font = "bold 11px Outfit,ui-monospace,Menlo,monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = "#e0f2fe";
  ctx.letterSpacing = "0.12em";
  ctx.fillText(labelText.toUpperCase(), cx, cy - 10);
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

function drawWigglingFish(ctx, time) {
  ctx.clearRect(0, 0, 128, 128);
  
  // Wiggle angle - sweeps between -0.38 and +0.38 rad at a happy, fast frequency
  const wiggle = Math.sin(time * 22) * 0.38;
  
  ctx.save();
  ctx.translate(64, 64);
  ctx.rotate(-Math.PI / 4); // base orientation to align with decal direction
  
  // Draw tail first (so it renders behind the body)
  ctx.fillStyle = "#1e88e5"; // cute bright blue fish tail
  ctx.beginPath();
  ctx.moveTo(-16, 0); // tail base relative to body center
  
  // Tail sweeps back and forth
  const tailX = -36 + Math.cos(wiggle) * -4;
  const tailY = Math.sin(wiggle) * 14;
  ctx.lineTo(tailX, tailY - 12);
  ctx.lineTo(tailX, tailY + 12);
  ctx.closePath();
  ctx.fill();
  
  // Draw body
  ctx.fillStyle = "#42a5f5"; // gorgeous primary blue body
  ctx.beginPath();
  ctx.ellipse(0, 0, 24, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Draw belly highlight
  ctx.fillStyle = "#bbdefb";
  ctx.beginPath();
  ctx.ellipse(2, 4, 16, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Draw eye
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(12, -4, 4, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.fillStyle = "#0d47a1";
  ctx.beginPath();
  ctx.arc(13, -4, 2, 0, Math.PI * 2);
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

  // Stress gauge
  _gaugeWrap:  null,
  _gaugeCtx:   null,

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

  // Cached pool-centre vector (created once in load)
  _poolCentre: null,

  async load(scene, camera) {
    this._scene   = scene;
    this._camera  = camera;
    this._fishingCamTimer = 0;
    this._poolCentre = new THREE.Vector3(SANCTUARY_POOL_CENTER_X, WATER_Y_M, SANCTUARY_POOL_CENTER_Z);

    if (typeof window !== "undefined") {
      window.__sanctuaryFishingSpawnRipple = (x, z) => this._spawnRipple(x, z);
    }

    // ── Spot disc + fish glyph ────────────────────────────────────
    const spot = (typeof window !== "undefined") ? window.__sanctuaryFishingSpot : null;
    if (spot) {
      const discMat = new THREE.MeshBasicMaterial({
        color: 0x68d4ff, transparent: true, opacity: 0.45,
        depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(SPOT_DISC_RADIUS_M, 56), discMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(spot.x, (spot.y ?? 0) + 0.03, spot.z);
      disc.renderOrder = 9970;
      disc.name = "sanctuary_fishing_spot_disc";
      disc.userData.anuKind = "sanctuary_fishing_spot_disc";
      disc.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.PLAYER;
      scene.add(disc);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(SPOT_DISC_RADIUS_M * 0.92, SPOT_DISC_RADIUS_M, 64),
        new THREE.MeshBasicMaterial({
          color: 0xfbe28a, transparent: true, opacity: 0.95,
          depthTest: false, depthWrite: false, side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(spot.x, (spot.y ?? 0) + 0.04, spot.z);
      ring.renderOrder = 9971;
      scene.add(ring);

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
    
    const { wrap, ctx, canvas } = _buildGauge();
    this._gaugeWrap = wrap;
    this._gaugeCtx = ctx;
    this._gaugeCanvas = canvas;

    this._onClick = () => this._tryAction();
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

    console.log(
      "%c[Sanctuary] 🎣 Fishing v2 — pool-centre cast · J-hook · ripples · turn-based bites.",
      "color:#80deea;font-weight:bold;",
    );
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

    // Reset turn counters each time we enter WAITING.
    if (p === PHASE.WAITING) {
      this._turnCount   = 0;
      this._turnElapsed = 0;
      this._surgeEvery  = 1 + Math.floor(Math.random() * 3);  // 1, 2, or 3
      this._interestCheckTimer = 10.0; // Force immediate check on entry
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

    if (this._bobber) {
      window.__sanctuaryBobberPos = this._bobber.position;
    } else {
      window.__sanctuaryBobberPos = null;
    }

    const avatar = (typeof window !== "undefined") ? window.__sanctuaryAvatar : null;
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
        
        // Target colors: blue when actively fishing, normal green otherwise
        const targetInner = isFishingActive ? new THREE.Color(0x06182c) : new THREE.Color(0x0d260d);
        const targetMid   = isFishingActive ? new THREE.Color(0x1565c0) : new THREE.Color(0x2e7d32);
        const targetRim   = isFishingActive ? new THREE.Color(0x64b5f6) : new THREE.Color(0x7cb342);

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
        const uni = ringMesh.material.uniforms;

        const targetInner = isFishingActive ? new THREE.Color(0xb3e5fc) : new THREE.Color(0xffffff);
        const targetOuter = isFishingActive ? new THREE.Color(0x0288d1) : new THREE.Color(0xffffff);

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

    // ── Camera ────────────────────────────────────────────────────
    // 10 ft above water, 4 ft behind avatar, locked on pool centre.
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

        let rotBkX = bkX;
        let rotBkZ = bkZ;
        let finalCamLift = CAM_LIFT_M;
        let finalCamBack = CAM_BACK_M;
        let lookTarget = this._poolCentre;

        if (this._fishingCamTimer >= 10.0) {
          const t = this._fishingCamTimer - 10.0;
          const angleOffset = Math.sin(t * 0.15) * 0.6; // gentle sway left & right
          const heightOffset = Math.sin(t * 0.22) * 0.8; // gentle height change
          const distanceOffset = Math.cos(t * 0.1) * 1.0; // gentle distance change

          const cosTh = Math.cos(angleOffset);
          const sinTh = Math.sin(angleOffset);
          rotBkX = bkX * cosTh - bkZ * sinTh;
          rotBkZ = bkX * sinTh + bkZ * cosTh;

          finalCamLift += heightOffset;
          finalCamBack += distanceOffset;

          // Midpoint gaze target between avatar and the cast target in water (static, no bobber wiggle shake)
          const playerPos = avatar.position;
          const fishPos = (this._bobber && this._bobber.visible && this._castTarget) ? this._castTarget : this._poolCentre;
          lookTarget = new THREE.Vector3().addVectors(playerPos, fishPos).multiplyScalar(0.5);
          lookTarget.y += 0.6; // lift to frame action
        }

        const camTarget = new THREE.Vector3(
          avatar.position.x + rotBkX * finalCamBack,
          WATER_Y_M + finalCamLift,
          avatar.position.z + rotBkZ * finalCamBack,
        );
        const k = 1 - Math.exp(-CAM_LERP_RATE * delta);
        this._camera.position.lerp(camTarget, k);
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
          
          // Chance increases every second. Once close enough, it takes the bait!
          const biteChancePerSec = 0.08 + (fishMesh.userData.interestTimer * 0.15);
          if (distToLure < 0.35 && Math.random() < biteChancePerSec * delta) {
            playFishingTone('bite');
            this._setPhase(PHASE.BITE);
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
        const tipWorld = new THREE.Vector3();
        if (!this._rodTipHelperRef && this._rod) {
          this._rodTipHelperRef = this._rod.getObjectByName("rod_tip_helper");
        }
        const tipObj = this._rodTipHelperRef;
        if (tipObj) {
          tipObj.getWorldPosition(tipWorld);
        } else {
          tipWorld.copy(this._rodGroup.position);
        }
        const startPos = new THREE.Vector3(SANCTUARY_POOL_CENTER_X, WATER_Y_M, SANCTUARY_POOL_CENTER_Z);
        this._bobber.position.lerpVectors(startPos, tipWorld, this._landingProgress);

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
          // 15% escape roll
          if (Math.random() < 0.15) {
            playFishingTone('fail');
            showWoWCombatText("It got away!", false);
            if (window.__interestedFish) {
              window.__interestedFish.userData.isStruggling = false;
              window.__interestedFish.userData.interestTimer = 0;
              window.__interestedFish = null;
            }
            this._endIdle(false);
          } else {
            // Success! Attach fish to avatar side and grant reward!
            playFishingTone('success');
            showWoWCombatText("You caught a fish!", true);
            this._attachFishToAvatarSide();
            
            // Caught fish resets as 10% tiny baby
            if (window.__interestedFish) {
              window.__interestedFish.userData.growthScale = 0.1;
              window.__interestedFish.userData.isStruggling = false;
              window.__interestedFish.userData.interestTimer = 0;
              window.__interestedFish = null;
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
      const tipWorld = new THREE.Vector3();
      if (!this._rodTipHelperRef && this._rod) {
        this._rodTipHelperRef = this._rod.getObjectByName("rod_tip_helper");
      }
      const tipObj = this._rodTipHelperRef;
      if (tipObj) {
        tipObj.getWorldPosition(tipWorld);
      } else {
        // Fallback
        tipWorld.copy(this._rodGroup.position);
      }
      const bp   = this._bobber.position;
      const arr  = this._lineGeo.attributes.position.array;
      arr[0] = tipWorld.x; arr[1] = tipWorld.y; arr[2] = tipWorld.z;
      arr[3] = bp.x; arr[4] = bp.y; arr[5] = bp.z;
      this._lineGeo.attributes.position.needsUpdate = true;
      this._line.visible = this._phase !== PHASE.IDLE;
    } else {
      this._line.visible = false;
    }

    // ── Update and Draw Stress Gauge ──────────────────────────────
    if (this._gaugeWrap && this._gaugeCtx && this._camera) {
      if (this._phase !== PHASE.IDLE) {
        // Compute stress fraction based on active phase
        let frac = 0.0;
        let label = "WAITING...";
        
        if (this._phase === PHASE.CASTING) {
          frac = Math.min(1.0, this._phaseT / 1.0);
          label = "CASTING...";
        } else if (this._phase === PHASE.WAITING) {
          frac = 0.0;
          label = "NO BITE...";
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
          frac = 0.0;
          label = "🐟 CAUGHT!";
        }
        
        const isReeling = (this._phase === PHASE.REELING || this._phase === PHASE.BITE || this._phase === PHASE.LANDING);
        const t = (typeof performance !== "undefined" ? performance.now() : 0) * 0.001;
        _drawGauge(this._gaugeCtx, frac, label, isReeling, t);
        
        // Project bobber position to screen coordinates
        const tempV = new THREE.Vector3();
        const targetPos = this._bobber.visible ? this._bobber.position : this._castTarget;
        tempV.copy(targetPos);
        tempV.project(this._camera);
        
        const width = window.innerWidth;
        const height = window.innerHeight;
        const screenX = (tempV.x * 0.5 + 0.5) * width;
        const screenY = (-(tempV.y * 0.5) + 0.5) * height - 85;
        
        this._gaugeWrap.style.left = `${screenX}px`;
        this._gaugeWrap.style.top = `${screenY}px`;
        this._gaugeWrap.style.display = "block";
      } else {
        this._gaugeWrap.style.display = "none";
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
    if (typeof window !== "undefined") {
      delete window.__sanctuaryFishingSpawnRipple;
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
    if (this._gaugeWrap && this._gaugeWrap.parentNode) {
      this._gaugeWrap.parentNode.removeChild(this._gaugeWrap);
    }
    this._gaugeWrap = null;
    this._gaugeCtx = null;
    this._gaugeCanvas = null;
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
