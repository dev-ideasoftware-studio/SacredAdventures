// qualityTier.js — the TESTING step of the loading screen (testing-pack T1, Mark 2026-10-22).
//
// Runs once at boot, after the renderer exists and BEFORE any module registers, so every
// module loads at the right size from its first frame. Publishes:
//   window.SacredQuality = { tier, budget, why, budgets, cached, msPerUnit, report() }
// tier/budget: "low" | "medium" | "high". Readers today: SanctuaryFish (budgets.fish),
// gltfLoaderSetup (budget "low" -> the light .mobile.glb models), SanctuaryCompassion (tier ->
// starting rung). index.html turns shadows off on "low" right after this (no recompile then).
//
// Decision, first found:
//   1. ?tier=low|medium|high, or ?tier=0..3 (3 high, 1 medium, 0/2 low)
//   2. the saved result for this device (localStorage "sacred.quality.v1", 30 days; ?retest=1 skips it)
//   3. the device check (js/v2/deviceCheck.js, if present) — hard signals and CPU timing
//   4. a short GPU test (WebGL2 fence syncs, offscreen), which may only LOWER the tier
// Never throws; the whole step is capped near 3 s. Words shown to players stay kind.
import * as THREE from "three";

const CACHE_KEY = "sacred.quality.v1";
const CACHE_TTL_MS = 30 * 24 * 3600 * 1000;
const VERSION = 1;
/** GPU time for one unit of the reference scene (ms), measured at the canvas size.
 *  Above MEDIUM_MS -> at most "medium"; above LOW_MS -> "low". Calibrate on real devices. */
export const MEDIUM_MS = 7;
export const LOW_MS = 16;
const GPU_BUDGET_MS = 2200;
const MIN_SHOW_MS = 900;

const BUDGETS = {
  low:    { fish: 0.25, shadows: false, lightModels: true },
  medium: { fish: 0.5,  shadows: true,  lightModels: false },
  high:   { fish: 1,    shadows: true,  lightModels: false },
};
const ORDER = ["low", "medium", "high"];
const lower = (a, b) => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b);
const fromNumber = (t) => (t >= 3 ? "high" : t === 1 ? "medium" : "low");
const now = () => performance.now();

function urlParams() { try { return new URLSearchParams(location.search); } catch (_) { return new URLSearchParams(); } }

function forcedTier() {
  const v = (urlParams().get("tier") || "").toLowerCase();
  if (ORDER.includes(v)) return v;
  if (/^[0-3]$/.test(v)) return fromNumber(+v);
  return null;
}

function readCache(key) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (c && c.v === VERSION && c.key === key && Date.now() - c.at < CACHE_TTL_MS && ORDER.includes(c.tier)) return c;
  } catch (_) {}
  return null;
}
function writeCache(rec) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(rec)); } catch (_) {} }

// ---- GPU test --------------------------------------------------------------------------------
const _mc = typeof MessageChannel !== "undefined" ? new MessageChannel() : null;
const _q = [];
if (_mc) _mc.port1.onmessage = () => { const f = _q.shift(); if (f) f(); };
const tick = () => new Promise((r) => { if (_mc) { _q.push(r); _mc.port2.postMessage(0); } else setTimeout(r, 0); });

async function gpuFinish(gl, timeoutMs = 400) {
  if (typeof gl.fenceSync !== "function") return -1;
  const t0 = now();
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) return -1;
  gl.flush();
  try {
    while (now() - t0 < timeoutMs) {
      const s = gl.clientWaitSync(sync, 0, 0);
      if (s === gl.ALREADY_SIGNALED || s === gl.CONDITION_SATISFIED) return now() - t0;
      if (s === gl.WAIT_FAILED) return -1;
      await tick();
    }
    return timeoutMs;
  } finally { gl.deleteSync(sync); }
}

