/**
 * Sacred Adventures — sanctuary part 17 of N: BUTTERFLIES.
 *
 * Anu domain: FAUNA. **May-18 2026 rewrite:** all butterflies are
 * YELLOW now, they live at Tipi 1 (Yellow Butterfly's tipi — hence
 * the name), and every 5 minutes they perform a sacred ritual:
 *
 *   • IDLE — drift in a loose cloud around Tipi 1.
 *   • SUMMON (every 5 min, first at +5 s) — every butterfly flies to
 *     a slot on a circle around YB (the seated NPC on Tipi 1's deck).
 *     A radial light bloom fades in at the centre, ramping for 1.5 s.
 *   • HOLD — the circle holds for ~6 s, bloom at full strength.
 *   • DISPERSE — bloom fades out, butterflies fan back to the meadow.
 *
 * Pure procedural sprites + an additive Sprite for the bloom. Single
 * `Group` parents the lot.
 *
 * The phase machine uses absolute elapsed-time math so a missed frame
 * never desyncs — `phaseEndsAtSec` is set when the phase begins.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN, ANU_INTERACTION_VERB } from "../v2/anu/SimulationController.js";
import { sanctuaryGroundY } from "./SanctuaryGround.js";

const BUTTERFLY_COUNT = 8;
const SIZE_M = 0.42;

const RITUAL_PERIOD_S = 300; // 5 minutes
const RITUAL_FIRST_DELAY_S = 5; // first one at +5 s
const SUMMON_S = 6.0;
const HOLD_S = 6.0;
const DISPERSE_S = 4.0;

const RITUAL_RADIUS_M = 1.4; // butterflies orbit YB this far out
const RITUAL_HEIGHT_OVER_GROUND_M = 1.55; // matches seated NPC head
const BLOOM_RADIUS_M = 3.0;
const FLIGHT_SPEED_MPS = 2.8;

// Explore/return cycle: each butterfly flies off into the meadow then
// returns to a tight cluster near Tipi 1, repeating forever (except
// when interrupted by the 5-min ritual).
const EXPLORE_RADIUS_MIN_M = 10;
const EXPLORE_RADIUS_MAX_M = 22;
const RETURN_RADIUS_M = 2.0;        // tight knot of butterflies at the tipi
const EXPLORE_MAX_S = 18;           // bail to return-mode if a butterfly gets stuck
const RETURN_MAX_S = 8;             // bail to explore-mode after lingering at tipi
const ARRIVE_EPS_M = 0.5;

const PHASE = Object.freeze({
  IDLE: "idle",
  SUMMON: "summon",
  HOLD: "hold",
  DISPERSE: "disperse",
});

// ── Yellow butterfly texture (built once, shared) ──────────────────
let _yellowTex = null;
function _yellowButterflyTexture() {
  if (_yellowTex) return _yellowTex;
  const W = 96, H = 48;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  // Wings — buttery yellow with a slight amber gradient.
  const wingGrad = ctx.createLinearGradient(0, 0, 0, H);
  wingGrad.addColorStop(0.00, "#fff3a0");
  wingGrad.addColorStop(0.50, "#fbc02d");
  wingGrad.addColorStop(1.00, "#e8a712");
  ctx.fillStyle = wingGrad;
  // Left upper
  ctx.beginPath();
  ctx.moveTo(48, 24);
  ctx.quadraticCurveTo(20, 4, 6, 18);
  ctx.quadraticCurveTo(14, 28, 48, 26);
  ctx.fill();
  // Right upper (mirror)
  ctx.beginPath();
  ctx.moveTo(48, 24);
  ctx.quadraticCurveTo(76, 4, 90, 18);
  ctx.quadraticCurveTo(82, 28, 48, 26);
  ctx.fill();
  // Lower wings — smaller fan-tail.
  ctx.beginPath();
  ctx.moveTo(48, 24);
  ctx.quadraticCurveTo(28, 38, 18, 44);
  ctx.quadraticCurveTo(32, 38, 48, 30);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(48, 24);
  ctx.quadraticCurveTo(68, 38, 78, 44);
  ctx.quadraticCurveTo(64, 38, 48, 30);
  ctx.fill();

  // Body + antennae — warm dark brown.
  ctx.strokeStyle = "#5e3b1a";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(48, 12);
  ctx.lineTo(48, 38);
  ctx.stroke();
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(48, 12);
  ctx.lineTo(43, 4);
  ctx.moveTo(48, 12);
  ctx.lineTo(53, 4);
  ctx.stroke();

  _yellowTex = new THREE.CanvasTexture(c);
  _yellowTex.anisotropy = 2;
  _yellowTex.colorSpace = THREE.SRGBColorSpace;
  return _yellowTex;
}

// ── Bloom texture (radial gradient, additive blended) ──────────────
let _bloomTex = null;
function _bloomTexture() {
  if (_bloomTex) return _bloomTex;
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  g.addColorStop(0.00, "rgba(255, 250, 210, 1.0)");
  g.addColorStop(0.25, "rgba(255, 220, 120, 0.85)");
  g.addColorStop(0.65, "rgba(251, 192, 45, 0.30)");
  g.addColorStop(1.00, "rgba(251, 192, 45, 0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  _bloomTex = new THREE.CanvasTexture(c);
  _bloomTex.colorSpace = THREE.SRGBColorSpace;
  return _bloomTex;
}

function mulberry32(seed) {
  return function rng() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function _buildButterfly(idx, mat) {
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(SIZE_M, SIZE_M * 0.55, 1);
  sprite.name = `sanctuary_butterfly_yellow_${idx}`;
  sprite.userData.anuKind = "sanctuary_butterfly";
  sprite.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FAUNA;
  sprite.userData.anuInteractable = true;
  sprite.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.INSPECT];
  sprite.renderOrder = 8;
  return sprite;
}

function _exploreTarget(rng, anchorX, anchorZ) {
  const ang = rng() * Math.PI * 2;
  const r = EXPLORE_RADIUS_MIN_M + rng() * (EXPLORE_RADIUS_MAX_M - EXPLORE_RADIUS_MIN_M);
  const x = anchorX + Math.cos(ang) * r;
  const z = anchorZ + Math.sin(ang) * r;
  const y = sanctuaryGroundY(x, z) + 1.5 + rng() * 2.2;
  return new THREE.Vector3(x, y, z);
}

function _returnTarget(rng, anchorX, anchorZ) {
  const ang = rng() * Math.PI * 2;
  const r = 0.5 + rng() * RETURN_RADIUS_M;
  const x = anchorX + Math.cos(ang) * r;
  const z = anchorZ + Math.sin(ang) * r;
  const y = sanctuaryGroundY(x, z) + 1.2 + rng() * 0.8;
  return new THREE.Vector3(x, y, z);
}

function _ritualSlot(i, n, centerX, centerZ, groundY) {
  const ang = (i / n) * Math.PI * 2;
  const x = centerX + Math.cos(ang) * RITUAL_RADIUS_M;
  const z = centerZ + Math.sin(ang) * RITUAL_RADIUS_M;
  return new THREE.Vector3(x, groundY + RITUAL_HEIGHT_OVER_GROUND_M, z);
}

export const SanctuaryButterfliesModule = {
  name: "SanctuaryButterflies",

  _scene: null,
  _root: null,
  _butterflies: [],
  _bloom: null,
  _rng: null,
  _elapsed: 0,
  _phase: PHASE.IDLE,
  _phaseEndAt: 0,
  _nextRitualAt: RITUAL_FIRST_DELAY_S,
  _anchor: { x: 18, z: -2, gy: 0 },

  _exploreTarget(rng, anchorX, anchorZ) {
    return _exploreTarget(rng, anchorX, anchorZ);
  },

  _returnTarget(rng, anchorX, anchorZ) {
    return _returnTarget(rng, anchorX, anchorZ);
  },

  async load(scene) {
    if (this._root) return;
    this._scene = scene;
    this._rng = mulberry32(0xb377e7f);

    // Anchor on Tipi 1 — published by SanctuaryTipis. Fall back to the
    // canonical (18, -2) if Tipis hasn't activated yet (shouldn't happen
    // given the v4 boot order, but safe).
    const t1 = (typeof window !== "undefined") ? window.__sanctuaryTipi1Anchor : null;
    this._anchor.x = t1?.x ?? 18;
    this._anchor.z = t1?.z ?? -2;
    this._anchor.gy = sanctuaryGroundY(this._anchor.x, this._anchor.z);

    const root = new THREE.Group();
    root.name = "sanctuary_butterflies";
    root.userData.anuId = "fauna.sanctuary.butterflies";
    root.userData.anuKind = "sanctuary_butterflies";
    root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FAUNA;

    // Shared yellow sprite material — every butterfly uses the same
    // map so we get free batching in the renderer's sprite path.
    const mat = new THREE.SpriteMaterial({
      map: _yellowButterflyTexture(),
      transparent: true,
      alphaTest: 0.25,
      depthWrite: false,
      toneMapped: false,
    });

    this._butterflies = [];
    for (let i = 0; i < BUTTERFLY_COUNT; i++) {
      const b = _buildButterfly(i, mat);
      // Spawn at Tipi 1, immediately set off on an exploration run.
      const spawn = _returnTarget(this._rng, this._anchor.x, this._anchor.z);
      b.position.copy(spawn);
      b.userData.mode = "explore";
      b.userData.target = _exploreTarget(this._rng, this._anchor.x, this._anchor.z);
      b.userData.modeT = this._rng() * 3; // stagger so they don't move in lockstep
      b.userData.bobPhase = this._rng() * Math.PI * 2;
      b.userData.bobAmp = 0.10 + this._rng() * 0.15;
      root.add(b);
      this._butterflies.push(b);
    }

    // Bloom — additive radial sprite that fades in/out during the
    // ritual. Hidden when idle.
    const bloomMat = new THREE.SpriteMaterial({
      map: _bloomTexture(),
      color: 0xffe48a,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.0,
      toneMapped: false,
    });
    const bloom = new THREE.Sprite(bloomMat);
    bloom.scale.set(BLOOM_RADIUS_M * 2, BLOOM_RADIUS_M * 2, 1);
    bloom.name = "sanctuary_butterfly_bloom";
    bloom.userData.anuKind = "sanctuary_butterfly_bloom";
    bloom.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    bloom.position.set(this._anchor.x, this._anchor.gy + RITUAL_HEIGHT_OVER_GROUND_M, this._anchor.z);
    bloom.visible = false;
    root.add(bloom);
    this._bloom = bloom;

    scene.add(root);
    this._root = root;

    console.log(
      `%c[Sanctuary] 🦋 ${BUTTERFLY_COUNT} yellow butterflies — sacred ritual every ${RITUAL_PERIOD_S / 60} min (first at +${RITUAL_FIRST_DELAY_S} s).`,
      "color:#fbc02d;font-weight:bold;",
    );
  },

  _enterPhase(p) {
    this._phase = p;
    if (p === PHASE.SUMMON) this._phaseEndAt = this._elapsed + SUMMON_S;
    else if (p === PHASE.HOLD) this._phaseEndAt = this._elapsed + HOLD_S;
    else if (p === PHASE.DISPERSE) this._phaseEndAt = this._elapsed + DISPERSE_S;
    else this._phaseEndAt = 0;

    if (p === PHASE.SUMMON) {
      // Assign each butterfly a slot on the ritual circle.
      const n = this._butterflies.length;
      for (let i = 0; i < n; i++) {
        this._butterflies[i].userData.target = _ritualSlot(
          i, n, this._anchor.x, this._anchor.z, this._anchor.gy,
        );
      }
      this._bloom.visible = true;
    } else if (p === PHASE.DISPERSE) {
      // Kick every butterfly into a fresh exploration run.
      for (const b of this._butterflies) {
        b.userData.mode = "explore";
        b.userData.target = _exploreTarget(this._rng, this._anchor.x, this._anchor.z);
        b.userData.modeT = this._rng() * 2;
      }
    } else if (p === PHASE.IDLE) {
      this._bloom.visible = false;
      this._bloom.material.opacity = 0;
      // Resume the explore/return cycle, staggered per butterfly.
      for (const b of this._butterflies) {
        b.userData.mode = this._rng() < 0.5 ? "explore" : "return";
        b.userData.target = (b.userData.mode === "explore")
          ? _exploreTarget(this._rng, this._anchor.x, this._anchor.z)
          : _returnTarget(this._rng, this._anchor.x, this._anchor.z);
        b.userData.modeT = this._rng() * 3;
      }
      // Queue the next ritual.
      this._nextRitualAt = this._elapsed + RITUAL_PERIOD_S;
    }
  },

  update(delta) {
    if (!this._root) return;
    this._elapsed += delta;

    // Phase transitions.
    if (this._phase === PHASE.IDLE && this._elapsed >= this._nextRitualAt) {
      this._enterPhase(PHASE.SUMMON);
    } else if (this._phase === PHASE.SUMMON && this._elapsed >= this._phaseEndAt) {
      this._enterPhase(PHASE.HOLD);
    } else if (this._phase === PHASE.HOLD && this._elapsed >= this._phaseEndAt) {
      this._enterPhase(PHASE.DISPERSE);
    } else if (this._phase === PHASE.DISPERSE && this._elapsed >= this._phaseEndAt) {
      this._enterPhase(PHASE.IDLE);
    }

    // Bloom opacity envelope.
    if (this._phase === PHASE.SUMMON) {
      const t = 1 - (this._phaseEndAt - this._elapsed) / SUMMON_S;
      this._bloom.material.opacity = Math.min(1, t) * 0.95;
      // Slow rotation gives it life.
      this._bloom.material.rotation = this._elapsed * 0.4;
    } else if (this._phase === PHASE.HOLD) {
      // Full bloom with subtle breathing pulse.
      const pulse = 0.85 + 0.10 * Math.sin(this._elapsed * 1.8);
      this._bloom.material.opacity = pulse;
      this._bloom.material.rotation = this._elapsed * 0.4;
    } else if (this._phase === PHASE.DISPERSE) {
      const t = (this._phaseEndAt - this._elapsed) / DISPERSE_S;
      this._bloom.material.opacity = Math.max(0, t) * 0.95;
      this._bloom.material.rotation = this._elapsed * 0.4;
      if (t <= 0) this._bloom.visible = false;
    }

    // Per-butterfly motion.
    const inRitual = this._phase === PHASE.SUMMON || this._phase === PHASE.HOLD;
    const speed = inRitual ? FLIGHT_SPEED_MPS : 2.0;

    for (let i = 0; i < this._butterflies.length; i++) {
      const b = this._butterflies[i];
      const ud = b.userData;

      // Idle / disperse: each butterfly cycles explore → return → repeat.
      if (this._phase === PHASE.IDLE || this._phase === PHASE.DISPERSE) {
        ud.modeT += delta;
        const dx0 = ud.target.x - b.position.x;
        const dz0 = ud.target.z - b.position.z;
        const planar = Math.hypot(dx0, dz0);
        const cap = ud.mode === "explore" ? EXPLORE_MAX_S : RETURN_MAX_S;
        if (planar < ARRIVE_EPS_M || ud.modeT > cap) {
          ud.mode = ud.mode === "explore" ? "return" : "explore";
          ud.target = (ud.mode === "explore")
            ? _exploreTarget(this._rng, this._anchor.x, this._anchor.z)
            : _returnTarget(this._rng, this._anchor.x, this._anchor.z);
          ud.modeT = 0;
        }
      } else if (this._phase === PHASE.HOLD) {
        // Slot drift — orbit YB slowly while held.
        const n = this._butterflies.length;
        const baseAng = (i / n) * Math.PI * 2;
        const ang = baseAng + this._elapsed * 0.4;
        ud.target.set(
          this._anchor.x + Math.cos(ang) * RITUAL_RADIUS_M,
          this._anchor.gy + RITUAL_HEIGHT_OVER_GROUND_M + Math.sin(this._elapsed * 1.5 + i) * 0.18,
          this._anchor.z + Math.sin(ang) * RITUAL_RADIUS_M,
        );
      }

      // Steer toward target.
      const dx = ud.target.x - b.position.x;
      const dy = ud.target.y - b.position.y;
      const dz = ud.target.z - b.position.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 0.005) {
        const step = Math.min(speed * delta, d);
        b.position.x += (dx / d) * step;
        b.position.y += (dy / d) * step;
        b.position.z += (dz / d) * step;
      }

      // Wing-bob — fast Y oscillation reads as wingbeat at distance.
      const bob = Math.sin(this._elapsed * 6 + ud.bobPhase) * ud.bobAmp;
      b.position.y += bob * delta * 6;
    }
  },

  unload(scene) {
    if (!this._root) return;
    scene.remove(this._root);
    this._root.traverse((o) => {
      if (o.material?.map) o.material.map.dispose?.();
      if (o.material) o.material.dispose?.();
    });
    this._root = null;
    this._bloom = null;
    this._butterflies = [];
    this._scene = null;
  },
};
