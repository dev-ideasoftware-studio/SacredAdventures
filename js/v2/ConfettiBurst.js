/**
 * Sacred Adventures v2 — confetti burst particle module.
 *
 * Used by the Quest-1 "Start Game" balloon pop: 150 small flat-plane
 * confetti pieces in a gold + nature palette tumble outward from the
 * balloon, then fall under gravity and air drag until they rest on the
 * terrain as gently-fading colored sparkles.
 *
 * Design: one InstancedMesh draw call for all pieces. Per-instance
 * matrix + color are mutated each tick. Cheap on the GPU; the
 * dominant cost is JS per-tick math on ~150 small particles.
 *
 * Lifecycle:
 *   const burst = createConfettiBurst({ scene, origin, terrainY });
 *   // each frame:
 *   burst.update(dt);
 *   // when burst.done === true:
 *   burst.dispose();
 *
 * The factory pushes its root group into `opts.objects` (if provided) so
 * the generic World unload sweep can dispose it on scene teardown.
 */
import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN } from "./anu/SimulationController.js";

const GOLD_NATURE_PALETTE = [
  0xffd700, // bright gold
  0xf4c430, // saffron
  0xdaa520, // goldenrod
  0xb8860b, // dark goldenrod
  0xcd7f32, // bronze
  0xa67d3d, // copper
  0x87a96b, // sage
  0x6b8e23, // olive drab
  0x355e3b, // forest green
  0x9caf88, // moss
  0xb73e3e, // autumn red
  0xc1683f, // terracotta
  0xe8b463, // honey
  0xd4a017, // amber
];

/**
 * @typedef {object} ConfettiBurstOptions
 * @property {THREE.Scene} scene
 * @property {THREE.Vector3} origin — burst spawn point (balloon position).
 * @property {(x: number, z: number) => number} terrainY — analytic terrain Y sampler.
 * @property {unknown[]} [objects] — optional scene-object array for unload sweep.
 * @property {number} [count=160] — particle count (140–180 reads well at village scale).
 * @property {number} [spread=4.2] — outward speed scale (m/s peak).
 * @property {number} [upBoost=4.6] — initial upward bias on Y (m/s) so the burst lifts before falling.
 * @property {number} [size=0.18] — piece edge length (m). 0.16–0.22 reads "village-scale".
 * @property {number} [groundFadeSeconds=2.4] — how long sparkles linger after settling.
 * @property {THREE.Vector3} [driftTarget] — when set, pieces accelerate slightly toward
 *   this XZ point as they fall, so the cascade reads as "raining down on the player"
 *   rather than a symmetrical puff. Y of the target is ignored.
 * @property {number} [sparkChance=0.55] — fraction of pieces emitting a bright "spark"
 *   trail sprite. 0 disables sparks entirely.
 */

/**
 * @param {ConfettiBurstOptions} opts
 */
