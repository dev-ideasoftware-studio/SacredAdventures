// Shared Node staging for sanctuary modules: browser stubs + import rewriting.
// Used by scene_census.mjs and the proposal equivalence tests. See scene_census.mjs for details.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const REPO = process.cwd();
const THREE_SRC = path.join(REPO, "vendor/three/three.module.js");
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "census-"));
fs.copyFileSync(THREE_SRC, path.join(OUT, "three.mjs"));

// ── browser stubs ────────────────────────────────────────────────────────────
const ctx2d = new Proxy({}, {
  get(t, k) {
    if (k in t) return t[k];
    if (k === "getImageData") return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)), width: w, height: h });
    if (k === "createImageData") return (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)), width: w, height: h });
    if (k === "measureText") return (s) => ({ width: String(s).length * 8 });
    if (typeof k === "string" && /^create\w*Gradient$|^createPattern$/.test(k)) return () => ({ addColorStop() {} });
    return () => {};
  },
  set(t, k, v) { t[k] = v; return true; },
});
const fakeEl = () => ({
  width: 1, height: 1, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  // three's ImageLoader waits for an <img> 'load' event — fire it on the next tick.
  getContext: () => ctx2d, addEventListener(type, fn) { if (type === "load") setTimeout(() => fn.call(this, { target: this }), 0); }, removeEventListener() {}, appendChild() {}, remove() {},
  setAttribute() {}, getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0 }),
});
globalThis.document = {
  createElement: fakeEl, createElementNS: fakeEl, getElementById: () => null, querySelector: () => null,
  body: fakeEl(), head: fakeEl(), addEventListener() {},
};
globalThis.window = globalThis;
// Node 22 ships a read-only global navigator (ATT-18): define, don't assign. Desktop UA so
// modules take their desktop branches (mobile skips would hide real desktop cost).
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 }, configurable: true });
globalThis.requestAnimationFrame = () => 0;
globalThis.Image = class { constructor() { this.width = 1; this.height = 1; setTimeout(() => this.onload?.(), 0); } addEventListener(e, f) { if (e === "load") setTimeout(f, 0); } removeEventListener() {} set src(v) { this._src = v; } };
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
// fetch() serves real files from the repo (three's FileLoader uses fetch in r160), so text
// assets such as Assets/Fish/fish.obj load for real; anything missing returns an empty body.
// three's FileLoader builds `new Request(url)` with a RELATIVE url, which Node rejects — accept it.
globalThis.Request = class { constructor(url, init = {}) { this.url = String(url); this.headers = new Headers(init.headers || {}); this.credentials = init.credentials; } };
globalThis.ProgressEvent = globalThis.ProgressEvent ?? class { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.fetch = async (req) => {
  const rel = String(req && req.url !== undefined ? req.url : req).replace(/^\.\//, "").split("?")[0];
  const file = path.join(REPO, rel);
  const buf = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
  return new Response(buf, { status: fs.existsSync(file) ? 200 : 404 });
};

// ── copy + rewrite imports ───────────────────────────────────────────────────
const done = new Map();
function stage(absFile) {
  if (done.has(absFile)) return done.get(absFile);
  const rel = path.relative(REPO, absFile);
  const dst = path.join(OUT, rel);
  done.set(absFile, dst);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  let src = fs.readFileSync(absFile, "utf8");
  // Line-anchored so quotes inside comments can't derail matching: `import … from "x"`,
  // a multi-line import's closing `} from "x"`, bare `import "x"`, and dynamic `import("x")`.
  src = src.replace(/^(\s*(?:import\b[^\n]*?\bfrom\s*|export\b[^\n]*?\bfrom\s*|\}\s*from\s*|import\s*))(["'])([^"'\n]+)\2|(import\s*\(\s*)(["'])([^"'\n]+)\5/gm, (m, preA, qA, specA, preB, qB, specB) => {
    const pre = preA ?? preB, q = qA ?? qB, spec = specA ?? specB;
    if (spec === "three") return `${pre}${q}${path.relative(path.dirname(dst), path.join(OUT, "three.mjs")).replace(/^(?!\.)/, "./")}${q}`;
    // "three/addons/X" → the real vendored example file (import map: ./vendor/three/examples/jsm/),
    // except GLTF/DRACO (wasm workers) which stay stubbed — GLB costs come from glbjson.mjs instead.
    if (spec.startsWith("three/addons/") && !/GLTFLoader|DRACOLoader|KTX2Loader/.test(spec)) {
      const real = path.join(REPO, "vendor/three/examples/jsm", spec.slice("three/addons/".length));
      if (fs.existsSync(real)) {
        const d = stage(real);
        return `${pre}${q}${path.relative(path.dirname(dst), d).replace(/^(?!\.)/, "./")}${q}`;
      }
    }
    if (spec.startsWith("three/") || spec.includes("/vendor/three/examples/")) {
      // examples (loaders etc.): stub with an empty module that exports common names
      const stub = path.join(OUT, "__examples_stub.mjs");
      if (!fs.existsSync(stub)) fs.writeFileSync(stub, "export class GLTFLoader{setDRACOLoader(){return this}setKTX2Loader(){return this}setMeshoptDecoder(){return this}load(){}loadAsync(){return Promise.reject(new Error('stub'))}}\nexport class DRACOLoader{setDecoderPath(){return this}setDecoderConfig(){return this}setWorkerLimit(){return this}preload(){return this}}\nexport class OBJLoader{loadAsync(){return Promise.reject(new Error('stub'))}}\nexport const BufferGeometryUtils={mergeGeometries:()=>null};export function mergeGeometries(){return null};export function mergeVertices(g){return g};\n");
      return `${pre}${q}${path.relative(path.dirname(dst), stub).replace(/^(?!\.)/, "./")}${q}`;
    }
    if (spec.startsWith(".")) {
      const target = path.resolve(path.dirname(absFile), spec);
      if (fs.existsSync(target)) stage(target);
      return m;
    }
    return m;
  });
  fs.writeFileSync(dst, src);
  return dst;
}


export const THREE = await import(pathToFileURL(path.join(OUT, "three.mjs")).href);
export async function importStaged(file) { return import(pathToFileURL(stage(path.resolve(REPO, file))).href); }
export function cleanup() { fs.rmSync(OUT, { recursive: true, force: true }); }
export { REPO, OUT, stage };
