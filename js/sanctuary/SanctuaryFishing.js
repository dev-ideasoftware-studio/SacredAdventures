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

// ── Physical ──────────────────────────────────────────────────────────
const STAND_RADIUS_M     = 0.7;
const SPOT_DISC_RADIUS_M = 0.55;
const WATER_Y_M          = -0.05;
const ROD_LENGTH_M       = 1.4;
const BOBBER_RADIUS_M    = 0.05;

// ── Timing ────────────────────────────────────────────────────────────
const CAST_FLIGHT_S  = 0.9;
const REEL_FLIGHT_S  = 0.6;
const BITE_WINDOW_S  = 1.5;
const REWARD_HOLD_S  = 0.8;

// ── Bite turn system ──────────────────────────────────────────────────
// 6-second turns. Each turn: 1–3 % base bite chance. Every surgeEvery
// turns (1–3, random at cast): +5 % bonus is applied to that turn.
const TURN_S         = 6.0;
const BITE_MIN_PCT   = 0.01;   // 1 %
const BITE_RANGE_PCT = 0.02;   // adds 0–2 % → max 3 %
const SURGE_BONUS    = 0.05;   // +5 % on surge turns

// ── Camera ────────────────────────────────────────────────────────────
// 10 ft above water, 4 ft behind avatar, looking straight at pool centre.
const CAM_LIFT_M    = 3.048;   // 10 ft
const CAM_BACK_M    = 1.219;   // 4 ft
const CAM_LERP_RATE = 6.0;

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
  REWARD:  "reward",
});