export function createConfettiBurst(opts) {
  const {
    scene,
    origin,
    terrainY,
    objects,
    count = 160,
    spread = 4.2,
    upBoost = 4.6,
    size = 0.18,
    groundFadeSeconds = 2.4,
    driftTarget = null,
    sparkChance = 0.55,
  } = opts;

  const root = new THREE.Group();
  root.name = "effect_quest_1_confetti_burst";
  root.userData.anuId = "environment.tipi_1.quest_1_confetti";
  root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  root.userData.anuKind = "quest_1_confetti_burst";

  // Slightly rectangular pieces read more "paper-like" than squares.
  const geo = new THREE.PlaneGeometry(size, size * 1.4);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 1.0,
    // No depthWrite so settled confetti doesn't z-fight with terrain.
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false; // burst spans the camera frame; cull math wastes cycles
  mesh.renderOrder = 8;
  root.add(mesh);

  /**
   * Bright "spark" sprite layer — additive-blended billboards that ride
   * along with a subset of confetti pieces so the burst reads as fireworks
   * (sparks) rather than just falling paper. The texture is a canvas radial
   * gradient: hot-white core → gold halo → fade. Shared material, per-piece
   * sprite. Disabled when `sparkChance` is 0.
   */
  const sparkCount = Math.max(0, Math.round(count * sparkChance));
  let sparkMesh = null;
  let sparkColorAttr = null;
  if (sparkCount > 0) {
    const sparkCanvas = document.createElement("canvas");
    sparkCanvas.width = 64;
    sparkCanvas.height = 64;
    const sctx = sparkCanvas.getContext("2d");
    const sgrad = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    sgrad.addColorStop(0.0, "rgba(255, 252, 220, 1.0)");
    sgrad.addColorStop(0.32, "rgba(255, 222, 120, 0.75)");
    sgrad.addColorStop(0.6, "rgba(255, 170, 60, 0.32)");
    sgrad.addColorStop(1.0, "rgba(255, 140, 30, 0)");
    sctx.fillStyle = sgrad;
    sctx.fillRect(0, 0, 64, 64);
    const sparkTex = new THREE.CanvasTexture(sparkCanvas);
    sparkTex.needsUpdate = true;
    const sparkPlaneGeo = new THREE.PlaneGeometry(size * 1.6, size * 1.6);
    const sparkMat = new THREE.MeshBasicMaterial({
      map: sparkTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      opacity: 1.0,
    });
    sparkMesh = new THREE.InstancedMesh(sparkPlaneGeo, sparkMat, sparkCount);
    sparkMesh.frustumCulled = false;
    sparkMesh.renderOrder = 9;
    root.add(sparkMesh);
  }

  /** @type {{
   *   x: number, y: number, z: number,
   *   vx: number, vy: number, vz: number,
   *   rx: number, ry: number, rz: number,
   *   wx: number, wy: number, wz: number,
   *   settled: boolean,
   *   settleAt: number,
   *   sx: number, sy: number, sz: number,
   * }[]} */
  const particles = new Array(count);
  const dummy = new THREE.Object3D();
  const colorScratch = new THREE.Color();

  for (let i = 0; i < count; i++) {
    // Spherical direction with upward bias — gives that "puff then rain" arc.
    const az = Math.random() * Math.PI * 2;
    const polar = Math.acos(1 - Math.random() * 1.35); // bias toward equator-up
    const sp = spread * (0.5 + Math.random() * 0.9);
    const vx = Math.sin(polar) * Math.cos(az) * sp;
    const vz = Math.sin(polar) * Math.sin(az) * sp;
    const vy = Math.cos(polar) * sp + upBoost * (0.55 + Math.random() * 0.55);
    particles[i] = {
      x: origin.x,
      y: origin.y,
      z: origin.z,
      vx,
      vy,
      vz,
      rx: Math.random() * Math.PI * 2,
      ry: Math.random() * Math.PI * 2,
      rz: Math.random() * Math.PI * 2,
      // Angular velocities (rad/s) — visibly tumbling without becoming a blur.
      wx: (Math.random() - 0.5) * 12,
      wy: (Math.random() - 0.5) * 12,
      wz: (Math.random() - 0.5) * 12,
      settled: false,
      settleAt: 0,
      sx: 0.85 + Math.random() * 0.4,
      sy: 0.85 + Math.random() * 0.4,
      sz: 1,
    };

    const colorHex =
      GOLD_NATURE_PALETTE[Math.floor(Math.random() * GOLD_NATURE_PALETTE.length)];
    colorScratch.setHex(colorHex);
    // Light per-instance brightness jitter so identical hues still read distinct.
    const bScale = 0.85 + Math.random() * 0.35;
    colorScratch.multiplyScalar(bScale);
    mesh.setColorAt(i, colorScratch);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  scene.add(root);
  if (Array.isArray(objects)) objects.push(root);

  // Physics constants — tuned for kid-readable arcs at village scale.
  const GRAVITY = 9.8; // m/s²
  const AIR_DRAG_HORIZONTAL = 1.6; // s⁻¹ (exponential decay rate)
  const AIR_DRAG_VERTICAL = 0.9;
  const FLOOR_LIFT = 0.04; // park settled pieces this far above terrain
  /** Sideways pull toward `driftTarget` (m/s²) — gentle so pieces still scatter. */
  const DRIFT_ACCEL = driftTarget ? 1.6 : 0;

  let elapsed = 0;
  let allSettledFor = 0;
  let done = false;

  /**
   * Advance the burst. Returns a flag that becomes `true` once every piece has
   * either settled into the ground sparkle phase and faded out, OR `dt > 1 s`
   * has elapsed at full opacity for the settled cohort.
   *
   * @param {number} dt seconds since last update
   */
  function update(dt) {
    if (done) return;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.066) dt = 0.066; // clamp huge frames so the burst doesn't explode
    elapsed += dt;

    const dragH = Math.exp(-AIR_DRAG_HORIZONTAL * dt);
    const dragV = Math.exp(-AIR_DRAG_VERTICAL * dt);

    let allSettled = true;
    let minOpacity = 1;

    for (let i = 0; i < count; i++) {
      const p = particles[i];

      if (!p.settled) {
        p.vy -= GRAVITY * dt;
        // Gentle drift toward `driftTarget` (player) — only after gravity has
        // pulled the piece below its peak so the upward burst still reads as
        // outward, then the rain biases toward the player on the way down.
        if (DRIFT_ACCEL > 0 && p.vy < 1.0) {
          const ddx = driftTarget.x - p.x;
          const ddz = driftTarget.z - p.z;
          const dlen = Math.hypot(ddx, ddz) || 1;
          p.vx += (ddx / dlen) * DRIFT_ACCEL * dt;
          p.vz += (ddz / dlen) * DRIFT_ACCEL * dt;
        }
        p.vx *= dragH;
        p.vz *= dragH;
        p.vy *= dragV;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;

        const groundY = terrainY(p.x, p.z);
        if (p.y <= groundY + FLOOR_LIFT && p.vy < 0.5) {
          p.y = groundY + FLOOR_LIFT;
          p.vx = 0;
          p.vy = 0;
          p.vz = 0;
          // Flatten pieces against the ground when they settle, otherwise
          // they protrude vertically and read as standing flags.
          p.rx = -Math.PI / 2 + (Math.random() - 0.5) * 0.3;
          p.ry = Math.random() * Math.PI * 2;
          p.rz = (Math.random() - 0.5) * 0.4;
          p.wx = 0;
          p.wy = 0;
          p.wz = 0;
          p.settled = true;
          p.settleAt = elapsed;
        } else {
          p.rx += p.wx * dt;
          p.ry += p.wy * dt;
          p.rz += p.wz * dt;
          allSettled = false;
        }
      }

      let opacity;
      if (!p.settled) {
        opacity = 1;
      } else {
        const ageSinceSettle = elapsed - p.settleAt;
        // First 0.6 s glint-bright on the ground, then linearly fade to 0.
        const headroom = groundFadeSeconds - 0.6;
        const dim =
          ageSinceSettle < 0.6
            ? 1
            : Math.max(0, 1 - (ageSinceSettle - 0.6) / (headroom > 0 ? headroom : 1));
        opacity = dim;
        if (dim > 0) allSettled = false;
      }
      if (opacity < minOpacity) minOpacity = opacity;

      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.rx, p.ry, p.rz);
      dummy.scale.set(p.sx, p.sy, p.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Spark sprite that rides on this piece (only first `sparkCount` pieces).
      // Adds a hot additive glow that "sparks" via a fast sin-twinkle on scale.
      if (sparkMesh && i < sparkCount) {
        // Twinkle frequency varies per piece via the existing tumble seed.
        const tw = 0.55 + 0.45 * Math.abs(Math.sin(elapsed * 14 + p.rx * 7));
        // Sparks burn out as the piece settles + fades.
        const sparkOpacity = !p.settled ? tw : tw * Math.max(0, opacity - 0.2);
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(sparkOpacity > 0 ? 0.6 + tw * 0.9 : 0);
        dummy.updateMatrix();
        sparkMesh.setMatrixAt(i, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (sparkMesh) sparkMesh.instanceMatrix.needsUpdate = true;

    // Group opacity tracks the dimmest particle so the whole burst fades together.
    mat.opacity = Math.max(0, minOpacity);

    if (allSettled) {
      allSettledFor += dt;
      if (allSettledFor > 0.05) done = true;
    } else {
      allSettledFor = 0;
    }
  }

  function dispose() {
    try {
      scene.remove(root);
    } catch (_e) { /* ignore */ }
    geo.dispose();
    mat.dispose();
    if (mesh.instanceColor) mesh.instanceColor = null;
    if (sparkMesh) {
      sparkMesh.geometry.dispose();
      sparkMesh.material.map?.dispose?.();
      sparkMesh.material.dispose();
    }
  }

  return {
    root,
    update,
    dispose,
    get done() {
      return done;
    },
  };
}
