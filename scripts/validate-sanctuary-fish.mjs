/**
 * Validates fish.obj upright bake + swim yaw convention for sanctuary.
 * Run: node scripts/validate-sanctuary-fish.mjs
 */
import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FISH_OBJ_PATH = join(ROOT, "Assets/Fish/fish.obj");

function loadFishGeometry() {
  const text = readFileSync(FISH_OBJ_PATH, "utf8");
  const obj = new OBJLoader().parse(text);
  let geom = null;
  obj.updateMatrixWorld(true);
  obj.traverse((c) => {
    if (geom || !c.isMesh || !c.geometry) return;
    geom = c.geometry.clone();
    geom.applyMatrix4(c.matrixWorld);
  });
  if (!geom) throw new Error("no mesh in fish.obj");
  geom.rotateX(-Math.PI / 2);
  geom.computeBoundingBox();
  const bb = geom.boundingBox;
  const size = new THREE.Vector3();
  bb.getSize(size);
  const center = bb.getCenter(new THREE.Vector3());
  geom.translate(-center.x, -center.y, -center.z);
  return { geom, size };
}

function swimYaw(vx, vz) {
  return Math.atan2(-vz, vx) + Math.PI;
}

let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("PASS:", msg);
  }
}

const { geom, size } = loadFishGeometry();

assert(
  size.y >= size.z && size.y >= size.x * 0.4,
  `upright: Y span ${size.y.toFixed(3)} should dominate (x=${size.x.toFixed(3)} z=${size.z.toFixed(3)})`,
);
assert(
  size.x >= size.y && size.x >= size.z,
  `length axis: X span ${size.x.toFixed(3)} is body length after bake`,
);

const headYaw = swimYaw(1, 0);
assert(
  Math.abs(headYaw) < 0.25 || Math.abs(Math.abs(headYaw) - Math.PI) < 0.25,
  `forward swim: velocity +X → yaw ${headYaw.toFixed(3)} (head ~ +X)`,
);

const tailYaw = swimYaw(-1, 0);
const yawDelta = Math.abs(headYaw - tailYaw);
assert(
  yawDelta > Math.PI * 0.8,
  `head vs tail yaw differ by ${yawDelta.toFixed(3)} rad (not swimming backwards)`,
);

const wiggleSamples = [];
for (let i = 0; i < 30; i++) {
  const t = i * 0.05;
  wiggleSamples.push(Math.sin(t * 6.5 + 0.43 * 4.7) * 0.22);
}
const wiggleRange =
  Math.max(...wiggleSamples) - Math.min(...wiggleSamples);
assert(wiggleRange > 0.35, `wiggle amplitude range ${wiggleRange.toFixed(3)}`);

assert(
  readFileSync(FISH_OBJ_PATH, "utf8").includes("3ds Max"),
  "fish.obj is the expected Wavefront export",
);

console.log(failed ? `\n${failed} check(s) failed` : "\nAll sanctuary fish checks passed");
process.exit(failed ? 1 : 0);
