/**
 * Sacred Adventures v2 — World Module (Phase 1)
 *
 * Matches the exact AssetFactory terrain formula + neumorphic hex GLSL shader.
 * Target: SOLID 60 FPS baseline.
 *
 * FPS fixes vs original World.js:
 *  - NO per-frame object allocation (no new THREE.Euler / new THREE.Vector3 in update)
 *  - computeVertexNormals() called ONCE at build time, never again
 *  - Movement uses pre-allocated _moveDir vector, mutated in place
 *  - camera.rotation.order set once in load(), not every frame
 */

import * as THREE from "three";
import { V2_PLAYER_MOVE_SPEED_MPS, V2_TILE_WORLD } from "./constants.js";
import { dispatchInteraction } from "./anu/InteractionBus.js";
import { ANU_EVENTS } from "./anu/anuEvents.js";
import { ANU_SIMULATION_DOMAIN } from "./anu/SimulationController.js";
import {
  clearRuntimeService,
  registerRuntimeService,
} from "./RuntimeServices.js";
import { applyNeuHexShader, terrainY } from "./WorldTerrain.js";
import {
  GRAVITY,
  JUMP_IMPULSE,
  PLAYER_COLLISION_RADIUS,
  PLAYER_HEIGHT,
  WorldPhysics,
} from "./WorldPhysics.js";
import { createWorldAvatarController } from "./WorldAvatar.js";
import {
  buildWorldPlayerState,
  clearPlayerInput,
  syncAutowalkFromHeldKeys,
  wirePlayerInput,
} from "./WorldPlayerController.js";
import { loadCenterTipi } from "./WorldStructures.js";

const FOOT_TO_M = 0.3048;
const DEFAULT_CAMERA_FOV = 58;
const IDLE_FPV_HEAD_FORWARD = 5 * FOOT_TO_M;
const FOLLOW_CAMERA_DIST = V2_TILE_WORLD;
const FOLLOW_CAMERA_HEIGHT = 2 * FOOT_TO_M;
const NPC_GREETING_DISTANCE = V2_TILE_WORLD * 2;