/** A small scene shaped like a game frame: lit vertex load + alpha-tested overdraw (leaves, grass). */
function referenceScene() {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  cam.position.set(0, 6, 22); cam.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(30, 26, 12); scene.add(sun);
  const geo = new THREE.IcosahedronGeometry(0.8, 15);
  const mat = new THREE.MeshStandardMaterial({ color: 0x6b8f4e, roughness: 0.8 });
  const rocks = new THREE.InstancedMesh(geo, mat, 100);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 100; i++) { m.makeTranslation((i % 10) * 2.2 - 10, 0, Math.floor(i / 10) * -2.2); rocks.setMatrixAt(i, m); }
  scene.add(rocks);
  const cv = document.createElement("canvas"); cv.width = cv.height = 64;
  const g = cv.getContext("2d");
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(80,140,60,${rnd() > 0.5 ? 1 : 0})`; g.fillRect(rnd() * 64, rnd() * 64, 6, 6); }
  const tex = new THREE.CanvasTexture(cv);
  const cardMat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
  const cardGeo = new THREE.PlaneGeometry(4, 4);
  const cards = new THREE.InstancedMesh(cardGeo, cardMat, 600);
  for (let i = 0; i < 600; i++) { m.makeTranslation(((i * 7919) % 40) - 20, (i * 104729) % 8, -((i * 15485863) % 30)); cards.setMatrixAt(i, m); }
  scene.add(cards);
  const dispose = () => { geo.dispose(); mat.dispose(); tex.dispose(); cardMat.dispose(); cardGeo.dispose(); rocks.dispose(); cards.dispose(); };
  return { scene, cam, dispose };
}

async function timeBatch(renderer, gl, ref, k) {
  await gpuFinish(gl);
  const t0 = now();
  for (let i = 0; i < k; i++) renderer.render(ref.scene, ref.cam);
  const waited = await gpuFinish(gl);
  return waited < 0 ? -1 : now() - t0;
}

/** ms of GPU per unit of the reference scene (median of batch slopes), or null. Never throws. */
async function gpuTest(renderer, onProgress) {
  const t0 = now();
  const gl = renderer.getContext();
  let rt = null, ref = null, prev = null, slow = false;
  const samples = [];
  try {
    if (typeof gl.fenceSync !== "function") return { ms: null, note: "no WebGL2 fence" };
    const w = Math.max(1, renderer.domElement.width), h = Math.max(1, renderer.domElement.height);
    rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true });
    ref = referenceScene(); ref.cam.aspect = w / h; ref.cam.updateProjectionMatrix();
    prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.compile(ref.scene, ref.cam);            // shader compile is not measured
    renderer.render(ref.scene, ref.cam); await gpuFinish(gl, 1500);
    for (let rep = 0; rep < 7 && now() - t0 < GPU_BUDGET_MS; rep++) {
      const t1 = await timeBatch(renderer, gl, ref, 1);
      const t3 = await timeBatch(renderer, gl, ref, 3);
      if (t1 < 0 || t3 < 0) break;
      samples.push(Math.max(0.05, (t3 - t1) / 2));
      onProgress(30 + rep * 9);
      if (t1 > 120) { slow = true; break; }
    }
  } catch (e) {
    return { ms: null, note: "test skipped (" + (e && e.message) + ")" };
  } finally {
    try { if (prev !== null || rt) renderer.setRenderTarget(prev); } catch (_) {}
    try { rt?.dispose(); ref?.dispose(); } catch (_) {}
  }
  samples.sort((a, b) => a - b);
  const ms = samples.length ? samples[samples.length >> 1] : null;
  return { ms: slow ? Math.max(ms ?? 0, 121) : ms, note: null };
}

// ---- the step --------------------------------------------------------------------------------
/**
 * @param renderer  the game's WebGLRenderer
 * @param progress  (pct 0..100, line?) => void  — drives the TESTING row
 */
export async function runQualityTest(renderer, progress = () => {}) {
  const t0 = now();
  let shown = 0;   // the row only moves forward
  const say = (p, line) => { shown = Math.max(shown, p); try { progress(shown, line); } catch (_) {} };
  const why = [];
  let tier = "high", cached = false, msPerUnit = null, key = "";
  say(5, "Looking at this device…");

  // Device check first: one tier source (Compassion reads the same cached result later).
  let dc = null;
  try {
    const mod = await import("./deviceCheck.js");
    dc = mod.runDeviceCheck(renderer);
  } catch (_) { /* not present on this build */ }
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    key = dc?.key || [VERSION, gpu, `${screen.width}x${screen.height}@${devicePixelRatio}`, navigator.hardwareConcurrency].join("|");
  } catch (_) {}
  say(15);

  const forced = forcedTier();
  const saved = forced || urlParams().has("retest") ? null : readCache(key);
  if (forced) {
    tier = forced; why.push(`forced by ?tier=${urlParams().get("tier")}`);
  } else if (saved) {
    tier = saved.tier; msPerUnit = saved.msPerUnit ?? null; cached = true;
    why.push(`saved for this device (${new Date(saved.at).toISOString().slice(0, 10)})`);
  } else {
    if (dc) { tier = fromNumber(dc.tier); why.push(`device check: tier ${dc.tier}${dc.reasons.length ? " — " + dc.reasons.join("; ") : ""}`); }
    say(25, "Testing drawing speed…");
    const g = await gpuTest(renderer, (p) => say(p));
    msPerUnit = g.ms;
    if (g.note) why.push(g.note);
    if (msPerUnit != null) {
      const gt = msPerUnit > LOW_MS ? "low" : msPerUnit > MEDIUM_MS ? "medium" : "high";
      why.push(`GPU ${msPerUnit.toFixed(2)} ms per unit -> ${gt}`);
      tier = lower(tier, gt);           // the GPU test may only lower the tier
    }
    writeCache({ v: VERSION, key, tier, msPerUnit, at: Date.now() });
  }
  // Mark wants to SEE this step: a fast device (or a saved result) finishes in ~20-200 ms, so the
  // row fills evenly over at least MIN_SHOW_MS. Once per load; nothing else waits on frames here.
  while (now() - t0 < MIN_SHOW_MS) {
    say(Math.round(92 * (now() - t0) / MIN_SHOW_MS));
    await new Promise((r) => setTimeout(r, 60));
  }
  say(96, "Choosing the best world for this device…");

  const q = {
    tier, budget: tier, why, cached, msPerUnit, key,
    budgets: { ...BUDGETS[tier] },
    ms: Math.round(now() - t0),
    report() { return `quality ${tier} (${why.join("; ")}) in ${this.ms} ms${cached ? ", saved" : ""}`; },
  };
  try { window.SacredQuality = q; } catch (_) {}
  return q;
}

/** Kind line for the loading log. Never "slow" or "weak". */
export function kindLine(tier) {
  return tier === "low" ? "This device: Lighter world — same adventure"
       : tier === "medium" ? "This device: Balanced world" : "This device: Full world";
}
