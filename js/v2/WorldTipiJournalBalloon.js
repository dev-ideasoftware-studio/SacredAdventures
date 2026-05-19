/**
 * Tipi 1 journal guide — 3D golden balloon matching `Component.ThreeIcons.js`
 * `buildQuest` (lathe body + knot + “!” sprite + additive bloom + sparkles).
 * World-scaled with a gentle wind sway for the main scene (not the HUD icon pass).
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN } from "./anu/SimulationController.js";

const FT = 0.3048;

/**
 * @param {object} opts
 * @param {THREE.Scene} opts.scene
 * @param {unknown[]} opts.objects — pushed for generic World unload sweep
 * @param {number} opts.apexWorldX
 * @param {number} opts.apexWorldY — tipi mesh bbox max Y (crown)
 * @param {number} opts.apexWorldZ
 * @param {number} opts.liftAboveApexM — additional Y above apex (e.g. 10 ft)
 * @returns {{ root: THREE.Group, update: (t: number, dt: number) => void }}
 */
export function createTipiJournalQuestBalloon({
  scene,
  objects,
  apexWorldX,
  apexWorldY,
  apexWorldZ,
  liftAboveApexM,
}) {
  const root = new THREE.Group();
  root.name = "effect_tipi_1_journal_quest_balloon";
  root.userData.anuId = "environment.tipi_1.journal_quest_balloon";
  root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  root.userData.anuKind = "journal_quest_balloon";

  const group = new THREE.Group();
  group.scale.set(0.65, 0.65, 0.65);
  root.add(group);

  const ballMat = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    emissive: 0xffd700,
    emissiveIntensity: 0.25,
    metalness: 1.0,
    roughness: 0.3,
  });

  const balloonPoints = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const y = Math.cos(t * Math.PI);
    let x = Math.sin(t * Math.PI);
    if (t > 0.5) {
      const pinchProgress = (t - 0.5) * 2.0;
      x *= Math.pow(1.0 - pinchProgress, 0.65);
    }
    balloonPoints.push(new THREE.Vector2(x * 2.1, y * 2.1));
  }
  const balloonGeo = new THREE.LatheGeometry(balloonPoints, 32);
  const ball = new THREE.Mesh(balloonGeo, ballMat);

  const knotGeo = new THREE.ConeGeometry(0.35, 0.5, 12);
  const knot = new THREE.Mesh(knotGeo, ballMat);
  knot.position.y = -2.15;
  knot.rotation.x = Math.PI;
  ball.add(knot);

  group.add(ball);

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.font = "bold 120px serif";
  ctx.fillStyle = "black";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("!", 64, 64);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const exclMat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const planeGeo = new THREE.PlaneGeometry(2.0, 2.0);
  const faceFront = new THREE.Mesh(planeGeo, exclMat);
  faceFront.position.set(0, 0, 2.38);
  const faceBack = new THREE.Mesh(planeGeo, exclMat.clone());
  faceBack.position.set(0, 0, -2.38);
  faceBack.rotation.y = Math.PI;
  group.add(faceFront, faceBack);

  const bloomGroup = new THREE.Group();
  group.add(bloomGroup);

  const bloomTex = new THREE.CanvasTexture(
    (() => {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 64;
      const t = c.getContext("2d");
      const g = t.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(255, 200, 50, 0.8)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      t.fillStyle = g;
      t.fillRect(0, 0, 64, 64);
      return c;
    })(),
  );

  for (let i = 0; i < 6; i++) {
    const b = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: bloomTex,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.6,
      }),
    );
    b.userData = {
      speed: 0.5 + Math.random() * 0.5,
      offset: Math.random() * 10,
      radius: 2.5,
    };
    bloomGroup.add(b);
  }
  bloomGroup.children.forEach((b) => {
    b.userData.radius *= 0.14;
  });

  const sparkles = new THREE.Group();
  group.add(sparkles);
  const spGeo = new THREE.PlaneGeometry(0.12, 0.12);
  const spMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1.0,
  });
  for (let i = 0; i < 15; i++) {
    const sp = new THREE.Mesh(spGeo, spMat);
    sp.userData = {
      phase: Math.random() * Math.PI * 2,
      speed: 1.0 + Math.random(),
      radius: 1.6 + Math.random() * 0.5,
      yBase: (Math.random() - 0.5) * 2.5,
    };
    sparkles.add(sp);
  }
  sparkles.children.forEach((sp) => {
    sp.userData.radius *= 0.16;
  });

  const borderGeo = new THREE.TorusGeometry(3.0, 0.1, 16, 64);
  const borderMat = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
  });
  const border = new THREE.Mesh(borderGeo, borderMat);
  group.add(border);

  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(
        (() => {
          const c = document.createElement("canvas");
          c.width = 64;
          c.height = 64;
          const tx = c.getContext("2d");
          const g = tx.createRadialGradient(32, 32, 0, 32, 32, 32);
          g.addColorStop(0, "rgba(0,100,255,0.8)");
          g.addColorStop(1, "rgba(0,0,0,0)");
          tx.fillStyle = g;
          tx.fillRect(0, 0, 64, 64);
          return c;
        })(),
      ),
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0,
    }),
  );
  glow.scale.set(5, 5, 5);
  group.add(glow);

  // Size to ~2.1 m envelope so it reads at village scale (tipi ~7.2 m).
  group.updateMatrixWorld(true);
  const fitBox = new THREE.Box3().setFromObject(group);
  const fitSize = new THREE.Vector3();
  fitBox.getSize(fitSize);
  const targetH = 2.1;
  const fitScale = targetH / Math.max(fitSize.y, 0.01);
  group.scale.multiplyScalar(fitScale);

  root.position.set(
    apexWorldX,
    apexWorldY + liftAboveApexM + 0.35 * FT,
    apexWorldZ,
  );

  scene.add(root);
  objects.push(root);

  const questIdle = (time, dt) => {
    group.position.y = Math.sin(time) * 0.1;

    bloomGroup.children.forEach((b) => {
      const u = b.userData;
      const angle = time * u.speed + u.offset;
      b.position.x = Math.cos(angle) * u.radius;
      b.position.z = Math.sin(angle) * u.radius;
      b.position.y = Math.sin(time * 1.1 + u.offset) * u.radius * 0.35;
      b.scale.setScalar(0.65 + 0.35 * Math.sin(time * 2 + u.offset));
    });

    sparkles.children.forEach((sp) => {
      const u = sp.userData;
      const angle = time * u.speed + u.phase;
      sp.position.x = Math.cos(angle) * u.radius;
      sp.position.z = Math.sin(angle) * u.radius;
      sp.position.y = u.yBase + Math.sin(time * 2 + u.phase) * 0.3;
      sp.scale.setScalar(0.5 + 0.5 * Math.sin(time * 10 + u.phase));
      sp.lookAt(0, 0, 10);
    });

    const t = time % 5.0;
    if (t < 1.0) {
      const f = Math.sin(t * Math.PI);
      borderMat.opacity = f * 0.8;
      glow.material.opacity = f * 0.5;
      border.rotation.x = time;
      border.rotation.y = time * 0.5;
    } else {
      borderMat.opacity = 0;
      glow.material.opacity = 0;
    }

    ball.rotation.y -= dt * 0.5;
    ball.rotation.x = Math.sin(time * 0.5) * 0.2;
  };

  let exploded = false;

  /**
   * Quest-1 "Start Game" pop: hide the balloon mesh and stop animating it so
   * the confetti burst spawned by `World.beginJournalStartGameIntro` is the
   * only visible element at the balloon's apex. Idempotent.
   *
   * Returns the balloon's current world position so the caller can spawn the
   * confetti burst at exactly where the balloon was, no matter where the
   * wind-sway loop happened to have placed it that frame.
   */
  function explode() {
    if (exploded) return root.getWorldPosition(new THREE.Vector3());
    exploded = true;
    const popAt = root.getWorldPosition(new THREE.Vector3());
    root.visible = false;
    return popAt;
  }

  return {
    root,
    explode,
    get exploded() {
      return exploded;
    },
    update(time, dt) {
      if (exploded) return;
      questIdle(time, dt);
      // Wind sway — layered sines, small angles (readable, not chaotic).
      const wx =
        Math.sin(time * 0.73 + 0.2) * 0.11 + Math.sin(time * 1.17 + 1.1) * 0.06;
      const wz =
        Math.cos(time * 0.69 + 0.5) * 0.09 + Math.sin(time * 0.91 + 2.4) * 0.05;
      root.rotation.z = wx;
      root.rotation.x = wz * 0.55;
      root.position.x =
        apexWorldX + Math.sin(time * 0.52) * 0.11 + Math.sin(time * 1.04) * 0.05;
      root.position.z =
        apexWorldZ + Math.cos(time * 0.48 + 0.3) * 0.1 + Math.sin(time * 0.88) * 0.04;
      root.position.y =
        apexWorldY +
        liftAboveApexM +
        0.35 * FT +
        Math.sin(time * 1.6) * 0.07;
    },
  };
}