// ─────────────────────────────────────────────────────────────────────────────
// WORLD MODULE
// ─────────────────────────────────────────────────────────────────────────────
export const WorldModule = {
  name: "World",

  _objects: [],
  _keys: {},
  _yaw: 0,
  _pitch: 0,
  _camera: null,
  _canvas: null,
  _onKey: null,

  // Pre-allocated vectors — NEVER recreated inside update()
  _moveDir: new THREE.Vector3(),
  _fwd: new THREE.Vector3(),
  _playerBody: null, // PhysicsBody for the camera/player
  _playerPos: new THREE.Vector3(),
  _walkDistance: 0,
  _lastWalkX: 0,
  _lastWalkZ: 0,

  _avatar: createWorldAvatarController(),
  _feetScratch: new THREE.Vector3(),
  _avatarFeetScratch: new THREE.Vector3(),
  _back: new THREE.Vector3(),
  _lookTarget: new THREE.Vector3(),
  _cameraPosSmooth: new THREE.Vector3(),
  _cameraLookSmooth: new THREE.Vector3(),
  _cameraSmoothReady: false,
  _npcGreetingState: new Map(),
  _npcScanFrame: 0,
  _tmpNpcPos: new THREE.Vector3(),
  _tmpPlayerPos: new THREE.Vector3(),
  _tmpAvoidVelocity: new THREE.Vector3(),
  _autoWalk: {
    active: false,
    key: null,
    startedByHoldAt: 0,
    dirX: 0,
    dirZ: -1,
  },
  _keyDownAt: {},
  _tipi: null,
  /** FPV chase / idle forward vs top-down map on main canvas (PiP shows the other). */
  _mainCanvasMapView: false,

  // ──────────────────────────────────────────────────────────────────────────
  async load(scene, camera) {
    this._camera = camera;
    this._canvas = document.querySelector("canvas");
    camera.fov = DEFAULT_CAMERA_FOV;
    camera.updateProjectionMatrix();

    // ── Sky ───────────────────────────────────────────────────────────────
    scene.background = new THREE.Color(0xfff1ca); // match original warm sky
    scene.fog = new THREE.FogExp2(0xfff1ca, 0.008);

    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x4a7c3f, 0.85);
    scene.add(hemi);
    this._objects.push(hemi);

    // ── Sun ───────────────────────────────────────────────────────────────
    const sun = new THREE.DirectionalLight(0xfff5e0, 1.3);
    sun.position.set(80, 120, 60);
    sun.castShadow = false;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 400;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -120;
    sun.shadow.camera.right = sun.shadow.camera.top = 120;
    sun.shadow.bias = -0.001;
    scene.add(sun);
    this._objects.push(sun);

    const fill = new THREE.DirectionalLight(0xb0d4ff, 0.22);
    fill.position.set(-60, 40, -80);
    scene.add(fill);
    this._objects.push(fill);

    // ── Terrain (matches AssetFactory exactly) ────────────────────────────
    const geo = new THREE.PlaneGeometry(60 * 4, 60 * 4, 128, 128);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const count = pos.count;
    const colors = new Float32Array(count * 3);
    const _hCache = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = terrainY(x, z);
      _hCache[i] = h;
      pos.setY(i, h);

      const dist = Math.sqrt(x * x + z * z);
      const sc = z * 0.6 + Math.sin(x * 0.05) * 8 + 15;
      const streamD = Math.abs(x - sc);

      let r = 0.97 + Math.random() * 0.06;
      let g = r,
        b = r;

      if (streamD < 3 && dist > 26) {
        const sb = 0.5 + 0.5 * Math.cos((streamD / 3) * Math.PI);
        r -= sb * 0.15;
        g -= sb * 0.05;
        b += sb * 0.1;
      }
      if (dist >= 16 && dist < 26) {
        const hb = Math.sin(((dist - 8) / 10) * Math.PI);
        r -= hb * 0.08;
        g += hb * 0.05;
        b -= hb * 0.06;
      }
      if (dist < 8) {
        const cb = 0.5 + 0.5 * Math.cos((dist / 8) * Math.PI);
        r = r * (1 - cb) + 0.8 * cb;
        g = g * (1 - cb) + 0.7 * cb;
        b = b * (1 - cb) + 0.48 * cb;
      }
      if (dist > 105) {
        const darkness = Math.min(1.0, (dist - 105) / 15.0);
        const v = 1.0 - darkness;
        r *= v;
        g *= v;
        b *= v;
      }

      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    pos.needsUpdate = true;
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals(); // called ONCE here, never in update()

    // ── Real grass texture (seamless, from game assets) ───────────────────
    const loader = new THREE.TextureLoader();
    const grassTex = loader.load(
      "./SacredOnes.1/assets/landscape/grass_seamless.png",
    );
    grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
    grassTex.repeat.set(24, 24); // tile density across the map

    // Neumorphic hex material (MeshStandard so shader hooks work)
    const groundMat = new THREE.MeshStandardMaterial({
      map: grassTex,
      vertexColors: true, // vertex colours tint on top of texture
      roughness: 0.92,
      metalness: 0.0,
    });
    applyNeuHexShader(groundMat);

    const terrain = new THREE.Mesh(geo, groundMat);
    terrain.receiveShadow = false;
    terrain.name = "terrain";
    terrain.userData.anuId = "environment.terrain.hex_ground";
    terrain.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    terrain.userData.anuKind = "terrain_hex_mesh";
    scene.add(terrain);
    this._objects.push(terrain);

    // ── Ethereal haze overlay (matches AssetFactory) ──────────────────────
    const hazeGeo = new THREE.PlaneGeometry(60 * 4, 60 * 4, 128, 128);
    hazeGeo.rotateX(-Math.PI / 2);
    const hazePos = hazeGeo.attributes.position;
    for (let i = 0; i < hazePos.count; i++) {
      const hx = hazePos.getX(i),
        hz = hazePos.getZ(i);
      let hY = _hCache[i] + 0.15;
      const d2 = Math.sqrt(hx * hx + hz * hz);
      if (d2 < 6) hY -= 0.15;
      else if (d2 < 10) hY -= 0.15 * (1 - (d2 - 6) / 4);
      hazePos.setY(i, hY);
    }
    hazeGeo.computeVertexNormals();
    const hazeMat = new THREE.MeshBasicMaterial({
      color: 0x2d5a1e,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    const hazeMesh = new THREE.Mesh(hazeGeo, hazeMat);
    hazeMesh.name = "atmospheric_haze";
    hazeMesh.userData.anuId = "environment.atmosphere.haze";
    hazeMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    hazeMesh.userData.anuKind = "haze_overlay";
    scene.add(hazeMesh);
    this._objects.push(hazeMesh);

    // Expose height cache globally (same interface as AssetFactory)
    window._terrainHeightCache = { data: _hCache, geo, lookup: terrainY };
    this._terrainY = terrainY;

    // ── Horizon ring ──────────────────────────────────────────────────────
    const ringGeo = new THREE.CylinderGeometry(238, 238, 10, 48, 1, true);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x6fa858,
      side: THREE.BackSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.name = "environment_outer_ring";
    ring.position.y = -3;
    ring.userData.anuId = "environment.boundary.outer_ring";
    ring.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    ring.userData.anuKind = "outer_boundary_ring";
    scene.add(ring);
    this._objects.push(ring);

    // ── Physics engine ────────────────────────────────────────────────────
    WorldPhysics._init(terrainY);
    registerRuntimeService("WorldPhysics", WorldPhysics, { owner: this.name });
    // Legacy alias for older modules/scripts while V2 migrates to RuntimeServices.
    window.WorldPhysics = WorldPhysics;

    // ── Player physics body ───────────────────────────────────────────────
    this._playerPos.set(0, terrainY(0, 0) + PLAYER_HEIGHT, 8);
    camera.position.copy(this._playerPos);
    camera.rotation.order = "YXZ"; // set ONCE — never reset in update()
    this._playerBody = WorldPhysics.createBody(this._playerPos, PLAYER_HEIGHT);
    this._walkDistance = 0;
    this._lastWalkX = this._playerPos.x;
    this._lastWalkZ = this._playerPos.z;
    this._cameraSmoothReady = false;
    this._npcGreetingState.clear();
    this._mainCanvasMapView = false;

    // ── Input ─────────────────────────────────────────────────────────────
    this._setupInput();

    const [tipi] = await Promise.all([
      loadCenterTipi({ scene, objects: this._objects, worldPhysics: WorldPhysics }),
      this._avatar.load(scene, this._objects),
    ]);
    this._tipi = tipi;

    console.log(
      "%c[World] ✅ Phase 1 loaded — terrain + physics + neumorphic hex shader",
      "color:#a5d6a7;font-weight:bold;",
    );
    console.log(
      "[World] WASD/arrows = move | SPACE = jump | window.WorldPhysics = physics API",
    );
    console.log("[World] Physics:", {
      gravity: GRAVITY,
      jumpImpulse: JUMP_IMPULSE,
      playerHeight: PLAYER_HEIGHT,
    });
  },

  // ──────────────────────────────────────────────────────────────────────────
  // UPDATE — zero allocations, all vectors pre-built
  // ──────────────────────────────────────────────────────────────────────────
  update(delta, _frameCount, _scene, camera) {
    const k = this._keys;
    const speed = V2_PLAYER_MOVE_SPEED_MPS;
    const dir = this._moveDir;
    const body = this._playerBody;
    const now = typeof performance !== "undefined" ? performance.now() : 0;

    // ── Horizontal movement intention ─────────────────────────────────────
    dir.set(0, 0, 0);
    if (k["w"] || k["arrowup"]) dir.z -= 1;
    if (k["s"] || k["arrowdown"]) dir.z += 1;
    if (k["a"]) dir.x -= 1;
    if (k["d"]) dir.x += 1;

    const physicalMovingKeys =
      k["w"] || k["s"] || k["arrowup"] || k["arrowdown"] || k["a"] || k["d"];
    if (physicalMovingKeys) {
      syncAutowalkFromHeldKeys(this, now, dir);
    } else if (this._autoWalk.active) {
      dir.set(this._autoWalk.dirX, 0, this._autoWalk.dirZ);
    }
    const movingKeys = physicalMovingKeys || this._autoWalk.active;

    const turnOnly = (k["arrowleft"] || k["arrowright"]) && !movingKeys;
    const turnRate = turnOnly ? 2.85 : 1.72;

    // ── Turn (after movement keys known — faster when rotating in place) ───
    if (k["arrowleft"]) this._yaw += turnRate * delta;
    if (k["arrowright"]) this._yaw -= turnRate * delta;

    if (dir.lengthSq() > 0) {
      dir.normalize();
      // Rotate direction by yaw — no allocations
      const cos = Math.cos(this._yaw),
        sin = Math.sin(this._yaw);
      const wx = dir.x * cos + dir.z * sin;
      const wz = -dir.x * sin + dir.z * cos;
      this._tmpAvoidVelocity.set(wx * speed, 0, wz * speed);
      WorldPhysics.steerAroundObstacles(
        body.position,
        this._tmpAvoidVelocity,
        PLAYER_COLLISION_RADIUS,
      );
      // Feed into physics body velocity (horizontal only)
      body.velocity.x = this._tmpAvoidVelocity.x;
      body.velocity.z = this._tmpAvoidVelocity.z;
    } else if (turnOnly) {
      // ←/→ only: no horizontal motion — do not blend with friction (avoids drift before zero)
      body.velocity.x = 0;
      body.velocity.z = 0;
    } else {
      // No movement keys — friction stop
      body.velocity.x *= 0.82;
      body.velocity.z *= 0.82;
    }

    // ── Jump (Space) — only if grounded ───────────────────────────────────
    if (k[" "] && body.grounded) {
      body.applyImpulse(0, JUMP_IMPULSE, 0);
      body.grounded = false;
      dispatchInteraction(ANU_EVENTS.PLAYER_JUMP, {
        t: typeof performance !== "undefined" ? performance.now() : 0,
      });
    }

    // ── Step all physics bodies (gravity, terrain collision, slope) ────────
    WorldPhysics.stepAll(delta);
    WorldPhysics.resolveBodyCollisions(body, PLAYER_COLLISION_RADIUS);

    // Belt-and-suspenders: slope integration must not leave horizontal drift during pivot
    if (turnOnly) {
      body.velocity.x = 0;
      body.velocity.z = 0;
    }

    const dx = body.position.x - this._lastWalkX;
    const dz = body.position.z - this._lastWalkZ;
    const stepDistance = Math.sqrt(dx * dx + dz * dz);
    this._lastWalkX = body.position.x;
    this._lastWalkZ = body.position.z;
    const horizontalSpeed = Math.sqrt(
      body.velocity.x * body.velocity.x + body.velocity.z * body.velocity.z,
    );
    const moving =
      body.grounded && horizontalSpeed > 0.18 && dir.lengthSq() > 0;
    if (moving) this._walkDistance += stepDistance;

    /** Hold walk clip whenever movement intent is active — avoids idle flashes from grounded/slope jitter. */
    const walkIntent = movingKeys && dir.lengthSq() > 0;

    let desiredLocomotion = "idle";
    if (walkIntent) desiredLocomotion = "walk";
    else if (turnOnly) desiredLocomotion = "look";

    const feetY = body.position.y - PLAYER_HEIGHT;
    this._feetScratch.set(body.position.x, feetY, body.position.z);
    this._fwd.set(-Math.sin(this._yaw), 0, -Math.cos(this._yaw));
    this._back.copy(this._fwd).multiplyScalar(-1);

    if (this._avatar) {
      this._avatar.setPose(body.position.x, feetY, body.position.z, this._yaw);
      if (now >= this._avatar.gestureUntil) {
        const reason =
          desiredLocomotion === "walk"
            ? "move"
            : desiredLocomotion === "look"
              ? "turn-in-place"
              : "idle";
        this._avatar.syncLocomotionIfNeeded(desiredLocomotion, reason);
      }
      this._avatar.syncWalkAnimToHorizontalSpeed(
        horizontalSpeed,
        walkIntent && desiredLocomotion === "walk",
        now,
      );
      this._avatar.advanceMixer(delta);
    }

    this._tickNpcGreeting(_scene, _frameCount, now);

    const headY = feetY + PLAYER_HEIGHT;

    if (this._mainCanvasMapView) {
      const elev = 78;
      camera.position.set(body.position.x, feetY + elev, body.position.z);
      camera.up.set(0, 1, 0);
      camera.lookAt(body.position.x, feetY, body.position.z);
      this._cameraSmoothReady = true;
    } else {
      const chaseView = walkIntent || turnOnly;
      if (chaseView) {
        this._cameraPosSmooth.set(
          body.position.x + this._back.x * FOLLOW_CAMERA_DIST,
          feetY + PLAYER_HEIGHT + FOLLOW_CAMERA_HEIGHT,
          body.position.z + this._back.z * FOLLOW_CAMERA_DIST,
        );
        this._lookTarget.set(
          body.position.x + this._fwd.x * V2_TILE_WORLD,
          headY,
          body.position.z + this._fwd.z * V2_TILE_WORLD,
        );
      } else {
        this._cameraPosSmooth.set(
          body.position.x + this._fwd.x * IDLE_FPV_HEAD_FORWARD,
          headY,
          body.position.z + this._fwd.z * IDLE_FPV_HEAD_FORWARD,
        );
        this._lookTarget.set(
          body.position.x + this._fwd.x * V2_TILE_WORLD,
          headY,
          body.position.z + this._fwd.z * V2_TILE_WORLD,
        );
      }

      if (!this._cameraSmoothReady) {
        camera.position.copy(this._cameraPosSmooth);
        this._cameraLookSmooth.copy(this._lookTarget);
        this._cameraSmoothReady = true;
      } else {
        const cameraLerp = 1 - Math.pow(0.01, delta);
        camera.position.lerp(this._cameraPosSmooth, cameraLerp);
        this._cameraLookSmooth.lerp(this._lookTarget, cameraLerp);
      }
      camera.up.set(0, 1, 0);
      camera.lookAt(this._cameraLookSmooth);
    }

    if (_frameCount % 24 === 0) {
      dispatchInteraction(ANU_EVENTS.PLAYER_STATE_SAMPLE, {
        t: typeof performance !== "undefined" ? performance.now() : 0,
        frame: _frameCount,
        x: body.position.x,
        y: body.position.y,
        z: body.position.z,
        yaw: this._yaw,
        grounded: body.grounded,
        walkDistance: this._walkDistance,
        velocityXZ: Math.sqrt(
          body.velocity.x * body.velocity.x + body.velocity.z * body.velocity.z,
        ),
      });
    }

    const playerState = buildWorldPlayerState(this, camera, body);
    registerRuntimeService("WorldPlayer", playerState, { owner: this.name });
    // Legacy alias for console workflows and older scripts.
    window.WorldPlayer = playerState;
  },

  _yawFacing(from, to) {
    return Math.atan2(-(to.x - from.x), -(to.z - from.z));
  },

  _triggerAvatarGesture(kind, reason, now) {
    const clipName = this._avatar.semanticClips?.[kind] ?? null;
    const duration =
      this._avatar.clips.find((clip) => clip.name === clipName)?.duration ?? 1.8;
    this._avatar.gestureUntil = now + Math.min(2600, Math.max(900, duration * 1000));
    this._avatar.play(kind, reason, 0.12, true);
  },

  _findNearestNpc(scene) {
    if (!scene || !this._avatar.root) return null;
    let nearest = null;
    let nearestD2 = Infinity;
    const player = this._tmpPlayerPos.copy(this._feetScratch);
    scene.traverse((obj) => {
      if (
        obj === this._avatar.root ||
        obj.userData?.anuSimulationDomain !== ANU_SIMULATION_DOMAIN.POPULATION
      ) {
        return;
      }
      obj.getWorldPosition(this._tmpNpcPos);
      const dx = this._tmpNpcPos.x - player.x;
      const dz = this._tmpNpcPos.z - player.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < nearestD2) {
        nearestD2 = d2;
        nearest = obj;
      }
    });
    if (!nearest) return null;
    return {
      object: nearest,
      distance: Math.sqrt(nearestD2),
    };
  },

  _turnNpcToward(npc, targetPosition) {
    if (!npc) return;
    npc.getWorldPosition(this._tmpNpcPos);
    npc.rotation.y = this._yawFacing(this._tmpNpcPos, targetPosition);
    npc.userData.anuGreetingState = "facing_player";
  },

  _tickNpcGreeting(scene, frameCount, now) {
    if (frameCount === this._npcScanFrame || frameCount % 10 !== 0) return;
    this._npcScanFrame = frameCount;
    const nearest = this._findNearestNpc(scene);
    const activeIds = new Set();

    if (nearest && nearest.distance <= NPC_GREETING_DISTANCE) {
      const npc = nearest.object;
      const npcId = npc.userData?.anuId ?? npc.uuid;
      activeIds.add(npcId);
      const state = this._npcGreetingState.get(npcId) ?? {
        greeted: false,
        goodbyeSent: false,
        object: npc,
      };
      state.object = npc;
      npc.getWorldPosition(this._tmpNpcPos);
      this._yaw = this._yawFacing(this._feetScratch, this._tmpNpcPos);
      if (this._avatar.root) this._avatar.root.rotation.y = this._yaw;
      this._turnNpcToward(npc, this._feetScratch);

      if (!state.greeted) {
        state.greeted = true;
        state.goodbyeSent = false;
        this._triggerAvatarGesture("wave", "npc-greeting", now);
        npc.userData.anuGreetingState = "wave_hello";
        if (typeof npc.userData.anuPlayGesture === "function") {
          npc.userData.anuPlayGesture("wave_hello");
        }
        dispatchInteraction(ANU_EVENTS.PLAYER_NPC_GREETING, {
          phase: "hello",
          playerId: "player.avatar.primary",
          npcId,
          distance: nearest.distance,
          t: now,
        });
      }
      this._npcGreetingState.set(npcId, state);
    }

    for (const [npcId, state] of this._npcGreetingState.entries()) {
      if (activeIds.has(npcId) || !state.greeted || state.goodbyeSent) continue;
      state.goodbyeSent = true;
      this._triggerAvatarGesture("goodbye", "npc-goodbye", now);
      if (state.object) {
        this._turnNpcToward(state.object, this._feetScratch);
        state.object.userData.anuGreetingState = "wave_goodbye";
        if (typeof state.object.userData.anuPlayGesture === "function") {
          state.object.userData.anuPlayGesture("wave_goodbye");
        }
        if (typeof window !== "undefined") {
          window.setTimeout(() => {
            if (state.object?.userData) state.object.userData.anuGreetingState = "normal";
          }, 1800);
        }
      }
      dispatchInteraction(ANU_EVENTS.PLAYER_NPC_GREETING, {
        phase: "goodbye",
        playerId: "player.avatar.primary",
        npcId,
        distance: NPC_GREETING_DISTANCE,
        t: now,
      });
      this._npcGreetingState.delete(npcId);
    }
  },

  // ──────────────────────────────────────────────────────────────────────────
  unload(scene) {
    for (const obj of this._objects) {
      scene.remove(obj);
      obj.traverse?.((child) => {
        if (child.geometry) child.geometry.dispose?.();
        const mat = child.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.());
        else mat?.dispose?.();
      });
      if (obj.geometry) obj.geometry.dispose?.();
      const mat = obj.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.());
      else mat?.dispose?.();
    }
    this._objects = [];
    this._avatar.dispose();
    this._playerBody = null;
    this._cameraSmoothReady = false;
    this._npcGreetingState.clear();
    this._autoWalk.active = false;
    this._autoWalk.key = null;
    this._autoWalk.startedByHoldAt = 0;
    this._keyDownAt = {};
    this._mainCanvasMapView = false;
    clearPlayerInput(this);
    WorldPhysics._reset();
    clearRuntimeService("WorldPhysics", WorldPhysics);
    clearRuntimeService("WorldPlayer");
    if (window.WorldPhysics === WorldPhysics) delete window.WorldPhysics;
    if (window.WorldPlayer) delete window.WorldPlayer;
    if (window._terrainHeightCache?.lookup === terrainY) delete window._terrainHeightCache;
    console.log("[World] ⏹ Unloaded.");
  },

  // ──────────────────────────────────────────────────────────────
  _setupInput() {
    wirePlayerInput(this, dispatchInteraction, ANU_EVENTS);
  },
};