function _makeButton() {
  const btn = document.createElement("button");
  btn.id   = "v4-btn-fishing";
  btn.type = "button";
  btn.textContent = "🎣 CAST";
  Object.assign(btn.style, {
    position: "fixed", left: "50%", bottom: "120px",
    transform: "translateX(-50%)", zIndex: "5100",
    padding: "10px 18px", borderRadius: "999px",
    background: "linear-gradient(180deg,rgba(50,80,40,.92),rgba(28,46,20,.92))",
    color: "#fff6c2", font: "700 14px/1 ui-sans-serif,system-ui,sans-serif",
    letterSpacing: "0.06em", border: "1px solid rgba(251,192,45,.55)",
    boxShadow: "0 4px 12px rgba(0,0,0,.45)", cursor: "pointer",
    pointerEvents: "auto", userSelect: "none", display: "none",
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
    padding: "5px 14px", borderRadius: "999px",
    background: "rgba(20,28,22,.85)", color: "#fff6c2",
    font: "600 12px/1 ui-monospace,monospace", letterSpacing: "0.08em",
    border: "1px solid rgba(251,192,45,.32)",
    pointerEvents: "none", userSelect: "none", display: "none",
  });
  pill.textContent = "WAITING";
  document.body.appendChild(pill);
  return pill;
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
    this._poolCentre = new THREE.Vector3(SANCTUARY_POOL_CENTER_X, WATER_Y_M, SANCTUARY_POOL_CENTER_Z);

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
      new THREE.CylinderGeometry(0.005, 0.018, ROD_LENGTH_M, 8, 1),
      new THREE.MeshStandardMaterial({ color: 0x6e482a, roughness: 0.6, metalness: 0.0 }),
    );
    rod.name = "fishing_rod_stick";
    rod.userData.anuKind = "fishing_rod_stick";
    rod.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ITEMS;
    rod.geometry.translate(0, ROD_LENGTH_M / 2, 0);
    rod.rotation.x = -Math.PI / 3;   // initial pitch; updated each frame based on distance
    rodGroup.add(rod);

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
    this._onClick = () => this._tryAction();
    this._btn.addEventListener("click", this._onClick);
    this._onKey = (e) => {
      const ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
      if ((e.key === "f" || e.key === "F") && this._isPlayerOnDock()) {
        e.preventDefault();
        this._tryAction();
      }
    };
    window.addEventListener("keydown", this._onKey);

    console.log(
      "%c[Sanctuary] 🎣 Fishing v2 — pool-centre cast · J-hook · ripples · turn-based bites.",
      "color:#80deea;font-weight:bold;",
    );
  },

  _setPhase(p) {
    this._phase  = p;
    this._phaseT = 0;
    // Reset turn counters each time we enter WAITING.
    if (p === PHASE.WAITING) {
      this._turnCount   = 0;
      this._turnElapsed = 0;
      this._surgeEvery  = 1 + Math.floor(Math.random() * 3);  // 1, 2, or 3
    }
    if (this._statusPill) {
      const label = {
        [PHASE.IDLE]:    "",
        [PHASE.CASTING]: "CASTING…",
        [PHASE.WAITING]: "WAITING…",
        [PHASE.BITE]:    "BITE! CLICK!",
        [PHASE.REELING]: "REELING…",
        [PHASE.REWARD]:  "🐟 CAUGHT!",
      }[p] ?? "";
      this._statusPill.textContent = label;
      this._statusPill.style.display = label ? "block" : "none";
      if (p === PHASE.BITE) {
        this._statusPill.style.color = "#ffcd72";
        this._statusPill.style.borderColor = "rgba(255,205,114,.65)";
      } else {
        this._statusPill.style.color = "#fff6c2";
        this._statusPill.style.borderColor = "rgba(251,192,45,.32)";
      }
    }
    if (this._btn) {
      this._btn.textContent = p === PHASE.BITE ? "🐟 CATCH!" : "🎣 CAST";
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
      const cam = this._camera;
      if (cam && !this._camIsRepositioned) {
        this._savedCamPos.copy(cam.position);
        this._savedCamRot = cam.rotation.clone();
        this._savedCamFov = cam.fov;
        this._camIsRepositioned = true;
      }
      const avatar = window.__sanctuaryAvatar;
      this._castStart.set(avatar.position.x, avatar.position.y + 1.2, avatar.position.z);
      // Lure always lands exactly at pool centre.
      this._castTarget.set(SANCTUARY_POOL_CENTER_X, WATER_Y_M, SANCTUARY_POOL_CENTER_Z);
      this._bobber.visible = true;
      this._rodGroup.visible = true;
      this._setPhase(PHASE.CASTING);
    } else if (this._phase === PHASE.BITE) {
      this._setPhase(PHASE.REELING);
    }
  },

  _spawnRipple() {
    const slot = this._ripples.find(r => r.age < 0);
    if (!slot) return;
    // Slight random scatter around pool centre so multiple rings don't
    // stack perfectly.
    slot.mesh.position.x = SANCTUARY_POOL_CENTER_X + (Math.random() - 0.5) * 0.35;
    slot.mesh.position.z = SANCTUARY_POOL_CENTER_Z + (Math.random() - 0.5) * 0.35;
    slot.mesh.scale.setScalar(0.1);
    slot.mesh.material.opacity = 0.68;
    slot.mesh.visible = true;
    slot.age = 0;
  },

  update(delta) {
    if (!this._scene) return;
    this._phaseT += delta;

    const avatar = (typeof window !== "undefined") ? window.__sanctuaryAvatar : null;

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
    const onDock = this._isPlayerOnDock();
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
        // "Behind" = direction from pool centre to avatar (away from pool).
        const toAvX = avatar.position.x - SANCTUARY_POOL_CENTER_X;
        const toAvZ = avatar.position.z - SANCTUARY_POOL_CENTER_Z;
        const toAvLen = Math.hypot(toAvX, toAvZ) || 1;
        const bkX = toAvX / toAvLen;
        const bkZ = toAvZ / toAvLen;
        const camTarget = new THREE.Vector3(
          avatar.position.x + bkX * CAM_BACK_M,
          WATER_Y_M + CAM_LIFT_M,
          avatar.position.z + bkZ * CAM_BACK_M,
        );
        const k = 1 - Math.exp(-CAM_LERP_RATE * delta);
        this._camera.position.lerp(camTarget, k);
        this._camera.lookAt(this._poolCentre);
      } else if (this._camIsRepositioned) {
        const k = 1 - Math.exp(-CAM_LERP_RATE * delta);
        this._camera.position.lerp(this._savedCamPos, k);
        if (this._savedCamRot) {
          this._camera.rotation.x = this._camera.rotation.x * (1 - k) + this._savedCamRot.x * k;
          this._camera.rotation.y = this._camera.rotation.y * (1 - k) + this._savedCamRot.y * k;
          this._camera.rotation.z = this._camera.rotation.z * (1 - k) + this._savedCamRot.z * k;
        }
        if (this._camera.position.distanceToSquared(this._savedCamPos) < 0.02) {
          this._camIsRepositioned = false;
        }
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
      this._rod.rotation.x = -pitchAngle;

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
        if (t >= 1) this._setPhase(PHASE.WAITING);
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

        // Turn-based bite roll.
        this._turnElapsed += delta;
        if (this._turnElapsed >= TURN_S) {
          this._turnElapsed -= TURN_S;
          this._turnCount++;
          const isSurge = (this._turnCount % this._surgeEvery === 0);
          const chance  = BITE_MIN_PCT + Math.random() * BITE_RANGE_PCT + (isSurge ? SURGE_BONUS : 0);
          if (Math.random() < chance) this._setPhase(PHASE.BITE);
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
        if (this._phaseT >= BITE_WINDOW_S) this._endIdle(false);
        break;
      }

      case PHASE.REELING: {
        const t = Math.min(1, this._phaseT / REEL_FLIGHT_S);
        const x = this._castTarget.x * (1 - t) + this._castStart.x * t;
        const z = this._castTarget.z * (1 - t) + this._castStart.z * t;
        const baseY = WATER_Y_M * (1 - t) + (this._castStart.y - 0.4) * t;
        this._bobber.position.set(x, baseY + 3.2 * t * (1 - t) * 1.2, z);
        if (t >= 1) {
          try { window.sanctuaryGrant?.("fish", 1); } catch (_) {}
          this._setPhase(PHASE.REWARD);
        }
        break;
      }

      case PHASE.REWARD:
        if (this._phaseT >= REWARD_HOLD_S) this._endIdle(true);
        break;
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
      const yaw   = this._rodGroup.rotation.y;
      const pitch = this._rod.rotation.x;         // negative = forward lean
      const fwdDist = ROD_LENGTH_M * Math.sin(-pitch);
      const tipX = this._rodGroup.position.x + fwdDist * Math.sin(yaw);
      const tipY = this._rodGroup.position.y + ROD_LENGTH_M * Math.cos(-pitch);
      const tipZ = this._rodGroup.position.z + fwdDist * Math.cos(yaw);
      const bp   = this._bobber.position;
      const arr  = this._lineGeo.attributes.position.array;
      arr[0] = tipX; arr[1] = tipY; arr[2] = tipZ;
      arr[3] = bp.x; arr[4] = bp.y; arr[5] = bp.z;
      this._lineGeo.attributes.position.needsUpdate = true;
      this._line.visible = this._phase !== PHASE.IDLE;
    } else {
      this._line.visible = false;
    }
  },

  _endIdle(caught) {
    for (const r of this._ripples) { r.age = -1; r.mesh.visible = false; }
    this._bobber.visible   = false;
    this._rodGroup.visible = false;
    this._line.visible     = false;
    this._setPhase(PHASE.IDLE);
    if (!caught && this._statusPill) {
      this._statusPill.textContent  = "got away…";
      this._statusPill.style.display = "block";
      setTimeout(() => {
        if (this._phase === PHASE.IDLE && this._statusPill) this._statusPill.style.display = "none";
      }, 900);
    }
  },

  unload(scene) {
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
    if (this._onKey) window.removeEventListener("keydown", this._onKey);
    this._rodGroup = this._rod = this._line = this._lineGeo = this._bobber = this._hookGroup = null;
    this._btn = this._statusPill = null;
    this._onClick = this._onKey = null;
    this._poolCentre = null;
    this._scene = null;
  },
};
